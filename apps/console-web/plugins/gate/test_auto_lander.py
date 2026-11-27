"""The lander's REST routes in the gate plugin (server/routes.py → deploy/lander/run.mjs, lander@1) against a temp
data folder and a temp builds store, MCP parity (each gate_auto_lander_* tool plans the same route and gets the same
answer as the CLI), and the systems-check item (server/auto_lander_health.py).

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
(TMP / "store.json").write_text(json.dumps({"$axf": "builds@1", "rev": 1, "builds": [
    {"id": "b-one", "title": "B one", "status": "failed", "steps": [{"id": "s1", "text": "x"}]},
    {"id": "b-two", "title": "B two", "status": "pending", "steps": []}]}))
os.environ.update(AXF_LANDER_DIR=str(TMP / "lander"), AXF_GATE_DIR=str(TMP / "gate"), AXF_BUILDS_STORE=str(TMP / "store.json"), AXF_BUILDS_LIVE="0", AXF_CREW_SAY="off")
AL = ROOT / "deploy" / "lander" / "run.mjs"
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


# ---- status: the lander's service and the builds it lands, read from the builds store
r = c.get(B)
ok(r.status_code == 200, f"GET auto-lander {r.status_code} {r.text[:200]}")
s = r.json()
ok(s["ok"] and {"service", "current", "queue", "builds", "settings", "escalations", "failing"} <= set(s), "status fields")
ok(s["service"]["lastTick"] == "" and s["escalations"] == [], "never ticked; nothing ever escalates to a person")

# ---- one build
r = c.get(f"{B}/builds/b-one").json()
ok(r["build"] == "b-one" and r["status"] == "failed" and "statusLog" in r, f"one build: {r}")
ok(c.get(f"{B}/builds/nope").status_code == 400, "an unknown build is refused")

# ---- settings (the size cap is one of them)
r = c.post(f"{B}/settings", json={"sizeCapLines": 2500, "enabled": True})
ok(r.status_code == 200 and r.json()["settings"]["sizeCapLines"] == 2500 and r.json()["settings"]["enabled"] is True, f"settings set {r.text[:200]}")
ok(c.get(f"{B}/settings").json()["settings"]["sizeCapLines"] == 2500, "settings read back")
ok(c.post(f"{B}/settings", json={"key": "backoffBaseMin", "value": 3}).json()["settings"]["backoffBaseMin"] == 3, "{key, value} form")
ok(c.post(f"{B}/settings", json={"bogus": 1}).status_code == 400, "unknown setting = 400")
ok(c.post(f"{B}/settings", json={"key": "maxAttempts", "value": 3}).status_code == 400, "the old escalation limit is gone = 400")

# ---- pause / resume / run / fix
ok(c.post(f"{B}/pause", json={"by": "test"}).json()["paused"] is True, "pause")
ok(c.get(B).json()["service"]["paused"] is True, "status says paused")
ok(c.post(f"{B}/resume", json={}).json()["paused"] is False, "resume")
ok(c.post(f"{B}/run", json={}).json()["requested"] is True, "run asks the service for a tick")
ctl = json.loads((TMP / "lander" / "control.json").read_text())
ok(bool(ctl["runRequested"]), "the request is in the control file")
ok(c.post(f"{B}/fix/b-two", json={}).status_code != 200, "fix on a build that isn't failed is refused")

# ---- MCP parity
mcp = via_mcp("gate/auto-lander-status", "read").json()
mine = cli("status")
strip = lambda d: {k: v for k, v in d.items() if k not in ("ok", "at")}  # noqa: E731
ok(strip(mcp) == strip(mine), "gate_auto_lander_status == axf gate auto-lander status")
ok(via_mcp("gate/auto-lander-settings", "read").json()["settings"] == cli("settings")["settings"], "settings read parity")
r = via_mcp("gate/auto-lander-settings-set", "run", {"sizeCapLines": 3000})
ok(r.status_code == 200 and cli("settings")["settings"]["sizeCapLines"] == 3000, f"settings set through MCP lands where the CLI reads ({r.text[:200]})")
ok(via_mcp("gate/auto-lander-pause", "run").json()["paused"] is True and cli("status")["service"]["paused"] is True, "pause parity")
ok(via_mcp("gate/auto-lander-resume", "run").json()["paused"] is False, "resume parity")
ok(via_mcp("gate/auto-lander-build", "read", {"build": "b-one"}).json()["status"] == cli("show", "b-one")["status"], "one build parity")
tools = json.loads(subprocess.run(["node", str(CMDS), "tools", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60).stdout)
names = {t["name"] for t in (tools if isinstance(tools, list) else tools.get("tools", []))}
want = {f"gate_auto_lander_{x}" for x in ("status", "build", "run", "retry", "fix", "pause", "resume", "settings", "settings_set")}
ok(want <= names, f"every MCP tool exists: missing {sorted(want - names)}")

# ---- the systems-check item
h = routes.al_health
now = time.time() * 1000
iso = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(ms / 1000))  # noqa: E731
up = {"service": {"lastTick": iso(now - 30000), "paused": False}, "builds": [{}], "escalations": [], "failing": []}
ok(h.check(up, now)["status"] == "ok", "a ticking service is green")
ok(h.check({"service": {"lastTick": iso(now - 20 * 60000)}}, now)["status"] == "error", "no tick for 20 min is red")
ok(h.check({"service": {"lastTick": ""}}, now)["status"] == "error", "never ticked is red")
ok("axf-lander.timer" in " ".join(h.check({"service": {"lastTick": ""}}, now)["details"]), "points at the lander's timer")
v = h.check({**up, "failing": [{"build": "b-one", "attempt": 4, "kind": "ci-red", "why": "CI is red", "pr": 7}]}, now)
ok(v["status"] == "warn" and "failed 4 times" in v["summary"] and "nobody needs to act" in v["summary"], f"failing summary: {v['summary']}")
ok(h.check({**up, "service": {**up["service"], "paused": True, "pausedAt": iso(now - 13 * 3600000)}}, now)["status"] == "warn", "paused for 13 h is amber")
ok(h.check({"ok": False, "message": "x"}, now)["status"] == "unknown", "unreadable status is unknown, not red at once")
ok(h.fix_all({"escalations": []}, lambda b: {"ok": True})["state"] == "done", "nothing escalated: nothing to do")


class Reg:
    def __init__(self) -> None:
        self.spec: dict = {}

    def register(self, spec: dict, owner: str) -> str:
        self.spec = {**spec, "owner": owner}
        return spec["id"]


reg = Reg()
ok(h.ensure({"axf.health@1": reg}, lambda: up, lambda b: {"ok": True}), "registers with the systems check")
ok(reg.spec["id"] == "gate-auto-lander" and reg.spec["push"] is False, "the runner's own chat post, never a second push")
ok(reg.spec["run"]()["status"] == "ok", "the registered check runs")

# the systems-check item for branch protection on main (L2-09): read-only, no Fix button, the exact steps for Brett
mp = routes.mp_health
want = {"rules": [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": "Build engine sweep (Node)"}, {"context": "CI scope (what changed)"}]}}]}
off = mp.check({"ok": True, "ruleset": want, "current": None, "error": ""})
ok(off["status"] == "warn" and "not protected" in off["summary"], "no ruleset on GitHub is amber")
ok(any("branch-protection.mjs apply --yes" in d for d in off["details"]) and any("status-key --yes" in d for d in off["details"]), "with the exact steps")
ok(mp.check({"ok": True, "ruleset": want, "current": {"enforcement": "disabled", "rules": want["rules"]}})["status"] == "warn", "a ruleset that is switched off is amber")
ok(mp.check({"ok": True, "ruleset": want, "current": {"enforcement": "active", "rules": want["rules"]}})["status"] == "ok", "the ruleset on and complete is green")
part = mp.check({"ok": True, "ruleset": want, "current": {"enforcement": "active", "rules": [{"type": "required_status_checks", "parameters": {"required_status_checks": [{"context": "CI scope (what changed)"}]}}]}})
ok(part["status"] == "warn" and "Build engine sweep (Node)" in part["summary"], "a required check missing on GitHub is named")
ok(mp.check({"ok": True, "ruleset": want, "current": None, "error": "GitHub GET /rulesets: 403"})["status"] == "unknown", "GitHub not read is unknown, never a guess")
ok(mp.check({"ok": False, "message": "x"})["status"] == "unknown", "no answer is unknown")
reg2 = Reg()
ok(mp.ensure({"axf.health@1": reg2}, lambda: {"ok": True, "ruleset": want, "current": None}), "registers with the systems check")
ok(reg2.spec["id"] == "gate-main-protection" and "autoFix" not in reg2.spec and reg2.spec["push"] is False, "no Fix button: applying it is Brett's call")
ok(reg2.spec["run"]()["status"] == "warn", "the registered check runs")
ok(not any(w in (HERE / "server" / "main_protection_health.py").read_text() for w in ("import subprocess", "import requests", "import urllib", "import httpx")), "the check itself calls nothing: routes.py runs the read-only CLI")

print(f"✓ gate lander routes — {n} checks")
