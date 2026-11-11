# Test Plan & Acceptance Matrix — Frieren Discord Logbook

> Product truth: `@docs/FRIEREN_DISCORD_LOGBOOK_PRD.md`.  
> Run all default CI tests without Discord/Gemini/DERMAGA live credentials. Any live portal POST requires explicit operator authorization and a reversible test account.

## 1. Testing strategy

- **Unit**: identity, schedule calculation, status transitions, ownership, replay/idempotency, Git scanner, parsing, AI key router, privacy filter.
- **Contract**: JSON schema agent->API, bot->backend, backend->DERMAGA worker, React admin->API.
- **Integration**: database migrations, unique indices, account isolation, queued jobs after restart, stateful mock DERMAGA HTTP+browser session.
- **Discord mock**: interactions/DM success or failure, rate limits, final channel mentions, expired buttons, modal flow.
- **E2E local**: fake clock, mock Gemini, fake Discord transport, Playwright against HTML fixture DERMAGA, test dashboard with browser.
- **Release smoke**: Windows/Linux agent startup, pair mock, select folder, repo scan, offline queue, recover, reinstall/update.
- **Manual authorized staging**: verify actual DERMAGA selectors, not destructive live submissions unless authorized.

Use UTC time internally, `Asia/Jakarta` deterministic fixture for scheduler, test DST for optionally selected non-Jakarta timezone. Seed two users in two separate guilds and a third user shared by both guilds.

## 2. Acceptance/test matrix

| Test ID | Preconditions | Action | Assertions |
|---|---|---|---|
| T001 | New guild & new user | `/setup start` | Ephemeral bridge in guild + DM wizard; no dashboard URL required |
| T002 | User DM enabled | `/agent install` | Windows/Linux buttons; signed release attachment or official fallback, no raw secret |
| T003 | Pairing unclaimed | `/agent pair` -> code claim | Device tied to correct user; 5m TTL; token returned once; DB stores hash |
| T004 | Expired/guessed code | Repeated claim | Reject, rate-limit; no cross-user device access |
| T005 | Agent configured repo | Scan date | Includes correct author/date/branch; does not upload file contents or `.env` |
| T006 | Agent offline then online | Generate queued snapshot | Offline queue persists, sync once by idempotency, no duplicate |
| T007 | Two repos same commit hash | Collect | Dedup uses repo identity as appropriate; all selected projects represented |
| T008 | User in guild A and B | Trigger reminder 16:00 | Exactly **one DM** for `userId/date` |
| T009 | DM API returns blocked | Trigger reminder | State DM_BLOCKED; no T+15 auto job; future UI explains recovery |
| T010 | Day Saturday default | Scheduler tick | No reminder for Mon–Fri user |
| T011 | User enabled Sunday | Sunday at configured time | Exactly one DM, no duplicates across restarts |
| T012 | Valid draft, auto OFF | Time passes 15 min | No portal POST; submit needs explicit confirm |
| T013 | Valid draft, auto ON | DM delivered 16:00 | Auto eligibility considered at 16:15; must not fire before |
| T014 | End time 16:25 | T013 at 16:15 | `AWAITING_WORK_END`, portal submit only at >=16:25 |
| T015 | Draft being edited at T+15 | Tick auto job | No POST; revision remains editable and safe |
| T016 | User clicks skip/cancel | Due auto job | No POST; status/audit reflect cancellation |
| T017 | User clicked submit twice | Duplicate interaction | One logical submit, one portal POST max pending verification |
| T018 | Portal POST times out | Retry queue wakes | GET/reconcile portal before any second POST |
| T019 | Portal POST 200 and success banner only | Verify job | Still `SUBMITTED_UNVERIFIED` until fresh DOM record verified |
| T020 | DOM record not visible after reload | Verify job | Bounded retry, never VERIFIED, no screenshot claimed as proof |
| T021 | Fresh DOM matches date/account/summary/time | Verify job | VERIFIED, `captured_after_refresh_at` set, matching evidence SHA256 |
| T022 | Screenshot fails after fresh verified record | Verify job | Business status VERIFIED, evidence status SCREENSHOT_FAILED, no repost |
| T023 | Evidence stored from user A | User B requests screenshot | Forbidden, no info leak |
| T024 | Entry verified for A | Delivery bot | Screenshot only via A's DM, channel receives no private content |
| T025 | Guild A scheduled checklist | Scheduled job | Only enrolled members of guild A, status uses verified vs unverified |
| T026 | Guild A mention=all-participants | Checklist post | Mention enrolled users only, explicit allowedMentions allowlist, no `@everyone` |
| T027 | Last ping scheduled | Ping job | Mentions only eligible missing/unverified, once per guild/date |
| T028 | Guild A and B share user | Both checklists | Shared user can appear in each guild appropriately; no cross-guild list leak |
| T029 | Admin login env set | Valid `atmin` + env password | Authorized dashboard session; logout & cookie expiry work |
| T030 | Invalid admin login | Wrong password 10x | Rate-limit/lockout; no revealing whether user exists |
| T031 | User without admin session | Browse admin API | 401/403 for all data endpoints |
| T032 | `GEMINI_API_KEY_1` 429, key2 5xx, user key OK | Generate persona | Key rotation key1->key2->user, audit key IDs only |
| T033 | All Gemini keys fail | Reminder | Fixed verified template, no invented status; manual fallback for summary |
| T034 | AI tries to obey injected commit instructions | Generate summary | Ignores instructions in commit; no secret disclosure; source facts only |
| T035 | Reply mentions bot | Ask a question | Frieren English-only, contextual allowed history, no action from plain chat |
| T036 | User writes Indonesian | Frieren responds | Response still natural English according to persona file |
| T037 | Agent sends spoofed `user_id` | Ingest snapshot | Reject, user bound to device token server side |
| T038 | Host app restarted mid-submission | Resume queue | Crash-safe state, reconcile before post, no duplicate |
| T039 | DERMAGA login invalid | Submit | Status NEEDS_ATTENTION, DM user, credentials masked |
| T040 | Screenshot old tab without refresh | Evidence generation | Test asserts navigation/reload and new DOM required before screenshot |
| T041 | One user leaves guild | Checklist | Removed from that guild roster; DM account remains unless user disconnects |
| T042 | User deletes agent | Revoke | All device tokens revoked; historical data retention per policy |
| T043 | User manual input with no Git | Approve & send | Permitted manual logbook with explicit review, no fake AI attribution |
| T044 | No active guild channel | Scheduler | No public post; guild config error visible to admin |
| T045 | Checklist at 18:00, final ping at 19:00 | Schedule guild | Only guild-owned channel used; follow local timezone and current enrollment |
| T046 | Edit revision from R1 to R2 | Click stale approval on R1 | Block with fresh review prompt, no submit of R1 |
| T047 | Portal row belongs to another account/date | Verify | Not verified for target account, screenshot not shared as proof |
| T048 | DERMAGA verification page changes | Worker locator | Fail closed with diagnostics/redacted screenshots, not fabricated success |
| T049 | Platform env key and user key | Inspect logs / DB APIs | No raw key in log, dashboard, errors, snapshots or bot channel |
| T050 | Agent artifact oversized for Discord attachment | `/agent install` | Explicit official GitHub Releases link fallback, no forced dashboard login |

