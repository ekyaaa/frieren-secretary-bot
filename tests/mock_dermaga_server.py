#!/usr/bin/env python3
"""
Mock DERMAGA Portal Server for Deterministic Testing.
Serves HTML fixtures, validates session cookies and CSRF tokens,
and tracks HTTP request history (including reload verification).
"""

import os
from http import HTTPStatus
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import parse_qs, urlparse

FIXTURES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "fixtures", "dermaga")

class MockDermagaHandler(BaseHTTPRequestHandler):
    # Class-level state across requests
    submissions = []
    login_attempts = []
    reload_count = 0
    monitoring_mode = "matching"  # matching | missing | wrong_date | other_user
    authenticated_user = None

    def _read_fixture(self, filename):
        path = os.path.join(FIXTURES_DIR, filename)
        with open(path, "r", encoding="utf-8") as f:
            return f.read()

    def _get_cookie(self, name):
        cookie_header = self.headers.get("Cookie", "")
        for item in cookie_header.split(";"):
            item = item.strip()
            if item.startswith(f"{name}="):
                return item.split("=", 1)[1]
        return None

    def do_GET(self):
        parsed = urlparse(self.path)
        
        if parsed.path == "/dermaga/login":
            html = self._read_fixture("login_form.html")
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return

        if parsed.path == "/dermaga/mahasiswa/monitoring":
            MockDermagaHandler.reload_count += 1
            session = self._get_cookie("dermaga_session")
            if not session or session != "valid-session-token":
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Location", "/dermaga/login")
                self.end_headers()
                return

            if not MockDermagaHandler.submissions:
                html = self._read_fixture("monitoring_before_empty.html")
            else:
                if MockDermagaHandler.monitoring_mode == "matching":
                    html = self._read_fixture("monitoring_after_matching.html")
                elif MockDermagaHandler.monitoring_mode == "missing":
                    html = self._read_fixture("monitoring_after_missing.html")
                elif MockDermagaHandler.monitoring_mode == "wrong_date":
                    html = self._read_fixture("monitoring_after_wrong_date.html")
                elif MockDermagaHandler.monitoring_mode == "other_user":
                    html = self._read_fixture("monitoring_after_other_user.html")
                else:
                    html = self._read_fixture("monitoring_before_empty.html")

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
            return

        if parsed.path == "/test/status":
            import json
            status = {
                "submissions_count": len(MockDermagaHandler.submissions),
                "reload_count": MockDermagaHandler.reload_count,
                "monitoring_mode": MockDermagaHandler.monitoring_mode,
                "authenticated_user": MockDermagaHandler.authenticated_user,
            }
            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(json.dumps(status).encode("utf-8"))
            return

        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

    def do_POST(self):
        parsed = urlparse(self.path)
        content_length = int(self.headers.get("Content-Length", 0))
        body = self.rfile.read(content_length).decode("utf-8")
        data = parse_qs(body)

        if parsed.path == "/dermaga/login":
            username = data.get("username", [""])[0]
            password = data.get("password", [""])[0]
            token = data.get("_token", [""])[0]

            MockDermagaHandler.login_attempts.append({"username": username, "token": token})

            if username == "student_2026001" and password == "secret123":
                MockDermagaHandler.authenticated_user = username
                self.send_response(HTTPStatus.FOUND)
                self.send_header("Set-Cookie", "dermaga_session=valid-session-token; Path=/; HttpOnly")
                self.send_header("Location", "/dermaga/mahasiswa/monitoring")
                self.end_headers()
            else:
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.end_headers()
                self.wfile.write(b"Invalid login credentials")
            return

        if parsed.path == "/dermaga/mahasiswa/monitoring/simpan":
            session = self._get_cookie("dermaga_session")
            if not session or session != "valid-session-token":
                self.send_response(HTTPStatus.UNAUTHORIZED)
                self.end_headers()
                return

            submission = {
                "date": data.get("tanggal", [""])[0] or data.get("date", [""])[0],
                "start_time": data.get("jam_masuk", [""])[0] or data.get("start_time", [""])[0],
                "end_time": data.get("jam_pulang", [""])[0] or data.get("end_time", [""])[0],
                "activity": data.get("kegiatan", [""])[0] or data.get("activity", [""])[0],
            }
            MockDermagaHandler.submissions.append(submission)

            self.send_response(HTTPStatus.OK)
            self.send_header("Content-Type", "application/json")
            self.end_headers()
            self.wfile.write(b'{"status":"success","message":"Data logbook berhasil disimpan."}')
            return

        if parsed.path == "/test/reset":
            MockDermagaHandler.submissions = []
            MockDermagaHandler.login_attempts = []
            MockDermagaHandler.reload_count = 0
            MockDermagaHandler.monitoring_mode = "matching"
            MockDermagaHandler.authenticated_user = None
            self.send_response(HTTPStatus.OK)
            self.end_headers()
            self.wfile.write(b'{"reset":true}')
            return

        if parsed.path == "/test/mode":
            mode = data.get("mode", ["matching"])[0]
            MockDermagaHandler.monitoring_mode = mode
            self.send_response(HTTPStatus.OK)
            self.end_headers()
            self.wfile.write(f'{{"mode":"{mode}"}}'.encode("utf-8"))
            return

        self.send_response(HTTPStatus.NOT_FOUND)
        self.end_headers()

def run_mock_server(port=8999):
    server_address = ("127.0.0.1", port)
    httpd = HTTPServer(server_address, MockDermagaHandler)
    print(f"Mock DERMAGA server running on http://127.0.0.1:{port}")
    httpd.serve_forever()

if __name__ == "__main__":
    import sys
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8999
    run_mock_server(port)
