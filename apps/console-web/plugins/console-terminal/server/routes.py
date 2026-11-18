"""Claude link — REST routes, under /api/plugins/console-terminal/claude-link (console token; 404 when the plugin is off).

Also served at /api/claude-link/… (capability mount of axf.claude-link@1: what framework/cli/claude-link.mjs and
claude-link-emit.mjs call, so nothing outside this folder names it).

  GET  claude-link?since=&kind=a,b&q=&limit=&all=   snapshot, oldest first (after the view marker unless all=1)
  GET  claude-link/stream?kind=&q=&since=&once=     SSE: `event: hello` (state), then `event: link` per event, id = event id;
                                                     a `: ping` comment every 15 s; resumes after Last-Event-ID (or since);
                                                     once=1 sends the backlog and ends (curl, tests)
  GET  claude-link/state                            connected, last event, counts per kind
  POST claude-link/clear                            moves the view marker; the log is kept
  POST claude-link/ingest {event | events: [...]}   events from outside the console (framework/cli/claude-link-emit.mjs)
  GET/PUT claude-link/view {paused, kinds, q}       the tab's live view state (pause, filters), shared by UI, API and voice
  POST claude-link/pause | resume | filter {kinds, q}   the same view changes as single commands (MCP, CLI, voice)
"""
from __future__ import annotations

import asyncio
import json
from typing import Any, AsyncIterator, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.routing import APIRoute
from fastapi.responses import StreamingResponse

from . import claude_link

HEARTBEAT_S = 15.0


def kinds_of(kind: str | list[str] | None) -> list[str]:
    raw = kind if isinstance(kind, list) else str(kind or "").split(",")
    ks = [k.strip() for k in raw if str(k).strip()]
    bad = [k for k in ks if k not in claude_link.KINDS]
    if bad:
        raise HTTPException(400, f"kind is one of {', '.join(claude_link.KINDS)}")
    return ks


