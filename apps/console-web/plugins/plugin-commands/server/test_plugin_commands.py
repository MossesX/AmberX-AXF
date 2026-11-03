"""Plugin commands server part, on fixture plugins (fixtures/root): /api/control/<plugin>/<command> runs a plugin's
route in-process (reads, commands, deletes with a confirm token), the whole control@1 form, actions go to the open
console through console-commands@1, data reads redact secrets, and the MCP tools follow the plugins (added, called,
removed when a plugin is turned off, all gone when the switch is off).

    python apps/console-web/plugins/plugin-commands/server/test_plugin_commands.py
"""
from __future__ import annotations

import importlib.util
import json
import logging
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
FIX = HERE.parent / "fixtures" / "root"
REPO = HERE.parents[4]
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))  # plugin_services, console_context
os.environ["AXF_PLUGIN_COMMANDS_DATA_DIR"] = tempfile.mkdtemp()
os.environ["AXF_CONTROL_DATA_DIR"] = tempfile.mkdtemp()
os.environ["AXF_PLUGIN_COMMANDS_SYNC"] = "0"
os.environ["AXF_PLUGIN_COMMANDS_ROOT"] = str(FIX)
os.environ["AXF_PLUGIN_DATA_ROOT"] = str(FIX)
os.environ["AXF_CONSOLE_INTERNAL_URL"] = "http://127.0.0.1:9"  # nothing listens: routes run in-process

import anyio  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from mcp.server.mcpserver import MCPServer  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

logging.getLogger("httpx").setLevel(logging.WARNING)
checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


def load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    assert spec and spec.loader
    m = importlib.util.module_from_spec(spec)
    sys.modules[name] = m
    spec.loader.exec_module(m)
    return m


def provider(capability: str) -> Path:
    """The server part of the plugin that provides a capability (by its plugin.json, never by folder name)."""
    for pj in sorted((REPO / "apps" / "console-web" / "plugins").glob("*/plugin.json")):
        if f"service:{capability}" in (json.loads(pj.read_text()).get("provides") or []):
            return pj.parent / "server" / "__init__.py"
    raise SystemExit(f"no plugin provides {capability}")


PLUGINS = FIX / "apps" / "console-web" / "plugins"
plans = load("fixture_plans", PLUGINS / "fixture-plans" / "server" / "__init__.py")
todos = load("fixture_todos", PLUGINS / "fixture-todos" / "server" / "__init__.py")
ENABLED = {"fixture-plans": True, "fixture-todos": True, "fixture-quiet": True}

app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # type: ignore[no-untyped-def]
    u = request.headers.get("x-user", "")
    request.state.axf_user = types.SimpleNamespace(name="console", admin=True) if not u else types.SimpleNamespace(name=u, admin=False, perms=("control.plugins.read",), role="")
    return await call_next(request)


app.include_router(plans.router, prefix="/api/plugins/fixture-plans")
app.include_router(todos.router, prefix="/api/plugins/fixture-todos")
mcp = MCPServer(name="test")
cx.set_context(ROOT=REPO, PLUGINS={f: {} for f in ENABLED}, plugin_enabled=lambda f: ENABLED.get(f, True), asgi_app=app, mcp_server=mcp)


class FakeConsole:
    """console-commands@1 stand-in: records what it would send to the open console."""

    def __init__(self) -> None:
        self.sent: list[dict[str, Any]] = []

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = "") -> dict[str, Any]:
        self.sent.append(command)
        return {"$axf": "control@1", "ok": True, "op": "act", "target": "console.actions", "path": command["path"], "delivered": [{"client": "c1", "ok": True}]}

    def run_for(self, request: Request, command: dict[str, Any]) -> dict[str, Any]:
        return self.run(command)


console = FakeConsole()
plugin_services.provide("console-commands@1", console, folder="fake-console")
pc = load("plugin_commands_server", HERE / "__init__.py")
ctl = load("control_server", provider("control@1"))
app.include_router(ctl.router, prefix="/api/control")
app.include_router(pc.router, prefix="/api/plugins/plugin-commands")
client = TestClient(app)

# ---- registry
reg = pc.registry()
eq(sorted(p["folder"] for p in reg["plugins"] if p["app"] == "console-web"), ["fixture-plans", "fixture-quiet", "fixture-todos"], "the console's plugins")
ok(any(p["app"] == "amberx-droid" and p["folder"] == "fixture-notes" for p in reg["plugins"]), "and the other apps' plugins")
ok(pc.is_plugin("fixture-plans") and not pc.is_plugin("tokens.layout"), "plugin folders vs control targets")

