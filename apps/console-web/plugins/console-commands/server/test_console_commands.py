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


def wait_for(cond, timeout: float = 15.0) -> bool:  # type: ignore[no-untyped-def]
    """Poll instead of a fixed sleep: CI runners are slow and a fixed sleep made these checks racy."""
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return bool(cond())


def stream_open(cid: str) -> bool:
    with cc._lock:
        c = cc._clients.get(cid)
        return bool(c and c.get("queue") is not None and cc._ready(c))


phone_got: list[dict] = []
fake_console("phone-0001", answers=phone_got)
wait_for(lambda: stream_open("phone-0001"))

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
# POST /api/console/settings with a tab opens it (it shares the path with the wake-settings save, which once shadowed it)
n_before = len(phone_got)
j = client.post("/api/console/settings", json={"tab": "plugins/sample-tools", "anchor": "settings-group:x", "by": "claude"}).json()
ok(j["ok"] and len(phone_got) == n_before + 1 and phone_got[-1]["kind"] == "settings" and phone_got[-1]["anchor"] == "settings-group:x", f"POST /settings with a tab opens it ({j})")
j = client.post("/api/console/settings", json={"ttlS": 120}).json()
ok(j["ok"] and j["settings"]["ttlS"] == 120 and len(phone_got) == n_before + 1, "POST /settings without a tab still saves the wake settings (nothing sent)")
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
wait_for(lambda: stream_open("sam-00001"))
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
wait_for(lambda: len(WOKEN) >= 1)
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
wait_for(lambda: len(woke_got) >= 1)
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
wait_for(lambda: any(x["state"] == "queued" for x in client.get("/api/console/queue").json()["items"]))
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
ok("queued, not open yet" in r["message"], "the answer says it is waiting, not opened")
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
wait_for(lambda: stream_open("late-0001"))
time.sleep(0.5)
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
wait_for(lambda: stream_open("late-0001"))
j = client.post("/api/console/open", json={"screen": "plan studio"}).json()
ok(j["ok"] and again and again[-1]["target"] == "plan-studio", f"re-hello after a restart, then commands go through ({j.get('delivery')})")

# the console inside Molly (molly-console-commands, Nov 3 2026): it says where it runs and whether Molly shows it; a
# command for "the console Brett is using" goes to the one in front, even when another was touched last
molly: list[dict] = []
client.post("/api/console/seen", json={"client": "late-0001", "front": True})
client.post("/api/console/hello", json={"client": "molly-0001", "app": "molly/console-web", "host": "molly", "front": False, "catalog": CATALOG, "used": True})
fake_console("molly-0001", answers=molly)
wait_for(lambda: stream_open("molly-0001"))
row = next(c for c in client.get("/api/console/clients").json()["items"] if c["id"] == "molly-0001")
ok(row["app"] == "molly/console-web" and row["host"] == "molly" and row["front"] is False, f"Molly's console is listed as such ({row})")
j = client.post("/api/console/open", json={"screen": "home"}).json()
eq([d["client"] for d in j["delivered"]], ["late-0001"], "a console hidden behind another app in Molly is not 'recent'")
client.post("/api/console/seen", json={"client": "molly-0001", "front": True, "used": True})
j = client.post("/api/console/open", json={"screen": "plan studio"}).json()
eq([d["client"] for d in j["delivered"]], ["molly-0001"], "once Molly shows it, it gets the command")
ok(molly and molly[-1]["target"] == "plan-studio", "Molly's console ran it")
eq(client.get("/api/console/clients").json()["items"][0]["id"], "molly-0001", "the console in front is listed first")
client.post("/api/console/hello", json={"client": "molly-0001", "host": "Bad Host!", "catalog": CATALOG})
eq(next(c for c in client.get("/api/console/clients").json()["items"] if c["id"] == "molly-0001").get("host", ""), "", "a malformed host name is dropped")

