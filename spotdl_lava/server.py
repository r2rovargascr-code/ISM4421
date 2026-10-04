"""Local HTTP server for running the UI in a normal web browser (--browser)."""

from __future__ import annotations

import json
import logging
import threading
import webbrowser
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

from .backend import Manager

log = logging.getLogger(__name__)


class Handler(SimpleHTTPRequestHandler):
    manager: Manager

    def log_message(self, fmt, *args):  # keep the console quiet
        log.debug(fmt, *args)

    def _json(self, payload, status=200):
        body = json.dumps(payload).encode()
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Cache-Control", "no-store")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path == "/api/state":
            return self._json(self.manager.state())
        return super().do_GET()

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        try:
            data = json.loads(self.rfile.read(length) or b"{}")
        except json.JSONDecodeError:
            data = {}
        if self.path == "/api/add":
            return self._json(self.manager.add(str(data.get("link", ""))))
        if self.path == "/api/location":
            self.manager.refresh_location()
            return self._json({"ok": True})
        self._json({"ok": False, "message": "not found"}, 404)


def serve(manager: Manager, web_dir: Path, port: int) -> None:
    handler = partial(type("BoundHandler", (Handler,), {"manager": manager}), directory=str(web_dir))
    httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
    url = f"http://127.0.0.1:{httpd.server_port}/"
    print(f"spotDL lava UI running at {url}  (Ctrl+C to stop)")
    threading.Timer(0.5, webbrowser.open, args=(url,)).start()
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        httpd.server_close()
