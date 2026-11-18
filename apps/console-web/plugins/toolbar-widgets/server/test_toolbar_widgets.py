"""Toolbar widgets server part: every REST route sends the console-control@1 command it should (state, list, press with
the op value, the destructive Detach button with confirm), bad input answers 400 before anything is sent, Detach without
confirm answers confirmation_required, and REST, MCP (plugin-commands route mapping) and the CLI give the same command.

    python apps/console-web/plugins/toolbar-widgets/server/test_toolbar_widgets.py
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402


class FakeConsoleControl(types.ModuleType):
    """console_control_api as the routes use it: the open console answers; a destructive press needs confirm."""

    def __init__(self) -> None:
        super().__init__("console_control_api")
        self.sent: list[dict[str, Any]] = []
        self.listed: list[tuple] = []

    def audience_of(self, request: Any) -> tuple[str, str]:
        return "owner", "console"

    def grants_of(self, request: Any) -> set[str]:
        return {"*"}

    def command(self, body: dict[str, Any], by: str = "", audience: str = "owner", grants: set[str] | None = None) -> dict[str, Any]:
        self.sent.append(body)
        if body["address"].endswith("/button:detach") and not body.get("confirm"):
            return {"$axf": "console-control@1", "ok": False, "code": "confirmation_required", "message": "Detach deletes something: send confirm"}
        if body["verb"] == "state":
            return {"$axf": "console-control@1", "ok": True, "address": body["address"], "value": {"$axf": "toolbar-widgets@1", "toolbar": "app", "rows": [], "slots": [], "style": {}}}
        return {"$axf": "console-control@1", "ok": True, "address": body["address"]}

    def targets(self, under: str = "", kinds: list[str] | None = None, source: str = "auto", by: str = "", audience: str = "owner", grants: set[str] | None = None) -> dict[str, Any]:
        self.listed.append((under, kinds, source))
        return {"ok": True, "targets": [{"address": "toolbar:app/widget:all", "kind": "widget"}]}

    def answer(self, r: dict[str, Any]) -> JSONResponse:
        return JSONResponse(r, status_code=200 if r.get("ok") else 409 if r.get("code") == "confirmation_required" else 400)


fake = FakeConsoleControl()
sys.modules["console_control_api"] = fake

spec = importlib.util.spec_from_file_location("toolbar_widgets_server", HERE / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(mod)

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/toolbar-widgets")
client = TestClient(app)

n = 0
fails = 0


def check(name: str, ok: bool, detail: Any = "") -> None:
    global n, fails
    n += 1
    if not ok:
        fails += 1
        print(f"✗ {name}" + (f"\n  {detail}" if detail != "" else ""))


def last() -> dict[str, Any]:
    return fake.sent[-1] if fake.sent else {}


# ---- reads
r = client.get("/api/plugins/toolbar-widgets/widgets", params={"toolbar": "app"})
check("GET widgets?toolbar=app answers the toolbar's state", r.status_code == 200 and r.json()["value"]["$axf"] == "toolbar-widgets@1", r.text)
check("… through state on toolbar:app/widget:all", last() == {"verb": "state", "address": "toolbar:app/widget:all"}, last())
r = client.get("/api/plugins/toolbar-widgets/widgets")
check("GET widgets lists every widget target", r.status_code == 200 and fake.listed[-1] == ("", ["widget"], "console"), fake.listed)

# ---- writes: each route → one press with the op value
cases = [
    ("attach", {"toolbar": "settings-toolbar", "widget": "status:cpu", "side": "start", "size": "icon", "shape": "squircle"}, {"verb": "press", "address": "toolbar:settings-toolbar/widget:status:cpu", "value": "attach:start:icon:squircle"}),
    ("attach", {"toolbar": "app", "widget": "clock:digital-12h"}, {"verb": "press", "address": "toolbar:app/widget:clock:digital-12h", "value": "attach:end"}),
    ("move", {"toolbar": "gate.auto-lander", "widget": "status:cpu", "side": "end", "index": 0}, {"verb": "press", "address": "toolbar:gate.auto-lander/widget:status:cpu", "value": "move:end:0"}),
    ("move", {"toolbar": "app", "widget": "status:cpu", "side": "start", "index": "prev"}, {"verb": "press", "address": "toolbar:app/widget:status:cpu", "value": "move:start:prev"}),
    ("style", {"toolbar": "app", "widget": "status:cpu", "field": "size", "value": "wide"}, {"verb": "press", "address": "toolbar:app/widget:status:cpu", "value": "style:size:wide"}),
    ("style", {"toolbar": "app", "widget": "status:cpu", "field": "hidden", "value": True}, {"verb": "press", "address": "toolbar:app/widget:status:cpu", "value": "style:hidden:true"}),
    ("style", {"toolbar": "app", "widget": "status:cpu", "field": "shape"}, {"verb": "press", "address": "toolbar:app/widget:status:cpu", "value": "style:shape:default"}),
    ("open", {"toolbar": "app"}, {"verb": "open", "address": "toolbar:app/widget:all"}),
    ("open", {"toolbar": "app", "widget": "status:cpu", "to": "all"}, {"verb": "open", "address": "toolbar:app/widget:status:cpu", "to": "all"}),
]
for op, body, want in cases:
    r = client.post(f"/api/plugins/toolbar-widgets/widgets/{op}", json=body)
    check(f"POST {op} {body} → {want}", r.status_code == 200 and last() == want, (r.status_code, last()))

# ---- detach is destructive: confirmation_required until confirm
r = client.post("/api/plugins/toolbar-widgets/widgets/detach", json={"toolbar": "app", "widget": "status:cpu"})
check("detach without confirm answers confirmation_required", r.status_code == 409 and r.json()["code"] == "confirmation_required", r.text)
check("… on the Detach button", last() == {"verb": "press", "address": "toolbar:app/widget:status:cpu/button:detach"}, last())
r = client.post("/api/plugins/toolbar-widgets/widgets/detach", json={"toolbar": "app", "widget": "status:cpu", "confirm": True, "reason": "tidy"})
check("detach with confirm runs", r.status_code == 200 and last() == {"verb": "press", "address": "toolbar:app/widget:status:cpu/button:detach", "confirm": True, "reason": "tidy"}, (r.text, last()))

# ---- bad input: 400, nothing sent
before = len(fake.sent)
for op, body in [("attach", {"toolbar": "app", "widget": "cpu"}), ("attach", {"toolbar": "app", "widget": "status:cpu", "side": "middle"}), ("attach", {"toolbar": "Bad Toolbar!", "widget": "status:cpu"}),
                 ("move", {"toolbar": "app", "widget": "status:cpu"}), ("move", {"toolbar": "app", "widget": "status:cpu", "side": "end", "index": "far"}),
                 ("style", {"toolbar": "app", "widget": "status:cpu", "field": "colour"}), ("attach", {"toolbar": "app", "widget": "status:cpu", "size": "huge"})]:
    r = client.post(f"/api/plugins/toolbar-widgets/widgets/{op}", json=body)
    check(f"{op} {body} is refused", r.status_code == 400 and r.json()["code"] == "invalid", r.text)
check("nothing reached the console for bad input", len(fake.sent) == before, fake.sent[before:])

# ---- parity: REST (plan) = MCP (plugin-commands route mapping → the same route body) = CLI (toolbar-widgets.mjs)
parity_cases = [
    ("attach", {"toolbar": "settings-toolbar", "widget": "status:cpu", "side": "start", "size": "icon"}, ["attach", "settings-toolbar", "status:cpu", "--side", "start", "--size", "icon"]),
    ("detach", {"toolbar": "app", "widget": "clock:digital-12h", "confirm": True}, ["detach", "app", "clock:digital-12h", "--confirm"]),
    ("move", {"toolbar": "app", "widget": "status:cpu", "side": "end", "index": "next"}, ["move", "app", "status:cpu", "end", "next"]),
    ("style", {"toolbar": "app", "widget": "status:cpu", "field": "shape", "value": "pill"}, ["style", "app", "status:cpu", "shape", "pill"]),
    ("open", {"toolbar": "app"}, ["open", "app"]),
    ("list", {"toolbar": "app"}, ["list", "app"]),
]
js = r"""
import { toRequest } from '%(cli)s';
import { pluginRouteRequest, resolvePluginCommand } from '%(pc)s';
import { registry } from '%(reg)s';
const cases = JSON.parse(process.argv[1]);
const reg = registry();
const plugin = reg.plugins.find((p) => p.folder === 'toolbar-widgets');
const out = cases.map(([op, input, argv]) => {
  const cmdId = op === 'list' ? 'widgets' : op;
  const cmd = plugin.commands.find((c) => c.id === cmdId);
  const route = pluginRouteRequest('toolbar-widgets', cmd, input);
  const cli = toRequest(argv);
  return { route, cli };
});
console.log(JSON.stringify(out));
""" % {"cli": (ROOT / "framework/cli/toolbar-widgets.mjs").as_uri(), "pc": (ROOT / "framework/core/engines/plugin-commands.mjs").as_uri(), "reg": (ROOT / "framework/cli/plugin-commands.mjs").as_uri()}
p = subprocess.run(["node", "--input-type=module", "-e", js, json.dumps(parity_cases)], capture_output=True, text=True, cwd=ROOT, timeout=120)
check("the parity runner ran", p.returncode == 0, p.stderr[-800:])
if p.returncode == 0:
    for (op, inp, argv), got in zip(parity_cases, json.loads(p.stdout)):
        route = got["route"]
        # MCP: the tool's input becomes the route request; it is the REST call
        body = route["body"] if route["body"] is not None else {k: v for k, v in route["query"].items()}
        rest_cmd = mod.plan("list" if op == "list" else op, body)
        cli = got["cli"]
        cli_cmd = cli.get("body") or ({"verb": "state", "address": __import__("urllib.parse").parse.unquote(cli["path"].split("address=")[1])} if "address=" in cli["path"] else {"verb": "list", "kinds": ["widget"]})
        cli_cmd = {k: v for k, v in cli_cmd.items() if k != "by"}
        check(f"{op}: MCP route {route['method']} {route['path']}", route["path"] == ("/api/plugins/toolbar-widgets/widgets" if op == "list" else f"/api/plugins/toolbar-widgets/widgets/{op}"), route)
        check(f"{op}: REST = MCP = CLI", rest_cmd == cli_cmd, {"rest": rest_cmd, "cli": cli_cmd})

print(f"{'✓' if not fails else '✗'} toolbar-widgets server: {n - fails}/{n} checks passed")
sys.exit(1 if fails else 0)
