"""Activity feed (activity@1): everything in progress, from every source, in one list.

An item:
    {id, source, kind, title, detail, state, progress?, startedAt, updatedAt, finishedAt?, url?, by?, steps?: [{name, state}]}
    state: queued | running | waiting  (active)  ·  done | failed | cancelled | stale  (finished, shown for a while)

Sources (each can be switched off in Settings → Plugins → Activity):
  github     GitHub Actions runs queued or running on the watched repos (+ the ones that just finished); per-run jobs and
             steps on request (detail)
  update     the console's own 5-minute update: deploy/install-console.sh's update script writes
             .axf-console/update-status.json while it pulls and rebuilds
  assistant  AI assistant replies running right now (capability axf.live-sessions@1)
  services   any capability service with an ``activity()`` method (e.g. axf.syscheck@1: VPS Auto fix jobs). That is the
             open way for a plugin to show its work here without naming this plugin.
  reports    anything that reports itself: POST report, the axf.activity@1 service, or a JSON file in reports/ (written by
             activity.mjs on the VPS, e.g. from Claude Code hooks). An active report not updated for report_ttl_s turns
             stale; finished ones are dropped after linger_s.

Never holds a secret: GitHub calls go through lib-github (axf_server.github: the token to api.github.com only, no
redirects, owner/name checked before any URL), and every title/detail is
passed through ``redact``.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.parse
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, storage

from . import complete

ACTIVE = ("queued", "running", "waiting")
# On hold: parked work that waits for a person (never stuck, never stale, never expires); shown with its buttons,
# e.g. Continue (Gizmo, Oct 25 2026).
HELD = ("held",)
FINISHED = ("done", "failed", "cancelled", "stale")
STATES = ACTIVE + HELD + FINISHED
SOURCES = {
    "github": "GitHub Actions",
    "update": "Console update",
    "assistant": "AI assistant replies",
    "services": "Plugins (VPS Auto fix and others)",
    "reports": "Reported work (Claude Code, scripts)",
    "holds": "Work on hold (waits for you to continue)",
}
# Buttons an item may carry: a runtime action spec (`id` or `id:args`) run in the browser that shows the banner.
ACTION_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,60}(:[A-Za-z0-9._~%:@/+-]{1,200})?$")
ICON_RE = re.compile(r"^[a-z0-9-]{1,24}$")
MAX_ACTIONS = 3


def clean_actions(raw: Any) -> list[dict[str, str]]:
    out: list[dict[str, str]] = []
    if not isinstance(raw, list):
        return out
    for a in raw[:MAX_ACTIONS]:
        if not isinstance(a, dict) or not isinstance(a.get("action"), str) or not ACTION_RE.match(a["action"]):
            continue
        label = redact(a.get("label"), 40).strip()
        if not label:
            continue
        b = {"label": label, "action": a["action"]}
        if isinstance(a.get("icon"), str) and ICON_RE.match(a["icon"]):
            b["icon"] = a["icon"]
        out.append(b)
    return out
ID_RE = re.compile(r"^[A-Za-z0-9_.:@/+-]{1,160}$")
MAX_REPORTS = 200

_SECRET = re.compile(
    r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}"
    r"|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"
    r"|(?i:bearer)\s+[A-Za-z0-9._~+/=-]{12,}"
    r"|(?i:(?:token|secret|password|passwd|api[_-]?key|key))\s*[=:]\s*\S{6,})"
)


def redact(s: Any, limit: int) -> str:
    text = "" if s is None else str(s)
    text = _SECRET.sub("[hidden]", text)
    text = "".join(ch for ch in text if ch == "\n" or ch >= " ")
    return text if len(text) <= limit else text[: limit - 1] + "…"


def _ms(v: Any) -> int | None:
    if v is None or v == "":
        return None
    if isinstance(v, (int, float)):
        n = float(v)
        return int(n * 1000) if n < 1e11 else int(n)  # seconds or ms
    try:
        from datetime import datetime
        return int(datetime.fromisoformat(str(v).replace("Z", "+00:00")).timestamp() * 1000)
    except Exception:  # noqa: BLE001
        return None


def _https(u: Any) -> str | None:
    try:
        p = urllib.parse.urlsplit(str(u))
    except Exception:  # noqa: BLE001
        return None
    if p.scheme != "https" or not p.hostname or p.username or p.password:
        return None
    return urllib.parse.urlunsplit(p)[:500]


def norm(raw: Any, source: str, now_ms: int) -> dict[str, Any] | None:
    """A clean item, or None when it can't be shown (no id/title)."""
    if not isinstance(raw, dict):
        return None
    iid = str(raw.get("id") or "")
    if not ID_RE.match(iid) or ".." in iid:
        return None
    title = redact(raw.get("title"), 160).strip()
    if not title:
        return None
    state = str(raw.get("state") or "running")
    if state not in STATES:
        state = "running"
    it: dict[str, Any] = {
        "id": iid,
        "source": redact(raw.get("source") or source, 40),
        "kind": redact(raw.get("kind") or "task", 40),
        "title": title,
        "detail": redact(raw.get("detail"), 2000),
        "state": state,
        "startedAt": _ms(raw.get("startedAt")) or now_ms,
        "updatedAt": _ms(raw.get("updatedAt")) or _ms(raw.get("startedAt")) or now_ms,
    }
    fin = _ms(raw.get("finishedAt"))
    if fin:
        it["finishedAt"] = fin
    try:
        p = raw.get("progress")
        if p is not None:
            it["progress"] = max(0.0, min(1.0, float(p)))
    except (TypeError, ValueError):
        pass
    if isinstance(raw.get("changeId"), str) and re.match(r"^chg-\d{8}-[0-9a-f]{6,16}$", raw["changeId"]):
        it["changeId"] = raw["changeId"]
    url = _https(raw.get("url")) if raw.get("url") else None
    if url:
        it["url"] = url
    if raw.get("by"):
        it["by"] = redact(raw.get("by"), 60)
    actions = clean_actions(raw.get("actions"))
    if actions:
        it["actions"] = actions
    steps = raw.get("steps")
    if isinstance(steps, list):
        clean = []
        for s in steps[:60]:
            if isinstance(s, dict) and s.get("name"):
                st = str(s.get("state") or "queued")
                clean.append({"name": redact(s.get("name"), 120), "state": st if st in STATES else "queued"})
        if clean:
            it["steps"] = clean
    return it


