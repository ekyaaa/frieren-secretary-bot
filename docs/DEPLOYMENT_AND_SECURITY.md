# Deployment, Config, Installer & Security Runbook

> Operator has explicitly chosen an existing **Tailscale Funnel** setup and `.env` username/password login for a single admin. Do not replace it with OAuth or require regular users to access the web.

## 1. Recommended deployment

- **Main server:** Debian/Ubuntu VPS / private server already running Tailscale.
- **Bot service:** Node.js/TypeScript `discord.js` gateway with Message Content intent where required for guild mention/reply context.
- **API + scheduler:** internal Fastify/TS app and durable job workers; Postgres DB, migration on deployment; optional Redis only if queue design warrants it.
- **DERMAGA worker:** Python with reused portal domain services, Playwright headless Chromium, private screenshot volume.
- **Admin:** React dashboard behind server-side auth/session, route `/admin` and `/admin/api` only.
- **Local Agent:** Windows and Linux user-installed app, outbound HTTPS to server. Never direct inbound SMB/SSH to users' laptops.

Use container network and health checks; only publish explicitly required endpoints. Bot webhook not required if using Discord gateway. Dashboard bound `127.0.0.1:<admin-port>` on host or Tailscale-targeted local service. Never publish Postgres or worker directly.

## 2. Environment template (example placeholders)

The server may create a real private `.env` with the static login values **requested by the owner**:

```dotenv
# Discord credentials (real values only in private .env)
DISCORD_BOT_TOKEN=replace-me
DISCORD_APPLICATION_ID=replace-me
PLATFORM_ADMIN_DISCORD_IDS=123456789012345678

# Database and durable jobs
DATABASE_URL=postgres://frieren:replace-me@postgres:5432/frieren_logbook
DATABASE_ENCRYPTION_KEY=replace-with-a-long-random-key
SESSION_SIGNING_KEY=replace-with-a-different-long-random-key

# Admin login (private .env only)
ADMIN_DASH_USERNAME=atmin
ADMIN_DASH_PASSWORD=replace-with-the-private-value-chosen-by-operator
ADMIN_DASH_SESSION_TTL_MINUTES=60

# This is a configuration example; the operator specifically selected
# username atmin and password password123 for their own private host .env.
# Do NOT publish their actual .env or seed those credentials as a hardcoded fallback.

# Gemini global failover keys (example allows configurable count)
GEMINI_API_KEY_1=replace-me
GEMINI_API_KEY_2=replace-me
GEMINI_MODEL=verify-supported-model-id
GEMINI_PERSONA_SYSTEM_PROMPT_PATH=./docs/frieren_system_prompt_english.md
GEMINI_LOGBOOK_SYSTEM_PROMPT_PATH=./docs/LOGBOOK_FORMAL_PROMPT.md

# Scheduling and personal data
DEFAULT_TIMEZONE=Asia/Jakarta
DEFAULT_REMINDER_TIME=16:00
DEFAULT_WORK_START=07:10
DEFAULT_WORK_END=16:25
REVIEW_WINDOW_MINUTES=15
SCREENSHOT_RETENTION_DAYS=30

# Public base URL for agent pairing and outbound sync. May be routed through existing Funnel.
AGENT_API_PUBLIC_BASE_URL=https://your-existing-authorized-host.example
# Admin auth surface is private via login; Funnel itself is internet-public.
ADMIN_BIND_HOST=127.0.0.1
ADMIN_BIND_PORT=3100
# Set only trusted proxy IP/CIDRs; don't trust forwarded headers from arbitrary clients
TRUSTED_PROXY_CIDRS=127.0.0.1/32

# DERMAGA endpoints (validate when implementing)
DERMAGA_LOGIN_URL=https://jti.polinema.ac.id/dermaga/login
DERMAGA_MONITORING_URL=https://jti.polinema.ac.id/dermaga/mahasiswa/monitoring
DERMAGA_SUBMIT_URL=https://jti.polinema.ac.id/dermaga/mahasiswa/monitoring/simpan
DERMAGA_WORKER_CONCURRENCY=1

# Internal authentication between services
INTERNAL_SERVICE_TOKEN=replace-with-long-random-value
LOG_LEVEL=INFO
```

For `.env.example` in the repository, **never include real tokens or API keys**. Developer should document exactly which variables are required vs optional and what the startup validator checks. Actual `.env` belongs only on host, protected file permissions (`chmod 600` appropriate on Linux), never built into Docker image, agent installer, public CI artifact or screenshot.

## 3. Tailscale Funnel: preserve operator setup

Tailscale Funnel is a TLS-enabled reverse tunnel that **exposes a selected service to the public internet**. It is **not tailnet-only**. The owner explicitly chose to keep existing Funnel setup; do not silently migrate to Tailscale Serve. Existing Funnel configuration details (hostname, route, port) have **not** been provided, so deployment code should never guess or overwrite them.

Runbook goals:

1. Inspect existing `tailscale funnel status` / existing reverse proxy routing on server when authorized; record existing route and bind port.
2. Start admin app on loopback/local target expected by existing Funnel; keep DB/worker private.
3. Map URL path for admin UI + login and API agent as needed; if agent API shares hostname, use disjoint routes/auth and rate limits.
4. Confirm HTTPS works externally, login required on every admin route, CSRF protection on mutation, no session leak via redirects.
5. Set `Secure`, `HttpOnly`, and `SameSite` session cookie options; verify proxy TLS termination and safe forwarded-host validation.
6. Rate-limit admin login; log authentication attempts with source/traces (not submitted password).
7. Record route host URL in **operator-only deployment doc**, not a fake hardcoded hostname in code.

