"""Project wizard — server part. Mounted at /api/plugins/project-wizard/.

The console adds two checks to every route: the console token (every method, reads included) and 404 while the
plugin is disabled. Plugin routes are never exposed through the console's MCP server.

Everything runs through the plugin's Node engine (wizard.mjs --json), which builds on AmberX AXF's claude-project, so
the console and the `claude-project` terminal command make projects the same way. Tokens (GITHUB_TOKEN) stay in the
server's environment; nothing secret is returned to the browser or written to the wizard's list.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

_PLUGIN = Path(__file__).resolve().parents[1]
_ROOT = _PLUGIN.parents[3]
_ENGINE = _PLUGIN / "wizard.mjs"
_RUN_LOCK = threading.Lock()  # one project run at a time (git pushes, repo creation)


def _engine(req: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(_ENGINE), "--json", json.dumps(req)], cwd=_ROOT, stdin=subprocess.DEVNULL,
                           capture_output=True, text=True, timeout=timeout, env={**os.environ})
    except subprocess.TimeoutExpired:
        raise HTTPException(504, f"the wizard took longer than {timeout} s")
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": (p.stderr or "no output").strip()[-600:]}
    except json.JSONDecodeError:
        return {"ok": False, "error": (p.stderr or p.stdout).strip()[-600:]}


def _ok(r: dict[str, Any]) -> dict[str, Any]:
    if not r.get("ok"):
        raise HTTPException(400, r.get("error", "the wizard failed"))
    return r


class Source(BaseModel):
    kind: Literal["github", "vps", "folder", "new"]
    repo: str = Field(default="", max_length=300)
    path: str = Field(default="", max_length=1000)
    template: str = Field(default="", max_length=40)
    boilerplate: str = Field(default="", max_length=60)


class Home(BaseModel):
    mode: Literal["new", "existing", "skip", "keep"] = "skip"
    owner: str = Field(default="", max_length=39)
    name: str = Field(default="", max_length=100)
    path: str = Field(default="", max_length=1000)


class Homes(BaseModel):
    github: Home = Field(default_factory=Home)
    vps: Home = Field(default_factory=Home)
    local: Home = Field(default_factory=lambda: Home(mode="keep"))


class Plan(BaseModel):
    source: Source
    display: str = Field(default="", max_length=80)
    name: str = Field(default="", max_length=63)
    description: str = Field(default="", max_length=300)
    kind: str = Field(default="app", max_length=30)
    visibility: Literal["private", "public"] = "private"
    port: Literal["bake", "rebuild", "no"] = "no"
    homes: Homes = Field(default_factory=Homes)
    sync: bool = True


class PlanReq(BaseModel):
    plan: Plan


class NameReq(BaseModel):
    name: str = Field(max_length=63)


class KitReq(NameReq):
    rebuild: bool = False


class LinkReq(NameReq):
    url: str = Field(max_length=300)


@router.get("/status")
def status() -> dict[str, Any]:
    return _ok(_engine({"action": "status"}, timeout=40))


@router.post("/inspect")
def inspect(src: Source) -> dict[str, Any]:
    return _ok(_engine({"action": "inspect", "source": src.model_dump()}, timeout=40))


@router.post("/check")
def check(req: PlanReq) -> dict[str, Any]:
    r = _engine({"action": "check", "plan": req.plan.model_dump()}, timeout=60)
    if "problems" not in r:
        raise HTTPException(400, r.get("error", "could not check the plan"))
    return r


@router.post("/run")
def run(req: PlanReq) -> dict[str, Any]:
    if not _RUN_LOCK.acquire(blocking=False):
        raise HTTPException(409, "another project is being made right now; try again when it finishes")
    try:
        # cloning, axf init, pushes and repo creation: give it time; failures come back with the log
        return _engine({"action": "run", "plan": req.plan.model_dump()}, timeout=900)
    finally:
        _RUN_LOCK.release()


@router.get("/list/{location}")
def listing(location: Literal["github", "vps", "local"]) -> dict[str, Any]:
    return _ok(_engine({"action": "list", "location": location}, timeout=40))


@router.post("/kit")
def kit(req: KitReq) -> dict[str, Any]:
    return _ok(_engine({"action": "kit", "name": req.name, "rebuild": req.rebuild}, timeout=180))


@router.post("/link")
def link(req: LinkReq) -> dict[str, Any]:
    return _ok(_engine({"action": "link", "name": req.name, "url": req.url}, timeout=120))


@router.post("/forget")
def forget(req: NameReq) -> dict[str, Any]:
    """Drops the project from the wizard's list only; folders and repositories are never deleted."""
    return _ok(_engine({"action": "forget", "name": req.name}))
