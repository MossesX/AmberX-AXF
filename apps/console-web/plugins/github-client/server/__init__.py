"""GitHub client — server part (github-client@1; DESIGN.md, contract.json). Mounted at /api/plugins/github-client/
(console token on every method, 404 while the plugin is off).

Every pull request of the project's repos with its status, checks, distance from main, conflicts and linked build;
every action on them (merge through the merge queue, pull main in, rebase, close, reopen, comment, re-run checks,
labels), batches (several PRs merged together on one branch and landed as one PR), bulk actions, branches, commits,
diffs and one searchable git log. plugin-commands@1 turns each route into a REST command, an MCP tool, a CLI command
and a voice command, with the flags plugin.json → commands.items declares.

GitHub is read and written through lib-github (`axf_server.github`): the token goes to the API origin only and never
reaches the browser. Work the API cannot do (rebase, batch branches, conflict heal) runs in a scratch clone in the
plugin's data folder (git_env auth: never argv, never on disk). Long actions are jobs (`GET job/{id}`).

Who may do what: a command whose caller says it is Claude (`X-Axf-By` from plugin-commands, or `by` in the body)
never merges, pulls main in, rebases, lands a batch or runs a bulk action (403): those are Brett's.
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import tempfile
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import StreamingResponse

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, storage

from . import core

FOLDER = Path(__file__).resolve().parents[1].name
router = APIRouter()

MERGE_QUEUE = "axf.merge-queue@1"
DISPATCH = "axf.build-dispatch@1"
LIST_MAX = 100  # open PRs read per repo
CLAUDE_DENIED = {"merge", "update-main", "rebase", "group-land", "bulk"}
POOL = ThreadPoolExecutor(max_workers=8, thread_name_prefix="gh-client")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_GITHUB_CLIENT_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _bad(status: int, msg: str) -> HTTPException:
    return HTTPException(status, core.text(msg, 500))


def _repo(repo: Any) -> str:
    r = str(repo or "").strip()
    if not github.valid_repo(r):
        raise _bad(400, "repo is owner/name")
    return r


def _num(n: Any) -> int:
    try:
        v = int(n)
    except (TypeError, ValueError):
        raise _bad(400, "n is the PR number") from None
    if v <= 0:
        raise _bad(400, "n is the PR number")
    return v


def _branch(b: Any) -> str:
    if not core.valid_branch(b):
        raise _bad(400, "that isn't a branch name")
    return str(b)


def actor_of(request: Request | None, body: Any = None) -> dict[str, str]:
    """Who asks: the plugin-commands proxy sets X-Axf-By (MCP, CLI, voice); the console's own UI sends nothing."""
    by = ""
    if request is not None:
        by = request.headers.get("x-axf-by", "")
    if not by and isinstance(body, dict) and isinstance(body.get("by"), str):
        by = body["by"]
    by = core.text(by, 80)
    if not by:
        return {"kind": "console", "name": "console"}
    low = by.lower()
    kind = "claude" if "claude" in low or low.startswith(("session", "agent")) else "queue" if low == "queue" else "api"
    return {"kind": kind, "name": by}


def deny_claude(command: str, who: dict[str, str]) -> None:
    if who["kind"] == "claude" and command in CLAUDE_DENIED:
        raise _bad(403, f"{command} is Brett's: a Claude session never merges, pulls main in, rebases or lands PRs (the merge queue lands everything)")


# ================================================================================================ GitHub access

