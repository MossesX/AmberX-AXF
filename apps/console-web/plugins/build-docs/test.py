#!/usr/bin/env python3
"""Self-test for the Build docs server part: routes over a scratch builds store, the docs worker with a fake GitHub and
no AI (template docs → a PR), plan links through a fake plans@1, the video flow up to the veto call through a fake Vinny,
the file route's guard and the change → build map.

    python3 apps/console-web/plugins/build-docs/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-build-docs-test-"))
os.environ["AXF_BUILD_DOCS_DIR"] = str(TMP / "data")
os.environ["AXF_BUILDS_STORE"] = str(TMP / "store.json")
os.environ["AXF_CHANGES_DIR"] = str(TMP / "changes")
(TMP / "store.json").write_text(json.dumps({"builds": [
    {"id": "demo-plugin", "title": "Demo plugin", "status": "complete", "branch": "claude/demo", "steps": [{"id": "s1", "text": "Core", "done": True}]},
    {"id": "not-yet", "title": "Not yet", "status": "pending", "steps": [{"id": "s1", "text": "Core", "done": False}]},
]}))
(TMP / "changes" / "2026" / "11").mkdir(parents=True)
(TMP / "changes" / "2026" / "11" / "chg-1.json").write_text(json.dumps({"id": "chg-1", "buildRef": {"kind": "orchestrator", "id": "orchestrator:demo-plugin"}}))
(TMP / "changes" / "2026" / "11" / "chg-2.json").write_text(json.dumps({"id": "chg-2", "branch": "claude/demo"}))
(TMP / "changes" / "2026" / "11" / "chg-3.json").write_text(json.dumps({"id": "chg-3", "buildRef": {"id": "someone-else"}}))

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.build_docs_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
client = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


class FakeGh:
    def __init__(self) -> None:
        self.calls: list[tuple[str, str, object]] = []

    def json(self, method: str, path: str, body: object = None, **_: object) -> object:
        self.calls.append((method, path, body))
        if path.endswith("/git/ref/heads/main"):
            return {"object": {"sha": "abc123"}}
        if method == "GET" and "/contents/" in path:
            raise mod.github.GitHubError(404, "Not Found")
        if path.endswith("/pulls"):
            return {"number": 77, "html_url": "https://github.com/MossesX/AmberX-AXF/pull/77"}
        return {}


class FakePlans:
    def __init__(self) -> None:
        self.saved: list[dict] = []
        self.plans = [{"id": "plan-demo", "build": {"id": "demo-plugin"}, "links": [], "attachments": []}, {"id": "other", "build": None}]

    def list(self) -> list[dict]:
        return self.plans

    def get(self, pid: str) -> dict | None:
        return next((p for p in self.plans if p["id"] == pid), None)

    def save(self, plan: dict, by: str = "", force: bool = False) -> dict:
        self.saved.append(plan)
        return {"ok": True}


class FakeVinny:
    def __init__(self) -> None:
        self.sent: list[tuple[str, dict, str]] = []

    def ready(self) -> tuple[bool, str]:
        return True, ""

    def call(self, tool: str, args: dict, reason: str = "") -> dict:
        self.sent.append((tool, args, reason))
        return {"ok": True}


plans = FakePlans()
plugin_services.provide("plans@1", plans, folder="plan-studio-fake")

# index: only the store's builds, plans and changes mapped to them
r = client.get("/p/index").json()
ok([b["id"] for b in r["builds"]] == ["demo-plugin", "not-yet"], "index lists the store's builds")
ok(r["plans"] == {"plan-demo": "demo-plugin"}, "index maps plans to builds through plans@1")
ok(r["changes"] == {"chg-1": "demo-plugin", "chg-2": "demo-plugin"}, f"index maps change entries by buildRef or branch: {r['changes']}")
ok(client.get("/p/options").json()["video"]["length"] == 60, "options carry the defaults")
ok(client.get("/p/ai-status").json()["available"] is False, "no AI provider here")

# docs: refused for an unbuilt build; template docs → PR → plan link
ok(client.post("/p/docs", json={"targets": ["not-yet"]}).status_code == 400, "docs refused for a build with nothing built")
gh = FakeGh()
orig_gh = mod._gh
mod._gh = lambda: gh
mod._start = lambda target, job_id: target(job_id)  # run the worker inline
j = client.post("/p/docs", json={"targets": ["demo-plugin"], "options": {"audience": "developer", "notes": "the menu"}}).json()["job"]
got = client.get(f"/p/job?id={j['id']}").json()
ok(got["job"]["state"] == "done", f"docs job done: {got['job']['state']} {got['job']['message']}")
ok(got["job"]["outputs"]["pr"]["number"] == 77 and got["job"]["mode"] == "template", "PR opened from template docs")
puts = [c for c in gh.calls if c[0] == "PUT"]
ok(len(puts) == 1 and "docs/builds/demo-plugin.md" in puts[0][1] and puts[0][2]["branch"].startswith("docs/demo-plugin-"), "one docs file committed on its own branch")
ok(any(c[0] == "POST" and c[1].endswith("/git/refs") and c[2]["sha"] == "abc123" for c in gh.calls), "branch made off main")
pr_body = next(c[2] for c in gh.calls if c[1].endswith("/pulls"))
ok(pr_body["base"] == "main" and "the menu" in pr_body["body"], "PR into main says what was asked")
ok(plans.saved and plans.saved[-1]["links"][-1]["kind"] == "doc" and plans.saved[-1]["links"][-1]["ref"].endswith("/pull/77"), "docs PR linked in the build's plan")
ok("Docs" in got["docs"][0]["text"] or "# Demo plugin" in got["docs"][0]["text"], "docs text kept in the job")

# a PR failure keeps the docs and says why
class BadGh(FakeGh):
    def json(self, method: str, path: str, body: object = None, **kw: object) -> object:
        if path.endswith("/pulls"):
            raise mod.github.GitHubError(422, "A pull request already exists")
        return super().json(method, path, body, **kw)


mod._gh = lambda: BadGh()
j2 = client.post("/p/docs", json={"targets": ["demo-plugin/s1"]}).json()["job"]
g2 = client.get(f"/p/job?id={j2['id']}").json()["job"]
ok(g2["state"] == "failed" and "already exists" in g2["message"], "PR failure reported, docs kept")
mod._gh = orig_gh

# video: script planned, waits; approve sends one veto call through Vinny
vin = FakeVinny()
plugin_services.provide("axf.vinny@1", vin, folder="agent-manager-fake")
v = client.post("/p/video", json={"targets": ["demo-plugin"], "options": {"length": 30}}).json()["job"]
gv = client.get(f"/p/job?id={v['id']}").json()
ok(gv["job"]["state"] == "script-ready" and gv["script"]["chapters"], "video script planned and waiting for approval")
e = client.post("/p/script", json={"id": v["id"], "edits": {"lines": {"intro-0": "A brand new first line for the video."}}}).json()
ok(e["script"]["chapters"][0]["scenes"][0]["say"] == "A brand new first line for the video.", "script edited before approval")
a = client.post("/p/approve", json={"id": v["id"]}).json()
time.sleep(0.3)
ok(a["job"]["state"] == "queued" and vin.sent and vin.sent[0][0] == "vps.run", "approve sends vps.run through Vinny")
ok("runner.mjs " + v["id"] in vin.sent[0][1]["command"] and "agent-slots.mjs heavy" in vin.sent[0][1]["command"], "the command records in a heavy slot")
ok(client.post("/p/approve", json={"id": v["id"]}).status_code == 400, "approve only once")

# file route guard
ok(client.get(f"/p/file?id={v['id']}&name=../../store.json").status_code == 400, "file route refuses paths outside the job")
ok(client.get(f"/p/file?id={v['id']}&name=script.json").status_code == 200, "file route serves the script")
ok(client.get(f"/p/file?id={v['id']}&name=out/walkthrough.mp4").status_code == 404, "video not made yet")

# a finished video is attached to the plan once
jd = Path(os.environ["AXF_BUILD_DOCS_DIR"]) / "jobs" / v["id"] / "job.json"
job = json.loads(jd.read_text())
job.update(state="done", outputs={**job["outputs"], "video": "out/walkthrough.mp4"})
jd.write_text(json.dumps(job))
before = len(plans.saved)
client.get("/p/jobs")
client.get("/p/jobs")
ok(len(plans.saved) == before + 1 and plans.saved[-1]["attachments"][-1]["kind"] == "video" and plans.saved[-1]["attachments"][-1]["url"] == f"#/build-docs?job={v['id']}", "finished video attached to the plan once")

# cancel + remove
c = client.post("/p/cancel", json={"id": j2["id"]}).json()
ok(c["job"]["state"] == "failed", "cancel leaves a finished job alone")
ok(client.post("/p/remove", json={"id": j2["id"]}).json()["removed"] == j2["id"], "remove a finished job")

print(f"build-docs server: {n} checks passed")
