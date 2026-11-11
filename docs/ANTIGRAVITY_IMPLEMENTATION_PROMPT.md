# ANTIGRAVITY MASTER AGENT PROMPT — Build Frieren Discord Logbook Automation

> **COPY THIS FULL DOCUMENT INTO THE ANTIGRAVITY AGENT CHAT.**  
> Recommended mode: **Planning Mode**, then implementation execution using its Implementation Plan, Task List, and Walkthrough artifacts.  
> Project target: a complete, working, tested, deployable product—not merely a concept, documentation, or UI mockup.  
> Date of requirements freeze: **2026-11-11**.

---

## 0. ROLE, MISSION, AND MANDATORY CONTEXT

You are the **principal full-stack engineer, backend/automation architect, senior test engineer, and technical owner** implementing **Frieren Discord Logbook Automation**. Deliver a secure, maintainable, production-minded multi-user Discord bot + Local Git Agent + DERMAGA integration + admin-only dashboard. Do actual implementation and testing in this workspace.

**Mandatory documents (open and read ALL completely before making architecture decisions or changing code):**

1. **PRIMARY REQUIREMENTS / FINAL SOURCE OF TRUTH:** `@docs/FRIEREN_DISCORD_LOGBOOK_PRD.md`
2. **SYSTEM ARCHITECTURE, CONTRACTS, STATE MODEL:** `@docs/ARCHITECTURE_AND_API.md`
3. **TEST PLAN / RELEASE GATES:** `@docs/TEST_PLAN_AND_ACCEPTANCE.md`
4. **DEPLOYMENT, TAILSCALE FUNNEL, .ENV:** `@docs/DEPLOYMENT_AND_SECURITY.md`
5. **SEPARATE INDONESIAN LOGBOOK SUMMARY PROMPT:** `@docs/LOGBOOK_FORMAL_PROMPT.md`
6. **EXACT USER-SUPPLIED CHARACTER SYSTEM PROMPT:** `@docs/frieren_system_prompt_english.md`
7. **USER-SUPPLIED GEMINI + DISCORD.JS REFERENCE CODE:** `@docs/frieren_gemini_example_english.md`
8. **WORKSPACE GUIDELINES AND REFERENCES:** `@AGENTS.md` (if present in workspace root)

The `@docs/...` references above are deliberate **Antigravity workspace file mentions**. They must resolve to real files in the working directory. If a file is absent, look for the attached docs bundle; do not invent its content. Preserve the original Frieren prompt file exactly unless the user explicitly requests modification.

External reference codebases to inspect:

- https://github.com/Oktavian19/bot-services (Python Telegram bot; existing DERMAGA login/submission, credential encryption, scheduler, logbook database).
- https://github.com/Oktavian19/logbook-cli (local Git scanner, commit summaries, offline queue, Windows/Linux release pipeline).
- DERMAGA portal login: https://jti.polinema.ac.id/dermaga/login

**Important:** Existing system is Telegram, but the desired system is Discord. Reuse or adapt tested domain logic, NOT the Telegram UX. The Git repositories are on individual users' laptops, **not on the VPS**. Never pretend the bot can open those paths from the server.

### Outcome checklist

By completion, there should be a runnable codebase featuring:

- Discord bot in multiple guilds, stable per-user identity, DM-only private onboarding/reminders/review/confirmations/screenshots.
- Guild channels containing only scheduled participation checklist and final missing-user ping.
- Windows/Linux Local Agent with GUI folder selector, Git scan, pairing, offline queue, auto-start option, and release workflow.
- Secure agent HTTP ingestion API, device pairing, per-user settings and accounts.
- Gemini persona (English-only) + **separate** formal Indonesian logbook generator, global ordered key fallback then user API key.
- Durable T+15-minute review workflow, auto-submit opt-in, manual editing and safe retry.
- DERMAGA submit and **freshly reloaded monitoring page verification using Playwright**, screenshot proof privately DM'd to the owner.
- Static `.env` admin login, dashboard restricted to platform admin, deployed behind **existing Tailscale Funnel**, without forcing normal users to access the web.
- Database schema/migrations, tests, CI, Docker Compose, deployment guide, and honest implementation walkthrough with limitations.