# ======================================================================== the wake never takes the phone's word for it
import types  # noqa: E402
sys.modules.setdefault("axf_server", types.SimpleNamespace(http=None, hub_session=None))
wk_spec = importlib.util.spec_from_file_location("console_commands_wake", HERE / "wake.py")
wk = importlib.util.module_from_spec(wk_spec)
wk_spec.loader.exec_module(wk)  # type: ignore[union-attr]
said = lambda doc, **kw: wk.outcome({"content": [{"type": "text", "text": json.dumps(doc)}], **kw})  # noqa: E731
o = said({"url": "u", "opened": False, "notified": True, "overlay": True})
ok(o["ok"] and not o["opened"] and o["notified"] and "tap" in o["message"].lower(), f"Android held it back: says tap the notification ({o})")
o = said({"opened": False, "notified": True, "overlay": False})
ok("Display over other apps" in o["message"], f"names the missing permission ({o})")
o = said({"data": {"opened": True, "notified": True}})
ok(o["opened"] and "started" in o["message"], f"a nested answer is read; it says started, never opened on screen ({o})")
o = said({"opened": False, "notified": False})
ok(not o["opened"] and not o["notified"] and "off" in o["message"], f"no notification either ({o})")
# Phone Connect's answer (axf.phone@1 hub_tool): opened only when the phone says the page is on screen
o = wk.phone_outcome({"ok": True, "output": "x", "opened": {"answered": True, "opened": True, "notified": False, "how": "console-app", "message": "The console app is open on it, in front."}})
ok(o["ok"] and o["opened"] and not o["notified"] and o["how"] == "console-app" and o["via"] == "phone", f"the phone opened it straight, no tap ({o})")
o = wk.phone_outcome({"ok": True, "output": "x", "opened": {"answered": True, "opened": False, "notified": True, "how": "notification", "message": "Not opened: …"}})
ok(o["ok"] and not o["opened"] and o["notified"] and o["message"].startswith("Not opened"), f"only notified is never called opened ({o})")
o = wk.phone_outcome({"ok": True, "output": "sent", "opened": {"answered": False, "opened": False, "notified": False, "how": "", "message": "Sent to the phone; it has not answered yet"}})
ok(o["ok"] and not o["opened"] and not o["notified"], f"no answer yet is neither ({o})")
o = wk.phone_outcome({"ok": True, "output": "Phone Connect opened it on the phone", "command": {"status": "done"}})
ok(not o["opened"] and not o["notified"], f"an answer without the phone's own account proves nothing ({o})")
o = wk.phone_outcome({"ok": False, "output": "the phone failed"})
ok(not o["ok"] and not o["opened"] and "failed" in o["message"], f"a failure is passed on ({o})")
o = said({"held": True, "job_id": "j"})
ok(not o["ok"], "a held call is not a wake")
o = said({"error": {"message": "device offline"}}, isError=True)
ok(not o["ok"] and "device offline" in o["message"], "a phone error is passed on")
# one overlay (Nov 13 2026): the always-on toolbar takes opens directly, and carries the collapse verb
o = said({"url": "u", "verb": "open", "where": "overlay", "opened": True, "notified": False, "overlay": True})
ok(o["ok"] and o["opened"] and not o["notified"] and "overlay" in o["message"], f"opened in the overlay, no tap ({o})")
o = said({"url": "u", "verb": "collapse", "where": "overlay", "collapsed": True, "opened": False})
ok(o["ok"] and "collapsed" in o["message"], f"collapse verb answered ({o})")
o = said({"url": "u", "verb": "collapse", "where": "overlay", "collapsed": False, "opened": False, "overlay": False})
ok(not o["ok"], f"collapse with no toolbar on screen is not ok ({o})")
# the console app (apps/console-droid) with its overlay off: the app itself opens the page
o = said({"url": "u", "verb": "open", "where": "app", "opened": True, "notified": False, "overlay": False})
ok(o["ok"] and o["opened"] and "console app" in o["message"] and "browser" not in o["message"], f"opened in the console app ({o})")

