"""AmberX settings server part: the registry over the hub-settings@1 document (list, get, set with checks, reset),
per-key writes that keep a phone's other keys, auto-approve settings refused to a token and taken from a person's
browser, the document with its ETag and If-Match.

    python apps/console-web/plugins/amberx-settings/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
sys.path.insert(0, str(HERE.parents[3] / "framework" / "python"))
PROJECTS = Path(tempfile.mkdtemp(prefix="axf-amberx-settings-"))
os.environ["AXF_AMBERX_SETTINGS_PROJECTS"] = str(PROJECTS)

spec = importlib.util.spec_from_file_location("amberx_settings_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)
mod.wall.wall_caller = lambda h: types.SimpleNamespace(name="brett", admin=True, via="session") if h.get("x-person") else None

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
fails = 0
PERSON = {"x-person": "1"}
DOC = PROJECTS / "_shared" / "_data" / "settings" / "apps" / "amberx-droid.json"


def eq(a: Any, b: Any, what: str) -> None:
    global fails
    if a != b:
        fails += 1
        print(f"FAIL {what}: {a!r} != {b!r}")


reg = json.loads((HERE / "registry.json").read_text())["settings"]
eq(len({s["key"] for s in reg}), len(reg), "registry keys are unique")
eq(all(s["doc"].startswith("amberx.") for s in reg), True, "registry document keys are AmberX's")

DOC.parent.mkdir(parents=True)
DOC.write_text(json.dumps({"$axf": "hub-settings@1", "values": {"amberx.voice.lang": "en-GB", "amberx.phone.own": 7}, "updatedAt": "", "updatedBy": ""}))

lst = c.get("/settings").json()
lang = next(s for s in lst["settings"] if s["key"] == "voice.lang")
eq((lang["value"], lang["overridden"], lst["live"]), ("en-GB", True, True), "reads the phone's value")
eq(c.get("/settings/monitor.interval").json()["setting"]["value"], 30, "default when unset")
eq(c.get("/settings/nope").status_code, 404, "unknown key")

eq(c.put("/settings/monitor.interval", json={"value": 5}).status_code, 400, "range")
eq(c.put("/settings/voice.mode", json={"value": "loud"}).status_code, 400, "choice")
eq(c.put("/settings/quiet", json={"value": "yes"}).status_code, 400, "toggle")
eq(c.put("/settings/voice.lang", json={"value": "english"}).status_code, 400, "pattern")
eq(c.put("/settings/monitor.interval", json={"value": 60}).json()["setting"]["value"], 60, "set")
doc = json.loads(DOC.read_text())
eq((doc["values"]["amberx.monitor.interval"], doc["values"]["amberx.phone.own"], doc["updatedBy"]), (60, 7, "console"), "per-key write keeps the phone's keys")

eq(c.put("/settings/monitor.autoApproveAll", json={"value": True}).status_code, 403, "auto-approve refused to a token")
eq(c.put("/settings/monitor.autoApproveAll", json={"value": True}, headers=PERSON).status_code, 200, "auto-approve from a person's browser")
eq(json.loads(DOC.read_text())["updatedBy"], "web:brett", "updatedBy is the person")
eq(c.post("/settings/monitor.autoApproveAll/reset").status_code, 403, "auto-approve reset refused to a token")

eq(c.post("/settings/voice.lang/reset").json()["setting"]["value"], "en-US", "reset to the default")
eq("amberx.voice.lang" in json.loads(DOC.read_text())["values"], False, "reset removes the key")

r = c.get("/document")
tag = r.headers["etag"]
eq(r.json()["$axf"], "hub-settings@1", "document")
eq(c.put("/document", json={"values": {"amberx.voice.swears": False}}, headers={"if-match": '"stale"'}).status_code, 412, "If-Match conflict")
eq(c.put("/document", json={"values": {"amberx.monitor.autoApprove": True}}, headers={"if-match": tag}).status_code, 403, "document refuses sensitive keys to a token")
r = c.put("/document", json={"values": {"amberx.voice.swears": False, "amberx.phone.own": None, "amberx.phone.new": "x"}}, headers={"if-match": tag})
eq(r.status_code, 200, "document merge")
v = json.loads(DOC.read_text())["values"]
eq((v["amberx.voice.swears"], "amberx.phone.own" in v, v["amberx.phone.new"]), (False, False, "x"), "merge: set, remove, keep unknown keys")
eq(c.put("/document", json={"values": {"other.key": 1}}).status_code, 400, "only AmberX keys")

print("amberx-settings:", "ok" if not fails else f"{fails} failed")
sys.exit(1 if fails else 0)
