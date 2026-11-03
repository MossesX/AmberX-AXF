"""Console commands server part: consoles announce themselves, a command is resolved by the runner and sent down the
right console's stream, the console's ack comes back in the answer; one mailbox per signed-in user; REST shortcuts;
the capability; a destructive action needs a confirm token. Console wake (Nov 3 2026): a command that finds no console
is queued and delivered once when one says hello, a reconnecting stream gets its command when it is back, a closed
console is woken through AmberX (a fake phone here), the queue's TTL and the settings.

    python apps/console-web/plugins/console-commands/server/test_console_commands.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services
os.environ.setdefault("AXF_CONSOLE_COMMANDS_DATA_DIR", tempfile.mkdtemp())

import importlib.util  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

WOKEN: list[tuple[str, str]] = []

spec = importlib.util.spec_from_file_location("console_commands_server", HERE / "__init__.py")
cc = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(cc)
cc.WAKE_AFTER_S = 0.3
cc.WAKER = lambda url, browser: (WOKEN.append((url, browser)), {"ok": True, "message": "AmberX is opening the console"})[1]

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


# The console sets request.state.axf_user from its auth; here a header picks who is calling.
app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # type: ignore[no-untyped-def]
    u = request.headers.get("x-user", "")
    request.state.axf_user = types.SimpleNamespace(name="console", admin=True) if not u else types.SimpleNamespace(name=u, admin=False, perms=("control.console.read", "control.console.navigate"), role="")
    return await call_next(request)


app.include_router(cc.router, prefix="/api/console")
client = TestClient(app)

CATALOG = {"app": "console-web", "items": [
    {"kind": "screen", "id": "home", "label": "Home"},
    {"kind": "screen", "id": "plan-studio", "label": "Plan Studio", "keywords": ["plans"]},
    {"kind": "screen", "id": "build-orchestrator", "label": "Build orchestrator"},
    {"kind": "settings", "id": "sample-tools", "label": "Token control", "parent": "plugins"},
    {"kind": "dialog", "id": "asset-json", "label": "Asset JSON"},
    {"kind": "action", "id": "terminal.open", "label": "Open output terminal"},
    {"kind": "action", "id": "assets.reset", "label": "Reset to defaults"},
    {"kind": "action", "id": "assets.random", "label": "Randomize assets", "requires": "assets.swap"},
], "here": {"screen": "home"}}

# ---- announce two of Brett's consoles and one of another user's
eq(client.post("/api/console/hello", json={"client": "desk-0001", "title": "Dev Console", "device": "desktop", "catalog": CATALOG, "here": {"screen": "home"}}).json()["items"], 8, "hello stores the catalog")
time.sleep(0.01)
ok(client.post("/api/console/hello", json={"client": "phone-0001", "device": "phone", "catalog": CATALOG, "used": True}).json()["ok"], "second console")
ok(client.post("/api/console/hello", json={"client": "sam-00001", "catalog": CATALOG}, headers={"x-user": "sam"}).json()["ok"], "another user's console")
eq(client.post("/api/console/hello", json={"client": "x"}).status_code, 400, "bad client id refused")
eq(client.post("/api/console/hello", json={"client": "sam-00001", "catalog": CATALOG}).status_code, 403, "someone else's console id refused")
items = client.get("/api/console/clients").json()["items"]
eq([c["id"] for c in items], ["phone-0001", "desk-0001"], "the owner sees only their consoles, used last first")


def fake_console(cid: str, user: str = "", answers: list[dict] | None = None, stop: threading.Event | None = None) -> threading.Thread:
    """A console tab: reads its stream and acks every command it gets."""
    got = answers if answers is not None else []

    def loop() -> None:
        hdr = {"x-user": user} if user else {}
        with client.stream("GET", f"/api/console/stream?client={cid}", headers=hdr) as s:
            for line in s.iter_lines():
                if line.startswith("data: "):
                    m = json.loads(line[6:])
                    if m.get("$axf") == "console-hello@1":  # the server lost our catalog: say hello again
                        client.post("/api/console/hello", json={"client": cid, "catalog": CATALOG}, headers=hdr)
                        continue
                    got.append(m)
                    client.post("/api/console/ack", json={"client": cid, "id": m["id"], "ok": True, "message": f"opened {m.get('label') or m['op']}", "here": {"screen": m.get("target", "")}}, headers=hdr)
                    if stop is not None and stop.is_set():
                        return
                    if len(got) >= 50:
                        return

    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


phone_got: list[dict] = []
fake_console("phone-0001", answers=phone_got)
time.sleep(0.3)

# ---- open a screen by words → the console used last gets it, and its ack is in the answer
r = client.post("/api/console/open", json={"screen": "plan studio", "by": "claude"})
j = r.json()
eq(r.status_code, 200, f"open answers 200 ({j})")
ok(j["ok"] and j["item"]["id"] == "plan-studio", "resolved by words")
eq([d["client"] for d in j["delivered"]], ["phone-0001"], "sent to the console used last")
ok(j["delivered"][0]["ok"] and j["delivered"][0]["message"] == "opened Plan Studio", "the console's ack is in the answer")
ok(phone_got and phone_got[-1]["op"] == "open" and phone_got[-1]["kind"] == "screen" and phone_got[-1]["target"] == "plan-studio", "the console got a console-command@1")
eq(phone_got[-1]["$axf"], "console-command@1", "message frame")

# ---- whole command, settings sub-tab with anchor, back
j = client.post("/api/console", json={"op": "act", "target": "console.settings", "path": "plugins/sample-tools", "action": "open", "input": {"anchor": "settings-group:x"}}).json()
ok(j["ok"] and phone_got[-1]["kind"] == "settings" and phone_got[-1]["anchor"] == "settings-group:x", "settings sub-tab through the whole-command route")
ok(client.post("/api/console/back", json={}).json()["ok"] and phone_got[-1]["op"] == "back", "back")
ok(client.post("/api/console/home", json={}).json()["ok"] and phone_got[-1]["op"] == "home", "home")

# ---- to: desk (no stream yet: reconnecting) → the call waits, the command goes down when the stream is back
res: dict = {}
t = threading.Thread(target=lambda: res.update(client.post("/api/console/open", json={"screen": "orchestrator", "to": "desk-0001"}).json()))
t.start()
time.sleep(0.6)
ok(t.is_alive(), "the call waits while the console's stream is reconnecting")
desk_got: list[dict] = []
fake_console("desk-0001", answers=desk_got)
t.join(10)
ok(desk_got and desk_got[0]["target"] == "build-orchestrator", "the pending command arrives when the stream opens")
ok(res.get("ok") and res["delivered"][0]["ok"], f"the answer carries the ack after the reconnect ({res})")
eq(res["delivery"]["how"], "after reconnect", "delivery says after reconnect")

# ---- unknown screen, list, where
r = client.post("/api/console/open", json={"screen": "spreadsheet"})
eq(r.status_code, 404, "unknown screen → 404 not_found")
ok("no screen" in r.json()["message"], "says what it could not find")
j = client.get("/api/console/list?kind=screens&q=plan").json()
eq([i["id"] for i in j["items"]], ["plan-studio"], "list with words")
j = client.get("/api/console/where").json()
ok(j["ok"] and "value" in j, "where")

# ---- actions: navigating runs, destructive asks for a confirm token, then runs
j = client.post("/api/console/action", json={"id": "terminal.open"}).json()
ok(j["ok"] and phone_got[-1]["spec"] == "terminal.open", "a navigating action runs")
r = client.post("/api/console/action", json={"id": "assets.reset"})
eq(r.status_code, 409, "a destructive action → 409 confirmation_required")
tok = r.json()["confirm"]
j = client.post("/api/console/action", json={"id": "assets.reset", "confirm": tok}).json()
ok(j["ok"] and phone_got[-1]["spec"] == "assets.reset", "the same action with the token runs")

# ---- another user: only their own console, only navigate
sam_got: list[dict] = []
fake_console("sam-00001", user="sam", answers=sam_got)
time.sleep(0.3)
before = len(phone_got)
j = client.post("/api/console/open", json={"screen": "home"}, headers={"x-user": "sam"}).json()
ok(j["ok"] and [d["client"] for d in j["delivered"]] == ["sam-00001"], "a user's command reaches only their console")
eq(len(phone_got), before, "Brett's console untouched")
r = client.post("/api/console/action", json={"id": "assets.random"}, headers={"x-user": "sam"})
eq(r.status_code, 403, "a navigate-only user can't run a data action")
eq(r.json()["code"], "denied", "denied names it")
eq(client.post("/api/console/ack", json={"client": "phone-0001", "id": "x"}, headers={"x-user": "sam"}).status_code, 404, "can't ack someone else's console")

# ---- recent + capability
rec = client.get("/api/console/recent").json()["items"]
ok(rec and rec[0]["action"] == "run", "recent commands for the owner")
ok(all(x["audience"] == "owner" for x in rec), "recent is per audience")
svc = plugin_services.get("console-commands@1")
ok(svc is not None, "capability provided")
j = svc.run({"op": "act", "target": "console.screens", "path": "Plan Studio", "action": "open"}, ["*"], "mcp")
ok(j["ok"] and j["delivered"][0]["client"] == "phone-0001", "capability run reaches the owner's console")
j = svc.run({"op": "list", "target": "tokens.layout"}, ["*"], "mcp")
eq(j["code"], "invalid", "not a console target")

# ---- bye: the console drops out of `recent`
client.post("/api/console/bye", json={"client": "phone-0001"})
j = client.post("/api/console/open", json={"screen": "home"}).json()
eq([d["client"] for d in j["delivered"]], ["desk-0001"], "after bye the other console is the recent one")

j = client.post("/api/console/open", json={"screen": "plan studio"}).json()
eq(j["delivery"]["how"], "live", "a live console: delivery live")

# ======================================================================== console wake: no console connected
client.post("/api/console/bye", json={"client": "desk-0001"})
eq(client.get("/api/console/settings").json()["settings"], {"wake": True, "ttlS": 120, "browser": "chrome"}, "default settings: wake on, 2 minutes, Chrome")

# a wrong name answers at once (checked against the last catalog the console sent), nothing queued, nobody woken
r = client.post("/api/console/open", json={"screen": "spreadsheet"})
eq(r.status_code, 404, "unknown screen with no console open: still 404 at once")
ok(not r.json().get("noConsole"), "…as no such screen, not as no console")
eq(client.get("/api/console/queue").json()["items"], [], "nothing queued for it")

# a command with nobody connected: queued, AmberX is asked to open the console, the new tab picks it up once
res = {}
t = threading.Thread(target=lambda: res.update(client.post("/api/console/action", json={"id": "terminal.open", "by": "Amber"}).json()))
t.start()
time.sleep(0.8)
q = client.get("/api/console/queue").json()["items"]
eq([x["state"] for x in q], ["queued"], "the command is queued, the call waits")
eq(len(WOKEN), 1, "AmberX asked to open the console after a few seconds of nothing")
ok(WOKEN[0][0] == f"https://console.amberxai.com/?axf-cmd={q[0]['id']}" and WOKEN[0][1] == "chrome", f"deep link with the command id, Chrome ({WOKEN})")
woke_got: list[dict] = []
client.post("/api/console/hello", json={"client": "woke-0001", "device": "phone", "catalog": CATALOG, "pick": q[0]["id"], "used": True})
client.post("/api/console/hello", json={"client": "woke-0001", "device": "phone", "catalog": CATALOG, "pick": q[0]["id"]})  # a second hello (reload)
fake_console("woke-0001", answers=woke_got)
t.join(15)
ok(res.get("ok") and res["delivered"][0]["ok"], f"the waiting call answers with the console's ack ({res})")
eq(res["delivery"]["how"], "woke via AmberX", "delivery says woke via AmberX")
time.sleep(0.5)
eq([m["spec"] for m in woke_got], ["terminal.open"], "delivered exactly once, even with two hellos")
eq(woke_got[0]["delivery"], "woke", "the message tells the console it was woken (its toast)")
eq(client.get("/api/console/queue").json()["items"][0]["state"], "delivered", "the queue shows it delivered")
ok(client.get("/api/console/recent").json()["items"][0]["how"] == "woke via AmberX", "recent commands say how")

# a console that reconnects within the wake delay: after reconnect, nobody woken
client.post("/api/console/bye", json={"client": "woke-0001"})
cc.WAKE_AGAIN_S = 0
res = {}
t = threading.Thread(target=lambda: res.update(client.post("/api/console/open", json={"screen": "home"}).json()))
t.start()
time.sleep(0.1)
client.post("/api/console/hello", json={"client": "woke-0001", "catalog": CATALOG, "used": True})
t.join(15)
eq(res.get("delivery", {}).get("how"), "after reconnect", f"queued then delivered on reconnect ({res})")
time.sleep(0.4)
eq(len(WOKEN), 1, "no wake when a console came back in time")

# wake off: queued, nobody woken; the call gives up waiting with queued (still delivered later)
eq(client.post("/api/console/settings", json={"wake": False, "ttlS": 5, "browser": "default"}).json()["settings"], {"wake": False, "ttlS": 30, "browser": "default"}, "settings saved, TTL clamped to 30 s")
eq(client.post("/api/console/settings", json={"wake": True}, headers={"x-user": "sam"}).status_code, 403, "only the owner changes them")
client.post("/api/console/bye", json={"client": "woke-0001"})
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, ["*"], "Amber", cc.OWNER, wait=cc.WAKE_AFTER_S + 0.5)
ok(r["ok"] and r["queued"] and r["delivery"]["how"] == "queued", f"still nobody after the wait: answered queued ({r})")
ok("queued, waiting for the console" in r["message"], "the answer says it is waiting")
time.sleep(0.4)
eq(len(WOKEN), 1, "wake off: AmberX not asked")
ok("off" in r["delivery"]["wake"]["message"] and "off" in r["message"], f"the answer says waking is off ({r['delivery']})")

# TTL: an expired command is never delivered
with cc._lock:
    for e in cc._queue:
        if e["state"] == "queued":
            e["expires"] = cc._now() - 1
late: list[dict] = []
client.post("/api/console/hello", json={"client": "late-0001", "catalog": CATALOG, "used": True})
fake_console("late-0001", answers=late)
time.sleep(0.8)
eq(late, [], "an expired command is not delivered")
ok(any(x["state"] == "expired" for x in client.get("/api/console/queue").json()["items"]), "the queue shows it expired")

# another user's command: queued for them only, never wakes Brett's phone
client.post("/api/console/bye", json={"client": "sam-00001"}, headers={"x-user": "sam"})
r = cc.run({"op": "act", "target": "console.screens", "path": "home", "action": "open"}, ["control.console.navigate"], "sam", "user:sam", wait=0.6)
ok(r["queued"], "a user's command queues too")
time.sleep(0.5)
eq(len(WOKEN), 1, "a user's command never wakes the owner's phone")
eq([x["by"] for x in client.get("/api/console/queue", headers={"x-user": "sam"}).json()["items"]], ["sam"], "each user sees only their queue")

# a named console that is gone is still an error (not queued)
r = client.post("/api/console/open", json={"screen": "home", "to": "gone-00001"})
eq(r.status_code, 404, "a command for one named console that isn't there: 404")

# after a server restart the console's stream comes back without a catalog: the server asks it to say hello again
with cc._lock:
    cc._clients.pop("late-0001", None)
again: list[dict] = []
fake_console("late-0001", answers=again)
time.sleep(0.6)
j = client.post("/api/console/open", json={"screen": "plan studio"}).json()
ok(j["ok"] and again and again[-1]["target"] == "plan-studio", f"re-hello after a restart, then commands go through ({j.get('delivery')})")

print(f"✓ console commands server — {checks} checks", flush=True)
os._exit(0)  # the fake consoles' streams are still open
