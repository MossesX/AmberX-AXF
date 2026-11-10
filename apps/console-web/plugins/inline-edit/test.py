"""Inline edit server part: every REST route answers what the engine answers (the same runner the plugin commands, the
CLI and voice reach). Switch, tokens, set / unset, the dialog state, the overrides list, tabs, search, filters, roots and
single-item reset, against a temporary look document and data folder.

    python apps/console-web/plugins/inline-edit/test.py
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
TMP = Path(tempfile.mkdtemp())
os.environ["AXF_APPEARANCE_FILE"] = str(TMP / "appearance.json")
os.environ["AXF_INLINE_EDIT_DATA_DIR"] = str(TMP / "data")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("inline_edit_server", HERE / "server" / "__init__.py")
assert spec and spec.loader
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/inline-edit")
c = TestClient(app)
B = "/api/plugins/inline-edit"
checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def engine(op: str, data: dict | None = None) -> dict:
    """The same operation straight through the Node runner (what plugin commands / CLI / voice end up running)."""
    p = subprocess.run(["node", str(HERE / "engine.mjs"), "run"], input=json.dumps({"op": op, "input": data or {}, "user": "brett", "by": "brett"}), capture_output=True, text=True, check=True)
    return json.loads(p.stdout.strip().splitlines()[-1])


# ---- master switch
r = c.get(f"{B}/mode")
ok(r.status_code == 200 and r.json()["on"] is False, "mode starts off")
r = c.put(f"{B}/mode", json={"state": "on"})
ok(r.status_code == 200 and r.json()["on"] is True and r.json()["changed"] is True, "PUT mode on")
ok(engine("mode.get")["data"]["on"] is True, "engine sees the switch REST set")
r = c.put(f"{B}/mode", json={"state": "toggle"})
ok(r.json()["on"] is False, "toggle turns it off")
r = c.put(f"{B}/mode", json={"input": {"state": "on"}, "by": "claude"})
ok(r.json()["on"] is True and r.json()["by"] == "claude", "a control@1 envelope works and records who")
r = c.put(f"{B}/mode", json={"state": "maybe"})
ok(r.status_code == 422, "a bad state is a validation error")

# ---- tokens of an element
PATH = "toolbar:app/group:edit/item:undo"
r = c.get(f"{B}/tokens", params={"path": PATH})
ok(r.status_code == 200, "GET tokens")
t = r.json()
ok([n["path"] for n in t["chain"]] == ["toolbar:app", "toolbar:app/group:edit", PATH], "the chain runs root → element")
row = next(x for x in t["chain"][-1]["tokens"] if x["token"] == "textColor")
ok(row["axHubValue"] == "theme" and row["overridden"] is False and row["source"]["layer"] == "theme", "inherited from axHub, not overridden")
ok("overrides what this element inherits from axHub" in t["note"], "the note says it overrides axHub inheritance")
ok(c.get(f"{B}/tokens", params={"path": "not a path"}).status_code == 422, "a bad path is refused")

# ---- set (item + parent), the list, unset
r = c.put(f"{B}/tokens", json={"path": PATH, "token": "textColor", "value": "danger", "reason": "undo looks dangerous"})
ok(r.status_code == 200 and r.json()["record"]["value"] == "danger" and r.json()["record"]["axHubValue"] == "theme", "PUT tokens sets an item override")
r = c.put(f"{B}/tokens", json={"path": "toolbar:app", "token": "fontSize", "value": "120", "scope": "parent"})
ok(r.status_code == 200 and r.json()["record"]["value"] == 120, "a parent override, the scale read as a number")
ok(c.put(f"{B}/tokens", json={"path": PATH, "token": "fontSize", "value": 999}).status_code == 422, "a value outside the scale is refused")
ok(c.put(f"{B}/tokens", json={"path": PATH, "token": "textColor", "value": "neon"}).status_code == 422, "a colour that is not a theme colour is refused")
t = c.get(f"{B}/tokens", params={"path": PATH}).json()
fs = next(x for x in t["chain"][-1]["tokens"] if x["token"] == "fontSize")
ok(fs["value"] == 120 and fs["overriddenAt"] == "toolbar:app", "the parent override reaches the child")

lst = c.get(f"{B}/overrides").json()
ok(lst["total"] == 2 and lst["shown"] == 2, "the list has both")
ok(lst == engine("overrides.list")["data"], "REST list = engine list")
ok(c.get(f"{B}/overrides", params={"q": "dangerous"}).json()["shown"] == 1, "full-text search finds the reason")
ok(c.get(f"{B}/overrides", params={"filter": json.dumps({"scope": "parent"})}).json()["items"][0]["token"] == "fontSize", "filter by scope")
ok(c.get(f"{B}/overrides", params={"filter": json.dumps({"tokenKind": "color"})}).json()["shown"] == 1, "filter by token kind")
ok(c.get(f"{B}/overrides", params={"filter": json.dumps({"app": "console-web"})}).json()["shown"] == 2, "filter by app")
ok(c.get(f"{B}/overrides", params={"filter": json.dumps({"since": "2000-01-01", "until": "2000-01-02"})}).json()["shown"] == 0, "filter by date")
ok(c.get(f"{B}/overrides", params={"root": "toolbar:app/group:edit"}).json()["shown"] == 1, "a root shows only what is under it")
ok(any(n["path"] == "toolbar:app" for n in lst["tree"]), "the tree starts at the root")

# ---- dialog state
ok(c.put(f"{B}/element", json={"path": PATH, "view": "grid", "scope": "parent"}).json() == {"path": PATH, "scope": "parent", "view": "grid"}, "PUT element")
ok(c.get(f"{B}/element").json()["view"] == "grid", "GET element reads it back")
ok(c.put(f"{B}/element", json={"view": "cards"}).status_code == 422, "an unknown view is refused")

# ---- list state, tabs, roots
ok(c.put(f"{B}/overrides/state", json={"q": "undo"}).status_code == 200, "PUT overrides/state")
ok(c.get(f"{B}/overrides").json()["q"] == "undo", "the search is kept for the user")
r = c.post(f"{B}/overrides/tabs", json={"root": "toolbar:app/group:edit"})
tab = r.json()["tab"]
ok(r.status_code == 200 and tab["root"] == "toolbar:app/group:edit", "a tab with its own root")
lst = c.get(f"{B}/overrides").json()
ok(lst["tab"] == tab["id"] and lst["root"] == "toolbar:app/group:edit", "the new tab is selected with its root")
c.put(f"{B}/overrides/state", json={"tab": "all", "q": ""})
ok(c.get(f"{B}/overrides").json()["shown"] == 2, "back on Everything")
ok(c.post(f"{B}/overrides/tabs/close", json={"id": tab["id"]}).status_code == 200, "close a tab")
ok(len(c.get(f"{B}/overrides").json()["tabs"]) == 1, "only Everything left")

# ---- single-item reset
rid = f"{PATH}|item|textColor"
r = c.post(f"{B}/overrides/reset", json={"id": rid})
ok(r.status_code == 200 and "inherits" in r.json()["now"], "reset one item")
lst = c.get(f"{B}/overrides").json()
ok(lst["total"] == 1 and lst["items"][0]["token"] == "fontSize", "only that item went; the parent override stays")
ok(c.post(f"{B}/overrides/reset", json={"id": rid}).status_code == 404, "resetting it again: not found")
ok(c.post(f"{B}/tokens/unset", json={"path": "toolbar:app", "token": "fontSize", "scope": "parent"}).status_code == 200, "unset the parent one")
ok(c.get(f"{B}/overrides").json()["total"] == 0, "nothing left: everything inherits from axHub")
doc = json.loads((TMP / "appearance.json").read_text())
ok(not any(k.startswith("axf.inline.") for k in doc.get("settings", {})), "the look document has no inline keys left")

print(f"✓ inline edit server — {checks} checks")
