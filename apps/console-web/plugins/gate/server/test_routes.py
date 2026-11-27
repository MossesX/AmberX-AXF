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
os.environ.update(AXHUB_URL="http://127.0.0.1:9", AXHUB_TOKEN="test-token")  # approval rules: no hub answers here
os.environ.update(AXF_MODEL_TRIAGE_DIR=str(TMP / "model-triage"), AXF_CLAUDE_SETTINGS_FILE=str(TMP / "no-claude-settings.json"))  # model triage: a scratch rule store
os.environ.pop("AXF_FABLE_UPGRADE_APPROVAL", None)

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

    # the build cap: every value is checked and the owner-only keys refused before anything runs or is saved
    ok(c.post(f"{B}/build-cap", json={"nope": 1}).status_code == 400, "POST build-cap needs a known key")
    ok(c.post(f"{B}/build-cap", json={"stepsInParallel": 99}).status_code == 400, "POST build-cap checks the range")
    ok(c.post(f"{B}/build-cap", json={"key": "stepsInParallel", "value": "x"}).status_code == 400, "POST build-cap wants a whole number")
    r = c.post(f"{B}/build-cap", json={"maxBuilds": 9})
    ok(r.status_code == 403 and "Only Brett" in r.json()["message"], "POST build-cap: the hard cap is the owner's own session only")
    ok(c.post(f"{B}/build-cap", json={"emergencySlots": 1, "stepsInParallel": 3}).status_code == 403, "an owner-only key refuses the whole call")

    # model triage: the routes pass every call to the VPS gate (framework/cli/model-triage.mjs), which checks every edit
    t0 = c.get(f"{B}/model-triage").json()
    ok(t0["ok"] and t0["$axf"] == "model-triage@1" and t0["config"]["enabled"] is True and t0["stored"] is False, "GET model-triage: the starting rules until the first edit")
    ok([r["id"] for r in t0["config"]["rules"]][:3] == ["ci-fix", "merge-clash", "second-try"] and t0["registry"]["fields"]["size"][1]["key"] == "files", "the rules in order, with the fields the tab draws")
    ok(t0["approvalRequired"] is False and t0["buildPin"] is None, "it says whether Fable upgrades wait for Brett and whether a build-wide model is set")
    r = c.post(f"{B}/model-triage", json={"op": "rule", "id": "size", "settings": {"files": 3}, "reason": {"title": "Smaller steps", "description": ""}})
    ok(r.status_code == 200 and next(x for x in r.json()["config"]["rules"] if x["id"] == "size")["settings"]["files"] == 3, "POST model-triage edits one rule")
    ok(c.post(f"{B}/model-triage", json={"op": "rule", "id": "size", "settings": {"files": "lots"}}).status_code == 400, "a bad value is the VPS's refusal (400)")
    ok(c.post(f"{B}/model-triage", json={"op": "rule", "id": "nope", "enabled": False}).status_code == 400, "an unknown rule is 400")
    ok(c.post(f"{B}/model-triage", json={"op": "delete-everything"}).status_code == 400, "an unknown op is 400")
    ok(c.post(f"{B}/model-triage", json={"input": {"op": "defaults", "model": "opus"}, "by": "mcp:test"}).json()["config"]["defaults"]["model"] == "opus", "the plugin-commands body shape works (MCP vps_model_triage_set)")
    hist = c.get(f"{B}/model-triage/history").json()["entries"]
    ok([h["what"] for h in hist] == ["defaults", "rule size"] and hist[0]["by"] == "mcp:test" and hist[1]["reason"]["title"] == "Smaller steps", "GET model-triage/history: who, what, why, newest first")
    d = c.post(f"{B}/model-triage/decide", json={"text": "Add two buttons", "files": ["a/x.tsx", "a/y.tsx", "a/z.tsx"]}).json()
    ok(d["ok"] and d["decision"]["model"] == "Fable" and d["decision"]["rule"] == "size", "POST model-triage/decide: the gate's answer with the rule that fires")
    ok(c.post(f"{B}/model-triage/decide", json={"text": "Add a button"}).json()["decision"]["rule"] == "default", "… and the default (Opus now) when none does")
    ok(c.get(f"{B}/model-triage/decisions").json()["decisions"] == [], "GET model-triage/decisions: a dry run logs nothing")
    ok(c.post(f"{B}/model-triage", json={"op": "reset"}).json()["config"]["defaults"]["model"] == "fable", "reset puts the starting rules back")

    # approval rules: reading never fails the page, a write here only ever stages, and there is no route that saves
    r = c.get(f"{B}/approval-rules")
    ok(r.status_code == 200 and r.json()["$axf"] == "approval-rules@1" and r.json()["available"] is False, "GET approval-rules says plainly when axHub can't be read")
    ok(r.json()["canSave"] is False, "a token caller cannot save")
    ok(c.post(f"{B}/approval-rules/draft", json={"op": "save"}).status_code == 400, "POST approval-rules/draft knows only staging ops")
    ok(c.post(f"{B}/approval-rules/draft", json={}).status_code == 400, "POST approval-rules/draft needs an op")
    r = c.post(f"{B}/approval-rules/draft", json={"op": "add", "service": "vps", "rule": {"match": "run", "policy": "veto"}})
    ok(r.status_code == 503 and "nothing was staged" in r.json()["message"], "nothing is staged while axHub can't be read")
    ok(c.put(f"{B}/approval-rules", json={}).status_code in (404, 405) and c.post(f"{B}/approval-rules", json={}).status_code in (404, 405), "no route writes the policy")

    ad = routes.ad_health
    svc = lambda veto: [{"service": "axf-console", "counts": {"veto": veto}}, {"service": "github", "counts": {"veto": 9}}]  # noqa: E731
    r = ad.check({"ok": True, "available": True, "default": {"applied": False}, "pending": 0, "services": svc(212)})
    ok(r["status"] == "warn" and "212 console and VPS tools" in r["summary"] and "Apply the default" in " ".join(r["details"]), "the default not applied is a banner item with the steps")
    ok(ad.check({"ok": True, "available": True, "default": {"applied": True}, "pending": 0, "services": svc(2)})["status"] == "ok", "applied and nothing staged is green")
    r = ad.check({"ok": True, "available": True, "default": {"applied": True}, "pending": 1, "draft": {"by": "paulie"}, "services": svc(2)})
    ok(r["status"] == "warn" and "staged by paulie" in r["summary"] and "Brett's Save" in r["summary"], "staged edits wait for Brett, and the item says so")
    ok(ad.check({"ok": True, "available": False, "message": "axHub answered 404."})["status"] == "warn", "a hub without the policy API is said plainly")
    ok(ad.check({"ok": False, "message": "boom"})["status"] == "unknown", "an unreadable answer is unknown, never green")
    got = {}
    ok(ad.ensure(type("S", (), {"get": staticmethod(lambda cap: type("R", (), {"register": staticmethod(lambda item, owner: got.update(item=item, owner=owner))})())})(), lambda: {"ok": False}) is True, "the check registers with axf.health@1")
    ok(got["item"]["id"] == "vps-approval-default" and got["owner"] == "gate" and "fix" not in got["item"] and "autofix" not in got["item"], "it has no Fix: only Brett's click applies it")
    ok(ad.ensure(None, lambda: {}) is False, "no systems check yet: try again later")

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
