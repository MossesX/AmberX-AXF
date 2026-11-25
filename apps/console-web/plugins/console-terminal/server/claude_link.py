"""Claude link — the console's connection to Claude and axHub as one live event log (claude-link-event@1).

Brett, Nov 17 2026: "Give terminal a main tab that outputs in real time the console's connection to cloud."
Design: ../docs/claude-link.md.

    BUS.append(event)        validate, redact, number, keep in the ring, write the JSONL tail, wake subscribers
    BUS.snapshot(...)        filtered read (since, kinds, q, limit), after the view marker unless asked otherwise
    BUS.state()              connected, last event, counts per kind
    BUS.clear()              moves the view marker; the log stays
    BUS.subscribe(fn)        fn(event) on every append (any thread); returns the unsubscribe

The ring holds `claudeLinkBuffer` events (default 2000). The JSONL tail lives in the plugin's dataDir
(`claude-link/events.jsonl`) and is written through data_store (data-store@1, namespace plugins/console-terminal).
Out-of-process senders that couldn't reach the console append to a spool file (framework/cli/claude-link-emit.mjs);
the bus drains it into the log on its next read.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Iterable

KINDS = ("launch", "exit", "account", "mcp", "axhub", "connect", "disconnect", "error")
LEVELS = ("info", "warn", "error")
SCHEMA = "claude-link-event@1"
DEFAULT_SIZE = 2000
MIN_SIZE, MAX_SIZE = 100, 20000
DETAIL_MAX = 8192
REDACTED = "[redacted]"

# ---------------------------------------------------------------- redaction

_SECRET_KEY = re.compile(r"(token|secret|passw(or)?d|api[-_]?key|private[-_]?key|^key$|_key$|authorization|cookie|credential|bearer)", re.I)
_SECRET_TEXT = [
    re.compile(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]{8,}"),
    re.compile(r"sk-ant-[A-Za-z0-9_-]{8,}"),
    re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"),
    re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"),
    re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"),
    re.compile(r"\bxox[abprs]-[A-Za-z0-9-]{10,}"),
    re.compile(r"\bAKIA[0-9A-Z]{16}\b"),
    re.compile(r"(?i)\b(token|secret|password|api[-_]?key)=([^\s&\"']{6,})"),
    re.compile(r"\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"),  # JWT
    re.compile(r"\b[A-Fa-f0-9]{48,}\b"),
    re.compile(r"\b(?=[A-Za-z0-9+_-]*\d)(?=[A-Za-z0-9+_-]*[A-Za-z])[A-Za-z0-9+_-]{48,}={0,2}"),
]


def redact_text(s: str) -> str:
    for rx in _SECRET_TEXT:
        s = rx.sub(lambda m: (m.group(1) + "=" + REDACTED) if rx.groups == 2 else REDACTED, s)
    return s


def redact(v: Any, key: str = "", depth: int = 0) -> Any:
    """A copy of `v` with every secret-looking value masked: values under secret-looking keys, and tokens inside text."""
    if key and _SECRET_KEY.search(key) and v not in (None, "", False, True) and not isinstance(v, (int, float)):
        return REDACTED
    if depth > 8:
        return "…"
    if isinstance(v, str):
        return redact_text(v)
    if isinstance(v, dict):
        return {str(k)[:80]: redact(x, str(k), depth + 1) for k, x in list(v.items())[:100]}
    if isinstance(v, (list, tuple)):
        return [redact(x, "", depth + 1) for x in list(v)[:100]]
    if v is None or isinstance(v, (bool, int, float)):
        return v
    return redact_text(str(v))


# ---------------------------------------------------------------- normalising

def _s(v: Any, n: int) -> str:
    return redact_text(str(v if v is not None else "").replace("\n", " ").strip())[:n]


def normalise(raw: dict[str, Any], now_ms: int | None = None) -> dict[str, Any]:
    """One claude-link-event@1 (without its id) from whatever a sender gave, or ValueError."""
    if not isinstance(raw, dict):
        raise ValueError("an event is an object")
    kind = str(raw.get("kind") or "")
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    level = str(raw.get("level") or ("error" if kind == "error" else "warn" if kind == "disconnect" else "info"))
    if level not in LEVELS:
        raise ValueError(f"level is one of {', '.join(LEVELS)}")
    ts = raw.get("ts")
    ts = int(ts) if isinstance(ts, (int, float)) and ts > 0 else int(now_ms if now_ms is not None else time.time() * 1000)
    detail = redact(raw.get("detail") if isinstance(raw.get("detail"), dict) else ({"text": raw["detail"]} if raw.get("detail") else {}))
    body = json.dumps(detail, default=str)
    if len(body) > DETAIL_MAX:
        detail = {"truncated": True, "text": body[:DETAIL_MAX]}
    summary = _s(raw.get("summary"), 200) or kind
    return {"$axf": SCHEMA, "ts": ts, "kind": kind, "source": _s(raw.get("source"), 40) or "unknown", "session": _s(raw.get("session"), 80),
            "account": _s(raw.get("account"), 40), "model": _s(raw.get("model"), 60), "summary": summary, "detail": detail, "level": level}


def matches(e: dict[str, Any], kinds: Iterable[str] | None = None, q: str = "") -> bool:
    ks = [k for k in (kinds or []) if k]
    if ks and e.get("kind") not in ks:
        return False
    if q:
        hay = " ".join(str(e.get(k, "")) for k in ("summary", "source", "session", "account", "model", "kind")).lower()
        hay += " " + json.dumps(e.get("detail") or {}, default=str).lower()
        return all(t in hay for t in q.lower().split())
    return True


# ---------------------------------------------------------------- the bus

class Bus:
    """The ring, the JSONL tail and the live subscribers. Thread-safe; `append` never raises on storage trouble."""

    def __init__(self, size: int = DEFAULT_SIZE, folder: Callable[[], Path] | None = None, spool: Callable[[], Path] | None = None,
                 store: Any = None):
        self._lock = threading.RLock()
        self.ring: deque[dict[str, Any]] = deque(maxlen=max(MIN_SIZE, min(int(size), MAX_SIZE)))
        self.seq = 0
        self._folder = folder
        self._spool = spool
        self._store = store
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._written = 0
        self._loaded = False
        self.cleared_at = 0
        self.link: dict[str, Any] = {"connected": None, "since": 0, "why": ""}

    # -- storage
    def _dir(self) -> Path | None:
        return self._folder() / "claude-link" if self._folder else None

    def _jsonl(self) -> Path | None:
        d = self._dir()
        return d / "events.jsonl" if d else None

    def _write_line(self, e: dict[str, Any]) -> None:
        p = self._jsonl()
        if not p:
            return
        try:
            if self._store is not None:
                self._store.append_jsonl(p, e)
            else:
                p.parent.mkdir(parents=True, exist_ok=True)
                with p.open("a", encoding="utf-8") as f:
                    f.write(json.dumps(e, default=str) + "\n")
            self._written += 1
            if self._written > self.ring.maxlen * 10:
                self._trim(p)
        except Exception:  # noqa: BLE001 — the log is best effort; the ring and the stream still work
            pass

    def _trim(self, p: Path) -> None:
        keep = self.ring.maxlen * 5
        try:
            lines = p.read_text("utf-8").splitlines()[-keep:]
            text = "\n".join(lines) + "\n"
            if self._store is not None:
                self._store.write_text(p, text)
            else:
                p.write_text(text, "utf-8")
            self._written = len(lines)
        except OSError:
            pass

    def load(self) -> None:
        """Fill the ring from the JSONL tail (once) and keep numbering after it; then drain the spool."""
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            p = self._jsonl()
            if p and p.is_file():
                try:
                    lines = p.read_text("utf-8").splitlines()
                except OSError:
                    lines = []
                self._written = len(lines)
                for ln in lines[-self.ring.maxlen:]:
                    try:
                        e = json.loads(ln)
                    except ValueError:
                        continue
                    if isinstance(e, dict) and isinstance(e.get("id"), int):
                        self.ring.append(e)
                        self.seq = max(self.seq, e["id"])
                        self._track_link(e)
            d = self._dir()
            if d:
                try:
                    self.cleared_at = int(json.loads((d / "view.json").read_text("utf-8")).get("clearedAt") or 0)
                except (OSError, ValueError, AttributeError):
                    self.cleared_at = 0
        self.drain_spool()

    def drain_spool(self) -> int:
        """Events senders wrote while the console was unreachable: into the log, oldest first."""
        sp = self._spool() if self._spool else None
        if not sp or not sp.is_file():
            return 0
        tmp = sp.with_name(sp.name + f".{os.getpid()}.draining")
        try:
            os.replace(sp, tmp)
            lines = tmp.read_text("utf-8").splitlines()
            tmp.unlink(missing_ok=True)
        except OSError:
            return 0
        n = 0
        for ln in lines:
            try:
                raw = json.loads(ln)
                d = raw.get("detail")
                self.append({**raw, "detail": {**(d if isinstance(d, dict) else {"text": d} if d else {}), "spooled": True}})
                n += 1
            except (ValueError, TypeError, AttributeError):
                continue
        return n

    # -- writes
    def resize(self, size: int) -> int:
        size = max(MIN_SIZE, min(int(size), MAX_SIZE))
        with self._lock:
            if size != self.ring.maxlen:
                self.ring = deque(self.ring, maxlen=size)
        return size

    def _track_link(self, e: dict[str, Any]) -> None:
        if e["kind"] == "connect":
            self.link = {"connected": True, "since": e["ts"], "why": e["summary"]}
        elif e["kind"] == "disconnect":
            self.link = {"connected": False, "since": e["ts"], "why": e["summary"]}

    def append(self, raw: dict[str, Any]) -> dict[str, Any]:
        """Add one event (ValueError when it isn't one). Returns it as stored: numbered and redacted."""
        if not self._loaded:
            self.load()
        e = normalise(raw)
        with self._lock:
            self.seq += 1
            e = {"id": self.seq, **e}
            self.ring.append(e)
            self._track_link(e)
            subs = list(self._subs)
        self._write_line(e)
        for fn in subs:
            try:
                fn(e)
            except Exception:  # noqa: BLE001 — a dead subscriber never fails the sender
                pass
        return e

    def clear(self) -> dict[str, Any]:
        """Clear the view: readers start after the newest event; the log itself is kept."""
        with self._lock:
            self.cleared_at = self.seq
        d = self._dir()
        if d:
            try:
                body = {"$axf": "claude-link-view@1", "clearedAt": self.cleared_at, "at": int(time.time() * 1000)}
                if self._store is not None:
                    self._store.write_json(d / "view.json", body)
                else:
                    d.mkdir(parents=True, exist_ok=True)
                    (d / "view.json").write_text(json.dumps(body))
            except Exception:  # noqa: BLE001
                pass
        return {"clearedAt": self.cleared_at}

    # -- reads
    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        with self._lock:
            self._subs.append(fn)

        def stop() -> None:
            with self._lock:
                if fn in self._subs:
                    self._subs.remove(fn)
        return stop

    def snapshot(self, since: int = 0, kinds: Iterable[str] | None = None, q: str = "", limit: int = 200, all: bool = False) -> dict[str, Any]:
        """Events with id > since (and after the view marker unless all), filtered; the newest `limit`, oldest first."""
        self.load()
        self.drain_spool()
        limit = max(1, min(int(limit), MAX_SIZE))
        with self._lock:
            floor = max(int(since or 0), 0 if all else self.cleared_at)
            items = [e for e in self.ring if e["id"] > floor and matches(e, kinds, q)]
            return {"items": items[-limit:], "more": len(items) > limit, "seq": self.seq, "clearedAt": self.cleared_at, "size": self.ring.maxlen}

    def state(self) -> dict[str, Any]:
        self.load()
        with self._lock:
            counts = {k: 0 for k in KINDS}
            for e in self.ring:
                if e["id"] > self.cleared_at:
                    counts[e["kind"]] = counts.get(e["kind"], 0) + 1
            last = self.ring[-1] if self.ring else None
            return {"$axf": "claude-link-state@1", "connected": self.link["connected"], "since": self.link["since"], "why": self.link["why"],
                    "last": last, "counts": counts, "seq": self.seq, "clearedAt": self.cleared_at, "size": self.ring.maxlen,
                    "held": len(self.ring), "subscribers": len(self._subs)}


class ClaudeLinkService:
    """Capability `axf.claude-link@1`: other plugins and the console server report Claude / axHub traffic here without
    importing this folder. Every method is safe to call from any thread and never raises on a bad event."""
    version = 1
    kinds = KINDS
    router: Any = None  # the REST routes, mounted again at /api/claude-link by the console (CAPABILITY_MOUNTS)

    def __init__(self, bus: Bus):
        self.bus = bus

    def append(self, event: dict[str, Any]) -> dict[str, Any] | None:
        try:
            return self.bus.append(event)
        except (ValueError, TypeError):
            return None

    def snapshot(self, **kw: Any) -> dict[str, Any]:
        return self.bus.snapshot(**kw)

    def state(self) -> dict[str, Any]:
        return self.bus.state()

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        return self.bus.subscribe(fn)


def spool_path() -> Path:
    """Where out-of-process senders append when the console can't be reached (framework/cli/claude-link-emit.mjs)."""
    env = os.environ.get("AXF_CLAUDE_LINK_SPOOL", "").strip()
    if env:
        return Path(env)
    import console_context as cx
    return Path(cx.ROOT) / ".axf-console" / "claude-link-spool.jsonl"


def make_bus(data_dir: Callable[[], Path], size: int = DEFAULT_SIZE) -> Bus:
    """The console's bus: JSONL through data_store when the console server runs, plain files otherwise (tests, CLI)."""
    try:
        import data_store as ds  # the console server's data layer (data-store@1)
    except ImportError:
        ds = None
    return Bus(size, folder=data_dir, spool=spool_path, store=ds)
