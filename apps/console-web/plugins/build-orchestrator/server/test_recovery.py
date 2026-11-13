"""Auto-recovery routes smoke test (build auto-recover-stuck-builds, Nov 13 2026).

    python3 apps/console-web/plugins/build-orchestrator/server/test_recovery.py

1. Every recovery route is on the router and matches the MCP plugin commands in plugin.json.
2. Each route hands recover.mjs the right arguments (stubbed), ids are checked, bodies are turned into k=v settings.
3. The systems check item: registered with an auto-fix that is on by default; probe and auto-fix answer health@1 shapes.
4. The real CLI end to end on a scratch builds store: status answers recovery-status@1, a dry run, settings round trip,
   retry of an unknown build is a 404.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from importlib import import_module
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "apps/console-web/server"))
sys.path.insert(0, str(HERE.parent.parent))

srv = import_module("build-orchestrator.server")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


class Req:
    def __init__(self, body: dict | None = None) -> None:
        self._b = json.dumps(body or {}).encode()
        self.headers: dict[str, str] = {}
        self.state = type("S", (), {"axf_user": None})()

    async def body(self) -> bytes:
        return self._b


# 1. routes ↔ MCP commands
paths = {(m, r.path) for r in srv.router.routes for m in getattr(r, "methods", set())}
manifest = json.loads((HERE.parent / "plugin.json").read_text())
cmds = {c["id"]: c["route"] for c in manifest["commands"]["items"] if c["id"].startswith("recovery-")}
check(set(cmds) == {"recovery-status", "recovery-run", "recovery-settings", "recovery-retry", "recovery-park"}, "five recovery MCP commands")
for cid, route in cmds.items():
    method, path = route.split(" ", 1)
    check((method, path) in paths, f"{cid}: {route} is a server route")

# 2. arguments (stubbed CLI)
calls: list[tuple[str, ...]] = []
real = srv._recover
srv._recover = lambda *a, **k: (calls.append(a), {"ok": True, "state": "done", "message": "m"})[1]  # type: ignore[assignment]
srv.recovery_state()
check(calls[-1] == ("status",), "GET recovery → recover.mjs status")
asyncio.run(srv.recovery_run(Req({"dry_run": True})))
check(calls[-1][:2] == ("run", "--dry-run"), "POST recovery/run {dry_run} → run --dry-run")
asyncio.run(srv.recovery_run(Req({})))
check(calls[-1][:2] == ("run", "--request"), "POST recovery/run → run --request (the host's tick runs it from the container)")
asyncio.run(srv.recovery_settings_set(Req({"enabled": False, "maxRetries": 4, "backoffMin": "1,5"})))
check(calls[-1][:5] == ("settings", "set", "enabled=false", "maxRetries=4", "backoffMin=1,5"), "settings body → k=v pairs, booleans as true/false")
try:
    asyncio.run(srv.recovery_settings_set(Req({"nope": 1})))
    check(False, "an empty settings change is a 400")
except srv.HTTPException as e:
    check(e.status_code == 400, "an empty settings change is a 400")
asyncio.run(srv.recovery_retry("alpha", Req()))
check(calls[-1][:2] == ("retry", "alpha"), "POST recovery/retry/{build}")
asyncio.run(srv.recovery_park("alpha", Req({"why": "needs a call"})))
check(calls[-1][:2] == ("park", "alpha") and calls[-1][-2:] == ("--why", "needs a call"), "POST recovery/park/{build} {why}")
for bad in ("../x", "A B", ""):
    try:
        asyncio.run(srv.recovery_retry(bad, Req()))
        check(False, f"bad id {bad!r} refused")
    except srv.HTTPException as e:
        check(e.status_code == 400, f"bad id {bad!r} is a 400")

# 3. the systems check item
class Reg:
    def __init__(self) -> None:
        self.specs: dict[str, dict] = {}

    def register(self, spec: dict, owner: str = "") -> str:
        self.specs[spec["id"]] = {**spec, "owner": owner}
        return spec["id"]


reg = Reg()
srv.register_recovery_health(reg)
spec = reg.specs.get(srv.RECOVERY_HEALTH_ID)
check(spec is not None and spec["owner"] == "build-orchestrator", "builds-stuck-recovery is registered by the orchestrator")
check(spec["autoFix"]["mode"] == "auto", "its auto-fix is on by default (Fix it yourself)")
check(srv.RECOVERY_HEALTH_ID != "builds-stuck", "it never replaces systems-check's own builds-stuck item")
fix = srv.recovery_autofix()
check(fix["state"] == "done" and calls[-1][:2] == ("run", "--request"), "the auto-fix runs a recovery round")
srv._recover = real  # type: ignore[assignment]

# 4. the real CLI on a scratch store
with tempfile.TemporaryDirectory() as d:
    store = Path(d) / "store.json"
    store.write_text(json.dumps({"$axf": "builds@1", "builds": [{"id": "alpha", "title": "Alpha", "status": "running", "steps": [{"id": "s1", "text": "x"}]}]}))
    os.environ.update(AXF_BUILDS_STORE=str(store), AXF_BUILDS_LIVE="0", AXF_BUILD_HOOKS="off", AXF_BUILDS_EXPORT="0", AXF_PIPELINE_DIR=str(Path(d) / "pipe"),
                      AXF_SLOTS_DIR=str(Path(d) / "slots"), AXF_SLOTS_TMUX="off", AXF_CLAUDE_SETTINGS_FILE=str(Path(d) / "cs.json"), AXF_BUILD_LIMIT="off", AXF_PIPELINE_CONSOLE="off")
    s = srv.recovery_state()
    check(s.get("$axf") == "recovery-status@1" and s["settings"]["maxRetries"] == 3 and s["health"]["status"] == "ok", "GET recovery answers through the real CLI")
    r = asyncio.run(srv.recovery_run(Req({"dry_run": True})))
    check(r["ok"] and isinstance(r.get("actions"), list), "a dry run answers its plan")
    r = asyncio.run(srv.recovery_settings_set(Req({"maxRetries": 5, "fyi": False})))
    check(r["settings"]["maxRetries"] == 5 and r["settings"]["fyi"] is False, "settings saved as Claude settings builds.recovery.*")
    check(json.loads((Path(d) / "cs.json").read_text())["values"]["builds.recovery.maxRetries"] == 5, "the Claude settings document holds the key")
    try:
        asyncio.run(srv.recovery_retry("no-such-build", Req()))
        check(False, "an unknown build is a 404")
    except srv.HTTPException as e:
        check(e.status_code == 404, "an unknown build is a 404")
    p = srv.recovery_probe()
    check(p["status"] == "ok", "the probe answers the health@1 shape")

print(f"recovery routes: {n} checks passed")