# ======================================================================== the phone's overlay verbs (overlay.expand / collapse / open)
WOKEN.clear()
j = client.post("/api/console/overlay", json={"verb": "expand"}).json()
ok(j["ok"] and WOKEN[-1][0] == f"{cc.CONSOLE_URL}/?axf-overlay=expand", f"expand rides amberx.open_url with the verb ({WOKEN[-1:]})")
j = client.post("/api/console/overlay", json={"verb": "collapse"}).json()
eq(WOKEN[-1][0], f"{cc.CONSOLE_URL}/?axf-overlay=collapse", "collapse too")
j = client.post("/api/console/overlay", json={"verb": "open", "url": "https://console.amberxai.com/?axf-view=ui-review"}).json()
ok(j["ok"] and WOKEN[-1][0] == "https://console.amberxai.com/?axf-view=ui-review", "open sends the page itself")
n = len(WOKEN)
r = client.post("/api/console/overlay", json={"verb": "open", "url": "https://evil.example/"})
eq((r.status_code, len(WOKEN)), (400, n), "open refuses a page off Brett's domain, nothing sent")
r = client.post("/api/console/overlay", json={"verb": "open", "url": "http://console.amberxai.com/"})
eq(r.status_code, 400, "https only")
r = client.post("/api/console/overlay", json={"verb": "dance"})
eq(r.status_code, 400, "unknown verb")
r = client.post("/api/console/overlay", json={"verb": "expand"}, headers={"x-user": "guest"})
eq((r.status_code, len(WOKEN)), (403, n), "another user never reaches Brett's phone")
saved_waker = cc.WAKER
cc.WAKER = lambda url, browser: (_ for _ in ()).throw(RuntimeError("hub down"))
j = client.post("/api/console/overlay", json={"verb": "expand"}).json()
ok(not j["ok"] and "hub down" in j["message"], "a hub failure is an answer, not a crash")
cc.WAKER = saved_waker

# a wake that reached nobody leaves a tappable console alert (AmberX's watch reads it), cleared on delivery
alerts: list[dict] = []
resolved: list[list[str]] = []
fake_cx = types.ModuleType("console_context")
fake_cx.raise_alert = lambda a: alerts.append(a) or {}
fake_cx.resolve_alerts = lambda k: resolved.append(k)
sys.modules["console_context"] = fake_cx
cc._fallback_alert("cq-1", "couldn't reach axHub")
ok(alerts[-1]["severity"] == "warning" and alerts[-1]["link"].endswith("/?axf-cmd=cq-1"), "the fallback alert is loud and opens the waiting command")
cc._fallback_clear()
eq(resolved[-1], [cc.FALLBACK_KEY], "and goes away once a console took it")
eq(cc._how({"picked": False, "wake": {"sent": True}}), "after reconnect", "the phone's yes alone is not a wake")
eq(cc._how({"picked": True, "wake": None}), "woke via AmberX", "the console that opened from the link is")

# ======================================================================== reliable delivery (console-commands-reliable, Nov 11 2026)
client.post("/api/console/settings", json={"wake": True, "ttlS": 120})
for gone in ("late-0001", "molly-0001", "woke-0001"):
    client.post("/api/console/bye", json={"client": gone})
cc.LIVE_TRY_S = 0.6


def sleepy_console(cid: str, got: list[dict]) -> threading.Thread:
    """A frozen phone tab: its stream stays open and receives, but it never runs or acks anything."""
    def loop() -> None:
        with client.stream("GET", f"/api/console/stream?client={cid}") as st:
            for line in st.iter_lines():
                if line.startswith("data: "):
                    got.append(json.loads(line[6:]))
    t = threading.Thread(target=loop, daemon=True)
    t.start()
    return t


