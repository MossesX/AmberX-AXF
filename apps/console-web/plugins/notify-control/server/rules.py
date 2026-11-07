"""Groups, triggers and commands of the Notifications panel (notify-rules@1). Pure: no FastAPI, no files.

A *group* is Brett's own list of types: on or off together, with its own command buttons. A *trigger* is a rule that
looks at each notification the hub gets:

  event       what it watches: types, groups, source, key prefix, lowest severity
  conditions  every one must hold: {field, op, value}, e.g. meta.percent gte 80
  threshold   only from the Nth match within N minutes
  schedule    only on these days, between these times

and what happens when it passes: `only` (notifications it watches are held unless it passes), `mute` (held when it passes)
or `raise` (a new notification goes out, with the given title). Guarded types (approvals, veto) are never held by a group or
a rule: a rule that could mute the veto notice could act unseen.

A *command* is a button on a notification: `approve` (opens the call's own screen, where only Brett's session can decide),
`open` (a screen) or `console` (a console action). Buttons only ever run in Brett's browser.
"""
from __future__ import annotations

import re
import time
from datetime import datetime
from typing import Any

EFFECTS = ("only", "mute", "raise")
OPS = ("eq", "ne", "contains", "not-contains", "gte", "lte")
FIELDS = ("source", "key", "title", "body", "severity", "type", "priority", "app")
SEVERITIES = ("info", "warning", "error", "critical")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")
COMMAND_KINDS = ("approve", "open", "console")
TEXT_MAX = 200
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
META_RE = re.compile(r"^meta\.[A-Za-z0-9_.-]{1,64}$")


def _text(v: Any, name: str, need: bool = False, limit: int = TEXT_MAX) -> str:
    s = v if isinstance(v, str) else "" if v is None else None
    if s is None:
        raise ValueError(f"{name} must be text")
    s = s.strip()[:limit]
    if need and not s:
        raise ValueError(f"{name} is missing")
    return s


def slug(name: str, taken: dict[str, Any]) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:40] or "item"
    out, n = base, 2
    while out in taken:
        out, n = f"{base}-{n}", n + 1
    return out


def clean_id(body: dict[str, Any], taken: dict[str, Any], name: str) -> str:
    rid = body.get("id")
    if rid in (None, ""):
        return slug(name, taken)
    if not isinstance(rid, str) or not ID_RE.match(rid):
        raise ValueError("id must be lower-case letters, digits and dashes")
    return rid


def clean_command(c: Any) -> dict[str, Any]:
    if not isinstance(c, dict):
        raise ValueError("a command needs label, kind and target")
    kind = c.get("kind")
    if kind not in COMMAND_KINDS:
        raise ValueError(f"command kind must be one of {', '.join(COMMAND_KINDS)}")
    label = _text(c.get("label"), "command label", True, 40)
    target = _text(c.get("target"), "command target")
    if kind != "approve" and not target:
        raise ValueError(f"{label}: an {kind} command needs a target" if kind == "open" else f"{label}: a console command needs a target")
    return {"label": label, "kind": kind, "target": target, "icon": _text(c.get("icon"), "command icon", limit=32)}


