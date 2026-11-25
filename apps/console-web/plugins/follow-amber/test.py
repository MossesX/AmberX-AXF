"""Follow Amber server part: the switch, show (off = nothing opens; on = Console commands opens it with the navigate
grant only, then the follow streams get the highlight), approval pop-up frames, owner only, the capability.

    python apps/console-web/plugins/follow-amber/test.py
"""
from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services
os.environ["AXF_FOLLOW_AMBER_DATA_DIR"] = tempfile.mkdtemp()

import importlib.util  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


# A fake Console commands (console-commands@1): records what it was asked, knows two screens and one settings tab.
class FakeConsole:
    def __init__(self) -> None:
        self.calls: list[tuple[dict, list[str], str]] = []

    def run(self, command: dict, grants: list[str] | None = None, by: str = "", audience: str = "owner") -> dict:
        self.calls.append((command, list(grants or []), by))
        target, path = command.get("target"), str(command.get("path"))
        if "control.console.write" not in (grants or []) and target == "console.actions" and path == "builds.delete":
            return {"ok": False, "code": "denied", "message": "act console.actions needs control.console.write"}
        known = {"console.screens": {"plan studio": "Plan Studio", "builds": "Builds"}, "console.settings": {"follow amber": "Follow Amber"}, "console.actions": {"builds.open": "Open builds"}}
        if path == "offline":
            return {"ok": False, "code": "not_found", "message": "no console is open for you right now: open the Dev Console"}
        if path == "queued":
            return {"ok": True, "queued": True, "delivery": {"how": "queued", "id": "cq-1"}, "message": "queued, not open yet"}
        if path == "asleep":  # the real Console commands: tried every live console, queued, woke one; says pending
            return {"ok": True, "queued": True, "status": "pending", "delivered": [{"client": "cc-1", "ok": False, "pending": True}], "delivery": {"how": "queued", "id": "cq-9", "tried": ["cc-1"]}, "message": "not shown yet: no open console answered"}
        if path == "build-orchestrator" and (command.get("input") or {}).get("focus"):
            return {"ok": True, "status": "delivered", "item": {"label": "Build orchestrator"}, "focus": command["input"]["focus"], "delivered": [{"client": "cc-abc123", "ok": True, "message": "opened Build orchestrator"}], "delivery": {"how": "live", "tried": ["cc-abc123"]}}
        if path.startswith("build:"):
            return {"ok": True, "status": "delivered", "item": {"label": "Build orchestrator"}, "focus": path[6:], "delivered": [{"client": "cc-abc123", "ok": True, "message": "opened Build orchestrator"}], "delivery": {"how": "after retry", "tried": ["cc-1", "cc-abc123"]}}
        if path == "frozen":
            return {"ok": True, "item": {"label": "Frozen"}, "delivered": [{"client": "cc-1", "ok": False, "pending": True, "message": "sent; the console didn't answer yet"}]}
        label = known.get(target, {}).get(path.lower())
        if not label:
            return {"ok": False, "code": "not_found", "message": f"no {target} named {path}"}
        return {"ok": True, "item": {"label": label}, "delivered": [{"client": "cc-abc123", "ok": True, "message": f"opened {label}"}]}


    def queue_for_owner(self, command: dict, grants: list[str], by: str = "") -> dict:
        self.queued.append(command)
        return {"id": "cq-2", "expiresAt": "later"}


fake = FakeConsole()
fake.queued = []
plugin_services.provide("console-commands@1", fake, folder="console-commands")

spec = importlib.util.spec_from_file_location("follow_amber_server", HERE / "server" / "__init__.py")
fa = importlib.util.module_from_spec(spec)
spec.loader.exec_module(fa)  # type: ignore[union-attr]

app = FastAPI()
ROLE: dict[str, object] = {"user": None}


@app.middleware("http")
async def who(request: Request, call_next):  # the console's auth sets request.state.axf_user; None = the console token
    request.state.axf_user = ROLE["user"]
    return await call_next(request)

