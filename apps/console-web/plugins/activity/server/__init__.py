"""Activity — server part. Mounted at /api/plugins/activity/ (console token, 404 when disabled, never on the console MCP).

  GET    items                  everything in progress (+ what just finished), from every source (feed.py)
  GET    detail?id=<id>         more about one item (GitHub runs: jobs and steps)
  POST   report                 {id, title, state?, detail?, progress?, steps?, url?, by?} add or update a reported item
  POST   finish                 {id, state?: done|failed|cancelled, detail?}
  DELETE item?id=<id>           take an item off the banner everywhere (a reported one is deleted; any other
                                is remembered as dismissed for a day): the trash can on a stuck item
  POST   close                  {id} ✕ on a finished item: moved to the Codebase changes banner, or deleted (onClose)
  POST   continue               {id} Continue on a held item: returns {action} the browser runs next (a hold is
                                marked continued on every device; a held report turns running)
  POST   hold-back              {id} put a continued hold back on hold (the build didn't start after all)
  POST   notify/test            sends a test push through axHub (the hub inbox + a console alert)
  GET    config | PUT config    {sources: {github, update, assistant, services, reports}, repos, lingerS, reportTtlS,
                                 autoRemove, keepFailed, onClose, onAutoRemove, push, pushLevel, pushMinS, sound, toast,
                                 expandOnDone, openResult} (complete.py says what each does)

Provides ``axf.activity@1``: report(item), finish(id, state, detail), items(), register_source(name, label, fn).
Other plugins don't need it to show up here: a capability service with an ``activity()`` method is read by itself.
"""
from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from . import complete
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


def _pending_status(pid: str) -> str | None:
    """A pending build's status (framework/plan/pending.json in the shared data folder, else the repo copy)."""
    for base in (cx.persist_root(), cx.ROOT):
        if base is None:
            continue
        try:
            data = json.loads((Path(base) / "framework" / "plan" / "pending.json").read_text("utf-8"))
        except (OSError, ValueError):
            continue
        for it in data.get("items", []) if isinstance(data, dict) else []:
            if isinstance(it, dict) and it.get("id") == pid:
                return str(it.get("status") or "pending")
        return "missing"
    return None


FEED = Feed(data_dir(), cx.ROOT, default_repos=[r for r in (cx.GITHUB_REPO or "MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot") if r],
            services=_services, live_sessions=lambda: plugin_services.get("axf.live-sessions@1"),
            holds_file=Path(__file__).resolve().parents[1] / "holds.json", pending_status=_pending_status)

COMPLETE = complete.Completer(data_dir(), FEED.snapshot, FEED.config, FEED.dismiss,
                              changes=lambda: plugin_services.get(complete.CHANGES),
                              raise_alert=lambda a: cx.raise_alert(a))
if os.environ.get("AXF_ACTIVITY_WATCH") != "off":
    complete.start_watcher(COMPLETE)


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


@router.post("/continue")
async def continue_(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        raise HTTPException(400, "send {id}")
    try:
        return FEED.continue_item(body["id"], _who(request))
    except KeyError:
        raise HTTPException(404, "no held item with that id") from None


@router.post("/hold-back")
async def hold_back(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        raise HTTPException(400, "send {id}")
    return {"held": FEED.hold_back(body["id"])}


@router.delete("/item")
def dismiss(id: str) -> dict[str, Any]:  # noqa: A002
    COMPLETE.forget(id)
    return {"removed": FEED.dismiss(id)}


@router.post("/close")
async def close(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or not isinstance(body.get("id"), str):
        raise HTTPException(400, "send {id}")
    try:
        return COMPLETE.close(body["id"])
    except KeyError:
        raise HTTPException(404, "not in the feed any more") from None
    except ValueError as e:
        raise HTTPException(409, str(e)) from None


@router.post("/notify/test")
def notify_test() -> dict[str, Any]:
    now = int(COMPLETE.now() * 1000)
    return COMPLETE.push({"id": "activity-test", "kind": "task", "title": "Test notification from the Activity banner", "detail": "If this reached your phone, finished work will too.",
                          "state": "done", "startedAt": now, "updatedAt": now, "finishedAt": now})


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {**FEED.config(), "sourceLabels": SOURCES, "lastPush": COMPLETE.last_push, "hubInbox": str(complete.inbox_dir() or "") or None,
            "changesOn": plugin_services.get(complete.CHANGES) is not None}


@router.put("/config")
async def put_config(request: Request) -> dict[str, Any]:
    body = await request.json()
    try:
        return FEED.set_config(body if isinstance(body, dict) else {})
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
