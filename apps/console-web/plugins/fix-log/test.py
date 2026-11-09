"""Fix log: entry rules, threading into fixes, the routes, alerts (bell + phone, FYI only) and the flood limit.

    python apps/console-web/plugins/fix-log/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
os.environ["AXF_FIX_LOG_DATA_DIR"] = tempfile.mkdtemp()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    checks += 1
    if not v:
        raise SystemExit(f"FAILED: {what}")


spec = importlib.util.spec_from_file_location("fixlog_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["fixlog_server"] = mod
spec.loader.exec_module(mod)  # type: ignore[union-attr]
C = sys.modules["fixlog_server.core"]

raised: list[dict] = []
resolved: list[list[str]] = []
cx.set_context(raise_alert=lambda a: raised.append(a) or {}, resolve_alerts=lambda keys: resolved.append(keys))

# ---- core
ok(C.validate({"text": "", "outcome": "found"}), "empty text refused")
ok(C.validate({"text": "x", "outcome": "maybe"}), "unknown outcome refused")
ok(C.validate({"text": "x", "outcome": "found", "issue": "bad id!"}), "bad issue id refused")
ok(C.validate({"text": "x", "outcome": "trying"}) is None, "a plain line passes")
a = C.alert_for({"id": "e1", "outcome": "failed", "text": "restart", "detail": "", "session": "s1", "agent": "", "build": "b1", "issue": "e1"})
ok(a["source"] == "fix-log" and a["severity"] == "warning" and a["title"] == "Failed: restart", "failed → warning alert")
ok("nothing to approve" in a["body"].lower() and a["link"] == "view:fix-log", "alert says FYI and deep-links the page")
s = C.norm_settings({"notify": {"trying": False}, "keep": 3, "perSessionPer10Min": "x"})
ok(s["notify"]["trying"] is False and s["notify"]["found"] is True and s["keep"] == 100 and s["perSessionPer10Min"] == 20, "settings normalised")

# ---- routes
app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/fix-log")
t = TestClient(app)
r = t.post("/api/plugins/fix-log/log", json={"text": "console 502 on /api/alerts", "outcome": "found", "session": "s1", "build": "b1"})
ok(r.status_code == 200 and r.json()["notified"], "found logged and notified")
issue = r.json()["issue"]
ok(raised[-1]["severity"] == "info" and raised[-1]["title"].startswith("Needs fixing:"), "found raises an info alert")
r = t.post("/api/plugins/fix-log/log", json={"text": "restart the console container", "outcome": "trying", "session": "s1"})
ok(r.json()["issue"] == issue, "trying without an issue joins the session's open fix")
ok(resolved and resolved[-1] == [f"fix-log:{issue}"], "the earlier line of the fix leaves the bell")
t.post("/api/plugins/fix-log/log", json={"text": "still 502", "outcome": "failed", "session": "s1"})
r = t.post("/api/plugins/fix-log/log", json={"text": "cleared the stuck worker", "outcome": "fixed", "session": "s1", "issue": issue})
ok(r.json()["issue"] == issue and raised[-1]["severity"] == "success", "fixed closes the fix with a success alert")
r = t.post("/api/plugins/fix-log/log", json={"text": "another thing", "outcome": "trying", "session": "s1"})
ok(r.json()["issue"] != issue, "after fixed, a new line starts a new fix")
r = t.post("/api/plugins/fix-log/log", json={"text": "header session", "outcome": "found"}, headers={"x-axhub-session": "hub-7"})
ok(r.json()["entry"]["session"] == "hub-7", "the axHub session header names the session")
ok(t.post("/api/plugins/fix-log/log", json={"text": "x", "outcome": "nope"}).status_code == 422, "bad outcome is a 422")

e = t.get("/api/plugins/fix-log/entries?session=s1").json()
ok(e["total"] == 5 and e["entries"][0]["text"] == "another thing", "entries filtered by session, newest first")
ok(t.get("/api/plugins/fix-log/entries?outcome=failed").json()["total"] == 1, "filter by outcome")
ok(t.get("/api/plugins/fix-log/entries?outcome=found,trying,failed&build=b1").json()["total"] == 1, "multi-outcome + build filter")
ok(t.get("/api/plugins/fix-log/entries?q=STUCK").json()["total"] == 1, "text search is case-blind")
one = t.get(f"/api/plugins/fix-log/entries/{issue}").json()
ok(len(one["thread"]) == 4, "one entry returns its whole fix")
ok(t.get("/api/plugins/fix-log/entries/nope").status_code == 404, "unknown entry is a 404")
iss = t.get("/api/plugins/fix-log/issues").json()["issues"]
first = next(i for i in iss if i["issue"] == issue)
ok(first["state"] == "fixed" and first["tries"] == 1 and first["failures"] == 1, "issue row: state, tries, failures")
ok(all(i["state"] != "fixed" for i in t.get("/api/plugins/fix-log/issues?state=open").json()["issues"]), "open issues only")
sm = t.get("/api/plugins/fix-log/summary").json()
ok(sm["entries"] == 6 and sm["fixedIssues"] == 1 and "s1" in sm["sessions"] and sm["builds"] == ["b1"], "summary")

# ---- settings: an outcome switched off is still logged, not sent
st = t.put("/api/plugins/fix-log/settings", json={"notify": {"trying": False}}).json()
ok(st["notify"]["trying"] is False and st["notify"]["fixed"] is True, "settings saved per outcome")
ok(t.put("/api/plugins/fix-log/settings", json={"notify": {"bogus": True}}).status_code == 400, "unknown notify key refused")
n = len(raised)
r = t.post("/api/plugins/fix-log/log", json={"text": "quiet try", "outcome": "trying", "session": "s2"}).json()
ok(len(raised) == n and r["notified"] is False, "a switched-off outcome is logged, not sent")
t.put("/api/plugins/fix-log/settings", json={"notify": {"trying": True}, "perSessionPer10Min": 1})
t.post("/api/plugins/fix-log/log", json={"text": "one", "outcome": "found", "session": "s3"})
r = t.post("/api/plugins/fix-log/log", json={"text": "two", "outcome": "trying", "session": "s3"}).json()
ok(r["notified"] is False and r["entry"]["muted"] is True, "the flood limit mutes, never drops")
ok(t.get("/api/plugins/fix-log/settings").json()["perSessionPer10Min"] == 1, "settings readable")

# ---- an alert hub failure keeps the line
cx.set_context(raise_alert=lambda a: (_ for _ in ()).throw(RuntimeError("hub down")))
t.put("/api/plugins/fix-log/settings", json={"perSessionPer10Min": 50})
r = t.post("/api/plugins/fix-log/log", json={"text": "hub down", "outcome": "found", "session": "s4"})
ok(r.status_code == 200 and r.json()["notified"] is False, "line kept when the alert hub fails")

# ---- the plugin's files agree
pj = json.loads((HERE / "plugin.json").read_text())
routes = {f"{m} {r.path}" for r in mod.router.routes for m in getattr(r, "methods", [])}
declared = {i["route"] for i in pj["commands"]["items"]}
ok(declared <= routes, f"every declared command is a route: {declared - routes}")
nt = json.loads((HERE / "notify.json").read_text())
ok(nt["types"][0]["match"]["source"] == "fix-log" and nt["types"][0]["push"] is True, "notify type pushes to AmberX")

# ---- the CLI (node): parsing and the fallback when the plugin is not deployed yet
js = r"""
import { logLine, parse } from './fixlog.mjs';
const calls = [];
const fake = (status) => async (m, p, b) => { calls.push(p); return p.endsWith('/log') ? { status, json: status === 200 ? { ok: true, issue: 'fx-1', notified: true } : null } : { status: 200, json: { ok: true } }; };
const a = await logLine('trying', 'x', parse(['--issue', 'fx-1']), { AXF_SESSION: 's' }, fake(200));
const b = await logLine('failed', 'y', {}, {}, fake(404));
console.log(JSON.stringify({ a, b, calls }));
"""
out = subprocess.run(["node", "--input-type=module", "-e", js], cwd=HERE, capture_output=True, text=True, timeout=60)
ok(out.returncode == 0, f"CLI test ran: {out.stderr[:300]}")
res = json.loads(out.stdout)
ok(res["a"]["ok"] and res["a"]["via"] == "fix-log" and res["a"]["issue"] == "fx-1", "CLI logs through the plugin")
ok(res["b"]["ok"] and res["b"]["via"] == "alert" and res["calls"][-1] == "/api/alerts", "CLI falls back to a plain alert before deploy")

print(f"fix-log: {checks} checks passed")
