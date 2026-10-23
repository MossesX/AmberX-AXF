#!/usr/bin/env python3
"""Self-test for the Todo manager plugin (routes through FastAPI's test client, scratch data folder).

    python3 apps/console-web/plugins/todo-manager/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import stat
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA = tempfile.mkdtemp(prefix="axf-todo-test-")
os.environ["AXF_TODO_DIR"] = DATA

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.todo_manager_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0
fails: list[str] = []


def check(name: str, cond: bool, detail: object = "") -> None:
    global ok
    if cond:
        ok += 1
    else:
        fails.append(f"{name}: {detail}")


# ---- types
t = c.get("/p/types").json()["types"]
check("three kinds", sorted(t) == ["note", "task", "todo"], t.keys())
check("note body required", t["note"]["core"]["body"] == "required")
r = c.put("/p/types", json={"types": {"task": {"label": "Job", "tone": "nope", "icon": "Bad Icon!", "statuses": ["Open", "Done", "Done"], "fields": [{"label": "Area"}, {"label": "Area"}]}}})
jt = r.json()["types"]["task"]
check("types saved + sanitised label", jt["label"] == "Job", jt)
check("bad tone → default", jt["tone"] == "accent", jt["tone"])
check("bad icon → default", jt["icon"] == "check-circle", jt["icon"])
check("statuses slugged + unique", jt["statuses"] == ["open", "done"], jt["statuses"])
check("field keys unique", [f["key"] for f in jt["fields"]] == ["area", "area_2"], jt["fields"])
c.put("/p/types", json={"types": {}})  # back to defaults
check("defaults restored", c.get("/p/types").json()["types"]["task"]["label"] == "Task")

# ---- lists
a = c.post("/p/lists", json={"title": "  Work  "}).json()["list"]
check("list created (title trimmed)", a["title"] == "Work" and a["parentId"] is None, a)
g = c.post("/p/lists", json={"title": "Backend", "parentId": a["id"]}).json()["list"]
check("group under list", g["parentId"] == a["id"], g)
b = c.post("/p/lists", json={}).json()["list"]
check("untitled default", b["title"] == "Untitled list", b)
check("missing parent → 404", c.post("/p/lists", json={"title": "x", "parentId": 9999}).status_code == 404)
check("bad parent id → 400", c.post("/p/lists", json={"title": "x", "parentId": "1"}).status_code == 400)
check("list into own group refused", c.put(f"/p/lists/{a['id']}", json={"parentId": g["id"]}).status_code == 400)
check("rename", c.put(f"/p/lists/{b['id']}", json={"title": "Home", "tone": "success"}).json()["list"]["tone"] == "success")
check("bad tone cleared", c.put(f"/p/lists/{b['id']}", json={"tone": "#ff0000"}).json()["list"]["tone"] == "")
check("three lists", len(c.get("/p/lists").json()["lists"]) == 3)

# ---- entries
r = c.post("/p/entries", json={"listId": a["id"], "kind": "note", "title": "Idea"})
check("note without body refused", r.status_code == 400 and "body" in r.json()["detail"], r.text)
r = c.post("/p/entries", json={"listId": a["id"], "kind": "note", "title": "Idea", "draft": True})
check("draft keeps going with warnings", r.status_code == 201 and r.json()["warnings"], r.text)
note = r.json()["entry"]
check("note status hidden → default", note["status"] == "open", note)
task = c.post("/p/entries", json={"listId": a["id"], "kind": "task", "title": "Ship it", "priority": "high", "tags": ["Deploy", "deploy", ""], "dueAt": 1_700_000_000_000, "fields": {"area": "server", "estimate": "3"}}).json()["entry"]
check("task fields", task["priority"] == "high" and task["tags"] == ["deploy"] and task["fields"]["estimate"] == 3, task)
check("select option checked", c.post("/p/entries", json={"listId": a["id"], "kind": "task", "title": "x", "fields": {"area": "moon"}}).status_code == 400)
check("url field checked", c.post("/p/entries", json={"listId": a["id"], "kind": "note", "title": "x", "body": "b", "fields": {"source": "javascript:alert(1)"}}).status_code == 400)
sub = c.post("/p/entries", json={"listId": a["id"], "parentId": task["id"], "kind": "task", "title": "Write tests"}).json()["entry"]
check("subtask", sub["parentId"] == task["id"], sub)
check("subtask across lists refused", c.post("/p/entries", json={"listId": b["id"], "parentId": task["id"], "title": "x"}).status_code == 400)
todo = c.post("/p/entries", json={"listId": g["id"], "kind": "todo", "title": "Check", "checklist": [{"text": "one"}, {"text": "two", "done": True}]}).json()["entry"]
check("todo checklist", [x["done"] for x in todo["checklist"]] == [False, True], todo)
check("todo without checklist refused", c.post("/p/entries", json={"listId": g["id"], "kind": "todo", "title": "x"}).status_code == 400)

u = c.put(f"/p/entries/{task['id']}", json={"status": "done"}).json()["entry"]
check("done stamps completedAt", u["status"] == "done" and u["completedAt"], u)
check("other fields kept", u["priority"] == "high" and u["tags"] == ["deploy"], u)
u = c.put(f"/p/entries/{task['id']}", json={"status": "open", "dueAt": None}).json()["entry"]
check("reopen clears completedAt + due", u["completedAt"] is None and u["dueAt"] is None, u)
check("entry under own subtask refused", c.put(f"/p/entries/{task['id']}", json={"parentId": sub["id"]}).status_code == 400)
m = c.put(f"/p/entries/{task['id']}", json={"listId": b["id"]}).json()["entry"]
check("move to another list takes subtasks", m["listId"] == b["id"] and c.get(f"/p/lists/{b['id']}/entries").json()["entries"][-1]["listId"] == b["id"], m)

inside = c.get(f"/p/lists/{a['id']}/entries").json()
check("list contents include groups", {x["id"] for x in inside["lists"]} == {a["id"], g["id"]}, inside["lists"])
check("list contents include group entries", todo["id"] in {e["id"] for e in inside["entries"]})
check("search by tag", [e["id"] for e in c.get("/p/entries", params={"q": "deploy"}).json()["entries"]] == [task["id"]])
check("search by kind", {e["kind"] for e in c.get("/p/entries", params={"kind": "todo"}).json()["entries"]} == {"todo"})

md = c.get(f"/p/lists/{b['id']}/export.md")
check("markdown export", md.status_code == 200 and "- [ ] **Ship it**" in md.text and "  - [ ] **Write tests**" in md.text, md.text)
check("export filename", 'filename="home.md"' in md.headers.get("content-disposition", ""), md.headers)

# ---- bulk
dup = c.post("/p/entries/bulk", json={"ids": [todo["id"]], "action": "duplicate"}).json()
check("duplicate", dup["count"] == 1, dup)
p = c.post("/p/entries/bulk", json={"ids": [todo["id"], dup["ids"][0]], "action": "patch", "patch": {"status": "blocked", "addTags": ["x"]}}).json()
check("patch", p["count"] == 2 and p["ok"], p)
p = c.post("/p/entries/bulk", json={"ids": [note["id"]], "action": "patch", "patch": {"kind": "todo"}}).json()
check("patch that breaks a rule reports it", not p["ok"] and p["errors"], p)
mv = c.post("/p/entries/bulk", json={"ids": [dup["ids"][0]], "action": "move", "listId": a["id"]}).json()
check("move", mv["count"] == 1, mv)
check("move under self refused", c.post("/p/entries/bulk", json={"ids": [task["id"]], "action": "move", "listId": b["id"], "parentId": sub["id"]}).status_code == 400)
check("unknown action", c.post("/p/entries/bulk", json={"ids": [todo["id"]], "action": "boom"}).status_code == 400)
check("ids required", c.post("/p/entries/bulk", json={"action": "delete"}).status_code == 400)
c.post("/p/entries/reorder", json={"ids": [dup["ids"][0], note["id"]]})
check("reorder", next(e for e in c.get(f"/p/lists/{a['id']}/entries").json()["entries"] if e["id"] == note["id"])["sortOrder"] == 2)

dl = c.delete(f"/p/entries/{task['id']}").json()
check("delete entry takes subtasks", dl["count"] == 2, dl)
dl = c.delete(f"/p/lists/{a['id']}").json()
check("delete list takes groups + entries", dl["groups"] == 1 and dl["entries"] >= 3, dl)
check("one list left", [x["id"] for x in c.get("/p/lists").json()["lists"]] == [b["id"]])

# ---- input hygiene + storage
check("non-object body", c.post("/p/lists", content=b"[1]", headers={"content-type": "application/json"}).status_code == 400)
check("bad json", c.post("/p/lists", content=b"{", headers={"content-type": "application/json"}).status_code == 400)
check("too large", c.post("/p/lists", content=b'{"title":"' + b"x" * 300_000 + b'"}', headers={"content-type": "application/json"}).status_code == 413)
check("404 entry", c.put("/p/entries/99999", json={"title": "x"}).status_code == 404)
f = Path(DATA) / "store.json"
check("store file 0600", f.exists() and stat.S_IMODE(f.stat().st_mode) == 0o600, oct(f.stat().st_mode) if f.exists() else "missing")
check("store format", json.loads(f.read_text())["$axf"] == "todo-store@1")
# a fresh store reads the same file back
fresh = mod.Store(f)
check("reload from disk", [x["id"] for x in fresh.lists()] == [b["id"]])

print(f"todo-manager: {ok} passed, {len(fails)} failed")
for x in fails:
    print("  ✗", x)
sys.exit(1 if fails else 0)
