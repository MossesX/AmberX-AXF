"""Codebase changes — server part. Mounted at /api/plugins/codebase-changes/ (console token on every method, 404 when the
plugin is off, never on the console MCP; the console adds those checks).

  GET   entries?open=1|closed=1&kind=&state=&repo=&q=&from=YYYY-MM-DD&to=YYYY-MM-DD&cursor=<id>&limit=50
                                   newest first: {items: [summaries], total, nextCursor, counts {total, open, byKind, byState}}
  GET   entries/{id}               one entry (change-log@1)
  POST  entries                    open an entry: {title, kind?, asked?, repos?, model?, who?, steps?, id?, …}; an id that
                                   already exists returns that entry unchanged ({…, existed: true}) so hooks are idempotent
  PATCH entries/{id}               {title?, kind?, asked?, repos?, model?, who?, steps? (whole list), step? {index?, text?,
                                   state?, note?} (one step, upserted), result? (merged; null clears)}
  POST  entries/{id}/close         {by?}  dismissed from the banner on every device (stored in the entry)
  POST  entries/{id}/reopen        back in the banner
  POST  close-all                  {ids?: [...]} every open entry (or just those)
  GET   where                      where the log is kept

Where: AXF_CHANGES_DIR, else <shared data folder>/changes (the hub's /projects/amberx-axf/_data/changes in the console
container; seeded once from the repo's changes/), else the repo's changes/. One file per entry; see store.py.
Provides ``axf.changes@1``: open(entry, by), update(id, patch), close(id, by), reopen(id), get(id), query(**filters).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shutil
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from .store import ID_RE, Store, normalize, now_iso, redact, upsert_step

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SELF = "axf.changes@1"
MAX_BODY = 128 * 1024
BUILD_KEYS = {"status", "buildRef", "surface", "startedAt", "finishedAt", "lastSeenAt", "estimate", "actual", "costEstimated", "branch", "areas", "activity",
              "parent", "progress", "verify"}
ENTRY_KEYS = {"$axf", "id", "createdAt", "updatedAt", "kind", "title", "asked", "repos", "model", "who", "steps", "result", "closed", "state"} | BUILD_KEYS
PATCH_KEYS = {"title", "kind", "asked", "repos", "model", "who", "steps", "step", "result", "beat"} | BUILD_KEYS
_DAY = re.compile(r"^\d{4}-\d{2}-\d{2}$")
_stores: dict[str, Store] = {}


def changes_dir() -> tuple[Path, str]:
    """(folder, where): 'env', 'hub' (shared data folder) or 'repo'."""
    exact = os.environ.get("AXF_CHANGES_DIR")
    if exact:
        return Path(exact), "env"
    root = cx.persist_root()
    if root:
        hub = Path(root) / "changes"
        repo = cx.ROOT / "changes"
        if not hub.exists() and repo.is_dir():
            try:  # first use: seed from the repo's copy (entries written by sessions that couldn't reach the hub)
                shutil.copytree(repo, hub, symlinks=False, ignore=shutil.ignore_patterns(".*"))
            except OSError:
                pass
        return hub, "hub"
    return cx.ROOT / "changes", "repo"


def store() -> Store:
    d, _ = changes_dir()
    key = str(d)
    if key not in _stores:
        _stores[key] = Store(d)
    return _stores[key]


def _who(request: Request | None) -> str:
    if request is None:
        return "plugin"
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{redact(name, 40)}" if name and name != "console-token" else "console"


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, f"at most {MAX_BODY // 1024} KB")
    if not raw:
        return {}
    try:
        body = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "send JSON") from None
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object")
    return body


def _check_id(cid: str) -> str:
    if not ID_RE.match(cid or ""):
        raise HTTPException(400, "not a change id (chg-YYYYMMDD-hex)")
    return cid


def _load(cid: str) -> dict[str, Any]:
    e = store().get(_check_id(cid))
    if not e:
        raise HTTPException(404, "no entry with that id")
    return e


def _save(e: dict[str, Any]) -> dict[str, Any]:
    try:
        return store().put(e)
    except ValueError as err:
        raise HTTPException(400, str(err)[:600]) from None


def open_entry(body: dict[str, Any], by: str = "console") -> dict[str, Any]:
    unknown = set(body) - ENTRY_KEYS
    if unknown:
        raise ValueError(f"unknown field(s): {', '.join(sorted(unknown))[:200]}")
    cid = body.get("id")
    if cid is not None:
        if not ID_RE.match(str(cid)):
            raise ValueError("id must look like chg-YYYYMMDD-hex")
        cur = store().get(str(cid))
        if cur:
            return {**cur, "existed": True}
    else:
        cid = f"chg-{now_iso()[:10].replace('-', '')}-{secrets.token_hex(5)}"
    now = now_iso()
    raw = {"result": None, "closed": None, "steps": [], **body, "id": cid, "createdAt": body.get("createdAt") or now, "updatedAt": now}
    raw.setdefault("who", {})
    if isinstance(raw["who"], dict) and not raw["who"].get("user") and by:
        raw["who"] = {**raw["who"], "user": by}
    e, errors = normalize(raw, now)
    if e is None:
        raise ValueError("; ".join(errors[:8]))
    return store().put(e)


def update_entry(cid: str, patch: dict[str, Any]) -> dict[str, Any]:
    unknown = set(patch) - PATCH_KEYS
    if unknown:
        raise ValueError(f"unknown field(s): {', '.join(sorted(unknown))[:200]}")
    e = store().get(cid)
    if not e:
        raise KeyError(cid)
    now = now_iso()
    nxt = dict(e)
    for k in ("title", "kind", "asked", "repos", "model", "who", "steps", *sorted(BUILD_KEYS)):
        if k in patch:
            if patch[k] is None and k in BUILD_KEYS:
                nxt.pop(k, None)
            else:
                nxt[k] = patch[k]
    if patch.get("beat"):  # heartbeat: the session is still working on it
        nxt["lastSeenAt"] = now
    if "step" in patch:
        s = patch["step"]
        if not isinstance(s, dict) or set(s) - {"index", "text", "state", "note"}:
            raise ValueError("step is {index?, text?, state?, note?}")
        idx = s.get("index")
        if idx is not None and (not isinstance(idx, int) or isinstance(idx, bool) or idx < 0):
            raise ValueError("step.index is a whole number from 0")
        nxt["steps"] = upsert_step(nxt.get("steps") or [], index=idx, text=s.get("text") or None, state=s.get("state") or None,
                                   note=s.get("note"), now=now)
    if "result" in patch:
        r = patch["result"]
        if r is None:
            nxt["result"] = None
        elif isinstance(r, dict):
            nxt["result"] = {**(e.get("result") or {}), **r}
        else:
            raise ValueError("result is an object or null")
    # every write from a working session counts as a heartbeat; finishing stamps finishedAt (and the actual minutes)
    if not nxt.get("result"):
        nxt["lastSeenAt"] = now
    elif not e.get("result"):
        nxt.setdefault("finishedAt", now)
    nxt["updatedAt"] = now
    return store().put(nxt)


def set_closed(cid: str, by: str | None) -> dict[str, Any]:
    e = store().get(cid)
    if not e:
        raise KeyError(cid)
    if by is None:
        if not e.get("closed"):
            return e
        return store().put({**e, "closed": None, "updatedAt": now_iso()})
    if e.get("closed"):
        return e
    return store().put({**e, "closed": {"at": now_iso(), "by": by}, "updatedAt": now_iso()})


class Service:
    """axf.changes@1 — other plugins record or read changes through this, never by folder name."""
    version = 1

    def open(self, entry: dict[str, Any], by: str = "plugin") -> dict[str, Any]:
        return open_entry(entry, by)

    def update(self, cid: str, patch: dict[str, Any]) -> dict[str, Any]:
        return update_entry(cid, patch)

    def close(self, cid: str, by: str = "plugin") -> dict[str, Any]:
        return set_closed(cid, by)

    def reopen(self, cid: str) -> dict[str, Any]:
        return set_closed(cid, None)

    def get(self, cid: str) -> dict[str, Any] | None:
        return store().get(cid) if ID_RE.match(cid or "") else None

    def query(self, **kw: Any) -> dict[str, Any]:
        return store().query(**kw)

    def summaries(self) -> list[dict[str, Any]]:
        """Every entry's summary with its build stats (status, estimate, actual, surface, host, areas, …), newest first."""
        return store().summaries()

    def stamp(self) -> str:
        """Changes whenever any entry changes (for cheap live polling)."""
        return store().stamp()

    def cli(self) -> str:
        """The recording CLI, relative to the repo (so other plugins can tell sessions how to report without naming it)."""
        return str((Path(__file__).resolve().parents[1] / "changes.mjs").relative_to(cx.ROOT)) if str(Path(__file__)).startswith(str(cx.ROOT)) else "changes.mjs"


