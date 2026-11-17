"""Settings interfaces + reset routes (settings_api.py; plugin-settings@1, settings-reset@1), against a fake open console.

    python apps/console-web/server/tests/test_settings_api.py      (pytest picks up the test_* functions too)

Covers GET /api/settings/interfaces/<owner> (live from the console, and from the plugin's own asset file when no console
is open), POST /api/settings/reset (dryRun answers the plan and a confirm token; without a token 428; with the token the
reset runs; bad requests 400; unknown plugins 404) and the MCP tools settings_interface_get / settings_reset.
"""
from __future__ import annotations

import asyncio
import json
import sys
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import settings_api as sa  # noqa: E402

PLAN = {"contract": "settings-reset@1", "scope": {"kind": "plugin", "id": "x"}, "includeAssets": False, "summary": "2 settings · 1 asset kept",
        "settings": [{"key": "gate.mode", "current": "strict", "default": "normal"}, {"key": "gate.note", "current": "x", "default": None}],
        "assets": [{"kind": "plugin-look", "type": "axf.plugin.x.look", "label": "X look", "current": "overridden", "default": "theme", "scope": "plugin:x"}],
        "apply": {"clear": ["gate.mode", "gate.note"], "look": None, "scopes": []}, "empty": False, "tableRows": 8}


class FakeCommands:
    """console-commands@1: what the open console answers to settings.interface / settings.reset.plan / settings.reset."""

    def __init__(self) -> None:
        self.runs: list[dict[str, Any]] = []
        self.open = True

    def run(self, cmd: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = "owner") -> dict[str, Any]:
        self.runs.append(cmd)
        if not self.open:
            return {"ok": False, "code": "unavailable", "message": "no console open"}
        action, args = cmd["path"], cmd["input"]["args"]
        if action == "settings.reset" and not cmd.get("confirm"):
            return {"ok": False, "code": "confirmation_required", "confirm": "console-token", "message": "destructive"}
        if action == "settings.interface":
            res = {"$axf": "settings-interface@1", "owner": args[0], "id": "plugin-x", "source": "asset", "interface": {"scope": "plugin"}, "values": {"gate.mode": "strict"}, "changedAssets": PLAN["assets"]}
        elif action == "settings.reset.plan":
            res = {**PLAN, "includeAssets": args[1] == "assets"}
        else:
            res = None
        return {"ok": True, "delivered": [{"client": "c1", "ok": True, "message": f"ran {action}", **({"result": res} if res else {})}]}


fake = FakeCommands()
sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: fake if name == "console-commands@1" else None)  # type: ignore[assignment]

app = FastAPI()
app.include_router(sa.router_for(lambda: None))
client = TestClient(app)
U = "/api/settings"

# a real plugin from the repo, picked by shape (one with its own interface file), never by name
PLUGIN_DIR, PLUGIN = next((d, m) for d, m in sa.plugin_manifests() if m.get("settingsInterface") and (d / "assets" / "settings" / f"{m['settingsInterface'].split('/')[-1]}.json").exists())
PID = PLUGIN["id"]


def reset() -> None:
    fake.runs.clear()
    fake.open = True


def test_interface_live_and_offline() -> None:
    reset()
    r = client.get(f"{U}/interfaces/{PLUGIN_DIR.name}")
    j = r.json()
    assert r.status_code == 200 and j["live"] is True and j["owner"] == f"plugin:{PID}" and j["values"] == {"gate.mode": "strict"}, j
    assert fake.runs[-1]["path"] == "settings.interface" and fake.runs[-1]["input"]["args"] == [f"plugin:{PID}"], "folder resolves to the plugin id"
    fake.open = False
    j = client.get(f"{U}/interfaces/{PID}").json()
    assert j["live"] is False and j["source"] == "asset" and j["interface"]["scope"] == "plugin" and j["interface"]["owner"] == PID and j["opens"] == f"settings:plugin/{PID}", j
    j = client.get(f"{U}/interfaces/console").json()
    assert j["owner"] == "app" and j["opens"] == "view:settings"
    assert client.get(f"{U}/interfaces/nope-nope-nope").status_code == 404


