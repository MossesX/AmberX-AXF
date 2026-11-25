"""Hidden assets (hidden-assets@1) over REST: what is hidden in an app, hide a piece, bring one or all back.

    GET  /api/hidden-assets?app=<app>                     {app, count, hidden: [{kind, id, hiddenAt, by, assetRef?}]}
    POST /api/hidden-assets/hide        {app?, kind, id, by?}
    POST /api/hidden-assets/unhide      {app?, kind, id}
    POST /api/hidden-assets/unhide-all  {app?}

The list is the app's own look document on the hub (`shared/settings/looks/<app>.json` → `own.hiddenAssets`). Every
write goes through framework/cli/hidden-assets.mjs, the one writer outside a running app (it reuses the look writer of
skins.mjs), so the console, the CLI, MCP and voice change the same document and an open app follows through the hub's
change feed. `app` is an app id (axf-console) or an alias (console, axhub, amberx); default the console.

The MCP tools (hidden_assets_*, mcp_server.py) call the same functions.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, Depends, HTTPException

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "framework" / "cli" / "hidden-assets.mjs"
KINDS = ("tab-group", "toolbar", "banner", "nav-menu", "app-menu", "widget")
_APP = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
_ID = re.compile(r"^[a-z0-9][a-z0-9._:/-]{0,119}$")
_BY = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:@-]{0,79}$")

# tests point this at a stub; the default runs node
Runner = Callable[[list[str]], dict[str, Any]]


def _node(args: list[str]) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30, env=os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"hidden-assets.mjs didn't run: {e}"}
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


runner: Runner = _node


def _app(app: Any) -> list[str]:
    if app in (None, ""):
        return []
    if not isinstance(app, str) or not _APP.match(app):
        raise ValueError("app must be an app id or alias (axf-console, console, axhub, amberx)")
    return ["--app", app]


def _target(kind: Any, id_: Any) -> list[str]:
    if kind not in KINDS:
        raise ValueError(f"kind must be one of {', '.join(KINDS)}")
    if not isinstance(id_, str) or not _ID.match(id_):
        raise ValueError("id must be a piece id: lower case letters, digits and . _ : / - (up to 120)")
    return [kind, id_]


def _by(by: Any, default: str) -> list[str]:
    who = by if isinstance(by, str) and _BY.match(by) else default
    return ["--by", who]


def list_hidden(app: str | None = None) -> dict[str, Any]:
    return runner(["list", *_app(app)])


def hide(app: str | None, kind: str, id_: str, by: str | None = None, default_by: str = "api:rest") -> dict[str, Any]:
    return runner(["hide", *_target(kind, id_), *_app(app), *_by(by, default_by)])


def unhide(app: str | None, kind: str, id_: str, by: str | None = None, default_by: str = "api:rest") -> dict[str, Any]:
    return runner(["unhide", *_target(kind, id_), *_app(app), *_by(by, default_by)])


def unhide_all(app: str | None = None, by: str | None = None, default_by: str = "api:rest") -> dict[str, Any]:
    return runner(["unhide-all", *_app(app), *_by(by, default_by)])


def _answer(fn: Callable[[], dict[str, Any]]) -> dict[str, Any]:
    try:
        res = fn()
    except ValueError as e:
        raise HTTPException(400, str(e))
    if not res.get("ok"):
        err = str(res.get("error", "failed"))
        raise HTTPException(404 if err.startswith("no app") or "no look document" in err else 400, err)
    return res


def router_for(auth: Callable[..., Any]) -> APIRouter:
    r = APIRouter()

    @r.get("/api/hidden-assets")
    def hidden_list(app: str | None = None) -> Any:
        """What is hidden in an app (default the console), oldest first."""
        return _answer(lambda: list_hidden(app))

    @r.post("/api/hidden-assets/hide", dependencies=[Depends(auth)])
    def hidden_hide(body: dict[str, Any] = Body(...)) -> Any:
        """Hide one piece: {app?, kind, id, by?}. `changed` false when it was already hidden."""
        return _answer(lambda: hide(body.get("app"), body.get("kind"), body.get("id"), body.get("by")))

    @r.post("/api/hidden-assets/unhide", dependencies=[Depends(auth)])
    def hidden_unhide(body: dict[str, Any] = Body(...)) -> Any:
        """Show one piece again: {app?, kind, id}."""
        return _answer(lambda: unhide(body.get("app"), body.get("kind"), body.get("id"), body.get("by")))

    @r.post("/api/hidden-assets/unhide-all", dependencies=[Depends(auth)])
    def hidden_unhide_all(body: dict[str, Any] | None = Body(None)) -> Any:
        """Show everything hidden in the app again: {app?}."""
        b = body or {}
        return _answer(lambda: unhide_all(b.get("app"), b.get("by")))

    return r
