#!/usr/bin/env python3
"""HTTP echo for the control-app HTTP drive.

Listens on 127.0.0.1:$HTTP_ECHO_PORT (default 8765). Every request is appended
as one JSON object to $HTTP_ECHO_LOG (default
/tmp/handshaker-verify/http-echo.jsonl).

- POST /token parses an OAuth2 client-credentials form and returns
  {"access_token":"tok-<client_id>","expires_in":3600,"token_type":"Bearer"}.
- /missing returns 404.
- Every other path returns 200 JSON with the method, path, query, headers, and
  body that arrived.
"""

from __future__ import annotations

import json
import os
import urllib.parse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

PORT = int(os.environ.get("HTTP_ECHO_PORT", "8765"))
LOG = Path(os.environ.get("HTTP_ECHO_LOG", "/tmp/handshaker-verify/http-echo.jsonl"))


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _body(self) -> bytes:
        length = int(self.headers.get("Content-Length") or 0)
        return self.rfile.read(length) if length else b""

    def _record(self, body: bytes) -> dict:
        split = urllib.parse.urlsplit(self.path)
        entry = {
            "method": self.command,
            "path": split.path,
            "raw_query": split.query,
            "query": urllib.parse.parse_qs(split.query, keep_blank_values=True),
            "headers": {key: value for key, value in self.headers.items()},
            "body": body.decode("utf-8", "replace"),
        }
        LOG.parent.mkdir(parents=True, exist_ok=True)
        with LOG.open("a", encoding="utf-8") as handle:
            handle.write(json.dumps(entry, ensure_ascii=False) + "\n")
        return entry

    def _send(self, status: int, payload: bytes, content_type: str) -> None:
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(payload)))
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(payload)

    def _handle(self) -> None:
        body = self._body()
        entry = self._record(body)
        if entry["path"] == "/missing":
            self._send(404, b"missing", "text/plain; charset=utf-8")
            return
        if entry["path"] == "/token":
            form = urllib.parse.parse_qs(entry["body"], keep_blank_values=True)
            client_id = (form.get("client_id") or [""])[0]
            payload = json.dumps(
                {
                    "access_token": f"tok-{client_id}",
                    "expires_in": 3600,
                    "token_type": "Bearer",
                }
            ).encode()
            self._send(200, payload, "application/json")
            return
        echo = json.dumps(
            {
                "method": entry["method"],
                "path": entry["path"],
                "query": entry["query"],
                "headers": entry["headers"],
                "body": entry["body"],
            }
        ).encode()
        self._send(200, echo, "application/json")

    def do_GET(self) -> None:
        self._handle()

    def do_POST(self) -> None:
        self._handle()

    def do_PUT(self) -> None:
        self._handle()

    def do_PATCH(self) -> None:
        self._handle()

    def do_DELETE(self) -> None:
        self._handle()

    def do_OPTIONS(self) -> None:
        self._handle()

    def do_HEAD(self) -> None:
        self._handle()

    def log_message(self, fmt: str, *args) -> None:
        print(fmt % args, flush=True)


def main() -> None:
    LOG.parent.mkdir(parents=True, exist_ok=True)
    LOG.write_text("")
    server = ThreadingHTTPServer(("127.0.0.1", PORT), Handler)
    print(f"http-echo listening on 127.0.0.1:{PORT} log={LOG}", flush=True)
    server.serve_forever()


if __name__ == "__main__":
    main()
