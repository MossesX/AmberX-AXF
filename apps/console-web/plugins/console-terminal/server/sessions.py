"""Terminal sessions: a PTY (console shell, VPS over SSH, Claude Code) or a container TTY (through axf.containers@1),
kept on the server so a browser can drop and re-attach (Mosh mode) without losing anything.

Every session keeps the last 512 KB of output and a running byte offset. A client attaches with the offset it has
seen; it gets the missing bytes, or a reset + the whole buffer when they've scrolled out. Sessions close when idle
(no typed input; output alone doesn't count) for `idleMinutes`, or when nobody is attached for longer than their keep-alive (Mosh mode:
`moshKeepMinutes`; otherwise a short grace so a page reload re-attaches). The console's own tokens and keys never
reach a shell's environment.

Persistent tabs (headless-tabs, Nov 3 2026, Brett: "every terminal tab runs on a session that never dies, like
Mosh"): VPS and console tabs (shells and Claude Code) run inside a tmux session named axt-… (the browser picks the name
and keeps it with the tab). The ssh / pty link here is only an attachment: when it drops (reload, phone sleep, console
restart, reaper) the browser opens a new one on the same name, which replays the pane's scrollback (capture-pane) and
re-attaches. Closing a tab detaches; Kill session ends the tmux session. The same session can be attached from Moshi
(`info().attachCmd`). Container tabs (axf.containers@1) keep the server-side ring only. Setting `persistTabs`.
"""
from __future__ import annotations

import asyncio
import fcntl
import os
import json
import pty
import re
import secrets
import select
import shlex
import shutil
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
    env = {k: v for k, v in os.environ.items() if k in _KEEP or (not _SECRETISH.search(k) and k not in stored and not k.startswith(("AXF_", "TMUX")))}
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

