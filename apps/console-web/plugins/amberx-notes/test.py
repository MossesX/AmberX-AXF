"""AmberX notes server part: settings (read, change, bad values 400, reset), state over the control@1 capability, the
page's control relay limited to amberx.items / amberx.lists, and an answer when control@1 is missing.

    python apps/console-web/plugins/amberx-notes/test.py
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
os.environ["AXF_AMBERX_NOTES_DATA_DIR"] = tempfile.mkdtemp(prefix="axf-amberx-notes-")

import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("amberx_notes_server", HERE / "server" / "__init__.py")
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


app.include_router(mod.router, prefix="/api/plugins/amberx-notes")
c = TestClient(app)
fails = 0


def eq(a: Any, b: Any, what: str) -> None:
    global fails
    if a != b:
        fails += 1
        print(f"FAIL {what}: {a!r} != {b!r}")


class FakeControl:
    """An in-memory control@1 for amberx.items / amberx.lists (the real one is the Token control plugin's)."""

    def __init__(self) -> None:
        self.calls: list[tuple[dict[str, Any], str]] = []
        self.items: dict[str, dict[str, Any]] = {}

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        self.calls.append((command, by))
        op, target = command.get("op"), command.get("target")
        if target == "amberx.lists" and op == "list":
            return {"ok": True, "items": [{"id": "inbox", "name": "Inbox", "path": "Inbox", "items": len(self.items)}], "total": 1}
        if target == "amberx.items" and op == "list":
            rows = list(self.items.values())
            return {"ok": True, "items": rows, "total": len(rows)}
        if target == "amberx.items" and op == "add":
            it = {"id": f"n{len(self.items) + 1}", "kind": "note", **(command.get("value") or {})}
            self.items[it["id"]] = it
            return {"ok": True, "changed": True, "item": it}
        if target == "amberx.items" and op == "remove":
            if not command.get("confirm"):
                return {"ok": False, "code": "confirmation_required", "confirm": "tok"}
            self.items.pop(command.get("path"), None)
            return {"ok": True, "removed": 1}
        return {"ok": False, "code": "invalid", "message": "unsupported"}


# no control@1 yet: a clear 503
r = c.get("/api/plugins/amberx-notes/state")
eq(r.status_code, 503, "state without control@1")

ctl = FakeControl()
plugin_services.provide("control@1", ctl, folder="token-control")

r = c.get("/api/plugins/amberx-notes/settings")
eq(r.status_code, 200, "settings read")
eq(r.json()["settings"]["pageSize"], 50, "default page size")

r = c.put("/api/plugins/amberx-notes/settings", json={"pageSize": 100, "sort": "title"})
eq(r.status_code, 200, "settings write")
eq(c.get("/api/plugins/amberx-notes/settings").json()["settings"]["sort"], "title", "settings kept")
eq(c.put("/api/plugins/amberx-notes/settings", json={"pageSize": 5}).status_code, 400, "page size range")
eq(c.put("/api/plugins/amberx-notes/settings", json={"nope": 1}).status_code, 400, "unknown setting")
eq(c.put("/api/plugins/amberx-notes/settings", json={"showDone": "yes"}).status_code, 400, "boolean setting")
eq(c.post("/api/plugins/amberx-notes/settings/reset").json()["settings"]["sort"], "updated", "reset")

r = c.post("/api/plugins/amberx-notes/control", json={"command": {"op": "add", "target": "amberx.items", "value": {"kind": "note", "text": "milk"}}})
eq(r.status_code, 200, "add through the relay")
eq(ctl.calls[-1][1], "console:brett", "by is the signed-in person")
eq(c.post("/api/plugins/amberx-notes/control", json={"command": {"op": "set", "target": "tokens.theme", "path": "accent", "value": "x"}}).status_code, 400, "relay refuses other targets")

r = c.post("/api/plugins/amberx-notes/control", json={"command": {"op": "remove", "target": "amberx.items", "path": "n1"}})
eq(r.status_code, 409, "remove asks to confirm")
r = c.post("/api/plugins/amberx-notes/control", json={"command": {"op": "remove", "target": "amberx.items", "path": "n1", "confirm": r.json()["confirm"]}})
eq(r.status_code, 200, "remove with the confirm token")

r = c.get("/api/plugins/amberx-notes/state")
eq(r.status_code, 200, "state")
eq([x["id"] for x in r.json()["lists"]], ["inbox"], "state lists")

print("amberx-notes:", "ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
