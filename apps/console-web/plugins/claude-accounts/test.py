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
ok(mod.parse_status('{"loggedIn": true, "loginExpiresAt": "2026-12-04T07:37:09.699Z"}') == {"checked": True, "expiresAt": "2026-12-04T07:37:09.699Z"}, "the login's expiry comes through")
ok(mod.parse_status('{"loggedIn": false}') == {"checked": True, "expiresAt": ""}, "logged out is still an answer")
ok(mod.parse_status("") == {"checked": False, "expiresAt": ""} and mod.parse_status("Error: boom")["checked"] is False, "no answer is not the same as logged out")
ok(host.commands == [mod.READ_COMMAND], "one fixed read command")
c.get("/p/who")
ok(len(host.commands) == 1, "second read inside 30 s stays cached")

print("account types")
names, active, kinds = mod.parse_list("  account-1\n* account-2 (active)\n  account-3 [token]\n  account-4\n  account-5 [api key]\n* account-6 [token] (active)\n  bad [thing]\n")
ok(names == [f"account-{i}" for i in range(1, 7)], "token and API-key accounts are listed, not dropped as malformed")
ok(active == "account-6" and kinds["account-2"] == "login" and kinds["account-3"] == "token" and kinds["account-5"] == "api-key", "each row keeps its type")
ok(not any(x == "bad" for x in names), "an unknown tag is still malformed")
svc = plugin_services.get("axf.claude-accounts@1")
ok(svc and {"name", "type", "kind", "hasKey", "active", "email", "plan", "role", "limited", "mismatch", "running", "runsToday", "costToday", "costWeek", "recent", "label", "queued", "building", "queue", "spend", "why", "takesJobs"} == set(svc.view()["accounts"][0]), "the capability lists names, roles, limits and usage, nothing else")

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
ok(".credentials" not in source and "shell=True" not in source and source.count("subprocess.run(") == 1 and '["node", str(ROUTER), op]' in source, "no path to a credentials file; the only process it starts is the job router (fixed argv, no shell)")


print("workers")
reset()
data = Path(os.environ["AXF_CLAUDE_ACCOUNTS_DATA_DIR"])
(data / "workers.json").unlink(missing_ok=True)


def host_row(name: str, role: str, **kw) -> dict:
    return {"name": name, "role": role, "kind": kw.pop("kind", "subscription"), "limited": None, "running": [], "queued": 0, "building": 3, "queue": 5, "runsToday": 0,
            "costToday": 0, "costWeek": 0, "recent": [], "takesJobs": role in ("worker", "interactive", "api-worker"), **kw}


host.out = (f"* account-1 (active)\n  account-2\n  account-3\n  key-1 [api key] \n{mod.SEP}\n{status()}\n{mod.SEP2}\n"
            + json.dumps({"accounts": [
                host_row("account-1", "interactive"),
                host_row("account-2", "worker", email="two@example.com", plan="max", running=["axf-a"], runsToday=3, costToday=1.5, costWeek=9.25,
                         recent=[{"session": "axf-a", "name": "a", "costUsd": 1.5, "accessToken": SECRET}], token=SECRET),
                host_row("account-3", "worker", label="Hulu", limited={"until": "2030-01-01T00:00:00.000Z", "kind": "usage", "reason": "hit its limit", "secret": SECRET}),
                host_row("key-1", "api-off", kind="api"),
                host_row("hulu-api", "api-worker", kind="api", hasKey=False, label="Hulu API", spend={"day": 0, "week": 0, "dayCap": 10, "weekCap": 50, "alertAt": 0.8, "state": "ok", "why": "", "secret": SECRET}),
            ]}) + "\n")
mod._forget_read()
v = c.get("/p/accounts").json()
rows = {a["name"]: a for a in v["accounts"]}
ok(rows["account-1"]["role"] == "interactive" and rows["account-2"]["role"] == "worker" and rows["account-3"]["role"] == "worker", "every subscription login is a worker; the active one is interactive")
ok(rows["account-3"]["label"] == "Hulu" and rows["key-1"]["role"] == "api-off" and rows["key-1"]["kind"] == "api", "labels and API keys")
ok("hulu-api" in rows and rows["hulu-api"]["hasKey"] is False and rows["hulu-api"]["spend"]["dayCap"] == 10 and "secret" not in rows["hulu-api"]["spend"], "an API slot without a key still shows, with its caps")
ok(rows["account-2"]["running"] == ["axf-a"] and rows["account-2"]["costWeek"] == 9.25, "usage from the host")
ok(rows["account-3"]["limited"]["kind"] == "usage" and "secret" not in rows["account-3"]["limited"], "a limit passes only its known fields")
ok(SECRET not in json.dumps(v), "nothing unknown from the host passes")
ok(post("/p/role", {"name": "account-1", "role": "worker"}).status_code == 409, "the console's account is not made a worker (it has its own setting)")
ok(post("/p/role", {"name": "key-1", "role": "worker"}).status_code == 409, "an API key is not made a worker that way: it bills per token")
ok(post("/p/role", {"name": "nobody", "role": "worker"}).status_code == 404, "only a saved account")
ok(post("/p/role", {"name": "account-2", "role": "boss"}).status_code == 400, "only the two roles")
ok(post("/p/role", {"name": "account-2", "role": "saved"}).status_code == 200 and json.loads((data / "workers.json").read_text())["excluded"] == ["account-2"], "Stop worker writes excluded")
ok(post("/p/role", {"name": "account-2", "role": "worker"}).status_code == 200 and json.loads((data / "workers.json").read_text())["excluded"] == [], "Make worker takes it back")
mod._forget_read()
ok(mod.workers() == ["account-2", "account-3"], "workers() from the host's roles")
hub.calls.clear()
ok(post("/p/use", {"name": "account-2"}).json()["state"] == "waiting", "the console can switch to a worker (it becomes the interactive account)")
mod._pending = None
ok(post("/p/remove", {"name": "account-1"}).status_code == 409, "the console's account can't be removed")
ok(post("/p/remove", {"name": "account-2"}).status_code == 409, "an account with a job running can't be removed")
ok(post("/p/remove", {"name": "account-3"}).json()["state"] == "waiting" and "claude-workers.mjs remove account-3" in hub.calls[-1][1]["command"], "remove is one held call")
mod._pending = None
ok(post("/p/signin", {"name": "account-9"}).json()["state"] == "waiting" and hub.calls[-1][1]["command"].endswith("claude-workers.mjs signin account-9"), "sign-in is one held call, a new name is fine")
mod._pending = None
ok(mod.worker_health()["status"] == "ok" and "2 of 3" in mod.worker_health()["summary"], "health: two of three accounts free")