class Session:
    def __init__(self, kind: str, title: str, target: str, cwd: str, backend: Any, mosh: bool, badge: str | None = None, protected: bool = False,
                 tmux: str | None = None, where: str | None = None):
        self.id = "t" + secrets.token_hex(6)
        self.kind, self.title, self.target, self.cwd, self.backend = kind, title, target, cwd, backend
        self.mosh, self.badge, self.protected = mosh, badge, protected
        self.tmux, self.where = tmux, where  # the tmux session this attaches to, and where it lives (vps | console)
        self.close_reason = ""
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
                "protected": self.protected, "createdAt": int(self.created * 1000), "attached": len(self.listeners), "closed": self.closed,
                "tmux": self.tmux, "where": self.where, "attachCmd": attach_commands(self.tmux, self.where) if self.tmux else None}

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
        tmux: str | None = None
        where: str | None = None
        tab_tmux = str(req.get("tmux") or "") if st.get("persistTabs", True) else ""
        if tab_tmux and not TAB_RE.match(tab_tmux):
            raise ValueError("tmux is the name of an axt-… session")
        if kind == "console":
            d = Path(cwd) if cwd else cx.ROOT
            if d.is_file():
                d = d.parent
            if not d.is_dir():
                d = cx.ROOT
            shell = "bash" if Path("/bin/bash").exists() or Path("/usr/bin/bash").exists() else "sh"
            tmux = local_tmux(tab_tmux)
            argv = ["sh", "-c", tmux_script(tmux, f"{shell} -l", str(d), cols, rows)] if tmux else [shell, "-l"]
            be = PtyBackend(argv, str(d), clean_env(), cols, rows)
            where = "console" if tmux else None
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
            attach = str(req.get("attach") or "")
            if attach and not TMUX_RE.match(attach):
                raise ValueError("attach is the name of an axf-… or axt-… tmux session")
            if attach:  # a headless Claude Code session claude-headless.sh started (or a detached tab): watch it (and type into it) here
                q = shlex.quote(attach)
                remote = (f"tmux capture-pane -p -e -J -S -{REPLAY_LINES} -t ={q} 2>/dev/null; tmux attach -t ={q} 2>/dev/null || "
                          "{ echo 'That session has ended; its log is in its folder (.axf-*.log).'; exec \"${SHELL:-bash}\" -l; }")
                tmux, where = attach, "vps"
            elif tab_tmux:
                remote = tmux_script(tab_tmux, "exec \"${SHELL:-bash}\" -l", cwd, cols, rows,
                                     fallback=(f"cd -- {shlex.quote(cwd)} 2>/dev/null; " if cwd else "") + "exec \"${SHELL:-bash}\" -l")
                tmux, where = tab_tmux, "vps"
            else:
                remote = f"cd -- {shlex.quote(cwd)} 2>/dev/null; exec \"${{SHELL:-bash}}\" -l" if cwd else "exec \"${SHELL:-bash}\" -l"
            be = PtyBackend(vps_argv(st, remote, tty=True), str(cx.ROOT), clean_env(), cols, rows)
            title, target, badge = (f"Claude: {attach[4:]}" if attach else "VPS"), vps["host"], "HOST ROOT"
        elif kind == "claude":
            # Claude Code on a connection (Oct 28 2026): via = console (default) | vps | container | axhub.
            # axhub = Claude Code in the console with axHub's MCP server added, so every hub service is a tool.
            via = str(req.get("via") or "console")
            exe = os.environ.get("CLAUDE_BIN", "claude")
            cargs = claude_args(req)
            tok = store.claude_token()
            if via in ("console", "axhub"):
                if not subprocess.run(["sh", "-c", f"command -v {shlex.quote(exe)}"], capture_output=True).stdout.strip():
                    raise ValueError("the claude CLI isn't installed in the console")
                d = Path(cwd) if cwd else cx.ROOT
                if not d.is_dir():
                    d = cx.ROOT
                extra = {"DISABLE_AUTOUPDATER": "1"}
                if tok:
                    extra["CLAUDE_CODE_OAUTH_TOKEN"] = tok
                if via == "axhub":
                    cargs = ["--mcp-config", json.dumps({"mcpServers": {"axHub": {"type": "http", "url": axhub_url()}}}), *cargs]
                tmux = local_tmux(tab_tmux)
                env = clean_env(extra)
                if tmux:  # the token reaches the tmux session through the environment of the command, never its command line
                    run = " ".join(shlex.quote(x) for x in [exe, *cargs])
                    argv = ["sh", "-c", tmux_script(tmux, run, str(d), cols, rows, env_keys=sorted(extra))]
                else:
                    argv = [exe, *cargs]
                be = PtyBackend(argv, str(d), env, cols, rows)
                where = "console" if tmux else None
                title, target, cwd = "Claude Code", ("axhub" if via == "axhub" else "console"), str(d)
            elif via == "vps":
                vps = st["vps"]
                if not vps.get("host") or not store.ssh_key().exists():
                    raise ValueError("set up the VPS tab first (Settings → Plugins → Terminal → VPS host: host + a key)")
                run = " ".join(shlex.quote(x) for x in ["claude", *cargs])
                remote = (f"cd -- {shlex.quote(cwd)} 2>/dev/null; " if cwd else "") + \
                    f"command -v claude >/dev/null 2>&1 || {{ echo 'Claude Code is not installed on the VPS host.'; exec \"${{SHELL:-bash}}\" -l; }}; exec {run}"
                if tab_tmux:
                    inner = f"command -v claude >/dev/null 2>&1 || {{ echo 'Claude Code is not installed on the VPS host.'; exec \"${{SHELL:-bash}}\" -l; }}; exec {run}"
                    remote = tmux_script(tab_tmux, inner, cwd, cols, rows, fallback=remote)
                    tmux, where = tab_tmux, "vps"
                be = PtyBackend(vps_argv(st, remote, tty=True), str(cx.ROOT), clean_env(), cols, rows)
                title, target, badge = "Claude Code", vps["host"], "HOST ROOT"
            elif via == "container":
                cs = plugin_services.get("axf.containers@1")
                if not cs:
                    raise PermissionError("Container access isn't installed or enabled")
                name = str(req.get("container") or "")
                entry = next((c for c in cs.list() if c["name"] == name), None)
                if not entry:
                    raise KeyError(f"no container named {name!r}")
                protected = bool(entry.get("protected"))
                if protected and not req.get("confirmProtected"):
                    raise PermissionError(f"{name} is protected ({entry['protected']['label']}): confirm to run Claude Code in it")
                run = " ".join(shlex.quote(x) for x in ["claude", *cargs])
                cmd = ["sh", "-c", f"command -v claude >/dev/null 2>&1 && exec {run} || {{ echo 'Claude Code is not installed in this container.'; "
                       "if command -v bash >/dev/null 2>&1; then exec bash -l; else exec sh -l; fi; }"]
                env = [f"CLAUDE_CODE_OAUTH_TOKEN={tok}"] if tok else []
                tty, c = cs.tty(name, actor={"kind": "user", "id": "console", "name": "Brett (terminal)"}, cwd=cwd, user=st["user"],
                                allow_protected=protected, cols=cols, rows=rows, command=cmd, env=env)
                be = TtyBackend(tty)
                title, target = "Claude Code", name
                badge = "PROTECTED" if protected else None
            else:
                raise ValueError("via is console, vps, container or axhub")
        else:
            raise ValueError("kind is console, container, vps or claude")
        s = Session(kind, title, target, cwd, be, mosh, badge, protected, tmux, where)
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
        store.log({"op": "open", "id": s.id, "kind": kind, "target": target, "cwd": cwd, "protected": protected, "mosh": mosh})
        return s

    def close(self, sid: str, reason: str = "closed") -> None:
        with self.lock:
            s = self.sessions.pop(sid, None)
        if not s or s.closed:
            return
        s.closed = True
        s.close_reason = reason
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
                if s.tmux and s.listeners:  # a persistent tab someone is watching: its link stays (the tmux session lives on anyway)
                    continue
                if now - s.last_input > st["idleMinutes"] * 60:  # output alone (top, tail -f) doesn't keep a terminal open
                    self.close(s.id, "idle")
                elif s.detached_at is not None:
                    keep = st["moshKeepMinutes"] * 60 if s.mosh else GRACE_SECONDS
                    if now - s.detached_at > keep:
                        self.close(s.id, "nobody attached")