def test_reset_dry_run_confirm_and_run() -> None:
    reset()
    r = client.post(f"{U}/reset", json={"scope": PID, "dryRun": True})
    j = r.json()
    assert r.status_code == 200 and j["dryRun"] is True and j["plan"]["settings"][0]["key"] == "gate.mode" and j["plan"]["assets"], j
    assert j["includeAssets"] is False and j["confirm"] and not any(c["path"] == "settings.reset" for c in fake.runs), "a dry run never resets"
    token = j["confirm"]
    # without a token: 428 with the plan and the token, nothing reset
    r = client.post(f"{U}/reset", json={"scope": PID})
    assert r.status_code == 428 and r.json()["code"] == "confirmation_required" and r.json()["plan"], r.json()
    assert not any(c["path"] == "settings.reset" and c.get("confirm") for c in fake.runs)
    # a token for another switch position does not count
    r = client.post(f"{U}/reset", json={"scope": PID, "includeAssets": True, "confirm": token})
    assert r.status_code == 428
    # the token: the reset runs once, with the console's own confirm
    r = client.post(f"{U}/reset", json={"scope": PID, "confirm": token})
    j = r.json()
    assert r.status_code == 200 and j["ok"] is True and j["undo"] == "settings.reset.undo", j
    ran = [c for c in fake.runs if c["path"] == "settings.reset" and c.get("confirm")]
    assert len(ran) == 1 and ran[0]["input"]["args"] == [f"plugin:{PID}", ""], ran
    # include assets travels as the second argument
    j = client.post(f"{U}/reset", json={"scope": PID, "includeAssets": True, "dryRun": True}).json()
    assert j["includeAssets"] is True and j["plan"]["includeAssets"] is True


def test_reset_errors() -> None:
    reset()
    assert client.post(f"{U}/reset", json={"scope": "bad scope!"}).status_code == 400
    assert client.post(f"{U}/reset", json={"scope": "console", "includeAssets": "yes"}).status_code == 400
    assert client.post(f"{U}/reset", json={"scope": "nope-nope-nope", "dryRun": True}).status_code == 404
    fake.open = False
    r = client.post(f"{U}/reset", json={"scope": "console", "dryRun": True})
    assert r.status_code == 503 and "no open console" in r.json()["message"]
    assert sa.confirm_valid("123.bad", "console", False) is False and sa.confirm_valid(None, "console", False) is False


def test_mcp_tools() -> None:
    reset()
    import mcp_server  # noqa: PLC0415
    srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True}, console_control=lambda body: {"ok": True})
    tools = {t.name: t for t in asyncio.run(srv.list_tools())}
    for name in mcp_server.SETTINGS_TOOLS:
        assert name in tools, name
    assert tools["settings_interface_get"].annotations.read_only_hint is True
    assert tools["settings_reset"].annotations.destructive_hint is True

    def data(res: Any) -> dict[str, Any]:
        if isinstance(res, tuple):
            res = res[1]
        if isinstance(res, dict):
            return res.get("result", res)
        sc = getattr(res, "structured_content", None)
        return sc.get("result", sc) if sc else json.loads(res.content[0].text)

    got = data(asyncio.run(srv.call_tool("settings_interface_get", {"owner": PID})))
    assert got["owner"] == f"plugin:{PID}" and got["live"] is True, got
    plan = data(asyncio.run(srv.call_tool("settings_reset", {"scope": PID})))
    assert plan["dryRun"] is True and plan["confirm"] and not any(c["path"] == "settings.reset" for c in fake.runs), "the tool dry-runs by default"


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"✓ settings API server — {n} tests (interface live/offline, reset dry run / confirm / run, errors, MCP)")
