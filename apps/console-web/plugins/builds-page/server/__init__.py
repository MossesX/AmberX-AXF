"""Server part of the Builds plugin. Mounted at /api/plugins/builds-page/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (builds.mjs --json) on the one builds store (builds@1, framework/cli/builds-store.mjs), so the
page, the CLI, the orchestrator and other sessions share one set of records. Every write is versioned (journal).
AmberX reaches these routes through its console forward (hub admins only). Never exposed on the console MCP.
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
