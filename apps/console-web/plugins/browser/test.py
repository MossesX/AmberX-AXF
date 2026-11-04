#!/usr/bin/env python3
"""Self-test for the Automated Browser plugin's server part (FastAPI test client against a real browser host).

Covers: config (defaults, save, bad host URL refused, token from the data folder, never in answers); status and the
systems check item when the host is down; then, with a real host (host/host.mjs + headless Chromium): open, navigate
to a local page, fill / click / extract, screenshot JSON + PNG, tabs, device, the generic run route, auto-open on the
first command, and the live view relayed through the plugin's websocket (frames out, input + command results back).
The live part is skipped when playwright-core can't be found (set AXF_PLAYWRIGHT=<path to playwright-core/index.mjs>).

    python3 apps/console-web/plugins/browser/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import socket
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-browser-test-"))
os.environ["AXF_BROWSER_PLUGIN_DIR"] = str(TMP / "plugin")
os.environ.pop("AXF_BROWSER_URL", None)
os.environ.pop("AXF_BROWSER_TOKEN", None)

sys.path.insert(0, str(HERE.parent.parent / "server"))
spec = importlib.util.spec_from_file_location("browser_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["browser_server"] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/browser")
client = TestClient(app)
P = "/api/plugins/browser"

passed = failed = 0


def t(name: str, fn) -> None:
    global passed, failed
    try:
        fn()
        passed += 1
        print(f"ok   {name}")
    except Exception as e:  # noqa: BLE001
        failed += 1
        print(f"FAIL {name}\n     {type(e).__name__}: {e}")


def free_port() -> int:
    s = socket.socket()
    s.bind(("127.0.0.1", 0))
    p = s.getsockname()[1]
    s.close()
    return p


# ---- without a host ----------------------------------------------------------------------------------------------
dead = free_port()


def t_defaults() -> None:
    c = client.get(f"{P}/config").json()
    assert c["hostUrl"] == "http://axf-browser:7095" and c["workspace"] == "default" and c["device"] == "desktop", c


def t_save() -> None:
    r = client.put(f"{P}/config", json={"hostUrl": f"http://127.0.0.1:{dead}", "device": "phone", "bogus": 1}).json()
    assert r["hostUrl"].endswith(str(dead)) and r["device"] == "phone" and "bogus" not in r, r
    assert oct((TMP / "plugin" / "config.json").stat().st_mode & 0o777) == "0o600"


def t_bad_url() -> None:
    assert client.put(f"{P}/config", json={"hostUrl": "file:///etc"}).status_code == 400


def t_down() -> None:
    s = client.get(f"{P}/status").json()
    assert s["reachable"] is False and "not reachable" in s["error"], s
    assert client.post(f"{P}/navigate", json={"url": "https://example.com"}).status_code == 503
    h = client.get(f"{P}/health-check").json()
    assert h["status"] == "error" and h["unreachable"], h


def t_token_file() -> None:
    (TMP / "plugin" / "host-token").write_text("file-token\n")
    assert mod.HOST.token() == "file-token"
    assert "file-token" not in json.dumps(client.get(f"{P}/config").json())
    assert client.get(f"{P}/config").json()["tokenSet"] is True


t("config defaults", t_defaults)
t("config save (0600, unknown keys dropped)", t_save)
t("config refuses a non-http host URL", t_bad_url)
t("host down: status, 503 on commands, red health item", t_down)
t("token read from the data folder, never answered", t_token_file)

# ---- with a real host ----------------------------------------------------------------------------------------------
PW = os.environ.get("AXF_PLAYWRIGHT") or ""
if not PW:
    for cand in [HERE / "host" / "node_modules" / "playwright-core" / "index.mjs", HERE.parent.parent / "node_modules" / "playwright-core" / "index.mjs"]:
        if cand.exists():
            PW = str(cand)
            break

PAGE = b"""<!doctype html><meta charset=utf-8><title>Plugin test</title><input id=q><button id=b onclick="document.getElementById('o').textContent='got '+document.getElementById('q').value">Go</button><p id=o></p>
<button id=big style="position:absolute;left:0;top:300px;width:300px;height:80px" onclick="this.textContent='hit'">big</button>"""


class Site(BaseHTTPRequestHandler):
    def do_GET(self) -> None:  # noqa: N802
        self.send_response(200)
        self.send_header("content-type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write(PAGE)

    def log_message(self, *a) -> None:  # noqa: D401
        pass


if not PW:
    print("skip live checks: playwright-core not found (set AXF_PLAYWRIGHT)")
else:
    site = ThreadingHTTPServer(("127.0.0.1", 0), Site)
    threading.Thread(target=site.serve_forever, daemon=True).start()
    site_url = f"http://127.0.0.1:{site.server_address[1]}/"
    port = free_port()
    env = {**os.environ, "PORT": str(port), "AXF_BROWSER_DATA": str(TMP / "host"), "AXF_BROWSER_TOKEN": "file-token", "AXF_PLAYWRIGHT": PW, "AXF_BROWSER_ALLOW_PRIVATE": "1"}
    proc = subprocess.Popen(["node", str(HERE / "host" / "host.mjs")], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT)
    try:
        client.put(f"{P}/config", json={"hostUrl": f"http://127.0.0.1:{port}", "device": "desktop", "workspace": "plug"})
        for _ in range(100):
            if client.get(f"{P}/status").json().get("reachable"):
                break
            time.sleep(0.1)

        def t_status() -> None:
            s = client.get(f"{P}/status").json()
            assert s["reachable"] and s["health"]["service"] == "axf-browser-host", s
            assert client.get(f"{P}/health-check").json()["status"] == "ok"

        def t_autopen() -> None:
            r = client.post(f"{P}/navigate", json={"url": site_url})
            assert r.status_code == 200 and r.json()["title"] == "Plugin test", r.text

        def t_drive() -> None:
            assert client.post(f"{P}/fill", json={"selector": "#q", "value": "books"}).status_code == 200
            assert client.post(f"{P}/click", json={"selector": "#b"}).status_code == 200
            assert client.post(f"{P}/extract", json={"selector": "#o"}).json()["value"] == "got books"
            assert client.post(f"{P}/run", json={"cmd": "extract", "args": {"selector": "#o"}}).json()["value"] == "got books"

        def t_shots() -> None:
            j = client.post(f"{P}/screenshot", json={}).json()
            assert j["type"] == "png" and len(j["data"]) > 100
            r = client.get(f"{P}/screenshot.png")
            assert r.headers["content-type"] == "image/png" and r.content[1:4] == b"PNG"

        def t_tabs_device() -> None:
            tab = client.post(f"{P}/tab/new", json={"url": site_url}).json()["tab"]
            st = client.get(f"{P}/state").json()
            assert len(st["tabs"]) == 2 and st["active"] == tab, st
            client.post(f"{P}/tab/close", json={"tab": tab})
            assert len(client.get(f"{P}/state").json()["tabs"]) == 1
            assert client.post(f"{P}/device", json={"preset": "phone"}).json()["device"] == "phone"
            assert client.post(f"{P}/device", json={"preset": "nope"}).status_code == 400
            client.post(f"{P}/device", json={"preset": "desktop"})

        def t_live() -> None:
            client.post(f"{P}/navigate", json={"url": site_url})
            with client.websocket_connect(f"{P}/live?workspace=plug") as ws:
                seen: dict[str, int] = {}
                deadline = time.time() + 15
                while time.time() < deadline and not seen.get("frame"):
                    m = json.loads(ws.receive_text())
                    seen[m["t"]] = seen.get(m["t"], 0) + 1
                assert seen.get("hello") and seen.get("frame"), seen
                ws.send_text(json.dumps({"t": "mouse", "action": "click", "x": 100, "y": 330}))
                ws.send_text(json.dumps({"t": "cmd", "cmd": "extract", "args": {"selector": "#big"}, "id": "x"}))
                got = None
                deadline = time.time() + 15
                while time.time() < deadline and got is None:
                    m = json.loads(ws.receive_text())
                    if m.get("id") == "x":
                        got = m
                assert got and got["t"] == "result" and got["result"]["value"] == "hit", got

        def t_close() -> None:
            assert client.post(f"{P}/close", json={}).status_code == 200
            assert client.get(f"{P}/sessions").json()["sessions"] == []

        t("status + health item green with the host up", t_status)
        t("first command opens the workspace browser", t_autopen)
        t("fill, click, extract, run", t_drive)
        t("screenshot JSON + PNG", t_shots)
        t("tabs and device", t_tabs_device)
        t("live view relayed: frames out, input + results back", t_live)
        t("close", t_close)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        site.shutdown()

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{passed} passed, {failed} failed")
sys.exit(1 if failed else 0)
