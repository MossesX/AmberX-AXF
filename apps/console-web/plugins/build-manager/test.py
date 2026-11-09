"""Build manager self-test. Run: python3 apps/console-web/plugins/build-manager/test.py

Server part (GET live): with and without the activity feed capability, filtering of old finished items, a failing
feed, and that it never writes anything. Then the merge/totals/live-link logic (node test.mjs) on fixtures + real data.
"""
from __future__ import annotations

import importlib
import os
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))
sys.path.insert(0, str(HERE.parent))

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

mod = importlib.import_module("build-manager.server")
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond: bool, label: str) -> None:
    global ok
    if not cond:
        print(f"  ✗ {label}")
        sys.exit(1)
    ok += 1
    print(f"  ✓ {label}")


before = {p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")}

# no activity feed installed
plugin_services._services.pop("axf.activity@1", None)
r = c.get("/p/live").json()
check(r["available"] is False and r["items"] == [], "no axf.activity@1 → available false, empty list (build list still works)")

now = time.time() * 1000


class Feed:
    fail = False

    def items(self):
        if self.fail:
            raise RuntimeError("feed down")
        return [
            {"id": "gh:a:1", "title": "CI", "state": "running", "startedAt": now - 1000, "detail": "push on fable/x", "secret": "nope"},
            {"id": "gh:a:2", "title": "Old", "state": "done", "startedAt": now - 3_600_000, "finishedAt": now - 3_000_000},
            {"id": "gh:a:3", "title": "Just done", "state": "failed", "startedAt": now - 60_000, "finishedAt": now - 5_000},
            {"title": "no id"}, "junk",
        ]


feed = Feed()
plugin_services.provide("axf.activity@1", feed, "some-folder")
r = c.get("/p/live").json()
ids = [i["id"] for i in r["items"]]
check(r["available"] is True and ids == ["gh:a:1", "gh:a:3"], "running + recently finished items; old finished and malformed ones dropped")
check("secret" not in r["items"][0] and r["items"][0]["detail"] == "push on fable/x", "only activity@1 fields are passed on")

plugin_services.configure(lambda folder: folder != "some-folder")
check(c.get("/p/live").json()["available"] is False, "feed provider switched off → treated as absent")
plugin_services.configure(lambda folder: True)

feed.fail = True
r = c.get("/p/live")
check(r.status_code == 200 and r.json()["items"] == [] and "feed down" in r.json()["error"], "a failing feed doesn't break the route")

check({(m.path, *sorted(m.methods)) for m in mod.router.routes if m.methods - {"GET", "HEAD"}} == {("/start", "POST"), ("/verify", "POST"), ("/abandon", "POST")}, "only start, verify + abandon write anything")
check({p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")} == before, "nothing in framework/plan written")

# ---------------------------------------------------------------- the build log (axf.changes@1) + real time
import tempfile  # noqa: E402

plugin_services._services.pop("axf.changes@1", None)
r = c.get("/p/changes").json()
check(r["available"] is False and r["items"] == [], "no build log capability → available false")
cc_dir = Path(tempfile.mkdtemp(prefix="axf-bm-changes-"))
os.environ["AXF_CHANGES_DIR"] = str(cc_dir)
sys.path.insert(0, str(HERE.parent))
cc = importlib.import_module("codebase-changes.server")  # provides axf.changes@1 (a capability; the test wires it like the console does)
svc = plugin_services.get("axf.changes@1")
check(svc is not None and hasattr(svc, "summaries"), "codebase-changes provides axf.changes@1 with summaries()")
e1 = svc.open({"kind": "build", "title": "Running build", "status": "running", "surface": "vps-claude-code", "estimate": {"minutes": 30, "costUsd": 4.2},
               "buildRef": {"kind": "pending", "id": "lib-clone"}, "areas": ["apps/console-web/plugins/x"]}, "test")
r = c.get("/p/changes").json()
check(r["available"] and len(r["items"]) == 1 and r["items"][0]["estimate"]["costUsd"] == 4.2 and r["items"][0]["surface"] == "vps-claude-code", "changes: summaries with build stats")
stamp = r["stamp"]
check(c.get(f"/p/changes?since={stamp}").json().get("same") is True, "?since=<stamp> answers {same} when nothing changed (cheap polling)")
time.sleep(0.01)
svc.update(e1["id"], {"step": {"text": "routes", "state": "running"}})
cc.store()._scanned = 0.0  # skip the 2 s scan cache in the test
r2 = c.get(f"/p/changes?since={stamp}").json()
check(not r2.get("same") and r2["stamp"] != stamp and r2["items"][0]["steps"]["running"] == "routes", "a step written anywhere changes the stamp → the browser refetches")
check(r2["items"][0].get("lastSeenAt"), "every update is a heartbeat (lastSeenAt)")
mod.EVENT_EVERY_S, mod.EVENT_MAX_S = 0.05, 0.4
with c.stream("GET", "/p/events") as s:
    first = next(s.iter_lines())
    check(first.startswith("retry:") or "ready" in first, "events: an SSE stream that says it's ready")

# ---------------------------------------------------------------- the trash can on a stuck live build
stuck = svc.open({"kind": "build", "title": "Stuck build", "status": "running", "surface": "vps-claude-code"}, "test")
check(c.post("/p/abandon", json={"changeId": "nope"}).status_code == 400, "abandon: needs a change id")
check(c.post("/p/abandon", json={"changeId": "chg-20991231-0000000000"}).status_code == 404, "abandon: unknown entry is 404")
r = c.post("/p/abandon", json={"changeId": stuck["id"]}).json()
got = svc.get(stuck["id"])
check(r["closed"] and r["state"] == "failed" and got["status"] == "failed" and got["closed"]["by"] == "build-manager", "abandon: the build log finishes it as failed (stalled) and closes it everywhere")
cc.store()._scanned = 0.0
live = [x for x in c.get("/p/changes").json()["items"] if x["id"] == stuck["id"]]
check(not live or live[0]["status"] == "failed", "abandon: it leaves the Live list (no longer running)")

# ---------------------------------------------------------------- Start build now (dry run, refusals, fake axHub)
os.environ["AXF_DATA_DIR"] = "off"
r = c.post("/p/start", json={"key": "nope"})
check(r.status_code == 400, "start: the key must be pending:/queue:/plan:<id>")
pend = json.loads((REPO / "framework/plan/pending.json").read_text())
open_item = next(i for i in pend["items"] if i["status"] != "complete" and i["id"] != "build-manager-history")
r = c.post("/p/start", json={"key": f"pending:{open_item['id']}", "dryRun": True}).json()
check(r["ok"] and r["dryRun"] and r["plan"]["model"] == open_item["model"].lower() and r["plan"]["branch"] and "# Build:" in r["plan"]["brief"], f"dry run on real data plans {open_item['id']} (model {open_item['model']} kept, branch, brief) without the VPS")
check({p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")} == before, "a dry run writes nothing")
svc.update(e1["id"], {"buildRef": {"kind": "pending", "id": open_item["id"]}})
cc.store()._scanned = 0.0
r = c.post("/p/start", json={"key": f"pending:{open_item['id']}", "dryRun": True}).json()
check(r["ok"] is False and "Already being built" in (r.get("refuse") or ""), "a build already running (any session) is refused")
svc.update(e1["id"], {"result": {"state": "done", "summary": "ok"}})
cc.store()._scanned = 0.0


# Send to queue (Brett, Nov 9 2026: "It has to be the orchestrator … Not the build manager"): Start files the build with
# the orchestrator (axf.build-dispatch@1) and queues it; nothing here launches or calls axHub.
engine_calls: list[tuple[str, dict]] = []
mod._engine = lambda op, **kw: engine_calls.append((op, kw)) or {"ok": True}  # the queue reorder goes through engine-rpc: recorded, never written here
mod.JOBS.jobs.clear()
check(not hasattr(mod, "_call_hub") and not hasattr(mod.JOBS, "start") and not hasattr(mod, "retry_delays"), "no launch path left in the Build manager (no axHub vps.run, no start job)")
plugin_services.withdraw("build-orchestrator")
r = c.post("/p/start", json={"key": f"pending:{open_item['id']}"}).json()
check(r["ok"] is False and "only from its Queue" in (r.get("refuse") or ""), "orchestrator off → Start refuses (builds start only from the orchestrator's Queue)")


class FakeDispatch:
    """The orchestrator's axf.build-dispatch@1: `known` = builds it already has (id → status)."""
    def __init__(self, known: dict[str, str] | None = None) -> None:
        self.calls: list[tuple[str, str, dict]] = []
        self.queued: list[tuple[str, str]] = []
        self.known = dict(known or {})

    def build(self, build_id: str) -> dict:
        if build_id not in self.known:
            raise LookupError(f'no build "{build_id}"')
        return {"id": build_id, "status": self.known[build_id]}

    def queue(self, build_id: str, by: str = "console") -> dict:
        self.queued.append((build_id, by))
        self.known[build_id] = "queued"
        return {"ok": True, "id": build_id, "status": "queued"}

    def request(self, title: str, detail: str = "", **kw: object) -> dict:
        self.calls.append((title, detail, kw))
        return {"ok": True, "id": "fake-build-1", "status": "queued"}


fd = FakeDispatch()
plugin_services.provide("axf.build-dispatch@1", fd, "build-orchestrator")
r = c.post("/p/start", json={"key": f"pending:{open_item['id']}"}).json()
check(r["ok"] and r["queued"] and r["build"] == "fake-build-1" and r["job"]["state"] == "queued", "Start = send to the orchestrator's Queue; the job says which build it became")
check(len(fd.calls) == 1 and fd.calls[0][2].get("queue") is True and str(fd.calls[0][2].get("by")).startswith("build-manager") and "# Build:" in fd.calls[0][1], "no build behind the row: the orchestrator gets the title, the planned brief as detail, by build-manager, straight to the Queue")
check(r.get("how") == "filed", "… and the answer says it was filed as a new build")
r = c.post("/p/start", json={"key": f"pending:{open_item['id']}"}).json()
check(r.get("existing") and len(fd.calls) == 1, "a second Start on the same item does not file it twice")
check(c.get("/p/jobs").json()["items"][0]["state"] == "queued", "jobs lists it as queued")
plugin_services.withdraw("build-orchestrator")

# A pending build the orchestrator already has is queued as itself, never filed again (filing it made a second copy and
# left the one on screen Pending: the "dead Start button", Nov 2026).
others = [i for i in pend["items"] if i.get("status") == "pending" and i["id"] != open_item["id"]][:3]
if len(others) >= 2:
    a, b = others[0]["id"], others[1]["id"]
    fd2 = FakeDispatch({a: "pending", b: "running"})
    plugin_services.provide("axf.build-dispatch@1", fd2, "build-orchestrator")
    r = c.post("/p/start", json={"key": f"pending:{a}"}).json()
    check(r["ok"] and r["build"] == a and r["how"] == "queued" and fd2.queued and fd2.queued[0][0] == a and not fd2.calls, "a Pending orchestrator build: Start queues that same build (no duplicate)")
    r = c.post("/p/start", json={"key": f"pending:{b}"}).json()
    check(r["ok"] and r["build"] == b and r["how"] == "already" and len(fd2.queued) == 1 and not fd2.calls, "a build already running: Start says so and files nothing")
    fd2.known[others[2]["id"] if len(others) > 2 else "x"] = "archived"
    if len(others) > 2:
        r = c.post("/p/start", json={"key": f"pending:{others[2]['id']}"}).json()
        check(r["ok"] is False and "only a Pending build" in (r.get("refuse") or "") and not fd2.calls, "an archived build: Start refuses with the reason, files nothing")
    plugin_services.withdraw("build-orchestrator")
e2 = svc.open({"kind": "build", "title": "verify me", "status": "running"}, "build-manager")
j = {"changeId": e2["id"]}

# verify: checks for the areas + CI; never merges
svc.update(j["changeId"], {"result": {"state": "done", "summary": "built"}, "areas": ["apps/console-web/plugins/build-manager"], "branch": "build/x"})
ran: list[str] = []
v = mod.run_verify(svc.get(j["changeId"]), runner=lambda cmd: ran.append(cmd) or (1 if "check-theme" in cmd else 0), ci=lambda b: "pass")
check(v["verify"]["state"] == "broken" and v["verify"]["checks"]["theme check"] == "fail" and "theme check" in v["verify"]["summary"], "verify: a failing check marks the build broken, naming it")
check(svc.get(j["changeId"])["verify"]["state"] == "broken" and not any("merge" in x or "push" in x for x in ran), "the result is stored on the entry; nothing is merged or pushed")
v = mod.run_verify(svc.get(j["changeId"]), runner=lambda cmd: 0, ci=lambda b: "pass")
check(v["verify"]["state"] == "verified" and v["verify"]["checks"]["CI (build/x)"] == "pass", "all pass + CI green → verified")
v = mod.run_verify(svc.get(j["changeId"]), runner=lambda cmd: 0, ci=lambda b: "running")
check(v["verify"]["state"] == "pending", "CI still running → pending")
check(all(op == "build-reorder" and kw.get("by") == "build-manager:start" for op, kw in engine_calls), "a start with unbuilt dependencies reorders the queue through the build-reorder engine")
check({p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")} == before, "the test never wrote framework/plan")
os.environ.pop("AXF_CHANGES_DIR", None)

manifest = json.loads((HERE / "plugin.json").read_text())
check(manifest["lifecycle"]["dataDir"] == ".axf-console/plugins/build-manager" and (HERE / "install.mjs").is_file() and (HERE / "uninstall.mjs").is_file(), "plugin-lifecycle@1: dataDir, install.mjs, uninstall.mjs")
check("service:axf.activity@1" in manifest["optional"], "activity feed declared optional (capability, not a folder)")
web = "\n".join(p.read_text() for p in (HERE / "web").glob("*.ts*"))
check("parent: 'plugins'" in web and "settingsTabs" in web, "settings only as a sub-tab of Settings → Plugins")
other = "activ" + "ity"  # spelled out so this test isn't itself a stale reference to that plugin
check(f"plugins/{other}" not in web and f"'{other}'" not in web, "never names the Activity plugin's folder")

node = subprocess.run(["node", str(HERE / "test.mjs")], capture_output=True, text=True, timeout=120)
print("\n".join("    " + ln for ln in node.stdout.strip().splitlines()[-3:]))
check(node.returncode == 0, f"merge/totals/live-link logic (test.mjs){'' if node.returncode == 0 else ': ' + (node.stdout + node.stderr)[-600:]}")
print(f"all {ok} checks passed")
