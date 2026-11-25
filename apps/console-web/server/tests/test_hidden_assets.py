"""hidden-assets@1 over REST: /api/hidden-assets list, hide, unhide, unhide-all, against the real writer
(framework/cli/hidden-assets.mjs) on a look document in a temp folder.

    python apps/console-web/server/tests/test_hidden_assets.py      (pytest picks up the test_* functions too)
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
ROOT = HERE.parents[3]

_TMP = tempfile.mkdtemp(prefix="hidden-assets-test-")
os.environ["AXF_LOOKS_DIR"] = _TMP
os.environ["AXF_APPEARANCE_FILE"] = str(Path(_TMP) / "appearance.json")

from fastapi import FastAPI, Header, HTTPException  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import hidden_assets  # noqa: E402

TOKEN = "t-hidden"


def _auth(authorization: str = Header("")) -> None:
    if authorization != f"Bearer {TOKEN}":
        raise HTTPException(401, "token required")


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(hidden_assets.router_for(_auth))
    return TestClient(app)


def _fresh_look(app: str = "axf-console") -> None:
    """A look document the way an app writes it the first time it opens (skin-rules newAppLook)."""
    for f in Path(_TMP).glob("*.json"):
        f.unlink()
    js = f"import('{(ROOT / 'framework/core/engines/skin-rules.mjs').as_posix()}').then((m) => process.stdout.write(JSON.stringify(m.newAppLook('{app}', {{ slots: {{}} }}))))"
    doc = subprocess.run(["node", "-e", js], capture_output=True, text=True, check=True).stdout
    (Path(_TMP) / f"{app}.json").write_text(doc)


def _doc(app: str = "axf-console") -> dict:
    return json.loads((Path(_TMP) / f"{app}.json").read_text())


H = {"Authorization": f"Bearer {TOKEN}"}


def test_list_empty() -> None:
    _fresh_look()
    r = _client().get("/api/hidden-assets")
    assert r.status_code == 200, r.text
    assert r.json()["app"] == "axf-console" and r.json()["count"] == 0 and r.json()["hidden"] == []


def test_hide_unhide_unhide_all() -> None:
    _fresh_look()
    c = _client()
    r = c.post("/api/hidden-assets/hide", json={"kind": "toolbar", "id": "app"}, headers=H)
    assert r.status_code == 200 and r.json()["changed"] is True and r.json()["count"] == 1, r.text
    entry = _doc()["own"]["hiddenAssets"][0]
    assert entry["kind"] == "toolbar" and entry["id"] == "app" and entry["by"] == "api:rest" and entry["hiddenAt"]
    assert _doc()["updatedBy"] == "api:rest"
    # hiding again keeps the first entry
    r = c.post("/api/hidden-assets/hide", json={"kind": "toolbar", "id": "app", "by": "someone"}, headers=H)
    assert r.json()["changed"] is False and r.json()["hidden"][0]["by"] == "api:rest"
    # a widget id carries its own colon; the alias names the same app
    r = c.post("/api/hidden-assets/hide", json={"app": "console", "kind": "widget", "id": "clock:main", "by": "voice"}, headers=H)
    assert r.json()["count"] == 2 and r.json()["hidden"][1]["by"] == "voice"
    listed = c.get("/api/hidden-assets?app=console").json()
    assert [f"{e['kind']}:{e['id']}" for e in listed["hidden"]] == ["toolbar:app", "widget:clock:main"]
    r = c.post("/api/hidden-assets/unhide", json={"kind": "toolbar", "id": "app"}, headers=H)
    assert r.json()["changed"] is True and r.json()["count"] == 1
    r = c.post("/api/hidden-assets/unhide", json={"kind": "toolbar", "id": "app"}, headers=H)
    assert r.json()["changed"] is False
    r = c.post("/api/hidden-assets/unhide-all", json={}, headers=H)
    assert r.json()["changed"] is True and r.json()["shown"] == 1
    assert "hiddenAssets" not in _doc()["own"], "an empty list leaves no field behind"
    r = c.post("/api/hidden-assets/unhide-all", headers=H)
    assert r.status_code == 200 and r.json()["changed"] is False


def test_refusals() -> None:
    _fresh_look()
    c = _client()
    assert c.post("/api/hidden-assets/hide", json={"kind": "toolbar", "id": "app"}).status_code == 401, "writes need the token"
    assert c.post("/api/hidden-assets/hide", json={"kind": "grid", "id": "x"}, headers=H).status_code == 400, "unknown kind"
    assert c.post("/api/hidden-assets/hide", json={"kind": "context-menu", "id": "app"}, headers=H).status_code == 400, "a context menu has no region"
    assert c.post("/api/hidden-assets/hide", json={"kind": "toolbar", "id": "Bad Id"}, headers=H).status_code == 400, "bad id"
    assert c.get("/api/hidden-assets?app=nope-app").status_code == 404, "unknown app"
    assert c.get("/api/hidden-assets?app=Bad!").status_code == 400, "bad app name"
    for f in Path(_TMP).glob("*.json"):
        f.unlink()
    r = c.post("/api/hidden-assets/hide", json={"kind": "toolbar", "id": "app"}, headers=H)
    assert r.status_code == 404 and "no look document" in r.json()["detail"], "no document yet: says how to get one"
    assert c.get("/api/hidden-assets").json()["count"] == 0, "no document reads as nothing hidden"


def test_mcp_tools() -> None:
    import asyncio
    import mcp_server
    _fresh_look()
    server = mcp_server.build_server(lambda op, **a: {}, terminal=lambda since: [], control=lambda c: {"ok": True})

    def call(name: str, args: dict) -> dict:
        out = asyncio.run(server.call_tool(name, args))
        res = out[1] if isinstance(out, tuple) else out
        if isinstance(res, dict):
            return res.get("result", res)
        if getattr(res, "isError", False):
            raise RuntimeError(" ".join(getattr(c, "text", "") for c in res.content))
        sc = getattr(res, "structuredContent", None)
        if isinstance(sc, dict):
            return sc.get("result", sc)
        return json.loads(res.content[0].text)

    r = call("hidden_assets_hide", {"kind": "tab-group", "id": "settings.tabs"})
    assert r["changed"] is True and r["hidden"][0]["by"] == "api:mcp", r
    assert call("hidden_assets_list", {})["count"] == 1
    assert call("hidden_assets_unhide", {"kind": "tab-group", "id": "settings.tabs"})["count"] == 0
    call("hidden_assets_hide", {"kind": "banner", "id": "top", "app": "console"})
    assert call("hidden_assets_unhide_all", {})["shown"] == 1
    try:
        call("hidden_assets_hide", {"kind": "toolbar", "id": "Bad Id"})
        raise AssertionError("a bad id is refused")
    except Exception as e:  # ToolError surfaces as an exception from call_tool
        assert "piece id" in str(e) or "id must" in str(e), e


def test_mounted_in_main() -> None:
    src = (HERE.parent / "main.py").read_text()
    assert "app.include_router(hidden_assets.router_for(auth))" in src
    assert src.index("hidden_assets.router_for") < src.index('@app.get("/{path:path}")'), "mounted before the page fallback"


if __name__ == "__main__":
    try:
        n = 0
        for name, fn in list(globals().items()):
            if name.startswith("test_") and callable(fn):
                fn()
                n += 1
        print(f"test_hidden_assets: {n} tests passed")
    finally:
        shutil.rmtree(_TMP, ignore_errors=True)