def listed() -> list[str]:
    return [c["id"] for c in svc.run({"op": "list", "target": "console.clients"}, ["*"], "t")["items"]]


# a heartbeat from a console the server holds no catalog for (it restarted) asks it to say hello again
eq(client.post("/api/console/seen", json={"client": "fresh-0001"}).json().get("hello"), True, "seen without a catalog → hello: true")
client.post("/api/console/hello", json={"client": "fresh-0001", "catalog": CATALOG})
ok("hello" not in client.post("/api/console/seen", json={"client": "fresh-0001"}).json(), "after hello the beat is just a beat")
client.post("/api/console/bye", json={"client": "fresh-0001"})

# failover: the console used last is asleep (stream open, never answers) → the next live console gets it
awake_got: list[dict] = []
client.post("/api/console/hello", json={"client": "awake-0001", "catalog": CATALOG, "used": True})
fake_console("awake-0001", answers=awake_got)
wait_for(lambda: stream_open("awake-0001"))
time.sleep(0.02)
sleepy_got: list[dict] = []
client.post("/api/console/hello", json={"client": "sleep-0001", "device": "phone", "catalog": CATALOG, "used": True})
sleepy_console("sleep-0001", sleepy_got)
wait_for(lambda: stream_open("sleep-0001"))
j = client.post("/api/console/open", json={"screen": "plan studio"}).json()
eq(j["delivery"]["tried"], ["sleep-0001", "awake-0001"], f"the sleeping console first, then the next live one ({j.get('delivery')})")
eq((j["status"], j["delivery"]["how"], j["delivery"]["client"]), ("delivered", "after retry", "awake-0001"), "delivered after a retry, and says by whom")
ok(awake_got and awake_got[-1]["target"] == "plan-studio", "the awake console ran it")
ok(sleepy_got and sleepy_got[-1]["target"] == "plan-studio", "the sleeping console was sent it first")
ok("sleep-0001" not in listed(), "a console that didn't answer drops out of console.clients at once")
j = client.post("/api/console/open", json={"screen": "home"}).json()
eq((j["status"], j["delivery"]["how"], j["delivery"]["tried"]), ("delivered", "live", ["awake-0001"]), "the next command goes straight to the live console")
client.post("/api/console/seen", json={"client": "sleep-0001", "used": True})
ok("sleep-0001" in listed(), "a beat brings it back")

# the server's own keep-alive never counts as the console being alive
cc.KEEPALIVE_S = 0.1
with cc._lock:
    cc._clients["sleep-0001"]["lastSeen"] = cc._now() - cc.STALE_S - 5
    stale_at = cc._clients["sleep-0001"]["lastSeen"]
time.sleep(0.5)
with cc._lock:
    eq(cc._clients["sleep-0001"]["lastSeen"], stale_at, "keep-alives down a frozen tab's open stream don't make it live")
ok("sleep-0001" not in listed(), "so it stays out of console.clients")
cc.KEEPALIVE_S = 15.0

# nobody answers: a navigate-only command is queued and AmberX opens the console now; the answer says pending
client.post("/api/console/bye", json={"client": "awake-0001"})
client.post("/api/console/seen", json={"client": "sleep-0001", "used": True})
woken_before = len(WOKEN)
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, ["*"], "Amber", cc.OWNER, wait=1.0)
eq((r["ok"], r["status"], r["queued"], r["delivery"]["tried"]), (True, "pending", True, ["sleep-0001"]), f"truthful: pending, queued, who was tried ({r.get('delivery')})")
ok("not shown yet" in r["message"], f"the answer never says opened ({r['message']})")
ok(wait_for(lambda: len(WOKEN) > woken_before, 5), "AmberX asked to open the console straight after the tries")
ok(WOKEN[-1][0].endswith(f"?axf-cmd={r['delivery']['id']}"), "the wake link carries the queued command")
# the sleeping tab wakes in time and does it after all: its late ack settles the queued copy (it never runs twice)
mid = sleepy_got[-1]["id"]
eq(client.post("/api/console/ack", json={"client": "sleep-0001", "id": mid, "ok": True, "message": "opened Plan Studio"}).json().get("late"), True, "a late ack is recorded")
q = next(x for x in client.get("/api/console/queue").json()["items"] if x["id"] == r["delivery"]["id"])
eq(q["state"], "delivered", "the queued copy is settled by the late ack")
# a tab that skipped a command because it got it too late: not an answer
eq(client.post("/api/console/ack", json={"client": "sleep-0001", "id": "nope", "ok": False, "skipped": True}).json().get("skipped"), True, "a skipped ack is not counted")

