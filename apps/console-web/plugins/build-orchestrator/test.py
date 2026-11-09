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
finally:
    srv.subprocess.run = _real_run

# ---- build queues (multi-queues-api-panel, Nov 9 2026): queues.mjs is called with fixed argv, Brett's click is the only
# approver, refusals map to 403 / 404 / 400
import asyncio  # noqa: E402
from types import SimpleNamespace  # noqa: E402

check(srv.QUEUES_CLI.is_file(), "queues.mjs is where the server looks for it")


class _Req:
    def __init__(self, body: dict, admin: bool = False, headers: dict | None = None) -> None:
        self._b = json.dumps(body).encode()
        self.headers = headers or {}
        self.state = SimpleNamespace(axf_user=SimpleNamespace(via="session", admin=True, name="brett") if admin else None)

    async def body(self) -> bytes:
        return self._b


_qcalls: list[tuple[list[str], dict]] = []


def _fake_queues(cmd, **kw):  # noqa: ANN001
    _qcalls.append((cmd, kw.get("env") or {}))
    if any("only Brett" in c for c in cmd) or (len(cmd) > 3 and '"approve"' in cmd[3] and "AXF_APPROVER" not in (kw.get("env") or {})):
        return _Proc('{"ok":false,"error":"running a build on an API key (billed per token) needs Brett\'s OK: his console click"}', 2)
    if any('"nope"' in c for c in cmd):
        return _Proc('{"ok":false,"error":"no queue \\"nope\\""}', 2)
    return _Proc('{"ok":true,"log":["done"],"doc":{"big":1}}')


srv.subprocess.run = _fake_queues
try:
    r = srv.queues_status()
    check(_qcalls[-1][0][1].endswith("queues.mjs") and _qcalls[-1][0][2] == "status", "GET /queues runs queues.mjs status --json")
    check("doc" not in r, "the whole store document is not sent back")
    asyncio.run(srv.queues_create(_Req({"name": "Night runs", "maxParallel": 2, "uses": "subscription", "evil": 1})))
    change = json.loads(_qcalls[-1][0][3])
    check(change == {"action": "create", "name": "Night runs", "uses": "subscription", "maxParallel": 2}, "create passes only queue fields")
    check("AXF_APPROVER" not in _qcalls[-1][1], "a token call carries no approver")
    asyncio.run(srv.queues_assign(_Req({"build": "alpha", "queue": "API"})))
    check(json.loads(_qcalls[-1][0][3]) == {"action": "assign", "build": "alpha", "queue": "API"}, "assign passes build and queue")
    try:
        asyncio.run(srv.queues_approve(_Req({"build": "alpha"})))
        check(False, "an API OK without Brett's click is refused")
    except srv.HTTPException as e:
        check(e.status_code == 403, "an API OK without Brett's click is a 403")
    asyncio.run(srv.queues_approve(_Req({"build": "alpha", "maxCostUsd": 3}, admin=True)))
    env = _qcalls[-1][1]
    check(env.get("AXF_APPROVER") == "brett" and env.get("AXF_APPROVER_VIA") == "console", "Brett's click is the approver")
    try:
        asyncio.run(srv.queues_approve(_Req({"build": "alpha"}, admin=True, headers={"x-axhub-session": "claude-1"})))
    except srv.HTTPException as e:
        check(e.status_code == 403, "a session header in Brett's browser is not his click")
    try:
        asyncio.run(srv.queues_pause(_Req({"queue": "nope"})))
        check(False, "an unknown queue is a 404")
    except srv.HTTPException as e:
        check(e.status_code == 404, "an unknown queue is a 404")
    for bad in ({"op": "zap", "rule": "x"}, {"op": "add", "rule": "x"}, {"op": "off", "rule": {"a": 1}}):
        try:
            asyncio.run(srv.queues_rule(_Req(bad)))
            check(False, f"bad rule call {bad} is refused")
        except srv.HTTPException as e:
            check(e.status_code == 400, f"bad rule call {bad['op']} is a 400")
    for bad in ("", "../x", "x" * 70):
        try:
            srv._queue_name(bad)
            check(False, f"bad queue name {bad!r} is refused")
        except srv.HTTPException as e:
            check(e.status_code == 400, f"bad queue name {bad[:10]!r} is a 400")
finally:
    srv.subprocess.run = _real_run

print(f"build-orchestrator: {n} checks passed")
