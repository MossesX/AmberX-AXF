"""change-log@1 in Python: the same checks as changes-core.mjs (test.py runs both on the same cases) and the folder store.

Storage: one file per entry, <changes dir>/<YYYY>/<MM>/<id>.json, written atomically (axf_server.storage: temp file →
fsync → replace). In the hub's projects tree (a setgid, group-shared folder) files are 0660 and new folders 2770 so
axHub, which runs as another user, can serve them; anywhere else 0600 / 0700. There is no index file next to the
entries (it would conflict when two copies sync); `Store` keeps an in-memory index rebuilt from the files' mtimes.
"""
from __future__ import annotations

import json
import math
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
LIMITS = {"title": 160, "asked": 4000, "model": 40, "repos": 10, "steps": 100, "stepText": 300, "note": 1000, "summary": 4000,
          "commits": 50, "commitMsg": 200, "tests": 50, "testName": 120, "testValue": 60, "links": 20, "link": 500, "who": 80,
          "areas": 40, "doing": 160, "bytes": 64 * 1024}

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
    _norm_build(raw, e, errors)
    _norm_resume(raw, e, errors)
    if len(json.dumps(e, separators=(",", ":"), ensure_ascii=False).encode()) > LIMITS["bytes"]:
        errors.append(f"an entry is at most {LIMITS['bytes'] // 1024} KB")
    return (None if errors else e), errors


# ---------------------------------------------------------------- build stats (= normBuild in changes-core.mjs)

BUILD_STATUSES = ("queued", "running", "done", "failed")
VERIFY_STATES = ("pending", "running", "verified", "broken", "skipped")
STALE_MS = 10 * 60_000
_SURFACE = re.compile(r"^[a-z][a-z0-9-]{0,31}$")
_REF_ID = re.compile(r"^[A-Za-z0-9._:/-]{1,120}$")
_AREA = re.compile(r"^[A-Za-z0-9_.@/*+-]{1,200}$")
_SOURCE = re.compile(r"^[a-z][a-z0-9-]{0,23}$")
_ACTUAL_INTS = ("inputTokens", "outputTokens", "cacheReadTokens", "cacheWriteTokens")
_BUILD_KEYS = ("buildRef", "surface", "startedAt", "finishedAt", "lastSeenAt", "estimate", "actual", "costEstimated", "branch", "areas", "parent", "doing",
               "progress", "verify")


def _num(v: Any) -> bool:
    return isinstance(v, (int, float)) and not isinstance(v, bool) and math.isfinite(v)


def _jround(v: float, d: int = 0) -> float | int:
    """Math.round(v * 10^d) / 10^d, the way changes-core.mjs rounds (half up, not banker's)."""
    f = 10 ** d
    r = math.floor(v * f + 0.5) / f
    return int(r) if d == 0 else r


def derive_status(result: Any, asked: Any = None) -> str:
    if result:
        return "failed" if result.get("state") in ("failed", "cancelled") else "done"
    return "queued" if asked == "queued" else "running"


def _js_str(v: Any) -> str:
    return redact(v, 10_000) if not isinstance(v, str) else v


