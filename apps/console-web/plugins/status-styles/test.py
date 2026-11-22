#!/usr/bin/env python3
"""Self-test for the Status styles plugin's server part (temp data folder, the real router through FastAPI's client).

    python3 apps/console-web/plugins/status-styles/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA = Path(tempfile.mkdtemp(prefix="axf-status-styles-test-"))
os.environ["AXF_STATUS_STYLES_DIR"] = str(DATA)
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("status_styles_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)

app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
N = 0


def ok(v, what):
    global N
    N += 1
    if not v:
        raise SystemExit(f"FAILED: {what}")


LIB = json.loads((HERE / "assets" / "status-style" / "library.json").read_text())["data"]
DEFAULT = json.loads((HERE / "assets" / "status-style" / "default.json").read_text())["data"]

# the shipped assets hold together
ids = [p["id"] for p in LIB["presets"]]
ok(len(ids) == len(set(ids)) and len(ids) >= 60, "library: unique preset ids, a big library")
ok(all({s["preset"], s["badgePreset"]} <= set(ids) for s in DEFAULT["statuses"].values()), "defaults point at shipped presets")
ok(all(mod.STATUS_RE.match(k) for k in DEFAULT["statuses"]), "default status ids are status ids")
for want in ("scoring-risk", "fast-merge", "post-merge-ci", "rolling-back", "rolled-back", "building", "failed", "landed"):
    ok(want in DEFAULT["statuses"], f"default for {want}")

# nothing saved yet
r = c.get("/config").json()
ok(r == {"config": {"$axf": "status-styles@1"}, "presets": []}, "empty to start")

# save changes
r = c.put("/config", json={"rows": False, "statuses": {"building": {"preset": "row-blink-slow", "animated": True}, "waiting-review": {"label": " Waiting\x00review ", "preset": "plain"}}})
ok(r.status_code == 200 and r.json()["config"]["rows"] is False, "saved")
cfg = c.get("/config").json()["config"]
ok(cfg["statuses"]["building"] == {"preset": "row-blink-slow", "animated": True}, "read back")
ok(cfg["statuses"]["waiting-review"]["label"] == "Waiting review", "labels lose control characters")
ok(json.loads((DATA / "config.json").read_text())["$axf"] == "status-styles@1", "in the plugin's data folder")
ok(oct((DATA / "config.json").stat().st_mode & 0o777) == "0o600", "private file")

# refused, with the reason, and nothing changed
for bad, why in [
    ([], "an object"), ({"enabled": "yes"}, "true or false"), ({"statuses": []}, "statuses is an object"),
    ({"statuses": {"Bad Id": {}}}, "not a status id"), ({"statuses": {"building": {"css": "x"}}}, "only label"),
    ({"statuses": {"building": {"preset": "a b"}}}, "preset id"), ({"statuses": {"building": {"preset": "x} body{display:none"}}}, "preset id"),
    ({"statuses": {"building": {"animated": 1}}}, "true or false"),
]:
    r = c.put("/config", json=bad)
    ok(r.status_code == 400 and why in r.json()["detail"], f"refused: {bad} ({r.status_code} {r.text[:80]})")
ok(c.get("/config").json()["config"] == cfg, "a refused save changes nothing")

# own presets
mine = {"id": "my-calm", "name": "Calm green sweep", "target": "row", "effect": "sweep", "tone": "success", "speed": 60, "strength": 50, "direction": "alternate", "tint": 4, "edge": True}
r = c.post("/presets", json=mine)
ok(r.status_code == 200 and r.json()["saved"]["dim"] == 0 and r.json()["saved"]["bold"] is False, "saved with the defaults filled in")
ok(c.post("/presets", json={**mine, "speed": 80}).json()["presets"][0]["speed"] == 80 and len(c.get("/presets").json()["presets"]) == 1, "same id replaces")
ok(c.get("/presets").json()["builtIn"] == len(ids), "and says how many are built in")
ok(c.get("/config").json()["presets"][0]["id"] == "my-calm", "config carries them too (one request on load)")
for bad, why in [
    ({"id": "plain", "name": "x"}, "built-in"), ({"id": "My Id"}, "id:"), ({"id": "my-a", "target": "page"}, "target"),
    ({"id": "my-a", "target": "text", "effect": "stripes"}, "effect for text"), ({"id": "my-a", "effect": "explode"}, "effect for row"),
    ({"id": "my-a", "tone": "#ff0000"}, "tone"), ({"id": "my-a", "direction": "up"}, "direction"), ({"id": "my-a", "speed": 5}, "speed"),
    ({"id": "my-a", "speed": "fast"}, "speed"), ({"id": "my-a", "tint": 99}, "tint"), ({"id": "my-a", "bold": "yes"}, "bold"), ("x", "one preset"),
]:
    r = c.post("/presets", json=bad)
    ok(r.status_code == 400 and why in r.json()["detail"], f"refused preset: {bad} ({r.text[:80]})")
ok(len(c.get("/presets").json()["presets"]) == 1, "refused presets are not saved")

# a damaged file never breaks the page
(DATA / "presets.json").write_text(json.dumps({"presets": [mine, {"id": "plain"}, "junk", {"id": "my-b", "tone": "nope"}]}))
ok([p["id"] for p in c.get("/presets").json()["presets"]] == ["my-calm"], "bad saved rows are skipped")
(DATA / "config.json").write_text(json.dumps({"statuses": {"Bad": 1}}))
ok(c.get("/config").json()["config"] == {"$axf": "status-styles@1"}, "a bad saved config reads as empty")

# remove, reset
ok(c.delete("/presets/nope").status_code == 404, "no such preset")
ok(c.delete("/presets/my-calm").json() == {"removed": "my-calm", "presets": []}, "removed")
c.put("/config", json={"enabled": False})
ok(c.put("/config", json={"reset": True}).json()["config"] == {"$axf": "status-styles@1"}, "back to the shipped styles")

# the limit on own presets
mod.write_presets([mod.clean_preset({"id": f"my-{j}"}) for j in range(LIB["limits"]["presets"])])
ok(c.post("/presets", json={"id": "my-one-more"}).status_code == 400, "the library of own presets is capped")
ok(c.post("/presets", json={"id": "my-0", "name": "Still fine"}).status_code == 200, "replacing one at the cap still works")

print(f"status-styles server: {N} checks passed")
