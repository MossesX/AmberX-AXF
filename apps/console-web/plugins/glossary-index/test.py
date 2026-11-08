#!/usr/bin/env python3
"""Self-test for the Glossary & Index server part's walkthrough routes (investor demos): plan, the background chain with
no provider (template) and with a fake axf.llm@1 (fixed replies, no live model), versions, restore, export, import,
play and delete, all against a scratch data folder (never the repo's).

    python3 apps/console-web/plugins/glossary-index/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
CONSOLE = HERE.parents[1]
scratch = Path(tempfile.mkdtemp(prefix="glossary-index-py-"))
os.environ["AXF_GLOSSARY_DIR"] = str(scratch)
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

spec = importlib.util.spec_from_file_location("glossary_index_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

TERMS = ["concept:orchestrator", "plugin:build-orchestrator", "concept:priority-tag"]
PROMPT = "Run a chain to demonstrate and explain these features."


def wait(job: dict) -> dict:
    for _ in range(600):
        j = c.get(f"/p/walkthrough/job?id={job['job']}").json()
        if j["state"] != "running":
            return j
        time.sleep(0.1)
    raise SystemExit("FAIL: the chain never finished")


r = c.get("/p/walkthroughs").json()
check(r["items"] == [] and r["ai"] is False, "walkthroughs: none yet, no AI provider")

p = c.post("/p/walkthrough/plan", json={"request": {"terms": TERMS, "prompt": PROMPT, "title": "Investor tour"}}).json()
check(p["id"] == "investor-tour" and f"> {PROMPT}" in p["brief"] and len(p["features"]) == 3, "plan: id, the prompt word for word in the brief, a prompt per part")
check(c.post("/p/walkthrough/plan", json={"request": {"terms": []}}).status_code == 400, "plan: no terms is refused with the reason")
check(c.post("/p/walkthrough/generate", json={"request": {"terms": []}}).status_code == 400, "generate: no terms is refused")

j = wait(c.post("/p/walkthrough/generate", json={"request": {"terms": TERMS, "prompt": PROMPT, "title": "Investor tour"}}).json())
check(j["state"] == "done" and j["result"]["version"] == "1.0.0" and j["result"]["claude"] == 0, "chain without a provider: done, every part by the template")
check(any("No AI provider" in line for line in j["log"]), "the log says why the template wrote it")


class FakeLlm:
    calls = 0

    def complete(self, messages, system=None, **_k):
        FakeLlm.calls += 1
        assert "ONE JSON object" in (system or "") and PROMPT in messages[0]["content"]
        if "Priority tag" in messages[0]["content"]:
            raise RuntimeError("rate limited")
        return {"text": '{"headline":"Why it matters","points":["One point"],"steps":[{"kind":"narrate","title":"Hello","say":"Here it is."},{"kind":"try","title":"Try it","say":"Your turn."}]}', "model": "claude-opus-5-5"}


plugin_services.provide("axf.llm@1", FakeLlm(), "fake-provider")
j = wait(c.post("/p/walkthrough/generate", json={"request": {"terms": TERMS, "prompt": PROMPT, "title": "Investor tour"}}).json())
check(FakeLlm.calls == 3, "chain: one model call per part")
check(j["state"] == "done" and j["result"]["version"] == "1.1.0" and j["result"]["claude"] == 2, "chain with a provider: two parts by Claude, the failed one by the template, saved as 1.1.0")
check(any("Priority tag" in line and "template used" in line for line in j["log"]), "a failed call is logged and the template stands in")
b = c.get("/p/walkthrough?id=investor-tour").json()
check(b["generator"]["model"] == "claude-opus-5-5" and b["features"][0]["steps"][-1]["kind"] == "try", "the saved walkthrough names the model and keeps the try-it step")
check(c.get("/p/walkthrough?id=investor-tour&version=1.0.0").json()["generator"]["mode"] == "template", "an older version reads by number")

vs = c.get("/p/walkthrough/versions?id=investor-tour").json()
check([v["version"] for v in vs] == ["1.1.0", "1.0.0"] and vs[0]["current"], "versions: newest first")
r = c.post("/p/walkthrough/restore", json={"id": "investor-tour", "version": "1.0.0"}).json()
check(r["version"] == "1.2.0" and r["claude"] == 0, "restore: the old version comes back as 1.2.0")

wt = c.get("/p/walkthrough/play?id=investor-tour").json()
check(wt["$axf"] == "walkthrough@1" and len(wt["steps"]) > 3, "play: walkthrough@1 for Molly's guide and the recorder")

x = c.get("/p/walkthrough/export?id=investor-tour").json()
check(x["$axf"] == "glossary-walkthrough-export@1" and len(x["assets"]) == 4, "export: the walkthrough with its 3 demonstrations and its book")
check(c.delete("/p/walkthrough?id=investor-tour").json()["removed"] is True, "delete")
check(c.get("/p/walkthroughs").json()["items"] == [], "nothing left after delete")
r = c.post("/p/walkthrough/import", json=x).json()
check(r["id"] == "investor-tour" and r["version"] == "1.2.0", "import: the exported file loads back as it was")
check(c.get("/p/walkthrough?id=../x").status_code == 400, "ids are checked")
check(json.loads((scratch / "walkthrough" / "investor-tour" / "current.json").read_text())["version"] == "1.2.0", "stored in the plugin's data folder")

print(f"glossary-index server: walkthrough routes, chain and versions ({ok} checks)")