def _norm_build(raw: dict[str, Any], e: dict[str, Any], errors: list[str]) -> None:
    e["status"] = derive_status(e["result"], raw.get("status"))
    if raw.get("status") is not None and str(raw["status"]) not in BUILD_STATUSES:
        errors.append(f"status is one of {', '.join(BUILD_STATUSES)}")
    r = raw.get("buildRef")
    if r is not None:
        if not _is_obj(r) or not _KIND.match(_js_str(r.get("kind") if r.get("kind") is not None else "")) or not _REF_ID.match(_js_str(r.get("id") if r.get("id") is not None else "")):
            errors.append("buildRef is {kind, id} (kind a short word, id a plain id)")
        else:
            e["buildRef"] = {"kind": _js_str(r["kind"]), "id": _js_str(r["id"])}
    s = raw.get("surface")
    if s is not None and _js_str(s) != "":
        if not _SURFACE.match(_js_str(s)):
            errors.append("surface is a short lowercase word (vps-claude-code, claude-ai, …)")
        else:
            e["surface"] = _js_str(s)
    for k in ("startedAt", "finishedAt", "lastSeenAt"):
        if _iso_or(raw.get(k), None):
            e[k] = raw[k]

    def money(v: Any, what: str) -> Any:
        if v is None:
            return None
        if not _num(v) or v < 0 or v > 100000:
            errors.append(f"{what} is a number from 0 to 100000")
            return None
        return v

    est = raw.get("estimate")
    if est is not None:
        if not _is_obj(est):
            errors.append("estimate is {minutes, costUsd}")
        else:
            o: dict[str, Any] = {}
            m = money(est.get("minutes"), "estimate.minutes")
            if m is not None:
                o["minutes"] = _jround(m)
            c = money(est.get("costUsd"), "estimate.costUsd")
            if c is not None:
                o["costUsd"] = _jround(c, 4)
            e["estimate"] = o
    a = raw.get("actual")
    if a is not None:
        if not _is_obj(a):
            errors.append("actual is {minutes, costUsd, inputTokens, outputTokens, cacheReadTokens, cacheWriteTokens, source}")
        else:
            o = {}
            m = money(a.get("minutes"), "actual.minutes")
            if m is not None:
                o["minutes"] = _jround(m)
            c = money(a.get("costUsd"), "actual.costUsd")
            if c is not None:
                o["costUsd"] = _jround(c, 4)
            for k in _ACTUAL_INTS:
                if a.get(k) is None:
                    continue
                n = _int_in(a[k], 0, 10_000_000_000)
                if n is None:
                    errors.append(f"actual.{k} is a whole number")
                else:
                    o[k] = n
            src = a.get("source")
            if src is not None and _js_str(src) != "":
                if _SOURCE.match(_js_str(src)):
                    o["source"] = _js_str(src)
                else:
                    errors.append("actual.source is a short word (transcript, manual, …)")
            e["actual"] = o
    ce = raw.get("costEstimated")
    if ce is not None:
        if not isinstance(ce, bool):
            errors.append("costEstimated is true or false")
        else:
            e["costEstimated"] = ce
    elif "estimate" in e or "actual" in e:
        e["costEstimated"] = (e.get("actual") or {}).get("costUsd") is None
    b = raw.get("branch")
    if b is not None and _js_str(b) != "":
        if _BRANCH.match(_js_str(b)) and ".." not in _js_str(b):
            e["branch"] = _js_str(b)
        else:
            errors.append("branch is not a branch name")
    areas = raw.get("areas")
    if areas is not None:
        if not isinstance(areas, list):
            errors.append("areas is a list of paths")
        else:
            if len(areas) > LIMITS["areas"]:
                errors.append(f"at most {LIMITS['areas']} areas")
            out: list[str] = []
            for x in areas[: LIMITS["areas"]]:
                sx = "" if x is None else _js_str(x)
                if not _AREA.match(sx) or ".." in sx.split("/") or sx.startswith("/"):
                    errors.append(f'area "{redact(sx, 60)}" is a relative repo path')
                elif sx not in out:
                    out.append(sx)
            e["areas"] = out
    p = raw.get("parent")
    if p is not None and _js_str(p) != "":
        if ID_RE.match(_js_str(p)):
            e["parent"] = _js_str(p)
        else:
            errors.append("parent is a change id")
    act = raw.get("doing")
    if act is not None and str(act).strip():
        e["doing"] = redact(act, LIMITS["doing"])
    pr = raw.get("progress")
    if pr is not None:
        if not _num(pr) or pr < 0 or pr > 1:
            errors.append("progress is a number from 0 to 1")
        else:
            e["progress"] = _jround(pr, 3)
    v = raw.get("verify")
    if v is not None:
        if not _is_obj(v) or _js_str(v.get("state") if v.get("state") is not None else "") not in VERIFY_STATES:
            errors.append(f"verify is {{state: {'|'.join(VERIFY_STATES)}, at, summary, checks}}")
        else:
            o = {"state": _js_str(v["state"])}
            if _iso_or(v.get("at"), None):
                o["at"] = v["at"]
            if v.get("summary") is not None and str(v["summary"]).strip():
                o["summary"] = redact(v["summary"], LIMITS["note"], True)
            ch = v.get("checks")
            if ch is not None:
                if not _is_obj(ch):
                    errors.append("verify.checks is {name: pass|fail|skip}")
                else:
                    o["checks"] = {}
                    for name in list(ch)[: LIMITS["tests"]]:
                        sv = _js_str(ch[name])
                        if sv not in ("pass", "fail", "skip"):
                            errors.append(f'verify check "{redact(name, 40)}" is pass, fail or skip')
                            continue
                        key = redact(name, LIMITS["testName"])
                        if key:
                            o["checks"][key] = sv
            e["verify"] = o