app.include_router(fa.router, prefix="/api/plugins/follow-amber")
c = TestClient(app)
P = "/api/plugins/follow-amber"

# ---------------------------------------------------------------- off by default: nothing opens
s = c.get(f"{P}/state").json()
ok(s["ok"] and s["on"] is False, "Follow Amber starts off")
r = c.post(f"{P}/show", json={"target": "plan studio", "say": "here's the plan"}).json()
ok(r["ok"] and r["shown"] is False and r["follow"] is False, "switch off: show answers shown false")
ok(not fake.calls, "switch off: nothing was sent to any console")
r = c.post(f"{P}/approval", json={"id": "x"}).json()
ok(r["ok"] and r["shown"] is False, "switch off: no approval pop-up")

# ---------------------------------------------------------------- a follow stream hears frames
frames: list[dict] = []
loop = asyncio.new_event_loop()
q: asyncio.Queue = asyncio.Queue()
fa._clients["fa-test0001"] = {"queue": q, "loop": loop, "since": 0}


def drain() -> list[dict]:
    loop.run_until_complete(asyncio.sleep(0))
    out = []
    while not q.empty():
        out.append(q.get_nowait())
    return out

# ---------------------------------------------------------------- switching
r = c.post(f"{P}/state", json={"on": True, "by": "Brett"}).json()
ok(r["on"] is True and r["by"] == "Brett" and r["at"], "switched on, by and when recorded")
ok(json.loads((Path(os.environ["AXF_FOLLOW_AMBER_DATA_DIR"]) / "state.json").read_text())["on"] is True, "kept in the data folder")
got = drain()
ok(got and got[-1]["type"] == "state" and got[-1]["on"] is True and got[-1]["$axf"] == "follow-amber@1", "every follow stream hears the switch")
ok(c.post(f"{P}/state", json={"on": "yes"}).status_code == 400, "on must be a boolean")

# ---------------------------------------------------------------- show: open through Console commands, navigate only
r = c.post(f"{P}/show", json={"target": "plan studio", "highlight": "h1", "say": "here's the plan"}).json()
ok(r["ok"] and r["shown"] is True and r["kind"] == "screen" and r["label"] == "Plan Studio", "a screen opens")
cmd, grants, by = fake.calls[-1]
ok(cmd["target"] == "console.screens" and cmd["action"] == "open" and cmd["path"] == "plan studio", "sent as console.screens open")
ok(grants == ["control.console.navigate"], "with the navigate grant only (nothing that changes data can run)")
ok("input" not in cmd, "to the console used last by default")
got = drain()
ok(got and got[-1]["type"] == "show" and got[-1]["highlight"] == "h1" and got[-1]["say"] == "here's the plan" and got[-1]["label"] == "Plan Studio", "the follow streams get the highlight and what Amber said")

n = len(fake.calls)
r = c.post(f"{P}/show", json={"target": "follow amber"}).json()
ok(r["ok"] and r["kind"] == "settings", "a bare name not a screen falls through to settings tabs")
ok([x[0]["target"] for x in fake.calls[n:]] == ["console.screens", "console.settings"], "tried screen, then settings")
r = c.post(f"{P}/show", json={"target": "settings:follow amber"}).json()
ok(r["ok"] and fake.calls[-1][0]["target"] == "console.settings", "kind:name goes straight to that kind")
r = c.post(f"{P}/show", json={"target": "nothing like it"}).json()
ok(r["ok"] is False and r["shown"] is False and r["tried"] == ["screen", "settings", "dialog"], "unknown: tried every kind, nothing shown")
r = c.post(f"{P}/show", json={"target": "offline"}).json()
ok(r["ok"] is False and r["tried"] == ["screen"] and r["target"] == "offline", "no console open: one try, said plainly")
r = c.post(f"{P}/show", json={"target": "action:builds.open"}).json()
ok(r["ok"] and fake.calls[-1][0]["action"] == "run", "a navigation action runs")
r = c.post(f"{P}/show", json={"target": "action:builds.delete"}).json()
ok(r["ok"] is False and r["code"] == "denied", "an action that changes data is refused (navigate grant only)")
r = c.post(f"{P}/show", json={"target": "builds", "to": "all"}).json()
ok(fake.calls[-1][0]["input"] == {"to": "all"}, "to=all reaches every console")
ok(c.post(f"{P}/show", json={}).json()["code"] == "invalid", "a target is needed")
ok(c.post(f"{P}/show", json={"target": "x", "kind": "nuke"}).json()["code"] == "invalid", "unknown kinds refused")

