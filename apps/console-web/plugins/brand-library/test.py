#!/usr/bin/env python3
"""Self-test for the Brand library plugin's server part (reads the real framework/brand-library, writes config to a temp dir).

    python3 apps/console-web/plugins/brand-library/test.py
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
REPO = HERE.parents[3]
DATA = tempfile.mkdtemp(prefix="axf-brand-library-test-")
os.environ["AXF_BRAND_LIBRARY_DIR"] = DATA

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.brand_library_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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


lib = json.loads((REPO / "framework" / "brand-library" / "index.json").read_text())
ix = c.get("/p/index").json()["types"]
for t in mod.TYPES:
    check(ix[t]["count"] == lib["counts"][t], f"index counts {t} = {lib['counts'][t]} (matches brand-library@1 index)")
check(set(ix["logo-mark"]["facets"]["brand"]) == {"AmberX", "GizmoX"}, "logos are faceted by brand (AmberX, GizmoX)")
check({"mark", "wordmark", "lockup"} <= set(ix["logo-mark"]["facets"]["form"]), "logos are faceted by form")
check(len(ix["animated-logo"]["facets"].get("preset", [])) >= 3, "animated logos are faceted by motion preset")
check(len(ix["icon-pack"]["facets"].get("style", [])) >= 2, "icon packs are faceted by style")

logos = c.get("/p/assets/logo-mark").json()["items"]
check(len(logos) == lib["counts"]["logo-mark"] and all(a["type"] == "logo-mark" and "facets" in a for a in logos), "every logo is served whole, with facets")
check(logos == sorted(logos, key=lambda a: a["id"]), "assets are sorted by id")
check(c.get("/p/assets/nope").status_code == 404, "an unknown type is a 404")
check(c.get("/p/assets/..%2Fschemas").status_code == 404, "a path in the type is a 404")

brand = c.get("/p/assets/branding").json()["items"][0]
cl = c.get(f"/p/closure/branding/{brand['id']}").json()
kinds = sorted({a["type"] for a in cl["items"]})
check(kinds == ["animated-logo", "branding", "icon-pack", "logo-mark"] and cl["missing"] == [], "a branding closure brings its marks, animated mark and icon pack")
check(all("facets" not in a for a in cl["items"]), "closure items are plain asset@1 (no facets)")
anim = c.get("/p/assets/animated-logo").json()["items"][0]
cla = c.get(f"/p/closure/animated-logo/{anim['id']}").json()
check({a["id"] for a in cla["items"]} == {anim["id"], anim["data"]["mark"]}, "an animated logo's closure brings its mark")
check(c.get("/p/closure/branding/not-there").status_code == 404, "a closure of an unknown id is a 404")
check(c.get("/p/closure/branding/BAD_ID").status_code == 404, "a bad id is a 404")

cfg = c.get("/p/config").json()
check(cfg == mod.DEFAULT_CONFIG, "config starts at the defaults")
r = c.put("/p/config", json={"tab": "packs", "tile": "lg", "brand": "GizmoX", "names": False, "evil": 1}).json()
check(r["tab"] == "packs" and r["tile"] == "lg" and r["brand"] == "GizmoX" and r["names"] is False and "evil" not in r, "config saves known keys only")
r = c.put("/p/config", json={"tab": "nope", "tile": 5}).json()
check(r["tab"] == "packs" and r["tile"] == "lg", "bad values keep what was saved")
derived = {"$axf": "asset@1", "type": "branding", "id": "bl-abc", "name": "x", "version": "1.0.0", "data": {"brand": {"name": "AmberX"}, "marks": {}}}
r = c.put("/p/config", json={"applied": {"type": "branding", "id": "bl-abc", "asset": derived}}).json()
check(r["applied"]["id"] == "bl-abc" and r["applied"]["asset"]["id"] == "bl-abc", "a derived branding package is kept with the applied pick")
r = c.put("/p/config", json={"applied": {"type": "branding", "id": "x", "asset": {"type": "branding", "data": "y" * 20000}}}).json()
check("asset" not in r["applied"], "an oversized derived package is dropped")
r = c.put("/p/config", json={"applied": None}).json()
check(r["applied"] is None, "applied can be cleared")
check((Path(DATA) / "config.json").stat().st_mode & 0o077 == 0, "config file is private (0600)")
(Path(DATA) / "config.json").write_text("{broken")
check(c.get("/p/config").json() == mod.DEFAULT_CONFIG, "a damaged config falls back to the defaults")
print(f"all {ok} checks passed")
