"""One-time merge of the console Todo manager (todo-store@1) into the one store (hub tables `lists` and `items`,
amberx-notes@1). Backs up first, adds rows only, and leaves the old store.json where it is.

Written the way lib-hubstore writes a table (hub-table@1: inline under 64 KB, else chunks). Safe to repeat: a row whose
id is already in the store is left alone, so an edit made since the last run is never overwritten.
"""
from __future__ import annotations

import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TABLE_FORMAT = "hub-table@1"
HUB_FILE_MAX = 64_000
TABLE_CHUNK = 48_000
STATUS = {"open": "open", "in_progress": "doing", "blocked": "open", "done": "done"}
PRIORITY = {"low": 1, "normal": 2, "high": 3, "urgent": 3}


def notes_dir() -> Path:
    if os.environ.get("AXF_AMBERX_NOTES_DIR"):
        return Path(os.environ["AXF_AMBERX_NOTES_DIR"])
    return Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data" / "amberx-notes"


def iso(ms: Any) -> str:
    if isinstance(ms, bool) or not isinstance(ms, (int, float)):
        return ""
    return datetime.fromtimestamp(ms / 1000, timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def to_list(raw: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": f"l-todo-{raw['id']}", "name": str(raw.get("title") or "Untitled")[:80],
        "parent": f"l-todo-{raw['parentId']}" if raw.get("parentId") else None,
        "order": raw.get("sortOrder") or 0, "icon": raw.get("icon") or "",
        "createdAt": iso(raw.get("createdAt")), "updatedAt": iso(raw.get("updatedAt")),
    }


def to_item(e: dict[str, Any]) -> dict[str, Any]:
    """Nothing is dropped: what the item has no field for goes into its tags or its text."""
    tags = list(e.get("tags") or [])
    if e.get("status") == "blocked":
        tags.append("blocked")
    if e.get("priority") == "urgent":
        tags.append("urgent")
    fields = [f"{k}: {v}" for k, v in (e.get("fields") or {}).items() if v not in (None, "", [])]
    body = str(e.get("body") or "")
    kind = e.get("kind") if e.get("kind") in ("note", "todo", "task") else "task"
    return {
        "id": f"n-todo-{e['id']}", "kind": kind, "list": f"l-todo-{e['listId']}", "title": str(e.get("title") or "Untitled")[:160],
        "text": "\n\n".join(x for x in [body, "\n".join(fields)] if x)[:20_000], "summary": "", "transcript": "", "tags": tags,
        "pinned": False, "starred": False, "status": STATUS.get(e.get("status"), "open"),
        "priority": 0 if kind == "note" else PRIORITY.get(e.get("priority"), 0),
        "due": iso(e.get("dueAt"))[:10], "checklist": [{"id": str(c.get("id")), "text": str(c.get("text") or "")[:300], "done": c.get("done") is True} for c in e.get("checklist") or []],
        "parent": f"n-todo-{e['parentId']}" if e.get("parentId") else "", "order": e.get("sortOrder") or 0, "source": "import", "url": "",
        "createdAt": iso(e.get("createdAt")), "updatedAt": iso(e.get("updatedAt")), "doneAt": iso(e.get("completedAt")), "by": "console:todo-manager", "device": "",
    }


def _json(p: Path) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def read_table(root: Path, name: str) -> dict[str, Any]:
    head = _json(root / name / "head.json")
    if not isinstance(head, dict) or head.get("$axf") != TABLE_FORMAT:
        return {}
    if head.get("rows") is not None:
        return dict(head["rows"])
    out: dict[str, Any] = {}
    for i in range(head.get("chunks") or 0):
        out.update(_json(root / name / f"rows-{i}.json") or {})
    return out


def _write(p: Path, value: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.tmp-{os.getpid()}")
    tmp.write_text(json.dumps(value), "utf-8")
    if p.exists():  # the hub owns these files: keep its owner and mode
        st = p.stat()
        os.chmod(tmp, st.st_mode & 0o777)
        try:
            os.chown(tmp, st.st_uid, st.st_gid)
        except PermissionError:
            pass
    tmp.replace(p)


def write_table(root: Path, name: str, rows: dict[str, Any]) -> None:
    now = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")
    base = {"$axf": TABLE_FORMAT, "table": name, "count": len(rows), "updatedAt": now}
    inline = {**base, "chunks": 0, "rows": rows}
    if len(json.dumps(inline)) <= HUB_FILE_MAX - 500:
        _write(root / name / "head.json", inline)
        return
    parts: list[dict[str, Any]] = [{}]
    size = 2
    for k, v in rows.items():
        n = len(json.dumps(k)) + len(json.dumps(v)) + 2
        if size + n > TABLE_CHUNK and parts[-1]:
            parts.append({})
            size = 2
        parts[-1][k] = v
        size += n
    for i, part in enumerate(parts):
        _write(root / name / f"rows-{i}.json", part)
    _write(root / name / "head.json", {**base, "chunks": len(parts)})


def backup(todo: Path, root: Path, data: Path) -> Path:
    """A copy of everything the merge reads or writes, stale chunks included. Never deleted by this plugin's code."""
    dest = data / "backup" / datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    dest.mkdir(parents=True, exist_ok=True)
    if todo.exists():
        shutil.copy2(todo, dest / "todo-store.json")
    for table in ("lists", "items"):
        if (root / table).is_dir():
            shutil.copytree(root / table, dest / "amberx-notes" / table, dirs_exist_ok=True)
    return dest


def status(data: Path) -> dict[str, Any]:
    return _json(data / "migrated.json") or {"done": False}


def run(todo: Path, root: Path, data: Path) -> dict[str, Any]:
    src = _json(todo)
    if not isinstance(src, dict) or src.get("$axf") != "todo-store@1":
        return {"done": False, "why": f"no todo-store@1 at {todo}"}
    if not (root / "lists" / "head.json").exists():
        return {"done": False, "why": f"the one store isn't at {root}"}
    dest = backup(todo, root, data)
    lists, items = read_table(root, "lists"), read_table(root, "items")
    new_lists = {r["id"]: r for r in map(to_list, src.get("lists") or []) if r["id"] not in lists}
    new_items = {r["id"]: r for r in map(to_item, src.get("entries") or []) if r["id"] not in items}
    if new_lists:
        write_table(root, "lists", {**lists, **new_lists})
    if new_items:
        write_table(root, "items", {**items, **new_items})
    report = {
        "done": True, "at": datetime.now(timezone.utc).isoformat(), "backup": str(dest),
        "lists": len(new_lists), "items": len(new_items),
        "skipped": len(src.get("lists") or []) + len(src.get("entries") or []) - len(new_lists) - len(new_items),
    }
    _write(data / "migrated.json", report)
    return report


def run_once(todo: Path, root: Path, data: Path) -> dict[str, Any] | None:
    return None if status(data).get("done") else run(todo, root, data)
