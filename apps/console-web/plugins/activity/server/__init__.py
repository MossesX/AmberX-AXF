"""Activity — server part. Mounted at /api/plugins/activity/ (console token, 404 when disabled, never on the console MCP).

  GET    items                  everything in progress (+ what just finished), from every source (feed.py)
  GET    detail?id=<id>         more about one item (GitHub runs: jobs and steps)
  POST   report                 {id, title, state?, detail?, progress?, steps?, url?, by?} add or update a reported item
  POST   finish                 {id, state?: done|failed|cancelled, detail?}
  DELETE item?id=<id>           drop a reported item (e.g. one that went stale)
  GET    config | PUT config    {sources: {github, update, assistant, services, reports}, repos, lingerS, reportTtlS}

Provides ``axf.activity@1``: report(item), finish(id, state, detail), items(), register_source(name, label, fn).
Other plugins don't need it to show up here: a capability service with an ``activity()`` method is read by itself.
"""
from __future__ import annotations

import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from .feed import SOURCES, Feed

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SELF = "axf.activity@1"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_ACTIVITY_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _services() -> list[tuple[str, Any]]:
    out = []
    for s in plugin_services.available():
        if s["name"] in (SELF, "axf.live-sessions@1") or not s.get("enabled"):
            continue
        impl = plugin_services.get(s["name"])
        if impl is not None:
            out.append((s["name"], impl))
    return out


FEED = Feed(data_dir(), cx.ROOT, default_repos=[r for r in (cx.GITHUB_REPO or "MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot") if r],
            services=_services, live_sessions=lambda: plugin_services.get("axf.live-sessions@1"))


class Service:
    """axf.activity@1"""
    version = 1

    def report(self, item: dict[str, Any], origin: str = "plugin") -> dict[str, Any]:
        return FEED.report(item, origin)

    def finish(self, iid: str, state: str = "done", detail: str | None = None) -> dict[str, Any] | None:
        return FEED.finish(iid, state, detail)

    def items(self) -> list[dict[str, Any]]:
        return FEED.snapshot()["items"]

    def register_source(self, name: str, label: str, fn: Any) -> Any:
        return FEED.register_source(name, label, fn)


plugin_services.provide(SELF, Service(), FOLDER)


def _who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{name}" if name else "console"


@router.get("/items")
def items() -> dict[str, Any]:
    return FEED.snapshot()


@router.get("/detail")
def detail(id: str) -> dict[str, Any]:  # noqa: A002
    try:
        return FEED.detail(id)
    except KeyError:
        raise HTTPException(404, "not in the feed (it may have just finished)") from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"couldn't load the details: {str(e)[:160]}") from None


@router.post("/report")
async def report(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object")
    try:
        return FEED.report(body, _who(request))
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/finish")
async def finish(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or not body.get("id"):
        raise HTTPException(400, "send {id, state?, detail?}")
    it = FEED.finish(str(body["id"]), str(body.get("state") or "done"), body.get("detail"))
    if not it:
        raise HTTPException(404, "no reported item with that id")
    return it


@router.delete("/item")
def dismiss(id: str) -> dict[str, Any]:  # noqa: A002
    return {"removed": FEED.dismiss(id)}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {**FEED.config(), "sourceLabels": SOURCES}


@router.put("/config")
async def put_config(request: Request) -> dict[str, Any]:
    body = await request.json()
    try:
        return FEED.set_config(body if isinstance(body, dict) else {})
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
