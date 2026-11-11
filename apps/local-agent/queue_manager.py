#!/usr/bin/env python3
"""
Local Queue and Configuration Manager for Local Git Agent.
Stores agent configuration and provides durable offline queueing
with automatic replay upon network recovery.
"""

import os
import json
import sqlite3
import urllib.request
import urllib.error
import hashlib
from typing import Optional, Dict, Any, List

def get_default_storage_dir() -> str:
    try:
        home_path = os.path.expanduser("~")
        test_file = os.path.join(home_path, ".frieren_write_test")
        with open(test_file, "w") as f:
            f.write("ok")
        os.remove(test_file)
        return home_path
    except Exception:
        workspace_data = os.path.join(os.getcwd(), "data")
        os.makedirs(workspace_data, exist_ok=True)
        return workspace_data

DEFAULT_STORAGE_DIR = get_default_storage_dir()
DEFAULT_CONFIG_PATH = os.path.join(DEFAULT_STORAGE_DIR, ".frieren_agent_config.json")
DEFAULT_DB_PATH = os.path.join(DEFAULT_STORAGE_DIR, ".frieren_agent_queue.db")

class QueueManager:
    def __init__(self, config_path: str = DEFAULT_CONFIG_PATH, db_path: str = DEFAULT_DB_PATH):
        self.config_path = config_path
        self.db_path = db_path
        self.config = self._load_config()
        self._init_db()

    def _load_config(self) -> Dict[str, Any]:
        if os.path.exists(self.config_path):
            try:
                with open(self.config_path, "r", encoding="utf-8") as f:
                    return json.load(f)
            except Exception:
                pass
        return {
            "device_id": "",
            "user_id": "",
            "bearer_token": "",
            "api_base_url": "http://127.0.0.1:3100",
            "monitored_paths": [],
            "author_filter": "",
            "auto_start": False,
        }

    def save_config(self, updates: Dict[str, Any]) -> None:
        self.config.update(updates)
        os.makedirs(os.path.dirname(os.path.abspath(self.config_path)), exist_ok=True)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump(self.config, f, indent=2)

    def _init_db(self) -> None:
        os.makedirs(os.path.dirname(os.path.abspath(self.db_path)), exist_ok=True)
        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS pending_snapshots (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    target_date TEXT NOT NULL,
                    payload_json TEXT NOT NULL,
                    idempotency_key TEXT UNIQUE NOT NULL,
                    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                    attempts INTEGER DEFAULT 0
                )
            """)

    def enqueue_snapshot(self, target_date: str, payload: Dict[str, Any]) -> str:
        payload_str = json.dumps(payload, sort_keys=True)
        idempotency_key = hashlib.sha256(payload_str.encode("utf-8")).hexdigest()

        with sqlite3.connect(self.db_path) as conn:
            conn.execute("""
                INSERT OR IGNORE INTO pending_snapshots (target_date, payload_json, idempotency_key)
                VALUES (?, ?, ?)
            """, (target_date, payload_str, idempotency_key))

        return idempotency_key

    def get_pending_count(self) -> int:
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT COUNT(*) FROM pending_snapshots")
            return cur.fetchone()[0]

    def send_snapshot_http(self, payload: Dict[str, Any]) -> bool:
        url = f"{self.config.get('api_base_url', 'http://127.0.0.1:3100').rstrip('/')}/api/v1/agent/commit-snapshots"
        token = self.config.get("bearer_token", "")
        if not token:
            return False

        req = urllib.request.Request(
            url,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
            },
            method="POST"
        )

        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return resp.status == 200
        except Exception:
            return False

    def flush_queue(self) -> int:
        """
        Attempts to replay all queued snapshots.
        Returns the number of successfully flushed items.
        """
        flushed = 0
        with sqlite3.connect(self.db_path) as conn:
            cur = conn.cursor()
            cur.execute("SELECT id, payload_json FROM pending_snapshots ORDER BY id ASC")
            rows = cur.fetchall()

            for row_id, payload_str in rows:
                try:
                    payload = json.loads(payload_str)
                    if self.send_snapshot_http(payload):
                        conn.execute("DELETE FROM pending_snapshots WHERE id = ?", (row_id,))
                        flushed += 1
                    else:
                        conn.execute("UPDATE pending_snapshots SET attempts = attempts + 1 WHERE id = ?", (row_id,))
                        break # Stop on first failure to maintain in-order sync
                except Exception:
                    break

        return flushed
