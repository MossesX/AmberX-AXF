#!/usr/bin/env python3
"""Maintenance engine (maintenance@1): server health and safe clean-up for the VPS. Standard library only.

The same file runs in two places:

- **On the VPS host** (as root, from cron every 5 minutes; installed by ``deploy/host.sh``): ``snapshot`` measures disk,
  memory, swap, load, Docker (images, volumes, build cache, containers), build worktrees, logs and /tmp, works out what
  every clean-up job would remove (the preview) and writes it to the plugin's data folder, which the console reads.
  ``run <id> --sha <hex>`` executes one approved clean-up plan. It is only ever started by axHub's ``vps.run`` after
  Brett approved the held call, and it never trusts the plan alone: every item is planned again on the spot and removed
  only if it is still in the approved plan *and* still passes every safety rule now.
- **In the console container** (imported by ``server/__init__.py``): the pure parts (thresholds, alert levels, plan
  files, job catalog, a reduced snapshot from what the container can see).

Never touched, by any job: running or paused containers, Docker volumes (none of the jobs removes a volume), app data,
anything outside the allowed roots, symlinks, open files, the working folder of a running process, a build that still
has a tmux session, and a worktree with uncommitted or unpushed work.

    python3 maint.py snapshot [--out FILE] [--json]      measure + preview every job (default out: <data>/snapshot.json)
    python3 maint.py preview --jobs docker,logs [--json] what those jobs would remove right now
    python3 maint.py run <plan-id> --sha <hex>           execute an approved plan from <data>/plans/<id>.json
    python3 maint.py jobs                                the job catalog
"""
from __future__ import annotations

import argparse
import datetime as _dt
import hashlib
import json
import os
import re
import shutil
import socket
import stat
import subprocess
import sys
import time
from pathlib import Path
from typing import Any, Callable, Iterable

SCHEMA = "maintenance@1"
HERE = Path(__file__).resolve().parent
PLUGIN_DIR = HERE.parent
FOLDER = PLUGIN_DIR.name
REPO_ROOT = Path(os.environ.get("AXF_ROOT") or PLUGIN_DIR.parents[3])
DATA_DIR = Path(os.environ.get("AXF_MAINT_DATA_DIR") or REPO_ROOT / ".axf-console" / "plugins" / FOLDER)

GB = 1024 ** 3

# ------------------------------------------------------------------ settings

DEFAULTS: dict[str, Any] = {
    "diskWarnPct": 80,        # alert levels (warning / error / critical)
    "diskHighPct": 85,
    "diskCriticalPct": 90,
    "swapFullPct": 90,        # swap counts as "nearly full" at or above this
    "swapMinutes": 15,        # ... for this long before it alerts
    "nightly": False,         # nightly auto-clean (safe jobs only); off by default
    "nightlyHour": 3,         # local hour on the console server
    "nightlyJobs": ["docker", "logs", "tmp", "created"],
    "logDays": 14,            # rotated logs and old build logs older than this
    "journalDays": 14,        # systemd journal kept for this long
    "tmpDays": 7,             # /tmp and /var/tmp entries untouched for this long
    "worktreeIdleHours": 24,  # a build worktree must be idle this long
    "createdHours": 1,        # a container stuck in "Created" for this long
    "buildCacheHours": 24,    # Docker build cache unused for this long
}

LIMITS: dict[str, tuple[float, float]] = {
    "diskWarnPct": (50, 99), "diskHighPct": (50, 99), "diskCriticalPct": (50, 99), "swapFullPct": (50, 100),
    "swapMinutes": (1, 1440), "nightlyHour": (0, 23), "logDays": (1, 365), "journalDays": (1, 365), "tmpDays": (1, 365),
    "worktreeIdleHours": (1, 24 * 90), "createdHours": (1, 24 * 30), "buildCacheHours": (1, 24 * 90),
}


def normalize_settings(raw: Any) -> dict[str, Any]:
    """Saved settings over the defaults, each value checked; unknown keys dropped. Levels stay in order."""
    out = dict(DEFAULTS)
    if not isinstance(raw, dict):
        return out
    for k, v in raw.items():
        if k not in DEFAULTS:
            continue
        if k == "nightly":
            out[k] = bool(v)
        elif k == "nightlyJobs":
            if isinstance(v, list):
                out[k] = [j for j in dict.fromkeys(str(x) for x in v) if j in JOBS and JOBS[j]["safe"]]
        elif isinstance(v, (int, float)) and not isinstance(v, bool):
            lo, hi = LIMITS[k]
            out[k] = int(min(hi, max(lo, v)))
    warn, high, crit = sorted([out["diskWarnPct"], out["diskHighPct"], out["diskCriticalPct"]])
    out.update(diskWarnPct=warn, diskHighPct=high, diskCriticalPct=crit)
    return out


