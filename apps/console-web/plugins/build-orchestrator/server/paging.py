"""Paged answers for the build orchestrator's routes (Brett, Nov 25 2026: no pipeline status file, no whole-set reads).

Build status has one home, the builds store (builds@1: rows on Postgres after the cut), read and written through the
console's data layer (server/data_store.py):

    store_page(status, project, limit, offset)   one page of builds plus counts per status (builds-page@1)
    store_build(build_id)                        one build's row, or None

This server writes no build status itself: every change (queue, hold, retry, land, act …) runs the orchestrator CLIs,
which change that build's row in the same store under its lock and journal it. No route of this plugin opens, serves
or writes a status file, and no answer carries every build: a list goes out as
one page (`limit` rows from `offset`, DEFAULT_LIMIT when the caller gives none, MAX_LIMIT at most) with `total` = how
many rows match. Rows keep the exact fields the screens read; only limit, offset and total are added.
"""
from __future__ import annotations

from typing import Any, Iterable

from fastapi import HTTPException

DEFAULT_LIMIT = 50
MAX_LIMIT = 200  # data_store.PAGE_MAX
STATUS_RE_MAX = 40
# builds nobody is working on any more: the last rows of a list that leads with what is live
SETTLED = ("archived", "complete", "landed", "deleted")


def window(limit: Any = None, offset: Any = None) -> tuple[int, int]:
    """(limit, offset) as whole numbers inside the caps; anything else is a 400."""
    try:
        lim = DEFAULT_LIMIT if limit is None or limit == "" else int(limit)
        off = 0 if offset is None or offset == "" else int(offset)
    except (TypeError, ValueError):
        raise HTTPException(400, "limit and offset are whole numbers") from None
    if lim < 0 or off < 0:
        raise HTTPException(400, "limit and offset are 0 or more")
    return min(lim, MAX_LIMIT), off


def statuses(status: Any) -> list[str]:
    """One status, a comma list or a list → the statuses asked for ([] = any)."""
    vals = status.split(",") if isinstance(status, str) else list(status or [])
    return sorted({str(v).strip()[:STATUS_RE_MAX] for v in vals if str(v).strip()})[:40]


def _data_store() -> Any:
    import data_store  # the console's data layer (apps/console-web/server), on sys.path wherever this plugin loads
    return data_store


def _in_project(b: dict[str, Any], project: str) -> bool:
    profiles = b.get("profiles")
    return b.get("project") == project or b.get("profile") == project or (isinstance(profiles, list) and project in profiles)


def store_page(status: Any = None, project: str = "", limit: int = DEFAULT_LIMIT, offset: int = 0, *, deleted: bool = False) -> dict[str, Any]:
    """One page of the builds store, newest status change first: { ok, rev, total, counts, items, limit, offset }.
    data_store.builds_page (builds-page@1) answers; a data layer from before it gets the same page cut from the store
    as builds_store reads it (the axf-data tables after the cut). DataStoreError when axf-data can't be reached."""
    ds = _data_store()
    want = statuses(status)
    limit, offset = max(0, min(int(limit), MAX_LIMIT)), max(0, int(offset))
    if callable(getattr(ds, "builds_page", None)):
        return ds.builds_page(status=want or None, project=project or None, limit=limit, offset=offset, deleted=deleted)
    import builds_store
    doc = builds_store.read()
    rows = [b for b in ((doc or {}).get("builds") or []) if isinstance(b, dict) and (deleted or not b.get("deleted"))]
    if project:
        rows = [b for b in rows if _in_project(b, project)]
    counts: dict[str, int] = {}
    for b in rows:
        st = str(b.get("status") or "")
        counts[st] = counts.get(st, 0) + 1
    if want:
        rows = [b for b in rows if str(b.get("status") or "") in want]
    rows.sort(key=lambda b: str(b.get("statusAt") or b.get("updatedAt") or b.get("createdAt") or ""), reverse=True)
    return {"ok": doc is not None, "rev": int(doc.get("rev") or 0) if doc is not None else -1, "limit": limit, "offset": offset,
            "total": len(rows), "counts": dict(sorted(counts.items())), "items": rows[offset:offset + limit]}


def store_build(build_id: str) -> dict[str, Any] | None:
    """One build's row by id (deleted ones too), or None. Never a status file."""
    ds = _data_store()
    if callable(getattr(ds, "build_row", None)):
        return ds.build_row(build_id)
    import builds_store
    return next((b for b in builds_store.builds() if isinstance(b, dict) and b.get("id") == build_id), None)


def project_ids(project: str) -> set[str]:
    """The ids of a project's builds, a page at a time from the store (ids only are kept)."""
    out: set[str] = set()
    offset = 0
    while True:
        page = store_page(project=project, limit=MAX_LIMIT, offset=offset, deleted=True)
        items = page.get("items") or []
        out.update(str(b.get("id")) for b in items if b.get("id"))
        offset += len(items)
        if not items or offset >= int(page.get("total") or 0):
            return out


class Filter:
    """What a list is cut down to before it is paged: statuses (any of) and a project. A row that says which project
    it is in is matched on that; a row that doesn't (the CLI views are already one project's) is matched by id against
    the project's builds in the store, read once per request and only when a project is asked for."""

    def __init__(self, status: Any = None, project: Any = None, *, status_key: str = "status", id_key: str = "id"):
        self.want = set(statuses(status))
        self.project = str(project or "").strip()[:80]
        self.status_key, self.id_key = status_key, id_key
        self._ids: set[str] | None = None

    def __bool__(self) -> bool:
        return bool(self.want or self.project)

    def _member(self, row: dict[str, Any]) -> bool:
        if any(k in row for k in ("project", "profile", "profiles")):
            return _in_project(row, self.project)
        if self._ids is None:
            self._ids = project_ids(self.project)
        return str(row.get(self.id_key) or "") in self._ids

    def match(self, row: Any) -> bool:
        if not isinstance(row, dict):
            return not self
        if self.want and str(row.get(self.status_key) or "") not in self.want:
            return False
        return not self.project or self._member(row)

    def rows(self, rows: Iterable[Any] | None) -> list[Any]:
        rows = list(rows or [])
        return [r for r in rows if self.match(r)] if self else rows


def cut(rows: Iterable[Any] | None, limit: int, offset: int, flt: Filter | None = None) -> tuple[list[Any], int]:
    """(the page, how many rows match): `limit` rows from `offset` of the rows the filter keeps."""
    kept = flt.rows(rows) if flt is not None else list(rows or [])
    return kept[offset:offset + limit], len(kept)


def live_first(rows: Iterable[Any] | None) -> list[Any]:
    """The same rows, the ones still being worked on first (order kept inside each half): page one of a long list is
    what matters now, hidden and settled builds follow."""
    rows = list(rows or [])
    settled = lambda r: isinstance(r, dict) and (bool(r.get("hidden")) or str(r.get("status") or "") in SETTLED)  # noqa: E731
    return [r for r in rows if not settled(r)] + [r for r in rows if settled(r)]


def paged(res: dict[str, Any], key: str, limit: int, offset: int, flt: Filter | None = None) -> dict[str, Any]:
    """A copy of `res` whose list `key` is one page, with limit, offset and total beside it."""
    items, total = cut(res.get(key), limit, offset, flt)
    return {**res, key: items, "limit": limit, "offset": offset, "total": total}
