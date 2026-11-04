"""Notes browser server part. Mounted at /api/plugins/notes-browser/ (console token on every method).

Brett's saved notes live in the hub's shared Claude files, `/projects/_shared/_claude/notes/` (store.py: the hub's
memory semantics, so versions and attribution match axHub's). Routes:

    GET    /notes?q=&content=          folders + notes (path, folder, name, title, size, version, updatedAt, updatedBy;
                                       content=1 adds each note's text: the Grid view counts sections)
    GET    /note?path=                 one note with its content
    GET    /history?path=              kept versions (no content)
    PUT    /note                       {path, content, if_version?}   "" = create only; a version = conflict-safe save (409)
    POST   /move                       {from, to, if_version?}        rename or move between folders
    DELETE /note?path=&if_version=     delete (history kept on the hub)
    POST   /folder                     {name}                          new folder
    DELETE /folder?name=               remove an empty folder

AmberX notes (the AmberX app's notes, to-dos and tasks, `amberx.items`), reached through the `control@1` capability
(Token control) so this plugin never touches another plugin's files; the caller's own grants apply:

    GET    /amberx?q=&kind=            notes (kind note by default; `all` = every kind) + the lists to move them to
    PUT    /amberx/item?id=            {title?, text?}                 edit
    POST   /amberx/act?id=&action=     {input}                         pin / star / move {list} / done / undone
    DELETE /amberx/item?id=&confirm=   first call answers {confirm}; the second, with it, deletes

Also provides the capability `axf.notes@1` (plugin_services) so other plugins (MD Studio's Notes scope) reuse the
same store without naming this folder.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, Request

import plugin_services

from .store import NotesError, NotesStore

FOLDER = "notes-browser"
SERVICE = "axf.notes@1"
STORE = NotesStore(by="console:notes-browser")

router = APIRouter()


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except NotesError as e:
        raise HTTPException(e.status, str(e)) from e


@router.get("/notes")
def notes(q: str = "", content: bool = False) -> dict[str, Any]:
    if not STORE.available():
        return {"root": str(STORE.notes_dir), "available": False, "folders": [], "notes": []}
    return _run(STORE.list, q[:200], content)


@router.get("/note")
def note(path: str = Query(...)) -> dict[str, Any]:
    return _run(STORE.read, path)


@router.get("/history")
def history(path: str = Query(...)) -> dict[str, Any]:
    return {"versions": _run(STORE.history, path)}


@router.put("/note")
def save(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    iv = body.get("if_version")
    return _run(STORE.write, body.get("path"), body.get("content"), iv if isinstance(iv, str) else None)


@router.post("/move")
def move(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    iv = body.get("if_version")
    return _run(STORE.move, body.get("from"), body.get("to"), iv if isinstance(iv, str) else None)


@router.delete("/note")
def delete(path: str = Query(...), if_version: str | None = None) -> dict[str, Any]:
    return {"deleted": _run(STORE.remove, path, if_version)}


@router.post("/folder")
def folder(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return {"folder": _run(STORE.make_folder, body.get("name"))}


@router.delete("/folder")
def delete_folder(name: str = Query(...)) -> dict[str, Any]:
    return {"deleted": _run(STORE.remove_folder, name)}


# ── AmberX notes through control@1 ──────────────────────────────────────────────────────────────────────────────

AMBERX_ACTIONS = ("pin", "star", "move", "done", "undone")


def _grants(request: Request) -> tuple[list[str], str]:
    """The console token / a hub admin = everything; anyone else = their own permissions (never more)."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return ["*"], "console:notes-browser"
    name = str(getattr(user, "name", "") or "console")
    return (["*"] if getattr(user, "admin", False) else sorted(getattr(user, "perms", ()) or ())), name


