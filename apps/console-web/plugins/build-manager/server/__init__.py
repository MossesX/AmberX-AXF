"""Build manager (server part). Mounted at /api/plugins/build-manager/ (console token on every route, 404 when off,
never on the console MCP). Read-only: it stores nothing and changes nothing.

  GET live     what's in progress right now, from the activity feed (capability ``axf.activity@1``, looked up at
               request time, so this works with or without the Activity plugin and never names it):
               {available, items: [activity@1 items: running ones + the ones that finished in the last few minutes]}

The build list itself (pending list, build queue, plan) comes from the console's own read routes (/api/pending,
/api/build-queue, /api/plan) and is merged in the browser by web/merge.mjs, so it also works offline.
"""
from __future__ import annotations

import time
from typing import Any

from fastapi import APIRouter

import plugin_services

router = APIRouter()
ACTIVITY = "axf.activity@1"
RECENT_S = 10 * 60  # finished items older than this aren't news for the tracker
ACTIVE = ("queued", "running", "waiting")
KEEP = ("id", "source", "kind", "title", "detail", "state", "progress", "startedAt", "updatedAt", "finishedAt", "url", "by", "steps")


def _clean(it: Any) -> dict[str, Any] | None:
    if not isinstance(it, dict) or not it.get("id") or not it.get("title"):
        return None
    return {k: it[k] for k in KEEP if k in it}


@router.get("/live")
def live() -> dict[str, Any]:
    svc = plugin_services.get(ACTIVITY)
    if svc is None:
        return {"available": False, "items": [], "checkedAt": int(time.time() * 1000)}
    try:
        raw = svc.items() or []
    except Exception as e:  # noqa: BLE001 — the feed failing must not break the build list
        return {"available": True, "items": [], "error": str(e)[:160], "checkedAt": int(time.time() * 1000)}
    now = time.time() * 1000
    out = []
    for it in raw:
        c = _clean(it)
        if not c:
            continue
        if c.get("state") not in ACTIVE and now - float(c.get("finishedAt") or c.get("updatedAt") or 0) > RECENT_S * 1000:
            continue
        out.append(c)
    return {"available": True, "items": out[:100], "checkedAt": int(now)}
