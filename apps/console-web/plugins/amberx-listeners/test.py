"""AmberX listeners server part: the routes over the Node core (devices, policies, registry, state, set a policy, restart),
bad input answered 400, the hub document written as hub-settings@1.

    python apps/console-web/plugins/amberx-listeners/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))  # plugin_services, for the console's import style
PROJECTS = Path(tempfile.mkdtemp(prefix="axf-amberx-listeners-"))
os.environ["AXF_AMBERX_LISTENERS_PROJECTS"] = str(PROJECTS)

spec = importlib.util.spec_from_file_location("amberx_listeners_server", HERE / "server" / "__init__.py")
mod = importlib.util.module_from_spec(spec)
assert spec.loader is not None
spec.loader.exec_module(mod)

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):
    request.state.axf_user = types.SimpleNamespace(name="brett", admin=True, via="session")
    return await call_next(request)


app.include_router(mod.router, prefix="/api/plugins/amberx-listeners")
c = TestClient(app)
n = failed = 0


def ok(cond: object, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"FAIL {what}")


# empty hub
r = c.get("/api/plugins/amberx-listeners/devices")
ok(r.status_code == 200 and r.json()["ok"] and r.json()["count"] == 0, "devices: none yet")
r = c.get("/api/plugins/amberx-listeners/policies")
ok(r.status_code == 200 and r.json()["policies"]["talk"]["retries"] == 6, "policies: defaults")
r = c.get("/api/plugins/amberx-listeners/registry")
ok(r.status_code == 200 and any(l["id"] == "handsfree" for l in r.json()["listeners"]), "registry")

# a phone publishes
d = PROJECTS / "amberx-axf" / "_data" / "listeners" / "devices"
d.mkdir(parents=True)
now = int(time.time() * 1000)
(d / "rows-0.json").write_text(json.dumps({"p1": {"$axf": "listener-state@1", "device": "p1", "name": "Phone", "app": "amberx-droid", "at": now, "side": "native", "micOff": False, "micHolder": "handsfree",
                                                  "listeners": [{"id": "handsfree", "state": "on", "detail": "Idle (wake word)", "holdsMic": True}, {"id": "talk", "state": "off"}]}}))
r = c.get("/api/plugins/amberx-listeners/state")
j = r.json()
ok(r.status_code == 200 and j["ok"] and len(j["devices"]) == 1 and j["devices"][0]["summary"].startswith("1 listening") and "handsfree" in j["policies"] and len(j["registry"]) >= 12, "state: devices + policies + registry")
ok(j["devices"][0]["listeners"][0]["stateLabel"] == "Idle (wake word)" and j["devices"][0]["stale"] is False, "state words and freshness")

# set a policy
r = c.post("/api/plugins/amberx-listeners/policy", json={"id": "handsfree", "policy": {"pauseOnCall": False, "retries": 3}})
ok(r.status_code == 200 and r.json()["policy"]["pauseOnCall"] is False and r.json()["policy"]["retries"] == 3, "set a policy")
doc = json.loads((PROJECTS / "_shared" / "_data" / "settings" / "apps" / "amberx-droid.json").read_text())
ok(doc["$axf"] == "hub-settings@1" and doc["values"]["amberx.listeners.handsfree.pauseOnCall"] is False and doc["values"]["amberx.listeners.handsfree.retries"] == "3" and doc["updatedBy"] == "console:brett", "the hub document, written by Brett's console")
ok(c.get("/api/plugins/amberx-listeners/devices").json()["devices"][0]["listeners"][0]["policy"]["retries"] == 3, "device rows show the new policy")

# bad input
ok(c.post("/api/plugins/amberx-listeners/policy", json={"id": "handsfree"}).status_code == 400, "no policy → 400")
ok(c.post("/api/plugins/amberx-listeners/policy", json={"id": "handsfree", "policy": {"bogus": True}}).status_code == 400, "unknown field → 400")
ok(c.post("/api/plugins/amberx-listeners/policy", json={"id": "No Way", "policy": {"on": True}}).status_code == 400, "bad id → 400")
ok(c.post("/api/plugins/amberx-listeners/policy", content=b"not json").status_code == 400, "not JSON → 400")

# restart
r = c.post("/api/plugins/amberx-listeners/restart", json={"id": "talk"})
ok(r.status_code == 200 and r.json()["restartAskedAt"].startswith("20"), "restart asked")
ok(c.post("/api/plugins/amberx-listeners/restart", json={"id": "oneshot"}).status_code == 400, "a listener without its own switch can't be restarted")
ok(c.get("/api/plugins/amberx-listeners/policies").json()["policies"]["talk"]["restartAskedAt"] == r.json()["restartAskedAt"], "policies show the restart request")

print(f"✗ amberx-listeners server — {failed}/{n} failed" if failed else f"✓ amberx-listeners server — {n} checks")
sys.exit(1 if failed else 0)
