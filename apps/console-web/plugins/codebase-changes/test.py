#!/usr/bin/env python3
"""Self-test for the Codebase changes plugin: validation, the folder store, every route (scratch folders), close
everywhere, pagination and filters, file modes, the Python and Node validators agreeing, and — through the real console
app in a child process — the console token on every method and 404 when the plugin is off. Also runs test.mjs.

    python3 apps/console-web/plugins/codebase-changes/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import stat
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
SERVER = HERE.parent.parent / "server"
ok = 0


def check(cond: bool, msg: str) -> None:
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


# ---------------------------------------------------------------- child process: the real console app (auth + 404)
if "--console" in sys.argv:
    tmp = Path(tempfile.mkdtemp(prefix="axf-changes-console-"))
    TOKEN = "c" * 32
    os.environ.update({"AXF_STATE": str(tmp / "state.json"), "AXF_DATA_DIR": str(tmp / "data"), "AXF_TOKEN": TOKEN, "AXF_CHANGES_DIR": str(tmp / "changes")})
    os.environ.pop("GITHUB_TOKEN", None)
    sys.path.insert(0, str(SERVER))
    from fastapi.testclient import TestClient  # noqa: E402

    import main  # noqa: E402

    c = TestClient(main.app, raise_server_exceptions=False)
    H = {"authorization": f"Bearer {TOKEN}"}
    base = "/api/plugins/codebase-changes"
    check(main.PLUGINS.get("codebase-changes", {}).get("server") == "loaded", "the console loads the plugin's server part")
    check(main.plugin_enabled("codebase-changes"), "enabled by default")
    for method, path in (("get", "/entries"), ("get", "/where"), ("post", "/entries"), ("patch", "/entries/chg-20261021-abcdef1234"),
                         ("post", "/entries/chg-20261021-abcdef1234/close"), ("post", "/close-all")):
        check(getattr(c, method)(base + path, **({"json": {}} if method != "get" else {})).status_code == 401, f"{method.upper()} {path} needs the console token")
    check(c.get(base + "/entries", headers={"authorization": "Bearer wrong"}).status_code == 401, "a wrong token is refused")
    r = c.post(base + "/entries", headers=H, json={"title": "Through the console", "kind": "build"})
    check(r.status_code == 200 and r.json()["id"].startswith("chg-"), "with the token an entry opens")
    check(c.get(base + "/entries", headers=H).json()["total"] == 1, "and lists")
    check(c.post("/api/plugins/codebase-changes/enabled", headers=H, json={"enabled": False}).status_code == 200, "switch the plugin off")
    check(c.get(base + "/entries", headers=H).status_code == 404, "off → its routes answer 404")
    check(c.post(base + "/entries", headers=H, json={"title": "x"}).status_code == 404, "off → writes answer 404 too")
    c.post("/api/plugins/codebase-changes/enabled", headers=H, json={"enabled": True})
    check(c.get(base + "/entries", headers=H).status_code == 200, "back on → routes answer again")
    mcp = c.post("/mcp", headers={**H, "accept": "application/json, text/event-stream"}, json={"jsonrpc": "2.0", "id": 1, "method": "tools/list"})
    check("codebase" not in mcp.text.lower(), "no console MCP tool reaches it")
    print(f"CONSOLE_OK {ok}")
    sys.exit(0)


# ---------------------------------------------------------------- the plugin's server part on scratch folders
ROOT = Path(tempfile.mkdtemp(prefix="axf-changes-root-"))
DATA = Path(tempfile.mkdtemp(prefix="axf-changes-data-"))
os.environ.pop("AXF_CHANGES_DIR", None)
sys.path.insert(0, str(SERVER))
import console_context as cx  # noqa: E402

# a session that couldn't reach the hub left one entry in the repo's changes/: it seeds the hub folder on first use
seed = {"$axf": "change-log@1", "id": "chg-20261001-aaaaaa0001", "createdAt": "2026-10-01T09:00:00.000Z", "updatedAt": "2026-10-01T09:00:00.000Z",
        "kind": "fix", "title": "Seeded from the repo", "asked": "", "repos": ["MossesX/AmberX-AXF"], "model": "", "who": {}, "state": "done",
        "steps": [], "result": {"state": "done", "summary": "ok"}, "closed": {"at": "2026-10-01T10:00:00.000Z", "by": "cli"}}
(ROOT / "changes" / "2026" / "10").mkdir(parents=True)
(ROOT / "changes" / "2026" / "10" / f"{seed['id']}.json").write_text(json.dumps(seed))
cx.set_context(ROOT=ROOT, persist_root=lambda: DATA)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.codebase_changes_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
store_mod = sys.modules["axf_console_plugins.codebase_changes_test.store"]

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

print("validation")
good = {"id": "chg-20261021-0123456789", "title": "Add a banner", "kind": "build", "asked": "please add ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123 to it",
        "repos": ["MossesX/AmberX-AXF"], "steps": ["one", {"text": "two", "state": "done"}],
        "result": {"state": "done", "summary": "token=supersecretvalue done", "commits": ["ABCDEF1", {"sha": "1234567890", "message": "msg"}],
                   "filesChanged": 3, "tests": {"plugin test": "12/12", "web": {"before": "0", "after": "5", "state": "pass"}},
                   "links": {"report": "_claude/memory/docs/x.md", "pr": "https://github.com/MossesX/AmberX-AXF/pull/9"}}}
e, errs = store_mod.normalize(good)
check(e is not None and not errs, "a full entry passes")
check("[hidden]" in e["asked"] and "ghp_" not in e["asked"], "a GitHub token in the request is hidden")
check("supersecret" not in e["result"]["summary"], "a token=… value in the summary is hidden")
check(e["steps"][0] == {"text": "one", "state": "queued"}, "a plain string step becomes a queued step")
check(e["result"]["commits"][0] == {"sha": "abcdef1"}, "commit shas are lower-cased")
check(e["result"]["tests"]["plugin test"] == {"after": "12/12"}, "a test given as a string is its after value")
check(e["state"] == "done" and e["closed"] is None, "state comes from the result; not closed")
bad_cases = {
    "no id": {**good, "id": "x"},
    "no title": {**good, "title": " "},
    "bad kind": {**good, "kind": "Build It!"},
    "bad repo": {**good, "repos": ["not a repo"]},
    "bad step state": {**good, "steps": [{"text": "a", "state": "maybe"}]},
    "too many steps": {**good, "steps": ["s"] * 101},
    "bad result state": {**good, "result": {"state": "great", "summary": ""}},
    "bad sha": {**good, "result": {"state": "done", "summary": "", "commits": ["zzz"]}},
    "javascript link": {**good, "result": {"state": "done", "summary": "", "links": {"x": "javascript:alert(1)"}}},
    "http link": {**good, "result": {"state": "done", "summary": "", "links": {"x": "http://example.com"}}},
    "traversal link": {**good, "result": {"state": "done", "summary": "", "links": {"x": "../../etc/passwd"}}},
    "negative files": {**good, "result": {"state": "done", "summary": "", "filesChanged": -1}},
    "bad branch": {**good, "result": {"state": "done", "summary": "", "branch": "a..b"}},
    "not an object": ["x"],
}
for name, raw in bad_cases.items():
    e2, errs2 = store_mod.normalize(raw)
    check(e2 is None and errs2, f"refused: {name}")
long, _ = store_mod.normalize({**good, "title": "t" * 500, "asked": "a" * 5000})
check(len(long["title"]) == 160 and len(long["asked"]) == 600, "long text is cut, not refused")
huge, errs3 = store_mod.normalize({**good, "steps": [{"text": "s" * 300, "note": "n" * 1000}] * 100})
check(huge is None and any("KB" in x for x in errs3), "an entry over 64 KB is refused")

print("build stats (Build manager)")
build_good = {**good, "result": None, "status": "running", "buildRef": {"kind": "pending", "id": "lib-clone"}, "surface": "claude-ai",
              "startedAt": "2026-10-21T10:00:00.000Z", "lastSeenAt": "2026-10-21T10:05:00.000Z", "estimate": {"minutes": 90.5, "costUsd": 12.345678},
              "actual": {"minutes": 3, "inputTokens": 100, "outputTokens": 5, "source": "transcript"}, "branch": "feat/x",
              "areas": ["apps/x", "apps/x", "framework/core/*.ts"], "parent": "chg-20261021-abcdef1234", "progress": 0.33333, "doing": "Editing x token=abcdefghijk",
              "verify": {"state": "broken", "at": "2026-10-21T11:00:00.000Z", "summary": "tsc failed", "checks": {"tsc": "fail", "vite": "pass"}}}
be, berrs = store_mod.normalize(build_good)
check(be is not None and not berrs, "a build entry passes")
check(be["estimate"] == {"minutes": 91, "costUsd": 12.3457} and be["areas"] == ["apps/x", "framework/core/*.ts"] and be["costEstimated"] is True, "rounded like JS, areas unique, costEstimated derived")
check("[hidden]" in be["doing"] and be["status"] == "running" and be["progress"] == 0.333, "doing redacted; status + progress")
check(store_mod.normalize(good)[0]["status"] == "done" and "estimate" not in store_mod.normalize(good)[0], "an old entry only gains the derived status")
check(store_mod.is_stale({"status": "running", "lastSeenAt": "2020-01-01T00:00:00.000Z"}) and not store_mod.is_stale({"status": "done", "lastSeenAt": "2020-01-01T00:00:00.000Z"}), "stale = running and not seen for 10 min")
check(store_mod.summary(be)["buildRef"]["id"] == "lib-clone" and store_mod.summary(be)["verify"]["state"] == "broken", "summaries carry build stats")
build_bad = {
    "bad status": {**build_good, "status": "flying"},
    "bad ref": {**build_good, "buildRef": {"kind": "Pending!", "id": "x"}},
    "bad surface": {**build_good, "surface": "Claude AI"},
    "negative estimate": {**build_good, "estimate": {"minutes": -5}},
    "huge cost": {**build_good, "estimate": {"costUsd": 1e9}},
    "string tokens": {**build_good, "actual": {"inputTokens": "12"}},
    "bool cost flag": {**build_good, "costEstimated": "yes"},
    "abs area": {**build_good, "areas": ["/etc"]},
    "traversal area": {**build_good, "areas": ["a/../b"]},
    "bad parent": {**build_good, "parent": "nope"},
    "progress > 1": {**build_good, "progress": 2},
    "bad verify": {**build_good, "verify": {"state": "great"}},
    "bad verify check": {**build_good, "verify": {"state": "verified", "checks": {"x": "ok"}}},
}
for name, raw in build_bad.items():
    e2, errs2 = store_mod.normalize(raw)
    check(e2 is None and errs2, f"refused: {name}")
bad_cases.update(build_bad)

print("Python and Node validators agree")
cases = [good, {**good, "title": "t" * 500}, build_good, {**build_good, "result": {"state": "cancelled", "summary": ""}, "status": "queued"},
         {**build_good, "actual": {"costUsd": 0.12345}, "costEstimated": None}, *bad_cases.values()]
for i, raw in enumerate(cases):
    r = subprocess.run(["node", str(HERE / "changes.mjs"), "validate"], input=json.dumps(raw), capture_output=True, text=True, timeout=20)
    js = json.loads(r.stdout)
    py, _ = store_mod.normalize(raw)
    same = (js["ok"] == (py is not None)) and (py is None or {k: v for k, v in js["entry"].items() if k not in ("createdAt", "updatedAt")} == {k: v for k, v in py.items() if k not in ("createdAt", "updatedAt")})
    check(same, f"case {i + 1}: same verdict{' and same entry' if py else ''}")

print("routes")
w = c.get("/p/where").json()
check(w["where"] == "hub" and w["path"] == str(DATA / "changes"), "the log lives in the shared data folder (the hub)")
check((DATA / "changes" / "2026" / "10" / f"{seed['id']}.json").exists(), "the repo's entries seeded the hub folder on first use")
r = c.post("/p/entries", json={"title": "Build the plugin", "kind": "build", "asked": "make it", "repos": ["MossesX/AmberX-AXF"], "steps": ["plan", "write"]})
check(r.status_code == 200, "POST entries opens one")
a = r.json()
check(a["state"] == "running" and a["who"].get("user") == "console", "a new entry is running; who = the console caller")
f = DATA / "changes" / a["createdAt"][:4] / a["createdAt"][5:7] / f"{a['id']}.json"
check(f.exists() and stat.S_IMODE(f.stat().st_mode) == 0o600, "one file per entry at changes/<YYYY>/<MM>/<id>.json, 0600 outside the hub tree")
fixed = {"id": "chg-20261021-feedc0ffee", "title": "From a hook", "kind": "edit"}
r1 = c.post("/p/entries", json=fixed).json()
r2 = c.post("/p/entries", json={**fixed, "title": "different"}).json()
check(r2.get("existed") is True and r2["title"] == "From a hook" and r1["id"] == r2["id"], "opening an existing id returns it unchanged (idempotent hooks)")
check(c.post("/p/entries", json={"title": "x", "evil": 1}).status_code == 400, "unknown fields are refused")
check(c.post("/p/entries", json={"title": "x", "id": "../../etc"}).status_code == 400, "a bad id is refused")
check(c.post("/p/entries", content=b"[1,2]", headers={"content-type": "application/json"}).status_code == 400, "a non-object body is refused")
check(c.post("/p/entries", content=b"{" + b" " * (130 * 1024) + b"}", headers={"content-type": "application/json"}).status_code == 413, "a body over 128 KB is refused")
check(c.get("/p/entries/chg-20991231-0000000000").status_code == 404, "an unknown id is 404")
check(c.get("/p/entries/nope").status_code == 400, "a malformed id is 400")

r = c.patch(f"/p/entries/{a['id']}", json={"step": {"text": "plan", "state": "running"}})
check(r.status_code == 200 and r.json()["steps"][0]["state"] == "running" and "startedAt" in r.json()["steps"][0], "PATCH step upserts by text and stamps startedAt")
r = c.patch(f"/p/entries/{a['id']}", json={"step": {"index": 0, "state": "done", "note": "planned"}})
s0 = r.json()["steps"][0]
check(s0["state"] == "done" and s0.get("finishedAt") and s0["note"] == "planned", "PATCH step by index finishes it with a note")
r = c.patch(f"/p/entries/{a['id']}", json={"step": {"text": "test"}})
check(len(r.json()["steps"]) == 3, "a new step text is appended")
check(c.patch(f"/p/entries/{a['id']}", json={"step": {"text": "x", "state": "weird"}}).status_code == 400, "a bad step state is refused")
check(c.patch(f"/p/entries/{a['id']}", json={"steps": "no"}).status_code == 400, "steps must be a list")
check(c.patch(f"/p/entries/{a['id']}", json={"oops": 1}).status_code == 400, "unknown patch fields are refused")
r = c.patch(f"/p/entries/{a['id']}", json={"result": {"state": "partial", "summary": "half"}})
check(r.json()["state"] == "partial", "PATCH result sets the state")
r = c.patch(f"/p/entries/{a['id']}", json={"result": {"state": "done", "branch": "feat/x", "commits": ["abc1234"]}})
check(r.json()["result"] == {"state": "done", "summary": "half", "branch": "feat/x", "commits": [{"sha": "abc1234"}], "tests": {}, "links": {}}, "PATCH result merges over the old result")
check(c.patch("/p/entries/chg-20991231-0000000000", json={"title": "x"}).status_code == 404, "patching an unknown entry is 404")

print("close everywhere")
check(c.get("/p/entries?open=1").json()["total"] == 2, "two entries in the banner (the seeded one was closed)")
r = c.post(f"/p/entries/{a['id']}/close", json={})
check(r.json()["closed"]["by"] == "console" and r.json()["closed"]["at"], "close stores {at, by} in the entry")
check(a["id"] not in [x["id"] for x in c.get("/p/entries?open=1").json()["items"]], "a closed entry leaves the banner list")
other_device = store_mod.Store(DATA / "changes")
check(other_device.get(a["id"])["closed"] is not None and other_device.query(open_only=True)["total"] == 1, "a second reader of the same folder sees it closed (closed everywhere)")
check(c.post(f"/p/entries/{a['id']}/close", json={}).json()["closed"]["at"] == r.json()["closed"]["at"], "closing twice keeps the first close")
check(c.post(f"/p/entries/{a['id']}/reopen").json()["closed"] is None, "reopen puts it back in the banner")
check(c.post("/p/close-all", json={"ids": ["bad"]}).status_code == 400, "close-all checks its ids")
check(c.post("/p/close-all", json={}).json()["closed"] == 2, "close-all closes every open entry")
check(c.get("/p/entries?open=1").json()["total"] == 0, "the banner list is empty")
check(c.get(f"/p/entries/{a['id']}").json()["result"]["state"] == "done", "closing never touches the record itself")


print("pagination + filters")
for i in range(7):
    c.post("/p/entries", json={"id": f"chg-202610{10 + i:02d}-{i:010x}", "createdAt": f"2026-10-{10 + i:02d}T08:00:00.000Z", "title": f"Item {i}",
                               "kind": "remove" if i % 2 else "build", "repos": ["MossesX/axHub" if i == 3 else "MossesX/AmberX-AXF"],
                               "result": {"state": "failed", "summary": "broke the zebra"} if i == 5 else None})
p1 = c.get("/p/entries?limit=4").json()
check(p1["total"] == 10 and len(p1["items"]) == 4 and p1["nextCursor"] == p1["items"][-1]["id"], "first page of 4 with a cursor")
check([x["createdAt"] for x in p1["items"]] == sorted([x["createdAt"] for x in p1["items"]], reverse=True), "newest first")
p2 = c.get(f"/p/entries?limit=4&cursor={p1['nextCursor']}").json()
p3 = c.get(f"/p/entries?limit=4&cursor={p2['nextCursor']}").json()
ids = [x["id"] for x in p1["items"] + p2["items"] + p3["items"]]
check(len(ids) == 10 and len(set(ids)) == 10 and p3["nextCursor"] is None, "three pages cover all 10 once, then no cursor")
check(c.get("/p/entries?kind=remove").json()["total"] == 3, "filter by kind")
check(c.get("/p/entries?state=failed").json()["total"] == 1, "filter by state")
check(c.get("/p/entries?q=ZEBRA").json()["total"] == 1, "search is case-insensitive over the result too")
check(c.get("/p/entries?repo=MossesX/axHub").json()["total"] == 1, "filter by repo")
check(c.get("/p/entries?from=2026-10-12&to=2026-10-14").json()["total"] == 3, "filter by date range")
check(c.get("/p/entries?closed=1").json()["total"] == 3, "closed only")
check(c.get("/p/entries?from=yesterday").status_code == 400 and c.get("/p/entries?kind=BAD!").status_code == 400 and c.get("/p/entries?cursor=x").status_code == 400, "bad filters are refused")
counts = c.get("/p/entries").json()["counts"]
check(counts["total"] == 10 and counts["byKind"]["remove"] == 3 and counts["open"] == 7, "counts by kind and open")

print("shared tree modes")
shared = Path(tempfile.mkdtemp(prefix="axf-changes-shared-"))
os.chmod(shared, 0o2775)
st2 = store_mod.Store(shared / "changes")
e3 = st2.put({"id": "chg-20261021-5555555555", "title": "Shared"})
p = st2.path_of(e3["id"])
check(stat.S_IMODE(p.stat().st_mode) == 0o660, "in a setgid (hub) tree files are 0660 so axHub can read them")
check(stat.S_IMODE(p.parent.stat().st_mode) == 0o2770, "and new folders 2770")
check(not any(x.name.endswith(".tmp") for x in p.parent.iterdir()), "no temp files left behind (atomic write)")

print("service axf.changes@1")
import plugin_services  # noqa: E402

svc = plugin_services.get("axf.changes@1")
check(svc is not None, "provides axf.changes@1")
e4 = svc.open({"title": "From another plugin", "kind": "other"}, "plugin:test")
check(svc.update(e4["id"], {"step": {"text": "go", "state": "done"}})["steps"][0]["state"] == "done", "update through the service")
check(svc.close(e4["id"], "plugin:test")["closed"]["by"] == "plugin:test", "close through the service")

print("trash can on a stuck entry")
st = c.post("/p/entries", json={"title": "Stuck build", "kind": "build", "steps": [{"text": "one", "state": "done"}, {"text": "two", "state": "running"}, {"text": "three", "state": "queued"}]}).json()
r = c.post(f"/p/entries/{st['id']}/abandon", json={})
got = c.get(f"/p/entries/{st['id']}").json()
check(r.status_code == 200 and got["closed"] and got["result"]["state"] == "failed" and "Stalled" in got["result"]["summary"], "abandon: finished as failed (stalled) and closed everywhere")
check([x["state"] for x in got["steps"]] == ["done", "skipped", "skipped"], "abandon: unfinished steps are skipped, done ones kept")
check(got.get("status") == "failed", "abandon: build status failed (the Build manager's Live list drops it)")
r = c.post(f"/p/entries/{a['id']}/abandon", json={})
check(c.get(f"/p/entries/{a['id']}").json()["result"]["state"] == "done", "abandon never overwrites a result it already has")
check(c.post("/p/entries/chg-20991231-0000000000/abandon", json={}).status_code == 404, "abandon: unknown entry is 404")
e5 = svc.open({"title": "Stuck elsewhere", "kind": "build"}, "plugin:test")
check(svc.abandon(e5["id"], "plugin:test")["result"]["state"] == "failed", "abandon through the service (the Build manager's trash can)")

print("console app (child process)")
r = subprocess.run([sys.executable, str(Path(__file__).resolve()), "--console"], capture_output=True, text=True, timeout=180)
sys.stdout.write("".join(f"  {ln}\n" for ln in r.stdout.splitlines() if ln.strip().startswith("✓")))
check(r.returncode == 0 and "CONSOLE_OK" in r.stdout, f"auth + 404 through the real console{'' if r.returncode == 0 else ': ' + (r.stdout + r.stderr)[-800:]}")
ok += int(r.stdout.split("CONSOLE_OK")[-1].strip() or 0) if "CONSOLE_OK" in r.stdout else 0

print("test.mjs")
r = subprocess.run(["node", str(HERE / "test.mjs")], capture_output=True, text=True, timeout=120)
check(r.returncode == 0, f"CLI + hook tests pass{'' if r.returncode == 0 else ': ' + (r.stdout + r.stderr)[-800:]}")
print(r.stdout.strip().splitlines()[-1] if r.stdout.strip() else "")

print(f"\n{ok} checks passed")
