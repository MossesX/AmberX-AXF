"""Projects console plugin — server part. Mounted at /api/plugins/project-switcher/ (console token on every method, 404 while
the plugin is off). Its routes are its plugin commands (plugin.json → commands): the same calls reach it as REST, MCP
tools (project-switcher_<command>), the plugin-commands CLI and voice in AmberX.

Projects themselves (projects@1) are framework data: framework/cli/projects.mjs owns the registry and every change,
and the console core serves it at GET/POST /api/projects too. These routes are named for what people ask:

    GET  /             every project (counts, which is active)          GET  /current   the active project
    POST /new          {name, description?, id?, select?}  a new, empty project (made active unless select is false)
    POST /switch       {project}       id or name                        POST /rename    {project, name?, description?}
    POST /archive      {project, confirm}  confirm = the project id     POST /unarchive {project}
    POST /delete       {project, confirm}  confirm = the project id; off the list, its data stays on disk
"""
from __future__ import annotations

import json
import os
import subprocess
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import readcache  # server/readcache.py: one shared, single-flight read per source + the cap on node spawns

router = APIRouter()
READ_TTL_S = 3.0  # the project list is read by the banner of every open console; one node process serves them all
READ_KEY = "project-switcher:"


def _cli(*args: str, actor: str = "console:projects") -> dict[str, Any]:
    cli = cx.ROOT / "framework" / "cli" / "projects.mjs"
    env = {**os.environ, "AXF_ACTOR": actor}
    try:
        proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=cx.ROOT, capture_output=True, text=True, timeout=60, env=env)
    except subprocess.TimeoutExpired:  # was uncaught: a raw 500 after a minute on a busy host
        return {"ok": False, "timeout": True, "error": "projects.mjs took longer than 60 s (the host is busy); try again"}
    except OSError as e:
        return {"ok": False, "error": f"projects.mjs could not start: {e}"[:600]}
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res if isinstance(res, dict) else {"ok": False, "error": "unexpected answer"}


def _read(*args: str) -> dict[str, Any]:
    """A read every console makes (state, current): shared and single-flight, the last answer served while it refreshes."""
    res = readcache.cached(READ_KEY + " ".join(args), lambda: _cli(*args), ttl=READ_TTL_S)
    if not res.get("ok"):
        raise HTTPException(503 if res.get("timeout") else 500, res.get("error", "failed"))
    return res


def _text(v: Any, n: int = 600) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _change(change: dict[str, Any]) -> dict[str, Any]:
    res = _cli("act", json.dumps(change))
    readcache.invalidate(READ_KEY)  # the next list shows the change
    for line in res.get("log", []) or []:
        cx.log("projects", str(line))
    if not res.get("ok"):
        raise HTTPException(400, res.get("error", "failed"))
    return res


def _body(body: Any) -> dict[str, Any]:
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    return body


def _project(b: dict[str, Any]) -> str:
    p = _text(b.get("project") or b.get("id"), 80)
    if not p:
        raise HTTPException(400, "project (its id or name) is needed")
    return p


@router.get("")  # the plugin command route (asked without the trailing slash)
@router.get("/")
def list_projects() -> dict[str, Any]:
    return _read("state")


@router.get("/current")
def current() -> dict[str, Any]:
    res = _read("current")
    return {"ok": True, "project": res.get("project")}


@router.post("/new")
def new(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    name = _text(b.get("name"), 80)
    if not name:
        raise HTTPException(400, "a new project needs a name")
    change: dict[str, Any] = {"action": "create", "name": name, "description": _text(b.get("description")), "select": b.get("select") is not False}
    if _text(b.get("id"), 40):
        change["id"] = _text(b.get("id"), 40)
    return _change(change)


@router.post("/switch")
def switch(body: Any = Body(None)) -> dict[str, Any]:
    return _change({"action": "select", "id": _project(_body(body))})


@router.post("/rename")
def rename(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    change: dict[str, Any] = {"action": "update", "id": _project(b)}
    if isinstance(b.get("name"), str):
        change["name"] = _text(b["name"], 80)
    if isinstance(b.get("description"), str):
        change["description"] = _text(b["description"])
    if len(change) == 2:
        raise HTTPException(400, "rename needs a name or a description")
    return _change(change)


@router.post("/archive")
def archive(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    return _change({"action": "archive", "id": _project(b), "confirm": _text(b.get("confirm"), 40)})


@router.post("/unarchive")
def unarchive(body: Any = Body(None)) -> dict[str, Any]:
    return _change({"action": "unarchive", "id": _project(_body(body))})


@router.post("/delete")
def delete(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    return _change({"action": "delete", "id": _project(b), "confirm": _text(b.get("confirm"), 40)})