class View:
    """The tab's shared live view (paused, kinds, q) and who wants to hear when it changes (open SSE streams)."""

    def __init__(self, v: dict[str, Any] | None = None):
        self.v: dict[str, Any] = {"paused": False, "kinds": [], "q": "", "rev": 0, **(v or {})}
        self.watchers: list[Callable[[dict[str, Any]], None]] = []

    def watch(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        self.watchers.append(fn)
        return lambda: self.watchers.remove(fn) if fn in self.watchers else None

    def set(self, body: dict[str, Any]) -> dict[str, Any]:
        v = self.v
        if "paused" in body:
            v["paused"] = bool(body["paused"])
        if "kinds" in body:
            v["kinds"] = kinds_of(body.get("kinds") or [])
        if "q" in body:
            v["q"] = str(body.get("q") or "")[:200]
        v["rev"] = int(v.get("rev") or 0) + 1
        for fn in list(self.watchers):
            fn(dict(v))
        return dict(v)


def build(bus: Callable[[], claude_link.Bus], view: View | dict[str, Any] | None = None) -> APIRouter:
    """The routes over a bus (a getter, so tests and a resize can swap it)."""
    r = APIRouter()
    vs = view if isinstance(view, View) else View(view)
    v = vs.v
    watch = vs.watch

    @r.get("/claude-link")
    def snapshot(since: int = 0, kind: str = "", q: str = "", limit: int = 200, all: bool = False) -> dict[str, Any]:
        return bus().snapshot(since=max(0, since), kinds=kinds_of(kind), q=q[:200], limit=max(1, min(limit, claude_link.MAX_SIZE)), all=all)

    @r.get("/claude-link/state")
    def state() -> dict[str, Any]:
        return {**bus().state(), "view": dict(v)}

    @r.post("/claude-link/clear")
    def clear() -> dict[str, Any]:
        return {"ok": True, **bus().clear()}

    @r.get("/claude-link/view")
    def get_view() -> dict[str, Any]:
        return dict(v)

    @r.put("/claude-link/view")
    def put_view(body: dict[str, Any]) -> dict[str, Any]:
        return vs.set(body)

    @r.post("/claude-link/pause")
    def pause() -> dict[str, Any]:
        return put_view({"paused": True})

    @r.post("/claude-link/resume")
    def resume() -> dict[str, Any]:
        return put_view({"paused": False})

    @r.post("/claude-link/filter")
    def set_filter(body: dict[str, Any]) -> dict[str, Any]:
        kinds = body.get("kinds")
        return put_view({"kinds": [] if kinds in (None, "", "all") else kinds, **({"q": body["q"]} if "q" in body else {})})

    @r.post("/claude-link/ingest")
    def ingest(body: dict[str, Any]) -> dict[str, Any]:
        evs = body.get("events") if isinstance(body.get("events"), list) else [body.get("event", body)]
        if not evs or len(evs) > 200:
            raise HTTPException(400, "send 1 to 200 events")
        ids, errors = [], []
        for i, e in enumerate(evs):
            try:
                ids.append(bus().append({**(e if isinstance(e, dict) else {}), "source": (e or {}).get("source") or "ingest"})["id"])
            except (ValueError, TypeError) as err:
                errors.append({"at": i, "error": str(err)})
        if errors and not ids:
            raise HTTPException(400, errors[0]["error"])
        return {"ok": True, "ids": ids, "errors": errors}

    @r.get("/claude-link/stream")
    async def stream(request: Request, kind: str = "", q: str = "", since: int = 0, once: bool = False) -> StreamingResponse:
        ks, q = kinds_of(kind), q[:200]
        try:
            last = int(request.headers.get("last-event-id") or since or 0)
        except ValueError:
            last = 0
        return StreamingResponse(sse(bus(), last, ks, q, once, request.is_disconnected, view=lambda: dict(v), watch=watch), media_type="text/event-stream",
                                 headers={"cache-control": "no-store", "x-accel-buffering": "no"})

    return r


def remount(src: APIRouter, strip: str = "/claude-link") -> APIRouter:
    """The same endpoints without the `/claude-link` prefix, for the capability mount /api/claude-link (axf.claude-link@1):
    one set of handlers, so both mounts share the bus and the view."""
    out = APIRouter()
    for rt in src.routes:
        if isinstance(rt, APIRoute):
            path = rt.path[len(strip):] if rt.path.startswith(strip) else rt.path
            out.add_api_route(path, rt.endpoint, methods=sorted(rt.methods or []), name=rt.name)
    return out


def frame(e: dict[str, Any]) -> str:
    return f"id: {e['id']}\nevent: link\ndata: {json.dumps(e, default=str, ensure_ascii=False)}\n\n"


async def sse(b: claude_link.Bus, last: int, kinds: list[str], q: str, once: bool = False,
              gone: Callable[[], Any] | None = None, heartbeat: float = HEARTBEAT_S, view: Callable[[], dict[str, Any]] | None = None,
              watch: Callable[[Callable[[dict[str, Any]], None]], Callable[[], None]] | None = None) -> AsyncIterator[str]:
    """hello (state + the shared view), the backlog after `last`, then live events and `event: view` when the view
    changes (pause / filters set from the API or voice); a ping comment when quiet."""
    loop = asyncio.get_running_loop()
    queue: asyncio.Queue = asyncio.Queue(maxsize=5000)

    def push(e: dict[str, Any]) -> None:
        try:
            loop.call_soon_threadsafe(queue.put_nowait, e)
        except (RuntimeError, asyncio.QueueFull):
            pass

    stop = b.subscribe(push)
    unwatch = watch(lambda nv: push({"$view": nv})) if watch else (lambda: None)
    try:
        yield "retry: 3000\n" + f"event: hello\ndata: {json.dumps({**b.state(), **({'view': view()} if view else {})}, default=str)}\n\n"
        backlog = b.snapshot(since=last, kinds=kinds, q=q, limit=claude_link.MAX_SIZE, all=last > 0)["items"]
        for e in backlog:
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
            if "$view" in e:
                yield f"event: view\ndata: {json.dumps(e['$view'])}\n\n"
                continue
            if e["id"] <= last or not claude_link.matches(e, kinds, q):
                continue
            last = e["id"]
            yield frame(e)
    finally:
        stop()
        unwatch()
