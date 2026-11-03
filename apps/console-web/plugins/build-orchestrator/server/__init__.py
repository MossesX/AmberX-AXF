"""Server part of the build orchestrator. Mounted at /api/plugins/build-orchestrator/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (orchestrator.mjs --json), so the console, the CLI and other sessions share one set of
rules and one tracker file (_claude/builds/orchestrator.json). Never exposed on the console MCP.

Model upgrades (framework/core/model-switch.mjs, Brett, Nov 3 2026): approving an upgrade (or answering an upgrade
request) counts only as Brett's own click: a browser signed in to axHub as an admin (wall session), with no
X-Axhub-Session / X-Axhub-Source header naming a session, build or agent. Only then does this route hand the CLI
AXF_APPROVER (his hub name) and AXF_APPROVER_VIA=console. The console token alone is not Brett: scripts and Claude
sessions hold it too. Downgrades need nobody.
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "orchestrator.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024


APPROVER_KEYS = ("AXF_APPROVER", "AXF_APPROVER_VIA")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")


def _run(*args: str, approver: str = "") -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}  # never inherited: only Brett's click sets them
    if approver:
        env.update(AXF_APPROVER=approver, AXF_APPROVER_VIA="console")
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    return res


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


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
    change.pop("approver", None)  # who approves comes from the sign-in, never from the body
    return _run("act", json.dumps(change), approver=brett_click(request))
