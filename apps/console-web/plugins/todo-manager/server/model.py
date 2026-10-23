"""Todo manager — the data model (ported from xGallery's developer task manager, server/src/tasks.ts + routes/tasks.ts).

Every entry is a note, a to-do or a task. What each kind must and may contain (core parts: body, status, priority, due
date, tags, checklist, subtasks, plus custom fields) is set in Settings → Plugins → Todo manager, never from the
workspace itself, and enforced here. Lists nest (a list's children are its groups); entries nest (subtasks).

The store is one JSON file (todo-store@1) in the plugin's data folder, written atomically (0600). Pure functions here,
no FastAPI; the routes are in __init__.py.
"""
from __future__ import annotations

import re
import threading
import time
from pathlib import Path
from typing import Any

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

KINDS = ("note", "todo", "task")
RULES = ("required", "optional", "hidden")
FIELD_TYPES = ("text", "textarea", "number", "date", "select", "checkbox", "url", "tags")
CORE = ("body", "status", "priority", "due", "tags", "checklist", "subtasks")
STATUSES = ["open", "in_progress", "blocked", "done"]
PRIORITIES = ["low", "normal", "high", "urgent"]
# Theme tones (colour tokens), never literal colours: the UI maps them to --fx-* tokens.
TONES = ("accent", "info", "success", "warning", "danger", "neutral")
ICON_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}\Z")

MAX_LISTS = 500
MAX_ENTRIES = 20_000

DEFAULT_TYPES: dict[str, dict[str, Any]] = {
    "note": {
        "label": "Note", "icon": "file", "tone": "warning",
        "core": {"body": "required", "status": "hidden", "priority": "hidden", "due": "hidden", "tags": "optional", "checklist": "hidden", "subtasks": "hidden"},
        "statuses": STATUSES, "priorities": PRIORITIES, "defaultStatus": "open", "defaultPriority": "normal",
        "fields": [{"key": "source", "label": "Source / link", "type": "url", "required": False, "options": [], "placeholder": "https://…", "showInGrid": False}],
    },
    "todo": {
        "label": "To-do", "icon": "list", "tone": "info",
        "core": {"body": "optional", "status": "optional", "priority": "optional", "due": "optional", "tags": "optional", "checklist": "required", "subtasks": "hidden"},
        "statuses": STATUSES, "priorities": PRIORITIES, "defaultStatus": "open", "defaultPriority": "normal",
        "fields": [],
    },
    "task": {
        "label": "Task", "icon": "check-circle", "tone": "accent",
        "core": {"body": "optional", "status": "required", "priority": "required", "due": "optional", "tags": "optional", "checklist": "optional", "subtasks": "optional"},
        "statuses": STATUSES, "priorities": PRIORITIES, "defaultStatus": "open", "defaultPriority": "normal",
        "fields": [
            {"key": "estimate", "label": "Estimate (hours)", "type": "number", "required": False, "options": [], "placeholder": "", "showInGrid": True},
            {"key": "area", "label": "Area", "type": "select", "required": False, "options": ["client", "server", "design", "deploy", "docs"], "placeholder": "", "showInGrid": True},
        ],
    },
}


class Invalid(ValueError):
    """A request the rules refuse (→ 400). `status` 404 for a missing list or entry."""

    def __init__(self, msg: str, status: int = 400):
        super().__init__(msg)
        self.status = status


def now_ms() -> int:
    return int(time.time() * 1000)


def slug(s: Any) -> str:
    return re.sub(r"^_+|_+$", "", re.sub(r"[^a-z0-9]+", "_", str(s).lower()))[:32]


def text(v: Any, n: int) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", "" if v is None else str(v))[:n]


# ------------------------------------------------------------------------------------------------ types


