"""Model upgrades need Brett (Nov 3 2026): the console's two ways in.

  python3 apps/console-web/plugins/build-orchestrator/server/test_upgrade.py

1. The console route: only a signed-in hub admin's click (wall session, no agent header) hands the CLI an approver.
2. The axHub approval (console MCP tool orchestrator_upgrade_approve): records Brett's approval when the console server
   runs it, and is refused when the process is a Claude session, headless build or agent.
Runs the real CLI against a scratch builds store.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "apps/console-web/server"))
sys.path.insert(0, str(HERE.parent.parent))

import mcp_server  # noqa: E402
from importlib import import_module  # noqa: E402

srv = import_module("build-orchestrator.server")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1


class Req:
    def __init__(self, via: str, admin: bool = True, headers: dict[str, str] | None = None):
        self.state = SimpleNamespace(axf_user=SimpleNamespace(name="brett", via=via, admin=admin))
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}


check(srv.brett_click(Req("session")) == "brett", "a signed-in hub admin's click is Brett")
check(srv.brett_click(Req("token")) == "", "the console token alone is not Brett (scripts and sessions hold it)")
check(srv.brett_click(Req("session", admin=False)) == "", "a hub user who isn't an admin is not Brett")
check(srv.brett_click(Req("session", headers={"X-Axhub-Session": "agent:Vinny"})) == "", "a request naming an agent is not Brett")
check(srv.brett_click(Req("session", headers={"X-Axhub-Session": "console"})) == "brett", "the console's own header is fine")

AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "AXF_SURFACE", "AXF_SESSION", "AXF_APPROVER", "AXF_APPROVER_VIA")
CLI = HERE.parent / "orchestrator.mjs"
with tempfile.TemporaryDirectory() as d:
    store = str(Path(d) / "store.json")
    clean = {k: v for k, v in os.environ.items() if k not in AGENT_ENV}
    clean.update(AXF_BUILDS_STORE=store)

    def cli(*args: str, env: dict[str, str] | None = None) -> dict:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, env=env or clean, timeout=60)
        return json.loads(p.stdout.strip().splitlines()[-1])

    cli("act", json.dumps({"action": "add", "title": "Up", "steps": [{"text": "a", "model": "Opus", "estimate": "5 min"}, {"text": "b", "model": "Fable", "estimate": "5 min"}]}))
    cli("act", json.dumps({"action": "step", "id": "up", "step": "s1"}))
    r = cli("act", json.dumps({"action": "approve", "id": "up", "phase": 1, "approver": {"by": "brett", "via": "console"}}))
    check(not r["ok"] and "needs Brett" in r["error"], "an approver inside the change is ignored: refused")
    r = cli("request-upgrade", "up", "1", env={**clean, "AXF_SESSION": "build:up"})
    check(r["ok"] and r["ask"]["tool"] == "axf.orchestrator_upgrade_approve", "a headless build may ask (request + the axHub call to send)")
    r = cli("act", json.dumps({"action": "approve", "id": "up", "phase": 1}), env={**clean, "AXF_SESSION": "build:up", "AXF_APPROVER": "brett", "AXF_APPROVER_VIA": "console"})
    check(not r["ok"], "a headless build setting the approver env itself is refused")

    saved = dict(os.environ)
    try:
        os.environ.clear(); os.environ.update(clean); os.environ["CLAUDECODE"] = "1"
        r = mcp_server.upgrade_via_axhub("up", 1)
        check(not r.get("ok"), "the MCP tool inside a Claude session (local stdio) is refused")
        os.environ.clear(); os.environ.update(clean)
        r = mcp_server.upgrade_via_axhub("up", 1, "req-1")
        check(r.get("ok"), "the console server running the axHub-approved call records it")
    finally:
        os.environ.clear(); os.environ.update(saved)
    b = next(x for x in json.loads(Path(store).read_text())["builds"] if x["id"] == "up")
    a = next(x for x in b["approvals"] if x["phase"] == 1)
    check(a["via"] == "axhub" and a["by"].startswith("brett (axHub approval") and a["kind"] == "upgrade", "who and how are on the approval")
    check(b["upgradeRequests"][0]["state"] == "approved", "the open request is closed as approved")

print(f"build-orchestrator upgrades: {n} checks passed")
