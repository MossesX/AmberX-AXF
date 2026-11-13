"""Decision dialog queue: a source raises, Brett answers (by id, 'latest' or queue place, pick option N), the answer
reaches the source's handler capability, Later snoozes the pop-up, settings switch pop-ups per type.

    python apps/console-web/plugins/decision-dialog/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
os.environ["AXF_DECISION_DIALOG_DIR"] = tempfile.mkdtemp()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

alerts: list[dict] = []
resolved: list[str] = []
cx.raise_alert = lambda a: alerts.append(a) or a
cx.resolve_alerts = lambda keys: resolved.extend(keys)

spec = importlib.util.spec_from_file_location("decision_dialog_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
assert spec.loader
spec.loader.exec_module(srv)

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


class Review:
    calls: list[tuple] = []

    def answer_decision(self, ref, button, option, note, by):
        self.calls.append((ref, button, option, note, by))
        return {"ok": True, "status": button}


plugin_services.provide("ui-review@1", Review(), "ui-review")
app = FastAPI()
app.include_router(srv.router)
c = TestClient(app)

ok(plugin_services.get("decisions@1") is not None, "decisions@1 is provided")
types = c.get("/types").json()["types"]
ok({"ui-review", "veto", "confirm", "model-upgrade", "merge-clash", "key-needed", "pass"} <= {t["id"] for t in types}, "every decision type is registered")

# A UI Review item with three options: notification + pop-up.
r = c.post("/raise", json={"type": "ui-review", "title": "Settings page", "build": "b1", "ref": "item-1", "handler": "ui-review@1",
                           "options": [{"label": "A", "shots": [{"src": "/x/a.png", "device": "desktop"}]}, {"label": "B"}, {"label": "C"}],
                           "shots": [{"src": "/x/p.png", "device": "phone"}]})
ok(r.status_code == 200, r.text)
d1 = r.json()
ok(d1["$axf"] == "decision@1" and d1["status"] == "waiting", "stored as decision@1")
ok([b["id"] for b in d1["buttons"]] == ["approve", "changes", "reject"], "UI Review gets its registered buttons")
ok(len(alerts) == 1 and alerts[0]["meta"]["decision"] == d1["id"], "a notification was raised")
# The same source + ref refreshes, never stacks twice.
d1b = c.post("/raise", json={"type": "ui-review", "title": "Settings page v2", "ref": "item-1", "handler": "ui-review@1", "options": [{"label": "A"}, {"label": "B"}, {"label": "C"}]}).json()
ok(d1b["id"] == d1["id"] and len(alerts) == 1, "same ref refreshes in place")
# A second, different source: the queue stacks.
d2 = c.post("/raise", json={"type": "model-upgrade", "title": "Step s3 wants Fable", "ref": "b2:s3"}).json()
lst = c.get("/list").json()
ok(lst["waiting"] == 2 and lst["items"][0]["popup"], "two waiting, they pop up")
ok(c.post("/raise", json={"type": "nope", "title": "x"}).status_code == 400, "unknown type refused")
ok(c.post("/raise", json={"type": "other"}).status_code == 400, "title required")

# Answers: a note is required for Request changes; pick by number; the handler hears it.
ok(c.post("/answer", json={"id": d1["id"], "button": "changes"}).status_code == 400, "Request changes needs a note")
ok(c.post("/answer", json={"id": d1["id"], "button": "pick", "option": "7"}).status_code == 400, "no option 7")
ok(c.post("/answer", json={"id": d1["id"], "button": "launch"}).status_code == 400, "unknown button refused")
a = c.post("/answer", json={"id": d1["id"], "button": "pick", "option": "2"}).json()
ok(a["option"] == "2" and Review.calls[-1][:3] == ("item-1", "pick", "2"), "pick option 2 reaches UI Review")
ok(srv.ALERT_KEY + d1["id"] in resolved, "the notification goes once answered")
ok(c.post("/answer", json={"id": d1["id"], "button": "approve"}).status_code == 400, "can't answer twice")

# 'latest' / queue place (voice: 'approve it'); no handler = answered here only.
a2 = c.post("/answer", json={"id": "latest", "button": "approve"}).json()
ok(a2["id"] == d2["id"], "'latest' answers the newest waiting one")
ok(c.get("/list").json()["waiting"] == 0, "queue empty")
ok(c.get("/list?status=answered").json()["items"][0]["answer"]["button"] == "approve", "answer kept")

# Later snoozes the pop-up only; withdraw takes it out.
d3 = c.post("/raise", json={"type": "confirm", "title": "Delete the old shots?", "source": "test", "ref": "r3"}).json()
ok(c.post("/later", json={"id": d3["id"], "minutes": 5}).status_code == 200, "later ok")
v = c.get("/item", params={"id": d3["id"]}).json()
ok(v["status"] == "waiting" and v["popup"] is False, "Later: still waiting, no pop-up")
ok(c.post("/withdraw", json={"source": "test", "ref": "r3"}).json()["withdrawn"] == [d3["id"]], "withdrawn by source + ref")

# Settings: a type switched off doesn't pop up; bad values refused.
s = c.put("/settings", json={"popup": {"confirm": False}, "laterMinutes": 30}).json()
ok(s["popup"]["confirm"] is False and s["popup"]["ui-review"] is True and s["laterMinutes"] == 30, "settings saved")
d4 = c.post("/raise", json={"type": "confirm", "title": "Again?"}).json()
ok(c.get("/item", params={"id": d4["id"]}).json()["popup"] is False, "switched-off type stays in the queue without popping up")
ok(c.put("/settings", json={"popup": {"zzz": True}}).status_code == 400, "unknown type in settings refused")
ok(c.put("/settings", json={"popup": {"confirm": "yes"}}).status_code == 400, "non-boolean refused")

# A handler that is gone: nothing is decided.
d5 = c.post("/raise", json={"type": "other", "title": "x", "handler": "gone@1", "ref": "g"}).json()
ok(c.post("/answer", json={"id": d5["id"], "button": "approve"}).status_code == 409, "missing handler = 409, nothing decided")
ok(c.get("/item", params={"id": d5["id"]}).json()["status"] == "waiting", "still waiting")

# A held call (browser source): its buttons are console actions, a person's tap only.
v = c.post("/raise", json={"type": "veto", "title": "Deploy", "source": "approvals-banner", "ref": "h1", "buttons": [
    {"id": "approve-now", "label": "Approve now", "kind": "primary", "action": "approvals.approve-now:h1"}, {"id": "deny", "label": "Deny", "kind": "danger", "action": "approvals.deny:h1"}]}).json()
ok(v["popup"] is False if "popup" in v else c.get("/item", params={"id": v["id"]}).json()["popup"] is False, "veto waits in the queue: its own screen pops up")
ok(c.post("/answer", json={"id": v["id"], "button": "deny"}).status_code == 403, "API / MCP / voice server-side can't press a tap-only button")
r = c.post("/answer", json={"id": v["id"], "button": "deny", "via": "console"}).json()
ok(r["action"] == "approvals.deny:h1", "the console tap gets the action to run")

print(f"decision-dialog: {checks} checks passed")
