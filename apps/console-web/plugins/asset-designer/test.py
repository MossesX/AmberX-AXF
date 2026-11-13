#!/usr/bin/env python3
"""Self-test for the Asset designer's server part (routes on a scratch data folder; needs node for the framework validator).

    python3 apps/console-web/plugins/asset-designer/test.py

Checks the type registry and chrome routes, built-in listing, the validation gate (valid / invalid, nothing written when
invalid), save with the designed@1 manifest (revision 1, then 2 with the same uid), overwrite guard, built-in ids refused,
every type accepted (toolbar, tab-group, settings interface for a chrome type), list / get / library / duplicate / delete.
The web model has its own test: test.mts.
"""
from __future__ import annotations

import copy
import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = tempfile.mkdtemp(prefix="axf-ad-test-")
os.environ["AXF_ASSET_DESIGNER_DIR"] = TMP
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.asset_designer_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
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


toolbar = {"$axf": "asset@1", "type": "toolbar", "id": "my-bar", "name": "My bar", "version": "1.0.0",
           "data": {"variant": "icons", "align": "start", "groups": [], "showSearch": False, "density": "regular", "surface": "flat", "divider": True, "collapsible": False}}
tabs = {"$axf": "asset@1", "type": "tab-group", "id": "my-tabs", "name": "My tabs", "version": "1.0.0", "data": {"style": "pills", "align": "start", "position": "top"}}
bad = copy.deepcopy(toolbar)
bad["data"]["variant"] = "sideways"
try:
    r = c.get("/p/types").json()
    check("types: toolbar + tab-group + settings listed", {"toolbar", "tab-group", "settings"} <= {t["type"] for t in r["items"]}, r.get("items", [])[:2])
    ch = c.get("/p/chrome").json()
    check("chrome: tab-group fields and the toolbar default", len(ch["fields"]["tab-group"]) >= 12 and ch["defaults"]["toolbar"] == "chrome-toolbar", ch.get("defaults"))
    b = c.get("/p/builtin/settings").json()["items"]
    check("builtin settings include chrome-toolbar and chrome-tab-group", {"chrome-toolbar", "chrome-tab-group"} <= {a["id"] for a in b})
    check("builtin unknown type → 404", c.get("/p/builtin/nope").status_code == 404)
    check("empty list", c.get("/p/assets").json() == {"items": []})

    v = c.post("/p/validate", json={"asset": toolbar}).json()
    check("validate: good toolbar ok", v == {"ok": True, "errors": []}, v)
    v = c.post("/p/validate", json={"asset": bad}).json()
    check("validate: bad enum lists errors, nothing saved", v["ok"] is False and v["errors"] and c.get("/p/assets").json()["items"] == [], v)

    r = c.post("/p/assets", json={"asset": bad})
    check("save invalid → 422 with the errors", r.status_code == 422 and r.json()["detail"]["errors"], r.text)
    check("nothing written", not list(Path(TMP).rglob("*.json")))

    r = c.post("/p/assets", json={"asset": toolbar})
    a1 = r.json().get("asset", {})
    check("save toolbar → revision 1 with uid + hash", r.status_code == 200 and a1.get("designed", {}).get("revision") == 1 and a1["designed"]["uid"].startswith("dz-"), r.text)
    check("file in the data folder", (Path(TMP) / "assets" / "toolbar" / "my-bar.json").exists())
    a1b = copy.deepcopy(a1)
    a1b["data"]["showSearch"] = True
    r = c.post("/p/assets", json={"asset": a1b})
    a2 = r.json().get("asset", {})
    check("save again → revision 2, same uid, new hash", r.status_code == 200 and a2["designed"]["revision"] == 2 and a2["designed"]["uid"] == a1["designed"]["uid"] and a2["designed"]["hash"] != a1["designed"]["hash"], r.text)
    check("overwrite: false refuses", c.post("/p/assets", json={"asset": toolbar, "overwrite": False}).status_code == 409)
    builtin_toolbar = c.get("/p/builtin/toolbar").json()["items"][0]["id"]
    check("built-in id refused", c.post("/p/assets", json={"asset": {**toolbar, "id": builtin_toolbar}}).status_code == 409, builtin_toolbar)
    check("preview id refused", c.post("/p/assets", json={"asset": {**toolbar, "id": "ad-preview-toolbar"}}).status_code == 400)
    check("unknown type refused", c.post("/p/assets", json={"asset": {**toolbar, "type": "nope"}}).status_code == 400)
    check("not an asset refused", c.post("/p/assets", json={"asset": {"hello": 1}}).status_code == 400)

    r = c.post("/p/assets", json={"asset": tabs})
    check("save tab-group (another type)", r.status_code == 200 and r.json()["asset"]["designed"]["addon"] == "host", r.text)
    chrome_default = next(a for a in b if a["id"] == "chrome-tab-group")
    custom = {"$axf": "asset@1", "type": "settings", "id": "chrome-tab-group-designed", "name": "Tab group settings (designed)", "version": "1.0.0", "data": copy.deepcopy(chrome_default["data"])}
    custom["data"]["layout"] = "tabs-side"
    r = c.post("/p/assets", json={"asset": custom})
    check("save a chrome settings interface (settings for tab-group)", r.status_code == 200 and r.json()["asset"]["data"]["for"] == "tab-group", r.text)
    broken_settings = copy.deepcopy(custom)
    broken_settings["data"]["layout"] = "sideways"
    check("invalid settings interface refused by the gate", c.post("/p/assets", json={"asset": broken_settings}).status_code == 422)

    items = c.get("/p/assets").json()["items"]
    check("list has three types", sorted(a["type"] for a in items) == ["settings", "tab-group", "toolbar"], [a["type"] for a in items])
    check("list by type", [a["id"] for a in c.get("/p/assets", params={"type": "toolbar"}).json()["items"]] == ["my-bar"])
    check("get one", c.get("/p/assets/toolbar/my-bar").json()["asset"]["designed"]["revision"] == 2)
    check("get missing → 404", c.get("/p/assets/toolbar/nope").status_code == 404)
    lib = c.get("/p/library").json()
    check("library index", lib["$axf"] == "designer-library@1" and {r["ref"] for r in lib["items"]} == {"toolbar/my-bar", "tab-group/my-tabs", "settings/chrome-tab-group-designed"}, lib)

    r = c.post("/p/assets/toolbar/my-bar/duplicate", json={"id": "my-bar-2", "name": "Bar two"})
    d = r.json().get("asset", {})
    check("duplicate → new id, fresh uid, revision 1", r.status_code == 200 and d["id"] == "my-bar-2" and d["designed"]["uid"] != a1["designed"]["uid"] and d["designed"]["revision"] == 1, r.text)
    check("duplicate onto an existing id refused", c.post("/p/assets/toolbar/my-bar/duplicate", json={"id": "my-bar-2"}).status_code == 409)
    check("duplicate bad id refused", c.post("/p/assets/toolbar/my-bar/duplicate", json={"id": "Bad"}).status_code == 400)
    check("delete", c.delete("/p/assets/toolbar/my-bar-2").json() == {"ok": True} and c.get("/p/assets/toolbar/my-bar-2").status_code == 404)
    check("delete missing → 404", c.delete("/p/assets/toolbar/my-bar-2").status_code == 404)
finally:
    import shutil

    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{fails} check(s) failed" if fails else "\nall checks passed")
sys.exit(1 if fails else 0)
