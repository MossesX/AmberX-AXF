#!/usr/bin/env python3
"""Self-test for server/data_store.py: the storage-shaped data layer in local, shadow, cutover and rollback mode, against
an in-process axf-data (services/axf-data, FastAPI TestClient as the transport).

    python3 apps/console-web/server/test_data_store.py
"""
from __future__ import annotations

import hashlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(REPO / "services/axf-data"))
os.environ["AXF_DATA_NO_APP"] = "1"

fails = 0


def check(ok: bool, name: str) -> None:
    global fails
    print(f"  {'✓' if ok else '✗'} {name}")
    if not ok:
        fails += 1


tmp = Path(tempfile.mkdtemp())
os.environ["AXF_STATE"] = str(tmp / "console/state.json")
os.environ["AXHUB_PROJECTS_DIR"] = str(tmp / "projects")
tok = tmp / "tokens.json"
tok.write_text(json.dumps({"tokens": [{"id": "c", "sub": "svc:console", "sha256": hashlib.sha256(b"t").hexdigest(), "grants": {"*": ["admin"]}}]}))
os.environ["AXF_DATA_TOKENS_FILE"] = str(tok)

import data_store as ds  # noqa: E402
import main as axf_data  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

client = TestClient(axf_data.create_app(tmp / "axf-data"))


def transport(method, url, headers, body):
    r = client.request(method, url.replace("http://axf-data:7700", ""), headers=headers, content=body)
    return r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content


ds.set_remote(ds.Remote("http://axf-data:7700", "t", transport))
mode_file = tmp / "console/data-store/mode.json"


def set_mode(ns: str, mode: str) -> None:
    doc = json.loads(mode_file.read_text()) if mode_file.exists() else {"$axf": "data-store-mode@1", "mode": "local", "namespaces": {}}
    doc["namespaces"][ns] = {"mode": mode}
    mode_file.parent.mkdir(parents=True, exist_ok=True)
    mode_file.write_text(json.dumps(doc))
    os.utime(mode_file, ns=(time.time_ns(), time.time_ns() + 1))


P = tmp / "projects"
plans = P / "amberx-axf/_data/plan-studio/plans/p1.json"
note = P / "_shared/_claude/notes/handoffs/a.md"
items = tmp / "console/plugins/ui-review/items.json"
journal = REPO / "_claude/builds/journal/2099-01.jsonl"

print("data_store: path map")
ex = json.loads((REPO / "framework/schemas/data-store-paths.json").read_text())["examples"]
bad = [k for k, want in ex.items() if ds.map_rel(*k.split(":", 1)) != want]
check(not bad, f"every example in data-store-paths.json maps as written ({bad[:3]})")
check(ds.key_for(plans) == "planner/plans/p1.json" and ds.key_for(items) == "ui-review/items.json", "absolute paths find their root")
check(ds.key_for(journal) == "builds/journal/2099-01" and ds.kind_of("builds/journal/2099-01") == "journal", "build journals are journals")
check(ds.key_for("/etc/passwd") is None, "a path outside every root stays local")

print("data_store: local (default) = storage, nothing remote")
ds.write_json(plans, {"title": "one"})
check(ds.read_json(plans, None) == {"title": "one"} and json.loads(plans.read_text()) == {"title": "one"}, "write/read the file")
check(client.get("/v1/planner/plans/p1.json", headers={"authorization": "Bearer t"}).status_code == 404, "axf-data untouched in local")
check(ds.read_json(P / "missing.json", {"d": 1}) == {"d": 1}, "missing → a copy of the default")

