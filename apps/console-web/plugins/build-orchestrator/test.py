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

print(f"build-orchestrator: {n} checks passed")
