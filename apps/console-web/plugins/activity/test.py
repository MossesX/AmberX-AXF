#!/usr/bin/env python3
"""Self-test for the Activity plugin (fake GitHub, fake services, scratch data folder; also runs activity.mjs with node).

    python3 apps/console-web/plugins/activity/test.py
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
DATA = Path(tempfile.mkdtemp(prefix="axf-activity-test-"))
ROOT = Path(tempfile.mkdtemp(prefix="axf-activity-root-"))
os.environ["AXF_ACTIVITY_DIR"] = str(DATA)
os.environ["GITHUB_TOKEN"] = "test-token"
os.environ["AXF_ACTIVITY_WATCH"] = "off"  # the test drives scan() itself
INBOX = Path(tempfile.mkdtemp(prefix="axf-activity-inbox-"))
os.environ["AXF_NOTIFY_INBOX"] = str(INBOX)
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=ROOT, GITHUB_REPO="MossesX/AmberX-AXF")
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.activity_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
feed_mod = sys.modules["axf_console_plugins.activity_test.feed"]

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


# ---- fake clock + fake GitHub
NOW = [1_800_000_000.0]
mod.FEED.now = lambda: NOW[0]
calls: list[str] = []
T = "2027-01-15T08:00:00Z"
RUNS = {
    "in_progress": [{"id": 11, "name": "Android", "status": "in_progress", "conclusion": None, "run_started_at": T, "updated_at": T,
                     "head_branch": "main", "event": "push", "run_number": 7, "html_url": "https://github.com/MossesX/AmberX-AXF/actions/runs/11",
                     "actor": {"login": "MossesX"}, "head_commit": {"message": "Add activity banner\n\nbody ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ012345"}}],
    "queued": [{"id": 12, "name": "Deploy", "status": "queued", "conclusion": None, "created_at": T, "updated_at": T, "head_branch": "main", "html_url": "javascript:alert(1)"}],
    "waiting": [],
    "completed": [{"id": 10, "name": "Android", "status": "completed", "conclusion": "failure", "run_started_at": T, "updated_at": T, "head_branch": "main", "html_url": "https://github.com/x/y/actions/runs/10"},
                  {"id": 9, "name": "Old", "status": "completed", "conclusion": "success", "run_started_at": "2020-01-01T00:00:00Z", "updated_at": "2020-01-01T00:00:00Z"}],
}
JOBS = {"jobs": [{"name": "build", "status": "in_progress", "started_at": T, "html_url": "https://github.com/j",
                  "steps": [{"name": "Checkout", "status": "completed", "conclusion": "success"}, {"name": "Gradle", "status": "in_progress"}, {"name": "Upload", "status": "queued"}]}]}


def fake_gh(path: str):
    calls.append(path)
    if "/jobs" in path:
        return JOBS
    for k, v in RUNS.items():
        if f"status={k}&" in path:
            return {"workflow_runs": v if "AmberX-AXF" in path else []}
    return {"workflow_runs": []}


mod.FEED._gh_get = fake_gh
NOW[0] = feed_mod._ms(T) / 1000 + 120  # two minutes after the runs started

print("config")
r = c.get("/p/config")
check(r.status_code == 200 and r.json()["repos"][0] == "MossesX/AmberX-AXF" and "MossesX/axHub" in r.json()["repos"], "default repos: the console repo, axHub, Build Pilot")
check(set(r.json()["sourceLabels"]) == {"github", "update", "assistant", "services", "reports"}, "five built-in sources")
check(c.put("/p/config", json={"repos": ["not a repo"]}).status_code == 400, "a bad repo name is refused")
check(c.put("/p/config", json={"lingerS": "x"}).status_code == 400, "a bad number is refused")
check(c.put("/p/config", json={"repos": ["MossesX/AmberX-AXF"]}).json()["repos"] == ["MossesX/AmberX-AXF"], "repos saved")
check(oct(os.stat(DATA / "config.json").st_mode)[-3:] == "600", "config file is 0600")

print("GitHub")
snap = c.get("/p/items").json()
ids = {i["id"]: i for i in snap["items"]}
run = ids.get("gh:MossesX/AmberX-AXF:11")
check(run and run["state"] == "running" and run["title"] == "Android · AmberX-AXF", "a running workflow shows as running")
check("ghp_" not in run["detail"] and "Add activity banner" in run["detail"], "commit message first line only, never a token")
check(run["by"] == "MossesX" and run["url"].startswith("https://github.com/"), "who started it + the run link")
q = ids.get("gh:MossesX/AmberX-AXF:12")
check(q and q["state"] == "queued" and "url" not in q, "a queued run shows; a non-https link is dropped")
check(ids.get("gh:MossesX/AmberX-AXF:10", {}).get("state") == "failed", "a run that just failed stays under Just finished")
check("gh:MossesX/AmberX-AXF:9" not in ids, "an old finished run is left out")
check(snap["active"] == 2, "active count = running + queued")
check(snap["items"][0]["state"] in ("running", "queued") and snap["items"][-1]["state"] == "failed", "active items first")
n = len(calls)
c.get("/p/items")
check(len(calls) == n, "GitHub answers are cached (20 s)")
d = c.get("/p/detail", params={"id": "gh:MossesX/AmberX-AXF:11"}).json()
check(d["jobs"][0]["steps"][1] == {"name": "Gradle", "state": "running"} and abs(d["progress"] - 1 / 3) < 1e-9, "jobs + steps + progress for a run")
check(c.get("/p/detail", params={"id": "gh:Someone/Else:1"}).status_code == 404, "details only for watched repos")
mod.FEED._gh_cache = None
# the trash can on a stuck item: a source's item (not a report) is dismissed everywhere, for a day
check(c.delete("/p/item", params={"id": "gh:MossesX/AmberX-AXF:12"}).json()["removed"] is True, "trash: any item can be taken off")
snap = c.get("/p/items").json()
check("gh:MossesX/AmberX-AXF:12" not in {i["id"] for i in snap["items"]} and "gh:MossesX/AmberX-AXF:11" in {i["id"] for i in snap["items"]}, "trash: gone from the feed, the rest stay")
check(oct(os.stat(DATA / "dismissed.json").st_mode)[-3:] == "600", "dismissed list is 0600")
mod.FEED._gh_cache = None
os.environ.pop("GITHUB_TOKEN")
snap = c.get("/p/items").json()
check(any("no token" in e for e in snap["errors"]) and not any(i["source"] == "github" for i in snap["items"]), "no GitHub token: says so, shows nothing from GitHub")
os.environ["GITHUB_TOKEN"] = "test-token"


def boom(path):
    raise RuntimeError("HTTP Error 500")


mod.FEED._gh_get = boom
mod.FEED._gh_cache = None
snap = c.get("/p/items").json()
check(any("500" in e for e in snap["errors"]), "a GitHub error is reported, the feed still answers")
mod.FEED._gh_get = fake_gh
mod.FEED._gh_cache = None

print("reports")
r = c.post("/p/report", json={"id": "backup", "title": "Backing up password=hunter2secret", "steps": [{"name": "copy", "state": "running"}], "url": "http://evil"})
check(r.status_code == 200 and "hunter2" not in r.json()["title"] and "url" not in r.json(), "a report: secrets hidden, http link dropped")
check(oct(os.stat(DATA / "reports" / "backup.json").st_mode)[-3:] == "600", "report files are 0600")
check(c.post("/p/report", json={"id": "../../etc", "title": "x"}).status_code == 400, "a bad id is refused")
check(c.post("/p/report", json={"id": "x"}).status_code == 400, "an item needs a title")
c.post("/p/report", json={"id": "backup", "progress": 0.5})
it = next(i for i in c.get("/p/items").json()["items"] if i["id"] == "backup")
check(it["progress"] == 0.5 and it["title"].startswith("Backing up") and it["reported"], "an update keeps what it had")
r = c.post("/p/finish", json={"id": "backup", "state": "failed", "detail": "disk full"})
check(r.json()["state"] == "failed" and r.json().get("finishedAt"), "finish → failed, with a time")
check(c.post("/p/finish", json={"id": "nope"}).status_code == 404, "finishing an unknown item is a 404")
c.post("/p/report", json={"id": "backup", "state": "running"})
it = next(i for i in c.get("/p/items").json()["items"] if i["id"] == "backup")
check(it["state"] == "running" and "finishedAt" not in it, "running again clears the finish time")
NOW[0] += 1801
it = next(i for i in c.get("/p/items").json()["items"] if i["id"] == "backup")
check(it["state"] == "stale" and "No word" in it["detail"], "no news for 30 min → No word")
NOW[0] += 601
check(not any(i["id"] == "backup" for i in c.get("/p/items").json()["items"]) and not (DATA / "reports" / "backup.json").exists(), "dropped once it has lingered")
c.post("/p/report", json={"id": "tmp", "title": "Temp"})
check(c.delete("/p/item", params={"id": "tmp"}).json()["removed"], "Clear drops a reported item")
(DATA / "reports" / "link.json").symlink_to("/etc/hostname")
check(not any(i["id"] == "link" for i in c.get("/p/items").json()["items"]), "a symlinked report is never read")
check(not c.delete("/p/item", params={"id": "link"}).json()["removed"], "and never deleted through")

print("update, assistant, services")
NOW[0] = 1_900_000_000.0
st = ROOT / ".axf-console" / "update-status.json"
st.parent.mkdir(parents=True)
st.write_text(json.dumps({"state": "building", "from": "aaaaaaa1", "to": "bbbbbbb2", "startedAt": int(NOW[0]) - 30}))
it = next(i for i in c.get("/p/items").json()["items"] if i["id"] == "console-update")
check(it["state"] == "running" and "aaaaaaa → bbbbbbb" in it["detail"] and it["steps"][1]["state"] == "running", "console update while it rebuilds")
st.write_text(json.dumps({"state": "done", "from": "a", "to": "b", "startedAt": int(NOW[0]) - 100, "finishedAt": int(NOW[0]) - 5}))
check(next(i for i in c.get("/p/items").json()["items"] if i["id"] == "console-update")["state"] == "done", "console update done")
st.write_text(json.dumps({"state": "building", "startedAt": int(NOW[0]) - 3000}))
check(next(i for i in c.get("/p/items").json()["items"] if i["id"] == "console-update")["state"] == "stale", "an update running for 50 min → No word")
st.unlink()


class FakeLive:
    def list(self, include_closed=False):
        return [{"id": "c1", "title": "Fix the banner", "state": "running", "createdAt": 1, "updatedAt": int(NOW[0] * 1000), "viewers": 1},
                {"id": "c2", "title": "Old", "state": "idle"}]


class FakeSys:
    def activity(self):
        return [{"id": "syscheck:autofix:host-mosh", "title": "VPS Auto fix: mosh", "state": "waiting", "detail": "Approve it", "startedAt": NOW[0]}, {"bad": True}]


class Broken:
    def activity(self):
        raise RuntimeError("oops")


plugin_services.provide("axf.live-sessions@1", FakeLive(), "ai-assistant")
plugin_services.provide("axf.syscheck@1", FakeSys(), "systems-check")
plugin_services.provide("axf.broken@1", Broken(), "broken")
snap = c.get("/p/items").json()
ids = {i["id"]: i for i in snap["items"]}
check(ids.get("assistant:c1", {}).get("state") == "running" and "c2" not in json.dumps(list(ids)), "a running AI reply shows; an idle one doesn't")
check(ids.get("syscheck:autofix:host-mosh", {}).get("state") == "waiting" and ids["syscheck:autofix:host-mosh"]["source"] == "axf.syscheck@1", "a service's activity() shows, bad items skipped")
check(any("oops" in e for e in snap["errors"]), "a broken service is reported, not fatal")
check(plugin_services.get("axf.activity@1") is not None, "provides axf.activity@1")
svc = plugin_services.get("axf.activity@1")
svc.report({"id": "svc-job", "title": "From a plugin"})
check(any(i["id"] == "svc-job" for i in svc.items()), "the service reports and lists")
unreg = svc.register_source("extra", "Extra", lambda: [{"id": "x1", "title": "Extra thing", "state": "running"}])
check(any(i["id"] == "x1" for i in svc.items()), "an extra source shows")
unreg()
check(not any(i["id"] == "x1" for i in svc.items()), "and goes when unregistered")
c.put("/p/config", json={"sources": {"services": False, "assistant": False}})
ids = {i["id"] for i in c.get("/p/items").json()["items"]}
check("assistant:c1" not in ids and "syscheck:autofix:host-mosh" not in ids, "sources can be switched off")
c.put("/p/config", json={"sources": {"services": True, "assistant": True}})

print("when something finishes")
comp = mod.COMPLETE
comp.now = lambda: NOW[0]
comp.started_ms = int(NOW[0] * 1000)
alerts: list[dict] = []
comp.raise_alert = alerts.append
opened: list[dict] = []


class FakeChanges:
    def open(self, entry, by="plugin"):
        opened.append(entry)
        return {"id": f"chg-20270115-{len(opened):06x}"}


comp.changes = lambda: FakeChanges()
c.put("/p/config", json={"sources": {"github": False, "services": False, "assistant": False}})
check(c.put("/p/config", json={"push": "loud"}).status_code == 400 and c.put("/p/config", json={"keepFailed": "yes"}).status_code == 400, "bad completion settings are refused")
cfg = c.put("/p/config", json={"push": "all", "pushLevel": "warning", "onClose": "changes"}).json()
check(cfg["push"] == "all" and cfg["onClose"] == "changes" and cfg["sound"] == "off" and cfg["toast"] is True, "completion settings saved with their defaults")
svc.report({"id": "job-a", "title": "Building the app", "kind": "build", "url": "https://github.com/x/y"})
comp.scan()
check(not alerts, "nothing pushed while it runs")
NOW[0] += 5
svc.finish("job-a", "done", "All green")
done = comp.scan()
check([i["id"] for i in done] == ["job-a"] and len(alerts) == 1 and alerts[0]["severity"] == "warning" and alerts[0]["key"] == "activity:job-a", "finishing pushes once (console alert at the chosen level)")
files = list(INBOX.glob("inbox/*/*/*.json"))
n = json.loads(files[0].read_text()) if files else {}
check(len(files) == 1 and n.get("$axf") == "hub-notification@1" and n["title"] == "Done: Building the app" and oct(files[0].stat().st_mode & 0o777) == "0o664", "…and writes a hub-notification@1 into axHub's inbox")
comp.scan()
check(len(alerts) == 1, "never pushed twice")
svc.report({"id": "job-b", "title": "Merging", "kind": "merge"})
comp.scan()
c.put("/p/config", json={"push": "failed", "pushMinS": 0})
svc.finish("job-b", "done")
comp.scan()
check(len(alerts) == 1, "'only failures' skips what finished well")
check(c.post("/p/close", json={"id": "job-a"}).json().get("movedTo") and opened[-1]["kind"] == "build" and opened[-1]["result"]["state"] == "done" and opened[-1]["surface"] == "activity", "closing a finished item moves it to the Codebase changes log")
check(not any(i["id"] == "job-a" for i in c.get("/p/items").json()["items"]), "…and takes it off the Activity banner")
svc.report({"id": "job-c", "title": "Still going"})
check(c.post("/p/close", json={"id": "job-c"}).status_code == 409, "a running item can't be closed")
c.put("/p/config", json={"onClose": "delete"})
n_open = len(opened)
check(c.post("/p/close", json={"id": "job-b"}).json().get("movedTo") is None and len(opened) == n_open, "with 'delete' closing just removes it")
c.put("/p/config", json={"lingerS": 60, "onAutoRemove": "changes", "keepFailed": True})
svc.report({"id": "job-d", "title": "Pulling main", "kind": "pull"})
svc.report({"id": "job-e", "title": "Deleting old builds", "kind": "delete"})
comp.scan()
svc.finish("job-d", "done")
svc.finish("job-e", "failed")
comp.scan()
NOW[0] += 120
ids = {i["id"] for i in c.get("/p/items").json()["items"]}
check("job-d" not in ids and "job-e" in ids, "auto-removed after N minutes; a failure stays while 'keep failures' is on")
comp.scan()
check(opened[-1]["title"] == "Pulling main" and opened[-1]["kind"] == "other", "…and the auto-removed one moved to Codebase changes")
c.put("/p/config", json={"autoRemove": False})
NOW[0] += 3600
check("job-e" in {i["id"] for i in c.get("/p/items").json()["items"]}, "auto-remove off keeps it")
r = c.post("/p/notify/test").json()
check(r["hub"] == "sent" and r["alert"] == "raised" and c.get("/p/config").json()["lastPush"]["title"].startswith("Done: Test"), "test push goes through axHub and the alert")
c.put("/p/config", json={"autoRemove": True, "keepFailed": False, "lingerS": 600, "push": "off", "onClose": "changes", "onAutoRemove": "delete",
                         "sources": {"github": True, "services": True, "assistant": True}})

print("codebase changes entries as activity")
sys.path.insert(0, str(HERE.parent / "codebase-changes" / "server"))
cc_spec = importlib.util.spec_from_file_location("axf_console_plugins.cc_for_activity", HERE.parent / "codebase-changes" / "server" / "__init__.py", submodule_search_locations=[str(HERE.parent / "codebase-changes" / "server")])
cc = importlib.util.module_from_spec(cc_spec)
sys.modules[cc_spec.name] = cc
cc_spec.loader.exec_module(cc)
t0 = 1_800_000_000.0
rows = [{"id": "chg-20270115-aaaaaa", "kind": "remove", "title": "Remove old plugin", "status": "running", "createdAt": "2027-01-15T08:00:00.000Z", "updatedAt": "2027-01-15T08:00:00.000Z", "steps": {"total": 4, "done": 1, "running": "Deleting files"}, "result": None},
        {"id": "chg-20270115-bbbbbb", "kind": "build", "title": "Build it", "status": "done", "createdAt": "2027-01-15T07:00:00.000Z", "updatedAt": "2027-01-15T07:30:00.000Z", "steps": {}, "result": {"state": "partial", "summary": "Mostly"}},
        {"id": "chg-20200101-cccccc", "kind": "edit", "title": "Old", "createdAt": "2020-01-01T00:00:00.000Z", "steps": {}, "result": None}]
acts = cc.activity_items(rows, now=t0)
check([a["kind"] for a in acts] == ["delete", "build"] and acts[0]["state"] == "running" and acts[1]["state"] == "done" and acts[0]["progress"] == 0.25, "open entries run, finished ones show their result, old ones are left out")
check(all(feed_mod.norm(a, "changes", 0) for a in acts) and feed_mod.norm(acts[0], "changes", 0)["changeId"] == "chg-20270115-aaaaaa", "they pass the feed's checks and keep their change id")

print("systems check: VPS Auto fix jobs as activity")
sys.path.insert(0, str(HERE.parent / "systems-check" / "server"))
hspec = importlib.util.spec_from_file_location("hostfix_for_activity_test", HERE.parent / "systems-check" / "server" / "hostfix.py")
hostfix = importlib.util.module_from_spec(hspec)
hspec.loader.exec_module(hostfix)
jobs = hostfix.Jobs(lambda cid: None, call=lambda *a: {"confirm": "00000000-0000-0000-0000-000000000000"}, poll_s=0.01)
os.environ["AXHUB_TOKEN"] = "t"
jobs.start("host-mosh")
import time as _t  # noqa: E402
_t.sleep(0.1)
alljobs = jobs.all()
check(len(alljobs) == 1 and alljobs[0]["state"] == "waiting" and alljobs[0].get("updatedAt"), "hostfix jobs list with their state and update time")

print("activity.mjs (node)")
node = subprocess.run(["node", "--version"], capture_output=True, text=True)
if node.returncode == 0:
    env = {**os.environ, "AXF_ACTIVITY_DIR": str(DATA), "HOME": tempfile.mkdtemp(prefix="axf-activity-home-")}
    cli = str(HERE / "activity.mjs")
    run_ = lambda *a, inp=None: subprocess.run(["node", cli, *a], capture_output=True, text=True, env=env, input=inp)  # noqa: E731
    r = run_("start", "build-1", "Building", "the app", "--steps", "compile,test")
    check(r.returncode == 0 and json.loads((DATA / "reports" / "build-1.json").read_text())["steps"][0]["state"] == "running", "start writes a report the console reads")
    run_("update", "build-1", "--step", "test=running", "--progress", "0.5")
    j = json.loads((DATA / "reports" / "build-1.json").read_text())
    check(j["progress"] == 0.5 and j["steps"][1]["state"] == "running" and j["title"] == "Building the app", "update keeps the title, sets a step")
    run_("done", "build-1")
    check(json.loads((DATA / "reports" / "build-1.json").read_text())["state"] == "done", "done")
    NOW[0] = _t.time()
    check(any(i["id"] == "build-1" and i["state"] == "done" for i in c.get("/p/items").json()["items"]), "the console shows it")
    ev = lambda **k: json.dumps({"session_id": "abc-123", "cwd": "/root/amberx-axf", **k})  # noqa: E731
    check(run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_input={"command": "ls"})).returncode == 0 and not (DATA / "reports" / "claude_abc-123.json").exists(), "a hook before any prompt adds nothing")
    run_("hook", inp=ev(hook_event_name="UserPromptSubmit", prompt="deploy it, my token=ghp_ABCDEFGHIJKLMNOPQRSTUVWX1234"))
    j = json.loads((DATA / "reports" / "claude_abc-123.json").read_text())
    check(j["state"] == "running" and j["title"] == "Claude Code · amberx-axf" and "ghp_" not in j["detail"], "a prompt starts a Claude Code item, secrets hidden")
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_input={"command": "npm test"}))
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Edit", tool_input={"file_path": "/x/y/App.tsx"}))
    j = json.loads((DATA / "reports" / "claude_abc-123.json").read_text())
    check([s["name"] for s in j["steps"]] == ["Running: npm test", "Editing App.tsx"] and j["steps"][0]["state"] == "done", "each tool is a step")
    check(j["kind"] == "edit", "the session shows what it's doing (editing)")
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="toolu_01PUSH", tool_input={"command": "git push -u origin feat"}))
    child = DATA / "reports" / "claude_abc-123_toolu_01PUSH.json"
    k = json.loads(child.read_text())
    check(k["kind"] == "push" and k["state"] == "running" and k["title"].startswith("Pushing"), "a git push gets its own running line")
    run_("hook", inp=ev(hook_event_name="PostToolUse", tool_name="Bash", tool_use_id="toolu_01PUSH", tool_input={"command": "git push -u origin feat"}, tool_response={"stdout": "ok"}))
    check(json.loads(child.read_text())["state"] == "done", "…done when the tool finishes")
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="toolu_01MERGE", tool_input={"command": "git merge main"}))
    run_("hook", inp=ev(hook_event_name="PostToolUse", tool_name="Bash", tool_use_id="toolu_01MERGE", tool_input={"command": "git merge main"}, tool_response={"is_error": True}))
    check(json.loads((DATA / "reports" / "claude_abc-123_toolu_01MERGE.json").read_text())["state"] == "failed", "a failed merge shows failed")
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["kind"] == "thinking", "back to thinking after a tool")
    kinds = subprocess.run(["node", "--input-type=module", "-e", f"import {{activityKind as k}} from {json.dumps(cli)}; console.log(JSON.stringify([k('Bash',{{command:'git pull'}}),k('Bash',{{command:'rm -rf dist'}}),k('Bash',{{command:'npm run build'}}),k('Bash',{{command:'git rebase main'}}),k('Write',{{}}),k('Bash',{{command:'ls'}})]))"], capture_output=True, text=True, env=env)
    check(json.loads(kinds.stdout) == ["pull", "delete", "build", "merge", "edit", None], "pull, delete, build, merge and edit are told apart")
    run_("hook", inp=ev(hook_event_name="Notification", message="Claude needs your permission"))
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["state"] == "waiting", "waiting for you")
    run_("hook", inp=ev(hook_event_name="Stop"))
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["state"] == "done", "Stop → done")
    check(run_("hook", inp="not json").returncode == 0, "a bad hook input never fails Claude Code")
    settings = Path(env["HOME"]) / ".claude" / "settings.json"
    settings.parent.mkdir()
    settings.write_text(json.dumps({"model": "opus", "hooks": {"Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]}}))
    r = run_("hooks", "install")
    s = json.loads(settings.read_text())
    check(r.returncode == 0 and s["model"] == "opus" and len(s["hooks"]["Stop"]) == 2 and "PreToolUse" in s["hooks"], "hooks install keeps your own settings and hooks")
    run_("hooks", "install")
    check(len(json.loads(settings.read_text())["hooks"]["Stop"]) == 2, "installing twice doesn't duplicate")
    run_("hooks", "remove")
    s = json.loads(settings.read_text())
    check(s["hooks"] == {"Stop": [{"hooks": [{"type": "command", "command": "echo mine"}]}]} and s["model"] == "opus", "hooks remove leaves exactly what was there")
else:
    print("  (node not found: skipped)")

print(f"\n{ok} checks passed")
