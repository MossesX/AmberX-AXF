#!/usr/bin/env python3
"""Server self-test for the Demonstration Designer's cloud narrator routes (GET narrators, POST narrate) over a fake
axf.speech@1 provider. Run by test.mjs when python3 with fastapi is there.

    python3 apps/console-web/plugins/demonstration-designer/server_test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["AXF_DEMO_DESIGNER_DIR"] = tempfile.mkdtemp(prefix="axf-dd-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402
from fastapi import FastAPI, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

plugin_services.configure(lambda folder: True)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.demonstration_designer_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

ok = 0


def check(cond: bool, what: str) -> None:
    global ok
    if not cond:
        print(f"  ✗ {what}")
        sys.exit(1)
    ok += 1
    print(f"  ✓ {what}")


r = c.get("/p/narrators").json()
check(r["available"] is False and r["items"] == [] and "axf.speech@1" in r["why"], "no speech provider: no cloud narrators, and it says why")
check(c.post("/p/narrate", json={"narrator": "agent:molly", "text": "hi"}).status_code == 409, "no speech provider: narrate answers 409")

said: list[tuple[str, str, float]] = []


class FakeSpeech:
    max_text = 20

    def narrators(self):
        return [{"agentId": "molly", "name": "Molly", "provider": "openai", "voice": "nova"}, {"bad": 1}]

    def say(self, agent_id: str, text: str, rate: float | None = None) -> bytes:
        if agent_id != "molly":
            raise HTTPException(403, f"{agent_id} isn't allowed cloud voices")
        said.append((agent_id, text, rate))
        return b"ID3fake"


plugin_services.provide("axf.speech@1", FakeSpeech(), "fake-speech")
r = c.get("/p/narrators").json()
check(r["available"] and [i["value"] for i in r["items"]] == ["agent:molly"] and "Molly" in r["items"][0]["label"], "narrators listed as agent:<id>, bad rows dropped")
r = c.post("/p/narrate", json={"narrator": "agent:molly", "text": "  Meet the designer, the fastest pitch.  ", "speed": 9})
check(r.status_code == 200 and r.content == b"ID3fake" and r.headers["content-type"] == "audio/mpeg", "a line comes back as audio/mpeg")
check(said[-1][0] == "molly" and said[-1][2] == 2.0, "speed clamped to 2")
check(said[-1][1] == "Meet the designer, t", "text trimmed and cut to the provider's limit")
check(c.post("/p/narrate", json={"narrator": "agent:ghost", "text": "hi"}).status_code == 403, "the provider's refusal passes through")
check(c.post("/p/narrate", json={"narrator": "Samantha", "text": "hi"}).status_code == 400, "a device voice is not a cloud narrator")
check(c.post("/p/narrate", json={"narrator": "agent:../x", "text": "hi"}).status_code == 400, "a bad agent id is refused")
check(c.post("/p/narrate", json={"narrator": "agent:molly", "text": "  "}).status_code == 400, "empty text refused")
plugin_services.withdraw("fake-speech")
check(c.get("/p/narrators").json()["available"] is False, "provider removed: back to none")

# pipeline demos: list, one, timeline, filtered lines, match, link, save / copy / delete, the player state round trip
items = c.get("/p/pipelines").json()["items"]
check(len(items) >= 7 and any(i["id"] == "voice-to-app" and i["builtIn"] for i in items), "pipelines: the built-in library is listed")
check(c.get("/p/pipeline", params={"id": "skin-swap"}).json()["$axf"] == "pipeline-demo@1", "pipeline: one demo as pipeline-demo@1")
check(c.get("/p/pipeline", params={"id": "no-such"}).status_code == 404, "pipeline: unknown id is 404")
check(c.get("/p/pipeline", params={"id": "../x"}).status_code == 400, "pipeline: a bad id is 400")
t = c.get("/p/pipeline/timeline", params={"id": "auto-fix", "speed": 2}).json()
check(t["timeline"]["total"] > 0 and t["wallSeconds"] == t["timeline"]["total"] / 2 and t["demo"]["id"] == "auto-fix", "pipeline/timeline: the demo, its timeline and the length at speed")
lines = c.get("/p/pipeline/lines", params={"id": "parallel-split", "kind": "git"}).json()["items"]
check(lines and all(x["kind"] == "git" for x in lines), "pipeline/lines: filtered by kind")
check(c.get("/p/pipeline/match", params={"q": "run the voice-to-app demo"}).json()["id"] == "voice-to-app", "pipeline/match: the phrase names the demo")
check("axf-pipeline=auto-fix" in c.get("/p/pipeline/link", params={"id": "auto-fix", "play": True}).json()["url"], "pipeline/link: the deep link")
d = c.post("/p/pipeline/copy", json={"id": "approval-flow"}).json()
check(d["id"] == "approval-flow-copy" and not d["builtIn"], "pipeline/copy: an editable copy")
d["name"] = "Approvals, my way"
check(c.post("/p/pipeline", json={"demo": d}).json()["name"] == "Approvals, my way", "pipeline: save an edited demo")
check(c.post("/p/pipeline", json={"demo": {"name": "", "chapters": []}}).status_code == 400, "pipeline: an invalid demo is refused")
check(c.delete("/p/pipeline", params={"id": "approval-flow-copy"}).json()["removed"] == "approval-flow-copy", "pipeline: delete a saved demo")
check(c.delete("/p/pipeline", params={"id": "approval-flow"}).status_code == 400, "pipeline: a built-in can't be deleted")
types_ = c.get("/p/pipeline/types").json()
check(len(types_["types"]) >= 8 and "git-log" in types_["probes"], "pipeline/types: types, screens and probes")
c.post("/p/pipeline/state", json={"demo": "skin-swap", "status": "playing", "at": 3.5, "dock": "float", "secret": "x"})
st = c.get("/p/pipeline/state").json()
check(st["demo"] == "skin-swap" and st["dock"] == "float" and "secret" not in st and st["reportedAt"], "pipeline/state: the console's report is readable, unknown keys dropped")
print(f"demonstration-designer server: {ok} checks passed")
