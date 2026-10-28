"""The notes intent, server side: the schema the AI is asked for and the check every answer goes through.

Python port of `src/plugins/notes/web/core.ts` (INTENT_ACTIONS, KINDS, INTENT_SCHEMA, validateIntent and the helpers
it needs: norm, tagList, normalizeDue, spokenDate). Keep the two in step; the browser checks the answer again with the
TypeScript copy, so a model's output is never trusted on either side.

    validate_intent(raw, today="2026-10-27")  -> (intent | None, errors)
    check_lists(intent, lists)                 -> errors when `list` / `sublist` isn't one of the given lists (and
                                                  `create` isn't true)
    extract_json(text)                         -> the first JSON object in a model's answer (fences stripped) or None
"""
from __future__ import annotations

import json
import re
import unicodedata
from datetime import date, datetime, timedelta
from typing import Any

INTENT_ACTIONS = ["add", "move", "rename-list", "rename-item", "create-list", "done", "undone", "remove", "read", "search", "open"]
KINDS = ["note", "todo", "task"]
MAX_NAME = 80
MAX_TITLE = 160
MAX_TEXT = 20_000
MAX_TAGS = 20

INTENT_SCHEMA: dict[str, Any] = {
    "type": "object", "required": ["action"],
    "properties": {
        "action": {"enum": INTENT_ACTIONS},
        "kind": {"enum": KINDS}, "title": {"type": "string"}, "text": {"type": "string"}, "summary": {"type": "string"},
        "list": {"type": "string"}, "sublist": {"type": "string"}, "target": {"type": "string"}, "to": {"type": "string"},
        "tasks": {"type": "array", "items": {"type": "object", "required": ["content"], "properties": {
            "content": {"type": "string"}, "due": {"type": "string"}, "priority": {"enum": [1, 2, 3]}}}},
        "tags": {"type": "array", "items": {"type": "string"}}, "due": {"type": "string"}, "priority": {"enum": [0, 1, 2, 3]},
        "create": {"type": "boolean"},
    },
}


def _str(v: Any, n: int) -> str:
    return re.sub(r"\s+", " ", v).strip()[:n] if isinstance(v, str) else ""


def _text(v: Any, n: int) -> str:
    return v[:n] if isinstance(v, str) else ""


def norm(s: Any) -> str:
    """Lower case, letters/digits/spaces only, single spaces (= core.ts norm)."""
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKD", s.lower())
    s = "".join(c for c in s if not unicodedata.combining(c))
    s = re.sub(r"['’]", "", s)
    s = re.sub(r"[^a-z0-9 ]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def tag_list(v: Any) -> list[str]:
    raw = v if isinstance(v, list) else re.split(r"[,#]+", v) if isinstance(v, str) else []
    out: list[str] = []
    for t in raw:
        n = norm(t).replace(" ", "-")[:30]
        if n and n not in out and len(out) < MAX_TAGS:
            out.append(n)
    return out


def normalize_due(v: Any) -> str:
    if not isinstance(v, str) or not v.strip():
        return ""
    s = v.strip()
    if re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        try:
            date.fromisoformat(s)
            return s
        except ValueError:
            return ""
    try:
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return ""
    return dt.isoformat()


_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "ten": 10}
_DAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"]


def spoken_date(phrase: str, today: date) -> str:
    """today, tomorrow, monday…sunday (next one), next week, in N days, end of the week (= core.ts spokenDate)."""
    p = norm(phrase)
    if not p:
        return ""
    if re.search(r"\d{4} \d{2} \d{2}", p):
        return p.replace(" ", "-")[:10]

    def add(n: int) -> str:
        return (today + timedelta(days=n)).isoformat()

    js_day = (today.weekday() + 1) % 7  # JS getDay(): Sunday = 0
    if re.search(r"\b(today|tonight|end of (the )?day)\b", p):
        return add(0)
    if re.search(r"\btomorrow\b", p):
        return add(1)
    m = re.search(r"\bin (\d+|one|two|three|four|five|six|seven|ten) days?\b", p)
    if m:
        n = _NUM.get(m.group(1)) or int(m.group(1))
        return add(min(n, 3650))
    if re.search(r"\bnext week\b", p):
        return add(7)
    for i, d in enumerate(_DAYS):
        if re.search(rf"\b{d}\b", p):
            return add((i - js_day + 7) % 7 or 7)
    if re.search(r"\bend of (the )?week\b", p):
        return add((5 - js_day + 7) % 7)
    return ""


def _due(v: Any, today: date) -> str:
    return normalize_due(v) or spoken_date(str(v), today)