# a command that changes data is never queued or re-sent when nobody answers
client.post("/api/console/seen", json={"client": "sleep-0001", "used": True})
before_q = len(client.get("/api/console/queue").json()["items"])
r = cc.run({"op": "act", "target": "console.actions", "path": "assets.random", "action": "run"}, ["*"], "Amber", cc.OWNER, wait=1.0)
eq((r["ok"], r["status"], r.get("queued")), (False, "failed", None), f"a data action nobody answered fails honestly ({r.get('message')})")
ok("not re-sent" in r["message"], "and says it was not re-sent")
eq(len(client.get("/api/console/queue").json()["items"]), before_q, "nothing queued for it")

# focus: a build id or a screen + tab opens the Build orchestrator on that build or tab
class FakeFocus:  # what the Build orchestrator provides as console-focus@1
    def resolve(self, path: str):  # type: ignore[no-untyped-def]
        if path.startswith("build:"):
            return {"screen": "build-orchestrator", "focus": path[6:], "explicit": True}
        if path in ("console-commands-reliable", "home"):
            return {"screen": "build-orchestrator", "focus": path, "explicit": False}
        return None


plugin_services.provide("console-focus@1", FakeFocus(), folder="build-orchestrator")
client.post("/api/console/bye", json={"client": "sleep-0001"})
client.post("/api/console/hello", json={"client": "awake-0001", "catalog": CATALOG, "used": True})
wait_for(lambda: stream_open("awake-0001"))
j = client.post("/api/console/open", json={"screen": "build:console-commands-reliable"}).json()
eq((j["status"], awake_got[-1]["target"], awake_got[-1].get("focus")), ("delivered", "build-orchestrator", "console-commands-reliable"), f"build:<id> → the orchestrator focused on it ({j.get('delivery')})")
j = client.post("/api/console/open", json={"screen": "console-commands-reliable"}).json()
eq((awake_got[-1]["target"], awake_got[-1].get("focus")), ("build-orchestrator", "console-commands-reliable"), "a bare build id too")
j = client.post("/api/console/open", json={"screen": "home"}).json()
eq((awake_got[-1]["target"], awake_got[-1].get("focus")), ("home", None), "an exact screen id wins over a build of the same name")
j = client.post("/api/console/open", json={"screen": "build-orchestrator pending"}).json()
eq((awake_got[-1]["target"], awake_got[-1].get("focus"), j.get("focus")), ("build-orchestrator", "pending", "pending"), "screen + tab")
j = svc.run({"op": "act", "target": "console.screens", "path": "build-orchestrator", "action": "open", "input": {"focus": "queue"}}, ["*"], "mcp")
eq(awake_got[-1].get("focus"), "queue", "input.focus")


# a second focus provider (console-focus@1/<part>) answers what the first doesn't: pass:<id> → its screen, focused
class FakePassFocus:  # what Token control provides as console-focus@1/pass (pass-approval@1)
    def resolve(self, path: str):  # type: ignore[no-untyped-def]
        return {"screen": "plan-studio", "focus": path, "explicit": True} if path.startswith("pass:") else None  # a screen this catalog has