def read_json(p: Path, default: Any = None) -> Any:
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def write_json(p: Path, value: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f".{p.name}.{os.getpid()}.tmp")
    tmp.write_text(json.dumps(value, indent=1, sort_keys=False))
    os.replace(tmp, p)


def load_settings(data_dir: Path = DATA_DIR) -> dict[str, Any]:
    return normalize_settings(read_json(data_dir / "settings.json", {}))


# ------------------------------------------------------------------ jobs

JOBS: dict[str, dict[str, Any]] = {
    "worktrees": {"label": "Finished build worktrees", "safe": False, "icon": "branch",
                  "what": "Build folders in /root/axf-builds and /home/axfbuild/wt-* whose branch is merged into main or "
                          "fully pushed, with no running tmux session or process and idle for the set hours. A worktree "
                          "with uncommitted or unpushed work is always kept. Build logs and briefs are moved to "
                          "/root/axf-builds/_archive first."},
    "docker": {"label": "Dangling Docker images and build cache", "safe": True, "icon": "box",
               "what": "Untagged (dangling) images no container uses, and build cache unused for the set hours. "
                       "Never volumes, tagged images or anything a container uses."},
    "logs": {"label": "Old logs", "safe": True, "icon": "file",
             "what": "Rotated logs in /var/log (.gz, .1, .old) and build logs older than the set days, and the systemd "
                     "journal beyond the set days. Never a log a process has open."},
    "tmp": {"label": "/tmp leftovers", "safe": True, "icon": "trash",
            "what": "Entries in /tmp and /var/tmp untouched for the set days. Never sockets, open files, the working "
                    "folder of a running process, or system folders (systemd-private, X11, tmux, snap)."},
    "created": {"label": "Containers stuck in Created", "safe": True, "icon": "alert",
                "what": "Containers that were created but never started, older than the set hours. Running, paused, "
                        "restarting and exited containers are never touched."},
}
SAFE_JOBS = [j for j, d in JOBS.items() if d["safe"]]


def job_catalog() -> list[dict[str, Any]]:
    return [{"id": j, **d} for j, d in JOBS.items()]


# ------------------------------------------------------------------ alert levels (pure)

def disk_level(pct: float | None, s: dict[str, Any]) -> str:
    """ok | warning (80) | error (85) | critical (90), with the saved thresholds."""
    if pct is None:
        return "unknown"
    if pct >= s["diskCriticalPct"]:
        return "critical"
    if pct >= s["diskHighPct"]:
        return "error"
    if pct >= s["diskWarnPct"]:
        return "warning"
    return "ok"


def swap_state(pct: float | None, high_since: float | None, now: float, s: dict[str, Any]) -> tuple[float | None, bool]:
    """Tracks how long swap has been nearly full → (new high_since, alert?). No swap = never alerts."""
    if pct is None or pct < s["swapFullPct"]:
        return None, False
    since = high_since if high_since is not None else now
    return since, (now - since) >= s["swapMinutes"] * 60


LEVEL_RANK = {"unknown": 0, "ok": 0, "warning": 1, "error": 2, "critical": 3}


# ------------------------------------------------------------------ small helpers

def human(n: float | int | None) -> str:
    if n is None:
        return "?"
    n = float(n)
    for unit in ("B", "KB", "MB", "GB", "TB"):
        if abs(n) < 1024 or unit == "TB":
            return f"{n:.0f} {unit}" if unit in ("B", "KB") else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} TB"


_SIZE = re.compile(r"^\s*([0-9.]+)\s*([kKMGTP]?i?B|B)?\s*$")
_MULT = {"B": 1, "KB": 1000, "MB": 1000 ** 2, "GB": 1000 ** 3, "TB": 1000 ** 4, "PB": 1000 ** 5,
         "KIB": 1024, "MIB": 1024 ** 2, "GIB": 1024 ** 3, "TIB": 1024 ** 4}


def parse_size(text: str | None) -> int:
    """Docker's sizes ("1.2GB", "512MB", "0B", "3.4GB (40%)") → bytes."""
    if not text:
        return 0
    m = _SIZE.match(str(text).split("(")[0])
    if not m:
        return 0
    return int(float(m.group(1)) * _MULT.get((m.group(2) or "B").upper(), 1))


def now_iso(t: float | None = None) -> str:
    return _dt.datetime.fromtimestamp(time.time() if t is None else t, _dt.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


Runner = Callable[[list[str], int], tuple[int, str]]


def _run(cmd: list[str], timeout: int = 60) -> tuple[int, str]:
    try:
        p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout)
        return p.returncode, (p.stdout or "") + (p.stderr if p.returncode else "")
    except (OSError, subprocess.TimeoutExpired) as e:
        return 127, f"{type(e).__name__}: {e}"


