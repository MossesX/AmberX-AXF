"""Claude link: the console's connection to Claude and axHub as one live event log (claude-link-event@1).

The Terminal's pinned "Claude link" tab, its REST / SSE routes, the MCP tools and the CLI all read this bus.

    b = bus()                the console's bus (ring sized from the plugin's `claudeLinkBuffer` setting)
    b.append(event)          validate, redact, number, keep in the ring, queue for the JSONL tail, wake subscribers
    b.snapshot(...)          filtered read (since, kinds, q, limit), after the view marker unless all=True
    b.state()                connected, last event, counts per kind
    b.clear()                moves the view marker; the log itself stays
    b.subscribe(fn)          fn(event) on every append (any thread); returns the unsubscribe
    b.resize(n)              a new ring size (the newest events are kept)

An event: {id, ts (epoch ms), kind, source, session, account, model, summary, detail, level}.
kind is one of KINDS, level one of LEVELS. `append` masks secrets before anything is kept: values under
secret-looking keys, and tokens / keys inside any text (redact, redact_text).

Storage: the ring is in memory (default 2000 events, 100..20000). The JSONL tail is
`<dataDir>/claude-link/events.jsonl`, written through data_store (data-store@1, namespace plugins/console-terminal)
by a background writer so a slow store never holds up the caller that reported the event. At TAIL_BYTES the file
moves to `events.1.jsonl` (one old generation). A restart refills the ring from the tail and numbering continues.
"""
from __future__ import annotations

import importlib
import json
import queue
import re
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable, Iterable

KINDS = ("launch", "exit", "account", "mcp", "axhub", "connect", "disconnect", "error")
LEVELS = ("info", "warn", "error")
SCHEMA = "claude-link-event@1"
SETTING = "claudeLinkBuffer"
DEFAULT_SIZE = 2000
MIN_SIZE, MAX_SIZE = 100, 20000
DETAIL_MAX = 8192          # bytes of a detail once serialised
TAIL_BYTES = 4_000_000     # the JSONL tail rotates past this (one old generation kept)
QUEUE_MAX = 5000           # events waiting for the tail; past this they stay in the ring only (state().dropped)
REDACTED = "[redacted]"
FOLDER = "claude-link"


def clamp_size(size: Any) -> int:
    """A ring size from whatever the settings hold: DEFAULT_SIZE when it isn't a number, else MIN_SIZE..MAX_SIZE."""
    try:
        n = int(size)
    except (TypeError, ValueError):
        return DEFAULT_SIZE
    return max(MIN_SIZE, min(n, MAX_SIZE))


# ── redaction ─────────────────────────────────────────────────────────────────────────────────────────────────────────

# a key whose value is a secret whatever it looks like (token, apiKey, client_secret, Authorization, set-cookie, …)
_SECRET_KEY = re.compile(r"token|secret|passw(or)?d|passphrase|api[-_]?key|private[-_]?key|access[-_]?key|signing[-_]?key|^key$|[-_]key$"
                         r"|authorization|^auth$|cookie|credential|bearer|session[-_]?id|signature", re.I)
# …unless it only counts or names them (inputTokens, max_tokens, tokenCount, keyId)
_COUNT_KEY = re.compile(r"tokens$|token[-_]?(count|limit|usage|budget|type)$|key[-_]?(id|name|count)$", re.I)

_NAME = r"[A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|passphrase|api[-_]?key|apikey|private[-_]?key|access[-_]?key|credential|auth|cookie)[A-Za-z0-9_-]*"

