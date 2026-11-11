#!/usr/bin/env python3
"""
Integration Tests for DERMAGA Automation and Fresh-Reload Proof.
Runs tests against MockDermagaServer using HTML fixtures.
Verifies T019, T020, T021, T022, T039, T047.
"""

import os
import sys
import threading
import time
import unittest
import urllib.request
import urllib.parse
import json

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services", "dermaga-worker"))
from playwright_verifier import PlaywrightVerifier
from mock_dermaga_server import run_mock_server, MockDermagaHandler

class TestDermagaVerification(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_port = 8995
        cls.base_url = f"http://127.0.0.1:{cls.server_port}"

        # Start mock DERMAGA server in background thread
        cls.server_thread = threading.Thread(
            target=run_mock_server,
            args=(cls.server_port,),
            daemon=True
        )
        cls.server_thread.start()
        time.sleep(0.3)

    def setUp(self):
        # Reset mock server state
        req = urllib.request.Request(f"{self.base_url}/test/reset", data=b"", method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)

        self.verifier = PlaywrightVerifier(base_url=self.base_url)

    def set_mock_mode(self, mode: str):
        data = urllib.parse.urlencode({"mode": mode}).encode("utf-8")
        req = urllib.request.Request(f"{self.base_url}/test/mode", data=data, method="POST")
        with urllib.request.urlopen(req) as resp:
            self.assertEqual(resp.status, 200)

    def test_t039_invalid_credentials(self):
        """T039: Wrong credentials return NEEDS_ATTENTION, does not attempt submission."""
        res = self.verifier.submit_and_fresh_verify(
            username="student_2026001",
            password="wrong_password",
            date="2026-11-11",
            start_time="07:10",
            end_time="16:25",
            activity="Test work"
        )
        self.assertEqual(res["status"], "NEEDS_ATTENTION")
        self.assertEqual(res["error"], "PORTAL_LOGIN_FAILED")

    def test_t019_post_200_without_row_stays_unverified(self):
        """
        T019/T020: POST returns 200 success banner, but fresh DOM reload lacks the row.
        Hard boundary: Must remain SUBMITTED_UNVERIFIED, never VERIFIED!
        """
        self.set_mock_mode("missing") # Server will return success toast but empty table

        res = self.verifier.submit_and_fresh_verify(
            username="student_2026001",
            password="secret123",
            date="2026-11-11",
            start_time="07:10",
            end_time="16:25",
            activity="Testing missing row edge case"
        )

        self.assertEqual(res["status"], "SUBMITTED_UNVERIFIED")
        self.assertIn("refreshed monitoring page does not show the entry", res["message"])

    def test_t021_fresh_reload_verified_with_screenshot(self):
        """
        T021: POST succeeds, fresh reload finds matching row -> VERIFIED,
        captures screenshot proof, calculates SHA-256.
        """
        self.set_mock_mode("matching") # Server returns matching row after submit

        res = self.verifier.submit_and_fresh_verify(
            username="student_2026001",
            password="secret123",
            date="2026-11-11",
            start_time="07:10",
            end_time="16:25",
            activity="Melakukan implementasi arsitektur microservices"
        )

        self.assertEqual(res["status"], "VERIFIED")
        self.assertEqual(res["evidence_status"], "READY")
        self.assertIsNotNone(res.get("screenshot_path"))
        self.assertTrue(os.path.exists(res["screenshot_path"]))
        self.assertIsNotNone(res.get("screenshot_sha256"))
        self.assertIsNotNone(res.get("captured_after_refresh_at"))

    def test_t022_screenshot_failure_preserves_verified_status(self):
        """
        T022: Fresh DOM matches, but screenshot capture fails ->
        Business status stays VERIFIED, evidence marked SCREENSHOT_FAILED, no duplicate POST!
        """
        self.set_mock_mode("matching")

        res = self.verifier.submit_and_fresh_verify(
            username="student_2026001",
            password="secret123",
            date="2026-11-11",
            start_time="07:10",
            end_time="16:25",
            activity="Melakukan refactoring",
            simulate_screenshot_failure=True
        )

        self.assertEqual(res["status"], "VERIFIED")
        self.assertEqual(res["evidence_status"], "SCREENSHOT_FAILED")
        self.assertEqual(res.get("error"), "SCREENSHOT_CAPTURE_ERROR")

    def test_t047_account_mismatch_fails_closed(self):
        """T047: Monitoring page belongs to another account -> Fails closed, not verified."""
        self.set_mock_mode("other_user")

        res = self.verifier.submit_and_fresh_verify(
            username="student_2026001",
            password="secret123",
            date="2026-11-11",
            start_time="07:10",
            end_time="16:25",
            activity="Work on other account"
        )

        self.assertEqual(res["status"], "NEEDS_ATTENTION")
        self.assertEqual(res["error"], "ACCOUNT_MISMATCH")

if __name__ == "__main__":
    unittest.main()
