"""Terminal sessions: a PTY (console shell, VPS over SSH, Claude Code) or a container TTY (through axf.containers@1),
kept on the server so a browser can drop and re-attach (Mosh mode) without losing anything.

Every session keeps the last 512 KB of output and a running byte offset. A client attaches with the offset it has
seen; it gets the missing bytes, or a reset + the whole buffer when they've scrolled out. Sessions close when idle
(no typed input; output alone doesn't count) for `idleMinutes`, or when nobody is attached for longer than their keep-alive (Mosh mode:
`moshKeepMinutes`; otherwise a short grace so a page reload re-attaches). The console's own tokens and keys never
reach a shell's environment.
"""
from __future__ import annotations

import asyncio
import fcntl
import os
import pty
import re
import secrets
import select
import shlex
import signal
import struct
import subprocess
import termios
import threading
import time
from pathlib import Path
from typing import Any

import console_context as cx
import plugin_services

from . import store

RING = 512 * 1024
MAX_SESSIONS = 12
GRACE_SECONDS = 25
_SECRETISH = re.compile(r"(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|(^|_)KEY$|_KEY_|API_KEY|AUTH)", re.I)
_KEEP = {"PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SHELL", "USER", "LOGNAME", "HOSTNAME", "PWD", "NODE_VERSION", "PYTHON_VERSION"}


def clean_env(extra: dict[str, str] | None = None) -> dict[str, str]:
    """The console's environment minus anything secret-looking (tokens, keys, passwords) and every stored credential."""
    try:
        import credentials
        stored = set((credentials.STORE.read() if credentials.STORE else {}).keys())
    except Exception:  # noqa: BLE001
        stored = set()
    env = {k: v for k, v in os.environ.items() if k in _KEEP or (not _SECRETISH.search(k) and k not in stored and not k.startswith("AXF_"))}
    env.update({"TERM": "xterm-256color", "COLORTERM": "truecolor", "AXF_TERMINAL": "1"})
    env.update(extra or {})
    return env


# ---------------------------------------------------------------- backends

class PtyBackend:
    def __init__(self, argv: list[str], cwd: str, env: dict[str, str], cols: int, rows: int):
        pid, fd = pty.fork()
        if pid == 0:  # child
            try:
                os.chdir(cwd)
            except OSError:
                os.chdir("/")
            os.execvpe(argv[0], argv, env)
        self.pid, self.fd = pid, fd
        self.resize(cols, rows)

    def read(self) -> bytes:
        while True:
            try:
                r, _, _ = select.select([self.fd], [], [], 1.0)
            except (OSError, ValueError):
                return b""
            if r:
                try:
                    return os.read(self.fd, 65536)
                except OSError:
                    return b""
            if not self.alive():
                return b""

    def write(self, data: bytes) -> None:
        os.write(self.fd, data)

    def resize(self, cols: int, rows: int) -> None:
        try:
            fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack("HHHH", max(5, min(rows, 300)), max(10, min(cols, 500)), 0, 0))
        except OSError:
            pass

    def alive(self) -> bool:
        try:
            return os.waitpid(self.pid, os.WNOHANG) == (0, 0)
        except ChildProcessError:
            return False

    def close(self) -> None:
        for sig in (signal.SIGHUP, signal.SIGKILL):
            try:
                os.kill(self.pid, sig)
            except OSError:
                break
            time.sleep(0.05)
        try:
            os.close(self.fd)
        except OSError:
            pass
        try:
            os.waitpid(self.pid, os.WNOHANG)
        except ChildProcessError:
            pass


class TtyBackend:
    """A container exec TTY from axf.containers@1."""

    def __init__(self, tty):
        self.tty = tty

    def read(self) -> bytes:
        return self.tty.read()

    def write(self, data: bytes) -> None:
        self.tty.write(data)

    def resize(self, cols: int, rows: int) -> None:
        self.tty.resize(cols, rows)

    def alive(self) -> bool:
        return not self.tty.closed

    def close(self) -> None:
        self.tty.close()


# ---------------------------------------------------------------- sessions

TMUX_NAME = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")


def new_sid() -> str:
    return "t" + secrets.token_hex(6)


def tmux_remote(name: str) -> str:
    """The remote command for a VPS tab attached to tmux session `name` (plain names only); a shell when it's gone."""
    if not TMUX_NAME.match(name):
        raise ValueError("tmux is a plain session name (letters, digits, . _ -)")
    t = shlex.quote(f"={name}")  # "=name": that session exactly, never a prefix match
    return (f"if tmux has-session -t {t} 2>/dev/null; then exec tmux attach -t {t}; "
            f"else echo 'tmux session {name} is not running on this host'; exec \"${{SHELL:-bash}}\" -l; fi")

