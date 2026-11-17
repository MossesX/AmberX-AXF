"""Live build status (build-live@1, framework/spec/BUILD-LIVE.md): the console live channel for builds.

Every builds store write and every 15-second liveness pass is one build-live-event@1 appended by the node side
(framework/cli/build-live-channel.mjs) to <repo>/.axf-console/build-live/events.jsonl, with the fold in state.json.
This module tails that file and pushes each new frame to every open stream, so the grids follow without polling:

    GET /api/plugins/build-orchestrator/live/stream      SSE: `event: build-live-snapshot` first (or the frames since
                                                         Last-Event-ID / ?since=<seq> when the ring still has them),
                                                         then one `event: build-live` frame per event and one
                                                         `event: build-live-tick` per liveness pass, keepalive 20 s
    GET /api/plugins/build-orchestrator/live/events      the last frames as JSON (?since=<seq>, ?limit)

The snapshot routes (GET /live, /live/<build>) and the settings / broke routes live in routes_live.py.
"""
from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any, AsyncIterator

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

ROOT = Path(__file__).resolve().parents[5]  # server → build-orchestrator → plugins → console-web → apps → repo
SSE_EVENT = "build-live"
SNAPSHOT_EVENT = "build-live-snapshot"
TICK_EVENT = "build-live-tick"  # the liveness pass's heartbeat summary (build-live-tick@1, no seq)
POLL_SEC = 0.75
KEEPALIVE_SEC = 20
RING = 2000


def channel_dir() -> Path:
    d = os.environ.get("AXF_BUILD_LIVE_DIR")
    return Path(d) if d else ROOT / ".axf-console" / "build-live"


def read_state() -> dict[str, Any]:
    """build-live-snapshot@1 (+ lastTick) as the node side folded it; an empty snapshot when the channel is new."""
    try:
        doc = json.loads((channel_dir() / "state.json").read_text())
        if isinstance(doc, dict) and doc.get("$axf") == "build-live-snapshot@1" and isinstance(doc.get("builds"), list):
            return doc
    except (OSError, ValueError):
        pass
    return {"$axf": "build-live-snapshot@1", "at": "", "seq": 0, "everySec": 15, "builds": [], "lastTick": None}


def read_events(since: int = 0, limit: int = RING) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    try:
        lines = (channel_dir() / "events.jsonl").read_text().splitlines()
    except OSError:
        return out
    for line in lines[-RING:]:
        try:
            ev = json.loads(line)
        except ValueError:
            continue
        if isinstance(ev, dict) and int(ev.get("seq") or 0) > since:
            out.append(ev)
    return out[-max(1, min(limit, RING)):]


def frame(ev: dict[str, Any], event: str = SSE_EVENT) -> str:
    seq = ev.get("seq")
    head = f"id: {seq}\n" if isinstance(seq, int) and seq > 0 else ""
    return f"{head}event: {event}\ndata: {json.dumps(ev, separators=(',', ':'))}\n\n"


class Tail:
    """Reads the frames appended to events.jsonl since the last call (handles a trim: the file got shorter)."""

    def __init__(self) -> None:
        self.path = channel_dir() / "events.jsonl"
        self.offset = self.path.stat().st_size if self.path.exists() else 0
        self.buf = b""

    def poll(self) -> list[dict[str, Any]]:
        try:
            size = self.path.stat().st_size
        except OSError:
            return []
        if size < self.offset:
            self.offset, self.buf = 0, b""
        if size == self.offset:
            return []
        with self.path.open("rb") as f:
            f.seek(self.offset)
            chunk = f.read(size - self.offset)
        self.offset = size
        data = self.buf + chunk
        lines = data.split(b"\n")
        self.buf = lines.pop()  # a partial last line waits for the rest
        out = []
        for line in lines:
            try:
                ev = json.loads(line)
            except ValueError:
                continue
            if isinstance(ev, dict):
                out.append(ev)
        return out


async def stream_frames(since: int | None, is_disconnected=None) -> AsyncIterator[str]:
    """The SSE body: catch-up (replay or snapshot), then every new frame as it is appended."""
    tail = Tail()
    yield "retry: 3000\n\n"
    last = 0
    replay = read_events(since) if since else []
    top = int(read_state().get("seq") or 0)
    ring_has = bool(since) and since <= top and (int(replay[0].get("seq") or 0) == since + 1 if replay else since == top)
    if since and ring_has:
        for ev in replay:
            last = max(last, int(ev.get("seq") or 0))
            yield frame(ev)
    else:
        snap = read_state()
        last = int(snap.get("seq") or 0)
        yield frame({**snap, "seq": last}, SNAPSHOT_EVENT)
    idle = 0.0
    while True:
        if is_disconnected is not None and await is_disconnected():
            return
        evs = tail.poll()
        sent = False
        for ev in evs:
            seq = int(ev.get("seq") or 0)
            if seq and seq <= last:
                continue
            last = max(last, seq)
            sent = True
            yield frame(ev, TICK_EVENT if ev.get("$axf") == "build-live-tick@1" else SSE_EVENT)
        if sent:
            idle = 0.0
        else:
            idle += POLL_SEC
            if idle >= KEEPALIVE_SEC:
                idle = 0.0
                yield ": keepalive\n\n"
        await asyncio.sleep(POLL_SEC)


def router() -> APIRouter:
    r = APIRouter()

    @r.get("/live/stream")
    async def live_stream(request: Request, since: int = 0) -> StreamingResponse:
        last_id = request.headers.get("last-event-id") or ""
        start = int(last_id) if last_id.isdigit() else since
        return StreamingResponse(stream_frames(start or None, request.is_disconnected), media_type="text/event-stream",
                                 headers={"cache-control": "no-store", "x-accel-buffering": "no"})

    @r.get("/live/events")
    def live_events(since: int = 0, limit: int = 200) -> dict[str, Any]:
        evs = read_events(since, limit)
        return {"ok": True, "seq": read_state().get("seq", 0), "events": evs}

    return r
