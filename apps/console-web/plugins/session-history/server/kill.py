"""Live watch and kill for running headless / agent runs.

Watch: the run's live file is tailed from a byte offset (whole lines only), so the browser gets just the new events.
Kill: the run's process is found from what's known about it, most certain first:
  1. the agent-run@1 report's ``pid`` (checked: it must still be a Claude Code process)
  2. its ``tmux`` session (``axf-<slug>``, what deploy/claude-headless.sh starts) → ``tmux kill-session``
  3. a Claude Code process whose arguments name the session id (``--resume <id>`` / ``--session-id <id>``)
  4. the only Claude Code process running ``-p`` in the run's folder (two or more = refused, never a guess)
SIGTERM first, SIGKILL after a grace period when it's still there. Processes the console can't see (another machine,
outside its container) are reported, not guessed at.
"""
from __future__ import annotations

import os
import re
import signal
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from .runs import read_events

PROC = Path("/proc")
TMUX = re.compile(r"^axf-[A-Za-z0-9._-]{1,60}$")
GRACE = 5.0


def _argv(pid: int) -> list[str]:
    try:
        return [a for a in (PROC / str(pid) / "cmdline").read_bytes().decode("utf-8", "replace").split("\0") if a]
    except OSError:
        return []


def _cwd(pid: int) -> str:
    try:
        return os.readlink(PROC / str(pid) / "cwd")
    except OSError:
        return ""


def is_claude(argv: list[str]) -> bool:
    if not argv:
        return False
    first = os.path.basename(argv[0])
    if first.startswith("claude") and not first.endswith((".sh", ".mjs", ".py")):
        return True  # claude, claude-build …
    return first in ("node", "bun") and len(argv) > 1 and ("@anthropic-ai/claude-code" in argv[1] or os.path.basename(argv[1]) == "claude")


def processes() -> list[dict[str, Any]]:
    out = []
    try:
        pids = [int(p.name) for p in PROC.iterdir() if p.name.isdigit()]
    except OSError:
        return out
    for pid in pids:
        argv = _argv(pid)
        if is_claude(argv):
            out.append({"pid": pid, "argv": argv, "cwd": _cwd(pid)})
    return out


def find_target(run: dict[str, Any], procs: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    """→ {how: 'pid'|'tmux'|'session'|'folder', pid?, tmux?} or {error}."""
    procs = processes() if procs is None else procs
    pid = run.get("pid")
    if isinstance(pid, int) and pid > 1:
        if any(p["pid"] == pid for p in procs):
            return {"how": "pid", "pid": pid}
        if not run.get("tmux"):
            return {"error": f"process {pid} from the report isn't a running Claude Code process here"}
    tm = run.get("tmux")
    if isinstance(tm, str) and TMUX.match(tm):
        return {"how": "tmux", "tmux": tm}
    sid = run.get("id") or ""
    named = [p for p in procs if sid and sid in p["argv"]]
    if len(named) == 1:
        return {"how": "session", "pid": named[0]["pid"]}
    cwd = (run.get("cwd") or "").rstrip("/")
    here = [p for p in procs if cwd and p["cwd"].rstrip("/") == cwd and ("-p" in p["argv"] or "--print" in p["argv"])]
    if len(here) == 1:
        return {"how": "folder", "pid": here[0]["pid"]}
    if len(here) > 1:
        return {"error": f"{len(here)} headless Claude Code processes run in {cwd}; not guessing which one"}
    return {"error": "no Claude Code process for this run is visible from the console (another machine, or outside its container)"}


def _term(pid: int, wait: float = GRACE, sleep: Callable[[float], None] = time.sleep) -> None:
    try:
        os.kill(pid, signal.SIGTERM)
    except ProcessLookupError:
        return

    def later() -> None:
        sleep(wait)
        try:
            os.kill(pid, signal.SIGKILL)
        except (ProcessLookupError, PermissionError):
            pass
    threading.Thread(target=later, daemon=True).start()


def kill(target: dict[str, Any]) -> dict[str, Any]:
    if target.get("how") == "tmux":
        try:
            p = subprocess.run(["tmux", "kill-session", "-t", f"={target['tmux']}"], capture_output=True, text=True, timeout=10)
        except (OSError, subprocess.SubprocessError) as e:
            return {"ok": False, "error": f"tmux: {e}"}
        return {"ok": p.returncode == 0, "error": (p.stderr or "").strip()[:200] or None}
    pid = target.get("pid")
    if not isinstance(pid, int) or pid <= 1:
        return {"ok": False, "error": "no process"}
    try:
        _term(pid)
    except PermissionError:
        return {"ok": False, "error": f"not allowed to stop process {pid}"}
    return {"ok": True}


def live_file(run: dict[str, Any]) -> str | None:
    f = run.get("files") or {}
    return f.get("stream") or f.get("transcript")


def tail(path: str, offset: int, back: int = 48 * 1024) -> dict[str, Any]:
    """New events of a live file since ``offset``; offset < 0 = start ``back`` bytes before the end (on a line)."""
    p = Path(path)
    try:
        size = p.stat().st_size
    except OSError:
        return {"offset": 0, "events": [], "size": 0}
    if offset < 0 or offset > size:
        start = max(0, size - back)
        if start:
            with p.open("rb") as f:
                f.seek(start)
                f.readline()  # skip to the next whole line
                start = f.tell()
        offset = start
    events, nxt = read_events(p, offset, 2 * 1024 * 1024)
    slim = [{k: e[k] for k in ("at", "role", "kind", "text", "tool", "input", "isError", "sidechain", "label") if e.get(k) not in (None, "", False)} for e in events]
    return {"offset": nxt, "events": slim[-400:], "size": size}

