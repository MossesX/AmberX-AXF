"""Web browser server part: any http(s) host opens, other schemes and credentials are refused, every open and close is
in the audit log, state shows the pane, `show` sends web-browser.show through console-commands@1, the capability.

    python apps/console-web/plugins/web-browser/server/test_web_browser.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services
os.environ["AXF_WEB_BROWSER_DIR"] = tempfile.mkdtemp(prefix="axf-web-browser-")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402


class FakeConsole:
    def __init__(self) -> None:
        self.sent: list[dict] = []

    def run(self, command: dict, grants=None, by: str = "", audience: str = "owner", wait=None) -> dict:
        self.sent.append({**command, "_by": by})
        return {"ok": True, "delivery": {"how": "live"}}


console = FakeConsole()
plugin_services.provide("console-commands@1", console, folder="fake-console")

spec = importlib.util.spec_from_file_location("web_browser_server", HERE / "__init__.py")
wb = importlib.util.module_from_spec(spec)
spec.loader.exec_module(wb)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(wb.router, prefix="/api/plugins/web-browser")
client = TestClient(app)

fails = 0
n = 0


def check(cond: bool, what: str) -> None:
    global fails, n
    n += 1
    if not cond:
        fails += 1
        print(f"  ✗ {what}")


# any https host, a bare address gets https, ports and paths kept
for raw, want in [("https://example.com", "https://example.com/"), ("example.com/news?x=1", "https://example.com/news?x=1"),
                  ("http://news.ycombinator.com/item?id=1", "http://news.ycombinator.com/item?id=1"), ("example.com:8080/a", "https://example.com:8080/a"),
                  ("HTTPS://GitHub.com/anthropics", "https://github.com/anthropics")]:
    try:
        got = wb.clean_url(raw)
    except ValueError as e:
        got = f"error: {e}"
    check(got == want, f"clean_url({raw!r}) = {got!r}, wanted {want!r}")

for bad in ["", "javascript:alert(1)", "file:///etc/passwd", "data:text/html,hi", "intent://x#Intent;end", "chrome://settings",
            "ftp://example.com", "https://user:pw@example.com", "https://exa mple.com", "notes", "https://", "x" * 2100]:
    try:
        wb.clean_url(bad)
        check(False, f"clean_url refuses {bad[:40]!r}")
    except ValueError:
        check(True, "refused")

r = client.post("/api/plugins/web-browser/open", json={"url": "example.com", "by": "test", "reason": {"title": "Look", "description": "Check the page"}})
check(r.status_code == 200 and r.json()["url"] == "https://example.com/", f"open: 200 with the clean url ({r.status_code} {r.text[:200]})")
check(r.json().get("shown", {}).get("ok") is True, "open: shown in the console by default")
check(console.sent and console.sent[-1]["path"] == "web-browser.show", "open: sends web-browser.show through console-commands@1")
r = client.post("/api/plugins/web-browser/open", json={"url": "https://github.com", "show": False, "record": True, "via": "voice"})
check(r.status_code == 200 and "shown" not in r.json() and r.json()["record"] is True, "open: show false stays quiet; record is noted")
check(len(console.sent) == 1, "open: show false sends nothing to the console")
r = client.post("/api/plugins/web-browser/open", json={"url": "javascript:alert(1)"})
check(r.status_code == 422, "open: another scheme is 422")

s = client.get("/api/plugins/web-browser/state").json()
check(s["current"]["url"] == "https://github.com/" and [e["url"] for e in s["recent"]] == ["https://github.com/", "https://example.com/"], f"state: current + recent newest first ({s})")
r = client.post("/api/plugins/web-browser/close", json={"by": "test"})
check(r.json()["closed"] == "https://github.com/" and client.get("/api/plugins/web-browser/state").json()["current"] is None, "close: clears the pane")

log = client.get("/api/plugins/web-browser/log?limit=10").json()["entries"]
check([e["op"] for e in log] == ["close", "open", "open"], f"log: every open and close, newest first ({[e['op'] for e in log]})")
check(log[2].get("reason") == {"title": "Look", "description": "Check the page"} and log[2]["by"] == "test", "log: by and reason kept")
check(not any(e.get("url") == "javascript:alert(1)" for e in log), "log: a refused open never becomes current")

svc = plugin_services.get("web-browser@1")
check(svc is not None and svc.open("https://anthropic.com", by="svc")["host"] == "anthropic.com" and svc.state()["current"]["via"] == "service", "capability web-browser@1 opens and reads")

print(f"{'✓' if fails == 0 else '✗'} {n - fails}/{n} web browser checks passed")
sys.exit(1 if fails else 0)