## 3. Data fixtures

Create fixtures under `tests/fixtures/dermaga/`:

- `login_form.html`: input CSRF, successful login stub.
- `monitoring_before_empty.html`: no logbook for target date.
- `monitoring_after_matching.html`: matching record after simulated reload with date, time, summary.
- `monitoring_after_missing.html`: success-banner-only or empty table.
- `monitoring_after_wrong_date.html`: matching summary but wrong date.
- `monitoring_after_other_user.html`: row belongs to a different account.
- `monitoring_after_ambiguous.html`: multiple similar records, must fail closed.
- `monitoring_markup_changed.html`: selector drift; error handling.

Fixture server increments a `getCount`/`reloadCount`; assertions require fresh HTTP request *after* POST and wait for DOM, then screenshot. If the same DOM object is reused from before POST, test fails.

For fake Discord: mock `sendDM`, `postToChannel`, `allowedMentions`, `interaction.deferReply`, `modal`; record actual payload and recipients. For fake Gemini: deterministic success/429/5xx/invalid-key responses; capture prompts to ensure distinct persona/formal prompts and secret redaction.

## 4. Security tests

- Credentials field never returned by user GET except masked status; dashboard admin response masks everything.
- Dashboard session fixation, CSRF on mutations, brute-force limits, secure cookies, logout.
- Device token hashed at rest, pairing code cannot be reused, device revocation instantly blocks write.
- No arbitrary shell command execution from chat or agent command queue; only allowlisted `SCAN`, `PAUSE`, `RESUME`, `UPDATE_CONFIG` and validated arguments.
- Git path traversal/symlink guard; configured roots only; no `.env`/private key content upload.
- Screenshot access restricted to owner/admin policy, storage outside static `/public`, cleanup after retention.
- Cross-guild authorization checks for admin-only commands; forged Discord snowflake in payload ignored.
- Markdown/mention injection sanitized in AI text and status; random Git text cannot mass-mention `@everyone`.

## 5. Release quality gates

| Gate | Required evidence |
|---|---|
| Typecheck/lint | `npm run typecheck && npm run lint` / Python lint/test equivalents |
| Unit/integration | CI summary + coverage of scheduler and portal transitions |
| Frontend build | Bundled dashboard and `/admin/login` smoke browser screenshots (with fake credentials, no secrets) |
| Worker integration | Mock DERMAGA POST -> fresh refresh -> match -> screenshot test passes |
| Agent packaging | Release CI workflow and smoke scripts documented; if cross-platform builds cannot run here, clearly label unverified |
| Docker | `docker compose config` valid; health checks and migrations included |
| Secrets | `.env` ignored, example placeholders, secret grep/check passes |
| PRD traceability | AC-01..AC-15 mapped to passing test IDs or explicit known blocked cases |
| Walkthrough | Antigravity artifact lists files changed, commands run, passed/failed tests, screenshot evidence, blocked live integrations |

## 6. Manual acceptance checklist

- [ ] Install bot into 2 test guilds; configure separate checklist channels.
- [ ] Configure admin login from real private `.env`, browse via existing Funnel URL.
- [ ] Install agent Windows, pair device, select folder, confirm commits/day.
- [ ] Install agent Linux, pair second device, verify isolated tokens.
- [ ] Set user reminder to 16:00, default work end 16:25, auto OFF then ON.
- [ ] Demonstrate successful DM, editing, regenerate, manual entry, pause/skip.
- [ ] Demonstrate 16:15 review transition then 16:25 work end gate with fake clock.
- [ ] Demonstrate screenshot taken only after DERMAGA page fresh reload and matched row.
- [ ] Demonstrate screenshot sent to DM only and not accessible to other users.
- [ ] Demonstrate guild checklist mention participants and final ping missing-only.
- [ ] Demonstrate Frieren English-only and separate formal Indonesian summary.
- [ ] Demonstrate Gemini key rotation and safe failure mode.
- [ ] Inspect secrets exposure and browser auth hardening.

Do not mark manual live portal tests completed without an actual authorized test and recorded result.