def du(path: Path, run: Runner = _run) -> int:
    """Bytes under a path (du -sxb, one filesystem), 0 when unreadable."""
    code, out = run(["du", "-sxb", str(path)], 120)
    if code == 0 and out.strip():
        try:
            return int(out.split()[0])
        except ValueError:
            pass
    total = 0
    for root, dirs, files in os.walk(path, onerror=lambda e: None):
        for f in files:
            try:
                total += os.lstat(os.path.join(root, f)).st_size
            except OSError:
                pass
    return total


def isdir(p: Path) -> bool:
    """Path.is_dir() that answers False instead of raising on a folder this user can't read (Python 3.12)."""
    try:
        return p.is_dir()
    except OSError:
        return False


def inside(path: Path, roots: Iterable[Path]) -> bool:
    """True when path (not followed if it is a link) sits strictly inside one of the roots."""
    try:
        p = Path(os.path.abspath(path))
    except (OSError, ValueError):
        return False
    for r in roots:
        r = Path(os.path.abspath(r))
        if p != r and str(p).startswith(str(r) + os.sep):
            return True
    return False


def open_paths() -> tuple[set[str], set[str]]:
    """Files any process has open, and every process's working folder (from /proc)."""
    files: set[str] = set()
    cwds: set[str] = set()
    proc = Path("/proc")
    if not proc.is_dir():
        return files, cwds
    for pid in proc.iterdir():
        if not pid.name.isdigit():
            continue
        try:
            cwds.add(os.readlink(pid / "cwd"))
        except OSError:
            pass
        try:
            for fd in (pid / "fd").iterdir():
                try:
                    t = os.readlink(fd)
                    if t.startswith("/"):
                        files.add(t.removesuffix(" (deleted)"))
                except OSError:
                    pass
        except OSError:
            pass
    return files, cwds


def busy(path: Path, files: set[str], cwds: set[str]) -> bool:
    """Something open under path, or a process working inside it."""
    p = str(path)
    pre = p + os.sep
    return any(f == p or f.startswith(pre) for f in files) or any(c == p or c.startswith(pre) for c in cwds)


def newest_mtime(path: Path, depth: int = 2, limit: int = 4000) -> float:
    """Latest mtime of a path and what's under it, a few levels deep (bounded, links not followed)."""
    try:
        best = os.lstat(path).st_mtime
    except OSError:
        return 0.0
    if not isdir(path) or path.is_symlink():
        return best
    seen = 0
    stack = [(path, 0)]
    while stack and seen < limit:
        d, lvl = stack.pop()
        try:
            with os.scandir(d) as it:
                for e in it:
                    seen += 1
                    try:
                        st = e.stat(follow_symlinks=False)
                    except OSError:
                        continue
                    best = max(best, st.st_mtime)
                    if lvl + 1 < depth and e.is_dir(follow_symlinks=False) and e.name not in ("node_modules", ".git"):
                        stack.append((Path(e.path), lvl + 1))
        except OSError:
            continue
    return best


# ------------------------------------------------------------------ measurements

def meminfo(text: str | None = None) -> dict[str, Any]:
    if text is None:
        try:
            text = Path("/proc/meminfo").read_text()
        except OSError:
            return {}
    kv = {}
    for ln in text.splitlines():
        parts = ln.split()
        if len(parts) >= 2 and parts[1].isdigit():
            kv[parts[0].rstrip(":")] = int(parts[1]) * 1024
    total, avail = kv.get("MemTotal", 0), kv.get("MemAvailable", kv.get("MemFree", 0))
    st, sf = kv.get("SwapTotal", 0), kv.get("SwapFree", 0)
    return {
        "memory": {"total": total, "available": avail, "used": max(0, total - avail), "pct": round((total - avail) / total * 100, 1) if total else None},
        "swap": {"total": st, "used": max(0, st - sf), "pct": round((st - sf) / st * 100, 1) if st else None},
    }


def disk(path: str = "/") -> dict[str, Any]:
    try:
        u = shutil.disk_usage(path)
    except OSError:
        return {"path": path, "total": None, "used": None, "free": None, "pct": None}
    return {"path": path, "total": u.total, "used": u.used, "free": u.free, "pct": round(u.used / u.total * 100, 1) if u.total else None}


def load() -> dict[str, Any]:
    try:
        one, five, fifteen = os.getloadavg()
    except OSError:
        return {}
    return {"1": round(one, 2), "5": round(five, 2), "15": round(fifteen, 2), "cpus": os.cpu_count() or 1}


def basic(disk_path: str = "/") -> dict[str, Any]:
    """What any place can measure: disk, memory, swap, load (the console container sees the host's)."""
    return {"disk": disk(disk_path), **meminfo(), "load": load()}


def _jsonl(text: str) -> list[dict[str, Any]]:
    out = []
    for ln in text.splitlines():
        ln = ln.strip()
        if ln.startswith("{"):
            try:
                out.append(json.loads(ln))
            except ValueError:
                pass
    return out


