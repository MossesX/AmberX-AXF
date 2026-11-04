"""App style (server part): every app's design / colours over axHub's look (app-style@1), as REST routes; the
console's plugin commands turn them into MCP tools (app_style_*) and CLI commands (axf app-style …) by themselves.

Every route runs the plugin's Node runner (`appstyle.mjs`), the same code as its CLI, on the shared look document.

  GET  /get?app=                    every app (or one): inheriting or overriding, axHub's value and the app's own
  POST /override {app, part, on, theme?}   override axHub's design or colours in one app (theme = its own pick)
  POST /reload {app, reset?}        every open app re-reads axHub's look now; reset also drops the app's overrides
  POST /save-to-axhub {app, parts}  Brett only: the app's own design / colours become axHub's look (versioned)
  POST /restore                     Brett only: take back the newest Save to axHub

"Brett only" = his own signed-in click in the console (a hub admin session, no agent headers). The console token, MCP
callers, agents and Claude sessions are refused with a plain reason (403).
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "appstyle.mjs"
ROOT = CLI.parents[4]
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
STATUS = {"invalid": 400, "denied": 403, "not_found": 404, "validation": 422}


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def _run(*args: str, approver: str = "") -> JSONResponse:
    env = {k: v for k, v in os.environ.items() if k != "AXF_APPROVER"}  # never inherited: only Brett's click sets it
    if approver:
        env["AXF_APPROVER"] = approver
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30, env=env)
    except (OSError, subprocess.TimeoutExpired) as e:
        return JSONResponse({"ok": False, "code": "unexpected", "error": str(e)[:200]}, status_code=500)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "code": "unexpected", "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "code": "unexpected", "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return JSONResponse(res, status_code=200 if res.get("ok") else STATUS.get(res.get("code", ""), 500))


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 4096:
        raise HTTPException(413, "body too large")
    try:
        b = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(b, dict):
        raise HTTPException(400, "a JSON object is needed")
    return b.get("input") if isinstance(b.get("input"), dict) else b


def _str(v: Any, n: int = 80) -> str:
    return str(v)[:n] if isinstance(v, (str, int)) else ""


@router.get("/get")
def get(app: str = "") -> JSONResponse:
    """Every app's style (or one app's): whether its design and colours inherit axHub's look or override it, axHub's value and its own."""
    return _run("get", *(["--app", app[:80]] if app else []))


@router.post("/override")
async def override(request: Request) -> JSONResponse:
    """Override axHub's design or colours in one app (on), or follow axHub again (off). Body {app, part: design|colors, on: bool, theme?: asset id}."""
    b = await _body(request)
    args = ["override", "--app", _str(b.get("app")), "--part", _str(b.get("part"), 20), "--on" if b.get("on") in (True, "on", "true", 1) else "--off", "--by", _str(b.get("by")) or "console"]
    if b.get("theme"):
        args += ["--theme", _str(b.get("theme"))]
    return _run(*args)


@router.post("/reload")
async def reload(request: Request) -> JSONResponse:
    """Every open app re-reads axHub's look now. Body {app, reset?: true to also drop that app's overrides}."""
    b = await _body(request)
    args = ["reload", "--app", _str(b.get("app")), "--by", _str(b.get("by")) or "console"]
    if b.get("reset") in (True, "true", 1):
        args.append("--reset")
    return _run(*args)


@router.post("/save-to-axhub")
async def save_to_axhub(request: Request) -> JSONResponse:
    """Brett only: an app's own design and/or colours become axHub's look for every app that inherits them (the previous style is kept for restore). Body {app, parts: design,colors}."""
    b = await _body(request)
    parts = b.get("parts")
    parts = ",".join(p for p in parts if isinstance(p, str)) if isinstance(parts, list) else _str(parts, 40)
    return _run("save", "--app", _str(b.get("app")), "--parts", parts, approver=brett_click(request))


@router.post("/restore")
async def restore(request: Request) -> JSONResponse:
    """Brett only: take back the newest Save to axHub (the previous axHub style returns for every app that inherits it)."""
    return _run("restore", approver=brett_click(request))
