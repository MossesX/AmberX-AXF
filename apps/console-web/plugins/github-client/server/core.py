"""GitHub client — pure part (github-client@1, DESIGN.md §3). No I/O: GitHub answers in, records out.

`ready(pr, policy)` is the one readiness rule: the server's Ready filter, the bulk `merge-ready` action and the web
part's status chip (web/core.ts mirrors it line for line; test.py replays the same cases on both).
"""
from __future__ import annotations

import re
import time
from datetime import datetime, timezone
from typing import Any, Iterable

SHA_RE = re.compile(r"[0-9a-f]{40}\Z")
BRANCH_RE = re.compile(r"(?!.*\.\.)(?!/)(?!-)(?!.*//)(?!.*@\{)[A-Za-z0-9._/-]{1,200}\Z")
TEXT_MAX = 300

FILTERS = ("all", "ready", "failing", "conflicts", "behind", "stale", "drafts", "mine")
SORTS = ("updated", "oldest", "number", "behind")
METHODS = ("queue", "squash", "merge", "rebase")
BULK_ACTIONS = ("merge-ready", "close-stale", "update-main", "rerun-failed", "label")
LOG_KINDS = ("merge", "merge-failed", "retry", "update-main", "rebase", "close", "reopen", "comment", "rerun-checks", "ready", "label",
             "queue-add", "queue-remove", "branch-delete", "restore", "push", "pr-open", "pr-close", "group-create", "group-land",
             "group-dissolve", "bulk", "import")

DEFAULT_CONFIG: dict[str, Any] = {
    "extraRepos": [], "pollMinutes": 2, "staleDays": 14, "mergeMethod": "queue", "requireGreenChecks": True,
    "allowNoChecks": False, "requireReview": False, "doNotMergeLabel": "do-not-merge", "me": "",
    "autoRetry": 1, "conflictHelp": "claude",
}


def text(v: Any, n: int = TEXT_MAX) -> str:
    return str(v if v is not None else "").replace("\r", " ").strip()[:n]


def valid_branch(s: Any) -> bool:
    return isinstance(s, str) and bool(BRANCH_RE.match(s)) and not s.endswith((".lock", "/", "."))


def slug(s: Any, n: int = 40) -> str:
    out = re.sub(r"[^a-z0-9]+", "-", str(s or "").lower()).strip("-")[:n].strip("-")
    return out or "batch"


