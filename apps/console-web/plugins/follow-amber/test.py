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
        label = known.get(target, {}).get(path.lower())
        if not label:
            return {"ok": False, "code": "not_found", "message": f"no {target} named {path}"}
        return {"ok": True, "item": {"label": label}, "delivered": [{"client": "cc-abc123", "ok": True, "message": f"opened {label}"}]}


fake = FakeConsole()
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
ok(svc.show("plan studio")["shown"] is True, "follow-amber@1 show")
c.post(f"{P}/state", json={"on": False})
n = len(fake.calls)
ok(svc.show("plan studio")["shown"] is False and len(fake.calls) == n, "switched off again: nothing opens")

# ---------------------------------------------------------------- no Console commands: says so
plugin_services.provide("console-commands@1", None, folder="console-commands")
c.post(f"{P}/state", json={"on": True})
r = svc.show("plan studio")
ok(r["ok"] is False and r.get("code") == "not_implemented", "without Console commands: a clear not_implemented")

print(f"✓ follow amber server — {checks} checks")