plugin_services.provide(SELF, Service(), FOLDER)


def _query(open_: str, closed: str, kind: str, state: str, repo: str, q: str, date_from: str, date_to: str, cursor: str, limit: int) -> dict[str, Any]:
    if kind and not re.fullmatch(r"[a-z][a-z0-9-]{0,23}", kind):
        raise HTTPException(400, "kind is a short lowercase word")
    if state and state not in ("running", "done", "failed", "partial", "cancelled"):
        raise HTTPException(400, "state is running, done, failed, partial or cancelled")
    if repo and not re.fullmatch(r"[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}", repo):
        raise HTTPException(400, "repo is owner/name")
    for d in (date_from, date_to):
        if d and not _DAY.match(d):
            raise HTTPException(400, "from/to are YYYY-MM-DD")
    if cursor and not ID_RE.match(cursor):
        raise HTTPException(400, "cursor is an entry id")
    if len(q) > 200:
        raise HTTPException(400, "search text is at most 200 characters")
    limit = max(1, min(200, limit))
    d, where = changes_dir()
    out = store().query(open_only=open_ in ("1", "true"), closed_only=closed in ("1", "true"), kind=kind, state=state, repo=repo, q=q,
                        date_from=date_from, date_to=date_to, cursor=cursor, limit=limit)
    return {**out, "where": where}