---

## 1. NON-NEGOTIABLE BUSINESS DECISIONS (DO NOT OVERRIDE)

### 1.1 Communication routing

**PRIVATE:** All setup, credentials, scheduling preferences, Git report preview, manual content, Gemini settings, reminder, edit, regenerate, approval, submission progress, final status, and screenshots occur in **Discord DM**. If a user begins via a guild slash command, give an ephemeral bridge reply only, then continue privately in DM. Background scheduler notifications are **regular DMs**, not ephemeral (ephemeral cannot be sent as a general scheduled DM).

**PUBLIC CHANNEL:** Only (a) a scheduled checklist of enrolled guild members and completion state, and (b) the last ping of users who are still missing/unverified. No credentials, drafts, commit contents, screenshots, personal history, or daily private reminders in guild channel. Checklist may mention all **enrolled guild participants** per config; last ping mentions only those still missing/unverified. Never use unrestricted @everyone by default.

**DM FAILURE:** If DM is blocked or fails, do not claim it was delivered, do not run the review timer, and do not silently auto-submit based on that nonexistent notification. Record `DM_BLOCKED` or transport failure. On user command in a guild, explain recovery using an ephemeral response.

### 1.2 Git source location

Git folders are on each user's laptop. Implement **Local Agent** for Windows and Linux. The agent gets its own bounded-access device token through an encrypted HTTPS pairing flow and reads only user-authorized local folder paths. The agent transmits commit **metadata** (subject, body, hash, timestamp, repo alias, optional changed-file statistics), not entire code, secrets, .env files, or private repo credentials. Provide GUI repo chooser and automatic sync/replay after offline periods. **Never implement arbitrary remote command execution from Discord.**

### 1.3 User setup and defaults

- Primary key: stable Discord User ID; guild membership is many-to-many.
- User-specific mandatory setup: DERMAGA username, password, Gemini API key, local project folder(s)/paired agent, authorized location if required by portal.
- Derive Discord identity/server from Discord itself; no asking user to type server IDs.
- Default reminder **16:00 Asia/Jakarta**.
- Default work start **07:10** and end **16:25**.
- Default working days **Monday through Friday**; allow all seven days via settings.
- Auto-submit default **OFF**, explicit opt-in.
- Review window is **15 minutes from successful DM reminder delivery**.
- Because default work end is 16:25, auto eligibility triggered at 16:15 must **wait until actual configured end-time** before submitting future-looking attendance; implement `AWAITING_WORK_END` with transparent DM status. The review timer remains 15m.
- One user in multiple guilds receives **only one daily DM**, but can be listed in each guild's checklist if enrolled there.

### 1.4 Admin web

- **Only platform admin uses web. Regular users never need web login.**
- Read static username/password from real private `.env`, with operator-chosen values:
  `ADMIN_DASH_USERNAME=atmin`, `ADMIN_DASH_PASSWORD=password123`.
- No Discord OAuth login for dashboard. Do not hardcode these as unconditional fallbacks or commit real secrets to a public repo. `.env.example` uses placeholders; documentation says what operator sets in their private `.env`.
- The user has explicitly accepted the risk of this weak chosen password on their own server. **Do not derail the implementation by arguing with this decision or silently change it.** Still implement session auth, secure cookies, CSRF, throttling, proper server-side authorization, redacted logs, and no exposed credentials.
- Existing **Tailscale Funnel** is the selected ingress. Funnel is publicly reachable, unlike Serve. Respect the operator's existing mapping and do not overwrite/uninstall/reconfigure it without actual host info and authorization. Bind UI/api to appropriate local ports and document how to connect to existing Funnel.

### 1.5 DERMAGA screenshot verification

This is a **hard acceptance requirement**:

