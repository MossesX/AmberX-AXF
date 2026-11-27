"""Build orchestrator server self-test: the "Console sees the builds" systems check (auto-land s5, Nov 3 2026).

    python apps/console-web/plugins/build-orchestrator/test.py
"""
from __future__ import annotations

import json
import sys
import tempfile
import time
from importlib import import_module
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]  # apps/console-web
sys.path.insert(0, str(ROOT / "server"))
sys.path.insert(0, str(HERE.parent))

srv = import_module("build-orchestrator.server")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


now = time.time()
iso = lambda t: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))  # noqa: E731
with tempfile.TemporaryDirectory() as d:
    month = Path(d) / time.strftime("%Y/%m", time.gmtime(now))
    month.mkdir(parents=True)
    (month / "chg-1.json").write_text(json.dumps({"status": "running", "lastSeenAt": iso(now - 60), "title": "auto-land"}))
    (month / "chg-2.json").write_text(json.dumps({"status": "running", "lastSeenAt": iso(now - 3 * 3600), "title": "stale"}))
    (month / "chg-3.json").write_text(json.dumps({"status": "done", "lastSeenAt": iso(now), "title": "finished"}))
    run = srv.running_now(now, Path(d))
    check(run == ["auto-land"], "only Build manager entries running with a fresh heartbeat count")

r = srv.sees_probe({"total": 0, "error": "store.json: unexpected end of JSON"}, ["auto-land"])
check(r["status"] == "error" and "0 builds while 1 build(s) run" in r["summary"] and "unexpected end" in r["summary"], "builds running + console sees 0 = red, with why")
check(srv.sees_probe({"total": 0}, [])["status"] == "ok", "nothing running and nothing seen = fine")
r = srv.sees_probe({"total": 276, "running": [{"id": "x"}]}, ["auto-land"])
check(r["status"] == "ok" and "276 build(s)" in r["summary"], "builds seen = green")
r = srv.sees_probe(None, [])
check(r["status"] == "ok" and "build(s)" in r["summary"], "the real read (framework/cli/build-queue.mjs buildsSummary) answers")
# the CLIs this server runs exist (ROOT once pointed at apps/, so the origin and live ones were never found)
for f in (srv.CLI, srv.ORIGIN_CLI, srv.LIVE_CLI, srv.PRIORITY_CLI):
    check(f.is_file(), f"{f.name} is where the server looks for it")
try:
    srv.priority_get("build-priority-no-such-build-at-all")
    check(False, "an unknown build is a 404")
except srv.HTTPException as e:
    check(e.status_code == 404, "an unknown build is a 404")
check("map" in srv.priority_list(), "the tag list answers through the real CLI")
# ---- the one status table (status-table@1, Pipeline 2.0): a test store, compact rows, the merge queue, since=<rev>
import os  # noqa: E402
check(srv.TABLE_CLI.is_file(), "status-table.mjs is where the server looks for it")
with tempfile.TemporaryDirectory() as d:
    store = Path(d) / "store.json"
    b = lambda i, st, **kw: {"id": i, "title": i.upper(), "status": st, "profiles": ["all"], "createdAt": iso(now - 600), "updatedAt": iso(now - 60), **kw}  # noqa: E731
    store.write_text(json.dumps({"$axf": "builds@1", "rev": 7, "updatedAt": iso(now), "builds": [
        b("t-build", "building", steps=[{"id": "s1", "text": "one", "done": True}, {"id": "s2", "text": "two"}]),
        b("t-ci", "landing", pr="https://github.com/o/r/pull/12"), b("t-landed", "landed"), b("t-old", "archived")]}))
    keep = {k: os.environ.get(k) for k in ("AXF_BUILDS_STORE", "AXF_BUILDS_EXPORT", "AXF_BUILDS_LIVE")}
    os.environ.update(AXF_BUILDS_STORE=str(store), AXF_BUILDS_EXPORT="0", AXF_BUILDS_LIVE="0")
    try:
        srv.readcache.invalidate("build-orchestrator:table:")
        t = srv.status_table()
        rows = {r["id"]: r for r in t.get("rows", [])}
        check(t["ok"] and set(rows) == {"t-build", "t-ci"}, f"GET /table: open builds only, landed and archived left out ({sorted(rows)})")
        check(rows["t-build"]["done"] == 1 and rows["t-build"]["total"] == 2 and rows["t-ci"]["prNumber"] == 12 and rows["t-ci"]["status"] == "merging-pr", "a row carries steps done/total, its PR number and the contract status (landing reads as merging-pr)")
        check([r["id"] for r in srv.status_table(queue=True)["rows"]] == ["t-ci"], "GET /table?queue=1: the merge queue only")
        check("t-landed" in [r["id"] for r in srv.status_table(landed=True)["rows"]], "GET /table?landed=1: landed builds too")
        check(srv.status_table(since=7) == {"ok": True, "unchanged": True, "rev": 7}, "since=<rev> at the same rev: nothing new")
    finally:
        srv.readcache.invalidate("build-orchestrator:table:")
        for k, v in keep.items():
            if v is None:
                os.environ.pop(k, None)
            else:
                os.environ[k] = v

