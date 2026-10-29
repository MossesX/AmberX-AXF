#!/usr/bin/env python3
"""Self-test for the Feature matrix plugin's server part: manifest, routes against a fake CLI runner and a fake
axf.changes@1 (no delete route, bad ids refused, change-log entries read and written through the capability), then the
node self-test (test.mjs).

    python3 apps/console-web/plugins/feature-matrix/test.py
"""
from __future__ import annotations

import asyncio
import json
import shutil
import subprocess
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


class Req:
    def __init__(self, data):
        self._b = json.dumps(data).encode()

    async def body(self):
        return self._b


print("feature-matrix self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.feature-matrix" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/feature-matrix", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["opens"] == "main" and "axf.changes@1" in man["optional"], "model recorded, opens in the main area, changes service optional")
src = (HERE / "server" / "__init__.py").read_text("utf-8")
check("@router.delete" not in src and "codebase-changes" not in src, "no delete route; never names the changes plugin")

services: dict = {}
sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: services.get(name))
try:
    import fastapi  # noqa: F401
except ImportError:
    print("  - server checks skipped (no fastapi)")
else:
    sys.path.insert(0, str(HERE))
    import server as srv  # noqa: E402
    from fastapi import HTTPException

    calls: list = []

    def fake_run(*args):
        calls.append(args)
        if args[0] == "apply":
            arg = json.loads(args[1])
            return {"ok": True, "report": {"summary": "x"}, "log": [], "change": {"id": "c", "steps": [{"text": "a", "state": "skipped", "fm": "a"}], "estimate": {"minutes": 5}} if "change" in arg else None}
        return {"ok": True, "args": list(args)}

    srv._run = fake_run
    run = asyncio.run

    def refused(fn, code, msg):
        try:
            run(fn()) if asyncio.iscoroutinefunction(fn) else fn()
            check(False, msg)
        except HTTPException as e:
            check(e.status_code == code, msg)

    check(srv.state()["args"] == ["state"], "GET state runs the CLI")
    check(srv.matrix("refactor:orchestrator:refactor-all")["args"] == ["get", "refactor:orchestrator:refactor-all"], "GET matrix?id=")
    refused(lambda: srv.matrix("../etc"), 400, "a bad matrix id is refused")
    for action in ("remove", "remove-item", "delete"):
        refused(lambda a=action: run(srv.act(Req({"action": a, "matrix": "x:orchestrator:y"}))), 400, f"act {action} refused (nothing is ever deleted)")
    r = run(srv.act(Req({"action": "skip", "matrix": "refactor:orchestrator:b", "item": "s1"})))
    check(r["args"][0] == "act" and json.loads(r["args"][1])["action"] == "skip", "act passes the change through")
    r = run(srv.seed(Req({"ref": {"kind": "change", "id": "chg-20261029-abcdef12"}})))
    check(r["ok"] is False, "seeding a change matrix without the changes service says so")

    stored: dict = {}

    class Fake:
        def get(self, cid):
            return {"id": cid, "title": "T", "steps": [{"text": "a", "state": "queued"}]} if cid == "chg-20261029-abcdef12" else None

        def update(self, cid, patch):
            stored[cid] = patch
            return {"id": cid, **patch}

    services["axf.changes@1"] = Fake()
    r = run(srv.seed(Req({"ref": {"kind": "change", "id": "chg-20261029-abcdef12"}})))
    check(json.loads(r["args"][1])["change"]["title"] == "T", "seed reads the change entry through axf.changes@1")
    r = run(srv.apply(Req({"matrix": "refactor:change:chg-20261029-abcdef12"})))
    check(stored.get("chg-20261029-abcdef12", {}).get("steps", [{}])[0].get("state") == "skipped" and "change" not in r, "apply writes the change entry back through the capability")
    refused(lambda: run(srv.apply(Req({"matrix": "nope"}))), 400, "apply refuses a bad matrix id")
    refused(lambda: run(srv.import_all(Req({"profile": "../x"}))), 400, "import refuses a bad profile id")

node = shutil.which("node")
if not node:
    print("  - node self-test skipped (no node)")
else:
    out = subprocess.run([node, str(HERE / "test.mjs")], capture_output=True, text=True, timeout=300)
    check(out.returncode == 0, f"node self-test: {(out.stdout or out.stderr).strip().splitlines()[-1] if (out.stdout or out.stderr).strip() else 'no output'}")
print(f"all {ok} checks passed")
