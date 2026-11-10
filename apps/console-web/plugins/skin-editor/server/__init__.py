"""Skin editor, server part (skin-check@1). Mounted at /api/plugins/skin-editor/ (console token; 404 while disabled).

Every route runs the skin checker's one Node core (packages/skin-checker/src/core.ts, through bin/skin-check.mjs
`call <action> <json>`), the same handlers `axf skin …`, the MCP plugin commands and the AmberX voice intents reach,
so every surface gives the same JSON. State lives in the plugin's data folder (AXF_SKIN_EDITOR_DIR overrides it):
settings.json (skin-check-settings@1), results/<skin>.json (the last result per skin), assets/<type>/<id>.json
(fixed copies of assets; built-in asset files are never rewritten from the console).

  GET    checker/skins                    every skin and design package with its last score
  GET    checker/settings                 threshold settings (defaults filled in), flat view and changed keys
  PUT    checker/settings                 write settings: { settings: {key: value, rules: {...}} } or { key, value }
  DELETE checker/settings                 back to the defaults
  GET    checker/{skin}                   the last result (runs the check when there is none)  [state]
  POST   checker/{skin}/check             run the checker                                      [check]
  POST   checker/{skin}/fix               { issues: [issueId, ...] } apply those fixes           [fix]
  POST   checker/{skin}/fix-all           apply every fix the skin has                          [fix_all]
  POST   checker/{skin}/set               { token: '<type>:<id>/<path>', value } one token edit, re-check  [set]
  GET    checker/link?skin=&issue=        the deep link (console_show target skin-editor/checker)  [open]
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]
BIN = ROOT / "packages" / "skin-checker" / "bin" / "skin-check.mjs"
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}
MAX_BODY = 64 * 1024


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SKIN_EDITOR_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def core(action: str, args: dict[str, Any] | None = None, timeout: int = 120) -> dict[str, Any]:
    """One core action: `node bin/skin-check.mjs call <action> '<json>'` → its one JSON line."""
    env = {**os.environ, "AXF_SKIN_EDITOR_DIR": str(data_dir())}
    try:
        p = subprocess.run(["node", str(BIN), "call", action, json.dumps(args or {})], cwd=ROOT, env=env, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the skin checker could not run: {str(e)[:200]}"}
    lines = [ln for ln in p.stdout.strip().splitlines() if ln.startswith("{")]
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unavailable", "message": (p.stderr.strip()[-400:] or "no output")}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unavailable", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def _body(request: Request) -> dict[str, Any] | None:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return None
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return None
    return body if isinstance(body, dict) else None


def _bad_body() -> JSONResponse:
    return answer({"ok": False, "code": "invalid", "message": f"send a JSON object (at most {MAX_BODY // 1024} KB)"})


@router.get("/checker/skins")
async def skins() -> JSONResponse:
    return answer(await run_in_threadpool(core, "skins"))


@router.get("/checker/settings")
async def settings_get(schema: bool = False) -> JSONResponse:
    return answer(await run_in_threadpool(core, "settings_get", {"schema": schema}))


@router.put("/checker/settings")
async def settings_set(request: Request) -> JSONResponse:
    body = await _body(request)
    if body is None:
        return _bad_body()
    return answer(await run_in_threadpool(core, "settings_set", body))


@router.delete("/checker/settings")
async def settings_reset() -> JSONResponse:
    return answer(await run_in_threadpool(core, "settings_reset"))


@router.get("/checker/link")
async def link(skin: str = "", issue: str = "") -> JSONResponse:
    return answer(await run_in_threadpool(core, "open", {"skin": skin, "issue": issue}))


@router.get("/checker/{skin}")
async def state(skin: str) -> JSONResponse:
    return answer(await run_in_threadpool(core, "state", {"skin": skin}))


@router.post("/checker/{skin}/check")
async def check(skin: str) -> JSONResponse:
    return answer(await run_in_threadpool(core, "check", {"skin": skin}))


@router.post("/checker/{skin}/fix")
async def fix(skin: str, request: Request) -> JSONResponse:
    body = await _body(request)
    if body is None:
        return _bad_body()
    return answer(await run_in_threadpool(core, "fix", {"skin": skin, "issues": body.get("issues"), "issue": body.get("issue")}))


@router.post("/checker/{skin}/fix-all")
async def fix_all(skin: str) -> JSONResponse:
    return answer(await run_in_threadpool(core, "fix_all", {"skin": skin}))


@router.post("/checker/{skin}/set")
async def set_token(skin: str, request: Request) -> JSONResponse:
    body = await _body(request)
    if body is None:
        return _bad_body()
    return answer(await run_in_threadpool(core, "set", {"skin": skin, "token": body.get("token"), "value": body.get("value")}))
