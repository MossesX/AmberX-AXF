"""VPS Configuration REST routes (server/routes.py) against a temp data folder: every route answers, the plugin-commands body
shape ({input, by, reason}) works like a page's, two-step presses answer confirmation_required first, errors map to
status codes, and the health / alert builders (health.py) say the right thing.

  python3 apps/console-web/plugins/gate/server/test_routes.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-gate-routes-"))
LAND = TMP / "lander"
LAND.mkdir()
FAKE = TMP / "fake-land.mjs"
FAKE.write_text("console.log(JSON.stringify({ ok: true }));\n")
(LAND / "config.json").write_text(json.dumps({"mergeQueue": True, "autoLand": False, "landWaitUi": True, "queueMode": "stack"}))
(LAND / "merge-queue.json").write_text(json.dumps({"items": [{"pr": 702, "title": "Help gate", "branch": "claude/help-gate", "state": "waiting", "why": "its screenshots are waiting in UI Review."}], "waiting": [], "merged": []}))
os.environ.update(AXF_GATE_DIR=str(TMP / "gate"), AXF_GATE_LANDER_DIR=str(LAND), AXF_GATE_LANDER_CLI=str(FAKE))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("gate_routes", HERE / "routes.py")
routes = importlib.util.module_from_spec(spec)
spec.loader.exec_module(routes)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(routes.router, prefix="/api/plugins/gate")
c = TestClient(app)
B = "/api/plugins/gate"
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


try:
    r = c.get(f"{B}/rules")
    ok(r.status_code == 200 and len(r.json()["rules"]) == 9, "GET rules")
    ok(c.get(f"{B}/rules?enabled=false").json()["rules"] == [], "GET rules filters")
    ok(c.get(f"{B}/rules/clash").json()["default"]["id"] == "clash", "GET rules/<id>")
    ok(c.get(f"{B}/rules/nope").status_code == 404, "an unknown rule is 404")
    r = c.put(f"{B}/rules/theme", json={"input": {"severity": "warn"}, "by": "mcp", "reason": "parity"})
    ok(r.status_code == 200 and r.json()["rule"]["severity"] == "warn" and r.json()["rule"]["updatedBy"] == "mcp", "PUT rules/<id> with the plugin-commands body")
    ok(c.put(f"{B}/rules/theme", json={"severity": "loud"}).status_code == 400, "a bad value is 400")
    r = c.post(f"{B}/rules/ui-review/toggle", json={"enabled": False})
    ok(r.json()["rule"]["enabled"] is False and r.json()["rule"]["updatedBy"] == "console", "POST toggle; by defaults to the caller")
    ok(json.loads((LAND / "config.json").read_text())["landWaitUi"] is False, "the lander config follows the UI Review rule")
    r = c.post(f"{B}/rules/reset", json={})
    ok(r.status_code == 200 and r.json()["code"] == "confirmation_required" and r.json()["confirm"], "reset asks first")
    r2 = c.post(f"{B}/rules/reset", json={"confirm": r.json()["confirm"]})
    ok(r2.status_code == 200 and r2.json()["ok"], "reset with the token")
    ok(c.post(f"{B}/rules/reset", json={"confirm": "wrong"}).status_code == 400, "a wrong token is 400")
    ok(c.get(f"{B}/check?pr=702").json()["held"] is True, "GET check")
    ok(c.get(f"{B}/check").status_code == 400, "GET check without a PR is 400")
    s = c.get(f"{B}/lander").json()
    ok(s["mergeQueue"] is True and s["counts"]["waiting"] == 1, "GET lander")
    ok(c.get(f"{B}/lander/waiting?rule=ui-review").json()["items"][0]["pr"] == 702, "GET lander/waiting")
    ok(c.get(f"{B}/lander/runs?limit=5").json()["items"] == [], "GET lander/runs")
    ok(c.get(f"{B}/lander/mode").json()["mergeQueue"] is True, "GET lander/mode")
    ok(c.post(f"{B}/lander/mode", json={"mergeQueue": False}).json()["mode"] == "serial", "POST lander/mode")
    ok(c.post(f"{B}/lander/mode", json={"mergeQueue": True}).json()["mergeQueue"] is True, "and back")
    first = c.post(f"{B}/lander/land-now", json={"pr": 702}).json()
    ok(first["code"] == "confirmation_required", "land-now asks first")
    ok(c.post(f"{B}/lander/land-now", json={"pr": 702, "confirm": first["confirm"]}).json()["via"] == "merge-queue", "land-now with the token")
    ok(c.post(f"{B}/lander/pause", json={"why": "test"}).json()["status"] == "paused", "POST lander/pause")
    ok(c.post(f"{B}/lander/resume").json()["paused"] is False, "POST lander/resume")
    h = c.get(f"{B}/history?kind=lander").json()["items"]
    ok([e["action"] for e in h][:2] == ["resume", "pause"], "GET history, newest first")
    ok(c.get(f"{B}/settings").json()["settings"]["refreshSec"] == 30, "GET settings")
    ok(c.put(f"{B}/settings", json={"refreshSec": 3}).status_code == 400, "PUT settings validates")
    ok(c.put(f"{B}/settings", json={"defaultTab": "history"}).json()["settings"]["defaultTab"] == "history", "PUT settings")

    hl = routes.health
    now = time.time() * 1000
    ok(hl.lander_check({"ok": True, "status": "running", "landing": {"pr": 5, "since": "2020-01-01T00:00:00Z"}}, now)["status"] == "error", "a PR landing for hours is stuck")
    ok(hl.lander_check({"ok": True, "status": "idle", "lastRun": {"result": "error", "error": "boom"}}, now)["status"] == "error", "a failed run is red")
    ok(hl.lander_check({"ok": True, "status": "paused", "paused": True, "pause": {"at": "2020-01-01T00:00:00Z"}}, now)["status"] == "warn", "a long pause is amber")
    ok(hl.lander_check({"ok": True, "status": "idle", "counts": {"waiting": 2}}, now)["status"] == "ok", "idle is fine")
    ok(hl.lander_check({"ok": False, "message": "x"}, now)["status"] == "error", "no answer is red")
    held = hl.held_alerts([{"pr": 1, "rule": "clash", "reason": "code clash", "gate": {"pass": False, "held": False}}, {"pr": 2, "rule": "ci-green", "gate": {"pass": False, "held": True}}])
    ok([a["key"] for a in held] == ["gate:pr-held:1:clash"], "an alert only for a PR that needs a fix")
    ok(hl.paused_alert({"paused": True, "pause": {"by": "b", "why": "w"}})["key"] == "gate:lander-paused" and hl.paused_alert({"paused": False}) is None, "the paused alert")
finally:
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
print(f"✓ gate routes — {n} checks")
