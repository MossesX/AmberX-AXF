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
    # one list per repo (newest first): what runs or waits now plus what just finished
    return {"workflow_runs": [r for v in RUNS.values() for r in v] if "AmberX-AXF" in path else []}


mod.FEED._gh_get = fake_gh
NOW[0] = feed_mod._ms(T) / 1000 + 120  # two minutes after the runs started

print("config")
r = c.get("/p/config")
check(r.status_code == 200 and r.json()["repos"][0] == "MossesX/AmberX-AXF" and "MossesX/axHub" in r.json()["repos"], "default repos: the console repo, axHub, Build Pilot")
check(set(r.json()["sourceLabels"]) == {"github", "update", "assistant", "services", "reports", "holds"}, "six built-in sources (work on hold included)")
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
check(len(calls) == n, "GitHub answers are cached (60 s)")
check(n == 1 and all("per_page=20" in x and "status=" not in x for x in calls), "one runs call per watched repo (was four per repo)")
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


def limited(path):
    calls.append(path)
    raise RuntimeError("GitHub 403: API rate limit exceeded for user ID 1234.")


mod.FEED._gh_get = limited
mod.FEED.set_config({"repos": ["MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot"]})
n = len(calls)
snap = c.get("/p/items").json()
check(len(calls) == n + 1 and any("rate limit is used up" in e and "isn't a missing permission" in e for e in snap["errors"]), "a rate-limit 403 says so (not a permission) and stops after the first repo")
mod.FEED._gh_cache = None
c.get("/p/items")
check(len(calls) == n + 1 and mod.FEED.github_status()["backoffUntil"], "…then GitHub is left alone for 10 minutes")
hc = sys.modules["axf_console_plugins.activity_test.health"]
check(hc.github_check(mod.FEED.github_status(), True)["status"] == "warn" and "paused until" in hc.github_check(mod.FEED.github_status(), True)["summary"], "health item: amber while it backs off, with the reason")
check(hc.github_check({"errors": ["GitHub MossesX/axHub: GitHub 401: Bad credentials"], "checkedAt": 1}, True)["status"] == "error", "health item: red with GitHub's own words on a refused read")
check(hc.github_check({"errors": [], "checkedAt": 1, "notes": ["axHub's GitHub token can't see MossesX/Build-Pilot (404: …)"]}, True)["status"] == "warn", "health item: amber naming the repo axHub's token can't see")
NOW[0] += 11 * 60
mod.FEED._gh_get = fake_gh
mod.FEED._gh_cache = None
check(any(i["id"] == "gh:MossesX/AmberX-AXF:11" for i in c.get("/p/items").json()["items"]), "after the back-off it reads again")
NOW[0] -= 11 * 60
mod.FEED.set_config({"repos": ["MossesX/AmberX-AXF"]})
mod.FEED._gh_cache = None


class FakeHub:
    def __init__(self):
        self.paths = []

    def has_token(self):
        return True

    def get(self, path):
        self.paths.append(path)
        return {"workflow_runs": []}


hub = FakeHub()
gf = feed_mod.Feed(Path(tempfile.mkdtemp()), ROOT, default_repos=["MossesX/AmberX-AXF"], github_token=lambda: "", github_client=lambda: hub, now=lambda: NOW[0])
check(not any("no token" in e for e in gf.snapshot()["errors"]) and len(hub.paths) == 1, "with axf.github@1 the feed reads through it (axHub), no local token needed")


class HubNoBP(FakeHub):
    def get(self, path):
        self.paths.append(path)
        if "Build-Pilot" in path:
            raise feed_mod.github.GitHubError(404, '"github" answered HTTP 404: Not Found')
        return {"workflow_runs": []}


hub2 = HubNoBP()
lf = feed_mod.Feed(Path(tempfile.mkdtemp()), ROOT, default_repos=["MossesX/AmberX-AXF", "MossesX/Build-Pilot"], github_token=lambda: "local-token", github_client=lambda: hub2, now=lambda: NOW[0])
locals_ = []
orig_cls = feed_mod.github.GitHubClient
class FakeLocal(orig_cls):  # noqa: E302
    def get(self, path, **kw):
        locals_.append(path)
        return {"workflow_runs": RUNS["in_progress"]}
feed_mod.github.GitHubClient = FakeLocal
try:
    snap = lf.snapshot()
finally:
    feed_mod.github.GitHubClient = orig_cls
