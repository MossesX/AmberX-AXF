"""Self-test of the Build profiles server part: python apps/console-web/plugins/build-profiles/test.py

Runs the real routes (FastAPI TestClient). Reads go to the real profiles CLI (they change nothing); every change goes
to a recording stand-in, so the registry is never touched: what is checked is the change each command hands over, what
is refused before the CLI is reached, and that plugin.json declares one command per route with the right effect.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import sys
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parent.parent / "server"))
from fastapi import Depends, FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402

cx.set_context(ROOT=ROOT)
spec = importlib.util.spec_from_file_location("build_profiles_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

USER: dict[str, object] = {"caller": None}


def who(request: Request) -> None:
    request.state.axf_user = USER["caller"]


app = FastAPI()
app.include_router(mod.router, prefix="/p", dependencies=[Depends(who)])
client = TestClient(app)
checks = 0


def ok(cond: bool, what: str) -> None:
    global checks
    checks += 1
    if not cond:
        print(f"FAIL {what}")
        sys.exit(1)


# reads: the real CLI
r = client.get("/p/list")
ok(r.status_code == 200 and r.json()["ok"] and any(p.get("base") for p in r.json()["profiles"]), "list: profiles with a base")
base = next(p["id"] for p in r.json()["profiles"] if p.get("base"))
r = client.get("/p/get", params={"id": base})
ok(r.status_code == 200 and r.json()["profile"]["id"] == base and r.json()["listed"] is True, "get: the base profile")
ok(client.get("/p/get", params={"id": "no-such-profile-x"}).status_code == 404, "get: unknown profile is 404")
ok(client.get("/p/get", params={"id": "Bad Id"}).status_code == 400, "get: bad id is 400")

# changes: a stand-in records what the CLI would get
sent: list[tuple[tuple[str, ...], str]] = []
answer: dict[str, object] = {"ok": True, "log": ["done"]}


def fake(*args: str, actor: str = "build-profiles") -> dict[str, object]:
    sent.append((args, actor))
    return dict(answer)


mod._cli = fake
logged: list[str] = []
cx.set_context(log=lambda channel, text, level="info": logged.append(f"{channel}: {text}"))


def last() -> dict[str, object]:
    args, _ = sent[-1]
    ok(args[0] == "act", "changes go through act")
    return json.loads(args[1])


def post(path: str, body: dict[str, object]):
    return client.post(f"/p/{path}", json=body)


ok(post("create", {"name": "Next", "copyFrom": "all", "select": True, "junk": 1}).status_code == 200, "create")
ok(last() == {"action": "create", "name": "Next", "copyFrom": "all", "select": True}, "create: known fields only")
ok(logged == ["profiles: done"], "the CLI's log lines reach the console log")
ok(post("create", {}).status_code == 400, "create needs a name")
ok(post("update", {"id": "next", "colour": "accent", "icon": "rocket", "catalog": False}).status_code == 200 and last() == {"action": "update", "id": "next", "colour": "accent", "icon": "rocket", "catalog": False}, "update")
ok(post("update", {"id": "next", "catalog": "yes"}).status_code == 400, "update: catalog must be a boolean")
ok(post("select", {"id": "next"}).status_code == 200 and last() == {"action": "select", "id": "next"}, "select")
ok(post("select", {"id": "../etc"}).status_code == 400, "select: bad id refused")
ok(post("duplicate", {"id": "next", "newId": "next-2", "name": "Next 2"}).status_code == 200 and last() == {"action": "duplicate", "id": "next", "name": "Next 2", "newId": "next-2"}, "duplicate")
ok(post("merge", {"from": "next", "into": "all", "removeSource": True}).status_code == 200 and last() == {"action": "merge", "from": "next", "into": "all", "removeSource": True}, "merge")
ok(post("merge", {"from": "all", "into": "all"}).status_code == 400, "merge: two different profiles")
ok(post("move-builds", {"builds": ["a", "b.c"], "to": "next"}).status_code == 200 and last() == {"action": "move-builds", "builds": ["a", "b.c"], "to": "next"}, "move-builds")
ok(post("move-builds", {"builds": [], "to": "next"}).status_code == 400, "move-builds needs builds")
ok(post("move-builds", {"builds": ["a b"], "to": "next"}).status_code == 400, "move-builds: bad build id refused")
ok(post("archive", {"id": "next"}).status_code == 200 and last() == {"action": "archive", "id": "next"}, "archive")
ok(post("archive", {"id": "next", "archived": False}).status_code == 200 and last() == {"action": "unarchive", "id": "next"}, "archive with archived = false unarchives")
ok(post("unlist", {"id": "next"}).status_code == 200 and last() == {"action": "remove", "id": "next", "confirm": "next"}, "remove: off the list, confirm filled in")
ok(post("relist", {"id": "next"}).status_code == 200 and last() == {"action": "restore", "id": "next"}, "restore")
ok(post("cleanup", {"profile": "all", "fix": False}).status_code == 200 and last() == {"action": "cleanup", "fix": True, "profile": "all"}, "cleanup fix always fixes")
ok(client.get("/p/cleanup").status_code == 200 and last() == {"action": "cleanup", "fix": False}, "cleanup scan never fixes")

# purge: confirm = the id, owner only
n = len(sent)
ok(post("purge", {"id": "next"}).status_code == 400 and post("purge", {"id": "next", "confirm": "other"}).status_code == 400 and len(sent) == n, "purge without the id as confirm never reaches the CLI")
USER["caller"] = SimpleNamespace(name="sam", admin=False)
ok(post("purge", {"id": "next", "confirm": "next"}).status_code == 403 and len(sent) == n, "purge: a signed-in user who is not the owner is refused")
USER["caller"] = SimpleNamespace(name="brett", admin=True)
ok(post("purge", {"id": "next", "confirm": "next"}).status_code == 200 and last() == {"action": "purge", "id": "next", "confirm": "next"}, "purge: owner with confirm")
ok(sent[-1][1] == "build-profiles:brett", "the caller is the actor")
USER["caller"] = None

answer = {"ok": False, "error": "the main profile stays"}
r = post("unlist", {"id": "all"})
ok(r.status_code == 400 and r.json()["detail"] == "the main profile stays", "a refused change is a 400 with the CLI's reason")
ok(client.post("/p/create", content=b"x" * (mod.MAX_BODY + 1)).status_code == 413, "oversized body refused")
ok(client.post("/p/create", content=b"[1]").status_code == 400, "a body that is not an object is refused")

# the declaration: one command per route, reads allow / changes veto / data delete confirm
reg = json.loads(subprocess.run(["node", str(ROOT / "framework/cli/plugin-commands.mjs"), "registry", "--json"], cwd=ROOT, capture_output=True, text=True, check=True).stdout)
plugins = reg["plugins"] if isinstance(reg, dict) and "plugins" in reg else reg
entry = next(p for p in (plugins if isinstance(plugins, list) else plugins.values()) if p["folder"] == HERE.name)
cmds = {c["id"]: c for c in entry["commands"]}
want = {"list": "read", "get": "read", "cleanup": "read", "create": "write", "update": "write", "select": "write", "duplicate": "write", "merge": "write",
        "move-builds": "write", "archive": "write", "remove": "write", "restore": "write", "cleanup-fix": "write", "purge": "destructive"}
for cid, effect in want.items():
    ok(cid in cmds and cmds[cid]["effect"] == effect, f"command {cid} is declared as {effect}")
    ok(cmds[cid]["confirm"] is (effect == "destructive"), f"command {cid}: confirm only on the data delete")
paths = {f"{r.methods and sorted(r.methods)[0]} {r.path}" for r in mod.router.routes}
ok({f"{c['run']['route']['method']} {c['run']['route']['path']}" for c in cmds.values() if "route" in c["run"]} == paths, "every route is a declared command and every declared route exists")
ok(not entry.get("errors"), "no declaration errors")

print(f"build-profiles server: {checks} checks passed")
