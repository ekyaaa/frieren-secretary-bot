# Technical Architecture & Contracts — Frieren Discord Logbook

> Status: reference implementation design. Product requirements are authoritative in `@docs/FRIEREN_DISCORD_LOGBOOK_PRD.md`.  
> Date: 2026-11-11.

## 1. Baseline + recommended runtime

### Recommended monorepo

```text
frieren-discord-logbook/
├─ AGENTS.md
├─ docs/
│  ├─ FRIEREN_DISCORD_LOGBOOK_PRD.md
│  ├─ ANTIGRAVITY_IMPLEMENTATION_PROMPT.md
│  ├─ ARCHITECTURE_AND_API.md
│  ├─ TEST_PLAN_AND_ACCEPTANCE.md
│  ├─ DEPLOYMENT_AND_SECURITY.md
│  ├─ LOGBOOK_FORMAL_PROMPT.md
│  ├─ frieren_system_prompt_english.md
│  └─ frieren_gemini_example_english.md
├─ apps/
│  ├─ bot/                  # discord.js TypeScript; slash commands, DM, buttons, modals, mention/reply
│  ├─ api/                  # Fastify TypeScript; authenticated agent/public + internal + dashboard APIs
│  ├─ admin-dashboard/      # React/Vite admin only, not required for end-users
│  └─ local-agent/          # Python: Git scanner, GUI, offline queue, installers
├─ services/
│  └─ dermaga-worker/       # Python: extracted domain adapter + Playwright verification
├─ packages/
│  ├─ contracts/            # zod or JSON Schema DTO, status types, request signatures
│  ├─ db/                   # schema & migrations, repositories
│  ├─ ai/                   # @google/genai, key rotation, persona + formal prompt wrapper
│  └─ scheduler/            # durable job producers/consumers
├─ infra/
│  ├─ docker-compose.yml
│  ├─ docker/
│  └─ migrations/
├─ .github/workflows/       # server CI and Windows/Linux agent releases
├─ .env.example             # placeholders ONLY
├─ package.json
└─ README.md
```

Alternative allowed: move backend+worker to Python (FastAPI) if faithful reuse materially improves quality, but **keep the provided Gemini/discord.js example reviewed**; justify in ADR and don't silently lose user requirements. Only trusted backend (not local agent) holds user DERMAGA/Gemini credentials.

### Components & responsibilities

1. **Discord gateway**: routes slash commands, DM follow-up, interactions; never accesses DB SQL directly outside repository layer; responds quickly then queues jobs.
2. **API/Domain**: account, guild, membership, pairing, commit ingestion, revision, approval, retrieval, auth and audit.
3. **Local Agent**: only local Git filesystem scanner + optional GUI; does not have DERMAGA password or Gemini key; outgoing HTTPS/JSON.
4. **Scheduler/Workers**: produce reminders and guild posts, protect state with transaction locks, run Gemini and DERMAGA jobs with safe retry policy.
5. **DERMAGA worker**: login/CSRF, pre-check, submit, post-check; Playwright refresh, DOM verify, screenshot. No Discord token in DERMAGA worker.
6. **AI service**: two isolated prompts: Frieren English for Discord text; formal Indonesian for logbook summary. Gemini global env-key pool then user key for retryable errors.
7. **Admin UI**: env credential-only sessions, overview, logs, reruns of safe reconciliation. No user-facing login web.

## 2. Trust boundaries

```text
[Discord users] --events, modal, DM--> [Bot]
                                         |
[Local Agent] --HTTPS device bearer------>| [API + auth middleware] --transactions--> [Postgres]
                                         |                          |
                                         +-- enqueue ----------> [durable scheduler]
                                                                    |
             [Google Gemini] <-- AI request -----------------------+
                                                                    |
                  [DERMAGA] <-- authenticated portal session -- [Worker]
                    ^                                            |
                    +------ Playwright reload + DOM verify -------+
                                                                evidence private storage
[Platform Admin Browser] --Funnel /admin HTTPS--> [admin auth + UI/API]
```

