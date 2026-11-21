"""Host services plugin: its own routes (the ones the plugin commands, and so the MCP tools host_services_*, call)
answer like the core /api/host-services: the down state, confirm on destructive presses, the list.

    python apps/console-web/plugins/host-services/test.py
"""
from __future__ import annotations

import importlib.util
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE.parents[1] / "server"
sys.path.insert(0, str(SERVER))

from fastapi import FastAPI  # noqa: E402
from fastapi.responses import JSONResponse  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import host_services as hs  # noqa: E402

spec = importlib.util.spec_from_file_location("hs_plugin", HERE / "server" / "__init__.py")
plugin = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(plugin)  # type: ignore[union-attr]


def _app() -> TestClient:
    hs.set_client(hs.HostServices({"AXF_HOST_API": "unix:/nonexistent/api.sock", "AXF_HOST_API_FALLBACK": ""}))
    app = FastAPI()
    app.include_router(plugin.router, prefix="/p")
    app.add_exception_handler(hs.HostServiceError, lambda _r, e: JSONResponse(e.frame(), status_code=e.status_code))  # type: ignore[attr-defined]
    return TestClient(app)


def test_routes_down_and_confirm() -> None:
    t = _app()
    lst = t.get("/p/").json()
    assert lst["down"]["code"] == "host_service_down" and all(s["status"] == "unknown" for s in lst["services"])
    assert t.get("/p/builds-live").status_code == 503
    assert t.get("/p/builds-live/logs").json()["code"] == "host_service_down"
    for path in ("/p/builds-live/rollback", "/p/builds-live/act"):
        r = t.post(path, json={"do": "restart"} if path.endswith("act") else {})
        assert r.status_code == 428 and r.json()["code"] == "confirm_required", r.json()
    assert t.put("/p/builds-live/mode", json={"to": "bogus"}).json()["code"] == "invalid_body"
    assert t.put("/p/builds-live/settings", json={}).json()["code"] == "invalid_body"


if __name__ == "__main__":
    test_routes_down_and_confirm()
    print("✓ host-services plugin routes: 1 test")