check(not snap["errors"] and len(locals_) == 1 and "Build-Pilot" in locals_[0] and any(i["id"].startswith("gh:MossesX/Build-Pilot:") for i in snap["items"]),
      "a repo axHub's token can't see (404) is read with the console's own token")

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

print("on hold")
hdir = Path(tempfile.mkdtemp(prefix="axf-activity-holds-"))
hfile = hdir / "holds.json"
hfile.write_text(json.dumps({"holds": [
    {"id": "hold:x", "title": "Update the Android framework", "pending": "android-x", "since": T,
     "actions": [{"label": "Continue", "icon": "play", "action": "build-manager.start:pending%3Aandroid-x"},
                 {"label": "Bad", "action": "javascript:alert(1) x"}, {"label": "Details", "action": "build-manager.open:pending%3Aandroid-x"}]},
    {"id": "not-a-hold", "title": "ignored"}]}))
status = {"android-x": "pending"}
hf = feed_mod.Feed(hdir / "data", ROOT, holds_file=hfile, pending_status=lambda pid: status.get(pid, "missing"), now=lambda: NOW[0])
hs = hf.snapshot()
held = [i for i in hs["items"] if i["state"] == "held"]
check(len(held) == 1 and held[0]["id"] == "hold:x" and hs["held"] == 1 and hs["active"] == 0, "a hold shows as On hold, apart from what's running")
check([a["label"] for a in held[0]["actions"]] == ["Continue", "Details"], "only well-formed buttons are kept (a bad action is dropped)")
NOW[0] += 7 * 86400
check(any(i["id"] == "hold:x" and i["state"] == "held" for i in hf.snapshot()["items"]), "a hold never goes stale or expires")
status["android-x"] = "unsafe"
check(any(i["id"] == "hold:x" for i in hf.snapshot()["items"]), "still held while its pending build is unsafe")
r = hf.continue_item("hold:x", "console")
check(r["action"] == "build-manager.start:pending%3Aandroid-x", "Continue hands back the first button's action")
c2 = [i for i in hf.snapshot()["items"] if i["id"] == "hold:x"]
check(c2 and c2[0]["state"] == "done" and "actions" not in c2[0], "after Continue it reads Done (no buttons), on every device")
check(oct(os.stat(hdir / "data" / "continued.json").st_mode)[-3:] == "600", "continued list is 0600")
check(hf.hold_back("hold:x") and any(i["id"] == "hold:x" and i["state"] == "held" for i in hf.snapshot()["items"]), "Put back on hold")
status["android-x"] = "complete"
check(not any(i["id"] == "hold:x" for i in hf.snapshot()["items"]), "a hold leaves once its pending build is complete")
status.pop("android-x")
check(not any(i["id"] == "hold:x" for i in hf.snapshot()["items"]), "…or once it's removed from the list")
try:
    hf.continue_item("hold:nope")
    check(False, "an unknown hold is refused")
except KeyError:
    check(True, "an unknown hold is refused")
rep = hf.report({"id": "rep-held", "title": "Parked script", "state": "held", "actions": [{"label": "Continue", "action": "app.settings"}]})
check(rep["state"] == "held" and rep["actions"][0]["action"] == "app.settings", "a reported item can be held with its own buttons")
check(hf.continue_item("rep-held")["action"] == "app.settings" and json.loads((hdir / "data" / "reports" / "rep-held.json").read_text())["state"] == "running", "Continue on a held report turns it running")
shipped = json.loads((HERE / "holds.json").read_text())
check(any(h["id"] == "hold:android-framework-update" and h["actions"][0]["label"] == "Continue" for h in shipped["holds"]), "the plugin ships the Android framework hold with Continue")
check(all(feed_mod.clean_actions(h["actions"]) == h["actions"] for h in shipped["holds"]), "every shipped button passes the checks")
check(c.post("/p/continue", json={"id": "hold:nope"}).status_code == 404, "POST continue: unknown id → 404")

print("command lines (ghosts) + one row per session")
gdir = Path(tempfile.mkdtemp(prefix="axf-activity-ghosts-"))
(gdir / "reports").mkdir()
nowms = int(NOW[0] * 1000)


def put(iid, state, upd_s_ago, **k):
    (gdir / "reports" / (iid.replace(":", "_") + ".json")).write_text(json.dumps({"id": iid, "title": k.pop("title", iid), "state": state, "startedAt": nowms - 3600_000, "updatedAt": nowms - upd_s_ago * 1000, "source": "claude-code", **k}))