# ---------------------------------------------------------------- approvals: the pop-up frame
drain()
r = c.post(f"{P}/approval", json={"id": "11111111-1111-4111-8111-111111111111", "say": "restart needs you"}).json()
ok(r["ok"] and r["shown"] is True and r["consoles"] == 1, "on: the following consoles are told")
got = drain()
ok(got and got[-1]["type"] == "approval" and got[-1]["id"].startswith("1111") and got[-1]["say"] == "restart needs you", "an approval frame names the call")
r = c.post(f"{P}/show", json={"target": "approval:abc"}).json()
ok(r["ok"] and r["kind"] == "approval" and drain()[-1]["type"] == "approval", "show approval:<id> pops it up too")

# ---------------------------------------------------------------- a call an approval pass covers: no notice
class FakeControl:
    """control@1 as Token control provides it: which pass covers a call, and the pass setting quietNotice."""
    quiet = False
    broken = False

    def pass_covering(self, call: str, irreversible: bool = False):
        if self.broken:
            raise RuntimeError("the pass store can't be read")
        return None if irreversible or call == "axhub.pass_grant" else {"id": "pass-abc", "scope": "all", "expiresAt": "later"}

    def pass_quiet_notice(self) -> bool:
        return self.quiet


drain()
r = c.post(f"{P}/approval", json={"id": "v1", "call": "vps.run"}).json()
ok(r["shown"] is True and drain()[-1]["type"] == "approval", "no pass plugin: a named call pops up as before")
control = FakeControl()
plugin_services.provide("control@1", control, folder="token-control")
for call in ("vps.run", "console.console_terminal_sessions_stop"):
    r = c.post(f"{P}/approval", json={"id": "v2", "call": call, "say": "needs you"}).json()
    ok(r["ok"] and r["shown"] is False and r["ranUnder"] == "pass-abc" and r["quiet"] is False, f"{call} under a pass: no approval pop-up, the answer names the pass")
ok(drain() == [], "a covered call sends no frame at all")
ok(fa.FollowAmber().approval("v2", call="vps.run")["ranUnder"] == "pass-abc", "the capability asks the pass too")
r = c.post(f"{P}/approval", json={"id": "v3"}).json()
ok(r["shown"] is True and drain()[-1]["type"] == "approval", "a call nobody named is not covered: it pops up")
r = c.post(f"{P}/approval", json={"id": "v4", "call": "vps.run", "irreversible": True}).json()
ok(r["shown"] is True and "ranUnder" not in r and drain()[-1]["type"] == "approval", "a call the pass doesn't cover pops up")
control.broken = True
r = c.post(f"{P}/approval", json={"id": "v5", "call": "vps.run"}).json()
ok(r["shown"] is True and drain()[-1]["type"] == "approval", "a pass check that fails never hides a waiting call")
control.broken = False
control.quiet = True
r = c.post(f"{P}/approval", json={"id": "v6", "call": "vps.run", "say": "rm -rf /tmp/x"}).json()
got = drain()
ok(r["shown"] is False and r["quiet"] is True and len(got) == 1 and got[0]["type"] == "pass-run", "quietNotice on: one quiet line, still no approval pop-up")
ok(got[0]["call"] == "vps.run" and got[0]["pass"] == "pass-abc" and "say" not in got[0] and "id" not in got[0], "the quiet line carries the tool and the pass id only")
control.quiet = False