def docker_info(run: Runner = _run) -> dict[str, Any]:
    """Images, containers, volumes and build cache from `docker system df` (sizes as bytes)."""
    if not shutil.which("docker") and run is _run:
        return {"available": False}
    code, out = run(["docker", "system", "df", "--format", "{{json .}}"], 60)
    if code != 0:
        return {"available": False, "error": out.strip()[-200:]}
    info: dict[str, Any] = {"available": True}
    names = {"Images": "images", "Containers": "containers", "Local Volumes": "volumes", "Build Cache": "buildCache"}
    for row in _jsonl(out):
        k = names.get(row.get("Type", ""))
        if k:
            info[k] = {"count": int(str(row.get("TotalCount") or 0) or 0), "active": int(str(row.get("Active") or 0) or 0),
                       "size": parse_size(row.get("Size")), "reclaimable": parse_size(row.get("Reclaimable"))}
    return info


# ------------------------------------------------------------------ the host's roots

def build_roots() -> list[Path]:
    env = os.environ.get("AXF_MAINT_BUILD_ROOTS")
    if env:
        return [Path(p) for p in env.split(":") if p]
    return [Path("/root/axf-builds"), Path("/home/axfbuild")]


def tmp_roots() -> list[Path]:
    env = os.environ.get("AXF_MAINT_TMP_ROOTS")
    return [Path(p) for p in env.split(":") if p] if env else [Path("/tmp"), Path("/var/tmp")]


def log_roots() -> list[Path]:
    env = os.environ.get("AXF_MAINT_LOG_ROOTS")
    return [Path(p) for p in env.split(":") if p] if env else [Path("/var/log")]


AREAS = (("Logs (/var/log)", "/var/log"), ("/tmp", "/tmp"), ("/var/tmp", "/var/tmp"), ("Build worktrees", "/root/axf-builds"),
         ("axfbuild home", "/home/axfbuild"), ("Root home", "/root"), ("/opt", "/opt"))


def area_list() -> list[tuple[str, str]]:
    """The folders measured for "biggest space users" (AXF_MAINT_AREAS = label=path,label=path overrides them)."""
    env = os.environ.get("AXF_MAINT_AREAS")
    if env:
        return [tuple(x.split("=", 1)) for x in env.split(",") if "=" in x]  # type: ignore[misc]
    return list(AREAS)


def worktree_dirs(roots: list[Path]) -> list[Path]:
    """/root/axf-builds/<build> and /home/axfbuild/wt-* (never _archive, hidden folders or the home itself)."""
    out = []
    for r in roots:
        if not isdir(r):
            continue
        only_wt = r.name == "axfbuild"
        try:
            for e in sorted(r.iterdir()):
                if e.is_symlink() or not e.is_dir() or e.name.startswith((".", "_")):
                    continue
                if only_wt and not e.name.startswith("wt-"):
                    continue
                out.append(e)
        except OSError:
            continue
    return out


# ------------------------------------------------------------------ planning: what each job would remove

TMP_KEEP = re.compile(r"^(systemd-private-.*|\.X11-unix|\.ICE-unix|\.font-unix|\.XIM-unix|\.Test-unix|tmux-\d+|snap-private-tmp|"
                      r"\.s\.PGSQL\..*|ssh-.*|pulse-.*|crontab\..*|axf-.*\.lock)$")
ROTATED = re.compile(r"(\.gz|\.xz|\.bz2|\.zst|\.old|\.\d+|\.\d+\.log|-\d{8})$")


class Ctx:
    """What planning needs from the machine; tests swap the parts."""

    def __init__(self, s: dict[str, Any], run: Runner = _run, now: float | None = None):
        self.s = s
        self.run = run
        self.now = time.time() if now is None else now
        self.files, self.cwds = open_paths()
        self._tmux: set[str] | None = None

    def tmux_sessions(self) -> set[str]:
        if self._tmux is None:
            code, out = self.run(["tmux", "ls", "-F", "#{session_name}"], 10)
            self._tmux = set(out.split()) if code == 0 else set()
        return self._tmux


def _item(job: str, ref: str, size: int | None, why: str, **extra: Any) -> dict[str, Any]:
    return {"id": f"{job}:{ref}", "job": job, "ref": ref, "size": size, "why": why, **extra}


def _git(ctx: Ctx, wt: Path, *args: str) -> tuple[int, str]:
    return ctx.run(["git", "-C", str(wt), *args], 30)


