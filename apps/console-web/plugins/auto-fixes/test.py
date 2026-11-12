"""Auto-fixes server part: the list (count, what each job is trying now), the voice answer, the display setting
(banner / widget / off, live), dismiss, and AmberX delivery through control@1 (one log note per job, rewritten as it
moves; exactly one FYI when it gives up).

    python apps/console-web/plugins/auto-fixes/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services, axf_framework
os.environ["AXF_AUTO_FIXES_DATA_DIR"] = tempfile.mkdtemp()
os.environ["AXF_RETRY_DIR"] = tempfile.mkdtemp()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import axf_framework  # noqa: E402,F401
import plugin_services  # noqa: E402
from axf_server import retry  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


class FakeControl:
    """control@1 with just amberx.lists / amberx.items."""

    def __init__(self) -> None:
        self.lists: dict[str, dict] = {}
        self.items: dict[str, dict] = {}

    def run(self, c: dict, grants: list[str], by: str) -> dict:
        if c["target"] == "amberx.lists":
            if c["op"] == "list":
                return {"ok": True, "items": [l for l in self.lists.values() if c["select"]["q"] in l["name"]]}
            l = {"id": f"l{len(self.lists) + 1}", "name": c["value"]["name"]}
            self.lists[l["id"]] = l
            return {"ok": True, "item": l}
        if c["op"] == "add":
            it = {"id": f"i{len(self.items) + 1}", **c["value"]}
            self.items[it["id"]] = it
            return {"ok": True, "item": it}
        if c["op"] == "set":
            self.items[c["path"]].update(c["value"])
            return {"ok": True, "item": self.items[c["path"]]}
        return {"ok": False}


control = FakeControl()
plugin_services.provide("control@1", control, folder="token-control")
plugin_services._is_enabled = lambda folder: True  # type: ignore[attr-defined]  # every plugin on in this test

spec = importlib.util.spec_from_file_location("auto_fixes_server", HERE / "server" / "__init__.py")
af = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
sys.modules[spec.name] = af  # type: ignore[union-attr]  # pydantic resolves the route models through it
spec.loader.exec_module(af)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(af.router, prefix="/api/plugins/auto-fixes")
c = TestClient(app)
svc = plugin_services.get("auto-fixes@1")
ok(svc is not None, "provides auto-fixes@1")

# empty
s = c.get("/api/plugins/auto-fixes/state").json()
ok(s["count"] == 0 and s["display"] == "banner" and s["rows"] == [], s)
ok(c.get("/api/plugins/auto-fixes/say").json()["text"] == "Nothing is failing right now.", "voice: nothing failing")

# a job being fixed, then one that gives up: the runner in this process tells the capability
runner = retry.Runner(on_change=af.deliver, on_fyi=af.deliver, delay_scale=0)
calls = {"n": 0}


def once_locked(ctx: dict) -> dict:
    calls["n"] += 1
    return {"ok": calls["n"] > 1} if calls["n"] > 1 else {"ok": False, "code": "store_locked", "message": "builds store is locked"}


fixed, _ = runner.run("builds store write", once_locked, ok=lambda r: None if r["ok"] else r)
gave, _ = runner.run("pending change", lambda ctx: {"ok": False, "status": 503, "message": "service unavailable"}, ok=lambda r: None if r["ok"] else r)

s = c.get("/api/plugins/auto-fixes/state").json()
ok(s["count"] == 1 and s["gaveUp"] == 1 and s["rows"][0]["id"] == gave["id"], s)
ok(s["rows"][0]["now"] == "service down: gave up after 3 fixes", s["rows"][0]["now"])
ok(any("restarting the container via Coolify: no automatic fix for this here" in m for m in s["rows"][0]["missing"]), s["rows"][0]["missing"])
ok(s["rows"][1]["now"] == "fixed: waited for the lock", s["rows"][1])
say = c.get("/api/plugins/auto-fixes/say").json()["text"]
ok(say.startswith("0 calls being fixed, 1 gave up. pending change: service down: gave up after 3 fixes"), say)

j = c.get(f"/api/plugins/auto-fixes/jobs/{gave['id']}").json()
ok("1. " in j["log"] and "health-checking the service, step 1 of 3" in j["log"] and j["amberxNote"], j)
ok(c.get("/api/plugins/auto-fixes/jobs/nope-0000").status_code == 404, "unknown job 404")

# AmberX: an "Automatic fixes" list, one note per job (rewritten, not duplicated), one FYI for the job that gave up
ok([l["name"] for l in control.lists.values()] == ["Automatic fixes"], control.lists)
notes = [i for i in control.items.values() if "auto-fix" in i.get("tags", []) and "fyi" not in i.get("tags", [])]
fyis = [i for i in control.items.values() if "fyi" in i.get("tags", [])]
ok(len(notes) == 2 and all(n["list"] == "l1" for n in notes), notes)
ok(len(fyis) == 1 and fyis[0]["title"] == "FYI: pending change gave up" and "Tried: health-checked the service" in fyis[0]["text"], fyis)
af.deliver(runner.get(gave["id"]))  # the sweep sees it again: nothing new
ok(len(control.items) == 3, f"no duplicates: {len(control.items)}")

# display setting: banner → widget → off, read back (what every console polls)
for d in ("widget", "off", "banner"):
    ok(c.post("/api/plugins/auto-fixes/settings", json={"display": d}).json()["display"] == d, d)
    ok(c.get("/api/plugins/auto-fixes/state").json()["display"] == d, f"state shows {d}")
ok(c.post("/api/plugins/auto-fixes/settings", json={"display": "sideways"}).status_code == 422, "bad display refused")

# dismiss
ok(c.post("/api/plugins/auto-fixes/dismiss", json={"id": gave["id"]}).json()["count"] == 0, "dismissed")
ok(c.post("/api/plugins/auto-fixes/dismiss", json={"id": "nope-0000"}).status_code == 404, "dismiss unknown 404")

print(f"✓ auto-fixes — {checks} checks")
