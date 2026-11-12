"""AmberX tasks (server part): to-dos and tasks. Mounted at /api/plugins/amberx-tasks/.

The AmberX web app's Tasks screen (to-dos and tasks), moved into the console (build
move-amberx-web-app-into-the-console-amberx-andr, s4; contract docs/contracts/amberx-console-api.md section 4.2). Every
to-do and task is an amberx-notes@1 item (kind todo or task) in hub project `amberx-axf`, read and written only through
control@1 (`amberx.items`) via the `control@1` capability service, so the page, REST, MCP and the CLI share one set of
rules. This plugin adds the screen's tabs as one read, reordering as one call, and the screen's settings.

  GET  state                         {settings, lists[], counts{today, upcoming, overdue, todo, all, done}}
  GET  items?tab=&list=&q=&limit=    the to-dos and tasks a tab shows (tab: today | upcoming | todo | all | done)
  POST add {text, kind?, list?, due?, priority?}     a new to-do (kind todo) or task
  POST complete {id, done?}          tick a to-do or task off (done false: open it again)
  POST reorder {ids[]}               put the items in this order (control@1 `set order` per item)
  POST remove {id, confirm?}         two-step delete: the first call answers confirmation_required with a token
  GET  settings · PUT settings {key: value} · POST settings/reset
  POST control {command}             one control@1 command on amberx.items / amberx.lists (the page's own writes)

The same is reached on control@1 directly: REST /api/control/amberx.items…, MCP amberx_* / control_*, CLI `axf todo …`,
`axf task …`. Hub admins and the console token (the console's wall).
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
    "defaultTab": ("enum", "today", ("today", "upcoming", "todo", "all", "done")),
    "defaultList": ("string", "inbox", None),
    "defaultKind": ("enum", "todo", ("todo", "task")),
    "pageSize": ("number", 100, (10, 500)),
    "overdueInToday": ("boolean", True, None),
}
TABS = ("today", "upcoming", "todo", "all", "done")
KINDS = ("todo", "task")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AMBERX_TASKS_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


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


def _fetch(by: str, lst: str = "", q: str = "") -> dict[str, Any]:
    """Every to-do and task (both kinds, any status) in a list / matching words: two control@1 reads."""
    rows: list[dict[str, Any]] = []
    for kind in KINDS:
        sel: dict[str, Any] = {"kind": kind, "limit": 500}
        if lst:
            sel.update({"list": lst, "deep": True})
        if q:
            sel["q"] = q
        r = control({"op": "list", "target": "amberx.items", "select": sel}, by)
        if not r.get("ok"):
            return r
        rows += r.get("items") or []
    return {"ok": True, "items": rows}


def in_tab(i: dict[str, Any], tab: str, overdue_in_today: bool = True) -> bool:
    done = i.get("status") == "done"
    if tab == "done":
        return done
    if done:
        return False
    if tab == "todo":
        return i.get("kind") == "todo"
    if tab == "today":
        return bool(i.get("due")) and (bucket(i["due"]) == "today" or (overdue_in_today and bucket(i["due"]) == "overdue"))
    if tab == "upcoming":
        return bool(i.get("due")) and bucket(i["due"]) == "upcoming"
    return True  # all: everything not done


def _items(by: str, tab: str, lst: str = "", q: str = "", limit: int = 500, overdue_in_today: bool = True) -> dict[str, Any]:
    """The to-dos and tasks one tab shows, in order (pinned first, then order, then due, then oldest)."""
    r = _fetch(by, lst, q)
    if not r.get("ok"):
        return r
    rows = [i for i in r["items"] if in_tab(i, tab, overdue_in_today)]
    rows.sort(key=lambda i: (not i.get("pinned"), i.get("order", 0), str(i.get("due") or "9999"), str(i.get("createdAt") or "")))
    return {"ok": True, "tab": tab, "items": rows[:limit], "total": len(rows)}


def bucket(due: str) -> str:
    """amberx-notes@1 dueBucket: overdue | today | upcoming (7 days) | later, by the console's local day."""
    import datetime as dt
    day = str(due)[:10]
    today = dt.date.today()
    if day < today.isoformat():
        return "overdue"
    if day == today.isoformat():
        return "today"
    return "upcoming" if day <= (today + dt.timedelta(days=7)).isoformat() else "later"


