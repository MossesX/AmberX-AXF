"""host-service@1, console half: the client (host_services.py), the REST routes (host_services_routes.py) and the systems-check items, against a real host API (deploy/host-services/axf-hostd.mjs) started
in a temp folder with systemctl / sudo stubs, and against no host API at all.

    python apps/console-web/server/tests/test_host_services.py      (pytest picks up the test_* functions too)

Covers: the down state (503 host_service_down frame, every service unknown with since, the voice line), the endpoint
order (socket, then loopback with the token), the list / get / logs / settings reads, destructive presses answering
428 confirm_required until confirm, actions forwarded to the service socket, mode changes guarded (shadow first),
rollback, the health@1 items (host-api not installed / down with what it breaks; a service up, in container mode,
down), and the capability axf.host-services@1.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = SERVER.parents[2]
sys.path.insert(0, str(SERVER))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import host_services as hs  # noqa: E402
import host_services_routes as routes  # noqa: E402


def _load(name: str, path: Path) -> Any:
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def _app(client: hs.HostServices) -> TestClient:
    app = FastAPI()
    app.include_router(routes.router_for(lambda: None, client=lambda: client))
    app.add_exception_handler(hs.HostServiceError, lambda _r, e: JSONResponse(e.frame(), status_code=e.status_code))  # type: ignore[attr-defined]
    return TestClient(app)


class Host:
    """A host API + one demo service in a temp checkout (the same stubs as deploy/host-services/test-hostd.mjs)."""

    def __init__(self) -> None:
        self.t = Path(tempfile.mkdtemp(prefix="axf-hs-py-"))
        r = self.t / "root"
        (r / "deploy/host-services/services").mkdir(parents=True)
        (r / "deploy/host-services/workers").mkdir(parents=True)
        (r / "framework/core").mkdir(parents=True)
        shutil.copy(ROOT / "framework/core/host-services.mjs", r / "framework/core/")
        # the runner keeps its state through the data layer (data-files.mjs) and that reads the path map
        for f in ("data-files.mjs", "data-store.mjs", "clip.mjs", "tracking-paths.mjs"):
            shutil.copy(ROOT / "framework/core" / f, r / "framework/core/")
        (r / "framework/schemas").mkdir(parents=True, exist_ok=True)
        shutil.copy(ROOT / "framework/schemas/data-store-paths.json", r / "framework/schemas/")
        shutil.copy(ROOT / "deploy/host-services/axf-hostd.mjs", r / "deploy/host-services/")
        shutil.copy(ROOT / "deploy/host-services/services/host-api.json", r / "deploy/host-services/services/")
        (r / "deploy/host-services/services/demo.json").write_text(json.dumps({
            "$axf": "host-service@1", "id": "demo", "title": "Demo", "kind": "daemon", "unit": "axf-demo.service", "plugin": "console",
            "runner": "deploy/host-services/workers/demo.mjs", "health": {"intervalSec": 5},
            "actions": [{"id": "wipe", "title": "Wipe", "confirm": True}, {"id": "echo", "title": "Echo"}],
            "settings": {"intervalSec": {"type": "integer", "default": 5, "min": 5, "max": 600}}}))
        (r / "deploy/host-services/workers/demo.mjs").write_text(
            "export const intervalSec = 5;\nexport async function tick(ctx) { return { result: 'ok', message: ctx.dryRun ? 'dry' : 'real' }; }\n"
            "export const actions = { wipe: async () => ({ wiped: true }), echo: async () => ({ hi: true }) };\n")
        b = self.t / "bin"
        b.mkdir()
        units = self.t / "units"
        units.mkdir()
        (units / "axf-demo.service").write_text("active")
        (b / "sudo").write_text(f"#!/bin/sh\nprintf '%s\\n' \"$*\" >> {self.t}/sudo.log\n[ \"$2\" = /usr/bin/systemctl ] || exit 0\n"
                                f"case \"$3\" in stop) echo inactive > {units}/$4 ;; start|restart) echo active > {units}/$4 ;; esac\n")
        (b / "systemctl").write_text(f"#!/bin/sh\ns=$(cat {units}/$2 2>/dev/null || echo inactive)\nprintf 'ActiveState=%s\\nMainPID=7\\nNRestarts=0\\nUnitFileState=enabled\\nLoadState=loaded\\n' \"$s\"\n")
        (b / "journalctl").write_text("#!/bin/sh\necho '2026-11-18T00:00:00+0000 host demo[1]: one line'\n")
        for f in b.iterdir():
            f.chmod(0o755)
        self.port = 23000 + os.getpid() % 2000
        self.env = {**os.environ, "AXF_HOST_ROOT": str(r), "AXF_HOST_DATA": str(self.t / "data"), "AXF_HOST_SOCKET_DIR": str(self.t / "run"),
                    "AXF_HOST_TOKEN": "tok", "AXF_HOST_SYSTEMCTL": str(b / "systemctl"), "AXF_HOST_JOURNALCTL": str(b / "journalctl"), "AXF_HOST_SUDO": str(b / "sudo")}
        self.procs = [
            subprocess.Popen(["node", str(r / "deploy/host-services/axf-hostd.mjs"), "demo"], env={**self.env, "AXF_HOST_PORT": ""}, stdout=subprocess.DEVNULL),
            subprocess.Popen(["node", str(r / "deploy/host-services/axf-hostd.mjs"), "host-api"], env={**self.env, "AXF_HOST_PORT": str(self.port)}, stdout=subprocess.DEVNULL),
        ]
        for _ in range(100):
            if (self.t / "run/api.sock").exists() and (self.t / "run/demo.sock").exists():
                break
            time.sleep(0.1)
        self.socket = str(self.t / "run/api.sock")

    def client(self, **env: str) -> hs.HostServices:
        return hs.HostServices({"AXF_HOST_API": f"unix:{self.socket}", "AXF_HOST_API_FALLBACK": "", "AXF_HOST_TOKEN": "tok", **env})

    def close(self) -> None:
        for p in self.procs:
            p.kill()
        shutil.rmtree(self.t, ignore_errors=True)


DOWN = hs.HostServices({"AXF_HOST_API": "unix:/nonexistent/api.sock", "AXF_HOST_API_FALLBACK": "http://127.0.0.1:9"})


def test_endpoints_order() -> None:
    eps = hs.endpoints({})
    assert [e["url"] for e in eps] == ["unix:/run/axf-host/api.sock", "http://host.docker.internal:7788"]
    assert [e["kind"] for e in hs.endpoints({"AXF_HOST_API": "", "AXF_HOST_API_FALLBACK": "http://h:1"})] == ["http"]


def test_down_state() -> None:
    t = _app(DOWN)
    r = t.get("/api/host-services")
    assert r.status_code == 200
    body = r.json()
    assert body["down"]["code"] == "host_service_down" and body["hostApi"]["up"] is False
    assert all(s["status"] == "unknown" and s["reachable"] is False and s["since"] for s in body["services"])
    r = t.get("/api/host-services/builds-live")
    assert r.status_code == 503 and r.json()["$axf"] == "host-error@1" and r.json()["code"] == "host_service_down" and r.json()["service"] == "host-api"
    try:
        DOWN.service("x")
    except hs.HostServiceError as e:
        assert e.down and e.voice().startswith("The host API is down")


def test_confirm_on_destructive_presses() -> None:
    t = _app(DOWN)
    for path, body in [("/api/host-services/x/unit/restart", {}), ("/api/host-services/x/unit/stop", {}), ("/api/host-services/x/rollback", {}),
                       ("/api/host-services/x/act", {"do": "restart"})]:
        r = t.post(path, json=body)
        assert r.status_code == 428 and r.json()["code"] == "confirm_required", (path, r.json())
    # with confirm the call goes through to the (dead) host: 503, not 428
    assert t.post("/api/host-services/x/unit/restart", json={"confirm": True}).status_code == 503
    assert t.post("/api/host-services/x/unit/start", json={}).status_code == 503  # start is not destructive


def test_against_a_live_host() -> None:
    h = Host()
    try:
        c = h.client()
        t = _app(c)
        lst = t.get("/api/host-services?fresh=true").json()
        assert sorted(s["id"] for s in lst["services"]) == ["demo", "host-api"], lst
        assert lst["hostApi"]["up"] is True
        demo = t.get("/api/host-services/demo?lines=5").json()
        assert demo["unit"] == "axf-demo.service" and demo["mode"] == "container" and demo["logs"][0]["line"].endswith("one line")
        # loopback with the token works when the socket is gone from the config
        lb = hs.HostServices({"AXF_HOST_API": "", "AXF_HOST_API_FALLBACK": f"http://127.0.0.1:{h.port}", "AXF_HOST_TOKEN": "tok"})
        assert lb.health()["ok"] is True and lb.endpoint_used.startswith("http://")
        bad = hs.HostServices({"AXF_HOST_API": "", "AXF_HOST_API_FALLBACK": f"http://127.0.0.1:{h.port}", "AXF_HOST_TOKEN": "nope"})
        try:
            bad.services(fresh=True)
            raise AssertionError("a wrong token was accepted")
        except hs.HostServiceError as e:
            assert e.code == "unauthorized"
        # actions: refused in container mode, then forwarded in shadow
        r = t.post("/api/host-services/demo/actions/echo", json={})
        assert r.status_code == 409 and r.json()["code"] == "mode_refused"
        assert t.put("/api/host-services/demo/mode", json={"to": "host"}).json()["code"] == "invalid_body"  # shadow first
        assert t.put("/api/host-services/demo/mode", json={"to": "shadow"}).json()["mode"] == "shadow"
        assert t.post("/api/host-services/demo/actions/echo", json={}).json()["result"] == {"hi": True}
        assert t.post("/api/host-services/demo/actions/wipe", json={}).status_code == 428
        assert t.post("/api/host-services/demo/actions/wipe", json={"confirm": True}).json()["result"] == {"wiped": True}
        assert t.post("/api/host-services/demo/actions/nope", json={}).json()["code"] == "unknown_action"
        # settings
        assert t.put("/api/host-services/demo/settings", json={"set": {"intervalSec": 60}}).json()["settings"]["intervalSec"] == 60
        assert t.put("/api/host-services/demo/settings", json={"set": {"nope": 1}}).json()["code"] == "unknown_setting"
        # moving back needs confirm; rollback with confirm stops the unit through sudo
        assert t.put("/api/host-services/demo/mode", json={"to": "container"}).status_code == 428
        rb = t.post("/api/host-services/demo/rollback", json={"confirm": True, "why": "test"}).json()
        assert rb["to"] == "container" and rb["ok"] is True
        assert "-n /usr/bin/systemctl stop axf-demo.service" in (h.t / "sudo.log").read_text()
        # the health@1 items
        hh = _load("host_health", ROOT / "apps/console-web/plugins/systems-check/server/host_health.py")  # axf-plugin:systems-check
        regs: dict[str, Any] = {}

        class Reg:
            def register(self, spec: dict[str, Any], owner: str = "") -> None:
                regs[spec["id"]] = spec

        os.environ["AXF_HOST_SERVICES"] = "1"
        hh.register(Reg(), ROOT, client=lambda: c)
        assert "host-api" in regs and "host-service:builds-live" in regs
        assert regs["host-api"]["run"]()["status"] == "ok"
        down = {}
        hh.register(type("R", (), {"register": lambda self, s, o="": down.__setitem__(s["id"], s)})(), ROOT, client=lambda: DOWN)
        st = down["host-api"]["run"]()
        assert st["status"] == "error" and "What that breaks" in " ".join(st["details"]) and "since" in st["summary"]
        assert down["host-service:builds-live"]["run"]().get("unreachable") is True
        os.environ.pop("AXF_HOST_SERVICES")
        os.environ.pop("AXF_HOST_API", None)
        assert down["host-api"]["run"]()["status"] == "ok"  # not installed yet: green, says so
    finally:
        h.close()


def test_capability() -> None:
    import plugin_services

    hs.register()
    assert plugin_services.get(hs.CAPABILITY) is hs.client()


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
            print(f"  ✓ {name}")
    print(f"✓ host services (console half): {n} tests")
