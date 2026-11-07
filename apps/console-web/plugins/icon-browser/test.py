#!/usr/bin/env python3
"""Self-test for the Icon Browser plugin's server part (reads the real framework/icon-library, writes data to a temp dir).

    python3 apps/console-web/plugins/icon-browser/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA = tempfile.mkdtemp(prefix="axf-icon-browser-test-")
os.environ["AXF_ICON_BROWSER_DIR"] = DATA

sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.icon_browser_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import HTTPException  # noqa: E402

n = 0


def check(name: str, cond: bool, detail: str = "") -> None:
    global n
    n += 1
    if not cond:
        print(f"✗ {name} {detail}")
        sys.exit(1)


def refused(name: str, fn, status: int) -> None:
    try:
        fn()
    except HTTPException as e:
        check(name, e.status_code == status, f"status {e.status_code}: {e.detail}")
        return
    check(name, False, "was accepted")


# the library
lib = mod.get_library()
check("library index", lib["$axf"] == "icon-library@1" and len(lib["sets"]) >= 7 and lib["mine"] == [])
total = sum(s["count"] for s in lib["sets"])
check("library holds thousands of icons", total > 10000, str(total))
r = mod.search(q="floppy disk", limit=50)
check("search by tag finds lucide save", any(i["name"] == "save" and i["set"] == "lucide" for i in r["items"]), str(r["total"]))
r = mod.search(set="tabler", category="Devices", limit=5)
check("search narrows by set + category", r["total"] > 0 and all(i["set"] == "tabler" and i["category"] == "Devices" for i in r["items"]))
check("search lists categories", "Devices" in r["categories"])
r2 = mod.search(q="", set="phosphor", limit=2, offset=1, sort="pack")
check("search pages and sorts", r2["offset"] == 1 and len(r2["items"]) == 2)
first = lib["sets"][0]["packs"][0]["id"]
pack = mod.get_pack(first)
check("pack by id", pack["type"] == "icon-pack" and pack["id"] == first and len(pack["data"]["glyphs"]) > 0)
refused("unknown pack is 404", lambda: mod.get_pack("nope-nope"), 404)
refused("bad set id is 404", lambda: mod.get_set("Nope"), 404)
side = mod.get_set("lucide")
check("set sidecar", side["$axf"] == "icon-library-set@1" and "save" in side["icons"])

# packs you make
good = {"$axf": "asset@1", "type": "icon-pack", "id": "mine-1", "name": "Mine", "version": "1.0.0", "data": {"style": "outline", "grid": 24, "glyphs": {"save": "M3 3h18v18H3z", "home": {"d": "M3 11 12 3l9 8", "fill": True}}}}
check("save a pack", mod.put_pack("mine-1", good)["count"] == 2)
check("saved pack is listed", [p["id"] for p in mod.list_packs()["items"]] == ["mine-1"])
check("saved pack is served by id", mod.get_pack("mine-1")["id"] == "mine-1")
check("saved pack's glyphs are in the search", any(i["pack"] == "mine-1" and i["set"] == "mine" for i in mod.search(q="save", limit=2000)["items"]))
check("library lists mine", mod.get_library()["mine"][0]["count"] == 2)
refused("pack id must match", lambda: mod.put_pack("other", good), 422)
refused("pack needs glyphs", lambda: mod.put_pack("mine-2", {**good, "id": "mine-2", "data": {"style": "outline", "grid": 24, "glyphs": {}}}), 422)
refused("glyph paths are path commands only", lambda: mod.put_pack("mine-2", {**good, "id": "mine-2", "data": {"style": "outline", "grid": 24, "glyphs": {"x": "<script>"}}}), 422)
check("delete a pack", mod.delete_pack("mine-1")["removed"] is True)
check("deleted pack is gone", mod.list_packs()["items"] == [])

# maps
shipped = mod.list_maps()["items"]
check("framework map is listed as shipped", any(m["id"] == "framework" and m["shipped"] == "framework" for m in shipped))
m = {"$axf": "asset@1", "type": "icon-map", "id": "console-root", "name": "Console", "version": "1.0.0", "data": {"scope": {"app": "console-web"}, "pack": "lucide-a-d", "slots": {"save": "pack:lucide-m-t/save", "hidden": "none", "nav.builds": "hammer"}}}
check("save a map", mod.put_map("console-root", m)["slots"] == 3)
check("saved map listed unshipped", any(x["id"] == "console-root" and x["shipped"] == "" for x in mod.list_maps()["items"]))
refused("map slot refs are checked", lambda: mod.put_map("bad-map", {**m, "id": "bad-map", "data": {"scope": {}, "slots": {"save": "Not A Ref"}}}), 422)
check("delete a map", mod.delete_map("console-root")["removed"] is True)

# sources + secrets
src = {"$axf": "asset@1", "type": "icon-source", "id": "box", "name": "Box", "version": "1.0.0", "data": {"kind": "sftp", "root": "/icons", "auth": {"mode": "password", "secretRef": "box-pass"}, "options": {"host": "h", "user": "u"}}}
check("save a source", mod.put_source("box", src)["id"] == "box")
refused("a raw password is refused", lambda: mod.put_source("box", {**src, "data": {**src["data"], "auth": {"mode": "password", "password": "hunter2"}}}), 422)
refused("a raw api key in options is refused", lambda: mod.put_source("box", {**src, "data": {**src["data"], "options": {"host": "h", "apiKey": "k"}}}), 422)
refused("unknown kind is refused", lambda: mod.put_source("box", {**src, "data": {**src["data"], "kind": "pigeon"}}), 422)
check("secret stored", mod.set_secret("box-pass", {"value": "hunter2"})["ref"] == "box-pass")
check("secrets list refs only", mod.list_secrets() == {"refs": ["box-pass"]})
secrets_file = Path(DATA) / "secrets.json"
check("secret file is private", oct(secrets_file.stat().st_mode & 0o777) == "0o600", oct(secrets_file.stat().st_mode & 0o777))
check("sources never carry the value", "hunter2" not in (Path(DATA) / "sources" / "box.json").read_text())
check("sftp source test says configured", mod.test_source("box")["ok"] is True)
local = {"$axf": "asset@1", "type": "icon-source", "id": "lib", "name": "Lib", "version": "1.0.0", "data": {"kind": "local", "root": "framework/icon-library/feather", "auth": {"mode": "none"}}}
mod.put_source("lib", local)
t = mod.test_source("lib")
check("local source test counts icon-pack files", t["ok"] is True and t["packs"] >= 1, str(t))
check("delete secret", mod.delete_secret("box-pass")["removed"] is True)
check("delete source", mod.delete_source("box")["removed"] is True and mod.delete_source("lib")["removed"] is True)

# import a folder of SVGs (feather's, from the test cache when present; else skipped)
cache = Path(os.environ.get("AXF_ICON_CACHE", "/tmp/icon-sets")) / "feather-icons" / "package" / "dist" / "icons"
if cache.is_dir():
    r = mod.import_folder({"folder": str(cache), "id": "feather-copy", "style": "outline", "grid": 24, "stroke": 2})
    check("import converts a folder into packs", r["ok"] is True and r.get("count", 0) > 200, str(r)[:200])
    check("imported pack is served", mod.get_pack("feather-copy-a-z")["type"] == "icon-pack")
    mod.delete_pack("feather-copy-a-z")
refused("import needs an id", lambda: mod.import_folder({"folder": str(cache), "id": "Bad Id"}), 422)
refused("import needs a folder", lambda: mod.import_folder({"folder": "/nonexistent/x", "id": "ok-id"}), 422)

# settings
c = mod.get_config()
check("default config", c["view"] == "grid" and c["panes"]["composer"] is True)
c = mod.put_config({"view": "tree", "tile": "xl", "panes": {"composer": False}, "openNewGroup": "floating", "junk": 1})
check("config keeps known values", c["view"] == "tree" and c["tile"] == "md" and c["panes"] == {"library": True, "composer": False, "details": True} and c["openNewGroup"] == "floating" and "junk" not in c)

print(f"✓ icon-browser server: {n} checks")
