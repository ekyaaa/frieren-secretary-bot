#!/usr/bin/env python3
"""
GUI & CLI Interface for Local Git Agent.
Built with Tkinter (universal Python GUI) with fallback to headless CLI mode.
Allows folder selection, commit preview, pairing code claiming, and snapshot syncing.
"""

import sys
import os
import json
import uuid
import platform
import hashlib
import urllib.request
import urllib.error
from datetime import datetime
from typing import List, Dict, Any, Optional

from git_scanner import discover_git_repos, get_commits_for_date, get_repo_branch
from queue_manager import QueueManager

def claim_pairing_code(api_base_url: str, code: str, device_id: str) -> Optional[Dict[str, Any]]:
    url = f"{api_base_url.rstrip('/')}/api/v1/agent/pair/claim"
    payload = {
        "code": code.strip(),
        "deviceId": device_id,
        "platform": "win32" if sys.platform.startswith("win") else ("darwin" if sys.platform == "darwin" else "linux"),
        "version": "1.0.0",
    }

    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=10) as resp:
            if resp.status == 200:
                return json.loads(resp.read().decode("utf-8"))
    except Exception as e:
        print(f"Pairing claim error: {e}")
    return None

class AgentApp:
    def __init__(self, headless: bool = False, qm: Optional[QueueManager] = None):
        self.qm = qm or QueueManager()
        self.headless = headless
        if not self.qm.config.get("device_id"):
            self.qm.save_config({"device_id": str(uuid.uuid4())})

    def run_sync(self, target_date: Optional[str] = None) -> Dict[str, Any]:
        if not target_date:
            target_date = datetime.now().strftime("%Y-%m-%d")

        search_paths = self.qm.config.get("monitored_paths", [])
        if not search_paths:
            # Default to current directory if none specified
            search_paths = [os.getcwd()]

        repos = discover_git_repos(search_paths)
        repo_infos = []
        all_commits = []

        for r in repos:
            repo_id = hashlib.sha256(r["path"].encode("utf-8")).hexdigest()[:12]
            branch = get_repo_branch(r["path"])
            repo_infos.append({"repoId": repo_id, "alias": r["alias"], "branch": branch})

            commits = get_commits_for_date(
                r["path"],
                target_date=target_date,
                author_filter=self.qm.config.get("author_filter")
            )
            for c in commits:
                c["repoId"] = repo_id
                all_commits.append(c)

        snapshot_payload = {
            "targetDate": target_date,
            "timezone": "Asia/Jakarta",
            "repositories": repo_infos,
            "commits": all_commits,
            "digest": hashlib.sha256(json.dumps(all_commits, sort_keys=True).encode("utf-8")).hexdigest(),
        }

        # Attempt immediate send; if offline, enqueue
        sent = self.qm.send_snapshot_http(snapshot_payload)
        if not sent:
            idempotency_key = self.qm.enqueue_snapshot(target_date, snapshot_payload)
            return {
                "status": "queued_offline",
                "commits_count": len(all_commits),
                "repos_count": len(repos),
                "idempotency_key": idempotency_key,
            }
        else:
            # Also flush any previously pending snapshots
            self.qm.flush_queue()
            return {
                "status": "synced_online",
                "commits_count": len(all_commits),
                "repos_count": len(repos),
            }

    def start_gui(self):
        try:
            import tkinter as tk
            from tkinter import filedialog, messagebox
        except ImportError:
            print("Tkinter not available. Falling back to headless mode.")
            self.run_cli()
            return

        if not os.environ.get("DISPLAY") and not sys.platform.startswith("win"):
            print("No DISPLAY available. Running in headless mode.")
            self.run_cli()
            return

        root = tk.Tk()
        root.title("Frieren Local Git Agent")
        root.geometry("520x420")

        # Status frame
        frame = tk.Frame(root, padx=10, pady=10)
        frame.pack(fill=tk.BOTH, expand=True)

        paired_status = "PAIRED" if self.qm.config.get("bearer_token") else "UNPAIRED"
        lbl_status = tk.Label(frame, text=f"Device Status: {paired_status}", font=("Arial", 11, "bold"))
        lbl_status.pack(anchor="w", pady=5)

        # Monitored folders
        lbl_folders = tk.Label(frame, text="Monitored Projects:")
        lbl_folders.pack(anchor="w")

        lst_folders = tk.Listbox(frame, height=4)
        for p in self.qm.config.get("monitored_paths", []):
            lst_folders.insert(tk.END, p)
        lst_folders.pack(fill=tk.X, pady=5)

        def add_folder():
            folder = filedialog.askdirectory()
            if folder:
                current = self.qm.config.get("monitored_paths", [])
                if folder not in current:
                    current.append(folder)
                    self.qm.save_config({"monitored_paths": current})
                    lst_folders.insert(tk.END, folder)

        btn_add = tk.Button(frame, text="Add Project Folder...", command=add_folder)
        btn_add.pack(anchor="w", pady=2)

        # Pairing code entry
        lbl_pair = tk.Label(frame, text="Pairing Code (from Discord /agent pair):")
        lbl_pair.pack(anchor="w", pady=(10, 0))

        ent_pair = tk.Entry(frame, width=20)
        ent_pair.pack(anchor="w", pady=2)

        def do_pair():
            code = ent_pair.get().strip()
            if not code:
                messagebox.showwarning("Warning", "Please enter a pairing code.")
                return
            res = claim_pairing_code(
                self.qm.config.get("api_base_url", "http://127.0.0.1:3100"),
                code,
                self.qm.config["device_id"]
            )
            if res:
                self.qm.save_config({
                    "user_id": res.get("userId", ""),
                    "bearer_token": res.get("bearerToken", ""),
                })
                lbl_status.config(text="Device Status: PAIRED", fg="green")
                messagebox.showinfo("Success", "Device paired successfully with your Discord account!")
            else:
                messagebox.showerror("Error", "Pairing failed. Code may be invalid or expired (5 min TTL).")

        btn_pair = tk.Button(frame, text="Claim Pairing Code", command=do_pair)
        btn_pair.pack(anchor="w", pady=2)

        # Sync button
        def do_sync():
            res = self.run_sync()
            status = res["status"]
            count = res["commits_count"]
            messagebox.showinfo("Sync Result", f"Status: {status}\nCommits found: {count}")

        btn_sync = tk.Button(frame, text="Sync Commits Now", bg="#4CAF50", fg="white", command=do_sync)
        btn_sync.pack(fill=tk.X, pady=15)

        root.mainloop()

    def run_cli(self):
        print(f"Frieren Local Git Agent [Device ID: {self.qm.config.get('device_id')}]")
        print(f"Status: {'PAIRED' if self.qm.config.get('bearer_token') else 'UNPAIRED'}")
        result = self.run_sync()
        print(f"Sync result: {json.dumps(result, indent=2)}")

if __name__ == "__main__":
    headless_flag = "--headless" in sys.argv
    app = AgentApp(headless=headless_flag)
    if headless_flag:
        app.run_cli()
    else:
        app.start_gui()