recent = c.get(f"{P}/recent").json()["items"]
ok(recent and recent[0]["target"] == "abc" and len(recent) >= 5, "what was shown is listed")

# ---------------------------------------------------------------- owner only
ROLE["user"] = types.SimpleNamespace(name="sam", admin=False, perms=(), role="viewer")
ok(c.get(f"{P}/state").status_code == 403 and c.post(f"{P}/show", json={"target": "builds"}).status_code == 403, "a hub user who isn't an admin gets 403")
ROLE["user"] = types.SimpleNamespace(name="brett", admin=True, perms=(), role="admin")
ok(c.get(f"{P}/state").status_code == 200, "a hub admin is the owner")
ROLE["user"] = None

# ---------------------------------------------------------------- the capability (what console_show / console_follow call)
svc = plugin_services.get("follow-amber@1")
ok(svc is not None and svc.state()["on"] is True and svc.state()["clients"] == 1, "follow-amber@1 state")
# never "opened" for what isn't on screen (build ui-review-notify-session-audio)
r = fa.show("screen:queued")
ok(r["ok"] and r["shown"] is False and r["queued"] is True and "opened" not in r["message"], f"queued: not shown, says so ({r})")
r = fa.show("screen:frozen")
ok(r["ok"] and r["shown"] is False and r["queued"] is True and len(fake.queued) == 1, f"a console that never answered: queued for the next one ({r})")

# console-commands-reliable (Nov 11 2026): the status Console commands answers is passed on as is
q_before = len(fake.queued)
r = fa.show("screen:asleep")
ok(r["ok"] and r["shown"] is False and r["status"] == "pending" and r["delivery"]["tried"] == ["cc-1"] and len(fake.queued) == q_before, f"pending stays pending, no second queue ({r})")
r = fa.show("build:console-commands-reliable")
ok(fake.calls[-1][0]["target"] == "console.screens" and fake.calls[-1][0]["path"] == "build:console-commands-reliable", "build:<id> goes to Console commands as a screen command")
ok(r["shown"] and r["status"] == "delivered" and r["focus"] == "console-commands-reliable" and "on console-commands-reliable" in r["message"], f"a build is shown, focused ({r})")
r = fa.show("console-commands-reliable", kind="build")
ok(fake.calls[-1][0]["path"] == "build:console-commands-reliable", "kind=build too")
r = svc.show("build-orchestrator", focus="pending")
ok(fake.calls[-1][0].get("input") == {"focus": "pending"} and r["focus"] == "pending", f"focus reaches the console command ({fake.calls[-1][0]})")

ok(svc.show("plan studio")["shown"] is True, "follow-amber@1 show")
c.post(f"{P}/state", json={"on": False})
n = len(fake.calls)
ok(svc.show("plan studio")["shown"] is False and len(fake.calls) == n, "switched off again: nothing opens")

# ---------------------------------------------------------------- the paired phone follows too (axf.phone@1)
check_addr = [(("screen", "plan-studio", {"id": "plan-studio"}), "view:plan-studio"), (("screen", "plan studio", {}), ""),
              (("screen", "build:x", {"id": "build-orchestrator"}), "view:build-orchestrator"), (("screen", "build:x", {}), ""),
              (("settings", "appearance", {"id": "appearance"}), "view:settings/tab:settings.tabs=appearance"),
              (("settings", "x", {"id": "follow-amber", "parent": "plugins"}), "view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=follow-amber"),
              (("settings", "plugins/follow-amber", {}), "view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=follow-amber"),
              (("approval", "0123abcd-0123-4abc-8def-0123456789ab", {}), "hub.review:0123abcd-0123-4abc-8def-0123456789ab"),
              (("dialog", "about", {"id": "about"}), ""), (("action", "builds.open", {"id": "builds.open"}), ""), (("screen", "a?b=c", {}), "")]
