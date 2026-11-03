"""Git status board (server part). Mounted at /api/plugins/git-status/ (console token on every route, 404 when off).
Every route is also a plugin command (plugin-commands@1: REST /api/control/git-status/<command>, MCP git-status_<command>,
CLI `axf git-status <command>`), so Amber can read and act by voice.

Reads (zero tokens: git, GitHub and files only, no LLM):
  GET  board[?since=<stamp>][&refresh=true]   every row in every section, the batches and the sources' health; with
                                              since= answers {same: true} while nothing changed (the page's live feed)
  GET  sections                               the sections with their counts
  GET  list?section=<id>[&q=]                 one section's rows, short (voice / CLI)
  GET  item?key=<key>                         one row in full: checks with failing lines, commits, linked build + steps,
                                              UI Review items, blockers and what clears them
  GET  files?repo=&number=                    a PR's changed files with their diffs
  GET  batches                                push batches with live badges, their PRs in merge order
Writes (each through the owner's own checks):
  POST merge {key}        merge a PR through the push banner (axf.push@1: head pinned, refuses held / behind / red)
  POST hold {key, reason?, on?}   put a PR on hold (or release it): auto-merge skips it and Merge refuses it
  POST update {key}       pull main into a PR or branch (push banner)
  POST rerun {key}        re-run the failed CI jobs on its head commit
  POST fix {key}          send an ops-fix job to the agent who owns it (Merge Max), with the failing lines
  POST land {key}         send a land-build job (Landin' Lenny) for a stale branch
  POST close {key}        close a PR (destructive: confirm)
  POST kill {key}         delete a stale GitHub branch with no open PR (destructive: confirm)
  POST batches {title, items}             a new batch     POST batches/add {id, key} · batches/take-out {id, key}
  POST batches/order {id, items}          merge order     POST batches/merge-next {id}   POST batches/remove {id}

Sources (all optional, looked up at request time by capability, never by folder): axf.push@1 (the push banner: GitHub
through axHub first, the local token as the fallback), ui-review@1, axf.changes@1 (cost), axf.containers@1 (what is
deployed). Local git and the builds store are read from disk. Provides axf.merge-holds@1.

Keys: "<owner>/<name>#<n>" a PR · "<owner>/<name>:<branch>" a pushed branch · "wt:<path>" a local checkout.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import subprocess
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

from . import core, localgit

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
PUSH = "axf.push@1"
UI = "ui-review@1"
CHANGES = "axf.changes@1"
CONTAINERS = "axf.containers@1"
HOLDS_CAP = "axf.merge-holds@1"
BOARD_CACHE_S = 15
# A forced GitHub re-read costs the push banner ~5 calls per branch and PR (hundreds): at most one every 2 minutes,
# whoever taps Check now (GitHub's hourly limit is shared with the push banner's auto-merge).
FORCE_GITHUB_EVERY_S = 120
SIDE_CACHE_S = 60
MAX_BATCHES = 40
MAX_BATCH_ITEMS = 30
UI_REPO = os.environ.get("AXF_GITHUB_REPO") or "MossesX/AmberX-AXF"
# Apps whose container says what is deployed (name → repo); any container whose image tag is a commit id joins too.
DEPLOY_APPS = {"axf-console": "MossesX/AmberX-AXF", "axhub-web": "MossesX/AmberX-AXF", "amberx-web": "MossesX/AmberX-AXF",
               "molly": "MossesX/AmberX-AXF", "axf-amberxai": "MossesX/AmberX-AXF", "walkthrough-studio": "MossesX/AmberX-AXF"}
KEY_PR = re.compile(r"^([A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100})#(\d{1,7})$")
KEY_BRANCH = re.compile(r"^([A-Za-z0-9._-]{1,100}/[A-Za-z0-9._-]{1,100}):((?!.*\.\.)[A-Za-z0-9._/-]{1,200})$")
BATCH_ID = re.compile(r"^b-[0-9a-z]{4,24}$")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_GIT_STATUS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _svc(name: str) -> Any:
    return plugin_services.get(name)


def _text(v: Any, n: int = 300) -> str:
    return str(v or "")[:n]


# ---------------------------------------------------------------- holds (axf.merge-holds@1) and batches

_lock = threading.Lock()


def holds() -> dict[str, dict[str, Any]]:
    raw = storage.read_json(data_dir() / "holds.json", {}) or {}
    h = raw.get("holds") if isinstance(raw, dict) else None
    return {k: v for k, v in (h or {}).items() if isinstance(v, dict) and KEY_PR.match(k)}


def _save_holds(h: dict[str, dict[str, Any]]) -> None:
    storage.write_json(data_dir() / "holds.json", {"$axf": "git-status-holds@1", "holds": h})


class MergeHolds:
    """axf.merge-holds@1: PRs put on hold by hand. The push banner skips them in auto-merge and refuses Merge."""
    version = 1

    def held(self, repo: str, number: int | None, branch: str = "") -> str:
        h = holds().get(f"{repo}#{number}") if number else None
        return (h.get("reason") or "put on hold in Git status") if h else ""

    def all(self) -> dict[str, dict[str, Any]]:
        return holds()


plugin_services.provide(HOLDS_CAP, MergeHolds(), FOLDER)


def batches() -> list[dict[str, Any]]:
    raw = storage.read_json(data_dir() / "batches.json", {}) or {}
    b = raw.get("batches") if isinstance(raw, dict) else None
    return [x for x in (b or []) if isinstance(x, dict) and BATCH_ID.match(str(x.get("id") or ""))][:MAX_BATCHES]


def _save_batches(b: list[dict[str, Any]]) -> None:
    storage.write_json(data_dir() / "batches.json", {"$axf": "git-status-batches@1", "batches": b[:MAX_BATCHES]})


# ---------------------------------------------------------------- side sources (cached)

class _Cached:
    def __init__(self, ttl: float, fn) -> None:
        self.ttl, self.fn, self.at, self.val, self.lock = ttl, fn, 0.0, None, threading.Lock()

    def get(self, force: bool = False) -> Any:
        with self.lock:
            if force or self.val is None or time.time() - self.at > self.ttl:
                try:
                    self.val = self.fn()
                except Exception as e:  # noqa: BLE001 — one broken source never breaks the board
                    self.val = {"error": _text(e, 200)}
                self.at = time.time()
            return self.val


SCANNER = localgit.Scanner(cx.ROOT)


def _store() -> dict[str, Any]:
    f = cx.ROOT / "_claude" / "builds" / "store.json"
    raw = storage.read_json(f, {}) or {}
    by_branch: dict[str, dict[str, Any]] = {}
    by_pr: dict[int, dict[str, Any]] = {}
    for b in raw.get("builds") or []:
        if not isinstance(b, dict) or b.get("deleted"):
            continue
        b = {**b, "said": ((b.get("origin") or {}).get("said") if isinstance(b.get("origin"), dict) else "") or ""}
        if b.get("branch"):
            by_branch[str(b["branch"])] = b
        m = re.match(r"#?(\d+)$", str(b.get("pr") or "").strip())
        if m:
            by_pr[int(m.group(1))] = b
    return {"byBranch": by_branch, "byPr": by_pr}


def _report_summary(build_id: str) -> str:
    if not build_id or not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,80}", build_id):
        return ""
    f = cx.ROOT / "_claude" / "builds" / "reports" / f"{build_id}.md"
    try:
        return core.first_sentence(f.read_text("utf-8")[:6000])
    except OSError:
        return ""


def _costs() -> dict[str, float]:
    svc = _svc(CHANGES)
    if not svc:
        return {}
    out: dict[str, float] = {}
    for e in svc.summaries() or []:
        b = e.get("branch") if isinstance(e, dict) else None
        if not b:
            continue
        c = (e.get("actual") or {}).get("costUsd")
        if c is None:
            c = (e.get("estimate") or {}).get("costUsd")
        if isinstance(c, (int, float)):
            out[b] = round(out.get(b, 0.0) + float(c), 2)
    return out


def _deployed() -> list[dict[str, Any]]:
    svc = _svc(CONTAINERS)
    if not svc:
        return []
    created: dict[str, int] = {}
    try:
        for c in svc.docker.containers():
            created[str(c.get("Id", ""))[:64]] = int(c.get("Created") or 0)
    except Exception:  # noqa: BLE001
        pass
    out = []
    for c in svc.list():
        name, image = c.get("name") or "", c.get("image") or ""
        tag = image.rsplit(":", 1)[-1] if ":" in image else ""
        exact = bool(re.fullmatch(r"[0-9a-f]{40}", tag))
        if name not in DEPLOY_APPS and not exact:
            continue
        ts = created.get(c.get("id") or "", 0)
        started = datetime.fromtimestamp(ts, timezone.utc).isoformat().replace("+00:00", "Z") if ts else ""
        commit = SCANNER.commit_info(tag) if exact else (SCANNER.commit_at(started) if started else {})
        out.append({"name": name, "repo": DEPLOY_APPS.get(name, ""), "image": image, "state": c.get("state") or "", "status": c.get("status") or "",
                    "startedAt": started, "exact": exact, "commit": commit, "behind": commit.get("behind")})
    return out


def _merged_since() -> str:
    try:
        from zoneinfo import ZoneInfo
        local = datetime.now(ZoneInfo(os.environ.get("AXF_GIT_STATUS_TZ") or "America/New_York"))
        start = local.replace(hour=0, minute=0, second=0, microsecond=0).astimezone(timezone.utc)
    except Exception:  # noqa: BLE001
        start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    return start.strftime("%Y-%m-%dT%H:%M:%SZ")


def _merged() -> list[dict[str, Any]]:
    svc = _svc(PUSH)
    return svc.merged(_merged_since()) if svc else []


STORE = _Cached(20, _store)
COSTS = _Cached(SIDE_CACHE_S, _costs)
DEPLOY = _Cached(SIDE_CACHE_S, _deployed)
MERGED = _Cached(120, _merged)


def _ui(repo: str, number: int | None, branch: str) -> dict[str, Any] | None:
    svc = _svc(UI)
    if not svc or not (branch or number):
        return None
    try:
        return svc.state(branch, number if repo == UI_REPO else None)
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------- the board

class Board:
    """The board, built at most every BOARD_CACHE_S. A read never waits behind a rebuild: once there is a board, a stale
    or forced read answers the last one and rebuilds in the background (the page's live feed picks the new one up).
    Only the very first read waits for a build."""

    def __init__(self) -> None:
        self.lock = threading.Lock()
        self.first = threading.Lock()
        self.at = 0.0
        self.val: dict[str, Any] | None = None
        self.running = False
        self.forced_github = 0.0

    def _run(self, force: bool) -> None:
        try:
            v = self.build(force)
            with self.lock:
                self.val, self.at = v, time.time()
        finally:
            with self.lock:
                self.running = False

    def get(self, force: bool = False, wait: bool = False) -> dict[str, Any]:
        with self.lock:
            fresh = self.val is not None and time.time() - self.at < BOARD_CACHE_S
            if self.val is not None and fresh and not force:
                return self.val
            start = not self.running
            if start:
                self.running = True
            have = self.val
        if have is not None and not wait:
            if start:
                threading.Thread(target=self._run, args=(force,), name="git-status-board", daemon=True).start()
            return have
        with self.first:  # nothing yet (or wait=True): build now, one at a time
            with self.lock:
                if self.val is not None and not wait and not force:
                    return self.val
            if start:
                self._run(force)
            else:
                v = self.build(force)
                with self.lock:
                    self.val, self.at = v, time.time()
            with self.lock:
                return self.val  # type: ignore[return-value]

    def build(self, force: bool) -> dict[str, Any]:
        now = time.time()
        errors: dict[str, str] = {}
        push = _svc(PUSH)
        snap: dict[str, Any] = {}
        if push is None:
            errors["github"] = "the Push banner plugin is off, so GitHub isn't read (Settings → Plugins → Push banner)"
        else:
            try:
                hard = force and time.time() - self.forced_github >= FORCE_GITHUB_EVERY_S
                if hard:
                    self.forced_github = time.time()
                snap = push.snapshot(force=hard) or {}
                if snap.get("error"):
                    errors["github"] = _text(snap["error"], 200)
            except Exception as e:  # noqa: BLE001
                errors["github"] = _text(e, 200)
        local = SCANNER.scan(force=force)
        if local.get("warning"):
            errors["local"] = local["warning"]
        store = STORE.get(force)
        store = store if isinstance(store, dict) and "byBranch" in store else {"byBranch": {}, "byPr": {}}
        costs = COSTS.get(force)
        costs = costs if isinstance(costs, dict) and "error" not in costs else {}
        hs = holds()
        bs = batches()
        in_batch = {k: b["id"] for b in bs for k in b.get("items") or []}
        rows: list[dict[str, Any]] = []
        pr_by_branch: dict[str, dict[str, Any]] = {}

        def build_for(branch: str, number: int | None, repo: str) -> dict[str, Any] | None:
            if repo and repo != UI_REPO:
                return store["byBranch"].get(branch) if branch else None
            return (store["byPr"].get(number) if number else None) or (store["byBranch"].get(branch) if branch else None)

        for r in snap.get("repos") or []:
            repo = r.get("repo") or ""
            if r.get("error"):
                errors[f"github {repo}"] = _text(r["error"], 200)
            ahead_of = {b.get("name"): (b.get("ahead"), b.get("behind")) for b in r.get("branches") or []}
            open_numbers = {p.get("number") for p in r.get("pulls") or [] if isinstance(p.get("number"), int)}
            for p in r.get("pulls") or []:
                n = p.get("number")
                if not isinstance(n, int):
                    continue
                b = build_for(p.get("head") or "", n, repo)
                ahead, behind = ahead_of.get(p.get("head"), (None, None))
                if behind is None and p.get("mergeState") == "behind":
                    behind = 1
                row = core.pr_row(repo, p, build=b, summary=_report_summary((b or {}).get("id", "")), ui=_ui(repo, n, p.get("head") or ""),
                                  hold=hs.get(f"{repo}#{n}"), open_numbers=open_numbers, behind=behind, ahead=ahead,
                                  cost=costs.get(p.get("head") or ""), batch=in_batch.get(f"{repo}#{n}", ""), now=now)
                rows.append(row)
                if repo == UI_REPO and p.get("head"):
                    pr_by_branch[p["head"]] = row
            for br in r.get("branches") or []:
                if br.get("pr") or br.get("hidden") or br.get("ahead") is None:
                    continue
                b = build_for(br.get("name") or "", None, repo)
                rows.append(core.branch_row(repo, br, build=b, summary=_report_summary((b or {}).get("id", "")), cost=costs.get(br.get("name") or ""), now=now))
        for w in local.get("items") or []:
            if w.get("error") and not w.get("branch"):
                continue
            pr = pr_by_branch.get(w.get("branch") or "")
            b = build_for(w.get("branch") or "", (pr or {}).get("number"), w.get("repo") or UI_REPO)
            row = core.worktree_row(w, build=b, summary=_report_summary((b or {}).get("id", "")), pr=pr, cost=costs.get(w.get("branch") or ""), now=now)
            if row["sections"]:
                rows.append(row)
        merged = MERGED.get(force)
        if isinstance(merged, list):
            for m in merged:
                b = build_for(m.get("head") or "", m.get("number"), m.get("repo") or "")
                rows.append(core.merged_row(m, build=b, summary=_report_summary((b or {}).get("id", "")), cost=costs.get(m.get("head") or "")))
        elif isinstance(merged, dict) and merged.get("error"):
            errors["merged"] = merged["error"]
        dep = DEPLOY.get(force)
        if isinstance(dep, list):
            rows.extend(core.deploy_row(c) for c in dep)
        elif isinstance(dep, dict) and dep.get("error"):
            errors["deployed"] = dep["error"]
        if _svc(CONTAINERS) is None:
            errors["deployed"] = "Container access is off, so deployed apps aren't read"
        by_key = {r["key"]: r for r in rows}
        views = [core.batch_view(b, by_key) for b in bs]
        body = {"rows": rows, "batches": views}
        stamp = hashlib.sha1(json.dumps(body, sort_keys=True, default=str).encode()).hexdigest()[:16]
        return {"$axf": "git-status-board@1", "checkedAt": int(now * 1000), "stamp": stamp, "sections": core.SECTIONS, "counts": core.counts(rows),
                **body, "errors": errors, "sources": {"github": push is not None and "github" not in errors, "local": len(local.get("items") or []),
                                                     "ui": _svc(UI) is not None, "cost": _svc(CHANGES) is not None, "deployed": _svc(CONTAINERS) is not None},
                "githubCheckedAt": snap.get("checkedAt"), "localCheckedAt": local.get("checkedAt")}


BOARD = Board()


def _row(key: str) -> dict[str, Any]:
    if not isinstance(key, str) or len(key) > 400:
        raise HTTPException(400, "key is a row key")
    r = next((x for x in BOARD.get()["rows"] if x["key"] == key), None) or next((x for x in BOARD.get(force=True, wait=True)["rows"] if x["key"] == key), None)
    if r is None:
        raise HTTPException(404, "no such row on the board (it may have merged or gone: reload)")
    return r


def _pr_key(key: Any) -> tuple[str, int]:
    m = KEY_PR.match(str(key or ""))
    if not m:
        raise HTTPException(400, 'key is "<owner>/<name>#<number>" (a PR)')
    return m.group(1), int(m.group(2))


def _push() -> Any:
    svc = _svc(PUSH)
    if svc is None:
        raise HTTPException(409, "the Push banner plugin is off: it does every GitHub write (Settings → Plugins → Push banner)")
    return svc


def _body(body: Any, *keys: str) -> dict[str, Any]:
    if not isinstance(body, dict) or set(body) - set(keys) - {"by", "reason", "confirm"}:
        raise HTTPException(400, f"send {{{', '.join(keys)}}}")
    return body


def _changed() -> None:
    """After a write: the next read rebuilds (in the background once there is a board)."""
    with BOARD.lock:
        BOARD.at = 0.0


# ---------------------------------------------------------------- reads

@router.get("/board")
def board(since: str = "", refresh: bool = False) -> dict[str, Any]:
    b = BOARD.get(force=refresh)
    if since and since == b["stamp"]:
        return {"same": True, "stamp": b["stamp"], "checkedAt": b["checkedAt"]}
    return b


@router.get("/sections")
def sections() -> dict[str, Any]:
    b = BOARD.get()
    return {"sections": [{**s, "count": b["counts"].get(s["id"], 0)} for s in core.SECTIONS], "errors": b["errors"], "checkedAt": b["checkedAt"]}


@router.get("/list")
def list_section(section: str = "ready", q: str = "") -> dict[str, Any]:
    if section not in core.SECTION_IDS:
        raise HTTPException(400, f"section is one of {', '.join(core.SECTION_IDS)}")
    ql = q.lower()[:100]
    rows = [r for r in BOARD.get()["rows"] if section in r["sections"] and (not ql or ql in json.dumps([r["lead"], r["branch"], r["agent"], r["status"]]).lower())]
    return {"section": section, "count": len(rows), "items": [{k: r.get(k) for k in ("key", "lead", "branch", "agent", "status", "ci", "ahead", "behind", "at", "cost", "url")}
                                                               | {"blocking": [b["why"] for b in r.get("blockers") or []]} for r in rows][:200]}


@router.get("/item")
def item(key: str) -> dict[str, Any]:
    r = _row(key)
    out: dict[str, Any] = {"row": r, "commits": [], "checks": [], "body": "", "files": None, "error": ""}
    push = _svc(PUSH)
    try:
        if r["kind"] == "pr" and push:
            d = push.detail(r["repo"], r["number"], None)
            out.update({"commits": d.get("commits") or [], "body": d.get("body") or "", "files": d.get("files"), "mergeState": d.get("mergeState"), "error": d.get("error") or ""})
            if d.get("sha") or r.get("sha"):
                out["checks"] = push.checks(r["repo"], d.get("sha") or r["sha"])
        elif r["kind"] == "branch" and push:
            d = push.detail(r["repo"], None, r["branch"])
            out.update({"commits": d.get("commits") or [], "files": d.get("files"), "error": d.get("error") or ""})
            if d.get("sha"):
                out["checks"] = push.checks(r["repo"], d["sha"])
        elif r["kind"] == "worktree":
            out["commits"] = SCANNER.local_log(r.get("path") or "")
    except HTTPException as e:
        out["error"] = _text(e.detail, 300)
    except Exception as e:  # noqa: BLE001
        out["error"] = _text(e, 300)
    return out


@router.get("/files")
def files(repo: str, number: int) -> dict[str, Any]:
    return {"files": _push().files(repo, number)}


@router.get("/batches")
def get_batches() -> dict[str, Any]:
    return {"batches": BOARD.get()["batches"]}


# ---------------------------------------------------------------- writes

@router.post("/merge")
def merge(body: Any = Body(None)) -> dict[str, Any]:
    repo, n = _pr_key(_body(body, "key")["key"])
    try:
        res = _push().merge(repo, n)
    finally:
        _changed()
    return res


@router.post("/hold")
def hold(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "key", "on")
    repo, n = _pr_key(b["key"])
    key = f"{repo}#{n}"
    with _lock:
        h = holds()
        on = b.get("on") if isinstance(b.get("on"), bool) else key not in h
        if on:
            h[key] = {"reason": _text(b.get("reason") or "", 200) or "put on hold in Git status", "by": _text(b.get("by") or "console", 80),
                      "at": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")}
        else:
            h.pop(key, None)
        _save_holds(h)
    _changed()
    return {"key": key, "held": on}


@router.post("/update")
def update(body: Any = Body(None)) -> dict[str, Any]:
    key = _body(body, "key")["key"]
    m, mb = KEY_PR.match(str(key)), KEY_BRANCH.match(str(key))
    try:
        if m:
            return _push().update(m.group(1), int(m.group(2)), None)
        if mb:
            return _push().update(mb.group(1), None, mb.group(2))
        raise HTTPException(400, "Update from main works on a PR or a pushed branch (a local worktree pulls on the VPS)")
    finally:
        _changed()


@router.post("/rerun")
def rerun(body: Any = Body(None)) -> dict[str, Any]:
    r = _row(_body(body, "key")["key"])
    if r["kind"] not in ("pr", "branch") or not r.get("sha"):
        raise HTTPException(400, "Re-run CI works on a PR or a pushed branch")
    try:
        return _push().rerun(r["repo"], r["sha"])
    finally:
        _changed()


def _job(job: str, inputs: dict[str, str]) -> dict[str, Any]:
    cli = cx.ROOT / "framework" / "cli" / "agent-job.mjs"
    if not cli.exists():
        raise HTTPException(409, "agent jobs aren't installed here (framework/cli/agent-job.mjs)")
    args = ["node", str(cli), job]
    for k, v in inputs.items():
        args += ["--input", f"{k}={v}"]
    p = subprocess.run([*args, "--json"], cwd=str(cx.ROOT), capture_output=True, text=True, timeout=90)
    last = (p.stdout.strip().splitlines() or [""])[-1]
    try:
        res = json.loads(last)
    except json.JSONDecodeError:
        res = {"ok": p.returncode == 0, "text": (p.stdout or p.stderr).strip()[-600:]}
    if p.returncode == 3:
        raise HTTPException(409, f"nobody can take the {job} job right now: {(res.get('error') or res.get('text') or p.stderr.strip())[:300]}")
    if p.returncode != 0:
        raise HTTPException(502, f"{job} job didn't start: {(res.get('error') or p.stderr.strip() or res.get('text') or '')[:300]}")
    return {"job": job, **res}


@router.post("/fix")
def fix(body: Any = Body(None)) -> dict[str, Any]:
    r = _row(_body(body, "key")["key"])
    if r["kind"] not in ("pr", "branch"):
        raise HTTPException(400, "Fix works on a PR or a pushed branch")
    lines: list[str] = []
    try:
        for c in (_push().checks(r["repo"], r["sha"]) if r.get("sha") else []):
            for ln in c.get("lines") or []:
                lines.append(f"{c['name']}: {ln}")
    except Exception:  # noqa: BLE001 — the agent reads the logs itself anyway
        pass
    problem = "; ".join(b["why"] for b in r.get("blockers") or [] if b["kind"] in ("ci", "conflict")) or "it can't merge"
    return _job("ops-fix", {"repo": r["repo"], "pr": str(r.get("number") or ""), "branch": r["branch"], "problem": problem[:300], "lines": "\n".join(lines[:30])[:3000]})


@router.post("/land")
def land(body: Any = Body(None)) -> dict[str, Any]:
    r = _row(_body(body, "key")["key"])
    if not r.get("branch") or r["branch"] in ("main", "master"):
        raise HTTPException(400, "Land works on a build branch")
    return _job("land-build", {"branch": r["branch"], "build": (r.get("build") or {}).get("id") or ""})


@router.post("/close")
def close(body: Any = Body(None)) -> dict[str, Any]:
    repo, n = _pr_key(_body(body, "key")["key"])
    try:
        return _push().close(repo, n)
    finally:
        _changed()


@router.post("/kill")
def kill(body: Any = Body(None)) -> dict[str, Any]:
    key = str(_body(body, "key")["key"])
    mb = KEY_BRANCH.match(key)
    if KEY_PR.match(key):
        raise HTTPException(400, "a PR is closed, not killed: use Close")
    if not mb:
        raise HTTPException(400, "Kill deletes a pushed GitHub branch with no open PR; a local worktree is removed on the VPS (git worktree remove)")
    try:
        return _push().delete_branch(mb.group(1), mb.group(2))
    finally:
        _changed()


def _new_id() -> str:
    return "b-" + hashlib.sha1(f"{time.time_ns()}".encode()).hexdigest()[:8]


def _batch(bs: list[dict[str, Any]], bid: Any) -> dict[str, Any]:
    b = next((x for x in bs if x.get("id") == bid), None)
    if b is None:
        raise HTTPException(404, "no such batch")
    return b


@router.post("/batches")
def new_batch(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "title", "items")
    items = [str(k) for k in b.get("items") or [] if KEY_PR.match(str(k))][:MAX_BATCH_ITEMS]
    title = _text(b.get("title") or "", 120).strip() or f"Batch {datetime.now(timezone.utc).strftime('%b %d %H:%M')}"
    with _lock:
        bs = batches()
        if len(bs) >= MAX_BATCHES:
            raise HTTPException(409, f"up to {MAX_BATCHES} batches: remove a finished one first")
        nb = {"id": _new_id(), "title": title, "items": list(dict.fromkeys(items)), "createdAt": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
              "by": _text(b.get("by") or "console", 80)}
        bs.append(nb)
        _save_batches(bs)
    _changed()
    return {"batch": nb}


@router.post("/batches/add")
def batch_add(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "id", "key")
    repo, n = _pr_key(b["key"])
    with _lock:
        bs = batches()
        for x in bs:  # a PR is in one batch at a time
            x["items"] = [k for k in x.get("items") or [] if k != f"{repo}#{n}"]
        t = _batch(bs, b["id"])
        if len(t["items"]) >= MAX_BATCH_ITEMS:
            raise HTTPException(409, f"a batch holds up to {MAX_BATCH_ITEMS} PRs")
        t["items"].append(f"{repo}#{n}")
        _save_batches(bs)
    _changed()
    return {"batch": t}


@router.post("/batches/take-out")
def batch_drop(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "id", "key")
    with _lock:
        bs = batches()
        t = _batch(bs, b["id"])
        t["items"] = [k for k in t.get("items") or [] if k != b["key"]]
        _save_batches(bs)
    _changed()
    return {"batch": t}


@router.post("/batches/order")
def batch_order(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "id", "items")
    with _lock:
        bs = batches()
        t = _batch(bs, b["id"])
        want = [str(k) for k in b.get("items") or []]
        if sorted(want) != sorted(t.get("items") or []):
            raise HTTPException(400, "send the batch's same PRs in the new order")
        t["items"] = want
        _save_batches(bs)
    _changed()
    return {"batch": t}


@router.post("/batches/merge-next")
def batch_merge_next(body: Any = Body(None)) -> dict[str, Any]:
    """One step of a batch, in its merge order: merge the first PR that is ready; a PR before it that is only behind
    main gets main pulled in first (then it waits for CI on its new head, like auto-merge)."""
    b = _body(body, "id")
    view = next((v for v in BOARD.get(force=True, wait=True)["batches"] if v.get("id") == b["id"]), None)
    if view is None:
        raise HTTPException(404, "no such batch")
    push = _push()
    try:
        for r in view["items"]:
            if r.get("kind") != "pr":
                continue
            if "ready" in r["sections"]:
                if (r.get("behind") or 0) > 0:
                    push.update(r["repo"], r["number"], None)
                    return {"did": "update", "key": r["key"], "text": f"pulled main into #{r['number']}: it merges once CI is green on the new head"}
                res = push.merge(r["repo"], r["number"])
                return {"did": "merge", "key": r["key"], "merged": bool(res.get("merged")), "text": f"merged #{r['number']}" if res.get("merged") else f"#{r['number']} didn't merge"}
            return {"did": "wait", "key": r["key"], "text": f"#{r['number']} goes first and isn't ready: " + ("; ".join(x["why"] for x in r.get("blockers") or []) or r.get("status", ""))}
        return {"did": "nothing", "text": "every PR in this batch is merged or gone"}
    finally:
        _changed()


@router.post("/batches/remove")
def batch_remove(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body, "id")
    with _lock:
        bs = batches()
        _batch(bs, b["id"])
        _save_batches([x for x in bs if x.get("id") != b["id"]])
    _changed()
    return {"removed": b["id"]}
