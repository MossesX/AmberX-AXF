#!/usr/bin/env python3
"""Self-test for the Agent cap plugin: routes through framework/cli/agent-slots.mjs on a scratch store, settings hot
reload, queue Move up / Cancel, and the systems-check probe (memory guard trips, swap in use for long).

    python3 apps/console-web/plugins/agent-slots/test.py
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
STORE = Path(tempfile.mkdtemp(prefix="axf-slots-test-"))
os.environ.update(AXF_SLOTS_DIR=str(STORE), AXF_SLOTS_TMUX="off", AXF_SLOTS_MEM_GB="8", AXF_SLOTS_SWAP_MB="0")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.agent_slots_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/agent-slots")
c = TestClient(app)
CLI = REPO / "framework" / "cli" / "agent-slots.mjs"
n = failed = 0


def ok(cond: bool, what: str) -> None:
    global n, failed
    n += 1
    if not cond:
        failed += 1
        print(f"FAIL {what}")


def cli(*args: str) -> str:
    return subprocess.run(["node", str(CLI), *args], capture_output=True, text=True, cwd=REPO, env=os.environ).stdout.strip()


ok(mod.ROOT == REPO, f"repo root found ({mod.ROOT})")
s = c.get("/api/plugins/agent-slots/status").json()
ok(s.get("cap") == 6 and s.get("used") == 0, f"defaults: 0/6 ({s})")

r = c.put("/api/plugins/agent-slots/settings", json={"maxAgents": 1, "bogus": 3})
ok(r.status_code == 200 and r.json()["maxAgents"] == 1 and "bogus" not in r.json(), "settings saved, unknown keys dropped")
ok(c.put("/api/plugins/agent-slots/settings", json={"nope": 1}).status_code == 400, "nothing to save = 400")
ok(json.loads(cli("settings", "--json"))["maxAgents"] == 1, "the CLI sees the console's save at once (hot reload)")

pid = str(os.getpid())
a = json.loads(cli("enqueue", "--name", "a", "--pid", pid, "--json"))
b = json.loads(cli("enqueue", "--name", "b", "--pid", pid, "--json"))
u = json.loads(cli("enqueue", "--name", "c", "--pid", pid, "--json"))
ok(a["started"] and not b["started"] and not u["started"], "cap 1: one starts, two wait")
s = mod.status(fresh=True)
ok([q["name"] for q in s["queue"]] == ["b", "c"], f"queue in order ({[q['name'] for q in s['queue']]})")
r = c.post(f"/api/plugins/agent-slots/queue/{u['id']}/up")
ok(r.status_code == 200 and [q["name"] for q in r.json()["status"]["queue"]] == ["c", "b"], "Move up")
r = c.post(f"/api/plugins/agent-slots/queue/{b['id']}/cancel")
ok(r.status_code == 200 and [q["name"] for q in r.json()["status"]["queue"]] == ["c"], "Cancel")
ok(c.post(f"/api/plugins/agent-slots/queue/{b['id']}/cancel").status_code == 409, "cancel twice = 409")
ok(c.post("/api/plugins/agent-slots/queue/bad$id/up").status_code in (400, 404), "bad id refused")
ok(plugin_services.get("axf.agent-slots@1").status()["queued"] == 1, "capability axf.agent-slots@1")

# systems-check probe
base = {"used": 1, "cap": 6, "queued": 0, "memory": {"availGb": 6, "floorGb": 2}, "settings": {"guardWarnTrips": 5, "swapWarnMin": 30}, "guard": {"tripsLastHour": 0}, "swap": {"since": None, "mb": 0}}
ok(mod.health_probe(base)["status"] == "ok", "probe ok")
ok(mod.health_probe({**base, "guard": {"tripsLastHour": 7}})["status"] == "warn", "probe warns on guard trips")
ok(mod.health_probe({**base, "swap": {"since": 0, "mb": 900}}, now_ms=31 * 60000)["status"] == "warn", "probe warns on swap in use 31 min")
ok(mod.health_probe({**base, "swap": {"since": 0, "mb": 900}}, now_ms=5 * 60000)["status"] == "ok", "short swap use is fine")
ok(mod.health_probe({"error": "x"})["status"] == "unknown", "unreadable store = unknown")


class Reg:
    def __init__(self) -> None:
        self.got: dict = {}

    def register(self, spec: dict, owner: str = "") -> str:
        self.got = {**spec, "owner": owner}
        return spec["id"]


reg = Reg()
plugin_services.provide("axf.health@1", reg, "systems-check")
mod._health_done = False
ok(mod.ensure_health() and reg.got.get("id") == "agent-slots-memory" and reg.got["owner"] == "agent-slots", "registers its systems-check item")
ok(reg.got["run"]()["status"] in ("ok", "warn"), "registered check runs")

print(f"agent-slots plugin: {n - failed}/{n} checks passed")
sys.exit(1 if failed else 0)
