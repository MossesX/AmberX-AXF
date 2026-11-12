"""AmberX notes (server part). Mounted at /api/plugins/amberx-notes/.

The AmberX web app's Notes screen, moved into the console (build move-amberx-web-app-into-the-console-amberx-andr, s3;
contract docs/contracts/amberx-console-api.md section 4.2). The notes themselves are amberx-notes@1 rows in hub project
`amberx-axf` and are read and written only through control@1 (`amberx.items`, `amberx.lists`), reached through the
`control@1` capability service, so the console page, REST, MCP and the CLI apply the same rules and the same confirm
tokens. This plugin adds the page's settings (kept in its data folder) and one read that gathers the page's state.

  GET  state                   {settings, lists[], total, recent[]}: what the Notes screen shows first
  GET  settings                the page settings
  PUT  settings {key: value}   change one or more settings (unknown keys and bad values answer 400)
  POST settings/reset          back to the defaults
  POST control {command}       one control@1 command on amberx.items / amberx.lists (the page's own writes)

Item verbs stay on control@1 itself: REST /api/control/amberx.items…, MCP amberx_* / control_*, CLI `axf note …`.
Hub admins and the console token (the console's wall); a plain hub user gets 403 from the console itself.
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
    "defaultList": ("string", "inbox", None),
    "pageSize": ("number", 50, (10, 500)),
    "sort": ("enum", "updated", ("updated", "created", "title")),
    "showDone": ("boolean", False, None),
    "preview": ("boolean", True, None),
}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AMBERX_NOTES_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


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


@router.get("/state")
async def state(request: Request) -> JSONResponse:
    s = read_settings()
    by = who(request)
    lists = await run_in_threadpool(control, {"op": "list", "target": "amberx.lists"}, by)
    if not lists.get("ok"):
        return answer(lists)
    sel: dict[str, Any] = {"kind": "note", "limit": 10}
    notes = await run_in_threadpool(control, {"op": "list", "target": "amberx.items", "select": sel}, by)
    if not notes.get("ok"):
        return answer(notes)
    return answer({"ok": True, "settings": s, "lists": lists.get("items") or [], "total": notes.get("total", 0), "recent": notes.get("items") or []})


@router.post("/control")
async def run_control(request: Request) -> JSONResponse:
    b = await body_of(request)
    cmd = b.get("command") if isinstance(b.get("command"), dict) else b
    if not isinstance(cmd, dict) or cmd.get("target") not in TARGETS:
        return answer({"ok": False, "code": "invalid", "message": f"send {{command}} with target {' or '.join(TARGETS)}"})
    cmd = {**cmd, "by": cmd.get("by") or who(request)}
    return answer(await run_in_threadpool(control, cmd, cmd["by"]))
