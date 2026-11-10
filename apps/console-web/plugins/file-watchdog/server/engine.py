"""File watchdog engine: watches, change detection, debounce, actions and the event log. No AI needed.

A watch names files, folders or globs. The engine keeps a snapshot (mtime, size) per watch and compares it on every
pass; inotify (Linux, through libc) wakes the loop as soon as something changes, and a timed pass catches anything
inotify can't see (network mounts, new folders between passes). Each change waits out the watch's debounce and then
runs the watch's actions with the changed path and event: notify, script, shell, console action, control@1 command,
and the optional AI action (off until the watch's Enable AI switch is on).

Scripts and shell commands run only once Brett approved that exact command (the same rule as other writes on the
VPS): editing the command clears the approval, and an unapproved one is logged as held, never run.

Pure Python, no third-party modules. The server part (``__init__.py``) wires the console's services in as hooks.
"""
from __future__ import annotations

import ctypes
import ctypes.util
import difflib
import fnmatch
import glob as globmod
import hashlib
import json
import os
import re
import secrets
import select
import shlex
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

EVENTS = ("created", "modified", "deleted")
ACTION_TYPES = ("notify", "script", "shell", "console", "control")
NEEDS_APPROVAL = ("script", "shell")
DEFAULT_IGNORE = [".git/**", "**/.git/**", "node_modules/**", "**/node_modules/**", "*.swp", "*~", "*.tmp", "__pycache__/**", "**/__pycache__/**"]
MAX_WATCHES = 100
MAX_FILES = 20000          # files one watch may track
MAX_DIRS = 4000            # folders inotify watches in total
MAX_PER_BATCH = 10         # changes one debounce window fires; the rest are logged as one skipped line
DIFF_FILE_MAX = 64 * 1024  # files above this aren't diffed (the AI gets the path and event only)
DIFF_OUT_MAX = 8000
OUT_MAX = 4000
LOG_KEEP = 2000
TIMEOUT_DEFAULT = 60
TIMEOUT_MAX = 600
GLOB_CHARS = re.compile(r"[*?\[]")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
RUNNERS = {".mjs": ["node"], ".js": ["node"], ".cjs": ["node"], ".py": ["python3"], ".sh": ["bash"]}


class WatchError(ValueError):
    """A watch or action that can't be saved: the message says what to fix."""


# ---------------------------------------------------------------------- the watch model

def _text(v: Any, n: int = 500) -> str:
    return str(v if v is not None else "").strip()[:n]


def _list(v: Any, n: int = 50, each: int = 500) -> list[str]:
    if isinstance(v, str):
        v = [x for x in re.split(r"[\n,]", v)]
    if not isinstance(v, list):
        return []
    return [s for s in (_text(x, each) for x in v) if s][:n]


def _int(v: Any, default: int, lo: int, hi: int) -> int:
    try:
        return max(lo, min(hi, int(v)))
    except (TypeError, ValueError):
        return default


def slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40]
    return s or "watch"


def command_hash(action: dict[str, Any]) -> str:
    """What an approval covers: the action type and exactly what it runs."""
    key = json.dumps([action.get("type"), action.get("command", ""), action.get("script", ""), action.get("args", [])], sort_keys=True)
    return hashlib.sha256(key.encode()).hexdigest()[:16]


