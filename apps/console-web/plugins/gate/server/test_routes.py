"""Gate & rules REST routes (server/routes.py) against a temp data folder: every route answers, the plugin-commands body
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
    # parallel builds and the host cap, side by side: read live, saved through the owners' services, host cap Brett only
    import types
    r = c.get(f"{B}/build-slots").json()
    ok(r["stepsInParallel"]["available"] is False and r["hostCap"]["available"] is False and "off" in r["hostCap"]["why"], "build-slots: owners off = both unavailable, with the reason")
    ok(c.put(f"{B}/build-slots", json={"stepsInParallel": 6}).status_code == 503, "build-slots: saving with the owner off is 503")

    class _HTTP(routes.HTTPException):
        pass

    live = {"steps": 4, "cap": 4, "saves": []}

    class _Pipe:
        def get(self):
            return {"ok": True, "settings": {"stepsInParallel": live["steps"]}}

        def set(self, request, body):
            live["steps"] = body["stepsInParallel"]
            live["saves"].append(("steps", body))
            return {"ok": True}

    class _Slots:
        def hard_limit(self):
            return {"max": live["cap"], "live": 2}

        def can_edit_hard_limit(self, request):
            return bool(getattr(getattr(request.state, "axf_user", None), "admin", False))

        def set_hard_limit(self, request, patch):
            if not self.can_edit_hard_limit(request):
                raise _HTTP(403, "Only Brett sets the hard build limit, from his own signed-in console.")
            live["cap"] = patch["maxBuilds"]
            live["saves"].append(("cap", patch))
            return self.hard_limit()

    fake = types.ModuleType("plugin_services")
    fake.get = lambda name: {"axf.pipeline-settings@1": _Pipe(), "axf.agent-slots@1": _Slots()}.get(name)
    sys.modules["plugin_services"] = fake
    r = c.get(f"{B}/build-slots").json()
    ok(r["stepsInParallel"] == {"value": 4, "min": 1, "max": 12, "available": True} and r["hostCap"]["value"] == 4 and r["hostCap"]["live"] == 2, "build-slots: both live values")
    ok(r["hostCap"]["canEdit"] is False and r["over"] is False and "note" not in r, "build-slots: the console token reads the host cap, cannot edit it; no note at or under the cap")
    r = c.put(f"{B}/build-slots", json={"input": {"stepsInParallel": 6}, "by": "mcp"})
    ok(r.status_code == 200 and r.json()["stepsInParallel"]["value"] == 6 and r.json()["saved"] == {"stepsInParallel": 6}, "build-slots: steps in parallel saves (plugin-commands body)")
    ok(r.json()["over"] is True and "above the host cap (4)" in r.json()["note"], "build-slots: a note when steps in parallel is above the host cap")
    r = c.put(f"{B}/build-slots", json={"stepsInParallel": 8, "maxBuilds": 8})
    ok(r.status_code == 403 and "Only Brett" in r.json()["message"] and live["steps"] == 6 and live["cap"] == 4, "build-slots: the host cap from the console token is 403 and nothing is saved, steps included")
    for bad in ({"stepsInParallel": 13}, {"stepsInParallel": 0}, {"stepsInParallel": "6"}, {"maxBuilds": 0}, {"stepsInParallel": True}, {}):
        ok(c.put(f"{B}/build-slots", json=bad).status_code == 400, f"build-slots: {bad} is 400")
    owner_app = FastAPI()

    @owner_app.middleware("http")
    async def as_brett(request, call_next):  # what the console's auth does for Brett's own signed-in session
        request.state.axf_user = types.SimpleNamespace(admin=True, name="Brett")
        return await call_next(request)

    owner_app.include_router(routes.router, prefix="/api/plugins/gate")
    bc = TestClient(owner_app)
    ok(bc.get(f"{B}/build-slots").json()["hostCap"]["canEdit"] is True, "build-slots: Brett's session may edit the host cap")
    r = bc.put(f"{B}/build-slots", json={"maxBuilds": 6})
    ok(r.status_code == 200 and r.json()["hostCap"]["value"] == 6 and r.json()["over"] is False and live["saves"][-1] == ("cap", {"maxBuilds": 6}), "build-slots: Brett saves the host cap; the note goes")
    del sys.modules["plugin_services"]
finally:
    import shutil
    shutil.rmtree(TMP, ignore_errors=True)
print(f"✓ gate routes — {n} checks")
