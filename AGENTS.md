# Agent Instructions — Frieren Discord Logbook Automation

## Source of truth

Read `docs/FRIEREN_DISCORD_LOGBOOK_PRD.md` completely before implementing. Then read `docs/ARCHITECTURE_AND_API.md`, `docs/TEST_PLAN_AND_ACCEPTANCE.md`, `docs/DEPLOYMENT_AND_SECURITY.md`, `docs/LOGBOOK_FORMAL_PROMPT.md`, `docs/frieren_system_prompt_english.md`, and `docs/frieren_gemini_example_english.md`. The implementation assignment is `docs/ANTIGRAVITY_IMPLEMENTATION_PROMPT.md`.

Precedence: explicit latest operator instruction > PRD > architecture/acceptance/deployment guides > suggested implementation examples. Original user-supplied Frieren prompt must remain unmodified.

## Hard boundaries

- Discord DM for all personalized reminders, setup, reports, confirmations, and screenshot evidence. Guild channels: scheduled checklist and last ping only.
- Git repositories stay on user laptops; use authorized local agent, outbound authenticated API, no remote shell.
- Admin web only, static username and password from private `.env`; existing Tailscale Funnel, not Discord OAuth.
- User-facing persona English-only; official DERMAGA logbook formal Indonesian, separate prompts and generation routes.
- Auto-submit requires explicit user opt-in, successful DM reminder, durable 15-minute review timer, valid approved/reviewable revision, and work-end guard.
- Portal POST/HTTP 200 is NOT proof of success: **freshly reload/reopen monitoring in Playwright; verify row/card; only then screenshot; send screenshot through DM**.
- No fake commit, work hours, GPS or portal outcomes, and no secrets in logs or public channels.
- Never submit to the live DERMAGA portal as part of tests without operator authorization; use mocks/fixtures by default.

## Workflow

1. Inspect existing repositories and versions; document reuse decisions.
2. Produce implementation plan and task checklist, including risks and acceptance criteria.
3. Implement vertical slices: core+database, Discord DM onboarding, local agent, Gemini, scheduler, DERMAGA+Playwright, admin UI, release/deploy.
4. Run unit/contract/integration/e2e tests; fix failures; provide honest evidence and list unresolved gaps.
5. Never claim tested or deployed unless verified. Keep example secrets out of commits.