def normal_action(a: Any, old: dict[str, Any] | None = None) -> dict[str, Any]:
    if not isinstance(a, dict):
        raise WatchError("each action is an object with a type")
    t = _text(a.get("type"), 20)
    if t not in ACTION_TYPES:
        raise WatchError(f"action type must be one of {', '.join(ACTION_TYPES)} (got '{t}')")
    out: dict[str, Any] = {"type": t, "enabled": a.get("enabled", True) is not False}
    if t == "notify":
        out["severity"] = a.get("severity") if a.get("severity") in ("info", "warning", "error") else "info"
        out["title"] = _text(a.get("title"), 160)
    elif t == "script":
        out["script"] = _text(a.get("script") or a.get("path"), 400)
        if not out["script"]:
            raise WatchError("a script action needs the script's path")
        out["args"] = _list(a.get("args"), 20, 400)
        out["timeout"] = _int(a.get("timeout"), TIMEOUT_DEFAULT, 1, TIMEOUT_MAX)
    elif t == "shell":
        out["command"] = _text(a.get("command"), 2000)
        if not out["command"]:
            raise WatchError("a shell action needs the command")
        out["timeout"] = _int(a.get("timeout"), TIMEOUT_DEFAULT, 1, TIMEOUT_MAX)
    elif t == "console":
        out["action"] = _text(a.get("action"), 200)
        if not out["action"]:
            raise WatchError("a console action needs the action id, e.g. nav:builds or file-watchdog.open")
        out["args"] = a.get("args") if isinstance(a.get("args"), (dict, list, str)) else None
    elif t == "control":
        cmd = a.get("command")
        if isinstance(cmd, str):
            try:
                cmd = json.loads(cmd)
            except ValueError as e:
                raise WatchError(f"the control@1 command isn't JSON: {e}") from None
        if not isinstance(cmd, dict) or not cmd.get("op") or not cmd.get("target"):
            raise WatchError("a control action needs a control@1 command object with op and target")
        out["command"] = cmd
    if t in NEEDS_APPROVAL:
        h = command_hash(out)
        keep = old if old and old.get("type") == t and old.get("approval", {}).get("hash") == h else None
        out["approval"] = keep["approval"] if keep else {"hash": h, "state": "needed", "by": "", "at": 0}
    return out


def normal_ai(a: Any, old: dict[str, Any] | None = None) -> dict[str, Any]:
    a = a if isinstance(a, dict) else {}
    o = old or {}
    return {
        "enabled": bool(a.get("enabled", o.get("enabled", False))),
        "prompt": _text(a.get("prompt", o.get("prompt", "")), 4000),
        "model": _text(a.get("model", o.get("model", "")), 80),
        "profile": _text(a.get("profile", o.get("profile", "")), 80),
        "maxTokens": _int(a.get("maxTokens", o.get("maxTokens", 1200)), 1200, 64, 8000),
    }


def normal_watch(inp: dict[str, Any], old: dict[str, Any] | None = None, taken: set[str] | None = None) -> dict[str, Any]:
    """A watch from a create or update body (an update keeps what it doesn't name)."""
    o = old or {}
    src = {**o, **{k: v for k, v in (inp or {}).items() if v is not None}}
    name = _text(src.get("name"), 80)
    paths = _list(src.get("paths") if "paths" in src else src.get("path"), 20, 1000)
    if not paths:
        raise WatchError("a watch needs at least one path, folder or glob")
    if not name:
        name = paths[0]
    wid = o.get("id") or _text(inp.get("id"), 48) or slug(name)
    if not ID_RE.match(wid):
        raise WatchError("id: lowercase letters, digits and dashes")
    if not old and taken is not None:
        base, n = wid, 2
        while wid in taken:
            wid, n = f"{base[:44]}-{n}", n + 1
    events = [e for e in _list(src.get("events") or list(EVENTS), 3, 20) if e in EVENTS] or list(EVENTS)
    old_actions = o.get("actions") or []
    acts_in = src.get("actions") if isinstance(src.get("actions"), list) else []
    actions = [normal_action(a, old_actions[i] if i < len(old_actions) else None) for i, a in enumerate(acts_in[:12])]
    return {
        "id": wid,
        "name": name,
        "paths": paths,
        "events": events,
        "recursive": src.get("recursive", True) is not False,
        "ignore": _list(src.get("ignore") if "ignore" in src else DEFAULT_IGNORE, 50, 200),
        "debounceMs": _int(src.get("debounceMs"), 500, 0, 600000),
        "enabled": src.get("enabled", True) is not False,
        "actions": actions,
        "ai": normal_ai(inp.get("ai") if isinstance(inp, dict) else None, o.get("ai")),
        "createdAt": int(o.get("createdAt") or time.time()),
        "updatedAt": int(time.time()),
    }


# ---------------------------------------------------------------------- change detection

def resolve(root: Path, p: str) -> Path:
    q = Path(os.path.expanduser(p))
    return q if q.is_absolute() else root / q


