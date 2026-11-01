#!/usr/bin/env python3
"""Self-test for the Molly guide's server part (no network): walkthrough@1 cleaning, storage, the ask route.

    python3 apps/console-web/plugins/molly-guide/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["AXF_MOLLY_GUIDE_DIR"] = tempfile.mkdtemp(prefix="axf-molly-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.molly_guide", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mg = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mg)
app = FastAPI()
app.include_router(mg.router, prefix="/mg")
c = TestClient(app)
ok = 0


def check(cond: bool, what: str) -> None:
    global ok
    if not cond:
        print(f"FAIL: {what}")
        sys.exit(1)
    ok += 1
    print(f"  ✓ {what}")


print("molly-guide self-test")
text_, wt_ = mg.split_walkthrough('Here you go.\n```walkthrough\n{"id":"AI Setup!","title":"Set up AI","steps":[{"say":"Open settings.","do":"settings.open:ai","target":"#ai"},{"say":"x","do":"javascript:alert(1)","target":"<b>"},{"say":"y","do":"https://evil.example"},{"nope":1}]}\n```')
check(text_ == "Here you go." and wt_ and wt_["id"] == "ai-setup" and len(wt_["steps"]) == 3, "block taken out of the answer, id cleaned, empty steps dropped")
check([wt_["steps"][1]["do"], wt_["steps"][1]["target"], wt_["steps"][2]["do"]] == ["", "", ""], "script and link actions, markup targets dropped")
check(mg.split_walkthrough("no block")[1] is None and mg.split_walkthrough("```walkthrough\n{broken\n```")[1] is None, "no block or a broken block = plain text")
r1 = mg.save_walkthrough(wt_, "amberx")
r2 = mg.save_walkthrough(wt_, "console")
check(r2["seq"] == r1["seq"] + 1 and [w["seq"] for w in c.get(f"/mg/walkthroughs?after={r1['seq']}").json()["walkthroughs"]] == [r2["seq"]], "kept with a sequence; the window polls for newer ones")
check(c.post("/mg/ask", json={}).status_code == 400, "ask: a task is required")
check(c.post("/mg/ask", json={"task": "hi"}).status_code == 503, "ask: no agents service = 503 with why")


class FakeAgents:
    def get_agent(self, aid):
        return {"id": aid} if aid == "molly" else None

    def run_task(self, aid, task):
        self.task = task
        return {"text": 'Sure.\n```walkthrough\n{"title":"Theme","steps":[{"say":"Open themes.","do":"nav:themes"}]}\n```', "tools": [], "ms": 5}


fake = FakeAgents()
plugin_services.provide("axf.agents@1", fake, "agent-manager")
r = c.post("/mg/ask", json={"task": "show me how to change the theme", "app": "AmberX!", "page": "notes<script>"}).json()
check(r["text"] == "Sure." and r["walkthrough"]["steps"][0]["do"] == "nav:themes" and r["walkthrough"]["source"] == "amberx", "ask: Molly's answer split into speech + a stored walkthrough")
check(fake.task.startswith("[from amberx, page notesscript] "), "ask: app and page cleaned before they reach Molly")

# Re-record AmberX's walkthrough: one veto call through Vinny, never without him
import time as _t  # noqa: E402
check(c.post("/mg/amberx-walkthrough/rerecord").status_code == 503, "rerecord: no Vinny = 503 with why")


class FakeVinny:
    def __init__(self) -> None:
        self.calls: list = []

    def ready(self):  # type: ignore[no-untyped-def]
        return True, ""

    def call(self, tool, arguments, confirmation_id=None, timeout=600, reason=""):  # type: ignore[no-untyped-def]
        self.calls.append((tool, arguments, reason))
        return {"confirm": "c-1"}


fv = FakeVinny()
plugin_services.provide("axf.vinny@1", fv, "agent-manager")
r = c.post("/mg/amberx-walkthrough/rerecord").json()
check(r["state"] in ("sending", "sent"), "rerecord: accepted")
for _ in range(50):
    if fv.calls and c.get("/mg/amberx-walkthrough/rerecord").json()["state"] == "sent":
        break
    _t.sleep(0.05)
tool, args, why = fv.calls[0]
check(tool == "vps.run" and "apps/amberx-droid/walkthrough/rebuild.sh" in args["command"] and args["command"].rstrip().endswith("&"), "rerecord: vps.run starts rebuild.sh in the background")
check(why == "Re-record the AmberX walkthrough video", "rerecord: the veto notice says what it's for")
check(c.get("/mg/amberx-walkthrough/rerecord").json()["state"] == "sent", "rerecord: status says it was sent")
print(f"all {ok} checks passed")