# ---- REST reads
r = client.get("/api/control/fixture-plans/state")
eq(r.status_code, 200, "GET /api/control/<plugin>/<read>")
eq(r.json()["value"]["plans"][0]["id"], "p1", "the plugin route answered through control@1")
eq(r.json()["target"], "plugins.reads", "as a plugins.reads act read")
r = client.get("/api/control/fixture-plans/plans-by-pid", params={"pid": "p 9", "full": "true"})
eq(r.json()["value"], {"id": "p 9", "full": True}, "path and query parameters")
r = client.get("/api/control/fixture-plans/plans-by-pid")
eq(r.json()["code"], "validation", "a missing path parameter is named")
r = client.get("/api/control/fixture-plans")
eq(r.json()["value"]["name"], "Fixture plans", "GET /api/control/<plugin> = its info")
ok(any(c["id"] == "fixture-plans/state" for c in r.json()["value"]["commands"]), "info lists its commands")
r = client.get("/api/control/plugins.reads", params={"plugin": "fixture-plans"})
ok({"fixture-plans/state", "fixture-plans/search"} <= {i["id"] for i in r.json()["items"]}, "control@1 list plugins.reads (a POST declared readOnly is a read)")
r = client.post("/api/control", json={"op": "act", "target": "plugins.reads", "path": "fixture-plans/search", "action": "read", "input": {"q": "alp"}})
eq(r.json()["value"]["hits"], ["alpha"], "the whole control@1 command form, a declared read that POSTs")
r = client.get("/api/control/fixture-plans/events")
eq(r.json()["code"], "not_found", "a skipped route is not a read")

# ---- data reads
r = client.get("/api/control/fixture-plans/data")
files = {i["file"]: i for i in r.json()["items"]}
ok("plans/index.json" in files and files["salt"].get("private"), "data lists the files, marks private ones")
r = client.get("/api/control/fixture-plans/data-file", params={"file": "plans/index.json"})
v = r.json()["value"]["value"]
ok(v["apiKey"] == "[redacted]" and v["nested"]["refreshToken"] == "[redacted]" and v["nested"]["title"] == "kept", "secrets redacted, the rest kept")
eq(client.get("/api/control/fixture-plans/data-file", params={"file": "salt"}).json()["code"], "denied", "a secret file is never read")
eq(client.get("/api/control/fixture-plans/data-file", params={"file": "../../etc/passwd"}).json()["code"], "validation", "no way out of the data folder")

# ---- REST commands
r = client.post("/api/control/fixture-todos/entries-run", json={"listId": 3, "title": "Milk", "by": "test", "reason": "check"})
eq(r.status_code, 200, "POST /api/control/<plugin>/<command>")
eq(r.json()["result"]["entry"]["title"], "Milk", "the body reached the route")
eq(todos.CALLS[-1], ("POST", "/entries", {"listId": 3, "title": "Milk"}), "by / reason stay out of the body")
eq(r.json()["audit"]["by"], "test", "audited")
r = client.post("/api/control/fixture-todos/entries-run", json={"input": {"title": "No list"}})
eq(r.json()["code"], "validation", "a 400 from the plugin is a validation failure")
eq(client.get("/api/control/fixture-todos/entries", params={"q": "x", "limit": 5}).json()["value"]["limit"], 5, "query parameters typed")

# ---- deletes need a confirm token
r = client.delete("/api/control/fixture-todos/entries-by-eid-delete", params={"eid": 5})
eq(r.json()["code"], "confirmation_required", "the first delete asks for a confirm token")
tok = r.json()["confirm"]
ok(not any(c[0] == "DELETE" for c in todos.CALLS), "nothing deleted yet")
r = client.delete("/api/control/fixture-todos/entries-by-eid-delete", params={"eid": 5, "confirm": tok})
eq(r.json()["result"]["deleted"], 5, "the same delete with the token runs")
r = client.delete("/api/control/fixture-todos/entries-by-eid-delete", params={"eid": 6, "confirm": tok})
eq(r.json()["code"], "confirmation_required", "the token does not confirm another record")

