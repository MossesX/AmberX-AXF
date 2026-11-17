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

# ---- projects (projects@1): a new project gets its own, empty store; switching back finds everything
base_lists = [x["id"] for x in c.get("/p/lists").json()["lists"]]
cx.set_context(project_dir=lambda p: Path(p) / "projects" / "garden")
check("new project: no lists", c.get("/p/lists").json()["lists"] == [])
check("new project: own list", c.post("/p/lists", json={"title": "Seeds"}).status_code == 201)
check("new project: own file", (Path(DATA) / "projects" / "garden" / "store.json").exists())
cx.set_context(project_dir=lambda p: Path(p))
check("back to AmberX AXF: same lists", [x["id"] for x in c.get("/p/lists").json()["lists"]] == base_lists)
check("back to AmberX AXF: other project's list not here", all(x["title"] != "Seeds" for x in c.get("/p/lists").json()["lists"]))

# ---- by name + voice (server/voice.py, voice.json): what MCP, the CLI and AmberX use
V = mod.hear
r = V("Make a new list called New build and a note called Build.")
check("voice: Brett's phrase → list + note", r and r["ok"] and r["command"] == "list-and-entry", r)
nb = next((x for x in c.get("/p/lists").json()["lists"] if x["title"] == "New build"), None)
check("voice: list keeps the case said", nb is not None, [x["title"] for x in c.get("/p/lists").json()["lists"]])
es = c.get(f"/p/lists/{nb['id']}/entries").json()["entries"] if nb else []
check("voice: note Build inside New build", [(e["kind"], e["title"]) for e in es] == [("note", "Build")], es)
r = V("make a list called new build")
check("voice: same name twice → no duplicate", r["ok"] and r["created"] is False, r)
check("voice: add a to-do", V("add a to-do called Fix tests to new build")["entry"]["kind"] == "todo")
check("voice: add a task", V("Amber, add a task called Ship it to New build")["entry"]["title"] == "Ship it")
check("voice: what's in", "3 items" in V("what's in new build")["say"], V("what's in new build"))
check("voice: mark done", V("mark ship it as done")["entry"]["status"] == "done")
check("voice: not done", V("mark ship it not done")["entry"]["status"] == "open")
check("voice: priority", V("set ship it priority to high")["entry"]["priority"] == "high")
c.post("/p/by-name/list-create", json={"title": "Later"})
check("voice: move entry", V("move ship it to later")["list"]["title"] == "Later")
check("voice: rename list", V("rename the list later to Someday")["list"]["title"] == "Someday")
check("voice: list position", V("move the list someday to position 1")["position"] == 1)
check("voice: find", V("find tasks about ship")["entries"][0]["title"] == "Ship it")
check("voice: export", V("export the list new build")["markdown"].count("Build") >= 1)
r = V("delete ship it")
check("voice: delete asks first", r["ok"] is False and r["code"] == "confirmation_required", r)
check("voice: delete with confirm", V("delete ship it confirm")["ok"] is True)
r = V("add a note called X to nowhere at all")
check("voice: unknown list said plainly", r["ok"] is False and r["code"] == "not_found" and "nowhere" in r["say"], r)
c.post("/p/by-name/list-create", json={"title": "Build log"})
c.post("/p/by-name/list-create", json={"title": "Build notes"})
r = V("add a note called Y to build")
check("voice: ambiguous name refused, candidates named", r["code"] == "ambiguous" and "Build log" in r["say"], r)
check("voice: not ours → None", V("open settings") is None)
check("voice route", c.post("/p/voice", json={"text": "read my lists"}).json()["say"].startswith("5 lists"))
check("voice route: unknown phrase", c.post("/p/voice", json={"text": "sing a song"}).json()["code"] == "invalid")
r = c.post("/p/by-name/entry-add", json={"list": "Someday", "title": "Water plants", "kind": "task"})
check("by-name entry-add (REST/MCP/CLI)", r.status_code == 201 and r.json()["entry"]["title"] == "Water plants", r.text)
check("by-name list-delete needs confirm", c.post("/p/by-name/list-delete", json={"list": "Someday"}).status_code == 409)
r = c.post("/p/by-name/list-delete", json={"list": "Someday", "confirm": True})
check("by-name list-delete", r.json().get("deleted", {}).get("entries") == 1, r.text)
check("by-name find", c.get("/p/by-name/find", params={"q": "fix"}).json()["entries"][0]["list"] == "New build")
check("by-name 404 plain", c.post("/p/by-name/entry-complete", json={"entry": "nope"}).status_code == 404)
import plugin_services as _ps  # noqa: E402
check("voice service registered", any(n == "axf.voice-phrases@1:todo-manager" for n, _ in _ps.get_all("axf.voice-phrases@1:")))

# ---- two lists with one name (the live store on Nov 16: Brett made "New build" twice in the UI)
c.post("/p/lists", json={"title": "Twin"}); c.post("/p/lists", json={"title": "Twin"})
r = V("what's in twin")
check("same name twice: refused, says so plainly", r["code"] == "ambiguous" and "2 lists are called Twin" in r["say"], r)
r = V("make a list called twin and a note called Inside")
check("compound phrase with duplicate names: uses the newest, says so", r["ok"] and r["created"] is False and "2 lists have that name" in r["say"], r)

# ---- the console's voice endpoint hands Todo manager phrases over (console_control_api.plugin_voice)
try:
    import console_control_api as _cca  # noqa: E402
except Exception as _e:  # noqa: BLE001 — the console server's modules need its context; skip with why
    print(f"  (console voice hand-over not checked here: {_e})")
else:
    r = _cca.plugin_voice("add a note called Hand over to new build")
    check("console voice → todo-manager", r and r["ok"] and r["plugin"] == "todo-manager" and r["entry"]["title"] == "Hand over", r)
    check("console voice: not ours → None", _cca.plugin_voice("scroll down") is None)

print(f"todo-manager: {ok} passed, {len(fails)} failed")
for x in fails:
    print("  ✗", x)
sys.exit(1 if fails else 0)
