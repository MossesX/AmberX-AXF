#!/usr/bin/env python3
"""project_seed_stores: the Python half of framework/cli/project-seed.mjs.

Writes a test project's to-do lists and notes through the console plugins' own store code, so the files are exactly
what the console would write:

- to-do manager (todo-store@1): `apps/console-web/plugins/todo-manager/server/model.py` Store, at the file given  # axf-plugin:todo-manager
- notes browser: `apps/console-web/plugins/notes-browser/server/store.py` NotesStore, in `_shared/_claude/<folder>/`  # axf-plugin:notes-browser

Reads one JSON object on stdin and prints one JSON line:

    {"todoFile": "<…/projects/<id>/store.json>", "notesRoot": "/projects", "notesFolder": "project-notes/<id>",
     "by": "project-seed", "lists": [ListSpec…], "notes": [{"path": "a.md", "content": "…"}…]}

    ListSpec = {"title", "tone"?, "icon"?, "entries": [EntryInput…], "children": [ListSpec…]}
    EntryInput = what POST /api/plugins/todo-manager/entries takes, without listId  # axf-plugin:todo-manager

The to-do store is seeded only while it has no lists (a second run changes nothing); a note is written only when it
doesn't exist yet. Run with `-I` is fine: paths are resolved from this file, not the working directory.
"""
from __future__ import annotations

import importlib.util
import json
import sys
from pathlib import Path
from typing import Any

REPO = Path(__file__).resolve().parents[2]
PLUGINS = REPO / "apps" / "console-web" / "plugins"


def _load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    if spec is None or spec.loader is None:
        raise RuntimeError(f"can't load {path}")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


def seed_todos(todo_file: Path, lists: list[dict[str, Any]]) -> dict[str, Any]:
    for p in (REPO / "framework" / "python", REPO / "apps" / "console-web" / "server"):
        if str(p) not in sys.path:
            sys.path.insert(0, str(p))
    model = _load("axf_project_seed_todo_model", PLUGINS / "todo-manager" / "server" / "model.py")
    store = model.Store(todo_file)
    if store.lists():
        return {"file": str(todo_file), "seeded": False, "why": "the store already has lists", "lists": 0, "entries": 0}
    counts = {"lists": 0, "entries": 0}

    def add(spec: dict[str, Any], parent: int | None) -> None:
        lst = store.create_list({"title": spec["title"], "parentId": parent, "tone": spec.get("tone", ""), "icon": spec.get("icon", "")})
        counts["lists"] += 1
        for e in spec.get("entries", []):
            store.create_entry({**e, "listId": lst["id"]})
            counts["entries"] += 1
        for child in spec.get("children", []):
            add(child, lst["id"])

    for spec in lists:
        add(spec, None)
    return {"file": str(todo_file), "seeded": True, **counts}


def seed_notes(root: Path, folder: str, by: str, notes: list[dict[str, str]]) -> dict[str, Any]:
    mod = _load("axf_project_seed_notes_store", PLUGINS / "notes-browser" / "server" / "store.py")
    store = mod.NotesStore(root, by=by, folder=folder)
    if not store.available():
        return {"folder": folder, "seeded": False, "why": f"{store.claude_dir} is not here", "written": []}
    written, kept = [], []
    for n in notes:
        try:
            store.write(n["path"], n["content"], if_version="")  # "" = only when it doesn't exist yet
            written.append(n["path"])
        except mod.NotesError:
            kept.append(n["path"])
    return {"folder": str(store.notes_dir), "seeded": bool(written), "written": written, "kept": kept}


def main() -> int:
    req = json.loads(sys.stdin.read() or "{}")
    out: dict[str, Any] = {"ok": True}
    if req.get("todoFile"):
        out["todos"] = seed_todos(Path(req["todoFile"]), req.get("lists") or [])
    if req.get("notesFolder"):
        out["notes"] = seed_notes(Path(req.get("notesRoot") or "/projects"), req["notesFolder"], req.get("by") or "project-seed", req.get("notes") or [])
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except Exception as e:  # noqa: BLE001 — one JSON line either way
        print(json.dumps({"ok": False, "error": f"{type(e).__name__}: {e}"}))
        sys.exit(1)