# ---------------------------------------------------------------- resume details (= normResume / resumePrompt in changes-core.mjs)

RESUME_LIMITS = {"folder": 300, "plan": 3000, "next": 1500, "notes": 3000, "files": 300, "file": 300, "tests": 30, "test": 300, "read": 30}
_RPATH = re.compile(r"^[A-Za-z0-9_.@+-][A-Za-z0-9_.@+ /-]{0,299}$")


def _rel_ok(v: str) -> bool:
    return bool(_RPATH.match(v)) and ".." not in v.split("/") and "//" not in v


def _norm_resume(raw: dict[str, Any], e: dict[str, Any], errors: list[str]) -> None:
    r = raw.get("resume")
    if r is None:
        return
    if not _is_obj(r):
        errors.append("resume is an object")
        return
    o: dict[str, Any] = {}
    if r.get("repo") is not None and _js_str(r["repo"]) != "":
        if _REPO.match(_js_str(r["repo"])):
            o["repo"] = _js_str(r["repo"])
        else:
            errors.append("resume.repo is owner/name")
    if r.get("folder") is not None and _js_str(r["folder"]).strip():
        o["folder"] = redact(r["folder"], RESUME_LIMITS["folder"])
    if r.get("branch") is not None and _js_str(r["branch"]) != "":
        b = _js_str(r["branch"])
        if _BRANCH.match(b) and ".." not in b:
            o["branch"] = b
        else:
            errors.append("resume.branch is not a branch name")
    for k in ("base", "head"):
        if r.get(k) is not None and _js_str(r[k]) != "":
            v = _js_str(r[k]).lower()
            if _SHA.match(v):
                o[k] = v
            else:
                errors.append(f"resume.{k} is a commit sha")
    if r.get("pushed") is not None:
        if isinstance(r["pushed"], bool):
            o["pushed"] = r["pushed"]
        else:
            errors.append("resume.pushed is true or false")
    if r.get("dirty") is not None:
        n = _int_in(r["dirty"], 0, 1_000_000)
        if n is None:
            errors.append("resume.dirty is a whole number")
        else:
            o["dirty"] = n
    if r.get("pr") is not None and _js_str(r["pr"]) != "":
        v = _link(r["pr"])
        if v and v.startswith("https://"):
            o["pr"] = v
        else:
            errors.append("resume.pr is an https URL")
    for k in ("plan", "next", "notes"):
        if r.get(k) is not None and _js_str(r[k]).strip():
            o[k] = redact(r[k], RESUME_LIMITS[k], True)

    def lst(k: str, mx: int, ok: Any, what: str, clean: Any = None) -> None:
        if r.get(k) is None:
            return
        if not isinstance(r[k], list):
            errors.append(f"resume.{k} is a list")
            return
        out: list[str] = []
        for x in r[k][:mx]:
            v = clean(x) if clean else ("" if x is None else _js_str(x)).strip()
            if not v:
                continue
            if not ok(v):
                errors.append(f'resume.{k}: "{redact(v, 60)}" {what}')
                continue
            if v not in out:
                out.append(v)
        o[k] = out

    lst("files", RESUME_LIMITS["files"], _rel_ok, "is not a relative repo path")
    lst("read", RESUME_LIMITS["read"], _rel_ok, "is not a relative repo path")
    lst("tests", RESUME_LIMITS["tests"], lambda v: True, "", lambda x: redact(x, RESUME_LIMITS["test"]))
    if _iso_or(r.get("at"), None):
        o["at"] = r["at"]
    e["resume"] = o