def clean_group(body: dict[str, Any], types: set[str], groups: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """A new or changed group. Fields left out keep what the group has."""
    old = groups.get(body.get("id")) if isinstance(body.get("id"), str) else None
    name = _text(body.get("name", (old or {}).get("name")), "name", True, 60)
    gid = clean_id(body, groups, name)
    members = body.get("types", (old or {}).get("types", []))
    if not isinstance(members, list) or not all(isinstance(t, str) for t in members):
        raise ValueError("types must be a list of type ids")
    unknown = [t for t in members if t not in types]
    if unknown:
        raise ValueError(f"no notification type {unknown[0]!r} (GET types lists them)")
    commands = body.get("commands", (old or {}).get("commands", []))
    if not isinstance(commands, list) or len(commands) > 8:
        raise ValueError("commands must be a list of at most 8")
    on = body.get("on", (old or {}).get("on", True))
    if not isinstance(on, bool):
        raise ValueError("on must be true or false")
    return gid, {"name": name, "on": on, "types": list(dict.fromkeys(members)), "commands": [clean_command(c) for c in commands]}


def clean_condition(c: Any) -> dict[str, Any]:
    if not isinstance(c, dict) or c.get("op") not in OPS:
        raise ValueError(f"a condition needs field, op ({', '.join(OPS)}) and value")
    field = c.get("field")
    if not isinstance(field, str) or not (field in FIELDS or META_RE.match(field)):
        raise ValueError(f"condition field must be one of {', '.join(FIELDS)} or meta.<name>")
    value = c.get("value")
    if isinstance(value, bool) or not isinstance(value, (str, int, float)):
        raise ValueError("condition value must be text or a number")
    if c["op"] in ("gte", "lte") and _number(value) is None:
        raise ValueError(f"{c['op']} needs a number")
    return {"field": field, "op": c["op"], "value": value}


def clean_trigger(body: dict[str, Any], types: set[str], groups: dict[str, Any], triggers: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """A new or changed trigger. Fields left out keep what the trigger has."""
    old = (triggers.get(body.get("id")) if isinstance(body.get("id"), str) else None) or {}
    get = lambda k, d: body.get(k, old.get(k, d))  # noqa: E731
    name = _text(get("name", ""), "name", True, 60)
    tid = clean_id(body, triggers, name)
    effect = get("effect", "only")
    if effect not in EFFECTS:
        raise ValueError(f"effect must be one of {', '.join(EFFECTS)}")
    on = get("on", True)
    if not isinstance(on, bool):
        raise ValueError("on must be true or false")
    e = get("event", {})
    if not isinstance(e, dict):
        raise ValueError("event must be an object")
    event = {"types": e.get("types") or [], "groups": e.get("groups") or [], "source": _text(e.get("source"), "event source"), "keyPrefix": _text(e.get("keyPrefix"), "event key prefix"), "severity": e.get("severity") or ""}
    bad = [t for t in event["types"] if t not in types]
    if bad:
        raise ValueError(f"no notification type {bad[0]!r} (GET types lists them)")
    bad = [g for g in event["groups"] if g not in groups]
    if bad:
        raise ValueError(f"no group {bad[0]!r} (GET groups lists them)")
    if event["severity"] and event["severity"] not in SEVERITIES:
        raise ValueError(f"severity must be one of {', '.join(SEVERITIES)}")
    if not any(event[k] for k in ("types", "groups", "source", "keyPrefix", "severity")):
        raise ValueError("a trigger has to watch something: give event types, groups, source, keyPrefix or severity")
    conds = get("conditions", [])
    if not isinstance(conds, list) or len(conds) > 8:
        raise ValueError("conditions must be a list of at most 8")
    th = get("threshold", {}) or {}
    if not isinstance(th, dict):
        raise ValueError("threshold must be { count, minutes }")
    count, minutes = _number(th.get("count", 1)), _number(th.get("minutes", 60))
    if count is None or count < 1 or count > 1000 or minutes is None or minutes < 1 or minutes > 10080:
        raise ValueError("threshold: count 1 to 1000, minutes 1 to 10080")
    sc = get("schedule", {}) or {}
    if not isinstance(sc, dict):
        raise ValueError("schedule must be { days, start, end }")
    days = [d for d in sc.get("days") or []]
    if any(d not in DAYS for d in days):
        raise ValueError(f"days must be among {', '.join(DAYS)}")
    start, end = str(sc.get("start") or ""), str(sc.get("end") or "")
    if bool(start) != bool(end) or (start and not (TIME_RE.match(start) and TIME_RE.match(end))):
        raise ValueError("schedule: start and end go together, HH:MM 24 hour")
    out = {"name": name, "on": on, "effect": effect, "event": event, "conditions": [clean_condition(c) for c in conds],
           "threshold": {"count": int(count), "minutes": int(minutes)}, "schedule": {"days": days, "start": start, "end": end}}
    if effect == "raise":
        out["title"] = _text(get("title", ""), "title", True)
        out["body"] = _text(get("body", ""), "body", limit=500)
        sev = get("severity", "warning")
        if sev not in SEVERITIES:
            raise ValueError(f"severity must be one of {', '.join(SEVERITIES)}")
        out["severity"] = sev
    return tid, out


def _number(v: Any) -> float | None:
    if isinstance(v, bool):
        return None
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def field_of(alert: dict[str, Any], field: str) -> Any:
    if field.startswith("meta."):
        cur: Any = alert.get("meta") if isinstance(alert.get("meta"), dict) else {}
        for part in field[5:].split("."):
            cur = cur.get(part) if isinstance(cur, dict) else None
        return cur
    return alert.get(field)


def holds(c: dict[str, Any], alert: dict[str, Any]) -> bool:
    v = field_of(alert, c["field"])
    if v is None:
        return c["op"] in ("ne", "not-contains")
    if c["op"] in ("gte", "lte"):
        a, b = _number(v), _number(c["value"])
        return a is not None and b is not None and (a >= b if c["op"] == "gte" else a <= b)
    a, b = str(v).lower(), str(c["value"]).lower()
    return {"eq": a == b, "ne": a != b, "contains": b in a, "not-contains": b not in a}[c["op"]]


def watches(tr: dict[str, Any], alert: dict[str, Any], groups: dict[str, Any]) -> bool:
    """Does this rule look at this notification at all?"""
    e = tr["event"]
    scope = set(e["types"])
    for g in e["groups"]:
        scope.update((groups.get(g) or {}).get("types") or [])
    if (e["types"] or e["groups"]) and alert.get("type") not in scope:
        return False
    if e["source"] and alert.get("source") != e["source"]:
        return False
    if e["keyPrefix"] and not str(alert.get("key") or "").startswith(e["keyPrefix"]):
        return False
    if e["severity"] and alert.get("severity") in SEVERITIES and SEVERITIES.index(alert["severity"]) < SEVERITIES.index(e["severity"]):
        return False
    return True


def in_schedule(sc: dict[str, Any], now: datetime, in_window: Any) -> bool:
    if sc["days"] and DAYS[now.weekday()] not in sc["days"]:
        return False
    return not sc["start"] or in_window(now, sc["start"], sc["end"])


def explain(tr: dict[str, Any], alert: dict[str, Any], groups: dict[str, Any], now: datetime, in_window: Any, seen: int) -> dict[str, Any]:
    """One rule against one notification. `seen` counts this one. Every step is named, so the panel can say why."""
    steps = {"event": watches(tr, alert, groups), "conditions": all(holds(c, alert) for c in tr["conditions"]),
             "threshold": seen >= tr["threshold"]["count"], "schedule": in_schedule(tr["schedule"], now, in_window)}
    return {"watches": steps["event"], "passes": all(steps.values()), "steps": steps}


def hits_in(hits: list[float], minutes: int, now: float) -> list[float]:
    return [h for h in hits if now - h < minutes * 60]


def apply(triggers: dict[str, Any], groups: dict[str, Any], alert: dict[str, Any], now: datetime, in_window: Any, hits: dict[str, list[float]], at: float | None = None) -> dict[str, Any]:
    """Every rule on one raise: {hold: why or "", fire: [rules that raise]}. `hits` is the threshold's memory and is updated.
    A rule of kind `only` holds what it watches unless one such rule passes. Hits clear when a rule fires."""
    at = time.time() if at is None else at
    only, passed, muted, fire = [], False, "", []
    for tid, tr in triggers.items():
        if not tr.get("on", True) or not watches(tr, alert, groups):
            continue
        seen = hits_in(hits.get(tid, []), tr["threshold"]["minutes"], at)
        ok_so_far = all(holds(c, alert) for c in tr["conditions"])
        if ok_so_far:
            seen.append(at)
        hits[tid] = seen
        r = explain(tr, alert, groups, now, in_window, len(seen))
        if tr["effect"] == "only":
            only.append(tr)
            passed = passed or r["passes"]
        if r["passes"]:
            if tr["threshold"]["count"] > 1:
                hits[tid] = []
            if tr["effect"] == "mute" and not muted:
                muted = f"Muted by rule: {tr['name']}"
            if tr["effect"] == "raise":
                fire.append({"id": tid, **tr})
    if muted:
        return {"hold": muted, "fire": fire}
    if only and not passed:
        return {"hold": f"Waiting on rule: {only[0]['name']}", "fire": fire}
    return {"hold": "", "fire": fire}


def commands_for(t: dict[str, Any], groups: dict[str, Any], link: str) -> list[dict[str, Any]]:
    """The buttons on one notification: Approve on a held call, then the commands of every group it is in that is on.
    `approve` takes the notification's own link, so it opens the screen where Brett's own session decides."""
    out: list[dict[str, Any]] = []
    if t.get("guarded") and link:
        out.append({"label": "Approve", "kind": "approve", "target": link, "icon": "check"})
    for g in groups.values():
        if g.get("on") is False or t["id"] not in (g.get("types") or []):
            continue
        for c in g.get("commands") or []:
            target = c["target"] or link
            if target and not any(x["label"] == c["label"] for x in out):
                out.append({**c, "target": target})
    return out
