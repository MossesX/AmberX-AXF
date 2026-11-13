#!/usr/bin/env python3
"""Self-test for the Skins plugin: server routes on scratch look documents.

    python3 apps/console-web/plugins/skin-gallery/test.py

Checks the gallery list, state per scope, use → back → restore → undo round trips at hub, app and plugin scope, the
deep link, and refusal of an unknown skin, a bad scope and an undo with nothing to undo.
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
REPO = HERE.parents[3]
TMP = Path(tempfile.mkdtemp(prefix="axf-skins-test-"))
(TMP / "looks").mkdir()
(TMP / "appearance.json").write_text(json.dumps({"colorTheme": "x"}) + "\n")
os.environ["AXF_APPEARANCE_FILE"] = str(TMP / "appearance.json")
os.environ["AXF_LOOKS_DIR"] = str(TMP / "looks")
subprocess.run(["node", "framework/cli/skins.mjs", "snapshot", "axf-console", "--json"], cwd=REPO, check=True, capture_output=True)

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.skin_gallery_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
fails: list[str] = []


def check(name: str, ok: bool, detail: object = "") -> None:
    print(("ok   " if ok else "FAIL ") + name + ("" if ok else f"  {detail}"))
    if not ok:
        fails.append(name)


r = c.get("/p/skins").json()
check("list", r["ok"] and len(r["result"]) > 0, r)
skin = r["result"][0]["id"]
other = r["result"][1]["id"]

r = c.get("/p/state", params={"scope": "hub"}).json()
check("hub starts off", r["result"]["state"]["use"] == "off", r)

r = c.post("/p/use", json={"skin": skin, "scope": "hub"}).json()
check("use at hub", r["result"]["inForce"]["id"] == skin and r["result"]["canUndo"], r)
check("hub written to the shared document", json.loads((TMP / "appearance.json").read_text()).get("skin", {}).get("id") == skin)

r = c.post("/p/use", json={"skin": other, "scope": "app"}).json()
check("use at app", r["result"]["state"]["use"] == "on" and r["result"]["inForce"]["id"] == other and r["result"]["inForce"]["from"] == "app", r)

r = c.post("/p/use", json={"skin": skin, "scope": "plugin:theme-manager"}).json()
check("use at plugin", r["result"]["inForce"]["from"] == "plugin:theme-manager", r)
check("scopes list the plugin scope", "plugin:theme-manager" in c.get("/p/scopes").json()["result"])

r = c.post("/p/undo", json={}).json()
check("undo the plugin switch", r["result"]["state"]["use"] == "inherit" and r["result"]["inForce"]["id"] == other, r)

r = c.post("/p/back", json={"scope": "app"}).json()
check("back keeps the skin", r["result"]["inForce"]["id"] == other, r)

r = c.post("/p/restore", json={"scope": "hub"}).json()
check("restore hub clears the hub-wide skin", r["result"]["state"]["use"] == "off" and "skin" not in json.loads((TMP / "appearance.json").read_text()), r)
r = c.post("/p/undo", json={}).json()
check("undo restore puts the hub-wide skin back", r["result"]["state"]["id"] == skin, r)
r = c.post("/p/undo", json={})
check("second undo refused", r.status_code == 409 and r.json()["code"] == "nothing-to-undo", r.text)

r = c.post("/p/use", json={"skin": "no-such-skin"})
check("unknown skin refused", r.status_code == 404, r.text)
r = c.get("/p/state", params={"scope": "nowhere:x"})
check("bad scope refused", r.status_code == 400, r.text)
r = c.post("/p/use", json={})
check("use without skin refused", r.status_code == 400, r.text)

r = c.get("/p/open", params={"skin": skin, "scope": "hub"}).json()
check("deep link", r["result"]["target"] == "skin-gallery" and f"skin={skin}" in r["result"]["link"], r)

print(f"\n{'FAILED ' + str(len(fails)) if fails else 'all passed'}")
sys.exit(1 if fails else 0)
