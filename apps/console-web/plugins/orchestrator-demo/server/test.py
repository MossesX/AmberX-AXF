"""Orchestrator demo route tests: python apps/console-web/plugins/orchestrator-demo/server/test.py

Drives the real routes (FastAPI TestClient) over the real runner.mjs with everything pointed at a scratch folder:
plugin data (AXF_PLUGINS_DATA_DIR), a test builds store holding one real build (AXF_BUILDS_STORE), no console calls
(AXF_DEMO_CONSOLE=off), no builds-live publish, and the test-only clock (AXF_DEMO_GAP_MS_TEST, which also skips the
dependency check). Checks every route, the refusals and their codes, and that Stop cleans up and leaves the real build.
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGINS = HERE.parents[1]
TMP = Path(tempfile.mkdtemp(prefix="od-routes-"))
STORE = TMP / "builds.json"
REAL = {"id": "real-build-keep", "title": "A real build", "status": "queued", "steps": [{"id": "s1", "text": "real", "done": False}]}
STORE.write_text(json.dumps({"$axf": "builds@1", "builds": [REAL]}))
os.environ.update(AXF_PLUGINS_DATA_DIR=str(TMP / "plugins"), AXF_BUILDS_STORE=str(STORE), AXF_BUILDS_LIVE="0",
                  AXF_DEMO_CONSOLE="off", AXF_DEMO_GAP_MS_TEST="200")

sys.path.insert(0, str(PLUGINS))
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

routes = importlib.import_module("orchestrator-demo.server.routes")
app = FastAPI()
app.include_router(routes.router, prefix="/api/plugins/orchestrator-demo")
c = TestClient(app)
B = "/api/plugins/orchestrator-demo"
fails: list[str] = []


def check(cond: bool, what: str) -> None:
    print(("ok   " if cond else "FAIL ") + what)
    if not cond:
        fails.append(what)


def run() -> None:
    r = c.get(f"{B}/state")
    check(r.status_code == 200 and r.json()["state"]["run"] is None, "GET state with no run")
    check(r.json()["settings"]["minGapMs"] == 30000, "state carries the settings (30 s gap)")
    check(c.get(f"{B}/summary").status_code == 404, "GET summary with no run is 404 no-run")
    check(c.post(f"{B}/next").status_code == 404, "POST next with no run is 404")
    d = c.get(f"{B}/deps").json()["deps"]
    check(d["ok"] and "test clock" in d["skipped"], "GET deps: skipped under the test clock, and says so")

    r = c.put(f"{B}/pause-between-steps", json={"pause": False})
    check(r.status_code == 200 and r.json()["settings"]["pauseBetweenSteps"] is False, "PUT pause-between-steps off (default)")
    check(c.put(f"{B}/pause-between-steps", json={}).status_code == 400, "PUT pause-between-steps without pause is 400")
    check(c.get(f"{B}/settings").json()["settings"]["pauseBetweenSteps"] is False, "GET settings reads it back")

    r = c.post(f"{B}/open", json={})
    s = r.json()["state"]
    check(r.status_code == 200 and s["run"]["state"] == "overlay", "POST open: a run in its overlay")
    check(s["run"]["pause"] is False, "the new run takes the default pause setting")
    check(len(s["checklist"]) == len(s["run"]["acts"]) and len(s["outline"]) == 4, "state has the check-list and the 4-part outline")
    r = c.post(f"{B}/open", json={})
    check(r.status_code == 409 and r.headers.get("x-axf-code") == "busy", "a second open is 409 busy with a plain reason")
    check(c.post(f"{B}/next").status_code == 409, "Next in the overlay is 409 invalid-transition")

    check(c.post(f"{B}/pause").json()["state"]["held"] is True, "POST pause holds")
    check(c.post(f"{B}/resume").json()["state"]["held"] is False, "POST resume")
    r = c.put(f"{B}/pause-between-steps", json={"pause": True})
    check(r.json()["state"]["run"]["pause"] is True, "pause-between-steps changes the open run too")

    r = c.post(f"{B}/stop", json={"why": "route test"})
    check(r.status_code == 200 and r.json()["state"]["run"]["state"] == "stopped", "POST stop stops at once")
    for _ in range(60):
        cleanup = c.get(f"{B}/summary").json().get("cleanup")
        if cleanup:
            break
        time.sleep(0.5)
    check(bool(cleanup) and cleanup.get("errors") == [], "the driver cleaned up after stop")
    sm = c.get(f"{B}/summary").json()["summary"]
    check(sm["state"] == "stopped" and len(sm["acts"]) > 0, "GET summary: stopped, one line per act")
    builds = json.loads(STORE.read_text())["builds"]
    check(not any(b["id"].startswith("demo-") for b in builds), "no demo build left in the store")
    check(any(b["id"] == REAL["id"] and b["status"] == "queued" for b in builds), "the real build is untouched")
    check(c.post(f"{B}/next").status_code == 409, "Next after stop is refused")


if __name__ == "__main__":
    try:
        run()
    finally:
        import shutil
        shutil.rmtree(TMP, ignore_errors=True)
    print(f"\n{'FAILED: ' + str(len(fails)) if fails else 'all passed'}")
    sys.exit(1 if fails else 0)