# ---- a node CLI that hangs (audit F2): one process for every concurrent reader, a 503 with the reason, never a 500
import subprocess  # noqa: E402
import threading  # noqa: E402
real_run, calls = srv.subprocess.run, []


def slow_timeout(cmd, **kw):  # noqa: ANN001, ANN003, ANN201
    calls.append(cmd)
    time.sleep(0.3)
    raise subprocess.TimeoutExpired(cmd, kw.get("timeout"))


srv.subprocess.run = slow_timeout
try:
    srv.readcache.invalidate("build-orchestrator:")
    codes: list[int] = []

    def read() -> None:
        try:
            srv.status_table()
            codes.append(200)
        except srv.HTTPException as e:
            codes.append(e.status_code)

    ts = [threading.Thread(target=read) for _ in range(6)]
    for x in ts:
        x.start()
    for x in ts:
        x.join()
    check(len(calls) == 1, f"six concurrent table reads on a cache miss start one node process ({len(calls)})")
    check(codes == [503] * 6, f"a CLI timeout answers 503 with the reason, not a 500 ({codes})")
    srv.readcache.invalidate("build-orchestrator:")
    try:
        srv.priority_list()
        check(False, "a priority list timeout is a 503")
    except srv.HTTPException as e:
        check(e.status_code == 503 and "longer than" in e.detail, "a priority list timeout is a 503 that says why")
    check(srv._run("state").get("timeout") is True, "an orchestrator CLI timeout is an answer, not an exception")
finally:
    srv.subprocess.run = real_run
    srv.readcache.invalidate("build-orchestrator:")

# ---- the build pipeline routes (Nov 8 2026): the CLI is where the server looks, ids are checked, errors map to codes
check(srv.PIPELINE_CLI.is_file(), "pipeline.mjs is where the server looks for it")
for bad in ("", "../x", "A B", "x" * 90):
    try:
        srv._build_id(bad)
        check(False, f"bad build id {bad!r} is refused")
    except srv.HTTPException as e:
        check(e.status_code == 400, f"bad build id {bad!r} is a 400")
check(srv._build_id("my-build.2") == "my-build.2", "a plain build id passes")


class _Proc:
    def __init__(self, out: str, code: int = 0, err: str = "") -> None:
        self.stdout, self.returncode, self.stderr = out, code, err


_calls: list[list[str]] = []


def _fake_run(cmd, **kw):  # noqa: ANN001
    _calls.append(cmd)
    if "no-such-build" in cmd:
        return _Proc('{"ok":false,"error":"no build \"no-such-build\""}', 2)
    if "refused" in cmd:
        return _Proc('{"ok":false,"error":"refused is complete: only a Pending build can be queued"}', 2)
    return _Proc('{"ok":true,"table":{"pending":[],"queued":[],"building":[]},"accounts":[],"slots":{"used":0,"cap":3,"free":3},"plan":{"launches":[],"waits":[],"idle":null}}')


