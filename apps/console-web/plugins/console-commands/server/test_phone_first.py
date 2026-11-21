"""Console commands with a paired phone (console jump-around fix, Nov 21 2026): every command for the console Brett is
using goes to the console on his phone, once.

  1. wrong target: an old browser tab never gets it; a console that stopped beating is off the client list
  2. jumping around: one command = one delivery = one bring-to-front; a newer open replaces one still on its way;
     nothing is replayed; after Brett leaves the app nothing pulls it back for a while
  3. no browser console needed: the phone brings the console to the front by itself (the console app's overlay
     first), no "tap to open" alert
  4. the whole address: the page the phone opens runs the whole command (screen + tab + focus), not a bare screen
  5. refresh: a page back from a reload is put back on its screen, tabs, focused item and selection

    python apps/console-web/plugins/console-commands/server/test_phone_first.py
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
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services
os.environ["AXF_CONSOLE_COMMANDS_DATA_DIR"] = tempfile.mkdtemp()

import importlib.util  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("console_commands_phone_first", HERE / "__init__.py")
cc = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(cc)
WOKEN: list[str] = []
cc.WAKE_AFTER_S = 0.2
cc.WAKER = lambda url, browser: (WOKEN.append(url), {"ok": True, "opened": True})[1]
cc.LIVE_TRY_S = 0.6
cc.PHONE_WAIT_S = 8.0

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # type: ignore[no-untyped-def]
    request.state.axf_user = types.SimpleNamespace(name="console", admin=True)
    return await call_next(request)


app.include_router(cc.router, prefix="/api/console")
client = TestClient(app)

CATALOG = {"app": "console-web", "items": [
    {"kind": "screen", "id": "home", "label": "Home"},
    {"kind": "screen", "id": "plan-studio", "label": "Plan Studio", "keywords": ["plans"]},
    {"kind": "screen", "id": "gate", "label": "Gate & rules"},
    {"kind": "settings", "id": "appearance", "label": "Appearance"},
    {"kind": "action", "id": "terminal.open", "label": "Open output terminal"},
    {"kind": "action", "id": "assets.random", "label": "Randomize assets", "requires": "assets.swap"},
], "here": {"screen": "home"}}


def wait_for(cond, timeout: float = 10.0) -> bool:  # type: ignore[no-untyped-def]
    end = time.time() + timeout
    while time.time() < end:
        if cond():
            return True
        time.sleep(0.02)
    return bool(cond())


class Page:
    """A console page: says hello (on the phone or not, opened for a queued command or not), keeps its stream open and
    acks what it runs. `asleep`: the stream is open but it never answers (a frozen tab)."""

    def __init__(self, cid: str, phone: bool, pick: str = "", front: bool = True, asleep: bool = False, into: list | None = None) -> None:
        self.cid, self.phone, self.got = cid, phone, []
        self.asleep = asleep
        if into is not None:
            into.append(self)
        body = {"client": cid, "device": "phone" if phone else "desktop", "catalog": CATALOG, "here": {"screen": "home"}, "front": front, "used": True,
                **({"phone": True} if phone else {}), **({"pick": pick} if pick else {})}
        assert client.post("/api/console/hello", json=body).json()["ok"]
        threading.Thread(target=self._loop, daemon=True).start()
        assert wait_for(lambda: (cc._clients.get(cid) or {}).get("queue") is not None)

    def _loop(self) -> None:
        with client.stream("GET", f"/api/console/stream?client={self.cid}") as s:
            for line in s.iter_lines():
                if not line.startswith("data: "):
                    continue
                m = json.loads(line[6:])
                if "id" not in m:
                    continue
                if any(x["id"] == m["id"] for x in self.got):  # the page's own dedupe (sessionStorage): acked again, never run twice
                    client.post("/api/console/ack", json={"client": self.cid, "id": m["id"], "ok": True, "message": "already done"})
                    continue
                self.got.append(m)
                if not self.asleep:
                    client.post("/api/console/ack", json={"client": self.cid, "id": m["id"], "ok": True, "message": f"ran {m.get('op')} {m.get('target', '')}".strip(),
                                                         **({"result": {"$axf": "console-control@1", "ok": True, "verb": m["command"]["verb"], "state": {"screen": "gate"}}} if m.get("op") == "control" else {})})

    def beat(self, **more: object) -> None:
        client.post("/api/console/seen", json={"client": self.cid, **({"phone": True} if self.phone else {}), **more})


class Phone:
    """A paired, online phone (axf.phone@1). Asked to open a page, it does what Phone Connect does: the console app's
    overlay loads it, and that page says hello for the command it carries."""

    def __init__(self) -> None:
        self.sent: list[dict] = []
        self.pages: list[Page] = []
        self.online = True
        self.opens = True
        self.how = "console-overlay"

    def available(self) -> bool:
        return self.online

    def status(self) -> dict:
        return {"ok": True, "features": {"follow": True}}

    def send(self, command: str, arguments: dict | None = None, **_: object) -> dict:
        self.sent.append({"command": command, **(arguments or {})})
        if self.opens:
            pick = parse_qs(urlsplit(arguments["url"]).query).get("axf-cmd", [""])[0]
            threading.Timer(0.15, lambda: Page(f"pc-page{len(self.pages):03d}", phone=True, pick=pick, into=self.pages)).start()
        return {"ok": True, "id": f"ph-{len(self.sent)}", "command": {"status": "queued"}}

    def command(self, cid: str) -> dict:
        return {"ok": True, "command": {"status": "done", "result": {"data": {"how": self.how}}}}


RAISED: list[dict] = []
sys.modules["console_context"] = types.SimpleNamespace(raise_alert=lambda a: RAISED.append(a), resolve_alerts=lambda keys: None)  # type: ignore[assignment]

phone = Phone()
plugin_services.provide("axf.phone@1", phone, folder="phone-under-test")

# ======================================================================== 1. the right target
desk = Page("desk-0001", phone=False)  # an old browser tab, live, in front, touched last
time.sleep(0.01)
mine = Page("pc-live001", phone=True)
desk.beat(used=True)  # the desk was touched after the phone: it would have won `recent`
r = client.post("/api/console/open", json={"screen": "plan studio", "by": "claude"}).json()
eq(r["status"], "delivered", f"delivered ({r})")
eq([d["client"] for d in r["delivered"]], ["pc-live001"], "the console on the phone gets it, not the browser tab used last")
ok(r["delivery"].get("phone") is True and r["delivery"]["how"] == "live", "down the phone's own stream (it is shown)")
eq(desk.got, [], "the old browser tab gets nothing")
eq(phone.sent, [], "a shown console on the phone is not brought to the front again")
r = client.post("/api/console/open", json={"screen": "gate", "to": "desk-0001"}).json()
ok(r["status"] == "delivered" and desk.got and desk.got[-1]["target"] == "gate", "a console Brett names still gets it")
j = client.get("/api/console/where").json()
eq(j["client"]["id"], "pc-live001", f"where reads the console on the phone ({j})")
# a console that stopped beating is off the list (it used to stay there for 3 minutes and win `recent`)
with cc._lock:
    cc._clients["desk-0001"]["lastSeen"] = time.time() - cc.STALE_S - 5
listed = [c["id"] for c in client.get("/api/console/clients").json()["items"]]
ok("desk-0001" not in listed and "pc-live001" in listed, f"a console with no heartbeat is dropped from the client list ({listed})")

# ======================================================================== 3 + 4. no console up: the phone brings it to the front, on the whole address
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0  # every console closed
cc.remember_catalog(cc.OWNER, CATALOG)
WOKEN.clear()
RAISED.clear()
r = client.post("/api/console/open", json={"screen": "build-rules", "by": "claude"}).json()
ok(r.get("code") == "not_found", f"a wrong name answers at once, checked against the last catalog, the phone untouched ({r})")
eq(phone.sent, [], "nothing was sent to the phone for it")
r = client.post("/api/console/settings", json={"tab": "appearance", "anchor": "setting:axf.display.fontScale", "by": "claude"}).json()
eq(r["status"], "delivered", f"no browser console needed: delivered on the phone ({r})")
eq(len(phone.sent), 1, "the phone was asked once")
asked = phone.sent[-1]
q = parse_qs(urlsplit(asked["url"]).query)
ok(asked["command"] == "open_url" and asked["where"] == "overlay" and asked["browser"] in ("chrome", "default"), f"the console app's overlay first, the browser only when it can't ({asked})")
ok(q.get("axf-cmd") and q.get("axf-via") == ["phone"] and "axf-open" not in q, f"the page opens for the whole queued command, not a bare screen address ({asked['url']})")
page = phone.pages[-1]
eq(len(page.got), 1, "the page the phone opened ran it once")
ok(page.got[0]["target"] == "appearance" and page.got[0]["anchor"] == "setting:axf.display.fontScale", f"with its tab and anchor ({page.got[0]})")
ok(r["delivery"]["how"] == "phone" and r["delivery"]["wake"]["phone"]["how"] == "console-overlay", f"the answer says how ({r['delivery']})")
eq(WOKEN, [], "no second wake through the old path")
eq([a for a in RAISED if "Tap to open" in a.get("title", "")], [], "no 'tap to open' alert")
# the screen's tab or item: the same message, focus and all
cc.focus_rewrite = lambda command, audience: command  # (no focus provider plugin here)
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
r = cc.run({"op": "act", "target": "console.screens", "path": "gate", "action": "open", "input": {"focus": "build-rules"}}, by="claude")
eq(r["status"], "delivered", f"open with a focus delivered ({r.get('message')})")
ok(phone.pages[-1].got[-1]["target"] == "gate" and phone.pages[-1].got[-1]["focus"] == "build-rules", f"Gate & rules opens on its Build rules tab ({phone.pages[-1].got[-1]})")
ok(phone.pages[-1].got[-1].get("delivery") in ("woke", "queued"), "marked as carried over, so the page never skips it as late")

# ======================================================================== 2. one delivery, one bring-to-front
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
n_sent, n_pages = len(phone.sent), len(phone.pages)
phone.opens = False  # the phone is slow to bring the page up: two opens arrive meanwhile
first: dict = {}
t = threading.Thread(target=lambda: first.update(cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, by="claude", wait=6)))
t.start()
assert wait_for(lambda: len(phone.sent) == n_sent + 1)
second: dict = {}
t2 = threading.Thread(target=lambda: second.update(cc.run({"op": "act", "target": "console.screens", "path": "gate", "action": "open"}, by="claude", wait=6)))
t2.start()
t.join(5)
eq(first.get("status"), "superseded", f"the earlier open gave way to the newer one ({first})")
eq(len(phone.sent), n_sent + 1, "the phone was not asked a second time")
pick = parse_qs(urlsplit(phone.sent[-1]["url"]).query)["axf-cmd"][0]
late_page = Page("pc-late001", phone=True, pick=pick)  # the page the first open asked for comes up
t2.join(8)
eq(second.get("status"), "delivered", f"the newer open is the one that runs ({second})")
eq([m["target"] for m in late_page.got], ["gate"], "the page opens one screen only: no bouncing between screens")
phone.opens = True
# a frozen console on the phone (stream open, never answers): brought to the front once, the command runs once
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
frozen = Page("pc-frozen1", phone=True, asleep=True)
n_sent = len(phone.sent)
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, by="claude")
eq(r["status"], "delivered", f"a frozen console on the phone: the page the phone opens runs it ({r.get('message')})")
eq(len(phone.sent), n_sent + 1, "one bring-to-front")
ok(len(frozen.got) == 1 and len(phone.pages[-1].got) == 1 and frozen.got[0]["id"] == phone.pages[-1].got[0]["id"], "one command id end to end (the page runs a copy only once)")
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = time.time() if c["id"] == "pc-frozen1" else 0.0  # only the frozen console is up
r = cc.run({"op": "act", "target": "console.actions", "path": "assets.random", "action": "run"}, by="claude")
ok(r["status"] == "failed" and "not re-sent" in r["message"], f"a command that changes data is never re-sent to the phone ({r.get('message')})")
eq(len(phone.sent), n_sent + 1, "and the phone is not asked for it")
# Brett leaves the app (Back / Home / Recents): nothing pulls it back for a while
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
shown = Page("pc-shown01", phone=True)
shown.beat(front=False)
ok(cc.away_for(cc.OWNER) > 0, "leaving the app is noticed")
n_sent, n_got = len(phone.sent), len(shown.got)
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, by="claude")
ok(r["ok"] and r["status"] == "held" and "left" in r["message"], f"held, not pulled back ({r.get('message')})")
ok(len(phone.sent) == n_sent and len(shown.got) == n_got, "nothing sent, nothing queued to run later")
eq(cc.queued_for(cc.OWNER) and [e for e in cc.queued_for(cc.OWNER) if e["state"] == "queued"], [], "nothing waits to replay when he comes back")
shown.beat(front=True, used=True)
eq(cc.away_for(cc.OWNER), 0.0, "back in the app: the back-off ends")
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, by="claude")
ok(r["status"] == "delivered" and shown.got[-1]["target"] == "plan-studio", "and the next open lands on the shown console")
r = cc.run({"op": "act", "target": "console.screens", "path": "gate", "action": "open"}, by="claude", pull=False)
ok(r["status"] == "delivered", "a show that may not pull still reaches a console that is already shown")
shown.beat(front=False)
cc._left.clear()
r = cc.run({"op": "act", "target": "console.screens", "path": "gate", "action": "open"}, by="claude", pull=False)
ok(r["status"] == "held" and "Follow" in r["message"], f"the phone's Follow switch off: never brought forward ({r.get('message')})")

# ======================================================================== console-control@1 (console_control_*): the phone too
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
cc._left.clear()
up = Page("pc-ctl0001", phone=True)
desk2 = Page("desk-0002", phone=False)
desk2.beat(used=True)
r = cc.control({"verb": "focus", "address": "view:gate/tab:gate.tabs=build-rules"}, by="mcp")
ok(r["ok"] and r["client"] == "pc-ctl0001" and r["delivery"].get("phone"), f"console_control_focus lands on the phone, not the desk ({r})")
eq(desk2.got, [], "the desk gets nothing")
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
n_sent = len(phone.sent)
r = cc.control({"verb": "focus", "address": "view:gate/tab:gate.tabs=build-rules"}, by="mcp")
ok(r["ok"] and len(phone.sent) == n_sent + 1 and phone.pages[-1].got[-1]["op"] == "control", f"no console up: the phone brings it forward on the command ({r})")
r = cc.control({"verb": "state"}, by="mcp")
ok(phone.pages[-1].got[-1]["command"]["verb"] == "state" and len(phone.sent) == n_sent + 1, "a read goes to the console on the phone and never brings it forward")
r = cc.control({"verb": "focus", "address": "view:gate"}, by="mcp", to="desk-0002")
ok(r["client"] == "desk-0002", "a console Brett names still gets it")

# ======================================================================== no phone paired: the consoles as before
phone.online = False
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
d3 = Page("desk-0003", phone=False)
n_sent = len(phone.sent)
r = cc.run({"op": "act", "target": "console.screens", "path": "plan studio", "action": "open"}, by="claude")
ok(r["status"] == "delivered" and r["delivered"][0]["client"] == "desk-0003" and len(phone.sent) == n_sent, "no phone: the browser console used last, as before")
phone.online = True

# ======================================================================== 5. back from a reload on the same screen
was = {"screen": "plan-studio-2", "screenLabel": "Plan Studio 2.0", "tabs": {"view:plan-studio-2/tab:plan-studio-2.tabs": "tree"}, "selection": "row:plan/item:abc",
       "focus": {"screen": "plan-studio-2", "focus": "build-now-nfun"}}
j = client.post("/api/console/hello", json={"client": "pc-reload1", "phone": True, "catalog": CATALOG, "here": {"screen": "home"}, "reloaded": True, "was": was}).json()
msgs = j.get("restore") or []
eq([m["op"] for m in msgs], ["control", "run", "control", "control"], f"screen, its focused plan, its tab, its selection ({msgs})")
eq(msgs[0]["command"], {"verb": "open", "address": "view:plan-studio-2"}, "the same screen")
eq(msgs[1]["spec"], "plan-studio-2.focus:build-now-nfun", "the same focused item")
eq(msgs[2]["command"], {"verb": "open", "address": "view:plan-studio-2/tab:plan-studio-2.tabs=tree"}, "the same tab")
eq(msgs[3]["command"], {"verb": "focus", "address": "row:plan/item:abc"}, "the same selection")
ok(all(m["$axf"] == "console-command@1" and m["id"].startswith("rs-") for m in msgs), "plain console-command@1 messages the page runs like any other")
j = client.post("/api/console/hello", json={"client": "pc-reload2", "phone": True, "catalog": CATALOG, "here": {"screen": "home"}, "reloaded": True, "was": was, "pick": "cq-x"}).json()
ok("restore" not in j, "a page opened for a command goes where the command says")
j = client.post("/api/console/hello", json={"client": "pc-reload3", "catalog": CATALOG, "here": {"screen": "gate"}, "reloaded": True, "was": {"screen": "gate"}}).json()
ok("restore" not in j, "already there: nothing to do")
j = client.post("/api/console/hello", json={"client": "pc-reload4", "catalog": CATALOG, "here": {"screen": "home"}}).json()
ok("restore" not in j, "a fresh page (not a reload) starts where it starts")
client.post("/api/console/seen", json={"client": "pc-reload4", "here": {"screen": "gate", "tabs": {"view:gate/tab:gate.tabs": "build-rules"}}})
j = client.post("/api/console/hello", json={"client": "pc-reload4", "catalog": CATALOG, "here": {"screen": "home"}, "reloaded": True}).json()
eq([m.get("command", {}).get("address") for m in j.get("restore") or []], ["view:gate", "view:gate/tab:gate.tabs=build-rules"], f"no place from the page: the server's own copy ({j})")
j = client.post("/api/console/hello", json={"client": "pc-reload5", "catalog": CATALOG, "here": {"screen": "home"}, "reloaded": True, "was": {"screen": "a b?c"}}).json()
ok("restore" not in j, "a place that isn't a screen id is ignored")
# the refresh command itself reaches the console on the phone once
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
cc._left.clear()
rp = Page("pc-refresh", phone=True)
r = client.post("/api/console/refresh", json={"by": "claude"}).json()
ok(r["status"] == "delivered" and [m["op"] for m in rp.got] == ["refresh"], f"console_refresh: one reload on the console on the phone ({r})")

rp.beat(front=False)
cc._left.clear()
n_sent = len(phone.sent)
r = client.post("/api/console/refresh", json={"by": "claude"}).json()
ok(r["status"] == "delivered" and [m["op"] for m in rp.got] == ["refresh", "refresh"] and len(phone.sent) == n_sent,
   f"the console on the phone is hidden: reloaded down its own stream, never brought forward on a fresh page that would lose its place ({r})")
with cc._lock:
    for c in cc._clients.values():
        c["lastSeen"] = 0.0
r = client.post("/api/console/back", json={"by": "claude"}).json()
ok(r["ok"] and r["status"] == "held" and len(phone.sent) == n_sent, f"nothing open on the phone: back has nothing to move and brings nothing forward ({r})")

plugin_services.withdraw("phone-under-test")
print(f"✓ console commands with the phone first — {checks} checks", flush=True)