class Session:
    def __init__(self, kind: str, title: str, target: str, cwd: str, backend: Any, mosh: bool, badge: str | None = None, protected: bool = False,
                 sid: str | None = None):
        self.id = sid or new_sid()
        self.kind, self.title, self.target, self.cwd, self.backend = kind, title, target, cwd, backend
        self.mosh, self.badge, self.protected = mosh, badge, protected
        self.created = self.last = self.last_input = time.time()
        self.detached_at: float | None = time.time()
        self.buf = bytearray()
        self.offset = 0  # total bytes ever produced
        self.lock = threading.Lock()
        self.listeners: set[tuple[asyncio.AbstractEventLoop, asyncio.Queue]] = set()
        self.exit: int | None = None
        self.closed = False
        threading.Thread(target=self._pump, daemon=True, name=f"term-{self.id}").start()

    def info(self) -> dict[str, Any]:
        return {"id": self.id, "kind": self.kind, "title": self.title, "target": self.target, "cwd": self.cwd, "mosh": self.mosh, "badge": self.badge,
                "protected": self.protected, "createdAt": int(self.created * 1000), "attached": len(self.listeners), "closed": self.closed}

    def _pump(self) -> None:
        while not self.closed:
            data = self.backend.read()
            if not data:
                break
            with self.lock:
                self.buf += data
                self.offset += len(data)
                if len(self.buf) > RING:
                    del self.buf[: len(self.buf) - RING]
                self.last = time.time()
                for loop, q in list(self.listeners):
                    loop.call_soon_threadsafe(q.put_nowait, data)
        self.exit = 0
        with self.lock:
            for loop, q in list(self.listeners):
                loop.call_soon_threadsafe(q.put_nowait, None)
        MANAGER.close(self.id, "exited")

    def attach(self, loop: asyncio.AbstractEventLoop, q: asyncio.Queue, have: int) -> tuple[bytes, bool, int]:
        """Register a listener; returns (bytes to send first, reset?, offset after them)."""
        with self.lock:
            start = self.offset - len(self.buf)
            if have < start or have > self.offset:
                replay, reset = bytes(self.buf), True
            else:
                replay, reset = bytes(self.buf[have - start:]), False
            self.listeners.add((loop, q))
            self.detached_at = None
            return replay, reset, self.offset

    def detach(self, loop: asyncio.AbstractEventLoop, q: asyncio.Queue) -> None:
        with self.lock:
            self.listeners.discard((loop, q))
            if not self.listeners:
                self.detached_at = time.time()

    def write(self, data: bytes) -> None:
        self.last = self.last_input = time.time()
        self.backend.write(data)