def worktree_state(ctx: Ctx, wt: Path) -> tuple[str, str]:
    """(state, why): active | recent | dirty | unpushed | finished | merged."""
    name = wt.name
    if f"axf-{name}" in ctx.tmux_sessions() or name in ctx.tmux_sessions():
        return "active", "its tmux session is running"
    if busy(wt, ctx.files, ctx.cwds):
        return "active", "a process is working inside it"
    idle_h = (ctx.now - newest_mtime(wt)) / 3600
    if idle_h < ctx.s["worktreeIdleHours"]:
        return "recent", f"changed {idle_h:.0f} h ago (needs {ctx.s['worktreeIdleHours']} h idle)"
    if not (wt / ".git").exists():
        return "finished", f"no git checkout, idle {idle_h:.0f} h"
    code, out = _git(ctx, wt, "status", "--porcelain", "--untracked-files=normal")
    if code != 0:
        return "dirty", "git status failed, kept to be safe"
    changes = [ln for ln in out.splitlines() if ln.strip() and not re.search(r"(\.log|\.brief\.md|\.out)$", ln.strip())]
    if changes:
        return "dirty", f"{len(changes)} uncommitted change(s)"
    _git(ctx, wt, "fetch", "--quiet", "origin", "main")
    if _git(ctx, wt, "merge-base", "--is-ancestor", "HEAD", "origin/main")[0] == 0:
        return "merged", f"merged into main, idle {idle_h:.0f} h"
    code, out = _git(ctx, wt, "rev-list", "--count", "@{upstream}..HEAD")
    if code != 0:
        return "unpushed", "its branch has no upstream, kept to be safe"
    if out.strip() != "0":
        return "unpushed", f"{out.strip()} commit(s) not pushed"
    return "finished", f"fully pushed, idle {idle_h:.0f} h"