1. Determine whether an entry already exists for the expected account/date before sending POST.
2. Submit user-approved or opted-in validated text to DERMAGA, using existing portal auth/CSRF as foundation.
3. **AFTER the submission attempt, navigate/reopen/reload monitoring page in a fresh browser state using Playwright.** Do not screenshot a stale DOM or submit success alert.
4. Find the actual row/card for the correct account, date, and content/time; confirm via DOM on the reloaded page.
5. Only after DOM verification mark the entry VERIFIED, capture a screenshot showing that record on the refreshed page, compute evidence hash/timestamp, store privately.
6. Send screenshot privately to the corresponding user's DM; **never to a guild channel**.
7. If the POST returned HTTP 200 but refreshed page lacks record, report `SUBMITTED_UNVERIFIED`/reconciliation pending, **not success**. On timeout, reconcile before trying another POST.
8. If verified but screenshot capture or DM delivery fails, keep submission VERIFIED and separately mark evidence/send failure; never duplicate POST to fix screenshot.

Ensure Playwright fixture-based integration tests prove a navigation/reload occurred **after** POST and before screenshot. The owner has specifically agreed with refresh-before-screenshot.

### 1.6 Persona + language + Gemini

- Read `@docs/frieren_system_prompt_english.md` verbatim as the **persona system instruction**. Its **English-only rule is absolute for Frieren's user-visible messages**, even if the user writes Indonesian.
- Character should be gently playful, thoughtful, not monotonous; avoid `Master~`, anime catchphrase spam, repeated `Hm...`, or claiming imaginary achievements.
- Use `@docs/frieren_gemini_example_english.md` as a **reference**, not a completed handler. It uses `@google/genai`, `discord.js`, `deferReply({ flags: MessageFlags.Ephemeral })` for an interaction. For scheduled notifications you must use normal Discord DM sends; don't try to invoke ephemeral replies without an interaction.
- Keep **formal Indonesian DERMAGA description generation** completely separate and use `@docs/LOGBOOK_FORMAL_PROMPT.md`. The persona must not leak into official logbook text.
- Global Gemini keys in `.env`: attempt key1, key2, ... keyN in configured order when retryable provider/quota/network issues arise, then **user's encrypted Gemini key**. Never print keys. Do not rotate on nonretryable semantic/invalid payload errors or policy blocks; handle individual invalid key health explicitly.
- Gemini failure must not prevent basic command/status operation; use factual deterministic English fallback templates for messages, manual review mode for summary. No fabricated commit content, successful submission, or screenshot.
- When bot is mentioned or replied to, answer conversationally with recent **authorized** history; avoid cross-user/guild leakage, implement bounded context retention and Discord intents as needed.
- Never use casual chat content as direct permission for sensitive actions. Approval requires backend-verified button/interaction ownership and explicit user opt-in.

### 1.7 Security and factual integrity

- Encrypt DERMAGA credentials and user Gemini keys at rest, hash device/pairing tokens, validate guild/user authorization, prevent stale callbacks and duplicate submission.
- No fake attendance/work hours/GPS/commits. Review existing GPS jitter logic before reuse; remove behaviors that invent locations.
- Use bound queries and schema validation; keep evidence private; redact secrets and response cookies in logs.
- The system must always distinguish `SUBMITTED_UNVERIFIED`, `VERIFIED`, and `SCREENSHOT_FAILED/DM_FAILED`.

---

## 2. ANTIGRAVITY-SPECIFIC EXECUTION PROTOCOL

**Use Planning Mode, not Fast Mode**, for this complex multi-service application. In your first action:

1. Read all the `@docs/` references above and root `@AGENTS.md`.
2. Inspect workspace contents (`ls`, `tree`, git status), identify whether this is a new repo or existing project; do not delete unrelated user files.
3. Inspect the actual current code in `Oktavian19/bot-services` and `Oktavian19/logbook-cli` if network/permissions permit. Search and read real implementations (`logbook_service.py`, `logbook_repo.py`, `logbook_api.py`, `scheduler.py`, `logbook_cli.py`, release workflow). Don't guess function signatures from README alone.
4. Emit an **Implementation Plan Artifact** with high-level stack decision, components, identity/security model, API/data migrations, state machine, handling of Playwright re-verification, a sequence of phases, risks and dry-run testing strategy.
5. Emit a **Task List Artifact** with atomic steps and dependencies; map each major step to product acceptance criteria `AC-01` ... `AC-15` and test IDs `T001` ... `T050`.
6. Write architecture ADR(s) under `docs/adr/`, especially on reuse of old Python code vs TypeScript services, durable queue, local agent packaging, and public Funnel separation.
7. Proceed to **actual implementation**, running targeted tests per phase and iterating until they pass. If your Antigravity review policy requires approval of the plan, provide the plan for review; otherwise continue per user task without unnecessary questions.
8. At each phase, update the Task List and produce **evidence artifacts** (test results, relevant screen captures/browser recordings for dashboard/fixtures where useful, concise walkthrough notes). Do not pass off speculative test results as executed.
9. Finish with **Walkthrough Artifact**: file tree, implemented features vs remaining limitations, commands run, tests and results, screenshots/recordings if real, startup/deploy steps, exact unresolved risks.

