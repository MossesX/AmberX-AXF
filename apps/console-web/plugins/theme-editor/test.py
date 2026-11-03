#!/usr/bin/env python3
"""Self-test for the Theme editor's server part (routes on a scratch data folder).

    python3 apps/console-web/plugins/theme-editor/test.py

Checks the asset@1 envelope validation (colour / style only, ids, built-in ids refused, draft ids refused, colour
theme shape, size cap), save / overwrite guard / list / delete. The web model has its own test: test.mts.
"""
from __future__ import annotations

import importlib.util
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = tempfile.mkdtemp(prefix="axf-te-test-")
os.environ["AXF_THEME_EDITOR_DIR"] = TMP
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.theme_editor_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
fails = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global fails
    print(("✓ " if ok else "✗ ") + name + ("" if ok else f"  {detail}"))
    fails += 0 if ok else 1


color = {"$axf": "asset@1", "type": "color-theme", "id": "my-colors", "name": "Mine", "version": "1.0.0", "data": {"scheme": "dark", "tokens": {"bg": "#000000", "text": "#ffffff"}}}
style = {"$axf": "asset@1", "type": "style-theme", "id": "my-style", "name": "Mine", "version": "1.0.0", "data": {"fontSize": 13}}
try:
    check("empty list", c.get("/p/themes").json() == {"items": []})
    r = c.post("/p/themes", json={"asset": color})
    check("save colour theme", r.status_code == 200 and r.json()["asset"]["id"] == "my-colors", r.text)
    check("save style theme", c.post("/p/themes", json={"asset": style}).status_code == 200)
    check("list has both", sorted(a["type"] for a in c.get("/p/themes").json()["items"]) == ["color-theme", "style-theme"])
    check("overwrite allowed by default", c.post("/p/themes", json={"asset": {**color, "name": "Mine 2"}}).status_code == 200)
    check("overwrite: false refuses", c.post("/p/themes", json={"asset": color, "overwrite": False}).status_code == 409)
    check("other types refused", c.post("/p/themes", json={"asset": {**style, "type": "layout"}}).status_code == 400)
    check("uac-policy refused", c.post("/p/themes", json={"asset": {**style, "type": "uac-policy"}}).status_code == 400)
    check("built-in id refused", c.post("/p/themes", json={"asset": {**style, "id": "hub"}}).status_code == 409)
    check("draft id refused", c.post("/p/themes", json={"asset": {**style, "id": "te-draft-x"}}).status_code == 400)
    check("bad id refused", c.post("/p/themes", json={"asset": {**style, "id": "../x"}}).status_code == 400)
    check("not asset@1 refused", c.post("/p/themes", json={"asset": {**style, "$axf": "x"}}).status_code == 400)
    check("colour theme needs scheme", c.post("/p/themes", json={"asset": {**color, "data": {"tokens": {}}}}).status_code == 400)
    check("size cap", c.post("/p/themes", json={"asset": {**style, "data": {"x": "a" * 120_000}}}).status_code == 413)
    check("delete", c.delete("/p/themes/style-theme/my-style").status_code == 200)
    check("delete again 404", c.delete("/p/themes/style-theme/my-style").status_code == 404)
    check("delete other type 404", c.delete("/p/themes/layout/x").status_code == 404)
    check("one left", [a["id"] for a in c.get("/p/themes").json()["items"]] == ["my-colors"])
finally:
    shutil.rmtree(TMP, ignore_errors=True)
print("all good" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
