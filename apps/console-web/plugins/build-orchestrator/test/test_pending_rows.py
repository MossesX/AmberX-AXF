"""Pending rows parity (pending-rows-view@1, build pending-tab-one-collapsed-row-per-2).

    python apps/console-web/plugins/build-orchestrator/test/test_pending_rows.py

One fixture Pending tab; the same sequence (list, expand, toggle, collapse, toggle, collapse-all) runs through
  - REST: GET /pending/rows, POST /pending/rows/<id>/<op>, POST /pending/rows/collapse-all (the plugin router);
  - MCP: the plugin commands pending-* planned by plugin-commands (commands.mjs plan) and run on their dispatched route;
  - CLI: orchestrator.mjs pending <op> [id] --json;
  - voice: the console actions build-orchestrator.pending-* mapped by pending-rows.mjs actionRoute() (the code the
    console action runs) onto the same router;
and every step must give the same expanded set and the same rows. Then the routes keep viewers apart.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from importlib import import_module
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
REPO = PLUGIN.parents[3]
sys.path.insert(0, str(PLUGIN.parents[1] / "server"))
sys.path.insert(0, str(PLUGIN.parent))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

srv = import_module("build-orchestrator.server")
app = FastAPI()
app.include_router(srv.router, prefix="/api/plugins/build-orchestrator")
client = TestClient(app)
PREFIX = "/api/plugins/build-orchestrator"
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


def row(i: str, title: str, done: int, total: int, **kw):
    steps = [{"id": f"s{k + 1}", "text": f"step {k + 1}", "model": "Fable" if k == 0 else "Opus", "estimate": "5 min", "done": k < done, "skip": False} for k in range(total)]
    return {"row": {"id": i, "title": title, "status": "pending", "priority": "High", "steps": {"done": done, "total": total, "left": total - done},
                    "needsApproval": False, "needsSplit": total == 0, "pipeline": None, "said": "short", "createdAt": "2026-11-15T09:00:00Z",
                    "updatedAt": "2026-11-15T10:00:00Z", "stepList": steps, "actions": ["archive", "delete"], **kw},
            "notes": [{"text": f"note on {i}", "at": "2026-11-15T10:00:00Z"}], "said": f"Brett said about {i}"}


tmp = Path(tempfile.mkdtemp())
fixture = tmp / "pending.json"
fixture.write_text(json.dumps([row("skins", "Skins", 1, 3), row("banner-widgets", "Banner widgets", 0, 0), row("grid-tokens", "Grid tokens", 2, 2)]))
os.environ["AXF_PENDING_FIXTURE"] = str(fixture)
os.environ.pop("AXF_VIEWER", None)

SEQ = [("rows", ""), ("expand", "skins"), ("toggle", "grid-tokens"), ("collapse", "skins"), ("toggle", "skins"), ("expand", "banner-widgets"), ("collapse-all", "")]


def fresh(name: str) -> None:
    d = tmp / name
    d.mkdir()
    os.environ["AXF_ORCH_DATA"] = str(d)


def norm(r: dict) -> dict:
    """What every interface must agree on (age is computed at call time, so it is compared separately)."""
    return {"viewer": r["viewer"], "expanded": r["expanded"], "count": r["count"],
            "rows": [{k: v for k, v in x.items() if k != "age"} for x in r["rows"]]}


def via_rest(op: str, bid: str) -> dict:
    if op == "rows":
        return client.get(f"{PREFIX}/pending/rows").json()
    if op == "collapse-all":
        return client.post(f"{PREFIX}/pending/rows/collapse-all", json={}).json()
    return client.post(f"{PREFIX}/pending/rows/{bid}/{op}", json={}).json()


def run_dispatch(d: dict) -> dict:
    if d["method"] == "GET":
        return client.get(d["path"], params=d.get("query") or {}).json()
    return client.post(d["path"], params=d.get("query") or {}, json=d.get("body") or {}).json()


def via_mcp(op: str, bid: str) -> dict:
    cmd = {"rows": "pending-rows", "collapse-all": "pending-collapse-all"}.get(op, f"pending-{op}")
    read = op == "rows"
    command = {"$axf": "control@1", "domain": "plugins", "op": "act", "action": "read" if read else "run",
               "target": "plugins.reads" if read else "plugins.commands", "path": f"build-orchestrator/{cmd}", "input": {"build": bid} if bid else {}}
    out = subprocess.run(["node", str(PLUGIN.parent / "plugin-commands" / "commands.mjs"), "plan"], input=json.dumps({"command": command}),
                         capture_output=True, text=True, cwd=REPO, timeout=60)
    planned = json.loads(out.stdout.strip().splitlines()[-1])
    assert planned.get("ok"), planned
    return run_dispatch(planned["dispatch"])


def via_cli(op: str, bid: str) -> dict:
    args = ["node", str(PLUGIN / "orchestrator.mjs"), "pending", op, *([bid] if bid else []), "--json"]
    out = subprocess.run(args, capture_output=True, text=True, cwd=REPO, timeout=60)
    return json.loads(out.stdout.strip().splitlines()[-1])


def via_voice(op: str, bid: str) -> dict:
    spec = f"build-orchestrator.pending-{op}" + (f":{bid}" if bid else "")
    code = f"import('{(PLUGIN / 'pending-rows.mjs').as_posix()}').then((m) => console.log(JSON.stringify(m.actionRoute({json.dumps(spec)}))))"
    out = subprocess.run(["node", "-e", code], capture_output=True, text=True, cwd=REPO, timeout=60)
    route = json.loads(out.stdout.strip())
    assert route, spec
    return run_dispatch({"method": route["method"], "path": f"{PREFIX}/{route['path']}"})


results: dict[str, list[dict]] = {}
for name, fn in (("rest", via_rest), ("mcp", via_mcp), ("cli", via_cli), ("voice", via_voice)):
    fresh(name)
    results[name] = [norm(fn(op, bid)) for op, bid in SEQ]

# `expanded` lists the open rows in the tab's order (skins, banner-widgets, grid-tokens)
want = [[], ["skins"], ["skins", "grid-tokens"], ["grid-tokens"], ["skins", "grid-tokens"], ["skins", "banner-widgets", "grid-tokens"], []]
check([r["expanded"] for r in results["rest"]] == want, "REST: list, expand, toggle, collapse, toggle, expand, collapse all give the expected expanded set")
for name in ("mcp", "cli", "voice"):
    check(results[name] == results["rest"], f"{name.upper()} gives the same state as REST at every step")
first = results["rest"][1]["rows"][0]
check(first["id"] == "skins" and first["why"] == "waiting for Queue" and first["steps"] == {"done": 1, "total": 3} and first["expanded"], "a row carries its summary and expanded flag")
check(results["rest"][0]["rows"][1]["why"] == "no steps yet", "why pending is derived (no steps yet)")
check(first["said"] == "Brett said about skins" and first["notes"][0]["text"] == "note on skins", "the expanded body carries what Brett said and the notes")

# per viewer: viewer A expanded does not expand for viewer B (body, query and header all name the viewer)
fresh("viewers")
a = client.post(f"{PREFIX}/pending/rows/skins/expand", json={"viewer": "viewer-a"}).json()
check(a["viewer"] == "viewer-a" and a["expanded"] == ["skins"], "viewer A expands skins")
b = client.get(f"{PREFIX}/pending/rows", params={"viewer": "viewer-b"}).json()
check(b["expanded"] == [] and not any(r["expanded"] for r in b["rows"]), "viewer B sees every row collapsed")
b2 = client.post(f"{PREFIX}/pending/rows/grid-tokens/toggle", headers={"x-axf-viewer": "viewer-b"}, json={}).json()
check(b2["expanded"] == ["grid-tokens"], "viewer B (header) toggles its own row")
a2 = client.get(f"{PREFIX}/pending/rows", params={"viewer": "viewer-a"}).json()
check(a2["expanded"] == ["skins"], "viewer A still has only skins open")
client.post(f"{PREFIX}/pending/rows/collapse-all", json={"viewer": "viewer-a"})
check(client.get(f"{PREFIX}/pending/rows", params={"viewer": "viewer-b"}).json()["expanded"] == ["grid-tokens"], "collapse all for A leaves B alone")
stored = json.loads((tmp / "viewers" / "pending-rows.json").read_text())
check(set(stored["viewers"]) == {"viewer:viewer-a", "viewer:viewer-b"}, "the state file keys each viewer")

# guards
check(client.post(f"{PREFIX}/pending/rows/nope/expand", json={}).status_code == 404, "a build not in Pending is 404")
check(client.post(f"{PREFIX}/pending/rows/Bad..Id!/expand", json={}).status_code == 400, "a bad build id is 400")
check(client.post(f"{PREFIX}/pending/rows/skins/explode", json={}).status_code in (404, 405), "an unknown op is refused")

# console-focus@1: row:<build> names a build on the orchestrator
focus = srv.ConsoleFocus()
focus.ids = lambda: {"skins"}  # type: ignore[method-assign]
check(focus.resolve("row:skins") == {"screen": "build-orchestrator", "focus": "skins", "explicit": True}, "console_show row:<build> resolves to the orchestrator")
check(focus.resolve("row:unknown") is None, "row:<id> that is not a build is left to other screens")

print(f"pending rows parity: {n} checks passed")
