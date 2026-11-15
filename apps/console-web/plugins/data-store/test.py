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
         "show the drift for notes": {"action": "drift", "ns": "notes"}}
for phrase, want in cases.items():
    check(R.parse_phrase(phrase) == want, f"{phrase!r} → {want}")
r = R.voice(R.VoiceBody(phrase="cut settings over"))
check(r["did"] == "ask" and "Say yes" in r["say"], "a move asks before it runs")

print("data-store plugin: routes against axf-data")
client = TestClient(axf_data.create_app(tmp / "axf-data"))
data_store.set_remote(data_store.Remote("http://axf-data:7700", "t", lambda m, u, h, b: (lambda r: (r.status_code, {k.lower(): v for k, v in r.headers.items()}, r.content))(client.request(m, u.replace("http://axf-data:7700", ""), headers=h, content=b))))
R.mode_status = lambda force=False: {"namespaces": [{"ns": "settings", "mode": "local", "since": "", "drift": 0, "lastDriftAt": "", "cursor": 0, "next": "shadow", "nextReason": ""}], "summary": []}
client.put("/v1/settings/a.json", content="{}", headers={"authorization": "Bearer t", "content-type": "application/json", "if-none-match": "*"})
s = R.state()
check(s["configured"] and s["reachable"] and s["counts"] == {"settings": 1} and s["namespaces"][0]["keys"] == 1, "state: reachable, keys per namespace, mode rows")
job = R.backup()
check(job["state"] in ("running", "done"), "Backup now starts a job on axf-data")
for _ in range(100):
    b = R.state()["backup"]
    if b["job"]["state"] != "running":
        break
    time.sleep(0.05)
check(b["job"]["state"] == "done" and b["last"]["verify"]["ok"], "…which finishes verified")
check(R.voice(R.VoiceBody(phrase="where is the data"))["say"].startswith("axf-data is up"), "voice: state in one sentence")
print(f"data-store plugin: {'all ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
