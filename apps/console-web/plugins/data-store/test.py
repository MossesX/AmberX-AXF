#!/usr/bin/env python3
"""Data store plugin: voice phrases → actions, and the routes against an in-process axf-data.

    python3 apps/console-web/plugins/data-store/test.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "apps/console-web/server"))
sys.path.insert(0, str(REPO / "services/axf-data"))
os.environ["AXF_DATA_NO_APP"] = "1"
tmp = Path(tempfile.mkdtemp())
os.environ["AXF_STATE"] = str(tmp / "console/state.json")
os.environ["AXF_DATA_BACKUPS"] = str(tmp / "backups")
(tmp / "tokens.json").write_text(json.dumps({"tokens": [{"id": "c", "sub": "svc:console", "sha256": hashlib.sha256(b"t").hexdigest(), "grants": {"*": ["read", "write", "append"]}}]}))
os.environ["AXF_DATA_TOKENS_FILE"] = str(tmp / "tokens.json")

spec = importlib.util.spec_from_file_location("dsp", HERE / "server/__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["dsp"] = mod
spec.loader.exec_module(mod)
from dsp import routes as R  # noqa: E402

import data_store  # noqa: E402
import main as axf_data  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

fails = 0


def check(ok: bool, name: str) -> None:
    global fails
    print(f"  {'✓' if ok else '✗'} {name}")
    fails += 0 if ok else 1


print("data-store plugin: voice")
cases = {"back up the data": {"action": "backup"}, "verify the backup": {"action": "verify"}, "where is my data": {"action": "state"},
         "shadow the planner": {"action": "mode", "to": "shadow", "ns": "planner"}, "cut settings over": {"action": "mode", "to": "cutover", "ns": "settings"},
         "roll back the builds": {"action": "mode", "to": "rollback", "ns": "builds"}, "shadow plugin shipped-features": {"action": "mode", "to": "shadow", "ns": "plugins/shipped-features"},
         "show the drift for notes": {"action": "drift", "ns": "notes"},
         "what tables are there": {"action": "tables"}, "which engine is the data on": {"action": "engine"},
         "cut over to postgres": {"action": "engine", "to": "postgres"}, "shadow the engine on postgres": {"action": "engine", "to": "shadow"},
         "go back to sqlite": {"action": "engine", "to": "sqlite"}, "sync the chats": {"action": "sync", "source": "plugins/chat-viewer/chats.db"},
         "mirror the shipped features ledger": {"action": "sync", "source": "plugins/shipped-features/ledger.sqlite"},
         "what's left to cut over": {"action": "cuts"}, "cut the console state over": {"action": "cut", "group": "console", "do": "cutover"},
         "backfill the console group": {"action": "cut", "group": "console", "do": "copy"}, "verify the console keys": {"action": "cut", "group": "console", "do": "verify"}}
for phrase, want in cases.items():
    check(R.parse_phrase(phrase) == want, f"{phrase!r} → {want}")
r = R.voice(R.VoiceBody(phrase="cut settings over"))
check(r["did"] == "ask" and "Say yes" in r["say"], "a move asks before it runs")
r = R.voice(R.VoiceBody(phrase="cut the console state over"))
check(r["did"] == "ask" and "console" in r["say"], "a data cut asks before it runs")
check(set(R.CUT_ACTIONS) == {"copy", "verify", "cutover", "sync", "local"}, "cut actions match data-cut.mjs")
r = R.voice(R.VoiceBody(phrase="cut over to postgres"))
check(r["did"] == "ask" and r["would"] == {"action": "engine", "to": "postgres"}, "an engine move asks before it runs")
r = R.voice(R.VoiceBody(phrase="sync the chats"))
check(r["did"] == "ask" and "chats.db" in r["say"], "a mirror run asks before it runs")

print("data-store plugin: routes against axf-data")
client = TestClient(axf_data.create_app(tmp / "axf-data"))
data_store.set_remote(data_store.Remote("http://axf-data:7700", "t", lambda m, u, h, b: (lambda r: (r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content))(client.request(m, u.replace("http://axf-data:7700", ""), headers=h, content=b))))
R.mode_status = lambda force=False: {"namespaces": [{"ns": "settings", "mode": "local", "since": "", "drift": 0, "lastDriftAt": "", "cursor": 0, "next": "shadow", "nextReason": ""}], "summary": []}
client.put("/v1/settings/a.json", content="{}", headers={"authorization": "Bearer t", "content-type": "application/json", "if-none-match": "*"})
s = R.state()
check(s["configured"] and s["reachable"] and s["counts"] == {"settings": 1} and s["namespaces"][0]["keys"] == 1, "state: reachable, keys per namespace, mode rows")
job = R.backup()
check(job["state"] in ("running", "done"), "Backup now starts a job on axf-data")
for _ in range(600):  # up to 30 s: a CI runner or a container takes longer than a workstation
    b = R.state()["backup"]
    if b["job"]["state"] != "running":
        break
    time.sleep(0.05)
check(b["job"]["state"] == "done" and b["last"]["verify"]["ok"], "…which finishes verified")
check(R.voice(R.VoiceBody(phrase="where is the data"))["say"].startswith("axf-data is up"), "voice: state in one sentence")
t = R.tables()
check(t["$axf"] == "data-tables@1" and t["engine"] in ("sqlite", "postgres", "shadow"), "tables: data-tables@1 with the engine (this axf-data runs on SQLite: no Postgres tables)")
e = R.engine()
check(e["$axf"] == "data-engine@1" and e["mode"] == "sqlite" and e["next"] == "done", "engine: data-engine@1, sqlite here")
try:
    R.engine_set(R.EngineBody(mode="postgres"))
    check(False, "engine move on a single-engine axf-data is refused")
except Exception as ex:  # noqa: BLE001
    check(getattr(ex, "status_code", 0) == 400 and "no second store" in str(getattr(ex, "detail", ex)), "engine move on a single-engine axf-data is refused with the reason")
try:
    R.engine_set(R.EngineBody(mode="mysql"))
    check(False, "a bad engine mode is refused")
except Exception as ex:  # noqa: BLE001
    check(getattr(ex, "status_code", 0) == 400, "a bad engine mode is refused")
check(R.voice(R.VoiceBody(phrase="what tables are there"))["say"].startswith("axf-data runs on sqlite"), "voice: tables in one sentence")
check("reads from sqlite" in R.voice(R.VoiceBody(phrase="which engine"))["say"], "voice: engine in one sentence")
print(f"data-store plugin: {'all ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