MANAGER = Manager()


HEADLESS_RE = re.compile(r"^axf-[A-Za-z0-9._-]{1,64}$")
TAB_RE = re.compile(r"^axt-[A-Za-z0-9._-]{1,64}$")
TMUX_RE = re.compile(r"^ax[ft]-[A-Za-z0-9._-]{1,64}$")
REPLAY_LINES = 3000
MUX_DIR = os.environ.get("TMPDIR") or "/tmp"


def tmux_script(name: str, command: str, cwd: str, cols: int, rows: int, fallback: str = "", env_keys: list[str] | None = None) -> str:
    """Attach to tmux session `name`, creating it (running `command` in `cwd`) when it isn't there. An existing session
    first prints its pane's last REPLAY_LINES lines with their colours, so the browser's scrollback is whole again.
    `env_keys` are copied from this shell's environment into the new session (tmux -e, read from the environment, so
    a value never sits on a command line). Without tmux on that machine it runs `fallback` (or the command) as before."""
    q = shlex.quote(name)
    keys = [k for k in (env_keys or []) if re.fullmatch(r"[A-Z_][A-Z0-9_]*", k)]
    envs = " ".join(f"-e {k}=\"${k}\"" for k in keys)
    # env -u: a tmux server this starts must not keep these in its global environment (other tabs' shells would get them)
    unset = ("env " + " ".join(f"-u {k}" for k in keys) + " ") if keys else ""
    new = (f"{unset}tmux new-session -d -s {q} -x {max(10, min(cols, 500))} -y {max(5, min(rows, 300))}"
           + (f" -c {shlex.quote(cwd)}" if cwd else "") + (f" {envs}" if envs else "") + f" {shlex.quote(command)} || exit 1; "
           f"tmux set-option -t ={q} history-limit 50000 >/dev/null; tmux set-option -t ={q} status off >/dev/null; "
           f"tmux set-option -t ={q} @axf_kind tab >/dev/null")
    return (f"if ! command -v tmux >/dev/null 2>&1; then {fallback or 'exec ' + command}; fi; "
            f"if tmux has-session -t ={q} 2>/dev/null; then tmux capture-pane -p -e -J -S -{REPLAY_LINES} -t ={q} 2>/dev/null; else {new}; fi; "
            f"exec tmux attach -t ={q}")