- Agent token is device-scoped with hash at rest; no admin session cookie accepted on agent routes.
- Internal queue worker communications use internal network + service authentication if separated.
- Host admin API bound to loopback behind existing Funnel; `/admin` vs `/api/v1/agent` enforce separate auth.
- Treat commit text and Discord message history as **data** even if they resemble prompt instructions.

## 3. Operational states and idempotency

### Domain enums

```typescript
type LogbookStatus =
  | 'NOT_DUE' | 'DM_BLOCKED' | 'NEEDS_MANUAL_INPUT' | 'AGENT_OFFLINE'
  | 'DRAFT_READY' | 'EDITING' | 'APPROVED' | 'AUTO_WAITING'
  | 'AWAITING_WORK_END' | 'QUEUED_SUBMIT' | 'SUBMITTING'
  | 'SUBMITTED_UNVERIFIED' | 'RECONCILING' | 'UNVERIFIED_RETRYABLE'
  | 'NEEDS_ATTENTION' | 'VERIFIED' | 'SKIPPED' | 'AUTO_CANCELLED';

type EvidenceStatus = 'NONE' | 'SCREENSHOT_PENDING' | 'READY' | 'SCREENSHOT_FAILED' | 'DM_SENT' | 'DM_FAILED';
```

Prefer separate `entry.status` and `evidence.status` rather than one enum creating accidental state explosion. Add transition guards; never let an AI model transition states.

### Unique constraints

- `UNIQUE(user_id, target_date, portal_account_id)` on logical entry; support optional explicitly authorized multiple-entry portal mode only after schema change.
- `UNIQUE(entry_id, idempotency_key)` on submissions; lock `entry_id` in transaction during eligibility & queue claim.
- `UNIQUE(user_id, target_date, notification_type)` on DM notification events.
- `UNIQUE(guild_id, target_date, post_type)` on checklist/final ping.
- `UNIQUE(device_id, agent_snapshot_idempotency_key)` on agent ingest.
- `UNIQUE(pairing_code_hash)` and TTL, one-time claim.
- A `revision_id` is bound into every button/approval action. Never submit a stale revision.

### Auto job algorithm

```text
reminder_due(user,date):
  if date not active or verified -> return
  if no data -> send DM with 'needs input'; do not start automatic send
  send_dm(user, revision, controls)
  if sent:
    store delivered_at=now, schedule review_deadline at delivered_at+15 minutes
  else:
    store DM_BLOCKED / API_FAILURE, no silent auto-submit

review_deadline(user,date):
  with per-entry DB lock:
    if !auto_enabled OR skipped OR editing OR current_revision != notified_revision: return/hold
    if no valid, source-supported draft: NEEDS_MANUAL_INPUT
    if user end_time later than now: AWAITING_WORK_END, reschedule once at end time
    else enqueue_submitting if portal preflight & idempotency allow

submit_job(entry,revision):
  lock entry, reread settings, check status and portal precheck
  if already exists: reconcile, no POST
  else POST exactly once per controlled attempt
  on timeout/unknown: reconcile before re-post
  after candidate submit: enqueue fresh_verify

fresh_verify(entry):
  authenticated browser session -> navigation/reload -> wait for correct DOM
  assert matching account/date/summary/time from read content
  if match: VERIFIED; capture screenshot after verified DOM; deliver evidence DM
  else: SUBMITTED_UNVERIFIED, bounded read-only retry, no premature verified
```

**Reminder default:** 16:00 WIB; review deadline 16:15; working end 16:25 -> eligible at 16:25. A reminder is not the same as a completion promise. All job times stored as UTC instants with timezone conversion.

## 4. API contract sketches

### 4.1 Pairing flow

```http
POST /internal/v1/agent-pairing/create
Authorization: internal bot service credential
Content-Type: application/json

{"discordUserId":"123...","requestedBy":"123..."}
```

Response (to bot only):

```json
{"pairingId":"pair-opaque","humanCode":"DEMO-PAIR-CODE","expiresAt":"2026-11-11T12:00:00Z"}
```

Agent claim (public API):

