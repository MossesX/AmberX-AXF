"""Claude link — REST routes, under /api/plugins/console-terminal/claude-link (console token; 404 when the plugin is off).

  GET  claude-link?since=&kind=a,b&q=&limit=&all=   snapshot, oldest first (after the view marker unless all=1)
  GET  claude-link/stream?kind=&q=&since=&once=     SSE: `event: hello` (state), then `event: link` per event, id = event id;
                                                     a `: ping` comment every 15 s; resumes after Last-Event-ID (or since);
                                                     once=1 sends the backlog and ends (curl, tests)
  GET  claude-link/state                            connected, last event, counts per kind
  POST claude-link/clear                            moves the view marker; the log is kept
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

from . import claude_link

HEARTBEAT_S = 15.0
RETRY_MS = 3000
QUEUE_MAX = 5000
Q_MAX = 200


def kinds_of(kind: str | list[str] | None) -> list[str]:
    """`a,b` (or a list) as checked kinds; 400 on one that isn't a claude-link-event@1 kind."""
    raw = kind if isinstance(kind, list) else str(kind or "").split(",")
    ks = [str(k).strip() for k in raw if str(k).strip()]
    bad = [k for k in ks if k not in claude_link.KINDS]
    if bad:
        raise HTTPException(400, f"kind is one of {', '.join(claude_link.KINDS)}")
    return list(dict.fromkeys(ks))


def last_id(header: str | None, since: int = 0) -> int:
    """Where a stream picks up: the browser's Last-Event-ID on a reconnect, else ?since=. Junk reads as 0."""
    try:
        return max(0, int(str(header).strip())) if header not in (None, "") else max(0, int(since or 0))
    except ValueError:
        return max(0, int(since or 0))


def build(bus: Callable[[], claude_link.Bus]) -> APIRouter:
    """The routes over a bus (a getter, so tests and a resize can swap it)."""
    r = APIRouter()

    @r.get("/claude-link")
    def snapshot(since: int = 0, kind: str = "", q: str = "", limit: int = 200, all: bool = False) -> dict[str, Any]:
        return bus().snapshot(since=max(0, since), kinds=kinds_of(kind), q=q[:Q_MAX], limit=max(1, min(limit, claude_link.MAX_SIZE)), all=all)

    @r.get("/claude-link/state")
    def state() -> dict[str, Any]:
        return bus().state()

    @r.post("/claude-link/clear")
    def clear() -> dict[str, Any]:
        return {"ok": True, **bus().clear()}

    @r.get("/claude-link/stream")
    async def stream(request: Request, kind: str = "", q: str = "", since: int = 0, once: bool = False) -> StreamingResponse:
        ks = kinds_of(kind)
        last = last_id(request.headers.get("last-event-id"), since)
        return StreamingResponse(sse(bus(), last, ks, q[:Q_MAX], once, request.is_disconnected), media_type="text/event-stream",
                                 headers={"cache-control": "no-store", "x-accel-buffering": "no"})

    return r


def frame(e: dict[str, Any]) -> str:
    return f"id: {e['id']}\nevent: link\ndata: {json.dumps(e, default=str, ensure_ascii=False)}\n\n"


async def sse(b: claude_link.Bus, last: int, kinds: list[str], q: str, once: bool = False,
              gone: Callable[[], Any] | None = None, heartbeat: float = HEARTBEAT_S) -> AsyncIterator[str]:
    """hello (state), the backlog after `last`, then live events; a ping comment when quiet.

    A fresh stream (last = 0) starts after the view marker; a resumed one (last > 0) gets everything it missed, so a
    reconnect never loses a line to a Clear pressed in between. The subscription opens before the backlog is read and
    events at or below the last id sent are dropped, so nothing is missed or sent twice."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=QUEUE_MAX)

    def put(e: dict[str, Any]) -> None:
        try:
            queue.put_nowait(e)
        except asyncio.QueueFull:  # a reader this far behind reconnects and resumes from its Last-Event-ID
            pass

    def push(e: dict[str, Any]) -> None:
        try:
            loop.call_soon_threadsafe(put, e)
        except RuntimeError:  # the loop closed under a late event
            pass

    stop = b.subscribe(push)
    try:
        yield f"retry: {RETRY_MS}\nevent: hello\ndata: {json.dumps(b.state(), default=str, ensure_ascii=False)}\n\n"
        for e in b.snapshot(since=last, kinds=kinds, q=q, limit=claude_link.MAX_SIZE, all=last > 0)["items"]:
            last = e["id"]
            yield frame(e)
        if once:
            return
        while True:
            try:
                e = await asyncio.wait_for(queue.get(), timeout=heartbeat)
            except asyncio.TimeoutError:
                if gone is not None and await gone():
                    return
                yield ": ping\n\n"
                continue
            if e["id"] <= last or not claude_link.matches(e, kinds, q):
                continue
            last = e["id"]
            yield frame(e)
    finally:
        stop()
