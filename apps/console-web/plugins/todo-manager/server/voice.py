"""Todo manager by name: what voice, MCP and the CLI use, so nobody has to know an id.

Lists and entries are found by their title (exact, then starts-with, then contains; case and spacing ignored). Two
equally good matches are refused with the candidates named, never guessed. Every operation answers with `say`, one
plain line to speak back, plus the list / entry it touched.

`hear(store, text, confirm)` turns a spoken phrase into one of these operations (the phrases are in `voice.json`,
next to plugin.json). Deletes answer `confirmation_required` until called again with confirm.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from .model import KINDS, Invalid, Store, text

VOICE_FILE = Path(__file__).resolve().parent.parent / "voice.json"
KIND_WORDS = {"note": "note", "notes": "note", "todo": "todo", "to-do": "todo", "to do": "todo", "todos": "todo", "task": "task", "tasks": "task"}
LABEL = {"note": "note", "todo": "to-do", "task": "task"}


def _clean(s: Any) -> str:
    """Punctuation off, spacing collapsed, case kept (titles keep what was said)."""
    s = re.sub(r"['’]", "", str(s or ""))
    s = re.sub(r"[“”\".,!?;:]+", " ", s)
    return re.sub(r"\s+", " ", s).strip()


def _norm(s: Any) -> str:
    return _clean(s).lower()


def _pick(rows: list[dict[str, Any]], name: str, what: str) -> dict[str, Any]:
    n = _norm(name)
    if not n:
        raise Invalid(f"Which {what}?")
    for test in (lambda t: t == n, lambda t: t.startswith(n), lambda t: n in t):
        hits = [r for r in rows if test(_norm(r["title"]))]
        if len(hits) == 1:
            return hits[0]
        if len(hits) > 1:
            names = ", ".join(sorted({h["title"] for h in hits})[:5])
            raise Invalid(f"More than one {what} matches “{name}”: {names}. Say the full name.", 409)
    raise Invalid(f"No {what} called “{name}”.", 404)


def find_list(store: Store, name: str) -> dict[str, Any]:
    return _pick(store.lists(), name, "list")


def find_entry(store: Store, name: str, list_name: str = "", kind: str = "") -> dict[str, Any]:
    rows = store.list_contents(find_list(store, list_name)["id"])["entries"] if list_name else store.search("")
    if kind in KINDS:
        rows = [r for r in rows if r["kind"] == kind]
    return _pick(rows, name, LABEL.get(kind, "item"))


def _kind(v: Any) -> str:
    k = KIND_WORDS.get(_norm(v), "")
    return k or "note"


# ---------------------------------------------------------------- operations (one per command)


def list_create(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    title = text(b.get("title") or b.get("list"), 120).strip()
    if not title:
        raise Invalid("Give the list a name")
    for x in store.lists():
        if _norm(x["title"]) == _norm(title):
            return {"ok": True, "created": False, "list": x, "say": f"There is already a list called {x['title']}."}
    parent = find_list(store, b["parent"])["id"] if b.get("parent") else None
    x = store.create_list({"title": title, "parentId": parent})
    return {"ok": True, "created": True, "list": x, "say": f"Made the list {x['title']}."}


def list_rename(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    x = find_list(store, b.get("list", ""))
    title = text(b.get("title"), 120).strip()
    if not title:
        raise Invalid("What should the list be called?")
    y = store.update_list(x["id"], {"title": title})
    return {"ok": True, "list": y, "say": f"Renamed {x['title']} to {y['title']}."}


def list_move(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    """Reorder: `position` (1 = first) among its siblings, or `parent` to nest it under another list ('top' = top level)."""
    x = find_list(store, b.get("list", ""))
    if b.get("parent"):
        top = _norm(b["parent"]) in ("top", "top level", "the top level", "root")
        y = store.update_list(x["id"], {"parentId": None if top else find_list(store, b["parent"])["id"]})
        return {"ok": True, "list": y, "say": f"Moved {y['title']} to the top level." if top else f"Moved {y['title']} into {b['parent']}."}
    pos = b.get("position")
    pos = int(pos) if isinstance(pos, (int, str)) and str(pos).isdigit() else 0
    if pos < 1:
        raise Invalid("Say where: a position (1 is first) or a list to move it into")
    sibs = [s for s in store.lists() if s.get("parentId") == x.get("parentId") and s["id"] != x["id"]]
    sibs.insert(min(pos, len(sibs) + 1) - 1, x)
    store.reorder("lists", [s["id"] for s in sibs])
    return {"ok": True, "list": x, "position": sibs.index(x) + 1, "say": f"Moved {x['title']} to position {sibs.index(x) + 1}."}


def list_delete(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    x = find_list(store, b.get("list", ""))
    if b.get("confirm") is not True:
        return {"ok": False, "code": "confirmation_required", "list": x, "say": f"Delete the list {x['title']} and its {x['counts']['entries']} items? Say it again with confirm."}
    n = store.delete_list(x["id"])
    return {"ok": True, "deleted": n, "say": f"Deleted the list {x['title']} ({n['entries']} items)."}


def entry_add(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    kind = _kind(b.get("kind"))
    title = text(b.get("title"), 200).strip()
    if not title:
        raise Invalid(f"What should the {LABEL[kind]} be called?")
    if not b.get("list"):
        raise Invalid(f"Which list should the {LABEL[kind]} go in?")
    x = find_list(store, b["list"])
    parent = find_entry(store, b["under"], x["title"])["id"] if b.get("under") else None
    e, warnings = store.create_entry({"listId": x["id"], "parentId": parent, "kind": kind, "title": title,
                                      "body": text(b.get("body"), 50_000), "draft": True})
    return {"ok": True, "entry": e, "list": x, "warnings": warnings, "say": f"Added the {LABEL[kind]} {e['title']} to {x['title']}."}


def entry_edit(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    e = find_entry(store, b.get("entry", ""), b.get("list", ""))
    patch: dict[str, Any] = {"draft": True}
    for k in ("title", "body", "status", "priority"):
        if b.get(k) not in (None, ""):
            patch[k] = text(b[k], 50_000 if k == "body" else 200).strip()
    if b.get("kind"):
        patch["kind"] = _kind(b["kind"])
    if len(patch) == 1:
        raise Invalid("Say what to change: title, body, status, priority or kind")
    y, warnings = store.update_entry(e["id"], patch)
    return {"ok": True, "entry": y, "warnings": warnings, "say": f"Updated {y['title']}."}


def entry_move(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    e = find_entry(store, b.get("entry", ""), b.get("from", ""))
    x = find_list(store, b.get("to") or b.get("list") or "")
    y, _ = store.update_entry(e["id"], {"listId": x["id"], "draft": True})
    return {"ok": True, "entry": y, "list": x, "say": f"Moved {y['title']} to {x['title']}."}


def entry_complete(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    e = find_entry(store, b.get("entry", ""), b.get("list", ""))
    done = b.get("done") is not False
    y, _ = store.update_entry(e["id"], {"status": "done" if done else "open", "draft": True})
    return {"ok": True, "entry": y, "say": f"Marked {y['title']} {'done' if done else 'not done'}."}


def entry_delete(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    e = find_entry(store, b.get("entry", ""), b.get("list", ""))
    if b.get("confirm") is not True:
        return {"ok": False, "code": "confirmation_required", "entry": e, "say": f"Delete {e['title']} and anything under it? Say it again with confirm."}
    n = store.delete_entry(e["id"])
    return {"ok": True, "deleted": n, "say": f"Deleted {e['title']}." if n == 1 else f"Deleted {e['title']} and {n - 1} under it."}


def find(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    q = text(b.get("q"), 120)
    kind = _kind(b["kind"]) if b.get("kind") else ""
    rows = store.search(q, kind, text(b.get("status"), 30))
    names = {x["id"]: x["title"] for x in store.lists()}
    rows = [{**r, "list": names.get(r["listId"], "")} for r in rows]
    top = ", ".join(f"{r['title']} in {r['list']}" for r in rows[:3])
    return {"ok": True, "entries": rows, "say": f"{len(rows)} found. {top}." if rows else f"Nothing matches {q}."}


def lists_read(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    if b.get("list"):
        c = store.list_contents(find_list(store, b["list"])["id"])
        open_ = [e for e in c["entries"] if e.get("status") != "done"]
        top = ", ".join(e["title"] for e in open_[:5])
        return {"ok": True, **c, "say": f"{c['list']['title']} has {len(c['entries'])} items, {len(open_)} open{': ' + top if top else ''}."}
    xs = store.lists()
    return {"ok": True, "lists": xs, "say": f"{len(xs)} lists: {', '.join(x['title'] for x in xs[:8])}." if xs else "No lists yet."}


def export(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    x = find_list(store, b.get("list", ""))
    name, md = store.export_md(x["id"])
    return {"ok": True, "file": name, "markdown": md, "say": f"Exported {x['title']} as Markdown, {len(md.splitlines())} lines."}


def list_and_entry(store: Store, b: dict[str, Any]) -> dict[str, Any]:
    """'Make a list called X and a note called Y': the list (made, or the one already called that) with the item in it."""
    x = list_create(store, {"title": b.get("list"), "parent": b.get("parent")})
    e = entry_add(store, {"list": x["list"]["title"], "kind": b.get("kind"), "title": b.get("title"), "body": b.get("body")})
    return {"ok": True, "created": x["created"], "list": e["list"], "entry": e["entry"], "warnings": e["warnings"],
            "say": f"{x['say']} {e['say']}"}


OPS = {
    "list-and-entry": list_and_entry,
    "list-create": list_create, "list-rename": list_rename, "list-move": list_move, "list-delete": list_delete,
    "entry-add": entry_add, "entry-edit": entry_edit, "entry-move": entry_move, "entry-complete": entry_complete,
    "entry-delete": entry_delete, "find": find, "lists-read": lists_read, "export": export,
}


# ---------------------------------------------------------------- phrases


def _pattern(phrase: str) -> re.Pattern[str]:
    """'add a {kind} called {title} to {list}' → a regex; each slot takes one or more words (shortest first)."""
    out = ""
    for part in re.split(r"(\{\w+\})", phrase.lower()):
        if re.fullmatch(r"\{\w+\}", part):
            out += rf"(?P<{part[1:-1]}>.+?)"
        elif part:
            lead, words, trail = part[:1].isspace(), part.split(), part[-1:].isspace()
            out += (r"\s+" if lead else "") + r"\s+".join(re.escape(w) for w in words) + (r"\s+" if trail and words else "")
    return re.compile(rf"^(?:(?:hey |ok |okay )?(?:amber|amberx)\s+)?(?:please\s+)?{out}$", re.IGNORECASE)


def load_phrases(path: Path = VOICE_FILE) -> list[dict[str, Any]]:
    doc = json.loads(path.read_text(encoding="utf-8"))
    return [{**c, "patterns": [_pattern(p) for p in c["phrases"]]} for c in doc["commands"]]


_PHRASES: list[dict[str, Any]] | None = None


def match(said: str) -> tuple[dict[str, Any], dict[str, str]] | None:
    """The first command whose phrase matches, with its slots (in voice.json order: specific phrases first)."""
    global _PHRASES
    if _PHRASES is None:
        _PHRASES = load_phrases()
    p = re.sub(r"\bto[- ]do(s?)\b", r"todo\1", _clean(said), flags=re.IGNORECASE)
    for c in _PHRASES:
        for pat in c["patterns"]:
            if m := pat.match(p):
                slots = {k: re.sub(r"^(?:the|a|an|my)\s+", "", v, flags=re.IGNORECASE).strip() for k, v in m.groupdict().items() if v}
                for k in ("list", "to", "from"):
                    if k in slots:
                        slots[k] = re.sub(r"\s+list$", "", slots[k], flags=re.IGNORECASE)
                return c, {**c.get("fixed", {}), **slots}
    return None


def hear(store: Store, said: str, confirm: bool = False) -> dict[str, Any] | None:
    """A spoken phrase → run it. None when it isn't a Todo manager phrase."""
    hit = match(said)
    if not hit:
        return None
    c, slots = hit
    if confirm or re.search(r"\b(?:confirm|confirmed|yes)\s*$", _norm(said)):
        slots = {k: re.sub(r"\s+(?:confirm|confirmed|yes)$", "", v, flags=re.IGNORECASE) if isinstance(v, str) else v for k, v in slots.items()}
        slots["confirm"] = True  # type: ignore[assignment]
    try:
        r = OPS[c["op"]](store, slots)
    except Invalid as e:
        r = {"ok": False, "code": "not_found" if e.status == 404 else "ambiguous" if e.status == 409 else "invalid", "message": str(e), "say": str(e)}
    return {**r, "heard": said, "command": c["id"], "op": c["op"], "slots": {k: v for k, v in slots.items() if k != "confirm"}}