# (pattern, replacement) pairs, in order; the specific shapes first, the "long random run" nets last
_TEXT: list[tuple[re.Pattern[str], Any]] = [
    # PEM blocks (private keys, certificates with keys)
    (re.compile(r"-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----.*?(?:-----END [A-Z0-9 ]*PRIVATE KEY-----|\Z)", re.S), REDACTED),
    # headers: Authorization: Bearer x / x-api-key: x / Cookie: a=b; c=d (to the end of the line)
    (re.compile(r"(?im)\b((?:proxy-)?authorization|x-api-key|x-axf-token|x-auth-token|(?:set-)?cookie)(\s*[:=]\s*)[^\r\n]+"),
     lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}"),
    (re.compile(r"(?i)\b(bearer|basic)\s+[A-Za-z0-9._~+/=-]{8,}"), lambda m: f"{m.group(1)} {REDACTED}"),
    # credentials inside a URL: https://user:password@host
    (re.compile(r"\b([a-z][a-z0-9+.-]*://)[^\s/:@]+:[^\s/@]+@"), lambda m: f"{m.group(1)}{REDACTED}@"),
    # well-known token shapes
    (re.compile(r"\bsk-ant-[A-Za-z0-9_-]{8,}"), REDACTED),
    (re.compile(r"\bsk-[A-Za-z0-9_-]{20,}"), REDACTED),
    (re.compile(r"\bgh[pousr]_[A-Za-z0-9]{20,}"), REDACTED),
    (re.compile(r"\bgithub_pat_[A-Za-z0-9_]{20,}"), REDACTED),
    (re.compile(r"\bglpat-[A-Za-z0-9_-]{16,}"), REDACTED),
    (re.compile(r"\bxox[abeprs]-[A-Za-z0-9-]{10,}"), REDACTED),
    (re.compile(r"\b(?:AKIA|ASIA)[0-9A-Z]{16}\b"), REDACTED),
    (re.compile(r"\bAIza[A-Za-z0-9_-]{30,}"), REDACTED),
    (re.compile(r"\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]{4,})?"), REDACTED),  # JWT
    # name=value and "name": "value" (env lines, query strings, JSON pasted into text)
    (re.compile(rf"(?i)(?<![A-Za-z0-9])({_NAME})(=)(\"[^\"\r\n]*\"|'[^'\r\n]*'|[^\s&\"',;]+)"), lambda m: f"{m.group(1)}={REDACTED}"),
    (re.compile(rf"(?i)([\"']{_NAME}[\"']\s*:\s*)(\"(?:[^\"\\\r\n]|\\.)*\"|'[^'\r\n]*')"), lambda m: f'{m.group(1)}"{REDACTED}"'),
    # command-line flags: --token abc, --api-key=abc, -p'secret' is left alone (not knowable)
    (re.compile(r"(?i)(--[a-z0-9-]*(?:token|secret|password|passwd|api-?key|private-key|access-key|credential)[a-z0-9-]*)([ =]+)(?!--)(\S+)"),
     lambda m: f"{m.group(1)}{m.group(2)}{REDACTED}"),
    # long hex (a git commit id is 40: kept)
    (re.compile(r"\b[A-Fa-f0-9]{48,}\b"), REDACTED),
]
# a long unbroken run that mixes lower case, upper case and digits is a key; a long slug (a-session-name-2) is not
_RUN = re.compile(r"(?<![A-Za-z0-9+_=-])[A-Za-z0-9+_-]{40,}={0,2}")


def _run(m: re.Match[str]) -> str:
    s = m.group(0)
    mixed = any(c.islower() for c in s) and any(c.isupper() for c in s) and sum(c.isdigit() for c in s) >= 2
    return REDACTED if mixed else s


def redact_text(s: str) -> str:
    """`s` with every token or key found inside it masked."""
    if len(s) < 8:
        return s
    for rx, to in _TEXT:
        s = rx.sub(to, s)
    return _RUN.sub(_run, s)


def _mask(v: Any, depth: int = 0) -> Any:
    """The value of a secret-looking key: every string in it masked, numbers and flags kept (they are never a secret)."""
    if v is None or isinstance(v, (bool, int, float)) or v == "":
        return v
    if depth < 8 and isinstance(v, dict):
        return {str(k)[:80]: _mask(x, depth + 1) for k, x in list(v.items())[:100]}
    if depth < 8 and isinstance(v, (list, tuple)):
        return [_mask(x, depth + 1) for x in list(v)[:100]]
    return REDACTED


