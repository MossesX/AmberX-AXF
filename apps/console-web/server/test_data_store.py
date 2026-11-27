#!/usr/bin/env python3
"""Self-test for server/data_store.py: Postgres is the one store. Every mapped path is a key on axf-data only (no local
file, no shadow or dual write, no fallback to a stale file); only a path the map keeps local is a file. Runs against an
in-process axf-data (services/axf-data, FastAPI TestClient as the transport), and checks the console server's own
readers and writers (state, alerts, build profiles, projects, host mode) go through the layer.

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

H = {"authorization": "Bearer t"}
DOWN = ds.Remote("http://axf-data:7700", "t", lambda *a: (_ for _ in ()).throw(OSError("down")))
saved = ds.REMOTE
orig_sleep = time.sleep


def remote(key: str):
    r = client.get(f"/v1/{key}", headers=H)
    return r.json() if r.status_code == 200 else None


def down(fn):
    """Run fn with axf-data unreachable; return the DataStoreError code it raised (or None)."""
    ds.set_remote(DOWN)
    time.sleep = lambda s: None
    try:
        fn()
        return None
    except ds.DataStoreError as e:
        return e.code
    finally:
        time.sleep = orig_sleep
        ds.set_remote(saved)


ds.STORE_MODE = "cutover"  # the map's `store.mode` (framework/schemas/data-store-paths.json): Postgres is the one store

print("data_store: a path the map keeps local is a file")
scratch = tmp / "elsewhere/x.json"
check(ds.key_for(scratch) is None, "a path outside every root has no key")
ds.write_json(scratch, {"a": 1})
check(json.loads(scratch.read_text()) == {"a": 1} and ds.read_json(scratch, None) == {"a": 1}, "…and is read and written as a file")
check(ds.read_json(tmp / "elsewhere/missing.json", {"d": 1}) == {"d": 1}, "missing → a copy of the default")

print("data_store: a mapped path is axf-data only")
check(ds.mode_of("planner/plans/p1.json") == "cutover", "store.mode cutover: every mapped key is cutover")
ds.write_json(plans, {"title": "one"})
check(not plans.exists(), "a write leaves no file")
check(remote("planner/plans/p1.json") == {"title": "one"}, "…it is a row on axf-data")
ds.write_json(plans, {"title": "two"})
check(remote("planner/plans/p1.json") == {"title": "two"}, "a second write re-reads the etag")
plans.parent.mkdir(parents=True, exist_ok=True)
plans.write_text(json.dumps({"title": "stale"}))
check(ds.read_json(plans, None) == {"title": "two"}, "reads come from axf-data, never the stale file beside it")
check(down(lambda: ds.read_json(plans, None)) == "unavailable", "axf-data down: a read raises unavailable (no local fallback)")
check(down(lambda: ds.write_json(plans, {"title": "x"})) == "unavailable", "axf-data down: a write raises unavailable")
check(down(lambda: ds.exists(plans)) == "unavailable", "axf-data down: exists raises too")
check(json.loads(plans.read_text()) == {"title": "stale"}, "the stale file is never written")
plans.unlink()
ds.mirror(plans, b'{"title": "mirror"}')
check(remote("planner/plans/p1.json") == {"title": "two"}, "mirror() does nothing: there is no dual write")
check(not (tmp / "console/data-store/drift").exists(), "nothing compares or logs drift in the background")
journal.parent.mkdir(parents=True, exist_ok=True)
journal.unlink(missing_ok=True)
ds.append_jsonl(journal, {"rev": 1})
ds.append_jsonl(journal, {"rev": 2})
r = client.get("/v1/builds/journal/2099-01?since=0", headers=H).json()
check([e["entry"] for e in r["entries"]] == [{"rev": 1}, {"rev": 2}] and not journal.exists(), "journal appends go to axf-data, no file")
check(ds.read_text(journal).count("\n") == 2, "…and read back line for line")
ds.write_text(note, "# Hello\n")
check(not note.exists() and ds.read_text(note) == "# Hello\n", "notes are blobs on axf-data")
check(client.get("/v1/notes/handoffs/a.md", headers=H).headers["content-type"].startswith("text/markdown"), "…with their content type")
check(ds.exists(note) and ds.remove(note) and not ds.exists(note), "exists / remove on the key")

print("data_store: the mode document can't bring a file back")
set_mode("planner", "local")
check(ds.mode_of("planner/plans/p1.json") == "cutover", "local in the mode document is still cutover")
ds.STORE_MODE = ""  # an older map without store.mode
set_mode("planner", "shadow")
check(ds.mode_of("planner/plans/p1.json") == "cutover", "shadow (the old dual write) reads as cutover")
ds.STORE_MODE = "cutover"

print("data_store: rollback holds writes")
set_mode("planner", "rollback")
try:
    ds.write_json(plans, {"x": 1})
    check(False, "rollback refuses writes")
except ds.DataStoreError as e:
    check(e.code == "read_only", "rollback refuses writes (read_only)")
check(ds.read_json(plans, None) == {"title": "two"}, "rollback reads from axf-data")

print("data_store: plugin data folders")
pd = ds.plugin("ui-review")
pd.write_json("items.json", {"items": [1]})
check(pd.read_json("items.json", None) == {"items": [1]} and pd.key("items.json") == "ui-review/items.json", "a plugin's dataDir through the layer")
check(not pd.path("items.json").exists() and remote("ui-review/items.json") == {"items": [1]}, "…a row on axf-data, no file")
try:
    pd.path("../other/x.json")
    check(False, "a plugin can't leave its folder")
except ValueError:
    check(True, "a plugin can't leave its folder")
st = ds.status()
check(st["configured"] and st["namespaces"]["planner"]["mode"] == "rollback" and not st["driftLines"], "status: mode per namespace, no drift lines")

print("data_store: the console server's readers and writers")
import build_profiles  # noqa: E402
import projects as projects_mod  # noqa: E402
import host_mode  # noqa: E402
hub = P / "amberx-axf/_data"
repo_root = tmp / "repo"
(repo_root / "framework/plan").mkdir(parents=True, exist_ok=True)
(repo_root / "framework/plan/profiles.json").write_text(json.dumps({"active": "repo-copy", "profiles": [{"id": "repo-copy"}]}))
(repo_root / "framework/plan/projects.json").write_text(json.dumps({"projects": [{"id": "repo-copy"}]}))
if ds.key_for(hub / "framework/plan/profiles.json"):
    bp = build_profiles.BuildProfiles(repo_root, lambda: hub)
    check(bp.registry()["active"] == "all", "build profiles: an empty hub key is the registry, never the checkout's file")
    ds.write_json(hub / "framework/plan/profiles.json", {"active": "all", "profiles": [{"id": "all"}, {"id": "side"}]})
    check([x["id"] for x in bp.registry()["profiles"]] == ["all", "side"] and not (hub / "framework/plan/profiles.json").exists(), "…the registry is read from axf-data")
    check(bp.data_path("framework/plan/pending.json") == hub / "framework/plan/pending.json", "…and the pending list resolves to the hub key")
    pj = projects_mod.Projects(repo_root, lambda: hub, bp.active)
    ds.write_json(hub / "framework/plan/projects.json", {"projects": [{"id": "amberx-axf"}, {"id": "side-project"}]})
    check([x["id"] for x in pj.registry()["projects"]] == ["amberx-axf", "side-project"], "projects: the registry is read from axf-data")
else:
    check(False, "the hub's framework/plan documents have a key")
os.environ["AXF_HOST_MODE_FILE"] = str(hub / "host-services/mode.json")
if ds.key_for(hub / "host-services/mode.json"):
    ds.write_json(hub / "host-services/mode.json", {"services": {"x": {"mode": "host"}}})
    check(host_mode.host_mode("x") == "host" and not host_mode.container_runs("x"), "host mode: the mode document is read from axf-data")
os.environ.pop("AXF_HOST_MODE_FILE")
import alerts as alerts_mod  # noqa: E402
data_root = tmp / "console"
if ds.key_for(data_root / "alerts.json"):
    ah = alerts_mod.AlertHub(data_root, plugins={})
    ah.raise_alert({"source": "system", "severity": "warning", "title": "from the test"}, deliver=False)
    check(not (data_root / "alerts.json").exists() and [a["title"] for a in remote("console/host/alerts.json")] == ["from the test"], "alerts: the list is a row on axf-data, no file")
    check([a["title"] for a in alerts_mod.AlertHub(data_root, plugins={}).items] == ["from the test"], "…and read back after a restart")
check(ds.key_for(data_root / "state.json") == "console/state.json", "console state maps to console/state.json")

journal.unlink(missing_ok=True)
print(f"data_store: {'all ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