def _control(request: Request, command: dict[str, Any]) -> dict[str, Any]:
    cc = plugin_services.get("control@1")
    if cc is None:
        raise HTTPException(503, "AmberX notes need the Token control plugin (control@1), which isn't running")
    grants, by = _grants(request)
    r = cc.run({"$axf": "control@1", **command, "by": by}, grants, by=by)
    if isinstance(r, dict) and r.get("ok") is False and r.get("code") != "confirmation_required":
        code = str(r.get("code") or "")
        status = {"not_found": 404, "denied": 403, "invalid": 400, "validation": 400}.get(code, 502)
        raise HTTPException(status, str(r.get("message") or code or "control@1 failed"))
    return r if isinstance(r, dict) else {}


def _data(r: dict[str, Any]) -> dict[str, Any]:
    return r.get("data") if isinstance(r.get("data"), dict) else r


@router.get("/amberx")
def amberx(request: Request, q: str = "", kind: str = "note") -> dict[str, Any]:
    if plugin_services.get("control@1") is None:
        return {"available": False, "why": "the Token control plugin (control@1) isn't running", "items": [], "lists": [], "total": 0}
    select: dict[str, Any] = {"limit": 500}
    if q.strip():
        select["q"] = q[:200]
    if kind != "all":
        select["kind"] = kind
    items = _data(_control(request, {"op": "list", "target": "amberx.items", "select": select}))
    lists = _data(_control(request, {"op": "list", "target": "amberx.lists"}))
    return {"available": True, "items": items.get("items", []), "total": items.get("total", 0),
            "lists": [{"id": x.get("id"), "name": x.get("name"), "path": x.get("path")} for x in lists.get("items", [])]}


@router.put("/amberx/item")
def amberx_save(request: Request, id: str = Query(...), body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    value = {k: body[k] for k in ("title", "text") if isinstance(body.get(k), str)}
    if not value:
        raise HTTPException(400, "nothing to save (title or text)")
    return _data(_control(request, {"op": "set", "target": "amberx.items", "path": id, "value": value}))


@router.post("/amberx/act")
def amberx_act(request: Request, id: str = Query(...), action: str = Query(...), body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    if action not in AMBERX_ACTIONS:
        raise HTTPException(400, f"unknown action {action} (one of {', '.join(AMBERX_ACTIONS)})")
    inp = body.get("input") if isinstance(body.get("input"), dict) else {}
    return _data(_control(request, {"op": "act", "target": "amberx.items", "path": id, "action": action, "input": inp}))


@router.delete("/amberx/item")
def amberx_delete(request: Request, id: str = Query(...), confirm: str = "") -> dict[str, Any]:
    r = _control(request, {"op": "remove", "target": "amberx.items", "path": id, **({"confirm": confirm} if confirm else {})})
    if r.get("code") == "confirmation_required":
        return {"removed": 0, "confirm": r.get("confirm") or _data(r).get("confirm")}
    return {"removed": _data(r).get("removed", 0)}


class Service:
    """axf.notes@1: Brett's saved notes (the hub's /projects/_shared/_claude/notes). Raises store.NotesError."""
    version = 1
    root = property(lambda self: str(STORE.notes_dir))

    def available(self) -> bool:
        return STORE.available()

    def list(self, q: str = "") -> dict[str, Any]:
        return STORE.list(q)

    def read(self, path: str) -> dict[str, Any]:
        return STORE.read(path)

    def write(self, path: str, content: str, if_version: str | None = None, by: str | None = None) -> dict[str, Any]:
        return (NotesStore(STORE.root, by=by) if by else STORE).write(path, content, if_version)

    def move(self, src: str, dst: str, if_version: str | None = None) -> dict[str, Any]:
        return STORE.move(src, dst, if_version)

    def remove(self, path: str, if_version: str | None = None) -> bool:
        return STORE.remove(path, if_version)

    def history(self, path: str) -> list[dict[str, Any]]:
        return STORE.history(path)


plugin_services.provide(SERVICE, Service(), FOLDER)