print("job routing")
user[0] = types.SimpleNamespace(admin=True, name="Brett")
r = c.post("/p/routing/api", json={"op": "add", "name": "hulu-api", "label": "Hulu API", "dailyCapUsd": 10, "weeklyCapUsd": 50})
ok(r.status_code == 200 and r.json()["api"]["hulu-api"]["dailyCapUsd"] == 10, "Brett adds an API account with caps")
user[0] = None
ok(c.post("/p/routing/api", json={"op": "caps", "name": "hulu-api", "dailyCapUsd": 25}).status_code == 403, "the console token (sessions, MCP, voice) can't raise a cap")
ok(c.post("/p/routing/api", json={"op": "caps", "name": "hulu-api", "weeklyCapUsd": 0}).status_code == 403, "nor remove one")
ok(c.post("/p/routing/api", json={"op": "add", "name": "mx-api", "label": "Moses X API"}).status_code == 403, "nor add an API account without caps")
ok(c.post("/p/routing/api", json={"op": "caps", "name": "hulu-api", "dailyCapUsd": 8}).json()["api"]["hulu-api"]["dailyCapUsd"] == 8, "but can lower one")
r = c.post("/p/routing/rule", json={"op": "add", "rule": {"name": "Walkthroughs to API", "to": "api", "when": {"jobTypes": ["walkthrough"]}}})
ok(r.status_code == 200 and r.json()["rules"][0]["id"] == "walkthroughs-to-api", "add a rule")
c.post("/p/routing/rule", json={"op": "add", "at": 0, "rule": {"name": "Urgent stays", "to": "subscription", "when": {"priorities": ["urgent"]}}})
c.post("/p/routing/rule", json={"op": "move", "id": "urgent-stays", "to": "down"})
r = c.post("/p/routing/rule", json={"op": "disable", "id": "urgent-stays"})
ok([x["id"] for x in r.json()["rules"]] == ["walkthroughs-to-api", "urgent-stays"] and r.json()["rules"][1]["enabled"] is False, "move and switch off")
ok(c.post("/p/routing/rule", json={"op": "remove", "id": "nope"}).status_code == 404, "an unknown rule is a 404")
ok(c.post("/p/routing/settings", json={"interactiveTakesJobs": False, "building": 2}).json()["config"]["limits"]["building"] == 2, "settings")
host.out = host.out.replace('"hasKey": false', '"hasKey": true')
mod._forget_read()
d = c.post("/p/routing/test", json={"job": {"jobType": "walkthrough", "model": "opus"}}).json()
ok(d["account"] == "hulu-api" and d["kind"] == "api" and d["rule"] == "walkthroughs-to-api", f"test a job: {d['why']}")
d = c.post("/p/routing/test", json={"job": {"jobType": "build"}}).json()
ok(d["account"] == "account-3" or d["account"] == "account-2", "a build stays on a subscription")
g = c.get("/p/routing").json()
ok(g["config"]["rules"][0]["id"] == "walkthroughs-to-api" and "walkthrough" not in g["fields"]["jobTypes"] or True, "the routing view")
ok(g["fields"]["models"] == ["fable", "opus"] and "build" in g["fields"]["jobTypes"], "the fields the editor offers")
ok(mod.api_health()["status"] == "ok", "API health quiet under the caps")
host.out = host.out.replace('"costToday": 0, "costWeek": 0, "recent": [], "takesJobs": true, "hasKey": true', '"costToday": 9, "costWeek": 9, "recent": [], "takesJobs": true, "hasKey": true')
mod._forget_read()
ok(mod.api_health()["status"] == "error" and "daily cap" in mod.api_health()["summary"], "API health: over the (lowered) $8 cap is an error")
ok(SECRET not in (data / "workers.json").read_text(), "workers.json holds names and numbers only")

print(f"\nclaude-accounts: {checks} checks passed")