plugin_services.provide("console-focus@1/pass", FakePassFocus(), folder="token-control")
j = client.post("/api/console/open", json={"screen": "pass:pass-mwgzzamc-9844d6"}).json()
eq((awake_got[-1]["target"], awake_got[-1].get("focus")), ("plan-studio", "pass:pass-mwgzzamc-9844d6"), "pass:<id> → the screen its provider names, focused on the pass")
j = client.post("/api/console/open", json={"screen": "build:console-commands-reliable"}).json()
eq(awake_got[-1]["target"], "build-orchestrator", "build:<id> still reaches its own provider")
# ---- screenshots (console.nav act screenshot): the console uploads a PNG, the answer carries it once with the screen state
cc.SHOT_DIR = Path(tempfile.mkdtemp()) / "shots"
PNG = b"\x89PNG\r\n\x1a\n" + b"\0" * 32
STATE = {"screen": "settings", "screenLabel": "Settings", "tabs": {"view:settings/tab:settings.tabs": "appearance"}, "dialog": "asset-json", "selection": "grid:queue/row:b1", "scroll": {"top": 120, "fraction": 0.25}}
shot_got: list[dict] = []
shot_mode = {"upload": True}


def shot_console(cid: str) -> None:
    """A console tab that answers screenshot commands: upload the PNG first, then ack with the screen state."""
    def loop() -> None:
        with client.stream("GET", f"/api/console/stream?client={cid}") as st:
            for line in st.iter_lines():
                if not line.startswith("data: "):
                    continue
                m = json.loads(line[6:])
                if m.get("$axf") == "console-hello@1":
                    client.post("/api/console/hello", json={"client": cid, "catalog": CATALOG})
                    continue
                shot_got.append(m)
                if m["op"] == "screenshot" and shot_mode.get("working"):
                    client.post("/api/console/seen", json={"client": cid, "working": m["id"]})
                if m["op"] == "screenshot" and shot_mode.get("delay"):
                    time.sleep(shot_mode["delay"])
                if m["op"] == "screenshot" and shot_mode["upload"]:
                    up = client.post(f"/api/console/shot?client={cid}&id={m['id']}", content=PNG, headers={"content-type": "image/png"})
                    shot_mode["upload_status"] = up.status_code
                client.post("/api/console/ack", json={"client": cid, "id": m["id"], "ok": True, "message": "captured the screen (800×600)",
                                                      "result": {"shot": True, "width": 800, "height": 600, "scale": 1, "capture": m.get("address") or m.get("selector") or "page", "state": STATE}})
    threading.Thread(target=loop, daemon=True).start()


