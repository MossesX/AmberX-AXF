"""Auto-approval rules for the Monitor watch (rules.json in the data dir; the phone syncs them on every poll).

A rule: {id, what, scope, expiresAt, state, note, createdBy, createdAt}
  what       a tool name ("build.status"), a family ("build.*") — never "*"
  scope      "any", "project:<id>", "agent:<id>" or "build:<id>": the approval must match it
  expiresAt  ISO date-time, or "" for no expiry (expired rules stop applying and drop from the list after 7 days)
  state      on | proposed. A rule added by a command (MCP, CLI, voice, an agent) is proposed and does nothing until
             Brett's own click turns it on; a rule Brett adds in the console is on at once.

Never covered, whatever the rules say: destructive tools (the approval says destructive, or the tool name deletes,
removes, drops, wipes, resets, revokes, kills, force-pushes or uninstalls), personOnly actions, phone.recorder_start
(a straight approval) and vps.run. A rule that could only ever match those is refused when it is added.
"""
from __future__ import annotations

import re
import uuid
from datetime import timedelta
from typing import Any

from . import core as C
from . import store

FILE = "rules.json"
FRAME = "phone-rules@1"
WHAT_RE = re.compile(r"^[a-z0-9_-]+(\.[a-z0-9_-]+)*(\.\*)?$")
SCOPE_RE = re.compile(r"^(any|(project|agent|build):[A-Za-z0-9_.-]{1,80})$")
DESTRUCTIVE_RE = re.compile(r"(^|[._-])(delete|remove|rm|drop|destroy|wipe|purge|reset|revoke|kill|uninstall|force_push|force-push|prune|truncate|overwrite)([._-]|$)")
NEVER = (*C.NEVER_AUTO, *C.NOT_IN_ALL)
MAX_RULES = 100
KEEP_EXPIRED_DAYS = 7


def destructive(tool: str) -> bool:
    return bool(DESTRUCTIVE_RE.search(str(tool or "").lower()))


def never_covered(tool: str, flags: dict[str, Any] | None = None) -> str:
    """Why a machine may never approve this, or ""."""
    f = flags or {}
    t = C.resolve_tool(tool)["tool"] or str(tool or "")
    if t in NEVER:
        return f"{t} is a straight approval: only Brett approves it"
    if f.get("personOnly"):
        return "a personOnly action: only Brett's own click"
    if f.get("destructive") or destructive(t):
        return "a destructive tool: never auto-approved"
    return ""


def _load() -> list[dict[str, Any]]:
    d = store.read(FILE, {})
    return d.get("rules", []) if isinstance(d, dict) else []


def _save(rules: list[dict[str, Any]]) -> None:
    store.write(FILE, {"$axf": FRAME, "rules": rules})


def _live(r: dict[str, Any], at: str) -> bool:
    exp, now = C._parse(r.get("expiresAt")), C._parse(at)
    return not (exp and now and now > exp)


def list_rules(at: str | None = None) -> list[dict[str, Any]]:
    at = at or C.now_iso()
    now = C._parse(at)
    with store.LOCK:
        rules = _load()
        kept = [r for r in rules if _live(r, at) or not now or (now - (C._parse(r["expiresAt"]) or now)) < timedelta(days=KEEP_EXPIRED_DAYS)]
        if len(kept) != len(rules):
            _save(kept)
    return [{**r, "active": r["state"] == "on" and _live(r, at)} for r in kept]


def add(what: str, scope: str, expires_at: str, note: str, by: str, person: bool, at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    w = str(what or "").strip().lower()
    s = str(scope or "any").strip() or "any"
    if not WHAT_RE.match(w):
        raise C.PhoneError("validation", "what is a tool name (build.status) or a family (build.*); never everything.")
    if not SCOPE_RE.match(s):
        raise C.PhoneError("validation", "scope is any, project:<id>, agent:<id> or build:<id>.")
    # A family is fine: evaluate() still skips the never-covered tools inside it. An exact never-covered tool is refused.
    why = "" if w.endswith(".*") else never_covered(w)
    if why:
        raise C.PhoneError("denied", f"No rule can cover {w}: {why}.")
    exp = ""
    if expires_at:
        d = C._parse(expires_at)
        if not d or (C._parse(at) and d <= C._parse(at)):
            raise C.PhoneError("validation", "expiresAt is an ISO date-time in the future, or empty for no expiry.")
        exp = C.iso_at(d)
    rule = {"id": f"rule-{uuid.uuid4().hex[:10]}", "what": w, "scope": s, "expiresAt": exp, "state": "on" if person else "proposed",
            "note": C._s(note, C.TEXT_MAX), "createdBy": C._s(by, C.NAME_MAX), "createdAt": at}
    with store.LOCK:
        rules = _load()
        if len(rules) >= MAX_RULES:
            raise C.PhoneError("invalid", f"At most {MAX_RULES} rules. Remove some first.")
        rules.append(rule)
        _save(rules)
    return {**rule, "active": rule["state"] == "on",
            **({} if person else {"message": "Proposed: it does nothing until Brett turns it on in Settings → Plugins → Phone Connect → Auto-approval."})}


def enable(rule_id: str, on: bool) -> dict[str, Any]:
    """Brett's own click only (the route checks personOnly before turning a rule on)."""
    with store.LOCK:
        rules = _load()
        for r in rules:
            if r["id"] == rule_id:
                r["state"] = "on" if on else "proposed"
                _save(rules)
                return r
    raise C.PhoneError("not_found", f"No rule {rule_id!r}.")


def remove(rule_id: str) -> dict[str, Any]:
    with store.LOCK:
        rules = _load()
        left = [r for r in rules if r["id"] != rule_id]
        if len(left) == len(rules):
            raise C.PhoneError("not_found", f"No rule {rule_id!r}.")
        _save(left)
    return {"removed": rule_id}


def _scope_hit(scope: str, approval: dict[str, Any]) -> bool:
    if scope == "any":
        return True
    kind, _, val = scope.partition(":")
    return str(approval.get(kind) or "") == val


def evaluate(approval: dict[str, Any], at: str | None = None) -> dict[str, Any]:
    """The Monitor's question for one waiting approval {tool, project?, agent?, build?, destructive?, personOnly?}:
    {approve, rule?, why}. The phone runs the same rules on its synced copy."""
    at = at or C.now_iso()
    tool = str(approval.get("tool") or "")
    why = never_covered(tool, approval)
    if why:
        return {"approve": False, "why": why}
    t = C.resolve_tool(tool)["tool"] or tool.lower()
    for r in list_rules(at):
        if not r["active"]:
            continue
        w = r["what"]
        if (w == t or (w.endswith(".*") and t.startswith(w[:-1]))) and _scope_hit(r["scope"], approval):
            return {"approve": True, "rule": r["id"], "why": f"rule {r['what']} ({r['scope']})"}
    return {"approve": False, "why": "no rule covers it"}


def synced() -> dict[str, Any]:
    """What the phone gets on each poll: the active rules plus the never-list, so it can't be talked into more."""
    return {"$axf": FRAME, "rules": [r for r in list_rules() if r["active"]], "never": list(NEVER), "destructive": DESTRUCTIVE_RE.pattern}