class Manager:
    def __init__(self) -> None:
        self.sessions: dict[str, Session] = {}
        self.lock = threading.Lock()
        threading.Thread(target=self._reaper, daemon=True, name="term-reaper").start()

    def list(self) -> list[dict[str, Any]]:
        return [s.info() for s in self.sessions.values()]

    def get(self, sid: str) -> Session:
        s = self.sessions.get(sid)
        if not s or s.closed:
            raise KeyError("no such terminal session")
        return s

    def open(self, req: dict[str, Any]) -> Session:
        if len(self.sessions) >= MAX_SESSIONS:
            raise ValueError(f"at most {MAX_SESSIONS} terminals at once; close one first")
        st = store.settings()
        kind = req.get("kind") or "console"
        cols, rows = int(req.get("cols") or 100), int(req.get("rows") or 30)
        mosh = bool(req.get("mosh"))
        cwd = str(req.get("cwd") or "").strip()
        if cwd and (not cwd.startswith("/") or "\x00" in cwd):
            raise ValueError("cwd is an absolute path")
        protected = False
        badge = None
        sid = new_sid()
        mine = {"AXF_TERM_SESSION": sid}  # a Claude Code started in this tab reports it (codebase-changes runner) so the banner can focus it
        tmux = str(req.get("tmux") or "").strip()
        if tmux and kind != "vps":
            raise ValueError("tmux attaches only in a VPS tab (the tmux session runs on the host)")
        if kind == "console":
            d = Path(cwd) if cwd else cx.ROOT
            if d.is_file():
                d = d.parent
            if not d.is_dir():
                d = cx.ROOT
            shell = "bash" if Path("/bin/bash").exists() or Path("/usr/bin/bash").exists() else "sh"
            be = PtyBackend([shell, "-l"], str(d), clean_env(mine), cols, rows)
            title, target, cwd = "Console", "console", str(d)
        elif kind == "container":
            cs = plugin_services.get("axf.containers@1")
            if not cs:
                raise PermissionError("Container access isn't installed or enabled, so only the console's own shell is available")
            name = str(req.get("container") or "")
            entry = next((c for c in cs.list() if c["name"] == name), None)
            if not entry:
                raise KeyError(f"no container named {name!r}")
            protected = bool(entry.get("protected"))
            if protected and not req.get("confirmProtected"):
                raise PermissionError(f"{name} is protected ({entry['protected']['label']}): confirm to open a root shell in it")
            tty, c = cs.tty(name, actor={"kind": "user", "id": "console", "name": "Brett (terminal)"}, cwd=cwd, user=st["user"],
                            allow_protected=protected, cols=cols, rows=rows)
            be = TtyBackend(tty)
            title, target = name, name
            badge = "PROTECTED" if protected else None
        elif kind == "vps":
            vps = st["vps"]
            key = store.ssh_key()
            if not vps.get("host") or not key.exists():
                raise ValueError("set up the VPS tab first (Settings → Plugins → Terminal → VPS host: host + a key)")
            remote = f"cd -- {shlex.quote(cwd)} 2>/dev/null; exec \"${{SHELL:-bash}}\" -l" if cwd else "exec \"${SHELL:-bash}\" -l"
            if tmux:
                remote = tmux_remote(tmux)
            argv = ["ssh", "-tt", "-i", str(key), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new",
                    "-o", f"UserKnownHostsFile={store.data_dir() / 'ssh' / 'known_hosts'}", "-o", "ServerAliveInterval=30", "-o", "BatchMode=yes",
                    "-p", str(vps.get("port") or 22), f"{vps.get('user') or 'root'}@{vps['host']}", remote]
            be = PtyBackend(argv, str(cx.ROOT), clean_env(), cols, rows)
            title, target, badge = (f"tmux {tmux}" if tmux else "VPS"), vps["host"], "HOST ROOT"
        elif kind == "claude":
            exe = os.environ.get("CLAUDE_BIN", "claude")
            if not subprocess.run(["sh", "-c", f"command -v {shlex.quote(exe)}"], capture_output=True).stdout.strip():
                raise ValueError("the claude CLI isn't installed in the console")
            d = Path(cwd) if cwd else cx.ROOT
            if not d.is_dir():
                d = cx.ROOT
            extra = {"DISABLE_AUTOUPDATER": "1", **mine}
            tok = store.claude_token()
            if tok:
                extra["CLAUDE_CODE_OAUTH_TOKEN"] = tok
            be = PtyBackend([exe], str(d), clean_env(extra), cols, rows)
            title, target, cwd = "Claude Code", "console", str(d)
        else:
            raise ValueError("kind is console, container, vps or claude")
        s = Session(kind, title, target, cwd, be, mosh, badge, protected, sid=sid)
        with self.lock:
            full = len(self.sessions) >= MAX_SESSIONS  # checked again here: two opens can race past the first check
            if not full:
                self.sessions[s.id] = s
        if full:
            s.closed = True
            try:
                be.close()
            except Exception:  # noqa: BLE001
                pass
            raise ValueError(f"at most {MAX_SESSIONS} terminals at once; close one first")
        store.log({"op": "open", "id": s.id, "kind": kind, "target": target, "cwd": cwd, "protected": protected, "mosh": mosh, **({"tmux": tmux} if tmux else {})})
        return s

    def close(self, sid: str, reason: str = "closed") -> None:
        with self.lock:
            s = self.sessions.pop(sid, None)
        if not s or s.closed:
            return
        s.closed = True
        try:
            s.backend.close()
        except Exception:  # noqa: BLE001
            pass
        with s.lock:
            for loop, q in list(s.listeners):
                loop.call_soon_threadsafe(q.put_nowait, None)
        store.log({"op": "close", "id": sid, "kind": s.kind, "target": s.target, "seconds": round(time.time() - s.created), "reason": reason})

    def close_all(self) -> None:
        for sid in list(self.sessions):
            self.close(sid, "console token reset")

    def _reaper(self) -> None:
        tok = hash(cx.current_token())
        while True:
            time.sleep(5)
            if hash(cx.current_token()) != tok:  # console token reset: every terminal closes, like the panel's shell
                tok = hash(cx.current_token())
                self.close_all()
            st = store.settings()
            now = time.time()
            for s in list(self.sessions.values()):
                if now - s.last_input > st["idleMinutes"] * 60:  # output alone (top, tail -f) doesn't keep a terminal open
                    self.close(s.id, "idle")
                elif s.detached_at is not None:
                    keep = st["moshKeepMinutes"] * 60 if s.mosh else GRACE_SECONDS
                    if now - s.detached_at > keep:
                        self.close(s.id, "nobody attached")


MANAGER = Manager()
