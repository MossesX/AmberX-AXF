"""Git status board: the local git scan. Reads every checkout on the VPS the console can see (the main checkout and
the build worktrees under /root/axf-builds, mounted in the console container at /axf and /hostfs/axf-builds) with plain
git: branch, commits not on any GitHub ref, uncommitted files, ahead / behind origin/main, last commit. Read-only
except one `git fetch origin --prune` at most every FETCH_EVERY_S so the counts are current. Never pushes or edits.

A worktree's `.git` file names its git dir by the host path (/opt/axf/.git/worktrees/<name>); in the container the
main checkout is mounted elsewhere, so the path is mapped through PATH_MAP (host prefix → where it is mounted here).
"""
from __future__ import annotations

import os
import subprocess
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

FETCH_EVERY_S = 600
CACHE_S = 180  # a full scan of ~150 worktrees takes ~30 s: it runs in the background, the board shows the last one
# Status-only files that change by themselves (builds-live, focus, queue logs): not "uncommitted work".
NOT_WORK = ("_claude/builds/", ".axf-")
MAX_WORKTREES = 250
GIT_TIMEOUT_S = 20


def _roots() -> list[Path]:
    """Folders holding build worktrees: AXF_GIT_STATUS_WORKTREES (os.pathsep list), else the ones that exist."""
    env = os.environ.get("AXF_GIT_STATUS_WORKTREES")
    cands = env.split(os.pathsep) if env else ["/hostfs/axf-builds", "/root/axf-builds"]
    return [Path(c) for c in cands if c and Path(c).is_dir()]


def _main_checkouts(root: Path) -> list[Path]:
    env = os.environ.get("AXF_GIT_STATUS_MAIN")
    cands = env.split(os.pathsep) if env else [str(root), "/axf", "/opt/axf"]
    seen, out = set(), []
    for c in cands:
        p = Path(c)
        if (p / ".git").is_dir() and p.resolve() not in seen:
            seen.add(p.resolve())
            out.append(p)
    return out


def path_map(main: list[Path]) -> list[tuple[str, str]]:
    """Host path prefix → where it is here. AXF_GIT_STATUS_PATH_MAP="/opt/axf=/axf;…", else /opt/axf → the main checkout."""
    env = os.environ.get("AXF_GIT_STATUS_PATH_MAP")
    if env:
        return [tuple(x.split("=", 1)) for x in env.split(";") if "=" in x]  # type: ignore[misc]
    return [("/opt/axf", str(main[0]))] if main and str(main[0]) != "/opt/axf" else []


def git_dir(wt: Path, pmap: list[tuple[str, str]]) -> str | None:
    g = wt / ".git"
    if g.is_dir():
        return str(g)
    try:
        line = g.read_text("utf-8").strip()
    except OSError:
        return None
    if not line.startswith("gitdir:"):
        return None
    d = line.split(":", 1)[1].strip()
    for host, here in pmap:
        if d.startswith(host + "/"):
            d = here + d[len(host):]
            break
    return d if Path(d).is_dir() else None


def _git(gd: str, wt: Path | None, *args: str, timeout: int = GIT_TIMEOUT_S) -> str:
    cmd = ["git", "-c", "safe.directory=*", f"--git-dir={gd}"] + ([f"--work-tree={wt}"] if wt else []) + list(args)
    p = subprocess.run(cmd, capture_output=True, text=True, timeout=timeout, cwd=str(wt) if wt else None,
                       env={**os.environ, "GIT_OPTIONAL_LOCKS": "0", "GIT_TERMINAL_PROMPT": "0"})
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip()[:200] or f"git {args[0]} failed")
    return p.stdout


def scan_one(wt: Path, gd: str, base: str = "origin/main") -> dict[str, Any]:
    out: dict[str, Any] = {"path": str(wt), "name": wt.name, "repo": "", "branch": "", "sha": "", "subject": "", "at": "", "unpushed": 0,
                           "dirty": 0, "ahead": None, "behind": None, "error": ""}
    try:
        out["branch"] = _git(gd, wt, "rev-parse", "--abbrev-ref", "HEAD").strip()
        log = _git(gd, wt, "log", "-1", "--format=%H%x09%cI%x09%s").strip().split("\t", 2)
        if len(log) == 3:
            out["sha"], out["at"], out["subject"] = log[0], log[1], log[2][:200]
        out["unpushed"] = int(_git(gd, wt, "rev-list", "--count", "HEAD", "--not", "--remotes=origin").strip() or 0)
        ab = _git(gd, wt, "rev-list", "--left-right", "--count", f"{base}...HEAD").split()
        if len(ab) == 2:
            out["behind"], out["ahead"] = int(ab[0]), int(ab[1])
        st = _git(gd, wt, "status", "--porcelain", "--untracked-files=no")
        out["dirty"] = sum(1 for ln in st.splitlines() if ln.strip() and not ln[3:].strip().strip('"').startswith(NOT_WORK))
        url = _git(gd, wt, "remote", "get-url", "origin").strip()
        out["repo"] = repo_of(url)
    except (RuntimeError, subprocess.TimeoutExpired, ValueError, OSError) as e:
        out["error"] = str(e)[:200]
    return out


