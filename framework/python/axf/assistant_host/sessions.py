"""Live sessions (live-session@1) — the host side, for any Python assistant host (framework/python,
`axf.assistant_host.sessions`; the console's ai-assistant plugin and Build Pilot's server run on it).

Every conversation is a live session owned by its host, not by the browser. A reply runs in its own thread and writes
every event into the conversation's event log; the browser only *watches* that log. Closing the tab, the dialog or the
phone app just detaches the viewer: the reply keeps going, and opening the chat again (on any device) replays what was
missed and follows on. A session ends only when it is closed on purpose (or its conversation is deleted). A host
restart while a reply is running marks that turn `interrupted` (the host keeps the streamed text through
`LocalHost.on_interrupted`); the session itself stays open.

Same semantics as the kernel contract (framework/core/live-session.ts = Kotlin ai.amberx.axf.kernel.live), checked
against framework/spec/fixtures/live-session.json by framework/python/axf/assistant_host/test.py.
Spec: framework/spec/LIVE-SESSIONS.md.

Hosts are an OPEN REGISTRY (`SessionHosts`, like the kernel's): `local` (`LocalHost`, built) is what a host registers
on start; `axhub` is a typed placeholder (`axhub_placeholder()`: `available()` is False, every call answers
NotImplemented) until axHub's session workers exist — a module providing a real `SessionHost` (console: capability
`axf.live-host@1` through plugin_services, or `HOSTS.register`) replaces it without any change here. The chosen host
is a setting (`sessionHost`); `SessionHosts.resolve()` falls back to the first available host with a notice.
"""
from __future__ import annotations

import json
import threading
import time
from pathlib import Path
from typing import Any, Callable, Iterator

CONTRACT = "live-session@1"
CAPABILITY = "axf.live-sessions"
HOST_CAPABILITY = "axf.live-host@1"   # what a module provides (console: plugin_services) to add a session host
STATES = ["idle", "running", "waiting", "closed"]
KINDS = {"open": "session.open", "close": "session.close", "turnStart": "turn.start", "turnEnd": "turn.end",
         "wait": "wait", "resume": "resume", "interrupted": "interrupted"}
LIMIT = 20_000          # events kept per session (text arrives in small pieces)
HEARTBEAT_S = 15.0       # keep-alive comment while a viewer waits


class NotImplementedHost(Exception):
    """A declared host nobody has built yet (the placeholder mechanism)."""

    def __init__(self, host_id: str) -> None:
        super().__init__(f'session host "{host_id}" is declared but not built yet')
        self.host = host_id


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
        self.owner: str = ""

    def info(self, host: str = "local") -> dict[str, Any]:
        with self.log.cond:
            turn_seq = next((e["seq"] for e in reversed(self.log.items) if e["kind"] == KINDS["turnStart"]), 0)
        return {"id": self.id, "kind": self.kind, "title": self.title, "state": self.state, "host": host,
                "createdAt": self.created, "updatedAt": self.updated, "lastSeq": self.log.last, "viewers": self.viewers,
                "meta": {"turnSeq": turn_seq, **({"owner": self.owner} if self.owner else {})}}


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


# ---------------------------------------------------------------- hosts

class SessionHost:
    """What a host provides (the Python face of the kernel's SessionHost). Replies are produced by `start_turn`."""

    id = "host"
    label = "Host"
    note = ""

    def available(self) -> bool:
        return False

    def describe(self) -> dict[str, Any]:
        return {"id": self.id, "label": self.label, "available": self.available(), "note": self.note}

    def list(self, include_closed: bool = False) -> list[dict[str, Any]]:
        raise NotImplementedHost(self.id)

    def info(self, sid: str) -> dict[str, Any] | None:
        raise NotImplementedHost(self.id)

    def get(self, sid: str, title: str = "", create: bool = False) -> Session | None:
        raise NotImplementedHost(self.id)

    def start_turn(self, sid: str, title: str, produce: Callable[[], Iterator[str]], notice: str = "", owner: str = "") -> int:
        raise NotImplementedHost(self.id)

    def tail(self, sid: str, after: int, until_idle: bool = True, max_wait_s: float = 0) -> Iterator[str]:
        raise NotImplementedHost(self.id)

    def close(self, sid: str, stop: Callable[[], Any] | None = None) -> bool:
        raise NotImplementedHost(self.id)

    def forget(self, sid: str) -> None:
        raise NotImplementedHost(self.id)

    def running(self, sid: str) -> bool:
        raise NotImplementedHost(self.id)


class PlaceholderHost(SessionHost):
    """A declared host that isn't built: never pretends to work."""

    def __init__(self, host_id: str, label: str, note: str) -> None:
        self.id, self.label, self.note = host_id, label, note

    def available(self) -> bool:
        return False


