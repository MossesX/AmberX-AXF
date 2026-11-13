"""console-control@1 parity harness, the Python half of apps/console-web/scripts/console-control-parity.mjs.

    python console_control_parity.py serve <port>   the real REST router (console_control_api) over HTTP, with a fake
                                                    open console behind the relay and /_fake/* to reset and inspect it
    python console_control_parity.py mcp <url>      reads [[tool, args], …] on stdin, calls each MCP tool through the
                                                    stdio runner (the REST API at <url>, as on a local clone), prints the
                                                    answers as a JSON array

The fake console is stateful and deterministic (no clocks): it keeps a screen, a scroll fraction and a focused address,
and searches with the static inventory search, so the four channels can be compared answer for answer.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.setdefault("AXF_CONSOLE_CONTROL_DATA_DIR", tempfile.mkdtemp(prefix="cc-parity-"))

from fastapi import FastAPI, Request  # noqa: E402  (module level: the route annotations resolve here)


class FakeConsole:
    """What the console-commands relay answers when one console is open (the browser executor's envelope and state)."""

    def __init__(self) -> None:
        self.reset()

    def reset(self) -> None:
        self.sent: list[dict[str, Any]] = []
        self.open = True
        self.screen = "home"
        self.fraction = 0.0
        self.focused: str | None = None

    def state(self) -> dict[str, Any]:
        row = self.focused if self.focused and any(p.startswith(("row:", "step:")) for p in self.focused.split("/")[-1:]) else None
        return {"screen": self.screen, "screenLabel": self.screen.replace("-", " ").title(), "tabs": {}, "focused": self.focused, "focusedRow": row,
                "scroll": {"container": "scroll:main", "fraction": self.fraction, "atTop": self.fraction == 0, "atBottom": self.fraction == 1}, "targets": 3}

    def control(self, cmd: dict[str, Any], by: str = "", audience: str = "owner", to: str = "recent") -> dict[str, Any]:
        import console_control as cc
        self.sent.append({k: v for k, v in cmd.items() if k not in ("by", "reason")})
        if not self.open:
            return {"$axf": cc.FRAME, "ok": False, "code": "unavailable", "because": "no console open", "message": "no console open", "openUrl": "https://console.example/"}
        verb = cmd["verb"]
        address = cmd.get("address")
        out: dict[str, Any] = {"$axf": cc.FRAME, "ok": True, "verb": verb, "client": "parity"}
        if address:
            out["address"] = address
        if verb in ("open", "focus") and address:
            first = address.split("/")[0]
            if first.startswith("view:"):
                self.screen = first[5:].split("=")[0]
            elif first.startswith("row:"):
                self.screen = "build-orchestrator"
            self.focused = address
            out["opened" if verb == "open" else "focused"] = address
        elif verb == "scroll":
            d = cmd["scroll"]["dir"]
            step = float(cmd["scroll"].get("amount", 1)) * 0.25
            self.fraction = {"top": 0.0, "bottom": 1.0}.get(d, min(1.0, max(0.0, self.fraction + (step if d in ("down", "page-down") else -step))))
            out["scroll"] = self.state()["scroll"]
        elif verb == "search":
            q = cmd["query"]
            out["hits"] = cc.search(q.get("q", ""), q.get("kinds"), q.get("limit"))
        elif verb == "list":
            out["targets"] = [{"address": "view:home", "kind": "view", "label": "Home"}]
            out["view"] = self.screen
        elif verb == "press":
            out["pressed"] = address
        elif verb == "set":
            out["value"] = cmd.get("value")
        elif verb == "state" and address:
            out["state"] = {**self.state(), "address": address, "kind": "setting", "value": None}
            return out
        out["state"] = self.state()
        return out


fake = FakeConsole()
enabled: dict[str, bool] = {}


class Ctx:
    """console_context's plugin table (enable / disable without the console server)."""

    @staticmethod
    def plugin_enabled(folder: str) -> bool:
        return enabled.get(folder, True)

    @staticmethod
    def set_plugin_enabled(folder: str, on: bool) -> None:
        enabled[folder] = on


def serve(port: int) -> None:
    import uvicorn

    import console_control as cc
    import console_control_api as api

    api._relay = lambda: fake  # type: ignore[assignment]
    cc._ctx = lambda: Ctx  # type: ignore[assignment]
    app = FastAPI()
    app.include_router(api.router_for(lambda: None))

    @app.post("/_fake/reset")
    async def reset(request: Request) -> dict[str, Any]:
        b = await request.json() if (await request.body()) else {}
        fake.reset()
        fake.open = bool(b.get("open", True))
        enabled.clear()
        api._rate.clear()
        return {"ok": True}

    @app.get("/_fake/sent")
    def sent() -> dict[str, Any]:
        return {"sent": fake.sent, "enabled": enabled}

    @app.get("/_fake/free-plugin")
    def free_plugin() -> dict[str, Any]:
        p = next(p for p in cc.inventory()["plugins"] if not p.get("core") and not any(d["required"] for d in cc.plugin_dependents(p, Ctx.plugin_enabled)))
        return {"folder": p["folder"], "label": p.get("label"), "address": p["address"]}

    uvicorn.run(app, host="127.0.0.1", port=port, log_level="warning")


def mcp(url: str) -> None:
    os.environ["AXF_CONSOLE_URL"] = url
    os.environ.pop("AXF_TOKEN", None)
    sys.modules["plugin_services"] = None  # type: ignore[assignment]  # a local clone: the runner goes through REST
    import mcp_server

    srv = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True}, console_control=mcp_server.console_control_runner())

    def call(name: str, args: dict[str, Any]) -> Any:
        try:
            res = asyncio.run(srv.call_tool(name, args))
        except Exception as e:  # a refusal the tool raises (a deciding press): MCP reports it as a tool error
            return {"toolError": str(e)}
        if isinstance(res, tuple):
            res = res[1]
        if isinstance(res, dict):
            return res.get("result", res)
        if getattr(res, "structured_content", None):
            sc = res.structured_content
            return sc.get("result", sc)
        return json.loads(res.content[0].text) if res.content else None

    calls = json.loads(sys.stdin.read())
    print(json.dumps([call(n, a) for n, a in calls]))


if __name__ == "__main__":
    if len(sys.argv) >= 3 and sys.argv[1] == "serve":
        serve(int(sys.argv[2]))
    elif len(sys.argv) >= 3 and sys.argv[1] == "mcp":
        mcp(sys.argv[2])
    else:
        print(__doc__)
        sys.exit(2)