def local_tmux(name: str) -> str | None:
    """The tab's tmux name when this console has tmux (Dockerfile installs it), else None (a plain pty, as before)."""
    return name if name and shutil.which("tmux") else None


def attach_commands(name: str | None, where: str | None) -> dict[str, str] | None:
    """How to attach the same session from a phone (Moshi) or any ssh client. A console tab's tmux lives in the console's
    container, so the command goes through docker exec on the host."""
    if not name or not TMUX_RE.match(name):
        return None
    vps = store.settings()["vps"]
    host = vps.get("host") or "<vps-host>"
    login = f"{vps.get('user') or 'root'}@{host}"
    port = int(vps.get("port") or 22)
    inner = f"tmux attach -t {name}"
    if where == "console":
        inner = f"docker exec -it {os.environ.get('HOSTNAME') or '<console-container>'} {inner}"
    ssh_port = f" -p {port}" if port != 22 else ""
    mosh_port = f" --ssh='ssh -p {port}'" if port != 22 else ""
    return {"mosh": f"mosh{mosh_port} {login} -- {inner}", "ssh": f"ssh -t{ssh_port} {login} {inner}", "tmux": inner}


def kill_tmux(name: str, where: str) -> dict[str, Any]:
    """End a tmux session for good (the tab's Kill session, after a confirm in the browser)."""
    if not TMUX_RE.match(name or ""):
        raise ValueError("not a terminal tmux session")
    cmd = f"tmux kill-session -t ={shlex.quote(name)}"
    if where == "console":
        r = RUNNER(["sh", "-c", cmd], capture_output=True, text=True, timeout=10, env=clean_env(), stdin=subprocess.DEVNULL)
    elif where == "vps":
        st = store.settings()
        if not st["vps"].get("host") or not store.ssh_key().exists():
            raise ValueError("the VPS tab isn't set up")
        r = RUNNER(vps_argv(st, cmd, tty=False), capture_output=True, text=True, timeout=15, env=clean_env(), stdin=subprocess.DEVNULL)
    else:
        raise ValueError("where is vps or console")
    _headless_cache["value"] = None
    store.log({"op": "kill", "tmux": name, "where": where, "ok": r.returncode == 0})
    if r.returncode != 0:
        raise KeyError(((r.stderr or "").strip().splitlines() or ["no such session"])[-1][:200])
    return {"ok": True, "name": name}


CLAUDE_FLAG = re.compile(r"^--?[A-Za-z][A-Za-z0-9-]*(=[^\x00]*)?$")


def claude_args(req: dict[str, Any]) -> list[str]:
    """Claude Code arguments from a tab's profile: model, permission mode, extra flags (each checked), a first prompt."""
    out: list[str] = []
    model = str(req.get("model") or "").strip()
    if model:
        if not re.fullmatch(r"[A-Za-z0-9._:-]{1,80}", model):
            raise ValueError("model is a model name")
        out += ["--model", model]
    mode = str(req.get("permissionMode") or "").strip()
    if mode:
        if mode not in ("default", "acceptEdits", "plan", "bypassPermissions"):
            raise ValueError("permissionMode is default, acceptEdits, plan or bypassPermissions")
        out += ["--permission-mode", mode]
    for f in req.get("flags") or []:
        f = str(f).strip()
        if not f:
            continue
        if not CLAUDE_FLAG.match(f) or len(f) > 300:
            raise ValueError(f"not a flag: {f[:40]}")
        out.append(f)
    prompt = str(req.get("prompt") or "").strip()
    if prompt:
        out.append(prompt[:4000])
    return out


