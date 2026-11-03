"""What's new — server part. Mounted at /api/plugins/whats-shipped/ (console token on every method, 404 when the plugin is
off, never on the console MCP).

    GET /feed[?refresh=true]   the whats-new@1 feed: one item per pull request merged into main that changed an app,
                               a plugin or the framework (title, summary, build, profile, apps, merged / deployed, links)
    GET /config | PUT /config  {days, apps, deployedOnly, deployWorkflows} (or {reset: true})

The feed is built from what actually shipped, never from a model:
  merged PRs      GitHub (lib-github, console token) when GITHUB_TOKEN is set, else the repo's own git history
                  (merge commits on origin/main, files from `git diff <first parent> <merge>`)
  deployed        a successful run of a deploy workflow on main after the merge (GitHub), else the `site` branch
                  (deploy.yml force-pushes it) having a commit after the merge; unknown stays null
  builds          the builds store (_claude/builds/store.json): a build matches by its pr / branch fields, or a step's
                  (orch-live-sync adds per-step branch / pr / merged fields: read when present). Store builds marked
                  merged with no PR found become items of their own.
  wording         the build report (_claude/builds/reports/<build or branch>.md): its title and first "what changed"
                  bullets; else the Codebase changes entry for the branch (result summary); else the PR body.

The answer is cached in memory and in <data dir>/feed.json, and rebuilt when the store or report files change, when
the merge list changes (checked at most every CHECK_S), or on ?refresh=true. Merged PRs' file lists never change, so they
are kept in <data dir>/pr-files.json.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, storage

router = APIRouter()

FORMAT = "whats-new@1"
CHECK_S = 300
MAX_PRS = 150
MAX_FILE_FETCHES = 25  # per rebuild; the rest come on the next one (cached for good once read)
DEFAULT_CONFIG = {"days": 30, "apps": [], "deployedOnly": False, "deployWorkflows": ["deploy.yml"]}
DAYS_CHOICES = (1, 3, 7, 14, 30, 60, 90, 365)
TEXT_MAX = 300

# Friendly names for app folders whose manifest titles are ambiguous or a product name.
APP_LABELS = {
    "console-web": "Dev Console", "console": "Dev Console (Android)", "axhub-web": "axHub", "axhub-android": "axHub (Android)",
    "patches": "Patches (Android)", "patches-web": "Patches", "demo": "Demo site", "amberx-droid": "AmberX",
}
# Paths that never make a change a feature on their own (logs, memory, generated status).
NOISE = re.compile(r"^(_claude/|changes/|sessions/|tracker\.json$|framework/plan/|framework/catalog/|\.brief\.md$|CLAUDE\.md$|README\.md$|apps/[^/]+/_claude/|apps/[^/]+/src/axf/)")
MERGE_RE = re.compile(r"Merge pull request #(\d+) from [^/\s]+/(\S+)")
CONVENTIONAL = re.compile(r"^(feat|fix|chore|refactor|docs|test|ci|build|perf|style)(\([^)]*\))?!?:\s*", re.I)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_WHATS_SHIPPED_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "whats-shipped"))


def _text(v: Any, n: int = TEXT_MAX) -> str:
    return re.sub(r"\s+", " ", str(v or "")).strip()[:n]


def _iso(v: Any) -> str:
    """An ISO time in UTC with a Z ('' when it isn't one)."""
    s = str(v or "").strip()
    if not s:
        return ""
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return ""
    if d.tzinfo is None:
        d = d.replace(tzinfo=timezone.utc)
    return d.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _ts(iso: str) -> float:
    try:
        return datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


# ---------------------------------------------------------------- apps from paths

def app_names(root: Path) -> dict[str, dict[str, str]]:
    """Folder → {label} for apps and console plugins (from their manifests; folder name when unreadable)."""
    out: dict[str, dict[str, str]] = {}
    apps = root / "apps"
    for d in sorted(apps.iterdir()) if apps.is_dir() else []:
        if d.is_dir():
            m = storage.read_json(d / "project.manifest.json", {})
            out[f"app:{d.name}"] = {"label": APP_LABELS.get(d.name) or _text((m or {}).get("title") or d.name, 60)}
    plugins = apps / "console-web" / "plugins"
    for d in sorted(plugins.iterdir()) if plugins.is_dir() else []:
        if d.is_dir() and not d.name.startswith("_"):
            m = storage.read_json(d / "plugin.json", {})
            out[f"plugin:{d.name}"] = {"label": _text((m or {}).get("name") or d.name, 60)}
    return out


def apps_of(files: list[str], names: dict[str, dict[str, str]]) -> list[dict[str, str]]:
    """The apps, plugins and framework a list of changed paths touches (noise and baked framework copies ignored)."""
    seen: dict[str, dict[str, str]] = {}

    def add(key: str, kind: str, fallback: str) -> None:
        if key not in seen:
            seen[key] = {"id": key, "label": names.get(key, {}).get("label") or fallback, "kind": kind}

    for f in files:
        if not isinstance(f, str) or NOISE.match(f):
            continue
        parts = f.split("/")
        if parts[0] == "framework":
            add("framework", "framework", "Framework")
        elif parts[0] == "apps" and len(parts) > 2:
            add(f"app:{parts[1]}", "app", APP_LABELS.get(parts[1], parts[1]))
            if parts[1] == "console-web" and parts[2] == "plugins" and len(parts) > 4 and not parts[3].startswith("_"):
                add(f"plugin:{parts[3]}", "plugin", parts[3])
        elif parts[0] == "deploy":
            add("deploy", "framework", "Server install")
    order = {"app": 0, "plugin": 1, "framework": 2}
    return sorted(seen.values(), key=lambda a: (order.get(a["kind"], 3), a["label"].lower()))


def where_of(apps: list[dict[str, str]]) -> str:
    """Where to find it, in plain words."""
    plugins = [a["label"] for a in apps if a["kind"] == "plugin"]
    if plugins:
        return f"Dev Console → Plugins → {', '.join(plugins[:3])}"
    named = [a["label"] for a in apps if a["kind"] == "app"]
    if named:
        return ", ".join(named[:4])
    return "Framework: every app built on AmberX AXF" if any(a["id"] == "framework" for a in apps) else ""


# ---------------------------------------------------------------- wording

def clean_title(t: str) -> str:
    t = CONVENTIONAL.sub("", _text(t, 200)).replace("[skip ci]", "").strip(" .")
    return t[:1].upper() + t[1:] if t else ""


def report_info(text: str) -> dict[str, Any]:
    """Title + the first plain bullets of a build report's 'what changed' section (or its first paragraph)."""
    lines = text.splitlines()
    title = ""
    for ln in lines:
        if ln.startswith("# "):
            title = re.sub(r"\s*\((?:[A-Z][a-z]{2} \d{1,2}|[^)]*20\d\d)[^)]*\)\s*$", "", ln[2:].strip())  # drop "(Nov 1 2026, …)"
            title = re.sub(r"\s+[—-]\s+(report|build report|finished.*|Nov .*|Oct .*)$", "", title, flags=re.I)
            title = re.sub(r"^[a-z0-9-]+\s+[—-]\s+", "", title) if re.match(r"^[a-z0-9-]+\s+[—-]\s+\S", title) else title
            break
    want = re.compile(r"^##+\s*(what (changed|was built|landed|brett gets|it does|you get)|added|changed|result|summary|how it works)", re.I)
    bullets: list[str] = []
    para = ""
    on = False
    for ln in lines:
        if ln.startswith("#"):
            if bullets:
                break
            on = bool(want.match(ln))
            continue
        if on:
            m = re.match(r"^\s*[-*]\s+(.*)", ln)
            if m and not ln.startswith("  "):
                bullets.append(_text(re.sub(r"[`*]", "", m.group(1)), 240))
                if len(bullets) >= 5:
                    break
            elif ln.strip() and not para and not m:
                para = _text(re.sub(r"[`*]", "", ln), 400)
    return {"title": _text(title, 160), "details": bullets, "summary": para or (bullets[0] if bullets else "")}


def first_paragraph(body: str) -> str:
    for block in re.split(r"\n\s*\n", body or ""):
        b = block.strip()
        if b and not b.startswith(("#", "🤖", "Co-Authored", "<!--")):
            return _text(re.sub(r"[`*]", "", b), 400)
    return ""


# ---------------------------------------------------------------- sources

class Sources:
    """Where the facts come from. Every reader is replaceable (tests pass fakes)."""

    def __init__(self, root: Callable[[], Path] = lambda: cx.ROOT,
                 token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", ""),
                 repo: Callable[[], str] = lambda: cx.GITHUB_REPO or "MossesX/AmberX-AXF",
                 get: Callable[[str], Any] | None = None, git: Callable[[list[str]], str] | None = None) -> None:
        self.root, self.token, self.repo = root, token, repo
        self._get = get or self._github_get
        self._git = git or self._run_git

    # ---- GitHub
    def _github_get(self, path: str) -> Any:
        gh = github.GitHubClient(self.token, base_url=github.api_base_from_env(), user_agent="axf-console-whats-shipped",
                                 timeout=15, max_bytes=4_000_000)
        return gh.get(path)

    def github_on(self) -> bool:
        return bool((self.token() or "").strip()) and github.valid_repo(self.repo())

    def github_prs(self) -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for page in (1, 2):
            data = self._get(github.repo_path(self.repo(), "pulls", query={"state": "closed", "base": "main", "sort": "updated",
                                                                              "direction": "desc", "per_page": 100, "page": page}))
            rows = data if isinstance(data, list) else []
            for p in rows:
                if isinstance(p, dict) and p.get("merged_at") and isinstance(p.get("number"), int):
                    out.append({"number": p["number"], "title": _text(p.get("title"), 200), "body": str(p.get("body") or "")[:4000],
                                "branch": _text((p.get("head") or {}).get("ref"), 200), "mergedAt": _iso(p.get("merged_at")),
                                "sha": _text(p.get("merge_commit_sha"), 40), "url": _safe_url(p.get("html_url")), "files": None})
            if len(rows) < 100:
                break
        return out[:MAX_PRS]

    def github_files(self, number: int) -> list[str]:
        data = self._get(github.repo_path(self.repo(), "pulls", number, "files", query={"per_page": 100}))
        return [_text(f.get("filename"), 300) for f in (data if isinstance(data, list) else []) if isinstance(f, dict)]

    def github_deploys(self, workflows: list[str]) -> list[str]:
        """Times of successful deploy runs on main (newest first)."""
        times: list[str] = []
        for wf in workflows:
            data = self._get(github.repo_path(self.repo(), "actions", "workflows", wf, "runs",
                                              query={"branch": "main", "status": "success", "per_page": 30}))
            for r in (data.get("workflow_runs", []) if isinstance(data, dict) else []):
                if isinstance(r, dict) and r.get("conclusion") == "success":
                    t = _iso(r.get("updated_at") or r.get("created_at"))
                    if t:
                        times.append(t)
        return sorted(times, reverse=True)

    # ---- git (no token needed)
    def _run_git(self, args: list[str]) -> str:
        r = subprocess.run(["git", "-C", str(self.root()), *args], capture_output=True, text=True, timeout=30)
        if r.returncode != 0:
            raise RuntimeError(_text(r.stderr, 200) or "git failed")
        return r.stdout

    def _main_ref(self) -> str:
        for ref in ("origin/main", "main"):
            try:
                self._git(["rev-parse", "--verify", "--quiet", ref])
                return ref
            except (RuntimeError, OSError, subprocess.SubprocessError):
                continue
        return ""

    def git_prs(self) -> list[dict[str, Any]]:
        ref = self._main_ref()
        if not ref:
            return []
        out = self._git(["log", ref, "--merges", "--first-parent", f"-n{MAX_PRS}", "--format=%H%x1f%P%x1f%cI%x1f%s%x1f%b%x1e"])
        prs = []
        for rec in out.split("\x1e"):
            f = rec.strip("\n").split("\x1f")
            if len(f) < 5:
                continue
            m = MERGE_RE.match(f[3])
            if not m:
                continue
            body = f[4].strip()
            prs.append({"number": int(m.group(1)), "title": _text(body.splitlines()[0] if body else m.group(2), 200), "body": "",
                        "branch": m.group(2), "mergedAt": _iso(f[2]), "sha": f[0], "parent": f[1].split(" ")[0],
                        "url": f"{github.GIT_BASE}/{self.repo()}/pull/{m.group(1)}" if github.valid_repo(self.repo()) else "", "files": None})
        return prs

    def git_files(self, pr: dict[str, Any]) -> list[str]:
        if not pr.get("parent") or not pr.get("sha"):
            return []
        return [ln for ln in self._git(["diff", "--name-only", pr["parent"], pr["sha"]]).splitlines() if ln][:2000]

    def git_deploys(self) -> list[str]:
        for ref in ("origin/site", "site"):
            try:
                t = _iso(self._git(["log", "-1", "--format=%cI", ref]).strip())
                if t:
                    return [t]
            except (RuntimeError, OSError, subprocess.SubprocessError):
                continue
        return []

    # ---- repo files
    def store(self) -> dict[str, Any]:
        s = storage.read_json(self.root() / "_claude" / "builds" / "store.json", {})
        return s if isinstance(s, dict) else {}

    def report(self, name: str) -> str:
        if not re.fullmatch(r"[A-Za-z0-9._-]{1,120}", name or ""):
            return ""
        return storage.read_text(self.root() / "_claude" / "builds" / "reports" / f"{name}.md", "")[:200_000]

    def changes_dir(self) -> Path | None:
        exact = os.environ.get("AXF_CHANGES_DIR")
        if exact:
            return Path(exact)
        root = cx.persist_root()
        for d in ([Path(root) / "changes"] if root else []) + [self.root() / "changes"]:
            if d.is_dir():
                return d
        return None

    def change_summaries(self, months: int = 3) -> dict[str, str]:
        """Branch → the latest finished Codebase changes entry's summary (only the last few months are read)."""
        d = self.changes_dir()
        out: dict[str, tuple[str, str]] = {}
        if not d:
            return {}
        folders = sorted((p for y in d.iterdir() if y.is_dir() and y.name.isdigit() for p in y.iterdir() if p.is_dir()), reverse=True)[:months]
        for folder in folders:
            for f in folder.glob("chg-*.json"):
                e = storage.read_json(f, {})
                if not isinstance(e, dict):
                    continue
                res = e.get("result") if isinstance(e.get("result"), dict) else {}
                br = _text(res.get("branch") or e.get("branch"), 200)
                summ = _text(res.get("summary"), 600)
                at = str(e.get("updatedAt") or "")
                if br and summ and res.get("state") in ("done", "partial") and (br not in out or at > out[br][0]):
                    out[br] = (at, summ)
        return {k: v[1] for k, v in out.items()}

    def fingerprint(self) -> str:
        """Changes when the store or a report changes (cheap: mtimes only)."""
        r = self.root() / "_claude" / "builds"
        parts = []
        for p in [r / "store.json", r / "reports"]:
            try:
                parts.append(f"{p}:{p.stat().st_mtime_ns}")
            except OSError:
                parts.append(f"{p}:-")
        return "|".join(parts)


def _safe_url(v: Any) -> str:
    s = str(v or "")
    return s[:500] if s.startswith(github.GIT_BASE + "/") and not any(c in s for c in "\"'<> \n\r\t") else ""


# ---------------------------------------------------------------- building the feed

def build_index(store: dict[str, Any]) -> tuple[dict[str, dict], dict[str, dict], list[dict]]:
    """(by PR number, by branch, merged builds) from the builds store. Step-level branch/pr/merged fields count too."""
    by_pr: dict[str, dict] = {}
    by_branch: dict[str, dict] = {}
    merged: list[dict] = []
    for b in store.get("builds", []) if isinstance(store.get("builds"), list) else []:
        if not isinstance(b, dict) or b.get("deleted"):
            continue
        profiles = b.get("profiles") if isinstance(b.get("profiles"), list) else []
        info = {"id": _text(b.get("id"), 80), "title": _text(b.get("title"), 200), "profile": _text(profiles[0] if profiles else b.get("profile"), 40),
                "status": _text(b.get("status"), 20), "branch": _text(b.get("branch"), 200)}
        refs = [b] + [s for s in (b.get("steps") or []) if isinstance(s, dict)]
        for r in refs:
            for n in re.findall(r"#?(\d+)", str(r.get("pr") or "")):
                by_pr.setdefault(n, info)
            br = _text(r.get("branch"), 200)
            if br:
                by_branch.setdefault(br, info)
        when = _iso(b.get("mergedAt"))
        if b.get("merged") is True or when:
            merged.append({**info, "mergedAt": when or _iso(b.get("builtAt")) or _iso(b.get("updatedAt"))})
    return by_pr, by_branch, merged


def deployed_after(merged_at: str, deploys: list[str] | None) -> tuple[bool | None, str]:
    """(deployed, when): a deploy at or after the merge carries it; None when there is no deploy information."""
    if deploys is None:
        return None, ""
    after = [d for d in deploys if d >= merged_at]
    return (True, min(after)) if after else (False, "")


def make_feed(prs: list[dict[str, Any]], deploys: list[str] | None, store: dict[str, Any], names: dict[str, dict[str, str]],
              report: Callable[[str], str], changes: dict[str, str], now: float, source: str) -> dict[str, Any]:
    by_pr, by_branch, merged_builds = build_index(store)
    items: list[dict[str, Any]] = []
    seen_builds: set[str] = set()
    for pr in prs:
        files = pr.get("files")
        apps = apps_of(files, names) if isinstance(files, list) else []
        if isinstance(files, list) and not apps:
            continue  # plans, notes, logs: nothing shipped to an app
        b = by_pr.get(str(pr["number"])) or by_branch.get(pr.get("branch", ""))
        tail = pr.get("branch", "").split("/")[-1]
        rep_name = next((n for n in ([b["id"]] if b else []) + [tail] if n and report(n)), "")
        rep = report_info(report(rep_name)) if rep_name else {"title": "", "details": [], "summary": ""}
        title = clean_title(pr.get("title", "")) or rep["title"] or (b["title"] if b else "") or f"Pull request #{pr['number']}"
        summary = rep["summary"] or changes.get(pr.get("branch", ""), "") or first_paragraph(pr.get("body", "")) or (b["title"] if b and b["title"] != title else "")
        dep, dep_at = deployed_after(pr["mergedAt"], deploys)
        if b:
            seen_builds.add(b["id"])
        items.append({
            "id": f"pr-{pr['number']}", "title": title, "summary": _text(summary, 600), "details": rep["details"],
            "build": {"id": b["id"], "title": b["title"], "profile": b["profile"]} if b else None,
            "apps": apps, "where": where_of(apps), "mergedAt": pr["mergedAt"], "deployed": dep, "deployedAt": dep_at,
            "pr": {"number": pr["number"], "url": pr.get("url", "")}, "branch": pr.get("branch", ""), "sha": pr.get("sha", "")[:40],
            "report": f"_claude/builds/reports/{rep_name}.md" if rep_name else "", "filesKnown": isinstance(files, list),
        })
    for b in merged_builds:  # builds the store marks merged that no PR above carried
        if b["id"] in seen_builds or not b["mergedAt"]:
            continue
        rep = report_info(report(b["id"]))
        dep, dep_at = deployed_after(b["mergedAt"], deploys)
        items.append({
            "id": f"build-{b['id']}", "title": b["title"] or rep["title"] or b["id"], "summary": _text(rep["summary"] or changes.get(b["branch"], ""), 600),
            "details": rep["details"], "build": {"id": b["id"], "title": b["title"], "profile": b["profile"]}, "apps": [], "where": "",
            "mergedAt": b["mergedAt"], "deployed": dep, "deployedAt": dep_at, "pr": None, "branch": b["branch"], "sha": "",
            "report": f"_claude/builds/reports/{b['id']}.md" if rep["title"] or rep["summary"] else "", "filesKnown": False,
        })
    items.sort(key=lambda i: i["mergedAt"], reverse=True)
    return {"$axf": FORMAT, "builtAt": datetime.fromtimestamp(now, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "source": source,
            "deploysKnown": deploys is not None, "items": items}


def filter_feed(feed: dict[str, Any], cfg: dict[str, Any], now: float) -> dict[str, Any]:
    """The configured window: how far back, which apps, deployed only."""
    since = now - cfg["days"] * 86_400
    want = set(cfg["apps"])
    out = []
    for it in feed.get("items", []):
        if _ts(it["mergedAt"]) < since:
            continue
        if cfg["deployedOnly"] and it.get("deployed") is not True:
            continue
        if want and not any(a["id"] in want for a in it.get("apps", [])):
            continue
        out.append(it)
    return {**feed, "items": out, "total": len(feed.get("items", [])), "config": cfg}


# ---------------------------------------------------------------- the service

def check_config(body: Any) -> dict[str, Any]:
    if not isinstance(body, dict):
        raise HTTPException(400, "config is an object")
    if body.get("reset"):
        return dict(DEFAULT_CONFIG)
    extra = set(body) - set(DEFAULT_CONFIG)
    if extra:
        raise HTTPException(400, f"unknown keys: {', '.join(sorted(extra))}")
    cfg = {**DEFAULT_CONFIG, **body}
    if cfg["days"] not in DAYS_CHOICES:
        raise HTTPException(400, f"days is one of {', '.join(map(str, DAYS_CHOICES))}")
    if not isinstance(cfg["apps"], list) or len(cfg["apps"]) > 100 or not all(isinstance(a, str) and re.fullmatch(r"(app|plugin):[a-z0-9._-]{1,80}|framework|deploy", a) for a in cfg["apps"]):
        raise HTTPException(400, "apps lists app:<folder>, plugin:<folder>, framework or deploy")
    if not isinstance(cfg["deployedOnly"], bool):
        raise HTTPException(400, "deployedOnly is true or false")
    wfs = cfg["deployWorkflows"]
    if not isinstance(wfs, list) or not 1 <= len(wfs) <= 5 or not all(isinstance(w, str) and re.fullmatch(r"[A-Za-z0-9_.-]{1,100}\.ya?ml", w) for w in wfs):
        raise HTTPException(400, "deployWorkflows lists 1 to 5 workflow file names (deploy.yml)")
    return {k: cfg[k] for k in DEFAULT_CONFIG}


class Feed:
    def __init__(self, sources: Sources | None = None, clock: Callable[[], float] = time.time) -> None:
        self.src = sources or Sources()
        self.clock = clock
        self._lock = threading.Lock()
        self._feed: dict[str, Any] | None = None
        self._key = ""
        self._checked = 0.0
        self.error = ""

    def config(self) -> dict[str, Any]:
        c = storage.read_json(data_dir() / "config.json", {})
        try:
            return check_config({k: v for k, v in (c if isinstance(c, dict) else {}).items() if k in DEFAULT_CONFIG})
        except HTTPException:
            return dict(DEFAULT_CONFIG)

    def save_config(self, body: Any) -> dict[str, Any]:
        cfg = check_config(body)
        storage.write_json(data_dir() / "config.json", {"$axf": "whats-shipped-config@1", **cfg})
        with self._lock:
            self._key = ""  # deploy workflows may have changed
        return self.config()

    def _pr_files(self, prs: list[dict[str, Any]], use_github: bool) -> None:
        f = data_dir() / "pr-files.json"
        cache = storage.read_json(f, {})
        cache = cache if isinstance(cache, dict) else {}
        fetched = 0
        for pr in prs:
            key = str(pr["number"])
            if isinstance(cache.get(key), list):
                pr["files"] = cache[key]
                continue
            if fetched >= MAX_FILE_FETCHES:
                continue
            try:
                pr["files"] = self.src.github_files(pr["number"]) if use_github else self.src.git_files(pr)
                cache[key] = pr["files"]
                fetched += 1
            except (github.GitHubError, RuntimeError, OSError, subprocess.SubprocessError, ValueError):
                pr["files"] = None
        if fetched:
            keep = {str(p["number"]) for p in prs}
            storage.write_json(f, {k: v for k, v in cache.items() if k in keep}, indent=None)

    def _rebuild(self, cfg: dict[str, Any]) -> dict[str, Any]:
        self.error = ""
        use_github = self.src.github_on()
        prs: list[dict[str, Any]] = []
        deploys: list[str] | None = None
        source = "none"
        if use_github:
            try:
                prs, source = self.src.github_prs(), "github"
            except github.GitHubError as e:
                self.error = f"GitHub: {_text(str(e), 160)}; using the repo's git history"
                use_github = False
        if not use_github:
            try:
                prs, source = self.src.git_prs(), "git"
            except (RuntimeError, OSError, subprocess.SubprocessError) as e:
                self.error = (self.error + "; " if self.error else "") + f"git: {_text(str(e), 160)}"
        self._pr_files(prs, use_github)
        try:
            deploys = self.src.github_deploys(cfg["deployWorkflows"]) if use_github else (self.src.git_deploys() or None)
        except (github.GitHubError, RuntimeError, OSError, subprocess.SubprocessError):
            deploys = None
        return make_feed(prs, deploys, self.src.store(), app_names(self.src.root()), self.src.report,
                         self.src.change_summaries(), self.clock(), source)

    def _merge_key(self, cfg: dict[str, Any]) -> str:
        """What the cached feed was built from: the newest merge, the store and reports, the deploy workflows."""
        try:
            head = self.src._git(["rev-parse", "origin/main"]).strip() if not self.src.github_on() else ""
        except (RuntimeError, OSError, subprocess.SubprocessError):
            head = ""
        return json.dumps([head, self.src.fingerprint(), cfg["deployWorkflows"]])

    def get(self, force: bool = False) -> dict[str, Any]:
        cfg = self.config()
        now = self.clock()
        with self._lock:
            if self._feed is None and not force:  # first answer after a restart: the cached file, if built from the same facts
                cached = storage.read_json(data_dir() / "feed.json", None)
                if isinstance(cached, dict) and cached.get("$axf") == FORMAT:
                    self._feed, self._key, self._checked = cached, str(cached.get("key") or ""), now
            key = self._merge_key(cfg)  # git: the head of main; GitHub: '' (the merge list is re-read every CHECK_S)
            if force or self._feed is None or key != self._key or (self.src.github_on() and now - self._checked >= CHECK_S):
                self._feed = {**self._rebuild(cfg), "key": key}
                storage.write_json(data_dir() / "feed.json", self._feed, indent=None)
                self._key, self._checked = key, now
            feed = self._feed
        out = filter_feed({k: v for k, v in feed.items() if k != "key"}, cfg, now)
        out["error"] = self.error
        out["checkS"] = CHECK_S
        return out

    def apps(self) -> list[dict[str, str]]:
        names = app_names(self.src.root())
        out = [{"id": "framework", "label": "Framework", "kind": "framework"}]
        out += [{"id": k, "label": v["label"], "kind": k.split(":")[0]} for k, v in names.items()]
        return out


FEED = Feed()


@router.get("/feed")
def feed(refresh: bool = False) -> dict[str, Any]:
    return FEED.get(force=refresh)


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {**FEED.config(), "defaults": DEFAULT_CONFIG, "daysChoices": list(DAYS_CHOICES), "apps": FEED.config()["apps"], "appChoices": FEED.apps()}


@router.put("/config")
def put_config(body: Any = Body(...)) -> dict[str, Any]:
    FEED.save_config(body)
    return get_config()
