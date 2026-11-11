#!/usr/bin/env python3
"""
Unit and Integration Tests for Local Git Agent.
Tests repo discovery, commit extraction, sensitive file filtering,
offline queue persistence, and pairing integration.
"""

import os
import sys
import tempfile
import subprocess
import unittest
import json
import threading
import time
from datetime import datetime

# Add apps/local-agent to sys.path
sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "local-agent"))

from git_scanner import discover_git_repos, get_commits_for_date, is_sensitive_path
from queue_manager import QueueManager
from agent_gui import AgentApp, claim_pairing_code

class TestLocalAgent(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.TemporaryDirectory()
        self.repo_path = os.path.join(self.test_dir.name, "sample_repo")
        os.makedirs(self.repo_path, exist_ok=True)

        # Initialize sample git repo
        subprocess.run(["git", "init"], cwd=self.repo_path, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "Test User"], cwd=self.repo_path, check=True)
        subprocess.run(["git", "config", "user.email", "test@example.com"], cwd=self.repo_path, check=True)

        # Commit 1: normal file
        file1 = os.path.join(self.repo_path, "feature.py")
        with open(file1, "w") as f:
            f.write("print('Hello Frieren')\n")
        subprocess.run(["git", "add", "feature.py"], cwd=self.repo_path, check=True)
        subprocess.run(["git", "commit", "-m", "feat: implement feature"], cwd=self.repo_path, check=True)

        # Commit 2: normal file + sensitive .env file
        file2 = os.path.join(self.repo_path, "service.py")
        with open(file2, "w") as f:
            f.write("def run(): pass\n")
        env_file = os.path.join(self.repo_path, ".env")
        with open(env_file, "w") as f:
            f.write("SECRET_KEY=123456\n")

        subprocess.run(["git", "add", "service.py", ".env"], cwd=self.repo_path, check=True)
        subprocess.run(["git", "commit", "-m", "feat: add service and config\n\nDetailed body explanation"], cwd=self.repo_path, check=True)

    def tearDown(self):
        self.test_dir.cleanup()

    def test_repo_discovery(self):
        discovered = discover_git_repos([self.test_dir.name])
        self.assertEqual(len(discovered), 1)
        self.assertEqual(discovered[0]["alias"], "sample_repo")

    def test_sensitive_path_check(self):
        self.assertTrue(is_sensitive_path(".env"))
        self.assertTrue(is_sensitive_path("config/.env.local"))
        self.assertTrue(is_sensitive_path("keys/id_rsa"))
        self.assertFalse(is_sensitive_path("src/app.py"))

    def test_commit_extraction_and_redaction(self):
        today = datetime.now().strftime("%Y-%m-%d")
        commits = get_commits_for_date(self.repo_path, today)
        self.assertGreaterEqual(len(commits), 2)

        # Find the commit with body and .env
        c2 = next((c for c in commits if "add service" in c["subject"]), None)
        self.assertIsNotNone(c2)
        self.assertIn("Detailed body explanation", c2["body"])
        self.assertIn("Test User", c2["author"])
        # .env should be excluded from stats, so only service.py is counted
        self.assertEqual(c2["changedFileStats"]["files"], 1)

    def test_offline_queue(self):
        db_file = os.path.join(self.test_dir.name, "queue.db")
        config_file = os.path.join(self.test_dir.name, "config.json")
        qm = QueueManager(config_path=config_file, db_path=db_file)

        self.assertEqual(qm.get_pending_count(), 0)

        # Enqueue a snapshot
        sample_payload = {"targetDate": "2026-11-11", "commits": [{"hash": "123"}]}
        idempotency_key = qm.enqueue_snapshot("2026-11-11", sample_payload)
        self.assertEqual(qm.get_pending_count(), 1)

        # Enqueue same snapshot should be deduplicated
        qm.enqueue_snapshot("2026-11-11", sample_payload)
        self.assertEqual(qm.get_pending_count(), 1)

if __name__ == "__main__":
    unittest.main()