# `from` is a Python keyword, so the query string is read directly.
@router.get("/entries")
def list_entries_all(request: Request) -> dict[str, Any]:
    qp = request.query_params
    try:
        limit = int(qp.get("limit") or 50)
    except ValueError:
        raise HTTPException(400, "limit is a number") from None
    return _query(qp.get("open", ""), qp.get("closed", ""), qp.get("kind", ""), qp.get("state", ""), qp.get("repo", ""), qp.get("q", ""),
                  qp.get("from", ""), qp.get("to", ""), qp.get("cursor", ""), limit)


@router.get("/entries/{cid}")
def get_entry(cid: str) -> dict[str, Any]:
    return _load(cid)


@router.post("/entries")
async def post_entry(request: Request) -> dict[str, Any]:
    body = await _body(request)
    try:
        return open_entry(body, _who(request))
    except ValueError as e:
        raise HTTPException(400, str(e)[:600]) from None


@router.patch("/entries/{cid}")
async def patch_entry(cid: str, request: Request) -> dict[str, Any]:
    _check_id(cid)
    body = await _body(request)
    try:
        return update_entry(cid, body)
    except KeyError:
        raise HTTPException(404, "no entry with that id") from None
    except ValueError as e:
        raise HTTPException(400, str(e)[:600]) from None


@router.post("/entries/{cid}/close")
async def close_entry(cid: str, request: Request) -> dict[str, Any]:
    _check_id(cid)
    body = await _body(request)
    by = redact(body.get("by"), 60) if body.get("by") else _who(request)
    try:
        return set_closed(cid, by)
    except KeyError:
        raise HTTPException(404, "no entry with that id") from None


@router.post("/entries/{cid}/reopen")
def reopen_entry(cid: str) -> dict[str, Any]:
    _check_id(cid)
    try:
        return set_closed(cid, None)
    except KeyError:
        raise HTTPException(404, "no entry with that id") from None


@router.post("/close-all")
async def close_all(request: Request) -> dict[str, Any]:
    body = await _body(request)
    ids = body.get("ids")
    if ids is not None and (not isinstance(ids, list) or len(ids) > 500 or not all(isinstance(i, str) and ID_RE.match(i) for i in ids)):
        raise HTTPException(400, "ids is a list of entry ids (at most 500)")
    by = _who(request)
    targets = ids if ids is not None else [s["id"] for s in store().query(open_only=True, limit=500)["items"]]
    closed = 0
    for cid in targets:
        try:
            e = store().get(cid)
            if e and not e.get("closed"):
                set_closed(cid, by)
                closed += 1
        except (KeyError, ValueError):
            continue
    return {"closed": closed}


@router.get("/where")
async def where() -> dict[str, Any]:
    d, kind = changes_dir()
    return {"where": kind, "path": str(d), "hubPath": str(d) if kind == "hub" else "/projects/amberx-axf/_data/changes", "exists": d.is_dir(),
            "shared": kind == "hub"}