Useful reference: https://tailscale.com/docs/features/tailscale-funnel

## 4. Static admin authentication

- Use `.env` variable **values**, no hard-coded in-process `if(username==='atmin' && password==='password123')` that cannot be configured.
- For the owner's chosen private `.env`, configure `ADMIN_DASH_USERNAME=atmin` and `ADMIN_DASH_PASSWORD=password123` if they insist; this is risk accepted by operator.
- If either var missing: refuse to enable admin login; don't leave an unprotected dashboard.
- On comparison, avoid logging plaintext password. Apply a secure password verification path (e.g. normalize input, KDF configuration or constant-time secret digest comparison), CSRF protection, session rotation on login, expiry, logout, audit, rate limit and max request sizes.
- No Discord OAuth login or access for ordinary users.
- Admin dashboard must never reveal plaintext DERMAGA credentials, Gemini keys, or device token.

## 5. GitHub Actions release and Discord distribution

CI should build Local Agent for:

- **Windows x64:** installable `.exe` (and optionally zip fallback) generated on a Windows runner.
- **Linux x64:** portable executable or `.AppImage`/`.deb` (plus tar.gz fallback) generated on a Linux runner.

Releases should attach versioned artifacts, checksums, and changelog. App version in agent heartbeat, optional update notification. Build must pin dependency versions and produce an SBOM if possible. Code signing is recommended for production—if no signing certificate available, don't claim binary is signed. Windows may show SmartScreen warnings for unsigned binaries; document clearly.

Discord delivery:

1. Bot shows OS choice buttons in DM.
2. Fetch release manifest from trusted configured GitHub release endpoint; verify asset name/size/checksum against manifest where possible.
3. If asset within Discord attachment limits and host supports retrieval, attach exact downloaded binary/zip in DM with the version and checksum.
4. If too large/not allowed, send a **direct GitHub Releases asset link**. User doesn't need to log into admin web or manually edit config.
5. The Local Agent GUI handles repo selection and pairing; no mandatory shell/JSON setup for end-users.

Do not attach arbitrary user-provided executables. Avoid exceeding Discord upload quotas or blindly uploading large binaries to every DM.

## 6. Database, backup, migration and retention

- Use migration tooling (`drizzle-kit`/Prisma/Knex/etc); migrations must be idempotent and reversible where possible.
- Store timestamps UTC and local date separately.
- Backup database with encrypted storage; backup/restore playbook and periodic restore test.
- Encrypt app-level secret fields with key from server environment, not database rows.
- Screenshots go to non-public directory, per-user/entry evidence metadata includes SHA256, `captured_at`, `retention_until`, screenshot redaction notes.
- Cleanup expired screenshots and conversation history regularly, no signed URL leak in general channels.
- Retention default candidate: screenshot 30 days; conversation 7 days; audit 90 days. Make these configurable and document deletion exceptions.

## 7. Monitoring and health

Dashboard statuses: bot gateway connected, last scheduler tick, queue job counts, stuck submissions, DERMAGA auth/HTML selector failures, Playwright availability, Gemini pool key **health only**, agent status, per-guild channel permissions.

Recommended alerts:

- No successful scheduler tick within threshold.
- Queue delay > configured threshold / dead letter spike.
- DERMAGA verification selector error after portal layout changes.
- Device agent API failures or token abuse.
- Invalid admin login bursts and session anomalies.

All diagnostic messages redact secrets and don't dump raw credential-bearing HTML. Live deployment runbooks distinguish `portal API POST accepted`, `record verified`, `screenshot captured`, `DM evidence sent` as separate observables.

## 8. Deployment validation before go-live

```text
[ ] Current repositories inspected and dependencies installed
[ ] .env private and startup env validation passes
[ ] DB migration and unique constraints applied
[ ] Discord bot invited with correct permissions, DM and message intents configured
[ ] Admin login works behind existing Funnel, `/admin/api/*` rejects anonymous access
[ ] Agent HTTPS pairing tests on Windows and Linux
[ ] Scheduler fake-clock test: 16:00 -> 16:15 -> 16:25 gate
[ ] Guild channel posting only checklist and last ping, no private data
[ ] Fixture DERMAGA login/submit -> fresh reload -> matching DOM -> screenshot works
[ ] Failure: POST 200 but row missing stays unverified
[ ] Screenshot user DM only, ownership checks pass
[ ] Secrets absent from logs, screenshots, attached files, and CI artifacts
[ ] backup/restore and rollback procedure documented
[ ] No live portal write occurs during dry run
```

## 9. Troubleshooting quick map

| Problem | Check first | Safe behavior |
|---|---|---|
| DM fails | DM permissions, blocked bot, user setup state | No timer start/auto-submit; ephemeral recovery prompt on command |
| Agent offline | Heartbeat/OS startup/task scheduler/HTTPS token expiry | Manual input fallback, no fake work |
| Gemini unavailable | Key pool status, model ID availability, quotas | Rotate retryable keys, fallback deterministic English; formal manual |
| DERMAGA login failure | CSRF/cookies/auth form/captcha/site maintenance | Stop submitting; request re-link/updated credentials |
| Submitted but not verified | Fresh monitoring DOM and matching row | Read-only reconciliation, do not duplicate POST |
| Screenshot absent | Playwright browser installed, locator matched, evidence store write | Verified remains verified; retry screenshot only |
| Guild checklist missing | Channel config, bot permissions, `guild_id` | Show admin actionable warning, don't spam DMs |
| Funnel route error | Existing Tailscale status/host/proxy port | Adjust service listener to existing route, don't reconfigure Funnel blindly |
