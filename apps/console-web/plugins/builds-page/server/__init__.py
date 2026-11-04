"""Server part of the Builds plugin. Mounted at /api/plugins/builds-page/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (builds.mjs --json) on the one builds store (builds@1, framework/cli/builds-store.mjs), so the
page, the CLI, the orchestrator and other sessions share one set of records. Every write is versioned (journal).
AmberX reaches these routes through its console forward (hub admins only). The console's control@1 plugins domain
lists every route as a command (REST /api/control/builds-page/…, MCP, `axf builds-page …`); see plugin.json commands.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "builds.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024
PROFILE = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")


def _run(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60,
                          env={**__import__("os").environ, "AXF_ACTOR": "builds-page"})
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


async def _json(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "an object is needed")
    p = data.get("profile")
    if p is not None and (not isinstance(p, str) or not PROFILE.match(p)):
        raise HTTPException(400, "bad profile id")
    return data


def _profile(p: str | None) -> list[str]:
    if p is None or p == "":
        return []
    if not PROFILE.match(p):
        raise HTTPException(400, "bad profile id")
    return [p]


@router.get("/state")
def state(profile: str | None = None) -> dict[str, Any]:
    return _run("state", *_profile(profile))


@router.get("/progress")
def progress(profile: str | None = None) -> dict[str, Any]:
    return _run("progress", *_profile(profile))


@router.post("/ops")
async def ops(request: Request) -> dict[str, Any]:
    return _run("ops", json.dumps(await _json(request)))


@router.post("/draft")
async def draft(request: Request) -> dict[str, Any]:
    return _run("draft", json.dumps(await _json(request)))


@router.post("/apply")
async def apply(request: Request) -> dict[str, Any]:
    return _run("apply", json.dumps(await _json(request)))


@router.post("/discard")
async def discard(request: Request) -> dict[str, Any]:
    return _run("discard", json.dumps(await _json(request)))


@router.post("/propose")
async def propose(request: Request) -> dict[str, Any]:
    return _run("propose", json.dumps(await _json(request)))


@router.post("/divide")
async def divide(request: Request) -> dict[str, Any]:
    return _run("divide", json.dumps(await _json(request)))


@router.post("/rename-profile")
async def rename_profile(request: Request) -> dict[str, Any]:
    data = await _json(request)
    if not isinstance(data.get("id"), str) or not PROFILE.match(data["id"]):
        raise HTTPException(400, "bad profile id")
    return _run("rename-profile", json.dumps(data))


# ---- every view and the page's immediate commands, by name (control@1 plugins domain: REST, MCP, CLI)

VIEWS = ("pending", "queue", "plan", "tracker", "orchestrator", "steps")
FILTERS = ("open", "complete", "archived", "hidden", "all")
BUILD_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,99}$")


@router.get("/view/{name}")
def view(name: str, profile: str | None = None, filter: str = "open", q: str = "", build: str = "") -> dict[str, Any]:
    if name not in VIEWS:
        raise HTTPException(404, f"no view {name} (one of {', '.join(VIEWS)})")
    if filter not in FILTERS:
        raise HTTPException(400, f"unknown filter {filter}")
    if build and not BUILD_ID.match(build):
        raise HTTPException(400, "bad build id")
    opts = {"filter": filter, "q": q[:200], "build": build, **({"profile": profile} if profile else {})}
    _profile(profile)
    return _run("view", name, json.dumps(opts))


async def _named(request: Request, cmd: str) -> dict[str, Any]:
    data = await _json(request)
    return _run(cmd, json.dumps(data))


@router.post("/tick")
async def tick(request: Request) -> dict[str, Any]:
    return await _named(request, "tick")


@router.post("/status")
async def set_status(request: Request) -> dict[str, Any]:
    return await _named(request, "status")


@router.post("/hide")
async def hide(request: Request) -> dict[str, Any]:
    return await _named(request, "hide")


@router.post("/unhide")
async def unhide(request: Request) -> dict[str, Any]:
    return await _named(request, "unhide")


@router.post("/archive")
async def archive(request: Request) -> dict[str, Any]:
    return await _named(request, "archive")


@router.post("/note")
async def note(request: Request) -> dict[str, Any]:
    return await _named(request, "note")


@router.delete("/build/{build_id}")
def delete_build(build_id: str, profile: str | None = None) -> dict[str, Any]:
    if not BUILD_ID.match(build_id):
        raise HTTPException(400, "bad build id")
    _profile(profile)
    return _run("delete", json.dumps({"ids": [build_id], **({"profile": profile} if profile else {})}))
