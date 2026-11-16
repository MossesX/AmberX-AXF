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
  POST library/export                      body { elements?: [ids or words], all?, id?, name?, description?, publish?, skin? }
                                           export the UI as an asset library (ui-library@1: assets + token values + manifest), schema-validated;
                                           publish = into the shared hub library; skin = also the skin@1 asset it makes
  GET  libraries                           every library in the shared hub library (ui-library-index@1)
  GET  library/{id}                        one library; ?skin=true adds the skin@1 asset it makes
  GET  library/{id}/download               the downloadable package (<id>.ui-library.json, Content-Disposition: attachment)
  POST library/validate                    body { library }  every problem in a library document (empty = valid), nothing saved
  POST library/import                      body { library | id, into: framework|app|project|skin|console, dir?, force?, plan? }
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse, Response

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


# ---------------------------------------------------------------- asset libraries (ui-library@1)

def _with_doc(cmd: str, doc: Any, *args: str) -> JSONResponse:
    """Run a command on a document handed in by the caller (a library package): written to a temp file for the CLI."""
    import tempfile

    with tempfile.NamedTemporaryFile("w", suffix=".json", delete=True) as f:
        json.dump(doc, f)
        f.flush()
        return _run(cmd, *args, "--pending", f.name) if cmd == "library-validate" else _run(cmd, f.name, *args)


@router.post("/library/export")
async def library_export(request: Request) -> JSONResponse:
    """Export the UI as an asset library: the selected elements (ids, labels or words; default: everything changed)."""
    b = await _body(request)
    els = b.get("elements")
    flags = [*_opt("id", b.get("id")), *_opt("name", b.get("name")), *_opt("description", b.get("description")), *_opt("version", b.get("version")), *_opt("by", b.get("by"))]
    if isinstance(els, list) and els:
        flags += ["--elements", ",".join(str(e) for e in els)]
    elif isinstance(els, str) and els:
        flags += ["--elements", els]
    flags += (["--all"] if b.get("all") else []) + (["--publish"] if b.get("publish") else []) + (["--skin"] if b.get("skin") else [])
    return await run_in_threadpool(_run, "library", *flags)


@router.get("/libraries")
async def libraries() -> JSONResponse:
    return await run_in_threadpool(_run, "libraries")


@router.get("/library/{id}")
async def library_get(id: str, skin: bool = False) -> JSONResponse:
    return await run_in_threadpool(_run, "library-get", id, *(["--skin"] if skin else []))


@router.get("/library/{id}/download")
async def library_download(id: str) -> Response:
    """The downloadable package: one file, <id>.ui-library.json."""
    r = await run_in_threadpool(_run, "library-get", id)
    if r.status_code != 200:
        return r
    body = json.loads(bytes(r.body))
    lib = body.get("library") or {}
    name = str(body.get("package") or f"{lib.get('id', 'library')}.ui-library.json")
    return Response(json.dumps(lib, indent=2) + "\n", media_type="application/json", headers={"content-disposition": f'attachment; filename="{name}"', "x-content-type-options": "nosniff"})


@router.post("/library/validate")
async def library_validate(request: Request) -> JSONResponse:
    b = await _body(request)
    if not isinstance(b.get("library"), dict):
        return JSONResponse({"error": "validate needs { library: ui-library@1 }", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_with_doc, "library-validate", b["library"])


@router.post("/library/import")
async def library_import(request: Request) -> JSONResponse:
    """Import a library (by hub id or as a document) into framework | app | project | skin | console."""
    b = await _body(request)
    into = str(b.get("into") or "framework")
    flags = ["--into", into, *_opt("dir", b.get("dir")), *_opt("by", b.get("by")), *_opt("reason", b.get("reason"))] + (["--force"] if b.get("force") else []) + (["--plan"] if b.get("plan") else [])
    if isinstance(b.get("library"), dict):
        return await run_in_threadpool(_with_doc, "import", b["library"], *flags)
    if not b.get("id"):
        return JSONResponse({"error": "import needs { id } (a hub library) or { library } (a package)", "code": "invalid"}, status_code=400)
    return await run_in_threadpool(_run, "import", str(b["id"]), *flags)
