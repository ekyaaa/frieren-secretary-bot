#!/usr/bin/env python3
"""
Master Test Runner for Frieren Discord Logbook Automation.
Executes all unit, contract, integration, and acceptance tests.
Produces test traceability report mapped to T001..T050 and AC-01..AC-15.
"""

import subprocess
import sys
import time

TEST_SUITES = [
    {
        "name": "Local Git Agent Scanner & Offline Queue",
        "command": ["python3", "tests/test_local_agent.py"],
        "test_ids": ["T005", "T006", "T007"],
    },
    {
        "name": "Local Agent + Node API Server Integration",
        "command": ["python3", "tests/test_agent_api_integration.py"],
        "test_ids": ["T002", "T003", "T004", "T037", "T042"],
    },
    {
        "name": "DERMAGA Fresh-Reload Verification & Screenshot Evidence",
        "command": ["python3", "tests/test_dermaga_verification.py"],
        "test_ids": ["T018", "T019", "T020", "T021", "T022", "T039", "T040", "T047", "T048"],
    },
    {
        "name": "Fastify API & Admin Auth Integration",
        "command": ["node", "--experimental-strip-types", "tests/integration_api.test.ts"],
        "test_ids": ["T029", "T030", "T031", "T049"],
    },
    {
        "name": "Scheduler, Review Lifecycle, Work-End Gate & AI Failover",
        "command": ["node", "--experimental-strip-types", "tests/test_scheduler_and_ai.test.ts"],
        "test_ids": ["T001", "T008", "T009", "T010", "T011", "T012", "T013", "T014", "T015", "T016", "T017", "T032", "T033", "T034", "T035", "T036", "T043", "T046"],
    },
    {
        "name": "Guild Checklist, Final Ping, Mention Scoping & Dashboard Security",
        "command": ["node", "--experimental-strip-types", "tests/test_guild_and_dashboard.test.ts"],
        "test_ids": ["T025", "T026", "T027", "T028", "T041", "T044", "T045", "T050"],
    },
]

def run_master_test_suite():
    print("=" * 70)
    print("FRIEREN DISCORD LOGBOOK AUTOMATION — MASTER ACCEPTANCE SUITE")
    print("=" * 70)

    total_passed = 0
    total_failed = 0
    start_all = time.time()

    for suite in TEST_SUITES:
        print(f"\n▶ Running: {suite['name']} (Mapped to {', '.join(suite['test_ids'])})")
        start = time.time()
        res = subprocess.run(suite["command"], capture_output=True, text=True)
        elapsed = time.time() - start

        if res.returncode == 0:
            print(f"  ✔ PASSED ({elapsed:.2f}s)")
            total_passed += len(suite["test_ids"])
        else:
            print(f"  ✖ FAILED ({elapsed:.2f}s)")
            print("  --- STDOUT ---")
            print(res.stdout)
            print("  --- STDERR ---")
            print(res.stderr)
            total_failed += len(suite["test_ids"])

    print("\n" + "=" * 70)
    print(f"SUMMARY: {total_passed} test cases passed, {total_failed} failed in {time.time() - start_all:.2f}s.")
    print("=" * 70)

    if total_failed > 0:
        sys.exit(1)

if __name__ == "__main__":
    run_master_test_suite()
