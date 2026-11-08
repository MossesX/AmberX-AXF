#!/usr/bin/env python3
"""Self-test for the Maintenance plugin: the engine's rules (thresholds, swap tracking, settings), every job's preview on
scratch folders with a fake Docker / git / tmux, an approved run that re-checks each item (tampered, repeated and
changed plans are refused or skipped), and the server part (routes, the held axHub call, alerts once per level, the
nightly run, the Server health row and its Auto fix). Nothing on this machine outside temp folders is touched.

    python3 apps/console-web/plugins/maintenance/test.py
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
TMP = Path(tempfile.mkdtemp(prefix="axf-maint-test-"))
DATA = TMP / "data"
BUILDS, LOGS, TMPS = TMP / "axf-builds", TMP / "log", TMP / "tmp"
for d in (DATA, BUILDS, LOGS, TMPS):
    d.mkdir(parents=True)
os.environ.update(AXF_MAINT_DATA_DIR=str(DATA), AXF_MAINT_NO_MONITOR="1", AXF_MAINT_BUILD_ROOTS=str(BUILDS),
                  AXF_MAINT_TMP_ROOTS=str(TMPS), AXF_MAINT_LOG_ROOTS=str(LOGS), AXF_MAINT_AREAS=f"Logs={LOGS},tmp={TMPS},Builds={BUILDS},Locked=/root/axf-builds", AXF_MAINT_HOST_ROOT="/opt/axf")
os.environ.pop("AXHUB_TOKEN", None)
(TMP / "store.json").write_text(json.dumps({"builds": [{"id": "done-build", "branch": "claude/done-build", "status": "complete"},
                                                       {"id": "hub-copies", "branch": "claude/hub-copies", "status": "running"}]}))
os.environ["AXF_BUILDS_STORE"] = str(TMP / "store.json")   # the worktree job reads build status from it (line ~356 resets it)
sys.path.insert(0, str(HERE.parent.parent / "server"))

n = failed = 0


def ok(cond: bool, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"  FAIL {what}")


spec = importlib.util.spec_from_file_location("maint_under_test", HERE / "engine" / "maint.py")
M = importlib.util.module_from_spec(spec)
spec.loader.exec_module(M)

OLD = time.time() - 40 * 86400


def age(p: Path, t: float = OLD) -> None:
    for root, dirs, files in os.walk(p):
        for f in files:
            os.utime(Path(root) / f, (t, t))
    for root, dirs, files in sorted(os.walk(p), key=lambda x: -len(x[0])):
        os.utime(root, (t, t))
    os.utime(p, (t, t))


# ---------------------------------------------------------------- pure rules

S = M.normalize_settings({})
ok(S["nightly"] is False, "nightly auto-clean is off by default")
ok((S["diskWarnPct"], S["diskHighPct"], S["diskCriticalPct"]) == (80, 85, 90), "disk alert levels default to 80/85/90")
ok([M.disk_level(p, S) for p in (50, 80, 84.9, 85, 90, 99)] == ["ok", "warning", "warning", "error", "critical", "critical"], "disk levels")
ok(M.disk_level(None, S) == "unknown", "no disk reading = unknown")
x = M.normalize_settings({"diskWarnPct": 95, "diskHighPct": 70, "diskCriticalPct": 80, "nightlyJobs": ["worktrees", "docker", "bogus"], "tmpDays": -4, "evil": 1})
ok((x["diskWarnPct"], x["diskHighPct"], x["diskCriticalPct"]) == (70, 80, 95), "levels are kept in order")
ok(x["nightlyJobs"] == ["docker"], "nightly jobs: only known safe jobs (worktrees never)")
ok(x["tmpDays"] == 1 and "evil" not in x, "values clamped, unknown keys dropped")
since, alert = M.swap_state(95, None, 1000.0, S)
ok(since == 1000.0 and not alert, "swap: starts the clock, no alert yet")
since, alert = M.swap_state(95, since, 1000.0 + 15 * 60, S)
ok(alert, "swap: alerts after 15 min nearly full")
ok(M.swap_state(40, since, 5000.0, S) == (None, False), "swap: clock resets when it drops")
ok(M.swap_state(None, None, 1.0, S) == (None, False), "no swap = never alerts")
ok(M.parse_size("1.5GB") == 1_500_000_000 and M.parse_size("3.4GB (40%)") == 3_400_000_000 and M.parse_size("0B") == 0 and M.parse_size("") == 0, "docker sizes")
ok(M.inside(BUILDS / "x", [BUILDS]) and not M.inside(BUILDS, [BUILDS]) and not M.inside(TMP / "other", [BUILDS]) and not M.inside(BUILDS / ".." / "etc", [BUILDS]), "inside() is strict")
ok(all(not j["safe"] for j in M.job_catalog() if j["id"] == "worktrees") and set(M.SAFE_JOBS) == {"docker", "logs", "tmp", "created"}, "job catalog and safe jobs")

# ---------------------------------------------------------------- scratch machine

for name in ("old-plain", "new-plain", "dirty", "merged", "active", "agent-run", "hub-copies", "done-build"):
    d = BUILDS / name
    d.mkdir()
    (d / "work.txt").write_text("x" * 1000)
    (d / "build.log").write_text("log")
    if name in ("dirty", "merged", "agent-run", "hub-copies", "done-build"):
        (d / ".git").mkdir()
    if name == "hub-copies":
        (d / "project.manifest.json").write_text(json.dumps({"data": {"shared": ["tracker.json", "changes/"]}}))
    if name != "new-plain":
        age(d)
(BUILDS / "_archive").mkdir()
age(BUILDS / "_archive")
(LOGS / "syslog.2.gz").write_text("z" * 500)
(LOGS / "syslog").write_text("live")
(LOGS / "recent.1.gz").write_text("r")
os.utime(LOGS / "syslog.2.gz", (OLD, OLD))
os.utime(LOGS / "syslog", (OLD, OLD))
(TMPS / "leftover").mkdir()
(TMPS / "leftover" / "big.bin").write_bytes(b"0" * 4096)
age(TMPS / "leftover")
(TMPS / "fresh.txt").write_text("new")
(TMPS / "systemd-private-abc").mkdir()
age(TMPS / "systemd-private-abc")
held_open = TMPS / "held.txt"
held_open.write_text("open")
os.utime(held_open, (OLD, OLD))
held_fh = open(held_open)  # noqa: SIM115 — kept open on purpose: an open file is never removed
os.symlink("/etc/passwd", TMPS / "link")

IMG_USED, IMG_FREE = "sha256:" + "a" * 64, "sha256:" + "b" * 64
CID = "c" * 64
calls: list[list[str]] = []
docker_state = {"created": "created"}


def fake(cmd: list[str], timeout: int = 60) -> tuple[int, str]:
    calls.append(cmd)
    j = lambda rows: "\n".join(json.dumps(r) for r in rows)  # noqa: E731
    if cmd[:2] == ["du", "-sxb"]:
        return 1, ""  # falls back to the Python walk
    if cmd[0] == "tmux":
        return 0, "axf-active\naxf-agent-run--vinnie\n" if cmd[1] == "ls" else ""
    if cmd[0] == "git":
        wt, args = cmd[2], cmd[3:]
        if args[0] == "status":
            if wt.endswith("hub-copies"):  # what claude-sync drops into every checkout: never the session's work
                return 0, "?? _claude/builds/reports/x.md\n?? changes/2026/11/c.json\n M tracker.json\n D assets.log\n?? run.jsonl\n"
            return 0, " M src/app.ts\n?? build.log\n" if wt.endswith("dirty") else "?? build.log\n"
        if args[0] == "symbolic-ref":
            return 0, f"claude/{Path(wt).name}\n"
        if args[0] == "merge-base":
            return (0, "") if wt.endswith("merged") else (1, "")
        return 0, ""
    if cmd[:3] == ["docker", "system", "df"]:
        return 0, j([{"Type": "Images", "TotalCount": "4", "Active": "2", "Size": "3GB", "Reclaimable": "1GB (33%)"},
                     {"Type": "Containers", "TotalCount": "3", "Active": "2", "Size": "10MB", "Reclaimable": "0B"},
                     {"Type": "Local Volumes", "TotalCount": "5", "Active": "5", "Size": "8GB", "Reclaimable": "0B"},
                     {"Type": "Build Cache", "TotalCount": "20", "Active": "0", "Size": "2GB", "Reclaimable": "2GB"}])
    if cmd[:2] == ["docker", "images"]:
        return 0, j([{"ID": IMG_USED, "Size": "100MB", "CreatedSince": "3 weeks ago"}, {"ID": IMG_FREE, "Size": "250MB", "CreatedSince": "2 weeks ago"}])
    if cmd[:3] == ["docker", "ps", "-a"] and "--filter" in cmd:
        return 0, j([{"ID": CID, "Names": "stuck_1", "Image": "x:1", "CreatedAt": "2026-01-01 10:00:00 +0000 UTC", "RunningFor": "10 months ago"}]) if docker_state["created"] == "created" else ""
    if cmd[:3] == ["docker", "ps", "-a"]:
        return 0, IMG_USED + "\nnginx:latest\n"
    if cmd[:2] == ["docker", "inspect"]:
        return 0, docker_state["created"] + "\n"
    if cmd[:2] in (["docker", "rmi"], ["docker", "rm"]):
        return 0, cmd[2]
    if cmd[:3] == ["docker", "builder", "prune"]:
        return 0, "Total:\t1.9GB\n"
    if cmd[0] == "journalctl":
        return 0, "Archived and active journals take up 1.2G in the file system.\n" if "--disk-usage" in cmd else "Vacuuming done, freed 300.0M of archived journals.\n"
    return 127, "unexpected"


ctx = M.Ctx(S, fake)
P = M.plan(ctx, M.JOBS)
refs = lambda job: {Path(i["ref"]).name if "/" in i["ref"] else i["ref"] for i in P[job]["items"]}  # noqa: E731
kept = {k["name"]: k["state"] for k in P["worktrees"]["kept"]}
ok(refs("worktrees") == {"old-plain", "merged", "done-build"}, f"worktrees: merged, build complete and idle plain go ({refs('worktrees')})")
ok(kept.get("dirty") == "dirty" and kept.get("active") == "active" and kept.get("new-plain") == "recent", f"worktrees: dirty, active and recent are kept ({kept})")
ok(kept.get("agent-run") == "active", "worktrees: a session named axf-<folder>--<agent> keeps its folder")
ok(kept.get("hub-copies") == "open", f"worktrees: hub copies, logs and the old assets.log don't make a folder dirty; not merged + no build = kept open ({kept.get('hub-copies')})")
ok(M.real_changes(" M src/a.ts\n?? _claude/x\n M framework/plan/pending.json\n", ["framework/plan/pending.json"]) == ["src/a.ts"], "real_changes: only the session's own work")
ok("_archive" not in refs("worktrees") | set(kept), "the _archive folder is never a worktree")
ok(refs("docker") == {IMG_FREE, "build-cache"}, "docker: only the dangling image no container uses, plus build cache")
ok(next(i for i in P["docker"]["items"] if i["ref"] == "build-cache")["size"] == 2_000_000_000, "docker: build cache size from system df")
ok({"syslog.2.gz", "journal"} <= refs("logs") and "syslog" not in refs("logs") and "recent.1.gz" not in refs("logs"), f"logs: old rotated + journal, never live or recent ({refs('logs')})")
ok(refs("tmp") == {"leftover"}, f"tmp: only the old leftover (not fresh, system, open, or a link) ({refs('tmp')})")
ok(refs("created") == {CID}, "created: the stuck container")
ok(all(not c[:2] == ["docker", "volume"] for c in calls), "nothing ever lists or touches volumes")
ok(P["tmp"]["bytes"] >= 4096, "sizes are measured")

# ---------------------------------------------------------------- an approved run

plan = M.make_plan("20261104-120000-abc123", ["worktrees", "docker", "tmp", "created", "logs"], P)
M.write_json(DATA / "plans" / f"{plan['id']}.json", plan)
ok(plan["sha"] == M.plan_sha(plan) and len(plan["sha"]) == 16, "plans carry a fingerprint")
try:
    M.run_plan(plan["id"], "0" * 16, DATA, fake)
    ok(False, "a wrong fingerprint is refused")
except SystemExit as e:
    ok("changed" in str(e), "a wrong fingerprint is refused")
os.utime(TMPS / "leftover", None)  # touched after approval: no longer qualifies
calls.clear()
res = M.run_plan(plan["id"], plan["sha"], DATA, fake)
byref = {Path(r["ref"]).name if "/" in r["ref"] else r["ref"]: r for r in res["results"]}
ok(not (BUILDS / "old-plain").exists() and not (BUILDS / "merged").exists(), "finished worktrees removed")
ok((BUILDS / "dirty").exists() and (BUILDS / "active").exists() and (BUILDS / "new-plain").exists(), "kept worktrees still there")
ok((BUILDS / "_archive" / "old-plain" / "build.log").exists(), "build logs archived before the worktree goes")
ok((TMPS / "leftover").exists() and byref["leftover"].get("skipped"), "an item that changed after approval is skipped")
ok(held_open.exists() and (TMPS / "systemd-private-abc").exists() and os.path.islink(TMPS / "link"), "open files, system folders and links untouched")
ok(not (LOGS / "syslog.2.gz").exists() and (LOGS / "syslog").exists(), "old rotated log removed, live log kept")
ok(["docker", "rmi", IMG_FREE] in calls and not any(c[:2] == ["docker", "rmi"] and IMG_USED in c for c in calls), "only the free dangling image is removed")
ok(any(c[:3] == ["docker", "builder", "prune"] for c in calls) and ["docker", "rm", CID] in calls, "build cache pruned, stuck container removed")
ok(not any("-f" in c and c[:2] in (["docker", "rmi"], ["docker", "rm"]) for c in calls), "never forced (Docker refuses anything in use)")
ok((DATA / "runs" / f"{plan['id']}.json").exists() and res["done"] >= 6, f"result written ({res['done']} done, {res['skipped']} skipped, {res['failed']} failed)")
try:
    M.run_plan(plan["id"], plan["sha"], DATA, fake)
    ok(False, "a plan runs once")
except SystemExit as e:
    ok("already ran" in str(e), "a plan runs once")
docker_state["created"] = "running"
ok(M.plan_created(M.Ctx(S, fake))[0] == [], "a container that started is no longer a candidate")
try:
    M._execute_item({"job": "created", "ref": CID}, M.Ctx(S, fake))
    ok(False, "a running container is never removed")
except PermissionError:
    ok(True, "a running container is never removed")
try:
    M._remove_path(Path("/etc/hostname"), [TMPS], set(), set())
    ok(False, "paths outside the roots are refused")
except PermissionError:
    ok(True, "paths outside the roots are refused")
held_fh.close()

# ---------------------------------------------------------------- server part

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

alerts: list[dict] = []
resolved: list[list[str]] = []
cx.set_context(ROOT=TMP, raise_alert=lambda a: alerts.append(a) or a, resolve_alerts=lambda k: resolved.append(k), log=lambda *a, **k: None)


class FakeHealth:
    def __init__(self) -> None:
        self.items: dict[str, dict] = {}

    def register(self, spec_: dict, owner: str = "") -> str:
        self.items[spec_["id"]] = {**spec_, "owner": owner}
        return spec_["id"]


HEALTH = FakeHealth()
plugin_services.provide("axf.health@1", HEALTH, "health-provider")

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
sspec = importlib.util.spec_from_file_location("axf_console_plugins.maintenance_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
srv = importlib.util.module_from_spec(sspec)
sys.modules[sspec.name] = srv
sspec.loader.exec_module(srv)

hub_calls: list[tuple[str, dict]] = []


def transport(method: str, params: dict, sid: str | None) -> tuple[dict, str | None]:
    hub_calls.append((method, params))
    if method == "initialize":
        return {}, "sid-1"
    return {"content": [{"type": "text", "text": json.dumps({"held": True, "job_id": "job-42"})}]}, sid


srv.hub.transport = transport
LIVE = {"disk": {"path": "/", "total": 100 * M.GB, "used": 86 * M.GB, "free": 14 * M.GB, "pct": 86.0},
        "memory": {"total": 16 * M.GB, "available": 8 * M.GB, "used": 8 * M.GB, "pct": 50.0},
        "swap": {"total": 4 * M.GB, "used": int(3.9 * M.GB), "pct": 97.5}, "load": {"1": 1.0, "5": 1.0, "15": 1.0, "cpus": 4}}
srv.maint.basic = lambda path="/": json.loads(json.dumps(LIVE))
snap = srv.maint.snapshot(S, fake)
snap["disk"] = dict(LIVE["disk"])
M.write_json(DATA / "snapshot.json", snap)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(srv.router, prefix="/api/plugins/maintenance")
c = TestClient(app)
B = "/api/plugins/maintenance"

r = c.get(f"{B}/status").json()
ok(r["hostPart"] and not r["stale"] and r["summary"]["level"] == "error", f"status: host part reporting, disk level error ({r['summary']['level']})")
ok(c.get(f"{B}/summary").json()["disk"]["pct"] == 86.0, "summary: disk percent for the Home card")
ok(HEALTH.items.get("maintenance-server-health", {}).get("label") == "Server health" and callable(HEALTH.items["maintenance-server-health"]["autoFix"]["run"]),
   "systems check: Server health row with Auto fix")
ok(HEALTH.items["maintenance-server-health"]["run"]()["status"] == "error", "Server health is red at 86%")
jobs = {j["id"]: j for j in c.get(f"{B}/jobs").json()["jobs"]}
ok(jobs["docker"]["safe"] and not jobs["worktrees"]["safe"] and jobs["docker"]["count"] == 2, "jobs: safe flags and counts")
pv = c.post(f"{B}/preview", json={"jobs": ["docker", "tmp"]}).json()
ok(pv["count"] == pv["jobs"]["docker"]["count"] + pv["jobs"]["tmp"]["count"] and pv["bytes"] > 0, "preview: items and bytes per job")
ok(c.post(f"{B}/preview", json={"jobs": ["volumes"]}).status_code == 400, "unknown jobs are refused")
ok(c.post(f"{B}/run", json={"jobs": []}).status_code == 400, "an empty run is refused")
before = len(list(DATA.glob("runs/*.json")))
run = c.post(f"{B}/run", json={"jobs": ["docker"]})
ok(run.status_code == 200 and run.json()["state"] == "waiting", f"run: sent and waiting for approval ({run.status_code} {run.text[:200]})")
tc = [p for m, p in hub_calls if m == "tools/call"][-1]["arguments"]
cmd = tc["arguments"]["command"]
ok(tc["tool"] == "vps.run" and tc["hold"] is True and tc["reason"]["title"].startswith("Server clean-up"), "one held vps.run call with a reason")
rid = run.json()["id"]
ok(cmd == f"python3 /opt/axf/apps/console-web/plugins/maintenance/engine/maint.py run {rid} --sha {M.read_json(DATA / 'plans' / f'{rid}.json')['sha']}", f"the exact engine command ({cmd})")
ok(len(list(DATA.glob("runs/*.json"))) == before, "sending a run removes nothing")
ok(c.post(f"{B}/run", json={"jobs": ["docker"]}).status_code == 409, "a second run waits for the first approval")
M.write_json(DATA / "runs" / f"{rid}.json", {"ok": True, "done": 2, "skipped": 0, "failed": 0, "freed": 123, "at": M.now_iso()})
ok(c.get(f"{B}/runs").json()["runs"][0]["state"] == "done", "runs: done once the VPS wrote the result")

ok(c.put(f"{B}/settings", json={"nightly": True, "nightlyHour": 99, "junk": 1}).json()["settings"]["nightlyHour"] == 23, "settings: saved and clamped")
ok(c.put(f"{B}/settings", json={"junk": 1}).status_code == 400, "settings: nothing known to save is refused")

alerts.clear()
t0 = time.time()
lt = time.localtime(t0)
c.put(f"{B}/settings", json={"nightly": True, "nightlyHour": lt.tm_hour})
hub_calls.clear()
srv.tick(t0)
ok([a["key"] for a in alerts] == ["maintenance:disk"] and alerts[0]["severity"] == "error", f"disk alert raised at 86% ({alerts})")
ok(any(m == "tools/call" for m, _ in hub_calls), "the nightly run is sent at the set hour")
nightly_plan = sorted(DATA.glob("plans/*.json"), key=lambda f: f.stat().st_mtime)[-1]
np_ = M.read_json(nightly_plan)
ok(np_["kind"] == "nightly" and "worktrees" not in np_["jobs"], "the nightly run only takes safe jobs")
hub_calls.clear()
srv.tick(t0 + 60)
ok(not any(m == "tools/call" for m, _ in hub_calls), "the nightly run goes once a day")
ok(len(alerts) == 1, "no repeat alert while the level holds")
srv.tick(t0 + 16 * 60)
ok(any(a["key"] == "maintenance:swap" for a in alerts), "swap alert after 15 min nearly full")
LIVE["disk"].update(pct=91.0)
snap["disk"]["pct"] = 91.0
M.write_json(DATA / "snapshot.json", snap)
srv.tick(t0 + 17 * 60)
ok(alerts[-1]["key"] == "maintenance:disk" and alerts[-1]["severity"] == "critical", "critical at 90%")
snap["disk"]["pct"] = 60.0
LIVE["swap"].update(pct=10.0)
M.write_json(DATA / "snapshot.json", snap)
resolved.clear()
srv.tick(t0 + 18 * 60)
ok(["maintenance:disk"] in resolved and ["maintenance:swap"] in resolved, "alerts clear when things are back to normal")
ok(HEALTH.items["maintenance-server-health"]["run"]()["status"] == "ok", "Server health green again")

# Auto fix: the safe clean-up, held on axHub (the nightly run still waits, so it says so instead of sending a second one)
fx = HEALTH.items["maintenance-server-health"]["autoFix"]["run"]()
ok(fx["state"] == "failed" and "waiting" in fx["message"], "Auto fix won't stack a second run on one waiting for approval")
M.write_json(DATA / "runs" / f"{np_['id']}.json", {"ok": True, "done": 1, "skipped": 0, "failed": 0, "freed": 1, "at": M.now_iso()})
fx = HEALTH.items["maintenance-server-health"]["autoFix"]["run"]()
ok(fx["state"] == "started" and fx.get("jobId") == "job-42", f"Auto fix sends the safe clean-up for approval ({fx})")

# without the host part only the basics show, and runs are refused
(DATA / "snapshot.json").unlink()
st = c.get(f"{B}/status").json()
ok(not st["hostPart"] and "host part" in (st["note"] or ""), "no host part: says so, basics still shown")
ok(c.post(f"{B}/run", json={"jobs": ["docker"]}).status_code == 409, "no host part: nothing to approve")

# ---------------------------------------------------------------- clean up build profiles (server side)
import subprocess  # noqa: E402

r = subprocess.run(["node", str(HERE / "engine" / "profiles.test.mjs")], capture_output=True, text=True, timeout=300)
ok(r.returncode == 0, f"profile engine checks: {(r.stdout or r.stderr).strip()[-400:]}")

PCD = TMP / "pc"
store = {"$axf": "builds@1", "rev": 0, "updatedAt": "", "migratedAt": "", "rules": {}, "meta": {"queue": {}, "pending": {}}, "drafts": {},
         "builds": [{"id": "ticked", "title": "Ticked build", "status": "pending", "profiles": ["main-framework"], "steps": [{"id": "s1", "title": "a", "done": True}]},
                    {"id": "open-one", "title": "Open build", "status": "pending", "profiles": ["main-framework"], "steps": [{"id": "s1", "title": "a"}]},
                    {"id": "busy", "title": "Busy build", "status": "running", "profiles": ["main-framework"]}]}
(PCD / "data" / "framework" / "plan").mkdir(parents=True)
(PCD / "data" / "framework" / "plan" / "profiles.json").write_text(json.dumps({"active": "main-framework", "profiles": [{"id": "main-framework"}]}))
(PCD / "store.json").write_text(json.dumps(store))
os.environ.update(AXF_DATA_DIR=str(PCD / "data"), AXF_BUILDS_STORE=str(PCD / "store.json"), AXF_BUILDS_LIVE="0", AXF_BUILDS_EXPORT="0",
                  AXF_MAINT_NO_REPLAN="1", AXF_BUILD_PROFILE="")
alerts.clear()
pv = c.post(f"{B}/profiles/preview", json={"mode": "basic"})
ok(pv.status_code == 200 and pv.json()["mode"] == "basic", f"profile preview runs in Basic ({pv.text[:300]})")
pv = pv.json()
its = {i["key"]: i for p in pv["profiles"] for i in p["items"]}
ok(its["build:ticked"]["verdict"] == "done" and its["build:busy"].get("locked"), "preview: done build found, running build locked")
ok(alerts and "Basic" in alerts[-1]["body"] and alerts[-1]["key"] == "maintenance:profiles", "the notification says which mode ran")
ok(c.get(f"{B}/profiles/preview/{pv['run']}").json()["run"] == pv["run"], "a saved preview reads back")
ok(c.post(f"{B}/profiles/preview", json={"mode": "deep"}).status_code == 409, "Deep without an AI model is refused (Basic is offered)")


class FakeLlm:
    def __init__(self, answer):
        self.answer, self.calls = answer, 0

    def complete(self, messages, system=None, params=None, **kw):
        self.calls += 1
        return {"text": json.dumps(self.answer)}


EV = {"ref": "main", "commits": [{"sha": "abc1234", "subject": "Add open build"}], "reports": ["_claude/builds/reports/x.md"], "built": []}
import importlib  # noqa: E402
PC = importlib.import_module(srv.__name__ + ".profiles")
base_plan = {"profiles": [{"id": "main-framework", "base": True, "items": [
    {"key": "build:a", "kind": "build", "id": "a", "title": "A", "status": "pending", "verdict": "keep", "about": {"detail": ""}},
    {"key": "build:b", "kind": "build", "id": "b", "title": "B", "status": "pending", "verdict": "keep", "about": {"detail": ""}},
    {"key": "build:c", "kind": "build", "id": "c", "title": "C", "status": "pending", "verdict": "keep", "about": {"detail": ""}},
    {"key": "build:d", "kind": "build", "id": "d", "title": "D", "status": "running", "verdict": "keep", "locked": True, "about": {"detail": ""}}]}]}
fake = FakeLlm({"verdicts": [{"key": "build:a", "verdict": "done", "reason": "shipped", "proof": "commit:abc1234"},
                             {"key": "build:b", "verdict": "done", "reason": "made up", "proof": "commit:fffffff"},
                             {"key": "build:c", "verdict": "duplicate", "reason": "same as a", "proof": "build:a"},
                             {"key": "build:d", "verdict": "done", "reason": "no", "proof": "commit:abc1234"}]})
dp = PC.deep_review(json.loads(json.dumps(base_plan)), fake, ev=EV, repo="https://github.com/o/r")
di = {i["key"]: i for i in dp["profiles"][0]["items"]}
ok(dp["mode"] == "deep" and di["build:a"]["verdict"] == "done" and di["build:a"]["by"] == "ai" and di["build:a"]["proof"]["url"].endswith("/commit/abc1234"), "Deep: an AI verdict with real proof is taken")
ok(di["build:b"]["verdict"] == "keep", "Deep: an AI verdict pointing at a commit that isn't there stays keep")
ok(di["build:c"]["verdict"] == "merge" and di["build:c"]["into"] == "a", "Deep: a duplicate of an open build becomes a merge")
ok(di["build:d"]["verdict"] == "keep", "Deep: running builds are never re-judged")
ok(dp["totals"]["done"] == 1 and dp["totals"]["merge"] == 1, "Deep: totals recounted")

import plugin_services  # noqa: E402
plugin_services.provide("axf.llm@1", FakeLlm({"verdicts": []}), "llm-provider")
alerts.clear()
dpv = c.post(f"{B}/profiles/preview", json={})
ok(dpv.status_code == 200 and dpv.json()["mode"] == "deep" and "Deep" in alerts[-1]["body"], f"auto picks Deep when an AI model is there ({dpv.text[:200]})")
ok(all("about" not in i for p in dpv.json()["profiles"] for i in p["items"]), "build details sent to the AI are not kept in the preview")

ap = c.post(f"{B}/profiles/apply", json={"run": pv["run"], "skip": []})
ok(ap.status_code == 200 and any(e["id"] == "ticked" for e in ap.json()["applied"]), f"apply cleans up ({ap.text[:200]})")
ok(json.loads((PCD / "store.json").read_text())["builds"][0]["status"] == "complete", "the store has it complete")
ok(c.post(f"{B}/profiles/apply", json={"run": pv["run"]}).status_code == 409, "a preview applies once")
ok(c.post(f"{B}/profiles/apply", json={"run": "../etc"}).status_code == 409, "bad run ids are refused")
ud = c.post(f"{B}/profiles/undo", json={"run": pv["run"]})
ok(ud.status_code == 200 and "ticked" in ud.json()["undo"]["restored"], "undo puts it back")
ok(c.post(f"{B}/profiles/undo", json={"run": pv["run"]}).status_code == 409, "one undo per run")
rl = c.get(f"{B}/profiles/runs").json()
ok(rl["ai"] is True and any(r["run"] == pv["run"] and r["state"] == "undone" for r in rl["runs"]), "runs list")

lt = time.localtime()
M.write_json(DATA / "settings.json", {**srv.settings(), "profileSchedule": "daily", "profileHour": lt.tm_hour, "profileMode": "basic"})
srv._set_state(lastProfilePreview=None)
tk = srv.tick()
ok((tk.get("profilePreview") or {}).get("mode") == "basic", f"the scheduled preview runs at its hour ({tk.get('profilePreview')})")
ok("profilePreview" not in srv.tick(), "… once a day")
ok(PC.due({"profileSchedule": "weekly", "profileHour": lt.tm_hour, "profileWeekday": (lt.tm_wday + 1) % 7}, None, time.time()) is False, "weekly waits for its day")
ok(PC.due({"profileSchedule": "off", "profileHour": lt.tm_hour}, None, time.time()) is False, "off by default")
ok(M.normalize_settings({"profileMode": "magic", "profileSchedule": "hourly"})["profileMode"] == "auto", "unknown profile settings fall back")

# plugin.json commands name only routes that exist
pj = json.loads((HERE / "plugin.json").read_text())
routes = {f"{m} {r.path}" for r in srv.router.routes if hasattr(r, "methods") for m in r.methods}
missing = [i["route"] for i in pj["commands"]["items"] if i["route"] not in routes]
ok(not missing, f"every declared command is a real route (missing {missing}, have {sorted(routes)})")
ok(pj.get("forFramework") is True, "forFramework: true (voice commands)")

print(f"maintenance: {n - failed}/{n} checks passed")
sys.exit(1 if failed else 0)
