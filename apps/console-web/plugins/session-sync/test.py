#!/usr/bin/env python3
"""Self-test for the Session sync plugin's server part (session-link@1) with the real Agent swarm (axf.crew@1) on scratch
data and a fake axHub: who is calling (session headers vs Brett's click), primary / secondary enforcement (403 + audit),
a new account's approval (bell + held axHub approval + Brett's click), request-work → offers → accept → Breakroom lines
in the Sessions channel, the SSE event stream with resume, owner-only settings, consistency, the capability. Zero tokens.
    python3 apps/console-web/plugins/session-sync/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
T = Path(tempfile.mkdtemp(prefix="axf-session-sync-test-"))
os.environ.update(AXF_SESSION_SYNC_DIR=str(T / "link"), AXF_SWARM_DIR=str(T / "swarm"), AXF_SWARM_CHATS_DIR="off", AXHUB_TOKEN="test-token",
                  AXF_SESSION_SYNC_WATCH="0", AXF_BUILDS_STORE=str(T / "store.json"), AXF_BUILDS_LIVE="0", AXF_SYNC_PUBLISH="0", AXF_DATA_DIR="off",
                  AXF_BUILD_PROFILE="main-framework", AXF_BUILDS_EXPORT="0", AXF_CONSOLE_ROOT="off")
for k in ("AXF_APPROVER", "AXF_APPROVER_VIA", "CLAUDECODE"):
    os.environ.pop(k, None)
(T / "store.json").write_text(json.dumps({"$axf": "builds@1", "rev": 1, "updatedAt": "2026-11-04T19:00:00Z", "rules": {}, "meta": {}, "drafts": {}, "builds": [
    {"id": "foo", "title": "Foo plugin", "status": "pending", "profiles": ["main-framework"], "order": {"main-framework": 1}, "createdAt": "2026-11-04T18:00:00Z",
     "steps": [{"id": "s1", "text": "Foo one", "estimate": "20 min", "files": ["apps/console-web/plugins/foo/**"]}, {"id": "s2", "text": "Foo two", "estimate": "20 min"}]},
]}))
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []


def load(folder: str):
    d = HERE.parent / folder / "server"
    spec = importlib.util.spec_from_file_location(f"axf_console_plugins.{folder.replace('-', '_')}_test", d / "__init__.py", submodule_search_locations=[str(d)])
    m = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = m
    spec.loader.exec_module(m)
    return m


swarm = load("agent-swarm")  # provides axf.crew@1 (post / messages)
mod = load("session-sync")
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

asked: list[dict] = []


def fake_transport(method, params, sid):
    if method == "initialize":
        return {}, "sid-1"
    asked.append(params)
    return {"content": [{"type": "text", "text": json.dumps({"held": True, "job_id": "job-7"})}]}, sid


mod.hub.transport = fake_transport
mod.cx.log = lambda ch, text, level="info": print(f"[{ch}] {text}")


class Caller:
    def __init__(self, name, admin=True):
        self.name, self.admin, self.via = name, admin, "session"


app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):
    b = request.headers.get("x-test-brett")
    if b:
        request.state.axf_user = Caller(b)
    u = request.headers.get("x-test-user")
    if u:
        request.state.axf_user = Caller(u, admin=False)
    return await call_next(request)


app.include_router(mod.router, prefix="/api/plugins/session-sync")
app.include_router(swarm.router, prefix=f"/api/plugins/{swarm.CLI.parent.name}")  # the crew plugin, by its own folder
c = TestClient(app)
P = "/api/plugins/session-sync"
A = {"x-axf-session": "s-brett", "x-axf-account": "brett", "x-axf-agent": "rio", "x-axf-client": "code"}
B = {"x-axf-session": "s-two", "x-axf-account": "acct2", "x-axf-agent": "paulie", "x-axf-client": "code"}
BRETT = {"x-test-brett": "Brett"}
fails = 0
n = 0


def check(name, ok, detail=""):
    global fails, n
    n += 1
    if not ok:
        fails += 1
        print(f"✗ {name}" + (f"\n  {detail}" if detail else ""))


r = c.post(f"{P}/join", headers=A, json={})
check("A joins as primary", r.status_code == 200 and r.json()["role"] == "primary" and r.json()["becamePrimary"], r.text[:300])
r = c.post(f"{P}/join", json={})
check("no identity → 400", r.status_code == 400)
r = c.post(f"{P}/join", headers=B, json={})
check("B (new account) joins, waits for approval, axHub asked once", r.status_code == 200 and r.json()["needsApproval"] and r.json().get("approval", {}).get("held") and len(asked) == 1, r.text[:300])
check("the approval names the tool and the account", asked[0]["arguments"]["tool"] == "axf.session_sync_approve_account" and asked[0]["arguments"]["arguments"]["input"]["account"] == "acct2", json.dumps(asked[0])[:300])
r = c.post(f"{P}/offer", headers=B, json={"build": "foo"})
check("a secondary offering → 403 secondary sessions can't", r.status_code == 403 and "secondary sessions can't" in r.text, r.text)
r = c.post(f"{P}/replan", headers=B, json={})
check("a secondary replanning → 403", r.status_code == 403)
r = c.post(f"{P}/approve-account", headers=A, json={"account": "acct2"})
check("a session (even primary) approving an account → 403", r.status_code == 403)
r = c.post(f"{P}/approve-account", headers=BRETT, json={"account": "acct2"})
check("Brett's click approves the account", r.status_code == 200 and r.json()["sessions"] == ["s-two"], r.text)
r = c.post(f"{P}/claim", headers=A, json={"kind": "area", "area": "kernel", "build": "big"})
check("A claims kernel", r.status_code == 200 and r.json()["claim"]["area"] == "kernel", r.text)
r = c.post(f"{P}/claim", headers=B, json={"kind": "path", "paths": ["framework/core/x.ts"]})
check("B racing for kernel → 409 with the holder", r.status_code == 409 and "rio" in r.text, r.text)
r = c.post(f"{P}/request-work", headers=B, json={"minutes": 60})
check("request-work offers foo", r.status_code == 200 and any(o["build"] == "foo" for o in r.json()["offers"]), r.text[:300])
oid = r.json()["offers"][0]["id"]
r = c.get(f"{P}/offers", headers=B)
check("B sees its offer", r.status_code == 200 and r.json()["offers"][0]["id"] == oid)
r = c.post(f"{P}/respond", headers=B, json={"id": oid, "response": "accept"})
check("B accepts: queued assignment, store patched", r.status_code == 200 and r.json()["assignment"]["status"] == "queued" and r.json()["store"]["ok"], r.text[:300])
r = c.get(f"{P}/state", headers=B)
check("B's state is scoped (managed by orchestrator), lists foo", r.status_code == 200 and r.json()["scoped"] and r.json()["managedBy"] == "orchestrator" and any(b["id"] == "foo" for b in r.json()["builds"]), r.text[:300])
r = c.get(f"{P}/state", headers=BRETT)
check("Brett's console sees everything", r.status_code == 200 and not r.json()["scoped"] and r.json()["me"]["role"] == "primary" and r.json()["me"]["account"] == "brett", r.text[:300])
r = c.get(f"{P}/snapshot", headers=A)
check("the snapshot has working / running / done / attention / queued", r.status_code == 200 and all(k in r.json() for k in ("working", "running", "done", "attention", "queued", "offers")), r.text[:200])
r = c.post(f"{P}/send", headers=A, json={"text": "hey paulie", "build": "foo"})
check("send posts a line", r.status_code == 200 and r.json()["seq"] > 0)
r = c.get(f"{P}/messages", headers=B)
msgs = r.json()["messages"]
check("the Breakroom's Sessions channel has the lines (joins, offer, accept, send), posted as the agents", r.status_code == 200 and r.json()["available"] and any("took foo" in m["text"] and m["from"] == "paulie" for m in msgs) and any("hey paulie" in m["text"] and m["from"] == "rio" for m in msgs) and all(m["channel"] == "sessions" for m in msgs), json.dumps(msgs)[:500])
r = c.get(f"{P}/messages?filter=handovers", headers=B)
check("the handovers filter keeps only handover lines", r.status_code == 200 and r.json()["messages"] and all(m["kind"] == "handover" for m in r.json()["messages"]))
r = c.get(f"{P}/messages?filter=mine", headers=B)
check("the mine filter keeps lines about my build or by me", r.status_code == 200 and all("foo" in (m.get("jobId") or "") or m["from"] == "paulie" for m in r.json()["messages"]))
r = c.post(f"{P}/inbox", headers=B, json={})
check("inbox for B carries A's line and moves the cursor", r.status_code == 200 and any("hey paulie" in l["text"] for l in r.json()["lines"]), r.text[:300])
r = c.post(f"{P}/inbox", headers=B, json={})
check("nothing new after", r.status_code == 200 and r.json()["lines"] == [])
r = c.put(f"{P}/settings", headers=A, json={"enforce": False})
check("an owner-only setting from a session → 403", r.status_code == 403, r.text)
r = c.put(f"{P}/settings", headers=A, json={"heartbeatSec": 30})
check("the primary may change an ordinary setting", r.status_code == 200 and r.json()["settings"]["heartbeatSec"] == 30, r.text)
r = c.put(f"{P}/settings", headers=BRETT, json={"enforce": False})
check("Brett's click changes an owner-only setting", r.status_code == 200 and r.json()["settings"]["enforce"] is False, r.text)
r = c.get(f"{P}/consistency", headers=A)
check("consistency: no drift", r.status_code == 200 and r.json()["drift"] == 0, r.text)
r = c.get(f"{P}/audit", headers=A)
check("the audit has the refused writes", r.status_code == 200 and any(l.get("kind") == "refused" and l.get("action") == "offer" for l in r.json()["lines"]))
# SSE: replay from a seq, then a live event
with c.stream("GET", f"{P}/events?after=2", headers=A) as s:
    frames = []
    for line in s.iter_lines():
        if line.startswith("id:"):
            frames.append(int(line[3:].strip()))
        if len(frames) >= 3:
            break
check("the event stream replays from `after` with ids = seq", frames and frames[0] == 3 and frames == sorted(frames), str(frames))
r = c.get(f"{P}/sync-file", headers=A)
check("no sync file yet", r.status_code == 200 and r.json()["exists"] is False)
r = c.post(f"{P}/sync", headers=A, json={"publish": False})
check("sync writes the file and lists who is connected", r.status_code == 200 and r.json()["path"].endswith("amberx-axf.json") and len(r.json()["connected"]) == 2, r.text[:300])
r = c.get(f"{P}/sync-file", headers=A)
check("the sync file reads back fresh", r.status_code == 200 and r.json()["exists"] and r.json()["fresh"] and r.json()["doc"]["$axf"] == "handoff@1")
svc = plugin_services.get("axf.session-sync@1")
check("the capability answers role and assignment", svc is not None and svc.role_of("s-two", "acct2") == "secondary" and svc.role_of("s-brett") == "primary" and (svc.assigned("foo") or {}).get("session") == "s-two")
r = c.post(f"{P}/end", headers=B, json={"summary": "done"})
check("ending the helper gives foo back", r.status_code == 200 and r.json()["givenBack"])
for f in (REPO / "_claude/sync/amberx-axf.json", REPO / "_claude/sync/amberx-axf.md"):
    f.unlink(missing_ok=True)
print(f"{'✗' if fails else '✓'} session-sync server: {n - fails}/{n} checks")
sys.exit(1 if fails else 0)
