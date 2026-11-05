#!/usr/bin/env python3
"""Claude accounts server: name validation, fixed commands, owner only, the held call, and no secret in any answer.

    python3 apps/console-web/plugins/claude-accounts/test.py
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
sys.path.insert(0, str(HERE.parent.parent / "server"))
os.environ["AXF_CLAUDE_ACCOUNTS_DATA_DIR"] = tempfile.mkdtemp()

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.accounts_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

SECRET = "fake-token-NEVER-SHOW-THIS"
checks = 0


def ok(v: object, what: str) -> None:
    global checks
    checks += 1
    if not v:
        raise SystemExit(f"FAILED: {what}")
    print(f"  ok {what}")


def status(email: str = "me@example.com") -> str:
    return json.dumps({"loggedIn": True, "email": email, "subscriptionType": "pro", "orgId": "org-1", "accessToken": SECRET, "refreshToken": SECRET})


class Host:
    version = 1

    def __init__(self) -> None:
        self.out = f"* account-2 (active)\n  main\n../evil\n  bad name; rm -rf\n{mod.SEP}\n{status()}\n"
        self.commands: list[str] = []

    def vps_read(self, remote: str, timeout: int = 15) -> dict:
        self.commands.append(remote)
        return {"ready": True, "out": self.out, "why": ""}


class Hub:
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.answer: dict = {"ok": 'held: true\n{"status": "held", "job_id": "0f9c1a2b-1111-2222-3333-444455556666"}'}

    def ready(self) -> tuple[bool, str]:
        return True, ""

    def call(self, tool: str, arguments: dict, confirmation_id: str | None = None, timeout: float = 600, reason: str = "") -> dict:
        self.calls.append((tool, arguments, reason))
        return self.answer


host, hub = Host(), Hub()
plugin_services.provide("axf.headless@1", host, "console-terminal")
plugin_services.provide("axf.vinny@1", hub, "agent-manager")

app = FastAPI()
user: list[object | None] = [None]


@app.middleware("http")
async def who(request: Request, call_next):
    request.state.axf_user = user[0]
    return await call_next(request)

app.include_router(mod.router, prefix="/p")
c = TestClient(app)
seen_bodies: list[str] = []


def reset() -> None:
    mod._pending = None
    mod._forget_read()
    hub.calls.clear()


def post(path: str, body: object):
    r = c.post(path, json=body)
    seen_bodies.append(r.text)
    return r


print("names")
for bad in ["", "A B!", "a;rm -rf /", "x" * 33, "../evil", "$(id)", "a b;c", 5, None, ["a"]]:
    r = post("/p/use", {"name": bad})
    ok(r.status_code == 400, f"refused: {bad!r}")
ok(mod.clean_name("Account 2") == "account-2", "spoken 'Account 2' becomes account-2")
ok(mod.clean_name("a\n") == "a" and mod.clean_name("a\nb") == "a-b", "no newline survives into a name")
ok(not hub.calls, "no bad name ever reached axHub")

print("list")
reset()
r = c.get("/p/accounts")
seen_bodies.append(r.text)
j = r.json()
ok(j["ready"] and [a["name"] for a in j["accounts"]] == ["account-2", "main"], "rows, malformed lines dropped")
ok(j["active"] == "account-2" and j["accounts"][0]["active"] and not j["accounts"][1]["active"], "active marker")
ok(j["accounts"][0]["email"] == "me@example.com" and j["accounts"][0]["plan"] == "pro", "email and plan on the active row")
ok("running builds keep" in j["note"].lower(), "the builds note is in the answer")
ok(set(j["login"]) == {"email", "plan"}, "only email and plan from auth status")
ok(host.commands == [mod.READ_COMMAND], "one fixed read command")
c.get("/p/who")
ok(len(host.commands) == 1, "second read inside 30 s stays cached")

print("account types")
names, active, kinds = mod.parse_list("  account-1\n* account-2 (active)\n  account-3 [token]\n  account-4\n  account-5 [api key]\n* account-6 [token] (active)\n  bad [thing]\n")
ok(names == [f"account-{i}" for i in range(1, 7)], "token and API-key accounts are listed, not dropped as malformed")
ok(active == "account-6" and kinds["account-2"] == "login" and kinds["account-3"] == "token" and kinds["account-5"] == "api-key", "each row keeps its type")
ok(not any(x == "bad" for x in names), "an unknown tag is still malformed")
svc = plugin_services.get("axf.claude-accounts@1")
ok(svc and {"name", "type", "active", "email", "plan"} == set(svc.view()["accounts"][0]), "the capability lists names, types and emails, nothing else")

print("use")
reset()
r = post("/p/use", {"name": "account-2"})
ok(r.json()["state"] == "done" and not hub.calls, "already active: nothing sent")
r = post("/p/use", {"name": "ghost"})
ok(r.status_code == 404 and not hub.calls, "unknown account: nothing sent")
r = post("/p/use", {"name": "Main"})
ok(r.status_code == 200 and r.json()["state"] == "waiting", "held: waiting for Brett")
ok(hub.calls[0][0] == "vps.run" and hub.calls[0][1]["command"] == f"{mod.SCRIPT} use main", "one fixed vps.run")
ok("main" in hub.calls[0][2], "the reason names the account")
r = post("/p/use", {"name": "main"})
ok(r.json()["state"] == "waiting" and len(hub.calls) == 1, "a repeat sends nothing")
ok(post("/p/save", {"name": "other"}).status_code == 409 and len(hub.calls) == 1, "one held call at a time")
ok(c.get("/p/accounts").json()["pending"]["name"] == "main", "the waiting call shows")
host.out = f"  account-2\n* main (active)\n{mod.SEP}\n{status('main@example.com')}\n"
mod._forget_read()
ok(c.get("/p/accounts").json()["pending"] is None, "clears once it took effect")

print("a pass runs it at once")
reset()
hub.answer = {"ok": "exit 0 · 12 ms\nserver builds now use: account-2"}
r = post("/p/use", {"name": "account-2"})
ok(r.json()["state"] == "done" and mod._pending is None, "ran under a pass: nothing pending")
hub.answer = {"ok": f"exit 1 · 3 ms\n{SECRET}"}
mod._forget_read()
r = post("/p/use", {"name": "account-2"})
ok(r.status_code == 200 and r.json()["state"] == "failed", "exit 1 is a failure")
hub.answer = {"confirm": "11111111-2222-3333-4444-555555555555"}
mod._forget_read()
ok(post("/p/use", {"name": "account-2"}).json()["state"] == "waiting", "a confirm answer waits too")

print("save")
reset()
r = post("/p/save", {"name": "fresh"})
ok(r.json()["state"] == "waiting" and hub.calls[0][1]["command"] == f"{mod.SCRIPT} save fresh", "save is the same fixed call")

print("a new login on the active name")
reset()
host.out = f"* main (active)\n  account-2\n{mod.SEP}\n{status('someone-else@example.com')}\n"
j = c.get("/p/accounts").json()
ok(j["loginChanged"], "spotted")
ok(j["accounts"][1]["email"] != "someone-else@example.com" and [a for a in j["accounts"] if a["name"] == "main"][0]["email"] == "main@example.com", "the last-seen email stays")
r = post("/p/use", {"name": "account-2"})
ok(r.status_code == 409 and not hub.calls, "switch refused: it would overwrite the saved login")
hub.answer = {"ok": 'held: true'}
ok(post("/p/save", {"name": "main"}).json()["state"] == "waiting", "saving over the active name stays allowed")
j = c.get("/p/accounts").json()
ok(not j["loginChanged"] and j["accounts"][0]["email"] == "someone-else@example.com", "while that save waits, the new email is taken")

print("owner only")
reset()
user[0] = types.SimpleNamespace(admin=False, name="guest")
for r in (c.get("/p/accounts"), c.get("/p/who"), c.post("/p/use", json={"name": "main"}), c.post("/p/save", json={"name": "main"})):
    ok(r.status_code == 403, "a non-admin is refused")
ok(not hub.calls, "nothing sent for a non-admin")
user[0] = types.SimpleNamespace(admin=True, name="Brett")
ok(c.get("/p/who").status_code == 200, "Brett's session reads")
user[0] = None

print("no secret anywhere")
ok(not any(SECRET in b or "accessToken" in b or "refreshToken" in b for b in seen_bodies), "no answer carries a token")
ok(SECRET not in (Path(os.environ["AXF_CLAUDE_ACCOUNTS_DATA_DIR"]) / "seen.json").read_text(), "nor the data file")
source = (HERE / "server" / "__init__.py").read_text()
ok(".credentials" not in source and "subprocess" not in source, "the server has no path to a credentials file and no shell of its own")

print(f"\nclaude-accounts: {checks} checks passed")