```http
POST /api/v1/agent/pair/claim
Content-Type: application/json

{"code":"DEMO-PAIR-CODE","deviceId":"device-generated-uuid","platform":"win32","version":"1.0.0"}
```

Response includes scoped bearer token (shown to agent only, not logged) once. Store its **hash** in DB; use OS secure storage on laptop. Enforce 5-minute expiry, 5 attempts max, atomic claim, and IP/device rate limit.

### 4.2 Commit snapshot

```http
POST /api/v1/agent/commit-snapshots
Authorization: Bearer <redacted_device_token>
Content-Type: application/json
Idempotency-Key: <opaque-hash>

{
  "deviceId": "device-generated-uuid",
  "targetDate": "2026-11-11",
  "timezone": "Asia/Jakarta",
  "repositories": [{"repoId":"r1","alias":"bot-services","branch":"main"}],
  "commits": [
    {"repoId":"r1","hash":"abcdef0","author":"developer@example.com",
     "committedAt":"2026-11-11T09:42:00+07:00",
     "subject":"fix validation", "body":"Prevent empty input",
     "changedFileStats":{"files":2,"insertions":12,"deletions":3}}
  ],
  "digest":"sha256-of-canonical-payload",
  "idempotencyKey":"opaque-id"
}
```

Reject unknown `deviceId`, repos not assigned to token owner, too-large payload, invalid timestamp/date, unexpected file contents, cross-device spoof. Accept even when there are zero commits as **empty snapshot**, not a fabricated report. Response `202`/`200` with ingestion ID and idempotent status.

### 4.3 Revision & submission

```json
{
  "entryId": "entry-uuid",
  "userId": "discord-snowflake",
  "targetDate": "2026-11-11",
  "revisionId": "rev-uuid",
  "summary": "Melakukan pengembangan dan perbaikan ...",
  "source": "GEMINI_FROM_GIT",
  "sourceSnapshotId": "snapshot-uuid",
  "startTime": "07:10",
  "endTime": "16:25",
  "locationProfileId": "loc-uuid",
  "status": "DRAFT_READY"
}
```

On submit, enforce user ownership, current revision, explicit click or user auto opt-in, portal account readiness, and idempotency lock. Backend event emitted e.g. `submission.verified` contains only `entryId, date, evidenceId, timestamp`, no credential.

### 4.4 Guild checklist payload

```json
{
  "guildId":"123...",
  "date":"2026-11-11",
  "verified":[{"userId":"111...","display":"Member A"}],
  "pending":[{"userId":"222...","display":"Member B"}],
  "missing":[{"userId":"333...","display":"Member C"}],
  "skipped":[],
  "statusAsOf":"2026-11-11T10:50:00Z"
}
```

Bot posts counts and short list. At checklist time `all-participants` policy may mention enrolled users only, subject to rate-limit and truncation (split into bounded messages if needed). At final ping mention only missing/unverified users. No `@everyone` by default. Explicit `allowedMentions.users=[...allowed scoped IDs]` rather than `parse:['everyone']`.

## 5. DERMAGA worker: POST vs fresh DOM verified proof

The core of this project is a **two-phase distinction**: `SUBMITTED_UNVERIFIED` is not `VERIFIED`.

```python
# Pseudocode — adapt URLs/locators only after inspecting permitted portal or test fixtures.
async def submit_then_verify(entry, credentials):
    portal = await login_dermaga(credentials)
    existing = await portal.fetch_monitoring()  # pre-check
    if matching_entry(existing, entry):
        return await capture_existing_verified_entry(portal, entry)

    post_result = await portal.submit_form(entry)
    # POST result is NOT proof; it is merely an attempt.
    page = await portal.browser_page()
    await page.goto(MONITORING_URL, wait_until="domcontentloaded")
    await page.reload(wait_until="domcontentloaded")   # if needed to force fresh server state
    await wait_for_relevant_table(page)
    row = find_row_with_date_time_and_summary(page, entry)
    if not await row_is_verified(row, entry):
        return {"status":"SUBMITTED_UNVERIFIED", "attempt":post_result}

    # Only after asserting the matching row is on this freshly loaded page:
    screenshot = await row.screenshot(animations="disabled")
    return {"status":"VERIFIED", "evidence_bytes":screenshot}
```

