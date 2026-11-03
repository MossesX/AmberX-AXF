"""Self-test of the Builds page server part: python apps/console-web/plugins/builds-page/test.py

Runs the real routes (FastAPI TestClient) against a scratch builds store (AXF_BUILDS_STORE), so the repo's store is
never touched: state, ops (rename refused when empty, id unchanged), draft → apply, draft → discard, propose, divide.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
tmp = Path(tempfile.mkdtemp(prefix="builds-page-"))
os.environ["AXF_BUILDS_STORE"] = str(tmp / "store.json")
os.environ["AXF_BUILD_PROFILE"] = "main-framework"
os.environ.pop("AXF_ORCH_FILE", None)
os.environ.pop("AXF_PENDING_FILE", None)

# a scratch store with one build of three steps (written through the framework store, as the orchestrator does)
build = {"id": "demo", "title": "Demo", "steps": [{"id": "s1", "text": "add the menu item", "estimate": "10 min"}, {"id": "s2", "text": "fix the banner colour", "estimate": "10 min"}, {"id": "s3", "text": "remove the old page; update docs", "estimate": "20 min"}]}
seed = ("const c = await import('./framework/plan/builds-store-core.mjs'); const io = await import('./framework/cli/builds-store.mjs');"
        f"io.withStore((s) => {{ const o = c.projectOrchestrator(s, 'main-framework'); o.builds.push({json.dumps(build)}); return c.absorbOrchestrator(s, 'main-framework', o); }}, {{ by: 'test' }});")
subprocess.run(["node", "--input-type=module", "-e", seed], cwd=ROOT, check=True, capture_output=True)

sys.path.insert(0, str(HERE.parent.parent / "server"))
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

sys.path.insert(0, str(HERE))
import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("builds_page_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/builds-page")
c = TestClient(app)
P = "/api/plugins/builds-page"
n = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global n
    if not ok:
        print(f"  ✗ {name} {detail}")
        sys.exit(1)
    n += 1
    print(f"  ✓ {name}")


s = c.get(f"{P}/state").json()
check("state lists the build with its steps and progress", s["ok"] and s["builds"][0]["id"] == "demo" and len(s["builds"][0]["steps"]) == 3 and s["progress"]["total"] == 3, s)
uids = [x["uid"] for x in s["builds"][0]["steps"]]
check("step kinds read from the text", [x["kind"] for x in s["builds"][0]["steps"]] == ["creation", "fix", "removal"], s["builds"][0]["steps"])
r = c.post(f"{P}/ops", json={"ops": [{"op": "rename-build", "id": "demo", "title": "  "}]}).json()
check("empty rename refused", r["ok"] is False and "name" in r["error"], r)
r = c.post(f"{P}/ops", json={"ops": [{"op": "rename-build", "id": "demo", "title": "Renamed"}]}).json()
check("rename keeps the id", r["builds"][0]["id"] == "demo" and r["builds"][0]["title"] == "Renamed", r)
r = c.post(f"{P}/draft", json={"op": {"op": "reorder-steps", "build": "demo", "uids": [uids[2], uids[0], uids[1]]}}).json()
check("a draft shows the preview and the count", r["draft"]["count"] == 1 and r["builds"][0]["steps"][0]["uid"] == uids[2], r["draft"])
r = c.post(f"{P}/discard", json={}).json()
check("discard drops it", r["draft"]["count"] == 0 and r["builds"][0]["steps"][0]["uid"] == uids[0], r["draft"])
c.post(f"{P}/draft", json={"op": {"op": "rename-step", "build": "demo", "uid": uids[1], "title": "Banner colour"}})
r = c.post(f"{P}/apply", json={}).json()
check("apply writes it", r["draft"]["count"] == 0 and r["builds"][0]["steps"][1]["title"] == "Banner colour", r)
p = c.post(f"{P}/propose", json={"uids": uids, "n": 2}).json()
check("split into 2: every step in exactly one proposal, each named", p["ok"] and len(p["builds"]) == 2 and sorted(u for b in p["builds"] for u in b["uids"]) == sorted(uids) and all(b["title"] for b in p["builds"]), p)
d = c.post(f"{P}/divide", json={"build": "demo", "uid": uids[2]}).json()
check("divide proposes parts for a step with several", d["ok"] and d["can"] and len(d["parts"]) == 2, d)
d = c.post(f"{P}/divide", json={"build": "demo", "uid": uids[0]}).json()
check("divide says why a single change can't be split", d["ok"] and not d["can"] and d["why"], d)
r = c.post(f"{P}/draft", json={"op": {"op": "harvest", "from": [{"build": "demo", "uid": uids[2]}], "into": [{"title": "Cleanup", "uids": [uids[2]]}]}}).json()
r = c.post(f"{P}/apply", json={}).json()
check("harvest makes a new build and refactors the source", any(b["id"] == "cleanup" for b in r["builds"]) and len(next(b for b in r["builds"] if b["id"] == "demo")["steps"]) == 2, [b["id"] for b in r["builds"]])
r = c.post(f"{P}/draft", json={"op": {"op": "restore-default", "id": "demo"}}).json()
r = c.post(f"{P}/apply", json={}).json()
check("restore default brings the harvested step back", len(next(b for b in r["builds"] if b["id"] == "demo")["steps"]) == 3, r["builds"])
b = next(b for b in r["builds"] if b["id"] == "demo")
check("every build carries the views' fields (time, cost, model, summary, phases)", b["minutes"] == 40 and b["cost"] > 0 and b["model"] == "Opus" and b["phases"][0]["uids"] and "plan" in b and "pending" in b, {k: b.get(k) for k in ("minutes", "cost", "model", "phases")})
u0 = b["steps"][0]["uid"]
r = c.post(f"{P}/ops", json={"ops": [{"op": "step-done", "build": "demo", "uid": u0, "done": True}]}).json()
check("a step ticks at once (no draft)", r["draft"]["count"] == 0 and next(b for b in r["builds"] if b["id"] == "demo")["steps"][0]["done"] is True, r.get("error"))
r = c.post(f"{P}/ops", json={"ops": [{"op": "hide", "ids": ["cleanup"]}, {"op": "note", "id": "demo", "text": "from the grid"}, {"op": "set-status", "ids": ["demo"], "status": "blocked"}]}).json()
d = next(b for b in r["builds"] if b["id"] == "demo")
check("hide, note and status from the toolbar", next(b for b in r["builds"] if b["id"] == "cleanup")["hidden"] and d["status"] == "blocked" and d["notes"][-1]["text"] == "from the grid", r.get("error"))
r = c.post(f"{P}/ops", json={"ops": [{"op": "delete", "ids": ["cleanup"]}]}).json()
check("delete takes it off the list (soft, journalled)", not any(b["id"] == "cleanup" for b in r["builds"]), [b["id"] for b in r["builds"]])
r = c.post(f"{P}/ops", json={"ops": [{"op": "archive", "ids": []}]}).json()
check("a toolbar op with nothing selected is refused", r["ok"] is False and "select" in r["error"], r)
check("bad profile id refused", c.get(f"{P}/state", params={"profile": "../x"}).status_code == 400)
check("journal has every write", sum(len(f.read_text().splitlines()) for f in (tmp / "store.journal").glob("*.jsonl")) >= 6)
# every view and the immediate commands by name (control@1 plugins domain lists these routes)
for v in ("pending", "queue", "plan", "tracker", "orchestrator", "steps"):
    r = c.get(f"{P}/view/{v}", params={"filter": "all"}).json()
    check(f"view {v} reads", r.get("ok") and r["view"] == v and isinstance(r["rows"], list), r.get("error"))
r = c.get(f"{P}/view/steps", params={"build": "demo"}).json()
check("steps view of one build lists its steps", [x["id"] for x in r["rows"]][:1] == ["s1"] and all(x["build"] == "demo" for x in r["rows"]), r)
r = c.get(f"{P}/view/orchestrator", params={"build": "demo"}).json()
check("orchestrator view nests phases", r["rows"] and r["rows"][0]["phases"] and "switch" in r["rows"][0]["phases"][0], r)
check("an unknown view is a 404", c.get(f"{P}/view/nope").status_code == 404)
check("an unknown filter is refused", c.get(f"{P}/view/pending", params={"filter": "x"}).status_code == 400)
r = c.post(f"{P}/tick", json={"build": "demo", "step": "s2"}).json()
check("tick by step id", r.get("ok") and any("s2 done" in x for x in r["log"]), r)
r = c.post(f"{P}/tick", json={"build": "demo", "step": "s9"}).json()
check("tick of a missing step is refused", r["ok"] is False and "no step" in r["error"], r)
r = c.post(f"{P}/note", json={"id": "demo", "text": "by name"}).json()
check("note by name", r.get("ok"), r)
r = c.post(f"{P}/status", json={"ids": ["demo"], "status": "running"}).json()
check("status by name", r.get("ok") and any("running" in x for x in r["log"]), r)
r = c.post(f"{P}/archive", json={"ids": ["demo"]}).json()
check("archive by name", r.get("ok"), r)
r = c.post(f"{P}/unhide", json={"ids": ["demo"]}).json()
check("unhide by name", r.get("ok"), r)
r = c.post(f"{P}/ops", json={"ops": [{"op": "approve", "id": "demo", "phase": 1, "from": "Opus", "to": "Fable"}]}).json()
check("a model switch can't be approved from the Builds page", r["ok"] is False and "unknown op" in r["error"], r)
check("delete by name: a bad id is refused", c.delete(f"{P}/build/..%2Fx").status_code in (400, 404))
r = c.delete(f"{P}/build/demo").json()
check("delete by name (soft)", r.get("ok") and any("deleted demo" in x for x in r["log"]), r)
print(f"all {n} checks passed")
