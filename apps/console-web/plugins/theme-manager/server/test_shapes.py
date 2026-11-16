#!/usr/bin/env python3
"""Theme-manager /shapes routes (shape@1) on scratch hub files: list, set at every scope, resolve, Restore previous edit,
add a custom corners / mask shape, a bad mask refused. The routes run framework/cli/shapes.mjs, so this also covers the CLI.

    python3 apps/console-web/plugins/theme-manager/server/test_shapes.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
TMP = Path(tempfile.mkdtemp(prefix="axf-shapes-test-"))
(TMP / "looks").mkdir()
(TMP / "appearance.json").write_text(json.dumps({"$axf": "appearance@1", "settings": {}}))
os.environ.update({"AXF_APPEARANCE_FILE": str(TMP / "appearance.json"), "AXF_LOOKS_DIR": str(TMP / "looks"), "AXF_SHAPES_DIR": str(TMP / "shapes"), "AXF_THEME_MANAGER_DIR": str(TMP / "tm")})
subprocess.run(["node", str(REPO / "framework/cli/skins.mjs"), "snapshot", "axf-console", "--json"], cwd=REPO, check=True, capture_output=True)

sys.path.insert(0, str(REPO / "apps/console-web/server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.theme_manager_shapes_test", HERE / "__init__.py", submodule_search_locations=[str(HERE)])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
n = 0


def check(cond: bool, msg: str) -> None:
    global n
    if not cond:
        raise SystemExit(f"✗ {msg}")
    n += 1


r = c.get("/p/shapes").json()
ids = [s["id"] for s in r["shapes"]]
for sid in ("circle", "pill", "rounded-square", "square", "squircle", "hexagon", "diamond", "tag", "leaf", "star"):
    check(sid in ids, f"starter {sid} listed")

check(c.put("/p/shapes/global", json={"shape": "hexagon"}).status_code == 200, "set global")
check(c.get("/p/shapes/resolve", params={"app": "axf-console"}).json()["id"] == "hexagon", "global decides with nothing below it")
check(c.put("/p/shapes/widget", json={"shape": "tag", "app": "axf-console", "widget": "clock:digital-12h"}).status_code == 200, "set one widget")
res = c.get("/p/shapes/resolve", params={"app": "axf-console", "widget": "clock:digital-12h"}).json()
check(res["id"] == "tag" and res["level"] == "instance", "the widget's own pick beats global")
check(c.put("/p/shapes/app", json={"shape": "squircle", "app": "axf-console"}).status_code == 200, "set the app")
check(c.get("/p/shapes/resolve", params={"app": "axf-console"}).json()["level"] == "app", "app beats global")
check(c.put("/p/shapes/skin", json={"shape": "diamond", "skin": "atelier"}).status_code == 200, "set a skin's shape")
check(c.get("/p/shapes").json()["levels"]["skins"] == {"atelier": "diamond"}, "skin pick kept per skin")

check(c.post("/p/shapes/global/restore-previous").json()["current"] == "", "restore global goes back to none")
check(c.post("/p/shapes/global/restore-previous").json()["current"] == "hexagon", "a second restore brings the edit back")
check(c.put("/p/shapes/widget", json={"shape": "inherit", "app": "axf-console", "widget": "clock:digital-12h"}).json()["current"] == "", "inherit clears a widget")
check(c.post("/p/shapes/widget/restore-previous", json={"app": "axf-console", "widget": "clock:digital-12h"}).json()["current"] == "tag", "restore a widget")

check(c.put("/p/shapes/global", json={"shape": "nope"}).status_code == 400, "unknown shape refused")
check(c.put("/p/shapes/planet", json={"shape": "pill"}).status_code == 404, "unknown scope refused")
check(c.put("/p/shapes/widget", json={"shape": "pill", "app": "axf-console"}).status_code == 400, "widget scope needs a widget")
bad = c.post("/p/shapes/assets", json={"id": "evil", "mask": "M 0 0 L 10 10 url(x) Z"})
check(bad.status_code == 400 and "outside the path" in bad.json()["detail"], "a mask with an external reference is refused")
check(c.post("/p/shapes/assets", json={"id": "open", "mask": "M 0 0 L 100 0 L 50 100"}).status_code == 400, "an open path is refused")
check(c.post("/p/shapes/assets", json={"id": "chip-cut", "corners": {"tl": "lg", "br": "lg"}}).status_code == 200, "a corners shape is added")
check(c.post("/p/shapes/assets", json={"id": "kite", "name": "Kite", "mask": "M 50 0 L 100 40 L 50 100 L 0 40 Z"}).status_code == 200, "a mask shape is added")
check({"chip-cut", "kite"} <= {a["id"] for a in c.get("/p/shapes/assets").json()["items"]}, "added shapes are served whole")
check(c.put("/p/shapes/global", json={"shape": "kite"}).status_code == 200, "an added shape can be picked")
check(c.post("/p/shapes/assets", json={"id": "kite", "corners": "tl=sm"}).status_code == 400, "an id is added once")

print(f"✓ theme-manager shapes: {n} checks")