Verification minimum: authenticated session belongs to expected account, row/record target date (timezone correct), expected work duration or content fingerprint, no obvious mismatching other person's data. If matching is ambiguous, do not mark verified and capture evidence of wrong row. Save screenshot with content hash & timestamp; DM only owner. Use DOM assertions rather than AI vision to decide status; screenshots alone may be misleading.

**HTTP 200 problem in existing code:** in the reviewed `submit_dermaga_entry`, unclear response may be returned success. This must be fixed/contained in the new adapter. **GPS:** existing `apply_gps_jitter` must not be reused to fake location; use accurate user-authorized data.

## 6. Gemini prompt & key routing

Two different `generateContent` use cases:

**Persona:** read `@docs/frieren_system_prompt_english.md` verbatim as `systemInstruction`; backend passes trusted JSON event, sanitize identifiers, approved context; reply English, verified facts only. `@docs/frieren_gemini_example_english.md` provides example (`@google/genai`, `discord.js`, `.deferReply`, `.editReply`) but is an instruction example, not an already registered handler. For **scheduled DM**, call Discord `user.send` (not `interaction.reply`); for guild slash commands use ephemeral interaction response.

**Logbook:** read `@docs/LOGBOOK_FORMAL_PROMPT.md` as a **separate** `systemInstruction` and validate output against schema; no Frieren style. Include all commits for day, limited to configured projects/authors, no made-up work or work-hours.

Key order:

```text
global env keys [GEMINI_API_KEY_1, GEMINI_API_KEY_2, ... GEMINI_API_KEY_N]
 -> retryable timeout, 429, 5xx, provider outage => rotate next healthy key
 -> after global pool exhausted => encrypted per-user key
 -> if all failed => error event + safe deterministic fallback; NO fabricated success
```

Do not rotate for 400 bad payload, prompt invalid, hard auth rejection of application, content policy failures; handle invalid key by marking only that key unhealthy. Circuit breakers/cooldowns & retry windows prevent rate-limit loops. Validate actual Gemini model availability in SDK; example specifies `gemini-3.8-flash`, but model IDs and access change—make env configurable and implement a verified supported default rather than assuming example string always works.

## 7. Conversation & message security

- Guild mention/reply processing only in configured channels or with explicit mention/reply; require correct Discord gateway intents as needed; strip ping control and quoted snippets.
- History DM: last 10–20 safe turns or capped token budget, TTL 7 days configurable, user delete command available.
- Discord bot message content restrictions apply in guilds; never rely on inaccessible history.
- AI is stateless text generation with backend-provided verified structured state; never accept natural language alone as permission to POST or execute arbitrary scripts.
- All strings to Discord escape Markdown/mentions where appropriate; allow mentions only deliberately in checklist/ping code.

## 8. Dashboard auth & privacy

Admin session login is separate from Discord user identity. Read `ADMIN_DASH_USERNAME` and `ADMIN_DASH_PASSWORD` on startup. No fallback to a known built-in admin account. Store session server-side or signed JWT cookie with short expiry; secure/httpOnly/SameSite & CSRF. Lockout/rate-limit password attempts. Dashboard API returns masked credentials and no raw API keys. Verify all evidence lookups require admin session or owner-via-bot access.

## 9. Release and process boundaries

- Agent release CI builds Windows & Linux from tagged versions and produces `sha256sums.txt`, documented manual install, artifact retrieval in Discord attachment where feasible.
- Backend worker Playwright Chromium must be installed in container at build time (`playwright install --with-deps chromium` as suitable).
- `docker compose up` on server with bot, API, Postgres, durable worker and dashboard; no dependency on user laptop for process startup.
- Test against fixtures by default; **never perform live DERMAGA submit without explicit confirmation and authorized credentials**.
- GitHub token in CI only, no public release bundling `.env`, access token, user credentials, screenshots or actual commit data.
