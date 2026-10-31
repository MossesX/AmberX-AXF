"""Push banner — server part. Mounted at /api/plugins/push-banner/ (console token on every method, 404 when the plugin
is off, never on the console MCP; hub users never reach it: the plugin isn't user-grantable).

    GET  /branches[?refresh=true]   every branch ahead of each watched repo's default branch (commits ahead/behind,
                                    last commit, its open PR and that PR's CI) and every open pull request as its own
                                    entry (head → base, fork, CI, mergeable, ready = CI passed + mergeable + not a
                                    draft); cached ~2 min
    POST /pr     {repo, branch}     opens a PR into the default branch (or answers the one already open)
    POST /merge  {repo, number, confirm: "<repo>#<number>"}
                                    merges an open PR (merge commit) only when it isn't behind its base, GitHub says it
                                    can and every check on its head commit passed; the head commit is pinned so nothing
                                    newer slips in
    POST /auto-merge | GET /auto-merge   one auto-merge round now | the last round's results (see "Auto-merge" below)
    GET  /protection                what branch protection on each watched repo's default branch looks like (and why
                                    it couldn't be set); POST /protection sets it again now (the systems check's Auto fix)
    POST /merge-branch              refused (0.5.0, Oct 30 2026: every change through a PR): says to open a PR
    POST /update {repo, number | branch, confirm: "<repo>#<number>" | "<repo>:<branch>"}
                                    pulls the default branch into a branch that's behind it: a PR through GitHub's
                                    "update branch" (its head pinned), a branch without one as a merge commit on it
    GET  /detail?repo=&number= | ?repo=&branch=
                                    one entry's details: its commits (newest first, up to 20) and the check runs on its
                                    head commit (name, state, link), plus GitHub's mergeable state for a PR
    POST /done/remove {key, sha?}   the trash can on a finished entry: forget it, and (when it is still open on GitHub,
                                    e.g. main was pulled in) hide it until it gets a new commit ("<key>@<sha>")
    GET  /config | PUT /config      {repos: [owner/name …], hidden: ["owner/name:branch" | "owner/name:#N", optionally
                                    "@<head sha>" = hidden only while that is its newest commit …], claudeOnFail, claudeShell}
    POST /failed/remove {key}       take a failed Pull main in off the banner's "Pull failed" group
    GET  /claude                    the hand-overs to headless Claude Code on the VPS (state, approval, entry id)
    POST /claude {repo, number | branch, confirm, repair?}   (repair: true = the Repair badge, works with the setting off)
                                    Fix with Claude by hand (setting on; skips the 6 h cooldown, never a running one)

Claude on failure (server/claudefix.py, setting claudeOnFail, off): a Pull main in that hits conflicts or a Merge that
GitHub refuses (conflicts, failed CI, a GitHub error) is handed to Mosses, who asks axHub vps.run (Brett approves) to start headless Claude Code
on the VPS on that branch; it shows in the Build manager's building banner. It never pushes to the default branch.

A successful Merge or Pull main in is remembered as a finished entry (`done` in /branches, every device, 7 days) until
its trash can is tapped; the entry itself leaves the other groups meanwhile.

Auto-merge (0.5.0, Oct 30 2026, Brett: "I want everything to need a PR and to pull against main before it's merged"),
one round every 3 minutes (settings autoMerge + autoPr, both on by default):
  1. autoPr: every branch ahead of main without an open PR gets one (main, site, go-pass, gh-pages and hidden ones never);
  2. ready PRs go oldest first, one at a time per repo: a PR behind its base gets the base pulled in (head pinned) and
     waits for CI on its new head; it merges only when it is 0 behind, mergeable, not a draft and CI passed on the
     pinned head. At most one merge per round, so the next PR is brought up to date with the new main first. A pull
     that conflicts lands in "Pull failed" (and Fix with Claude when that is on) and is skipped until it is retried;
  3. branch protection on main (require a PR, branches up to date, the CI checks every PR runs) is set where the token
     may and never loosened; where it can't, the systems check shows why with an Auto fix that tries again.

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

from . import claudefix

router = APIRouter()

DEFAULT_REPOS = ["MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot"]
# Branches that are never "waiting for main": the demo site's build output and GitHub Pages.
ALWAYS_HIDDEN = {"site", "gh-pages"}
# Branches that never get a PR opened by autoPr (the go-pass branch is axHub's pass file, never merged).
NO_AUTO_PR = ALWAYS_HIDDEN | {"main", "master", "go-pass"}
PROTECT_EVERY_S = 6 * 3600
CACHE_S = 120
MAX_REPOS = 10
MAX_BRANCHES = 150  # per repo, newest first by GitHub's listing
MAX_HIDDEN = 300
MAX_PULLS = 60  # open PRs per repo
BRANCH_RE = re.compile(r"(?!.*\.\.)(?!/)(?!.*//)[A-Za-z0-9._/-]{1,200}\Z")
TEXT_MAX = 200
SHA_RE = re.compile(r"[0-9a-f]{6,40}\Z")
MAX_DONE = 100
DONE_KEEP_S = 7 * 24 * 3600
MAX_FAILED = 100


def is_hidden(hidden: set[str], key: str, sha: str = "") -> bool:
    """Hidden for good ("<key>"), or only while its newest commit is <sha> ("<key>@<sha>": comes back on a new commit)."""
    return key in hidden or (bool(sha) and f"{key}@{sha}" in hidden)


def valid_hidden(e: Any) -> bool:
    key, at, sha = str(e).partition("@")
    if at and not SHA_RE.match(sha):
        return False
    repo, _, ref = key.partition(":")
    return github.valid_repo(repo) and (valid_branch(ref) or bool(re.fullmatch(r"#\d{1,9}", ref)))


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


def failed_key(body: Any) -> str:
    """The banner key of a Pull main in request ("" when it doesn't name a PR or a branch properly)."""
    if not isinstance(body, dict) or not github.valid_repo(str(body.get("repo", ""))):
        return ""
    n, b = body.get("number"), body.get("branch")
    key = f"{body['repo']}:#{n}" if isinstance(n, int) and not isinstance(n, bool) and n > 0 else f"{body['repo']}:{b}" if valid_branch(b) else ""
    return key if key and valid_hidden(key) else ""


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
        return {"repos": repos or list(DEFAULT_REPOS), "hidden": hidden, "defaults": list(DEFAULT_REPOS),
                "claudeOnFail": raw.get("claudeOnFail") is True, "claudeShell": raw.get("claudeShell") is True,
                # Auto-merge (Oct 30 2026, Brett: "When stuff needs to merge automatic merge"): on unless switched off.
                "autoMerge": raw.get("autoMerge") is not False,
                # Every branch gets a PR (Oct 30 2026, Brett: "I want everything to need a PR"): on unless switched off.
                "autoPr": raw.get("autoPr") is not False}

    def save_config(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"repos", "hidden", "claudeOnFail", "claudeShell", "autoMerge", "autoPr"}:
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
                if not valid_hidden(e):
                    raise HTTPException(400, f"hidden entries look like owner/name:branch[@sha] ({_text(e, 80)!r})")
            hidden = list(dict.fromkeys(h))
        flags = {}
        for k in ("claudeOnFail", "claudeShell", "autoMerge", "autoPr"):
            if k in body and not isinstance(body[k], bool):
                raise HTTPException(400, f"{k} is true or false")
            flags[k] = body[k] if k in body else cur[k]
        storage.write_json(data_dir() / "config.json", {"$axf": "push-banner-config@1", "repos": repos, "hidden": hidden, **flags})
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

    def _behind(self, gh: github.GitHubClient, repo: str, base: str, head: str) -> int | None:
        """How many commits on <base> the commit/branch <head> lacks (None when GitHub can't say)."""
        cmp = gh.get(compare_path(repo, base, head))
        n = cmp.get("behind_by") if isinstance(cmp, dict) else None
        return n if isinstance(n, int) and not isinstance(n, bool) else None

    def _repo(self, gh: github.GitHubClient, repo: str, hidden: set[str]) -> dict[str, Any]:
        out: dict[str, Any] = {"repo": repo, "base": "main", "url": f"{github.GIT_BASE}/{repo}", "branches": [], "pulls": [], "error": ""}
        try:
            info = gh.repo(repo)
            base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
            out["base"] = base
            names = [b.get("name") for b in gh.paginate(github.repo_path(repo, "branches", query={"per_page": 100}), max_pages=3, max_items=MAX_BRANCHES)
                     if isinstance(b, dict)]
            pulls = gh.paginate(github.repo_path(repo, "pulls", query={"state": "open", "per_page": 100}), max_pages=2, max_items=MAX_PULLS)
        except (github.GitHubError, ValueError) as e:
            out["error"] = _text(str(e))
            return out
        prs: dict[str, dict[str, Any]] = {}
        for p in pulls:
            head = p.get("head") if isinstance(p, dict) else None
            same = isinstance(head, dict) and ((head.get("repo") or {}).get("full_name") or "").lower() == repo.lower()
            if same and valid_branch(head.get("ref")) and ((p.get("base") or {}).get("ref") == base):
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
                "url": f"{github.GIT_BASE}/{repo}/compare/{quote(base, safe='/')}...{quote(name, safe='/')}", "hidden": is_hidden(hidden, f"{repo}:{name}", _text(last.get("sha"), 40)), "pr": None, "error": "",
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
            elif item["behind"] == 0 and item["sha"]:
                # No PR, nothing on the default branch it lacks: it merges cleanly (fast-forward). Its CI decides Merge.
                try:
                    item["ci"] = ci_state(self._checks(gh, repo, item["sha"]))
                except (github.GitHubError, ValueError):
                    item["ci"] = "unknown"
                item["clean"] = True
                item["canMerge"] = item["ci"] == "success"
            return item

        with ThreadPoolExecutor(max_workers=8) as pool:
            got = [r for r in pool.map(one, todo) if r]
        got.sort(key=lambda b: b.get("date") or "", reverse=True)
        out["branches"] = got
        behind_of = {g["name"]: g.get("behind") for g in got}

        def pull(p: dict[str, Any]) -> dict[str, Any] | None:
            n = p.get("number")
            if not isinstance(n, int):
                return None
            head = p.get("head") if isinstance(p.get("head"), dict) else {}
            sha = _text(head.get("sha"), 40)
            item: dict[str, Any] = {
                "number": n, "title": _text(p.get("title")), "url": _safe_url(p.get("html_url")), "draft": p.get("draft") is True,
                "head": _text(head.get("ref"), 200), "base": _text((p.get("base") or {}).get("ref") if isinstance(p.get("base"), dict) else "", 200),
                "fork": ((head.get("repo") or {}).get("full_name") or "").lower() != repo.lower(),
                "author": _text((p.get("user") or {}).get("login") if isinstance(p.get("user"), dict) else "", 60),
                "updated": _text(p.get("updated_at"), 40), "created": _text(p.get("created_at"), 40), "ci": "none", "mergeable": None, "mergeState": "", "ready": False,
                "hidden": is_hidden(hidden, f"{repo}:#{n}", sha), "sha": sha,
            }
            try:
                item["ci"] = ci_state(self._checks(gh, repo, sha)) if sha else "none"
            except (github.GitHubError, ValueError):
                item["ci"] = "unknown"
            try:
                full = gh.get(github.repo_path(repo, "pulls", n))
                m = full.get("mergeable") if isinstance(full, dict) else None
                item["mergeable"] = m if isinstance(m, bool) else None
                st = full.get("mergeable_state") if isinstance(full, dict) else None
                item["mergeState"] = st if st in ("clean", "behind", "dirty", "blocked", "unstable", "draft", "has_hooks", "unknown") else ""
            except (github.GitHubError, ValueError):
                pass
            # ready = it would merge now: not behind its base (pulled up to date first), CI passed, mergeable, not a draft
            behind = item["mergeState"] == "behind" or (not item["fork"] and item["base"] == base and (behind_of.get(item["head"]) or 0) > 0)
            item["ready"] = item["ci"] == "success" and item["mergeable"] is True and not item["draft"] and not behind
            return item

        with ThreadPoolExecutor(max_workers=8) as pool:
            out["pulls"] = [x for x in pool.map(pull, [p for p in pulls if isinstance(p, dict)]) if x]
        out["pulls"].sort(key=lambda x: x.get("updated") or "", reverse=True)
        out["pulls"].sort(key=lambda x: not x["ready"])  # ready ones first, newest first within each group
        return out

    def branches(self, force: bool = False) -> dict[str, Any]:
        cfg = self.config()
        key = json.dumps([cfg["repos"], cfg["hidden"]])
        now = self.clock()
        with self._lock:
            cached = self._cache[2] if not force and self._cache and self._cache[1] == key and now - self._cache[0] < CACHE_S else None
        if cached is not None:
            return {**cached, "done": self.done(), "failed": self.failed()}
        if not (self.token() or "").strip():
            out = {"checkedAt": int(now * 1000), "repos": [], "error": "GITHUB_TOKEN isn't set on the console server"}  # done comes below
        else:
            gh = self.gh()
            hidden = set(cfg["hidden"])
            out = {"checkedAt": int(now * 1000), "cacheS": CACHE_S, "repos": [self._repo(gh, r, hidden) for r in cfg["repos"]], "error": ""}
        with self._lock:
            self._cache = (now, key, out)
        return {**out, "done": self.done(), "failed": self.failed()}

    # ---- finished entries (a successful Merge / Pull main in), until their trash can is tapped
    def done(self) -> list[dict[str, Any]]:
        raw = storage.read_json(data_dir() / "done.json", {}) or {}
        items = raw.get("items") if isinstance(raw, dict) else None
        now = self.clock()
        keep = []
        for d in items if isinstance(items, list) else []:
            if isinstance(d, dict) and isinstance(d.get("key"), str) and isinstance(d.get("at"), (int, float)) and now - d["at"] / 1000 < DONE_KEEP_S:
                keep.append({k: d[k] for k in ("key", "kind", "at", "repo", "base", "number", "branch", "title", "url", "text") if k in d})
        return keep[:MAX_DONE]

    def _remember(self, entry: dict[str, Any]) -> None:
        with self._lock:
            items = [d for d in self.done() if d["key"] != entry["key"]]
            items.insert(0, {**entry, "at": int(self.clock() * 1000)})
            storage.write_json(data_dir() / "done.json", {"$axf": "push-banner-done@1", "items": items[:MAX_DONE]})

    # ---- failed pulls (any Pull main in / Pull all that GitHub refused), until a pull goes through or they're taken off
    def failed(self) -> list[dict[str, Any]]:
        raw = storage.read_json(data_dir() / "failed.json", {}) or {}
        items = raw.get("items") if isinstance(raw, dict) else None
        now = self.clock()
        return [{k: d[k] for k in ("key", "at", "repo", "base", "number", "branch", "title", "error", "sha") if k in d}
                for d in (items if isinstance(items, list) else [])
                if isinstance(d, dict) and isinstance(d.get("key"), str) and isinstance(d.get("at"), (int, float)) and now - d["at"] / 1000 < DONE_KEEP_S][:MAX_FAILED]

    def _set_failed(self, key: str, entry: dict[str, Any] | None) -> None:
        with self._lock:
            items = [d for d in self.failed() if d["key"] != key]
            if entry is not None:
                items.insert(0, {**entry, "key": key, "at": int(self.clock() * 1000)})
            storage.write_json(data_dir() / "failed.json", {"$axf": "push-banner-failed@1", "items": items[:MAX_FAILED]})

    def remove_failed(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) != {"key"} or not isinstance(body["key"], str) or not valid_hidden(body["key"]) or "@" in body["key"]:
            raise HTTPException(400, "send {key: owner/name:branch | owner/name:#N}")
        self._set_failed(body["key"], None)
        return {"ok": True}

    def remove_done(self, body: Any) -> dict[str, Any]:
        if not isinstance(body, dict) or set(body) - {"key", "sha"} or not isinstance(body.get("key"), str) or not valid_hidden(body["key"]) or "@" in body["key"]:
            raise HTTPException(400, "send {key: owner/name:branch | owner/name:#N, sha?}")
        key, sha = body["key"], body.get("sha")
        if sha is not None and not (isinstance(sha, str) and SHA_RE.match(sha)):
            raise HTTPException(400, "sha is a commit sha")
        with self._lock:
            items = [d for d in self.done() if d["key"] != key]
            storage.write_json(data_dir() / "done.json", {"$axf": "push-banner-done@1", "items": items})
        if sha:  # still open on GitHub: off the banner until it gets a new commit
            cfg = self.config()
            hidden = [h for h in cfg["hidden"] if not h.startswith(f"{key}@")] + [f"{key}@{sha}"]
            self.save_config({"hidden": hidden[-MAX_HIDDEN:]})
        self._forget()
        return {"removed": key, "hiddenUntilNewCommit": bool(sha)}

    # ---- one entry's details
    def detail(self, repo: Any, number: Any = None, branch: Any = None) -> dict[str, Any]:
        if repo not in self.config()["repos"]:
            raise HTTPException(400, "that repo isn't watched here")
        gh = self.gh()
        out: dict[str, Any] = {"commits": [], "checks": [], "mergeState": "", "files": None, "error": ""}
        try:
            if number is not None:
                if not isinstance(number, int) or number <= 0:
                    raise HTTPException(400, "number is the PR number")
                p = gh.get(github.repo_path(repo, "pulls", number))
                if not isinstance(p, dict):
                    raise HTTPException(404, "no such PR")
                sha = _text((p.get("head") or {}).get("sha"), 40)
                st = p.get("mergeable_state")
                out["mergeState"] = st if isinstance(st, str) and len(st) < 20 else ""
                out["files"] = p.get("changed_files") if isinstance(p.get("changed_files"), int) else None
                out["body"] = _text(p.get("body"), 600)
                commits = gh.get(github.repo_path(repo, "pulls", number, "commits", query={"per_page": 100}))
            else:
                if not valid_branch(branch):
                    raise HTTPException(400, "send a PR number or a branch")
                info = gh.repo(repo)
                base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
                cmp = gh.get(compare_path(repo, base, branch).replace("?per_page=1", "?per_page=100"))
                commits = cmp.get("commits") if isinstance(cmp, dict) else []
                out["files"] = len(cmp.get("files") or []) if isinstance(cmp, dict) and isinstance(cmp.get("files"), list) else None
                sha = _text(self._head(gh, repo, branch).get("sha"), 40)
            for c in reversed(commits if isinstance(commits, list) else []):
                if not isinstance(c, dict) or len(out["commits"]) >= 20:
                    continue
                inner = c.get("commit") if isinstance(c.get("commit"), dict) else {}
                who = inner.get("author") if isinstance(inner.get("author"), dict) else {}
                out["commits"].append({"sha": _text(c.get("sha"), 40), "subject": _text(str(inner.get("message") or "").split("\n")[0]),
                                       "author": _text(who.get("name"), 60), "date": _text(who.get("date"), 40), "url": _safe_url(c.get("html_url"))})
            try:
                runs = self._checks(gh, repo, sha) if sha else []
            except ValueError:  # not a commit sha
                runs = []
            for r in runs:
                out["checks"].append({"name": _text(r.get("name"), 120), "status": _text(r.get("status"), 20), "conclusion": _text(r.get("conclusion"), 20),
                                      "url": _safe_url(r.get("html_url"))})
            out["sha"] = sha
        except (github.GitHubError, ValueError) as e:
            out["error"] = _text(str(e))
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
            task = self._task(repo, p, "merge", "merge it")
            sha = _text((p.get("head") or {}).get("sha"), 40)
            pbase = _text((p.get("base") or {}).get("ref") if isinstance(p.get("base"), dict) else "", 200) or "main"
            # Up to date with its base first (Oct 30 2026): a PR behind main gets main pulled in and re-tested, then merges.
            behind = self._behind(gh, repo, pbase, sha) if sha else None
            if behind is None:
                raise HTTPException(409, f"GitHub couldn't say whether it's up to date with {pbase}: try again in a moment")
            if behind > 0 or p.get("mergeable_state") == "behind":
                raise HTTPException(409, f"it's behind {pbase}: pull {pbase} in first (auto-merge does it, then waits for CI on the new head)")
            if p.get("mergeable") is False:
                raise HTTPException(409, "GitHub can't merge it: it has conflicts" + self._hand({**task, "failure": "it has conflicts with its base"}))
            if p.get("mergeable") is not True:
                raise HTTPException(409, "GitHub is still working out whether it can merge: try again in a moment")
            ci = ci_state(self._checks(gh, repo, sha)) if sha else "none"
            if ci == "failure":
                raise HTTPException(409, "its CI failed" + self._hand({**task, "failure": "CI failed on its head commit"}))
            if ci != "success":
                raise HTTPException(409, {"running": "its CI is still running", "none": "it has no CI result yet"}.get(ci, "its CI isn't green"))
            r = gh.json("PUT", github.repo_path(repo, "pulls", number, "merge"), {"merge_method": "merge", "sha": sha})
        except github.GitHubError as e:
            hand = self._hand({**task, "failure": f"GitHub refused the merge: {_text(str(e), 160)}"}) if "task" in locals() and getattr(e, "status", 0) in (405, 409, 422) else ""
            raise HTTPException(502, _text(str(e)) + hand) from None
        self._forget()
        merged = bool(isinstance(r, dict) and r.get("merged"))
        base = _text((p.get("base") or {}).get("ref") if isinstance(p.get("base"), dict) else "", 200)
        if merged:
            self._remember({"key": f"{repo}:#{number}", "kind": "merged", "repo": repo, "base": base, "number": number,
                            "title": _text(p.get("title")), "url": _safe_url(p.get("html_url")), "text": f"Merged #{number} into {base or 'main'}."})
        return {"merged": merged, "sha": _text(r.get("sha"), 40) if isinstance(r, dict) else "", "url": _safe_url(p.get("html_url"))}


    # ---- auto-merge (Oct 30 2026; 0.5.0: every branch through a PR, pulled up to date with main before it merges)
    def auto_merge(self) -> list[dict[str, Any]]:
        """One round (module docstring, "Auto-merge"): opens a PR for every branch without one (autoPr), then per repo
        takes the open PRs oldest first and does one thing with the first one that can go: pull its base in when it is
        behind (then it waits for CI on the new head), wait while its CI runs, or merge it through `merge` (CI re-checked,
        head pinned, 0 behind). At most one merge per round. Then branch protection, at most every 6 h. Never raises."""
        cfg = self.config()
        if not cfg["autoMerge"] or not (self.token() or "").strip():
            return []
        done: list[dict[str, Any]] = []
        try:
            state = self.branches(force=True)
        except Exception as e:  # noqa: BLE001 — GitHub down: try again next round
            return [{"error": _text(str(e), 200)}]
        if cfg["autoPr"]:
            for r in state.get("repos", []):
                for b in r.get("branches", []):
                    name = b.get("name")
                    if b.get("pr") or b.get("hidden") or b.get("error") or not valid_branch(name) or name in NO_AUTO_PR or name == r.get("base"):
                        continue
                    try:
                        res = self.open_pr({"repo": r["repo"], "branch": name})
                        done.append({"branch": f"{r['repo']}:{name}", "opened": res.get("number"), "existing": bool(res.get("existing"))})
                    except HTTPException as e:
                        done.append({"branch": f"{r['repo']}:{name}", "opened": None, "why": _text(str(e.detail), 200)})
                    except Exception as e:  # noqa: BLE001
                        done.append({"branch": f"{r['repo']}:{name}", "opened": None, "why": _text(str(e), 200)})
        # a failed pull is skipped until its PR gets a new commit (a fix) or it is taken off Pull failed
        failed = {d["key"]: d.get("sha", "") for d in self.failed()}
        merged_one = False
        gh = self.gh()
        for r in state.get("repos", []):
            repo, base = r["repo"], r.get("base") or "main"
            queue = [p for p in r.get("pulls", []) if isinstance(p.get("number"), int) and not p.get("draft") and not p.get("hidden")
                     and not p.get("fork") and p.get("base") == base and failed.get(f"{repo}:#{p['number']}", None) not in ("", p.get("sha"))]
            queue.sort(key=lambda p: (p.get("created") or p.get("updated") or "", p["number"]))  # oldest first
            for p in queue:
                key = f"{repo}#{p['number']}"
                line = {"pr": key, "title": p.get("title", "")}
                if p.get("ci") in ("failure", "none", "unknown"):
                    continue  # nothing to do until it is fixed (or, without CI, never)
                try:
                    behind = self._behind(gh, repo, base, p["sha"]) if p.get("sha") else None
                except (github.GitHubError, ValueError):
                    behind = None
                if behind is None:
                    done.append({**line, "merged": False, "why": "GitHub couldn't say whether it's up to date: next round"})
                    break
                if behind > 0 or p.get("mergeState") == "behind":
                    try:
                        self.update({"repo": repo, "number": p["number"], "confirm": key})
                        done.append({**line, "merged": False, "pulled": True, "why": f"{behind} behind {base}: pulled {base} in, waiting for CI on the new head"})
                        break  # one at a time: this one goes first once its new CI is green
                    except HTTPException as e:  # conflicts: in Pull failed (and Fix with Claude when on); the next PR gets its turn
                        fk = f"{repo}:#{p['number']}"
                        hit = next((d for d in self.failed() if d["key"] == fk), None)
                        if hit:
                            self._set_failed(fk, {**{k: v for k, v in hit.items() if k not in ("key", "at")}, "sha": p.get("sha", "")})
                        done.append({**line, "merged": False, "pulled": False, "why": _text(str(e.detail), 200)})
                        continue
                if p.get("ci") == "running" or p.get("mergeable") is not True:
                    done.append({**line, "merged": False, "why": "waiting: CI is running on its head" if p.get("ci") == "running" else "waiting: GitHub is working out whether it can merge"})
                    break
                if merged_one:
                    done.append({**line, "merged": False, "why": "ready: merges next round (one merge per round)"})
                    break
                try:
                    res = self.merge({"repo": repo, "number": p["number"], "confirm": key})
                    merged_one = bool(res.get("merged"))
                    done.append({**line, "merged": merged_one})
                except HTTPException as e:
                    done.append({**line, "merged": False, "why": _text(str(e.detail), 200)})
                except Exception as e:  # noqa: BLE001
                    done.append({**line, "merged": False, "why": _text(str(e), 200)})
                break
        try:
            self.protect_all()
        except Exception:  # noqa: BLE001 — protection is best effort; the systems check says what's wrong
            pass
        if done:
            try:
                storage.write_json(data_dir() / "auto-merge.json", {"$axf": "push-banner-automerge@1", "at": int(self.clock() * 1000), "last": done[:50]})
            except OSError:
                pass
        return done

    # ---- branch protection on the default branch (0.5.0): require a PR, branches up to date, the CI every PR runs
    def protection(self) -> dict[str, Any]:
        raw = storage.read_json(data_dir() / "protection.json", {}) or {}
        repos = raw.get("repos") if isinstance(raw, dict) and isinstance(raw.get("repos"), dict) else {}
        watched = self.config()["repos"]
        return {"at": raw.get("at") if isinstance(raw, dict) else None, "repos": {k: v for k, v in repos.items() if k in watched and isinstance(v, dict)}}

    def _required_checks(self, gh: github.GitHubClient, repo: str, base: str) -> list[str]:
        """The check names every recent PR into <base> ran (the intersection over the last few merged PRs' heads): a
        required check that some PRs never run would hold them forever, so only those."""
        pulls = gh.get(github.repo_path(repo, "pulls", query={"state": "closed", "base": base, "per_page": 10, "sort": "updated", "direction": "desc"}))
        names: set[str] | None = None
        for p in [x for x in (pulls if isinstance(pulls, list) else []) if isinstance(x, dict) and x.get("merged_at")][:5]:
            sha = _text((p.get("head") or {}).get("sha"), 40)
            if not sha:
                continue
            got = {_text(c.get("name"), 120) for c in self._checks(gh, repo, sha) if c.get("name")}
            names = got if names is None else names & got
        return sorted(names or [])

    def protect(self, gh: github.GitHubClient, repo: str) -> dict[str, Any]:
        """Turn on (never loosen) protection on <repo>'s default branch. Returns what it found/did."""
        info = gh.repo(repo)
        base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
        out: dict[str, Any] = {"base": base, "state": "unknown", "error": "", "checks": []}
        path = github.repo_path(repo, "branches", base, "protection")
        try:
            cur = gh.get(path)
        except github.GitHubError as e:
            if getattr(e, "status", 0) != 404:  # 404 = not protected yet; 403 etc. = the token may not read it
                return {**out, "state": "cannot", "error": _text(str(e), 300)}
            cur = {}
        cur = cur if isinstance(cur, dict) else {}
        rsc = cur.get("required_status_checks") if isinstance(cur.get("required_status_checks"), dict) else None
        rpr = cur.get("required_pull_request_reviews") if isinstance(cur.get("required_pull_request_reviews"), dict) else None
        have_checks = [c for c in (rsc or {}).get("contexts", []) if isinstance(c, str)] if rsc else []
        if rsc and rsc.get("strict") is True and rpr is not None and have_checks:
            return {**out, "state": "protected", "checks": have_checks}
        if rpr and (rpr.get("dismissal_restrictions") or rpr.get("bypass_pull_request_allowances")):
            # rewriting those could loosen them: leave the branch as it is and say what's missing
            return {**out, "state": "cannot", "checks": have_checks, "error": "it has review restrictions the banner won't rewrite: turn on "
                    "'Require branches to be up to date' and a required check on GitHub (Settings → Branches)"}
        want = have_checks or self._required_checks(gh, repo, base)
        reviews = {"required_approving_review_count": 0}
        if rpr:  # keep every review rule it already has
            reviews = {k: rpr[k] for k in ("dismiss_stale_reviews", "require_code_owner_reviews", "required_approving_review_count", "require_last_push_approval") if k in rpr}
            reviews.setdefault("required_approving_review_count", 0)
        restr = cur.get("restrictions") if isinstance(cur.get("restrictions"), dict) else None
        body = {
            "required_status_checks": {"strict": True, "contexts": sorted(set(want))},
            # unchanged when set; admins are held to it too when it's new, so nothing reaches main except through a PR
            "enforce_admins": bool((cur.get("enforce_admins") or {}).get("enabled")) if cur else True,
            "required_pull_request_reviews": reviews,
            "restrictions": {"users": [u.get("login") for u in restr.get("users", []) if isinstance(u, dict)],
                             "teams": [t.get("slug") for t in restr.get("teams", []) if isinstance(t, dict)],
                             "apps": [a.get("slug") for a in restr.get("apps", []) if isinstance(a, dict)]} if restr else None,
        }
        for k in ("required_linear_history", "allow_force_pushes", "allow_deletions", "required_conversation_resolution", "lock_branch", "block_creations"):
            if isinstance(cur.get(k), dict) and isinstance(cur[k].get("enabled"), bool):
                body[k] = cur[k]["enabled"]
        try:
            gh.json("PUT", path, body)
        except github.GitHubError as e:
            return {**out, "state": "cannot", "error": _text(str(e), 300)}
        return {**out, "state": "protected", "checks": body["required_status_checks"]["contexts"], "set": True}

    def protect_all(self, force: bool = False) -> dict[str, Any]:
        cur = self.protection()
        now = self.clock()
        if not force and isinstance(cur.get("at"), (int, float)) and now - cur["at"] / 1000 < PROTECT_EVERY_S and set(cur["repos"]) >= set(self.config()["repos"]):
            return cur
        if not (self.token() or "").strip():
            return cur
        gh = self.gh()
        repos: dict[str, Any] = {}
        for repo in self.config()["repos"]:
            try:
                repos[repo] = self.protect(gh, repo)
            except (github.GitHubError, ValueError) as e:
                repos[repo] = {"base": "main", "state": "cannot", "error": _text(str(e), 300), "checks": []}
        out = {"$axf": "push-banner-protection@1", "at": int(now * 1000), "repos": repos}
        storage.write_json(data_dir() / "protection.json", out)
        return {"at": out["at"], "repos": repos}

    def merge_branch(self, body: Any) -> dict[str, Any]:
        """No direct merges (0.5.0, Oct 30 2026, Brett: "I want everything to need a PR"): a branch reaches main only
        through its pull request, brought up to date with main and re-tested first. Always refused."""
        raise HTTPException(409, "branches don't merge straight into main any more: open a PR (Open PR); auto-merge pulls main in and merges it once CI on its up-to-date head is green")

    def update(self, body: Any) -> dict[str, Any]:
        """Pull main in; a pull GitHub refuses (or can't be done) goes to the "Pull failed" group, one that works leaves it."""
        try:
            out = self._update(body)
        except HTTPException as e:
            if e.status_code in (409, 502) and isinstance(body, dict):
                key = failed_key(body)
                if key:
                    self._set_failed(key, {"repo": body["repo"], "number": body.get("number"), "branch": body.get("branch") or "", "error": _text(e.detail, 300)})
            raise
        key = failed_key(body)
        if key and any(d["key"] == key for d in self.failed()):
            self._set_failed(key, None)
        return out

    def _update(self, body: Any) -> dict[str, Any]:
        """Pull the default branch into a branch behind it (never touches the default branch itself)."""
        if not isinstance(body, dict) or set(body) - {"repo", "number", "branch", "confirm"}:
            raise HTTPException(400, "send {repo, number | branch, confirm}")
        repo, number, branch = body.get("repo"), body.get("number"), body.get("branch")
        if repo not in self.config()["repos"]:
            raise HTTPException(400, "that repo isn't watched here")
        gh = self.gh()
        try:
            if number is not None:
                if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
                    raise HTTPException(400, "number is the PR number")
                if body.get("confirm") != f"{repo}#{number}":
                    raise HTTPException(400, f'confirm with "{repo}#{number}"')
                p = gh.get(github.repo_path(repo, "pulls", number))
                if not isinstance(p, dict) or p.get("state") != "open":
                    raise HTTPException(409, "that PR isn't open")
                task = self._task(repo, p, "conflict", "pull main in")
                sha = _text((p.get("head") or {}).get("sha"), 40)
                gh.json("PUT", github.repo_path(repo, "pulls", number, "update-branch"), {"expected_head_sha": sha})
                self._forget()
                base = _text((p.get("base") or {}).get("ref") if isinstance(p.get("base"), dict) else "", 200)
                self._remember({"key": f"{repo}:#{number}", "kind": "pulled", "repo": repo, "base": base, "number": number,
                                "title": _text(p.get("title")), "url": _safe_url(p.get("html_url")), "text": f"Pulled {base or 'main'} into #{number}."})
                return {"updated": True, "url": _safe_url(p.get("html_url"))}
            if not valid_branch(branch):
                raise HTTPException(400, "send a PR number or a branch")
            if body.get("confirm") != f"{repo}:{branch}":
                raise HTTPException(400, f'confirm with "{repo}:{branch}"')
            info = gh.repo(repo)
            base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
            if branch == base:
                raise HTTPException(400, "that is the default branch")
            task = {"repo": repo, "branch": branch, "base": base, "kind": "conflict", "action": "pull main in", "title": branch}
            r = gh.json("POST", github.repo_path(repo, "merges"), {
                "base": branch, "head": base, "commit_message": f"Merge {base} into {branch} (Dev Console Push banner)"})
        except github.GitHubError as e:
            if getattr(e, "status", 0) in (409, 422):
                hand = self._hand({**task, "failure": "it has conflicts with the default branch"}) if "task" in locals() else ""
                raise HTTPException(409, "it has conflicts with the default branch (or GitHub can't update it)" + (hand or ": merge it by hand")) from None
            raise HTTPException(502, _text(str(e))) from None
        self._forget()
        self._remember({"key": f"{repo}:{branch}", "kind": "pulled", "repo": repo, "base": base, "branch": branch, "title": branch,
                        "url": f"{github.GIT_BASE}/{repo}/compare/{quote(base, safe='/')}...{quote(branch, safe='/')}", "text": f"Pulled {base} into {branch}."})
        return {"updated": True, "sha": _text(r.get("sha"), 40) if isinstance(r, dict) else ""}


    # ---- Claude on failure
    @staticmethod
    def _task(repo: str, p: dict[str, Any], kind: str, action: str) -> dict[str, Any]:
        head, base = p.get("head") or {}, p.get("base") or {}
        fork = isinstance(head.get("repo"), dict) and head["repo"].get("full_name") != repo
        return {"repo": repo, "number": p.get("number"), "branch": "" if fork else _text(head.get("ref"), 200),
                "base": _text(base.get("ref"), 200) or "main", "title": _text(p.get("title")), "url": _safe_url(p.get("html_url")),
                "kind": kind, "action": action}

    def _hand(self, task: dict[str, Any]) -> str:
        """Hand a failure to headless Claude Code when the setting is on; the words appended to the error. Never raises."""
        if not task.get("branch") or task["branch"] == task.get("base"):
            return ""  # forks and the default branch are never handed over
        try:
            job = CLAUDE.maybe_launch(task)
        except Exception:  # noqa: BLE001
            return ""
        if not job:
            return ""
        if job["state"] == "failed":
            return f". Claude Code couldn't be started: {job['message']}"
        cx.log("system", f"push banner: {task['action']} failed on {task['repo']} {task.get('number') or task['branch']}; asked axHub to start Claude Code (needs your approval)", "info")
        return ". Handed to Claude Code on the VPS: approve it on axHub, then follow it in the building banner"

    def claude_fix(self, body: Any) -> dict[str, Any]:
        """Fix with Claude by hand: any watched PR or branch (not a fork, never the default branch)."""
        if not isinstance(body, dict) or set(body) - {"repo", "number", "branch", "confirm", "repair", "rest"}:
            raise HTTPException(400, "send {repo, number | branch, confirm, repair?, rest?}")
        repair = body.get("repair") is True
        rest = body.get("rest", [])  # Pull all stopped here: the other branches of this repo the session pulls main into too
        if not isinstance(rest, list) or len(rest) > 20 or not all(valid_branch(b) for b in rest) or (rest and not repair):
            raise HTTPException(400, "rest is a list of up to 20 branch names (with repair: true)")  # the Repair badge on a failed pull: asked for by hand, so the setting isn't needed
        if not repair and not self.config()["claudeOnFail"]:
            raise HTTPException(409, "Turn on “Hand failures to Claude Code” in Settings → Plugins → Push banner first")
        repo, number, branch = body.get("repo"), body.get("number"), body.get("branch")
        if repo not in self.config()["repos"]:
            raise HTTPException(400, "that repo isn't watched here")
        gh = self.gh()
        try:
            if number is not None:
                if not isinstance(number, int) or isinstance(number, bool) or number <= 0:
                    raise HTTPException(400, "number is the PR number")
                if body.get("confirm") != f"{repo}#{number}":
                    raise HTTPException(400, f'confirm with "{repo}#{number}"')
                p = gh.get(github.repo_path(repo, "pulls", number))
                if not isinstance(p, dict) or p.get("state") != "open":
                    raise HTTPException(409, "that PR isn't open")
                task = self._task(repo, p, "conflict" if p.get("mergeable") is False else "merge", "get it ready to merge")
                task["failure"] = "Brett asked for a fix (" + ("it has conflicts" if p.get("mergeable") is False else "it can't merge as is") + ")"
            else:
                if not valid_branch(branch) or body.get("confirm") != f"{repo}:{branch}":
                    raise HTTPException(400, f'send a branch and confirm with "{repo}:<branch>"')
                info = gh.repo(repo)
                base = info.get("default_branch") if isinstance(info, dict) and valid_branch(info.get("default_branch")) else "main"
                task = {"repo": repo, "branch": branch, "base": base, "kind": "conflict", "action": "pull main in", "title": branch,
                        "failure": "Brett asked for a fix (it has conflicts with the default branch)"}
        except github.GitHubError as e:
            raise HTTPException(502, _text(str(e))) from None
        if not task.get("branch") or task["branch"] == task["base"]:
            raise HTTPException(400, "forks and the default branch can't be handed over")
        if repair:
            task = {**task, "kind": "conflict", "action": "pull main in", "failure": "the banner's Pull main in failed; Brett tapped Repair",
                    "rest": [b for b in dict.fromkeys(rest) if b not in (task["branch"], task["base"])]}
            if rest:
                task["failure"] = "the banner's Pull all stopped at a failed pull and handed this repo's pulls to this session"
        job = CLAUDE.maybe_launch(task, force=True, by_hand=repair)
        if not job:
            raise HTTPException(400, "that can't be handed over")
        return {"job": job}


PUSHES = Pushes()
CLAUDE = claudefix.Launches(lambda: PUSHES.config())


class ProtectionChecks:
    """axf.syscheck.items@1 (one provider per name, so this one is named …:push-protection): the systems check lists
    these items and runs `fix` for Auto fix."""

    def items(self) -> list[dict[str, Any]]:
        if not (PUSHES.token() or "").strip():
            return []
        cur = PUSHES.protection()
        out = []
        for repo in PUSHES.config()["repos"]:
            st = cur["repos"].get(repo)
            title = f"Branch protection: {repo}"
            if not st:
                out.append({"id": f"protect:{repo}", "title": title, "status": "info", "autoFix": True,
                            "summary": "not checked yet: Auto fix sets it (require a PR, branches up to date with main, the CI every PR runs)"})
            elif st.get("state") == "protected":
                checks = st.get("checks") or []
                out.append({"id": f"protect:{repo}", "title": title, "status": "ok" if checks else "info", "autoFix": not checks,
                            "summary": f"{st.get('base', 'main')} needs a PR that is up to date with it" + (f" and green {', '.join(checks)[:160]}" if checks else
                                                                                                           "; no required check yet (no CI name every PR runs): Auto fix looks again")})
            else:
                out.append({"id": f"protect:{repo}", "title": title, "status": "warn", "autoFix": True,
                            "summary": f"couldn't protect {st.get('base', 'main')}: {_text(st.get('error'), 200)}",
                            "details": ["Every change reaches main through a PR that is up to date with main and re-tested (Brett, Oct 30 2026). "
                                        "The push banner enforces it itself; GitHub's branch protection makes it hold for everyone else too.",
                                        f"Give the console's GITHUB_TOKEN Administration: Read and write on {repo} (fine-grained token → Repository "
                                        "permissions), or a classic token with repo scope. Private repos on a free plan need GitHub Pro for protection.",
                                        "Then tap Auto fix: it sets require a PR, require branches to be up to date and the CI checks every PR runs, "
                                        "and never loosens what is already set."]})
        return out

    def fix(self, item_id: str) -> str:
        res = PUSHES.protect_all(force=True)
        repo = item_id.split(":", 1)[1] if ":" in item_id else ""
        st = res["repos"].get(repo, {})
        if st.get("state") == "protected":
            return f"{repo}: {st.get('base', 'main')} is protected"
        raise HTTPException(409, f"{repo}: still can't protect it: {_text(st.get('error'), 200) or 'GITHUB_TOKEN isn’t set'}")


claudefix.plugin_services.provide("axf.syscheck.items@1:push-protection", ProtectionChecks(), "push-banner")

AUTO_MERGE_EVERY_S = max(60, int(os.environ.get("AXF_PUSH_AUTOMERGE_S", "180") or 180))


def _auto_merge_loop() -> None:
    """Runs in the console server: every few minutes, merge whatever is ready (setting autoMerge, on by default).
    No Claude session and no tokens: GitHub calls only. AXF_PUSH_AUTOMERGE=off stops the loop."""
    while True:
        time.sleep(AUTO_MERGE_EVERY_S)
        try:
            PUSHES.auto_merge()
        except Exception:  # noqa: BLE001 — never take the server down
            pass


if os.environ.get("AXF_PUSH_AUTOMERGE", "").lower() != "off":
    threading.Thread(target=_auto_merge_loop, name="push-banner-auto-merge", daemon=True).start()


@router.get("/branches")
def branches(refresh: bool = False) -> dict[str, Any]:
    return PUSHES.branches(force=refresh)


def _tracked(kind: str, verb: str, body: Any, fn: Callable[[Any], dict[str, Any]]) -> dict[str, Any]:
    """Runs one push / pull / merge and shows it in the Activity banner while it runs (axf.activity@1, optional:
    without the Activity plugin it just runs)."""
    act = claudefix.plugin_services.get("axf.activity@1")
    b = body if isinstance(body, dict) else {}
    what = str(b.get("repo") or "")[:140] + (f" #{b['number']}" if b.get("number") else f" · {str(b.get('branch'))[:120]}" if b.get("branch") else "")
    iid = f"push-banner:{kind}:{int(time.time() * 1000)}"
    if act:
        try:
            act.report({"id": iid, "kind": kind, "source": "git", "title": f"{verb} {what}".strip(), "state": "running",
                        "url": f"https://github.com/{b['repo']}" if github.valid_repo(str(b.get("repo") or "")) else None}, "push-banner")
        except Exception:  # noqa: BLE001 — the banner never blocks the work
            act = None
    try:
        out = fn(body)
    except HTTPException as e:
        if act:
            act.finish(iid, "failed", str(e.detail)[:300])
        raise
    except Exception as e:
        if act:
            act.finish(iid, "failed", str(e)[:300])
        raise
    if act:
        act.finish(iid, "done", None)
    return out


@router.post("/pr")
def open_pr(body: Any = Body(None)) -> dict[str, Any]:
    return _tracked("push", "Open pull request", body, PUSHES.open_pr)


@router.post("/merge")
def merge(body: Any = Body(None)) -> dict[str, Any]:
    return _tracked("merge", "Merge", body, PUSHES.merge)


@router.post("/auto-merge")
def auto_merge_now() -> dict[str, Any]:
    """Run auto-merge once now (the banner's "Merge everything ready" and tests)."""
    return {"results": PUSHES.auto_merge()}


@router.get("/auto-merge")
def auto_merge_last() -> dict[str, Any]:
    raw = storage.read_json(data_dir() / "auto-merge.json", {}) or {}
    cfg = PUSHES.config()
    return {"on": cfg["autoMerge"], "autoPr": cfg["autoPr"], "everyS": AUTO_MERGE_EVERY_S, "last": raw.get("last", []), "at": raw.get("at"),
            "protection": PUSHES.protection()["repos"]}


@router.get("/protection")
def get_protection() -> dict[str, Any]:
    return PUSHES.protection()


@router.post("/protection")
def set_protection() -> dict[str, Any]:
    return PUSHES.protect_all(force=True)


@router.post("/merge-branch")
def merge_branch(body: Any = Body(None)) -> dict[str, Any]:
    return _tracked("merge", "Merge", body, PUSHES.merge_branch)


@router.post("/update")
def update(body: Any = Body(None)) -> dict[str, Any]:
    return _tracked("pull", "Pull main into", body, PUSHES.update)


@router.get("/detail")
def detail(repo: str, number: int | None = None, branch: str | None = None) -> dict[str, Any]:
    return PUSHES.detail(repo, number, branch)


@router.post("/done/remove")
def remove_done(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.remove_done(body)


@router.post("/failed/remove")
def remove_failed(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.remove_failed(body)


@router.get("/claude")
def claude_jobs() -> dict[str, Any]:
    cfg = PUSHES.config()
    ok, why = claudefix.mosses_ready()
    return {"on": cfg["claudeOnFail"], "shell": cfg["claudeShell"], "hubToken": bool(os.environ.get("AXHUB_TOKEN")), "mosses": ok, "mossesWhy": why,
            "changes": claudefix.plugin_services.get(claudefix.CHANGES) is not None, "jobs": CLAUDE.all()}


@router.post("/claude")
def claude_fix(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.claude_fix(body)


@router.get("/config")
def get_config() -> dict[str, Any]:
    return PUSHES.config()


@router.put("/config")
def put_config(body: Any = Body(None)) -> dict[str, Any]:
    return PUSHES.save_config(body)