def resume_prompt(e: dict[str, Any]) -> str:
    """The prompt a new session on any Claude account pastes to carry on (= resumePrompt in changes-core.mjs)."""
    r = e.get("resume") or {}
    res = e.get("result") or None
    repo = r.get("repo") or (e.get("repos") or [""])[0] or ""
    branch = r.get("branch") or (res or {}).get("branch") or e.get("branch") or ""
    L = [f"Resume a piece of work that another Claude session started (Codebase changes entry {e['id']}).", ""]
    L.append(f"Title: {e.get('title', '')}")
    L.append(f"Kind: {e.get('kind', '')} · state: {res['state'] if res else 'running'}" + (f" · built so far with {e['model']}" if e.get("model") else ""))
    if repo:
        L.append(f"Repo: {repo}" + (f" · branch {branch}" if branch else ""))
    if r.get("base") or r.get("head"):
        pushed = r.get("pushed")
        L.append(f"Commits: started from {r.get('base') or '?'}, last {r.get('head') or '?'}"
                 + (" (NOT pushed: it may only exist on the old machine)" if pushed is False else " (pushed)" if pushed else ""))
    if r.get("dirty"):
        L.append(f"Uncommitted files on the old machine: {r['dirty']} (they are not in the repo; redo them if needed)")
    if r.get("pr"):
        L.append(f"Pull request: {r['pr']}")
    if e.get("asked"):
        L += ["", "What was asked:", e["asked"]]
    if r.get("plan"):
        L += ["", "Plan:", r["plan"]]
    steps = e.get("steps") or []
    if steps:
        L += ["", "Steps:"]
        L += [f"  {i + 1}. [{s['state']}] {s['text']}" + (f" ({s['note']})" if s.get("note") else "") for i, s in enumerate(steps)]
    if res and res.get("summary"):
        L += ["", f"Result so far: {res['summary']}"]
    if r.get("next"):
        L += ["", "What is left:", r["next"]]
    if r.get("notes"):
        L += ["", "Notes:", r["notes"]]
    files = r.get("files") or []
    if files:
        L += ["", f"Files changed ({len(files)}):", *[f"  {f}" for f in files[:60]], *([f"  … and {len(files) - 60} more"] if len(files) > 60 else [])]
    if r.get("read"):
        L += ["", "Read first:", *[f"  {f}" for f in r["read"]]]
    if r.get("tests"):
        L += ["", "Check it with:", *[f"  {t}" for t in r["tests"]]]
    cid = e["id"]
    L += ["", "How to carry on:",
          f"  1. Work in {repo or 'the same repo'}" + (f" on branch {branch}" if branch else "") + ": fetch it and check it out (no new repo, no fork).",
          "  2. Read the repo's CLAUDE.md and rules first; check the Build manager's Live list so you don't clash with a running session.",
          f"  3. Report on this same entry as you go: node apps/console-web/plugins/codebase-changes/changes.mjs step {cid} \"<step>\" --state running",
          f"     and keep its resume details current: changes.mjs resume {cid} --next \"<what's left>\"",
          f"  4. Finish with: changes.mjs result {cid} --state done --summary \"<what changed>\" --branch <branch> --commit <sha>"]
    return "\n".join(L)


def is_stale(e: dict[str, Any], now_ms: float | None = None) -> bool:
    if (e.get("status") or derive_status(e.get("result"))) != "running":
        return False
    t = _parse_ms(e.get("lastSeenAt") or e.get("updatedAt") or "")
    now_ms = time.time() * 1000 if now_ms is None else now_ms
    return t is not None and now_ms - t > STALE_MS


def _parse_ms(s: str) -> float | None:
    try:
        return datetime.strptime(s[:19], "%Y-%m-%dT%H:%M:%S").replace(tzinfo=timezone.utc).timestamp() * 1000
    except (ValueError, TypeError):
        return None


def build_summary(e: dict[str, Any]) -> dict[str, Any]:
    out: dict[str, Any] = {"status": e.get("status") or derive_status(e.get("result"))}
    for k in _BUILD_KEYS:
        if e.get(k) is not None:
            out[k] = e[k]
    r = e.get("result") or {}
    if r.get("branch") and "branch" not in out:
        out["branch"] = r["branch"]
    if r.get("commits"):
        out["commits"] = [c["sha"] for c in r["commits"]][:10]
    if r.get("links"):
        out["links"] = r["links"]
    who = e.get("who") or {}
    for k in ("host", "session", "user"):
        if who.get(k):
            out[k] = who[k]
    return out


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
        **build_summary(e),
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

    def summaries(self) -> list[dict[str, Any]]:
        """Every entry's summary (build stats included), newest first: what the Build manager indexes."""
        return sorted(self._scan(), key=lambda s: (s.get("createdAt") or "", s["id"]), reverse=True)

    def stamp(self) -> str:
        """Changes whenever any entry file changes (mtimes + sizes): a cheap 'anything new?' for live polling."""
        self._scan()
        with self._lock:
            return f"{len(self._index)}:{max((v[0] for v in self._index.values()), default=0)}:{sum(v[1] for v in self._index.values())}"

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
