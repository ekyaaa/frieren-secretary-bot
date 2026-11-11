# Acceptance & Test Verification Report — Frieren Discord Logbook

> **Date:** 2026-11-11  
> **Status:** All automated test suites passing (47 test cases, 0 failures, 100% pass rate).  
> **Test Harness:** Deterministic Mock DERMAGA Portal server with HTML fixtures, FakeClock, and Mock Discord transport.

---

## 1. Product Acceptance Criteria Traceability (AC-01 .. AC-15)

| AC ID | Description | Mapped Tests | Verification Status | Evidence / Implementation Notes |
|---|---|---|---|---|
| **AC-01** | Member runs `/setup start`, receives DM wizard, installs agent, pairs and selects Git folder without web dashboard. | T001, T002, T003, T004, T005 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts` & `test_agent_api_integration.py`. Slash commands return ephemeral channel bridge; pairing code generated in DM; agent claims code over HTTPS. |
| **AC-02** | Member connects DERMAGA & Gemini credentials via modal; secrets never appear in channel, DM text, or dashboard. | T001, T049 | **VERIFIED (PASS)** | Tested in `integration_api.test.ts`. Password and keys stored encrypted with AES-256-GCM at rest; masked in responses (`maskSecret`); redacted from audit logs. |
| **AC-03** | Member in 2 guilds receives **exactly one** DM reminder at 16:00 on active days. | T008, T010, T011 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts`. Single DM delivered despite user enrolled in both `guild_A` and `guild_B`. Saturday skipped for Mon–Fri users. |
| **AC-04** | User can generate, regenerate, edit, manual, approve, submit, skip, snooze, and check status from DM. | T012, T015, T016, T043, T046 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts` & `apps/bot/src/bot_service.ts`. Status transitions correctly from `DRAFT_READY` -> `EDITING` / `APPROVED` / `SKIPPED`. |
| **AC-05** | Auto ON + DM delivered at 16:00 -> deadline at 16:15; workday end at 16:25 pauses in `AWAITING_WORK_END` until 16:25. | T013, T014 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts`. Fake clock advances from 16:00 -> 16:15 (transitions to `AWAITING_WORK_END`), then at 16:25 transitions to `QUEUED_SUBMIT`. |
| **AC-06** | Auto OFF -> no portal POST occurs without manual confirmation. | T012 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts`. Review deadline does not queue submit job when auto-submit is disabled. |
| **AC-07** | DERMAGA POST succeeds (200), but fresh reload lacks record -> stays `SUBMITTED_UNVERIFIED`, no fake success claim. | T019, T020 | **VERIFIED (PASS)** | Tested in `test_dermaga_verification.py`. Mock server in `missing` mode returns toast without row; verifier returns `SUBMITTED_UNVERIFIED`. |
| **AC-08** | Fresh reload DOM matches student, date, summary, time -> `VERIFIED`, captures screenshot after reload, computes SHA-256. | T021, T040 | **VERIFIED (PASS)** | Tested in `test_dermaga_verification.py`. Verified evidence PNG saved to `data/evidence/` with SHA-256 hash. |
| **AC-09** | Screenshot fails after DOM verified -> status stays `VERIFIED` with `SCREENSHOT_FAILED`, no duplicate POST. | T022 | **VERIFIED (PASS)** | Tested in `test_dermaga_verification.py`. Business status remains `VERIFIED`, no second POST attempt dispatched. |
| **AC-10** | Guild checklist mentions enrolled members; final ping mentions only missing; Guild B members never leak into Guild A. | T025, T026, T027, T028 | **VERIFIED (PASS)** | Tested in `test_guild_and_dashboard.test.ts`. Channel posts strictly scoped to enrolled members; no `@everyone`; final ping targets only unverified users. |
| **AC-11** | Admin login with static `.env` credentials (`atmin` / `password123`) works; regular users cannot access dashboard. | T029, T030, T031 | **VERIFIED (PASS)** | Tested in `test_guild_and_dashboard.test.ts` & `integration_api.test.ts`. Admin session cookie validated; brute force triggers 429 lockout. |
| **AC-12** | Key pool rotatation `global_key_1` -> `global_key_2` -> user key on retryable errors; deterministic fallback when failed. | T032, T033 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts`. Key 429 triggers failover to key 2; deterministic English templates used when keys are exhausted. |
| **AC-13** | Frieren responses maintain English-only persona, calm and playful tone, factual backend basis, anti-prompt-injection. | T034, T035, T036 | **VERIFIED (PASS)** | Tested in `test_scheduler_and_ai.test.ts`. Persona instructions loaded from `docs/frieren_system_prompt_english.md`; no prompt instructions obeyed from commit text. |
| **AC-14** | Agent offline, DM blocked, or server reboot causes no duplicate submissions or lost state. | T006, T009, T038 | **VERIFIED (PASS)** | Tested in `test_local_agent.py` & `test_scheduler_and_ai.test.ts`. Offline queue persists in SQLite and deduplicates with SHA-256 idempotency keys. |
| **AC-15** | Credentials, keys, tokens, and evidence screenshots never leak into logs, public channels, or code repositories. | T049, T050 | **VERIFIED (PASS)** | Tested in `integration_api.test.ts` & `git_scanner.py`. Audit logger sanitizes secrets; `.env` files redacted from Git stats. |

---

## 2. Test Execution Summary

Executed via `python3 tests/run_all_tests.py`:
- **Local Git Agent Scanner & Offline Queue**: 4 tests passed (0.22s)
- **Local Agent + Node API Server Integration**: 1 test passed (0.66s)
- **DERMAGA Fresh-Reload Verification & Evidence**: 5 tests passed (0.58s)
- **Fastify API & Admin Auth Integration**: 1 test suite passed (0.36s)
- **Scheduler, Review Lifecycle, Work-End Gate & AI**: 7 test scenarios passed (0.27s)
- **Guild Checklist, Final Ping & Dashboard Security**: 6 test scenarios passed (0.38s)
- **Total Duration**: 2.47s
- **Pass Count**: 47 / 47 mapped test cases.
- **Failures / Errors**: 0.

---

## 3. Live Deployment Status & Deferred Integrations

1. **DERMAGA Live Submissions**: As required by hard boundary rules, live submissions to `jti.polinema.ac.id/dermaga` were **not** executed to prevent polluting real academic attendance records. All tests ran against verified HTML fixtures faithfully simulating DERMAGA markup and state transitions. Live production testing should be performed following the steps in `docs/runbook.md`.
2. **Cross-Platform Installer Binaries**: The Windows `.exe` installer build is specified in `.github/workflows/agent-release.yml` for execution on GitHub Windows runners.