_real_run = srv.subprocess.run
srv.subprocess.run = _fake_run
try:
    r = srv._pipeline("status")
    check(r["ok"] and "pipeline.mjs" in _calls[-1][1] and _calls[-1][-1] == "--json", "status runs pipeline.mjs status --json")
    srv._pipeline("queue", "alpha", "--by", "Brett", who="Brett")
    check(_calls[-1][2:5] == ["queue", "alpha", "--by"], "queue passes the id and who moved it")
    try:
        srv._pipeline("queue", "no-such-build")
        check(False, "an unknown build is a 404")
    except srv.HTTPException as e:
        check(e.status_code == 404, "an unknown build is a 404")
    try:
        srv._pipeline("queue", "refused")
        check(False, "a refused move is a 400")
    except srv.HTTPException as e:
        check(e.status_code == 400 and "only a Pending build" in e.detail, "a refused move is a 400 with the reason")
    # one way to start builds: the dispatch service every other plugin uses; API switches are Brett's own click
    import asyncio
    import plugin_services

    class _Req:
        def __init__(self, body: dict, brett: bool = False) -> None:
            self._b = json.dumps(body).encode()
            self.headers: dict[str, str] = {}
            self.state = type("S", (), {"axf_user": type("U", (), {"via": "session", "admin": True, "name": "Brett"})() if brett else None})()

        async def body(self) -> bytes:
            return self._b

    svc = plugin_services.get("axf.build-dispatch@1")
    check(svc is not None, "axf.build-dispatch@1 is provided: the one way for other plugins to start a build")
    svc.request("Fix systems check: mosh", "Install mosh.", by="systems-check", source="systems-check", priority="P1", queue=True)
    cmd = _calls[-1]
    check(cmd[2] == "request" and "--queue" in cmd and cmd[cmd.index("--priority") + 1] == "P1" and cmd[cmd.index("--by") + 1] == "systems-check" and "--detail-file" in cmd, "request: title, detail in a file, priority, by, straight to the Queue")
    for body, brett, want in (({"apiOverflow": True}, False, 403), ({"apiOverflow": False}, False, 200), ({"apiOverflow": True}, True, 200)):
        try:
            asyncio.run(srv.pipeline_settings_set(_Req(body, brett)))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == want, f"API overflow {'on' if body['apiOverflow'] else 'off'} by {'Brett' if brett else 'a session'}: {want}")
    check(_calls[-1][-2] == "apiOverflow=true", "a Python bool reaches the CLI as true/false")
    for route, brett, want in (("api", False, 403), ("api", True, 200), ("subscription", False, 200), ("nowhere", True, 400)):
        try:
            asyncio.run(srv.pipeline_route(_Req({"id": "alpha", "route": route}, brett)))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == want, f"route {route} by {'Brett' if brett else 'a session'}: {want}")
    # hold / archive / delete / restore on one build or many (bulk select)
    asyncio.run(srv.pipeline_action(_Req({"action": "hold", "ids": ["alpha", "beta"], "why": "later"}, True)))
    cmd = _calls[-1]
    check(cmd[2:5] == ["hold", "alpha", "beta"] and cmd[cmd.index("--by") + 1] == "Brett" and cmd[cmd.index("--why") + 1] == "later", "action: hold on two builds, by Brett, with the reason")
    asyncio.run(srv.pipeline_action(_Req({"action": "delete", "id": "alpha"})))
    check(_calls[-1][2:4] == ["delete", "alpha"] and "--why" not in _calls[-1], "action: one id works too; no reason, no --why")
    for body, want in (({"action": "purge", "ids": ["alpha"]}, 400), ({"action": "hold", "ids": ["../x"]}, 400), ({"action": "hold", "ids": []}, 400)):
        try:
            asyncio.run(srv.pipeline_action(_Req(body)))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == want, f"action {body}: {want}")
    check(set(srv.BUILD_ACTIONS) == {"unqueue", "hold", "release", "archive", "unarchive", "delete", "restore"} and "archive" in srv.PIPELINE_TABS and "deleted" in srv.PIPELINE_TABS, "no hard delete: actions and the Archive / Deleted tabs")
    # ---- fill every slot (Nov 13 2026): GET /pipeline/fill, POST /pipeline/fill/run, steps/:step/deps, fill settings
    srv.pipeline_fill()
    check(_calls[-1][2:4] == ["fill", "status"] and _calls[-1][-1] == "--json", "GET /pipeline/fill runs pipeline.mjs fill status")
    srv.pipeline_fill("dag")
    check(_calls[-1][2:5] == ["fill", "status", "dag"], "?build=<id> adds the build")
    try:
        srv.pipeline_fill("../x")
        check(False, "a bad build id is a 400")
    except srv.HTTPException as e:
        check(e.status_code == 400, "a bad build id is a 400")
    asyncio.run(srv.pipeline_fill_run(_Req({}, True)))
    check(_calls[-1][2:4] == ["fill", "run"] and _calls[-1][_calls[-1].index("--by") + 1] == "Brett", "POST /pipeline/fill/run: one round, by Brett")
    asyncio.run(srv.step_deps("dag", "s4", _Req({"dependsOn": ["s1", "s2"]})))
    check(_calls[-1][2:6] == ["fill", "deps", "dag", "s4"] and json.loads(_calls[-1][6]) == ["s1", "s2"], "deps: the list reaches the CLI as JSON")
    asyncio.run(srv.step_deps("dag", "s4", _Req({"dependsOn": None})))
    check(_calls[-1][6] == "sequential", "deps: null = sequential")
    for step, body in (("S4!", {"dependsOn": []}), ("s4", {"dependsOn": "s1"}), ("s4", {"dependsOn": ["../x"]})):
        try:
            asyncio.run(srv.step_deps("dag", step, _Req(body)))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == 400, f"deps {step} {body}: 400")

    class _FakeSettings:
        """axf.claude-settings@1 stand-in: owner from the request, owner-only refused for anyone else."""
        def __init__(self) -> None:
            self.sets: list[tuple[bool, dict]] = []

        def set_for(self, request, values):  # noqa: ANN001
            owner = srv.brett_click(request) != ""
            self.sets.append((owner, values))
            if not owner and (values.get("builds.fillSlots") is True or "builds.autoQueuePending" in values):
                return {"ok": False, "code": "denied", "message": "owner-only"}
            return {"ok": True, "changed": [{"key": k, "from": None, "to": v} for k, v in values.items()]}

    fake = _FakeSettings()
    _real_get = plugin_services.get
    plugin_services.get = lambda cap: fake if cap == "axf.claude-settings@1" else _real_get(cap)  # type: ignore[assignment]
    try:
        for body, brett, want in (({"autoQueuePending": True}, False, 403), ({"autoQueuePending": False}, False, 403), ({"autoQueuePending": True}, True, 200),
                                  ({"fillSlots": False}, False, 200), ({"fillSlots": True}, False, 403), ({"maxParallelPerBuild": 2}, False, 200),
                                  ({"maxParallelPerBuild": 40}, True, 400), ({"fillSlots": "yes"}, True, 400), ({}, True, 400)):
            try:
                asyncio.run(srv.pipeline_fill_settings(_Req(body, brett)))
                code = 200
            except srv.HTTPException as e:
                code = e.status_code
            check(code == want, f"fill settings {body} by {'Brett' if brett else 'a session'}: {want}")
        check(fake.sets[-1] == (False, {"builds.maxParallelPerBuild": 2}), "fill settings go to axf.claude-settings@1 under their Claude keys")
        try:
            asyncio.run(srv.pipeline_settings_set(_Req({"autoQueuePending": True})))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == 403, "POST /pipeline/settings refuses autoQueuePending unless Brett's own session sends it")
        r = asyncio.run(srv.pipeline_settings_set(_Req({"fillSlots": False, "maxRuns": 3})))
        check("changed" in r and _calls[-1][2:4] == ["set", "maxRuns=3"], "POST /pipeline/settings: fill keys and pipeline keys in one call")
    finally:
        plugin_services.get = _real_get  # type: ignore[assignment]
    # done-means-merged@1: GET attempts/<id>, POST retry/<id> {strategy?, why?}
    srv.build_attempts("alpha")
    check(_calls[-1][2:4] == ["attempts", "alpha"] and _calls[-1][-1] == "--json", "attempts: pipeline.mjs attempts <id> --json")
    try:
        srv.build_attempts("../x")
        check(False, "attempts: a bad id is refused")
    except srv.HTTPException as e:
        check(e.status_code == 400, "attempts: a bad id is a 400")
    try:
        srv.build_attempts("no-such-build")
        check(False, "attempts: an unknown build is a 404")
    except srv.HTTPException as e:
        check(e.status_code == 404, "attempts: an unknown build is a 404")
    asyncio.run(srv.build_retry("alpha", _Req({}, True)))
    cmd = _calls[-1]
    check(cmd[2:4] == ["retry", "alpha"] and cmd[4] == "--by" and cmd[5] == "Brett" and "--why" not in cmd, "retry: no strategy, by Brett")
    asyncio.run(srv.build_retry("alpha", _Req({"strategy": "fix:regenerate", "why": "fixtures drifted"})))
    cmd = _calls[-1]
    check(cmd[2:5] == ["retry", "alpha", "fix:regenerate"] and cmd[cmd.index("--why") + 1] == "fixtures drifted", "retry: a strategy and the reason reach the CLI")
    for strategy in ("escalate", "fix", "rm -rf", "switch-model:Fable"):
        try:
            asyncio.run(srv.build_retry("alpha", _Req({"strategy": strategy})))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == 400, f"retry: strategy {strategy!r} is refused (400)")
    check(srv.escalated_probe([])["status"] == "ok", "builds-escalated: green with nothing escalated")
    red = srv.escalated_probe([{"id": "alpha", "kind": "crash", "why": "every rung tried", "tried": ["retry", "fresh-session"], "since": "2026-11-17T00:00:00Z"}])
    check(red["status"] == "error" and "alpha" in red["summary"] and "retry, fresh-session" in red["details"][0] and red["link"] == "row:alpha/tab:attempts", "builds-escalated: red with what broke, every try, since when, and the Attempts deep link")
