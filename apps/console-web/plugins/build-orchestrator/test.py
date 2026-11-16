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