put("claude:live-1", "running", 10)
put("claude:live-1:toolu_fresh", "running", 60, kind="push")
put("claude:live-1:toolu_quiet", "running", 400, kind="merge")
put("claude:ended-2", "done", 900, finishedAt=nowms - 900_000)
put("claude:ended-2:toolu_a", "running", 1200, kind="pull")
put("claude:ended-2:toolu_b", "done", 1200, kind="build", finishedAt=nowms - 1200_000)
put("claude:gone-3:toolu_c", "running", 30, kind="delete")


class Changes:
    def activity(self):
        return [{"id": "changes:chg-20261101-aaaaaa", "source": "changes", "kind": "fix", "title": "Activity banner fix", "state": "running",
                 "startedAt": nowms - 600_000, "updatedAt": nowms - 5_000, "changeId": "chg-20261101-aaaaaa", "session": "live-1", "progress": 0.5},
                {"id": "changes:chg-20261101-bbbbbb", "source": "changes", "kind": "build", "title": "claude.ai build", "state": "running",
                 "startedAt": nowms - 600_000, "updatedAt": nowms - 5_000, "session": "other-9"}]


gfeed = feed_mod.Feed(gdir, ROOT, services=lambda: [("axf.changes@1", Changes())], now=lambda: NOW[0])
gfeed.set_config({"sources": {"github": False}})
snap = gfeed.snapshot()
ids = {i["id"]: i for i in snap["items"]}
check("claude:live-1:toolu_fresh" in ids, "a running command line of a live session shows")
check("claude:live-1:toolu_quiet" not in ids and not (gdir / "reports" / "claude_live-1_toolu_quiet.json").exists(), "expiry: a command line with no word for 5 min is dropped (not 'No word' / stuck)")
check(not any(k.startswith("claude:ended-2:") for k in ids) and not (gdir / "reports" / "claude_ended-2_toolu_a.json").exists(), "a session that ended takes its command lines with it")
check("claude:gone-3:toolu_c" not in ids, "a command line without a session doesn't show")
row = ids.get("claude:live-1")
check("changes:chg-20261101-aaaaaa" not in ids and row and row["changeId"] == "chg-20261101-aaaaaa" and row["change"]["title"] == "Activity banner fix" and row["progress"] == 0.5,
      "one row per session: its change-log entry is folded into the session's row")
check("changes:chg-20261101-bbbbbb" in ids, "an entry with no Claude Code row (claude.ai, scripts) keeps its own row")
check(snap["active"] == 3, f"counts: session + its live push + the claude.ai entry = 3 (was 7 with ghosts and the double) — got {snap['active']}")
check(gfeed.config()["childTtlS"] == 300 and gfeed.set_config({"childTtlS": 30})["childTtlS"] == 60, "command-line expiry is a setting (5 min, at least 1)")

print("holds read the builds store")
sdir = Path(tempfile.mkdtemp(prefix="axf-activity-store-"))
store = {"$axf": "builds@1", "builds": [{"id": "android-framework-update", "pendingId": "android-framework-update", "status": "pending", "pending": {"status": "pending"}},
                                        {"id": "done-one", "status": "complete", "pending": {"status": "complete"}},
                                        {"id": "risky", "status": "pending", "pending": {"status": "unsafe"}},
                                        {"id": "gone", "status": "pending", "deleted": True}]}
(sdir / "store.json").write_text(json.dumps(store))
os.environ["AXF_BUILDS_STORE"] = str(sdir / "store.json")
check(mod.builds_store_file() == sdir / "store.json", "the store is found the way builds-store.mjs finds it")
check([mod._pending_status(x) for x in ("android-framework-update", "done-one", "risky", "gone", "nope")] == ["pending", "complete", "unsafe", "missing", "missing"],
      "a hold's pending build: status from the builds store (pending, complete, unsafe, deleted/absent = missing)")
os.environ["AXF_BUILDS_STORE"] = str(sdir / "absent.json")
check(mod._pending_status("android-framework-update") is None, "an unreadable store = unknown (the hold stays)")
os.environ.pop("AXF_BUILDS_STORE")
real = mod.build_status(json.loads((REPO / "_claude" / "builds" / "store.json").read_text()), "android-framework-update")
check(real in ("pending", "unsafe", "complete", "missing"), f"the repo's store answers for the shipped hold ({real})")

