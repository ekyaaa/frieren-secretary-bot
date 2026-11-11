#!/usr/bin/env python3
"""
Local Git Scanner for Frieren Discord Logbook.
Discovers Git repositories within user-authorized directories,
extracts commit metadata (hash, author, date, subject, body, stats) for a target date,
and strictly enforces privacy boundaries: no file content, no .env, no credentials.
"""

import os
import subprocess
from datetime import datetime
from typing import List, Dict, Any, Optional

SENSITIVE_FILENAME_PATTERNS = [
    ".env", "id_rsa", "id_ed25519", ".pem", ".key", ".pfx", "credentials", "secret", "token"
]

def is_sensitive_path(filepath: str) -> bool:
    lower = filepath.lower()
    return any(pattern in lower for pattern in SENSITIVE_FILENAME_PATTERNS)

def discover_git_repos(search_paths: List[str], max_depth: int = 3) -> List[Dict[str, str]]:
    """
    Discovers Git repositories under search_paths up to max_depth.
    Guards against symlink loops and path traversal.
    """
    discovered = []
    seen_realpaths = set()

    for base_path in search_paths:
        real_base = os.path.realpath(os.path.expanduser(base_path))
        if not os.path.isdir(real_base) or real_base in seen_realpaths:
            continue
        seen_realpaths.add(real_base)

        # Check if the base path itself is a git repo
        if os.path.isdir(os.path.join(real_base, ".git")):
            alias = os.path.basename(real_base)
            discovered.append({"alias": alias, "path": real_base})
            continue

        base_depth = real_base.rstrip(os.sep).count(os.sep)
        for root, dirs, _ in os.walk(real_base, followlinks=False):
            current_depth = root.rstrip(os.sep).count(os.sep) - base_depth
            if current_depth >= max_depth:
                dirs.clear() # do not recurse deeper
                continue

            if ".git" in dirs:
                repo_path = root
                dirs.remove(".git") # don't search inside .git
                alias = os.path.basename(repo_path)
                if repo_path not in seen_realpaths:
                    seen_realpaths.add(repo_path)
                    discovered.append({"alias": alias, "path": repo_path})

    return discovered

def get_repo_branch(repo_path: str) -> str:
    try:
        res = subprocess.run(
            ["git", "-C", repo_path, "rev-parse", "--abbrev-ref", "HEAD"],
            capture_output=True,
            text=True,
            timeout=5,
            check=True
        )
        return res.stdout.strip()
    except Exception:
        return "main"

def get_commits_for_date(
    repo_path: str,
    target_date: str, # "YYYY-MM-DD"
    timezone: str = "+07:00",
    author_filter: Optional[str] = None
) -> List[Dict[str, Any]]:
    """
    Extracts commit metadata for a specific date from a Git repository.
    Never uploads source code or files.
    """
    if not os.path.isdir(os.path.join(repo_path, ".git")):
        return []

    since = f"{target_date} 00:00:00 {timezone}"
    until = f"{target_date} 23:59:59 {timezone}"

    # Use ASCII Record Separator (\x1e) at the start of each commit and Unit Separator (\x1f) between fields
    # Format: \x1e hash | author_name | author_email | date_iso | subject | body | numstat
    log_format = "\x1e%H\x1f%an\x1f%ae\x1f%aI\x1f%s\x1f%b\x1f"
    cmd = [
        "git", "-C", repo_path, "log",
        f"--since={since}",
        f"--until={until}",
        f"--pretty=format:{log_format}",
        "--numstat"
    ]

    try:
        res = subprocess.run(cmd, capture_output=True, text=True, timeout=15, check=True)
    except Exception:
        return []

    raw_output = res.stdout
    if not raw_output or not raw_output.strip():
        return []

    commits = []
    records = raw_output.split("\x1e")

    for rec in records:
        if not rec.strip():
            continue

        parts = rec.split("\x1f")
        if len(parts) < 6:
            continue

        commit_hash = parts[0].strip()
        author_name = parts[1].strip()
        author_email = parts[2].strip()
        committed_at = parts[3].strip()
        subject = parts[4].strip()
        body = parts[5].strip()
        numstat_block = parts[6].strip() if len(parts) > 6 else ""

        insertions = 0
        deletions = 0
        changed_files_count = 0

        for line in numstat_block.splitlines():
            line_parts = line.strip().split("\t")
            if len(line_parts) == 3 and (line_parts[0].isdigit() or line_parts[0] == "-"):
                ins_str, del_str, file_name = line_parts
                if is_sensitive_path(file_name):
                    continue # Redact sensitive file name completely
                ins = int(ins_str) if ins_str.isdigit() else 0
                dels = int(del_str) if del_str.isdigit() else 0
                insertions += ins
                deletions += dels
                changed_files_count += 1

        # Apply author filter if specified
        if author_filter:
            author_match = (
                author_filter.lower() in author_email.lower()
                or author_filter.lower() in author_name.lower()
            )
            if not author_match:
                continue

        commits.append({
            "hash": commit_hash,
            "author": f"{author_name} <{author_email}>",
            "committedAt": committed_at,
            "subject": subject,
            "body": body,
            "changedFileStats": {
                "files": changed_files_count,
                "insertions": insertions,
                "deletions": deletions,
            }
        })

    return commits
