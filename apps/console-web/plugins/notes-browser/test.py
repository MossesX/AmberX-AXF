#!/usr/bin/env python3
"""Self-test for the Notes browser plugin (scratch hub tree, routes through FastAPI's test client).

Covers: the hub's memory-dir semantics (meta.json attribution, kept versions on replace and delete, version = sha256[:16]
matching axHub's memoryVersion); list with folders, titles and search snippets; create-only ("" if_version), conflict
-safe save (409 on a stale version), rename and move between folders (old path deleted with history kept), delete,
folders (create, refuse non-empty removal); path safety (.., absolute, links, wrong extension, hidden); the
axf.notes@1 capability; and "not mounted" answers.

    python3 apps/console-web/plugins/notes-browser/test.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-notes-browser-test-"))
HUB = TMP / "projects"
(HUB / "_shared" / "_claude" / "notes" / "plans").mkdir(parents=True)
os.environ["AXHUB_PROJECTS_DIR"] = str(HUB)

sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

spec = importlib.util.spec_from_file_location("notes_browser_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["notes_browser_server"] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
fails = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global fails
    print(f"{'ok  ' if ok else 'FAIL'} {name}{'' if ok else f'  -> {detail}'}")
    fails += 0 if ok else 1


state = HUB / ".axhub" / "claude" / "shared"
meta = lambda: json.loads((state / "meta.json").read_text())  # noqa: E731
kept = lambda p: json.loads((state / "versions" / f"{quote('notes/' + p, safe='')}.json").read_text())  # noqa: E731
ver = lambda s: hashlib.sha256(s.encode()).hexdigest()[:16]  # noqa: E731

# create-only, attribution
r = c.put("/note", json={"path": "plans/first.md", "content": "# First plan\n\nhello world\n", "if_version": ""})
check("create note", r.status_code == 200 and r.json()["version"] == ver("# First plan\n\nhello world\n"), r.text)
check("meta attribution", meta().get("notes/plans/first.md", {}).get("updatedBy") == "console:notes-browser", meta())
r = c.put("/note", json={"path": "plans/first.md", "content": "again", "if_version": ""})
check("create refuses an existing note (409)", r.status_code == 409, r.text)

# list + search
c.put("/note", json={"path": "install/vps.md", "content": "# VPS install\n\nRun the installer with sudo.\n"})
lst = c.get("/notes").json()
check("list folders", lst["folders"] == ["install", "plans"], lst["folders"])
check("list titles", {n["path"]: n["title"] for n in lst["notes"]} == {"install/vps.md": "VPS install", "plans/first.md": "First plan"}, lst["notes"])
s = c.get("/notes", params={"q": "installer sudo"}).json()["notes"]
check("search every word + snippet", [n["path"] for n in s] == ["install/vps.md"] and "installer" in s[0]["snippet"], s)
check("list without content by default", all("content" not in n for n in lst["notes"]), lst["notes"])
withc = {n["path"]: n.get("content") for n in c.get("/notes", params={"content": "1"}).json()["notes"]}
check("content=1 adds each note's text (Grid view)", withc.get("install/vps.md") == "# VPS install\n\nRun the installer with sudo.\n", withc)

# conflict-safe save
doc = c.get("/note", params={"path": "plans/first.md"}).json()
r = c.put("/note", json={"path": "plans/first.md", "content": "# First plan\n\nedited\n", "if_version": doc["version"]})
check("save with the current version", r.status_code == 200, r.text)
r = c.put("/note", json={"path": "plans/first.md", "content": "# stale\n", "if_version": doc["version"]})
check("stale save is refused (409)", r.status_code == 409 and "changed since you opened it" in r.json()["detail"], r.text)
check("replaced text kept as a version", kept("plans/first.md")[0]["content"] == "# First plan\n\nhello world\n" and kept("plans/first.md")[0]["reason"] == "write", kept("plans/first.md"))

# rename / move
cur = c.get("/note", params={"path": "plans/first.md"}).json()
r = c.post("/move", json={"from": "plans/first.md", "to": "misc/renamed.md", "if_version": cur["version"]})
check("move to a new folder", r.status_code == 200 and (HUB / "_shared/_claude/notes/misc/renamed.md").read_text() == "# First plan\n\nedited\n", r.text)
check("old path gone, history kept as delete", not (HUB / "_shared/_claude/notes/plans/first.md").exists() and kept("plans/first.md")[0]["reason"] == "delete" and "notes/plans/first.md" not in meta(), kept("plans/first.md")[0])
r = c.post("/move", json={"from": "misc/renamed.md", "to": "install/vps.md"})
check("move onto an existing note is refused", r.status_code == 409, r.text)

# delete
cur = c.get("/note", params={"path": "misc/renamed.md"}).json()
r = c.delete("/note", params={"path": "misc/renamed.md", "if_version": "0000000000000000"})
check("delete with a stale version is refused", r.status_code == 409, r.text)
r = c.delete("/note", params={"path": "misc/renamed.md", "if_version": cur["version"]})
check("delete", r.status_code == 200 and r.json()["deleted"] and kept("misc/renamed.md")[0]["reason"] == "delete", r.text)
check("history route", [v["reason"] for v in c.get("/history", params={"path": "misc/renamed.md"}).json()["versions"]] == ["delete"])

# folders
check("new folder", c.post("/folder", json={"name": "recipes"}).json()["folder"] == "recipes" and (HUB / "_shared/_claude/notes/recipes").is_dir())
check("non-empty folder isn't removed", c.delete("/folder", params={"name": "install"}).status_code == 409)
check("empty folder removed", c.delete("/folder", params={"name": "recipes"}).json()["deleted"] is True)

# path safety
outside = TMP / "outside"
outside.mkdir()
os.symlink(outside, HUB / "_shared/_claude/notes/linked")
bad = ["../x.md", "/etc/passwd.md", "plans/../../x.md", "a/b/c.md", ".hidden.md", "plans/x.sh", "plans/.x.md", "linked/x.md", ""]
codes = {p: c.put("/note", json={"path": p, "content": "x"}).status_code for p in bad}
check("bad paths refused", all(v == 400 for v in codes.values()), codes)
check("nothing written through the link", not any(outside.iterdir()))
check("link folder not listed", "linked" not in c.get("/notes").json()["folders"])
check("notes/ prefix accepted", c.get("/note", params={"path": "notes/install/vps.md"}).status_code == 200)
check("too big refused", c.put("/note", json={"path": "plans/big.md", "content": "x" * (512 * 1024 + 1)}).status_code == 413)

# capability
svc = plugin_services.get("axf.notes@1")
check("axf.notes@1 provided", svc is not None and svc.available() and svc.root.endswith("_shared/_claude/notes"))
info = svc.write("misc/from-service.md", "# From MD Studio\n", "", by="console:md-studio")
check("capability write with its own attribution", meta()["notes/misc/from-service.md"]["updatedBy"] == "console:md-studio" and svc.read("misc/from-service.md")["version"] == info["version"])

# AmberX notes through control@1 (a fake capability records what it was sent)
check("amberx: no control@1 = unavailable, not an error", c.get("/amberx").json()["available"] is False)
sent: list[tuple[dict, list]] = []


class FakeControl:
    def run(self, command, grants=None, by=""):
        sent.append((command, grants))
        op, target = command.get("op"), command.get("target")
        if op == "list" and target == "amberx.items":
            return {"$axf": "control@1", "ok": True, "op": "list", "items": [{"id": "n-1", "kind": "note", "title": "Features", "text": "JUST MERGED\n- a"}], "total": 1}
        if op == "list" and target == "amberx.lists":
            return {"$axf": "control@1", "ok": True, "op": "list", "items": [{"id": "inbox", "name": "Inbox", "path": "Inbox"}], "total": 1}
        if op == "get" or command.get("path") == "missing":
            return {"$axf": "control@1", "ok": False, "code": "not_found", "message": "no AmberX item missing"}
        if op == "remove" and not command.get("confirm"):
            return {"$axf": "control@1", "ok": False, "code": "confirmation_required", "message": "confirm", "confirm": "tok-1"}
        if op == "remove":
            return {"$axf": "control@1", "ok": True, "removed": 1}
        return {"$axf": "control@1", "ok": True, "changed": True, "item": {"id": command.get("path")}}


plugin_services.provide("control@1", FakeControl(), "token-control")
a = c.get("/amberx", params={"q": "merged"}).json()
check("amberx: notes + lists", a["available"] and a["items"][0]["id"] == "n-1" and a["lists"] == [{"id": "inbox", "name": "Inbox", "path": "Inbox"}], a)
check("amberx: asks for notes matching q", sent[0][0]["select"] == {"limit": 500, "q": "merged", "kind": "note"} and sent[0][1] == ["*"], sent[0])
c.get("/amberx", params={"kind": "all"})
check("amberx: kind=all drops the kind filter", "kind" not in sent[-2][0]["select"], sent[-2])
r = c.put("/amberx/item", params={"id": "n-1"}, json={"text": "new text", "status": "done"})
check("amberx: save sends only title/text", r.status_code == 200 and sent[-1][0]["value"] == {"text": "new text"} and sent[-1][0]["op"] == "set", sent[-1])
check("amberx: save with nothing is refused", c.put("/amberx/item", params={"id": "n-1"}, json={}).status_code == 400)
r = c.post("/amberx/act", params={"id": "n-1", "action": "move"}, json={"input": {"list": "inbox"}})
check("amberx: move", r.status_code == 200 and sent[-1][0]["action"] == "move" and sent[-1][0]["input"] == {"list": "inbox"}, sent[-1])
check("amberx: unknown action refused", c.post("/amberx/act", params={"id": "n-1", "action": "merge"}, json={}).status_code == 400)
check("amberx: not found = 404", c.post("/amberx/act", params={"id": "missing", "action": "pin"}, json={"input": {"on": True}}).status_code == 404)
first = c.delete("/amberx/item", params={"id": "n-1"}).json()
check("amberx: delete answers a confirm token first", first == {"removed": 0, "confirm": "tok-1"}, first)
second = c.delete("/amberx/item", params={"id": "n-1", "confirm": "tok-1"}).json()
check("amberx: delete with the token", second == {"removed": 1} and sent[-1][0]["confirm"] == "tok-1", second)

# not mounted
mod.STORE.root = TMP / "nowhere"
r = c.get("/notes").json()
check("not mounted: list says so", r["available"] is False and r["notes"] == [], r)
check("not mounted: read answers 503", c.get("/note", params={"path": "plans/a.md"}).status_code == 503)

shutil.rmtree(TMP, ignore_errors=True)
print(f"\n{'all passed' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