def axhub_url() -> str:
    return os.environ.get("AXF_AXHUB_MCP_URL", "https://axhub.amberxai.com/mcp")


def vps_argv(st: dict[str, Any], remote: str, tty: bool) -> list[str]:
    """ssh to the VPS with the Terminal's own key (Settings → Plugins → Terminal → VPS host)."""
    vps = st["vps"]
    # the short status reads (tmux ls, meters every 2 s) share one connection; interactive tabs keep their own
    mux = [] if tty else ["-o", "ControlMaster=auto", "-o", f"ControlPath={MUX_DIR}/axf-term-%C", "-o", "ControlPersist=120"]
    return ["ssh", *(["-tt"] if tty else ["-T"]), *mux, "-i", str(store.ssh_key()), "-o", "IdentitiesOnly=yes", "-o", "StrictHostKeyChecking=accept-new",
            "-o", f"UserKnownHostsFile={store.data_dir() / 'ssh' / 'known_hosts'}", "-o", "ServerAliveInterval=30", "-o", "BatchMode=yes",
            "-o", "ConnectTimeout=8", "-p", str(vps.get("port") or 22), f"{vps.get('user') or 'root'}@{vps['host']}", remote]


_headless_cache: dict[str, Any] = {"at": 0.0, "value": None}
HEADLESS_TTL = 8.0
METER_TTL = 2.0
RUNNER: Any = subprocess.run  # replaced by the self-test
HEADLESS_DIR = "${AXF_HEADLESS_DIR:-/var/tmp/axf-headless}"  # on the VPS host (deploy/claude-headless.sh)
LS_FORMAT = "#{session_name}\t#{session_created}\t#{session_attached}\t#{@axf_kind}\t#{@axf_agent}\t#{@axf_model}\t#{@axf_cwd}"


def parse_ls(text: str) -> list[dict[str, Any]]:
    """`tmux ls -F LS_FORMAT` → the terminal's sessions (axf-… headless runs, axt-… tabs), oldest first. Pure."""
    items = []
    for ln in (text or "").splitlines():
        p = ln.split("\t")
        if not p or not TMUX_RE.match(p[0]):
            continue
        p += [""] * (7 - len(p))
        created = int(p[1]) * 1000 if p[1].isdigit() else 0
        kind = p[3] or ("headless" if p[0].startswith("axf-") else "tab")
        items.append({"name": p[0], "createdAt": created, "attached": int(p[2]) if p[2].isdigit() else 0, "kind": kind,
                      "agent": p[4] or (p[0][4:] if kind == "headless" else ""), "model": p[5], "cwd": p[6]})
    return sorted(items, key=lambda x: x["createdAt"])


def _vps_run(st: dict[str, Any], remote: str, timeout: int = 15) -> tuple[str, str]:
    """Run a short command on the VPS host; returns (stdout, why-it-failed)."""
    try:
        r = RUNNER(vps_argv(st, remote, tty=False), capture_output=True, text=True, timeout=timeout, env=clean_env(), stdin=subprocess.DEVNULL)
        if r.returncode == 0:
            return r.stdout or "", ""
        return "", ((r.stderr or "").strip().splitlines() or ["ssh failed"])[-1][:200]
    except (OSError, subprocess.TimeoutExpired) as e:
        return "", f"{type(e).__name__}: {e}"[:200]


def _vps_ready(st: dict[str, Any]) -> bool:
    return bool(st["vps"].get("host")) and store.ssh_key().exists()


