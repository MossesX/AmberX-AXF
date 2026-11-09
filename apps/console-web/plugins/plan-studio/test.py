#!/usr/bin/env python3
"""Self-test for Plan Studio's server part: every route against a scratch plan store (never the repo or the hub), the AI
route with no provider and with a fake axf.llm@1 (fixed reply, no live model), the plans@1 capability, then the node
self-test (test.mjs: contract, CLI, parser, voice loop).

    python3 apps/console-web/plugins/plan-studio/test.py
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONSOLE = HERE.parents[1]
scratch = Path(tempfile.mkdtemp(prefix="plan-studio-py-"))
os.environ.update({"AXF_PLANS_DIR": str(scratch / "store"), "AXF_ORCH_FILE": str(scratch / "orch.json"), "AXF_DATA_DIR": str(scratch / "data")})
sys.path.insert(0, str(CONSOLE / "server"))
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


import plugin_services  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("plan_studio_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

s = c.get("/p/state").json()
check(s["ok"] and len(s["plans"]) >= 3 and s["store"] == os.environ["AXF_PLANS_DIR"], "state: the seed plans, from the scratch store")
check(any(p["id"] == "docs-studio" and p["status"] == "parked" for p in s["plans"]), "Docs Studio is a parked plan")
check(c.post("/p/api", json={"op": "state"}).status_code == 400, "api refuses ops outside its list")
saved = c.post("/p/api", json={"op": "save", "plan": {"title": "From the server", "status": "idea"}}).json()
check(saved["ok"] and saved["plan"]["createdBy"] == "console", "save: who saved it is recorded")
check(c.post("/p/api", json={"op": "save", "plan": {"title": "From the server"}}).json()["ok"] is False, "save: the duplicate check answers with the matches")
check(c.get("/p/ai/status").json()["available"] is False, "ai/status: no provider")
r = c.post("/p/ai", json={"text": "add a risk: fees", "plan": "docs-studio"}).json()
check(r["via"] == "rules" and r["summary"] == ["Risks + fees"], "ai: simple requests need no model")
r = c.post("/p/ai", json={"text": "figure out the rocket fuel", "plan": "docs-studio"}).json()
check(r.get("aiMissing") and r["ops"][0]["op"] == "ask", "ai: no provider = a plain answer pointing to the setup")


class FakeLlm:
    def profiles(self):
        return [{"id": "x", "label": "X", "defaultModel": "m"}]

    def complete(self, messages, system=None, **_k):
        assert "ONE JSON object" in (system or "") and "Docs Studio" in messages[0]["content"]
        return {"text": '{"ops":[{"op":"add","list":"questions","item":{"text":"Which fuel?"}}],"reply":"ok"}', "model": "fake"}


plugin_services.provide("axf.llm@1", FakeLlm(), "fake-provider")
check(c.get("/p/ai/status").json()["available"] is True, "ai/status: a provider is there")
r = c.post("/p/ai", json={"text": "figure out the rocket fuel", "plan": "docs-studio"}).json()
check(r["via"] == "model" and r["model"] == "fake" and r["summary"] == ["Open questions + Which fuel?"], "ai: the model's reply becomes edits (not applied)")
check(c.post("/p/api", json={"op": "get", "id": "docs-studio"}).json()["plan"]["questions"] == [], "ai: nothing is saved until ai-apply")
ap = c.post("/p/api", json={"op": "ai-apply", "ops": r["ops"], "text": "figure out the rocket fuel", "plan": "docs-studio"}).json()
check(ap["saved"][0]["questions"][0]["text"] == "Which fuel?", "ai-apply saves the edits")
hist = c.post("/p/api", json={"op": "get", "id": "docs-studio"}).json()["history"]["versions"]
check(hist[-1]["note"] == "AI, from: figure out the rocket fuel", 'history says "AI, from: …"')
svc = plugin_services.get("plans@1")
check(svc is not None and svc.park("Later thing")["plan"]["status"] == "parked", 'plans@1: "put it in a plan for later" parks a plan')
check(len(c.get("/p/catalog").json()["entries"]) > 20, "catalog: every plugin, app and library")

# shipped-manifest@1 → the build's plan (what the orchestrator sends Shipped features reaches Plan Studio too)
MANIFEST = {
    "$axf": "shipped-manifest@1", "id": "sm-ship-it-py", "rev": 1, "source": "orchestrator", "shippedAt": "2026-11-09T01:00:00Z",
    "build": {"id": "ship-it-py", "title": "Ship it (py)", "profile": "all"},
    "said": {"text": "Make the shipping thing work. It has to be valid.", "verbatim": True},
    "brief": "# Build\n\nDo it.", "models": ["Opus"], "accounts": ["account-3"],
    "steps": [{"id": "s1", "text": "Do A", "model": "Opus", "estimate": "20 min", "startedAt": "2026-11-08T22:10:00Z", "doneAt": "2026-11-08T22:35:00Z", "done": True}],
    "branch": "claude/ship-it-py", "pr": {"number": 401}, "landedCommit": "661901740ba21f9767d70f7cf3c101c2e2c35a27", "mergedAt": "2026-11-09T00:06:38Z",
    "files": ["apps/console-web/plugins/plan-studio/plans.mjs"], "tests": [{"name": "test.py", "result": "pass"}], "cost": {"usd": 1.5, "tokens": {"input": 1, "output": 2}}, "report": "", "open": [],
}
check(c.post("/p/shipped", json={}).status_code == 400, "shipped: a manifest or a build id is required")
r = c.post("/p/shipped", json={"manifest": MANIFEST}).json()
check(r["ok"] and r["created"] and r["plan"]["id"] == "ship-it-py" and r["plan"]["shipped"]["id"] == "sm-ship-it-py" and r["plan"]["status"] == "done", "shipped: a valid manifest creates the build's plan, done, with the manifest on it")
check(r["plan"]["origin"]["said"] == MANIFEST["said"]["text"] and r["plan"]["actual"]["usd"] == 1.5 and r["plan"]["build"]["landedCommit"] == MANIFEST["landedCommit"], "shipped: Brett's words, actual cost and the landed commit are on the plan")
check(c.post("/p/shipped", json=MANIFEST).json().get("unchanged") is True, "shipped: the manifest posted as the body works too; same rev = unchanged")
g = c.get("/p/shipped/ship-it-py").json()
check(g["ok"] and g["summary"]["pr"] == 401 and g["problem"] is None and g["shipped"]["rev"] == 1, "shipped/{plan}: the manifest, its summary and no flag")
check(c.get("/p/shipped/no-such-plan").status_code == 404, "shipped/{plan}: 404 for an unknown plan")
bad = c.post("/p/shipped", json={"manifest": {"build": {"id": "ship-it-py-bad"}, "said": {"text": "w"}, "landedCommit": "zz", "models": ["Sonnet"]}}).json()
check(bad["ok"] is False and bad["refused"] and any(e["field"] == "models" for e in bad["errors"]) and "landedCommit must be a git sha" in bad["reason"], "shipped: an invalid manifest is refused with the field errors")
fl = c.get("/p/shipped/ship-it-py-bad").json()
check(fl["shipped"] is None and fl["problem"]["reason"] == bad["reason"], "shipped: the plan is flagged, nothing stored as its manifest")
check(c.post("/p/shipped/backfill", json={"since": "nope"}).status_code == 400, "shipped/backfill: since must be a date")
check(c.post("/p/shipped/backfill", json={"dry": True}).json()["ok"], "shipped/backfill: runs (no sidecars in the scratch data folder)")
log = c.get("/p/shipped-log").json()["entries"]
check(len(log) == 2 and log[0]["ok"] and log[1]["refused"], "shipped-log: one taken, one refused")
ck = c.get("/p/check-builds").json()
check(ck["ok"] and ck["plans"] == 1 and len(ck["warnings"]) == 1, "check-builds: green, the flagged plan is a warning")
check(svc.shipped({**MANIFEST, "rev": 2, "open": ["one thing"]}, by="other-plugin")["plan"]["shipped"]["rev"] == 2, "plans@1: another plugin can send a manifest (rev 2 applied)")

shutil.rmtree(scratch, ignore_errors=True)
print(f"plan-studio server: {ok} checks passed", flush=True)

# the node self-test (contract, CLI, parser, voice loop); test.mjs imports the .ts voice loop
node = ["node", "--experimental-strip-types"] if subprocess.run(["node", "--experimental-strip-types", "-e", "0"], capture_output=True).returncode == 0 else ["npx", "-y", "tsx"]
sys.exit(subprocess.run([*node, str(HERE / "test.mjs")]).returncode)
