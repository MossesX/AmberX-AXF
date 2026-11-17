"""The server auto-lander's REST routes in the gate plugin (server/routes.py, auto-lander@1) against a temp data folder,
MCP parity (each gate_auto_lander_* tool plans the same route and gets the same answer as the CLI), and the
systems-check item (server/auto_lander_health.py).

  python3 apps/console-web/plugins/gate/test_auto_lander.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2].parent
TMP = Path(tempfile.mkdtemp(prefix="axf-gate-al-"))
os.environ.update(AXF_AUTO_LANDER_DIR=str(TMP / "al"), AXF_GATE_DIR=str(TMP / "gate"), AXF_LAND_CONSOLE="off")
AL = ROOT / "deploy" / "auto-lander" / "auto-lander.mjs"
CMDS = ROOT / "apps" / "console-web" / "plugins" / "plugin-commands" / "commands.mjs"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("gate_routes", HERE / "server" / "routes.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(routes.router, prefix="/api/plugins/gate")
c = TestClient(app)
B = "/api/plugins/gate/auto-lander"
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


def cli(*args: str) -> dict:
    p = subprocess.run(["node", str(AL), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    ok(p.returncode == 0, f"cli {' '.join(args)}: {p.stderr[-200:]}")
    return json.loads(p.stdout)


def plan(path: str, action: str, inp: dict) -> dict:
    """What the MCP tool for a gate command does: plugin-commands plans the route the console server then runs."""
    target = "plugins.reads" if action == "read" else "plugins.commands"
    p = subprocess.run(["node", str(CMDS), "plan"], cwd=ROOT, capture_output=True, text=True, timeout=60,
                       input=json.dumps({"command": {"op": "act", "target": target, "path": path, "action": action, "input": inp, "by": "mcp"}}))
    r = json.loads(p.stdout)
    ok(r.get("ok") and r["dispatch"]["kind"] == "route", f"plan {path}: {r}")
    return r["dispatch"]


def via_mcp(path: str, action: str, inp: dict | None = None):
    d = plan(path, action, inp or {})
    return c.request(d["method"], d["path"], params=d.get("query") or None, json=d.get("body") if d.get("body") is not None else ({} if d["method"] != "GET" else None))


# a build with attempts in the log (written by the Node store, the same code the runner uses)
seed = ("import * as A from './deploy/auto-lander/attempts.mjs';"
        "A.record('b-one', 'clash', 'ok', { pr: 7, at: '2026-11-17T01:00:00.000Z', log: 'merged main' });"
        "A.record('b-one', 'red-ci', 'failed', { pr: 7, at: '2026-11-17T01:10:00.000Z', log: 'CI is still red' });")
subprocess.run(["node", "--input-type=module", "-e", seed], cwd=ROOT, check=True, timeout=60)

# ---- status
r = c.get(B)
ok(r.status_code == 200, f"GET auto-lander {r.status_code} {r.text[:200]}")
s = r.json()
ok(s["ok"] and {"service", "current", "queue", "builds", "settings", "escalations"} <= set(s), "status fields")
ok(s["service"]["up"] is False and s["service"]["lastTick"] == "", "never ticked = down")

# ---- one build's log
r = c.get(f"{B}/builds/b-one").json()
ok([a["kind"] for a in r["attempts"]] == ["clash", "red-ci"], "attempt log in order")
ok(r["count"]["red-ci"]["failures"] == 1 and r["count"]["clash"]["ok"] == 1, "counts by kind")

# ---- settings
r = c.post(f"{B}/settings", json={"maxAttempts": 5, "pushOnEscalation": False})
ok(r.status_code == 200 and r.json()["settings"]["maxAttempts"] == 5 and r.json()["settings"]["pushOnEscalation"] is False, f"settings set {r.text[:200]}")
ok(c.get(f"{B}/settings").json()["settings"]["maxAttempts"] == 5, "settings read back")
ok(c.post(f"{B}/settings", json={"key": "backoffBaseMin", "value": 2}).json()["settings"]["backoffBaseMin"] == 2, "{key, value} form")
ok(c.post(f"{B}/settings", json={"input": {"attemptTimeoutMin": 30}, "by": "mcp"}).json()["settings"]["attemptTimeoutMin"] == 30, "plugin-commands body shape")
ok(c.post(f"{B}/settings", json={"bogus": 1}).status_code == 400, "unknown setting = 400")
ok(c.post(f"{B}/settings", json={"maxAttempts": 50}).status_code == 400, "maxAttempts out of range = 400")
ok(c.post(f"{B}/settings", json={"maxAttempts": 0}).status_code == 400, "maxAttempts 0 = 400")
ok(c.get(f"{B}/settings").json()["settings"]["maxAttempts"] == 5, "a refused change leaves the value")

# ---- pause / resume / run / retry / fix
ok(c.post(f"{B}/pause", json={"by": "test"}).json()["paused"] is True, "pause")
ok(c.get(B).json()["service"]["paused"] is True, "status says paused")
ok(c.post(f"{B}/resume", json={}).json()["paused"] is False, "resume")
r = c.post(f"{B}/run", json={}).json()
ok(r["requested"] is True and r["by"] == "console", "run asks the service for a tick (by the signed-in caller)")
r = c.post(f"{B}/retry/b-one", json={"by": "brett"}).json()
ok(r["reset"] == 1 and r["fix"] is False, "retry resets the failed attempt")
ok(c.get(f"{B}/builds/b-one").json()["count"]["red-ci"]["failures"] == 0, "no failures counted after the reset")
ok(c.post(f"{B}/fix/b-one", json={}).json()["fix"] is True, "fix = reset + a fix session next tick")
ctl = json.loads((TMP / "al" / "control.json").read_text())
ok(ctl["fixNow"] == ["b-one"], "the next tick will start a fix session")
ok(c.post(f"{B}/retry/..%2Fetc", json={}).status_code in (400, 404), "a bad build id is refused")

# ---- MCP parity: each tool plans the same route and gets the CLI's answer
mcp = via_mcp("gate/auto-lander-status", "read").json()
mine = cli("status")
strip = lambda d: {k: v for k, v in d.items() if k not in ("ok", "at")}  # noqa: E731
ok(strip(mcp) == strip(mine), "gate_auto_lander_status == axf gate auto-lander status")
ok(via_mcp("gate/auto-lander-settings", "read").json()["settings"] == cli("settings")["settings"], "settings read parity")
r = via_mcp("gate/auto-lander-settings-set", "run", {"maxAttempts": 4})
ok(r.status_code == 200 and cli("settings")["settings"]["maxAttempts"] == 4, f"settings set through MCP lands where the CLI reads ({r.text[:200]})")
ok(via_mcp("gate/auto-lander-pause", "run").json()["paused"] is True and cli("status")["service"]["paused"] is True, "pause parity")
ok(via_mcp("gate/auto-lander-resume", "run").json()["paused"] is False, "resume parity")
ok(via_mcp("gate/auto-lander-retry", "run", {"build": "b-one"}).json()["build"] == "b-one", "retry parity")
ok(via_mcp("gate/auto-lander-build", "read", {"build": "b-one"}).json()["attempts"] == cli("show", "b-one")["attempts"], "attempt log parity")
tools = json.loads(subprocess.run(["node", str(CMDS), "tools", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout)
names = {t["name"] for t in (tools if isinstance(tools, list) else tools.get("tools", []))}
want = {f"gate_auto_lander_{x}" for x in ("status", "build", "run", "retry", "fix", "pause", "resume", "settings", "settings_set")}
ok(want <= names, f"every MCP tool exists: missing {sorted(want - names)}")

# ---- the systems-check item
h = routes.al_health
now = time.time() * 1000
iso = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ms / 1000))  # noqa: E731
up = {"service": {"lastTick": iso(now - 30000), "paused": False}, "builds": [{}], "escalations": []}
ok(h.check(up, now)["status"] == "ok", "a ticking service with nothing escalated is green")
ok(h.check({"service": {"lastTick": iso(now - 20 * 60000)}}, now)["status"] == "error", "no tick for 20 min is red")
ok(h.check({"service": {"lastTick": ""}}, now)["status"] == "error", "never ticked is red")
v = h.check({**up, "escalations": [{"build": "b-one", "pr": 7, "kind": "red-ci", "attempts": 3, "since": "2026-11-17T01:00:00Z", "why": "CI is red", "log": "a\nCI is still red"}]}, now)
ok(v["status"] == "error" and "gave up on b-one" in v["summary"] and "since 2026-11-17 01:00 UTC" in v["summary"], f"escalation summary: {v['summary']}")
ok("Last attempt: a · CI is still red" in v["details"][0] and v["link"].endswith("row:b-one"), "details carry the last log and the row link")
ok(h.check({**up, "service": {**up["service"], "paused": True, "pausedAt": iso(now - 13 * 3600000)}}, now)["status"] == "warn", "paused for 13 h is amber")
ok(h.check({"ok": False, "message": "x"}, now)["status"] == "unknown", "unreadable status is unknown, not red at once")
seen: list[str] = []
r = h.fix_all({"escalations": [{"build": "b-one"}, {"build": "b-two"}]}, lambda b: (seen.append(b), {"ok": True})[1])
ok(r["state"] == "started" and seen == ["b-one", "b-two"], "Reset and fix now resets every escalated build")
ok(h.fix_all({"escalations": []}, lambda b: {"ok": True})["state"] == "done", "nothing escalated: nothing to do")


class Reg:
    def __init__(self) -> None:
        self.spec: dict = {}

    def register(self, spec: dict, owner: str) -> str:
        self.spec = {**spec, "owner": owner}
        return spec["id"]


reg = Reg()
ok(h.ensure({"axf.health@1": reg}, lambda: up, lambda b: {"ok": True}), "registers with the systems check")
ok(reg.spec["id"] == "gate-auto-lander" and reg.spec["push"] is False and reg.spec["autoFix"]["mode"] == "ask", "one push (the runner's), Fix waits for a press")
ok(reg.spec["run"]()["status"] == "ok", "the registered check runs")
notify = json.loads((HERE / "notify.json").read_text())
ok(any(t["id"] == "gate.auto-lander-escalated" and t["match"]["keyPrefix"] == "gate:auto-lander-escalated:" for t in notify["types"]), "the push is declared in notify.json")

print(f"✓ gate auto-lander routes — {n} checks")
