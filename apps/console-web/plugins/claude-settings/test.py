#!/usr/bin/env python3
"""Self-test for the Claude plugin's server: owner-only settings change only from Brett's signed-in console session,
and the No wait switch creates / re-grants / revokes a real all-scope veto pass in Token control's store (control@1,
loaded here with a scratch data folder). The clock turns No wait off when its pass is revoked, renews only Brett's own
pass. Run where FastAPI is installed (the console image):

    python3 apps/console-web/plugins/claude-settings/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGINS = HERE.parent
TMP = Path(tempfile.mkdtemp(prefix="axf-claude-settings-test-"))
os.environ.update(AXF_CLAUDE_SETTINGS_FILE=str(TMP / "settings.json"), AXF_CLAUDE_SETTINGS_DATA=str(TMP), AXF_CLAUDE_SETTINGS_NO_CLOCK="1",
                  AXF_CONTROL_DATA_DIR=str(TMP / "control"), AXF_TOKEN="test-token", AXF_PASS_SECRET="test-secret")
for k in ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "AXF_SURFACE", "AXF_SESSION"):
    os.environ.pop(k, None)  # the console server is never a Claude session
sys.path.insert(0, str(PLUGINS.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []


def load(folder: str) -> types.ModuleType:
    d = PLUGINS / folder / "server"
    spec = importlib.util.spec_from_file_location(f"axf_console_plugins.{folder.replace('-', '_')}_test", d / "__init__.py", submodule_search_locations=[str(d)])
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


load("token-control")
mod = load("claude-settings")

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # what the console's auth sets: Brett's browser session vs a bearer token
    w = request.headers.get("x-test-who", "token")
    request.state.axf_user = types.SimpleNamespace(name="brett", admin=True, via="session") if w == "brett" else types.SimpleNamespace(name="console", admin=True, via="token")
    return await call_next(request)


app.include_router(mod.router, prefix="/api/plugins/claude-settings")
c = TestClient(app)
BRETT = {"x-test-who": "brett"}
n = failed = 0


def ok(cond: object, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"FAIL {what}")


def put(values: dict, headers: dict | None = None):
    return c.put("/api/plugins/claude-settings/settings", json={"values": values}, headers=headers or {})


def get() -> dict:
    return c.get("/api/plugins/claude-settings/settings").json()


control = plugin_services.get("control@1")


def all_pass() -> dict:
    r = control.run({"op": "get", "target": "pass.scopes", "path": "all"}, ["*"], "test")
    return (r.get("item") or {}).get("active") or {}


v = get()
ok(v.get("ok") and v["values"]["noWait.enabled"] is False and v["noWait"]["active"] is False, "starts off, no pass")
ok(len(v["settings"]) >= 25 and all(s.get("description") for s in v["settings"]), "every setting with a description")

# a session / console token can't touch owner-only settings
r = put({"noWait.enabled": True})
ok(r.status_code == 403 and "owner-only" in r.json().get("message", ""), "console token → No wait refused (403)")
ok(not all_pass(), "no pass after the refusal")
ok(put({"builds.launchWithoutAsking": True}).status_code == 403, "launch without asking is owner-only")
ok(put({"builds.budgetPerBuildUsd": 400}).status_code == 403, "raising a budget cap needs Brett")
ok(put({"builds.budgetPerBuildUsd": 5}).status_code == 200, "lowering it is fine")
r = put({"talking.length": "detailed", "followAmber.enabled": True})
ok(r.status_code == 200 and r.json()["values"]["talking.length"] == "detailed" and r.json()["values"]["followAmber.enabled"] is True, "non-owner settings change")

# Brett's click: the pass comes on
r = put({"noWait.enabled": True, "noWait.autoOffAtNight": False}, BRETT)
p = all_pass()
ok(r.status_code == 200 and r.json()["values"]["noWait.enabled"] is True, "Brett turns No wait on")
ok(p and p.get("approvedVia") == "console" and p.get("minutes") == 60 and not p.get("include_irreversible"), "an all-scope pass, approved by his session, 60 min, irreversible excluded")
ok(r.json()["noWait"]["active"] is True, "the answer shows the pass on")

# changes while on re-grant it
put({"noWait.duration": "untilOff", "noWait.includeIrreversible": True}, BRETT)
p2 = all_pass()
ok(p2.get("minutes") == 240 and p2.get("include_irreversible") is True and p2.get("id") != p.get("id"), "until off + irreversible → re-granted (240 min, irreversible)")
ok(put({"noWait.enabled": False}).status_code == 403 and all_pass(), "a session can't switch it off either; the pass stays")

# the clock: nothing to do with plenty left; renewal keeps Brett's own pass
ok(mod.tick().get("action") == "none", "clock: nothing to do with 4 h left")
rn = control.renew_pass("all", {"minutes": 240, "include_irreversible": True}, "test renewal")
ok(rn.get("ok") and "(standing)" in all_pass().get("approvedBy", ""), "renewal: still Brett's, marked standing")

# off: the pass is revoked at once
r = put({"noWait.enabled": False}, BRETT)
ok(r.status_code == 200 and not all_pass() and r.json()["noWait"]["active"] is False, "Brett turns it off → pass revoked at once")
ok(not control.renew_pass("all", {"minutes": 60}, "x").get("ok"), "no renewal without a pass of Brett's")

# revoked from the banner: the clock switches No wait off
put({"noWait.enabled": True, "noWait.duration": "1h"}, BRETT)
ok(all_pass(), "on again")
control.run({"op": "act", "target": "pass.scopes", "path": "all", "action": "revoke", "input": {}, "by": "banner"}, ["*"], "banner")
t = mod.tick()
ok(t.get("action") == "off" and get()["values"]["noWait.enabled"] is False, "pass revoked elsewhere → the clock switches No wait off")
ch = next(s for s in get()["settings"] if s["key"] == "noWait.enabled").get("changed", {})
ok(ch.get("via") == "system" and "revoked" in ch.get("why", ""), "recorded as the clock's doing, with why")

# a grant through the plain capability (MCP, other plugins) is only ever a request
g = control.run({"op": "act", "target": "pass.scopes", "path": "all", "action": "grant", "input": {"minutes": 30}}, ["*"], "mcp")
ok((g.get("approval") or {}).get("required") and not all_pass(), "a grant without Brett's session stays a request")

print(f"✗ claude-settings server — {failed}/{n} failed" if failed else f"✓ claude-settings server — {n} checks")
sys.exit(1 if failed else 0)