def sanitize_types(inp: Any) -> dict[str, dict[str, Any]]:
    """Whatever came in, a complete and valid type schema (unknown keys dropped, bad values = the defaults)."""
    o = inp if isinstance(inp, dict) else {}
    out: dict[str, dict[str, Any]] = {}
    for kind in KINDS:
        d = DEFAULT_TYPES[kind]
        t = o.get(kind) if isinstance(o.get(kind), dict) else {}
        core_in = t.get("core") if isinstance(t.get("core"), dict) else {}
        core = {k: (core_in.get(k) if core_in.get(k) in RULES else d["core"][k]) for k in CORE}

        def lst(v: Any, fallback: list[str]) -> list[str]:
            arr = [slug(x) for x in v] if isinstance(v, list) else fallback
            arr = [x for x in dict.fromkeys(arr) if x][:12]
            return arr or fallback

        statuses = lst(t.get("statuses"), d["statuses"])
        priorities = lst(t.get("priorities"), d["priorities"])
        fields: list[dict[str, Any]] = []
        seen: set[str] = set()
        for raw in (t.get("fields") if isinstance(t.get("fields"), list) else d["fields"])[:24]:
            f = raw if isinstance(raw, dict) else {}
            label = text(f.get("label"), 40).strip() or "Field"
            key = slug(f.get("key") or "") or slug(label) or f"field_{len(fields) + 1}"
            while key in seen:
                key += "_2"
            seen.add(key)
            fields.append({
                "key": key, "label": label,
                "type": f.get("type") if f.get("type") in FIELD_TYPES else "text",
                "required": f.get("required") is True,
                "options": [x for x in (text(o2, 40).strip() for o2 in (f.get("options") if isinstance(f.get("options"), list) else [])) if x][:30],
                "placeholder": text(f.get("placeholder"), 80),
                "showInGrid": f.get("showInGrid") is True,
            })
        icon = t.get("icon")
        ds, dp = t.get("defaultStatus"), t.get("defaultPriority")
        out[kind] = {
            "label": text(t.get("label") or d["label"], 30).strip() or d["label"],
            "icon": icon if isinstance(icon, str) and ICON_RE.match(icon) else d["icon"],
            "tone": t.get("tone") if t.get("tone") in TONES else d["tone"],
            "core": core,
            "statuses": statuses,
            "priorities": priorities,
            "defaultStatus": ds if ds in statuses else statuses[0],
            "defaultPriority": dp if dp in priorities else ("normal" if "normal" in priorities else priorities[0]),
            "fields": fields,
        }
    return out


# ------------------------------------------------------------------------------------------------ entries


def validate_entry(kind: str, e: dict[str, Any], types: dict[str, dict[str, Any]]) -> tuple[bool, list[str], dict[str, Any]]:
    """Normalise a (partial) entry against its type; (ok, errors, value)."""
    t = types[kind]
    c = t["core"]
    errors: list[str] = []
    tags_in = e.get("tags") if isinstance(e.get("tags"), list) else []
    check_in = e.get("checklist") if isinstance(e.get("checklist"), list) else []
    due = e.get("dueAt")
    value: dict[str, Any] = {
        "kind": kind,
        "title": text(e.get("title"), 200).strip(),
        "body": "" if c["body"] == "hidden" else text(e.get("body"), 50_000),
        "status": t["defaultStatus"] if c["status"] == "hidden" else (e.get("status") if e.get("status") in t["statuses"] else t["defaultStatus"]),
        "priority": t["defaultPriority"] if c["priority"] == "hidden" else (e.get("priority") if e.get("priority") in t["priorities"] else t["defaultPriority"]),
        "dueAt": None if c["due"] == "hidden" or not isinstance(due, (int, float)) or isinstance(due, bool) or due != due else int(due),
        "tags": [] if c["tags"] == "hidden" else [x for x in dict.fromkeys(text(x, 30).strip().lower() for x in tags_in) if x][:20],
        "checklist": [] if c["checklist"] == "hidden" else [
            {"id": text(it.get("id") or f"c{i}", 20), "text": text(it.get("text"), 300), "done": it.get("done") is True}
            for i, it in enumerate(x for x in check_in[:200] if isinstance(x, dict))
        ],
        "fields": {},
    }
    label = t["label"]
    if not value["title"]:
        errors.append("A title is required")
    if c["body"] == "required" and not value["body"].strip():
        errors.append(f"{label}s need a body")
    if c["due"] == "required" and value["dueAt"] is None:
        errors.append(f"{label}s need a due date")
    if c["tags"] == "required" and not value["tags"]:
        errors.append(f"{label}s need at least one tag")
    if c["checklist"] == "required" and not any(x["text"].strip() for x in value["checklist"]):
        errors.append(f"{label}s need at least one checklist item")
    fin = e.get("fields") if isinstance(e.get("fields"), dict) else {}
    for f in t["fields"]:
        raw = fin.get(f["key"])
        ft = f["type"]
        v: Any
        if ft in ("number", "date"):
            if raw in (None, ""):
                v = None
            else:
                try:
                    v = float(raw)
                    if v != v or v in (float("inf"), float("-inf")):
                        raise ValueError
                    v = int(v) if ft == "date" or v.is_integer() else v
                except (TypeError, ValueError):
                    v = None
                    errors.append(f"{f['label']} must be a {'number' if ft == 'number' else 'date'}")
        elif ft == "checkbox":
            v = raw is True
        elif ft == "select":
            v = "" if raw in (None, "") else text(raw, 40)
            if v and v not in f["options"]:
                errors.append(f"{f['label']}: “{v}” is not one of the allowed options")
        elif ft == "tags":
            src = raw if isinstance(raw, list) else (str(raw).split(",") if isinstance(raw, str) else [])
            v = [x for x in (text(s, 30).strip() for s in src) if x][:20]
        elif ft == "url":
            v = text(raw, 500).strip()
            if v and not re.match(r"(https?://|mailto:|/)", v, re.I):
                errors.append(f"{f['label']} must be a link")
        else:
            v = text(raw, 10_000 if ft == "textarea" else 500)
        empty = v is None or v == "" or v is False or v == []
        if f["required"] and empty:
            errors.append(f"{f['label']} is required")
        value["fields"][f["key"]] = v
    return (not errors, errors, value)


