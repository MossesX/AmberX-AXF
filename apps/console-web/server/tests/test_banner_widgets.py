"""Banner widget shape and icon (widget-shape@1, build banner-widget-shapes-plus-change-icon): REST, MCP and CLI parity.

    python apps/console-web/server/tests/test_banner_widgets.py      (pytest picks up the test_* functions too)

Each surface (REST /api/console-control/banner-widgets, the MCP tool console_control_banner_widget, `axf banner widget`
through framework/cli/banner-widget.mjs) must reach the open console with the same console-control command on the same
derived address (setting:banner.widget.<widget>.shape|icon|path, function:banner.widget.<widget>.reset), so shape, icon
and reset mean one thing everywhere. Also: list / get grouping, bad input refused before the console, voice phrases.
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
os.environ.setdefault("AXF_CONSOLE_CONTROL_DATA_DIR", tempfile.mkdtemp(prefix="bw-test-"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_control as cc  # noqa: E402
import console_control_api as api  # noqa: E402
import mcp_server  # noqa: E402

ROOT = HERE.parents[3]
W = "clock:digital-12h"
U = "/api/console-control"


class FakeConsole:
    """An open console whose registry holds two banner widgets' derived targets."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.values = {f"setting:banner.widget.{W}.shape": "circle", f"setting:banner.widget.{W}.icon": "own", f"setting:banner.widget.{W}.path": "",
                       "setting:banner.widget.status:usage.shape": "hexagon", "setting:banner.widget.status:usage.icon": "amberx-outline/bell"}

    def control(self, cmd: dict[str, Any], by: str = "", audience: str = "owner", to: str = "recent") -> dict[str, Any]:
        self.sent.append(dict(cmd))
        out: dict[str, Any] = {"$axf": cc.FRAME, "ok": True, "verb": cmd["verb"], "client": "bw-test", "state": {"screen": "home"}}
        if cmd.get("address"):
            out["address"] = cmd["address"]
        if cmd["verb"] == "list":
            labels = {W: "Clock", "status:usage": "Usage"}
            out["targets"] = [{"address": a, "kind": "setting", "label": f"{labels[a.split('.', 2)[2].rsplit('.', 1)[0]]} · {a.rsplit('.', 1)[1]}", "value": v} for a, v in self.values.items()]
            out["targets"].append({"address": "view:home", "kind": "view", "label": "Home"})
        if cmd["verb"] == "set":
            self.values[cmd["address"]] = cmd["value"]
        return out


fake = FakeConsole()
app = FastAPI()
app.include_router(api.router_for(lambda: None))
client = TestClient(app)


class _Relay:
    """Swap the console relay in for one test and put the previous one back (other test modules own theirs)."""

    def __enter__(self) -> FakeConsole:
        self.prev = api._relay
        api._relay = lambda: fake  # type: ignore[assignment]
        fake.sent.clear()
        api._rate.clear()
        return fake

    def __exit__(self, *_: Any) -> None:
        api._relay = self.prev  # type: ignore[assignment]


def _core(cmd: dict[str, Any]) -> dict[str, Any]:
    """What reached the console, without who / why / where."""
    return {k: v for k, v in cmd.items() if k in ("verb", "address", "value")}


def _cli(*argv: str) -> dict[str, Any]:
    """The REST request `axf banner widget <argv>` sends (framework/cli/banner-widget.mjs toRequest)."""
    js = f"import('{(ROOT / 'framework/cli/banner-widget.mjs').as_posix()}').then(m => console.log(JSON.stringify(m.toRequest({json.dumps(list(argv))}))))"
    return json.loads(subprocess.run(["node", "-e", js], check=True, capture_output=True, text=True).stdout)


def _rest(req: dict[str, Any]) -> Any:
    return client.get(U + req["path"]) if req["method"] == "GET" else client.post(U + req["path"], json=req.get("body") or {})


def _mcp(args: dict[str, Any]) -> dict[str, Any]:
    def run(body: dict[str, Any]) -> dict[str, Any]:
        if body.get("verb") == "banner-widgets":
            if not body.get("what"):
                return api.banner_widgets("mcp", widget=str(body.get("widget") or ""))
            return api.banner_widget_command(str(body.get("widget") or ""), str(body["what"]), body.get("value"), "mcp", confirm=bool(body.get("confirm")))
        return api.command(body, "mcp")
    srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True}, console_control=run)
    res = asyncio.run(srv.call_tool("console_control_banner_widget", args))
    if isinstance(res, tuple):
        res = res[1]
    if isinstance(res, dict):
        return res.get("result", res)
    assert not getattr(res, "is_error", False), res.content[0].text if res.content else ""
    sc = getattr(res, "structured_content", None)
    return sc.get("result", sc) if sc else json.loads(res.content[0].text)


