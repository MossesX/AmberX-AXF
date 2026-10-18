"""Live sessions (live-session@1) — the AI assistant's local session host.

Every conversation is a live session owned by this server, not by the browser. A reply runs in its own thread and
writes every event into the conversation's event log; the browser only *watches* that log. Closing the tab, the
dialog or the phone app just detaches the viewer: the reply keeps going, and opening the chat again (on any device)
replays what was missed and follows on. A session ends only when it is closed on purpose (or its conversation is
deleted). A console restart while a reply is running marks that turn `interrupted`; the conversation itself is kept.

Same semantics as the kernel contract (framework/core/live-session.ts = Kotlin ai.amberx.axf.kernel.live), checked
against framework/spec/fixtures/live-session.json by test.py. Spec: framework/spec/LIVE-SESSIONS.md.

Hosts: `local` (this module, built) and `axhub` (session workers on the VPS hub, placeholder: choosing it falls back
to local with a notice until the hub side exists).
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterator

CONTRACT = "live-session@1"
CAPABILITY = "axf.live-sessions"
STATES = ["idle", "running", "waiting", "closed"]
KINDS = {"open": "session.open", "close": "session.close", "turnStart": "turn.start", "turnEnd": "turn.end",
         "wait": "wait", "resume": "resume", "interrupted": "interrupted"}
HOSTS = [
    {"id": "local", "label": "This console", "available": True,
     "note": "Replies run on the console server and keep going when the browser closes."},
    {"id": "axhub", "label": "axHub (VPS hub)", "available": False,
     "note": "Not available yet: axHub's session workers aren't built. Chats run on this console until they are."},
]
LIMIT = 20_000          # events kept per session (text arrives in small pieces)
HEARTBEAT_S = 15.0       # keep-alive comment while a viewer waits


def now_ms() -> int:
    return int(time.time() * 1000)


def reduce(state: str, kind: str) -> str:
    """State after an event; only the reserved kinds change it (closed is final)."""
    if state == "closed":
        return "closed"
    if kind == KINDS["close"]:
        return "closed"
    if kind == KINDS["turnStart"]:
        return "running"
    if kind == KINDS["resume"]:
        return "running" if state == "waiting" else state
    if kind == KINDS["wait"]:
        return "waiting" if state == "running" else state
    if kind in (KINDS["turnEnd"], KINDS["interrupted"]):
        return "idle"
    return state


class EventLog:
    """Bounded append-only log, seq 1, 2, 3…; `since` matches LiveEventLog.since on every port."""

    def __init__(self, limit: int = LIMIT, events: list[dict[str, Any]] | None = None) -> None:
        self.limit = limit
        self.items: list[dict[str, Any]] = []
        self.last = 0
        self.cond = threading.Condition()
        for e in events or []:
            self.items.append(e)
            self.last = max(self.last, int(e.get("seq", 0)))
        self._trim()

    @property
    def first_seq(self) -> int:
        return self.items[0]["seq"] if self.items else self.last + 1

    def append(self, kind: str, data: Any, at: int) -> dict[str, Any]:
        with self.cond:
            self.last += 1
            e: dict[str, Any] = {"seq": self.last, "at": at, "kind": kind}
            if data is not None:
                e["data"] = data
            self.items.append(e)
            self._trim()
            self.cond.notify_all()
            return e

    def since(self, after: int, max_events: int = 500) -> dict[str, Any]:
        with self.cond:
            frm = max(0, int(after))
            reset = False
            if frm > self.last:
                reset, frm = True, 0
            first = self.items[0]["seq"] if self.items else self.last + 1
            gap = (not reset) and bool(self.items) and frm < first - 1
            fresh = [e for e in self.items if e["seq"] > frm]
            events = fresh[: max(0, max_events)]
            return {"events": events, "next": events[-1]["seq"] if events else frm, "gap": gap, "reset": reset, "more": len(fresh) > len(events)}

    def wait_beyond(self, seq: int, timeout: float) -> bool:
        with self.cond:
            if self.last > seq:
                return True
            self.cond.wait(timeout)
            return self.last > seq

    def _trim(self) -> None:
        if len(self.items) > self.limit:
            del self.items[: len(self.items) - self.limit]


class Busy(Exception):
    """A reply is already running in this session."""


class Session:
    def __init__(self, sid: str, kind: str, title: str, created: int, log: EventLog, state: str = "idle") -> None:
        self.id, self.kind, self.title, self.created = sid, kind, title, created
        self.updated = created
        self.state = state
        self.log = log
        self.viewers = 0
        self.thread: threading.Thread | None = None

    def info(self, host: str = "local") -> dict[str, Any]:
        with self.log.cond:
            turn_seq = next((e["seq"] for e in reversed(self.log.items) if e["kind"] == KINDS["turnStart"]), 0)
        return {"id": self.id, "kind": self.kind, "title": self.title, "state": self.state, "host": host,
                "createdAt": self.created, "updatedAt": self.updated, "lastSeq": self.log.last, "viewers": self.viewers,
                "meta": {"turnSeq": turn_seq}}


def _parse_sse(chunk: str) -> tuple[str, Any] | None:
    event, data = "message", ""
    for line in chunk.split("\n"):
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data += line[5:].strip()
    if not data:
        return None
    try:
        return event, json.loads(data)
    except ValueError:
        return event, data


def sse(e: dict[str, Any]) -> str:
    return f"id: {e['seq']}\nevent: {e['kind']}\ndata: {json.dumps(e.get('data'), ensure_ascii=False)}\n\n"


class LocalHost:
    """Sessions in memory, logs saved to <data>/sessions/<id>.json when a turn ends and on lifecycle changes."""

    id = "local"
    label = "This console"

    def __init__(self, folder: Path, limit: int = LIMIT) -> None:
        self.folder = folder
        self.limit = limit
        self.lock = threading.RLock()
        self.sessions: dict[str, Session] = {}
        self._loaded = False

    # ---------------------------------------------------------------- persistence
    def _path(self, sid: str) -> Path:
        safe = "".join(c for c in sid if c.isalnum() or c in "-_")[:80]
        if not safe:
            raise KeyError("bad session id")
        return self.folder / f"{safe}.json"

    def _save(self, s: Session) -> None:
        if s.state == "closed" or self.sessions.get(s.id) is not s:
            return  # closed or forgotten: never write it back
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            p = self._path(s.id)
            tmp = p.with_suffix(".tmp")
            with s.log.cond:
                events = list(s.log.items)
            tmp.write_text(json.dumps({"$axf": CONTRACT, "id": s.id, "kind": s.kind, "title": s.title, "createdAt": s.created,
                                       "updatedAt": s.updated, "state": s.state, "lastSeq": s.log.last, "events": events}, ensure_ascii=False))
            tmp.chmod(0o600)
            tmp.replace(p)
        except OSError:
            pass  # best effort: the conversation file is the durable record

    def load(self) -> None:
        """Read saved sessions once; a turn that was running when the server stopped is marked interrupted."""
        with self.lock:
            if self._loaded:
                return
            self._loaded = True
            if not self.folder.is_dir():
                return
            for p in sorted(self.folder.glob("*.json")):
                try:
                    raw = json.loads(p.read_text())
                    log = EventLog(self.limit, [e for e in raw.get("events", []) if isinstance(e, dict) and isinstance(e.get("seq"), int)])
                    log.last = max(log.last, int(raw.get("lastSeq") or 0))
                    s = Session(str(raw["id"]), str(raw.get("kind") or "assistant.chat"), str(raw.get("title") or ""),
                                int(raw.get("createdAt") or now_ms()), log, str(raw.get("state") or "idle"))
                    s.updated = int(raw.get("updatedAt") or s.created)
                except (OSError, ValueError, KeyError, TypeError):
                    continue
                if s.state == "closed":
                    continue
                self.sessions[s.id] = s
                if s.state in ("running", "waiting"):
                    self._append(s, KINDS["interrupted"], {"reason": "The console restarted while this reply was running."})
                    self._save(s)

    # ---------------------------------------------------------------- sessions
    def _append(self, s: Session, kind: str, data: Any = None) -> dict[str, Any]:
        e = s.log.append(kind, data, now_ms())
        s.state = reduce(s.state, kind)
        s.updated = e["at"]
        return e

    def get(self, sid: str, title: str = "", create: bool = False) -> Session | None:
        self.load()
        with self.lock:
            s = self.sessions.get(sid)
            if s is None and create:
                self._path(sid)  # validates the id
                s = Session(sid, "assistant.chat", title, now_ms(), EventLog(self.limit))
                self.sessions[sid] = s
                self._append(s, KINDS["open"], {"title": title})
            return s

    def list(self, include_closed: bool = False) -> list[dict[str, Any]]:
        self.load()
        with self.lock:
            items = [s.info(self.id) for s in self.sessions.values() if include_closed or s.state != "closed"]
        return sorted(items, key=lambda i: -i["updatedAt"])

    def info(self, sid: str) -> dict[str, Any] | None:
        s = self.get(sid)
        return s.info(self.id) if s else None

    def append(self, sid: str, kind: str, data: Any = None) -> dict[str, Any]:
        s = self.get(sid, create=True)
        assert s is not None
        with self.lock:
            return self._append(s, kind, data)

    def start_turn(self, sid: str, title: str, produce: Callable[[], Iterator[str]], notice: str = "") -> int:
        """Run `produce()` (an SSE-chunk generator) in its own thread, writing every event to the log.
        Returns the seq of the turn.start event; viewers follow from the event before it."""
        s = self.get(sid, title=title, create=True)
        assert s is not None
        with self.lock:
            if s.state == "running" and s.thread and s.thread.is_alive():
                raise Busy("a reply is still running in this conversation — open it to watch, or stop it first")
            if title:
                s.title = title
            start = self._append(s, KINDS["turnStart"], {"at": now_ms()})
            if notice:
                self._append(s, "status", {"text": notice})

            def work() -> None:
                end: dict[str, Any] = {"ok": True}
                try:
                    for chunk in produce():
                        parsed = _parse_sse(chunk)
                        if not parsed:
                            continue
                        kind, data = parsed
                        if kind in KINDS.values():
                            kind = f"owner.{kind}"  # never let owner events fake lifecycle changes
                        with self.lock:
                            self._append(s, kind, data)
                            if kind == "done" and isinstance(data, dict) and data.get("title"):
                                s.title = str(data["title"])[:200]
                            if kind == "error":
                                end = {"ok": False}
                except Exception as e:  # noqa: BLE001
                    with self.lock:
                        self._append(s, "error", {"message": f"{type(e).__name__}: {e}"})
                    end = {"ok": False}
                finally:
                    with self.lock:
                        if s.state != "closed":
                            self._append(s, KINDS["turnEnd"], end)
                    self._save(s)

            t = threading.Thread(target=work, name=f"ai-turn-{sid}", daemon=True)
            s.thread = t
            t.start()
            return start["seq"]

    def tail(self, sid: str, after: int, until_idle: bool = True, max_wait_s: float = 0) -> Iterator[str]:
        """SSE: replay everything after `after`, then follow. With `until_idle` the stream ends once nothing is
        running and every event was sent; otherwise it follows until the viewer leaves (or `max_wait_s` passes)."""
        s = self.get(sid)
        if s is None:
            yield f"event: session\ndata: {json.dumps({'state': 'none', 'lastSeq': 0})}\n\n"
            return
        with self.lock:
            s.viewers += 1
        began = time.monotonic()
        try:
            r = s.log.since(after, 500)
            yield f"event: replay\ndata: {json.dumps({k: r[k] for k in ('next', 'gap', 'reset', 'more')} | {'state': s.state, 'lastSeq': s.log.last})}\n\n"
            pos = 0 if r["reset"] else after
            while True:
                r = s.log.since(pos, 500)
                for e in r["events"]:
                    yield sse(e)
                pos = r["next"]
                if r["more"]:
                    continue
                if s.state == "closed" or (until_idle and s.state not in ("running", "waiting")):
                    if s.log.last <= pos:
                        return
                    continue
                if max_wait_s and time.monotonic() - began > max_wait_s:
                    return
                if not s.log.wait_beyond(pos, HEARTBEAT_S):
                    yield ": keep-alive\n\n"
        finally:
            with self.lock:
                s.viewers = max(0, s.viewers - 1)

    def close(self, sid: str, stop: Callable[[], None] | None = None) -> bool:
        """End the session on purpose: stop its reply, write session.close, forget its log."""
        s = self.get(sid)
        if s is None:
            return False
        if stop and s.state == "running":
            stop()
        with self.lock:
            self._append(s, KINDS["close"], {"by": "user"})
            self.sessions.pop(sid, None)
        self.forget(sid)
        return True

    def forget(self, sid: str) -> None:
        with self.lock:
            self.sessions.pop(sid, None)
        try:
            self._path(sid).unlink(missing_ok=True)
        except (OSError, KeyError):
            pass

    def running(self, sid: str) -> bool:
        s = self.get(sid)
        return bool(s and s.state == "running" and s.thread and s.thread.is_alive())


class LiveSessionsService:
    """axf.live-sessions@1 for other plugins: read-only views of the assistant's sessions."""

    version = 1
    contract = CONTRACT

    def __init__(self, host: LocalHost) -> None:
        self._host = host

    def hosts(self) -> list[dict[str, Any]]:
        return [dict(h) for h in HOSTS]

    def list(self, include_closed: bool = False) -> list[dict[str, Any]]:
        return self._host.list(include_closed)

    def info(self, sid: str) -> dict[str, Any] | None:
        return self._host.info(sid)

    def events(self, sid: str, after: int = 0, max_events: int = 500) -> dict[str, Any]:
        s = self._host.get(sid)
        if s is None:
            raise KeyError("no such session")
        return s.log.since(after, max_events)