def iso(ts: float | None = None) -> str:
    return datetime.fromtimestamp(time.time() if ts is None else ts, timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse_time(s: Any) -> float | None:
    if not isinstance(s, str) or not s:
        return None
    try:
        return datetime.fromisoformat(s.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


# ---------------------------------------------------------------------------------------------------- config

def check_config(body: Any, cur: dict[str, Any], valid_repo) -> dict[str, Any]:
    """The settings after `body` (a partial patch) is applied; ValueError says what is wrong."""
    if not isinstance(body, dict):
        raise ValueError("send an object with the settings to change")
    unknown = set(body) - set(DEFAULT_CONFIG)
    if unknown:
        raise ValueError(f"unknown settings: {', '.join(sorted(unknown))}")
    out = {**DEFAULT_CONFIG, **cur}
    for k, v in body.items():
        d = DEFAULT_CONFIG[k]
        if k == "extraRepos":
            if not isinstance(v, list) or len(v) > 20 or any(not valid_repo(x) for x in v):
                raise ValueError("extraRepos is a list of owner/name (at most 20)")
            out[k] = list(dict.fromkeys(x.strip() for x in v))
        elif k == "mergeMethod":
            if v not in METHODS:
                raise ValueError(f"mergeMethod is one of {', '.join(METHODS)}")
            out[k] = v
        elif k == "conflictHelp":
            if v not in ("claude", "report"):
                raise ValueError("conflictHelp is claude (hand clashes to a Claude build) or report (only report them)")
            out[k] = v
        elif isinstance(d, bool):
            if not isinstance(v, bool):
                raise ValueError(f"{k} is true or false")
            out[k] = v
        elif isinstance(d, int):
            lo, hi = {"pollMinutes": (1, 60), "staleDays": (1, 365), "autoRetry": (0, 3)}[k]
            if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
                raise ValueError(f"{k} is a whole number from {lo} to {hi}")
            out[k] = v
        else:
            if not isinstance(v, str) or len(v) > 100 or any(c in v for c in "\n\r\t"):
                raise ValueError(f"{k} is a short text")
            out[k] = v.strip()
    return out


# ---------------------------------------------------------------------------------------------------- PR records

def checks_summary(runs: Iterable[dict[str, Any]], statuses: Iterable[dict[str, Any]], state_of) -> dict[str, Any]:
    """Check runs + commit statuses of one SHA → {state, total, failed[], pending[]}. Latest status per context only."""
    failed: list[str] = []
    pending: list[str] = []
    total = 0
    for r in runs or []:
        if not isinstance(r, dict):
            continue
        total += 1
        st = state_of(r.get("status"), r.get("conclusion"))
        name = text(r.get("name"), 120)
        if st == "failure":
            failed.append(name)
        elif st in ("queued", "waiting", "running"):
            pending.append(name)
    seen: set[str] = set()
    for s in statuses or []:  # GitHub lists the newest first
        if not isinstance(s, dict) or s.get("context") in seen:
            continue
        seen.add(str(s.get("context")))
        total += 1
        name = text(s.get("context"), 120)
        if s.get("state") in ("failure", "error"):
            failed.append(name)
        elif s.get("state") == "pending":
            pending.append(name)
    state = "none" if total == 0 else "failure" if failed else "pending" if pending else "success"
    return {"state": state, "total": total, "failed": failed[:30], "pending": pending[:30]}


def mergeable_of(detail: dict[str, Any] | None) -> str:
    """GitHub mergeable / mergeable_state → clean | conflict | blocked | unknown."""
    if not isinstance(detail, dict):
        return "unknown"
    ms = detail.get("mergeable_state")
    if detail.get("mergeable") is False or ms == "dirty":
        return "conflict"
    if ms == "blocked":
        return "blocked"
    if ms in (None, "unknown") or detail.get("mergeable") is None:
        return "unknown"
    return "clean"  # clean, behind, unstable, has_hooks, draft: nothing stops the merge itself


def review_of(reviews: Iterable[dict[str, Any]] | None, required: bool) -> str:
    """Latest review per reviewer → approved | changes | required | none."""
    last: dict[str, str] = {}
    for r in reviews or []:
        if isinstance(r, dict) and r.get("state") in ("APPROVED", "CHANGES_REQUESTED", "DISMISSED"):
            last[str((r.get("user") or {}).get("login"))] = r["state"]
    if "CHANGES_REQUESTED" in last.values():
        return "changes"
    if "APPROVED" in last.values():
        return "approved"
    return "required" if required else "none"


def ready_reasons(pr: dict[str, Any], policy: dict[str, Any]) -> list[str]:
    """Why a PR is not ready to merge ([] = ready). Same rule as web/core.ts readyReasons."""
    why: list[str] = []
    if pr.get("state") != "open":
        why.append(f"it is {pr.get('state')}")
    if pr.get("draft"):
        why.append("it is a draft")
    if pr.get("mergeable") == "conflict":
        why.append("it has conflicts with its base")
    elif pr.get("mergeable") != "clean":
        why.append(f"GitHub says mergeable: {pr.get('mergeable')}")
    cs = (pr.get("checks") or {}).get("state")
    if cs == "failure":
        why.append("checks are failing")
    elif cs == "pending" and policy.get("requireGreenChecks", True):
        why.append("checks are still running")
    elif cs == "none" and policy.get("requireGreenChecks", True) and not policy.get("allowNoChecks"):
        why.append("no checks have run")
    if pr.get("review") == "changes":
        why.append("changes were requested")
    elif policy.get("requireReview") and pr.get("review") != "approved":
        why.append("it needs an approving review")
    label = policy.get("doNotMergeLabel") or "do-not-merge"
    if label in (pr.get("labels") or []):
        why.append(f"it has the {label} label")
    return why


def ready(pr: dict[str, Any], policy: dict[str, Any]) -> bool:
    return not ready_reasons(pr, policy)


def pr_record(raw: dict[str, Any], *, repo: str, detail: dict[str, Any] | None = None, checks: dict[str, Any] | None = None,
              compare: dict[str, Any] | None = None, reviews: list[dict[str, Any]] | None = None,
              build: dict[str, Any] | None = None, queue: dict[str, Any] | None = None,
              policy: dict[str, Any] | None = None, now: float | None = None) -> dict[str, Any]:
    """One `pr` record (contract.json → records.pr) from GitHub's list item plus what was read alongside it."""
    policy = {**DEFAULT_CONFIG, **(policy or {})}
    now = time.time() if now is None else now
    d = detail if isinstance(detail, dict) else {}
    merged = bool(raw.get("merged_at") or d.get("merged"))
    state = "merged" if merged else ("open" if raw.get("state") == "open" else "closed")
    updated = text(raw.get("updated_at"), 40)
    ut = parse_time(updated)
    created = parse_time(raw.get("created_at"))
    cmp_ = compare if isinstance(compare, dict) else {}
    rec: dict[str, Any] = {
        "repo": repo,
        "number": int(raw.get("number") or 0),
        "title": text(raw.get("title"), 300),
        "author": text((raw.get("user") or {}).get("login"), 80),
        "head": text((raw.get("head") or {}).get("ref"), 200),
        "headSha": text((raw.get("head") or {}).get("sha"), 40),
        "base": text((raw.get("base") or {}).get("ref"), 200),
        "draft": bool(raw.get("draft")),
        "state": state,
        "mergeable": mergeable_of(d) if d else "unknown",
        "behind": max(0, int(cmp_.get("behind_by") or 0)),
        "ahead": max(0, int(cmp_.get("ahead_by") or 0)),
        "checks": checks or {"state": "none", "total": 0, "failed": [], "pending": []},
        "review": review_of(reviews, bool(policy.get("requireReview"))),
        "labels": [text(lb.get("name"), 80) for lb in raw.get("labels") or [] if isinstance(lb, dict)],
        "updatedAt": updated,
        "createdAt": text(raw.get("created_at"), 40),
        "ageDays": max(0, int((now - created) // 86400)) if created else 0,
        "comments": int(d.get("comments") or 0) + int(d.get("review_comments") or 0),
        "changedFiles": int(d.get("changed_files") or 0),
        "additions": int(d.get("additions") or 0),
        "deletions": int(d.get("deletions") or 0),
        "linkedBuild": build,
        "queue": queue,
        "url": text(raw.get("html_url"), 400),
    }
    rec["stale"] = state == "open" and not queue and bool(ut) and (now - (ut or now)) > policy["staleDays"] * 86400
    rec["why"] = ready_reasons(rec, policy)
    rec["ready"] = not rec["why"]
    return rec


def matches(pr: dict[str, Any], flt: str, me: str = "") -> bool:
    if flt == "ready":
        return bool(pr.get("ready"))
    if flt == "failing":
        return (pr.get("checks") or {}).get("state") == "failure"
    if flt == "conflicts":
        return pr.get("mergeable") == "conflict"
    if flt == "behind":
        return int(pr.get("behind") or 0) > 0
    if flt == "stale":
        return bool(pr.get("stale"))
    if flt == "drafts":
        return bool(pr.get("draft"))
    if flt == "mine":
        return bool(me) and pr.get("author", "").lower() == me.lower()
    return True


def search(pr: dict[str, Any], q: str) -> bool:
    q = (q or "").strip().lower()
    if not q:
        return True
    if q.lstrip("#").isdigit():
        return str(pr.get("number")) == q.lstrip("#")
    hay = " ".join([pr.get("title", ""), pr.get("head", ""), pr.get("author", ""), " ".join(pr.get("labels") or []),
                    ((pr.get("linkedBuild") or {}).get("id") or "")]).lower()
    return all(w in hay for w in q.split())


def sort_prs(prs: list[dict[str, Any]], how: str) -> list[dict[str, Any]]:
    if how == "oldest":
        return sorted(prs, key=lambda p: p.get("createdAt") or "")
    if how == "number":
        return sorted(prs, key=lambda p: -int(p.get("number") or 0))
    if how == "behind":
        return sorted(prs, key=lambda p: (-int(p.get("behind") or 0), -int(p.get("number") or 0)))
    return sorted(prs, key=lambda p: p.get("updatedAt") or "", reverse=True)


def select(prs: list[dict[str, Any]], flt: str = "all", sort: str = "updated", q: str = "", me: str = "") -> list[dict[str, Any]]:
    return sort_prs([p for p in prs if matches(p, flt, me) and search(p, q)], sort)


def counts(prs: list[dict[str, Any]], me: str = "") -> dict[str, int]:
    return {f: sum(1 for p in prs if matches(p, f, me)) for f in FILTERS}


# ---------------------------------------------------------------------------------------------------- bulk

def bulk_targets(prs: list[dict[str, Any]], action: str, numbers: list[int] | None, flt: str | None) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """(take, skip) for a bulk action. `merge-ready` takes only ready PRs, `close-stale` only stale ones, `update-main`
    only PRs behind their base, `rerun-failed` only failing ones; skip items say why."""
    if numbers:
        wanted = {int(n) for n in numbers}
        pool = [p for p in prs if p["number"] in wanted]
        missing = [{"target": f"#{n}", "state": "skipped", "note": "not an open PR in this repo"} for n in sorted(wanted - {p["number"] for p in pool})]
    else:
        default = {"merge-ready": "ready", "close-stale": "stale", "update-main": "behind", "rerun-failed": "failing", "label": "all"}[action]
        pool = [p for p in prs if matches(p, flt or default)]
        missing = []
    take, skip = [], list(missing)
    for p in pool:
        why = ""
        if action == "merge-ready" and not p.get("ready"):
            why = "not ready: " + "; ".join(p.get("why") or [])
        elif action == "close-stale" and not p.get("stale"):
            why = "not stale"
        elif action == "update-main" and not p.get("behind"):
            why = "already up to date with its base"
        elif action == "rerun-failed" and (p.get("checks") or {}).get("state") != "failure":
            why = "no failed checks"
        (skip.append({"target": f"#{p['number']}", "state": "skipped", "note": why}) if why else take.append(p))
    return take, skip


# ---------------------------------------------------------------------------------------------------- log

def log_entry(kind: str, repo: str, *, target: dict[str, Any] | None = None, actor: dict[str, str] | None = None,
              outcome: str = "ok", why: str = "", details: str = "", saved_sha: str = "", at: str = "", seq: str = "") -> dict[str, Any]:
    if kind not in LOG_KINDS:
        raise ValueError(f"unknown log kind {kind}")
    e: dict[str, Any] = {"id": seq or f"lg-{int(time.time() * 1000):x}", "at": at or iso(), "repo": repo, "kind": kind,
                         "target": {k: v for k, v in (target or {}).items() if v not in (None, "")},
                         "actor": actor or {"kind": "console", "name": "console"}, "outcome": "failed" if outcome == "failed" else "ok",
                         "restorable": False}
    if why:
        e["why"] = text(why, 500)
    if details:
        e["details"] = text(details, 2000)
    if saved_sha and SHA_RE.match(saved_sha):
        e["savedSha"] = saved_sha
        e["restorable"] = kind in ("branch-delete", "import") and bool(e["target"].get("branch"))
    return e


def log_match(e: dict[str, Any], q: str = "", kind: str = "", repo: str = "", since: str = "", outcome: str = "") -> bool:
    if kind and e.get("kind") != kind:
        return False
    if repo and e.get("repo") != repo:
        return False
    if outcome and e.get("outcome") != outcome:
        return False
    if since:
        if since == "today":
            since = iso()[:10]
        if (e.get("at") or "") < since:
            return False
    q = (q or "").strip().lower()
    if not q:
        return True
    t = e.get("target") or {}
    hay = " ".join(str(x) for x in [e.get("kind"), e.get("repo"), e.get("why", ""), e.get("details", ""), e.get("savedSha", ""),
                                     t.get("branch", ""), t.get("sha", ""), t.get("group", ""), f"#{t['pr']}" if t.get("pr") else "",
                                     (e.get("actor") or {}).get("name", ""), e.get("outcome")]).lower()
    return all(w in hay for w in q.split())


_LINE_SHA = re.compile(r"\b([0-9a-f]{40})\b")


def parse_deleted_list(body: str) -> list[dict[str, str]]:
    """A `_deleted-branches-*.txt` list → [{branch, sha}]. Accepts `branch sha`, `sha branch`, `branch: sha`,
    `branch<TAB>sha` and `git branch -D` style `Deleted branch x (was abc1234…)` lines (full SHAs only)."""
    out: list[dict[str, str]] = []
    for line in (body or "").splitlines():
        line = line.strip()
        if not line or line.startswith("#"):
            continue
        m = re.match(r"Deleted (?:remote-tracking )?branch (\S+) \(was ([0-9a-f]{40})\)", line)
        if m:
            out.append({"branch": m.group(1).removeprefix("origin/"), "sha": m.group(2)})
            continue
        sm = _LINE_SHA.search(line)
        if not sm:
            continue
        rest = (line[:sm.start()] + " " + line[sm.end():]).replace(":", " ").replace(",", " ").split()
        name = next((w for w in rest if valid_branch(w.removeprefix("origin/").removeprefix("refs/heads/"))), "")
        if name:
            out.append({"branch": name.removeprefix("origin/").removeprefix("refs/heads/"), "sha": sm.group(1)})
    return out


# ---------------------------------------------------------------------------------------------------- groups

def group_branch(name: str) -> str:
    return f"queue/group-{slug(name)}"


def group_body(name: str, members: list[dict[str, Any]], conflicts: list[dict[str, Any]]) -> str:
    lines = [f"Batch **{text(name, 120)}**: these pull requests merged together on one branch, so they land as one and "
             "cannot clash with each other on main.", "", "Members:"]
    lines += [f"- #{m['number']} {text(m.get('title'), 120)} (`{text(m.get('head'), 120)}`)" for m in members]
    if conflicts:
        lines += ["", "Clashes resolved on this branch:"]
        lines += [f"- #{c['member']}: {', '.join(c.get('files') or [])[:400]} ({c.get('how', 'resolved')})" for c in conflicts]
    lines += ["", "Made by the console's GitHub client. Landing this PR closes the members as merged by the batch."]
    return "\n".join(lines)