def repo_of(url: str) -> str:
    """owner/name from a GitHub remote URL (https or ssh; any token in it is never kept)."""
    u = url.strip().removesuffix(".git")
    if "github.com" not in u:
        return ""
    tail = u.split("github.com", 1)[1].lstrip(":/")
    parts = tail.split("/")
    return f"{parts[0]}/{parts[1]}" if len(parts) >= 2 else ""


class Scanner:
    def __init__(self, root: Path, clock=time.time) -> None:
        self.root = root
        self.clock = clock
        self._lock = threading.Lock()
        self._cache: tuple[float, dict[str, Any]] | None = None
        self._fetched = 0.0
        self._running = False

    def _fetch(self, gd: str) -> str:
        if self.clock() - self._fetched < FETCH_EVERY_S:
            return ""
        self._fetched = self.clock()
        try:
            _git(gd, None, "fetch", "--quiet", "--prune", "origin", timeout=60)
            return ""
        except (RuntimeError, subprocess.TimeoutExpired, OSError) as e:
            return f"git fetch failed: {str(e)[:160]}"

    def scan(self, force: bool = False, wait: bool = False) -> dict[str, Any]:
        """The last scan at once; a new one starts in the background when it is older than CACHE_S (or force). Before
        the first one has finished: an empty list saying it is scanning. wait=True scans now (tests, the CLI)."""
        with self._lock:
            cached = self._cache[1] if self._cache else None
            fresh = bool(self._cache and self.clock() - self._cache[0] < CACHE_S)
            start = (force or not fresh) and not self._running
            if start:
                self._running = True
        if wait:
            if not start:  # one is running (or fresh): run our own only when nothing is cached
                return cached if cached and not force else self._scan_now(release=False)
            return self._scan_now()
        if start:
            threading.Thread(target=self._scan_now, name="git-status-scan", daemon=True).start()
        return cached or {"checkedAt": 0, "items": [], "warning": "scanning the VPS checkouts for the first time (about half a minute)…", "roots": []}

    def _scan_now(self, release: bool = True) -> dict[str, Any]:
        try:
            main = _main_checkouts(self.root)
            pmap = path_map(main)
            warn = self._fetch(str(main[0] / ".git")) if main else "no main checkout found"
            todo: list[tuple[Path, str]] = [(m, str(m / ".git")) for m in main]
            for r in _roots():
                for d in sorted(r.iterdir()) if r.is_dir() else []:
                    if len(todo) >= MAX_WORKTREES:
                        break
                    if d.is_dir() and (d / ".git").exists():
                        gd = git_dir(d, pmap)
                        if gd:
                            todo.append((d, gd))
            with ThreadPoolExecutor(max_workers=8) as pool:
                items = list(pool.map(lambda t: scan_one(*t), todo))
            res = {"checkedAt": int(self.clock() * 1000), "items": items, "warning": warn, "roots": [str(r) for r in _roots()]}
            with self._lock:
                self._cache = (self.clock(), res)
            return res
        finally:
            if release:
                with self._lock:
                    self._running = False

    def commit_at(self, before_iso: str) -> dict[str, Any]:
        """The newest origin/main commit at or before a time (what a container built then was running)."""
        main = _main_checkouts(self.root)
        if not main:
            return {}
        try:
            ln = _git(str(main[0] / ".git"), None, "log", "-1", f"--before={before_iso}", "--format=%H%x09%cI%x09%s", "origin/main").strip().split("\t", 2)
            behind = int(_git(str(main[0] / ".git"), None, "rev-list", "--count", f"{ln[0]}..origin/main").strip() or 0) if ln and ln[0] else None
        except (RuntimeError, subprocess.TimeoutExpired, OSError):
            return {}
        return {"sha": ln[0], "at": ln[1], "subject": ln[2][:200], "behind": behind} if len(ln) == 3 else {}

    def commit_info(self, sha: str) -> dict[str, Any]:
        main = _main_checkouts(self.root)
        if not main:
            return {}
        try:
            ln = _git(str(main[0] / ".git"), None, "log", "-1", "--format=%H%x09%cI%x09%s", sha).strip().split("\t", 2)
            behind = int(_git(str(main[0] / ".git"), None, "rev-list", "--count", f"{ln[0]}..origin/main").strip() or 0)
        except (RuntimeError, subprocess.TimeoutExpired, OSError):
            return {"sha": sha}
        return {"sha": ln[0], "at": ln[1], "subject": ln[2][:200], "behind": behind} if len(ln) == 3 else {"sha": sha}

    def local_log(self, wt: str, n: int = 20) -> list[dict[str, Any]]:
        """A worktree's commits that aren't on main yet (newest first)."""
        main = _main_checkouts(self.root)
        p = Path(wt)
        gd = git_dir(p, path_map(main)) if p.is_dir() else None
        if not gd or not self.known(wt):
            return []
        try:
            raw = _git(gd, p, "log", f"-{n}", "--format=%H%x09%cI%x09%an%x09%s", "origin/main..HEAD")
        except (RuntimeError, subprocess.TimeoutExpired, OSError):
            return []
        out = []
        for ln in raw.splitlines():
            a = ln.split("\t", 3)
            if len(a) == 4:
                out.append({"sha": a[0], "date": a[1], "author": a[2][:60], "subject": a[3][:200]})
        return out

    def known(self, wt: str) -> bool:
        """Only checkouts the scan found may be read in detail (no path from a request reaches git otherwise)."""
        c = self._cache[1] if self._cache else None
        return bool(c and any(i["path"] == wt for i in c["items"]))
