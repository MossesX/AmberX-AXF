"""AmberX lists (server part). Mounted at /api/plugins/amberx-lists/.

The AmberX web app's Lists screen, moved into the console (build move-amberx-web-app-into-the-console-amberx-andr, s5;
contract docs/contracts/amberx-console-api.md section 4.2, C8 and C12). Lists and the items in them are amberx-notes@1
rows in hub project `amberx-axf`, read and written only through control@1 (`amberx.lists`, `amberx.items`) via the
`control@1` capability service. System lists (Inbox, Plugins, Voice notes) are renamed, never removed (control@1 refuses).

  GET  state                               {settings, lists[]}: the tree with item counts
  GET  list?id=                            one list and the items in it (checked last when the setting says so)
  GET  export?id=                          the list as Markdown ({ok, markdown})
  POST lists/add {name, parent?}           a new list
  POST lists/rename {id, name} · POST lists/move {id, parent} · POST lists/remove {id, confirm?}  (two-step)
  POST items/add {list, text, kind?}       a new item in a list (kind from the settings: todo, so it can be ticked)
  POST items/edit {id, text?, title?}      change an item's words
  POST items/check {id, done}              tick an item off / untick it
  POST items/remove {id, confirm?}         two-step delete
  GET  settings · PUT settings {key: value} · POST settings/reset
  POST control {command}                   one control@1 command on amberx.items / amberx.lists (the page's own writes)

The same is reached on control@1 directly: REST /api/control/amberx.lists…, MCP control_*(target="amberx.lists"),
CLI `axf list …`. Hub admins and the console token (the console's wall).
"""
from __future__ import annotations

import json
import os
import tempfile
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]
MAX_BODY = 256 * 1024
TARGETS = ("amberx.items", "amberx.lists")
STATUS = {"invalid": 400, "validation": 400, "not_found": 404, "denied": 403, "confirmation_required": 409, "unavailable": 503}