def redact(v: Any, key: str = "", depth: int = 0) -> Any:
    """A JSON-safe copy of `v` with secrets masked: values under secret-looking keys, and tokens inside any text."""
    if key and _SECRET_KEY.search(key) and not _COUNT_KEY.search(key):
        return _mask(v)
    if depth > 8:
        return "…"
    if isinstance(v, str):
        return redact_text(v)
    if isinstance(v, dict):
        return {redact_text(str(k))[:80]: redact(x, str(k), depth + 1) for k, x in list(v.items())[:100]}
    if isinstance(v, (list, tuple, set, frozenset)):
        return [redact(x, "", depth + 1) for x in list(v)[:100]]
    if v is None or isinstance(v, (bool, int)):
        return v
    if isinstance(v, float):
        return v if v == v and v not in (float("inf"), float("-inf")) else None
    if isinstance(v, (bytes, bytearray)):
        return f"<{len(v)} bytes>"
    return redact_text(str(v))


# ── one event ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def _line(v: Any, n: int) -> str:
    return redact_text(" ".join(str(v if v is not None else "").split()))[:n]


def normalise(raw: Any, now_ms: int | None = None) -> dict[str, Any]:
    """One claude-link-event@1 (without its id) from whatever a sender gave, redacted. ValueError when it isn't one."""
    if not isinstance(raw, dict):
        raise ValueError("an event is an object")
    kind = str(raw.get("kind") or "")
    if kind not in KINDS:
        raise ValueError(f"kind is one of {', '.join(KINDS)}")
    level = str(raw.get("level") or ("error" if kind == "error" else "warn" if kind == "disconnect" else "info"))
    if level not in LEVELS:
        raise ValueError(f"level is one of {', '.join(LEVELS)}")
    ts = raw.get("ts")
    if isinstance(ts, bool) or not isinstance(ts, (int, float)) or not 0 < ts < 1e14:
        ts = now_ms if now_ms is not None else time.time() * 1000
    d = raw.get("detail")
    detail = redact(d if isinstance(d, dict) else ({"text": d} if d not in (None, "", [], ()) else {}))
    body = json.dumps(detail, ensure_ascii=False)
    if len(body.encode("utf-8")) > DETAIL_MAX:
        detail = {"truncated": True, "text": body.encode("utf-8")[:DETAIL_MAX].decode("utf-8", "ignore")}
    return {"$axf": SCHEMA, "ts": int(ts), "kind": kind, "source": _line(raw.get("source"), 40) or "unknown",
            "session": _line(raw.get("session"), 80), "account": _line(raw.get("account"), 40), "model": _line(raw.get("model"), 60),
            "summary": _line(raw.get("summary"), 200) or kind, "detail": detail, "level": level}


def matches(e: dict[str, Any], kinds: Iterable[str] | None = None, q: str = "") -> bool:
    """True when the event is one of `kinds` (none = any) and holds every word of `q` (case-blind, detail included)."""
    ks = [k for k in (kinds or []) if k]
    if ks and e.get("kind") not in ks:
        return False
    words = (q or "").lower().split()
    if not words:
        return True
    hay = " ".join(str(e.get(k, "")) for k in ("summary", "source", "session", "account", "model", "kind", "level")).lower()
    hay += " " + json.dumps(e.get("detail") or {}, ensure_ascii=False).lower()
    return all(w in hay for w in words)


# ── storage ───────────────────────────────────────────────────────────────────────────────────────────────────────────

class Files:
    """Plain files with data_store's calls, for when the console's data layer isn't importable (unit tests, a CLI)."""

    @staticmethod
    def append_jsonl(path: Path, entry: Any, *, rotate_at: int | None = None, **_kw: Any) -> None:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        if rotate_at is not None and p.is_file() and p.stat().st_size > rotate_at:
            p.replace(p.with_suffix(".1.jsonl"))
        with p.open("a", encoding="utf-8") as fh:
            fh.write(json.dumps(entry) + "\n")
        p.chmod(0o600)

    @staticmethod
    def read_text(path: Path, default: str = "") -> str:
        try:
            return Path(path).read_text("utf-8")
        except (OSError, UnicodeDecodeError):
            return default

    @staticmethod
    def read_json(path: Path, default: Any) -> Any:
        try:
            return json.loads(Path(path).read_text("utf-8"))
        except (OSError, ValueError):
            return default

    @staticmethod
    def write_json(path: Path, data: Any, **_kw: Any) -> Path:
        p = Path(path)
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = p.with_name(p.name + ".tmp")
        tmp.write_text(json.dumps(data), "utf-8")
        tmp.chmod(0o600)
        tmp.replace(p)
        return p


