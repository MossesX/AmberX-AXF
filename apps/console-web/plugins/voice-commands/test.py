"""Voice commands server part: registry and help from the real rules (Node), match, the ask-then-run flow (missing
slot → question → answer; destructive → yes / no), running through plugin-commands@1 / control@1 /
console-commands@1 fakes, the MCP loopback shape, the audit, the capability.

    python apps/console-web/plugins/voice-commands/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services, console_context
DATA = tempfile.mkdtemp()
FIX = Path(tempfile.mkdtemp())
os.environ["AXF_VOICE_COMMANDS_DATA_DIR"] = DATA
os.environ["AXF_VOICE_COMMANDS_CACHE"] = "0"
os.environ["AXF_VOICE_COMMANDS_ROOT"] = str(FIX)
os.environ["AXF_CONSOLE_INTERNAL_URL"] = "http://127.0.0.1:9"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


# A fixture repo with one forFramework app (its voice asset authored here) and nothing else.
(FIX / "apps" / "shop").mkdir(parents=True)
(FIX / "apps" / "shop" / "project.manifest.json").write_text(json.dumps({"$manifest": "project-manifest@1", "name": "shop", "displayName": "Shop", "kind": "app", "framework": {"relation": "built-on", "forFramework": True}, "repo": {"owner": "x", "name": "shop", "exists": False}}))
asset = {"$axf": "asset@1", "type": "voice-command", "id": "shop", "name": "Shop voice commands", "version": "1", "data": {"app": "shop", "source": "generated", "wake": ["shop"], "commands": [
    {"id": "orders_add", "title": "Add an order", "effect": "write", "run": {"mcp": "orders_add", "api": "POST /api/control/orders/add", "cli": "axf orders add"}, "slots": {"item": {"type": "text", "required": True, "say": "the item"}, "amount": {"type": "money", "required": True, "say": "the amount"}}, "phrases": ["add an order {item} {amount}", "add an order"], "say": "Ordered {item} for {amount}."},
    {"id": "orders_list", "title": "List orders", "effect": "read", "run": {"mcp": "orders_list", "api": "GET /api/control/orders/list"}, "phrases": ["list orders"]},
    {"id": "orders_delete", "title": "Delete an order", "effect": "destructive", "run": {"api": "DELETE /api/control/orders/delete"}, "slots": {"id": {"type": "id", "required": True, "say": "the order id"}}, "phrases": ["delete order {id}"]},
    {"id": "control_set", "title": "Control: set", "effect": "write", "run": {"mcp": "control_set", "api": "POST /api/control/set"}, "slots": {"target": {"type": "choice", "required": True, "options": ["tokens.theme"], "say": "target"}, "path": {"type": "id", "required": True, "say": "path"}, "value": {"type": "text", "required": True, "say": "value"}}, "phrases": ["control set {target} {path} {value}"]},
    {"id": "nav.builds", "title": "Open builds", "effect": "navigate", "run": {"action": "nav:builds"}, "phrases": ["open builds"]},
    {"id": "pay_now", "title": "Pay now", "effect": "write", "run": {"mcp": "pay_now"}, "phrases": ["pay now"]},
    {"id": "only_cli", "title": "Only CLI", "effect": "write", "run": {"cli": "shop only"}, "phrases": ["only cli"]},
]}}
(FIX / "apps" / "shop" / "src" / "assets" / "voice-command").mkdir(parents=True)
(FIX / "apps" / "shop" / "src" / "assets" / "voice-command" / "shop.json").write_text(json.dumps(asset))
# the CLI reads apps/ under AXF_ROOT but imports the framework from its own location: copy nothing else


class FakePlugins:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def run(self, command: dict, grants=None, by: str = "") -> dict:
        self.calls.append(command)
        if command["path"] == "orders/delete" and not command.get("confirm"):
            return {"ok": False, "code": "confirmation_required", "confirm": "tok-1"}
        if command["path"] == "orders/list":
            return {"ok": True, "result": {"orders": [1, 2, 3]}}
        return {"ok": True, "result": {"id": "o-9", "path": command["path"], "input": command.get("input")}}


class FakeControl:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def run(self, command: dict, grants=None, by: str = "") -> dict:
        self.calls.append(command)
        return {"ok": True, "result": {"set": command.get("path"), "to": command.get("value")}}


class FakeConsole:
    def __init__(self) -> None:
        self.calls: list[dict] = []

    def run(self, command: dict, grants=None, by: str = "", audience: str = "owner") -> dict:
        self.calls.append(command)
        return {"ok": True, "result": {"ran": command.get("path")}}


fp, fc, fk = FakePlugins(), FakeControl(), FakeConsole()
plugin_services.provide("plugin-commands@1", fp, folder="plugin-commands")
plugin_services.provide("control@1", fc, folder="token-control")
plugin_services.provide("console-commands@1", fk, folder="console-commands")

spec = importlib.util.spec_from_file_location("voice_commands_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(mod)

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/voice-commands")
c = TestClient(app)
P = "/api/plugins/voice-commands"

try:
    r = c.get(f"{P}/registry").json()
    ok(r["$axf"] == "voice-registry@1" and [a["app"] for a in r["apps"]] == ["shop"], "registry lists the fixture app")

    h = c.get(f"{P}/help?app=shop").json()
    ok(h["ok"] and h["apps"][0]["header"].startswith("In Shop") and len(h["apps"][0]["commands"]) == 7, "help lines per app")

    m = c.post(f"{P}/match", json={"text": "add an order coffee 4.50"}).json()["match"]
    ok(m and m["command"]["id"] == "orders_add" and m["slots"] == {"item": "coffee", "amount": 4.5} and not m["confirm"], "match fills slots; nothing ran")
    ok(not fp.calls, "match never runs")

    # a write with every slot runs at once through plugin-commands@1
    r = c.post(f"{P}/run", json={"text": "shop add an order coffee 4.50", "by": "test"}).json()
    ok(r["ok"] and r["command"] == "orders_add" and r["via"] == "plugin-commands@1" and r["say"] == "Ordered coffee for 4.5.", f"write runs and answers: {r}")
    ok(fp.calls[-1]["target"] == "plugins.commands" and fp.calls[-1]["path"] == "orders/add" and fp.calls[-1]["input"] == {"item": "coffee", "amount": 4.5} and fp.calls[-1]["by"] == "test", "the plugin command got the slots as input")

    # a missing slot is asked for, the answer fills it
    r = c.post(f"{P}/run", json={"text": "add an order"}).json()
    ok(r["code"] == "confirmation_required" and r["pending"] and "item" in r["question"] and r["missing"] == ["item", "amount"], f"missing slots → question: {r}")
    r2 = c.post(f"{P}/run", json={"pending": r["pending"], "answer": "tea"}).json()
    ok(r2["code"] == "confirmation_required" and "amount" in r2["question"], "the next missing slot is asked next")
    r3 = c.post(f"{P}/run", json={"pending": r2["pending"], "answer": "3 dollars"}).json()
    ok(r3["ok"] and r3["slots"] == {"item": "tea", "amount": 3}, f"answers fill the slots and it runs: {r3}")
    r4 = c.post(f"{P}/run", json={"pending": r2["pending"], "answer": "x"}).json()
    ok(r4["code"] == "not_found", "a question is answered once")

    # a read runs at once
    r = c.post(f"{P}/run", json={"text": "list orders"}).json()
    ok(r["ok"] and r["via"] == "plugin-commands@1" and fp.calls[-1]["target"] == "plugins.reads" and r["say"] == "List orders: 3 orders", f"reads go through plugins.reads: {r}")

    # destructive asks; no cancels; yes runs (and passes the plugin runner's own confirm token)
    r = c.post(f"{P}/run", json={"text": "delete order o-1"}).json()
    ok(r["code"] == "confirmation_required" and "Yes or no" in r["question"], "destructive asks first")
    ok(c.post(f"{P}/run", json={"pending": r["pending"], "answer": "nah"}).json()["code"] == "cancelled", "an unclear answer does not run a delete")
    r = c.post(f"{P}/run", json={"text": "delete order o-1"}).json()
    ok(c.post(f"{P}/run", json={"pending": r["pending"], "answer": "no"}).json()["code"] == "cancelled", "no cancels")
    r = c.post(f"{P}/run", json={"text": "delete order o-1"}).json()
    n = len(fp.calls)
    r = c.post(f"{P}/run", json={"pending": r["pending"], "answer": "yes do it"}).json()
    ok(r["ok"] and len(fp.calls) == n + 2 and fp.calls[-1].get("confirm") == "tok-1", f"yes runs it, with the runner's confirm token on the second call: {r}")
    r = c.post(f"{P}/run", json={"text": "delete order o-2", "confirm": True}).json()
    ok(r["ok"], "confirm: true skips the question")

    # control@1 tools and console actions
    r = c.post(f"{P}/run", json={"text": "control set tokens.theme accent #fff"}).json()
    ok(r["ok"] and r["via"] == "control@1" and fc.calls[-1]["op"] == "set" and fc.calls[-1]["target"] == "tokens.theme" and fc.calls[-1]["path"] == "accent" and fc.calls[-1]["value"] == "#fff", f"control tools go to control@1: {r} {fc.calls}")
    r = c.post(f"{P}/run", json={"text": "open builds"}).json()
    ok(r["ok"] and r["via"] == "console-commands@1" and fk.calls[-1]["target"] == "console.actions" and fk.calls[-1]["path"] == "nav:builds", "actions run in the open console")

    # an MCP-only command goes to the console's own /mcp: nothing listens here, so it says so instead of hanging
    r = c.post(f"{P}/run", json={"text": "pay now"}).json()
    ok(not r["ok"] and r["via"] == "mcp" and "did not run" in r["say"], f"mcp loopback failure is reported: {r}")
    r = c.post(f"{P}/run", json={"text": "only cli"}).json()
    ok(not r["ok"] and r["code"] == "not_implemented" and "axf.commands.json" in r["message"], "a CLI-only command says how to make it runnable")

    r = c.post(f"{P}/run", json={"text": "make me a sandwich"}).json()
    ok(not r["ok"] and r["code"] == "not_found" and "what can I say" in r["message"], "nothing matched → not_found with the help hint")

    runs = c.get(f"{P}/recent").json()["runs"]
    ok(runs and runs[0]["text"] == "only cli" and any(x["text"] == "shop add an order coffee 4.50" and x["by"] == "test" for x in runs), "runs are audited, newest first")
    ok(mod.yes_or_no("Yeah, do it") is True and mod.yes_or_no("no thanks") is False and mod.yes_or_no("maybe") is None, "yes / no words")

    svc = plugin_services.get("voice-commands@1")
    ok(svc is not None and svc.say("list orders", by="banner")["ok"] and svc.help("shop")[0]["app"] == "shop", "the capability shares the flow")
finally:
    shutil.rmtree(DATA, ignore_errors=True)
    shutil.rmtree(FIX, ignore_errors=True)

print(f"voice-commands server: {checks} checks passed")