# key: (kind, default, allowed) — allowed is a tuple of choices or a (min, max) range for numbers
SETTINGS: dict[str, tuple[str, Any, Any]] = {
    "itemKind": ("enum", "todo", ("todo", "note")),
    "showChecked": ("boolean", True, None),
    "checkedLast": ("boolean", True, None),
    "showEmpty": ("boolean", True, None),
}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AMBERX_LISTS_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def read_settings() -> dict[str, Any]:
    out = {k: d for k, (_, d, _) in SETTINGS.items()}
    try:
        saved = json.loads((data_dir() / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    if isinstance(saved, dict):
        for k, v in saved.items():
            if k in SETTINGS and check(k, v) is None:
                out[k] = v
    return out


def check(key: str, v: Any) -> str | None:
    """None when `v` is a valid value for `key`, else why not."""
    if key not in SETTINGS:
        return f"no setting {key} ({', '.join(SETTINGS)})"
    kind, _, allowed = SETTINGS[key]
    if kind == "boolean" and not isinstance(v, bool):
        return f"{key} is true or false"
    if kind == "number":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not allowed[0] <= v <= allowed[1]:
            return f"{key} is a number from {allowed[0]} to {allowed[1]}"
    if kind == "enum" and v not in allowed:
        return f"{key} is one of {', '.join(allowed)}"
    if kind == "string" and (not isinstance(v, str) or not 0 < len(v) <= 120):
        return f"{key} is a short text"
    return None


def write_settings(s: dict[str, Any]) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=d, prefix=".settings-")
    with os.fdopen(fd, "w") as f:
        json.dump(s, f, indent=1)
    os.replace(tmp, d / "settings.json")


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


async def body_of(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return {}
    try:
        b = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return b if isinstance(b, dict) else {}


def control(command: dict[str, Any], by: str) -> dict[str, Any]:
    svc = plugin_services.get("control@1")
    if svc is None:
        return {"ok": False, "code": "unavailable", "message": "control@1 is not installed or is switched off on this console (Token control)"}
    return svc.run(command, ["*"], by)


@router.get("/settings")
def get_settings() -> JSONResponse:
    return answer({"ok": True, "settings": read_settings(), "defaults": {k: d for k, (_, d, _) in SETTINGS.items()}})


@router.put("/settings")
async def put_settings(request: Request) -> JSONResponse:
    b = await body_of(request)
    if not b:
        return answer({"ok": False, "code": "invalid", "message": "send { key: value } (" + ", ".join(SETTINGS) + ")"})
    for k, v in b.items():
        why = check(k, v)
        if why:
            return answer({"ok": False, "code": "invalid", "message": why})
    s = {**read_settings(), **b}
    write_settings(s)
    return answer({"ok": True, "settings": s, "changed": sorted(b)})


@router.post("/settings/reset")
def reset_settings() -> JSONResponse:
    s = {k: d for k, (_, d, _) in SETTINGS.items()}
    write_settings(s)
    return answer({"ok": True, "settings": s})


def _go(command: dict[str, Any], by: str, reason: str) -> dict[str, Any]:
    return control({**command, "by": by, "reason": reason}, by)


def need_str(b: dict[str, Any], *keys: str) -> str | None:
    for k in keys:
        if not isinstance(b.get(k), str) or not b[k].strip():
            return f"send {{ {', '.join(keys)} }}"
    return None


def list_items(by: str, list_id: str, s: dict[str, Any]) -> dict[str, Any]:
    head = control({"op": "get", "target": "amberx.lists", "path": list_id}, by)
    if not head.get("ok"):
        return head
    r = control({"op": "list", "target": "amberx.items", "select": {"list": list_id, "limit": 500}}, by)
    if not r.get("ok"):
        return r
    rows = r.get("items") or []
    if not s["showChecked"]:
        rows = [i for i in rows if i.get("status") != "done"]
    rows.sort(key=lambda i: ((i.get("status") == "done") if s["checkedLast"] else False, i.get("order", 0)))
    return {"ok": True, "list": head.get("item"), "items": rows, "total": len(rows)}


def markdown(lst: dict[str, Any], rows: list[dict[str, Any]]) -> str:
    out = [f"# {lst.get('path') or lst.get('name') or lst.get('id')}", ""]
    for i in rows:
        words = (i.get("title") or i.get("text") or "").strip().replace("\n", " ")
        box = "[x]" if i.get("status") == "done" else "[ ]"
        out.append(f"- {box} {words}" if i.get("kind") in ("todo", "task") else f"- {words}")
    return "\n".join(out) + "\n"


@router.get("/state")
async def state(request: Request) -> JSONResponse:
    s = read_settings()
    r = await run_in_threadpool(control, {"op": "list", "target": "amberx.lists"}, who(request))
    if not r.get("ok"):
        return answer(r)
    rows = r.get("items") or []
    if not s["showEmpty"]:
        rows = [x for x in rows if x.get("items") or x.get("system")]
    return answer({"ok": True, "settings": s, "lists": rows, "total": len(rows)})


@router.get("/list")
async def one_list(request: Request, id: str = "") -> JSONResponse:  # noqa: A002
    if not id:
        return answer({"ok": False, "code": "invalid", "message": "send ?id=<list id>"})
    return answer(await run_in_threadpool(list_items, who(request), id[:120], read_settings()))


@router.get("/export")
async def export(request: Request, id: str = "") -> JSONResponse:  # noqa: A002
    if not id:
        return answer({"ok": False, "code": "invalid", "message": "send ?id=<list id>"})
    r = await run_in_threadpool(list_items, who(request), id[:120], {**read_settings(), "showChecked": True})
    if not r.get("ok"):
        return answer(r)
    return answer({"ok": True, "id": id, "markdown": markdown(r["list"] or {}, r["items"])})


@router.post("/lists/add")
async def lists_add(request: Request) -> JSONResponse:
    b = await body_of(request)
    if (why := need_str(b, "name")):
        return answer({"ok": False, "code": "invalid", "message": why + " (parent? = a list id)"})
    value: dict[str, Any] = {"name": b["name"].strip()}
    if isinstance(b.get("parent"), str) and b["parent"]:
        value["parent"] = b["parent"]
    return answer(await run_in_threadpool(_go, {"op": "add", "target": "amberx.lists", "value": value}, who(request), "add a list"))


@router.post("/lists/rename")
async def lists_rename(request: Request) -> JSONResponse:
    b = await body_of(request)
    if (why := need_str(b, "id", "name")):
        return answer({"ok": False, "code": "invalid", "message": why})
    return answer(await run_in_threadpool(_go, {"op": "act", "target": "amberx.lists", "path": b["id"], "action": "rename", "input": {"name": b["name"].strip()}}, who(request), "rename a list"))


@router.post("/lists/move")
async def lists_move(request: Request) -> JSONResponse:
    b = await body_of(request)
    if (why := need_str(b, "id")):
        return answer({"ok": False, "code": "invalid", "message": why + " (parent: a list id, or null for the top)"})
    parent = b.get("parent") if isinstance(b.get("parent"), str) and b.get("parent") else None
    return answer(await run_in_threadpool(_go, {"op": "act", "target": "amberx.lists", "path": b["id"], "action": "move", "input": {"parent": parent}}, who(request), "move a list"))


@router.post("/lists/remove")
async def lists_remove(request: Request) -> JSONResponse:
    b = await body_of(request)
    if (why := need_str(b, "id")):
        return answer({"ok": False, "code": "invalid", "message": why + " (confirm? from the first answer)"})
    cmd: dict[str, Any] = {"op": "remove", "target": "amberx.lists", "path": b["id"]}
    if isinstance(b.get("confirm"), str):
        cmd["confirm"] = b["confirm"]
    return answer(await run_in_threadpool(_go, cmd, who(request), "delete a list"))


@router.post("/items/add")
async def items_add(request: Request) -> JSONResponse:
    b = await body_of(request)
    if (why := need_str(b, "list", "text")):
        return answer({"ok": False, "code": "invalid", "message": why + " (kind? todo|note)"})
    kind = b.get("kind") or read_settings()["itemKind"]
    if kind not in ("todo", "note", "task"):
        return answer({"ok": False, "code": "invalid", "message": "kind is todo, note or task"})
    value = {"kind": kind, "text": b["text"].strip(), "list": b["list"]}
    return answer(await run_in_threadpool(_go, {"op": "add", "target": "amberx.items", "value": value}, who(request), "add to a list"))


@router.post("/items/edit")
async def items_edit(request: Request) -> JSONResponse:
    b = await body_of(request)
    value = {k: b[k] for k in ("text", "title") if isinstance(b.get(k), str)}
    if not isinstance(b.get("id"), str) or not value:
        return answer({"ok": False, "code": "invalid", "message": "send { id, text?, title? }"})
    return answer(await run_in_threadpool(_go, {"op": "set", "target": "amberx.items", "path": b["id"], "value": value}, who(request), "edit a list item"))


@router.post("/items/check")
async def items_check(request: Request) -> JSONResponse:
    b = await body_of(request)
    if not isinstance(b.get("id"), str):
        return answer({"ok": False, "code": "invalid", "message": "send { id, done?: true|false }"})
    action = "undone" if b.get("done") is False else "done"
    return answer(await run_in_threadpool(_go, {"op": "act", "target": "amberx.items", "path": b["id"], "action": action}, who(request), f"list item {action}"))


@router.post("/items/remove")
async def items_remove(request: Request) -> JSONResponse:
    b = await body_of(request)
    if not isinstance(b.get("id"), str):
        return answer({"ok": False, "code": "invalid", "message": "send { id, confirm? }"})
    cmd: dict[str, Any] = {"op": "remove", "target": "amberx.items", "path": b["id"]}
    if isinstance(b.get("confirm"), str):
        cmd["confirm"] = b["confirm"]
    return answer(await run_in_threadpool(_go, cmd, who(request), "delete a list item"))


@router.post("/control")
async def run_control(request: Request) -> JSONResponse:
    b = await body_of(request)
    cmd = b.get("command") if isinstance(b.get("command"), dict) else b
    if not isinstance(cmd, dict) or cmd.get("target") not in TARGETS:
        return answer({"ok": False, "code": "invalid", "message": f"send {{command}} with target {' or '.join(TARGETS)}"})
    cmd = {**cmd, "by": cmd.get("by") or who(request)}
    return answer(await run_in_threadpool(control, cmd, cmd["by"]))