print("hook health check")
H = 3600_000
note = lambda user, **ev: {"user": user, "settings": f"/home/{user}/.claude/settings.json", "missing": ev.pop("missing", []), "events": ev}  # noqa: E731
r = hc.hooks_check([note("root", missing=["PostToolUse"], PreToolUse=nowms)], [], nowms)
check(r["status"] == "error" and "PostToolUse" in r["summary"] and "never close" in r["details"][0], "red: PostToolUse missing from a user's settings")
r = hc.hooks_check([note("axfbuild", PreToolUse=nowms, PostToolUse=nowms - 2 * H)], [], nowms)
check(r["status"] == "error" and "stopped arriving for axfbuild" in r["summary"], "red: PreToolUse keeps coming, PostToolUse doesn't")
r = hc.hooks_check([note("root", PreToolUse=nowms - H, PostToolUse=nowms - H)], [{"id": "changes:x", "title": "A build", "updatedAt": nowms - 60_000}], nowms)
check(r["status"] == "error" and "stopped arriving" in r["summary"] and "A build" in r["details"][0], "red: hook events stopped while the change log shows a session working")
r = hc.hooks_check([note("root", PreToolUse=nowms - 30_000, PostToolUse=nowms - 20_000), note("axfbuild", UserPromptSubmit=nowms - H)], [{"id": "changes:x", "updatedAt": nowms - 60_000}], nowms)
check(r["status"] == "ok" and "root, axfbuild" in r["summary"], "green: every user's hooks complete and reporting")
check(hc.hooks_check([], [], nowms)["status"] == "ok", "green when nothing is working and nothing reported")
check('hooks ensure --all' in hc.fix_command(), "Auto fix runs hooks ensure --all on the VPS")


class Reg:
    def __init__(self):
        self.specs, self.cmds = [], []
        self.vps_run = lambda cmd: self.cmds.append(cmd) or {"state": "started", "message": "veto"}

    def register(self, spec, owner=""):
        self.specs.append(spec)


reg = Reg()
plugin_services.provide("axf.health@1", reg, "systems-check")
hc._done = False
check(hc.ensure(mod.FEED, DATA, changes=lambda: None) and {x["id"] for x in reg.specs} == {"activity-hooks", "activity-github"}, "both checks register on axf.health@1")
hook_spec = next(x for x in reg.specs if x["id"] == "activity-hooks")
check(hook_spec["autoFix"]["run"]()["state"] == "started" and reg.cmds == [hc.fix_command()], "its Auto fix sends the one fixed command as a veto call")

