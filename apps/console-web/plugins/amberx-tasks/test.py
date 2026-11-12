"""AmberX to-dos server part: tabs (today with overdue, upcoming, todo, all, done) and counts over the control@1
capability, add with the default list and kind, complete / reopen, reorder (set order per item), two-step delete,
settings validation.

    python apps/console-web/plugins/amberx-tasks/test.py
"""
from __future__ import annotations

import datetime as dt
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
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
P = "/api/plugins/amberx-tasks"
fails = 0


def eq(a: Any, b: Any, what: str) -> None:
    global fails
    if a != b:
        fails += 1
        print(f"FAIL {what}: {a!r} != {b!r}")


class FakeControl:
    """In-memory control@1 for amberx.items (select kind / status / list honoured like the real one)."""

    def __init__(self) -> None:
        self.items: dict[str, dict[str, Any]] = {}

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        op, target, path = command.get("op"), command.get("target"), command.get("path")
        if target == "amberx.lists":
            return {"ok": True, "items": [{"id": "inbox", "name": "Inbox", "path": "Inbox", "items": 0}], "total": 1}
        if op == "list":
            f = command.get("select") or {}
            rows = [i for i in self.items.values() if (not f.get("kind") or i["kind"] == f["kind"]) and (not f.get("list") or i["list"] == f["list"])]
            if f.get("status") == "not-done":
                rows = [i for i in rows if i["status"] != "done"]
            return {"ok": True, "items": rows, "total": len(rows)}
        if op == "add":
            it = {"id": f"t{len(self.items) + 1}", "status": "open", "order": len(self.items), "title": "", **(command.get("value") or {})}
            self.items[it["id"]] = it
            return {"ok": True, "item": it}
        if path not in self.items:
            return {"ok": False, "code": "not_found", "message": f"no item {path}"}
        if op == "set":
            self.items[path].update(command.get("value") or {})
            return {"ok": True, "item": self.items[path]}
        if op == "act":
            self.items[path]["status"] = "done" if command.get("action") == "done" else "open"
            return {"ok": True, "item": self.items[path]}
        if op == "remove":
            if command.get("confirm") != "tok":
                return {"ok": False, "code": "confirmation_required", "confirm": "tok"}
            del self.items[path]
            return {"ok": True, "removed": 1}
        return {"ok": False, "code": "invalid"}


ctl = FakeControl()
plugin_services.provide("control@1", ctl, folder="token-control")
today = dt.date.today()
day = lambda n: (today + dt.timedelta(days=n)).isoformat()  # noqa: E731

eq(c.post(f"{P}/add", json={"text": ""}).status_code, 400, "empty text refused")
a = c.post(f"{P}/add", json={"text": "milk", "due": day(0)}).json()["item"]
eq((a["kind"], a["list"]), ("todo", "inbox"), "defaults: kind todo, list inbox")
b = c.post(f"{P}/add", json={"text": "late", "due": day(-2)}).json()["item"]
t = c.post(f"{P}/add", json={"text": "plan", "kind": "task", "due": day(3)}).json()["item"]
c.post(f"{P}/add", json={"text": "someday"})

s = c.get(f"{P}/state").json()
eq(s["counts"], {"today": 2, "upcoming": 1, "todo": 3, "all": 4, "done": 0, "overdue": 1}, "counts")
eq({i["id"] for i in c.get(f"{P}/items?tab=today").json()["items"]}, {a["id"], b["id"]}, "today has overdue")
c.put(f"{P}/settings", json={"overdueInToday": False})
eq([i["id"] for i in c.get(f"{P}/items?tab=today").json()["items"]], [a["id"]], "today without overdue")
eq([i["id"] for i in c.get(f"{P}/items?tab=upcoming").json()["items"]], [t["id"]], "upcoming")
eq(c.get(f"{P}/items?tab=nope").status_code, 400, "bad tab")

eq(c.post(f"{P}/complete", json={"id": a["id"]}).status_code, 200, "complete")
eq([i["id"] for i in c.get(f"{P}/items?tab=done").json()["items"]], [a["id"]], "done tab")
c.post(f"{P}/complete", json={"id": a["id"], "done": False})
eq(ctl.items[a["id"]]["status"], "open", "reopen")

ids = [t["id"], b["id"], a["id"]]
eq(c.post(f"{P}/reorder", json={"ids": ids}).json()["reordered"], 3, "reorder")
eq([ctl.items[x]["order"] for x in ids], [0, 1, 2], "orders set")
eq(c.post(f"{P}/reorder", json={"ids": [a["id"], a["id"]]}).status_code, 400, "reorder refuses repeats")
eq(c.post(f"{P}/reorder", json={"ids": ["missing"]}).status_code, 404, "reorder unknown id")

r = c.post(f"{P}/remove", json={"id": b["id"]})
eq((r.status_code, r.json().get("confirm")), (409, "tok"), "remove asks first")
eq(c.post(f"{P}/remove", json={"id": b["id"], "confirm": "tok"}).status_code, 200, "remove confirmed")

eq(c.put(f"{P}/settings", json={"defaultTab": "later"}).status_code, 400, "bad tab setting")
eq(c.put(f"{P}/settings", json={"defaultKind": "task"}).json()["settings"]["defaultKind"], "task", "kind setting")

print("amberx-tasks:", "ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
