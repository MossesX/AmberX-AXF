"""AmberX lists server part: the list tree, one list with checked items last, Markdown export, list add / rename / move /
two-step remove, item add (kind from the settings) / edit / check / two-step remove, settings validation.

    python apps/console-web/plugins/amberx-lists/test.py
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
sys.path.insert(0, str(HERE.parents[1] / "server"))
os.environ["AXF_AMBERX_LISTS_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-amberx-lists-")

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("amberx_lists_server", HERE / "server" / "__init__.py")
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


app.include_router(mod.router, prefix="/api/plugins/amberx-lists")
c = TestClient(app)
P = "/api/plugins/amberx-lists"
fails = 0


def eq(a: Any, b: Any, what: str) -> None:
    global fails
    if a != b:
        fails += 1
        print(f"FAIL {what}: {a!r} != {b!r}")


class FakeControl:
    def __init__(self) -> None:
        self.lists: dict[str, dict[str, Any]] = {"inbox": {"id": "inbox", "name": "Inbox", "parent": None, "system": "inbox"}}
        self.items: dict[str, dict[str, Any]] = {}
        self.n = 0

    def _out(self, l: dict[str, Any]) -> dict[str, Any]:
        path = l["name"] if not l.get("parent") else f"{self.lists[l['parent']]['name']} / {l['name']}"
        return {**l, "path": path, "items": sum(1 for i in self.items.values() if i["list"] == l["id"])}

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        op, target, path = command.get("op"), command.get("target"), command.get("path")
        coll = self.lists if target == "amberx.lists" else self.items
        if op == "list":
            if target == "amberx.lists":
                return {"ok": True, "items": [self._out(l) for l in self.lists.values()]}
            f = command.get("select") or {}
            return {"ok": True, "items": [i for i in self.items.values() if i["list"] == f.get("list")]}
        if op == "add":
            self.n += 1
            v = {"id": f"x{self.n}", "status": "open", "order": self.n, "parent": None, **(command.get("value") or {})}
            coll[v["id"]] = v
            return {"ok": True, "item": self._out(v) if coll is self.lists else v}
        if path not in coll:
            return {"ok": False, "code": "not_found", "message": f"no {path}"}
        if op == "get":
            return {"ok": True, "item": self._out(coll[path])}
        if op == "set":
            coll[path].update(command.get("value") or {})
            return {"ok": True, "item": coll[path]}
        if op == "act":
            a, inp = command.get("action"), command.get("input") or {}
            if a in ("done", "undone"):
                coll[path]["status"] = "done" if a == "done" else "open"
            elif a == "rename":
                coll[path]["name"] = inp["name"]
            elif a == "move":
                coll[path]["parent"] = inp.get("parent")
            return {"ok": True, "item": coll[path]}
        if op == "remove":
            if coll[path].get("system"):
                return {"ok": False, "code": "denied", "message": "system list"}
            if command.get("confirm") != "tok":
                return {"ok": False, "code": "confirmation_required", "confirm": "tok"}
            del coll[path]
            return {"ok": True, "removed": 1}
        return {"ok": False, "code": "invalid"}


ctl = FakeControl()
plugin_services.provide("control@1", ctl, folder="token-control")

eq(c.post(f"{P}/lists/add", json={}).status_code, 400, "list name needed")
g = c.post(f"{P}/lists/add", json={"name": "Groceries"}).json()["item"]
w = c.post(f"{P}/lists/add", json={"name": "Work"}).json()["item"]
eq(c.post(f"{P}/lists/rename", json={"id": g["id"], "name": "Shopping"}).status_code, 200, "rename")
eq(c.post(f"{P}/lists/move", json={"id": g["id"], "parent": w["id"]}).status_code, 200, "move")
eq(ctl.lists[g["id"]]["parent"], w["id"], "moved inside")

m = c.post(f"{P}/items/add", json={"list": g["id"], "text": "milk"}).json()["item"]
eq(m["kind"], "todo", "items are to-dos by default")
e = c.post(f"{P}/items/add", json={"list": g["id"], "text": "eggs"}).json()["item"]
eq(c.post(f"{P}/items/edit", json={"id": e["id"], "text": "6 eggs"}).status_code, 200, "edit")
eq(c.post(f"{P}/items/edit", json={"id": e["id"]}).status_code, 400, "edit needs words")
eq(c.post(f"{P}/items/check", json={"id": m["id"], "done": True}).status_code, 200, "check")
r = c.get(f"{P}/list?id={g['id']}").json()
eq([i["text"] for i in r["items"]], ["6 eggs", "milk"], "checked last")
eq(r["list"]["path"], "Work / Shopping", "list path")
eq(c.get(f"{P}/export?id={g['id']}").json()["markdown"], "# Work / Shopping\n\n- [ ] 6 eggs\n- [x] milk\n", "export")
c.put(f"{P}/settings", json={"showChecked": False})
eq([i["text"] for i in c.get(f"{P}/list?id={g['id']}").json()["items"]], ["6 eggs"], "hide checked")
eq(c.get(f"{P}/list?id=nope").status_code, 404, "unknown list")

eq(c.post(f"{P}/items/remove", json={"id": e["id"]}).status_code, 409, "item remove asks")
eq(c.post(f"{P}/items/remove", json={"id": e["id"], "confirm": "tok"}).status_code, 200, "item removed")
eq(c.post(f"{P}/lists/remove", json={"id": "inbox", "confirm": "tok"}).status_code, 403, "system list kept")
eq(c.post(f"{P}/lists/remove", json={"id": w["id"]}).json().get("confirm"), "tok", "list remove asks")
eq(c.post(f"{P}/lists/remove", json={"id": w["id"], "confirm": "tok"}).status_code, 200, "list removed")

eq(c.put(f"{P}/settings", json={"itemKind": "task"}).status_code, 400, "itemKind range")
eq(c.put(f"{P}/settings", json={"itemKind": "note"}).json()["settings"]["itemKind"], "note", "itemKind set")
eq(c.post(f"{P}/items/add", json={"list": "inbox", "text": "idea"}).json()["item"]["kind"], "note", "kind from settings")

print("amberx-lists:", "ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