def data_layer() -> Any:
    """The console server's data layer (data_store, data-store@1), or plain files when it isn't there."""
    try:
        return importlib.import_module("data_store")
    except ImportError:
        return Files


# ── the bus ───────────────────────────────────────────────────────────────────────────────────────────────────────────

class Bus:
    """The ring, the JSONL tail and the live subscribers. Thread-safe. `append` never blocks on storage and never raises
    because of it; it raises ValueError only for something that isn't an event."""

    def __init__(self, size: Any = DEFAULT_SIZE, folder: Callable[[], Path] | None = None, store: Any = None, background: bool = True):
        """`folder()` is the plugin's dataDir (None = memory only). `store` has data_store's calls. `background` False
        writes each line inside append (tests, one-shot tools)."""
        self._lock = threading.RLock()
        self.ring: deque[dict[str, Any]] = deque(maxlen=clamp_size(size))
        self.seq = 0
        self.cleared_at = 0
        self.dropped = 0
        self.link: dict[str, Any] = {"connected": None, "since": 0, "why": ""}
        self._folder = folder
        self._store = store if store is not None else (data_layer() if folder else None)
        self._background = background
        self._subs: list[Callable[[dict[str, Any]], None]] = []
        self._loaded = False
        self._queue: queue.Queue[dict[str, Any]] = queue.Queue(maxsize=QUEUE_MAX)
        self._writer: threading.Thread | None = None
        self._write_lock = threading.Lock()

    # ── storage
    def path(self, name: str = "events.jsonl") -> Path | None:
        return self._folder() / FOLDER / name if self._folder else None

    def _write_line(self, e: dict[str, Any]) -> None:
        p = self.path()
        if p is None:
            return
        try:
            with self._write_lock:
                self._store.append_jsonl(p, e, rotate_at=TAIL_BYTES)
        except Exception:  # noqa: BLE001 — the tail is best effort: the ring and the live stream carry on without it
            with self._lock:
                self.dropped += 1

    def _drain(self) -> None:
        while True:
            e = self._queue.get()
            try:
                self._write_line(e)
            finally:
                self._queue.task_done()

    def _persist(self, e: dict[str, Any]) -> None:
        if self._folder is None:
            return
        if not self._background:
            self._write_line(e)
            return
        if self._writer is None:
            with self._lock:
                if self._writer is None:
                    self._writer = threading.Thread(target=self._drain, name="claude-link-tail", daemon=True)
                    self._writer.start()
        try:
            self._queue.put_nowait(e)
        except queue.Full:
            with self._lock:
                self.dropped += 1

    def flush(self) -> None:
        """Wait until every event appended so far is in the JSONL tail (tests, a clean shutdown)."""
        if self._writer is not None:
            self._queue.join()

    def load(self) -> None:
        """Once: refill the ring from the JSONL tail (the old generation too when the new one is short), carry on
        numbering after it and read the view marker."""
        with self._lock:
            if self._loaded:
                return
            self._loaded = True
            if self._folder is None:
                return
            want = self.ring.maxlen or DEFAULT_SIZE
            found: list[dict[str, Any]] = []
            for name in ("events.jsonl", "events.1.jsonl"):
                if len(found) >= want:
                    break
                try:
                    lines = (self._store.read_text(self.path(name), "") or "").splitlines()
                except Exception:  # noqa: BLE001 — an unreadable tail starts an empty ring, it never stops the console
                    lines = []
                part = []
                for ln in lines[-want:]:
                    try:
                        e = json.loads(ln)
                    except ValueError:
                        continue
                    if isinstance(e, dict) and isinstance(e.get("id"), int) and e.get("kind") in KINDS:
                        part.append(e)
                found = part + found
            found.sort(key=lambda e: e["id"])
            for e in found[-want:]:
                self.ring.append(e)
                self._track_link(e)
            self.seq = max([self.seq] + [e["id"] for e in found])
            try:
                view = self._store.read_json(self.path("view.json"), {})
                self.cleared_at = min(self.seq, max(0, int(view.get("clearedAt") or 0)))
            except Exception:  # noqa: BLE001
                self.cleared_at = 0

    # ── writes
    def resize(self, size: Any) -> int:
        """Change how many events the ring holds; the newest are kept. Returns the size it settled on."""
        n = clamp_size(size)
        with self._lock:
            if n != self.ring.maxlen:
                self.ring = deque(self.ring, maxlen=n)
        return n

    def _track_link(self, e: dict[str, Any]) -> None:
        if e.get("kind") in ("connect", "disconnect"):
            self.link = {"connected": e["kind"] == "connect", "since": e.get("ts") or 0, "why": e.get("summary") or ""}

    def append(self, raw: Any) -> dict[str, Any]:
        """Add one event. Returns it as stored: numbered and redacted."""
        e = normalise(raw)
        self.load()
        with self._lock:
            self.seq += 1
            e = {"id": self.seq, **e}
            self.ring.append(e)
            self._track_link(e)
            subs = list(self._subs)
            self._persist(e)  # queued under the lock so the tail keeps the ring's order
        for fn in subs:
            try:
                fn(e)
            except Exception:  # noqa: BLE001 — a broken subscriber never fails the sender
                pass
        return e

    def clear(self) -> dict[str, Any]:
        """Clear the view: readers start after the newest event. The ring and the JSONL tail are kept."""
        self.load()
        with self._lock:
            self.cleared_at = self.seq
            marker = {"$axf": "claude-link-view@1", "clearedAt": self.cleared_at, "at": int(time.time() * 1000)}
        p = self.path("view.json")
        if p is not None:
            try:
                self._store.write_json(p, marker)
            except Exception:  # noqa: BLE001 — the marker still holds until the next restart
                pass
        return {"clearedAt": marker["clearedAt"]}

    # ── reads
    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        with self._lock:
            self._subs.append(fn)

        def stop() -> None:
            with self._lock:
                if fn in self._subs:
                    self._subs.remove(fn)
        return stop

    def snapshot(self, since: int = 0, kinds: Iterable[str] | None = None, q: str = "", limit: int = 200, all: bool = False) -> dict[str, Any]:  # noqa: A002
        """Events with id > since (and after the view marker unless `all`), filtered: the newest `limit`, oldest first."""
        self.load()
        limit = max(1, min(int(limit or 200), MAX_SIZE))
        ks = list(kinds or [])
        with self._lock:
            floor = max(int(since or 0), 0 if all else self.cleared_at)
            items = [e for e in self.ring if e["id"] > floor and matches(e, ks, q)]
            return {"$axf": "claude-link-snapshot@1", "items": items[-limit:], "more": len(items) > limit, "seq": self.seq,
                    "clearedAt": self.cleared_at, "size": self.ring.maxlen}

    def state(self) -> dict[str, Any]:
        self.load()
        with self._lock:
            counts = dict.fromkeys(KINDS, 0)
            for e in self.ring:
                if e["id"] > self.cleared_at:
                    counts[e["kind"]] += 1
            return {"$axf": "claude-link-state@1", "connected": self.link["connected"], "since": self.link["since"], "why": self.link["why"],
                    "last": self.ring[-1] if self.ring else None, "counts": counts, "seq": self.seq, "clearedAt": self.cleared_at,
                    "size": self.ring.maxlen, "held": len(self.ring), "subscribers": len(self._subs), "dropped": self.dropped}


# ── the console's bus ─────────────────────────────────────────────────────────────────────────────────────────────────

_BUS: Bus | None = None
_bus_lock = threading.Lock()


def bus() -> Bus:
    """The one bus of this console server, made on first use: sized from the plugin's settings, its tail in the
    plugin's dataDir through data_store."""
    global _BUS
    if _BUS is None:
        with _bus_lock:
            if _BUS is None:
                store = importlib.import_module(".store", __package__)
                _BUS = Bus(store.settings().get(SETTING), folder=store.data_dir)
    return _BUS


def append(event: Any) -> dict[str, Any] | None:
    """Report one event on the console's bus. Never raises: None when it wasn't an event."""
    try:
        return bus().append(event)
    except (ValueError, TypeError):
        return None


def settings_saved(size: Any) -> None:
    """The plugin's settings changed: an existing bus takes the new ring size at once."""
    if _BUS is not None:
        _BUS.resize(size)
