"""UI Manager (server part). Mounted at /api/plugins/ui-manager/ (console token on every route; 404 while the plugin is off).

Every route runs the plugin's Node core (ui-manager.mjs --json), the same code the CLI uses, so REST, the MCP tools and
`axf ui-manager …` made from these routes (plugin-commands@1) and the floating window never differ.

  GET  elements?q=&category=&visible=a,b   every selectable element (+ the category counts; visible ids = On screen now)
  GET  tree?visible=a,b                    the collapsible categories; On screen now holds shortcuts to the visible ids
  GET  props/{element}                     the expanding row: every property and token with value, base, source, choices
  GET  choices/{element}/{prop}            the predetermined values of one property (never free text)
  PUT  props/{element}/{prop}              body { value, by?, reason? }  set one property to one of its choices and save
  POST reset                               body { element?, prop?, by? }  one property / one element / everything
  POST preview                             body { pending? }  CSS + swaps + patches for a live preview, and the exit summary
  POST apply                               body { pending, by?, reason? }  save a pending document as one change
  GET  changes?limit=                      the change log (who, when, element, property, old → new)
  POST undo                                body { id, by? }  undo one change-log entry
  GET  catalog | overrides                 what the choices come from · the saved overrides
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
FOLDER = "ui-manager"
CLI = Path(__file__).resolve().parent.parent / "ui-manager.mjs"
ROOT = CLI.parents[4]
STATUS = {"invalid": 400, "validation": 422, "not_found": 404, "unexpected": 500}


def _run(*args: str, timeout: int = 30) -> JSONResponse:
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout)
        body: Any = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {"error": p.stderr.strip()[-400:] or "no answer", "code": "unexpected"}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as e:
        body = {"error": str(e)[:400], "code": "unexpected"}
    status = STATUS.get(str(body.get("code")), 500) if isinstance(body, dict) and "error" in body else 200
    return JSONResponse(body, status_code=status)


async def _body(request: Request) -> dict[str, Any]:
    try:
        data = await request.json()
    except (ValueError, UnicodeDecodeError):
        return {}
    return data if isinstance(data, dict) else {}


def _opt(name: str, value: Any) -> list[str]:
    return [f"--{name}", str(value)] if value not in (None, "", False) else []


@router.get("/elements")
async def elements(q: str = "", category: str = "", visible: str = "") -> JSONResponse:
    return await run_in_threadpool(_run, "elements", *_opt("q", q), *_opt("category", category), *_opt("visible", visible))


@router.get("/tree")
async def tree(visible: str = "") -> JSONResponse:
    return await run_in_threadpool(_run, "tree", *_opt("visible", visible))


@router.get("/props/{element}")
async def props(element: str) -> JSONResponse:
    return await run_in_threadpool(_run, "props", element)


@router.get("/choices/{element}/{prop}")
async def choices(element: str, prop: str) -> JSONResponse:
    return await run_in_threadpool(_run, "choices", element, prop)


@router.put("/props/{element}/{prop}")
async def set_prop(element: str, prop: str, request: Request) -> JSONResponse:
    b = await _body(request)
    value = b.get("value")
    return await run_in_threadpool(_run, "set", element, prop, json.dumps(value) if isinstance(value, (bool, int, float)) else str(value), *_opt("by", b.get("by")), *_opt("reason", b.get("reason")))


@router.post("/reset")
async def reset(request: Request) -> JSONResponse:
    b = await _body(request)
    args = ["reset"] + ([str(b["element"])] if b.get("element") else []) + ([str(b["prop"])] if b.get("element") and b.get("prop") else [])
    return await run_in_threadpool(_run, *args, *_opt("by", b.get("by")), *_opt("reason", b.get("reason")))


def _with_pending(cmd: str, b: dict[str, Any]) -> JSONResponse:
    import tempfile

    pending = b.get("pending")
    if pending is None:
        return _run(cmd)
    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=True) as f:
        json.dump(pending, f)
        f.flush()
        return _run(cmd, "--pending", f.name, *_opt("by", b.get("by")), *_opt("reason", b.get("reason")))


@router.post("/preview")
async def preview(request: Request) -> JSONResponse:
    return await run_in_threadpool(_with_pending, "preview", await _body(request))


@router.post("/apply")
async def apply(request: Request) -> JSONResponse:
    b = await _body(request)
    if not isinstance(b.get("pending"), dict):
        return JSONResponse({"error": "apply needs { pending: ui-overrides@1 }", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_with_pending, "apply", b)


@router.get("/changes")
async def changes(limit: int = 50) -> JSONResponse:
    return await run_in_threadpool(_run, "changes", "--limit", str(max(1, min(limit, 2000))))


@router.post("/undo")
async def undo(request: Request) -> JSONResponse:
    b = await _body(request)
    if not b.get("id"):
        return JSONResponse({"error": "undo needs { id }", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_run, "undo", str(b["id"]), *_opt("by", b.get("by")))


@router.get("/catalog")
async def catalog() -> JSONResponse:
    return await run_in_threadpool(_run, "catalog")


@router.get("/overrides")
async def overrides() -> JSONResponse:
    return await run_in_threadpool(_run, "overrides")
