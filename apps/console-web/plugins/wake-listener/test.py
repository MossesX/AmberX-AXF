#!/usr/bin/env python3
"""Self-test for the wake listener's Claude mode (server part): the catalog → tools converter, the understand route
with a fake axf.llm@1 (picks a command, asks for a missing field, confirm gate, timeout and errors fall back to offline,
the switch off sends nothing), the approvals guard, the state and history reads.

    python3 apps/console-web/plugins/wake-listener/test.py
The Node side (core, catalog, store, CLI) is test.mjs.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_WAKE_LISTENER_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-wl-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
sys.path.insert(0, str(HERE / "server"))

import claude_tools as ct  # noqa: E402

ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("wake-listener Claude mode self-test")

# ---------------------------------------------------------------- the converter (s3)

ENTRIES = [
    {"id": "approvals.review", "title": "Review what needs approval", "group": "approvals", "say": ["approve"], "fields": [], "run": {"kind": "builtin", "what": "approvals.review"}, "effect": "write", "source": "builtin"},
    {"id": "approvals.all", "title": "Approve everything pending", "group": "approvals", "confirm": True, "say": ["approve all"], "fields": [], "run": {"kind": "builtin"}, "effect": "write", "source": "builtin"},
    {"id": "listener.help", "title": "What can I say", "group": "listener", "say": ["what can i say"], "fields": [], "run": {"kind": "builtin", "what": "help"}, "effect": "read", "source": "builtin"},
    {"id": "project-wizard/run", "title": "Create a new project", "group": "projects", "confirm": True, "say": ["create a new project named {name}"],
     "fields": [{"name": "name", "ask": "What is the project called?"}, {"name": "kind", "ask": "What kind?", "enum": ["app", "library", "plugin", "site"], "optional": True}],
     "run": {"kind": "plugin-route", "folder": "project-wizard", "method": "POST", "path": "/run"}, "effect": "write", "source": "phrasebook"},
    {"id": "control:pass.scopes", "title": "Veto pass", "group": "approvals", "confirm": True, "say": ["set the veto timer to {duration}"], "fields": [{"name": "duration", "ask": "For how long?", "type": "duration"}], "run": {"kind": "control", "command": {"op": "act", "target": "pass.scopes", "action": "grant"}}, "effect": "write", "source": "phrasebook"},
    {"id": "build-orchestrator/pipeline-build-action", "title": "Hold, release, archive, delete or restore a build", "group": "pipelines", "confirm": True, "say": ["stop build {id}"],
     "fields": [{"name": "id", "ask": "Which build?"}, {"name": "action", "ask": "Do what?", "enum": ["hold", "release", "delete"]}], "run": {"kind": "plugin-route"}, "effect": "write", "source": "phrasebook"},
    {"id": "notes/remove", "title": "Remove a note", "group": "plugins", "say": ["remove a note {id}"], "fields": [{"name": "id", "ask": "id?"}], "run": {"kind": "plugin-route"}, "effect": "destructive", "source": "registry"},
    {"id": "hub/approve", "title": "Approve a call", "group": "plugins", "say": ["approve a call"], "fields": [{"name": "id", "ask": "id?"}], "run": {"kind": "plugin-route"}, "effect": "write", "source": "registry"},
    {"id": "action:approvals.deny", "title": "Deny", "group": "plugins", "say": ["deny"], "fields": [], "run": {"kind": "console-action", "action": "approvals.deny"}, "effect": "write", "source": "actions"},
    {"id": "weather/today", "title": "Today's weather", "group": "plugins", "say": ["todays weather"], "fields": [{"name": "city", "ask": "city?", "type": "string", "optional": True}, {"name": "days", "ask": "days?", "type": "number"}], "run": {"kind": "plugin-route"}, "effect": "read", "source": "registry"},
    {"id": "console.open", "title": "Open a screen", "group": "navigation", "say": ["open {target}"], "fields": [{"name": "target", "ask": "Open what?"}], "run": {"kind": "voice"}, "effect": "navigate", "source": "builtin"},
]

tools = ct.tools_from_catalog(ENTRIES)
names = {t["id"]: t for t in tools}
check(all(re_ok for re_ok in (len(t["name"]) <= 64 and all(c.isalnum() or c in "_-" for c in t["name"]) for t in tools)), "tool names are provider-safe ([a-zA-Z0-9_-], ≤ 64)")
check(len({t["name"] for t in tools}) == len(tools), "tool names are unique")
check(names["project-wizard/run"]["name"] == "project-wizard__run" and names["project-wizard/run"]["parameters"]["required"] == ["name"], "fields → schema: required = the non-optional ones")
check(names["project-wizard/run"]["parameters"]["properties"]["kind"]["enum"] == ["app", "library", "plugin", "site"], "enum fields keep their values")
check(names["weather/today"]["parameters"]["properties"]["days"]["type"] == "number" and names["weather/today"]["parameters"]["properties"]["city"]["description"] == "city?", "number type, the field's question is its description")
check(names["project-wizard/run"]["confirm"] and not names["project-wizard/run"]["destructive"], "a phrasebook confirm entry confirms but is not destructive")
check(names["notes/remove"]["destructive"] and names["notes/remove"]["confirm"], "a destructive command is flagged and confirms")
check(not names["listener.help"]["destructive"] and not names["listener.help"]["confirm"], "a read is neither")
check(not any(i in names for i in ("approvals.review", "approvals.all", "control:pass.scopes", "hub/approve", "action:approvals.deny")), "approve / deny / approvals / veto entries are never tools (personOnly)")
check(ct.is_person_only(ENTRIES[7]) and ct.is_person_only(ENTRIES[8]) and not ct.is_person_only(ENTRIES[3]), "personOnly flag from the deciding words and the approvals group")
check(all(set(t) == {"name", "description", "parameters"} for t in ct.provider_tools(tools)), "the model sees name, description and parameters only")
check("Said like" in names["project-wizard/run"]["description"] and len(names["project-wizard/run"]["description"]) <= 300, "description: title + a spoken form, ≤ 300 chars")
check(ct.tool_name("a/b", {"a__b"}) == "a__b_2", "a clashing name gets a suffix")
many = ENTRIES + [{"id": f"x{i}/cmd", "title": f"thing {i}", "say": [f"thing {i}"], "fields": [], "run": {"kind": "plugin-route"}, "effect": "read", "source": "registry"} for i in range(200)]
sel = ct.select_tools(many, "today's weather in Paris")
check(len(sel) <= ct.MAX_TOOLS and any(t["id"] == "weather/today" for t in sel) and any(t["id"] == "project-wizard/run" for t in sel), "select_tools: capped, keeps the core entries and the best word matches")
check(not any(t["personOnly"] for t in sel), "select_tools never offers a personOnly tool")
real = subprocess.run(["node", str(HERE / "listener.mjs"), "catalog", "--json"], cwd=REPO, capture_output=True, text=True, timeout=120)
cat = json.loads(real.stdout.strip().splitlines()[-1])
all_tools = ct.tools_from_catalog(cat["entries"])
check(len(all_tools) > 100 and len({t["name"] for t in all_tools}) == len(all_tools) and not any(ct.DECIDING_RE.search(t["id"]) for t in all_tools), f"the real catalog converts: {len(all_tools)} tools, unique names, no deciding command")

# ---------------------------------------------------------------- the understand route (s4, s5)

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.wake_listener_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
ci = mod.claude_intent

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)


class FakeLlm:
    """Answers with a scripted reply; records every call (so a test can prove nothing was sent)."""

    def __init__(self):
        self.calls: list = []
        self.reply: dict = {}
        self.delay = 0.0
        self.error = ""
        self.model = "claude-opus-5-5"

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append({"messages": messages, "system": system, "tools": tools})
        if self.delay:
            time.sleep(self.delay)
        if self.error:
            raise RuntimeError(self.error)
        return {"text": "", "tool_calls": [], "model": self.model, **self.reply}


def call(name, args):
    return {"tool_calls": [{"id": "t1", "name": name, "arguments": args}]}


llm = FakeLlm()
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
mod.claude_status().data.update(failedAt=0)

llm.reply = call("project-wizard__run", {"name": "Gizmo Johnson", "kind": "app"})
r = c.post("/p/understand", json={"text": "make me a project called Gizmo Johnson"}).json()
check(r["mode"] == "claude" and r["command"] == "project-wizard/run" and r["args"] == {"name": "Gizmo Johnson", "kind": "app"}, "understand: Claude picks a command and fills its fields")
check(len(llm.calls) == 1 and llm.calls[0]["system"] == ci.SYSTEM and any(t["name"] == "project-wizard__run" for t in llm.calls[0]["tools"]), "understand: one call through axf.llm@1 with the system prompt and the tools")
check(not any(ct.DECIDING_RE.search(t["name"]) for t in llm.calls[0]["tools"]), "understand: no approve / deny tool is offered")
check(c.post("/p/understand", json={}).status_code == 400, "understand: no text → 400")

# asks for a missing field, then the follow-up fills only that one
llm.calls.clear()
llm.reply = call("build-orchestrator__pipeline-build-action", {"action": "hold"})
r = c.post("/p/understand", json={"text": "pause that build"}).json()
check(r["mode"] == "claude" and r["missing"] == ["id"] and r["ask"] and not r["run"] and r["pending"]["args"] == {"action": "hold"}, "missing field: Claude's pick asks for it, nothing runs")
llm.reply = call("build-orchestrator__pipeline-build-action", {"id": "gizmo-rebuild"})
r2 = c.post("/p/understand", json={"text": "gizmo rebuild", "pending": r["pending"]}).json()
check(len(llm.calls) == 2 and [t["name"] for t in llm.calls[1]["tools"]] == ["build-orchestrator__pipeline-build-action"], "follow-up: only the pending command's tool is offered")
check("Brett answered" in llm.calls[1]["messages"][0]["content"] and "pause that build" in llm.calls[1]["messages"][0]["content"], "follow-up: the first phrase, the question and the answer go back")
check(r2["args"] == {"action": "hold", "id": "gizmo-rebuild"} and r2["missing"] == [] and r2["confirm"] and not r2["run"], "follow-up: keeps what it had, fills the missing field, then asks to confirm")

# the confirm gate: only a spoken yes runs it, read here without a Claude call
n = len(llm.calls)
r3 = c.post("/p/understand", json={"text": "hmm maybe", "pending": r2["pending"]}).json()
check(r3["confirm"] and not r3["run"] and r3["prompt"].startswith("Yes or no?"), "confirm gate: anything but yes / no asks again")
r4 = c.post("/p/understand", json={"text": "no", "pending": r2["pending"]}).json()
check(r4.get("cancelled") and not r4["run"], "confirm gate: no cancels")
r5 = c.post("/p/understand", json={"text": "yes", "pending": r2["pending"]}).json()
check(r5["run"] and r5.get("confirmed") and r5["args"]["id"] == "gizmo-rebuild", "confirm gate: yes runs it")
check(len(llm.calls) == n, "confirm gate: the yes / no never goes to Claude")

# a destructive command always confirms
llm.reply = call("weather__today", {})
entries = mod.catalog_entries()
dest = next(e for e in entries if e.get("effect") == "destructive" and not ct.is_person_only(e) and not [f for f in e.get("fields") or [] if not f.get("optional")])
dt = ct.to_tool(dest)
res = ci.answer_for(dt, dest, {}, "x")
check(res["confirm"] and not res["run"] and res["destructive"], f"destructive command ({dest['id']}) returns confirm:true")

# a read with nothing missing runs at once
llm.reply = call("listener_help", {})
r = c.post("/p/understand", json={"text": "what are you able to do"}).json()
check(r["mode"] == "claude" and r["run"] and r["command"] == "listener.help", "a command with nothing missing and no confirm runs at once")

# timeout → offline, then the cooldown skips Claude without waiting
c.post("/p/settings", json={"claudeTimeoutSec": 2})
llm.delay = 3.0
t0 = time.time()
r = c.post("/p/understand", json={"text": "what can i say"}).json()
check(r["mode"] == "offline" and r["reason"] == "timeout" and time.time() - t0 < 2.9, "timeout: falls back to offline after the timeout setting")
n = len(llm.calls)
r = c.post("/p/understand", json={"text": "what can i say"}).json()
check(r["reason"] == "cooldown" and len(llm.calls) == n, "after a failure the cooldown goes straight to scripted (no call)")
llm.delay = 0.0
mod.claude_status().data.update(failedAt=0)

# errors, credits, a non-Claude model, no service
llm.error = "boom 500"
check(c.post("/p/understand", json={"text": "help"}).json()["reason"] == "error", "an error falls back (error)")
mod.claude_status().data.update(failedAt=0)
llm.error = "Your credit balance is too low"
check(c.post("/p/understand", json={"text": "help"}).json()["reason"] == "no-credit", "out of credits falls back (no-credit)")
mod.claude_status().data.update(failedAt=0)
llm.error = ""
llm.model = "gpt-5"
check(c.post("/p/understand", json={"text": "help"}).json()["reason"] == "not-claude", "a non-Claude model is not 'Claude connected' (not-claude)")
mod.claude_status().data.update(failedAt=0)
llm.model = "claude-opus-5-5"
llm.reply = {"text": "I am not sure."}
check(c.post("/p/understand", json={"text": "blah"}).json()["reason"] == "no-command", "no tool picked → offline (no-command)")
llm.reply = {"text": 'Sure: {"command": "listener_help", "args": {}, "ask": ""}'}
check(c.post("/p/understand", json={"text": "help me"}).json()["command"] == "listener.help", "a JSON line works when the provider has no tools (Claude Code CLI)")
plugin_services.provide("axf.llm@1", None, "fake-assistant")
check(c.post("/p/understand", json={"text": "help"}).json()["reason"] == "no-llm", "no axf.llm@1 → offline (no-llm)")
plugin_services.provide("axf.llm@1", llm, "fake-assistant")

# Brett: the switch is a real off: with Claude connected and the switch off, nothing is sent to Claude
mod.claude_status().ok("claude-opus-5-5")
c.post("/p/settings", json={"useClaude": False})
n = len(llm.calls)
r = c.post("/p/understand", json={"text": "create a new project named Gizmo Johnson"}).json()
check(r["mode"] == "offline" and r["reason"] == "off" and len(llm.calls) == n, "switch off: offline, no Claude request at all (even while connected)")
c.post("/p/settings", json={"useClaude": True})

print(f"{ok} checks passed")
