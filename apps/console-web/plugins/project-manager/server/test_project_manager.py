"""Routes + axf.projects@1 of the Project Manager plugin, on a scratch data folder (python3 -m pytest or run directly)."""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services


def load():
    spec = importlib.util.spec_from_file_location("pm_server", HERE / "__init__.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)  # type: ignore[union-attr]
    return mod


def test_routes_and_service() -> None:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    with tempfile.TemporaryDirectory() as tmp:
        os.environ["AXF_PROJECT_MANAGER_DATA"] = tmp
        mod = load()
        app = FastAPI()
        app.include_router(mod.router)
        c = TestClient(app)
        assert c.get("/projects").json()["projects"][0]["id"] == "console"
        r = c.post("/projects", json={"name": "Demo App", "type": "app", "scaffold": False})
        assert r.status_code == 200 and r.json()["project"]["id"] == "demo-app"
        assert c.post("/projects", json={"name": ""}).status_code == 400
        assert c.post("/open", json={"id": "nope"}).status_code == 404
        assert c.put("/settings", json={"multiView": True, "layout": "split"}).json()["settings"]["multiView"] is True
        assert c.post("/preview", json={"open": True, "mode": "dock", "project": "demo-app"}).json()["preview"]["mode"] == "dock"
        svc = mod.ProjectsService()
        assert svc.data_dir("demo-app", "notes").endswith("projects/demo-app/notes")
        assert svc.data_dir("console") is None
        assert c.post("/delete", json={"id": "demo-app", "data": True}).json()["dataRemoved"] is True


if __name__ == "__main__":
    test_routes_and_service()
    print("project-manager server: ok")
