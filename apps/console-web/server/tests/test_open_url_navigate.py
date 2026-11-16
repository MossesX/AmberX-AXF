"""open-url-route@1 console-tab on the console server: POST /api/console-control/navigate and its twins.

    python apps/console-web/server/tests/test_open_url_navigate.py      (pytest picks up the test_* functions too)

Against the real console-commands relay with a fake console tab on its stream:
  - a tab on screen that acks opened → route console-tab, 200
  - no tab → route none, fallThrough, 503 (the phone's routes go next)
  - a hidden tab (acks console-behind) / a tab marked not in front / a tab that never acks → falls through
  - a host other than amberxai.com, http, a port, user info → refused (400) before any tab is asked
  - GET /navigate/last, the voice phrase, the MCP tools and the CLI request say the same
  - open_url_route.allowed_url matches the reference engine (allowedUrl) on every case (needs node)
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(SERVER))
os.environ["AXF_CONSOLE_CONTROL_DATA_DIR"] = tempfile.mkdtemp(prefix="nav-test-")
os.environ["AXF_CONSOLE_COMMANDS_DATA_DIR"] = tempfile.mkdtemp(prefix="nav-cc-")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

_spec = importlib.util.spec_from_file_location("console_commands_plugin", ROOT / "apps/console-web/plugins/console-commands/server/__init__.py",
                                               submodule_search_locations=[str(ROOT / "apps/console-web/plugins/console-commands/server")])
relay = importlib.util.module_from_spec(_spec)
sys.modules["console_commands_plugin"] = relay
_spec.loader.exec_module(relay)  # provides console-commands@1

import console_control_api as api  # noqa: E402
import open_url_route as our  # noqa: E402

relay.NAVIGATE_ACK_S = 0.6
LOOP = asyncio.new_event_loop()
threading.Thread(target=LOOP.run_forever, daemon=True).start()
CHECKS = 0


def check(cond: bool, what: str) -> None:
    global CHECKS
    assert cond, what
    CHECKS += 1


def tab(cid: str = "cc-navtest", front: bool = True, answer: dict[str, Any] | None = None, used: float | None = None) -> threading.Thread | None:
    """A console tab with an open stream; `answer` = the ack's result (None = never answers)."""
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    with relay._lock:  # noqa: SLF001
        relay._clients[cid] = {"id": cid, "audience": "owner", "user": "brett", "lastUsed": used or time.time(), "lastSeen": time.time(),  # noqa: SLF001
                               "queue": q, "loop": LOOP, "pending": [], "front": front, "catalog": {"items": [{"id": "x"}]}}
    if answer is None:
        return None

    def ack() -> None:
        try:
            m = asyncio.run_coroutine_threadsafe(asyncio.wait_for(q.get(), 3), LOOP).result()
        except Exception:  # noqa: BLE001 — nothing was sent
            return
        with relay._lock:  # noqa: SLF001
            a = relay._acks.get(m["id"])  # noqa: SLF001
            if a is not None:
                a["results"][cid] = {"client": cid, "ok": bool(answer.get("opened")), "message": "", "result": answer, "sent": m}
                a["event"].set()
    t = threading.Thread(target=ack)
    t.start()
    return t


def reset() -> None:
    with relay._lock:  # noqa: SLF001
        relay._clients.clear()  # noqa: SLF001
        relay._acks.clear()  # noqa: SLF001
    api._rate.clear()  # noqa: SLF001


def client() -> TestClient:
    app = FastAPI()
    app.include_router(api.router_for(lambda: None))
    return TestClient(app)


def test_tab_present_opens_in_console_tab() -> None:
    reset()
    t = tab(answer={"opened": True, "mode": "in-place", "reason": ""})
    r = client().post("/api/console-control/navigate", json={"url": "https://console.amberxai.com/?axf-cmd=c-1"})
    t.join()
    b = r.json()
    check(r.status_code == 200 and b["ok"] and b["route"] == "console-tab" and b["opened"] is True and b["mode"] == "in-place", "tab on screen: console-tab, opened, in place")
    check(b["$axf"] == "open-url-result@1" and b["reason"] == "console-visible" and b["fallThrough"] is False and b["client"] == "cc-navtest", "result shape: open-url-result@1, no fall-through, the tab named")
    check(r.headers.get("X-AXF-Policy") == "allow" and b["policy"]["tag"] == "allow", "navigation: policy allow (never a veto)")


def test_focused_tab_is_picked() -> None:
    reset()
    tab("cc-older1", used=time.time() - 300)  # never answers: must not be asked
    t = tab("cc-newer1", answer={"opened": True, "mode": "new-tab"})
    b = api.open_url("https://plan.amberxai.com/x")
    t.join()
    check(b["client"] == "cc-newer1" and b["delivery"]["tried"] == ["cc-newer1"], "the tab used last is the one asked, and only it")


def test_no_tab_falls_through() -> None:
    reset()
    r = client().post("/api/console-control/navigate", json={"url": "https://console.amberxai.com/"})
    b = r.json()
    check(r.status_code == 503 and not b["ok"] and b["route"] == "none" and b["fallThrough"] is True, "no tab: route none, fall through, 503")
    check(b["tried"] == [{"route": "console-tab", "outcome": "skipped", "reason": "no-console"}], "no tab: console-tab skipped, no-console")


