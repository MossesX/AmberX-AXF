"""Self-test of the Activity Monitor server part: python3 apps/console-web/plugins/activity-monitor/test.py

Runs the real routes (FastAPI TestClient) against a scratch data folder and a scratch builds store, with fake axHub runs,
activity feed and fix-note services registered as capabilities: sentences, chains, tabs, filters, collectors, error →
fix linking, rules (notify / route / action) with their cooldown, retry, export, settings, clear.
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
tmp = Path(tempfile.mkdtemp(prefix="activity-monitor-"))
os.environ["AXF_ACTIVITY_MONITOR_DIR"] = str(tmp / "data")
os.environ["AXF_BUILDS_STORE"] = str(tmp / "store.json")
now = int(time.time() * 1000)
iso = lambda ms: time.strftime("%Y-%m-%dT%H:%M:%S", time.gmtime(ms / 1000)) + ".000Z"  # noqa: E731
(tmp / "store.json").write_text(json.dumps({"builds": [{"id": "login-fix", "title": "Login fix", "status": "queued", "notes": [
    {"text": "Queued by Joey.", "at": iso(now - 60_000)},
    {"text": "Rejected: no tests.", "at": iso(now - 50_000)},
    {"text": "Handed off to Patches.", "at": iso(now - 40_000)}]}]}))

sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402
import console_context as cx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

alerts: list[dict] = []
cx.raise_alert = lambda a: alerts.append(a) or a  # type: ignore[assignment]
cx.terminal_lines = lambda: [{"at": now - 1000, "channel": "mcp", "level": "error", "text": "console_open failed: no such view"}]  # type: ignore[attr-defined]


class HubRuns:
    def runs(self, since=0):
        return [{"id": "r1", "at": now - 30_000, "tool": "vps.run", "command": "curl -O https://example.com/a.zip", "exit": 0,
                 "agent": "Molly", "reason": "download a file", "confirmationId": "c1", "output": "ok"}]


class Feed:
    items_ = [{"id": "session:abc", "kind": "session", "title": "Headless session for login-fix", "state": "running", "updatedAt": now - 20_000}]

    def items(self):
        return self.items_


class Dispatch:
    asked: list = []

    def request(self, title, detail="", **kw):
        self.asked.append((title, detail, kw))
        return {"ok": True, "id": "b-new", "status": "pending"}

    def queue(self, bid, by="console"):
        return {"ok": True}


DISPATCH = Dispatch()
FEED = Feed()
plugin_services.provide("axf.hub-runs@1", HubRuns(), "fake")
plugin_services.provide("axf.activity@1", FEED, "fake")
plugin_services.provide("axf.build-dispatch@1", DISPATCH, "fake")

spec = importlib.util.spec_from_file_location("activity_monitor_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["activity_monitor_server"] = mod
spec.loader.exec_module(mod)
E = mod.engine
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
n = 0


def check(ok: bool, what: str) -> None:
    global n
    n += 1
    if not ok:
        print(f"✗ {what}")
        sys.exit(1)
    print(f"✓ {what}")


# sentences
s = lambda **e: E.normalize(e)["sentence"]  # noqa: E731
check(s(actor="Joey", verb="sent", object="the login fix", target="the orchestrator", result="rejected", reason="no tests") == "Joey sent the login fix to the orchestrator, which rejected it: no tests.", "rejection sentence")
check(s(actor="Molly", verb="asked", target="Patches", via="axHub", object="download a file", result="done") == "Molly asked Patches through axHub to download a file. Done.", "request through axHub")
check(s(actor="Patches", verb="fixed", object="it", result="sent back") == "Patches fixed it (sent back).", "a result of its own words is kept")
check(E.normalize({"sentence": "x", "kind": "error"})["severity"] == "error", "errors are errors")
try:
    E.normalize({})
    check(False, "an empty event is refused")
except ValueError:
    check(True, "an empty event is refused")

# collectors
r = c.post("/p/collect").json()
check(r["added"] >= 6, f"collectors read the builds store, axHub runs, the feed and the terminal ({r['added']})")
evs = c.get("/p/events?hide=").json()["events"]
sent = [e["sentence"] for e in evs]
check(any("Joey sent build “Login fix” to the orchestrator" in x for x in sent), "orchestrator note: queued by Joey")
check(any("rejected" in x.lower() for x in sent), "orchestrator note: rejected")
check(any(e["kind"] == "approval" and e["actor"] == "Brett" for e in evs), "axHub run brings its approval")
check(any(e["kind"] == "axhub" and e["actor"] == "Molly" and e.get("via") == "axHub" for e in evs), "axHub run by Molly")
check(any(e["source"] == "terminal" and e["severity"] == "error" for e in evs), "console terminal error")
again = c.post("/p/collect").json()["added"]
check(again == 0, "a second read adds nothing")
FEED.items_ = [{**FEED.items_[0], "state": "failed", "detail": "tests failed", "finishedAt": now - 5000}]
check(c.post("/p/collect").json()["added"] == 1, "a feed item that changes state is one more event")

# tabs, filters, chains
tabs = {t["id"]: t["count"] for t in c.get("/p/events").json()["tabs"]}
check(tabs.get("builds", 0) >= 3 and tabs.get("axhub", 0) >= 2 and tabs.get("approvals", 0) >= 1 and tabs.get("errors", 0) >= 2, f"tab counts {tabs}")
check("app:axhub" in tabs, "a tab per app")
q = c.get("/p/events?q=molly%20curl").json()["events"]
check(len(q) == 1 and q[0]["actor"] == "Molly", "search: all words")
tree = c.get("/p/events?view=tree&tab=builds").json()["chains"]
lf = next(x for x in tree if x["chain"] == "build:login-fix")
check(lf["count"] == 3 and [e["depth"] for e in lf["events"]] == [0, 1, 2], "a build's notes are one chain, each after the last")
check(c.get("/p/events?range=1w&hide=").json()["total"] == len(c.get("/p/events?hide=").json()["events"]) and c.get("/p/events?until=1").json()["total"] == 0, "time range and until")
check(c.get("/p/events?since=abc").status_code == 400, "a bad since is refused")

# emit + error → fix linking
r = c.post("/p/emit", json={"events": [
    {"id": "err-1", "kind": "error", "app": "walkthrough-studio", "actor": "Patches", "verb": "could not download", "object": "a.zip", "reason": "403", "ref": {"type": "file", "id": "a.zip"}},
    {"id": "fix-1", "kind": "fix", "app": "walkthrough-studio", "actor": "Patches", "verb": "fixed", "object": "the download", "result": "fixed", "ref": {"type": "file", "id": "a.zip"}}]}).json()
check(r["added"] == 2, "emit writes events")
fix = c.get("/p/event/fix-1").json()
check(fix["event"]["chain"] == "err-1" and fix["event"]["parent"] == "err-1" and fix["chain"]["count"] == 2, "a fix joins the error it fixed")
check(c.get("/p/event/nope").status_code == 404, "unknown event → 404")

# rules
bad = c.post("/p/rules", json={"on": {}, "do": {"type": "notify"}})
check(bad.status_code == 400, "a rule needs a condition")
r1 = c.post("/p/rules", json={"on": {"kind": "error", "app": "walkthrough-studio"}, "do": {"type": "notify", "message": "Studio error"}, "cooldownS": 0}).json()["rule"]
r2 = c.post("/p/rules/from-event/err-1", json={"do": {"type": "route", "agent": "Patches"}}).json()["rule"]
r3 = c.post("/p/rules", json={"name": "Open builds", "on": {"text": "download"}, "do": {"type": "action", "action": "nav:builds"}}).json()["rule"]
check(r2["on"]["kind"] == "error" and r2["do"]["agent"] == "Patches" and r2["from"] == "err-1", "make a rule from an event")
check(c.post("/p/rules/test", json={"on": {"kind": "error"}, "do": {"type": "note"}}).json()["matches"] >= 2, "test a rule on recent events")
c.post("/p/emit", json={"event": {"id": "err-2", "kind": "error", "app": "walkthrough-studio", "sentence": "Studio could not download a.zip", "reason": "403"}})
check(any(a["title"] == "Studio error" for a in alerts), "notify rule raised an alert")
check(any("Patches" in d[1] for d in DISPATCH.asked), "route rule filed a build for the agent")
rule_evs = c.get("/p/events?kind=rule&hide=").json()["events"]
check(any(e.get("ref", {}).get("action") == "nav:builds" and e["result"] == "waiting" for e in rule_evs), "action rule waits for the open console")
check(all(e["chain"] == "err-2" for e in rule_evs if e["id"].endswith(":err-2")), "rule events join the chain they answered")
before = len(DISPATCH.asked)
c.post("/p/emit", json={"event": {"id": "err-3", "kind": "error", "app": "walkthrough-studio", "sentence": "again", "reason": "403"}})
check(len(DISPATCH.asked) == before, "cooldown: a route rule doesn't fire twice in ten minutes")
rules = c.get("/p/rules").json()["rules"]
check(next(x for x in rules if x["id"] == r1["id"])["hits"] == 2, "hits counted")
check(c.post("/p/rules", json={**r3, "enabled": False}).json()["rule"]["enabled"] is False, "turn a rule off")
check(c.delete(f"/p/rules/{r3['id']}").status_code == 200 and c.delete(f"/p/rules/{r3['id']}").status_code == 404, "delete a rule")

# retry
c.post("/p/emit", json={"event": {"id": "act-1", "kind": "action", "actor": "You", "verb": "ran", "object": "Save", "ref": {"action": "file.save", "retry": "file.save"}}})
check(c.post("/p/retry/act-1").json()["action"] == "file.save", "retry a console action runs it in the console")
b = next(e for e in evs if e["source"] == "builds")
check(c.post(f"/p/retry/{b['id']}").json()["done"] is True, "retry a build puts it back in the Queue")

# stats, export, settings, clear
st = c.get("/p/stats").json()
check(st["errors"] >= 3 and st["lastError"]["id"] == "err-3" and st["rules"] == 2, "stats: errors today and the last error")
csv = c.get("/p/export?format=csv&tab=errors")
check(csv.status_code == 200 and "Studio could not download" in csv.text and csv.headers["content-type"].startswith("text/csv"), "export CSV of a tab")
check("# Activity log" in c.get("/p/export?format=md").text, "export Markdown")
check(c.get("/p/export?format=pdf").status_code == 400, "unknown export format refused")
check(c.put("/p/settings", json={"density": "compact", "colors": {"error": "danger"}}).json()["settings"]["density"] == "compact", "settings saved")
check(c.put("/p/settings", json={"colors": {"error": "#f00"}}).status_code == 400, "a colour must be a theme token")
check(c.put("/p/settings", json={"nope": 1}).status_code == 400, "unknown setting refused")
check(c.delete("/p/events").status_code == 400, "clear needs confirm")
check(c.delete("/p/events?confirm=activity-monitor").json()["removed"] > 10, "clear the log")
svc = plugin_services.get("axf.activity-log@1")
check(svc is not None and len(svc.emit({"actor": "Vinny", "verb": "pushed", "object": "main"})) == 1 and svc.query(q="vinny")[0]["sentence"] == "Vinny pushed main.", "the axf.activity-log@1 service writes and reads")
check(oct(os.stat(tmp / "data" / "events.jsonl").st_mode & 0o777) == "0o600", "the log file is private")
print(f"\n{n} checks passed")
