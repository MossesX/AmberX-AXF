"""The live channel for builds (builds-events@1): one update command in, one event out to every open screen.

The builds store is the one true source (framework/cli/builds-store.mjs). Nothing here carries build or step data: an
event only says "the store moved, read it again", so the orchestrator and Plan Studio 2.0 get the same nudge at the
same moment and both re-read the same records.

    POST /api/builds/updated          { build, state, rev, at }   the one update command (console token or a signed-in
                                      admin). The VPS pipeline sends it after every state change it writes, the lander
                                      after every landing state and merge-line change. → { ok, delivered }
    GET  /api/builds/events           Server-Sent Events. Every command becomes one event on every connection:
                                          event: builds.updated
                                          data: {"build": "...", "state": "...", "rev": 12, "at": "..."}
                                      Heartbeat comments keep proxies from closing an idle stream; a closed browser
                                      tab is dropped at once.
    POST /api/builds/merge-together   { builds?: [id], off?: true }   the merge line's "Merge together" press: asks the
                                      lander (deploy/lander/run.mjs merge-together) to combine the builds waiting to
                                      merge (the ones named, or all of them) into one PR on its next tick.
                                      → the lander's own answer: { ok, mergeTogether, builds, message }.

The fallback watcher: while at least one screen is connected, the builds store's revision is read every WATCH_S
seconds (builds_store.marker(), which goes through server/data_store.py to the axf-data tables, or the local file
before the cut). When it moved and no command arrived for it, the watcher emits `builds.updated` itself (build and
state empty: "something changed"), so a missed command still refreshes every screen. With nobody connected nothing
is polled.

Nothing is written to disk: subscribers, the last revision seen and the counters live in memory.
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
from datetime import datetime, timezone
from typing import Any, AsyncIterator, Awaitable, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse

SCHEMA = "builds-events@1"
EVENT = "builds.updated"
WATCH_S = 3.0  # the fallback watcher's beat
HEARTBEAT_S = 20.0  # an idle stream gets a comment line this often
QUEUE_MAX = 64  # events a slow screen may have waiting; past it they fold into one "read again"
RETRY_MS = 3000  # what a dropped EventSource waits before it reconnects

_BUILD = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
_STATE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")


def _now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def clean_event(body: Any) -> dict[str, Any]:
    """The command's body → the event every screen gets: { build, state, rev, at } and nothing else. Raises ValueError
    with the field that is wrong. `build` and `state` may be empty (the watcher's "something changed")."""
    if not isinstance(body, dict):
        raise ValueError("send a JSON object: { build, state, rev, at }")
    build = body.get("build") or ""
    state = body.get("state") or ""
    if not isinstance(build, str) or (build and not _BUILD.match(build)):
        raise ValueError("build must be a build id")
    if not isinstance(state, str) or (state and not _STATE.match(state)):
        raise ValueError("state must be a pipeline state (lower case, dashes)")
    rev = body.get("rev")
    if isinstance(rev, bool) or not isinstance(rev, (int, float)) or rev != rev or abs(rev) > 2**53:
        rev = 0
    at = body.get("at")
    return {"build": build, "state": state, "rev": int(rev), "at": at[:40] if isinstance(at, str) and at else _now()}


def frame(event: dict[str, Any]) -> str:
    """One Server-Sent Event."""
    return f"event: {EVENT}\ndata: {json.dumps(event, separators=(',', ':'))}\n\n"


class Hub:
    """Every connected screen, and the watcher that covers a missed command. `marker` reads what changes when the
    builds store does (default: builds_store.marker); it runs off the event loop, because it may ask axf-data."""

    def __init__(self, marker: Callable[[], str] | None = None, *, watch_s: float = WATCH_S, heartbeat_s: float = HEARTBEAT_S) -> None:
        self._marker = marker
        self.watch_s = watch_s
        self.heartbeat_s = heartbeat_s
        self._subs: set[asyncio.Queue[dict[str, Any]]] = set()
        self._task: asyncio.Task[None] | None = None
        self._seen: str | None = None  # the store marker the watcher last saw
        self._commands = 0  # commands received, ever
        self._commands_seen = 0  # … as of the watcher's last look
        self.sent = 0
        self.watched = 0  # events the watcher had to send itself

    # ---------------------------------------------------------------- subscribers

    @property
    def subscribers(self) -> int:
        return len(self._subs)

    def publish(self, event: dict[str, Any]) -> int:
        """Fan one event out to every connection. A screen that is not reading (its queue is full) keeps one
        "read again" in place of the backlog: it never holds the others up and never grows without bound."""
        for q in list(self._subs):
            if q.full():
                while not q.empty():
                    q.get_nowait()
                q.put_nowait({"build": "", "state": "", "rev": event.get("rev", 0), "at": event.get("at", _now())})
            else:
                q.put_nowait(event)
        self.sent += 1
        return len(self._subs)

    def command(self, body: Any) -> dict[str, Any]:
        """The update command: validate, fan out, and remember that a command covered this change."""
        event = clean_event(body)
        self._commands += 1
        return {"ok": True, "event": event, "delivered": self.publish(event)}

    async def stream(self, disconnected: Callable[[], Awaitable[bool]] | None = None) -> AsyncIterator[str]:
        """One connection's stream: the retry hint, then every event as it comes, a heartbeat comment when idle.
        Ends (and unsubscribes) when the client is gone or the generator is closed."""
        q: asyncio.Queue[dict[str, Any]] = asyncio.Queue(maxsize=QUEUE_MAX)
        self._subs.add(q)
        self._ensure_watcher()
        try:
            yield f"retry: {RETRY_MS}\n: connected\n\n"
            idle = 0.0
            step = min(1.0, self.heartbeat_s)
            while True:
                if disconnected is not None and await disconnected():
                    return
                try:
                    event = await asyncio.wait_for(q.get(), timeout=step)
                except asyncio.TimeoutError:
                    idle += step
                    if idle >= self.heartbeat_s:
                        idle = 0.0
                        yield ": keep-alive\n\n"
                    continue
                idle = 0.0
                yield frame(event)
        finally:
            self._subs.discard(q)
            if not self._subs:
                self._stop_watcher()

    # ---------------------------------------------------------------- the fallback watcher

    def _read_marker(self) -> str:
        if self._marker is not None:
            return self._marker()
        import builds_store  # the server's one reader of the builds store (through data_store.py)

        return builds_store.marker()

    @staticmethod
    def _rev_of(marker: str) -> int:
        try:
            return max(0, int(str(marker).split(":", 1)[0]))
        except ValueError:
            return 0

    async def check_once(self) -> dict[str, Any] | None:
        """One beat of the watcher: read the store's marker; when it moved and no command arrived since the last beat,
        emit `builds.updated`. → the event it sent, or None (nothing moved, a command covered it, the first look, or
        the store could not be read)."""
        try:
            now = await asyncio.to_thread(self._read_marker)
        except Exception:  # noqa: BLE001 - a store that can't be read is not news; the next beat asks again
            return None
        commands = self._commands
        first = self._seen is None
        moved = not first and now != self._seen
        covered = commands != self._commands_seen
        self._seen = now
        self._commands_seen = commands
        if not moved or covered or now.startswith("-1:"):  # -1: the store could not be read just now
            return None
        event = {"build": "", "state": "", "rev": self._rev_of(now), "at": _now()}
        self.watched += 1
        self.publish(event)
        return event

    async def _watch(self) -> None:
        while self._subs:
            await self.check_once()
            await asyncio.sleep(self.watch_s)

    def _ensure_watcher(self) -> None:
        if self.watch_s <= 0 or (self._task is not None and not self._task.done()):
            return
        self._seen = None  # nobody was watching: the first look only records where the store is
        self._task = asyncio.get_running_loop().create_task(self._watch())

    def _stop_watcher(self) -> None:
        if self._task is not None and not self._task.done():
            self._task.cancel()
        self._task = None

    def status(self) -> dict[str, Any]:
        return {"$axf": SCHEMA, "subscribers": len(self._subs), "sent": self.sent, "watched": self.watched, "commands": self._commands, "watching": self._task is not None and not self._task.done()}


HUB = Hub()


def _lander(args: list[str], root: Any) -> dict[str, Any]:
    """Ask the lander's CLI (deploy/lander/run.mjs); its JSON answer, or { ok: False, error }."""
    try:
        proc = subprocess.run(["node", str(root / "deploy" / "lander" / "run.mjs"), *args, "--json"], cwd=root, capture_output=True, text=True, timeout=30)
        out = json.loads(proc.stdout.strip().splitlines()[-1]) if proc.stdout.strip() else None
    except (OSError, ValueError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"the lander did not answer: {str(e)[:200]}"}
    if not isinstance(out, dict):
        return {"ok": False, "error": (proc.stderr or "the lander answered nothing").strip()[-300:]}
    return out


def router_for(auth: Callable[..., Any], hub: Hub | None = None, *, lander: Callable[[list[str]], dict[str, Any]] | None = None) -> APIRouter:
    """The routes, behind the console's own `auth` for everything that changes something. `hub` and `lander` are
    injectable for tests."""
    h = hub or HUB
    r = APIRouter()

    def run_lander(args: list[str]) -> dict[str, Any]:
        if lander is not None:
            return lander(args)
        import data_store

        return _lander(args, data_store.ROOT)

    @r.post("/api/builds/updated", dependencies=[Depends(auth)])
    async def updated(request: Request) -> dict[str, Any]:
        try:
            body = await request.json()
        except ValueError:
            raise HTTPException(400, "send JSON: { build, state, rev, at }") from None
        try:
            out = h.command(body)
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        return {"ok": True, "delivered": out["delivered"]}

    @r.get("/api/builds/events")
    async def events(request: Request) -> StreamingResponse:
        return StreamingResponse(h.stream(request.is_disconnected), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})

    @r.get("/api/builds/events/status")
    def events_status() -> dict[str, Any]:
        return h.status()

    @r.post("/api/builds/merge-together", dependencies=[Depends(auth)])
    async def merge_together(request: Request) -> dict[str, Any]:
        try:
            body = await request.json()
        except ValueError:
            body = {}
        body = body if isinstance(body, dict) else {}
        off = body.get("off") is True
        named = body.get("builds") if isinstance(body.get("builds"), list) else []
        if any(not isinstance(b, str) or not _BUILD.match(b) for b in named) or len(named) > 50:
            raise HTTPException(400, "builds must be a list of build ids")
        who = getattr(getattr(request.state, "axf_user", None), "name", None) or "console"
        by = re.sub(r"[^A-Za-z0-9 ._:@-]", "", str(who))[:80] or "console"
        out = await asyncio.to_thread(run_lander, ["merge-together", *(["--off"] if off else []), *(["--builds", ",".join(named)] if named and not off else []), "--by", by])
        if not out.get("ok"):
            raise HTTPException(502, out.get("error") or "the lander refused")
        # the line is about to change: every screen reads the store again
        h.publish({"build": "", "state": "", "rev": 0, "at": _now()})
        return out

    return r
