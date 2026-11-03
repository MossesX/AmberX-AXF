"""Notes browser server part. Mounted at /api/plugins/notes-browser/ (console token on every method).

Brett's saved notes live in the hub's shared Claude files, `/projects/_shared/_claude/notes/` (store.py: the hub's
memory semantics, so versions and attribution match axHub's). Routes:

    GET    /notes?q=                   folders + notes (path, folder, name, title, size, version, updatedAt, updatedBy)
    GET    /note?path=                 one note with its content
    GET    /history?path=              kept versions (no content)
    PUT    /note                       {path, content, if_version?}   "" = create only; a version = conflict-safe save (409)
    POST   /move                       {from, to, if_version?}        rename or move between folders
    DELETE /note?path=&if_version=     delete (history kept on the hub)
    POST   /folder                     {name}                          new folder
    DELETE /folder?name=               remove an empty folder

Also provides the capability `axf.notes@1` (plugin_services) so other plugins (MD Studio's Notes scope) reuse the
same store without naming this folder.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

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
def notes(q: str = "") -> dict[str, Any]:
    if not STORE.available():
        return {"root": str(STORE.notes_dir), "available": False, "folders": [], "notes": []}
    return _run(STORE.list, q[:200])


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
