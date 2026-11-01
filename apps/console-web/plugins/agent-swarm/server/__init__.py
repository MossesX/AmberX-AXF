"""Server part of the agent swarm. Mounted at /api/plugins/agent-swarm/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (swarm.mjs --json), so the console, the CLI and the orchestrator share one set of rules.
Runs (claude -p) are started from the CLI, never from here: a page request can't spend tokens.
Never exposed on the console MCP.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "swarm.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _run(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


@router.get("/state")
def state() -> dict[str, Any]:
    return _run("state")


@router.get("/plan/{build_id}")
def plan(build_id: str) -> dict[str, Any]:
    if not ID.match(build_id):
        raise HTTPException(400, "bad build id")
    return _run("plan", build_id)


@router.get("/pack/{build_id}/{step_id}")
def pack(build_id: str, step_id: str) -> dict[str, Any]:
    if not ID.match(build_id) or not ID.match(step_id):
        raise HTTPException(400, "bad id")
    return _run("pack", build_id, step_id)


@router.post("/act")
async def act(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        change = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(change, dict) or not isinstance(change.get("action"), str):
        raise HTTPException(400, "a change needs an action")
    return _run("act", json.dumps(change))