def ignored(rel: str, patterns: list[str]) -> bool:
    base = rel.rsplit("/", 1)[-1]
    return any(fnmatch.fnmatch(rel, pat) or fnmatch.fnmatch(base, pat) for pat in patterns)


def rel_of(root: Path, path: str) -> str:
    try:
        return str(Path(path).relative_to(root))
    except ValueError:
        return path


def snapshot(watch: dict[str, Any], root: Path) -> tuple[dict[str, tuple[int, int]], set[str]]:
    """{absolute path: (mtime_ns, size)} for every file the watch covers, and the folders to hand inotify."""
    files: dict[str, tuple[int, int]] = {}
    dirs: set[str] = set()
    pats = watch.get("ignore") or []

    def add(fp: str) -> None:
        if len(files) >= MAX_FILES or ignored(rel_of(root, fp), pats):
            return
        try:
            st = os.stat(fp)
        except OSError:
            return
        if os.path.isfile(fp):
            files[fp] = (st.st_mtime_ns, st.st_size)

    def walk(d: str) -> None:
        dirs.add(d)
        if watch.get("recursive", True):
            for cur, subs, names in os.walk(d):
                subs[:] = [s for s in subs if not ignored(rel_of(root, os.path.join(cur, s)) + "/", pats) and not ignored(rel_of(root, os.path.join(cur, s)), pats)]
                dirs.add(cur)
                for n in names:
                    add(os.path.join(cur, n))
                if len(files) >= MAX_FILES:
                    return
        else:
            try:
                for n in os.listdir(d):
                    add(os.path.join(d, n))
            except OSError:
                pass

    for p in watch.get("paths") or []:
        full = str(resolve(root, p))
        if GLOB_CHARS.search(p):
            for fp in globmod.glob(full, recursive=bool(watch.get("recursive", True))):
                if os.path.isdir(fp):
                    walk(fp)
                else:
                    add(fp)
            fixed = GLOB_CHARS.split(full, 1)[0]
            parent = fixed if fixed.endswith("/") else os.path.dirname(fixed)
            if os.path.isdir(parent):
                dirs.add(parent.rstrip("/") or "/")
                if watch.get("recursive", True) and "**" in p:
                    for cur, subs, _ in os.walk(parent):
                        subs[:] = [s for s in subs if not ignored(rel_of(root, os.path.join(cur, s)), pats)]
                        dirs.add(cur)
                        if len(dirs) > MAX_DIRS:
                            break
        elif os.path.isdir(full):
            walk(full)
        else:
            add(full)
            if os.path.isdir(os.path.dirname(full)):
                dirs.add(os.path.dirname(full))
    return files, dirs


def compare(old: dict[str, tuple[int, int]], new: dict[str, tuple[int, int]]) -> list[tuple[str, str]]:
    """[(event, path)] between two snapshots, sorted by path."""
    out = [("created", p) for p in new.keys() - old.keys()]
    out += [("deleted", p) for p in old.keys() - new.keys()]
    out += [("modified", p) for p in new.keys() & old.keys() if new[p] != old[p]]
    return sorted(out, key=lambda e: e[1])


def merge_event(prev: str | None, nxt: str) -> str | None:
    """Two changes to one path inside a debounce window → the one event they add up to (None = nothing happened)."""
    if prev is None:
        return nxt
    if prev == "created":
        return None if nxt == "deleted" else "created"
    if prev == "deleted":
        return "modified" if nxt == "created" else "deleted"
    return "deleted" if nxt == "deleted" else "modified"


def read_text(path: str) -> str | None:
    try:
        if os.path.getsize(path) > DIFF_FILE_MAX:
            return None
        with open(path, "rb") as f:
            b = f.read(DIFF_FILE_MAX + 1)
    except OSError:
        return None
    if b"\0" in b:
        return None
    return b.decode("utf-8", "replace")


def text_diff(before: str | None, after: str | None, rel: str) -> str:
    if before is None and after is None:
        return ""
    d = "".join(difflib.unified_diff((before or "").splitlines(True), (after or "").splitlines(True), f"a/{rel}", f"b/{rel}", n=2))
    return d[:DIFF_OUT_MAX] + ("\n… (diff cut)" if len(d) > DIFF_OUT_MAX else "")


