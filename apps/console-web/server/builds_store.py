"""The builds store (builds@1) for the console server's readers (Pipeline 2.0, Nov 19 2026: no store.json projection).

Every Python reader of the builds asks here instead of opening `_claude/builds/store.json`:

    import builds_store
    builds_store.read()            the whole store (dict with `builds`), or None when it can't be read
    builds_store.builds()          its builds (deleted ones too; callers filter), [] when it can't be read
    builds_store.rev()             its rev (-1 when it can't be read)
    builds_store.marker()          what changes when the store does (rev, or the file's size and mtime): for caches
    builds_store.pipeline_summary()  pipeline-summary@1: counts by status, the queued build, the running builds
    builds_store.build(id)         one build by its id (its row, with steps and notes), or None

Pipeline status (Nov 25 2026, framework/spec/DATA-INVENTORY.md → Pipeline status): a status is a row of the builds
table. `pipeline_summary()` and `build(id)` ask axf-data for the summary query and the one row; neither reads the whole
record, and no status file exists (`_claude/builds/orchestrator.json` is gone). Before the cut they answer the same
from the store file.

Where it comes from is the data-store@1 mode of the `builds/store.json` key (framework/core/data-store-mode.mjs):
cutover / rollback = the axf-data tables (Postgres), and never the checkout's stale file, which nothing writes after
the cut; local / shadow (a fresh checkout, a project not moved yet) = the file, as framework/cli/builds-store.mjs
reads it. AXF_BUILDS_STORE points at a test store, as it does for the Node side. Reads are shared for CACHE_S.
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
    """The local file (test store, scratch data dir, else the checkout's): only read before the cut."""
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


# ---- pipeline status: the summary query and one row, never the document (pipeline-summary@1, data-item@1) ----
SUMMARY_SCHEMA = "pipeline-summary@1"
QUEUED_STATUS = "queued"
# services/axf-data/tables.py RUNNING_STATUSES and framework/cli/builds-store.mjs SUMMARY_RUNNING: the same list
RUNNING_STATUSES = ("running", "fixing", "landing", "splitting", "pulling-main", "assigning-models", "ready", "sending", "building",
                    "build-complete", "merging-pr", "pr-pulling-main", "running-ci", "merging-main")
_SUMMARY_PIPELINE = ("slot", "account", "session", "model", "queuedAt", "queuedBy", "heldAt", "heldBy", "heldWhy")
SUMMARY_CACHE_S = 2.0


def _text(v: Any) -> str:
    return v if isinstance(v, str) else ""


def summary_row(b: dict[str, Any]) -> dict[str, Any]:
    """What a list shows of one build: never steps, notes or the origin."""
    pl = b.get("pipeline") if isinstance(b.get("pipeline"), dict) else {}
    out = {"id": _text(b.get("id")), "number": _text(b.get("number")), "title": _text(b.get("title")), "status": _text(b.get("status")),
           "priority": _text(b.get("priority")), "pr": b.get("pr") if isinstance(b.get("pr"), (str, int)) and not isinstance(b.get("pr"), bool) else "",
           "branch": _text(b.get("branch")), "rev": b.get("rev") if isinstance(b.get("rev"), int) and not isinstance(b.get("rev"), bool) else None,
           "updatedAt": _text(b.get("updatedAt")), "statusAt": _text(b.get("statusAt")), "statusBy": _text(b.get("statusBy"))}
    out.update({k: _text(pl.get(k)) for k in _SUMMARY_PIPELINE})
    return out


def summary_of(doc: Any) -> dict[str, Any]:
    """pipeline-summary@1 from a store document: the answer axf-data computes in SQL, for a store that is a file."""
    items = [b for b in (doc.get("builds") if isinstance(doc, dict) else None) or [] if isinstance(b, dict) and b.get("deleted") is not True]
    counts: dict[str, int] = {}
    for b in items:
        counts[_text(b.get("status"))] = counts.get(_text(b.get("status")), 0) + 1
    live = [summary_row(b) for b in items if b.get("status") == QUEUED_STATUS or b.get("status") in RUNNING_STATUSES]
    queued = sorted((r for r in live if r["status"] == QUEUED_STATUS), key=lambda r: (r["queuedAt"] or r["updatedAt"] or "~", r["id"]))
    run = sorted((r for r in live if r["status"] != QUEUED_STATUS), key=lambda r: (r["slot"] or "~", r["id"]))
    return {"$axf": SUMMARY_SCHEMA, "total": len(items), "counts": dict(sorted(counts.items())), "queued": queued[0] if queued else None,
            "queuedAll": queued, "running": run, "rev": int(doc.get("rev") or 0) if isinstance(doc, dict) else 0,
            "at": _text(doc.get("updatedAt")) if isinstance(doc, dict) else ""}


def _row_call(fn: Any) -> Any:
    """One row call on axf-data, or None when the service is from before data-item@1 / pipeline-summary@1 (it answers
    `invalid_key`: unknown action). The service is deployed on its own schedule; the caller then reads the record."""
    try:
        return fn()
    except data_store.DataStoreError as e:
        if e.code == "invalid_key":
            return None
        raise


def pipeline_summary(*, fresh: bool = False) -> dict[str, Any]:
    """The pipeline's status: counts by status, the one queued build, the running builds with slot and account. On the
    tables it is the summary query (a GROUP BY and the few live rows); DataStoreError when axf-data can't answer, never
    a stale file instead. Shared for SUMMARY_CACHE_S: every open console polls it."""
    key = f"summary|{os.environ.get('AXF_BUILDS_STORE', '')}"
    now = time.time()
    with _lock:
        hit = _cache.get(key)
        if hit and not fresh and now - hit[0] < SUMMARY_CACHE_S:
            return hit[1]
    out = _row_call(lambda: data_store.REMOTE.summary(KEY)) if on_tables() else None
    if out is None:  # before the cut, or an axf-data from before pipeline-summary@1: the same answer from the record
        out = summary_of(_load(None))
    with _lock:
        _cache[key] = (now, out)
    return out


def build(build_id: str) -> dict[str, Any] | None:
    """One build by its id as the store holds it, or None. On the tables: its row with its steps and notes."""
    if on_tables():
        r = _row_call(lambda: data_store.REMOTE.item(KEY, build_id) or {})
        if r is not None:
            return r.get("item") if isinstance(r.get("item"), dict) else None
    doc = _load(None)
    return next((b for b in (doc or {}).get("builds", []) if isinstance(b, dict) and b.get("id") == build_id), None)


def clear() -> None:
    with _lock:
        _cache.clear()