def test_list_and_get() -> None:
    with _Relay():
        r = client.get(f"{U}/banner-widgets").json()
        assert r["ok"] and [w["widget"] for w in r["widgets"]] == [W, "status:usage"]
        clock = r["widgets"][0]
        assert clock["shape"] == "circle" and clock["icon"] == "own" and clock["label"] == "Clock"
        assert clock["addresses"]["reset"] == f"function:banner.widget.{W}.reset" and r["open"] == cc.BANNERS_SETTINGS_ADDRESS
        assert client.get(f"{U}/banner-widgets/status").json()["widgets"][0]["shape"] == "hexagon", "a widget by its type"
        assert client.get(f"{U}/banner-widgets/nope").status_code == 404
        m = _mcp({})
        assert [w["widget"] for w in m["widgets"]] == [W, "status:usage"], "MCP lists the same widgets"


def test_parity_shape_icon_path_reset_open() -> None:
    cases = [
        (("shape", W, "hexagon"), {"widget": W, "shape": "hexagon"}),
        (("shape", W, "--path", "M50 0 L100 50 L50 100 L0 50 Z"), {"widget": W, "path": "M50 0 L100 50 L50 100 L0 50 Z"}),
        (("icon", W, "amberx-outline/bell"), {"widget": W, "icon": "amberx-outline/bell"}),
        (("icon", W, "own"), {"widget": W, "icon": "own"}),
        (("reset", W, "--confirm"), {"widget": W, "reset": True, "confirm": True}),
        (("open", W, "icon"), {"widget": W, "open": "icon"}),
        (("open", W, "shape"), {"widget": W, "open": "shape"}),
    ]
    with _Relay():
        for argv, mcp_args in cases:
            fake.sent.clear()
            r = _rest(_cli(*argv))
            assert r.status_code == 200, (argv, r.json())
            via_cli_rest = _core(fake.sent[-1])
            fake.sent.clear()
            _mcp(mcp_args)
            via_mcp = _core(fake.sent[-1])
            assert via_cli_rest == via_mcp, (argv, via_cli_rest, via_mcp)
        # what each one is, spelled out once
        assert _core(fake.sent[-1]) == {"verb": "press", "address": f"function:banner.widget.{W}.custom-shape"}
    with _Relay():
        client.post(f"{U}/banner-widgets/{W}/shape", json={"shape": "pill"})
        assert _core(fake.sent[-1]) == {"verb": "set", "address": f"setting:banner.widget.{W}.shape", "value": "pill"}
        fake.sent.clear()
        r = client.post(f"{U}/banner-widgets/{W}/reset", json={})
        assert r.status_code == 409 and r.json()["code"] == "confirmation_required" and not fake.sent, "reset asks for confirm first"
        assert _mcp({"widget": W, "reset": True})["code"] == "confirmation_required", "MCP: the same confirm rule"
        assert _cli("reset", W)["body"].get("confirm") is None and _cli("reset", W, "--confirm")["body"]["confirm"] is True, "CLI: --confirm"
        client.post(f"{U}/banner-widgets/{W}/reset", json={"confirm": True})
        assert _core(fake.sent[-1]) == {"verb": "press", "address": f"function:banner.widget.{W}.reset"}
        client.post(f"{U}/banner-widgets/clock/icon", json={"icon": "amberx-outline/star"})
        assert _core(fake.sent[-1]) == {"verb": "set", "address": f"setting:banner.widget.{W}.icon", "value": "amberx-outline/star"}, "a bare type resolves to its key"


def test_bad_input_never_reaches_the_console() -> None:
    with _Relay():
        for path, body in ((f"{W}/shape", {"shape": "blob"}), (f"{W}/shape", {"shape": "custom"}), (f"{W}/icon", {"icon": "Not A Ref"}), (f"{W}/path", {"path": "x" * 401}), (f"{W}/spin", {})):
            fake.sent.clear()
            r = client.post(f"{U}/banner-widgets/{path}", json=body)
            assert r.status_code == 400 and r.json()["code"] == "invalid", (path, r.json())
            assert not [c for c in fake.sent if c["verb"] != "list"], f"{path}: refused before the console"


def test_voice_phrases() -> None:
    assert cc.voice_intent("make the clock a hexagon") == {"verb": "set", "find": {"q": "clock shape", "kinds": ["setting"]}, "value": "hexagon"}
    assert cc.voice_intent("change the clock's icon") == {"verb": "press", "find": {"q": "clock change icon", "kinds": ["function"]}}
    assert cc.voice_intent("reset the clock widget") == {"verb": "press", "find": {"q": "clock back to default", "kinds": ["function"]}}
    assert cc.voice_intent("turn help mode on")["value"] is True, "the general set rule still answers"


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"✓ banner widgets — {n} tests (REST, MCP, CLI parity, refusals, voice)")