# ------------------------------------------------------------------------------------------------ store


class Store:
    """todo-store@1: {types, lists, entries, nextId}. One lock; every change is written before it's answered."""

    def __init__(self, path: Path):
        self.path = path
        self.lock = threading.RLock()
        self.data: dict[str, Any] | None = None

    # ---- load / save
    def _load(self) -> dict[str, Any]:
        if self.data is None:
            raw = storage.read_json(self.path, {})
            raw = raw if isinstance(raw, dict) else {}
            lists = [x for x in raw.get("lists", []) if isinstance(x, dict) and isinstance(x.get("id"), int)]
            ids = {x["id"] for x in lists}
            entries = [x for x in raw.get("entries", []) if isinstance(x, dict) and isinstance(x.get("id"), int) and x.get("listId") in ids]
            top = max([0, *ids, *(x["id"] for x in entries)])
            self.data = {
                "$axf": "todo-store@1",
                "types": sanitize_types(raw.get("types")),
                "lists": lists,
                "entries": entries,
                "nextId": max(int(raw.get("nextId") or 1), top + 1),
            }
        return self.data

    def _save(self) -> None:
        storage.write_json(self.path, self.data)

    def _id(self) -> int:
        d = self._load()
        i = d["nextId"]
        d["nextId"] = i + 1
        return i

    # ---- types
    def types(self) -> dict[str, Any]:
        with self.lock:
            return self._load()["types"]

    def save_types(self, inp: Any) -> dict[str, Any]:
        with self.lock:
            d = self._load()
            d["types"] = sanitize_types(inp)
            self._save()
            return d["types"]

    # ---- lists
    def _list(self, lid: Any) -> dict[str, Any]:
        for x in self._load()["lists"]:
            if x["id"] == lid:
                return x
        raise Invalid("List not found", 404)

    def _subtree(self, lid: int) -> list[int]:
        lists = self._load()["lists"]
        out = [lid]
        i = 0
        while i < len(out):
            out += [x["id"] for x in lists if x.get("parentId") == out[i]]
            i += 1
        return out

    def list_json(self, x: dict[str, Any]) -> dict[str, Any]:
        es = [e for e in self._load()["entries"] if e["listId"] == x["id"]]
        return {**x, "counts": {"entries": len(es), "done": sum(1 for e in es if e.get("status") == "done")}}

    def lists(self) -> list[dict[str, Any]]:
        with self.lock:
            return [self.list_json(x) for x in sorted(self._load()["lists"], key=lambda x: (x.get("sortOrder", 0), x["id"]))]

    def create_list(self, b: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            d = self._load()
            if len(d["lists"]) >= MAX_LISTS:
                raise Invalid(f"At most {MAX_LISTS} lists and groups")
            parent = b.get("parentId")
            if parent is not None:
                self._list(parent)
            order = 1 + max([0, *(x.get("sortOrder", 0) for x in d["lists"] if x.get("parentId") == parent)])
            t = now_ms()
            icon = b.get("icon")
            x = {"id": self._id(), "parentId": parent, "title": text(b.get("title"), 120).strip() or "Untitled list",
                 "tone": b.get("tone") if b.get("tone") in TONES else "", "icon": icon if isinstance(icon, str) and ICON_RE.match(icon) else "",
                 "sortOrder": order, "createdAt": t, "updatedAt": t}
            d["lists"].append(x)
            self._save()
            return self.list_json(x)

    def update_list(self, lid: int, b: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            x = self._list(lid)
            if b.get("title") is not None:
                x["title"] = text(b["title"], 120).strip() or x["title"]
            if "parentId" in b:
                p = b["parentId"]
                if p is not None:
                    if p in self._subtree(x["id"]):
                        raise Invalid("A list cannot be moved into itself")
                    self._list(p)
                x["parentId"] = p
            if "tone" in b:
                x["tone"] = b["tone"] if b["tone"] in TONES else ""
            if "icon" in b:
                x["icon"] = b["icon"] if isinstance(b["icon"], str) and ICON_RE.match(b["icon"]) else ""
            if isinstance(b.get("sortOrder"), int):
                x["sortOrder"] = b["sortOrder"]
            x["updatedAt"] = now_ms()
            self._save()
            return self.list_json(x)

    def delete_list(self, lid: int) -> dict[str, int]:
        with self.lock:
            d = self._load()
            self._list(lid)
            ids = set(self._subtree(lid))
            n = sum(1 for e in d["entries"] if e["listId"] in ids)
            d["lists"] = [x for x in d["lists"] if x["id"] not in ids]
            d["entries"] = [e for e in d["entries"] if e["listId"] not in ids]
            self._save()
            return {"groups": len(ids) - 1, "entries": n}

    def reorder(self, coll: str, ids: list[int]) -> None:
        with self.lock:
            pos = {i: n + 1 for n, i in enumerate(ids)}
            for x in self._load()[coll]:
                if x["id"] in pos:
                    x["sortOrder"] = pos[x["id"]]
            self._save()

    def list_contents(self, lid: int) -> dict[str, Any]:
        with self.lock:
            x = self._list(lid)
            ids = self._subtree(lid)
            d = self._load()
            lists = sorted((l for l in d["lists"] if l["id"] in ids), key=lambda l: (l.get("sortOrder", 0), l["id"]))
            entries = sorted((e for e in d["entries"] if e["listId"] in ids), key=lambda e: (e.get("sortOrder", 0), e["id"]))
            return {"list": self.list_json(x), "lists": [self.list_json(l) for l in lists], "entries": [dict(e) for e in entries]}

    # ---- entries
    def _entry(self, eid: Any) -> dict[str, Any]:
        for e in self._load()["entries"]:
            if e["id"] == eid:
                return e
        raise Invalid("Entry not found", 404)

    def search(self, q: str = "", kind: str = "", status: str = "") -> list[dict[str, Any]]:
        with self.lock:
            ql = q.lower()
            out = [e for e in self._load()["entries"]
                   if (not ql or ql in e["title"].lower() or ql in e.get("body", "").lower() or any(ql in t for t in e.get("tags", [])))
                   and (not kind or e["kind"] == kind) and (not status or e.get("status") == status)]
            return [dict(e) for e in sorted(out, key=lambda e: -e.get("updatedAt", 0))[:300]]

    def _input(self, b: dict[str, Any], base: dict[str, Any] | None = None) -> dict[str, Any]:
        base = base or {}
        def pick(k: str, dflt: Any) -> Any:
            return b[k] if k in b else base.get(k, dflt)

        return {"title": pick("title", ""), "body": pick("body", ""), "status": pick("status", ""), "priority": pick("priority", ""),
                "dueAt": pick("dueAt", None), "tags": pick("tags", []), "checklist": pick("checklist", []),
                "fields": {**(base.get("fields") or {}), **(b.get("fields") if isinstance(b.get("fields"), dict) else {})}}

    def create_entry(self, b: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        with self.lock:
            d = self._load()
            if len(d["entries"]) >= MAX_ENTRIES:
                raise Invalid(f"At most {MAX_ENTRIES} entries")
            lid = b.get("listId")
            self._list(lid)
            parent = b.get("parentId")
            if parent is not None and self._entry(parent)["listId"] != lid:
                raise Invalid("A subtask must live in the same list as its parent")
            kind = b.get("kind") if b.get("kind") in KINDS else "task"
            types = d["types"]
            inp = self._input(b)
            if not b.get("status"):
                inp["status"] = types[kind]["defaultStatus"]
            if not b.get("priority"):
                inp["priority"] = types[kind]["defaultPriority"]
            ok, errors, v = validate_entry(kind, inp, types)
            if not ok and not b.get("draft"):
                raise Invalid(". ".join(errors))
            order = 1 + max([0, *(e.get("sortOrder", 0) for e in d["entries"] if e["listId"] == lid and e.get("parentId") == parent)])
            t = now_ms()
            e = {**v, "id": self._id(), "listId": lid, "parentId": parent, "title": v["title"] or "Untitled", "sortOrder": order,
                 "createdAt": t, "updatedAt": t, "completedAt": t if v["status"] == "done" else None}
            d["entries"].append(e)
            self._save()
            return dict(e), [] if ok else errors

    def update_entry(self, eid: int, b: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
        with self.lock:
            d = self._load()
            e = self._entry(eid)
            kind = b.get("kind") if b.get("kind") in KINDS else e["kind"]
            ok, errors, v = validate_entry(kind, self._input(b, e), d["types"])
            if not ok and not b.get("draft"):
                raise Invalid(". ".join(errors))
            lid, parent = e["listId"], e.get("parentId")
            if "listId" in b:
                lid = b["listId"]
                self._list(lid)
                if "parentId" not in b:
                    parent = None
            if "parentId" in b:
                parent = b["parentId"]
                if parent is not None:
                    if parent == e["id"] or parent in self._descendants(e["id"]):
                        raise Invalid("An entry cannot be nested under itself")
                    lid = self._entry(parent)["listId"]
            old_list = e["listId"]
            e.update({**v, "title": v["title"] or e["title"], "listId": lid, "parentId": parent, "updatedAt": now_ms(),
                      "completedAt": (e.get("completedAt") or now_ms()) if v["status"] == "done" else None})
            if isinstance(b.get("sortOrder"), int):
                e["sortOrder"] = b["sortOrder"]
            if lid != old_list:
                for c in self._descendants(e["id"]):
                    self._entry(c)["listId"] = lid
            self._save()
            return dict(e), [] if ok else errors

    def _descendants(self, eid: int) -> list[int]:
        es = self._load()["entries"]
        out: list[int] = []
        frontier = [eid]
        while frontier:
            kids = [e["id"] for e in es if e.get("parentId") in frontier]
            out += kids
            frontier = kids
        return out

    def delete_entry(self, eid: int) -> int:
        with self.lock:
            d = self._load()
            self._entry(eid)
            gone = {eid, *self._descendants(eid)}
            d["entries"] = [e for e in d["entries"] if e["id"] not in gone]
            self._save()
            return len(gone)

    def bulk(self, ids: list[int], action: str, b: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            d = self._load()
            rows = [e for e in d["entries"] if e["id"] in ids]
            if not rows:
                raise Invalid("No such entries", 404)
            if action == "delete":
                gone: set[int] = set()
                for r in rows:
                    gone |= {r["id"], *self._descendants(r["id"])}
                d["entries"] = [e for e in d["entries"] if e["id"] not in gone]
                self._save()
                return {"ok": True, "count": len(rows)}
            if action == "move":
                lid = b.get("listId")
                self._list(lid)
                parent = b.get("parentId")
                if parent is not None:
                    p = self._entry(parent)
                    under = set(ids)
                    for r in rows:
                        under |= set(self._descendants(r["id"]))
                    if parent in under or p["listId"] != lid:
                        raise Invalid("Cannot nest a selection under one of its own entries or across lists")
                base = max([0, *(e.get("sortOrder", 0) for e in d["entries"] if e["listId"] == lid and e.get("parentId") == parent)])
                for i, r in enumerate(rows):
                    r.update({"listId": lid, "parentId": parent, "sortOrder": base + i + 1, "updatedAt": now_ms()})
                    for c in self._descendants(r["id"]):
                        self._entry(c)["listId"] = lid
                self._save()
                return {"ok": True, "count": len(rows)}
            if action == "duplicate":
                if len(d["entries"]) + len(rows) > MAX_ENTRIES:
                    raise Invalid(f"At most {MAX_ENTRIES} entries")
                made = []
                for r in rows:
                    t = now_ms()
                    c = {**r, "id": self._id(), "title": f"{r['title']} (copy)"[:200], "sortOrder": r.get("sortOrder", 0) + 1,
                         "createdAt": t, "updatedAt": t, "completedAt": None,
                         "checklist": [dict(x) for x in r.get("checklist", [])], "tags": list(r.get("tags", [])), "fields": dict(r.get("fields", {}))}
                    d["entries"].append(c)
                    made.append(c["id"])
                self._save()
                return {"ok": True, "count": len(made), "ids": made}
            if action == "patch":
                patch = b.get("patch") if isinstance(b.get("patch"), dict) else {}
                add = [text(x, 30).strip().lower() for x in patch.get("addTags", [])] if isinstance(patch.get("addTags"), list) else []
                rem = [text(x, 30).strip().lower() for x in patch.get("removeTags", [])] if isinstance(patch.get("removeTags"), list) else []
                errors: list[str] = []
                count = 0
                for r in rows:
                    kind = patch["kind"] if patch.get("kind") in KINDS else r["kind"]
                    nxt: dict[str, Any] = {k: patch[k] for k in ("status", "priority", "dueAt") if k in patch}
                    if add or rem:
                        nxt["tags"] = list(dict.fromkeys([*(t for t in r.get("tags", []) if t not in rem), *add]))
                    ok, errs, v = validate_entry(kind, self._input(nxt, r), d["types"])
                    if not ok:
                        errors.append(f"“{r['title']}”: {', '.join(errs)}")
                        continue
                    r.update({"kind": kind, "status": v["status"], "priority": v["priority"], "dueAt": v["dueAt"], "tags": v["tags"],
                              "updatedAt": now_ms(), "completedAt": (r.get("completedAt") or now_ms()) if v["status"] == "done" else None})
                    count += 1
                self._save()
                return {"ok": not errors, "count": count, "errors": errors}
            raise Invalid("Unknown action")

    def export_md(self, lid: int) -> tuple[str, str]:
        """A list (with its groups and every entry) as Markdown; (filename, text)."""
        c = self.list_contents(lid)
        lists, entries = c["lists"], c["entries"]
        lines = [f"# {c['list']['title']}", ""]

        def items(list_id: int, parent: int | None, indent: int) -> None:
            for e in (x for x in entries if x["listId"] == list_id and x.get("parentId") == parent):
                box = "•" if e["kind"] == "note" else ("[x]" if e["status"] == "done" else "[ ]")
                meta = ""
                if e["kind"] != "note":
                    due = f", due {time.strftime('%Y-%m-%d', time.gmtime(e['dueAt'] / 1000))}" if e.get("dueAt") else ""
                    meta = f" _({e['kind']}, {e['status']}, {e['priority']}{due})_"
                tags = f" #{' #'.join(e['tags'])}" if e.get("tags") else ""
                lines.append(f"{'  ' * indent}- {box} **{e['title']}**{meta}{tags}")
                if e.get("body"):
                    lines.extend(f"{'  ' * (indent + 1)}{t}" for t in e["body"].split("\n"))
                for ch in e.get("checklist", []):
                    lines.append(f"{'  ' * (indent + 1)}- [{'x' if ch['done'] else ' '}] {ch['text']}")
                items(list_id, e["id"], indent + 1)

        def render(list_id: int, depth: int) -> None:
            l = next(x for x in lists if x["id"] == list_id)
            if depth:
                lines.extend([f"{'#' * min(6, depth + 1)} {l['title']}", ""])
            items(list_id, None, 0)
            lines.append("")
            for child in (x for x in lists if x.get("parentId") == list_id):
                render(child["id"], depth + 1)

        render(lid, 0)
        name = re.sub(r"[^a-z0-9_-]+", "-", c["list"]["title"].lower()).strip("-") or "list"
        return f"{name}.md", "\n".join(lines)