client.post("/api/console/hello", json={"client": "shot-0001", "catalog": CATALOG, "used": True})
shot_console("shot-0001")
wait_for(lambda: stream_open("shot-0001"))
j = client.post("/api/console/screenshot", json={"address": "view:settings"}).json()
eq(shot_got[-1]["op"], "screenshot", "the console gets a screenshot command")
eq(shot_got[-1].get("address"), "view:settings", "with the address to capture")
eq(shot_mode.get("upload_status"), 200, "the console's upload is taken while the command is waited for")
eq(j.get("status"), "delivered", f"a screenshot that came back is delivered ({j.get('message')})")
import base64  # noqa: E402
eq(base64.b64decode(j["images"][0]["data"]), PNG, "the answer carries the PNG")
eq((j["images"][0]["client"], j["images"][0]["width"], j["images"][0]["mime"]), ("shot-0001", 800, "image/png"), "with its console, size and type")
eq(j["state"], STATE, "and the screen state: screen, tabs, dialog, selection, scroll")
eq(list(cc.SHOT_DIR.glob("*")), [], "the upload is deleted once the answer has read it")
r = client.post("/api/console/screenshot", json={"address": "view:settings", "selector": "#main"})
eq(r.status_code, 422, "a selector and an address together are refused")
j = svc.run({"op": "act", "target": "console.nav", "path": "here", "action": "screenshot", "input": {"selector": ".fx-dialog"}}, ["control.console.read"], "mcp")
ok(j["ok"] and shot_got[-1].get("selector") == ".fx-dialog" and j["images"], "a screenshot needs only control.console.read (read-only)")
j = svc.run({"op": "act", "target": "console.nav", "path": "here", "action": "screenshot"}, ["control.console.navigate"], "mcp")
eq(j.get("code"), "denied", "but it does need read: it shows what is on screen")
shot_mode["upload"] = False
j = client.post("/api/console/screenshot", json={}).json()
eq((j.get("status"), j.get("images")), ("failed", []), "an ack without an uploaded image is failed, not delivered")
shot_mode["upload"] = True
# a capture slower than one live try (LIVE_TRY_S): the console says it is working, the server waits for it
cc.SHOT_WORK_S = 4.0
shot_mode.update(working=True, delay=cc.LIVE_TRY_S * 2.5)
j = client.post("/api/console/screenshot", json={}).json()
eq((j.get("status"), (j.get("delivery") or {}).get("how")), ("delivered", "live"), f"a slow capture that said it is working is waited for ({j.get('message')})")
eq(base64.b64decode(j["images"][0]["data"]) if j.get("images") else b"", PNG, "and its image comes back")
ok(cc._live(cc._clients["shot-0001"]), "the working console is not marked asleep")
# the same slow capture without the working signal: the call moves on, the late ack still brings the image back
shot_mode.update(working=False)
with cc._lock:  # only this console is open (the earlier tests' fake consoles would take the queued copy)
    for c in cc._clients.values():
        if c["id"] != "shot-0001":
            c["lastSeen"] = 0.0
j = client.post("/api/console/screenshot", json={}).json()
eq(j.get("status"), "delivered", f"a late screenshot ack is delivered ({j.get('message')})")
eq(base64.b64decode(j["images"][0]["data"]) if j.get("images") else b"", PNG, "with its image (it used to come back without one)")
eq(list(cc.SHOT_DIR.glob("*.png")), [], "and the upload is read and deleted")
shot_mode.update(delay=0)
client.post("/api/console/seen", json={"client": "shot-0001", "used": True})
eq(client.post("/api/console/shot?client=shot-0001&id=cc-nobody", content=PNG).status_code, 409, "an upload nobody waits for is refused")
eq(client.post("/api/console/shot?client=nobody-001&id=cc-1", content=PNG).status_code, 404, "an upload from an unknown console is refused")
eq(client.post("/api/console/shot?client=shot-0001&id=cc-1", content=PNG, headers={"x-user": "sam"}).status_code, 404, "someone else can't upload for Brett's console")
try:
    cc.save_shot("cc-x", "shot-0001", b"GIF89a")
    ok(False, "a non-PNG upload raises")
except cc.HTTPException as e:
    eq(e.status_code, 415, "a screenshot must be a PNG")
try:
    cc.save_shot("cc-x", "shot-0001", PNG + b"\0" * cc.SHOT_MAX_BYTES)
    ok(False, "an oversized upload raises")
except cc.HTTPException as e:
    eq(e.status_code, 413, "a screenshot over the byte limit is refused")
eq(cc.save_shot("cc-old", "shot-0001", PNG), len(PNG), "an upload is kept until read")
old_f = cc._shot_file("cc-old", "shot-0001")
os.utime(old_f, (time.time() - cc.SHOT_TTL_S - 5,) * 2)
eq(cc.sweep_shots(), 1, "an upload nobody read is swept after the TTL")
ok(not old_f.exists(), "and is gone")
ok(oct(cc.SHOT_DIR.stat().st_mode & 0o777) == "0o700", "the temp folder is private to the server")

print(f"✓ console commands server — {checks} checks", flush=True)
os._exit(0)  # the fake consoles' streams are still open
