"""Paged routes of the build orchestrator server: no status file, never the whole set (Brett, Nov 25 2026).

    python apps/console-web/plugins/build-orchestrator/server/test_paging.py

The CLIs are stubbed (the routes' own work is what is checked): each list goes out one page at a time with limit,
offset and total, the rows keep their fields, status and project filter, and nothing here names or opens a status file.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from importlib import import_module
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
sys.path.insert(0, str(PLUGIN.parents[1] / "server"))
sys.path.insert(0, str(PLUGIN.parent))

tmp = Path(tempfile.mkdtemp())
STORE = tmp / "store.json"
N = 130
STATUSES = ("building", "pending", "archived", "failed")
builds = [{"id": f"b{i:03d}", "title": f"Build {i}", "status": STATUSES[i % 4], "profiles": ["other" if i % 10 == 0 else "all"],
           "updatedAt": f"2026-11-25T00:{i % 60:02d}:00Z", "steps": []} for i in range(N)]
STORE.write_text(json.dumps({"$axf": "builds@1", "rev": 9, "builds": builds}))
os.environ.update(AXF_BUILDS_STORE=str(STORE), AXF_DATA_DIR="off")

srv = import_module(f"{PLUGIN.name}.server")
paging = srv.paging
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


def code_of(fn) -> int:  # noqa: ANN001
    try:
        fn()
        return 200
    except srv.HTTPException as e:
        return e.status_code


# ---- the paging rules
check(paging.window() == (50, 0) and paging.window("7", "3") == (7, 3) and paging.window(9999, 0) == (paging.MAX_LIMIT, 0), "limit: 50 by default, 200 at most")
check(code_of(lambda: paging.window("x")) == 400 and code_of(lambda: paging.window(5, -1)) == 400, "a limit or offset that is no whole number ≥ 0 is a 400")
check(paging.statuses("failed, pending,,failed") == ["failed", "pending"] and paging.statuses(None) == [], "status: one, a comma list, or none")
rows = [{"id": b["id"], "status": b["status"]} for b in builds]
page, total = paging.cut(rows, 10, 20)
check(total == N and [r["id"] for r in page] == [f"b{i:03d}" for i in range(20, 30)], "a page is `limit` rows from `offset`, total counts them all")
page, total = paging.cut(rows, 5, 0, paging.Filter("failed"))
check(total == sum(1 for b in builds if b["status"] == "failed") and all(r["status"] == "failed" for r in page) and len(page) == 5, "status filters before paging")
page, total = paging.cut(rows, 200, 0, paging.Filter("", "other"))
check(total == 13 and {r["id"] for r in page} == {b["id"] for b in builds if b["profiles"] == ["other"]}, "project: rows that name no project are matched by id against the store's builds of that project")
page, total = paging.cut([{"id": "x", "profiles": ["other"]}, {"id": "y", "profiles": ["all"]}], 10, 0, paging.Filter("", "other"))
check(total == 1 and page[0]["id"] == "x", "project: a row that names its project is matched on it")
order = paging.live_first([{"id": 1, "status": "archived"}, {"id": 2, "status": "building"}, {"id": 3, "status": "pending", "hidden": True}, {"id": 4, "status": "failed"}])
check([r["id"] for r in order] == [2, 4, 1, 3], "live builds lead a list, settled and hidden ones follow, order kept")

# ---- the store reads behind the server: one page, one row
p = paging.store_page(status="pending,failed", project="all", limit=7, offset=7)
want = [b for b in builds if b["status"] in ("pending", "failed") and b["profiles"] == ["all"]]
check(p["ok"] and p["total"] == len(want) and len(p["items"]) == 7 and all(b["status"] in ("pending", "failed") for b in p["items"]), "store_page: by status and project, a page plus the total")
check(sum(p["counts"].values()) == sum(1 for b in builds if b["profiles"] == ["all"]), "store_page: counts per status for the project")
check(paging.store_build("b042")["status"] == STATUSES[42 % 4] and paging.store_build("nope") is None, "store_build: one row, or None")
check(len(paging.store_page(limit=99999)["items"]) <= paging.MAX_LIMIT, "store_page never answers more than the cap")

# ---- the routes (CLIs stubbed)
view = lambda b, **kw: {"id": b["id"], "title": b["title"], "status": b["status"], "steps": {"done": 0, "total": 0}, "actions": [], **kw}  # noqa: E731
TABS = {"pending": [view(b, tab="pending") for b in builds if b["status"] == "pending"], "queue": [], "active": [view(b, tab="active") for b in builds if b["status"] == "building"],
        "incomplete": [], "complete": [], "errors": [view(b, tab="errors") for b in builds if b["status"] == "failed"],
        "archive": [view(b, tab="archive") for b in builds if b["status"] == "archived"], "deleted": []}
STATUS = {"ok": True, "at": "now", "table": {"pending": TABS["pending"], "queued": [], "building": TABS["active"]}, "tabs": TABS,
          "accounts": [{"name": "a"}], "slots": {"cap": 6, "used": 1, "free": 5}, "plan": {"launches": [], "waits": []}, "settings": {"healthEveryMin": 5}, "health": {"accounts": []}}
FILL = {"ok": True, "at": "now", "settings": {"fillSlots": True}, "slots": {"cap": 2, "used": 1, "free": 1, "rows": [{"n": 1, "state": "running", "build": "b000"}, {"n": 2, "state": "free", "build": ""}]},
        "ready": [{"id": b["id"], "step": "s1"} for b in builds[:120]], "builds": [{"id": b["id"], "title": b["title"]} for b in builds[:60]],
        "plan": {"launches": [], "waits": []}, "sessions": []}
calls: list[tuple] = []


def fake_pipeline_run(*args: str, who: str = "") -> dict:
    calls.append(args)
    return FILL if args[:2] == ("fill", "status") else STATUS


srv._pipeline_run = fake_pipeline_run
srv._PIPE_CACHE.clear()

r = srv.pipeline_status()
check(r["ok"] and r["limit"] == 50 and r["offset"] == 0 and all(len(v) <= 50 for g in ("table", "tabs") for v in r[g].values()), "GET /pipeline: every build list is one page")
check(r["totals"]["tabs"] == {k: len(v) for k, v in TABS.items()} and r["totals"]["table"]["building"] == len(TABS["active"]) and r["total"] == N, "GET /pipeline: totals per list and over all tabs")
check(r["accounts"] == STATUS["accounts"] and r["slots"] == STATUS["slots"] and r["plan"] == STATUS["plan"] and r["tabs"]["active"][0] == TABS["active"][0], "GET /pipeline: accounts, slots, plan and each row's fields unchanged")
check(len(STATUS["tabs"]["archive"]) == len(TABS["archive"]) and "limit" not in STATUS, "the shared pipeline read is not changed by a page cut from it")
r = srv.pipeline_status(status="failed", limit=3)
check(r["totals"]["tabs"]["errors"] == len(TABS["errors"]) and len(r["tabs"]["errors"]) == 3 and r["totals"]["tabs"]["archive"] == 0, "GET /pipeline?status=failed&limit=3")

srv._PIPE_CACHE.clear()
calls.clear()
seen: list[str] = []
off = 0
while True:
    t = srv.pipeline_tab("archive", limit=10, offset=off)
    seen += [x["id"] for x in t["rows"]]
    off += len(t["rows"])
    if not t["rows"] or off >= t["total"]:
        break
check(t["ok"] and t["tab"] == "archive" and seen == [x["id"] for x in TABS["archive"]] and t["total"] == len(TABS["archive"]), "GET /pipeline/tab/archive: paged through to the end, in order, nothing lost or repeated")
check(len(calls) == 1, f"paging a tab shares one pipeline read ({len(calls)} CLI run(s))")
check(srv.pipeline_tab("errors", project="other")["total"] == sum(1 for b in builds if b["status"] == "failed" and b["profiles"] == ["other"]), "GET /pipeline/tab/errors?project=other")
check(code_of(lambda: srv.pipeline_tab("nope")) == 400 and code_of(lambda: srv.pipeline_tab("archive", limit=-1)) == 400, "an unknown tab or a bad limit is a 400")
check(srv.pipeline_health() == {"ok": True, "health": STATUS["health"], "every": 5}, "GET /pipeline/health still reads the account sweep")

f = srv.pipeline_fill()
check(f["ok"] and len(f["ready"]) == 50 and f["total"] == 120 and f["totals"] == {"ready": 120, "builds": 60, "sessions": 0} and f["slots"] == FILL["slots"] and f["settings"] == FILL["settings"], "GET /pipeline/fill: ready steps and builds one page each, slots and settings whole")
f = srv.pipeline_fill("", "free", "", 20, 100)
check([x["id"] for x in f["ready"]] == [b["id"] for b in builds[100:120]] and [s["n"] for s in f["slots"]["rows"]] == [2], "GET /pipeline/fill?status=free&limit=20&offset=100")

STATE = {"ok": True, "upgradePolicy": {"approval": False}, "state": {"$axf": "orchestrator@1", "updatedAt": "now", "rules": {"maxMinutes": 30},
                                                                    "builds": [{**b, "hidden": False} for b in builds]}}
state_calls: list[tuple] = []


def fake_run(*args: str, approver: str = "") -> dict:
    state_calls.append(args)
    return STATE


srv._run = fake_run
srv.readcache.invalidate(srv.STATE_KEY)
s1 = srv.state()
s2 = srv.state(limit=200, offset=50)
live = [b["id"] for b in builds if b["status"] != "archived"]
check(s1["ok"] and s1["upgradePolicy"] == STATE["upgradePolicy"] and s1["state"]["rules"] == STATE["state"]["rules"] and s1["state"]["$axf"] == "orchestrator@1", "GET /state: rules and upgrade policy as before")
check(len(s1["state"]["builds"]) == 50 and s1["total"] == N and [b["id"] for b in s1["state"]["builds"]] == live[:50], "GET /state: one page of builds, the live ones first")
check(len(s2["state"]["builds"]) == N - 50 and len(state_calls) == 1, "GET /state: the next page comes from the same CLI read")
check(srv.state(status="archived", project="other")["total"] == sum(1 for b in builds if b["status"] == "archived" and b["profiles"] == ["other"]), "GET /state?status=archived&project=other")
check(len(STATE["state"]["builds"]) == N, "the shared state read is not changed by a page cut from it")
srv.readcache.invalidate(srv.STATE_KEY)

TABLE = {"ok": True, "rev": 9, "updatedAt": "now", "profile": "all", "rows": [{"id": b["id"], "status": b["status"], "done": 0, "total": 0} for b in builds]}
srv._node_json = lambda cmd, timeout, **kw: TABLE
srv.readcache.invalidate("build-orchestrator:table:")
t = srv.status_table()
check(t["ok"] and t["rev"] == 9 and t["profile"] == "all" and len(t["rows"]) == 50 and t["total"] == N and t["limit"] == 50 and t["offset"] == 0, "GET /table: one page of rows, rev and profile as before")
check([x["id"] for x in srv.status_table(status="building", limit=4, offset=4)["rows"]] == [b["id"] for b in builds if b["status"] == "building"][4:8], "GET /table?status=building&limit=4&offset=4")
check(srv.status_table(since=9) == {"ok": True, "unchanged": True, "rev": 9}, "GET /table?since=<rev>: still nothing new at the same rev")
srv.readcache.invalidate("build-orchestrator:table:")

# ---- console-focus@1: one row asked of the store, never every build
fx = srv.ConsoleFocus()
asked: list[str] = []
real_build = paging.store_build
paging.store_build = lambda i: (asked.append(i), real_build(i))[1]
check(fx.resolve("b007") == {"screen": "build-orchestrator", "focus": "b007", "explicit": False} and fx.resolve("no-such-build") is None, "console-focus: a bare build id is a build when the store has that row")
fx.resolve("b007")
check(asked == ["b007", "no-such-build"], "console-focus: an answer is remembered, the store is asked once per id")
paging.store_build = real_build

# ---- no status file: nothing in server/ names it, and none of the reads above made one
gone = "orchestrator" + ".json"
named = [p.name for p in HERE.glob("*.py") if gone in p.read_text()]
check(not named, f"no file under server/ names the retired status file ({named})")
check(sorted(p.name for p in tmp.iterdir()) == ["store.json"], "reading pages writes no file beside the store")
biggest = max(len(json.dumps(x)) for x in (srv.pipeline_status(limit=10), srv.pipeline_tab("archive", limit=10), srv.pipeline_fill(limit=10)))
check(biggest < len(json.dumps(STATUS)), "a page is smaller than the set it is cut from")

print(f"\n{n} checks passed")
