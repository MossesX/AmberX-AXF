"""Fix log rules (fix-log@1): pure functions, no I/O, no clock. The routes in __init__.py add the store and the alerts.

An entry is one line a Claude session writes while it fixes something:

    {id, at, outcome, text, detail, session, agent, build, issue, notified}

outcome: found (something needs fixing) · trying (what it is trying now) · failed (that try failed) · fixed.
issue: the thread the entries belong to. A new ``found`` starts one; trying / failed / fixed without an issue join the
session's latest open issue (or start one). ``fixed`` closes the issue.
"""
from __future__ import annotations

import re
from typing import Any

OUTCOMES = ("found", "trying", "failed", "fixed")
TEXT_MAX = 300
DETAIL_MAX = 2000
SEVERITY = {"found": "info", "trying": "info", "failed": "warning", "fixed": "success"}
TITLE = {"found": "Needs fixing", "trying": "Trying", "failed": "Failed", "fixed": "Fixed"}
DEFAULT_SETTINGS: dict[str, Any] = {
    "$axf": "fix-log-settings@1",
    "notify": {"found": True, "trying": True, "failed": True, "fixed": True},
    "perSessionPer10Min": 20,
    "keep": 5000,
}
_ID_RE = re.compile(r"^[A-Za-z0-9._:-]{1,80}$")


def clean(s: Any, n: int) -> str:
    return re.sub(r"\s+", " ", str(s or "")).strip()[:n]


def norm_settings(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    notify = {o: bool((raw.get("notify") or {}).get(o, True)) for o in OUTCOMES}
    def num(k: str, lo: int, hi: int) -> int:
        try:
            return max(lo, min(hi, int(raw.get(k, DEFAULT_SETTINGS[k]))))
        except (TypeError, ValueError):
            return DEFAULT_SETTINGS[k]
    return {"$axf": "fix-log-settings@1", "notify": notify, "perSessionPer10Min": num("perSessionPer10Min", 1, 200), "keep": num("keep", 100, 50000)}


def validate(inp: dict[str, Any]) -> str | None:
    """The reason an entry is refused, or None."""
    if clean(inp.get("text"), TEXT_MAX) == "":
        return "text is required: one short line saying what needs fixing, what you are trying, or what happened"
    if inp.get("outcome") not in OUTCOMES:
        return f"outcome must be one of {', '.join(OUTCOMES)}"
    if inp.get("issue") and not _ID_RE.match(str(inp["issue"])):
        return "issue must be an id from an earlier entry (letters, digits, . _ : -)"
    return None


def open_issue(entries: list[dict[str, Any]], session: str) -> str | None:
    """The session's newest issue that isn't fixed yet."""
    closed: set[str] = set()
    for e in reversed(entries):
        if e.get("outcome") == "fixed":
            closed.add(e.get("issue", ""))
            continue
        if e.get("session") == session and e.get("issue") not in closed:
            return e.get("issue")
    return None


def make_entry(inp: dict[str, Any], entries: list[dict[str, Any]], eid: str, at: str) -> dict[str, Any]:
    session = clean(inp.get("session"), 80) or "unknown"
    outcome = inp["outcome"]
    issue = clean(inp.get("issue"), 80)
    if not issue and outcome != "found":
        issue = open_issue(entries, session) or ""
    return {
        "id": eid, "at": at, "outcome": outcome,
        "text": clean(inp.get("text"), TEXT_MAX),
        "detail": str(inp.get("detail") or "").strip()[:DETAIL_MAX],
        "session": session,
        "agent": clean(inp.get("agent"), 60),
        "build": clean(inp.get("build"), 80),
        "issue": issue or eid,
        "notified": False,
    }


def alert_for(e: dict[str, Any]) -> dict[str, Any]:
    """The informational alert (bell + AmberX). Never asks for anything: no approve, no veto."""
    who = " · ".join(x for x in (e.get("build") or e.get("session"), e.get("agent")) if x)
    body = f"{who}. {e['detail']}" if e.get("detail") else who
    return {"source": "fix-log", "severity": SEVERITY[e["outcome"]], "key": f"fix-log:{e['id']}",
            "title": f"{TITLE[e['outcome']]}: {e['text']}"[:200], "body": f"FYI, nothing to approve. {body}"[:1000],
            "link": "view:fix-log", "meta": {"issue": e["issue"], "outcome": e["outcome"], "session": e["session"][:80]}}


def over_limit(entries: list[dict[str, Any]], session: str, now_ms: int, at_ms, limit: int) -> bool:
    """True when the session already notified `limit` times in the last 10 minutes (the entry is still logged)."""
    n = sum(1 for e in entries if e.get("session") == session and e.get("notified") and now_ms - at_ms(e["at"]) < 600_000)
    return n >= limit


def matches(e: dict[str, Any], f: dict[str, Any]) -> bool:
    if f.get("outcome") and e.get("outcome") not in str(f["outcome"]).split(","):
        return False
    for k in ("session", "build", "issue", "agent"):
        if f.get(k) and e.get(k) != f[k]:
            return False
    if f.get("since") and e.get("at", "") < str(f["since"]):
        return False
    q = str(f.get("q") or "").lower().strip()
    if q and q not in " ".join(str(e.get(k, "")) for k in ("text", "detail", "session", "build", "agent", "issue")).lower():
        return False
    return True


def issues(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """One row per issue, newest first: its first line, latest state, tries and failures."""
    by: dict[str, dict[str, Any]] = {}
    for e in entries:
        i = by.setdefault(e["issue"], {"issue": e["issue"], "title": e["text"], "session": e["session"], "build": e.get("build", ""),
                                       "startedAt": e["at"], "tries": 0, "failures": 0, "entries": 0})
        i.update(state=e["outcome"], lastAt=e["at"], last=e["text"], entries=i["entries"] + 1)
        i["tries"] += e["outcome"] == "trying"
        i["failures"] += e["outcome"] == "failed"
    return sorted(by.values(), key=lambda i: i["lastAt"], reverse=True)


def summary(entries: list[dict[str, Any]], today: str) -> dict[str, Any]:
    iss = issues(entries)
    return {
        "entries": len(entries),
        "today": {o: sum(1 for e in entries if e["outcome"] == o and e["at"].startswith(today)) for o in OUTCOMES},
        "openIssues": sum(1 for i in iss if i["state"] != "fixed"),
        "fixedIssues": sum(1 for i in iss if i["state"] == "fixed"),
        "sessions": sorted({e["session"] for e in entries}),
        "builds": sorted({e["build"] for e in entries if e.get("build")}),
        "last": entries[-1] if entries else None,
    }
