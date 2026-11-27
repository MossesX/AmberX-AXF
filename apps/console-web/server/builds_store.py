"""The builds store (builds@1) for the console server's readers (Pipeline 2.0, Nov 19 2026: no store.json projection).

Every Python reader of the builds asks here instead of opening `_claude/builds/store.json`:

    import builds_store
    builds_store.read()            the whole store (dict with `builds`), or None when it can't be read
    builds_store.builds()          its builds (deleted ones too; callers filter), [] when it can't be read
    builds_store.rev()             its rev (-1 when it can't be read)
    builds_store.marker()          what changes when the store does (rev, or the file's size and mtime): for caches

This checkout's store is the axf-data tables (Postgres) only: the path map's `store.mode: cutover` puts the
`builds/store.json` key there, and the checkout's old file is never read instead (DataStoreError reads as None). A file
is read only for a store that is not this checkout's: AXF_BUILDS_STORE (a test store, as for the Node side) or another
root (a test root, a project's own repo). Reads are shared for CACHE_S.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

import data_store

STORE_REL = Path("_claude") / "builds" / "store.json"
KEY = "builds/store.json"
CACHE_S = 3.0
_lock = threading.Lock()
_cache: dict[str, tuple[float, Any]] = {}


def store_file(root: Path | None = None) -> Path:
    """The file of a store that is not on the tables (test store, scratch data dir, another root)."""
    if os.environ.get("AXF_BUILDS_STORE"):
        return Path(os.environ["AXF_BUILDS_STORE"])
    d = os.environ.get("AXF_DATA_DIR")
    if d and d != "off" and root is None:
        return Path(d) / STORE_REL
    return (root or data_store.ROOT) / STORE_REL


def on_tables() -> bool:
    """True once the builds store lives on the axf-data tables (the test store override never does)."""
    if os.environ.get("AXF_BUILDS_STORE"):
        return False
    return data_store.mode_of(KEY) in ("cutover", "rollback")


def _load(root: Path | None) -> Any:
    # another checkout (a test root, a project's own repo) keeps its own file; this checkout's store is the tables
    if on_tables() and (root is None or Path(root).resolve() == data_store.ROOT.resolve()):
        r = data_store.REMOTE.get(KEY)  # DataStoreError('unavailable') is the caller's: never a stale file instead
        return None if r is None else json.loads(r[1])
    try:
        return json.loads(store_file(root).read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _file_sig(root: Path | None) -> str:
    """A local file's change marker (size and mtime); '' for the tables, which the TTL covers."""
    if on_tables() and (root is None or Path(root).resolve() == data_store.ROOT.resolve()):
        return ""
    try:
        st = store_file(root).stat()
        return f"{st.st_size}:{st.st_mtime_ns}"
    except OSError:
        return "-"


def read(root: Path | None = None, *, fresh: bool = False) -> dict[str, Any] | None:
    """The store, or None when it can't be read (axf-data unreachable after the cut, no file before it). The tables
    are read at most every CACHE_S seconds; a local file again as soon as it changes."""
    sig = _file_sig(root)
    key = f"{root or ''}|{os.environ.get('AXF_BUILDS_STORE', '')}|{sig}"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and not fresh and (sig or now - hit[0] < CACHE_S):
            return hit[1]
        if len(_cache) > 16:
            _cache.clear()
    try:
        doc = _load(root)
    except data_store.DataStoreError:
        doc = None
    doc = doc if isinstance(doc, dict) else None
    with _lock:
        _cache[key] = (now, doc)
    return doc


def builds(root: Path | None = None) -> list[dict[str, Any]]:
    doc = read(root)
    return [b for b in (doc or {}).get("builds", []) if isinstance(b, dict)]


def rev(root: Path | None = None) -> int:
    doc = read(root)
    return int(doc.get("rev") or 0) if doc else -1


def marker(root: Path | None = None) -> str:
    """What changes when the store does: the tables' rev, or a local file's size and mtime (a hand-written test store
    carries no rev)."""
    return f"{rev(root)}:{_file_sig(root)}"


def clear() -> None:
    with _lock:
        _cache.clear()
