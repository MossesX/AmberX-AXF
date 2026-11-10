"""Inline edit (server part): every route runs the plugin's Node runner (`engine.mjs run`), the same code the plugin
commands (REST /api/control/inline-edit/…, MCP inline-edit_*, `axf inline-edit …`) and the AmberX voice commands reach,
so every surface answers the same.

Mounted at /api/plugins/inline-edit/ (console token on every route, like every plugin):

  GET  mode                          the master switch "Inline edit mode" { on, by, at }
  PUT  mode                          { state: on | off | toggle | status }
  GET  tokens?path=&scope=           every token of the element and each parent: value, axHub value, where it comes from
  PUT  tokens                        { path, token, value, scope?: item | parent, reason?, app? }  one override
  POST tokens/unset                  { path, token, scope? }  revert one token to axHub
  GET  element                       the edit dialog's state (path, scope, view), per user
  PUT  element                       { path?, scope?, view?: tree | classic | grid }
  GET  overrides?root=&q=&filter=&tab=   the overrides list (items, tree, roots, tabs, facets)
  PUT  overrides/state               { q?, filter?, root?, tab? }  search, filter, select a root or a tab (per user)
  POST overrides/tabs                { root, label? }  add a tab with its own root
  POST overrides/tabs/close          { id }  close (remove) a tab
  POST overrides/reset               { id }  reset one item to axHub (only that record)
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
ENGINE = Path(__file__).resolve().parent.parent / "engine.mjs"
ROOT = ENGINE.parents[4]
STATUS = {"invalid": 400, "validation": 422, "not_found": 404, "unexpected": 500}


def run(op: str, data: dict[str, Any] | None = None, user: str = "", by: str = "") -> dict[str, Any]:
    """One engine operation → its answer ({ok, data} or {ok: false, code, message})."""
    body = json.dumps({"op": op, "input": data or {}, "user": user, "by": by})
    try:
        proc = subprocess.run(["node", str(ENGINE), "run"], input=body, cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unexpected", "message": f"the inline edit runner could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": proc.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (proc.stderr or proc.stdout).strip()[-400:]}


def _who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", "") if u is not None else ""
    return str(name or "brett")[:80]


async def _answer(request: Request, op: str, data: dict[str, Any]) -> Any:
    who = _who(request)
    by = str(data.pop("by", "") or who)[:80]
    r = await run_in_threadpool(run, op, data, who, by)
    if r.get("ok"):
        return r.get("data")
    return JSONResponse({"detail": r.get("message", "failed"), "code": r.get("code", "unexpected")}, status_code=STATUS.get(r.get("code", ""), 500))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (ValueError, json.JSONDecodeError):
        b = {}
    if isinstance(b, dict) and isinstance(b.get("input"), dict):  # a control@1 envelope
        b = {**b["input"], **({"by": b["by"]} if b.get("by") else {})}
    return b if isinstance(b, dict) else {}


@router.get("/mode")
async def get_mode(request: Request) -> Any:
    return await _answer(request, "mode.get", {})


@router.put("/mode")
async def put_mode(request: Request) -> Any:
    return await _answer(request, "mode.set", await _body(request))


@router.get("/tokens")
async def get_tokens(request: Request, path: str = "", scope: str = "") -> Any:
    """Every token of the element and each parent (query parameters are declared so plugin commands pass them)."""
    return await _answer(request, "tokens.get", {k: v for k, v in {"path": path, "scope": scope}.items() if v})


@router.put("/tokens")
async def put_token(request: Request) -> Any:
    return await _answer(request, "token.set", await _body(request))


@router.post("/tokens/unset")
async def unset_token(request: Request) -> Any:
    return await _answer(request, "token.unset", await _body(request))


@router.get("/element")
async def get_element(request: Request) -> Any:
    return await _answer(request, "element.get", {})


@router.put("/element")
async def put_element(request: Request) -> Any:
    return await _answer(request, "element.set", await _body(request))


@router.get("/overrides")
async def get_overrides(request: Request, root: Optional[str] = None, q: Optional[str] = None, filter: Optional[str] = None, tab: Optional[str] = None) -> Any:  # noqa: A002
    """The overrides list; a parameter left out = the user's saved state."""
    sent = {"root": root, "q": q, "filter": filter, "tab": tab}
    return await _answer(request, "overrides.list", {k: v for k, v in sent.items() if v is not None})


@router.put("/overrides/state")
async def put_overrides_state(request: Request) -> Any:
    return await _answer(request, "overrides.state", await _body(request))


@router.post("/overrides/tabs")
async def add_tab(request: Request) -> Any:
    return await _answer(request, "overrides.tab.add", await _body(request))


@router.post("/overrides/tabs/close")
async def remove_tab(request: Request) -> Any:
    return await _answer(request, "overrides.tab.remove", await _body(request))


@router.post("/overrides/reset")
async def reset_item(request: Request) -> Any:
    return await _answer(request, "overrides.reset", await _body(request))
