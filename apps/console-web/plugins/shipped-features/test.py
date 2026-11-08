#!/usr/bin/env python3
"""Self-test for the Shipped features server part: reads the SQLite ledger the Node side writes (feature-ledger@1).

    python3 apps/console-web/plugins/shipped-features/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
DATA = Path(tempfile.mkdtemp(prefix="axf-shipped-test-"))
os.environ["AXF_SHIPPED_FEATURES_DIR"] = str(DATA)
SEED = r"""
const D = await import(process.argv[1]);
const db = D.openDb();
const f = D.putFeature(db, { name: 'Status chips', plugin: 'shipped-features', status: 'planned', plannedAt: '2026-11-04T21:35:00Z', prompts: [{ id: 'p-sf-0' }] });
D.putPrompt(db, { build: 'sf', said: 'Put every feature in the list the moment it is planned.', verbatim: true });
D.putEdit(db, { feature: f.id, summary: 'Stalled tone', build: 'sf-fix', status: 'building', at: '2026-11-05T00:00:00Z' });
"""
subprocess.run(["node", "--input-type=module", "-e", SEED, str(HERE / "ledger" / "db.mjs")], check=True, env=os.environ)

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.shipped_features_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
mod._state["syncAt"] = 1e18  # no background sync in the test

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/shipped-features")
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


r = c.get("/api/plugins/shipped-features/ledger").json()
ok(r["$axf"] == "feature-ledger@1" and len(r["features"]) == 1 and len(r["edits"]) == 1, "ledger: every table, as the contract's records")
ok(r["meta"]["schema"] >= 2 and r["meta"]["counts"]["prompts"] == 1, "ledger meta: schema version and counts")
f = r["features"][0]
ok(f["beingEdited"] is True and f["editCount"] == 1, "feature carries its edit fields")
d = c.get(f"/api/plugins/shipped-features/feature/{f['id']}").json()
ok(d["edits"][0]["summary"] == "Stalled tone" and d["prompts"][0]["said"].startswith("Put every feature"), "feature detail: edits + his words")
ok(len(d["history"]) >= 1 and d["history"][0]["doc"]["editCount"] == 0, "feature detail: the original version is kept")
ok(c.get("/api/plugins/shipped-features/feature/BAD!").status_code == 400, "bad id refused")
ok(c.get("/api/plugins/shipped-features/feature/f-nope").status_code == 404, "unknown id is 404")
csv = c.get("/api/plugins/shipped-features/export", params={"kind": "csv", "view": json.dumps({"hideCancelled": True})})
ok(csv.status_code == 200 and "Status chips" in csv.text, "export csv")
ok(c.get("/api/plugins/shipped-features/export", params={"kind": "pdf"}).status_code == 400, "export kind checked")
sm = c.get("/api/plugins/shipped-features/summary").json()
ok(sm["ready"] and sm["beingEdited"] == 1 and sm["statuses"].get("planned") == 1 and sm["active"] == 1, "summary: counts for the menu badge")
print(f"shipped-features server: {n} checks passed")
