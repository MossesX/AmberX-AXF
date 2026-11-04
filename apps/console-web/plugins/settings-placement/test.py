#!/usr/bin/env python3
"""Self-test for the Settings placement plugin's server part (settings-placement@1 store).

    python3 apps/console-web/plugins/settings-placement/test.py

Set / get / list / forget a plugin's pick by id and by folder, the app default, refusal of unknown values (naming the
field), and the store file staying inside the data folder.
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
os.environ["AXF_SETTINGS_PLACEMENT_DIR"] = tempfile.mkdtemp(prefix="axf-sp-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("axf_console_plugins.settings_placement_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    assert cond, what
    n += 1


# this plugin's own id (a folder resolves to its plugin id); no other plugin is named here (plugin-lifecycle check)
TERM = "ai.amberx.axf.console.settings-placement"
r = c.get("/placements").json()
ok(r["count"] == 0 and r["rev"] == 0, "empty store")
r = c.put("/placements/settings-placement", json={"placement": "inside", "mode": "pane", "looks": {"inside:pane": {"edge": "left", "animation": "slide", "dim": True}}})
ok(r.status_code == 200 and r.json()["owner"] == TERM, "folder resolves to the plugin id")
g = c.get(f"/placements/{TERM}").json()
ok(g["pick"]["placement"] == "inside" and g["pick"]["looks"]["inside:pane"]["edge"] == "left" and g["source"] == "own", "get by id")
ok(c.get("/placements").json()["count"] == 1, "listed")
# screens (Nov 4 2026): per-screen picks, the choice words, older names
r = c.put("/screens/home", json={"placement": "panel-left"})
ok(r.status_code == 200 and r.json()["pick"]["placement"] == "panel" and r.json()["pick"]["side"] == "left", "a choice word sets the panel and its side")
ok(c.get("/screens/home").json()["source"] == "own", "a screen's own pick")
ok(c.get("/screens").json()["count"] == 1 and c.get("/placements").json()["count"] == 2, "screens listed and counted")
r = c.put("/screens/plan-studio", json={"placement": "main", "looks": {"fallback": {"edge": "left", "size": "wide"}}})
ok(r.json()["pick"]["placement"] == "page" and r.json()["pick"]["looks"]["panel"]["size"] == "wide", "older names still load: main → page, fallback look → panel")
r = c.put("/screens/sheet-screen", json={"placement": "bottom sheet"})
ok(r.json()["pick"]["placement"] == "sheet", "a spoken name")
bad = c.put("/screens/home", json={"placement": "panel", "side": "up"})
ok(bad.status_code == 400 and "side" in bad.json()["detail"], "unknown side refused")
bad = c.put("/screens/bad id!", json={"placement": "dialog"})
ok(bad.status_code == 400, "a bad view id is refused")
f = c.put("/screens/home", json={"placement": "default"}).json()
ok(f["pick"] is None and c.get("/screens").json()["count"] == 2, "placement default forgets a screen's pick")
bad = c.put(f"/placements/{TERM}", json={"placement": "sideways"})
ok(bad.status_code == 400 and "placement" in bad.json()["detail"], "unknown placement refused")
bad = c.put(f"/placements/{TERM}", json={"placement": "inside", "looks": {"inside:pane": {"edge": "diagonal"}}})
ok(bad.status_code == 400 and "looks.inside:pane.edge" in bad.json()["detail"], "unknown look value refused, field named")
bad = c.put(f"/placements/{TERM}", json={"placement": "inside", "looks": {"inside:pane": {"colour": "red"}}})
ok(bad.status_code == 400 and "colour" in bad.json()["detail"], "unknown look field refused")
d = c.put("/default", json={"placement": "dialog"}).json()
ok(d["default"]["placement"] == "dialog", "app default set")
ok(c.get("/placements/other.plugin").json()["source"] == "app default", "unset plugin follows the app default")
f = c.put(f"/placements/{TERM}", json={"placement": "default"}).json()
ok(f["pick"] is None and c.get("/placements").json()["count"] == 2, "placement default forgets the pick")
store = Path(os.environ["AXF_SETTINGS_PLACEMENT_DIR"]) / "placements.json"
s = json.loads(store.read_text())
ok(s["$axf"] == "settings-placement-store@1" and s["rev"] == 7, "store file in the data folder, versioned")
ch = c.get("/choices").json()
ok("inside" in ch["placements"] and "pane" in ch["modes"] and "slide" in ch["look"]["animation"], "choices")
print(f"settings-placement server: {n} checks passed")
