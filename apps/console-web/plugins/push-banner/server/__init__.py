"""Push banner — server part. Mounted at /api/plugins/push-banner/ (console token on every method, 404 when the plugin
is off, never on the console MCP; hub users never reach it: the plugin isn't user-grantable).

    GET  /branches[?refresh=true]   every branch ahead of each watched repo's default branch: commits ahead/behind,
                                    last commit, its open PR and that PR's CI; cached ~2 min
    POST /pr     {repo, branch}     opens a PR into the default branch (or answers the one already open)
    POST /merge  {repo, number, confirm: "<repo>#<number>"}
                                    merges an open PR (merge commit) only when GitHub says it can and every check on
                                    its head commit passed; the head commit is pinned so nothing newer slips in
    GET  /config | PUT /config      {repos: [owner/name …], hidden: ["owner/name:branch" …]}

main is never pushed to: a branch reaches main only through its PR. GitHub is read through lib-github
(`axf_server.github`): the token goes to the API origin only, API calls never follow a redirect, answers are size-capped,
errors scrubbed. Nothing here returns the token, and everything GitHub says is data (the browser renders it as text).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, storage

router = APIRouter()

DEFAULT_REPOS = ["MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot"]
# Branches that are never "waiting for main": the demo site's build output and GitHub Pages.
ALWAYS_HIDDEN = {"site", "gh-pages"}
CACHE_S = 120
MAX_REPOS = 10
MAX_BRANCHES = 150  # per repo, newest first by GitHub's listing
MAX_HIDDEN = 300
BRANCH_RE = re.compile(r"(?!.*\.\.)(?!/)(?!.*//)[A-Za-z0-9._/-]{1,200}\Z")
TEXT_MAX = 200


def data_dir() -> Path:
    return Path(os.environ.get("AXF_PUSH_BANNER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "push-banner"))


def _text(v: Any, n: int = TEXT_MAX) -> str:
    return str(v or "").replace("\r", " ").strip()[:n]


def _safe_url(v: Any) -> str:
    """Only https links on github.com go back to the browser."""
    s = str(v or "")
    return s[:500] if s.startswith(github.GIT_BASE + "/") and not any(c in s for c in "\"'<> \n\r\t") else ""


def valid_branch(b: Any) -> bool:
    return isinstance(b, str) and bool(BRANCH_RE.match(b)) and not b.endswith((".", "/", ".lock"))


def compare_path(repo: str, base: str, branch: str) -> str:
    """'/repos/<o>/<n>/compare/<base>...<branch>?per_page=1' (counts only: one commit, the file list still comes): the refs are checked and quoted one by one (a path part
    may not hold '..', and a branch may hold '/')."""
    if not (valid_branch(base) and valid_branch(branch)):
        raise ValueError("bad branch name")
    return f"{github.repo_path(repo, 'compare')}/{quote(base, safe='')}...{quote(branch, safe='')}?per_page=1"


def ci_state(runs: list[dict[str, Any]]) -> str:
    """One state for a commit's check runs: none | running | failure | success."""
    if not runs:
        return "none"
    if any(r.get("status") != "completed" for r in runs):
        return "running"
    bad = {"failure", "timed_out", "cancelled", "action_required", "startup_failure", "stale"}
    if any(r.get("conclusion") in bad for r in runs):
        return "failure"
    return "success"


