#!/usr/bin/env python3
"""Self-test for the Feature assistant (scripted fake AXF expert + Mosses; the real build engine on a scratch copy of
the shared data, so the repo is never touched).

    python3 apps/console-web/plugins/feature-assist/test.py

Checks the requirements gate, drafting (cleaned: unknown ids dropped, bad kinds/models fixed), approving into the plan
(sub-features under their parent, unique ids, pending list with the right model), Build with Mosses (plan, prerequisites
moved ahead in the build order, refused on built features), parking for Fable, Opus now + Fable later, the chat
hand-off (agent, plan, Anthropic profile + model), and marking built / partial.
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_FEATURE_ASSIST_DIR"] = tempfile.mkdtemp(prefix="axf-fa-test-")
os.environ["AXF_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-fa-data-")  # the engine writes plan/pending/queue here
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.feature_assist_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


before = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "framework", "tracker.json"], capture_output=True, text=True).stdout
plan = mod.engine("plan")["features"]
queue = mod.engine("build-queue")["view"]
order = queue["order"]
# a queue step that isn't built, and a later one that isn't built either: Mosses will name the later one as a prerequisite
unbuilt = [s["id"] for s in queue["steps"] if s["status"] != "built"]
target, later = unbuilt[0], unbuilt[-1]
built = next(f["id"] for f in plan if f["status"] == "built")


class FakeLlm:
    calls: list = []

    def profiles(self):
        return [{"id": "oa", "kind": "openai", "keyReady": True}, {"id": "claude", "kind": "anthropic", "keyReady": True}]

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        text = messages[-1]["content"]
        self.calls.append({"system": system, "text": text})
        if "plain words" in text:
            return {"text": "Here you go:\n" + json.dumps({"features": [
                {"title": "Photo backup to the VPS", "summary": "Back up phone photos and browse them.", "area": "Plugins & apps", "kind": "epic",
                 "parent": "no-such-id", "dependsOn": [built, "made-up"], "ports": {"web": "planned", "android": "planned", "ios": "x"}, "acceptance": ["photos upload"],
                 "priority": "P1", "model": "opus", "modelReason": "servers", "where": "plugin",
                 "subFeatures": [{"title": "Albums", "summary": "Group photos.", "kind": "weird", "model": "gpt", "priority": "P9"}]},
            ], "clashes": [{"text": "Overlaps the media library", "featureId": built}], "notes": "Decide where originals live."}), "model": "fake"}
        if "Plan how to build" in text:
            return {"text": json.dumps({"summary": "Do it.", "steps": ["read", "write", "test"], "files": ["a.ts"], "modules": ["m"],
                                        "prerequisites": [later, "nope"], "risks": ["none"], "model": "opus", "modelReason": "security"}), "model": "fake"}
        return {"text": "{}", "model": "fake"}


class FakeAgents:
    def get_agent(self, aid):
        return {"id": aid, "name": {"axf-expert": "AXF expert", "coder": "Mosses"}.get(aid, aid), "system_prompt": f"You are {aid}."} if aid in ("axf-expert", "coder") else None

    def memory_context(self, aid, q):
        return "- the plan lives in framework/plan/plan.json" if aid == "axf-expert" else ""


print("feature-assist self-test")
s = c.get("/p/status").json()
check(not s["describe"] and not s["build"], "hidden without the assistant and agents")
check(c.post("/p/draft", json={"text": "x"}).status_code == 409, "drafting needs the AXF expert")
llm = FakeLlm()
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
plugin_services.provide("axf.agents@1", FakeAgents(), "fake-agents")
s = c.get("/p/status").json()
check(s["describe"] and s["build"] and s["expertName"] == "AXF expert" and s["mossesName"] == "Mosses", "ready with the assistant, AXF expert and Mosses")

d = c.post("/p/draft", json={"text": "back up my photos to the VPS"}).json()
f0 = d["features"][0]
check(f0["parent"] == "" and f0["dependsOn"] == [built], "unknown ids dropped from parent / dependsOn")
check(set(f0["ports"]) == {"web", "android"}, "unknown ports dropped")
sub = f0["subFeatures"][0]
check(sub["kind"] == "feature" and sub["model"] == "opus" and sub["priority"] == "P2", "bad kind / model / priority fixed")
check(d["clashes"][0]["featureId"] == built and d["notes"], "clashes and notes come through")
check("You are axf-expert" in llm.calls[-1]["system"] and "plan.json" in llm.calls[-1]["system"] and built in llm.calls[-1]["text"], "the AXF expert gets its memory and the plan index")
check(c.post("/p/draft", json={"text": ""}).status_code == 400, "empty description refused")

f0["title"] = "Photo backup (edited)"
r = c.post("/p/approve", json={"features": [f0], "pending": True}).json()
check(len(r["saved"]) == 2 and r["saved"][0] == "u.photo-backup-edited" and len(r["pending"]) == 2, "approved: epic + sub-feature saved, both on the pending list")
plan2 = {f["id"]: f for f in mod.engine("plan")["features"]}
check(plan2[r["saved"][1]]["parent"] == r["saved"][0] and plan2[r["saved"][0]]["status"] == "planned", "sub-feature under its parent; status planned")
pend = mod.engine("pending")
pi = next(i for i in pend["items"] if i.get("planId") == r["saved"][0])
check(pi["model"] == "Opus", "pending item carries the model")
r2 = c.post("/p/approve", json={"features": [f0], "pending": False}).json()
check(r2["saved"][0] == "u.photo-backup-edited-2" and not r2["pending"], "ids stay unique; pending is optional")

# Build with Mosses
check(c.post("/p/build/plan", json={"featureId": built}).status_code == 400, "built features can't be built again")
bp = c.post("/p/build/plan", json={"featureId": target}).json()
check(bp["plan"]["steps"] == ["read", "write", "test"] and bp["plan"]["prerequisites"][0] == later and "nope" not in bp["plan"]["prerequisites"], "Mosses plans; unknown prerequisites dropped")
check(bp["order"]["changed"] and bp["order"]["after"].index(later) < bp["order"]["after"].index(target) and later in bp["order"]["moved"], "prerequisite moved ahead in the build order")
check(bp["model"]["recommend"] == "opus", "model recommendation")
park = c.post("/p/build/start", json={"featureId": target, "plan": bp["plan"], "model": "fable", "park": True}).json()
check(park["parked"] and mod.engine("pending")["items"][-1]["model"] == "Fable", "Fable = parked on the pending list")
st = c.post("/p/build/start", json={"featureId": target, "plan": bp["plan"], "model": "opus", "fableLater": True, "order": bp["order"]["after"]}).json()
check(not st["parked"] and len(st["pending"]) == 1, "Opus now + Fable later adds the Fable rebuild")
rebuild = mod.engine("pending")["items"][-1]
check(rebuild["model"] == "Fable" and "uninstall script" in rebuild["detail"], "…which starts by running the Opus version's uninstall")
q2 = mod.engine("build-queue")["view"]["order"]
check(q2.index(later) < q2.index(target), "approved order applied")
chat = st["chat"]
check(chat["agentId"] == "coder" and "read" in chat["message"] and chat["profile"] == "claude" and chat["model"] == "claude-opus-5-5", "chat hand-off: Mosses, the plan, an Anthropic profile + the picked model")
fplan = {f["id"]: f for f in mod.engine("plan")["features"]}[target]
check(fplan["model"] == "opus" and fplan["modelEdited"], "model recorded on the feature")
check(target in c.get("/p/status").json()["building"], "feature shows as being built")
check(c.post("/p/build/finish", json={"featureId": target, "status": "done"}).status_code == 400, "finish status is built or partial")
c.post("/p/build/finish", json={"featureId": target, "status": "partial", "notes": "tests left"})
fplan = {f["id"]: f for f in mod.engine("plan")["features"]}[target]
check(fplan["status"] == "partial" and "tests left" in fplan["notes"], "marked partial with notes")
check(target not in c.get("/p/status").json()["building"], "no longer building")
log = c.get("/p/builds").json()["items"]
check({e["op"] for e in log} >= {"describe", "park", "start", "finish"} and all("model" in e for e in log if e["op"] in ("start", "park")), "history records every step and model")
after = subprocess.run(["git", "-C", str(REPO), "status", "--porcelain", "framework", "tracker.json"], capture_output=True, text=True).stdout
check(after == before, "the repo's plan, queue and pending list were never touched (scratch data folder)")
print(f"all {ok} checks passed")