def plan_worktrees(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items, kept = [], []
    for wt in worktree_dirs(build_roots()):
        state, why = worktree_state(ctx, wt)
        size = du(wt, ctx.run)
        row = {"path": str(wt), "name": wt.name, "size": size, "state": state, "why": why}
        if state in ("merged", "finished"):
            items.append(_item("worktrees", str(wt), size, why, path=str(wt)))
        else:
            kept.append(row)
    return items, kept


def plan_docker(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    code, out = ctx.run(["docker", "images", "--filter", "dangling=true", "--no-trunc", "--format", "{{json .}}"], 60)
    if code == 0:
        used = set()
        c2, o2 = ctx.run(["docker", "ps", "-a", "--no-trunc", "--format", "{{.Image}}"], 30)
        if c2 == 0:
            used = {ln.strip() for ln in o2.splitlines() if ln.strip()}
        for row in _jsonl(out):
            iid = str(row.get("ID") or "")
            if not re.match(r"^(sha256:)?[0-9a-f]{12,64}$", iid) or iid in used or iid.removeprefix("sha256:") in used:
                continue
            items.append(_item("docker", iid, parse_size(row.get("Size")), f"dangling image, created {row.get('CreatedSince') or row.get('CreatedAt') or '?'}",
                               kind="image"))
    info = docker_info(ctx.run)
    cache = (info.get("buildCache") or {}).get("reclaimable") or 0
    if cache:
        items.append(_item("docker", "build-cache", cache, f"build cache unused for {ctx.s['buildCacheHours']} h or more (up to this much)",
                           kind="build-cache", approx=True))
    return items, []


def plan_logs(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    cutoff = ctx.now - ctx.s["logDays"] * 86400
    for root in log_roots():
        for dirpath, dirnames, filenames in os.walk(root, onerror=lambda e: None):
            dirnames[:] = [d for d in dirnames if d != "journal"]
            for f in filenames:
                p = Path(dirpath) / f
                try:
                    st = os.lstat(p)
                except OSError:
                    continue
                if not stat.S_ISREG(st.st_mode) or not ROTATED.search(f) or st.st_mtime > cutoff or str(p) in ctx.files:
                    continue
                items.append(_item("logs", str(p), st.st_size, f"rotated log, {int((ctx.now - st.st_mtime) / 86400)} days old", path=str(p)))
    for wt in worktree_dirs(build_roots()):
        try:
            for p in wt.glob("*.log"):
                st = os.lstat(p)
                if stat.S_ISREG(st.st_mode) and st.st_mtime < cutoff and str(p) not in ctx.files:
                    items.append(_item("logs", str(p), st.st_size, f"build log, {int((ctx.now - st.st_mtime) / 86400)} days old", path=str(p)))
        except OSError:
            continue
    code, out = ctx.run(["journalctl", "--disk-usage"], 20)
    m = re.search(r"take up ([0-9.]+\s*[KMGT]?)B?", out) if code == 0 else None
    if m:
        used = parse_size(m.group(1).replace(" ", "") + "iB") if m.group(1)[-1:].isalpha() else int(float(m.group(1)))
        if used > 200 * 1024 ** 2:
            items.append(_item("logs", "journal", None, f"systemd journal ({human(used)}) older than {ctx.s['journalDays']} days", kind="journal", approx=True))
    return items, []


def plan_tmp(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items, kept = [], []
    cutoff = ctx.now - ctx.s["tmpDays"] * 86400
    for root in tmp_roots():
        try:
            entries = sorted(root.iterdir())
        except OSError:
            continue
        for e in entries:
            try:
                st = os.lstat(e)
            except OSError:
                continue
            if TMP_KEEP.match(e.name) or stat.S_ISLNK(st.st_mode) or stat.S_ISSOCK(st.st_mode) or stat.S_ISFIFO(st.st_mode):
                continue
            if busy(e, ctx.files, ctx.cwds):
                kept.append({"path": str(e), "why": "in use"})
                continue
            m = newest_mtime(e, depth=3)
            if m > cutoff:
                continue
            size = du(e, ctx.run) if stat.S_ISDIR(st.st_mode) else st.st_size
            items.append(_item("tmp", str(e), size, f"untouched for {int((ctx.now - m) / 86400)} days", path=str(e)))
    return items, kept


def plan_created(ctx: Ctx) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    items: list[dict[str, Any]] = []
    code, out = ctx.run(["docker", "ps", "-a", "--filter", "status=created", "--no-trunc", "--format", "{{json .}}"], 30)
    if code != 0:
        return items, []
    for row in _jsonl(out):
        cid = str(row.get("ID") or "")
        if not re.match(r"^[0-9a-f]{12,64}$", cid):
            continue
        created = _parse_docker_time(str(row.get("CreatedAt") or ""))
        if created and ctx.now - created < ctx.s["createdHours"] * 3600:
            continue
        items.append(_item("created", cid, 0, f"{row.get('Names') or cid[:12]} ({row.get('Image') or '?'}) created {row.get('RunningFor') or '?'}, never started",
                           name=str(row.get("Names") or "")))
    return items, []


def _parse_docker_time(text: str) -> float | None:
    m = re.match(r"(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d) ([+-]\d{4})", text)
    if not m:
        return None
    try:
        return _dt.datetime.strptime(f"{m.group(1)} {m.group(2)}", "%Y-%m-%d %H:%M:%S %z").timestamp()
    except ValueError:
        return None


PLANNERS: dict[str, Callable[[Ctx], tuple[list[dict[str, Any]], list[dict[str, Any]]]]] = {
    "worktrees": plan_worktrees, "docker": plan_docker, "logs": plan_logs, "tmp": plan_tmp, "created": plan_created,
}


def plan(ctx: Ctx, jobs: Iterable[str]) -> dict[str, dict[str, Any]]:
    out = {}
    for j in jobs:
        if j not in PLANNERS:
            continue
        try:
            items, kept = PLANNERS[j](ctx)
            out[j] = {"items": items, "kept": kept, "bytes": sum(i["size"] or 0 for i in items), "count": len(items)}
        except Exception as e:  # noqa: BLE001 — one job's failure never hides the others
            out[j] = {"items": [], "kept": [], "bytes": 0, "count": 0, "error": f"{type(e).__name__}: {e}"[:300]}
    return out


# ------------------------------------------------------------------ the full snapshot (host)

def biggest(rows: list[dict[str, Any]], n: int = 12) -> list[dict[str, Any]]:
    return sorted([r for r in rows if r.get("size")], key=lambda r: -r["size"])[:n]


def snapshot(s: dict[str, Any] | None = None, run: Runner = _run) -> dict[str, Any]:
    s = s or load_settings()
    t0 = time.time()
    snap: dict[str, Any] = {"$axf": SCHEMA, "at": now_iso(), "host": socket.gethostname(), "source": "host", **basic("/")}
    snap["docker"] = docker_info(run)
    ctx = Ctx(s, run)
    snap["candidates"] = plan(ctx, JOBS)
    wts = []
    for wt in worktree_dirs(build_roots()):
        cand = next((i for i in snap["candidates"]["worktrees"]["items"] if i["ref"] == str(wt)), None)
        kept = next((k for k in snap["candidates"]["worktrees"]["kept"] if k["path"] == str(wt)), None)
        row = {"name": wt.name, "path": str(wt), "size": (cand or kept or {}).get("size") or 0,
               "state": "removable" if cand else (kept or {}).get("state", "?"), "why": (cand or kept or {}).get("why", "")}
        wts.append(row)
    snap["builds"] = {"roots": [str(r) for r in build_roots()], "count": len(wts), "size": sum(w["size"] for w in wts), "items": wts}
    areas = []
    for label, path in area_list():
        p = Path(path)
        if isdir(p):
            areas.append({"label": label, "path": path, "size": du(p, run)})
    snap["logs"] = {"size": next((a["size"] for a in areas if a["path"] == "/var/log"), 0)}
    snap["tmp"] = {"size": sum(a["size"] for a in areas if a["path"] in ("/tmp", "/var/tmp"))}
    rows = [{"kind": "area", **a} for a in areas] + [{"kind": "worktree", "label": w["name"], "path": w["path"], "size": w["size"]} for w in wts]
    for k, lbl in (("images", "Docker images"), ("volumes", "Docker volumes"), ("buildCache", "Docker build cache")):
        v = snap["docker"].get(k) or {}
        if v.get("size"):
            rows.append({"kind": "docker", "label": lbl, "path": f"docker:{k}", "size": v["size"], "reclaimable": v.get("reclaimable")})
    snap["biggest"] = biggest(rows)
    snap["tookMs"] = int((time.time() - t0) * 1000)
    return snap


# ------------------------------------------------------------------ plans (console writes, host runs)

def plan_sha(p: dict[str, Any]) -> str:
    """Fingerprint of what was approved: the run id, the jobs and the item ids (order-free)."""
    body = json.dumps({"id": p["id"], "jobs": sorted(p["jobs"]), "items": sorted(i["id"] for i in p["items"])}, sort_keys=True)
    return hashlib.sha256(body.encode()).hexdigest()[:16]


def make_plan(run_id: str, jobs: list[str], candidates: dict[str, Any], only: list[str] | None = None, by: str = "console",
              kind: str = "manual") -> dict[str, Any]:
    jobs = [j for j in dict.fromkeys(jobs) if j in JOBS]
    items = [i for j in jobs for i in (candidates.get(j) or {}).get("items", [])]
    if only:
        keep = set(only)
        items = [i for i in items if i["id"] in keep]
    p = {"$axf": SCHEMA, "id": run_id, "at": now_iso(), "by": by, "kind": kind, "jobs": jobs, "items": items,
         "bytes": sum(i.get("size") or 0 for i in items), "count": len(items)}
    p["sha"] = plan_sha(p)
    return p


RUN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{5,63}$")


def _remove_path(p: Path, roots: list[Path], files: set[str], cwds: set[str]) -> int:
    if not inside(p, roots):
        raise PermissionError(f"{p} is outside the allowed folders")
    st = os.lstat(p)
    if stat.S_ISLNK(st.st_mode):
        raise PermissionError("symlinks are never removed")
    if busy(p, files, cwds):
        raise PermissionError("in use right now")
    size = du(p) if stat.S_ISDIR(st.st_mode) else st.st_size
    if stat.S_ISDIR(st.st_mode):
        shutil.rmtree(p)
    else:
        p.unlink()
    return size


def _archive_build_notes(wt: Path) -> None:
    dest = wt.parent / "_archive" / wt.name if wt.parent.name == "axf-builds" else Path("/root/axf-builds/_archive") / wt.name
    for f in list(wt.glob("*.log")) + list(wt.glob(".brief.md")):
        try:
            dest.mkdir(parents=True, exist_ok=True)
            shutil.copy2(f, dest / f.name)
        except OSError:
            pass


def execute(p: dict[str, Any], ctx: Ctx) -> dict[str, Any]:
    """Re-plans each job now and removes only items that are in the approved plan AND still qualify."""
    before = disk("/")
    fresh = plan(ctx, p["jobs"])
    allowed = {i["id"]: i for j in fresh.values() for i in j["items"]}
    results = []
    for it in p["items"]:
        r: dict[str, Any] = {"id": it["id"], "job": it["job"], "ref": it["ref"]}
        now_item = allowed.get(it["id"])
        if not now_item:
            results.append({**r, "ok": False, "skipped": True, "error": "no longer qualifies (in use, changed or gone), left alone"})
            continue
        try:
            r["freed"] = _execute_item(now_item, ctx)
            r["ok"] = True
        except Exception as e:  # noqa: BLE001
            r.update(ok=False, error=f"{type(e).__name__}: {e}"[:300])
        results.append(r)
    after = disk("/")
    return {"$axf": SCHEMA, "id": p["id"], "sha": p["sha"], "at": now_iso(), "ok": all(x["ok"] or x.get("skipped") for x in results),
            "done": sum(1 for x in results if x["ok"]), "skipped": sum(1 for x in results if x.get("skipped")),
            "failed": sum(1 for x in results if not x["ok"] and not x.get("skipped")),
            "freed": max(0, (after["free"] or 0) - (before["free"] or 0)),
            "diskBefore": before, "diskAfter": after, "results": results}


def _execute_item(it: dict[str, Any], ctx: Ctx) -> int:
    job, ref = it["job"], it["ref"]
    if job == "worktrees":
        wt = Path(ref)
        roots = build_roots()
        if not inside(wt, roots):
            raise PermissionError("outside the build folders")
        _archive_build_notes(wt)
        size = it.get("size") or 0
        gitfile = wt / ".git"
        if gitfile.is_file():  # a linked worktree: let git drop it from its repository's list
            code, out = ctx.run(["git", "-C", str(wt), "worktree", "remove", "--force", str(wt)], 120)
            if code == 0 and not wt.exists():
                return size
        return _remove_path(wt, roots, ctx.files, ctx.cwds) or size
    if job == "docker":
        if ref == "build-cache":
            code, out = ctx.run(["docker", "builder", "prune", "-f", "--filter", f"until={ctx.s['buildCacheHours']}h"], 600)
            if code != 0:
                raise RuntimeError(out.strip()[-200:])
            m = re.search(r"Total(?: reclaimed space)?:\s*([0-9.]+\s*[kKMGT]?B)", out)
            return parse_size(m.group(1).replace(" ", "")) if m else 0
        code, out = ctx.run(["docker", "rmi", ref], 120)  # no -f: Docker refuses an image a container uses
        if code != 0:
            raise RuntimeError(out.strip()[-200:])
        return it.get("size") or 0
    if job == "logs":
        if ref == "journal":
            code, out = ctx.run(["journalctl", f"--vacuum-time={ctx.s['journalDays']}d"], 300)
            if code != 0:
                raise RuntimeError(out.strip()[-200:])
            m = re.search(r"freed ([0-9.]+[KMGT]?)", out)
            return parse_size(m.group(1) + "iB") if m and m.group(1)[-1:].isalpha() else 0
        return _remove_path(Path(ref), log_roots() + build_roots(), ctx.files, ctx.cwds)
    if job == "tmp":
        return _remove_path(Path(ref), tmp_roots(), ctx.files, ctx.cwds)
    if job == "created":
        code, out = ctx.run(["docker", "inspect", "-f", "{{.State.Status}}", ref], 30)
        if code != 0 or out.strip() != "created":
            raise PermissionError(f"not in Created any more ({out.strip()[:40] or 'gone'})")
        code, out = ctx.run(["docker", "rm", ref], 60)  # no -f: never stops anything
        if code != 0:
            raise RuntimeError(out.strip()[-200:])
        return 0
    raise ValueError(f"unknown job {job}")


def run_plan(run_id: str, sha: str, data_dir: Path = DATA_DIR, run: Runner = _run) -> dict[str, Any]:
    if not RUN_ID.match(run_id):
        raise SystemExit("bad run id")
    p = read_json(data_dir / "plans" / f"{run_id}.json")
    if not isinstance(p, dict):
        raise SystemExit(f"no plan {run_id}")
    if plan_sha(p) != sha or p.get("sha") != sha:
        raise SystemExit("the plan changed after it was approved; nothing was removed")
    if (data_dir / "runs" / f"{run_id}.json").exists():
        raise SystemExit("this plan already ran; nothing was removed")
    res = execute(p, Ctx(load_settings(data_dir), run))
    write_json(data_dir / "runs" / f"{run_id}.json", res)
    try:
        write_json(data_dir / "snapshot.json", snapshot(load_settings(data_dir), run))
    except Exception:  # noqa: BLE001 — the next cron tick refreshes it
        pass
    return res


# ------------------------------------------------------------------ CLI

def _main(argv: list[str]) -> int:
    ap = argparse.ArgumentParser(prog="maint.py", description="AXF maintenance engine (maintenance@1)")
    sub = ap.add_subparsers(dest="cmd", required=True)
    a = sub.add_parser("snapshot")
    a.add_argument("--out")
    a.add_argument("--json", action="store_true")
    b = sub.add_parser("preview")
    b.add_argument("--jobs", default=",".join(JOBS))
    b.add_argument("--json", action="store_true")
    c = sub.add_parser("run")
    c.add_argument("id")
    c.add_argument("--sha", required=True)
    sub.add_parser("jobs")
    args = ap.parse_args(argv)
    if args.cmd == "jobs":
        print(json.dumps(job_catalog(), indent=1))
        return 0
    if args.cmd == "snapshot":
        snap = snapshot()
        out = Path(args.out) if args.out else DATA_DIR / "snapshot.json"
        write_json(out, snap)
        if args.json:
            print(json.dumps(snap, indent=1))
        else:
            d = snap["disk"]
            print(f"disk {d['pct']}% · snapshot written to {out} in {snap['tookMs']} ms")
        return 0
    if args.cmd == "preview":
        jobs = [j for j in args.jobs.split(",") if j]
        res = plan(Ctx(load_settings()), jobs)
        if args.json:
            print(json.dumps(res, indent=1))
        else:
            for j, r in res.items():
                print(f"{JOBS[j]['label']}: {r['count']} item(s), {human(r['bytes'])}{' · ' + r['error'] if r.get('error') else ''}")
                for i in r["items"][:20]:
                    print(f"  - {i['ref']}  {human(i['size'])}  ({i['why']})")
        return 0
    if args.cmd == "run":
        res = run_plan(args.id, args.sha)
        print(f"done {res['done']} · skipped {res['skipped']} · failed {res['failed']} · freed {human(res['freed'])} · disk {res['diskAfter']['pct']}%")
        for r in res["results"]:
            if not r["ok"]:
                print(f"  {'skip' if r.get('skipped') else 'FAIL'} {r['ref']}: {r.get('error')}")
        return 0 if res["ok"] else 1
    return 2


if __name__ == "__main__":
    sys.exit(_main(sys.argv[1:]))