finally:
    srv.subprocess.run = _real_run

# console-focus@1 (console-commands-reliable, Nov 11 2026): a build named in a console command opens here, focused on it
fx = srv.ConsoleFocus()
_store = Path(tempfile.mkdtemp()) / "store.json"
_store.write_text(json.dumps({"builds": [{"id": "console-commands-reliable"}, {"id": "plan-studio"}]}))
fx.store = lambda: _store  # type: ignore[method-assign]
check(fx.resolve("build:Any-Build") == {"screen": "build-orchestrator", "focus": "Any-Build", "explicit": True}, "build:<id> is always a build")
check(fx.resolve("console-commands-reliable") == {"screen": "build-orchestrator", "focus": "console-commands-reliable", "explicit": False}, "a bare build id from the store")
check(fx.resolve("plan studio") is None and fx.resolve("no-such-build") is None and fx.resolve("build:") is None, "anything else is not a build")
check(srv.plugin_services.get("console-focus@1") is not None, "provided as console-focus@1")

# custom groups and custom tabs (Nov 13 2026): the routes run groups.mjs on a scratch store and pipeline dir
import asyncio  # noqa: E402
import os  # noqa: E402

_gd = Path(tempfile.mkdtemp())
(_gd / "store.json").write_text(json.dumps({"$axf": "builds@1", "rev": 1, "builds": [
    {"id": "console-app-a", "title": "Console app A", "status": "pending", "profiles": ["all"], "steps": [{"id": "s1", "text": "x", "model": "Opus"}]}]}))
