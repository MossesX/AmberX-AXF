"""Send to emergency is Brett's own signed-in console only (Nov 20 2026): the console's two ways in.

  python3 apps/console-web/plugins/build-orchestrator/server/test_emergency.py

1. Build orchestrator: POST /pipeline/emergency {id}.
2. Plan Studio 2.0: POST /emergency {id} (found by its plan-tree@1 capability, never by folder name; skipped when that
   plugin is not installed).
Both take the request only from a signed-in hub admin's session with no agent header. The console token (what MCP, REST
commands, voice and every session hold), a non-admin and a request naming an agent get 403 and nothing is tagged or
granted. Runs the real CLIs against a scratch builds store, slots folder and plan tree.
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
sys.path.insert(0, str(ROOT / "apps/console-web/server"))
sys.path.insert(0, str(HERE.parent.parent))

from fastapi import HTTPException  # noqa: E402

AGENT_ENV = ("CLAUDECODE", "CLAUDE_CODE_ENTRYPOINT", "AI_AGENT", "AXF_SURFACE", "AXF_SESSION", "AXF_APPROVER", "AXF_APPROVER_VIA", "AXF_BUILD_ID")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1


class Req:
    def __init__(self, via: str, body: dict | None = None, admin: bool = True, headers: dict[str, str] | None = None):
        self.state = SimpleNamespace(axf_user=SimpleNamespace(name="Brett", via=via, admin=admin))
        self.headers = {k.lower(): v for k, v in (headers or {}).items()}
        self._body = json.dumps(body or {}).encode()

    async def body(self) -> bytes:
        return self._body

    async def json(self) -> dict:
        return json.loads(self._body)


def call(fn, req: Req) -> tuple[int, dict | str]:
    try:
        return 200, asyncio.run(fn(req))
    except HTTPException as e:
        return e.status_code, str(e.detail)


with tempfile.TemporaryDirectory() as d:
    for k in AGENT_ENV:
        os.environ.pop(k, None)
    store = Path(d) / "store.json"
    slots = Path(d) / "slots"
    os.environ.update(AXF_BUILDS_STORE=str(store), AXF_SLOTS_DIR=str(slots), AXF_PLAN_TREE_DIR=str(Path(d) / "tree"), AXF_BUILDS_LIVE="0", AXF_BUILD_HOOKS="off",
                      AXF_BUILDS_EXPORT="0", AXF_DATA_DIR="off", AXF_SHIPPED="off", AXF_CREW_SAY="off")
    srv = import_module("build-orchestrator.server")

    def build(bid: str) -> dict:
        return next(b for b in json.loads(store.read_text())["builds"] if b["id"] == bid)

    def grants() -> list[str]:
        f = slots / "build-limit-emergency.json"
        return [g["id"] for g in json.loads(f.read_text())["builds"]] if f.exists() else []

    # a Pipeline 2.0 build to send, made the way Plan Studio makes one
    seed = ("import('./framework/cli/builds-store.mjs').then(async (BS) => { const core = await import('./framework/plan/builds-store-core.mjs'); const P2 = await import('./framework/core/pipeline-status.mjs');"
            " BS.withStore((s) => { for (const id of ['rush', 'calm']) s.builds.push(core.normBuild(P2.transition({ id, title: id, flow: P2.FLOW, steps: [] }, 'pending', { by: 'test' }).rec)); return s; }, { by: 'test' }); })")
    import subprocess
    p = subprocess.run(["node", "-e", seed], cwd=ROOT, capture_output=True, text=True, timeout=60)
    check(p.returncode == 0 and build("rush")["flow"] == "pipeline-2", f"scratch store seeded {p.stderr[-200:]}")

    # ---- Build orchestrator: POST /pipeline/emergency
    send = srv.pipeline_emergency
    for name, req in [
        ("the console token (MCP, REST commands, voice, sessions)", Req("token", {"id": "rush"})),
        ("a hub user who is not an admin", Req("session", {"id": "rush"}, admin=False)),
        ("a request naming an agent", Req("session", {"id": "rush"}, headers={"X-Axhub-Session": "agent:Vinny"})),
        ("a request from another source", Req("session", {"id": "rush"}, headers={"X-Axhub-Source": "mcp"})),
    ]:
        code, why = call(send, req)
        check(code == 403 and "Only Brett" in str(why), f"orchestrator: {name} is refused with 403")
    check("emergency" not in build("rush") and grants() == [], "orchestrator: after every refusal nothing is tagged and nothing is granted")
    code, res = call(send, Req("session", {"id": "rush"}))
    check(code == 200 and res["ok"] and res["emergency"]["by"] == "Brett" and not res["already"], "orchestrator: Brett's signed-in click sends it")
    check(build("rush")["emergency"]["by"] == "Brett" and grants() == ["rush"], "orchestrator: the build is tagged emergency and holds the emergency slot grant")
    code, res = call(send, Req("session", {"id": "rush"}, headers={"X-Axhub-Session": "console"}))
    check(code == 200 and res["already"], "orchestrator: the console's own header is fine; sending twice changes nothing")
    code, why = call(send, Req("session", {"id": "nope"}))
    check(code == 400 and "no build" in str(why), "orchestrator: Brett, but no such build: 400")
    code, why = call(send, Req("session", {"id": "Bad Id"}))
    check(code == 400, "orchestrator: a bad build id: 400")
    # a session that sets the approver variables itself and calls the CLI is refused by the CLI
    p = subprocess.run(["node", str(srv.EMERGENCY_CLI), "send", "calm", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60,
                       env={**os.environ, "AXF_APPROVER": "Brett", "AXF_APPROVER_VIA": "console", "CLAUDECODE": "1"})
    check(p.returncode == 3 and "only Brett" in p.stdout and "emergency" not in build("calm"), "the CLI: a Claude session setting the approver itself is refused (exit 3)")
    p = subprocess.run(["node", str(srv.EMERGENCY_CLI), "send", "calm", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60, env=dict(os.environ))
    check(p.returncode == 3 and grants() == ["rush"], "the CLI: a bare call is refused (exit 3)")
    lst = srv.pipeline_emergency_list(Req("token"))
    check([b["id"] for b in lst["builds"]] == ["rush"] and lst["builds"][0]["granted"] and lst["canSend"] is False, "anyone with the console token may read the emergency builds; canSend false")
    check(srv.pipeline_emergency_list(Req("session"))["canSend"] is True, "canSend true in Brett's signed-in console")
    code, res = call(srv.pipeline_emergency_clear, Req("token", {"id": "rush"}))
    check(code == 200 and res["cleared"] and "emergency" not in build("rush") and grants() == [], "clear: back to an ordinary build (it only removes a privilege)")

    # ---- Plan Studio 2.0: POST /emergency (the plugin that provides plan-tree@1)
    plan = None
    for f in sorted((HERE.parent.parent).iterdir()):
        m = f / "plugin.json"
        if m.exists() and "service:plan-tree@1" in json.loads(m.read_text()).get("provides", []) and (f / "server" / "__init__.py").exists():
            plan = import_module(f"{f.name}.server")
    if plan is None:
        print("(no plugin provides plan-tree@1 here: its Send to emergency is not checked)")
    else:
        item = plan.run({"op": "add", "kind": "plan", "title": "Hot fix now", "body": "Fix the thing that is broken.", "by": "test"})["item"]["id"]
        for name, req in [
            ("the console token", Req("token", {"id": item})),
            ("a hub user who is not an admin", Req("session", {"id": item}, admin=False)),
            ("a request naming an agent", Req("session", {"id": item}, headers={"X-Axhub-Session": "agent:Vinny"})),
        ]:
            code, why = call(plan.emergency, req)
            check(code == 403 and "Only Brett" in str(why), f"plan studio: {name} is refused with 403")
        before = {b["id"] for b in json.loads(store.read_text())["builds"]}
        # the ordinary send route never takes the emergency flag (the body's flag is dropped)
        r = plan.run({"op": "build", "id": item, "emergency": True, "by": "someone"})
        check(not r.get("ok") and r.get("code") == "forbidden" and {b["id"] for b in json.loads(store.read_text())["builds"]} == before, "plan studio: the CLI without Brett's click sends nothing at all (no ordinary build slips through)")
        code, res = call(plan.emergency, Req("session", {"id": item, "buildId": "hot-fix-now"}))
        check(code == 200 and res["ok"] and res["emergency"] is True and res["build"]["id"] == "hot-fix-now", f"plan studio: Brett's signed-in click sends it as an emergency build {res}")
        b = build("hot-fix-now")
        check(b["flow"] == "pipeline-2" and b["status"] == "pending" and b["emergency"]["by"] == "Brett" and grants() == ["hot-fix-now"], "plan studio: one pending Pipeline 2.0 build, tagged emergency, with the slot grant")
        item2 = plan.run({"op": "add", "kind": "plan", "title": "Ordinary work", "body": "Nothing urgent.", "by": "test"})["item"]["id"]
        code, res = call(plan.build, Req("token", {"id": item2, "emergency": True, "buildId": "ordinary-work"}))
        check(code == 200 and "emergency" not in build("ordinary-work") and grants() == ["hot-fix-now"], "plan studio: POST /build ignores an emergency flag in the body (an ordinary build)")
        # plans@1 from the same plugin: the tree's plans with the build each was sent as (the orchestrator's priority rows read this)
        plans = plan.PlansService()
        rows = {p["id"]: p for p in plans.list()}
        check(rows[item]["build"] == {"id": "hot-fix-now"} and rows[item2]["build"] == {"id": "ordinary-work"} and plans.get(item)["title"] == "Hot fix now" and plans.get("nope") is None, "plans@1: list / get carry the linked build")
        parked = plans.park("Do it later", "A parked idea", by="test")
        check(parked["ok"] and parked["item"]["status"] == "parked" and parked["item"]["kind"] == "plan" and not any(b["id"] == "do-it-later" for b in json.loads(store.read_text())["builds"]), "plans@1 park: a parked plan, never a build")

print(f"send to emergency (console only): {n} checks passed")