This is a real engineering deliverable. **Do not stop after writing architecture or placeholder functions.** Do not claim deployed/live DERMAGA submission or real Discord message unless you actually performed it with authorization and logged result. If the task cannot complete in one agent turn, implement the largest vertical slice that is runnable, preserve state in code/docs, and clearly label remaining work; do not leave a mock-only product described as complete.

### Suggested task ordering

**Phase 0: Repo audit and architecture (do before coding)**
- Read existing repository source and imported persona files.
- Create `docs/adr` with decisions and `docs/implementation-plan.md` mapped to PRD.
- Establish deterministic fixture DERMAGA and Discord mock simulator; obtain no credentials from user.

**Phase 1: Infrastructure & identity**
- Scaffold monorepo services, package manager, TS strict settings, Python worker/agent environments.
- Postgres schema/migrations, encryption utilities, durable queue, transaction locks, RBAC.
- Bot gateway + slash command registration and DM routing; multi-guild membership lookup; DM failure route.
- Admin login page & protected dashboard skeleton via `.env` credentials, with secure sessions.

**Phase 2: Agent + pairing**
- Fork/adapt Git scanner from `logbook-cli`, support explicit folder picker, repo discovery, local persisted config, offline retry, heartbeat, run-on-startup option.
- Pairing code issuance in DM, 5-minute single-use token claim, device revocation, token storage.
- Agent HTTP ingestion, snapshot hashing, author/date filtering, safe repo metadata.
- Versioned Windows/Linux build workflows, Discord `/agent install` button flow, attachment-or-release-link fallback.
- README with screenshot/mock of GUI and tested local run commands.

**Phase 3: Gemini + daily review**
- Build AI client with global env key pool -> user's encrypted key on retryable failures; cooldown, model config and cost/rate limits.
- Implement persona event renderer (verifiable factual data -> English Frieren text) and formal Indonesian summary generator as separate prompt/validation paths.
- Build per-user schedule with 16:00 default, 07:10–16:25 work interval, Mon–Fri, 15-minute review timer.
- DM draft with button flows, modal edit, revision ownership, manual input, regenerate, snooze, skip, approve, submit now.
- Prevent double DM cross-guild. Ensure `DM_BLOCKED` cannot start auto timer.

**Phase 4: DERMAGA worker + Playwright verification**
- Extract or port tested Python DERMAGA logic while isolating Telegram `chat_id` assumptions. No fake GPS jitter.
- Implement submit with portal preflight, CSRF, session, dedup, robust status classification.
- Playwright browser login, fresh navigation/reload, DOM verification, screenshot after match, encrypted/private evidence storage + SHA256.
- DM screenshot and status. Separate successful portal record from evidence delivery success.
- Mock fixtures test POST 200 no row, timeout, wrong user/date, matched record, screenshot failure.

**Phase 5: Guild posts and full admin dashboard**
- Guild admin config of channel and times; no predefined channel name assumptions.
- Checklist scheduled per guild with all enrolled participant mentions when configured, verified/pending/missing status; final ping missing users only; idempotent posts.
- Dashboard cards/tables/filters: user registry, guilds, memberships, agent status, logbook entries/evidence, scheduled jobs, system/API/queue health, Gemini key health (masked) and audit.
- Verify only admin can access web; no regular user web login.

