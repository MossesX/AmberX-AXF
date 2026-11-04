"""MD Studio server part. Mounted at /api/plugins/md-studio/ (console token on every method).

Every Markdown file Brett works with, by scope (store.py): Project and Repo (.md files in the checkout), Claude (the
hub's Claude files of every project, axHub memory semantics) and Notes (the Notes Vault through `axf.notes@1`, optional:
the scope is hidden when the Notes plugin is off). Routes (each one is also a command: REST, MCP and the `axf` CLI,
plugin-commands@1 auto):

    GET  /files?q=&content=          scopes → groups → files (q filters by path; content=true also searches the text)
    GET  /file?id=                   one file: content, version, tokens, references resolved to ids
    PUT  /file                       {id, content, if_version?}  "" = create only; a version = conflict-safe save (409)
    GET  /history?id=                kept versions (no content)
    GET  /version?id=&version=       one kept version with its content
    POST /restore                    {id, version, if_version?}  write a kept version back (the current text is kept)
    GET  /chain?id=&depth=&follow=   the file and everything it references, with token counts per part (context view)
    GET  /refs?id=                   the references of a file, resolved to ids (the reference branches)

Ids: `repo:<path>`, `hub:<project>/<path under _claude>` (`_shared` = every project), `notes:<folder>/<name>.md`.
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query

import plugin_services

from .store import MdError, MdStore

FOLDER = "md-studio"
STORE = MdStore(by="console:md-studio", notes=lambda: plugin_services.get("axf.notes@1"))

router = APIRouter()


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except MdError as e:
        raise HTTPException(e.status, str(e)) from e


@router.get("/files")
def files(q: str = "", content: bool = False) -> dict[str, Any]:
    """Every Markdown file by scope (Project, Claude, Repo, Notes) and category; q filters, content=true searches the text too."""
    return _run(STORE.list, q[:200], content)


@router.get("/file")
def file(id: str = Query(...)) -> dict[str, Any]:
    """Open one Markdown file by id: its text, version, token count and resolved references."""
    return _run(STORE.read, id)


@router.put("/file")
def save(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Save a Markdown file: {id, content, if_version}. if_version "" creates only; a version saves only if nobody changed it."""
    iv = body.get("if_version")
    return _run(STORE.write, body.get("id"), body.get("content"), iv if isinstance(iv, str) else None)


@router.get("/history")
def history(id: str = Query(...)) -> dict[str, Any]:
    """The kept versions of a file, newest first (version, size, savedAt, savedBy, reason)."""
    return {"versions": _run(STORE.history, id)}


@router.get("/version")
def version(id: str = Query(...), version: str = Query(...)) -> dict[str, Any]:
    """One kept version of a file with its text."""
    return _run(STORE.version, id, version)


@router.post("/restore")
def restore(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Restore a kept version: {id, version, if_version}. The text it replaces is kept too, so a restore can be undone."""
    iv = body.get("if_version")
    return _run(STORE.restore, body.get("id"), str(body.get("version") or ""), iv if isinstance(iv, str) else None)


@router.get("/chain")
def chain(id: str = Query(...), depth: int = 3, follow: str = "all") -> dict[str, Any]:
    """Context view: a file and every file it references as a tree, with tokens per part and in total. follow=import keeps only @imports (what Claude loads)."""
    return _run(STORE.chain, id, depth, follow)


@router.get("/refs")
def refs(id: str = Query(...)) -> dict[str, Any]:
    """The files a Markdown file references, resolved to ids (null when the file isn't there)."""
    d = _run(STORE.read, id)
    return {"id": d["id"], "refs": d["refs"]}