def vps_tmux() -> dict[str, Any]:
    """Every axf-… / axt-… tmux session on the VPS. One ssh `tmux ls` at most every 8 s, whoever asks."""
    st = store.settings()
    if not _vps_ready(st):
        return {"ready": False, "items": [], "why": "the VPS tab isn't set up (Settings → Plugins → Terminal → VPS host)"}
    now = time.time()
    if _headless_cache["value"] is not None and now - _headless_cache["at"] < HEADLESS_TTL:
        return _headless_cache["value"]
    out, why = _vps_run(st, f"tmux ls -F {shlex.quote(LS_FORMAT)} 2>/dev/null || true")
    value = {"ready": not why, "items": [{**x, "where": "vps"} for x in parse_ls(out)][:80], "why": why}
    _headless_cache.update(at=now, value=value)
    return value


def headless_sessions() -> dict[str, Any]:
    """The headless Claude Code sessions running on the VPS: tmux sessions named axf-… (deploy/claude-headless.sh),
    with the agent and model the launcher tagged them with."""
    v = vps_tmux()
    return {**v, "items": [x for x in v["items"] if x["name"].startswith("axf-")][:40]}


def console_tmux() -> list[dict[str, Any]]:
    """The console's own persistent tabs (axt-… in this container's tmux)."""
    if not shutil.which("tmux"):
        return []
    try:
        r = RUNNER(["tmux", "ls", "-F", LS_FORMAT], capture_output=True, text=True, timeout=5, env=clean_env(), stdin=subprocess.DEVNULL)
    except (OSError, subprocess.TimeoutExpired):
        return []
    return [{**x, "where": "console"} for x in parse_ls(r.stdout if r.returncode == 0 else "")]


_meter_cache: dict[str, Any] = {"at": 0.0, "key": "", "value": None}


def meters(names: list[str]) -> dict[str, Any]:
    """The live meters (headless-meter@1) of these headless sessions, in one ssh call (cached 2 s). A session whose tmux
    has closed still answers from its meter file in the headless folder, so a finished tab keeps its final cost."""
    names = [n for n in names if HEADLESS_RE.match(n)][:40]
    st = store.settings()
    if not names or not _vps_ready(st):
        return {"ready": _vps_ready(st), "items": {}}
    key, now = ",".join(sorted(names)), time.time()
    if _meter_cache["value"] is not None and _meter_cache["key"] == key and now - _meter_cache["at"] < METER_TTL:
        return _meter_cache["value"]
    remote = (f'd="{HEADLESS_DIR}"; for s in {" ".join(shlex.quote(n) for n in names)}; do '
              'm="$(tmux show-options -t "=$s" -v @axf_meter 2>/dev/null)"; [ -n "$m" ] || m="$d/$s.meter.json"; '
              '[ -r "$m" ] && { printf "%s\t" "$s"; head -c 65536 "$m" | tr -d "\n"; echo; }; done; true')
    out, why = _vps_run(st, remote)
    items: dict[str, Any] = {}
    for ln in out.splitlines():
        n, _, js = ln.partition("\t")
        try:
            v = json.loads(js)
        except ValueError:
            continue
        if isinstance(v, dict) and n in names:
            items[n] = v
    value = {"ready": not why, "items": items, "why": why, "now": int(now * 1000)}
    _meter_cache.update(at=now, key=key, value=value)
    return value


def chain(name: str) -> dict[str, Any]:
    """A headless session's context chain (context-chain@1): the files it took in, in order, with their rules."""
    if not HEADLESS_RE.match(name or ""):
        raise ValueError("not a headless session")
    st = store.settings()
    if not _vps_ready(st):
        raise ValueError("the VPS tab isn't set up")
    q = shlex.quote(name)
    remote = (f'd="{HEADLESS_DIR}"; c="$(tmux show-options -t ={q} -v @axf_chain 2>/dev/null)"; [ -n "$c" ] || c="$d/{name}.chain.json"; '
              '[ -r "$c" ] && head -c 4000000 "$c"; true')
    out, why = _vps_run(st, remote, timeout=20)
    if why:
        raise OSError(why)
    try:
        v = json.loads(out) if out.strip() else None
    except ValueError:
        v = None
    return v if isinstance(v, dict) else {"$axf": "context-chain@1", "session": name, "version": 0, "items": []}