@router.get("/state")
async def state(request: Request) -> JSONResponse:
    s = read_settings()
    by = who(request)
    lists = await run_in_threadpool(control, {"op": "list", "target": "amberx.lists"}, by)
    if not lists.get("ok"):
        return answer(lists)
    r = await run_in_threadpool(_fetch, by)
    if not r.get("ok"):
        return answer(r)
    rows = r["items"]
    counts = {tab: sum(1 for i in rows if in_tab(i, tab, bool(s["overdueInToday"]))) for tab in TABS}
    counts["overdue"] = sum(1 for i in rows if i.get("status") != "done" and i.get("due") and bucket(i["due"]) == "overdue")
    return answer({"ok": True, "settings": s, "lists": lists.get("items") or [], "counts": counts})


@router.get("/items")
async def items(request: Request, tab: str = "", list: str = "", q: str = "", limit: int = 0) -> JSONResponse:  # noqa: A002
    s = read_settings()
    tab = tab or s["defaultTab"]
    if tab not in TABS:
        return answer({"ok": False, "code": "invalid", "message": f"tab is one of {', '.join(TABS)}"})
    n = max(1, min(int(limit or s["pageSize"]), 500))
    return answer(await run_in_threadpool(_items, who(request), tab, list[:120], q[:200], n, bool(s["overdueInToday"])))


@router.post("/add")
async def add(request: Request) -> JSONResponse:
    b = await body_of(request)
    s = read_settings()
    text = b.get("text")
    if not isinstance(text, str) or not text.strip():
        return answer({"ok": False, "code": "invalid", "message": "send { text, kind?: todo|task, list?, due?: YYYY-MM-DD, priority?: 0-3 }"})
    kind = b.get("kind") or s["defaultKind"]
    if kind not in KINDS:
        return answer({"ok": False, "code": "invalid", "message": "kind is todo or task"})
    value: dict[str, Any] = {"kind": kind, "text": text.strip(), "list": b.get("list") or s["defaultList"]}
    for k in ("due", "priority", "title", "tags"):
        if k in b:
            value[k] = b[k]
    by = who(request)
    return answer(await run_in_threadpool(control, {"op": "add", "target": "amberx.items", "value": value, "by": by, "reason": b.get("reason") or "add a to-do"}, by))


@router.post("/complete")
async def complete(request: Request) -> JSONResponse:
    b = await body_of(request)
    if not isinstance(b.get("id"), str):
        return answer({"ok": False, "code": "invalid", "message": "send { id, done?: true|false }"})
    by = who(request)
    action = "undone" if b.get("done") is False else "done"
    return answer(await run_in_threadpool(control, {"op": "act", "target": "amberx.items", "path": b["id"], "action": action, "by": by, "reason": b.get("reason") or f"mark {action}"}, by))


@router.post("/reorder")
async def reorder(request: Request) -> JSONResponse:
    b = await body_of(request)
    ids = b.get("ids")
    if not isinstance(ids, list) or not ids or not all(isinstance(x, str) for x in ids) or len(ids) > 500 or len(set(ids)) != len(ids):
        return answer({"ok": False, "code": "invalid", "message": "send { ids: [item id, …] } in the new order (no repeats, at most 500)"})
    by = who(request)

    def go() -> dict[str, Any]:
        for i, item_id in enumerate(ids):
            r = control({"op": "set", "target": "amberx.items", "path": item_id, "value": {"order": i}, "by": by, "reason": b.get("reason") or "reorder to-dos"}, by)
            if not r.get("ok"):
                return {**r, "reordered": i}
        return {"ok": True, "changed": True, "reordered": len(ids)}

    return answer(await run_in_threadpool(go))


@router.post("/remove")
async def remove(request: Request) -> JSONResponse:
    b = await body_of(request)
    if not isinstance(b.get("id"), str):
        return answer({"ok": False, "code": "invalid", "message": "send { id, confirm? }"})
    by = who(request)
    cmd: dict[str, Any] = {"op": "remove", "target": "amberx.items", "path": b["id"], "by": by, "reason": b.get("reason") or "delete a to-do"}
    if isinstance(b.get("confirm"), str):
        cmd["confirm"] = b["confirm"]
    return answer(await run_in_threadpool(control, cmd, by))


@router.post("/control")
async def run_control(request: Request) -> JSONResponse:
    b = await body_of(request)
    cmd = b.get("command") if isinstance(b.get("command"), dict) else b
    if not isinstance(cmd, dict) or cmd.get("target") not in TARGETS:
        return answer({"ok": False, "code": "invalid", "message": f"send {{command}} with target {' or '.join(TARGETS)}"})
    cmd = {**cmd, "by": cmd.get("by") or who(request)}
    return answer(await run_in_threadpool(control, cmd, cmd["by"]))
