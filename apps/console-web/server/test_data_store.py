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

print("data_store: the pipeline status file is retired")
sf = tmp / "repo/_claude/builds/orchestrator.json"
sf.parent.mkdir(parents=True, exist_ok=True)
sf.write_text('{"builds": [{"id": "left-over"}]}')
pf = REPO / "_claude/builds/profiles/all/orchestrator.json"
check(ds.is_status_file(sf) and ds.is_status_file(pf) and ds.is_status_file("_claude/builds/orchestrator.json"), "the file and a profile's copy are recognised")
check(not ds.is_status_file(REPO / "_claude/builds/store.json") and not ds.is_status_file(tmp / "fixtures/orchestrator.json"), "…and nothing else is")
check(ds.key_for(pf) is None and ds.key_for(REPO / "_claude/builds/orchestrator.json") is None, "it has no data-store key")
check(ds.read_json(sf, "gone") == "gone" and ds.read_bytes(sf) is None and not ds.exists(sf), "a leftover copy is never read")
refused = 0
for write in (lambda: ds.write_json(sf, {"builds": []}), lambda: ds.write_text(pf, "{}"), lambda: ds.append_jsonl(sf, {})):
    try:
        write()
    except ds.DataStoreError as e:
        refused += e.code == "gone"
check(refused == 3 and sf.read_text().startswith('{"builds": [{"id": "left-over"') and not pf.exists(), "a write raises gone and creates nothing")
check(client.get("/v1/builds/orchestrator.json", headers={"authorization": "Bearer t"}).status_code == 404, "nothing reached axf-data")
check(ds.remove(sf) and not sf.exists(), "a leftover copy can be removed")

print("data_store: build status is rows of the builds store")
STORE = {"$axf": "builds@1", "rev": 7, "builds": [
    {"id": f"b{i}", "title": f"Build {i}", "status": ["running", "queued", "landed", "landed", "pending"][i % 5], "rev": 1,
     "profiles": ["axf"] if i % 2 else ["voicevault"], "updatedAt": f"2026-11-25T10:{i:02d}:00.000Z", "steps": [{"id": "s1", "status": "pending"}], "notes": []}
    for i in range(10)] + [{"id": "old", "status": "landed", "rev": 1, "deleted": True, "profiles": ["axf"], "steps": [], "notes": []}]}
set_mode("builds", "local")
store_file = tmp / "store.json"
store_file.write_text(json.dumps(STORE))
os.environ["AXF_BUILDS_STORE"] = str(store_file)
pg = ds.builds_page()
check(pg["$axf"] == "builds-page@1" and pg["ok"] and pg["total"] == 10 and pg["counts"] == {"landed": 4, "pending": 2, "queued": 2, "running": 2} and pg["rev"] == 7, "counts per status, deleted builds left out")
pg = ds.builds_page(status="landed", limit=3)
check([b["id"] for b in pg["items"]] == ["b8", "b7", "b3"] and pg["total"] == 4 and pg["next"] == 3, "a status page, newest first")
pg = ds.builds_page(status="landed", limit=3, offset=3)
check([b["id"] for b in pg["items"]] == ["b2"] and pg["next"] is None, "the next page ends it")
pg = ds.builds_page(status=["running", "queued"], project="axf")
check(sorted(b["id"] for b in pg["items"]) == ["b1", "b5"] and pg["counts"] == {"landed": 2, "pending": 1, "queued": 1, "running": 1} and pg["all"] == 5, "status list and project together; counts keep every status of the project")
check(len(ds.builds_page(limit=10_000)["items"]) == 10 and ds.builds_page(limit=10_000)["limit"] == ds.PAGE_MAX and ds.builds_counts("voicevault")["running"] == 1, "the page size is capped; counts alone carry no builds")
b = ds.build_update("b1", {"status": "landed", "pr": "12"})
on_disk = json.loads(store_file.read_text())
check(b["status"] == "landed" and b["rev"] == 2 and b["statusBy"] == "console" and on_disk["rev"] == 8 and [x for x in on_disk["builds"] if x["id"] == "b1"][0]["pr"] == "12"
      and ds.build_row("b1")["status"] == "landed" and len(on_disk["builds"]) == 11, "before the cut a row update lands in the store's file")
del os.environ["AXF_BUILDS_STORE"]
ds.builds_clear()

set_mode("builds", "cutover")
ds.REMOTE.put_latest("builds/store.json", json.dumps(STORE).encode(), "application/json")
check(ds.builds_on_tables() and ds.builds_page(status="queued", fresh=True)["total"] == 2, "after the cut the page comes from axf-data")
b = ds.build_update("b6", {"status": "landed", "branch": "claude/b6"}, by="lander")
got = json.loads(client.get("/v1/builds/store.json", headers={"authorization": "Bearer t"}).content)
row = [x for x in got["builds"] if x["id"] == "b6"][0]
check(row["status"] == "landed" and row["branch"] == "claude/b6" and row["rev"] == 2 and row["statusBy"] == "lander" and got["rev"] == 8
      and row["steps"] == [{"id": "s1", "status": "pending"}], "a row update is a data-patch on that build")
check([x for x in got["builds"] if x["id"] != "b6"] == [x for x in STORE["builds"] if x["id"] != "b6"], "…and the other builds are untouched")
check(ds.builds_page(status="queued")["total"] == 1 and ds.builds_counts()["landed"] == 5, "the next read sees it")
# another writer changes the row between our read and our patch: the patch is refused once, re-read, applied
real_patch, raced = ds.REMOTE.patch, []


def racing_patch(key, body):
    if not raced:
        raced.append(1)
        other = dict(row, rev=3, title="renamed elsewhere")
        real_patch(key, {"lists": {"builds": [{"key": "b6", "ifRev": 2, "item": other}]}})
    return real_patch(key, body)


ds.REMOTE.patch = racing_patch
b = ds.build_update("b6", {"pr": "44"})
ds.REMOTE.patch = real_patch
check(b["pr"] == "44" and b["title"] == "renamed elsewhere" and b["rev"] == 4, "a conflict re-reads the row and keeps the other writer's change")
try:
    ds.build_update("nope", {"status": "landed"})
    check(False, "an unknown build is not_found")
except ds.DataStoreError as e:
    check(e.code == "not_found", "an unknown build is not_found")
set_mode("builds", "rollback")
try:
    ds.build_update("b6", {"status": "failed"})
    check(False, "rollback refuses a row update")
except ds.DataStoreError as e:
    check(e.code == "read_only", "rollback refuses a row update")
check(ds.builds_page(status="landed")["total"] == 5, "rollback still reads the rows")

journal.unlink(missing_ok=True)
print(f"data_store: {'all ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