class GitHubApi:
    """One place every GitHub call goes through. Tests replace `call` with a fake (method, path, body, query) → JSON."""

    def __init__(self, token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", "")) -> None:
        self.token = token
        self.calls = 0
        self.rate: dict[str, Any] = {}

    def client(self) -> github.GitHubClient:
        return github.GitHubClient(self.token, base_url=github.api_base_from_env(), user_agent="axf-console-github-client", timeout=20, max_bytes=8_000_000)

    def call(self, method: str, path: str, body: Any = None, query: dict[str, Any] | None = None) -> Any:
        self.calls += 1
        c = self.client()
        r = c.call(method, path, body, query=query)
        h = {str(k).lower(): v for k, v in (r.headers or {}).items()}
        if str(h.get("x-ratelimit-remaining", "")).isdigit():
            self.rate = {"remaining": int(h["x-ratelimit-remaining"]), "reset": int(h.get("x-ratelimit-reset") or 0)}
        if not r.ok:
            msg = c.message(r) or "request failed"
            raise github.GitHubError(r.status, f"GitHub {r.status}: {msg}")
        if not r.body:
            return None
        try:
            return r.json()
        except ValueError:
            return None

    def get(self, path: str, **query: Any) -> Any:
        return self.call("GET", path, query=query or None)

    def all(self, path: str, key: str | None = None, max_items: int = 300, **query: Any) -> list[Any]:
        out: list[Any] = []
        page = 1
        while len(out) < max_items and page <= 10:
            data = self.get(path, per_page=100, page=page, **query)
            items = (data or {}).get(key, []) if key else data
            if not isinstance(items, list) or not items:
                break
            out += items
            if len(items) < 100:
                break
            page += 1
        return out[:max_items]


API = GitHubApi()


def rp(repo: str, *parts: Any, **query: Any) -> str:
    """/repos/<owner>/<name>/<parts…>?query. Unlike github.repo_path a part may hold a branch with slashes or a
    compare range (main...feat/x); every piece is percent-quoted and `.` / `..` pieces are refused."""
    from urllib.parse import quote, urlencode
    if not github.valid_repo(repo):
        raise _bad(400, "repo is owner/name")
    out = []
    for p in parts:
        s = str(p)
        if not s or any(x in (".", "..", "") for x in s.split("/")) or any(ord(ch) < 33 for ch in s):
            raise _bad(400, f"odd path part {s[:40]!r}")
        out.append(quote(s, safe="/.-_~"))
    q = {k: v for k, v in query.items() if v is not None}
    return f"/repos/{repo}/" + "/".join(out) + (("?" + urlencode(q)) if q else "")


# ================================================================================================ the service

class Client:
    def __init__(self, api: GitHubApi = API) -> None:
        self.api = api
        self.lock = threading.RLock()
        self._prs: dict[str, tuple[float, list[dict[str, Any]]]] = {}
        self._memo: dict[str, Any] = {}  # immutable-ish answers keyed by SHAs / updated_at
        self.version = 0  # bumps on every change the open views should see (GET events)
        self.last_error = ""
        self.last_poll = 0.0
        self._ticker: threading.Thread | None = None

    # ---------------------------------------------------------------- config + repos
    def config(self) -> dict[str, Any]:
        c = storage.read_json(data_dir() / "config.json", {})
        return {**core.DEFAULT_CONFIG, **({k: v for k, v in c.items() if k in core.DEFAULT_CONFIG} if isinstance(c, dict) else {})}

    def set_config(self, body: Any) -> dict[str, Any]:
        try:
            cfg = core.check_config(body, self.config(), github.valid_repo)
        except ValueError as e:
            raise _bad(400, str(e)) from None
        storage.write_json(data_dir() / "config.json", {"$axf": "github-client-config@1", **cfg})
        self.changed(drop=True)
        return cfg

    def repos(self) -> list[dict[str, Any]]:
        """The project's repos: the console's own repo, the active project's manifest repo(s), the extra repos setting."""
        seen: dict[str, dict[str, Any]] = {}
        pj = cx.project() or {}

        def add(r: Any, source: str, default_branch: str = "main") -> None:
            if github.valid_repo(r) and r not in seen:
                seen[r] = {"repo": r, "project": pj.get("id", ""), "defaultBranch": default_branch or "main", "source": source}
        rep = pj.get("repo")
        for r in (rep if isinstance(rep, list) else [rep]):
            if isinstance(r, dict):
                add(f"{r.get('owner')}/{r.get('name')}", "manifest", str(r.get("defaultBranch") or "main"))
            elif isinstance(r, str):
                add(r, "manifest")
        add(cx.GITHUB_REPO or os.environ.get("AXF_GITHUB_REPO", ""), "console")
        q = self.queue_state()
        add(q.get("repo"), "merge-queue")
        for r in self.config()["extraRepos"]:
            add(r, "extra")
        out = list(seen.values())
        for i, r in enumerate(out):
            r["selected"] = i == 0
        return out

    def default_repo(self, repo: Any = None) -> str:
        if repo:
            return _repo(repo)
        rs = self.repos()
        if not rs:
            raise _bad(400, "no repo: set one under Settings → Plugins → GitHub client (extra repos)")
        return rs[0]["repo"]

    def default_branch(self, repo: str) -> str:
        return next((r["defaultBranch"] for r in self.repos() if r["repo"] == repo), "main")

    # ---------------------------------------------------------------- outside state: merge queue, builds
    def queue_state(self) -> dict[str, Any]:
        svc = plugin_services.get(MERGE_QUEUE)
        if svc is None:
            return {"on": False}
        try:
            return svc.queue() or {"on": False}
        except Exception:  # noqa: BLE001 — the queue's own trouble: show the PRs anyway
            return {"on": False}

    def queue_of(self, repo: str) -> dict[int, dict[str, Any]]:
        q = self.queue_state()
        if not q.get("on") or q.get("repo") != repo:
            return {}
        out: dict[int, dict[str, Any]] = {}
        batch = set((q.get("batch") or {}).get("prs") or [])
        for i, it in enumerate(q.get("items") or []):
            n = it.get("pr")
            if isinstance(n, int):
                out[n] = {"state": "landing" if n in batch else "queued", "position": i}
        return out

    def builds_index(self) -> dict[str, dict[str, Any]]:
        """branch / "pr:<n>" → {id, title, status} from the builds store (the fields builds-live.mjs link sets)."""
        f = cx.ROOT / "_claude" / "builds" / "store.json"
        try:
            mt = f.stat().st_mtime
        except OSError:
            return {}
        memo = self._memo.get("builds")
        if memo and memo[0] == mt:
            return memo[1]
        idx: dict[str, dict[str, Any]] = {}
        store = storage.read_json(f, {})
        for b in (store.get("builds") or []) if isinstance(store, dict) else []:
            if not isinstance(b, dict) or b.get("deleted"):
                continue
            ref = {"id": core.text(b.get("id"), 120), "title": core.text(b.get("title"), 160), "status": core.text(b.get("status"), 40)}
            if b.get("branch"):
                idx[str(b["branch"])] = ref
            pr = str(b.get("pr") or "")
            m = re.search(r"(\d+)\s*$", pr)
            if m:
                idx[f"pr:{m.group(1)}"] = ref
        self._memo["builds"] = (mt, idx)
        return idx

    # ---------------------------------------------------------------- pull requests
    def _memo_get(self, key: str, fn: Callable[[], Any]) -> Any:
        if key in self._memo:
            return self._memo[key]
        v = fn()
        if len(self._memo) > 4000:
            builds = self._memo.get("builds")
            self._memo.clear()
            if builds:
                self._memo["builds"] = builds
        self._memo[key] = v
        return v

    def checks_of(self, repo: str, sha: str, final_only: bool = True) -> dict[str, Any]:
        key = f"checks:{repo}:{sha}"
        if key in self._memo:
            return self._memo[key]
        runs = self.api.get(rp(repo, "commits", sha, "check-runs"), per_page=100) or {}
        statuses = self.api.get(rp(repo, "commits", sha, "statuses"), per_page=100) or []
        s = core.checks_summary(runs.get("check_runs") or [], statuses, github.run_state)
        if s["state"] in ("success", "failure"):  # a finished SHA never changes unless re-run (rerun drops it)
            self._memo[key] = s
        return s

    def _enrich(self, repo: str, raw: dict[str, Any], base_sha: str, policy: dict[str, Any], builds: dict[str, Any], queue: dict[int, Any]) -> dict[str, Any]:
        n = int(raw["number"])
        head_sha = (raw.get("head") or {}).get("sha", "")
        upd = raw.get("updated_at", "")
        try:
            detail = self._memo_get(f"pr:{repo}:{n}:{upd}:{base_sha}", lambda: self.api.get(rp(repo, "pulls", n)))
            if isinstance(detail, dict) and detail.get("mergeable") is None:
                self._memo.pop(f"pr:{repo}:{n}:{upd}:{base_sha}", None)  # GitHub is still computing it: ask next time
            compare = self._memo_get(f"cmp:{repo}:{base_sha}:{head_sha}", lambda: self.api.get(rp(repo, "compare", f"{(raw.get('base') or {}).get('ref', 'main')}...{head_sha}")))
            reviews = self._memo_get(f"rev:{repo}:{n}:{upd}", lambda: self.api.get(rp(repo, "pulls", n, "reviews"), per_page=100))
            checks = self.checks_of(repo, head_sha) if head_sha else None
        except github.GitHubError as e:
            detail, compare, reviews, checks = None, None, None, None
            self.last_error = core.text(str(e), 200)
        head = (raw.get("head") or {}).get("ref", "")
        build = builds.get(head) or builds.get(f"pr:{n}")
        compare_small = {"behind_by": (compare or {}).get("behind_by"), "ahead_by": (compare or {}).get("ahead_by")} if isinstance(compare, dict) else None
        return core.pr_record(raw, repo=repo, detail=detail, checks=checks, compare=compare_small, reviews=reviews if isinstance(reviews, list) else None,
                              build=build, queue=queue.get(n), policy=policy)

    def prs(self, repo: str, force: bool = False) -> list[dict[str, Any]]:
        cfg = self.config()
        with self.lock:
            hit = self._prs.get(repo)
            if hit and not force and time.time() - hit[0] < cfg["pollMinutes"] * 60:
                return hit[1]
        if not (self.api.token() or "").strip():
            raise _bad(503, "GITHUB_TOKEN isn't set on the console server (the GitHub App keeper sets it)")
        try:
            raws = self.api.all(rp(repo, "pulls"), max_items=LIST_MAX, state="open", sort="updated", direction="desc")
            base = self.default_branch(repo)
            base_sha = ((self.api.get(rp(repo, "branches", base)) or {}).get("commit") or {}).get("sha", "")
        except github.GitHubError as e:
            self.last_error = core.text(str(e), 200)
            if hit:
                return hit[1]
            raise _bad(502, str(e)) from None
        builds, queue = self.builds_index(), self.queue_of(repo)
        out = list(POOL.map(lambda r: self._enrich(repo, r, base_sha, cfg, builds, queue), [r for r in raws if isinstance(r, dict) and r.get("number")]))
        with self.lock:
            changed = not hit or json.dumps(hit[1], sort_keys=True) != json.dumps(out, sort_keys=True)
            self._prs[repo] = (time.time(), out)
            self.last_poll = time.time()
            self.last_error = "" if not self.last_error.startswith("GitHub") else self.last_error
            if changed:
                self.version += 1
        return out

    def pr(self, repo: str, n: int, fresh: bool = True) -> dict[str, Any]:
        """One PR (open or not), read fresh from GitHub."""
        try:
            raw = self.api.get(rp(repo, "pulls", n))
        except github.GitHubError as e:
            raise _bad(404 if e.status == 404 else 502, str(e)) from None
        if not isinstance(raw, dict):
            raise _bad(404, f"no PR #{n} in {repo}")
        base_sha = ""
        try:
            base_sha = ((self.api.get(rp(repo, "branches", (raw.get("base") or {}).get("ref", "main"))) or {}).get("commit") or {}).get("sha", "")
        except github.GitHubError:
            pass
        self._memo[f"pr:{repo}:{n}:{raw.get('updated_at', '')}:{base_sha}"] = raw
        return self._enrich(repo, raw, base_sha, self.config(), self.builds_index(), self.queue_of(repo))

    def find(self, repo: str, n: int) -> dict[str, Any]:
        for p in self.prs(repo):
            if p["number"] == n:
                return p
        return self.pr(repo, n)

    def pr_checks(self, repo: str, n: int) -> list[dict[str, Any]]:
        p = self.api.get(rp(repo, "pulls", n)) or {}
        return self.checks(repo, (p.get("head") or {}).get("sha", ""))

    def checks(self, repo: str, ref: str) -> list[dict[str, Any]]:
        if not ref:
            raise _bad(400, "ref is a branch, a SHA or pr:<n>")
        if ref.startswith("pr:"):
            return self.pr_checks(repo, _num(ref[3:]))
        runs = (self.api.get(rp(repo, "commits", ref, "check-runs"), per_page=100) or {}).get("check_runs") or []
        statuses = self.api.get(rp(repo, "commits", ref, "statuses"), per_page=100) or []
        out: list[dict[str, Any]] = []
        for r in runs:
            m = re.search(r"/actions/runs/(\d+)/job/(\d+)", str(r.get("html_url") or "")) or re.search(r"/runs/(\d+)", str(r.get("details_url") or ""))
            out.append({"repo": repo, "ref": ref, "name": core.text(r.get("name"), 160), "kind": "check-run",
                        "state": github.run_state(r.get("status"), r.get("conclusion")) if r.get("conclusion") not in ("skipped",) else "skipped",
                        "startedAt": core.text(r.get("started_at"), 40), "finishedAt": core.text(r.get("completed_at"), 40),
                        "url": core.text(r.get("html_url"), 400), "workflow": core.text(((r.get("check_suite") or {}).get("app") or {}).get("name"), 80),
                        **({"runId": int(m.group(1))} if m else {}), **({"jobId": int(m.group(2))} if m and m.lastindex and m.lastindex >= 2 else {})})
        seen: set[str] = set()
        for s in statuses:
            if s.get("context") in seen:
                continue
            seen.add(str(s.get("context")))
            st = {"success": "success", "failure": "failure", "error": "failure", "pending": "running"}.get(s.get("state"), "queued")
            out.append({"repo": repo, "ref": ref, "name": core.text(s.get("context"), 160), "kind": "status", "state": st,
                        "startedAt": core.text(s.get("created_at"), 40), "finishedAt": core.text(s.get("updated_at"), 40),
                        "url": core.text(s.get("target_url"), 400), "description": core.text(s.get("description"), 200)})
        return out

    def pr_commits(self, repo: str, n: int) -> list[dict[str, Any]]:
        return [self.commit_record(repo, c) for c in self.api.all(rp(repo, "pulls", n, "commits"), max_items=250)]

    def pr_files(self, repo: str, n: int) -> list[dict[str, Any]]:
        return [file_record(f) for f in self.api.all(rp(repo, "pulls", n, "files"), max_items=300)]

    # ---------------------------------------------------------------- commits, branches, diffs (s6)
    def commit_record(self, repo: str, c: dict[str, Any], files: bool = False) -> dict[str, Any]:
        cm = c.get("commit") or {}
        rec = {"repo": repo, "sha": core.text(c.get("sha"), 40), "message": core.text(cm.get("message"), 4000),
               "author": core.text((c.get("author") or {}).get("login") or (cm.get("author") or {}).get("name"), 80),
               "at": core.text((cm.get("author") or {}).get("date") or (cm.get("committer") or {}).get("date"), 40),
               "parents": [core.text(p.get("sha"), 40) for p in c.get("parents") or [] if isinstance(p, dict)],
               "url": core.text(c.get("html_url"), 400)}
        if c.get("stats"):
            rec["stats"] = {"additions": int(c["stats"].get("additions") or 0), "deletions": int(c["stats"].get("deletions") or 0)}
        if files:
            rec["files"] = [file_record(f) for f in c.get("files") or []]
        return rec

    def commits(self, repo: str, branch: str, page: int = 1) -> dict[str, Any]:
        page = max(1, min(int(page or 1), 50))
        data = self.api.get(rp(repo, "commits"), sha=branch, per_page=50, page=page) or []
        return {"repo": repo, "branch": branch, "page": page, "more": len(data) == 50, "items": [self.commit_record(repo, c) for c in data]}

    def commit(self, repo: str, sha: str) -> dict[str, Any]:
        if not re.fullmatch(r"[0-9a-f]{7,40}", sha):
            raise _bad(400, "sha is a commit SHA")
        return self.commit_record(repo, self.api.get(rp(repo, "commits", sha)) or {}, files=True)

    def diff(self, repo: str, base: str, head: str) -> dict[str, Any]:
        d = self.api.get(rp(repo, "compare", f"{base}...{head}")) or {}
        return {"repo": repo, "base": base, "head": head, "status": core.text(d.get("status"), 20), "ahead": int(d.get("ahead_by") or 0),
                "behind": int(d.get("behind_by") or 0), "commits": [self.commit_record(repo, c) for c in (d.get("commits") or [])[-100:]],
                "files": [file_record(f) for f in (d.get("files") or [])[:300]], "url": core.text(d.get("html_url"), 400)}

    def branches(self, repo: str) -> list[dict[str, Any]]:
        default = self.default_branch(repo)
        raws = self.api.all(rp(repo, "branches"), max_items=300)
        heads: dict[str, int] = {}
        try:
            for p in self.prs(repo):
                heads[p["head"]] = p["number"]
        except HTTPException:
            pass

        def one(b: dict[str, Any]) -> dict[str, Any]:
            sha = (b.get("commit") or {}).get("sha", "")
            rec = {"repo": repo, "name": core.text(b.get("name"), 200), "sha": sha, "ahead": 0, "behind": 0,
                   "lastCommit": {"sha": sha, "message": "", "author": "", "at": ""}, "pr": heads.get(b.get("name")),
                   "protected": bool(b.get("protected")), "default": b.get("name") == default}
            if rec["default"]:
                return rec
            try:
                cmp_ = self._memo_get(f"bcmp:{repo}:{default}:{sha}", lambda: _small_compare(self.api.get(rp(repo, "compare", f"{default}...{sha}"), per_page=1)))
                rec.update(ahead=cmp_["ahead"], behind=cmp_["behind"], lastCommit=cmp_["last"] or rec["lastCommit"])
            except github.GitHubError:
                pass
            return rec
        return list(POOL.map(one, [b for b in raws if isinstance(b, dict)]))

    def branch(self, repo: str, name: str) -> dict[str, Any]:
        b = self.api.get(rp(repo, "branches", name)) or {}
        c = b.get("commit") or {}
        default = self.default_branch(repo)
        cmp_ = {"ahead": 0, "behind": 0}
        if name != default:
            cmp_ = _small_compare(self.api.get(rp(repo, "compare", f"{default}...{c.get('sha', name)}"), per_page=1))
        pr = next((p["number"] for p in self._prs.get(repo, (0, []))[1] if p["head"] == name), None)
        return {"repo": repo, "name": name, "sha": c.get("sha", ""), "ahead": cmp_["ahead"], "behind": cmp_["behind"],
                "lastCommit": self.commit_record(repo, c) if c else {}, "pr": pr, "protected": bool(b.get("protected")), "default": name == default}

    # ---------------------------------------------------------------- status + live
    def status(self) -> dict[str, Any]:
        tok = bool((self.api.token() or "").strip())
        q = self.queue_state()
        log_last = LOG.last_failure()
        return {"$axf": "github-client-status@1", "token": "set" if tok else "missing", "rate": self.api.rate, "calls": self.api.calls,
                "lastPoll": core.iso(self.last_poll) if self.last_poll else "", "lastError": self.last_error,
                "queue": {"on": bool(q.get("on")), "repo": q.get("repo", ""), "depth": len(q.get("items") or [])},
                "jobs": JOBS.summary(), "lastFailure": log_last, "version": self.version}

    def changed(self, repo: str = "", drop: bool = False) -> None:
        with self.lock:
            if drop:
                if repo:
                    self._prs.pop(repo, None)
                else:
                    self._prs.clear()
            self.version += 1


def _small_compare(d: Any) -> dict[str, Any]:
    d = d if isinstance(d, dict) else {}
    commits = d.get("commits") or []
    last = commits[-1] if commits else None
    lc = None
    if isinstance(last, dict):
        cm = last.get("commit") or {}
        lc = {"sha": core.text(last.get("sha"), 40), "message": core.text(cm.get("message"), 200).split("\n")[0],
              "author": core.text((last.get("author") or {}).get("login") or (cm.get("author") or {}).get("name"), 80),
              "at": core.text((cm.get("author") or {}).get("date"), 40)}
    return {"ahead": int(d.get("ahead_by") or 0), "behind": int(d.get("behind_by") or 0), "last": lc}


def file_record(f: dict[str, Any]) -> dict[str, Any]:
    return {"path": core.text(f.get("filename"), 400), "status": core.text(f.get("status"), 20), "additions": int(f.get("additions") or 0),
            "deletions": int(f.get("deletions") or 0), "previous": core.text(f.get("previous_filename"), 400),
            "patch": str(f.get("patch") or "")[:60_000], "truncated": f.get("patch") is None and int(f.get("changes") or 0) > 0}


# ================================================================================================ log + jobs (filled by later sections)

class Log:
    """log.jsonl, append-only: every git action this plugin did or saw (DESIGN.md §4 Git log)."""

    def file(self) -> Path:
        return data_dir() / "log.jsonl"

    def all(self) -> list[dict[str, Any]]:
        try:
            lines = self.file().read_text(encoding="utf-8").splitlines()
        except OSError:
            return []
        out = []
        for ln in lines:
            try:
                e = json.loads(ln)
            except ValueError:
                continue
            if isinstance(e, dict) and e.get("id"):
                out.append(e)
        return out

    def add(self, kind: str, repo: str, **kw: Any) -> dict[str, Any]:
        e = core.log_entry(kind, repo, seq=f"lg-{time.time_ns():x}", **kw)
        storage.append_jsonl(self.file(), e)
        if e["outcome"] == "failed":
            what = f"#{e['target']['pr']}" if e["target"].get("pr") else e["target"].get("branch") or e["target"].get("group") or repo
            cx.raise_alert({"source": "github-client", "severity": "error", "key": f"github-client:{kind}:{repo}:{what}",
                            "title": f"GitHub client: {kind.replace('-', ' ')} failed on {what}", "body": e.get("why", "")[:400],
                            "link": f"screen:github-client log {what}"})
        CLIENT.changed()
        return e

    def last_failure(self) -> dict[str, Any] | None:
        for e in reversed(self.all()[-200:]):
            if e.get("outcome") == "failed":
                return {"id": e["id"], "at": e["at"], "kind": e["kind"], "why": e.get("why", "")}
        return None


class Jobs:
    """Long actions (DESIGN.md §5): one at a time per repo, per-item results, persisted in jobs/<id>.json."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.repo_locks: dict[str, threading.Lock] = {}
        self.live: dict[str, dict[str, Any]] = {}
        self.cancel: set[str] = set()
        self.runs: dict[str, Callable[[dict[str, Any]], None]] = {}

    def dir(self) -> Path:
        return data_dir() / "jobs"

    def save(self, job: dict[str, Any]) -> None:
        storage.write_json(self.dir() / f"{job['id']}.json", job)
        CLIENT.changed()

    def start(self, kind: str, repo: str, items: list[str], who: dict[str, str], fn: Callable[[dict[str, Any]], None], meta: dict[str, Any] | None = None,
              wait: bool = False) -> dict[str, Any]:
        job = {"$axf": "github-client-job@1", "id": f"job-{time.time_ns():x}", "kind": kind, "repo": repo, "state": "queued",
               "items": [{"target": t, "state": "pending"} for t in items], "startedAt": core.iso(), "by": who["name"], "meta": meta or {}}
        with self.lock:
            self.live[job["id"]] = job
            lock = self.repo_locks.setdefault(repo, threading.Lock())
        self.save(job)

        def run() -> None:
            with lock:
                if job["id"] in self.cancel:
                    job["state"] = "cancelled"
                else:
                    job["state"] = "running"
                    self.save(job)
                    try:
                        fn(job)
                        job["state"] = "cancelled" if job["id"] in self.cancel else ("failed" if any(i["state"] == "failed" for i in job["items"]) else "done")
                    except Exception as e:  # noqa: BLE001 — a job never takes the console down; it records why
                        job["state"] = "failed"
                        job["error"] = core.text(github.scrub(str(e), [API.token()]), 500)
                job["finishedAt"] = core.iso()
                self.save(job)
                with self.lock:
                    self.live.pop(job["id"], None)
        self.runs[job["id"]] = fn
        if wait:
            run()
        else:
            threading.Thread(target=run, daemon=True, name=f"gh-job-{job['id']}").start()
        return job

    def item(self, job: dict[str, Any], target: str, state: str, note: str = "") -> None:
        for it in job["items"]:
            if it["target"] == target:
                it["state"] = state
                if note:
                    it["note"] = core.text(note, 500)
        self.save(job)

    def cancelled(self, job: dict[str, Any]) -> bool:
        return job["id"] in self.cancel

    def get(self, jid: str) -> dict[str, Any]:
        if not re.fullmatch(r"job-[0-9a-f]{6,20}", jid or ""):
            raise _bad(400, "that isn't a job id")
        j = self.live.get(jid) or storage.read_json(self.dir() / f"{jid}.json", None)
        if not isinstance(j, dict):
            raise _bad(404, "no such job")
        return j

    def list(self, limit: int = 50) -> list[dict[str, Any]]:
        d = self.dir()
        files = sorted(d.glob("job-*.json"), key=lambda p: p.stat().st_mtime, reverse=True)[:limit] if d.is_dir() else []
        return [j for j in (storage.read_json(f, None) for f in files) if isinstance(j, dict)]

    def summary(self) -> dict[str, Any]:
        recent = self.list(10)
        return {"running": len(self.live), "lastFailed": next((j["id"] for j in recent if j.get("state") == "failed"), "")}


CLIENT = Client()
LOG = Log()
JOBS = Jobs()


# ================================================================================================ routes: reads

@router.get("/repos")
def get_repos() -> dict[str, Any]:
    """Repos of this project (manifest, the console's repo, the merge queue's, extra repos)."""
    return {"items": CLIENT.repos()}


@router.get("/prs")
def get_prs(repo: str = "", filter: str = "all", sort: str = "updated", q: str = "", refresh: bool = False) -> dict[str, Any]:  # noqa: A002
    """Open pull requests with status, checks, commits behind, conflicts, linked build, queue position and readiness."""
    if filter not in core.FILTERS:
        raise _bad(400, f"filter is one of {', '.join(core.FILTERS)}")
    if sort not in core.SORTS:
        raise _bad(400, f"sort is one of {', '.join(core.SORTS)}")
    r = CLIENT.default_repo(repo)
    allp = CLIENT.prs(r, force=refresh)
    me = CLIENT.config()["me"]
    items = core.select(allp, filter, sort, q, me)
    return {"repo": r, "filter": filter, "sort": sort, "q": q, "counts": core.counts(allp, me), "total": len(allp), "items": items,
            "policy": {k: CLIENT.config()[k] for k in ("requireGreenChecks", "allowNoChecks", "requireReview", "doNotMergeLabel", "staleDays", "mergeMethod")},
            "queue": {"on": bool(CLIENT.queue_of(r)) or (CLIENT.queue_state().get("on") and CLIENT.queue_state().get("repo") == r)},
            "polledAt": core.iso(CLIENT._prs.get(r, (time.time(),))[0]), "version": CLIENT.version}


@router.get("/pr/{owner}/{name}/{n}")
def get_pr(owner: str, name: str, n: int) -> dict[str, Any]:
    """One pull request, read fresh."""
    return CLIENT.pr(_repo(f"{owner}/{name}"), _num(n))


@router.get("/pr/{owner}/{name}/{n}/checks")
def get_pr_checks(owner: str, name: str, n: int) -> dict[str, Any]:
    """Checks of a pull request's head commit."""
    return {"items": CLIENT.pr_checks(_repo(f"{owner}/{name}"), _num(n))}


@router.get("/pr/{owner}/{name}/{n}/commits")
def get_pr_commits(owner: str, name: str, n: int) -> dict[str, Any]:
    """Commits of a pull request."""
    return {"items": CLIENT.pr_commits(_repo(f"{owner}/{name}"), _num(n))}


@router.get("/pr/{owner}/{name}/{n}/files")
def get_pr_files(owner: str, name: str, n: int) -> dict[str, Any]:
    """Files a pull request changes, with patches."""
    return {"items": CLIENT.pr_files(_repo(f"{owner}/{name}"), _num(n))}


@router.get("/checks")
def get_checks(repo: str, ref: str) -> dict[str, Any]:
    """Check runs and statuses for a branch, a SHA or pr:<n>."""
    r = _repo(repo)
    return {"repo": r, "ref": ref, "items": CLIENT.checks(r, ref.strip())}


@router.get("/status")
def get_status() -> dict[str, Any]:
    """Token, rate limit, last poll, last error, merge queue on/off, jobs."""
    return CLIENT.status()


@router.get("/config")
def get_config() -> dict[str, Any]:
    """Settings."""
    return CLIENT.config()


@router.put("/config")
def put_config(body: Any = Body(...)) -> dict[str, Any]:
    """Change settings (a partial object)."""
    return CLIENT.set_config(body)


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    """Server-sent events: `change` with the version whenever records change, while a view is open."""
    import asyncio

    async def gen():
        last = -1
        while not await request.is_disconnected():
            if CLIENT.version != last:
                last = CLIENT.version
                yield f"event: change\ndata: {json.dumps({'version': last})}\n\n"
            await asyncio.sleep(2)
    return StreamingResponse(gen(), media_type="text/event-stream")


# ================================================================================================ commands (s3)

from .work import GitError, Work  # noqa: E402 — after the service it uses

WORK = Work(data_dir, lambda: API.token(), cx.ROOT)


def _gh(fn: Callable[[], Any], what: str) -> Any:
    try:
        return fn()
    except github.GitHubError as e:
        raise _bad(e.status if e.status in (403, 404, 405, 409, 422) else 502, f"{what}: {e}") from None


class Actions:
    """Every PR action. Each logs (outcome, why, who); failures raise an alert through the log."""

    def merge(self, repo: str, n: int, body: dict[str, Any], who: dict[str, str]) -> dict[str, Any]:
        deny_claude("merge", who)
        cfg = CLIENT.config()
        pr = CLIENT.pr(repo, n)
        if pr["state"] != "open":
            raise _bad(409, f"#{n} is {pr['state']}")
        force = body.get("force") is True and who["kind"] == "console"
        if not pr["ready"] and not force:
            LOG.add("merge-failed", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why="not ready: " + "; ".join(pr["why"]))
            raise _bad(409, f"#{n} is not ready: {'; '.join(pr['why'])}")
        method = body.get("method") or cfg["mergeMethod"]
        if method not in core.METHODS:
            raise _bad(400, f"method is one of {', '.join(core.METHODS)}")
        q = CLIENT.queue_state()
        svc = plugin_services.get(MERGE_QUEUE)
        if method == "queue" and q.get("on") and q.get("repo") == repo and svc is not None and hasattr(svc, "add"):
            try:
                svc.add(n, core.text(body.get("why"), 200))
            except HTTPException as e:
                LOG.add("merge-failed", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why=f"merge queue refused: {e.detail}")
                raise
            LOG.add("queue-add", repo, target={"pr": n, "branch": pr["head"], "sha": pr["headSha"]}, actor=who, why=core.text(body.get("why"), 300))
            CLIENT.changed(repo, drop=True)
            return {"ok": True, "queued": True, "merged": False, "text": f"#{n} is in the merge queue: it lands with the next batch once that batch's CI is green."}
        if method == "queue":
            method = "squash"  # no queue for this repo: GitHub merges it now
        try:
            r = API.call("PUT", rp(repo, "pulls", n, "merge"), {"merge_method": method, "sha": pr["headSha"]})
        except github.GitHubError as e:
            LOG.add("merge-failed", repo, target={"pr": n, "branch": pr["head"], "sha": pr["headSha"]}, actor=who, outcome="failed", why=str(e))
            raise _bad(409 if e.status in (405, 409, 422) else 502, str(e)) from None
        sha = core.text((r or {}).get("sha"), 40)
        LOG.add("merge", repo, target={"pr": n, "branch": pr["head"], "sha": sha}, actor=who, details=f"{method} into {pr['base']}")
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "merged": True, "sha": sha, "text": f"#{n} merged ({method})."}

    def update_main(self, repo: str, n: int, who: dict[str, str], wait: bool = False) -> dict[str, Any]:
        deny_claude("update-main", who)
        pr = CLIENT.pr(repo, n)
        if pr["state"] != "open":
            raise _bad(409, f"#{n} is {pr['state']}")
        if pr["behind"] == 0:
            return {"ok": True, "text": f"#{n} is already up to date with {pr['base']}."}
        try:
            API.call("PUT", rp(repo, "pulls", n, "update-branch"), {"expected_head_sha": pr["headSha"]})
            LOG.add("update-main", repo, target={"pr": n, "branch": pr["head"]}, actor=who, details=f"{pr['behind']} commits of {pr['base']} pulled in (GitHub update-branch)")
            CLIENT.changed(repo, drop=True)
            return {"ok": True, "text": f"Pulling {pr['base']} into #{n} ({pr['behind']} commits)."}
        except github.GitHubError as e:
            if e.status != 422:
                LOG.add("update-main", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why=str(e))
                raise _bad(502, str(e)) from None
        # GitHub can't (a conflict): merge in a scratch clone, where builds files heal by themselves
        def run(job: dict[str, Any]) -> None:
            t = f"#{n}"
            try:
                r = WORK.update_from_base(repo, pr["head"], pr["base"], CLIENT.default_branch(repo))
            except GitError as e:
                JOBS.item(job, t, "failed", str(e))
                LOG.add("update-main", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why=str(e))
                return
            if r["ok"]:
                JOBS.item(job, t, "ok", f"merged {pr['base']} in ({core.text(r['sha'], 8)}); builds files healed")
                LOG.add("update-main", repo, target={"pr": n, "branch": pr["head"], "sha": r["sha"]}, actor=who, details="merged in a scratch clone (builds files healed)")
                LOG.add("push", repo, target={"pr": n, "branch": pr["head"], "sha": r["sha"]}, actor=who)
            else:
                why = f"conflicts outside the builds files: {', '.join(r['conflicts'])[:400]}"
                JOBS.item(job, t, "failed", why)
                LOG.add("update-main", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why=why, details="Ask Claude to fix (row action) or resolve on the branch")
            CLIENT.changed(repo, drop=True)
        job = JOBS.start("update-main", repo, [f"#{n}"], who, run, wait=wait)
        return {"ok": True, "job": job, "text": f"GitHub can't pull {pr['base']} into #{n} by itself: merging it in a scratch clone (job {job['id']})."}

    def rebase(self, repo: str, n: int, who: dict[str, str]) -> dict[str, Any]:
        deny_claude("rebase", who)
        pr = CLIENT.pr(repo, n)
        if pr["state"] != "open":
            raise _bad(409, f"#{n} is {pr['state']}")

        def run(job: dict[str, Any]) -> None:
            try:
                r = WORK.rebase(repo, pr["head"], pr["base"], CLIENT.default_branch(repo))
            except GitError as e:
                r = {"ok": False, "why": str(e), "conflicts": []}
            if r["ok"]:
                JOBS.item(job, f"#{n}", "ok", f"rebased onto {pr['base']} ({core.text(r['sha'], 8)})")
                LOG.add("rebase", repo, target={"pr": n, "branch": pr["head"], "sha": r["sha"]}, actor=who, saved_sha=r.get("was", ""), details=f"onto {pr['base']}; the old head is saved")
            else:
                why = r.get("why") or f"conflicts: {', '.join(r.get('conflicts') or [])[:400]}"
                JOBS.item(job, f"#{n}", "failed", why)
                LOG.add("rebase", repo, target={"pr": n, "branch": pr["head"]}, actor=who, outcome="failed", why=why)
            CLIENT.changed(repo, drop=True)
        job = JOBS.start("rebase", repo, [f"#{n}"], who, run)
        return {"ok": True, "job": job, "text": f"Rebasing #{n} onto {pr['base']} (job {job['id']})."}

    def set_state(self, repo: str, n: int, state: str, who: dict[str, str], why: str = "") -> dict[str, Any]:
        _gh(lambda: API.call("PATCH", rp(repo, "pulls", n), {"state": state}), f"{'close' if state == 'closed' else 'reopen'} #{n}")
        if why and state == "closed":
            _gh(lambda: API.call("POST", rp(repo, "issues", n, "comments"), {"body": f"Closed from the console: {why}"}), "comment")
        LOG.add("close" if state == "closed" else "reopen", repo, target={"pr": n}, actor=who, why=why)
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "text": f"#{n} {'closed' if state == 'closed' else 'reopened'}."}

    def comment(self, repo: str, n: int, body: str, who: dict[str, str]) -> dict[str, Any]:
        if not isinstance(body, str) or not body.strip():
            raise _bad(400, "body is the comment text")
        r = _gh(lambda: API.call("POST", rp(repo, "issues", n, "comments"), {"body": body[:60_000]}), f"comment on #{n}")
        LOG.add("comment", repo, target={"pr": n}, actor=who, details=body[:300])
        return {"ok": True, "url": core.text((r or {}).get("html_url"), 400), "text": f"Commented on #{n}."}

    def rerun(self, repo: str, n: int, failed_only: bool, who: dict[str, str]) -> dict[str, Any]:
        pr = CLIENT.pr(repo, n)
        runs = (_gh(lambda: API.get(rp(repo, "actions", "runs"), head_sha=pr["headSha"], per_page=50), "workflow runs") or {}).get("workflow_runs") or []
        done = []
        for r in runs:
            st = github.run_state(r.get("status"), r.get("conclusion"))
            if st in ("queued", "waiting", "running") or (failed_only and st != "failure"):
                continue
            try:
                API.call("POST", rp(repo, "actions", "runs", int(r["id"]), "rerun-failed-jobs" if failed_only else "rerun"))
                done.append(core.text(r.get("name"), 80))
            except github.GitHubError as e:
                LOG.add("rerun-checks", repo, target={"pr": n}, actor=who, outcome="failed", why=f"{r.get('name')}: {e}")
        CLIENT._memo.pop(f"checks:{repo}:{pr['headSha']}", None)
        CLIENT.changed(repo, drop=True)
        if done:
            LOG.add("rerun-checks", repo, target={"pr": n, "sha": pr["headSha"]}, actor=who, details=("failed jobs of " if failed_only else "") + ", ".join(done))
        return {"ok": True, "runs": done, "text": f"Re-running {'failed jobs of ' if failed_only else ''}{len(done)} run(s) on #{n}." if done else f"Nothing to re-run on #{n}."}

    def ready_for_review(self, repo: str, n: int, who: dict[str, str]) -> dict[str, Any]:
        raw = _gh(lambda: API.get(rp(repo, "pulls", n)), f"#{n}") or {}
        if not raw.get("draft"):
            return {"ok": True, "text": f"#{n} is not a draft."}
        q = "mutation($id: ID!) { markPullRequestReadyForReview(input: {pullRequestId: $id}) { pullRequest { isDraft } } }"
        r = _gh(lambda: API.call("POST", "/graphql", {"query": q, "variables": {"id": raw.get("node_id")}}), "ready for review")
        if isinstance(r, dict) and r.get("errors"):
            raise _bad(502, f"GitHub: {core.text(r['errors'][0].get('message'), 200)}")
        LOG.add("ready", repo, target={"pr": n}, actor=who)
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "text": f"#{n} is ready for review."}

    def label(self, repo: str, n: int, add: list[str], remove: list[str], who: dict[str, str]) -> dict[str, Any]:
        for lst in (add, remove):
            if not isinstance(lst, list) or any(not isinstance(x, str) or not x.strip() or len(x) > 50 for x in lst):
                raise _bad(400, "add and remove are lists of label names")
        if add:
            _gh(lambda: API.call("POST", rp(repo, "issues", n, "labels"), {"labels": add}), "add labels")
        for name in remove:
            try:
                API.call("DELETE", rp(repo, "issues", n, "labels", name))
            except github.GitHubError as e:
                if e.status != 404:
                    raise _bad(502, str(e)) from None
        LOG.add("label", repo, target={"pr": n}, actor=who, details=f"+{', '.join(add)} −{', '.join(remove)}")
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "text": f"Labels changed on #{n}."}

    def queue_remove(self, repo: str, n: int, why: str, who: dict[str, str]) -> dict[str, Any]:
        svc = plugin_services.get(MERGE_QUEUE)
        if svc is None or not hasattr(svc, "remove"):
            raise _bad(409, "the merge queue isn't available here")
        svc.remove(n, why)
        LOG.add("queue-remove", repo, target={"pr": n}, actor=who, why=why)
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "text": f"#{n} is out of the merge queue."}

    def fix_conflicts(self, repo: str, branch: str, base: str, title: str, other: str, who: dict[str, str], pr: int | None = None) -> dict[str, Any]:
        """Hand a clash to Claude: a build in the orchestrator's Queue (axf.build-dispatch@1) that merges `other` into
        `branch`, resolves the conflicts keeping both sides' intent, pushes to `branch` and never merges anything."""
        svc = plugin_services.get(DISPATCH)
        if svc is None:
            raise _bad(409, "the Build orchestrator is off: turn it on to hand conflicts to Claude")
        slug = re.sub(r"[^A-Za-z0-9._-]", "-", f"{repo.replace('/', '-')}--{branch}")[:100]
        brief = "\n".join([
            f"Resolve merge conflicts on `{branch}` in {repo} ({'PR #' + str(pr) if pr else 'batch branch'}).", "",
            "## Setup (run first, then work only there)", "```",
            "mkdir -p /root/axf-fixes/repos",
            f"[ -d /root/axf-fixes/repos/{repo.replace('/', '-')} ] || git clone -q https://github.com/{repo}.git /root/axf-fixes/repos/{repo.replace('/', '-')}",
            f"git -C /root/axf-fixes/repos/{repo.replace('/', '-')} fetch -q origin && git -C /root/axf-fixes/repos/{repo.replace('/', '-')} worktree prune",
            f"git -C /root/axf-fixes/repos/{repo.replace('/', '-')} worktree add -f -B '{branch}' /root/axf-fixes/{slug} 'origin/{branch}'",
            f"cd /root/axf-fixes/{slug}", "```", "",
            "## Do", f"1. `git merge origin/{other}` and resolve every conflict so both sides' changes survive (builds files: `node framework/cli/builds-live.mjs install` first, the driver merges them).",
            "2. Run the checks the touched code has (tests next to it), commit the merge.",
            f"3. `git push origin HEAD:{branch}` (never force, never to {base}).",
            "4. Do not merge or close any PR. The GitHub client retries the batch / Brett merges it.",
        ])
        try:
            r = svc.request(f"Fix conflicts: {repo.split('/')[-1]} {branch} ← {other}"[:200], brief[:8000], by="github-client", source="github-client", priority="P1", queue=True)
        except Exception as e:  # noqa: BLE001 — the orchestrator's own refusal
            raise _bad(409, f"the orchestrator did not take it: {getattr(e, 'detail', None) or e}") from None
        bid = core.text((r or {}).get("id"), 120)
        LOG.add("retry", repo, target={"pr": pr, "branch": branch}, actor=who, details=f"conflicts with {other} handed to Claude as build {bid}")
        return {"ok": True, "build": bid, "text": f"Handed to Claude: build {bid} is in the orchestrator's Queue."}


