"""Auto-lander routes in the gate plugin (build auto-lander-controls-in-the-gate-plugin, Nov 15 2026): every route goes
through auto-lander@1, skip and land now carry confirm, land now is Brett's own click, no provider = 503.

    python apps/console-web/plugins/build-orchestrator/server/test_lander.py
"""
from __future__ import annotations

import sys
from importlib import import_module
from pathlib import Path
from types import SimpleNamespace

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))
sys.path.insert(0, str(HERE.parents[1]))

import plugin_services  # noqa: E402
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

srv = import_module("build-orchestrator.server")
n = 0


def check(ok: bool, name: str) -> None:
    global n
    if not ok:
        raise SystemExit(f"✗ {name}")
    n += 1
    print(f"  ✓ {name}")


class Fake:
    """Stands in for the push banner's auto-lander@1 and records every call."""
    def __init__(self) -> None:
        self.calls: list[tuple] = []
        self.on, self.mode = True, "serial"

    def status(self): self.calls.append(("status",)); return {"enabled": self.on, "mode": self.mode, "reason": "ci-waiting", "landing": {"pr": 686}}
    def line(self): self.calls.append(("line",)); return {"line": [{"position": 1, "pr": 686}, {"position": 2, "pr": 633}]}
    def runs(self, limit=50): self.calls.append(("runs", limit)); return {"runs": [{"result": "landing"}]}
    def cron(self): return {"last": None, "enabled": self.on}
    def set_enabled(self, on): self.calls.append(("enabled", on)); self.on = on; return self.status()
    def set_mode(self, mode): self.calls.append(("mode", mode)); self.mode = mode; return self.status()

    def act(self, action, pr, why="", confirm=False, owner=""):
        from fastapi import HTTPException
        self.calls.append(("act", action, pr, why, confirm, owner))
        if action in ("skip", "land-now") and not confirm:
            raise HTTPException(409, f"{action} needs confirm: true")
        if action == "land-now" and not owner:
            raise HTTPException(403, "Land now is Brett's own click")
        return {"ok": True, "action": action, "pr": pr}


app = FastAPI()
brett = {"on": False}


@app.middleware("http")
async def who(request: Request, call_next):
    if brett["on"]:
        request.state.axf_user = SimpleNamespace(via="session", admin=True, name="brett")
    return await call_next(request)

app.include_router(srv.router, prefix="/p")
c = TestClient(app)
print("build-orchestrator: auto-lander routes")

r = c.get("/p/auto-lander/status")
check(r.status_code == 503 and "auto-lander@1" in r.json()["detail"], "no provider: 503 with the reason")

fake = Fake()
plugin_services.provide("auto-lander@1", fake, "push-banner")
check(c.get("/p/auto-lander/status").json()["landing"]["pr"] == 686, "GET status through auto-lander@1")
check(len(c.get("/p/auto-lander/line").json()["line"]) == 2, "GET line")
check(c.get("/p/auto-lander/runs?limit=5").status_code == 200 and fake.calls[-1] == ("runs", 5), "GET runs passes the limit")
check(c.post("/p/auto-lander/enabled", json={"enabled": False}).json()["enabled"] is False, "POST enabled false")
check(c.post("/p/auto-lander/enabled", json={"enabled": "no"}).status_code == 400, "POST enabled refuses a non-boolean")
check(c.post("/p/auto-lander/mode", json={"mode": "merge-queue"}).json()["mode"] == "merge-queue", "POST mode")
check(c.post("/p/auto-lander/mode", json={"mode": "fast"}).status_code == 400, "POST mode refuses an unknown mode")
check(c.post("/p/auto-lander/line/move", json={"pr": 633, "direction": "up"}).json()["action"] == "move-up", "POST line/move up")
check(c.post("/p/auto-lander/line/move", json={"pr": "#633", "direction": "down"}).json()["action"] == "move-down", "POST line/move down, '#633' accepted")
check(c.post("/p/auto-lander/line/move", json={"pr": 0}).status_code == 400, "a bad PR number is refused")
check(c.post("/p/auto-lander/line/skip", json={"pr": 640, "why": "waits for #637"}).status_code == 409, "POST line/skip without confirm: 409")
check(c.post("/p/auto-lander/line/skip", json={"pr": 640, "confirm": True}).status_code == 400, "POST line/skip without a reason: 400")
check(c.post("/p/auto-lander/line/skip", json={"pr": 640, "why": "waits for #637", "confirm": True}).json()["ok"], "POST line/skip with reason and confirm")
check(c.post("/p/auto-lander/line/unskip", json={"pr": 640}).json()["action"] == "unskip", "POST line/unskip")
check(c.post("/p/auto-lander/line/land-now", json={"pr": 633, "confirm": True}).status_code == 403, "POST line/land-now from a token: 403")
brett["on"] = True
check(c.post("/p/auto-lander/line/land-now", json={"pr": 633}).status_code == 409, "POST line/land-now without confirm: 409")
r = c.post("/p/auto-lander/line/land-now", json={"pr": 633, "confirm": True})
check(r.json()["ok"] and fake.calls[-1][-1] == "brett", "POST line/land-now: Brett's click with confirm goes through")
src = (HERE / "lander.py").read_text()
check("push-banner" not in src.split('"""', 2)[2].replace("the push banner", ""), "the routes never name the push banner's folder (capability only)")
print(f"build-orchestrator auto-lander routes: {n} checks passed")
