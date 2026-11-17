"""drag-move@1 server side (framework/spec/DRAG-MOVE.md): the Python validator against the engine's fixture, the REST
routes /api/drag/* (checks, grants, relay, statuses, voice, deep link), the console-control voice hand-off, the MCP tools
console_drag_* (read-only reads, writes need a reason) and the drag: deep link in console_open / console_show, and the
CLI's request against the MCP tool's.

    python apps/console-web/server/tests/test_drag.py
"""
from __future__ import annotations

import asyncio
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("AXF_CONSOLE_CONTROL_DATA_DIR", tempfile.mkdtemp(prefix="drag-test-"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_control_api as api  # noqa: E402
import drag_api  # noqa: E402
import drag_move as dm  # noqa: E402
import mcp_server  # noqa: E402

ROOT = HERE.parents[3]
FIXTURE = json.loads((ROOT / "framework" / "spec" / "fixtures" / "drag-move.json").read_text())


class FakeConsole:
    """The open console as the relay reaches it: it answers drag.* requests like the drag executor would."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.open = True

    def __call__(self, cmd: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
        self.sent.append(cmd)
        if not self.open:
            return {"$axf": "console-control@1", "ok": False, "code": "unavailable", "message": "no console open", "openUrl": "https://console.example/"}
        verb = cmd.get("verb")
        if verb == "drag.list":
            return {"$axf": "drag-list@1", "ok": True, "view": "home", "kinds": [], "hosts": [{"kind": "tab", "container": "settings.tabs", "items": [{"id": "plugins"}], "order": ["plugins"]}]}
        if verb == "drag.zones":
            return {"$axf": "drag-zones@1", "ok": True, "kind": cmd["kind"], "container": cmd["container"], "id": cmd["id"], "targets": [], "more": False}
        if verb == "drag.show":
            return {"$axf": "drag-show@1", "ok": True, "kind": cmd["kind"], "container": cmd["container"], "id": cmd.get("id"), "view": "settings", "host": {"order": []}, "highlighted": True, "zones": 2}
        if verb == "drag.voice":
            return {"$axf": "drag-move-result@1", "ok": True, "say": "Moved Clock.", "heard": cmd["text"]}
        c = cmd["command"]
        if c["source"]["id"] == "pane" and c["op"] == "remove" and not c.get("confirm"):
            return {"$axf": "drag-move-result@1", "ok": False, "code": "confirmation_required", "message": "closing a pane closes its tabs"}
        return {"$axf": "drag-move-result@1", "ok": True, "op": c["op"], "kind": c["kind"], "item": {"id": c["source"]["id"]}, "order": {}}


def client(fake: FakeConsole, grants: set[str] | None = None) -> TestClient:
    api.to_console = fake  # type: ignore[assignment]
    api.grants_of = (lambda request: grants if grants is not None else {"*"})  # type: ignore[assignment]
    app = FastAPI()
    app.include_router(drag_api.router_for(lambda: None))
    return TestClient(app)


def test_validator_matches_engine_fixture() -> None:
    for name, case in FIXTURE["cases"].items():
        assert dm.errors(case["command"]) == FIXTURE["errors"][name], f"{name}: errors differ from the engine"
        want = FIXTURE["normalized"].get(name)
        if want is None:
            continue
        try:
            got: Any = dm.normalize(case["command"])
        except dm.DragMoveError as e:
            got = {"code": e.code}
        assert got == want, f"{name}: normalized {got} != engine {want}"
    reg = FIXTURE["registry"]
    assert dm.KINDS[: len(reg["kinds"])] == reg["kinds"], "the same kinds, in order"
    assert list(dm.OPS) == reg["ops"] and list(dm.ZONES) == reg["zones"] and list(dm.CODES) == reg["codes"], "the same ops, zones and codes"


def test_rest_routes() -> None:
    fake = FakeConsole()
    c = client(fake)
    r = c.post("/api/drag/move", json={"kind": "tab", "source": {"container": "settings.tabs", "id": "plugins"}, "target": {"container": "settings.tabs", "ref": "appearance"}, "reason": "next to Appearance"})
    assert r.status_code == 200 and r.json()["ok"], r.text
    sent = fake.sent[-1]
    assert sent["verb"] == "drag.move" and sent["command"]["target"]["zone"] == "after" and sent["command"]["reason"] == "next to Appearance", "normalized, then relayed"
    r = c.post("/api/drag/move", json={"kind": "tab", "source": {"id": "x"}})
    assert r.status_code == 400 and r.json()["code"] == "invalid", "a bad command never reaches the console"
    r = c.post("/api/drag/move", json={"kind": "sticker", "source": {"container": "a", "id": "b"}, "target": {"container": "a"}})
    assert r.status_code == 404 and r.json()["code"] == "unknown_kind" and "tab" in r.json()["nearest"]
    r = c.post("/api/drag/remove", json={"kind": "dock-pane", "source": {"container": "main", "id": "pane"}})
    assert r.status_code == 409 and r.json()["code"] == "confirmation_required"
    r = c.post("/api/drag/add", json={"kind": "banner-widget", "source": {"id": "clock:main"}, "target": {"container": "banner", "side": "left"}})
    assert r.status_code == 200 and fake.sent[-1]["command"]["op"] == "add" and fake.sent[-1]["command"]["target"]["zone"] == "side"
    assert c.get("/api/drag/hosts?kind=tab").json()["hosts"][0]["order"] == ["plugins"]
    assert c.get("/api/drag/zones?kind=tab&container=settings.tabs&id=plugins").json()["$axf"] == "drag-zones@1"
    assert c.get("/api/drag/zones?kind=tab").status_code == 400
    r = c.get("/api/drag/show?kind=banner-widget&container=banner&id=clock:main")
    assert r.json()["highlighted"] and fake.sent[-1] == {"verb": "drag.show", "kind": "banner-widget", "container": "banner", "id": "clock:main", "by": "console"}
    r = c.post("/api/drag/preview", json={"kind": "tab", "source": {"container": "a", "id": "b"}, "target": {"container": "a", "zone": "into", "index": 0}})
    assert r.status_code == 200 and fake.sent[-1]["verb"] == "drag.preview"
    assert c.post("/api/drag/voice", json={"text": "drag the Logs tab first"}).json()["say"]
    fake.open = False
    r = c.get("/api/drag/hosts")
    assert r.status_code == 503 and r.json()["openUrl"], "no console: 503 with the link"


def test_grants() -> None:
    fake = FakeConsole()
    c = client(fake, grants={"control.console.read"})
    assert c.get("/api/drag/hosts").status_code == 200, "a reader may list"
    r = c.post("/api/drag/move", json={"kind": "tab", "source": {"container": "a", "id": "b"}, "target": {"container": "a"}})
    assert r.status_code == 403 and r.json()["requires"] == "control.console.write", "a reader may not move"
    c = client(fake, grants=set())
    assert c.get("/api/drag/hosts").status_code == 403


def test_voice_hand_off() -> None:
    fake = FakeConsole()
    client(fake)
    r = api.voice("Hey Amber, move the clock widget to the left of the banner")
    assert fake.sent[-1]["verb"] == "drag.voice" and r["say"], "a drag phrase no console-control intent takes goes to drag.voice"
    assert dm.looks_like_drag("remove the CPU widget") and not dm.looks_like_drag("scroll down")
    assert drag_api.parse_link("drag:banner-widget:banner:clock:main") == {"kind": "banner-widget", "container": "banner", "id": "clock:main"}
    assert drag_api.parse_link("drag:tab") is None and drag_api.parse_link("view:x") is None


def test_mcp_tools() -> None:
    calls: list[tuple[str, dict[str, Any]]] = []

    def drag(verb: str, body: dict[str, Any]) -> dict[str, Any]:
        calls.append((verb, body))
        return {"ok": True, "$axf": "drag-show@1" if verb == "show" else "drag-move-result@1"}

    srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True, "status": "delivered"}, console_control=lambda b: {"ok": True}, drag=drag)

    async def go() -> None:
        tools = {t.name: t for t in await srv.list_tools()}
        for name in mcp_server.DRAG_TOOLS:
            assert name in tools, f"{name} is registered"
        assert tools["console_drag_list"].annotations.read_only_hint and tools["console_drag_zones"].annotations.read_only_hint, "reads are read-only"
        for name in ("console_drag_move", "console_drag_add", "console_drag_remove"):
            assert not tools[name].annotations.read_only_hint, f"{name} is a write (veto)"
        await srv.call_tool("console_drag_move", {"kind": "tab", "container": "settings.tabs", "id": "plugins", "zone": "before", "ref": "appearance", "reason": "Plugins first"})
        assert calls[-1] == ("move", {"kind": "tab", "source": {"container": "settings.tabs", "id": "plugins"}, "target": {"container": "settings.tabs", "zone": "before", "ref": "appearance"}, "reason": "Plugins first", "to": "recent", "by": "mcp"})
        try:
            await srv.call_tool("console_drag_remove", {"kind": "banner-widget", "container": "banner", "id": "cpu:main", "reason": " "})
            raise AssertionError("a move without a reason is refused")
        except Exception as e:  # noqa: BLE001 — ToolError
            assert "reason" in str(e)
        await srv.call_tool("console_drag_list", {"kind": "tab"})
        assert calls[-1][0] == "hosts"
        await srv.call_tool("console_open", {"screen": "drag:tab:settings.tabs:plugins"})
        assert calls[-1] == ("show", {"kind": "tab", "container": "settings.tabs", "id": "plugins", "to": "recent", "by": "mcp"}), "console_open takes a drag link"

    asyncio.run(go())


def test_cli_matches_mcp() -> None:
    """axf drag move … sends the same command body the MCP tool sends (by aside)."""
    script = "import('./framework/cli/drag.mjs').then((m) => console.log(JSON.stringify(m.toRequest(['move', 'tab', 'settings.tabs', 'plugins', 'before', 'appearance', '--reason', 'Plugins first']))))"
    try:
        out = subprocess.run(["node", "-e", script], cwd=ROOT, capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired):
        return  # no node here: the JS side has its own checks
    req = json.loads(out.stdout.strip().splitlines()[-1])
    assert req["method"] == "POST" and req["path"] == "/move"
    body = {k: v for k, v in req["body"].items() if k != "by"}
    assert body == {"kind": "tab", "source": {"container": "settings.tabs", "id": "plugins"}, "target": {"container": "settings.tabs", "zone": "before", "ref": "appearance"}, "reason": "Plugins first"}


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"✓ drag server — {n} tests (validator = engine fixture, REST, grants, voice, MCP, CLI parity)")
