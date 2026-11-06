"""UI shortcuts server part: the registry (the real apps' ui-registry assets through the CLI), list / search / get, say and
open through a fake console-commands@1 (navigate grants for screens, the caller's grants for a data-changing action),
user shortcuts (add by words, match, remove, owner only), live items from an open console winning and expiring, the
voice-command@1 projection, recent, the capability.
    python apps/console-web/plugins/ui-shortcuts/test.py
"""
from __future__ import annotations

import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services
os.environ["AXF_UI_SHORTCUTS_DATA_DIR"] = tempfile.mkdtemp()
import importlib.util  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


class FakeConsole:
    """console-commands@1: records every command and the grants it came with."""

    def __init__(self) -> None:
        self.calls: list[tuple[dict, list[str], str]] = []

    def run(self, command: dict, grants: list[str] | None = None, by: str = "", audience: str = "owner") -> dict:
        self.calls.append((command, list(grants or []), by))
        if command.get("target") == "console.actions" and command.get("path") == "plan.delete" and "*" not in (grants or []):
            return {"ok": False, "code": "denied", "message": "act console.actions needs control.console.delete"}
        return {"ok": True, "message": f"opened {command.get('path')}", "delivery": {"how": "live"}}


spec = importlib.util.spec_from_file_location("ui_shortcuts_server", HERE / "server" / "__init__.py")
us = importlib.util.module_from_spec(spec)
assert spec and spec.loader
spec.loader.exec_module(us)
fake = FakeConsole()
plugin_services.provide("console-commands@1", fake, folder="console-commands")

app = FastAPI()


class User:
    def __init__(self, name: str, admin: bool, perms: tuple[str, ...] = ()) -> None:
        self.name, self.admin, self.perms, self.role = name, admin, perms, "viewer"


@app.middleware("http")
async def who(request: Request, call_next):  # type: ignore[no-untyped-def]
    h = request.headers.get("x-test-user", "")
    request.state.axf_user = None if not h else User(h, h == "admin", ("control.console.navigate",) if h != "admin" else ())
    return await call_next(request)


app.include_router(us.router, prefix="/api/plugins/ui-shortcuts")
c = TestClient(app)
P = "/api/plugins/ui-shortcuts"

# ---- the registry (the real apps' assets through the CLI)
r = c.get(f"{P}/registry").json()
ok(r["ok"] and r["items"] > 500, f"registry lists the apps' items ({r['items']})")
ok(any(a["app"] == "axf-console-web" for a in r["apps"]), "the console is one of the apps")
ok(any(a["app"] == "amberx-droid" for a in r["apps"]) and any(a["app"] == "molly" for a in r["apps"]), "AmberX and Molly are registered too")

# ---- list / search / get
items = c.get(f"{P}/items", params={"q": "plan studio", "limit": 5}).json()["items"]
ok(items and items[0]["id"] in ("screen:plan-studio", "menu-item:builds/plan-studio", "nav-item:plan-studio"), f"search finds Plan Studio ({items[0]['id'] if items else None})")
ok(all("score" in i for i in items), "search hits carry a score")
screens = c.get(f"{P}/items", params={"kind": "screen", "app": "axf-console-web", "limit": 1000}).json()["items"]
ok(len(screens) >= 50 and all(i["kind"] == "screen" for i in screens), f"list filters by kind + app ({len(screens)} console screens)")
g = c.get(f"{P}/item", params={"id": "screen:plan-studio"}).json()
eq(g["item"]["id"], "screen:plan-studio", "get by id")
eq(g["command"]["target"], "console.screens", "get gives the console command")
g2 = c.get(f"{P}/item", params={"id": "orkestrator"}).json()
eq(g2["item"]["id"], "screen:build-orchestrator", "get by a misheard name (fuzzy)")
eq(c.get(f"{P}/item", params={"id": "zzzz nothing"}).status_code, 404, "unknown item → 404")

# ---- say → open (navigate grants only)
s = c.post(f"{P}/say", json={"text": "open the plan studio", "by": "amber"}).json()
ok(s["ok"] and s["opened"] and s["item"]["id"] == "screen:plan-studio", f"say opens Plan Studio ({s.get('item', {}).get('id')})")
cmd, grants, by = fake.calls[-1]
eq((cmd["target"], cmd["path"], cmd["action"]), ("console.screens", "plan-studio", "open"), "the console command for a screen")
eq(grants, ["control.console.navigate"], "a screen opens with the navigate grant alone")
eq(by, "amber", "by is passed through")
ok(s["say"].startswith("Opening Plan Studio"), f"the answer sentence ({s['say']})")
s2 = c.post(f"{P}/say", json={"text": "show me the ui review settings", "open": False}).json()
ok(s2["ok"] and s2["item"]["id"] == "settings:plugins/ui-review" and "opened" not in s2, f"open: false only resolves ({s2.get('item', {}).get('id')})")
s3 = c.post(f"{P}/say", json={"text": "nothing like this at all"})
eq(s3.status_code, 404, "nothing matches → 404")
ok("I know nothing called" in s3.json()["say"], "and the answer says so")
eq(c.post(f"{P}/say", json={"text": ""}).status_code, 400, "empty text → 400")