for args, want in check_addr:
    ok(fa.phone_address(*args) == want, f"phone address of {args[0]} {args[1]!r} = {want!r} (got {fa.phone_address(*args)!r})")


class FakePhone:
    def __init__(self) -> None:
        self.asked: list[tuple[str, dict]] = []

    def follow(self, address: str, *, by: dict | None = None) -> dict:
        self.asked.append((address, by or {}))
        return {"ok": True, "shown": True, "id": "cmd-1", "url": "https://console.test/?axf-open=" + address, "message": "the phone is opening the console there"}


phone = FakePhone()
known_item = fake.run
fake.run = lambda command, grants=None, by="", audience="owner": {**known_item(command, grants, by, audience), **({"item": {"label": "Plan Studio", "id": "plan-studio"}} if str(command.get("path")).lower() == "plan studio" else {})}  # type: ignore[method-assign]
c.post(f"{P}/state", json={"on": True})
ok("phone" not in svc.show("plan studio"), "no phone plugin: the show is as before")
plugin_services.provide("axf.phone@1", phone, folder="some-phone-plugin")
r = svc.show("plan studio", by="amber (mcp)")
ok(r["shown"] and phone.asked == [("view:plan-studio", {"kind": "agent", "who": "amber (mcp)", "via": "console"})], f"a shown screen also opens on the phone ({phone.asked})")
ok(r["phone"] == {"ok": True, "shown": True, "message": "the phone is opening the console there"}, f"the answer says what the phone did ({r.get('phone')})")
n = len(phone.asked)
svc.show("builds.open", kind="action")
ok(len(phone.asked) == n, "an action never goes to the phone")
# console-open-no-reload (Nov 23 2026): the console inside the phone's app acked it (its ack carries `shell`) and came
# to the front itself; asking the phone to open the console there as well loaded the page again, at its home screen
in_app = fake.run
fake.run = lambda command, grants=None, by="", audience="owner": (lambda r: {**r, "delivered": [{**d, "shell": "console-droid", "surfaced": True} for d in r.get("delivered") or []]})(in_app(command, grants, by, audience))  # type: ignore[method-assign]
n = len(phone.asked)
r = svc.show("plan studio")
ok(r["shown"] and len(phone.asked) == n, f"shown by the phone app's own page: the phone is not asked to open it again ({phone.asked[n:]})")
ok(r["phone"]["shown"] is True and "no reload" in r["phone"]["message"], f"the answer says so ({r.get('phone')})")
fake.run = in_app  # type: ignore[method-assign]
ok(svc.phone("grid:queue/row:b1") == {"ok": True, "shown": True, "message": "the phone is opening the console there"} and phone.asked[-1][0] == "grid:queue/row:b1", "an address console_show opened itself reaches the phone too")
c.post(f"{P}/state", json={"on": False})
n = len(phone.asked)
ok(svc.show("plan studio")["shown"] is False and svc.phone("view:builds") is None and len(phone.asked) == n, "Follow Amber off: nothing goes to the phone")
phone.follow = lambda address, by=None: (_ for _ in ()).throw(RuntimeError("boom"))  # type: ignore[method-assign]
c.post(f"{P}/state", json={"on": True})
r = svc.show("plan studio")
ok(r["shown"] is True and r["phone"]["ok"] is False, "a phone that fails never stops the show")
plugin_services.withdraw("some-phone-plugin")
fake.run = known_item  # type: ignore[method-assign]

# ---------------------------------------------------------------- no Console commands: says so
plugin_services.provide("console-commands@1", None, folder="console-commands")
c.post(f"{P}/state", json={"on": True})
r = svc.show("plan studio")
ok(r["ok"] is False and r.get("code") == "not_implemented", "without Console commands: a clear not_implemented")

print(f"✓ follow amber server — {checks} checks")
