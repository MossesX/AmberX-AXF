"""Molly menus and skin without the UI (flagship skin s10). Mounted at /api/plugins/molly-menus/.

The work is done by ../molly.mjs (Molly's look document on axHub, its menu assets, its deep links); these routes are
its REST face, and plugin-commands@1 projects them to MCP tools (molly-menus_*), the CLI (axf molly-menus …) and voice.
Per-item behaviour and look overrides go through the control@1 capability service (target tokens.menu), never a folder.

  GET    /state                     skin, choices with current values, live status, deep links
  GET    /tree?root=app-menu|context-menu   the menus: path, kind, action, current value, status source, links
  GET    /choices                   the look choices and their values
  PUT    /choices/{choice}          {value}: set skin, mode, density, text or motion (applies in Molly at once)
  GET    /skin                      the skin in force
  PUT    /skin                      {skin}: a skin id, or "own" for Molly's own look
  POST   /invoke                    {path, value?, payload?}: run a menu item (a choice is set; else the deep link that runs it)
  GET    /links                     deep links: skin picker, app menu, each sub-menu, item settings, set, do
  GET    /status                    live status: axHub, look document, skin
  GET    /items/overrides           every per-item override (control@1 tokens.menu)
  PUT    /items/overrides           {path, token, value}: set one token of one menu row
  DELETE /items/overrides           {path?, token?}: reset one token, one row, or every override (confirm)
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services

router = APIRouter()
FOLDER = "molly-menus"
CLI = Path(__file__).resolve().parent.parent / "molly.mjs"
ROOT = CLI.parents[4]
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "confirmation_required": 409, "not_implemented": 501, "unexpected": 500}


def _node(*args: str) -> JSONResponse:
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        out = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return JSONResponse({"ok": False, "code": "unexpected", "message": str(e)[:200]}, status_code=500)
    if not out.get("ok"):
        return JSONResponse(out, status_code=STATUS.get(str(out.get("code")), 500))
    return JSONResponse(out)


async def _run(*args: str) -> JSONResponse:
    return await run_in_threadpool(_node, *args)


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (ValueError, json.JSONDecodeError):
        return {}
    return b if isinstance(b, dict) else {}


def _str(v: Any) -> str:
    return v if isinstance(v, str) else "" if v is None else json.dumps(v) if not isinstance(v, (int, float, bool)) else str(v).lower() if isinstance(v, bool) else str(v)


@router.get("/state")
async def get_state() -> JSONResponse:
    return await _run("state")


@router.get("/tree")
async def get_tree(root: str = "") -> JSONResponse:
    return await _run("tree", root) if root else await _run("tree")


@router.get("/choices")
async def get_choices() -> JSONResponse:
    return await _run("choices")


@router.put("/choices/{choice}")
async def set_choice(choice: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return await _run("set", choice, _str(b.get("value")))


@router.get("/skin")
async def get_skin() -> JSONResponse:
    return await _run("skin")


@router.put("/skin")
async def set_skin(request: Request) -> JSONResponse:
    b = await _body(request)
    return await _run("skin", _str(b.get("skin")) or "own")


@router.post("/invoke")
async def invoke(request: Request) -> JSONResponse:
    b = await _body(request)
    return await _run("invoke", _str(b.get("path")), _str(b.get("value")), _str(b.get("payload")))


@router.get("/links")
async def get_links() -> JSONResponse:
    return await _run("links")


@router.get("/status")
async def get_status() -> JSONResponse:
    return await _run("status")


def _control(command: dict[str, Any], by: str) -> JSONResponse:
    svc = plugin_services.get("control@1")
    if svc is None:
        return JSONResponse({"ok": False, "code": "not_implemented", "message": "per-item overrides need the control@1 service (Token control plugin)"}, status_code=501)
    r = svc.run(command, by=by)
    return JSONResponse(r, status_code=200 if r.get("ok", True) else STATUS.get(str(r.get("code")), 500))


@router.get("/items/overrides")
async def list_overrides() -> JSONResponse:
    return await run_in_threadpool(_control, {"op": "list", "target": "tokens.menu"}, "molly-menus")


@router.put("/items/overrides")
async def set_override(request: Request) -> JSONResponse:
    b = await _body(request)
    path, token = _str(b.get("path")), _str(b.get("token"))
    if not path or not token:
        return JSONResponse({"ok": False, "code": "validation", "message": "path (a menu item path, e.g. app-menu/molly/apps) and token (label, icon, hint, visible, tone, …) are needed"}, status_code=422)
    return await run_in_threadpool(_control, {"op": "set", "target": "tokens.menu", "path": f"{path}@{token}", "value": b.get("value")}, "molly-menus")


@router.delete("/items/overrides")
async def reset_override(request: Request) -> JSONResponse:
    b = await _body(request)
    path, token = _str(b.get("path")), _str(b.get("token"))
    cmd: dict[str, Any] = {"op": "reset", "target": "tokens.menu", "confirm": _str(b.get("confirm"))}
    if path:
        cmd["path"] = f"{path}@{token}" if token else path
    return await run_in_threadpool(_control, cmd, "molly-menus")