# ---- open by id, settings anchor, dialog arg, destructive action with the caller's grants
n = len(fake.calls)
o = c.post(f"{P}/open", json={"id": "settings:plugins/ui-shortcuts", "to": "all"}).json()
ok(o["ok"], "open a settings tab")
cmd = fake.calls[-1][0]
eq((cmd["target"], cmd["path"], cmd.get("input", {}).get("to")), ("console.settings", "ui-shortcuts", "all"), "settings command carries `to`")
o2 = c.post(f"{P}/open", json={"id": "dialog:about", "arg": "credits"}).json()
ok(o2["ok"] and fake.calls[-1][0]["input"]["arg"] == "credits", "a dialog's argument goes with it")
# an action that deletes: the owner (console token) passes `*`; a hub user with navigate only is refused by the runner
hit = c.get(f"{P}/items", params={"kind": "action", "q": "delete", "limit": 3}).json()["items"]
if hit:
    o3 = c.post(f"{P}/open", json={"id": hit[0]["id"]}).json()
    eq(fake.calls[-1][1], ["*"], "a data-changing action runs with the owner's grants, not navigate")
    ok(o3["effect"] in ("destructive", "write"), f"its effect is reported ({o3['effect']})")
eq(c.post(f"{P}/open", json={}).status_code, 400, "open without an id → 400")
ok(len(fake.calls) >= n + 2, "commands were delivered")

# ---- shortcuts: add by words, say matches the phrase first, remove, owner only
a = c.post(f"{P}/shortcuts", json={"phrase": "my plans", "item": "the plan studio screen", "say": "Here are your plans."}).json()
ok(a["ok"] and a["shortcut"]["item"] == "screen:plan-studio", "a shortcut's item is settled to an id from words")
eq(a["shortcut"]["id"], "sc-my-plans", "its id comes from the phrase")
s4 = c.post(f"{P}/say", json={"text": "my plans"}).json()
eq((s4["via"], s4["say"]), ("shortcut", "Here are your plans."), "say matches the shortcut and uses its answer")
ok(any(sc["id"] == "sc-my-plans" for sc in c.get(f"{P}/shortcuts").json()["shortcuts"]), "the shortcut is listed")
v = c.get(f"{P}/voice").json()
ok(v["commands"][0]["id"] == "ui.open" and any(cmd["id"] == "ui.shortcut.sc-my-plans" for cmd in v["commands"]), "voice: the generic open + the shortcut as voice-command@1 commands")
ok(all(cmd["effect"] == "navigate" and cmd["confirm"] == "never" for cmd in v["commands"]), "voice commands never ask")
eq(c.post(f"{P}/shortcuts", json={"phrase": "x", "item": "no such thing anywhere"}).status_code, 404, "a shortcut to nothing is refused")
eq(c.post(f"{P}/shortcuts", json={"phrase": "x", "item": "screen:home"}, headers={"x-test-user": "pat"}).status_code, 403, "a hub user can't edit the owner's shortcuts")
d = c.delete(f"{P}/shortcuts", params={"id": "sc-my-plans"}).json()
ok(d["ok"] and not any(sc["id"] == "sc-my-plans" for sc in d["shortcuts"]), "remove a shortcut")
eq(c.delete(f"{P}/shortcuts", params={"id": "sc-my-plans"}).status_code, 404, "removing it again → 404")

# ---- live items: what an open console reports fills in and wins; it expires
lv = c.post(f"{P}/live", json={"app": "axf-console-web", "client": "cc-1", "items": [
    {"id": "screen:brand-new-plugin", "label": "Brand new plugin", "aliases": ["the new one"], "open": {"view": "brand-new-plugin"}},
    {"id": "screen:plan-studio", "label": "Plan Studio (live)", "open": {"view": "plan-studio"}},
]}).json()
eq(lv["kept"], 2, "live items kept")
g3 = c.get(f"{P}/item", params={"id": "the new one"}).json()
eq(g3["item"]["id"], "screen:brand-new-plugin", "a live-only item is found by its alias")
g4 = c.get(f"{P}/item", params={"id": "screen:plan-studio"}).json()
eq(g4["item"]["label"], "Plan Studio (live)", "the live copy wins over the disk copy")
ok(c.get(f"{P}/registry").json()["live"] == 2, "registry reports the live count")
us._live["owner/axf-console-web/cc-1"]["at"] -= us.LIVE_TTL_S + 1
us._write_live()
gone = c.get(f"{P}/item", params={"id": "screen:brand-new-plugin"})
ok(gone.status_code == 404, "live items expire (the live-only item is gone)")
ok(c.get(f"{P}/item", params={"id": "screen:plan-studio"}).json()["item"]["label"] == "Plan Studio", "and the disk copy is back")

# ---- recent + coverage + capability
rc = c.get(f"{P}/recent").json()["recent"]
ok(rc and rc[0]["kind"] in ("say", "open"), "recent lists what was opened")
cov = c.get(f"{P}/coverage").json()["apps"]
ok(any(a["app"] == "console-web" and a["total"] > 500 for a in cov), "coverage per app")
svc = plugin_services.get("ui-registry@1")
ok(svc is not None, "the capability is provided")
cap = svc.say("open the build orchestrator", by="molly", open=False)
eq(cap["item"]["id"], "screen:build-orchestrator", "capability say resolves")
ok(svc.items(q="plan", limit=3) and isinstance(svc.shortcuts(), list) and svc.voice()[0]["id"] == "ui.open", "capability items / shortcuts / voice")

print(f"✓ ui-shortcuts server: {checks} checks")