class LocalHost(SessionHost):
    """Sessions in memory, logs saved to <folder>/<id>.json when a turn ends and on lifecycle changes.
    `label`/`note`/`restart_reason` name the host for people ("This console", "Build Pilot server", …)."""

    id = "local"
    label = "This server"
    note = "Replies run on this server and keep going when the browser closes."
    restart_reason = "The server restarted while this reply was running."

    def __init__(self, folder: Path, limit: int = LIMIT, *, label: str | None = None, note: str | None = None, restart_reason: str | None = None) -> None:
        self.folder = folder
        self.limit = limit
        if label:
            self.label = label
        if note:
            self.note = note
        if restart_reason:
            self.restart_reason = restart_reason
        self.lock = threading.RLock()
        self.sessions: dict[str, Session] = {}
        self._loaded = False
        self.on_interrupted: Callable[[Session], None] | None = None  # the host keeps the interrupted reply's text

    def available(self) -> bool:
        return True

    # ---------------------------------------------------------------- persistence
    def _path(self, sid: str) -> Path:
        safe = "".join(c for c in sid if c.isalnum() or c in "-_")[:80]
        if not safe:
            raise KeyError("bad session id")
        return self.folder / f"{safe}.json"

    def _save(self, s: Session) -> None:
        # Under the host lock: close() / forget() drop the session and delete its file under the same lock, so a reply
        # thread finishing at that moment can't pass the check and then write a closed session's log back.
        with self.lock:
            if s.state == "closed" or self.sessions.get(s.id) is not s:
                return  # closed or forgotten: never write it back
            self._write(s)

    def _write(self, s: Session) -> None:
        try:
            self.folder.mkdir(parents=True, exist_ok=True)
            p = self._path(s.id)
            tmp = p.with_suffix(".tmp")
            with s.log.cond:
                events = list(s.log.items)
            tmp.write_text(json.dumps({"$axf": CONTRACT, "id": s.id, "kind": s.kind, "title": s.title, "createdAt": s.created, "owner": s.owner,
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
                    s.owner = str(raw.get("owner") or "")
                except (OSError, ValueError, KeyError, TypeError):
                    continue
                if s.state == "closed":
                    continue
                self.sessions[s.id] = s
                if s.state in ("running", "waiting"):
                    self._append(s, KINDS["interrupted"], {"reason": self.restart_reason})
                    if self.on_interrupted:
                        try:
                            self.on_interrupted(s)
                        except Exception:  # noqa: BLE001 — keeping partial text is a nicety
                            pass
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

    def start_turn(self, sid: str, title: str, produce: Callable[[], Iterator[str]], notice: str = "", owner: str = "") -> int:
        """Run `produce()` (an SSE-chunk generator) in its own thread, writing every event to the log.
        Returns the seq of the turn.start event; viewers follow from the event before it."""
        s = self.get(sid, title=title, create=True)
        assert s is not None
        with self.lock:
            if s.state == "running" and s.thread and s.thread.is_alive():
                raise Busy("a reply is still running in this conversation — open it to watch, or stop it first")
            if title:
                s.title = title
            if owner:
                s.owner = owner
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

    def close(self, sid: str, stop: Callable[[], Any] | None = None) -> bool:
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


class SessionHosts:
    """Hosts by id (open registry, like the kernel's SessionHosts). Modules add hosts; the chosen one is a setting."""

    def __init__(self) -> None:
        self._hosts: dict[str, SessionHost] = {}
        self._lock = threading.Lock()

    def register(self, h: SessionHost) -> Callable[[], None]:
        with self._lock:
            self._hosts[h.id] = h

        def unregister() -> None:
            with self._lock:
                if self._hosts.get(h.id) is h:
                    self._hosts.pop(h.id, None)
        return unregister

    def get(self, host_id: str) -> SessionHost | None:
        with self._lock:
            return self._hosts.get(host_id)

    def list(self) -> list[SessionHost]:
        with self._lock:
            return list(self._hosts.values())

    def describe(self) -> list[dict[str, Any]]:
        out = []
        for h in self.list():
            try:
                out.append(h.describe())
            except Exception as e:  # noqa: BLE001 — a broken external host must not break the list
                out.append({"id": h.id, "label": h.label, "available": False, "note": f"not reachable: {str(e)[:120]}"})
        return out

    def resolve(self, chosen: str) -> tuple[SessionHost, str]:
        """The chosen host when it is available, else the first available one with a notice for the chat."""
        want = self.get(chosen) if chosen else None
        try:
            if want and want.available():
                return want, ""
        except Exception:  # noqa: BLE001
            pass
        for h in self.list():
            try:
                if h.available():
                    label = want.label if want else (chosen or "the chosen host")
                    note = (want.note if want and want.note else "") or f"{label} isn't available"
                    return h, f"{note} This reply runs on {h.label} (it still keeps going if you close the browser)."
            except Exception:  # noqa: BLE001
                continue
        raise NotImplementedHost(chosen or "none")


def axhub_placeholder(runs_on: str = "this server") -> PlaceholderHost:
    """The declared-but-unbuilt axHub host (session workers on the VPS, pending `axhub-agent-host`)."""
    return PlaceholderHost("axhub", "axHub (VPS hub)", f"Not available yet: axHub's session workers aren't built. Chats run on {runs_on} until they are.")


AXHUB_PLACEHOLDER = axhub_placeholder()


class LiveSessionsService:
    """axf.live-sessions@1 for other modules: read-only views of the assistant's sessions, plus host registration."""

    version = 1
    contract = CONTRACT

    def __init__(self, hosts: SessionHosts, local: LocalHost) -> None:
        self._hosts = hosts
        self._local = local

    def hosts(self) -> list[dict[str, Any]]:
        return self._hosts.describe()

    def register_host(self, host: SessionHost) -> Callable[[], None]:
        """A module adds a session host (e.g. the axHub workers); returns the unregister function."""
        return self._hosts.register(host)

    def list(self, include_closed: bool = False) -> list[dict[str, Any]]:
        return self._local.list(include_closed)

    def info(self, sid: str) -> dict[str, Any] | None:
        return self._local.info(sid)

    def events(self, sid: str, after: int = 0, max_events: int = 500) -> dict[str, Any]:
        s = self._local.get(sid)
        if s is None:
            raise KeyError("no such session")
        return s.log.since(after, max_events)