print("data_store: shadow mirrors writes, never fails the caller")
set_mode("planner", "shadow")
ds.write_json(plans, {"title": "two"})
r = client.get("/v1/planner/plans/p1.json", headers={"authorization": "Bearer t"})
check(r.status_code == 200 and r.json() == {"title": "two"}, "write lands locally and on axf-data")
ds.write_json(plans, {"title": "three"})
check(client.get("/v1/planner/plans/p1.json", headers={"authorization": "Bearer t"}).json() == {"title": "three"}, "a second write re-reads the etag")
check(ds.read_json(plans, None) == {"title": "three"}, "reads come from the file")
ds.drain()
check(not (tmp / "console/data-store/drift/planner.jsonl").exists(), "equal sides log no drift")
saved = ds.REMOTE
ds.set_remote(ds.Remote("http://axf-data:7700", "t", lambda *a: (_ for _ in ()).throw(OSError("down"))))
orig_sleep = time.sleep
time.sleep = lambda s: None
ds.write_json(plans, {"title": "four"})
time.sleep = orig_sleep
ds.set_remote(saved)
check(json.loads(plans.read_text()) == {"title": "four"}, "axf-data down: the local write still succeeds")
drift = (tmp / "console/data-store/drift/planner.jsonl").read_text().splitlines()
check(len(drift) == 1 and json.loads(drift[0])["kind"] == "write-failed", "…and a write-failed drift line is logged")
# a read finds the difference (local four, remote three)
ds.read_json(plans, None)
ds.drain()
lines = (tmp / "console/data-store/drift/planner.jsonl").read_text().splitlines()
check(len(lines) == 2 and json.loads(lines[1])["kind"] == "etag", "a shadow read that differs logs an etag drift")
journal.parent.mkdir(parents=True, exist_ok=True)
set_mode("builds", "shadow")
ds.append_jsonl(journal, {"rev": 1})
ds.append_jsonl(journal, {"rev": 2})
r = client.get("/v1/builds/journal/2099-01?since=0", headers={"authorization": "Bearer t"}).json()
check([e["entry"] for e in r["entries"]] == [{"rev": 1}, {"rev": 2}] and len(journal.read_text().splitlines()) == 2, "journal appends mirror line for line")

print("data_store: cutover reads and writes axf-data only")
set_mode("planner", "cutover")
before = plans.read_text()
ds.write_json(plans, {"title": "five"})
check(plans.read_text() == before, "the local copy is left alone (read-only backup)")
check(ds.read_json(plans, None) == {"title": "five"}, "reads come from axf-data")
ds.set_remote(ds.Remote("http://axf-data:7700", "t", lambda *a: (_ for _ in ()).throw(OSError("down"))))
time.sleep = lambda s: None
check(ds.read_json(plans, None) == {"title": "four"}, "axf-data down: reads fall back to the local copy")
try:
    ds.write_json(plans, {"title": "six"})
    check(False, "a cutover write with axf-data down raises")
except ds.DataStoreError as e:
    check(e.code == "unavailable", "a cutover write with axf-data down raises unavailable")
time.sleep = orig_sleep
ds.set_remote(saved)
set_mode("builds", "cutover")
ds.append_jsonl(journal, {"rev": 3})
check(len(journal.read_text().splitlines()) == 2 and ds.read_text(journal).count("\n") == 3, "cutover appends go to axf-data; reads see all three")
set_mode("notes", "cutover")
ds.write_text(note, "# Hello\n")
check(not note.exists() and ds.read_text(note) == "# Hello\n", "notes are blobs on axf-data")
check(client.get("/v1/notes/handoffs/a.md", headers={"authorization": "Bearer t"}).headers["content-type"].startswith("text/markdown"), "…with their content type")

print("data_store: rollback holds writes")
set_mode("planner", "rollback")
try:
    ds.write_json(plans, {"x": 1})
    check(False, "rollback refuses writes")
except ds.DataStoreError as e:
    check(e.code == "read_only", "rollback refuses writes (read_only)")
check(ds.read_json(plans, None) == {"title": "five"}, "rollback reads from axf-data")

print("data_store: plugin data folders")
set_mode("ui-review", "shadow")
pd = ds.plugin("ui-review")
pd.write_json("items.json", {"items": [1]})
check(pd.read_json("items.json", None) == {"items": [1]} and pd.key("items.json") == "ui-review/items.json", "a plugin's dataDir through the layer")
import time as _t
_mir = None
for _ in range(50):  # the shadow mirror is written in the background; wait for it (flaky on slow CI runners)
    _res = client.get("/v1/ui-review/items.json", headers={"authorization": "Bearer t"})
    try:
        _mir = _res.json()
    except ValueError:  # the row is there but its body is not written yet
        _mir = None
    if _mir == {"items": [1]}:
        break
    _t.sleep(0.1)
