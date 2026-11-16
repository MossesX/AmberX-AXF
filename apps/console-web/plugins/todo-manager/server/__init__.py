"""Todo manager — server part. Mounted at /api/plugins/todo-manager/ (console token on every method, 404 when the plugin
is off, never on the console MCP).

Ported from xGallery's developer task manager (server/src/routes/tasks.ts): lists with nested groups, entries (notes,
to-dos, tasks) with subtasks, checklists, tags, due dates, custom fields per kind, group actions and Markdown export.

    GET  /types                 the type schema (what each kind must / may hold)      PUT /types   save it
    GET  /lists                 every list and group (counts)                         POST /lists  {title, parentId?, tone?, icon?}
    PUT  /lists/{id}            {title?, parentId?, tone?, icon?, sortOrder?}         DELETE /lists/{id}  (with its groups + entries)
    POST /lists/reorder         {ids}
    GET  /lists/{id}/entries    {list, lists, entries}: everything inside a list
    GET  /lists/{id}/export.md  the list as Markdown
    GET  /entries?q=&kind=&status=   search (newest first, ≤ 300)
    POST /entries               {listId, parentId?, kind, title, …, draft?}           PUT /entries/{id}   DELETE /entries/{id}
    POST /entries/bulk          {ids, action: delete|move|duplicate|patch, listId?, parentId?, patch?}
    POST /entries/reorder       {ids}

By name (server/voice.py; what MCP, the CLI and voice use, no ids needed). Each answers {ok, say, …}:
    POST /by-name/list-create   {title, parent?}         POST /by-name/list-rename  {list, title}
    POST /by-name/list-move     {list, position | parent} POST /by-name/list-delete {list, confirm}
    POST /by-name/entry-add     {list, title, kind?, body?, under?}   POST /by-name/entry-edit {entry, list?, title?, body?, status?, priority?, kind?}
    POST /by-name/entry-move    {entry, to, from?}       POST /by-name/entry-complete {entry, list?, done?}
    POST /by-name/entry-delete  {entry, list?, confirm}  POST /by-name/list-and-entry {list, title, kind?}
    GET  /by-name/find?q=&kind=&status=                  GET /by-name/lists-read?list=   GET /by-name/export?list=
    POST /voice                 {text, confirm?}: a spoken phrase (voice.json) → one of the above, with `say`

The console's voice endpoint (console_control_voice, /api/console-control/voice) hands any phrase it doesn't know to
this plugin through plugin_services `axf.voice-phrases@1:todo-manager`.

Data: one file, todo-store@1, in the plugin's data folder (`AXF_TODO_DIR` overrides), 0600, written atomically; one per
project (projects@1): AmberX AXF keeps `store.json`, any other project `projects/<id>/store.json`.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import Response

import console_context as cx
from . import voice as V
from .model import KINDS, Invalid, Store, text

router = APIRouter()

MAX_BODY = 256 * 1024


def data_dir() -> Path:
    return Path(os.environ.get("AXF_TODO_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "todo-manager"))


class _ProjectStores:
    """Projects (projects@1): each project has its own lists, notes, to-dos and tasks. The active project's store
    (AmberX AXF: <data dir>/store.json, as before; any other: <data dir>/projects/<id>/store.json, empty at first).
    STORE.<anything> goes to the store of the project in force at that moment."""

    def __init__(self) -> None:
        self._by_path: dict[Path, Store] = {}

    def current(self) -> Store:
        f = Path(cx.project_dir(data_dir())) / "store.json"
        st = self._by_path.get(f)
        if st is None:
            st = self._by_path[f] = Store(f)
        return st

    def __getattr__(self, name: str) -> Any:
        return getattr(self.current(), name)


STORE = _ProjectStores()


def _call(fn, *a):
    try:
        return fn(*a)
    except Invalid as e:
        raise HTTPException(e.status, str(e)) from None


def _id(v: Any, what: str = "id") -> int:
    if isinstance(v, bool) or not isinstance(v, int) or v <= 0:
        raise HTTPException(400, f"{what} must be a positive whole number")
    return v


def _opt_id(v: Any, what: str) -> int | None:
    return None if v is None else _id(v, what)


async def _body(req: Request) -> dict[str, Any]:
    raw = await req.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "Request too large")
    if not raw:
        return {}
    try:
        b = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "Body must be JSON") from None
    if not isinstance(b, dict):
        raise HTTPException(400, "Body must be a JSON object")
    return b


def _ids(b: dict[str, Any]) -> list[int]:
    raw = b.get("ids")
    ids = [x for x in raw if isinstance(x, int) and not isinstance(x, bool) and x > 0] if isinstance(raw, list) else []
    if not ids:
        raise HTTPException(400, "ids is required")
    return list(dict.fromkeys(ids))[:500]


def _ref_ids(b: dict[str, Any]) -> dict[str, Any]:
    """listId / parentId checked as ids wherever they appear."""
    out = dict(b)
    if "listId" in out:
        out["listId"] = _id(out["listId"], "listId")
    if "parentId" in out:
        out["parentId"] = _opt_id(out["parentId"], "parentId")
    return out


# ---------------------------------------------------------------- types


@router.get("/types")
def get_types() -> dict[str, Any]:
    return {"types": STORE.types()}


@router.put("/types")
async def put_types(req: Request) -> dict[str, Any]:
    b = await _body(req)
    return {"types": STORE.save_types(b.get("types", b))}


# ---------------------------------------------------------------- lists


@router.get("/lists")
def get_lists() -> dict[str, Any]:
    return {"lists": STORE.lists()}


@router.post("/lists", status_code=201)
async def post_list(req: Request) -> dict[str, Any]:
    return {"list": _call(STORE.create_list, _ref_ids(await _body(req)))}


@router.post("/lists/reorder")
async def reorder_lists(req: Request) -> dict[str, bool]:
    STORE.reorder("lists", _ids(await _body(req)))
    return {"ok": True}


@router.put("/lists/{lid}")
async def put_list(lid: int, req: Request) -> dict[str, Any]:
    return {"list": _call(STORE.update_list, lid, _ref_ids(await _body(req)))}


@router.delete("/lists/{lid}")
def delete_list(lid: int) -> dict[str, Any]:
    return {"ok": True, **_call(STORE.delete_list, lid)}


@router.get("/lists/{lid}/entries")
def list_entries(lid: int) -> dict[str, Any]:
    return _call(STORE.list_contents, lid)


@router.get("/lists/{lid}/export.md")
def export_md(lid: int) -> Response:
    name, md = _call(STORE.export_md, lid)
    return Response(md, media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": f'attachment; filename="{name}"'})


# ---------------------------------------------------------------- entries


@router.get("/entries")
def search(q: str = "", kind: str = "", status: str = "") -> dict[str, Any]:
    return {"entries": STORE.search(text(q, 120), kind if kind in KINDS else "", text(status, 30))}


@router.post("/entries", status_code=201)
async def post_entry(req: Request) -> dict[str, Any]:
    b = _ref_ids(await _body(req))
    if "listId" not in b:
        raise HTTPException(400, "listId is required")
    e, warnings = _call(STORE.create_entry, b)
    return {"entry": e, "warnings": warnings}


@router.post("/entries/bulk")
async def bulk(req: Request) -> dict[str, Any]:
    b = _ref_ids(await _body(req))
    return _call(STORE.bulk, _ids(b), text(b.get("action"), 20), b)


@router.post("/entries/reorder")
async def reorder_entries(req: Request) -> dict[str, bool]:
    STORE.reorder("entries", _ids(await _body(req)))
    return {"ok": True}


@router.put("/entries/{eid}")
async def put_entry(eid: int, req: Request) -> dict[str, Any]:
    e, warnings = _call(STORE.update_entry, eid, _ref_ids(await _body(req)))
    return {"entry": e, "warnings": warnings}


@router.delete("/entries/{eid}")
def delete_entry(eid: int) -> dict[str, Any]:
    return {"ok": True, "count": _call(STORE.delete_entry, eid)}



# ---------------------------------------------------------------- by name (voice, MCP, CLI)


def _named(op: str, b: dict[str, Any]) -> dict[str, Any]:
    r = _call(V.OPS[op], STORE.current(), b)
    if r.get("code") == "confirmation_required":
        raise HTTPException(409, r["say"])
    return r


@router.post("/by-name/list-create", status_code=201)
async def by_name_list_create(req: Request) -> dict[str, Any]:
    return _named("list-create", await _body(req))


@router.post("/by-name/list-rename")
async def by_name_list_rename(req: Request) -> dict[str, Any]:
    return _named("list-rename", await _body(req))


@router.post("/by-name/list-move")
async def by_name_list_move(req: Request) -> dict[str, Any]:
    return _named("list-move", await _body(req))


@router.post("/by-name/list-delete")
async def by_name_list_delete(req: Request) -> dict[str, Any]:
    return _named("list-delete", await _body(req))


@router.post("/by-name/list-and-entry", status_code=201)
async def by_name_list_and_entry(req: Request) -> dict[str, Any]:
    return _named("list-and-entry", await _body(req))


@router.post("/by-name/entry-add", status_code=201)
async def by_name_entry_add(req: Request) -> dict[str, Any]:
    return _named("entry-add", await _body(req))


@router.post("/by-name/entry-edit")
async def by_name_entry_edit(req: Request) -> dict[str, Any]:
    return _named("entry-edit", await _body(req))


@router.post("/by-name/entry-move")
async def by_name_entry_move(req: Request) -> dict[str, Any]:
    return _named("entry-move", await _body(req))


@router.post("/by-name/entry-complete")
async def by_name_entry_complete(req: Request) -> dict[str, Any]:
    return _named("entry-complete", await _body(req))


@router.post("/by-name/entry-delete")
async def by_name_entry_delete(req: Request) -> dict[str, Any]:
    return _named("entry-delete", await _body(req))


@router.get("/by-name/find")
def by_name_find(q: str = "", kind: str = "", status: str = "") -> dict[str, Any]:
    return _named("find", {"q": q, "kind": kind, "status": status})


@router.get("/by-name/lists-read")
def by_name_lists_read(list: str = "") -> dict[str, Any]:  # noqa: A002 — the query field is called list
    return _named("lists-read", {"list": list})


@router.get("/by-name/export")
def by_name_export(list: str = "") -> dict[str, Any]:  # noqa: A002
    return _named("export", {"list": list})


def hear(said: str, confirm: bool = False) -> dict[str, Any] | None:
    """A spoken phrase → run it on the active project's store; None when it isn't a Todo manager phrase."""
    return V.hear(STORE.current(), str(said or "")[:300], confirm)


@router.post("/voice")
async def voice(req: Request) -> dict[str, Any]:
    b = await _body(req)
    said = text(b.get("text"), 300).strip()
    if not said:
        raise HTTPException(400, "text is required")
    r = hear(said, b.get("confirm") is True)
    return r or {"ok": False, "code": "invalid", "heard": said, "say": "That isn't a Todo manager phrase. Try: make a list called Groceries."}


try:  # the console's voice endpoint asks every plugin that hears phrases (optional: tests run without it)
    import plugin_services as _ps

    _ps.provide("axf.voice-phrases@1:todo-manager", hear, folder="todo-manager")
except ImportError:  # pragma: no cover
    pass
