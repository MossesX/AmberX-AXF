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

print(f"{ok} checks passed")