check(_mir == {"items": [1]}, "…mirrored in shadow")
try:
    pd.path("../other/x.json")
    check(False, "a plugin can't leave its folder")
except ValueError:
    check(True, "a plugin can't leave its folder")
st = ds.status()
check(st["configured"] and st["namespaces"]["planner"]["mode"] == "rollback" and st["driftLines"]["planner"] == 3, "status: mode per namespace and drift lines")

print("builds_store: pipeline status is the summary query and one row, never the document")
import builds_store as bs  # noqa: E402

_pl = lambda **k: {"slot": "", "account": "", "queuedAt": "", **k}  # noqa: E731
_doc = {"$axf": "builds@1", "rev": 7, "updatedAt": "2026-11-25T12:00:00.000Z", "meta": {}, "builds": [
    {"id": "a", "title": "A", "status": "pending", "rev": 1, "steps": [{"id": "s1", "done": True}, {"id": "s2", "done": False}], "notes": []},
    {"id": "b", "title": "B", "status": "queued", "rev": 2, "priority": "P0", "pipeline": _pl(queuedAt="2026-11-25T10:00:00Z", queuedBy="console"), "steps": [], "notes": []},
    {"id": "c", "title": "C", "status": "running", "rev": 4, "number": "B-0007", "pipeline": _pl(slot="2", account="acct-one", session="axf-c"), "steps": [], "notes": [{"text": "n"}]},
    {"id": "d", "title": "D", "status": "building", "rev": 1, "pipeline": _pl(slot="1", account="acct-two"), "steps": []},
    {"id": "e", "title": "E", "status": "queued", "rev": 1, "deleted": True}]}
_r = client.put("/v1/builds/store.json", content=json.dumps(_doc), headers={"authorization": "Bearer t", "content-type": "application/json", "if-none-match": "*"})
check(_r.status_code in (200, 201), f"the builds store is on axf-data ({_r.status_code})")
set_mode("builds", "cutover")
_seen: list[str] = []
ds.set_remote(ds.Remote("http://axf-data:7700", "t", lambda m, u, h, b: (_seen.append(u), transport(m, u, h, b))[1]))
_old_store = os.environ.pop("AXF_BUILDS_STORE", None)
bs.clear()
_s = bs.pipeline_summary()
check(_s["$axf"] == "pipeline-summary@1" and _s["total"] == 4 and _s["counts"] == {"building": 1, "pending": 1, "queued": 1, "running": 1}, "counts by status, deleted builds left out")
check(_s["queued"]["id"] == "b" and _s["queued"]["queuedBy"] == "console" and [(r["id"], r["slot"], r["account"]) for r in _s["running"]] == [("d", "1", "acct-two"), ("c", "2", "acct-one")], "the queued build and the running builds with slot and account")
_local = bs.summary_of(_doc)
check(all(_local[k] == _s[k] for k in ("total", "counts", "queued", "queuedAll", "running")), "the file twin (before the cut) answers the same")
_b = bs.build("a")
check(_b is not None and _b["status"] == "pending" and len(_b["steps"]) == 2 and bs.build("nope") is None, "one build by its id, None for an unknown one")
check(bs.pipeline_summary() is _s, "polls inside the cache window share one read")
check(_seen and all(":summary" in u or ":item" in u for u in _seen), f"only :summary and :item were asked, never the document ({_seen[:4]})")
ds.set_remote(ds.Remote("http://axf-data:7700", "t", lambda *a: (_ for _ in ()).throw(OSError("down"))))
bs.clear()
try:
    bs.pipeline_summary()
    check(False, "axf-data down: an error, never a stale answer")
except ds.DataStoreError as e:
    check(e.code == "unavailable", "axf-data down: an error, never a stale answer")
ds.set_remote(ds.Remote("http://axf-data:7700", "t", transport))
bs.clear()
if _old_store is not None:
    os.environ["AXF_BUILDS_STORE"] = _old_store

journal.unlink(missing_ok=True)
print(f"data_store: {'all ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
