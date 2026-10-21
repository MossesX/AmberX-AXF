"""Main build status — server part. Mounted at /api/plugins/main-build-status/ (console token on every method, 404 when
the plugin is off, never on the console MCP).

    GET /status            the last run of each watched (repo, branch, workflow): state success | failure | running |
                           unknown, title, commit, times, link, failed jobs; cached ~30 s
    GET /config | PUT /config   {watch: [{repo, branch, workflow}]}  (open list; the first one is the banner's)

GitHub is read through lib-github (`axf_server.github`): the token goes to the API origin only, API calls never follow a
redirect, answers are size-capped, errors scrubbed. Nothing here ever returns the token, and everything GitHub says is
data (the browser renders it as text).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, storage

router = APIRouter()

DEFAULT_WATCH = [{"repo": "MossesX/AmberX-AXF", "branch": "main", "workflow": "android.yml"}]
CACHE_S = 30
MAX_WATCH = 10
BRANCH_RE = re.compile(r"(?!.*\.\.)(?!/)[A-Za-z0-9._/-]{1,200}\Z")
WORKFLOW_FILE_RE = re.compile(r"[A-Za-z0-9_.-]{1,100}\.ya?ml\Z")
WORKFLOW_ID_RE = re.compile(r"\d{1,20}\Z")
WORKFLOW_NAME_RE = re.compile(r"[^\x00-\x1f\x7f]{1,100}\Z")
TEXT_MAX = 200


def data_dir() -> Path:
    return Path(os.environ.get("AXF_MAIN_BUILD_STATUS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "main-build-status"))


def _text(v: Any, n: int = TEXT_MAX) -> str:
    return str(v or "").replace("\r", " ").strip()[:n]


def check_watch(w: Any) -> str | None:
    """None when one watch entry is fine, else why not."""
    if not isinstance(w, dict):
        return "each entry is an object {repo, branch, workflow}"
    if set(w) - {"repo", "branch", "workflow"}:
        return f"unknown keys: {', '.join(sorted(set(w) - {'repo', 'branch', 'workflow'}))}"
    if not github.valid_repo(w.get("repo")):
        return f"repo must be owner/name ({_text(w.get('repo'), 80)!r})"
    if not isinstance(w.get("branch"), str) or not BRANCH_RE.match(w["branch"]):
        return f"branch isn't a branch name ({_text(w.get('branch'), 80)!r})"
    wf = w.get("workflow")
    if not isinstance(wf, str) or not (WORKFLOW_FILE_RE.match(wf) or WORKFLOW_ID_RE.match(wf) or WORKFLOW_NAME_RE.match(wf.strip())):
        return "workflow is a file name (android.yml), a workflow id or the workflow's name"
    return None


class Monitor:
    """Reads the latest run per watch entry. `get` is one GitHub API GET (path → JSON); tests pass a fake."""

    def __init__(self, token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", ""),
                 get: Callable[[str], Any] | None = None, clock: Callable[[], float] = time.time) -> None:
        self.token = token
        self._get = get or self._github_get
        self.clock = clock
        self._lock = threading.Lock()
        self._cache: tuple[float, str, dict[str, Any]] | None = None
        self._jobs: dict[str, list[dict[str, str]]] = {}  # "repo#run_id" → failed jobs (a finished run never changes)

    # ---- config
    def config(self) -> dict[str, Any]:
        c = storage.read_json(data_dir() / "config.json", {})
        watch = c.get("watch") if isinstance(c, dict) else None
        if not isinstance(watch, list) or not watch or any(check_watch(w) for w in watch):
            watch = DEFAULT_WATCH
        return {"watch": [dict(w) for w in watch[:MAX_WATCH]], "defaults": DEFAULT_WATCH, "cacheS": CACHE_S}

    def save_config(self, body: Any) -> dict[str, Any]:
        watch = body.get("watch") if isinstance(body, dict) else None
        if watch is None and isinstance(body, dict) and body.get("reset"):
            watch = DEFAULT_WATCH
        if not isinstance(watch, list) or not watch:
            raise HTTPException(400, "watch must list at least one {repo, branch, workflow}")
        if len(watch) > MAX_WATCH:
            raise HTTPException(400, f"at most {MAX_WATCH} entries")
        clean = []
        for i, w in enumerate(watch):
            if isinstance(w, dict):
                w = {k: (v.strip() if isinstance(v, str) else v) for k, v in w.items()}
            bad = check_watch(w)
            if bad:
                raise HTTPException(400, f"entry {i + 1}: {bad}")
            clean.append(w)
        storage.write_json(data_dir() / "config.json", {"$axf": "main-build-status-config@1", "watch": clean})
        with self._lock:
            self._cache = None
        return self.config()

    # ---- GitHub
    def _github_get(self, path: str) -> Any:
        gh = github.GitHubClient(self.token, base_url=github.api_base_from_env(), user_agent="axf-console-main-build-status",
                                 timeout=10, max_bytes=2_000_000)
        return gh.get(path)

    def _runs(self, w: dict[str, str]) -> list[dict[str, Any]]:
        wf = w["workflow"]
        if WORKFLOW_FILE_RE.match(wf) or WORKFLOW_ID_RE.match(wf):
            data = self._get(github.repo_path(w["repo"], "actions", "workflows", wf, "runs", query={"branch": w["branch"], "per_page": 10}))
            runs = data.get("workflow_runs", []) if isinstance(data, dict) else []
        else:  # a workflow's display name: every run on the branch, filtered by name
            data = self._get(github.repo_path(w["repo"], "actions", "runs", query={"branch": w["branch"], "per_page": 50}))
            runs = [r for r in (data.get("workflow_runs", []) if isinstance(data, dict) else []) if isinstance(r, dict) and r.get("name") == wf.strip()]
        return [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []

    def _failed_jobs(self, repo: str, run_id: Any) -> list[dict[str, str]]:
        key = f"{repo}#{run_id}"
        if key in self._jobs:
            return self._jobs[key]
        data = self._get(github.repo_path(repo, "actions", "runs", int(run_id), "jobs", query={"per_page": 50}))
        jobs = data.get("jobs", []) if isinstance(data, dict) else []
        out = [{"name": _text(j.get("name"), 120), "url": _safe_url(j.get("html_url"))}
               for j in (jobs if isinstance(jobs, list) else []) if isinstance(j, dict) and github.run_state(j.get("status"), j.get("conclusion")) == "failure"]
        if len(self._jobs) > 200:
            self._jobs.clear()
        self._jobs[key] = out[:20]
        return self._jobs[key]

    def one(self, w: dict[str, str]) -> dict[str, Any]:
        item: dict[str, Any] = {"repo": w["repo"], "branch": w["branch"], "workflow": w["workflow"], "state": "unknown",
                                "title": "", "name": "", "sha": "", "url": _repo_url(w["repo"]), "runNumber": None, "event": "",
                                "startedAt": "", "updatedAt": "", "failedJobs": [], "previous": None, "error": ""}
        if not (self.token() or "").strip():
            item["error"] = "GITHUB_TOKEN isn't set on the console server"
            return item
        try:
            runs = self._runs(w)
        except github.GitHubError as e:
            item["error"] = _text(str(e))
            return item
        if not runs:
            item["error"] = "no runs on this branch yet"
            return item
        r = runs[0]
        st = github.run_state(r.get("status"), r.get("conclusion"))
        item.update(
            state={"success": "success", "failure": "failure", "running": "running", "queued": "running", "waiting": "running"}.get(st, "unknown"),
            conclusion=st, title=_text(r.get("display_title") or (r.get("head_commit") or {}).get("message", "").split("\n")[0]),
            name=_text(r.get("name"), 120), sha=_text(r.get("head_sha"), 40), runNumber=r.get("run_number") if isinstance(r.get("run_number"), int) else None,
            event=_text(r.get("event"), 40), startedAt=_text(r.get("run_started_at") or r.get("created_at"), 40),
            updatedAt=_text(r.get("updated_at"), 40), url=_safe_url(r.get("html_url")) or _repo_url(w["repo"]),
        )
        if st == "cancelled":
            item["error"] = "the last run was cancelled"
        prev = next((x for x in runs[1:] if github.run_state(x.get("status"), x.get("conclusion")) in ("success", "failure")), None)
        if item["state"] == "running" and prev:
            item["previous"] = {"state": github.run_state(prev.get("status"), prev.get("conclusion")), "updatedAt": _text(prev.get("updated_at"), 40),
                                "url": _safe_url(prev.get("html_url"))}
        if item["state"] == "failure" and r.get("id") is not None:
            try:
                item["failedJobs"] = self._failed_jobs(w["repo"], r["id"])
            except (github.GitHubError, ValueError, TypeError) as e:
                item["error"] = f"failed jobs not loaded: {_text(str(e), 120)}"
        return item

    def status(self, force: bool = False) -> dict[str, Any]:
        cfg = self.config()
        key = json.dumps(cfg["watch"], sort_keys=True)
        now = self.clock()
        with self._lock:
            if not force and self._cache and self._cache[1] == key and now - self._cache[0] < CACHE_S:
                return self._cache[2]
        items = [self.one(w) for w in cfg["watch"]]
        out = {"checkedAt": int(now * 1000), "cacheS": CACHE_S, "items": items}
        with self._lock:
            self._cache = (now, key, out)
        return out


def _repo_url(repo: str) -> str:
    return f"{github.GIT_BASE}/{repo}/actions" if github.valid_repo(repo) else ""


def _safe_url(v: Any) -> str:
    """Only https links on github.com go back to the browser."""
    s = str(v or "")
    return s[:500] if s.startswith(github.GIT_BASE + "/") and not any(c in s for c in "\"'<> \n\r\t") else ""


MONITOR = Monitor()


@router.get("/status")
def status(refresh: bool = False) -> dict[str, Any]:
    return MONITOR.status(force=refresh)


@router.get("/config")
def get_config() -> dict[str, Any]:
    return MONITOR.config()


@router.put("/config")
def put_config(body: Any = Body(...)) -> dict[str, Any]:
    return MONITOR.save_config(body)