# ---------------------------------------------------------------------- inotify (optional wake-up)

class Waker:
    """Blocks until a watched folder changes or the timeout passes. inotify through libc when it's there, else a sleep."""
    MASK = 0x2 | 0x8 | 0x40 | 0x80 | 0x100 | 0x200 | 0x400 | 0x800  # MODIFY CLOSE_WRITE MOVED_FROM/TO CREATE DELETE DELETE_SELF MOVE_SELF

    def __init__(self) -> None:
        self.fd = -1
        self.dirs: set[str] = set()
        self.kind = "polling"
        try:
            libc = ctypes.CDLL(ctypes.util.find_library("c") or "libc.so.6", use_errno=True)
            fd = libc.inotify_init1(os.O_NONBLOCK | getattr(os, "O_CLOEXEC", 0))
            if fd >= 0:
                self.libc, self.fd, self.kind = libc, fd, "inotify"
        except (OSError, AttributeError):
            pass

    def sync(self, dirs: set[str]) -> None:
        if self.fd < 0:
            return
        for d in sorted(dirs - self.dirs)[: max(0, MAX_DIRS - len(self.dirs))]:
            if self.libc.inotify_add_watch(self.fd, d.encode(), self.MASK) >= 0:
                self.dirs.add(d)

    def wait(self, timeout: float) -> bool:
        if self.fd < 0:
            time.sleep(timeout)
            return False
        try:
            r, _, _ = select.select([self.fd], [], [], timeout)
        except (OSError, ValueError):
            time.sleep(timeout)
            return False
        if not r:
            return False
        try:
            while os.read(self.fd, 65536):
                pass
        except BlockingIOError:
            pass
        except OSError:
            pass
        self.dirs = {d for d in self.dirs if os.path.isdir(d)}
        return True


# ---------------------------------------------------------------------- the engine

def _fill(s: str, ctx: dict[str, str], quote: bool = False) -> str:
    def one(m: re.Match[str]) -> str:
        v = ctx.get(m.group(1))
        return m.group(0) if v is None else (shlex.quote(v) if quote else v)
    return re.sub(r"\{(path|rel|event|watch|name|diff)\}", one, s)


def _fill_any(v: Any, ctx: dict[str, str]) -> Any:
    if isinstance(v, str):
        return _fill(v, ctx)
    if isinstance(v, list):
        return [_fill_any(x, ctx) for x in v]
    if isinstance(v, dict):
        return {k: _fill_any(x, ctx) for k, x in v.items()}
    return v


class Hooks:
    """What the console lends the engine. Every hook may be missing; the engine logs why an action couldn't run."""
    notify: Callable[[dict[str, Any]], Any] | None = None           # alert@1 → AmberX / console banner
    notify_allowed: Callable[[], bool] | None = None                 # axf.notify@1 gate for watchdog.fired
    console: Callable[[dict[str, Any]], dict[str, Any]] | None = None  # console-commands@1 (an action in the open console)
    control: Callable[[dict[str, Any]], dict[str, Any]] | None = None  # control@1 command
    llm: Callable[..., dict[str, Any]] | None = None                 # axf.llm@1 complete(messages, system=, model=, profile=, params=)
    log: Callable[[str, str], None] = staticmethod(lambda text, level: None)


