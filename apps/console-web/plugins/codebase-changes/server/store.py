"""change-log@1 in Python: the same checks as changes-core.mjs (test.py runs both on the same cases) and the folder store.

Storage: one file per entry, <changes dir>/<YYYY>/<MM>/<id>.json, written atomically (axf_server.storage: temp file →
fsync → replace). In the hub's projects tree (a setgid, group-shared folder) files are 0660 and new folders 2770 so
axHub, which runs as another user, can serve them; anywhere else 0600 / 0700. There is no index file next to the
entries (it would conflict when two copies sync); `Store` keeps an in-memory index rebuilt from the files' mtimes.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

FORMAT = "change-log@1"
KINDS = ("build", "edit", "remove", "fix", "other")
STEP_STATES = ("queued", "running", "done", "failed", "skipped")
RESULT_STATES = ("done", "failed", "partial", "cancelled")
ID_RE = re.compile(r"^chg-(\d{8})-[0-9a-f]{6,16}$")
LIMITS = {"title": 160, "asked": 600, "model": 40, "repos": 10, "steps": 100, "stepText": 300, "note": 1000, "summary": 4000,
          "commits": 50, "commitMsg": 200, "tests": 50, "testName": 120, "testValue": 60, "links": 20, "link": 500, "who": 80,
          "bytes": 64 * 1024}

_SECRET = re.compile(
    r"(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|sk-[A-Za-z0-9_-]{16,}|xox[abpr]-[A-Za-z0-9-]{10,}"
    r"|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}"
    r"|[Bb]earer\s+[A-Za-z0-9._~+/=-]{12,}"
    r"|(?i:(?:token|secret|password|passwd|api[_-]?key|key))\s*[=:]\s*\S{6,})", re.IGNORECASE)
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?Z$")
_REPO = re.compile(r"^[A-Za-z0-9_.-]{1,39}/[A-Za-z0-9_.-]{1,100}$")
_SHA = re.compile(r"^[0-9a-f]{7,40}$")
_BRANCH = re.compile(r"^[A-Za-z0-9._/-]{1,120}$")
_KIND = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
_LINK_NAME = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
_PATHLIKE = re.compile(r"^[A-Za-z0-9_.][A-Za-z0-9_./ -]*$")


def now_iso() -> str:
    t = datetime.now(timezone.utc)
    return t.strftime("%Y-%m-%dT%H:%M:%S.") + f"{t.microsecond // 1000:03d}Z"


def redact(s: Any, limit: int = 400, keep_newlines: bool = False) -> str:
    """Hide token-looking text, drop control characters, cut to `limit` (same rule as changes-core.mjs)."""
    if s is None:
        t = ""
    elif isinstance(s, bool):
        t = "true" if s else "false"
    elif isinstance(s, dict):
        t = "[object Object]"  # what String(obj) gives in changes-core.mjs
    elif isinstance(s, list):
        t = ",".join("" if x is None else str(x) for x in s)
    else:
        t = str(s)
    t = _SECRET.sub("[hidden]", t)
    t = re.sub(r"[\x00-\x09\x0b-\x1f\x7f]" if keep_newlines else r"[\x00-\x1f\x7f]", " ", t).strip()
    return t[: limit - 1] + "…" if len(t) > limit else t


def rel_path(cid: str) -> Path:
    m = ID_RE.match(str(cid or ""))
    if not m:
        raise ValueError(f'"{str(cid)[:40]}" is not a change id (chg-YYYYMMDD-hex)')
    d = m.group(1)
    return Path(d[:4]) / d[4:6] / f"{cid}.json"


def _iso_or(v: Any, d: Any) -> Any:
    return v if isinstance(v, str) and _ISO.match(v) else d


def _link(v: Any) -> str | None:
    s = str(v if v is not None else "").strip()
    if not s or len(s) > LIMITS["link"]:
        return None
    if s.lower().startswith("https://"):
        u = urlsplit(s)
        return s if u.scheme == "https" and u.hostname and not u.username and not u.password else None
    if _PATHLIKE.match(s) and ".." not in s.split("/") and "//" not in s:
        return s
    return None


def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _int_in(v: Any, lo: int, hi: int) -> int | None:
    return v if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi else None


def normalize(raw: Any, now: str | None = None) -> tuple[dict[str, Any] | None, list[str]]:
    """Check + normalise an entry: (entry, []) or (None, errors). Mirrors normalize() in changes-core.mjs."""
    now = now or now_iso()
    errors: list[str] = []
    if not _is_obj(raw):
        return None, ["an entry is a JSON object"]
    e: dict[str, Any] = {"$axf": FORMAT}
    if not ID_RE.match(str(raw.get("id") or "")):
        errors.append("id must look like chg-YYYYMMDD-hex")
    e["id"] = str(raw.get("id") or "")
    e["createdAt"] = _iso_or(raw.get("createdAt"), now)
    e["updatedAt"] = _iso_or(raw.get("updatedAt"), e["createdAt"])
    kind = str(raw.get("kind") if raw.get("kind") is not None else "other").lower()
    if not _KIND.match(kind):
        errors.append("kind is a short lowercase word (build, edit, remove, fix, other, …)")
    e["kind"] = kind
    e["title"] = redact(raw.get("title"), LIMITS["title"])
    if not e["title"]:
        errors.append("title is required")
    e["asked"] = redact(raw.get("asked"), LIMITS["asked"], True)
    repos = raw.get("repos")
    repos = [] if repos is None else repos if isinstance(repos, list) else [repos]
    if len(repos) > LIMITS["repos"]:
        errors.append(f"at most {LIMITS['repos']} repos")
    out_repos: list[str] = []
    for r in repos:
        r = str(r)
        if not _REPO.match(r):
            errors.append(f'repo "{redact(r, 60)}" is not owner/name')
        elif r not in out_repos:
            out_repos.append(r)
    e["repos"] = out_repos[: LIMITS["repos"]]
    e["model"] = redact(raw.get("model"), LIMITS["model"])
    who = raw.get("who") if _is_obj(raw.get("who")) else {}
    e["who"] = {k: redact(who[k], LIMITS["who"]) for k in ("session", "where", "user", "host") if who.get(k) is not None and str(who[k]).strip()}

    steps = raw.get("steps")
    steps = [] if steps is None else steps
    if not isinstance(steps, list):
        errors.append("steps is a list")
        steps = []
    elif len(steps) > LIMITS["steps"]:
        errors.append(f"at most {LIMITS['steps']} steps")
    e["steps"] = []
    for i, s in enumerate(steps[: LIMITS["steps"]]):
        o = {"text": s} if isinstance(s, str) else s if _is_obj(s) else {}
        st = str(o.get("state") if o.get("state") is not None else "queued")
        if st not in STEP_STATES:
            errors.append(f"step {i + 1}: state is one of {', '.join(STEP_STATES)}")
        step: dict[str, Any] = {"text": redact(o.get("text"), LIMITS["stepText"]), "state": st if st in STEP_STATES else "queued"}
        if not step["text"]:
            errors.append(f"step {i + 1} needs text")
        for k in ("startedAt", "finishedAt"):
            if _iso_or(o.get(k), None):
                step[k] = o[k]
        if o.get("note") is not None and str(o["note"]).strip():
            step["note"] = redact(o["note"], LIMITS["note"], True)
        e["steps"].append(step)

    e["result"] = None
    r = raw.get("result")
    if r is not None:
        if not _is_obj(r):
            errors.append("result is an object")
        else:
            rs = str(r.get("state") or "")
            if rs not in RESULT_STATES:
                errors.append(f"result.state is one of {', '.join(RESULT_STATES)}")
            res: dict[str, Any] = {"state": rs if rs in RESULT_STATES else "partial", "summary": redact(r.get("summary"), LIMITS["summary"], True)}
            b = r.get("branch")
            if b is not None and str(b):
                if _BRANCH.match(str(b)) and ".." not in str(b):
                    res["branch"] = str(b)
                else:
                    errors.append("result.branch is not a branch name")
            commits = r.get("commits")
            commits = [] if commits is None else commits
            if not isinstance(commits, list):
                errors.append("result.commits is a list")
                commits = []
            elif len(commits) > LIMITS["commits"]:
                errors.append(f"at most {LIMITS['commits']} commits")
            res["commits"] = []
            for c in commits[: LIMITS["commits"]]:
                o = {"sha": c} if isinstance(c, str) else c if _is_obj(c) else {}
                sha = str(o.get("sha") if o.get("sha") is not None else "").lower()
                if not _SHA.match(sha):
                    errors.append(f'commit "{redact(o.get("sha"), 50)}" is not a sha')
                    continue
                res["commits"].append({"sha": sha, "message": redact(o["message"], LIMITS["commitMsg"])} if o.get("message") else {"sha": sha})
            if r.get("filesChanged") is not None:
                n = _int_in(r.get("filesChanged"), 0, 1_000_000)
                if n is None:
                    errors.append("result.filesChanged is a whole number")
                else:
                    res["filesChanged"] = n
            tests = r.get("tests")
            tests = {} if tests is None else tests
            if not _is_obj(tests):
                errors.append("result.tests is an object (name → {before, after, state})")
            else:
                if len(tests) > LIMITS["tests"]:
                    errors.append(f"at most {LIMITS['tests']} tests")
                res["tests"] = {}
                for name in list(tests)[: LIMITS["tests"]]:
                    v = tests[name]
                    o = {"after": str(v)} if isinstance(v, (str, int, float)) and not isinstance(v, bool) else v if _is_obj(v) else None
                    if o is None:
                        errors.append(f'test "{redact(name, 40)}" is a string or {{before, after, state}}')
                        continue
                    t: dict[str, Any] = {}
                    if o.get("before") is not None:
                        t["before"] = redact(o["before"], LIMITS["testValue"])
                    if o.get("after") is not None:
                        t["after"] = redact(o["after"], LIMITS["testValue"])
                    if o.get("state") is not None:
                        if o["state"] in ("pass", "fail", "skip"):
                            t["state"] = o["state"]
                        else:
                            errors.append(f'test "{redact(name, 40)}": state is pass, fail or skip')
                    key = redact(name, LIMITS["testName"])
                    if key:
                        res["tests"][key] = t
            links = r.get("links")
            links = {} if links is None else links
            if not _is_obj(links):
                errors.append("result.links is an object (name → https URL or repo path)")
            else:
                if len(links) > LIMITS["links"]:
                    errors.append(f"at most {LIMITS['links']} links")
                res["links"] = {}
                for name in list(links)[: LIMITS["links"]]:
                    if not _LINK_NAME.match(str(name)):
                        errors.append(f'link name "{redact(name, 30)}" is a short lowercase word')
                        continue
                    v = _link(links[name])
                    if not v:
                        errors.append(f'link "{name}" must be an https URL or a repo path')
                        continue
                    res["links"][name] = v
            e["result"] = res

    e["closed"] = None
    c = raw.get("closed")
    if c is not None:
        if not _is_obj(c):
            errors.append("closed is {at, by} or null")
        else:
            e["closed"] = {"at": _iso_or(c.get("at"), now), "by": redact(c.get("by") if c.get("by") is not None else "unknown", LIMITS["who"]) or "unknown"}
    e["state"] = e["result"]["state"] if e["result"] else "running"
    if len(json.dumps(e, separators=(",", ":"), ensure_ascii=False).encode()) > LIMITS["bytes"]:
        errors.append(f"an entry is at most {LIMITS['bytes'] // 1024} KB")
    return (None if errors else e), errors


def upsert_step(steps: list[dict[str, Any]], *, index: int | None = None, text: str | None = None, state: str | None = None,
                note: str | None = None, now: str | None = None) -> list[dict[str, Any]]:
    """By index (0-based), else by matching text, else appended; times stamped on state changes (= upsertStep)."""
    now = now or now_iso()
    out = [dict(s) for s in steps or []]
    i = index if isinstance(index, int) else next((k for k, s in enumerate(out) if s.get("text") == text), -1)
    if i < 0 or i >= len(out):
        if not text:
            raise ValueError("a new step needs text")
        out.append({"text": text, "state": "queued"})
        i = len(out) - 1
    s = out[i]
    if text and isinstance(index, int):
        s["text"] = text
    if state and state != s.get("state"):
        if state not in STEP_STATES:
            raise ValueError(f"a step's state is one of {', '.join(STEP_STATES)}")
        s["state"] = state
        if state == "running":
            s.setdefault("startedAt", now)
            s.pop("finishedAt", None)
        if state in ("done", "failed", "skipped"):
            s.setdefault("startedAt", now)
            s["finishedAt"] = now
    if note is not None:
        s["note"] = note
    return out


def summary(e: dict[str, Any]) -> dict[str, Any]:
    steps = e.get("steps") or []
    r = e.get("result")
    return {
        "id": e["id"], "createdAt": e.get("createdAt"), "updatedAt": e.get("updatedAt"), "kind": e.get("kind"), "title": e.get("title"),
        "asked": (e.get("asked") or "")[:200], "state": e.get("state"), "repos": e.get("repos") or [], "model": e.get("model") or "",
        "where": (e.get("who") or {}).get("where", ""),
        "steps": {"total": len(steps), "done": sum(1 for s in steps if s.get("state") == "done"), "failed": sum(1 for s in steps if s.get("state") == "failed"),
                  "running": next((s.get("text") for s in steps if s.get("state") == "running"), "")},
        "result": {"state": r.get("state"), "summary": (r.get("summary") or "")[:300]} if r else None,
        "closed": (e.get("closed") or {}).get("at") if e.get("closed") else None,
    }


def _shared_tree(p: Path) -> bool:
    d = p.resolve()
    while True:
        try:
            return bool(os.stat(d).st_mode & 0o2000)
        except OSError:
            if d.parent == d:
                return False
            d = d.parent


class Store:
    """The log folder: get/put one entry, list the rest through an index rebuilt from the files (cached by mtime)."""

    def __init__(self, root: Path) -> None:
        self.root = Path(root)
        self._lock = threading.Lock()
        self._index: dict[str, tuple[int, int, dict[str, Any]]] = {}  # path → (mtime_ns, size, summary)
        self._scanned = 0.0

    def modes(self) -> tuple[int, int]:
        return (0o660, 0o2770) if _shared_tree(self.root) else (0o600, 0o700)

    def path_of(self, cid: str) -> Path:
        return self.root / rel_path(cid)

    def get(self, cid: str) -> dict[str, Any] | None:
        p = self.path_of(cid)
        if p.is_symlink() or not p.is_file():
            return None
        e = storage.read_json(p, None)
        return e if isinstance(e, dict) and e.get("id") == cid else None

    def put(self, raw: dict[str, Any]) -> dict[str, Any]:
        e, errors = normalize(raw)
        if e is None:
            raise ValueError("; ".join(errors[:8]))
        p = self.path_of(e["id"])
        file_mode, dir_mode = self.modes()
        d = p.parent
        missing = []
        while not d.exists() and d != self.root.parent:
            missing.append(d)
            d = d.parent
        for m in reversed(missing):
            storage.private_dir(m, dir_mode)
        if p.is_symlink():
            raise ValueError("refusing a symlink")
        storage.write_json(p, e, mode=file_mode, dir_mode=None, trailing_newline=True)
        with self._lock:
            self._scanned = 0.0
        return e

    def _scan(self) -> list[dict[str, Any]]:
        with self._lock:
            if time.monotonic() - self._scanned < 2.0:
                return [v[2] for v in self._index.values()]
            seen: dict[str, tuple[int, int, dict[str, Any]]] = {}
            if self.root.is_dir():
                for y in self.root.iterdir():
                    if not re.fullmatch(r"\d{4}", y.name) or not y.is_dir() or y.is_symlink():
                        continue
                    for m in y.iterdir():
                        if not re.fullmatch(r"\d{2}", m.name) or not m.is_dir() or m.is_symlink():
                            continue
                        for f in m.iterdir():
                            if not f.name.endswith(".json") or not ID_RE.match(f.name[:-5]) or f.is_symlink():
                                continue
                            try:
                                st = f.stat()
                            except OSError:
                                continue
                            key = str(f)
                            old = self._index.get(key)
                            if old and old[0] == st.st_mtime_ns and old[1] == st.st_size:
                                seen[key] = old
                                continue
                            e = storage.read_json(f, None)
                            if isinstance(e, dict) and e.get("id") == f.name[:-5]:
                                ok, _ = normalize(e)
                                if ok:
                                    seen[key] = (st.st_mtime_ns, st.st_size, summary(ok))
            self._index = seen
            self._scanned = time.monotonic()
            return [v[2] for v in seen.values()]

    def query(self, *, open_only: bool = False, closed_only: bool = False, kind: str = "", state: str = "", repo: str = "", q: str = "",
              date_from: str = "", date_to: str = "", cursor: str = "", limit: int = 50) -> dict[str, Any]:
        rows = sorted(self._scan(), key=lambda s: (s.get("createdAt") or "", s["id"]), reverse=True)
        counts = {"total": len(rows), "open": sum(1 for s in rows if not s["closed"]),
                  "byKind": {}, "byState": {}}
        for s in rows:
            counts["byKind"][s["kind"]] = counts["byKind"].get(s["kind"], 0) + 1
            counts["byState"][s["state"]] = counts["byState"].get(s["state"], 0) + 1
        needle = q.lower().strip()

        def keep(s: dict[str, Any]) -> bool:
            if open_only and s["closed"]:
                return False
            if closed_only and not s["closed"]:
                return False
            if kind and s["kind"] != kind:
                return False
            if state and s["state"] != state:
                return False
            if repo and repo not in s["repos"]:
                return False
            day = (s.get("createdAt") or "")[:10]
            if date_from and day < date_from:
                return False
            if date_to and day > date_to:
                return False
            if needle:
                hay = " ".join([s["id"], s["title"] or "", s["asked"] or "", " ".join(s["repos"]), s["model"], (s["result"] or {}).get("summary", "")]).lower()
                return needle in hay
            return True

        rows = [s for s in rows if keep(s)]
        total = len(rows)
        if cursor:
            at = next((i for i, s in enumerate(rows) if s["id"] == cursor), None)
            rows = rows[at + 1:] if at is not None else []
        page = rows[:limit]
        return {"items": page, "total": total, "nextCursor": page[-1]["id"] if len(rows) > limit else None, "counts": counts}
