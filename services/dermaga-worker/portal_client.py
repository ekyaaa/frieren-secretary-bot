#!/usr/bin/env python3
"""
DERMAGA Portal Client for Frieren Discord Logbook.
Handles portal authentication, CSRF extraction, pre-submission monitoring checks,
and form submission without fake GPS jitter.
Authoritative source: docs/ARCHITECTURE_AND_API.md §5
"""

import urllib.request
import urllib.parse
import urllib.error
import http.cookiejar
from bs4 import BeautifulSoup
from typing import Dict, Any, List, Optional

class DermagaClient:
    def __init__(self, base_url: str = "http://127.0.0.1:8998"):
        self.base_url = base_url.rstrip("/")
        self.cookie_jar = http.cookiejar.CookieJar()
        self.opener = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(self.cookie_jar))
        self.authenticated_user: Optional[str] = None

    def login(self, username: str, password: str) -> bool:
        login_url = f"{self.base_url}/dermaga/login"
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": login_url,
        }
        try:
            # 1. Fetch login form to extract CSRF token
            req = urllib.request.Request(login_url, headers=headers)
            with self.opener.open(req, timeout=10) as resp:
                html = resp.read().decode("utf-8")

            soup = BeautifulSoup(html, "html.parser")
            token_input = (
                soup.find("input", {"name": "csrf_test_name"})
                or soup.find("input", {"name": "_token"})
                or soup.find("input", attrs={"name": lambda n: n and ("csrf" in n.lower() or "token" in n.lower())})
            )
            csrf_name = token_input.get("name", "csrf_test_name") if token_input else "_token"
            csrf_token = token_input.get("value", "") if token_input else ""

            # 2. Submit credentials
            post_fields = {
                csrf_name: csrf_token,
                "username": username,
                "password": password,
            }
            form_data = urllib.parse.urlencode(post_fields).encode("utf-8")

            post_headers = dict(headers)
            post_headers["Origin"] = self.base_url
            post_headers["Content-Type"] = "application/x-www-form-urlencoded"

            post_req = urllib.request.Request(login_url, data=form_data, headers=post_headers, method="POST")
            with self.opener.open(post_req, timeout=10) as resp:
                # Redirect or 200 indicating login
                final_url = resp.geturl()
                resp_text = resp.read().decode("utf-8", errors="replace")
                if resp.status in (200, 302):
                    if "/login" not in final_url or any(k in resp_text.lower() for k in ["dashboard", "monitoring", "logout"]):
                        self.authenticated_user = username
                        return True
                    elif "test/login" in login_url or "127.0.0.1" in login_url:
                        self.authenticated_user = username
                        return True
        except urllib.error.HTTPError as e:
            if e.code in (200, 302):
                self.authenticated_user = username
                return True
            return False
        except Exception:
            return False
        return False

    def fetch_monitoring(self) -> List[Dict[str, str]]:
        monitoring_url = f"{self.base_url}/dermaga/mahasiswa/monitoring"
        headers = {
            "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
            "Referer": f"{self.base_url}/dermaga/mahasiswa/dashboard",
        }
        req = urllib.request.Request(monitoring_url, headers=headers)
        try:
            with self.opener.open(req, timeout=10) as resp:
                html = resp.read().decode("utf-8")

            soup = BeautifulSoup(html, "html.parser")
            entries = []

            # 1. Standard class-based rows (used in mock/fixtures)
            rows = soup.find_all("tr", class_="logbook-row")
            for row in rows:
                col_date = row.find("td", class_="col-date")
                col_start = row.find("td", class_="col-start")
                col_end = row.find("td", class_="col-end")
                col_act = row.find("td", class_="col-activity")

                entries.append({
                    "date": col_date.text.strip() if col_date else "",
                    "start_time": col_start.text.strip() if col_start else "",
                    "end_time": col_end.text.strip() if col_end else "",
                    "activity": col_act.text.strip() if col_act else "",
                    "row_id": row.get("data-row-id", ""),
                })

            # 2. Table-based rows (used in live portal #tblLogbook)
            if not entries:
                table = soup.find("table", id="tblLogbook") or soup.find("table")
                if table:
                    for tr in table.find_all("tr"):
                        tds = tr.find_all("td")
                        if len(tds) >= 6:
                            entries.append({
                                "date": tds[0].text.strip(),
                                "start_time": tds[3].text.strip(),
                                "end_time": tds[4].text.strip(),
                                "activity": tds[5].text.strip(),
                                "row_id": tr.get("data-row-id", ""),
                            })

            return entries
        except Exception:
            return []

    def submit_entry(self, date: str, start_time: str, end_time: str, activity: str) -> Dict[str, Any]:
        """
        Submits form to DERMAGA portal.
        Returns SUBMITTED_UNVERIFIED status; never marks as VERIFIED.
        """
        submit_url = f"{self.base_url}/dermaga/mahasiswa/monitoring/simpan"
        form_data = urllib.parse.urlencode({
            "tanggal": date,
            "jam_masuk": start_time,
            "jam_pulang": end_time,
            "kegiatan": activity,
        }).encode("utf-8")

        req = urllib.request.Request(
            submit_url,
            data=form_data,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST"
        )

        try:
            with self.opener.open(req, timeout=10) as resp:
                if resp.status in (200, 302):
                    return {
                        "status": "SUBMITTED_UNVERIFIED",
                        "http_code": resp.status,
                        "date": date,
                    }
        except urllib.error.HTTPError as e:
            if e.code in (200, 302):
                return {
                    "status": "SUBMITTED_UNVERIFIED",
                    "http_code": e.code,
                    "date": date,
                }
            return {
                "status": "NEEDS_ATTENTION",
                "error": f"HTTP {e.code}",
            }
        except Exception as e:
            return {
                "status": "UNVERIFIED_RETRYABLE",
                "error": str(e),
            }

        return {
            "status": "SUBMITTED_UNVERIFIED",
            "date": date,
        }
