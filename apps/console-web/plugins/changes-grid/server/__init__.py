"""Changes & features grid (server part). Mounted at /api/plugins/changes-grid/ (console token on every route, 404 when
off, never on the console MCP).

  GET  changes        every change-log@1 entry summary, newest first, read through the capability ``axf.changes@1``
                      (looked up at request time, so the grid works with or without the Codebase changes plugin and never
                      names it): {available, items}
  GET  changes/{id}   one whole entry (steps, result, commits, links) for an expanded row: {available, entry}

Features come from the console's own plan route in the browser. Nothing is stored.
"""
from __future__ import annotations

import re
from typing import Any

from fastapi import APIRouter, HTTPException

import plugin_services

router = APIRouter()
CHANGES = "axf.changes@1"
_CID = re.compile(r"^chg-\d{8}-[0-9a-f]{6,16}$")


@router.get("/changes")
def changes() -> dict[str, Any]:
    svc = plugin_services.get(CHANGES)
    if not svc:
        return {"available": False, "items": []}
    try:
        return {"available": True, "items": list(svc.summaries())}
    except Exception as e:  # noqa: BLE001 — a broken log never breaks the grid
        return {"available": False, "items": [], "error": str(e)[:200]}


@router.get("/changes/{cid}")
def change(cid: str) -> dict[str, Any]:
    if not _CID.match(cid):
        raise HTTPException(400, "not a change id")
    svc = plugin_services.get(CHANGES)
    if not svc:
        return {"available": False, "entry": None}
    entry = svc.get(cid)
    if entry is None:
        raise HTTPException(404, "no such change")
    return {"available": True, "entry": entry}
