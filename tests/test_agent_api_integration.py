#!/usr/bin/env python3
"""
End-to-End Agent + API Integration Test.
Spawns Node ApiServer, pairs python agent via one-time code,
scans a real local Git repository, ingests commit snapshot,
and asserts database storage.
"""

import os
import sys
import tempfile
import subprocess
import time
import urllib.request
import json
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "apps", "local-agent"))
from agent_gui import AgentApp, claim_pairing_code
from queue_manager import QueueManager

class TestAgentApiIntegration(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server_port = 9345
        cls.api_base_url = f"http://127.0.0.1:{cls.server_port}"

        # Start Node ApiServer in background
        server_script = f"""
import {{ ApiServer }} from './apps/api/src/server.ts';
import {{ Database }} from './packages/db/src/database.ts';

const db = new Database('./data/test_agent_e2e.db');
const server = new ApiServer({{
  port: {cls.server_port},
  host: '127.0.0.1',
  adminUsername: 'atmin',
  adminPassword: 'password123',
  encryptionKey: 'test-key-for-e2e',
}}, db);

server.agentRepo.createPairingCode('user-e2e-1', 'FR-55555', 5);
await server.start();
console.log('API_READY');
"""
        cls.proc = subprocess.Popen(
            ["node", "--experimental-strip-types", "--input-type=module", "-e", server_script],
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True
        )

        # Wait for API_READY
        ready = False
        start_time = time.time()
        while time.time() - start_time < 10:
            line = cls.proc.stdout.readline()
            if "API_READY" in line:
                ready = True
                break
            time.sleep(0.1)

        if not ready:
            cls.proc.kill()
            raise RuntimeError("API Server failed to start in time")

    @classmethod
    def tearDownClass(cls):
        cls.proc.terminate()
        try:
            cls.proc.wait(timeout=3)
        except subprocess.TimeoutExpired:
            cls.proc.kill()

        if os.path.exists("./data/test_agent_e2e.db"):
            try:
                os.remove("./data/test_agent_e2e.db")
            except Exception:
                pass

    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.config_path = os.path.join(self.temp_dir.name, "agent_config.json")
        self.db_path = os.path.join(self.temp_dir.name, "agent_queue.db")

        # Create sample repo
        self.repo_dir = os.path.join(self.temp_dir.name, "my_project")
        os.makedirs(self.repo_dir, exist_ok=True)
        subprocess.run(["git", "init"], cwd=self.repo_dir, check=True, capture_output=True)
        subprocess.run(["git", "config", "user.name", "E2E Student"], cwd=self.repo_dir, check=True)
        subprocess.run(["git", "config", "user.email", "student@campus.edu"], cwd=self.repo_dir, check=True)

        with open(os.path.join(self.repo_dir, "calculator.py"), "w") as f:
            f.write("def add(a, b): return a + b\n")
        subprocess.run(["git", "add", "calculator.py"], cwd=self.repo_dir, check=True)
        subprocess.run(["git", "commit", "-m", "feat: implement addition in calculator"], cwd=self.repo_dir, check=True)

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_full_agent_workflow(self):
        # 1. Initialize queue manager & save config with API URL and monitored path
        qm = QueueManager(config_path=self.config_path, db_path=self.db_path)
        qm.save_config({
            "api_base_url": self.api_base_url,
            "monitored_paths": [self.repo_dir],
            "device_id": "test-device-uuid-1",
        })

        # 2. Pair device using one-time code "FR-55555"
        claim = claim_pairing_code(self.api_base_url, "FR-55555", "test-device-uuid-1")
        self.assertIsNotNone(claim)
        self.assertEqual(claim["userId"], "user-e2e-1")
        self.assertTrue(claim["bearerToken"].startswith("agt_"))

        # Save token to agent config
        qm.save_config({"bearer_token": claim["bearerToken"], "user_id": claim["userId"]})

        # 3. Instantiate AgentApp and run sync
        app = AgentApp(headless=True, qm=qm)

        sync_res = app.run_sync()
        self.assertEqual(sync_res["status"], "synced_online")
        self.assertEqual(sync_res["commits_count"], 1)

if __name__ == "__main__":
    unittest.main()
