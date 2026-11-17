#!/usr/bin/env python3
"""Route test for instance-look@1 in the Theme manager (build own-look-per-grid-and-tab-group).

    python3 apps/console-web/plugins/theme-manager/test/test_instance_look.py

On a scratch look document: list / keys / get / PUT / DELETE (reset to skin) / undo, a raw px and a raw colour refused
with 400 and nothing written, an unknown kind refused, an id with dots and a slash, the app-wide record (id -).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE.parent
REPO = PLUGIN.parents[3]
scratch = Path(tempfile.mkdtemp(prefix="axf-look-test-"))
(scratch / "looks").mkdir()
(scratch / "looks" / "axf-console.json").write_text(json.dumps({"$axf": "app-look@1", "app": "axf-console", "default": {"slots": {}, "settings": {}}, "own": {"settings": {"axf.display.fontScale": 1}}}))
os.environ["AXF_APPEARANCE_FILE"] = str(scratch / "appearance.json")
os.environ["AXF_LOOKS_DIR"] = str(scratch / "looks")
os.environ["AXF_THEME_MANAGER_DIR"] = str(scratch / "tm")
sys.path.insert(0, str(PLUGIN.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.theme_manager_look_test", PLUGIN / "server" / "__init__.py", submodule_search_locations=[str(PLUGIN / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


def doc() -> dict:
    return json.loads((scratch / "looks" / "axf-console.json").read_text())


B = "/p/instance-look"
r = c.get(B)
ok(r.status_code == 200 and r.json()["items"] == [], f"nothing has an own look at first ({r.status_code} {r.text[:300]})")
r = c.get(f"{B}/keys")
ok(r.status_code == 200 and [k["key"] for k in r.json()["items"]][:2] == ["rowBg", "rowAltBg"] and len(r.json()["items"]) == 10, "ten keys, in dialog order")

r = c.put(f"{B}/grid/ui-review.items", json={"values": {"rowBg": "surface2", "textSize": "sm", "radius": "md"}})
ok(r.status_code == 200 and r.json()["look"] == {"rowBg": "surface2", "textSize": "sm", "radius": "md"}, f"PUT sets three keys ({r.text})")
ok(doc()["own"]["settings"]["axf.chrome.grid.ui-review.items.look"] == {"rowBg": "surface2", "textSize": "sm", "radius": "md"}, "written as axf.chrome.grid.<id>.look in own.settings")
ok(doc()["own"]["settings"]["axf.display.fontScale"] == 1, "other settings untouched")

before = doc()
for bad in ({"radius": "4px"}, {"rowBg": "#ff0000"}, {"rowBg": "red"}, {"nope": "x"}, {"selectedFg": "transparent"}):
    r = c.put(f"{B}/grid/ui-review.items", json={"values": bad})
    ok(r.status_code == 400, f"refused {bad} ({r.status_code})")
ok(doc()["own"] == before["own"], "a refused value writes nothing")
ok(c.put(f"{B}/table/x", json={"values": {"rowBg": "surface"}}).status_code == 400, "unknown kind refused")

r = c.put(f"{B}/tab-group/settings.main", json={"selectedBg": "accentSoft"})
ok(r.status_code == 200 and r.json()["look"] == {"selectedBg": "accentSoft"}, "PUT with keys at the top level")
r = c.put(f"{B}/tab-group/workspace/panes", json={"values": {"spacing": "lg"}})
ok(r.status_code == 200 and r.json()["id"] == "workspace/panes", "an id with a slash")
r = c.put(f"{B}/grid/-", json={"values": {"borderW": "thin"}})
ok(r.status_code == 200 and "axf.chrome.grid.look" in doc()["own"]["settings"], "id - = the app-wide record")

r = c.get(B)
ok([(x["kind"], x["id"]) for x in r.json()["items"]] == [("grid", ""), ("grid", "ui-review.items"), ("tab-group", "settings.main"), ("tab-group", "workspace/panes")], f"list: app-wide first, then by kind and id ({r.text})")

r = c.get(f"{B}/grid/ui-review.items")
ok(r.status_code == 200 and r.json()["appWide"] == {"borderW": "thin"} and r.json()["followsSkin"] is False, "get carries the app-wide record")

r = c.put(f"{B}/grid/ui-review.items", json={"values": {"radius": "skin"}})
ok(r.json()["look"] == {"rowBg": "surface2", "textSize": "sm"}, "value skin drops one key")

r = c.delete(f"{B}/grid/ui-review.items")
ok(r.status_code == 200 and r.json()["changed"] is True and r.json()["followsSkin"] is True and r.json()["canUndo"] is True, "DELETE = reset to skin, one undo")
ok("axf.chrome.grid.ui-review.items.look" not in doc()["own"]["settings"], "reset drops the record")
ok("axf.chrome.tab-group.settings.main.look" in doc()["own"]["settings"], "reset leaves the other records")
r = c.post(f"{B}/grid/ui-review.items/undo")
ok(r.status_code == 200 and r.json()["look"] == {"rowBg": "surface2", "textSize": "sm"}, "undo puts the record back")
ok(c.post(f"{B}/grid/ui-review.items/undo").status_code == 404, "one undo only")
ok(c.delete(f"{B}/grid/never-set").json()["changed"] is False, "reset of a record nobody set changes nothing")

print(f"✓ theme-manager instance-look routes: {n} checks")