class Engine:
    def __init__(self, data_dir: Path, root: Path, hooks: Hooks | None = None) -> None:
        self.data_dir = Path(data_dir)
        self.root = Path(root).resolve()
        self.hooks = hooks or Hooks()
        self.lock = threading.RLock()
        self.snaps: dict[str, dict[str, tuple[int, int]]] = {}
        self.texts: dict[str, dict[str, str]] = {}      # AI watches only: last text of each small file, for diffs
        self.pending: dict[str, dict[str, str]] = {}    # watch id → {path: event} waiting out the debounce
        self.changed_at: dict[str, float] = {}
        self.fired: dict[str, int] = {}
        self.stop_flag = threading.Event()
        self.thread: threading.Thread | None = None
        self.waker: Waker | None = None
        self.poll_s = 2.0
        self.last_pass = 0.0
        self.active: Callable[[], bool] = lambda: True

    # ---- storage
    @property
    def watches_file(self) -> Path:
        return self.data_dir / "watches.json"

    @property
    def log_file(self) -> Path:
        return self.data_dir / "events.jsonl"

    def _write(self, p: Path, text: str) -> None:
        self.data_dir.mkdir(parents=True, exist_ok=True)
        try:
            os.chmod(self.data_dir, 0o700)
        except OSError:
            pass
        tmp = p.with_suffix(p.suffix + f".{secrets.token_hex(4)}.tmp")
        fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        os.replace(tmp, p)

    def watches(self) -> list[dict[str, Any]]:
        try:
            d = json.loads(self.watches_file.read_text("utf-8"))
            return [w for w in d.get("watches", []) if isinstance(w, dict) and w.get("id")]
        except (OSError, ValueError):
            return []

    def _save(self, ws: list[dict[str, Any]]) -> None:
        self._write(self.watches_file, json.dumps({"$axf": "file-watchdog@1", "watches": ws}, indent=2))

    def get(self, wid: str) -> dict[str, Any]:
        for w in self.watches():
            if w["id"] == wid:
                return w
        raise KeyError(wid)

    # ---- changes to watches
    def add(self, inp: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            ws = self.watches()
            if len(ws) >= MAX_WATCHES:
                raise WatchError(f"at most {MAX_WATCHES} watches")
            w = normal_watch(inp, None, {x["id"] for x in ws})
            ws.append(w)
            self._save(ws)
            self._forget(w["id"])
            return w

    def update(self, wid: str, inp: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            ws = self.watches()
            for i, w in enumerate(ws):
                if w["id"] == wid:
                    ws[i] = normal_watch(inp, w)
                    self._save(ws)
                    if any(ws[i][k] != w.get(k) for k in ("paths", "recursive", "ignore", "enabled")):
                        self._forget(wid)  # what it covers changed: start from a fresh snapshot
                    return ws[i]
            raise KeyError(wid)

    def remove(self, wid: str) -> dict[str, Any]:
        with self.lock:
            ws = self.watches()
            keep = [w for w in ws if w["id"] != wid]
            if len(keep) == len(ws):
                raise KeyError(wid)
            self._save(keep)
            self._forget(wid)
            return {"removed": wid}

    def approve(self, wid: str, index: int, approver: dict[str, str] | None, revoke: bool = False) -> dict[str, Any]:
        """Approve (or revoke) one script / shell action. Only Brett's own approval, as the request carries it, counts."""
        with self.lock:
            ws = self.watches()
            w = next((x for x in ws if x["id"] == wid), None)
            if w is None:
                raise KeyError(wid)
            if not 0 <= index < len(w["actions"]) or w["actions"][index]["type"] not in NEEDS_APPROVAL:
                raise WatchError("that action doesn't need an approval (only script and shell actions do)")
            a = w["actions"][index]
            if revoke:
                a["approval"] = {"hash": command_hash(a), "state": "needed", "by": "", "at": 0}
            elif approver:
                a["approval"] = {"hash": command_hash(a), "state": "approved", "by": _text(approver.get("name") or approver.get("via"), 80), "at": int(time.time())}
            else:
                a["approval"] = {**a.get("approval", {}), "hash": command_hash(a), "state": "requested", "at": int(time.time())}
            self._save(ws)
            return a

    def _forget(self, wid: str) -> None:
        for d in (self.snaps, self.texts, self.pending, self.changed_at):
            d.pop(wid, None)

    # ---- the event log
    def log_event(self, rec: dict[str, Any]) -> None:
        with self.lock:
            self.data_dir.mkdir(parents=True, exist_ok=True)
            line = json.dumps(rec, separators=(",", ":")) + "\n"
            fd = os.open(self.log_file, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
            with os.fdopen(fd, "a", encoding="utf-8") as f:
                f.write(line)
            try:
                if self.log_file.stat().st_size > 4 * 1024 * 1024:
                    lines = self.log_file.read_text("utf-8").splitlines(True)[-LOG_KEEP:]
                    self._write(self.log_file, "".join(lines))
            except OSError:
                pass

    def events(self, limit: int = 100, watch: str = "") -> list[dict[str, Any]]:
        try:
            lines = self.log_file.read_text("utf-8").splitlines()
        except OSError:
            return []
        out: list[dict[str, Any]] = []
        for ln in reversed(lines):
            try:
                r = json.loads(ln)
            except ValueError:
                continue
            if watch and r.get("watch") != watch:
                continue
            out.append(r)
            if len(out) >= limit:
                break
        return out

    def clear_events(self) -> dict[str, Any]:
        with self.lock:
            self._write(self.log_file, "")
        return {"cleared": True}

    # ---- scanning
    def scan(self, now: float | None = None) -> int:
        """One pass: compare every enabled watch with its snapshot, then fire what waited out its debounce. → fired count."""
        now = time.time() if now is None else now
        dirs: set[str] = set()
        fired = 0
        for w in self.watches():
            if not w.get("enabled", True):
                self._forget(w["id"])
                continue
            try:
                new, wd = snapshot(w, self.root)
            except Exception as e:  # noqa: BLE001 — one bad watch never stops the others
                self.hooks.log(f"file watchdog: {w['id']}: {e}", "warn")
                continue
            dirs |= wd
            old = self.snaps.get(w["id"])
            self.snaps[w["id"]] = new
            changes = compare(old, new) if old is not None else []
            if w.get("ai", {}).get("enabled") and w["id"] not in self.texts:
                # AI just switched on (or a fresh start): remember the text of unchanged small files, for later diffs
                moved = {p for _, p in changes}
                self.texts[w["id"]] = {p: t for p in list(new)[:200] if p not in moved and (t := read_text(p)) is not None}
            if old is None:
                continue
            pend = self.pending.setdefault(w["id"], {})
            for ev, p in changes:
                m = merge_event(pend.get(p), ev)
                if m is None:
                    pend.pop(p, None)
                else:
                    pend[p] = m
                self.changed_at[w["id"]] = now
            if pend and now - self.changed_at.get(w["id"], now) >= w.get("debounceMs", 500) / 1000:
                batch = sorted(pend.items())
                self.pending[w["id"]] = {}
                todo = [(p, ev) for p, ev in batch if ev in w.get("events", EVENTS)]
                for p, ev in todo[:MAX_PER_BATCH]:
                    self.fire(w, ev, p)
                    fired += 1
                if len(todo) > MAX_PER_BATCH:
                    self.log_event({"id": secrets.token_hex(6), "at": int(now), "watch": w["id"], "name": w["name"], "event": "batch",
                                    "path": "", "rel": "", "results": [{"type": "watch", "status": "skipped", "ok": True,
                                    "message": f"{len(todo) - MAX_PER_BATCH} more changes in this batch were not run (at most {MAX_PER_BATCH} at once)"}]})
        if self.waker:
            self.waker.sync(dirs)
        self.last_pass = now
        return fired

    # ---- firing
    def fire(self, w: dict[str, Any], event: str, path: str, *, test: bool = False) -> dict[str, Any]:
        """Run every action of a watch for one change. Every action gets the path and event; every result is logged."""
        rel = rel_of(self.root, path)
        ctx = {"path": path, "rel": rel, "event": event, "watch": w["id"], "name": w["name"]}
        results: list[dict[str, Any]] = []
        for i, a in enumerate(w.get("actions", [])):
            t0 = time.time()
            if not a.get("enabled", True):
                r = {"status": "off", "ok": True, "message": "action switched off"}
            else:
                try:
                    r = self._run(a, ctx)
                except Exception as e:  # noqa: BLE001
                    r = {"status": "failed", "ok": False, "message": f"{type(e).__name__}: {e}"[:OUT_MAX]}
            results.append({"index": i, "type": a["type"], **r, "ms": int((time.time() - t0) * 1000)})
        ai = w.get("ai") or {}
        if ai.get("enabled"):
            t0 = time.time()
            try:
                r = self._ai(w, ai, ctx, path, event)
            except Exception as e:  # noqa: BLE001
                r = {"status": "failed", "ok": False, "message": f"{type(e).__name__}: {e}"[:OUT_MAX]}
            results.append({"index": -1, "type": "ai", **r, "ms": int((time.time() - t0) * 1000)})
        elif w["id"] in self.texts:
            self.texts.pop(w["id"], None)
        rec = {"id": secrets.token_hex(6), "at": int(time.time()), "watch": w["id"], "name": w["name"], "event": event,
               "path": path, "rel": rel, "test": test, "results": results}
        self.fired[w["id"]] = self.fired.get(w["id"], 0) + 1
        self.log_event(rec)
        return rec

    def _env(self, ctx: dict[str, str]) -> dict[str, str]:
        env = {k: v for k, v in os.environ.items() if not re.search(r"TOKEN|SECRET|KEY|PASSWORD", k)}
        env.update({"WATCHDOG_PATH": ctx["path"], "WATCHDOG_REL": ctx["rel"], "WATCHDOG_EVENT": ctx["event"],
                    "WATCHDOG_WATCH": ctx["watch"], "WATCHDOG_NAME": ctx["name"]})
        return env

    def _exec(self, argv: list[str] | str, ctx: dict[str, str], timeout: int, shell: bool) -> dict[str, Any]:
        try:
            p = subprocess.run(argv, shell=shell, cwd=str(self.root), env=self._env(ctx), capture_output=True, text=True,
                               timeout=timeout, stdin=subprocess.DEVNULL)
        except subprocess.TimeoutExpired:
            return {"status": "failed", "ok": False, "message": f"timed out after {timeout}s"}
        except OSError as e:
            return {"status": "failed", "ok": False, "message": str(e)[:OUT_MAX]}
        out = ((p.stdout or "") + (("\n" + p.stderr) if p.stderr else "")).strip()
        return {"status": "ok" if p.returncode == 0 else "failed", "ok": p.returncode == 0, "exit": p.returncode,
                "message": out[-OUT_MAX:] or f"exit {p.returncode}"}

    def _run(self, a: dict[str, Any], ctx: dict[str, str]) -> dict[str, Any]:
        t = a["type"]
        if t in NEEDS_APPROVAL:
            ap = a.get("approval") or {}
            if ap.get("state") != "approved" or ap.get("hash") != command_hash(a):
                return {"status": "held", "ok": False, "message": "waiting for Brett's approval of this command (watch → Approve)"}
        if t == "notify":
            if self.hooks.notify_allowed and not self.hooks.notify_allowed():
                return {"status": "off", "ok": True, "message": "off in the Notifications panel (watchdog.fired)"}
            if not self.hooks.notify:
                return {"status": "failed", "ok": False, "message": "the console's alert hub isn't reachable"}
            title = _fill(a.get("title") or "{name}: {event} {rel}", ctx)[:160]
            self.hooks.notify({"source": "file-watchdog", "key": f"file-watchdog:{ctx['watch']}", "severity": a.get("severity", "info"),
                               "title": title, "body": f"{ctx['event']}: {ctx['path']}"[:300], "link": "nav:file-watchdog"})
            return {"status": "ok", "ok": True, "message": f"sent: {title}"}
        if t == "script":
            sp = resolve(self.root, a["script"])
            if not sp.is_file():
                return {"status": "failed", "ok": False, "message": f"no script at {sp}"}
            args = [_fill(x, ctx) for x in a.get("args", [])]
            argv = [str(sp), *args] if os.access(sp, os.X_OK) else [*RUNNERS.get(sp.suffix, ["bash"]), str(sp), *args]
            return self._exec(argv, ctx, a.get("timeout", TIMEOUT_DEFAULT), shell=False)
        if t == "shell":
            return self._exec(_fill(a["command"], ctx, quote=True), ctx, a.get("timeout", TIMEOUT_DEFAULT), shell=True)
        if t == "console":
            if not self.hooks.console:
                return {"status": "failed", "ok": False, "message": "console actions need the Console commands plugin (console-commands@1)"}
            cmd: dict[str, Any] = {"op": "act", "target": "console.actions", "path": _fill(a["action"], ctx), "action": "run", "by": "file-watchdog"}
            if a.get("args") not in (None, "", [], {}):
                cmd["input"] = {"args": _fill_any(a["args"], ctx)}
            r = self.hooks.console(cmd) or {}
            return {"status": "ok" if r.get("ok") else "failed", "ok": bool(r.get("ok")), "message": _text(r.get("message") or r.get("code") or "", OUT_MAX)}
        if t == "control":
            if not self.hooks.control:
                return {"status": "failed", "ok": False, "message": "control@1 isn't available (Token control plugin off)"}
            cmd = _fill_any(a["command"], ctx)
            cmd.setdefault("by", "file-watchdog")
            r = self.hooks.control(cmd) or {}
            return {"status": "ok" if r.get("ok") else "failed", "ok": bool(r.get("ok")), "message": _text(r.get("message") or r.get("code") or "", OUT_MAX)}
        return {"status": "failed", "ok": False, "message": f"unknown action {t}"}

    def _ai(self, w: dict[str, Any], ai: dict[str, Any], ctx: dict[str, str], path: str, event: str) -> dict[str, Any]:
        texts = self.texts.setdefault(w["id"], {})
        before = texts.get(path)
        after = read_text(path) if event != "deleted" else None
        if after is not None:
            texts[path] = after
        else:
            texts.pop(path, None)
        diff = text_diff(before, after, ctx["rel"]) if (before is not None or after is not None) else ""
        if not ai.get("prompt"):
            return {"status": "skipped", "ok": False, "message": "Enable AI is on but the watch has no prompt"}
        if not self.hooks.llm:
            return {"status": "failed", "ok": False, "message": "no model service (axf.llm@1): the AI assistant plugin is off"}
        user = (_fill(ai["prompt"], {**ctx, "diff": diff}) + f"\n\nWatch: {w['name']}\nEvent: {event}\nPath: {path}\n"
                + (f"\nDiff:\n```diff\n{diff}\n```\n" if diff else "\n(no text diff: binary, too large, or new to the watch)\n"))
        out = self.hooks.llm([{"role": "user", "content": user}],
                             system="You are the console's file watchdog. A watched file changed; follow the user's instruction about it. Be brief.",
                             model=ai.get("model") or None, profile=ai.get("profile") or None, params={"max_tokens": ai.get("maxTokens", 1200)})
        usage = out.get("usage") or {}
        return {"status": "ok", "ok": True, "message": _text(out.get("text"), OUT_MAX), "model": out.get("model") or "",
                "profile": out.get("profile") or "", "usage": {"input": int(usage.get("input") or 0), "output": int(usage.get("output") or 0)}}

    # ---- the loop
    def start(self, active: Callable[[], bool] | None = None, poll_s: float = 2.0) -> None:
        if self.thread and self.thread.is_alive():
            return
        self.active = active or (lambda: True)
        self.poll_s = poll_s
        self.waker = Waker()
        self.stop_flag.clear()
        self.thread = threading.Thread(target=self._loop, name="file-watchdog", daemon=True)
        self.thread.start()

    def stop(self) -> None:
        self.stop_flag.set()

    def _loop(self) -> None:
        while not self.stop_flag.is_set():
            try:
                if self.active():
                    self.scan()
            except Exception as e:  # noqa: BLE001 — the loop never dies
                self.hooks.log(f"file watchdog: pass failed: {e}", "warn")
            waiting = any(self.pending.values())
            assert self.waker is not None
            # a change waiting out its debounce: come back soon; otherwise sleep until inotify wakes us or the timer runs out
            self.waker.wait(0.25 if waiting else self.poll_s)

    def status(self) -> dict[str, Any]:
        return {"running": bool(self.thread and self.thread.is_alive() and not self.stop_flag.is_set()),
                "mode": self.waker.kind if self.waker else "stopped", "folders": len(self.waker.dirs) if self.waker else 0,
                "lastPass": int(self.last_pass), "pollSeconds": self.poll_s}

    def view(self, w: dict[str, Any]) -> dict[str, Any]:
        return {**w, "files": len(self.snaps.get(w["id"], {})), "pending": len(self.pending.get(w["id"], {})), "fired": self.fired.get(w["id"], 0)}