**Phase 6: Reliability/CI/deployment**
- Rate limits, CSRF, secure cookie and Funnel host/trusted-proxy handling, lost DM safe fallback, retry policies, manual reconciliation.
- Docker Compose deployment with migration, Playwright Chromium install, private screenshot mount, health endpoints; docs on reusing existing Funnel (not reconfiguring it).
- CI lint/typecheck/unit/integration tests, agent packaging workflows, optional API contract generator.
- Run full release gates and add test report with honest pass/fail/unrun labels.

### Parallelizable workstreams (if Antigravity supports multiple Agents)

- Workstream A: DB schema, backend API, scheduler, idempotency.
- Workstream B: Discord commands, DM UX, Frieren persona and Gemini routing.
- Workstream C: Local Agent GUI, Windows/Linux packaging, pairing.
- Workstream D: DERMAGA Python worker, Playwright fresh-refresh verification, fixture tests.
- Workstream E: Admin dashboard + operational docs, UI E2E.

Assign ownership to disjoint directories where possible. Align shared schemas first. Avoid multiple agents editing migration state or shared contract files simultaneously without reconciliation.

---

## 3. STACK PREFERENCE & IMPLEMENTATION GUARDRAILS

Preferred stack (choose it unless code audit gives compelling reason not to):

```text
apps/bot/                TypeScript, discord.js (v14+ compatible current)
apps/api/                TypeScript, Fastify, secure sessions / zod schemas
apps/admin-dashboard/    TypeScript React/Vite with admin-only authenticated API
apps/local-agent/        Python + GUI (Tkinter/PySide6 based on packaging tradeoff)
services/dermaga-worker/ Python async aiohttp/BeautifulSoup + Playwright Chromium
packages/ai/             @google/genai or SDK-compatible current client
packages/contracts/      typed DTO + JSON Schema validated in Node/Python
packages/db/             Postgres migrations and repositories
packages/scheduler/      durable Postgres-backed jobs, retries/locks
infra/                   Docker Compose, Dockerfiles, release workflows
```

Read actual user supplied `@docs/frieren_gemini_example_english.md`. It is JavaScript text stored in `.md` with a notice to rename to `.mjs` before executing. **Do not `import` the Markdown file as code.** Implement a proper TypeScript module equivalent, using its SDK structure correctly and reading the actual system prompt path.

Implementation quality:

- Strict type checking, safe input validation, structured error taxonomy, unit-testable services, dependency inversion for Discord/Gemini/DERMAGA.
- No SQL string interpolation with user-provided values, no shell execution from untrusted messages, no insecure certificate verification overrides.
- Cap Discord output length, avoid accidental mentions; explicit allowlist for guild checklist/last ping mentions.
- For long-running slash interaction actions, `deferReply` promptly and send result via private DM/event; background notifications use `user.send`/DM API.
- Gemini prompt loading from configured path, cache and reload policy documented. Capture prompt version/checksum in logbook revision metadata.
- Use stable UTC scheduler jobs, idempotency, per-user/date transaction locks; fake clock for deterministic tests.
- Git author/timezone semantics explicitly tested; ensure timezone-day cutoff correct.
- Be transparent when details of live DERMAGA HTML cannot be examined. Build against fixtures and provide a deployment verification step rather than guessing locators and declaring success.
- Treat backend state as authoritative for AI responses. AI cannot claim screenshot was captured until worker succeeded.

---

## 4. SPECIFIC CODE PATHS / REUSE GUIDANCE

Audit and extract from `bot-services`:

- `app/services/logbook_service.py`: test/login DERMAGA, scrape monitoring, submission. **Review `submit_dermaga_entry` success return when HTTP response ambiguous**; prefer explicit read-back verification.
- `app/database/logbook_repo.py`: old encrypted credentials and draft operations; map to new schema.
- `app/services/logbook_api.py`: existing device/CLI Bearer token and draft ingestion pattern.
- `app/services/scheduler.py`: APScheduler reminder logic; adapt to durable queue.
- `app/bot/handlers/logbook.py`: conceptual flows for registration, editing, manual, approval, weekly signatures (out of initial scope).

Audit and extract from `logbook-cli`:

- `logbook_cli.py`: `discover_git_repos`, `resolve_all_repositories`, `get_commits_for_date`, `collect_all_commits`, pending queue functions.
- `.github/workflows/release.yml`: packaging for Windows/Linux.
- Existing OpenAI-compatible summary path may be replaced with centralized Gemini API; **do not require user to store Gemini key in local agent**.

