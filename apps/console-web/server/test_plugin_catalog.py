"""Console routes for the plugin catalog (plugin-catalog@1) on a scratch catalog. Run: python apps/console-web/server/test_plugin_catalog.py"""
from __future__ import annotations

import base64
import json
import os
import sys
import tempfile
from pathlib import Path

_tmp = tempfile.TemporaryDirectory()
TOKEN = "t" * 32
os.environ["AXF_STATE"] = str(Path(_tmp.name) / "state.json")
os.environ.setdefault("AXF_DATA_DIR", "off")
os.environ["AXF_TOKEN"] = TOKEN
os.environ["AXF_PLUGIN_CATALOG"] = str(Path(_tmp.name) / "catalog")
os.environ.pop("GITHUB_TOKEN", None)
sys.path.insert(0, os.path.dirname(__file__))

from fastapi.testclient import TestClient  # noqa: E402

import main  # noqa: E402

c = TestClient(main.app, raise_server_exceptions=False)
H = {"authorization": f"Bearer {TOKEN}"}
ok = fail = 0


def check(name: str, cond: bool) -> None:
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("✗", name)


def b64(s: str) -> str:
    return base64.b64encode(s.encode()).decode()


man = {"$axf": "pilot-plugin@1", "id": "ai.amberx.pilot.extra-steps", "name": "Extra steps", "version": "1.0.0", "stacks": ["*"]}
pkg = {"$axf": "plugin-package@1", "kind": "pilot", "folder": "extra-steps", "files": [{"path": "plugin.json", "b64": b64(json.dumps(man))}, {"path": "web/index.tsx", "b64": b64("export const plugin = {};")}]}

check("list needs the token", c.get("/api/plugin-catalog").status_code == 401)
r = c.get("/api/plugin-catalog", headers=H)
check("empty catalog lists", r.status_code == 200 and r.json()["items"] == [] and "root" not in r.json())
check("publish needs the token", c.post("/api/plugin-catalog/publish", json={"package": pkg}).status_code == 401)
r = c.post("/api/plugin-catalog/publish", headers=H, json={"package": pkg, "from": "test"})
check("publish a pilot package", r.status_code == 200 and r.json()["published"] is True)
r = c.post("/api/plugin-catalog/publish", headers=H, json={"package": {**pkg, "files": pkg["files"] + [{"path": "server/x.py", "b64": b64("x")}]}})
check("pilot package with server code refused", r.status_code == 400)
r = c.post("/api/plugin-catalog/publish", headers=H, json={"folder": "plugin-switches"})
check("publish a console plugin from this clone", r.status_code == 200 and r.json()["item"]["folder"] == "plugin-switches")
check("publish an unknown folder = 404", c.post("/api/plugin-catalog/publish", headers=H, json={"folder": "no-such-plugin"}).status_code == 404)
items = c.get("/api/plugin-catalog", headers=H).json()["items"]
sw = next(i for i in items if i["folder"] == "plugin-switches")
check("installed console plugin is marked", sw["installed"] == sw["version"] and sw["clash"] is False)
check("kind filter", [i["kind"] for i in c.get("/api/plugin-catalog?kind=pilot", headers=H).json()["items"]] == ["pilot"])
r = c.get("/api/plugin-catalog/package?kind=pilot&folder=extra-steps", headers=H)
check("package served", r.status_code == 200 and r.json()["sha256"] and len(r.json()["files"]) == 2)
check("package needs the token", c.get("/api/plugin-catalog/package?kind=pilot&folder=extra-steps").status_code == 401)
check("missing package = 404", c.get("/api/plugin-catalog/package?kind=pilot&folder=nope-nope", headers=H).status_code == 404)
check("bad folder refused", c.get("/api/plugin-catalog/package?kind=pilot&folder=../x", headers=H).status_code == 400)
check("install needs confirm", c.post("/api/plugin-catalog/install", headers=H, json={"folder": "plugin-switches"}).status_code == 400)
r = c.post("/api/plugin-catalog/install", headers=H, json={"folder": "plugin-switches", "confirm": "plugin-switches"})
check("install over an installed plugin without update refused", r.status_code == 400 and "already installed" in r.json().get("detail", ""))
check("remove needs confirm", c.post("/api/plugin-catalog/remove", headers=H, json={"kind": "pilot", "folder": "extra-steps"}).status_code == 400)
r = c.post("/api/plugin-catalog/remove", headers=H, json={"kind": "pilot", "folder": "extra-steps", "confirm": "extra-steps"})
check("remove from the catalog", r.status_code == 200 and all(i["folder"] != "extra-steps" for i in c.get("/api/plugin-catalog", headers=H).json()["items"]))
os.environ["AXF_PLUGIN_CATALOG"] = "off"
check("no catalog = 503 on package", c.get("/api/plugin-catalog/package?kind=pilot&folder=extra-steps", headers=H).status_code == 503)
check("no catalog = list says unreachable", c.get("/api/plugin-catalog", headers=H).json()["reachable"] is False)

print(f"console plugin catalog: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
