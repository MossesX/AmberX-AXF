#!/usr/bin/env python3
"""Self-test for the context menu designer's server part (scratch data folder).

    python3 apps/console-web/plugins/context-menu-designer/test.py
"""
from __future__ import annotations

import importlib.util
import os
import stat
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_CONTEXT_MENU_DESIGNER_DIR"] = tempfile.mkdtemp(prefix="axf-ctxd-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.ctxd_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


check(c.get("/p/designs").json() == {"items": []}, "starts empty")
menu = {"name": "Main", "kind": "menu", "style": {"color": "token:accent", "hoverBackground": "#112233", "size": 999}, "items": [
    {"kind": "item", "id": "a", "label": "Copy", "action": "edit.copy", "items": [{"kind": "item", "id": "b", "label": "Inner"}]},
    {"kind": "separator", "id": "s"}, {"kind": "chunk", "id": "c", "chunk": "Edit"}]}
r = c.put("/p/designs/main", json=menu)
check(r.status_code == 200, "save a menu")
d = r.json()["design"]
check(d["style"]["size"] == 200 and d["style"]["color"] == "token:accent" and d["inherit"] is False, "style cleaned and clamped; menus never inherit")
check(d["items"][0]["items"][0]["label"] == "Inner" and d["items"][2]["chunk"] == "Edit", "items, submenus and chunk refs kept")
lv = c.put("/p/designs/lv", json={"name": "Loaded", "kind": "menu", "contributions": False, "items": [{"kind": "item", "id": "p", "label": "Plugins", "provider": "amber.plugins"}]}).json()["design"]
check(lv["items"][0]["provider"] == "amber.plugins" and lv["contributions"] is False, "live lists + contributions: false kept (loaded app menus)")
check(c.delete("/p/designs/lv").status_code == 200, "remove the loaded one")
check(c.put("/p/designs/edit", json={"name": "Edit", "kind": "chunk", "items": []}).json()["design"]["inherit"] is True, "chunks inherit by default")
check(c.put("/p/designs/edit2", json={"name": "edit", "kind": "chunk"}).status_code == 409, "duplicate chunk name refused")
check(c.put("/p/designs/m2", json={"name": "Edit", "kind": "menu"}).status_code == 200, "a menu may share a chunk name")
check(c.put("/p/designs/x", json={"name": "X", "kind": "menu", "style": {"color": "red"}}).status_code == 400, "named colours refused")
check(c.put("/p/designs/x", json={"name": "X", "kind": "menu", "style": {"background": "url(javascript:1)"}}).status_code == 400, "css injection in colours refused")
check(c.put("/p/designs/Bad%20Id", json={"name": "X", "kind": "menu"}).status_code == 400, "bad id refused")
check(c.put("/p/designs/x", json={"name": " ", "kind": "menu"}).status_code == 400, "blank name refused")
check(c.put("/p/designs/x", json={"name": "X", "kind": "thing"}).status_code == 400, "unknown kind refused")
check(c.put("/p/designs/x", json={"name": "X", "kind": "chunk", "items": [{"kind": "chunk", "id": "c"}]}).status_code == 400, "chunk entry without a name refused")
deep = {"kind": "item", "id": "d", "label": "d"}
for _ in range(5):
    deep = {"kind": "item", "id": "d", "label": "d", "items": [deep]}
check(c.put("/p/designs/x", json={"name": "X", "kind": "menu", "items": [deep]}).status_code == 400, "submenus deeper than 4 refused")
check(c.put("/p/designs/main", json={**menu, "name": "Main renamed"}).json()["design"]["name"] == "Main renamed", "rename = save with a new name")
names = [x["name"] for x in c.get("/p/designs").json()["items"]]
check(names[0] in ("Edit", "Main renamed") and "Edit" in names and len(names) == 3, "list: menus first, then chunks")
f = Path(os.environ["AXF_CONTEXT_MENU_DESIGNER_DIR"]) / "designs.json"
check(stat.S_IMODE(f.stat().st_mode) == 0o600, "data file is 0600")
check(c.delete("/p/designs/m2").status_code == 200 and c.delete("/p/designs/m2").status_code == 404, "delete, then 404")
r = subprocess.run(["node", "--experimental-strip-types", str(HERE / "test.mts")], capture_output=True, text=True, cwd=REPO)
check(r.returncode == 0, "core model checks (test.mts)" + ("" if r.returncode == 0 else f": {r.stdout[-400:]}{r.stderr[-400:]}"))
print(f"\n{ok} checks passed")
