#!/usr/bin/env python3
"""Self-test for the chain control API (chain-control@1): every route over a scratch store. Run where FastAPI is installed
(the console image): python3 apps/console-web/server/test_chain_control.py
"""
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
TMP = tempfile.mkdtemp(prefix="axf-chain-api-")
os.environ.update(AXF_CHAIN_CONTROL_FILE=f"{TMP}/cc.json", AXF_RULES_BRIEFS_FILE=f"{TMP}/rb.json")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import chain_control  # noqa: E402

app = FastAPI()
app.include_router(chain_control.router, prefix="/c")
c = TestClient(app)

s = c.get("/c/state").json()
assert s["ok"] and s["rev"] == 0 and s["rows"] and s["preset"] == "lean", s
assert c.post("/c/set", json={"patch": {"budget": {"stopTokens": 99}}, "build": "x", "step": "s1"}).json()["rev"] == 1
assert c.get("/c/state?build=x&step=s1").json()["config"]["budget"]["stopTokens"] == 99
assert c.get("/c/state").json()["config"]["budget"]["stopTokens"] == 0
assert c.post("/c/file-mode", json={"path": "CLAUDE.md", "mode": "always"}).json()["rev"] == 2
assert "CLAUDE.md" in c.get("/c/state").json()["plan"]["sent"]
assert c.post("/c/file-mode", json={"path": "CLAUDE.md", "mode": "nope"}).status_code == 400
assert c.post("/c/preset", json={"action": "apply", "id": "full"}).json()["rev"] == 3
assert c.get("/c/state").json()["plan"]["native"] is True
assert c.post("/c/preset", json={"action": "apply", "id": "nope"}).status_code == 404
assert c.post("/c/preset", json={"action": "wat"}).status_code == 400
assert c.get("/c/file?path=package.json").status_code == 403
f = c.get("/c/file?path=CLAUDE.md").json()
assert f["version"]
assert c.put("/c/file", json={"path": "CLAUDE.md", "content": "x", "if_version": "stale"}).status_code == 409
assert [e["rev"] for e in c.get("/c/events?since=1").json()["events"]] == [2, 3]
assert c.post("/c/restore", json={"rev": 1}).json()["rev"] == 4
assert c.post("/c/order", json={"paths": ["CLAUDE.md"]}).json()["rev"] == 5
assert c.post("/c/clear", json={"build": "x", "step": "s1"}).json()["rev"] == 6
assert c.post("/c/reset").json()["rev"] == 7
assert len(c.get("/c/history").json()["history"]) == 7
print("✓ chain control API")
