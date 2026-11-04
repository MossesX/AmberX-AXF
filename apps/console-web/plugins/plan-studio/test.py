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

shutil.rmtree(scratch, ignore_errors=True)
print(f"plan-studio server: {ok} checks passed", flush=True)

# the node self-test (contract, CLI, parser, voice loop); test.mjs imports the .ts voice loop
node = ["node", "--experimental-strip-types"] if subprocess.run(["node", "--experimental-strip-types", "-e", "0"], capture_output=True).returncode == 0 else ["npx", "-y", "tsx"]
sys.exit(subprocess.run([*node, str(HERE / "test.mjs")]).returncode)
