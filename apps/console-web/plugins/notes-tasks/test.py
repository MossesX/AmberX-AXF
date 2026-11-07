#!/usr/bin/env python3
"""Self-test for the Notes and tasks server part: the one-time merge (backup first, nothing lost, repeat changes nothing,
newer rows win, chunked tables, a missing source) and the Claude files read through axf.notes@1.

    python3 apps/console-web/plugins/notes-tasks/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-notes-tasks-test-"))
spec = importlib.util.spec_from_file_location("nt_migrate", HERE / "server" / "migrate.py")
m = importlib.util.module_from_spec(spec)
sys.modules["nt_migrate"] = m
spec.loader.exec_module(m)

todo, root, data = TMP / "todo" / "store.json", TMP / "notes", TMP / "data"
todo.parent.mkdir()
fails = 0


def ok(cond: bool, what: str) -> None:
    global fails
    print(("ok   " if cond else "FAIL ") + what)
    fails += 0 if cond else 1


def seed(entries: list | None = None) -> None:
    m.write_table(root, "lists", {"inbox": {"id": "inbox", "name": "Inbox"}})
    m.write_table(root, "items", {"n-1": {"id": "n-1", "title": "AmberX note"}})
    todo.write_text(json.dumps({"$axf": "todo-store@1", "lists": [
        {"id": 1, "parentId": None, "title": "My list", "icon": "", "sortOrder": 1, "createdAt": 1792718095220, "updatedAt": 1792718111483},
        {"id": 2, "parentId": 1, "title": "Group", "sortOrder": 2},
    ], "entries": entries if entries is not None else [
        {"id": 3, "listId": 1, "parentId": None, "kind": "task", "title": "Ship", "body": "text", "status": "blocked", "priority": "urgent", "dueAt": 1792718095220,
         "tags": ["a"], "checklist": [{"id": "c1", "text": "one", "done": True}], "fields": {"area": "server", "estimate": 2, "none": ""}, "sortOrder": 1, "createdAt": 1, "updatedAt": 2, "completedAt": None},
        {"id": 4, "listId": 2, "parentId": 3, "kind": "task", "title": "Sub", "status": "in_progress", "priority": "low"},
        {"id": 5, "listId": 1, "parentId": None, "kind": "note", "title": "Memo", "body": "n", "status": "open", "priority": "normal"},
    ]}))


seed()
r = m.run(todo, root, data)
lists, items = m.read_table(root, "lists"), m.read_table(root, "items")
ok(r["done"] and r["lists"] == 2 and r["items"] == 3, "every list and entry moved")
ok("inbox" in lists and "n-1" in items, "what the store had is still there")
ok(Path(r["backup"], "todo-store.json").exists() and Path(r["backup"], "amberx-notes", "items", "head.json").exists(), "backup taken first")
ok(json.loads(Path(r["backup"], "amberx-notes", "items", "head.json").read_text())["count"] == 1, "the backup is the state before the merge")
ok(json.loads(todo.read_text())["$axf"] == "todo-store@1", "the old store is left alone")
t = items["n-todo-3"]
ok(t["status"] == "open" and t["priority"] == 3 and {"a", "blocked", "urgent"} <= set(t["tags"]), "status + priority map, what has no field becomes a tag")
ok("area: server" in t["text"] and "estimate: 2" in t["text"] and "none" not in t["text"] and t["text"].startswith("text"), "custom fields kept in the text")
ok(t["due"] == m.iso(1792718095220)[:10] and t["checklist"][0] == {"id": "c1", "text": "one", "done": True}, "due date and checklist")
ok(items["n-todo-4"]["parent"] == "n-todo-3" and items["n-todo-4"]["status"] == "doing" and items["n-todo-4"]["list"] == "l-todo-2", "subtask and group links")
ok(items["n-todo-5"]["kind"] == "note" and items["n-todo-5"]["priority"] == 0, "a note stays a note")
ok(lists["l-todo-2"]["parent"] == "l-todo-1", "groups stay under their list")

items["n-todo-3"]["title"] = "Edited since"
m.write_table(root, "items", items)
r2 = m.run(todo, root, data)
ok(r2["lists"] == 0 and r2["items"] == 0 and r2["skipped"] == 5, "a repeat adds nothing")
ok(m.read_table(root, "items")["n-todo-3"]["title"] == "Edited since", "a repeat never overwrites an edit")
ok(m.run_once(todo, root, data) is None, "run_once stops after the first run")

shutil.rmtree(root); shutil.rmtree(data)
seed([{"id": i, "listId": 1, "kind": "note", "title": f"N{i}", "body": "x" * 900} for i in range(10, 200)])
os.chmod(root / "items" / "head.json", 0o660)
r = m.run(todo, root, data)
head = json.loads((root / "items" / "head.json").read_text())
ok(head["chunks"] > 0 and head["count"] == 191 and len(m.read_table(root, "items")) == 191, "a big table is written in chunks, every row reads back")
ok(all(p.stat().st_size <= m.HUB_FILE_MAX for p in (root / "items").iterdir()), "every file fits the hub's limit")
ok((root / "items" / "head.json").stat().st_mode & 0o777 == 0o660, "the hub's file mode is kept")

shutil.rmtree(data)
ok(m.run(TMP / "nope.json", root, data)["done"] is False and not data.exists(), "no todo store: nothing happens")
ok(m.run(todo, TMP / "nowhere", data)["done"] is False and not data.exists(), "no one store: nothing happens")

# the Claude files, through the capability only
os.environ["AXF_NOTES_TASKS_MIGRATE"] = "off"


class Notes:
    def __init__(self, on: bool = True):
        self.on = on

    def available(self) -> bool:
        return self.on

    def list(self, q: str = "") -> dict:
        return {"notes": [{"path": "a/b.md", "title": "B"}, {"path": "bad.md", "title": "Bad"}]}

    def read(self, path: str) -> dict:
        if path == "bad.md":
            raise OSError("gone")
        return {"content": "# B"}


services: dict = {}
sys.modules["console_context"] = types.SimpleNamespace(ROOT=TMP)
sys.modules["plugin_services"] = types.SimpleNamespace(get=services.get)
pkg = importlib.util.spec_from_file_location("nt_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
srv = importlib.util.module_from_spec(pkg)
sys.modules["nt_server"] = srv
pkg.loader.exec_module(srv)
ok(srv.vault() == {"available": False, "notes": []}, "no axf.notes@1: an empty answer, not an error")
services["axf.notes@1"] = Notes()
v = srv.vault()
ok(v["available"] and [n["path"] for n in v["notes"]] == ["a/b.md"] and v["notes"][0]["content"] == "# B", "the text comes along; one bad file doesn't hide the rest")
services["axf.notes@1"] = Notes(False)
ok(srv.vault()["available"] is False, "hub folder not mounted: an empty answer")

shutil.rmtree(TMP)
print("FAILED" if fails else "all good")
sys.exit(1 if fails else 0)