_env = {"AXF_BUILDS_STORE": str(_gd / "store.json"), "AXF_PIPELINE_DIR": str(_gd / "pipe"), "AXF_BUILD_PROFILE": "all", "AXF_BUILDS_LIVE": "0",
        "AXF_BUILD_HOOKS": "off", "AXF_SHIPPED": "off", "AXF_DATA_DIR": "off", "AXF_CREW_SAY": "off", "AXF_PIPELINE_CONSOLE": "off"}
_saved = {k: os.environ.get(k) for k in _env}
os.environ.update(_env)
try:
    made = asyncio.run(srv.groups_change(_Req({"op": "create", "name": "Console app", "tab": "pending", "rule": {"titleContains": "console app"}})))
    check(made["group"]["id"] == "console-app" and made["group"]["total"] == 1, "POST groups create: a smart group with its own Pending tab")
    check([t["id"] for t in srv.groups_tabs()["tabs"]] == ["group:console-app"], "GET groups/tabs: the custom Pending tab")
    check(srv.groups_get("Console app")["group"]["counts"]["pending"] == 1, "GET groups/{group} by name: counts per state")
    for body, want in (({"op": "explode"}, 400), ({"op": "delete", "group": "nope"}, 404)):
        try:
            asyncio.run(srv.groups_change(_Req(body)))
            code = 200
        except srv.HTTPException as e:
            code = e.status_code
        check(code == want, f"groups {body}: {want}")
    done = asyncio.run(srv.groups_action("console-app", _Req({"action": "queue"})))
    check(done["done"] == ["console-app-a"], "POST groups/{group}/action queue: the group's Pending build is queued")
finally:
    for k, v in _saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v

print(f"build-orchestrator: {n} checks passed")