print("banner: collapsed, at most ~30% open")
tsx = (HERE / "web" / "index.tsx").read_text()
css = (HERE / "web" / "activity.css").read_text()
check("open: false, pinned: false" in tsx and "useBannerLaunchOpen" not in tsx, "it launches folded to one line")
check("axp-activity__lead" not in tsx, "the folded line is counts only")
check("max-height: calc(30vh" in css and "overflow: auto" in css.split("axp-activity__body")[1].split("}")[0], "open, the list is capped near 30% of the screen and scrolls inside")

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
    kinds = subprocess.run(["node", "--input-type=module", "-e", f"import {{activityKind as k}} from {json.dumps(cli)}; console.log(JSON.stringify([k('Bash',{{command:'git pull'}}),k('Bash',{{command:'rm -rf docs/old'}}),k('Bash',{{command:'npm run build'}}),k('Bash',{{command:'git rebase main'}}),k('Write',{{}}),k('Bash',{{command:'ls'}})]))"], capture_output=True, text=True, env=env)
    check(json.loads(kinds.stdout) == ["pull", "delete", "build", "merge", "edit", None], "pull, delete, build, merge and edit are told apart")
    CASES = {"git merge-base HEAD origin/main": None, "git rev-parse --abbrev-ref HEAD": None, "git log --oneline -5": None, "git status --short": None,
             "git diff origin/main...HEAD": None, "git stash list": None, "git merge origin/main": "merge", "git push origin HEAD:main": "push",
             "rm -rf /tmp/axf-x": None, 'rm -f "$TMPDIR/a.json"': None, "rm -rf src/axf && mkdir -p src/axf": None, "rm -rf dist node_modules": None,
             "cd apps/demo && rm -rf build": None, "docker rm old-box": None, "rm apps/console-web/src/App.tsx": "delete",
             "rm -f /tmp/a.json notes.md": "delete", "git branch -D old": "delete", "git rm -r framework/x": "delete",
             "cat > /tmp/poll.sh <<'EOF'\ngit merge-base a b && git merge x\nrm -rf apps\nEOF\nbash /tmp/poll.sh": None,
             "cat > /tmp/w.sh <<EOF\ngit push\nEOF": None, 'grep -n "git push" notes.md': None, "git commit -m 'git merge later'": None,
             "git fetch origin -q && git merge-base HEAD origin/main": "pull", "cat <<'EOF' > x\nhi\nEOF\ngit push origin b": "push"}
    got = subprocess.run(["node", "--input-type=module", "-e", f"import {{activityKind as k}} from {json.dumps(cli)}; console.log(JSON.stringify({json.dumps(list(CASES))}.map((c) => k('Bash', {{command: c}}))))"], capture_output=True, text=True, env=env)
    bad = [f"{c!r}: {g}" for (c, w), g in zip(CASES.items(), json.loads(got.stdout)) if g != w]
    check(not bad, f"matching: merge-base / rev-parse / log / status / diff are reads, rm of temp or build scratch isn't Deleting {bad}")
    run_("hook", inp=ev(hook_event_name="Notification", message="Claude needs your permission"))
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["state"] == "waiting", "waiting for you")
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="toolu_01GHOST", tool_input={"command": "git pull --ff-only"}))
    run_("hook", inp=ev(hook_event_name="PreToolUse", tool_name="Bash", tool_use_id="toolu_01GHOS2", tool_input={"command": "npm run build"}))
    j = json.loads((DATA / "reports" / "claude_abc-123.json").read_text())
    check(j["open"] == ["claude:abc-123:toolu_01GHOST", "claude:abc-123:toolu_01GHOS2"], "the session knows its open command lines")
    run_("hook", inp=ev(hook_event_name="Stop"))
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["state"] == "done", "Stop → done")
    check(all(json.loads((DATA / "reports" / f"claude_abc-123_{t}.json").read_text())["state"] == "done" for t in ("toolu_01GHOST", "toolu_01GHOS2")),
          "ghosts: Stop closes every command line the session left open (no PostToolUse came)")
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["open"] == [], "…and forgets them")
    # a line the session didn't list (lost in a race) is still found in the folder and closed on SessionEnd
    run_("hook", inp=ev(hook_event_name="UserPromptSubmit", prompt="again"))
    run_("hook", inp=ev(hook_event_name="UserPromptSubmit", prompt="<task-notification> <task-id>b1</task-id> <status>completed</status>"))
    check(json.loads((DATA / "reports" / "claude_abc-123.json").read_text())["detail"] == "Asked: again", "a background-task notice isn't a new question: the session keeps what was asked")
    (DATA / "reports" / "claude_abc-123_toolu_01LOST.json").write_text(json.dumps({"id": "claude:abc-123:toolu_01LOST", "title": "Pushing · x", "state": "running", "startedAt": 1, "updatedAt": 1}))
    run_("hook", inp=ev(hook_event_name="SessionEnd"))
    check(json.loads((DATA / "reports" / "claude_abc-123_toolu_01LOST.json").read_text())["state"] == "done", "SessionEnd closes unlisted lines found in the folder")
    hn = json.loads((DATA / "hooks" / f"{os.environ.get('USER') or __import__('getpass').getuser()}.json").read_text())
    check(hn["$axf"] == "activity-hooks@1" and hn["events"]["SessionEnd"] and hn["events"]["PreToolUse"] and "PostToolUse" in hn["missing"], "every hook event is noted per user, with what its settings lack")
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
    # an old install (before PostToolUse): status says what's missing, ensure adds only that
    old = {"model": "opus", "hooks": {ev: [{"hooks": [{"type": "command", "command": f'node "{cli}" hook', "timeout": 5}]}] for ev in ("UserPromptSubmit", "PreToolUse", "Notification", "Stop", "SessionEnd")}}
    settings.write_text(json.dumps(old))
    r = run_("hooks", "status", "--exit-code")
    check(r.returncode == 1 and "missing PostToolUse" in r.stdout, "hooks status: an install without PostToolUse is incomplete")
    r = run_("hooks", "ensure")
    s = json.loads(settings.read_text())
    check("fixed" in r.stdout and "PostToolUse" in s["hooks"] and s["hooks"]["PostToolUse"][0]["matcher"] == "*" and len(s["hooks"]["Stop"]) == 1 and s["model"] == "opus", "hooks ensure re-registers PostToolUse, nothing doubled")
    check(run_("hooks", "ensure").stdout.startswith("ok") and run_("hooks", "status", "--exit-code").returncode == 0, "…and leaves a complete install alone")
else:
    print("  (node not found: skipped)")

print(f"\n{ok} checks passed")