class Pushes:
    def __init__(self, token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", ""), clock: Callable[[], float] = time.time) -> None:
        self.token = token
        self.clock = clock
        self._lock = threading.Lock()
        self._cache: tuple[float, str, dict[str, Any]] | None = None

    # ---- config
    def config(self) -> dict[str, Any]:
        raw = storage.read_json(data_dir() / "config.json", {}) or {}
        repos = [r for r in raw.get("repos", []) if github.valid_repo(r)][:MAX_REPOS] if isinstance(raw.get("repos"), list) else []
        hidden = [h for h in raw.get("hidden", []) if isinstance(h, str) and len(h) <= 260][:MAX_HIDDEN] if isinstance(raw.get("hidden"), list) else []
        return {"repos": repos or list(DEFAULT_REPOS), "hidden": hidden, "defaults": list(DEFAULT_REPOS)}

    def save_config(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"repos", "hidden"}:
            raise HTTPException(400, "send {repos: [owner/name …], hidden: [\"owner/name:branch\" …]}")
        cur = self.config()
        repos, hidden = cur["repos"], cur["hidden"]
        if "repos" in body:
            if not isinstance(body["repos"], list) or len(body["repos"]) > MAX_REPOS or not all(github.valid_repo(r) for r in body["repos"]):
                raise HTTPException(400, f"repos: up to {MAX_REPOS} owner/name entries")
            repos = list(dict.fromkeys(body["repos"]))
        if "hidden" in body:
            h = body["hidden"]
            if not isinstance(h, list) or len(h) > MAX_HIDDEN:
                raise HTTPException(400, f"hidden: up to {MAX_HIDDEN} entries")
            for e in h:
                repo, _, branch = str(e).partition(":")
                if not (github.valid_repo(repo) and valid_branch(branch)):
                    raise HTTPException(400, f"hidden entries look like owner/name:branch ({_text(e, 80)!r})")
            hidden = list(dict.fromkeys(h))
        storage.write_json(data_dir() / "config.json", {"$axf": "push-banner-config@1", "repos": repos, "hidden": hidden})
        with self._lock:
            self._cache = None
        return self.config()

    # ---- GitHub
    def gh(self) -> github.GitHubClient:
        return github.GitHubClient(self.token, base_url=github.api_base_from_env(), user_agent="axf-console-push-banner",
                                   timeout=12, max_bytes=8_000_000)

    def _checks(self, gh: github.GitHubClient, repo: str, sha: str) -> list[dict[str, Any]]:
        data = gh.get(github.repo_path(repo, "commits", sha, "check-runs", query={"per_page": 100}))
        runs = data.get("check_runs", []) if isinstance(data, dict) else []
        return [r for r in runs if isinstance(r, dict)] if isinstance(runs, list) else []

    def _head(self, gh: github.GitHubClient, repo: str, branch: str) -> dict[str, Any]:
        """The newest commit on a branch (the commits list: no file diffs, unlike compare's)."""
        data = gh.get(github.repo_path(repo, "commits", query={"sha": branch, "per_page": 1}))
        return data[0] if isinstance(data, list) and data and isinstance(data[0], dict) else {}

    def _repo(self, gh: github.GitHubClient, repo: str, hidden: set[str]) -> dict[str, Any]:
        out: dict[str, Any] = {"repo": repo, "base": "main", "url": f"{github.GIT_BASE}/{repo}", "branches": [], "error": ""}
        try:
            info = gh.repo(repo)
            base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
            out["base"] = base
            names = [b.get("name") for b in gh.paginate(github.repo_path(repo, "branches", query={"per_page": 100}), max_pages=3, max_items=MAX_BRANCHES)
                     if isinstance(b, dict)]
            pulls = gh.paginate(github.repo_path(repo, "pulls", query={"state": "open", "base": base, "per_page": 100}), max_pages=2, max_items=200)
        except (github.GitHubError, ValueError) as e:
            out["error"] = _text(str(e))
            return out
        prs: dict[str, dict[str, Any]] = {}
        for p in pulls:
            head = p.get("head") if isinstance(p, dict) else None
            if isinstance(head, dict) and (head.get("repo") or {}).get("full_name", "").lower() == repo.lower() and valid_branch(head.get("ref")):
                prs[head["ref"]] = p
        todo = [n for n in names if valid_branch(n) and n != base and n not in ALWAYS_HIDDEN]

        def one(name: str) -> dict[str, Any] | None:
            try:
                cmp = gh.get(compare_path(repo, base, name))
            except (github.GitHubError, ValueError) as e:
                return {"name": name, "ahead": None, "behind": None, "error": _text(str(e), 120)}
            ahead = cmp.get("ahead_by") if isinstance(cmp, dict) else None
            if not isinstance(ahead, int) or ahead <= 0:
                return None
            last = self._head(gh, repo, name)
            c = last.get("commit") if isinstance(last.get("commit"), dict) else {}
            item: dict[str, Any] = {
                "name": name, "ahead": ahead, "behind": cmp.get("behind_by") if isinstance(cmp.get("behind_by"), int) else None,
                "sha": _text(last.get("sha"), 40), "subject": _text(str(c.get("message") or "").split("\n")[0]),
                "date": _text((c.get("committer") or {}).get("date") if isinstance(c.get("committer"), dict) else "", 40),
                "url": f"{github.GIT_BASE}/{repo}/compare/{quote(base, safe='/')}...{quote(name, safe='/')}", "hidden": f"{repo}:{name}" in hidden, "pr": None, "error": "",
            }
            p = prs.get(name)
            if p:
                pr = {"number": p.get("number") if isinstance(p.get("number"), int) else None, "title": _text(p.get("title")),
                      "url": _safe_url(p.get("html_url")), "draft": p.get("draft") is True, "ci": "none"}
                sha = _text((p.get("head") or {}).get("sha"), 40)
                try:
                    pr["ci"] = ci_state(self._checks(gh, repo, sha)) if sha else "none"
                except (github.GitHubError, ValueError):
                    pr["ci"] = "unknown"
                item["pr"] = pr
            return item

        with ThreadPoolExecutor(max_workers=8) as pool:
            got = [r for r in pool.map(one, todo) if r]
        got.sort(key=lambda b: b.get("date") or "", reverse=True)
        out["branches"] = got
        return out

    def branches(self, force: bool = False) -> dict[str, Any]:
        cfg = self.config()
        key = json.dumps([cfg["repos"], cfg["hidden"]])
        now = self.clock()
        with self._lock:
            if not force and self._cache and self._cache[1] == key and now - self._cache[0] < CACHE_S:
                return self._cache[2]
        if not (self.token() or "").strip():
            out = {"checkedAt": int(now * 1000), "repos": [], "error": "GITHUB_TOKEN isn't set on the console server"}
        else:
            gh = self.gh()
            hidden = set(cfg["hidden"])
            out = {"checkedAt": int(now * 1000), "cacheS": CACHE_S, "repos": [self._repo(gh, r, hidden) for r in cfg["repos"]], "error": ""}
        with self._lock:
            self._cache = (now, key, out)
        return out

    def _forget(self) -> None:
        with self._lock:
            self._cache = None

    # ---- writes
    def open_pr(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"repo", "branch"}:
            raise HTTPException(400, "send {repo, branch}")
        repo, branch = body.get("repo"), body.get("branch")
        cfg = self.config()
        if repo not in cfg["repos"]:
            raise HTTPException(400, "that repo isn't watched here")
        if not valid_branch(branch):
            raise HTTPException(400, "that isn't a branch name")
        gh = self.gh()
        try:
            info = gh.repo(repo)
            base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
            if branch == base:
                raise HTTPException(400, "that is the default branch")
            owner = repo.split("/")[0]
            open_ = gh.get(github.repo_path(repo, "pulls", query={"state": "open", "head": f"{owner}:{branch}", "base": base}))
            if isinstance(open_, list) and open_ and isinstance(open_[0], dict):
                p = open_[0]
                return {"number": p.get("number"), "url": _safe_url(p.get("html_url")), "existing": True}
            cmp = gh.get(compare_path(repo, base, branch))
            last = self._head(gh, repo, branch).get("commit") or {}
            title = _text(str(last.get("message") or "").split("\n")[0], 120) or branch
            p = gh.json("POST", github.repo_path(repo, "pulls"), {
                "title": title, "head": branch, "base": base,
                "body": f"Opened from the Dev Console's Push banner: `{branch}` is {cmp.get('ahead_by', '?')} commit(s) ahead of `{base}`.",
            })
        except github.GitHubError as e:
            raise HTTPException(502, _text(str(e))) from None
        self._forget()
        return {"number": p.get("number") if isinstance(p, dict) else None, "url": _safe_url(p.get("html_url")) if isinstance(p, dict) else "", "existing": False}

    def merge(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"repo", "number", "confirm"}:
            raise HTTPException(400, "send {repo, number, confirm}")
        repo, number = body.get("repo"), body.get("number")
        if repo not in self.config()["repos"]:
            raise HTTPException(400, "that repo isn't watched here")
        if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
            raise HTTPException(400, "number is the PR number")
        if body.get("confirm") != f"{repo}#{number}":
            raise HTTPException(400, f'confirm with "{repo}#{number}"')
        gh = self.gh()
        try:
            p = gh.get(github.repo_path(repo, "pulls", number))
            if not isinstance(p, dict) or p.get("state") != "open":
                raise HTTPException(409, "that PR isn't open")
            if p.get("draft") is True:
                raise HTTPException(409, "that PR is a draft")
            if p.get("mergeable") is not True:
                raise HTTPException(409, "GitHub can't merge it as is (conflicts, or it's still working that out: try again in a moment)")
            sha = _text((p.get("head") or {}).get("sha"), 40)
            ci = ci_state(self._checks(gh, repo, sha)) if sha else "none"
            if ci != "success":
                raise HTTPException(409, {"running": "its CI is still running", "failure": "its CI failed", "none": "it has no CI result yet"}.get(ci, "its CI isn't green"))
            r = gh.json("PUT", github.repo_path(repo, "pulls", number, "merge"), {"merge_method": "merge", "sha": sha})
        except github.GitHubError as e:
            raise HTTPException(502, _text(str(e))) from None
        self._forget()
        return {"merged": bool(isinstance(r, dict) and r.get("merged")), "sha": _text(r.get("sha"), 40) if isinstance(r, dict) else "",
                "url": _safe_url(p.get("html_url"))}


PUSHES = Pushes()


@router.get("/branches")
def branches(refresh: bool = False) -> dict[str, Any]:
    return PUSHES.branches(force=refresh)


@router.post("/pr")
def open_pr(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.open_pr(body)


@router.post("/merge")
def merge(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.merge(body)


@router.get("/config")
def get_config() -> dict[str, Any]:
    return PUSHES.config()


@router.put("/config")
def put_config(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.save_config(body)