_GH_STATES = {"success": "done", "failure": "failed"}  # lib-github run states → feed states (others are the same word)


def _gh_state(status: str, conclusion: str | None) -> str:
    s = github.run_state(status, conclusion)
    return _GH_STATES.get(s, s)


class Feed:
    def __init__(self, data_dir: Path, root: Path, default_repos: list[str] | None = None,
                 github_token: Callable[[], str] = lambda: os.environ.get("GITHUB_TOKEN", ""),
                 services: Callable[[], list[tuple[str, Any]]] = lambda: [],
                 live_sessions: Callable[[], Any] = lambda: None,
                 github_get: Callable[[str], Any] | None = None,
                 holds_file: Path | None = None,
                 # status of a pending build by id: its status, "missing" when not on the list, None when unreadable
                 pending_status: Callable[[str], str | None] = lambda pid: None,
                 now: Callable[[], float] = time.time) -> None:
        self.dir = data_dir
        self.root = root
        self.default_repos = [r for r in (default_repos or []) if github.valid_repo(r)]
        self.github_token = github_token
        self.services = services
        self.live_sessions = live_sessions
        self.holds_file = holds_file
        self.pending_status = pending_status
        self.now = now
        self._gh_get = github_get or self._github_get
        self._lock = threading.Lock()
        self._gh_cache: tuple[float, list[dict[str, Any]], list[str]] | None = None
        self._detail_cache: dict[str, tuple[float, dict[str, Any]]] = {}
        self._extra: dict[str, tuple[str, Callable[[], list[dict[str, Any]]]]] = {}

    # ---------------- config

    @property
    def reports_dir(self) -> Path:
        return self.dir / "reports"

    def config(self) -> dict[str, Any]:
        try:
            c = json.loads((self.dir / "config.json").read_text())
        except Exception:  # noqa: BLE001
            c = {}
        src = c.get("sources") if isinstance(c.get("sources"), dict) else {}
        return {
            "sources": {k: bool(src.get(k, True)) for k in SOURCES},
            "repos": [r for r in c.get("repos", self.default_repos) if isinstance(r, str) and github.valid_repo(r)][:20],
            "lingerS": int(c.get("lingerS", 600)) if str(c.get("lingerS", "")).isdigit() else 600,
            "reportTtlS": int(c.get("reportTtlS", 1800)) if str(c.get("reportTtlS", "")).isdigit() else 1800,
            **complete.clean(c),
        }

    def set_config(self, patch: dict[str, Any]) -> dict[str, Any]:
        c = self.config()
        if isinstance(patch.get("sources"), dict):
            for k, v in patch["sources"].items():
                if k in SOURCES:
                    c["sources"][k] = bool(v)
        if isinstance(patch.get("repos"), list):
            bad = [r for r in patch["repos"] if not isinstance(r, str) or not github.valid_repo(r)]
            if bad:
                raise ValueError(f"repos must look like owner/name: {bad[:3]}")
            c["repos"] = list(dict.fromkeys(patch["repos"]))[:20]
        c = complete.patch(c, patch)
        for k, lo, hi in (("lingerS", 0, 86400), ("reportTtlS", 60, 86400)):
            if k in patch:
                try:
                    c[k] = max(lo, min(hi, int(patch[k])))
                except (TypeError, ValueError):
                    raise ValueError(f"{k} must be a number of seconds") from None
        self.dir.mkdir(parents=True, exist_ok=True)
        storage.write_json(self.dir / "config.json", c, dir_mode=None)  # atomic, 0600 (axf_server.storage)
        self._gh_cache = None
        return c

    # Without auto-remove a finished item still leaves after a day (sources like GitHub would otherwise pile up).
    KEEP_MAX_MS = 24 * 3600 * 1000

    def expired(self, state: str, finished: int | None, cfg: dict[str, Any], now: int) -> bool:
        """A finished item past its time: lingerS after it finished (Settings: auto-remove after N minutes), a day
        when auto-remove is off, never for a failure while "keep failures until closed" is on (a day at most)."""
        if state in ACTIVE or state in HELD:
            return False
        age = now - (finished or now)
        if age > self.KEEP_MAX_MS:
            return True
        if not cfg["autoRemove"] or (cfg["keepFailed"] and state in ("failed", "stale")):
            return False
        return age > cfg["lingerS"] * 1000

    # ---------------- open source registry (other code in this process)

    def register_source(self, name: str, label: str, fn: Callable[[], list[dict[str, Any]]]) -> Callable[[], None]:
        if not re.match(r"^[a-z0-9][a-z0-9.-]{0,39}$", name) or name in SOURCES:
            raise ValueError("bad source name")
        self._extra[name] = (label, fn)
        return lambda: self._extra.pop(name, None)

    # ---------------- reports (files, so the VPS host can write them too)

    def _report_path(self, iid: str) -> Path:
        safe = re.sub(r"[^A-Za-z0-9_.@+-]", "_", iid)[:150]
        return self.reports_dir / f"{safe}.json"

    def report(self, raw: dict[str, Any], origin: str = "api") -> dict[str, Any]:
        now = int(self.now() * 1000)
        prev = self._read_report(self._report_path(str(raw.get("id") or "")))
        merged = {**(prev or {}), **{k: v for k, v in raw.items() if v is not None}}
        merged.setdefault("startedAt", now)
        merged["updatedAt"] = now
        if merged.get("state") in FINISHED:
            if not raw.get("finishedAt"):
                merged["finishedAt"] = now
        else:
            merged.pop("finishedAt", None)
        it = norm(merged, "reports", now)
        if not it:
            raise ValueError("an item needs an id (letters, digits, . : @ / + - _) and a title")
        it["origin"] = redact(origin, 60)
        self.reports_dir.mkdir(parents=True, exist_ok=True)
        files = list(self.reports_dir.glob("*.json"))
        p = self._report_path(it["id"])
        if not p.exists() and len(files) >= MAX_REPORTS:
            raise ValueError("too many reported items; finish some first")
        storage.write_json(p, it, indent=None, dir_mode=None)  # atomic, 0600 (axf_server.storage)
        return it

    def finish(self, iid: str, state: str = "done", detail: str | None = None) -> dict[str, Any] | None:
        p = self._report_path(iid)
        prev = self._read_report(p)
        if not prev:
            return None
        return self.report({**prev, "state": state if state in FINISHED else "done", **({"detail": detail} if detail else {}), "finishedAt": None}, prev.get("origin", "api"))

    # Items taken off the banner on purpose (the trash can on a stuck item): every device, for a day.
    DISMISS_KEEP_MS = 24 * 3600 * 1000
    MAX_DISMISSED = 500

    def _dismissed(self, now: int) -> dict[str, int]:
        try:
            raw = json.loads((self.dir / "dismissed.json").read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        if not isinstance(raw, dict):
            return {}
        return {k: v for k, v in raw.items() if isinstance(k, str) and len(k) <= 200 and isinstance(v, int) and now - v < self.DISMISS_KEEP_MS}

    def dismiss(self, iid: str) -> bool:
        """Take an item off the banner everywhere: a reported one is deleted; any other (a GitHub run, a reply, a
        service's item) is remembered as dismissed for a day so it doesn't come back from its source."""
        if not isinstance(iid, str) or not iid or len(iid) > 200:
            return False
        p = self._report_path(iid)
        if p.is_symlink():
            return False  # never touched through a link
        if p.is_file():
            p.unlink()  # a reporter that reports again later shows again: it's alive
            return True
        now = int(self.now() * 1000)
        with self._lock:
            d = self._dismissed(now)
            d[iid] = now
            if len(d) > self.MAX_DISMISSED:
                d = dict(sorted(d.items(), key=lambda kv: kv[1])[-self.MAX_DISMISSED:])
            storage.write_json(self.dir / "dismissed.json", d, indent=None, dir_mode=None)
        return True

    @staticmethod
    def _read_report(p: Path) -> dict[str, Any] | None:
        try:
            if p.is_symlink() or not p.is_file() or p.stat().st_size > 64_000:
                return None
            d = json.loads(p.read_text())
            return d if isinstance(d, dict) else None
        except Exception:  # noqa: BLE001
            return None

    def _reports(self, cfg: dict[str, Any], now: int) -> list[dict[str, Any]]:
        out = []
        if not self.reports_dir.is_dir():
            return out
        for p in sorted(self.reports_dir.glob("*.json"))[: MAX_REPORTS * 2]:
            raw = self._read_report(p)
            it = norm(raw, "reports", now) if raw else None
            if not it:
                continue
            if it["state"] in ACTIVE and now - it["updatedAt"] > cfg["reportTtlS"] * 1000:
                it["state"] = "stale"
                it["finishedAt"] = it["updatedAt"] + cfg["reportTtlS"] * 1000  # it went quiet then; linger from there
                it["detail"] = (it["detail"] + "\n" if it["detail"] else "") + "No word from it for a while: it may have stopped without saying so."
            if self.expired(it["state"], it.get("finishedAt", it["updatedAt"]), cfg, now):
                try:
                    p.unlink()
                except OSError:
                    pass
                continue
            it["reported"] = True
            out.append(it)
        return out

    # ---------------- work on hold (holds.json in the plugin folder: code, so it ships with the repo)

    CONTINUED_KEEP_MS = 30 * 24 * 3600 * 1000

    def holds(self) -> list[dict[str, Any]]:
        """The held items the plugin ships (`holds.json`, activity-holds@1): each {id, title, detail?, kind?,
        pending?, actions: [{label, action, icon?}]}. Never more than 20."""
        if not self.holds_file:
            return []
        try:
            raw = json.loads(self.holds_file.read_text("utf-8"))
        except (OSError, ValueError):
            return []
        items = raw.get("holds") if isinstance(raw, dict) else None
        return [h for h in (items or [])[:20] if isinstance(h, dict) and isinstance(h.get("id"), str) and str(h["id"]).startswith("hold:")]

    def _continued(self) -> dict[str, int]:
        try:
            raw = json.loads((self.dir / "continued.json").read_text("utf-8"))
        except (OSError, ValueError):
            return {}
        return {k: v for k, v in raw.items() if isinstance(k, str) and len(k) <= 200 and isinstance(v, int)} if isinstance(raw, dict) else {}

    def _holds(self, cfg: dict[str, Any], now: int) -> list[dict[str, Any]]:
        """Held items: on hold until someone taps Continue (then Done for a while: the work shows up through its own
        source) or until the pending build they stand for is no longer waiting (started, complete or removed)."""
        out = []
        cont = self._continued()
        for h in self.holds():
            pid = h.get("pending") if isinstance(h.get("pending"), str) else None
            status = self.pending_status(pid) if pid else None
            at = cont.get(h["id"])
            if at:
                if self.expired("done", at, cfg, now):
                    continue
                raw = {**h, "state": "done", "startedAt": at, "updatedAt": at, "finishedAt": at, "actions": None,
                       "detail": "Continued: started in the Build manager (it asks for your axHub approval)."}
            elif pid and status not in (None, "pending", "unsafe"):
                continue  # the pending build moved on (complete, failed …) or was removed ("missing"): nothing to hold
            else:
                raw = {**h, "state": "held", "startedAt": h.get("since") or now, "updatedAt": h.get("since") or now}
            it = norm(raw, "holds", now)
            if it:
                if pid:
                    it["pending"] = redact(pid, 80)
                out.append(it)
        return out

    def continue_item(self, iid: str, by: str = "") -> dict[str, Any]:
        """Continue on a held item: a hold is marked continued (every device); a reported held item turns running.
        Returns {item, action}: the action the browser runs next (the first button's)."""
        now = int(self.now() * 1000)
        for h in self.holds():
            if h["id"] == iid:
                acts = clean_actions(h.get("actions"))
                with self._lock:
                    c = self._continued()
                    c[iid] = now
                    c = {k: v for k, v in c.items() if now - v < self.CONTINUED_KEEP_MS}
                    self.dir.mkdir(parents=True, exist_ok=True)
                    storage.write_json(self.dir / "continued.json", c, indent=None, dir_mode=None)
                return {"id": iid, "action": acts[0]["action"] if acts else None, "by": redact(by, 60)}
        prev = self._read_report(self._report_path(iid))
        if prev and prev.get("state") == "held":
            acts = clean_actions(prev.get("actions"))
            it = self.report({**prev, "state": "running", "detail": (str(prev.get("detail") or "") + "\nContinued" + (f" by {by}" if by else "")).strip()}, prev.get("origin", "api"))
            return {"id": it["id"], "action": acts[0]["action"] if acts else None}
        raise KeyError(iid)

    def hold_back(self, iid: str) -> bool:
        """Put a continued hold back on hold (when the build didn't start after all)."""
        with self._lock:
            c = self._continued()
            if iid not in c:
                return False
            c.pop(iid)
            storage.write_json(self.dir / "continued.json", c, indent=None, dir_mode=None)
        return True

    # ---------------- GitHub Actions

    def _github_get(self, path: str) -> Any:
        if not self.github_token():
            raise RuntimeError("no GitHub token")
        # lib-github: the token to api.github.com only, never follows a redirect, 4 MB cap
        gh = github.GitHubClient(self.github_token, user_agent="axf-console-activity", timeout=12, max_bytes=4_000_000)
        try:
            return gh.get(path)
        except github.GitHubError as e:
            raise RuntimeError(f"GitHub answered {e.status}" if e.status else str(e)) from None

    def _github(self, cfg: dict[str, Any], now: int) -> tuple[list[dict[str, Any]], list[str]]:
        if self._gh_cache and self.now() - self._gh_cache[0] < 20:
            return self._gh_cache[1], self._gh_cache[2]
        if not self.github_token():
            return [], ["GitHub: no token (Keys needed → GitHub)"]
        items: list[dict[str, Any]] = []
        errors: list[str] = []
        for repo in cfg["repos"]:
            runs: dict[int, dict[str, Any]] = {}
            try:
                for status in ("in_progress", "queued", "waiting"):
                    for r in self._gh_get(github.repo_path(repo, "actions", "runs", query={"status": status, "per_page": 30})).get("workflow_runs", []):
                        runs[int(r.get("id") or 0)] = r
                for r in self._gh_get(github.repo_path(repo, "actions", "runs", query={"status": "completed", "per_page": 10})).get("workflow_runs", []):
                    runs.setdefault(int(r.get("id") or 0), r)
            except Exception as e:  # noqa: BLE001 — one repo failing doesn't hide the others
                errors.append(f"GitHub {repo}: {redact(e, 120)}")
                continue
            for rid, r in runs.items():
                state = _gh_state(str(r.get("status") or ""), r.get("conclusion"))
                started = _ms(r.get("run_started_at")) or _ms(r.get("created_at")) or now
                updated = _ms(r.get("updated_at")) or started
                if self.expired(state, updated, cfg, now):
                    continue
                commit = (r.get("head_commit") or {}).get("message") or r.get("display_title") or ""
                it = norm({
                    "id": f"gh:{repo}:{rid}", "kind": "ci", "state": state,
                    "title": f"{r.get('name') or 'Workflow'} · {repo.split('/')[-1]}",
                    "detail": f"{r.get('event', 'run')} on {r.get('head_branch') or '?'} · #{r.get('run_number', '')}\n{str(commit).splitlines()[0] if commit else ''}".strip(),
                    "startedAt": started, "updatedAt": updated,
                    "finishedAt": updated if state not in ACTIVE else None,
                    "url": r.get("html_url"), "by": (r.get("actor") or {}).get("login"),
                }, "github", now)
                if it:
                    items.append(it)
        self._gh_cache = (self.now(), items, errors)
        return items, errors

    def _github_detail(self, iid: str) -> dict[str, Any]:
        m = re.match(r"^gh:([^:]{3,140}):(\d{1,20})$", iid)
        if not m or not github.valid_repo(m.group(1)):
            raise KeyError(iid)
        repo, rid = m.groups()
        if repo not in self.config()["repos"]:
            raise KeyError(iid)
        hit = self._detail_cache.get(iid)
        if hit and self.now() - hit[0] < 8:
            return hit[1]
        jobs = self._gh_get(github.repo_path(repo, "actions", "runs", int(rid), "jobs", query={"per_page": 50})).get("jobs", [])
        groups = []
        done = total = 0
        for j in jobs:
            steps = []
            for s in j.get("steps") or []:
                st = _gh_state(str(s.get("status") or ""), s.get("conclusion"))
                steps.append({"name": redact(s.get("name"), 120), "state": st})
                total += 1
                done += st in FINISHED
            groups.append({"name": redact(j.get("name"), 120), "state": _gh_state(str(j.get("status") or ""), j.get("conclusion")),
                           "startedAt": _ms(j.get("started_at")), "finishedAt": _ms(j.get("completed_at")),
                           "url": _https(j.get("html_url")), "steps": steps})
        res = {"id": iid, "jobs": groups, "progress": (done / total) if total else None}
        self._detail_cache[iid] = (self.now(), res)
        return res

    # ---------------- console update

    def _update(self, cfg: dict[str, Any], now: int) -> list[dict[str, Any]]:
        p = self.root / ".axf-console" / "update-status.json"
        try:
            if p.is_symlink() or p.stat().st_size > 16_000:
                return []
            d = json.loads(p.read_text())
        except Exception:  # noqa: BLE001
            return []
        state = {"building": "running", "pulling": "running", "done": "done", "failed": "failed"}.get(str(d.get("state")), "")
        if not state:
            return []
        started = _ms(d.get("startedAt")) or now
        fin = _ms(d.get("finishedAt"))
        if state == "running" and now - started > 45 * 60 * 1000:
            state, fin = "stale", started + 45 * 60 * 1000  # the update script died without saying so
        if self.expired(state, fin or started, cfg, now):
            return []
        frm, to = str(d.get("from") or "")[:7], str(d.get("to") or "")[:7]
        it = norm({"id": "console-update", "kind": "deploy", "state": state, "title": "Console update",
                   "detail": (f"Rebuilding the console: {frm} → {to}" if state == "running" else
                              f"Updated {frm} → {to}" if state == "done" else
                              f"Update {frm} → {to} failed (see /var/log/axf-console-update.log on the VPS)") + (f"\n{d.get('message')}" if d.get("message") else ""),
                   "startedAt": started, "updatedAt": fin or started, "finishedAt": fin,
                   "steps": [{"name": "Pull from GitHub", "state": "done"},
                             {"name": "Build the image and restart", "state": "running" if state == "running" else ("done" if state == "done" else "failed")}]},
                  "update", now)
        return [it] if it else []

    # ---------------- AI assistant replies

    def _assistant(self, now: int) -> list[dict[str, Any]]:
        svc = self.live_sessions()
        if not svc:
            return []
        out = []
        for s in svc.list() or []:
            if not isinstance(s, dict) or s.get("state") not in ("running", "waiting"):
                continue
            it = norm({"id": f"assistant:{s.get('id')}", "kind": "ai", "state": s["state"],
                       "title": f"AI reply: {s.get('title') or 'conversation'}",
                       "detail": "Writing a reply" + (f" · {s['viewers']} watching" if s.get("viewers") else "") + (" (waiting on you)" if s["state"] == "waiting" else ""),
                       "startedAt": s.get("updatedAt") or s.get("createdAt"), "updatedAt": s.get("updatedAt")}, "assistant", now)
            if it:
                out.append(it)
        return out

    # ---------------- everything

    def snapshot(self) -> dict[str, Any]:
        cfg = self.config()
        now = int(self.now() * 1000)
        items: list[dict[str, Any]] = []
        errors: list[str] = []

        def run(name: str, fn: Callable[[], list[dict[str, Any]]]) -> None:
            try:
                items.extend(fn())
            except Exception as e:  # noqa: BLE001 — a broken source never hides the others
                errors.append(f"{name}: {redact(e, 160)}")

        if cfg["sources"]["github"]:
            def gh() -> list[dict[str, Any]]:
                got, errs = self._github(cfg, now)
                errors.extend(errs)
                return got
            run("GitHub", gh)
        if cfg["sources"]["update"]:
            run("Console update", lambda: self._update(cfg, now))
        if cfg["sources"]["assistant"]:
            run("AI assistant", lambda: self._assistant(now))
        if cfg["sources"]["services"]:
            for name, impl in self.services():
                fn = getattr(impl, "activity", None)
                if callable(fn):
                    run(name, lambda fn=fn, name=name: [x for x in (norm(r, name, now) for r in (fn() or [])[:50]) if x])
            for name, (label, fn) in list(self._extra.items()):
                run(label, lambda fn=fn, name=name: [x for x in (norm(r, name, now) for r in (fn() or [])[:50]) if x])
        if cfg["sources"]["reports"]:
            run("Reports", lambda: self._reports(cfg, now))
        if cfg["sources"]["holds"]:
            run("Holds", lambda: self._holds(cfg, now))

        seen: set[str] = set(self._dismissed(now))
        uniq = []
        for it in items:
            if it["state"] in FINISHED and self.expired(it["state"], it.get("finishedAt") or it["updatedAt"], cfg, now):
                continue
            if it["id"] not in seen:
                seen.add(it["id"])
                uniq.append(it)
        rank = lambda i: 0 if i["state"] in ACTIVE else 1 if i["state"] in HELD else 2  # noqa: E731
        uniq.sort(key=lambda i: (rank(i), -(i.get("finishedAt") or i["startedAt"]) if rank(i) == 2 else i["startedAt"]))
        active = [i for i in uniq if i["state"] in ACTIVE]
        held = [i for i in uniq if i["state"] in HELD]
        return {"items": uniq, "active": len(active), "held": len(held), "errors": errors[:10], "checkedAt": now,
                "sources": {k: {"label": v, "on": cfg["sources"][k]} for k, v in SOURCES.items()},
                "complete": {k: cfg[k] for k in ("sound", "toast", "expandOnDone", "openResult", "onClose")}}

    def detail(self, iid: str) -> dict[str, Any]:
        if iid.startswith("gh:"):
            return self._github_detail(iid)
        for it in self.snapshot()["items"]:
            if it["id"] == iid:
                return {"id": iid, "item": it}
        raise KeyError(iid)
