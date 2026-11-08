"""Memory Manager server part. Mounted at /api/plugins/memory-manager/ (console token on every method).

Memory (memory.py, memory-manager@1): every Claude memory file, what reads and writes it, and full management:

    GET  /memory?q=&category=&kind=&root=&writer=&loaded=&refresh=   memory files with location, readers, writers
    POST /scan                       re-run the code scan (readers / writers) and list again
    GET  /memory/file?id=            one memory file's details (location, readers, writers)
    GET  /search?q=&limit=           search inside every memory file (snippets, hit counts)
    POST /move                       {id, to, if_version?}  within a scope; the old text is kept as a version
    POST /delete                     {id, if_version?}  the text is kept as a version (restore brings it back)
    GET  /chunks?q=&source=          the chunked store's index (_claude/chunks)
    POST /chunks/build               rebuild the chunks from their sources
    GET  /load?hours=                what a session loads at start (memory-load@1)
    GET  /audit                      the audit map (memory-map@1): every location, its readers and writers
    GET  /settings · PUT /settings   the plugin's settings (scan, list, safety, chunks)

Files (the editor, duplicated from MD Studio so MD Studio can be removed later):

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

from .memory import MemoryIndex, load_map
from .store import MemError, MemStore

FOLDER = "memory-manager"
STORE = MemStore(by="console:memory-manager", notes=lambda: plugin_services.get("axf.notes@1"))
MEM = MemoryIndex(STORE)

router = APIRouter()


def _run(fn: Any, *args: Any, **kw: Any) -> Any:
    try:
        return fn(*args, **kw)
    except MemError as e:
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


# ---- memory --------------------------------------------------------------------------------------------------------
@router.get("/memory")
def memory(q: str = "", category: str = "", kind: str = "", root: str = "", writer: str = "", loaded: str = "", refresh: bool = False) -> dict[str, Any]:
    """Every Claude memory file with its location, category, kind, whether it loads at start, and what reads and writes it. Filters: q (path words), category, kind (memory|builds|log|generated), root (repo|hub|user), writer (name or path), loaded=true."""
    return _run(MEM.scan, q[:200], category[:80], kind[:20], root[:10], writer[:120], loaded[:5], refresh)


@router.post("/scan")
def rescan() -> dict[str, Any]:
    """Refresh: scan the code again for readers and writers of memory files, then list every memory file."""
    return _run(MEM.scan, refresh=True)


@router.get("/memory/file")
def memory_file(id: str = Query(...)) -> dict[str, Any]:
    """One memory file's details: location, category, kind, readers and writers."""
    return _run(MEM.detail, id)


@router.get("/search")
def search(q: str = Query(...), limit: int = 100) -> dict[str, Any]:
    """Search inside every memory file: results with hit counts and a snippet."""
    return _run(MEM.search, q[:200], limit)


@router.post("/move")
def move(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Move or rename a memory file: {id, to, if_version}. Same scope only; the old text is kept in the version history."""
    iv = body.get("if_version")
    return _run(MEM.move, body.get("id"), body.get("to"), iv if isinstance(iv, str) else None)


@router.post("/delete")
def delete(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Delete a memory file: {id, if_version}. Its text is kept as a version, so restore brings it back."""
    iv = body.get("if_version")
    return _run(MEM.delete, body.get("id"), iv if isinstance(iv, str) else None)


@router.get("/chunks")
def chunks(q: str = "", source: str = "") -> dict[str, Any]:
    """The chunked memory store's index: one line per chunk (id, source, title, tokens, date)."""
    return _run(MEM.chunks, q[:200], source[:200])


@router.post("/chunks/build")
def chunks_build() -> dict[str, Any]:
    """Rebuild _claude/chunks from CLAUDE.md, THREADS, STATUS, decisions and the memory docs."""
    return _run(MEM.build_chunks)


@router.get("/load")
def session_load(hours: int = 24) -> dict[str, Any]:
    """What a session loads at start: builds started in the last N hours that stopped unfinished, and the chunk index."""
    return _run(MEM.load, hours)


@router.get("/audit")
def audit() -> dict[str, Any]:
    """The memory audit: every place memory lives and every part of the app that reads or writes it."""
    return load_map()


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """Memory Manager settings by category (Scan, List, Safety, Chunks) with defaults and choices."""
    return MEM.settings_doc()


@router.put("/settings")
def put_settings(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Change Memory Manager settings: {"scan.includeChunks": true, …}."""
    return {"settings": _run(MEM.set_settings, body)}