ACTIONS = Actions()


def _pr_route(owner: str, name: str, n: int) -> tuple[str, int]:
    return _repo(f"{owner}/{name}"), _num(n)


def _body(body: Any) -> dict[str, Any]:
    return body if isinstance(body, dict) else {}


@router.post("/pr/{owner}/{name}/{n}/merge")
def post_merge(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Merge a pull request: into the merge queue when it is on for this repo, else GitHub merges it. Refused unless ready."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.merge(repo, num, _body(body), actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/update-main")
def post_update_main(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Pull main (the base) into a pull request; a conflict becomes a job that heals builds files and reports the rest."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.update_main(repo, num, actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/rebase")
def post_rebase(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Rebase a pull request onto its base (force-push with lease to its own branch; the old head is saved in the log)."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.rebase(repo, num, actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/close")
def post_close(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Close a pull request (the branch stays)."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.set_state(repo, num, "closed", actor_of(request, body), core.text(_body(body).get("why"), 300))


@router.post("/pr/{owner}/{name}/{n}/reopen")
def post_reopen(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Reopen a closed pull request."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.set_state(repo, num, "open", actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/comment")
def post_comment(owner: str, name: str, n: int, request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Comment on a pull request."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.comment(repo, num, _body(body).get("body"), actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/rerun-checks")
def post_rerun(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Re-run the failed jobs (failedOnly, default) or every run on the pull request's head commit."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.rerun(repo, num, _body(body).get("failedOnly", True) is not False, actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/ready")
def post_ready(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Mark a draft pull request ready for review."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.ready_for_review(repo, num, actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/label")
def post_label(owner: str, name: str, n: int, request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Add or remove labels on a pull request."""
    repo, num = _pr_route(owner, name, n)
    b = _body(body)
    return ACTIONS.label(repo, num, b.get("add") or [], b.get("remove") or [], actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/queue-remove")
def post_queue_remove(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Take a pull request out of the merge queue."""
    repo, num = _pr_route(owner, name, n)
    return ACTIONS.queue_remove(repo, num, core.text(_body(body).get("why") or "taken out from the GitHub client", 200), actor_of(request, body))


@router.post("/pr/{owner}/{name}/{n}/fix-conflicts")
def post_fix_conflicts(owner: str, name: str, n: int, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Hand a pull request's conflicts with its base to Claude (a build in the orchestrator's Queue; it never merges)."""
    repo, num = _pr_route(owner, name, n)
    pr = CLIENT.pr(repo, num)
    return ACTIONS.fix_conflicts(repo, pr["head"], pr["base"], pr["title"], pr["base"], actor_of(request, body), pr=num)


@router.post("/refresh")
def post_refresh(body: Any = Body(None)) -> dict[str, Any]:
    """Drop the cache and read GitHub now."""
    repo = _body(body).get("repo")
    r = CLIENT.default_repo(repo)
    CLIENT.changed(r, drop=True)
    items = CLIENT.prs(r, force=True)
    return {"ok": True, "repo": r, "open": len(items), "text": f"{r}: {len(items)} open PRs read."}


@router.get("/jobs")
def get_jobs() -> dict[str, Any]:
    """Recent jobs (pull main in, rebase, batch, bulk) with per-item results."""
    return {"items": JOBS.list()}


@router.get("/job/{jid}")
def get_job(jid: str) -> dict[str, Any]:
    """One job."""
    return JOBS.get(jid)


@router.post("/job/{jid}/cancel")
def post_job_cancel(jid: str) -> dict[str, Any]:
    """Stop a running job between items."""
    j = JOBS.get(jid)
    if j["state"] not in ("queued", "running"):
        return {"ok": True, "text": f"{jid} is {j['state']}."}
    JOBS.cancel.add(jid)
    return {"ok": True, "text": f"{jid} stops after the item it is on."}


# ================================================================================================ batches (s4)
# Brett: "I need a way to pull main into a bunch of PRs and merge them all together as one so they don't clash with
# each other." A batch = queue/group-<slug> made from main with every member merged in order (main is in each by
# construction), one PR into main, checks run once on it. A clash between members stops the build at that member:
# Claude gets it (a build in the orchestrator's Queue) when conflictHelp is "claude", Brett is alerted, and a retry
# carries on from the fixed branch. Landing goes through the merge queue like any merge; once the batch PR is merged
# the members are closed as landed by the batch. A batch whose checks fail is rebuilt on fresh main (autoRetry times)
# before it alerts.

class Batches:
    def file(self) -> Path:
        return data_dir() / "groups.json"

    def all(self) -> list[dict[str, Any]]:
        d = storage.read_json(self.file(), {})
        return [g for g in (d.get("groups") or []) if isinstance(g, dict)] if isinstance(d, dict) else []

    def save(self, g: dict[str, Any]) -> dict[str, Any]:
        with JOBS.lock:
            rows = [x for x in self.all() if x["id"] != g["id"]] + [g]
            storage.write_json(self.file(), {"$axf": "github-client-groups@1", "groups": rows[-200:]})
        CLIENT.changed()
        return g

    def get(self, gid: str) -> dict[str, Any]:
        g = next((x for x in self.all() if x["id"] == gid), None)
        if not g:
            raise _bad(404, f"no batch {gid}")
        return g

    def members(self, repo: str, numbers: list[int]) -> list[dict[str, Any]]:
        out = []
        for n in numbers:
            p = CLIENT.pr(repo, n)
            if p["state"] != "open":
                raise _bad(409, f"#{n} is {p['state']}")
            out.append(p)
        bases = {p["base"] for p in out}
        if len(bases) > 1:
            raise _bad(409, f"the PRs go to different bases ({', '.join(sorted(bases))}): a batch has one")
        return out

    def create(self, body: dict[str, Any], who: dict[str, str], wait: bool = False) -> dict[str, Any]:
        repo = CLIENT.default_repo(body.get("repo"))
        prs = body.get("prs")
        if not isinstance(prs, list) or len({int(x) for x in prs if isinstance(x, int) and x > 0}) < 2:
            raise _bad(400, "prs lists at least two PR numbers")
        nums = list(dict.fromkeys(int(x) for x in prs if isinstance(x, int) and x > 0))
        busy = {n for g in self.all() if g["repo"] == repo and g["state"] in ("building", "open", "conflict", "landing", "checks-failed") for n in g["members"]}
        clash = sorted(set(nums) & busy)
        if clash:
            raise _bad(409, f"already in an open batch: {', '.join('#' + str(n) for n in clash)}")
        name = core.text(body.get("name") or f"Batch {' '.join('#' + str(n) for n in nums)}", 120)
        members = self.members(repo, nums)
        branch = core.group_branch(name)
        if any(g["branch"] == branch and g["state"] not in ("landed", "dissolved") for g in self.all()):
            branch = f"{branch}-{int(time.time()) % 100000}"
        g = {"id": f"grp-{time.time_ns():x}", "repo": repo, "name": name, "branch": branch, "base": members[0]["base"], "members": nums, "merged": [],
             "titles": {str(p["number"]): p["title"] for p in members}, "pr": None, "url": "", "state": "building", "conflicts": [],
             "createdAt": core.iso(), "by": who["name"], "autoLand": body.get("autoLand") is True and who["kind"] != "claude", "tries": 0, "fixBuild": "", "why": ""}
        self.save(g)
        job = self.build(g, who, keep=False, wait=wait)
        return {"ok": True, "group": self.get(g["id"]), "job": job, "text": f"Building batch {name} on {branch} from {len(nums)} PRs (job {job['id']})."}

    def build(self, g: dict[str, Any], who: dict[str, str], keep: bool, wait: bool = False) -> dict[str, Any]:
        repo = g["repo"]

        def run(job: dict[str, Any]) -> None:
            cur = self.get(g["id"])
            cur.update(state="building", why="")
            self.save(cur)
            try:
                members = self.members(repo, cur["members"])
            except HTTPException as e:
                cur.update(state="conflict", why=str(e.detail))
                self.save(cur)
                LOG.add("group-create", repo, target={"group": cur["id"], "branch": cur["branch"]}, actor=who, outcome="failed", why=str(e.detail))
                for it in job["items"]:
                    JOBS.item(job, it["target"], "failed", str(e.detail))
                return
            # main into each member first, so every PR on GitHub is current too (builds files heal by themselves)
            for p in members:
                if JOBS.cancelled(job):
                    return
                if p["behind"] > 0:
                    try:
                        API.call("PUT", rp(repo, "pulls", p["number"], "update-branch"), {"expected_head_sha": p["headSha"]})
                        LOG.add("update-main", repo, target={"pr": p["number"], "branch": p["head"], "group": cur["id"]}, actor=who, details="pulled in for the batch")
                    except github.GitHubError:
                        pass  # a member that clashes with main: the batch merge below resolves or reports it
            try:
                r = WORK.build_batch(repo, cur["base"], cur["branch"], members, default=CLIENT.default_branch(repo), keep_existing=keep,
                                     on_member=lambda m, st, note: JOBS.item(job, f"#{m['number']}", st, note))
            except GitError as e:
                cur.update(state="conflict", why=str(e))
                self.save(cur)
                LOG.add("group-create", repo, target={"group": cur["id"], "branch": cur["branch"]}, actor=who, outcome="failed", why=str(e))
                return
            cur["merged"] = r.get("merged") or []
            if r.get("sha"):
                LOG.add("push", repo, target={"branch": cur["branch"], "sha": r["sha"], "group": cur["id"]}, actor=who, details=f"batch with {', '.join('#' + str(n) for n in cur['merged'])}")
            if not r["ok"]:
                c = r.get("conflict") or {"member": r.get("missing", 0), "files": []}
                c["how"] = "open"
                cur["conflicts"] = [x for x in cur["conflicts"] if x.get("member") != c["member"]] + [c]
                who_ = f"#{c['member']}" if c.get("member") else cur["base"]
                why = f"{who_} clashes with the batch in {', '.join(c.get('files') or [])[:300]}" if c.get("files") else f"#{r.get('missing')} has no branch any more"
                cur.update(state="conflict", why=why)
                if c.get("files") and CLIENT.config()["conflictHelp"] == "claude" and cur["merged"]:
                    other = next((p["head"] for p in members if p["number"] == c.get("member")), cur["base"])
                    try:
                        fx = ACTIONS.fix_conflicts(repo, cur["branch"], cur["base"], cur["name"], other, who)
                        cur["fixBuild"] = fx.get("build", "")
                        c["how"] = f"Claude: build {cur['fixBuild']}"
                    except HTTPException as e:
                        cur["why"] += f"; not handed to Claude: {e.detail}"
                self.save(cur)
                LOG.add("group-create", repo, target={"group": cur["id"], "branch": cur["branch"]}, actor=who, outcome="failed", why=why,
                        details=(f"handed to Claude as build {cur['fixBuild']}; Retry carries on once it is fixed" if cur["fixBuild"] else "resolve on the batch branch, then Retry"))
                return
            for c in cur["conflicts"]:
                c["how"] = "resolved" if c.get("how") == "open" or str(c.get("how", "")).startswith("Claude") else c.get("how", "resolved")
            body = core.group_body(cur["name"], [{"number": p["number"], "title": p["title"], "head": p["head"]} for p in members], cur["conflicts"])
            try:
                if cur.get("pr"):
                    API.call("PATCH", rp(repo, "pulls", cur["pr"]), {"body": body, "state": "open"})
                else:
                    made = API.call("POST", rp(repo, "pulls"), {"title": f"{cur['name']} ({len(members)} PRs)", "head": cur["branch"], "base": cur["base"], "body": body})
                    cur["pr"] = int(made["number"])
                    cur["url"] = core.text(made.get("html_url"), 400)
                    LOG.add("pr-open", repo, target={"pr": cur["pr"], "branch": cur["branch"], "group": cur["id"]}, actor=who, details=f"batch of {', '.join('#' + str(n) for n in cur['members'])}")
            except (github.GitHubError, KeyError, TypeError, ValueError) as e:
                cur.update(state="conflict", why=f"batch PR: {e}")
                self.save(cur)
                LOG.add("group-create", repo, target={"group": cur["id"], "branch": cur["branch"]}, actor=who, outcome="failed", why=f"batch PR: {e}")
                return
            cur.update(state="open", why="", fixBuild="")
            self.save(cur)
            LOG.add("group-create", repo, target={"group": cur["id"], "branch": cur["branch"], "pr": cur["pr"]}, actor=who,
                    details=f"{len(members)} PRs on one branch; checks run once on #{cur['pr']}")
            cx.resolve_alerts([f"github-client:group-create:{repo}:{cur['branch']}"])
        return JOBS.start("group", repo, [f"#{n}" for n in g["members"]], who, run, meta={"group": g["id"]}, wait=wait)

    def retry(self, gid: str, who: dict[str, str], fresh: bool = False) -> dict[str, Any]:
        g = self.get(gid)
        if g["state"] in ("landed", "dissolved", "landing"):
            raise _bad(409, f"{gid} is {g['state']}")
        g["tries"] = int(g.get("tries") or 0) + 1
        self.save(g)
        LOG.add("retry", g["repo"], target={"group": gid, "branch": g["branch"]}, actor=who, details=("rebuilt on fresh main" if fresh else "carried on from the batch branch") + f" (try {g['tries']})")
        job = self.build(g, who, keep=not fresh)
        return {"ok": True, "group": g, "job": job, "text": f"Retrying batch {g['name']} (job {job['id']})."}

    def change(self, gid: str, add: list[int], remove: list[int], who: dict[str, str]) -> dict[str, Any]:
        g = self.get(gid)
        if g["state"] in ("landed", "dissolved", "landing"):
            raise _bad(409, f"{gid} is {g['state']}")
        members = [n for n in g["members"] if n not in set(remove)] + [n for n in add if n not in g["members"]]
        if len(members) < 1:
            raise _bad(400, "a batch keeps at least one PR (dissolve it instead)")
        g.update(members=members, merged=[], conflicts=[c for c in g["conflicts"] if c.get("member") in members])
        self.save(g)
        job = self.build(g, who, keep=False)  # rebuilt from main with the new member set
        return {"ok": True, "group": g, "job": job, "text": f"Rebuilding batch {g['name']} with {len(members)} PRs."}

    def land(self, gid: str, who: dict[str, str], body: dict[str, Any] | None = None) -> dict[str, Any]:
        deny_claude("group-land", who)
        g = self.get(gid)
        if g["state"] != "open" and g["state"] != "checks-failed" or not g.get("pr"):
            raise _bad(409, f"{g['name']} is {g['state']}: it lands once its PR is open and green")
        r = ACTIONS.merge(g["repo"], int(g["pr"]), body or {}, who)
        if r.get("queued"):
            g["state"] = "landing"
            self.save(g)
        elif r.get("merged"):
            self.finish(g, who)
        LOG.add("group-land", g["repo"], target={"group": gid, "pr": g["pr"], "branch": g["branch"]}, actor=who, details=r.get("text", ""))
        return {**r, "group": self.get(gid)}

    def finish(self, g: dict[str, Any], who: dict[str, str]) -> None:
        """The batch PR merged: close every member as landed by the batch."""
        for n in g["members"]:
            try:
                API.call("POST", rp(g["repo"], "issues", n, "comments"), {"body": f"Landed on {g['base']} in batch #{g['pr']} ({g['name']})."})
                API.call("PATCH", rp(g["repo"], "pulls", n), {"state": "closed"})
                LOG.add("pr-close", g["repo"], target={"pr": n, "group": g["id"]}, actor=who, details=f"landed in batch #{g['pr']}")
            except github.GitHubError as e:
                LOG.add("pr-close", g["repo"], target={"pr": n, "group": g["id"]}, actor=who, outcome="failed", why=str(e))
        g["state"] = "landed"
        self.save(g)
        CLIENT.changed(g["repo"], drop=True)

    def dissolve(self, gid: str, who: dict[str, str]) -> dict[str, Any]:
        g = self.get(gid)
        if g["state"] in ("landed", "dissolved"):
            return {"ok": True, "text": f"{g['name']} is already {g['state']}."}
        if g.get("pr"):
            try:
                API.call("PATCH", rp(g["repo"], "pulls", g["pr"]), {"state": "closed"})
                LOG.add("pr-close", g["repo"], target={"pr": g["pr"], "group": gid}, actor=who, details="batch dissolved")
            except github.GitHubError:
                pass
        try:
            BRANCHES.delete(g["repo"], g["branch"], who, why=f"batch {g['name']} dissolved")
        except HTTPException:
            pass
        g["state"] = "dissolved"
        self.save(g)
        LOG.add("group-dissolve", g["repo"], target={"group": gid, "branch": g["branch"]}, actor=who)
        return {"ok": True, "text": f"Batch {g['name']} dissolved; its PRs are untouched."}

    def tick(self) -> None:
        """Every minute: follow open batches (merged → close members; green + autoLand → land; red → rebuild or alert)."""
        cfg = CLIENT.config()
        sys_actor = {"kind": "console", "name": "github-client (batch follow-up)"}
        for g in self.all():
            if g["state"] not in ("open", "landing") or not g.get("pr"):
                continue
            try:
                p = CLIENT.pr(g["repo"], int(g["pr"]))
            except HTTPException:
                continue
            if p["state"] == "merged":
                LOG.add("merge", g["repo"], target={"pr": g["pr"], "group": g["id"], "branch": g["branch"]}, actor={"kind": "queue", "name": "merge queue"}, details="batch landed")
                self.finish(g, sys_actor)
            elif p["state"] == "closed" and g["state"] == "landing":
                g.update(state="open", why="the batch PR was closed without merging")
                self.save(g)
            elif p["checks"]["state"] == "failure":
                if int(g.get("tries") or 0) < cfg["autoRetry"]:
                    self.retry(g["id"], sys_actor, fresh=True)
                else:
                    g.update(state="checks-failed", why=f"checks failed: {', '.join(p['checks']['failed'])[:300]}")
                    self.save(g)
                    LOG.add("group-land", g["repo"], target={"group": g["id"], "pr": g["pr"]}, actor=sys_actor, outcome="failed", why=g["why"],
                            details="Retry rebuilds it on fresh main; Re-run checks if it was flaky")
            elif g["state"] == "open" and g.get("autoLand") and p["ready"]:
                try:
                    self.land(g["id"], {"kind": "console", "name": f"{g['by']} (auto-land)"})
                except HTTPException as e:
                    LOG.add("group-land", g["repo"], target={"group": g["id"], "pr": g["pr"]}, actor=sys_actor, outcome="failed", why=str(e.detail))


BATCHES = Batches()


def _ticker() -> None:
    while True:
        time.sleep(60)
        if not cx.plugin_enabled(FOLDER):
            continue
        try:
            BATCHES.tick()
        except Exception as e:  # noqa: BLE001 — keep following
            CLIENT.last_error = core.text(f"batch follow-up: {e}", 200)


if not os.environ.get("AXF_GITHUB_CLIENT_NO_TICK"):
    threading.Thread(target=_ticker, daemon=True, name="gh-client-batches").start()


@router.get("/groups")
def get_groups(repo: str = "") -> dict[str, Any]:
    """Batches (PR groups): state, members, the batch PR, clashes, who handles them."""
    rows = [g for g in BATCHES.all() if not repo or g["repo"] == repo]
    return {"items": sorted(rows, key=lambda g: g["createdAt"], reverse=True)}


@router.get("/group/{gid}")
def get_group(gid: str) -> dict[str, Any]:
    """One batch."""
    return BATCHES.get(gid)


@router.post("/group")
def post_group(request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Batch merge: pull main into each PR, merge them all on one branch, open one PR (checks run once); clashes go to Claude."""
    return BATCHES.create(_body(body), actor_of(request, body))


@router.post("/group/{gid}/add")
def post_group_add(gid: str, request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Add pull requests to a batch (rebuilt from main)."""
    return BATCHES.change(gid, [int(x) for x in _body(body).get("prs") or [] if isinstance(x, int)], [], actor_of(request, body))


@router.post("/group/{gid}/remove")
def post_group_remove(gid: str, request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Remove pull requests from a batch (rebuilt from main)."""
    return BATCHES.change(gid, [], [int(x) for x in _body(body).get("prs") or [] if isinstance(x, int)], actor_of(request, body))


@router.post("/group/{gid}/retry")
def post_group_retry(gid: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Retry a batch: carry on from its branch (after a fix), or fresh: rebuild it on the newest main."""
    return BATCHES.retry(gid, actor_of(request, body), fresh=_body(body).get("fresh") is True)


@router.post("/group/{gid}/land")
def post_group_land(gid: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Land a batch: its PR goes through the merge queue (or merges); the members close as landed by the batch."""
    return BATCHES.land(gid, actor_of(request, body), _body(body))


@router.post("/group/{gid}/dissolve")
def post_group_dissolve(gid: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Dissolve a batch: close its PR, delete its branch (SHA saved); the member PRs are untouched."""
    return BATCHES.dissolve(gid, actor_of(request, body))


# ================================================================================================ bulk (s5)

def bulk(body: dict[str, Any], who: dict[str, str], wait: bool = False) -> dict[str, Any]:
    deny_claude("bulk", who)
    action = body.get("action")
    if action not in core.BULK_ACTIONS:
        raise _bad(400, f"action is one of {', '.join(core.BULK_ACTIONS)}")
    repo = CLIENT.default_repo(body.get("repo"))
    nums = body.get("prs") if isinstance(body.get("prs"), list) else None
    flt = body.get("filter") if body.get("filter") in core.FILTERS else None
    take, skip = core.bulk_targets(CLIENT.prs(repo, force=True), action, [int(x) for x in nums or [] if isinstance(x, int)], flt)
    if not take:
        return {"ok": True, "text": "Nothing to do: " + ("; ".join(f"{s['target']} {s['note']}" for s in skip[:8]) or "no PR matches."), "skipped": skip}
    why = core.text(body.get("why"), 200)

    def run(job: dict[str, Any]) -> None:
        for it in skip:
            JOBS.item(job, it["target"], "skipped", it["note"])
        for p in take:
            if JOBS.cancelled(job):
                return
            t = f"#{p['number']}"
            JOBS.item(job, t, "running")
            try:
                if action == "merge-ready":
                    r = ACTIONS.merge(repo, p["number"], {"why": why or "bulk: merge all ready"}, who)
                elif action == "close-stale":
                    r = ACTIONS.set_state(repo, p["number"], "closed", who, why or f"stale: no update in {CLIENT.config()['staleDays']} days")
                elif action == "update-main":
                    r = ACTIONS.update_main(repo, p["number"], who, wait=True)
                    if r.get("job") and JOBS.get(r["job"]["id"]).get("state") == "failed":
                        raise _bad(409, (JOBS.get(r["job"]["id"])["items"][0].get("note") or "conflicts"))
                elif action == "rerun-failed":
                    r = ACTIONS.rerun(repo, p["number"], True, who)
                else:
                    r = ACTIONS.label(repo, p["number"], body.get("add") or [], body.get("remove") or [], who)
                JOBS.item(job, t, "ok", r.get("text", ""))
            except HTTPException as e:
                JOBS.item(job, t, "failed", str(e.detail))
        done = sum(1 for i in job["items"] if i["state"] == "ok")
        failed = [i for i in job["items"] if i["state"] == "failed"]
        LOG.add("bulk", repo, actor=who, outcome="failed" if failed else "ok", why="; ".join(f"{i['target']}: {i.get('note', '')}" for i in failed)[:500],
                details=f"{action}: {done} done, {len(failed)} failed, {len(skip)} skipped")
    job = JOBS.start("bulk", repo, [f"#{p['number']}" for p in take] + [s["target"] for s in skip], who, run, meta={"action": action}, wait=wait)
    return {"ok": True, "job": job, "take": [p["number"] for p in take], "skipped": skip, "text": f"{action} on {len(take)} PRs (job {job['id']}); {len(skip)} skipped."}


@router.post("/bulk")
def post_bulk(request: Request, body: Any = Body(...)) -> dict[str, Any]:
    """Bulk action on many pull requests: merge-ready, close-stale, update-main, rerun-failed, label (one job, per-PR results)."""
    return bulk(_body(body), actor_of(request, body))


@router.post("/bulk/preview")
def post_bulk_preview(body: Any = Body(...)) -> dict[str, Any]:
    """What a bulk action would take and skip, without doing it."""
    b = _body(body)
    if b.get("action") not in core.BULK_ACTIONS:
        raise _bad(400, f"action is one of {', '.join(core.BULK_ACTIONS)}")
    repo = CLIENT.default_repo(b.get("repo"))
    nums = [int(x) for x in b.get("prs") or [] if isinstance(x, int)]
    take, skip = core.bulk_targets(CLIENT.prs(repo), b["action"], nums, b.get("filter") if b.get("filter") in core.FILTERS else None)
    return {"repo": repo, "action": b["action"], "take": [{"number": p["number"], "title": p["title"]} for p in take], "skipped": skip}


# ================================================================================================ branches, commits, diffs (s6)

class Branches:
    def delete(self, repo: str, name: str, who: dict[str, str], why: str = "") -> dict[str, Any]:
        _branch(name)
        b = _gh(lambda: API.get(rp(repo, "branches", name)), f"branch {name}") or {}
        sha = (b.get("commit") or {}).get("sha", "")
        if name == CLIENT.default_branch(repo) or b.get("protected"):
            raise _bad(403, f"{name} is the default or a protected branch: never deleted from here")
        try:
            API.call("DELETE", rp(repo, "git", "refs", "heads", name))
        except github.GitHubError as e:
            LOG.add("branch-delete", repo, target={"branch": name, "sha": sha}, actor=who, outcome="failed", why=str(e))
            raise _bad(502, str(e)) from None
        e = LOG.add("branch-delete", repo, target={"branch": name, "sha": sha}, actor=who, saved_sha=sha, why=why)
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "log": e["id"], "savedSha": sha, "text": f"Deleted {name}; its SHA {sha[:8]} is saved (Git log → Restore)."}

    def restore(self, lid: str, who: dict[str, str]) -> dict[str, Any]:
        e = next((x for x in LOG.all() if x["id"] == lid), None)
        if not e or not e.get("savedSha") or not (e.get("target") or {}).get("branch"):
            raise _bad(404, "no restorable entry with that id")
        name, sha, repo = e["target"]["branch"], e["savedSha"], e["repo"]
        try:
            API.call("POST", rp(repo, "git", "refs"), {"ref": f"refs/heads/{name}", "sha": sha})
        except github.GitHubError as x:
            LOG.add("restore", repo, target={"branch": name, "sha": sha}, actor=who, outcome="failed", why=str(x))
            raise _bad(409 if x.status == 422 else 502, f"{x} (does {name} exist already?)") from None
        LOG.add("restore", repo, target={"branch": name, "sha": sha}, actor=who, details=f"from log entry {lid}")
        CLIENT.changed(repo, drop=True)
        return {"ok": True, "text": f"Restored {name} at {sha[:8]}."}


BRANCHES = Branches()


@router.get("/branches")
def get_branches(repo: str = "") -> dict[str, Any]:
    """Branches with ahead/behind main, last commit, PR, protected and default flags."""
    r = CLIENT.default_repo(repo)
    return {"repo": r, "items": _gh(lambda: CLIENT.branches(r), "branches")}


@router.get("/branch/{owner}/{name}/{branch:path}")
def get_branch(owner: str, name: str, branch: str) -> dict[str, Any]:
    """One branch."""
    return _gh(lambda: CLIENT.branch(_repo(f"{owner}/{name}"), _branch(branch)), f"branch {branch}")


@router.delete("/branch/{owner}/{name}/{branch:path}")
def delete_branch(owner: str, name: str, branch: str, request: Request) -> dict[str, Any]:
    """Delete a branch: its SHA is saved in the Git log first (Restore brings it back). Never the default or a protected one."""
    return BRANCHES.delete(_repo(f"{owner}/{name}"), _branch(branch), actor_of(request))


@router.get("/commits")
def get_commits(repo: str = "", branch: str = "", page: int = 1) -> dict[str, Any]:
    """Commits on a branch, newest first, 50 a page."""
    r = CLIENT.default_repo(repo)
    return _gh(lambda: CLIENT.commits(r, _branch(branch or CLIENT.default_branch(r)), page), "commits")


@router.get("/commit/{owner}/{name}/{sha}")
def get_commit(owner: str, name: str, sha: str) -> dict[str, Any]:
    """One commit with its files and patches."""
    return _gh(lambda: CLIENT.commit(_repo(f"{owner}/{name}"), sha), f"commit {sha}")


@router.get("/diff")
def get_diff(repo: str, base: str, head: str) -> dict[str, Any]:
    """Compare two refs: commits and files with patches."""
    return _gh(lambda: CLIENT.diff(_repo(repo), _branch(base) if not re.fullmatch(r"[0-9a-f]{7,40}", base) else base,
                                   _branch(head) if not re.fullmatch(r"[0-9a-f]{7,40}", head) else head), "compare")


# ================================================================================================ git log (s9)

DELETED_LIST = re.compile(r"_deleted-branches-[A-Za-z0-9._-]*\.txt\Z")


def import_lists(who: dict[str, str]) -> dict[str, Any]:
    """Every `_deleted-branches-*.txt` in the repo root and in dataDir/imports/ → restorable branch-delete entries
    (idempotent on repo + branch + SHA). The repo of a list is the console's own unless the file says `# repo: o/n`."""
    have = {(e["repo"], (e.get("target") or {}).get("branch"), e.get("savedSha")) for e in LOG.all() if e.get("savedSha")}
    files = [f for d in (cx.ROOT, data_dir() / "imports") if d.is_dir() for f in sorted(d.iterdir()) if DELETED_LIST.match(f.name)]
    added, seen = 0, 0
    default_repo = CLIENT.default_repo() if CLIENT.repos() else ""
    for f in files:
        try:
            body = f.read_text(encoding="utf-8", errors="replace")[:2_000_000]
        except OSError:
            continue
        m = re.search(r"^#\s*repo:\s*(\S+)", body, re.M)
        repo = m.group(1) if m and github.valid_repo(m.group(1)) else default_repo
        for row in core.parse_deleted_list(body):
            seen += 1
            if (repo, row["branch"], row["sha"]) in have:
                continue
            have.add((repo, row["branch"], row["sha"]))
            storage.append_jsonl(LOG.file(), core.log_entry("import", repo, target={"branch": row["branch"], "sha": row["sha"]},
                                                            actor={"kind": "import", "name": f.name}, saved_sha=row["sha"],
                                                            details=f"deleted branch from {f.name}", seq=f"lg-{time.time_ns():x}"))
            added += 1
    CLIENT.changed()
    return {"ok": True, "files": [f.name for f in files], "rows": seen, "added": added,
            "text": f"Imported {added} deleted branches from {len(files)} list(s)" + ("" if files else " (none found: put _deleted-branches-*.txt in the repo root or the plugin's imports folder)") + "."}


@router.get("/log")
def get_log(q: str = "", kind: str = "", repo: str = "", since: str = "", outcome: str = "", page: int = 1) -> dict[str, Any]:
    """The git log: every merge (and failed merge with why), retry, branch delete (saved SHA, restorable), push, main pulled in, PR opened/closed, batch and bulk run; newest first, searchable."""
    rows = [e for e in reversed(LOG.all()) if core.log_match(e, q, kind, repo, since, outcome)]
    restored = {(e["repo"], (e.get("target") or {}).get("branch"), (e.get("target") or {}).get("sha")) for e in rows if e.get("kind") == "restore" and e.get("outcome") == "ok"}
    page = max(1, int(page or 1))
    out = rows[(page - 1) * 100: page * 100]
    for e in out:
        if e.get("restorable") and (e["repo"], e["target"].get("branch"), e.get("savedSha")) in restored:
            e["restoredAt"] = "yes"
    return {"total": len(rows), "page": page, "more": len(rows) > page * 100, "kinds": list(core.LOG_KINDS), "items": out}


@router.post("/log/{lid}/restore")
def post_restore(lid: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Recreate a deleted branch at its saved SHA."""
    return BRANCHES.restore(lid, actor_of(request, body))


@router.post("/log/import")
def post_log_import(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """Import the _deleted-branches-*.txt lists into the git log (restorable; idempotent)."""
    return import_lists(actor_of(request, body))
