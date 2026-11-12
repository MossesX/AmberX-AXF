"""AmberX to-dos server part: settings, tabs (today / upcoming / overdue / done), add, complete, reorder, two-step
delete, the control relay limited to amberx.items / amberx.lists, and an answer when control@1 is missing.

    python apps/console-web/plugins/amberx-tasks/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services, for the console's import style
os.environ["AXF_AMBERX_TASKS_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-amberx-tasks-")

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("amberx_tasks_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):
    request.state.axf_user = types.SimpleNamespace(name="brett", admin=True, via="session")
    return await call_next(request)


app.include_router(mod.router, prefix="/api/plugins/amberx-tasks")
c = TestClient(app)
fails = 0


def eq(a: Any, b: Any, what: str) -> None:
    global fails
    if a != b:
        fails += 1
        print(f"FAIL {what}: {a!r} != {b!r}")


import datetime as dt  # noqa: E402

TODAY = dt.date.today()
D = lambda n: (TODAY + dt.timedelta(days=n)).isoformat()  # noqa: E731


class FakeControl:
    """An in-memory control@1 for amberx.items / amberx.lists (the real one is the Token control plugin's)."""

    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], str]] = []
        self.items: dict[str, dict[str, Any]] = {}

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        self.calls.append((command, by))
        op, target, path = command.get("op"), command.get("target"), command.get("path")
        if target == "amberx.lists" and op == "list":
            return {"ok": True, "items": [{"id": "inbox", "name": "Inbox", "path": "Inbox", "items": len(self.items)}], "total": 1}
        if target != "amberx.items":
            return {"ok": False, "code": "invalid", "message": "unsupported"}
        if op == "list":
            sel = command.get("select") or {}
            rows = [i for i in self.items.values() if not sel.get("kind") or i["kind"] == sel["kind"]]
            return {"ok": True, "items": rows, "total": len(rows)}
        if op == "add":
            it = {"id": f"t{len(self.items) + 1}", "status": "open", "order": len(self.items), **(command.get("value") or {})}
            self.items[it["id"]] = it
            return {"ok": True, "changed": True, "item": it}
        if path not in self.items:
            return {"ok": False, "code": "not_found", "message": f"no AmberX item {path}"}
        if op == "set":
            self.items[path].update(command.get("value") or {})
            return {"ok": True, "changed": True, "item": self.items[path]}
        if op == "act" and command.get("action") in ("done", "undone"):
            self.items[path]["status"] = "done" if command["action"] == "done" else "open"
            return {"ok": True, "changed": True, "item": self.items[path]}
        if op == "remove":
            if not command.get("confirm"):
                return {"ok": False, "code": "confirmation_required", "confirm": "tok"}
            self.items.pop(path, None)
            return {"ok": True, "removed": 1}
        return {"ok": False, "code": "invalid", "message": "unsupported"}


P = "/api/plugins/amberx-tasks"
eq(c.get(f"{P}/state").status_code, 503, "state without control@1")

ctl = FakeControl()
plugin_services.provide("control@1", ctl, folder="token-control")

eq(c.get(f"{P}/settings").json()["settings"]["defaultTab"], "today", "default tab")
eq(c.put(f"{P}/settings", json={"defaultTab": "someday"}).status_code, 400, "tab must be known")
eq(c.put(f"{P}/settings", json={"defaultKind": "task"}).status_code, 200, "settings write")
eq(c.get(f"{P}/settings").json()["settings"]["defaultKind"], "task", "settings kept")
eq(c.post(f"{P}/settings/reset").json()["settings"]["defaultKind"], "todo", "reset")

eq(c.post(f"{P}/add", json={}).status_code, 400, "add needs text")
eq(c.post(f"{P}/add", json={"text": "x", "kind": "note"}).status_code, 400, "add refuses notes")
a = c.post(f"{P}/add", json={"text": "milk", "due": D(0)}).json()["item"]
eq((a["kind"], a["list"]), ("todo", "inbox"), "add defaults")
eq(ctl.calls[-1][1], "console:brett", "by is the signed-in person")
b = c.post(f"{P}/add", json={"text": "taxes", "kind": "task", "due": D(-2)}).json()["item"]
d = c.post(f"{P}/add", json={"text": "call mum", "due": D(3)}).json()["item"]
e = c.post(f"{P}/add", json={"text": "someday"}).json()["item"]

ids = lambda tab: [i["id"] for i in c.get(f"{P}/items", params={"tab": tab}).json()["items"]]  # noqa: E731
eq(sorted(ids("today")), sorted([a["id"], b["id"]]), "today takes overdue")
eq(ids("upcoming"), [d["id"]], "upcoming")
eq(sorted(ids("todo")), sorted([a["id"], d["id"], e["id"]]), "to-dos tab is kind todo")
eq(c.get(f"{P}/items", params={"tab": "nope"}).status_code, 400, "unknown tab")
c.put(f"{P}/settings", json={"overdueInToday": False})
eq(ids("today"), [a["id"]], "overdue off")
c.post(f"{P}/settings/reset")

eq(c.post(f"{P}/complete", json={"id": a["id"]}).status_code, 200, "complete")
eq(ids("done"), [a["id"]], "done tab")
c.post(f"{P}/complete", json={"id": a["id"], "done": False})
eq(ids("done"), [], "open again")
eq(c.post(f"{P}/complete", json={"id": "zz"}).status_code, 404, "complete a missing one")

eq(c.post(f"{P}/reorder", json={"ids": [e["id"], e["id"]]}).status_code, 400, "reorder refuses repeats")
r = c.post(f"{P}/reorder", json={"ids": [e["id"], d["id"], a["id"]]})
eq(r.json().get("reordered"), 3, "reorder")
eq(ids("todo"), [e["id"], d["id"], a["id"]], "new order kept")

s = c.get(f"{P}/state").json()
eq((s["counts"]["today"], s["counts"]["overdue"], s["counts"]["all"]), (2, 1, 4), "state counts")

r = c.post(f"{P}/remove", json={"id": e["id"]})
eq(r.status_code, 409, "remove asks to confirm")
eq(c.post(f"{P}/remove", json={"id": e["id"], "confirm": r.json()["confirm"]}).status_code, 200, "remove with the token")
eq(e["id"] in ctl.items, False, "removed")
eq(c.post(f"{P}/control", json={"command": {"op": "set", "target": "tokens.theme", "path": "accent", "value": "x"}}).status_code, 400, "relay refuses other targets")

print("amberx-tasks:", "ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
