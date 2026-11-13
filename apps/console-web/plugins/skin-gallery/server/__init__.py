"""Skins plugin server part, mounted at /api/plugins/skin-gallery/.

Every route runs the plugin CLI (skin-gallery.mjs, the skin-switch@1 engine over the framework's look documents), so
the REST API, MCP plugin commands, the CLI and voice make the same change. No second store: the documents are each
app's app-look@1 file and the shared appearance document, as the framework skins CLI writes them.

  GET  /skins                    every skin for the gallery (with the scopes each is in force at)
  GET  /scopes?app=              the scopes that can be switched
  GET  /state?scope=&app=        one scope: its own state, the skin in force and the level that decided, the undo
  POST /use      {skin, scope?, app?}
  POST /back     {scope?, slot?, app?}
  POST /restore  {scope?, app?}
  POST /undo     {app?}
  GET  /open?skin=&scope=        the console deep link (console_open screen target + arg)
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

router = APIRouter()

CLI = Path(__file__).resolve().parents[1] / "skin-gallery.mjs"
ROOT = CLI.parents[4]
SCOPE = re.compile(r"^(hub|app|app:[a-z0-9][a-z0-9-]*|(ui|plugin):[a-z0-9][a-z0-9._-]{0,119})$")
ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,119}$")
STATUS = {"unknown-skin": 404, "nothing-to-undo": 409, "no-document": 409, "other-app": 400, "bad-scope": 400, "bad-slot": 400, "no-skin": 400, "bad-action": 400}


def _run(*args: str) -> JSONResponse:
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        out: dict[str, Any] = json.loads(proc.stdout.strip().splitlines()[-1])
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as e:
        return JSONResponse({"ok": False, "error": f"skins CLI failed: {str(e)[:200]}"}, status_code=500)
    if out.get("ok"):
        return JSONResponse(out)
    code = str(out.get("code") or "")
    return JSONResponse(out, status_code=STATUS.get(code, 400))


def _bad(msg: str) -> JSONResponse:
    return JSONResponse({"ok": False, "error": msg, "code": "bad-request"}, status_code=400)


def _common(scope: str, app: str) -> list[str] | JSONResponse:
    args: list[str] = []
    if scope:
        if not SCOPE.match(scope):
            return _bad(f'"{scope}" is not a scope: hub, app, app:<id>, ui:<view> or plugin:<id>')
        args += ["--scope", scope]
    if app:
        if not ID.match(app):
            return _bad(f'"{app}" is not an app id')
        args += ["--app", app]
    return args


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001 - an empty or broken body reads as no fields
        return {}
    return b if isinstance(b, dict) else {}


def _str(b: dict[str, Any], k: str) -> str:
    v = b.get(k)
    return v.strip() if isinstance(v, str) else ""


@router.get("/skins")
def skins(app: str = "") -> JSONResponse:
    args = _common("", app)
    return args if isinstance(args, JSONResponse) else _run("list", *args)


@router.get("/scopes")
def scopes(app: str = "") -> JSONResponse:
    args = _common("", app)
    return args if isinstance(args, JSONResponse) else _run("scopes", *args)


@router.get("/state")
def state(scope: str = "app", app: str = "") -> JSONResponse:
    args = _common(scope, app)
    return args if isinstance(args, JSONResponse) else _run("state", *args)


@router.get("/open")
def open_link(skin: str = "", scope: str = "") -> JSONResponse:
    if skin and not ID.match(skin):
        return _bad(f'"{skin}" is not a skin id')
    args = _common(scope, "")
    if isinstance(args, JSONResponse):
        return args
    return _run("open", *([skin] if skin else []), *args)


@router.post("/use")
async def use(request: Request) -> JSONResponse:
    b = await _body(request)
    skin = _str(b, "skin")
    if not ID.match(skin):
        return _bad("use needs a skin id")
    args = _common(_str(b, "scope"), _str(b, "app"))
    return args if isinstance(args, JSONResponse) else _run("use", skin, *args)


@router.post("/back")
async def back(request: Request) -> JSONResponse:
    b = await _body(request)
    slot = _str(b, "slot")
    if slot and not ID.match(slot):
        return _bad(f'"{slot}" is not a slot')
    args = _common(_str(b, "scope"), _str(b, "app"))
    return args if isinstance(args, JSONResponse) else _run("back", *([slot] if slot else []), *args)


@router.post("/restore")
async def restore(request: Request) -> JSONResponse:
    b = await _body(request)
    args = _common(_str(b, "scope"), _str(b, "app"))
    return args if isinstance(args, JSONResponse) else _run("restore", *args)


@router.post("/undo")
async def undo(request: Request) -> JSONResponse:
    b = await _body(request)
    args = _common("", _str(b, "app"))
    return args if isinstance(args, JSONResponse) else _run("undo", *args)
