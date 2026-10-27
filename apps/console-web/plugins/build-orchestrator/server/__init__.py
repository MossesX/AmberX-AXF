"""Server part of the build orchestrator. Mounted at /api/plugins/build-orchestrator/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (orchestrator.mjs --json), so the console, the CLI and other sessions share one set of
rules and one tracker file (_claude/builds/orchestrator.json). Never exposed on the console MCP.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "orchestrator.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024


def _run(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res


@router.get("/state")
def state() -> dict[str, Any]:
    return _run("state")


@router.get("/brief/{build_id}")
def brief(build_id: str) -> dict[str, Any]:
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    return _run("brief", build_id)


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