def test_hidden_or_silent_tab_falls_through() -> None:
    reset()
    t = tab(answer={"opened": False, "mode": "", "reason": "console-behind"})
    b = api.open_url("https://console.amberxai.com/")
    t.join()
    check(b["route"] == "none" and b["reason"] == "console-behind" and b["fallThrough"], "hidden tab: console-behind, falls through")
    reset()
    tab(front=False)
    b = api.open_url("https://console.amberxai.com/")
    check(b["reason"] == "console-behind" and b["delivery"]["tried"] == [], "tab not in front: not asked, console-behind")
    reset()
    tab()  # never acks
    b = api.open_url("https://console.amberxai.com/")
    check(b["reason"] == "console-stale" and b["fallThrough"] and b["delivery"]["tried"] == ["cc-navtest"], "silent tab: console-stale after the short wait")


def test_other_hosts_refused() -> None:
    reset()
    t = tab(answer={"opened": True})
    c = client()
    for bad in ("https://evil.com/", "http://console.amberxai.com/", "https://console.amberxai.com:8443/", "https://user@console.amberxai.com/", "https://amberxai.com.evil.com/", "", "javascript:alert(1)"):
        r = c.post("/api/console-control/navigate", json={"url": bad})
        b = r.json()
        check(r.status_code == 400 and b["reason"] == "url-refused" and b["fallThrough"] is False, f"refused: {bad!r}")
    with relay._lock:  # noqa: SLF001
        check(relay._clients["cc-navtest"]["queue"].empty(), "a refused url never reaches a tab")  # noqa: SLF001
    reset()
    if t:
        t.join()


def test_last_voice_mcp_cli() -> None:
    reset()
    t = tab(answer={"opened": True, "mode": "same-tab"})
    api.open_url("https://console.amberxai.com/a", by="test")
    t.join()
    api.open_url("https://evil.com/", by="test")
    last = client().get("/api/console-control/navigate/last").json()
    check(last["ok"] and last["items"][0]["reason"] == "url-refused" and last["items"][1]["route"] == "console-tab" and last["items"][1]["mode"] == "same-tab", "navigate/last: newest first, route + mode + reason")
    v = api.voice("open page evil.com")
    check(v["reason"] == "url-refused" and v["intent"]["verb"] == "navigate" and "isn't one of your pages" in v["say"], "voice: open page <address> → navigate, refusal spoken")
    check(api.open_url_phrase("open the page plan in a new tab") == {"url": "https://plan.amberxai.com/", "newTab": True}, "voice: a bare name is <name>.amberxai.com, new tab heard")
    import mcp_server
    check({"console_open_url", "console_open_url_last"} <= set(mcp_server.CONSOLE_CONTROL_TOOLS), "MCP: console_open_url and console_open_url_last listed")
    run = mcp_server.console_control_runner()
    reset()
    check(run({"verb": "navigate", "url": "https://console.amberxai.com/"})["fallThrough"] is True, "MCP runner: navigate, same answer as REST")
    check(run({"verb": "navigate.last"})["ok"], "MCP runner: navigate.last")
    if shutil.which("node"):
        out = subprocess.run(["node", "-e", "import('./framework/cli/console-control.mjs').then(m=>console.log(JSON.stringify([m.toRequest(['open-url','https://console.amberxai.com/','--new-tab']),m.toRequest(['open-url','last'])])))"],
                             cwd=ROOT, capture_output=True, text=True, check=True).stdout
        a, b = json.loads(out)
        check(a == {"method": "POST", "path": "/navigate", "body": {"url": "https://console.amberxai.com/", "newTab": True, "by": "cli"}} and b == {"method": "GET", "path": "/navigate/last"}, "CLI: axf console open-url maps to the same REST call")


URLS = ["https://console.amberxai.com/?axf-cmd=c-1", "https://amberxai.com", "https://A.AmberXAI.com/x#y", "https://evil.com/", "http://console.amberxai.com/",
        "https://console.amberxai.com:443/", "https://console.amberxai.com:8443/", "https://u:p@console.amberxai.com/", "https://amberxai.com.evil.com/",
        "https://amberxai.com./", "", "not a url", "ftp://amberxai.com/", "https://x." + "a" * 1990 + ".amberxai.com/"]


def test_python_twin_matches_engine() -> None:
    if not shutil.which("node"):
        return
    js = "import('./framework/core/open-url-route.mjs').then(R=>console.log(JSON.stringify(JSON.parse(process.argv[1]).map(u=>{const a=R.allowedUrl(u);return {ok:a.ok,url:a.url}}))))"
    want = json.loads(subprocess.run(["node", "-e", js, json.dumps(URLS)], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
    for u, w in zip(URLS, want):
        got = our.allowed_url(u)
        check(got["ok"] == w["ok"], f"allowed_url({u[:60]!r}) ok = engine's {w['ok']}")
        if w["ok"]:
            check(got["url"] == w["url"], f"allowed_url({u[:60]!r}) normalises like the engine: {w['url'][:80]}")


if __name__ == "__main__":
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
    print(f"✓ open-url navigate — {CHECKS} checks")
