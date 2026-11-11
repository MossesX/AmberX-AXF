#!/usr/bin/env python3
"""Self-test for the Theme manager (server routes on a scratch data folder + the roll engine on the real starter assets).

    python3 apps/console-web/plugins/theme-manager/test.py

Checks the asset@1 envelope validation (types, ids, built-in ids refused, uac-policy excluded, size cap), save /
list / rename / delete, presets, and the roll engine: locks kept, unticked untouched, numbers in range, enums valid,
readable palettes, tri-state ticks and presets.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_THEME_MANAGER_DIR"] = tempfile.mkdtemp(prefix="axf-tm-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.theme_manager_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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


print("theme-manager self-test")
# skins routes: the colour theme inside a skin has its own routes, and the fixed hub-wide path sits before the {app} ones
paths = [r.path for r in mod.router.routes]
check("/skins/{app}/color" in paths and "/skins/global/color" in paths, "colour-theme-inside-the-skin routes exist")
check(paths.index("/skins/global/color") < paths.index("/skins/{app}/at"), "the hub-wide colour route is declared before the {app} routes")
builtin = json.loads(next((REPO / "framework" / "assets" / "color-theme").glob("*.json")).read_text("utf-8"))
mine = {**builtin, "id": "my-roll-color-theme", "name": "My roll", "extra": "dropped", "tags": ["rolled"]}
check(c.get("/p/themes").json()["items"] == [], "starts empty")
r = c.post("/p/themes", json={"asset": mine})
check(r.status_code == 200 and "extra" not in r.json()["asset"] and r.json()["asset"]["data"] == builtin["data"], "saves a valid asset; unknown envelope keys dropped")
check(c.post("/p/themes", json={"asset": builtin}).status_code == 409, "a built-in id is refused (built-ins are never changed)")
check(c.post("/p/themes", json={"asset": {**mine, "type": "uac-policy"}}).status_code == 400, "access policies are never themes")
check(c.post("/p/themes", json={"asset": {**mine, "type": "nope"}}).status_code == 400, "unknown type refused")
for bad in ("../x", "Upper", "tm-preview-color-theme-a", "", "a" * 61):
    check(c.post("/p/themes", json={"asset": {**mine, "id": bad}}).status_code == 400, f"bad id refused: {bad[:12]!r}")
check(c.post("/p/themes", json={"asset": {**mine, "$axf": "asset@2"}}).status_code == 400, "envelope version checked")
check(c.post("/p/themes", json={"asset": {**mine, "data": []}}).status_code == 400, "data must be an object")
check(c.post("/p/themes", json={"asset": {**mine, "id": "big", "data": {"x": "y" * 300_000}}}).status_code == 413, "size cap")
items = c.get("/p/themes").json()["items"]
check(len(items) == 1 and items[0]["id"] == "my-roll-color-theme", "listed")
r = c.put("/p/themes/color-theme/my-roll-color-theme", json={**items[0], "name": "Renamed", "id": "other", "type": "layout"})
check(r.status_code == 200 and r.json()["asset"]["name"] == "Renamed" and r.json()["asset"]["id"] == "my-roll-color-theme" and r.json()["asset"]["type"] == "color-theme", "rename keeps type and id from the path")
check(c.put("/p/themes/color-theme/missing", json=items[0]).status_code == 404, "update of a missing theme is 404")
f = Path(os.environ["AXF_THEME_MANAGER_DIR"]) / "themes" / "color-theme" / "my-roll-color-theme.json"
check(f.exists() and (f.stat().st_mode & 0o777) == 0o600, "stored privately in the data folder")
check(c.delete("/p/themes/color-theme/my-roll-color-theme").json()["ok"] and not f.exists(), "deleted")
check(c.delete("/p/themes/color-theme/%2e%2e").status_code == 404 and c.delete("/p/themes/..%2fx/y").status_code == 404, "no path tricks on delete")

check(c.get("/p/presets").json()["presets"] == {}, "no presets yet")
p = c.put("/p/presets", json={"menus only": ["nav-menu:indicator"], "  ": []})
check(p.status_code == 400, "blank preset name refused")
p = c.put("/p/presets", json={"menus only": ["nav-menu:indicator", 3]}).json()["presets"]
check(p == {"menus only": ["nav-menu:indicator"]}, "preset saved (non-strings dropped)")
check(c.get("/p/presets").json()["presets"] == p, "presets persist")
check(c.put("/p/presets", json={str(i): [] for i in range(60)}).status_code == 400, "preset count capped")

# skin library: the asset store's Skins category (save / overwrite / duplicate / import / favourite / delete)
check(paths.index("/skin-library/saved") < paths.index("/skin-library/{iid}/export"), "the fixed skin-library paths come first")
win = json.loads((REPO / "framework" / "assets" / "skin" / "windows.json").read_text("utf-8"))
lib = c.get("/p/skin-library").json()
check(any(r["id"] == "windows" and not r["custom"] for r in lib["items"]), "the built-in skins are listed")
check(c.post("/p/skin-library", json={"asset": win}).status_code == 409, "a built-in skin id is refused")
mine_skin = {**win, "id": "my-skin", "name": "My skin"}
check(c.post("/p/skin-library", json={"asset": mine_skin}).status_code == 200, "save a skin")
check(c.post("/p/skin-library", json={"asset": mine_skin}).status_code == 409, "save as new never takes a used id")
check(c.post("/p/skin-library", json={"asset": {**mine_skin, "name": "Mine"}, "overwrite": True}).json()["asset"]["name"] == "Mine", "overwrite a saved skin")
check(c.post("/p/skin-library", json={"asset": {**mine, "id": "x"}}).status_code == 400, "only skins")
d = c.post("/p/skin-library/windows/duplicate", json={}).json()["asset"]
check(d["id"] == "windows-copy" and "custom" in d["tags"], "duplicate a built-in skin under a free id")
check(c.post("/p/skin-library/windows/duplicate", json={}).json()["asset"]["id"] == "windows-copy-2", "the next copy gets the next id")
imp = c.post("/p/skin-library/import", json={"asset": mine_skin}).json()
check(imp["imported"] == ["my-skin-2"] and imp["errors"] == [], "import gives a taken id a free one")
check(c.get("/p/skin-library/my-skin/export").json()["name"] == "Mine", "export a saved skin")
check(c.get("/p/skin-library/windows/export").json()["id"] == "windows", "export a built-in skin")
check(c.post("/p/skin-library/my-skin/favourite", json={"on": True}).json()["favourites"] == ["my-skin"], "favourite")
check([r["id"] for r in c.get("/p/skin-library?show=favourites").json()["items"]] == ["my-skin"], "favourites filter")
check({r["id"] for r in c.get("/p/skin-library?show=custom").json()["items"]} == {"my-skin", "my-skin-2", "windows-copy", "windows-copy-2"}, "mine filter")
check([r["id"] for r in c.get("/p/skin-library?q=mine").json()["items"]] == ["my-skin"], "search")
r = c.delete("/p/skin-library/my-skin").json()
check(r["ok"] and r["favourites"] == [], "delete drops it from favourites too")
check(c.delete("/p/skin-library/windows").status_code == 404, "a built-in skin is never deleted")
check(len(c.get("/p/skin-library/saved").json()["items"]) == 3, "saved skins listed as assets")

npx = shutil.which("npx")
if not npx:
    print("  - roll engine checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "roll-check.mjs"), str(REPO)], capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise SystemExit(f"FAIL: roll engine check crashed\n{out.stderr[-2000:]}")
    e = json.loads(out.stdout.strip().splitlines()[-1])
    check({"color-theme", "style-theme", "layout"} <= set(e["types"]) and e["noUac"], "tree has a branch per asset type, no access policies")
    check(e["lockKept"], "a locked value is never rolled")
    check(e["changed"] >= 3 and e["sameKeys"], "a colour roll changes ticked values and keeps the asset complete")
    check(e["readable"] == [], f"rolled colours are readable ({e['readable']})")
    check(e["worstTextContrast"] >= 4.5, f"text contrast ≥ 4.5 over 40 palettes (worst {e['worstTextContrast']:.2f})")
    check(e["numbersInRange"] and e["enumsValid"], "style rolls keep numbers in the known range and enums valid")
    check(e["untickedUnchanged"], "nothing ticked = nothing changes")
    check(e["tri"] == ["off", "on", "some"] and e["untoggle"], "tri-state ticks and toggling a branch")
    check(e["presetColors"] and e["presetAll"], "presets: colors only / all")
    check(e["badContrastFlagged"], "hard-to-read colours are flagged")
print(f"all {ok} checks passed")
