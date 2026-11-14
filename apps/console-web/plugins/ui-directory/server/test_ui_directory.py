"""Server tests for the UI Directory routes added for the page: GET/POST page, POST show, POST open.

python3 apps/console-web/plugins/ui-directory/server/test_ui_directory.py
The directory is built into a temp data folder; console-commands@1 is a stub that records what it was asked to run.
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[2] / "server"))  # plugin_services
os.environ["AXF_UI_DIRECTORY_DIR"] = tempfile.mkdtemp()

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import plugin_services  # noqa: E402

sent: list[dict[str, Any]] = []


class Commands:
    def run(self, command: dict[str, Any], grants: Any = None, by: str = "", audience: str = "") -> dict[str, Any]:
        sent.append(command)
        return {"ok": True, "ran": command["path"]}


plugin_services.provide("console-commands@1", Commands(), "console-commands")
spec = importlib.util.spec_from_file_location("ui_directory_server", HERE / "__init__.py")
mod = importlib.util.module_from_spec(spec)  # type: ignore[arg-type]
spec.loader.exec_module(mod)  # type: ignore[union-attr]
app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)


def test_page_state_round_trip() -> None:
    assert c.get("/page").json()["q"] == ""
    p = c.post("/page", json={"q": "toolbar", "kind": "settings-tab", "open": ["a"], "all": False, "shown": 4, "total": 575, "junk": 1}).json()
    assert p["q"] == "toolbar" and p["kind"] == "settings-tab" and p["shown"] == 4 and "junk" not in p and p["at"]
    assert c.get("/page").json() == p


def test_show_sends_the_filters_to_the_console() -> None:
    sent.clear()
    r = c.post("/show", json={"q": "builds", "app": "console-web"}).json()
    assert r["ok"]
    cmd = sent[-1]
    assert cmd["path"] == "ui-directory.show" and cmd["input"]["args"][:2] == ["q=builds", "app=console-web"]


def test_open_a_row_and_its_settings() -> None:
    assert c.post("/rebuild", json={"reason": "test"}).status_code == 200
    sent.clear()
    r = c.post("/open", json={"id": "console-web:settings-panel:ui-directory.status"}).json()
    assert r["ok"] and r["row"]["id"] == "console-web:settings-panel:ui-directory.status" and r["reach"]["cli"].startswith("axf console do open")
    assert sent[-1]["path"] == "ui-directory.open-row" and sent[-1]["input"]["args"] == ["console-web%3Asettings-panel%3Aui-directory.status"]
    s = c.post("/open", json={"id": "console-web:screen:ui-directory", "settings": True}).json()
    assert s["row"]["id"] == "console-web:settings-tab:ui-directory"
    assert c.post("/open", json={"id": "nope:screen:x"}).status_code == 404


if __name__ == "__main__":
    n = 0
    for name, fn in list(globals().items()):
        if name.startswith("test_") and callable(fn):
            fn()
            n += 1
    print(f"ui-directory server: {n} tests passed")
