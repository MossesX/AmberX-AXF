#!/usr/bin/env python3
"""Self-test for the Plugins menu plugin's server part (scratch data folder, a scratch catalog folder, a fake axHub).

    python3 apps/console-web/plugins/plugins-menu/test.py
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
os.environ["AXF_PLUGINS_MENU_DIR"] = tempfile.mkdtemp(prefix="axf-plugins-menu-test-")
os.environ.pop("AXHUB_TOKEN", None)
os.environ.pop("GITHUB_TOKEN", None)
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.plugins_menu_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0
fail = 0


def check(cond, msg):
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print(f"✗ {msg}")


# --- a scratch catalog folder with one plugin published (the real CLI, AXF_PLUGIN_CATALOG = that folder)
cat = Path(tempfile.mkdtemp(prefix="axf-plugins-menu-cat-"))
src = Path(tempfile.mkdtemp(prefix="axf-plugins-menu-src-")) / "demo-widget"
src.mkdir()
(src / "plugin.json").write_text(json.dumps({"$axf": "plugin@1", "id": "ai.amberx.axf.console.demo-widget", "name": "Demo widget", "version": "1.0.0", "kind": "module",
                                             "apiLevel": 1, "description": "test", "provides": [], "builtWith": {"model": "opus", "builtAt": "2026-10-23"}}))
pub = subprocess.run(["node", str(REPO / "framework/cli/plugin-catalog.mjs"), "publish", str(src), "--kind", "console", "--json"], capture_output=True, text=True,
                     env={**os.environ, "AXF_PLUGIN_CATALOG": str(cat)})
check(pub.returncode == 0, f"publish into the scratch catalog: {pub.stdout[-200:]} {pub.stderr[-200:]}")

# --- archives: axHub is there, permanent, needs a credential
r = c.get("/p/archives").json()
hub = next(a for a in r["archives"] if a["id"] == "axhub")
check(hub["permanent"] and hub["kind"] == "axhub", "axHub is the permanent archive")
check(hub["needsCredential"] and not hub["auth"]["set"], "axHub needs a credential and none is set")
check(any(k["id"] == "github" and not k["built"] for k in r["kinds"]), "placeholder kinds are listed as not built")
check(c.delete("/p/archives/axhub").status_code == 400, "axHub can't be removed")
t = c.post("/p/archives/axhub/test").json()["test"]
check(not t["ok"] and "credential" in t["error"], f"axHub without a token says it needs credentials: {t}")

# a fake hub: the token must reach it, and nothing else
seen = {}


class FakeHub:
    def __init__(self, base, token):
        seen["token"] = token

    def read(self, path, cap=0):
        seen["path"] = path
        if token_ok():
            return json.dumps({"$axf": "plugin-catalog@1", "items": [{"kind": "console", "folder": "demo-widget", "id": "ai.amberx.axf.console.demo-widget", "name": "Demo widget", "version": "1.0.0", "versions": ["1.0.0"], "builtWith": {"model": "opus"}}]})
        raise mod.ArchiveError("axHub refused the credentials: check the axHub token")


def token_ok():
    return seen.get("token") == "hub-secret-123"


mod.HUB_FACTORY = FakeHub
r = c.post("/p/archives", json={"id": "axhub", "auth": {"type": "bearer", "token": "hub-secret-123"}})
check(r.status_code == 200, f"save the axHub token: {r.text[:200]}")
body = json.dumps(c.get("/p/archives").json())
check("hub-secret-123" not in body, "the token never comes back to the browser")
check(next(a for a in c.get("/p/archives").json()["archives"] if a["id"] == "axhub")["auth"]["set"], "axHub shows its credential as set")
t = c.post("/p/archives/axhub/test").json()["test"]
check(t["ok"] and t["count"] == 1 and seen["path"] == "plugin-catalog/catalog.json", f"axHub test reads the index with the token: {t}")
raw = (Path(os.environ["AXF_PLUGINS_MENU_DIR"]) / "archives.json")
check((raw.stat().st_mode & 0o077) == 0, "archives.json is private (0600)")
check(c.post("/p/archives", json={"id": "axhub", "enabled": False}).status_code == 200 and next(a for a in c.get("/p/archives").json()["archives"] if a["id"] == "axhub")["enabled"], "axHub can't be switched off")
r = c.post("/p/archives", json={"id": "axhub", "auth": {"type": "basic", "user": "x", "password": "y"}})
check(r.status_code == 400, "axHub takes only a token")

# --- folder archive
r = c.post("/p/archives", json={"kind": "folder", "label": "Scratch", "location": str(cat)})
check(r.status_code == 200, f"add a folder archive: {r.text[:200]}")
fid = r.json()["archive"]["id"]
check(c.post("/p/archives", json={"kind": "folder", "location": "relative/path"}).status_code == 400, "a folder archive needs an absolute path")
check(c.post("/p/archives", json={"kind": "https", "location": "http://example.com"}).status_code == 400, "an https archive refuses plain http")
check(c.post("/p/archives", json={"kind": "github", "location": "MossesX/x"}).status_code == 400, "a placeholder kind can't be saved")
check(c.post("/p/archives", json={"kind": "axhub", "location": "https://x"}).status_code == 400, "a second axHub can't be added")
b = c.get(f"/p/browse?archive={fid}").json()
check(len(b["items"]) == 1 and b["items"][0]["folder"] == "demo-widget" and b["items"][0]["installed"] is None, f"browse the folder archive: {b}")
b = c.get("/p/browse?archive=all&q=nothing-like-this").json()
check(b["items"] == [] and len(b["archives"]) == 2, "search filters across every archive")
b = c.get("/p/browse?archive=all").json()
check(len(b["items"]) == 2 and {i["archive"] for i in b["items"]} == {"axhub", fid}, "every archive is listed")
it = c.get(f"/p/item?archive={fid}&folder=demo-widget").json()["item"]
check(it["name"] == "Demo widget" and it["clash"] is None, "item details")

# --- installed marks: a plugin already here, the same plugin under another folder = a clash
have = mod.installed()
check("plugin-manager" in have and "plugins-menu" in have, "the installed plugins are read from the repo")
m = mod.mark({"kind": "console", "folder": "plugin-manager-opus", "id": "x.other", "name": "Plugin Manager", "version": "9.0.0"}, have)
check(bool(m["clash"]), f"another build of an installed plugin is a clash: {m['clash']}")
real = have["plugin-manager"]
m = mod.mark({"kind": "console", "folder": "plugin-manager", "id": real["id"], "name": real["name"], "version": "9.9.9", "builtWith": {"model": "sonnet"}}, have)
check(m["installed"] == real["version"] and m["otherModel"] and m["model"] == "sonnet", f"another model's build of an installed plugin = replace: {m}")

# --- install refuses without the confirm, a bad folder, a missing plugin
check(c.post("/p/install", json={"archive": fid, "folder": "demo-widget"}).status_code == 400, "install needs the typed confirm")
check(c.post("/p/install", json={"archive": fid, "folder": "../x", "confirm": "../x"}).status_code == 400, "a bad folder is refused")
check(c.post("/p/install", json={"archive": fid, "folder": "not-there", "confirm": "not-there"}).status_code == 502, "a plugin not in the archive is refused")
check(c.post("/p/install", json={"archive": fid, "folder": "demo-widget", "confirm": "demo-widget", "replace": True}).status_code == 400, "replace needs 'replace <folder>'")
# the package read from a folder archive is the verified one
pkg = mod.read_package({"kind": "folder", "location": str(cat), "label": "x"}, "console", "demo-widget", "1.0.0")
check(pkg.get("$axf") == "plugin-package@1" and pkg.get("folder") == "demo-widget", "a folder archive's package is read through the CLI")

# --- config
cfg = c.get("/p/config").json()["config"]
check(cfg["publish"] is True and cfg["sort"] == "name" and cfg["pageSize"] == 50, "config defaults")
cfg = c.put("/p/config", json={"sort": "evil", "pageSize": 5000, "confirmTyping": False, "nope": 1}).json()["config"]
check(cfg["sort"] == "name" and cfg["pageSize"] == 200 and cfg["confirmTyping"] is False and "nope" not in cfg, "config is cleaned")

# --- removing an added archive
check(c.delete(f"/p/archives/{fid}").status_code == 200 and all(a["id"] != fid for a in c.get("/p/archives").json()["archives"]), "an added archive can be removed")

shutil.rmtree(cat, ignore_errors=True)
shutil.rmtree(src.parent, ignore_errors=True)
print(f"plugins-menu: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
