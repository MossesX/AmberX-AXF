#!/usr/bin/env python3
"""Self-test for VPS Settings: routes through framework/cli/vps-settings.mjs on a scratch store, the owner-only switch-off
(403 for a session, MCP or voice; Brett's own click passes), the refused-jobs log and Clear, the console alert per noticed
refusal, and the capability axf.vps-settings@1.

    python3 apps/console-web/plugins/vps-settings/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
STORE = Path(tempfile.mkdtemp(prefix="axf-vps-settings-test-"))
os.environ.update(AXF_VPS_SETTINGS_DIR=str(STORE / "vps"), AXF_DISPATCH_DIR=str(STORE / "dispatch"), AXF_NOTIFY_INBOX="off",
                  AXF_VPS_SETTINGS_WATCH="off")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.vps_settings_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

BRETT = {"on": False}
app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # the console's auth: Brett's signed-in session, else a token caller
    request.state.axf_user = type("U", (), {"via": "session", "admin": True, "name": "Brett"})() if BRETT["on"] else None
    return await call_next(request)

app.include_router(mod.router, prefix="/api/plugins/vps-settings")
c = TestClient(app)
P = "/api/plugins/vps-settings"
GATE = REPO / "framework" / "cli" / "dispatch-gate.mjs"
CLI = REPO / "framework" / "cli" / "vps-settings.mjs"
n = failed = 0


def ok(cond: bool, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"FAIL {what}")


def node(f: Path, *args: str) -> subprocess.CompletedProcess:
    return subprocess.run(["node", str(f), *args], capture_output=True, text=True, cwd=REPO, env=os.environ)


ok(mod.ROOT == REPO, f"repo root found ({mod.ROOT})")
s = c.get(f"{P}/state").json()
ok(s["values"]["orchestratorOnly"] is True and s["values"]["notifyRefused"] is True, f"defaults: rule on ({s['values']})")
ok(s["deepLink"] == "settings:vps-settings", "state names its deep link")
ok({x["key"] for x in s["settings"]} >= {"orchestratorOnly", "notifyRefused", "notifyEveryMin", "refusedLogMax"}, "every setting listed")

# owner-only switch-off
r = c.put(f"{P}/settings", json={"orchestratorOnly": False})
ok(r.status_code == 403, f"a token caller (session, MCP, voice) can't switch the rule off ({r.status_code})")
r = c.put(f"{P}/settings", json={"orchestratorOnly": "off"}, headers={"X-Axhub-Session": "build-x"})
ok(r.status_code == 403, "… not even as a string")
BRETT["on"] = True
r = c.put(f"{P}/settings", json={"orchestratorOnly": False}, headers={"X-Axhub-Session": "build-x"})
ok(r.status_code == 403, "Brett's session with an agent header is not his click")
r = c.put(f"{P}/settings", json={"orchestratorOnly": False})
ok(r.status_code == 200 and r.json()["values"]["orchestratorOnly"] is False, "Brett's own click switches it off")
ok(next(x for x in r.json()["settings"] if x["key"] == "orchestratorOnly")["changed"]["by"] == "Brett", "who changed it is kept")
BRETT["on"] = False
r = c.put(f"{P}/settings", json={"orchestratorOnly": True})
ok(r.status_code == 200 and r.json()["values"]["orchestratorOnly"] is True, "anyone may switch it back on")
ok(c.put(f"{P}/settings", json={"notifyEveryMin": 5}).json()["values"]["notifyEveryMin"] == 5, "other settings open to every caller")
ok(c.put(f"{P}/settings", json={"notifyEveryMin": 99999}).status_code == 400, "out of range = 400")
ok(c.put(f"{P}/settings", json={"bogus": 1}).status_code == 400, "unknown key = 400")
ok(c.put(f"{P}/settings", json={}).status_code == 400, "empty = 400")
ok(json.loads(node(CLI, "get", "--json").stdout)["values"]["notifyEveryMin"] == 5, "the host CLI sees the console's save at once")

# the refused-jobs log, fed by the real gate
r = node(GATE, "check", "--name", "build-not-dispatched", "--launcher", "claude-headless")
ok(r.returncode == 3, "gate refuses a build-* launch without a token")
rows = c.get(f"{P}/refused").json()["refused"]
ok(rows and rows[0]["name"] == "build-not-dispatched" and rows[0]["outcome"] == "refused", f"refusal in the log ({rows[:1]})")
ok(c.get(f"{P}/state").json()["counts"]["refused24h"] == 1, "24 h count")

# console alert per noticed refusal (once)
seen: list[dict] = []
mod._seen.clear()
alerts = mod.raise_alerts([{"id": "a1", "outcome": "refused", "build": "b1", "why": "x", "notified": "sent"},
                           {"id": "a2", "outcome": "refused", "build": "b1", "why": "x", "notified": ""},
                           {"id": "a3", "outcome": "allowed-off", "build": "b2", "why": "x", "notified": ""}], seen.append)
ok(alerts == 1 and seen[0]["key"] == "vps-refused:b1" and seen[0]["link"] == "settings:vps-settings", f"one alert for the noticed refusal ({seen})")
ok(mod.raise_alerts([{"id": "a1", "outcome": "refused", "build": "b1", "notified": "sent"}], seen.append) == 0, "never twice")

r = c.post(f"{P}/refused/clear")
ok(r.status_code == 200 and r.json()["cleared"], "Clear")
rows = c.get(f"{P}/refused").json()["refused"]
ok(len(rows) == 1 and rows[0]["outcome"] == "cleared", "the log keeps one line saying it was cleared")

svc = plugin_services.get("axf.vps-settings@1")
ok(svc is not None and svc.settings()["values"]["orchestratorOnly"] is True, "capability axf.vps-settings@1")

print(f"vps-settings plugin: {n - failed}/{n} passed")
sys.exit(1 if failed else 0)
