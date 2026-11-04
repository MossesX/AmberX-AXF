"""Build to-do sync server part: names, sync through a fake control@1 (an in-memory to-do manager + orchestrator), live
check-off, owner-only asks, settings, the off note, events, health.

    python apps/console-web/plugins/build-todo-sync/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services, console_context
DATA = tempfile.mkdtemp()
os.environ["AXF_BUILD_TODO_SYNC_DATA_DIR"] = DATA
os.environ["AXF_BUILD_TODO_SYNC_NO_CLOCK"] = "1"
STORE = Path(tempfile.mkdtemp()) / "store.json"
os.environ["AXF_BUILDS_STORE"] = str(STORE)
os.environ["AXF_BUILD_PROFILE"] = "main-framework"
os.environ["AXF_BUILDS_EXPORT"] = "0"
os.environ["AXF_BUILDS_LIVE"] = "0"
os.environ["AXF_BUILDS_NOTIFY"] = "0"
os.environ["AXF_CONSOLE_ROOT"] = "off"

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

ORCH = ROOT / "apps" / "console-web" / "plugins" / "build-orchestrator" / "orchestrator.mjs"
checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def orch(*args: str) -> dict:
    p = subprocess.run(["node", str(ORCH), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = p.stdout.strip().splitlines()
    return json.loads(out[-1]) if out else {"ok": False, "error": p.stderr}


# ---------------------------------------------------------------- a fake control@1: the AmberX to-do manager in memory + the orchestrator CLI
class FakeControl:
    def __init__(self) -> None:
        self.lists: dict[str, dict] = {}
        self.items: dict[str, dict] = {}
        self.seq = 0
        self.calls: list[dict] = []

    def _id(self, p: str) -> str:
        self.seq += 1
        return f"{p}{self.seq}"

    def run(self, c: dict, grants=None, by: str = "") -> dict:
        self.calls.append(c)
        t, op = c.get("target"), c.get("op")
        if t == "planner.builds":
            if op == "act":
                i = c.get("input") or {}
                if c["action"] == "step":
                    r = orch("act", json.dumps({"action": "step", "id": c["path"], "step": i["step"], "done": i.get("done", True)}))
                elif c["action"] in ("name", "fix-add", "fix-set", "fix-remove"):
                    r = orch("act", json.dumps({"action": c["action"], "id": c["path"], **i}))
                else:
                    return {"ok": False, "code": "invalid", "message": f"no action {c['action']}"}
                return {"ok": r.get("ok", False), "data": {"item": r.get("build")}, "message": r.get("error", "")}
            return {"ok": False, "code": "invalid", "message": "not in the fake"}
        if t == "amberx.lists":
            if op == "list":
                rows = list(self.lists.values())
                return {"ok": True, "data": {"items": rows, "total": len(rows)}}
            if op == "get":
                return {"ok": True, "data": {"item": self.lists[c["path"]]}} if c["path"] in self.lists else {"ok": False, "code": "not_found", "message": "no list"}
            if op == "add":
                v = c["value"]
                l = {"id": self._id("l"), "name": v["name"], "parent": v.get("parent"), "order": 0}
                self.lists[l["id"]] = l
                return {"ok": True, "data": {"item": l}}
            if op == "set":
                self.lists[c["path"]].update(c["value"])
                return {"ok": True, "data": {"item": self.lists[c["path"]]}}
            if op == "remove":
                self.lists.pop(c["path"], None)
                return {"ok": True, "data": {"removed": 1}}
        if t == "amberx.items":
            if op == "list":
                sel = c.get("select") or {}
                rows = [i for i in self.items.values() if not sel.get("list") or i["list"] == sel["list"]]
                return {"ok": True, "data": {"items": rows, "total": len(rows)}}
            if op == "add":
                v = c["value"]
                it = {"status": "open", "tags": [], "order": 0, "url": "", "text": "", "updatedAt": "2026-11-04T18:00:00Z", "doneAt": "", **v, "id": self._id("i")}
                self.items[it["id"]] = it
                return {"ok": True, "data": {"item": it}}
            if op == "set":
                it = self.items[c["path"]]
                it.update(c["value"])
                it["updatedAt"] = "2026-11-04T18:00:00Z"
                return {"ok": True, "data": {"item": it}}
            if op == "remove":
                self.items.pop(c["path"], None)
                return {"ok": True, "data": {"removed": 1}}
        return {"ok": False, "code": "invalid", "message": f"fake has no {op} {t}"}


fake = FakeControl()
plugin_services.provide("control@1", fake, folder="token-control")


class FakeHealth:
    def __init__(self) -> None:
        self.specs: list[dict] = []

    def register(self, spec: dict, owner: str = "") -> str:
        self.specs.append(spec)
        return spec["id"]


health = FakeHealth()
plugin_services.provide("axf.health@1", health, folder="systems-check")


class FakePlans:
    """plans@1 in memory: list / get / save (a saved plan is kept as given)."""

    def __init__(self) -> None:
        self.plans: dict[str, dict] = {}
        self.saves = 0

    def list(self) -> list[dict]:
        return list(self.plans.values())

    def get(self, pid: str) -> dict | None:
        return self.plans.get(pid)

    def save(self, plan: dict, by: str = "", force: bool = False) -> dict:
        self.saves += 1
        self.plans[plan["id"]] = plan
        return {"ok": True, "plan": plan}


plans = FakePlans()
plugin_services.provide("plans@1", plans, folder="plan-studio")
cx.set_context(current_token=lambda: "tok")

# ---------------------------------------------------------------- a small store through the real orchestrator
r = orch("act", json.dumps({"action": "add", "title": "Live sessions plugin: tabs + Molly", "steps": [{"text": "contract", "model": "Fable", "estimate": "20 min"}, {"text": "server", "model": "Opus", "estimate": "20 min"}, {"text": "ui", "model": "Opus", "estimate": "20 min"}], "source": "console"}))
ok(r["ok"], f"orchestrator add: {r}")
BID = r["build"]["id"]
ok(r["build"]["displayName"] == "Live sessions plugin" and r["build"]["category"] == "Plugin" and r["build"]["nameReview"] is True, "the build gets a suggested name and category, flagged for review")
ok(any("name it" in l for l in r["log"]), "the orchestrator asks for the name")

spec = importlib.util.spec_from_file_location("bts_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)  # type: ignore[union-attr]

app = FastAPI()
ROLE: dict[str, object] = {"user": None}


class User:
    def __init__(self, via: str, admin: bool, name: str = "brett") -> None:
        self.via, self.admin, self.name = via, admin, name


@app.middleware("http")
async def who(request: Request, call_next):
    request.state.axf_user = ROLE["user"]
    return await call_next(request)

app.include_router(srv.router, prefix="/api/plugins/build-todo-sync")
c = TestClient(app)
P = "/api/plugins/build-todo-sync"

# ---------------------------------------------------------------- names
s = c.get(f"{P}/state").json()
ok(s["ok"] and s["enabled"] is True and s["control"] is True, "state: on, control@1 reachable")
n = c.get(f"{P}/names").json()
ok(any(b["id"] == BID for b in n["builds"]) and n["categories"][0] == "Plugin", "names lists the build awaiting its name")
sg = c.get(f"{P}/suggest", params={"title": "Follow Amber plugin extension: approvals pop-up"}).json()
ok(sg["displayName"] == "Follow Amber plugin extension" and sg["category"] == "Plugin extension", f"suggest: {sg}")
ok(c.get(f"{P}/suggest").status_code == 400, "suggest needs a title")
r = c.post(f"{P}/name", json={"id": BID, "displayName": "Live sessions", "category": "plugin"}).json()
ok(r["ok"] and r["build"]["displayName"] == "Live sessions" and r["build"]["category"] == "Plugin" and r["build"]["nameReview"] is False, f"named through control@1 planner.builds: {r}")
ok(c.post(f"{P}/name", json={"id": BID, "category": "Console"}).status_code == 400, "a bad category is refused")
ok(not any(b["id"] == BID for b in c.get(f"{P}/names").json()["builds"]), "a named build leaves the list")

# ---------------------------------------------------------------- first sync = backfill
r = c.post(f"{P}/sync", json={"dry": True}).json()
ok(r["ok"] and r["ops"] >= 5 and not fake.items, "dry run plans without writing")
r = c.post(f"{P}/sync", json={}).json()
ok(r["ok"] and r["errors"] == [], f"sync ran: {r}")
names = {l["name"]: l for l in fake.lists.values()}
ok({"Builds", "Plugin", "Live sessions"} <= set(names), f"Builds › Plugin › Live sessions lists exist: {sorted(names)}")
ok(names["Live sessions"]["parent"] == names["Plugin"]["id"] and names["Plugin"]["parent"] == names["Builds"]["id"], "nested the right way")
in_list = sorted((i for i in fake.items.values() if i["list"] == names["Live sessions"]["id"]), key=lambda i: i["order"])
ok([i["title"] for i in in_list] == ["1. contract", "2. server", "3. ui"], f"one item per step in order: {[i['title'] for i in in_list]}")
ok(all(i["status"] == "open" for i in in_list) and "fable" in in_list[0]["tags"] and "Model: Fable" in in_list[0]["text"], "items carry model and state")
note = next((i for i in fake.items.values() if i.get("kind") == "note"), None)
ok(note is not None and note["list"] == names["Builds"]["id"] and "Synced by Build to-do sync" in note["title"], "the sync note sits on the Builds list")
links = json.loads((Path(DATA) / "links.json").read_text())
ok(links["lists"][f"build:{BID}"] == names["Live sessions"]["id"] and len(links["items"]) == 4, "links remember list and item ids")
calls_before = len(fake.calls)
r = c.post(f"{P}/sync", json={}).json()
ok(r["ok"] and r["summary"]["ops"] <= 1, f"a second sync changes nothing but the note time: {r['summary']}")

# ---------------------------------------------------------------- live check-off: a step done in the store ticks its item
r = orch("act", "step", BID, "s1")
ok(r["ok"], "step s1 done in the orchestrator")
ev = c.post(f"{P}/events", json={"$axf": "build-todo-sync@1", "kind": "store-write", "rev": 3, "at": "2026-11-04T18:01:00Z", "by": "orchestrator", "action": "orchestrator:step", "builds": [{"id": BID, "op": "change"}]}).json()
ok(ev["ok"] and ev["queued"] and ev["builds"] == [BID], "a store event is taken")
ok(c.post(f"{P}/events", json={"nope": 1}).status_code == 400, "a non-frame is refused")
srv._run_pending()  # what the debounce timer does
in_list = sorted((i for i in fake.items.values() if i["list"] == names["Live sessions"]["id"]), key=lambda i: i["order"])
ok(in_list[0]["status"] == "done" and in_list[1]["status"] in ("open", "doing") and in_list[2]["status"] == "open", f"item 1 ticked after the event, item 2 is next: {[i['status'] for i in in_list]}")

# ---------------------------------------------------------------- Brett ticks an item in the to-do manager → an ask, owner only
in_list[1]["status"] = "done"
in_list[1]["updatedAt"] = "2026-11-04T19:00:00Z"
in_list[1]["doneAt"] = in_list[1]["updatedAt"]
r = c.post(f"{P}/sync", json={}).json()
asks = c.get(f"{P}/asks").json()["asks"]
ok(len(asks) == 1 and asks[0]["kind"] == "ticked" and asks[0]["stepId"] == "s2" and asks[0]["state"] == "open", f"an ask opened: {asks}")
ok(in_list[1]["status"] == "done", "the item keeps Brett's tick while the ask is open")
ok(c.post(f"{P}/asks/{asks[0]['id']}", json={"decision": "approve"}).status_code == 403, "a token caller can't answer an ask")
ROLE["user"] = User("token", True)
ok(c.post(f"{P}/asks/{asks[0]['id']}", json={"decision": "approve"}).status_code == 403, "an admin bearer token is not Brett's click")
ROLE["user"] = User("session", True)
r = c.post(f"{P}/asks/{asks[0]['id']}", json={"decision": "approve"}).json()
ok(r["ok"] and r["ask"]["state"] == "approved" and r["ask"]["by"] == "brett", f"Brett's own session approves: {r}")
st = orch("list")["state"]
b = next(x for x in st["builds"] if x["id"] == BID)
ok(b["steps"][1]["done"] is True, "approving ticked the step in the store")
ok(c.post(f"{P}/asks/{asks[0]['id']}", json={"decision": "deny"}).status_code == 409, "an answered ask stays answered")
# deny puts the item back
in_list[2]["status"] = "done"
in_list[2]["updatedAt"] = "2026-11-04T19:30:00Z"
c.post(f"{P}/sync", json={})
a2 = c.get(f"{P}/asks").json()["asks"]
ok(len(a2) == 1 and a2[0]["stepId"] == "s3", "a second ask for s3")
r = c.post(f"{P}/asks/{a2[0]['id']}", json={"decision": "deny"}).json()
ok(r["ok"] and r["ask"]["state"] == "denied" and fake.items[in_list[2]["id"]]["status"] == "open", "deny puts the item back to open")
ROLE["user"] = None

# ---------------------------------------------------------------- Planned & fixes: a fix becomes an item; ticking it in the to-do manager applies
r = orch("act", json.dumps({"action": "fix-add", "id": BID, "text": "Tabs forget their size", "kind": "bug", "by": "Brett"}))
ok(r["ok"] and r["build"]["fixes"][0]["id"] == "f1", f"fix added: {r.get('error')}")
c.post(f"{P}/sync", json={})
fix_item = next((i for i in fake.items.values() if i.get("title") == "Bug: Tabs forget their size"), None)
ok(fix_item is not None and fix_item["order"] == 1000 and "fixes" in fix_item["tags"], "the fix is an item after the steps")

# ---------------------------------------------------------------- the API for fixes, notes, docs, plan and list (addenda 2–4)
r = c.post(f"{P}/builds/{BID}/fixes", json={"text": "Voice command for sync", "kind": "planned"}).json()
ok(r["ok"] and len(r["build"]["fixes"]) == 2 and r["build"]["fixes"][1]["kind"] == "planned", f"fix added through the API: {r}")
ok(c.post(f"{P}/builds/{BID}/fixes", json={"text": "  "}).status_code == 400, "a fix needs text")
r = c.put(f"{P}/builds/{BID}/fixes/f1", json={"done": True}).json()
ok(r["ok"] and r["build"]["fixes"][0]["done"] is True, "fix checked off through the API")
v = c.get(f"{P}/builds/{BID}").json()
ok(v["ok"] and v["build"]["displayName"] == "Live sessions" and len(v["build"]["steps"]) == 3 and len(v["build"]["fixes"]) == 2 and v["listId"] == names["Live sessions"]["id"], f"build view: {v['build']['displayName']}")
ok(c.get(f"{P}/builds/nope").status_code == 404, "unknown build = 404")
lst = c.get(f"{P}/builds/{BID}/list").json()
ok(lst["ok"] and lst["list"]["name"] == "Live sessions" and [i["title"] for i in lst["items"]][:3] == ["1. contract", "2. server", "3. ui"], "the build's to-do list as the manager holds it")
d = c.get(f"{P}/builds/{BID}/docs").json()
ok(d["ok"] and any(x["path"].endswith(f"plugins/{BID}/README.md") and x["status"] == "none" for x in d["docs"]) and any(x["path"] == f"_claude/builds/reports/{BID}.md" for x in d["docs"]), f"docs expected for a plugin build: {d['docs']}")
ok(d["status"] == "none", "no docs yet = none")
r = c.post(f"{P}/builds/{BID}/note", json={"said": "Also make the tabs remember their size.", "source": "voice"}).json()
ok(r["ok"], f"an addendum through the API: {r}")
ok(c.post(f"{P}/builds/{BID}/note", json={"said": ""}).status_code == 400, "a note needs his words")
r = c.post(f"{P}/plans/sync", json={}).json()
ok(r["ok"] and r["saved"] >= 1 and BID in r["plans"], f"plans synced: {r}")
pl = c.get(f"{P}/builds/{BID}/plan").json()["plan"]
ok(pl and pl["id"] == f"build-{BID}" and pl["title"] == "Live sessions" and pl["category"] == "Builds > Plugin" and pl["status"] == "building", f"the plan mirrors the build: {pl and {k: pl[k] for k in ('id', 'title', 'category', 'status')}}")
ok([s["text"] for s in pl["steps"]] == ["contract", "server", "ui"] and pl["steps"][0]["done"] is True, "plan steps = build steps")
ok("## Planned & fixes" in pl["body"] and "- [x] **bug:** Tabs forget their size" in pl["body"] and "## Docs" in pl["body"] and "<!-- build-todo-sync:start -->" in pl["body"], "the managed block lists fixes and docs")
ok(any(cm["text"] == "Also make the tabs remember their size." for cm in pl["comments"]), "the addendum became a plan comment, verbatim")
ok(pl["build"]["id"] == BID and pl["docsStatus"] == "none" and len(pl["fixes"]) == 2, "plan carries build link, fixes and docs status")
pl["body"] = "Brett's own notes stay.\n\n" + pl["body"]
plans.plans[pl["id"]] = pl
saves = plans.saves
c.post(f"{P}/plans/sync", json={})
ok(plans.saves == saves, "a second plans sync with nothing new saves nothing")
r = c.delete(f"{P}/builds/{BID}/fixes/f2").json()
ok(r["ok"] and len(r["build"]["fixes"]) == 1, "fix removed through the API")
c.post(f"{P}/plans/sync", json={})
pl2 = plans.plans[pl["id"]]
ok(pl2["body"].startswith("Brett's own notes stay.") and "Voice command for sync" not in pl2["body"], "the plan's own text is kept; the managed block follows the build")

# ---------------------------------------------------------------- off: the note says so and nothing else moves
r = c.put(f"{P}/settings", json={"on": False}).json()
ok(r["ok"] and r["settings"]["on"] is False, "switched off")
orch("act", "step", BID, "s3")
r = c.post(f"{P}/sync", json={}).json()
ok(r["ok"] and r["enabled"] is False, "sync while off only touches the note")
in_list = sorted((i for i in fake.items.values() if i["list"] == names["Live sessions"]["id"]), key=lambda i: i["order"])
ok(in_list[2]["status"] != "done", f"the step ticked while off did not reach the list: {in_list[2]['status']}")
note = next(i for i in fake.items.values() if i.get("kind") == "note")
ok("OFF" in note["title"], f"the note says the sync is off: {note['title']}")
c.put(f"{P}/settings", json={"on": True})
r = c.post(f"{P}/sync", json={}).json()
in_list = sorted((i for i in fake.items.values() if i["list"] == names["Live sessions"]["id"]), key=lambda i: i["order"])
ok(in_list[2]["status"] == "done", "back on: the list catches up")
note = next(i for i in fake.items.values() if i.get("kind") == "note")
ok("Synced by" in note["title"], "the note is back to synced")

# ---------------------------------------------------------------- done builds move to Done; health
orch("act", "status", BID, "complete")
c.post(f"{P}/sync", json={})
names = {l["name"]: l for l in fake.lists.values()}
ok("Done" in names and names["Live sessions"]["parent"] == names["Done"]["id"], "a complete build's list moves under Done")
ok(health.specs and health.specs[0]["id"] == "build-todo-sync" and callable(health.specs[0]["autoFix"]["run"]), "the health row is registered with Auto fix")
h = srv.health_probe()
ok(h["status"] == "ok", f"health ok after a sync: {h}")
c.put(f"{P}/settings", json={"on": False})
ok(srv.health_probe()["status"] == "warning", "health warns while off")
c.put(f"{P}/settings", json={"on": True})
ok(c.get(f"{P}/settings").json()["settings"]["completedDays"] == 7, "settings answer with defaults")
ok(c.put(f"{P}/settings", json={"completedDays": 400}).json()["settings"]["completedDays"] == 90, "settings are clamped")

# ---------------------------------------------------------------- capability
cap = plugin_services.get("build-todo-sync@1")
ok(cap is not None and cap.state()["ok"] and cap.sync("test", dry=True)["ok"], "build-todo-sync@1 capability: state + sync")

print(f"build-todo-sync server: {checks} checks passed")
