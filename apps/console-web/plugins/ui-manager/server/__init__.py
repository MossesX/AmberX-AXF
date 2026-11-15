"""UI Manager (server part). Mounted at /api/plugins/ui-manager/ (console token on every route; 404 while the plugin is off).

Every route runs the plugin's Node core (ui-manager.mjs --json), the same code the CLI uses, so REST, the MCP tools and
`axf ui-manager …` made from these routes (plugin-commands@1) and the floating window never differ.

  GET  elements?q=&kinds=&categories=&plugins=&overridden=&onScreen=&sort=&desc=&limit=&offset=&visible=a,b
                                           search / sort / multi-filter every selectable element (+ facets, category counts)
  GET  tree?visible=a,b                    the collapsible categories; On screen now holds shortcuts to the visible ids
  GET  element?id=                         the same as props/{element}, for ids with slashes (live console targets)
  POST set                                 body { element, prop, value, by?, reason? }  the same as PUT props/…
  GET  state                               the window's selection and view
  POST select | view | say                 body { element } | { view } | { text: "select the main toolbar, set its transparency to 80" }
  GET  props/{element}                     the expanding row: every property and token with value, base, source, choices
  GET  choices/{element}/{prop}            the predetermined values of one property (never free text)
  PUT  props/{element}/{prop}              body { value, by?, reason? }  set one property to one of its choices and save
  POST reset                               body { element?, prop?, by? }  one property / one element / everything
  POST preview                             body { pending? }  CSS + swaps + patches for a live preview, and the exit summary
  POST validate                            body { pending }  every problem in a pending document (empty = valid), nothing saved
  POST apply                               body { pending, by?, reason? }  save a pending document as one change
  GET  schemas                             JSON Schemas of ui-element@1, ui-overrides@1, ui-change@1
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


def _query(q: str, kinds: str, categories: str, plugins: str, overridden: bool, on_screen: bool, sort: str, desc: bool) -> list[str]:
    """search / sort / multi-filter (lib/query.mjs), the same flags the CLI takes."""
    flags = [*_opt("q", q), *_opt("kinds", kinds), *_opt("categories", categories), *_opt("plugins", plugins), *_opt("sort", sort)]
    return flags + (["--overridden"] if overridden else []) + (["--on-screen"] if on_screen else []) + (["--desc"] if desc else [])


@router.get("/elements")
async def elements(q: str = "", category: str = "", kinds: str = "", categories: str = "", plugins: str = "", overridden: bool = False,
                   onScreen: bool = False, sort: str = "", desc: bool = False, limit: int = 0, offset: int = 0, visible: str = "") -> JSONResponse:
    flags = _query(q, kinds, categories or category, plugins, overridden, onScreen, sort, desc)
    return await run_in_threadpool(_run, "elements", *flags, *_opt("limit", limit), *_opt("offset", offset), *_opt("visible", visible))


@router.get("/tree")
async def tree(q: str = "", kinds: str = "", categories: str = "", plugins: str = "", overridden: bool = False, onScreen: bool = False,
               sort: str = "", desc: bool = False, visible: str = "") -> JSONResponse:
    return await run_in_threadpool(_run, "tree", *_query(q, kinds, categories, plugins, overridden, onScreen, sort, desc), *_opt("visible", visible))


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


@router.get("/element")
async def element_props(id: str = "", q: str = "", groups: str = "", changed: bool = False, sort: str = "", desc: bool = False) -> JSONResponse:
    """props by query (`?id=`): element ids of live console targets carry slashes (target:view:builds/button:save).
    q / groups / changed / sort / desc search, filter and sort the properties."""
    if not id:
        return JSONResponse({"error": "element needs ?id=", "code": "invalid"}, status_code=400)
    flags = [*_opt("q", q), *_opt("groups", groups), *_opt("sort", sort)] + (["--changed"] if changed else []) + (["--desc"] if desc else [])
    return await run_in_threadpool(_run, "props", id, *flags)


@router.post("/set")
async def set_body(request: Request) -> JSONResponse:
    """set by body { element, prop, value, by?, reason? }: the same as PUT props/{element}/{prop}, for ids with slashes."""
    b = await _body(request)
    if not b.get("element") or not b.get("prop") or "value" not in b:
        return JSONResponse({"error": "set needs { element, prop, value }", "code": "invalid"}, status_code=400)
    value = b.get("value")
    return await run_in_threadpool(_run, "set", str(b["element"]), str(b["prop"]), json.dumps(value) if isinstance(value, (bool, int, float)) else str(value), *_opt("by", b.get("by")), *_opt("reason", b.get("reason")))


@router.get("/state")
async def state() -> JSONResponse:
    """The window's selection and view (the open window follows; console_action ui-manager.select shows it at once)."""
    return await run_in_threadpool(_run, "state")


@router.post("/select")
async def select(request: Request) -> JSONResponse:
    b = await _body(request)
    if not b.get("element"):
        return JSONResponse({"error": "select needs { element } (an id, a label or words: main toolbar)", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_run, "select", *str(b["element"]).split(), *_opt("by", b.get("by")))


@router.post("/view")
async def view(request: Request) -> JSONResponse:
    b = await _body(request)
    return await run_in_threadpool(_run, "view", str(b.get("view") or ""), *_opt("by", b.get("by")))


@router.post("/say")
async def say(request: Request) -> JSONResponse:
    """What a person says (voice): "select the main toolbar, set its transparency to 80", run step by step."""
    b = await _body(request)
    text = str(b.get("text") or "").strip()
    if not text:
        return JSONResponse({"error": "say needs { text }", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_run, "say", *text.split(), *_opt("by", b.get("by")), *_opt("reason", b.get("reason")))


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


@router.post("/validate")
async def validate(request: Request) -> JSONResponse:
    b = await _body(request)
    if not isinstance(b.get("pending"), dict):
        return JSONResponse({"error": "validate needs { pending: ui-overrides@1 }", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_with_pending, "validate", b)


@router.get("/schemas")
async def schemas() -> JSONResponse:
    return await run_in_threadpool(_run, "schemas")


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