Do not claim code has been reused until actual code is checked out into workspace and tests pass. Record source version/commit ID of reused logic in `docs/adr` or `THIRD_PARTY_REUSE.md`.

---

## 5. REQUIRED USER FLOWS TO DEMONSTRATE

### Scenario A — New user, no web

- User joins guild where bot installed, runs `/setup start`.
- Bot sends ephemeral explanation when invoked from guild and starts DM wizard.
- User selects Windows/Linux installer in Discord, installs GUI agent, selects folder(s), pairs with DM code.
- User connects DERMAGA account via a secure modal, enters Gemini key via modal, sees defaults and can edit via commands.
- Agent sends commits; setup becomes READY. **No dashboard visit required**.

### Scenario B — Daily DM review and auto flow

- Agent syncs commits earlier that day.
- At 16:00, exactly one DM reminder with valid review controls, even if user belongs to multiple guilds.
- If auto ON, review deadline triggers at 16:15. If work end is 16:25, state moves to AWAITING_WORK_END, then eligible to submit at 16:25.
- User may click edit/skip/cancel/snooze any time before dispatch, and this must prevent stale auto submission.
- For auto OFF, nothing posts to DERMAGA until user explicitly confirms sending.

### Scenario C — Portal proof

- HTTP POST returns portal response. DO NOT mark verified yet.
- Worker opens/reloads monitoring **again**, looks for correct date/entry and only then screenshots matching row + context.
- DM screenshot with a message stating exactly what was verified. If no matching entry, clearly say pending/unverified.
- Same status propagates to guild checklist; no screenshot/draft is published.

### Scenario D — Guild checklist and last ping

- Guild admin assigns the channel and configures checklist/last ping times (dashboard admin may also edit); no unknown default times invented.
- Checklist lists eligible users and optionally mentions all **registered participants** as requested. Last reminder pings only missing/unverified users.
- Multiple guilds retain separate rosters and channels. Don't announce a private user's commit details.

### Scenario E — Conversational Frieren

- User mentions Frieren or replies to a message, asks about their verified logbook. Backend fetches authorized state first.
- AI uses the exact English persona prompt and recent allowed history to form a friendly, natural, accurately bounded response.
- A prompt-injection inside a commit or message cannot trigger unauthorized submission, reveal credentials, or alter the verified state.

---

## 6. TEST-DRIVEN ACCEPTANCE REQUIREMENTS

You must use `@docs/TEST_PLAN_AND_ACCEPTANCE.md` to implement acceptance tests and produce a traceability report.

### Minimum tests that MUST pass

1. Identity: one Discord ID across 2 guilds still gets exactly one DM reminder.
2. UI/Agent: install flow needs no admin web; pairing code TTL/one-time and token revocation; local file path scanning bounded.
3. Scheduler: Mon–Fri, 16:00 default, T+15 from **actual successful DM**, auto OFF; 16:25 work-end gate, editing/skip/cancel.
4. Guild: checklist only enrolled users, mention all enrolled if configured, last ping only missing; no leaks across guilds.
5. DERMAGA: POST 200 is not VERIFIED, fresh reload required before DOM match and screenshot, screenshot failure does not cause re-post.
6. Data privacy: no password/key printed, owner-only screenshot, status redacted in guild and admin UI.
7. Gemini: ordered global key fallback followed by user key only on retryable failures, deterministic English fallback when unavailable.
8. Persona: all Frieren messages English-only; formal DERMAGA description remains Indonesian.
9. Dashboard: static `.env` account works, invalid credentials denied/rate-limited, admin pages not publicly accessible without session.
10. Crash recovery: retries do not create duplicate logical logbook entries or cross-contaminate guild contexts.

Use mock/fake Discord, Gemini, a mocked DERMAGA HTML fixture site and fake clocks in CI. Browser E2E may run against local fixture server for refresh evidence. **Do not execute real DERMAGA writes without operator's explicit authorization** and working test credentials. Do not invent screenshots of real DERMAGA if none were captured.