def validate_intent(raw: Any, today: date | None = None) -> tuple[dict[str, Any] | None, list[str]]:
    """The cleaned intent, or None and the reasons it's refused (= core.ts validateIntent)."""
    today = today or date.today()
    errors: list[str] = []
    if not isinstance(raw, dict):
        return None, ["not an object"]
    action = raw.get("action")
    if action not in INTENT_ACTIONS:
        errors.append(f"unknown action {json.dumps(action)[:60]}")
    kind = raw.get("kind")
    if kind is not None and kind not in KINDS:
        errors.append("bad kind")
        kind = None
    pr = raw.get("priority")
    priority: int | None = None
    if pr is not None:
        try:
            n = int(pr) if not isinstance(pr, bool) and float(pr) == int(float(pr)) else -1
        except (TypeError, ValueError):
            n = -1
        if n in (0, 1, 2, 3):
            priority = n
        else:
            errors.append("bad priority")
    tasks: list[dict[str, Any]] | None = None
    if isinstance(raw.get("tasks"), list):
        tasks = []
        for t in raw["tasks"][:50]:
            o = t if isinstance(t, dict) else {}
            content = _str(o.get("content"), 300)
            if not content:
                continue
            item: dict[str, Any] = {"content": content}
            if o.get("due"):
                d = _due(o["due"], today)
                if d:
                    item["due"] = d
            try:
                p = int(o.get("priority")) if o.get("priority") is not None and not isinstance(o.get("priority"), bool) else 0
            except (TypeError, ValueError):
                p = 0
            if p in (1, 2, 3):
                item["priority"] = p
            tasks.append(item)
    elif raw.get("tasks") is not None:
        errors.append("tasks must be a list")
    intent: dict[str, Any] = {"action": action}
    if kind:
        intent["kind"] = kind
    for key, fn, n in (("title", _str, MAX_TITLE), ("text", _text, MAX_TEXT), ("summary", _text, 2000), ("list", _str, MAX_NAME),
                       ("sublist", _str, MAX_NAME), ("target", _str, MAX_TITLE), ("to", _str, MAX_NAME)):
        if raw.get(key):
            v = fn(raw[key], n)
            if v:
                intent[key] = v
    if tasks:
        intent["tasks"] = tasks
    if raw.get("tags"):
        tags = tag_list(raw["tags"])
        if tags:
            intent["tags"] = tags
    if raw.get("due"):
        d = _due(raw["due"], today)
        if d:
            intent["due"] = d
    if priority is not None:
        intent["priority"] = priority
    if raw.get("create") is True:
        intent["create"] = True
    if action == "add" and not intent.get("text") and not intent.get("title") and not intent.get("tasks"):
        errors.append("add needs text, a title or tasks")
    if action in ("rename-list", "rename-item") and (not intent.get("target") or not intent.get("to")):
        errors.append("rename needs target and to")
    if action == "create-list" and not intent.get("list"):
        errors.append("create-list needs list")
    if action == "move" and not intent.get("list"):
        errors.append("move needs list")
    return (None, errors) if errors else (intent, [])


def _names(lists: list[str]) -> set[str]:
    """Every list as its whole path and as each of its parts ("Work › Bugs" → "work bugs", "work", "bugs")."""
    out: set[str] = set()
    for path in lists:
        parts = [norm(p) for p in re.split(r"\s*[›>/]\s*", path) if norm(p)]
        if parts:
            out.add(" ".join(parts))
            out.update(parts)
    return out


def check_lists(intent: dict[str, Any], lists: list[str]) -> list[str]:
    """The AI may only name lists it was given, unless it says `create: true` (a clearly new list); a list it creates
    needs an action that makes one (create-list, add, move)."""
    if intent.get("create"):
        return []
    if intent.get("action") == "create-list":
        return []  # creating is the point
    names = _names(lists)
    errors = []
    for key in ("list", "sublist"):
        v = intent.get(key)
        if v and norm(v) not in names:
            errors.append(f"{key} {json.dumps(v)} isn't one of the lists (use one of them, or set create: true for a clearly new list)")
    return errors


def extract_json(text: str) -> Any | None:
    """The first JSON object in a model's answer: the whole text, a ```json fence, or the outermost {...}."""
    if not isinstance(text, str):
        return None
    t = text.strip()
    m = re.search(r"```(?:json)?\s*(.*?)```", t, re.S)
    candidates = [t] + ([m.group(1).strip()] if m else [])
    start, end = t.find("{"), t.rfind("}")
    if 0 <= start < end:
        candidates.append(t[start:end + 1])
    for c in candidates:
        try:
            v = json.loads(c)
        except ValueError:
            continue
        if isinstance(v, dict):
            return v
    return None