# ---- grants
eq(pc.run({"op": "act", "target": "plugins.commands", "path": "fixture-todos/entries-run", "action": "run", "input": {"listId": 1}}, ["control.plugins.read"])["code"], "denied", "a reader can't run a command")
eq(pc.run({"op": "act", "target": "plugins.reads", "path": "fixture-plans/state", "action": "read"}, ["control.plugins.read"])["ok"], True, "a reader can read")
eq(pc.run({"op": "act", "target": "plugins.commands", "path": "fixture-todos/entries-by-eid-delete", "action": "run", "input": {"eid": 1}}, ["control.plugins.write"])["code"], "denied", "write doesn't cover a delete")

# ---- actions go to the open console
r = client.post("/api/control/fixture-plans/action-capture", json={})
eq(r.json()["ok"], True, "an action command runs")
eq(console.sent[-1]["path"], "fixture-plans.capture", "sent to the open console as console.actions run")
eq(r.json()["delivered"][0]["client"], "c1", "with the consoles' acks")
eq(client.post("/api/control/fixture-plans/action-clear", json={}).json()["code"], "confirmation_required", "a clearing action needs a confirm token")

# ---- unknowns, other apps
eq(client.get("/api/control/fixture-plans/nope").json()["code"], "not_found", "an unknown read")
eq(client.post("/api/control/not-a-plugin/x", json={}).json()["code"], "not_found", "an unknown plugin")
eq(pc.run({"op": "act", "target": "plugins.commands", "path": "amberx-droid:fixture-notes/action-notes-new", "action": "run"})["code"], "not_implemented", "another app's command is listed, run there")

# ---- MCP: tools follow the plugins
s = pc.sync_mcp(force=True)
ok(s["added"] >= 10, f"tools added ({s['added']})")
names = {t.name for t in anyio.run(mcp.list_tools)}
ok({"plugin_commands", "plugin_read", "plugin_run", "fixture_plans_state", "fixture_todos_entries_run"} <= names, "generic and per-plugin tools")
ok(not any(n.startswith("fixture_notes") for n in names), "other apps' commands get no console tools")
tools = {t.name: t for t in anyio.run(mcp.list_tools)}
ok(tools["fixture_plans_state"].annotations.read_only_hint and not tools["fixture_plans_state"].annotations.destructive_hint, "a read is read-only")
d = tools["fixture_todos_entries_by_eid_delete"]
ok(d.annotations.destructive_hint and "confirm" in d.input_schema["properties"], "a delete is destructive and takes confirm")
ok("eid" in d.input_schema["properties"]["input"]["properties"], "the input schema is the command's")
out = anyio.run(lambda: mcp.call_tool("fixture_plans_state", {}))
ok("p1" in json.dumps(out, default=str), "calling a plugin tool runs the route")
out = anyio.run(lambda: mcp.call_tool("plugin_read", {"path": "fixture-plans/state"}))
ok("p1" in json.dumps(out, default=str), "plugin_read")
out = anyio.run(lambda: mcp.call_tool("plugin_commands", {"plugin": "fixture-todos"}))
ok("fixture-todos/entries-run" in json.dumps(out, default=str), "plugin_commands lists them")
ENABLED["fixture-plans"] = False
pc.sync_mcp(force=True)
names = {t.name for t in anyio.run(mcp.list_tools)}
ok("fixture_plans_state" not in names and "fixture_todos_entries_run" in names, "turning a plugin off takes its tools away")
eq(client.get("/api/control/fixture-plans/state").json()["code"], "not_implemented", "and its commands answer that it is off")
ENABLED["fixture-plans"] = True
pc.sync_mcp(force=True)
ok("fixture_plans_state" in {t.name for t in anyio.run(mcp.list_tools)}, "turning it back on brings them back")
r = client.put("/api/plugins/plugin-commands/settings", json={"perPluginTools": False})
names = {t.name for t in anyio.run(mcp.list_tools)}
ok("fixture_plans_state" not in names and "plugin_run" in names, "per-plugin tools off: only the three generic ones")
client.put("/api/plugins/plugin-commands/settings", json={"perPluginTools": True})
ok("fixture_plans_state" in {t.name for t in anyio.run(mcp.list_tools)}, "and back on")

# ---- the plugin's own routes
r = client.get("/api/plugins/plugin-commands/tools")
ok(len(r.json()["tools"]) >= 10 and "fixture_plans_state" in r.json()["live"], "the docs page sees tools and the live ones")
r = client.post("/api/plugins/plugin-commands/try", json={"op": "act", "target": "plugins.reads", "path": "fixture-plans/state", "action": "read"})
eq(r.json()["value"]["ok"], True, "the docs page's runner")

print(f"✓ plugin commands server — {checks} checks")