After each phase, run targeted tests and fix failures; log exact commands and results. At the end run lint, typecheck, unit tests, integration tests, contract tests, browser screenshots if possible, Docker config/build validation, release pipeline lint. When packaging can only run on CI, provide workflow and mark cross-platform installer run as unverified locally.

---

## 7. DELIVERABLES (CREATE REAL FILES, NOT JUST RESPOND IN CHAT)

**Repository content:**

```text
[ ] Root README with local setup, Docker run, Discord setup, repo architecture
[ ] AGENTS.md or workspace rules preserving decisions
[ ] docs/adr/*.md with design decisions and source reuse provenance
[ ] apps/bot/ with slash commands, DM UX, persona, mention/reply
[ ] apps/api/ with auth/schema/agent/guild/user/entry/evidence/admin endpoints
[ ] apps/admin-dashboard/ actual admin-only pages and interactive controls
[ ] apps/local-agent/ GUI, pairing, Git scan, offline storage, install/run scripts
[ ] services/dermaga-worker/ portal adapter and Playwright fresh-reload proof
[ ] packages/contracts/ status enums, DTO schemas
[ ] packages/db/ schema/migrations/encryption
[ ] packages/scheduler/ durable queue and locked jobs
[ ] packages/ai/ Gemini failover, persona, formal summary
[ ] infra/docker-compose.yml, Dockerfiles and data mounts
[ ] .github/workflows/ CI test and Windows/Linux agent release
[ ] .env.example (placeholders; never real credentials)
[ ] tests/ with mock DERMAGA fixtures and acceptance tests
[ ] docs/runbook.md and docs/acceptance-report.md
[ ] Meaningful UI/browser evidence for dashboard and test portal if tools allow
```

**Completion report:**

- Which PRD features are implemented, partially implemented, or deferred.
- Exact files/modules modified and why.
- Which repository sources were reused, with commit SHAs if available.
- Actual executed commands, test pass/fail/skip counts, and known limitations.
- Dashboard route and run instructions, local agent build/install instructions.
- DERMAGA refresh->verify->screenshot evidence from **test fixtures** unless an authorized live test occurred.
- Security notes and environment variables requiring operator secret setup.
- A concise operational next-step checklist that the human can follow to launch.

---

## 8. IMPORTANT FAILURE MODES / ANTI-PATTERNS

DO NOT:

- Replace the agreed DM-only private workflow with public channel reminders.
- Require Discord OAuth or web login for normal users.
- Put Git folder path on VPS and assume `git -C` can read user laptop.
- Rely on ephemeral messages for scheduled background DMs.
- Force user to open admin web just to install/pair agent.
- Leak user screenshots in checklist or final ping channel.
- Claim DERMAGA verified from only `HTTP 200`, portal submit toast, or screenshot before refresh.
- Blindly resend POST after timeout or screenshot failure.
- Hardcode `atmin/password123` in a source fallback or log those values.
- Override existing Tailscale Funnel setup without inspecting it/permission.
- Use English conversational Frieren prose as the official Indonesian logbook description.
- Put a real Gemini key, DERMAGA password, or user personal API key in agent config or compiled bundle.
- Let natural-language chat trigger shell commands, privileged dashboard mutations, or logbook submission without authorization.
- Implement UI placeholders that show fake success or unverified demo data as actual production data.
- Ask the user to provide information already present in docs; make explicit, safe, documented implementation choices for unspecified matters.

---

## 9. START HERE — IMMEDIATE INSTRUCTIONS

**Your first reply should summarize that you've read the required docs, list discovered workspace/repository facts, and present the Implementation Plan and Task List artifacts.** Be precise about facts vs assumptions. Then start actual coding as your artifact review policy permits. Prioritize an end-to-end slice that can be demonstrated with test fixtures, and proceed through phases systematically.

Implementation should stay consistent with `@docs/FRIEREN_DISCORD_LOGBOOK_PRD.md`. When an ambiguity arises, consult the PRD, architecture, test plan, and deployment runbook in that order. If a feature is not implementable without secrets or a live third-party portal, provide a realistic mock-backed implementation and a clearly marked final verification checklist; do not fabricate success.

**Build the project. Verify it. Show evidence.**
