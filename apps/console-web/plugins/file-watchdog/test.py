"""File watchdog self-test: the watch model, change detection, debounce, every action type, approvals, the AI switch,
the event log and the routes. No AI, network or console needed.

    python apps/console-web/plugins/file-watchdog/test.py
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
sys.path.insert(0, str(HERE.parents[1] / "server"))
WORK = Path(tempfile.mkdtemp())
ROOT = WORK / "repo"
ROOT.mkdir()
os.environ["AXF_WATCHDOG_DATA_DIR"] = str(WORK / "data")
os.environ["AXF_WATCHDOG_ROOT"] = str(ROOT)
os.environ["AXF_WATCHDOG_NO_LOOP"] = "1"

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    checks += 1
    if not v:
        raise SystemExit(f"FAILED: {what}")


alerts: list[dict] = []
cx.set_context(raise_alert=lambda a: alerts.append(a) or {})

spec = importlib.util.spec_from_file_location("watchdog_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["watchdog_server"] = mod
spec.loader.exec_module(mod)
E = sys.modules["engine"]
eng = mod.ENGINE

# ---- pure parts
ok(E.merge_event(None, "created") == "created", "first event kept")
ok(E.merge_event("created", "modified") == "created", "created then modified = created")
ok(E.merge_event("created", "deleted") is None, "created then deleted = nothing")
ok(E.merge_event("deleted", "created") == "modified", "deleted then created = modified")
ok(E.merge_event("modified", "deleted") == "deleted", "modified then deleted = deleted")
ok(E.ignored("node_modules/x/y.js", E.DEFAULT_IGNORE), "default ignore: node_modules")
ok(E.ignored("a/.git/HEAD", E.DEFAULT_IGNORE), "default ignore: nested .git")
ok(not E.ignored("src/app.ts", E.DEFAULT_IGNORE), "a normal file is not ignored")
ok(E.compare({"a": (1, 1), "b": (1, 1)}, {"b": (2, 1), "c": (1, 1)}) == [("deleted", "a"), ("modified", "b"), ("created", "c")], "snapshot compare")
ok("+new" in E.text_diff("old\n", "new\n", "f.txt"), "text diff")
ok(E._fill("x {path} {event}", {"path": "a b", "event": "created"}, quote=True) == "x 'a b' created", "shell placeholders are quoted")
for bad, why in [({}, "no paths"), ({"paths": ["x"], "actions": [{"type": "nope"}]}, "unknown action"), ({"paths": ["x"], "actions": [{"type": "shell"}]}, "shell without command"),
                 ({"paths": ["x"], "actions": [{"type": "control", "command": "{not json"}]}, "control not JSON")]:
    try:
        E.normal_watch(bad)
        ok(False, f"rejects {why}")
    except E.WatchError:
        ok(True, f"rejects {why}")
w0 = E.normal_watch({"paths": "a.txt\nb/*.md"})
ok(w0["paths"] == ["a.txt", "b/*.md"] and w0["ai"]["enabled"] is False and w0["enabled"] and w0["recursive"], "defaults: AI off, enabled, recursive")

# ---- the routes, end to end
app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)

(ROOT / "watched").mkdir()
(ROOT / "watched" / "a.txt").write_text("one\n")
(ROOT / "watched" / "skip.swp").write_text("x")
marker = WORK / "marker.txt"
script = ROOT / "on-change.sh"
script.write_text(f'#!/bin/sh\necho "$WATCHDOG_EVENT $1" >> {marker}\n')

r = c.post("/add", json={"name": "Watched folder", "paths": ["watched"], "debounceMs": 0, "actions": [
    {"type": "notify", "title": "{name}: {event} {rel}"},
    {"type": "script", "script": "on-change.sh", "args": ["{rel}"]},
    {"type": "shell", "command": f"echo shell {{event}} {{rel}} >> {marker}"},
    {"type": "console", "action": "nav:builds"},
    {"type": "control", "command": {"op": "get", "target": "console.screens"}},
]})
ok(r.status_code == 200, f"add: {r.text}")
wid = r.json()["watch"]["id"]
ok(wid == "watched-folder", "id from the name")
ok(c.post("/add", json={"name": "Watched folder", "paths": ["watched"]}).json()["watch"]["id"] == "watched-folder-2", "ids stay unique")
c.delete("/watch", params={"id": "watched-folder-2"})
ok(c.post("/add", json={"paths": []}).status_code == 400, "a bad watch is a 400 with the reason")

ok(c.post("/scan").json()["fired"] == 0, "first pass only takes the snapshot")
st = c.get("/state").json()
ok(st["watches"][0]["files"] == 1, "ignore patterns: the .swp file isn't tracked")
ok(st["counts"]["needApproval"] == 2, "script and shell need approval")

# no console services: console + control fail with a reason, scripts are held
(ROOT / "watched" / "b.txt").write_text("two\n")
ok(c.post("/scan").json()["fired"] == 1, "a new file fires")
ev = c.get("/events").json()["events"][0]
ok(ev["event"] == "created" and ev["rel"] == "watched/b.txt", "event and path logged")
res = {x["type"]: x for x in ev["results"]}
ok(res["notify"]["ok"] and alerts and alerts[-1]["title"] == "Watched folder: created watched/b.txt", "notify gets the path and event")
ok(res["script"]["status"] == "held" and res["shell"]["status"] == "held", "unapproved script / shell are held, not run")
ok(not marker.exists(), "nothing ran before approval")
ok(res["console"]["status"] == "failed" and "Console commands" in res["console"]["message"], "console action without the service says why")
ok(res["control"]["status"] == "failed", "control action without control@1 says why")

# approvals: only the owner's request approves
class FakeControl:
    owner_ok = False
    calls: list[dict] = []

    def owner(self, request):
        return {"via": "console", "name": "Brett"} if self.owner_ok else None

    def run(self, cmd, grants=None, by=""):
        self.calls.append(cmd)
        return {"ok": True, "message": "done"}


class FakeConsole:
    calls: list[dict] = []

    def run(self, cmd, grants=None, by=""):
        self.calls.append(cmd)
        return {"ok": True, "message": "opened"}


ctl, con = FakeControl(), FakeConsole()
plugin_services.provide("control@1", ctl, "token-control")
plugin_services.provide("console-commands@1", con, "console-commands")
r = c.post("/approve", json={"id": wid, "action": 1}).json()
ok(not r["approved"] and r["action"]["approval"]["state"] == "requested", "a non-owner approval is only a request")
ok(any(a.get("key", "").startswith("file-watchdog-approve:") for a in alerts), "the request asks Brett with an alert")
ctl.owner_ok = True
ok(c.post("/approve", json={"id": wid, "action": 1}).json()["approved"], "the owner approves the script")
ok(c.post("/approve", json={"id": wid, "action": 2}).json()["approved"], "the owner approves the shell command")
ok(c.post("/approve", json={"id": wid, "action": 0}).status_code == 400, "a notify action has nothing to approve")

(ROOT / "watched" / "a.txt").write_text("one changed\n")
c.post("/scan")
ev = c.get("/events").json()["events"][0]
res = {x["type"]: x for x in ev["results"]}
ok(ev["event"] == "modified", "a change is modified")
ok(res["script"]["ok"] and res["shell"]["ok"], f"approved script and shell run: {res}")
lines = marker.read_text().splitlines()
ok("modified watched/a.txt" in lines and "shell modified watched/a.txt" in lines, "script and shell got the event and path")
ok(con.calls[-1]["path"] == "nav:builds" and con.calls[-1]["target"] == "console.actions", "console action goes through console-commands@1")
ok(ctl.calls[-1]["target"] == "console.screens" and ctl.calls[-1]["by"] == "file-watchdog", "control command goes through control@1")

# editing the command clears its approval
w = c.get("/watch", params={"id": wid}).json()["watch"]
acts = w["actions"]
acts[2] = {**acts[2], "command": "echo changed"}
c.post("/update", json={"id": wid, "actions": acts})
w = c.get("/watch", params={"id": wid}).json()["watch"]
ok(w["actions"][2]["approval"]["state"] == "needed", "a changed command needs a new approval")
ok(w["actions"][1]["approval"]["state"] == "approved", "the unchanged script keeps its approval")
ok(c.post("/approve", json={"id": wid, "action": 1, "revoke": True}).json()["action"]["approval"]["state"] == "needed", "revoke")

# deleted + event filter
(ROOT / "watched" / "b.txt").unlink()
c.post("/scan")
ok(c.get("/events").json()["events"][0]["event"] == "deleted", "deleted fires")
c.post("/update", json={"id": wid, "events": ["deleted"]})
c.post("/scan")
(ROOT / "watched" / "c.txt").write_text("x")
ok(c.post("/scan").json()["fired"] == 0, "events the watch doesn't want don't fire")

# debounce: changes inside the window wait, then fire once
c.post("/update", json={"id": wid, "events": ["created", "modified", "deleted"], "debounceMs": 60000, "actions": []})
eng.scan()
(ROOT / "watched" / "d.txt").write_text("1")
ok(eng.scan(time.time()) == 0, "debounce: waits")
(ROOT / "watched" / "d.txt").write_text("22")
ok(eng.scan(time.time()) == 0 and eng.pending[wid] == {str(ROOT / "watched" / "d.txt"): "created"}, "debounce: changes merge")
ok(eng.scan(time.time() + 61) == 1, "debounce: fires once after the window")

# disabled watch
c.post("/enable", json={"id": wid, "enabled": False})
(ROOT / "watched" / "e.txt").write_text("x")
ok(c.post("/scan").json()["fired"] == 0, "a switched-off watch doesn't fire")
c.post("/enable", json={"id": wid, "enabled": True})

# globs + non-recursive
(ROOT / "docs" / "sub").mkdir(parents=True)
(ROOT / "docs" / "x.md").write_text("x")
(ROOT / "docs" / "sub" / "y.md").write_text("y")
(ROOT / "docs" / "z.txt").write_text("z")
g = c.post("/add", json={"name": "docs", "paths": ["docs/**/*.md"], "debounceMs": 0}).json()["watch"]
files, _ = E.snapshot(g, ROOT)
ok(set(files) == {str(ROOT / "docs" / "x.md"), str(ROOT / "docs" / "sub" / "y.md")}, "a ** glob matches nested files only")
flat = E.snapshot({**g, "paths": ["docs"], "recursive": False}, ROOT)[0]
ok(str(ROOT / "docs" / "sub" / "y.md") not in flat and str(ROOT / "docs" / "z.txt") in flat, "non-recursive skips sub-folders")

# AI: off by default; on → prompt + path + event + diff, tokens logged
seen: list = []


class FakeLlm:
    def complete(self, messages, **kw):
        seen.append((messages, kw))
        return {"text": "looks fine", "usage": {"input": 120, "output": 8}, "model": "claude-opus-5-5", "profile": "default"}


plugin_services.provide("axf.llm@1", FakeLlm(), "ai-assistant")
c.post("/scan")
(ROOT / "docs" / "x.md").write_text("x changed\n")
c.post("/scan")
ok(not seen and not any(r["type"] == "ai" for r in c.get("/events", params={"watch": "docs"}).json()["events"][0]["results"]), "AI stays off unless switched on")
r = c.post("/ai", json={"id": "docs", "enabled": True, "prompt": "Summarise {rel}"})
ok(r.json()["watch"]["ai"]["enabled"], "Enable AI switch")
c.post("/scan")  # primes the texts for the diff
(ROOT / "docs" / "x.md").write_text("x changed again\n")
c.post("/scan")
ok(seen, "AI called once on")
msg = seen[-1][0][0]["content"]
ok("Summarise docs/x.md" in msg and "Event: modified" in msg and "-x changed\n+x changed again" in msg, "prompt, event, path and diff reach Claude")
air = [r for r in c.get("/events", params={"watch": "docs"}).json()["events"][0]["results"] if r["type"] == "ai"][0]
ok(air["ok"] and air["usage"] == {"input": 120, "output": 8} and air["model"] == "claude-opus-5-5", "tokens and model logged")
c.post("/ai", json={"id": "docs", "prompt": ""})
c.post("/test", json={"id": "docs", "path": "docs/x.md"})
air = [r for r in c.get("/events").json()["events"][0]["results"] if r["type"] == "ai"][0]
ok(air["status"] == "skipped", "AI on without a prompt is skipped with a reason")
ok(c.get("/events").json()["events"][0]["test"], "test fires are marked")

# log, remove, storage
ok(len(c.get("/events", params={"limit": 2}).json()["events"]) == 2, "events limit")
ok(c.post("/events/clear").json()["cleared"] and c.get("/events").json()["events"] == [], "clear the log")
ok(c.delete("/watch", params={"id": "docs"}).json()["removed"] == "docs", "remove")
ok(c.get("/watch", params={"id": "docs"}).status_code == 404, "removed watch is gone")
data = Path(os.environ["AXF_WATCHDOG_DATA_DIR"])
ok(oct(os.stat(data / "watches.json").st_mode & 0o777) == "0o600", "watches file is private")
ok(json.loads((data / "watches.json").read_text())["$axf"] == "file-watchdog@1", "watches file is tagged")

# inotify waker (Linux): a change wakes it
wk = E.Waker()
if wk.kind == "inotify":
    wk.sync({str(ROOT / "watched")})
    (ROOT / "watched" / "wake.txt").write_text("x")
    ok(wk.wait(1.0), "inotify wakes on a change")

# the manifest exposes every route as a command
man = json.loads((HERE / "plugin.json").read_text())
routes = {f"{r.methods and sorted(r.methods)[0]} {r.path}" for r in mod.router.routes}
declared = {i["route"] for i in man["commands"]["items"]}
ok(routes <= declared, f"every route declared: {routes - declared}")

print(f"file-watchdog: {checks} checks passed")
