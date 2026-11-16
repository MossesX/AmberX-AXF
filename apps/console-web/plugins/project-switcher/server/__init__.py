"""Projects console plugin — server part. Mounted at /api/plugins/project-switcher/ (console token on every method, 404 while
the plugin is off). Its routes are its plugin commands (plugin.json → commands): the same calls reach it as REST, MCP
tools (project-switcher_<command>), the plugin-commands CLI and voice in AmberX.

Projects themselves (projects@1) are framework data: framework/cli/projects.mjs owns the registry and every change,
and the console core serves it at GET/POST /api/projects too. These routes are named for what people ask:

    GET  /             every project (counts, which is active)          GET  /current   the active project
    POST /new          {name, description?, id?, repo?, skin?, seed?, select?}  a new project (made active unless select
                       is false; seed "demo" = clearly marked test data, else empty) with its hub home and manifest
    POST /switch       {project}       id or name                        POST /rename    {project, name?, description?}
    POST /archive      {project, confirm}  confirm = the project id     POST /unarchive {project}
    POST /delete       {project, confirm}  confirm = the project id; off the list, its data stays on disk
    POST /axhub-policy {done}          Brett has set axHub's policy for project_create / project_switch (allow)

Systems check item `projects-axhub-policy` (capability axf.health@1): amber until Brett sets axHub's policy so the
console MCP's project_create and project_switch run without the veto (CONTROL.md → Recommended axHub policy), then
green. axHub can't be asked which policy it holds, so Brett (or a session he tells) marks it done here.
"""
from __future__ import annotations

import json
import os
import subprocess
from datetime import datetime, timezone
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import plugin_services

router = APIRouter()

FOLDER = "project-switcher"
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "projects-axhub-policy"
_health_done = False


def _policy_file():
    return cx.ROOT / ".axf-console" / "plugins" / FOLDER / "axhub-policy.json"


def policy_probe() -> dict[str, Any]:
    """Systems check: has axHub been told to run project_create / project_switch without the veto?"""
    try:
        done = json.loads(_policy_file().read_text("utf-8")).get("done") is True
    except (OSError, ValueError, AttributeError):
        done = False
    if done:
        return {"status": "ok", "summary": "axHub runs project_create and project_switch at once; project_delete keeps the veto."}
    return {"status": "warn", "summary": "axHub still holds project_create and project_switch for the veto countdown.",
            "details": ["The console MCP marks both tools _meta ai.amberx.axf/policy = allow; axHub's policy for the axf server decides."]}


def ensure_health() -> bool:
    """Registers the axHub policy item on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "axHub policy for creating and switching projects", "service": "axhub", "order": 85, "severity": "warn",
                      "run": policy_probe,
                      "breaks": "An AI client's project_create / project_switch waits for the 90 s veto instead of running at once.",
                      "instructions": ["In axHub, open the tool policy of the axf (console) MCP server.",
                                       "Set project_create and project_switch to Allow (run at once). Leave project_delete on Confirm.",
                                       "Then mark it done: tell a session \"axHub policy for projects is set\", or POST /api/plugins/project-switcher/axhub-policy {\"done\": true}."]}, FOLDER)
    except Exception:  # noqa: BLE001 — projects work without the item
        return False
    _health_done = True
    return True


def _cli(*args: str, actor: str = "console:projects") -> dict[str, Any]:
    cli = cx.ROOT / "framework" / "cli" / "projects.mjs"
    env = {**os.environ, "AXF_ACTOR": actor}
    proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=cx.ROOT, capture_output=True, text=True, timeout=60, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res if isinstance(res, dict) else {"ok": False, "error": "unexpected answer"}


def _text(v: Any, n: int = 600) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _change(change: dict[str, Any]) -> dict[str, Any]:
    res = _cli("act", json.dumps(change))
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


@router.get("/")
def list_projects() -> dict[str, Any]:
    ensure_health()
    res = _cli("state")
    if not res.get("ok"):
        raise HTTPException(500, res.get("error", "failed"))
    return res


@router.get("/current")
def current() -> dict[str, Any]:
    res = _cli("current")
    if not res.get("ok"):
        raise HTTPException(500, res.get("error", "failed"))
    return {"ok": True, "project": res.get("project")}


@router.post("/new")
def new(body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    name = _text(b.get("name"), 80)
    if not name:
        raise HTTPException(400, "a new project needs a name")
    change: dict[str, Any] = {"action": "create", "name": name, "description": _text(b.get("description")), "select": b.get("select") is not False}
    for key, n in (("id", 40), ("repo", 300), ("skin", 63), ("seed", 20)):
        if _text(b.get(key), n):
            change[key] = _text(b.get(key), n)
    if b.get("seed") is True:
        change["seed"] = "demo"
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


@router.post("/axhub-policy")
def axhub_policy(body: Any = Body(None)) -> dict[str, Any]:
    done = _body(body).get("done") is not False
    f = _policy_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    f.write_text(json.dumps({"done": done, "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}) + "\n", "utf-8")
    cx.log("projects", f"axHub policy for project_create / project_switch marked {'set' if done else 'not set'}")
    ensure_health()
    return {"ok": True, "done": done, "check": policy_probe()}
