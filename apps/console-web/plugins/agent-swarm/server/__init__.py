"""Server part of the agent swarm. Mounted at /api/plugins/agent-swarm/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (swarm.mjs --json), so the console, the CLI and the orchestrator share one set of rules.
Build-step runs (claude -p) are started from the CLI, never from here: a page request can't spend tokens. The one
exception is Breakroom → Jobs → Run: an explicit POST that routes one job-type run to its owning agent (jobs.mjs), so a
GET never spends anything.
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
JOBS = CLI.parent / "jobs.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _run(*args: str, cli: Path = CLI) -> dict[str, Any]:
    proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=90)
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


INPUT_KEY = re.compile(r"^[a-z][a-zA-Z0-9]{0,29}$")


async def _body(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict) or not isinstance(data.get("jobType"), str) or not ID.match(data["jobType"]):
        raise HTTPException(400, "a jobType is needed")
    return data


@router.get("/jobs")
def jobs() -> dict[str, Any]:
    """Job types with owner, last run, next scheduled and cost (finished runs are swept first)."""
    return _run("list", cli=JOBS)


@router.post("/jobs/run")
async def jobs_run(request: Request) -> dict[str, Any]:
    """Route one run to the owning agent and launch it (dry: true = the brief and command only)."""
    data = await _body(request)
    inputs = data.get("inputs") or {}
    if not isinstance(inputs, dict) or len(inputs) > 12:
        raise HTTPException(400, "inputs must be an object")
    args = ["run", data["jobType"]]
    for k, v in inputs.items():
        if not isinstance(k, str) or not INPUT_KEY.match(k) or not isinstance(v, str) or len(v) > 2000:
            raise HTTPException(400, f"bad input {k!r}")
        args += ["--input", f"{k}={v}"]
    if data.get("dry") is True:
        args.append("--dry-run")
    return _run(*args, cli=JOBS)


@router.post("/jobs/hire")
async def jobs_hire(request: Request) -> dict[str, Any]:
    """One-tap hire for a job type nobody owns."""
    data = await _body(request)
    return _run("hire", data["jobType"], cli=JOBS)
