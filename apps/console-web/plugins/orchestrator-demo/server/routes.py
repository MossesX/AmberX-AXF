"""Orchestrator demo routes (demo-run@1). Mounted at /api/plugins/orchestrator-demo/.

Every route is a thin call into runner.mjs (the one place the run is read and changed), so the console UI, REST, the
plugin-commands MCP tools, the CLI and voice all go through the same code. The runner answers one JSON line
{ok, code?, error?, state?, summary?, settings?}; a refusal becomes an HTTP error whose detail is the plain reason
(the code in the X-Axf-Code header).
"""
from __future__ import annotations

import json
import os
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
RUNNER = HERE / "runner.mjs"
ROOT = HERE.parents[3]  # the repo root (/axf in the console image)
TIMEOUT_S = 30
# Refusal code -> HTTP status. Anything not listed is a 400 (a bad request) or a 500 (the runner failed).
STATUS = {"busy": 409, "invalid-transition": 409, "no-act": 409, "no-run": 404, "usage": 400, "bad-result": 400}


def run_runner(*args: str) -> dict[str, Any]:
    """Run runner.mjs with args and return its JSON answer (or a runner-failed answer)."""
    try:
        p = subprocess.run(["node", str(RUNNER), *args], cwd=str(ROOT), capture_output=True, text=True,
                           timeout=TIMEOUT_S, env=os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "runner-failed", "error": f"{type(e).__name__}: {e}"[:400]}
    line = next((x for x in reversed(p.stdout.strip().splitlines()) if x.startswith("{")), "")
    try:
        return json.loads(line) if line else {"ok": False, "code": "runner-failed", "error": (p.stderr or "no answer")[-400:]}
    except json.JSONDecodeError:
        return {"ok": False, "code": "runner-failed", "error": line[-400:]}


def answer(res: dict[str, Any]) -> dict[str, Any]:
    if res.get("ok"):
        return res
    code = str(res.get("code") or "error")
    raise HTTPException(STATUS.get(code, 500 if code in ("runner-failed", "error") else 400),
                        str(res.get("error") or "refused"), headers={"X-Axf-Code": code})


async def body_of(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (json.JSONDecodeError, ValueError):
        return {}
    return b if isinstance(b, dict) else {}


def pause_flag(v: Any) -> list[str]:
    if v is None:
        return []
    if isinstance(v, str):
        v = v.strip().lower() in ("1", "true", "yes", "on")
    return ["--pause"] if bool(v) else ["--no-pause"]


def event(kind: str, *extra: str) -> dict[str, Any]:
    return answer(run_runner("event", kind, *extra))


@router.get("/state")
def state() -> dict[str, Any]:
    """The demo run now: state, current act, caption (n/N, countdown), check-list, held, allowed events, settings."""
    res = answer(run_runner("state"))
    res["settings"] = run_runner("settings").get("settings")
    return res


@router.post("/open")
async def open_overlay(request: Request) -> dict[str, Any]:
    """Open a new demo run in its start overlay (nothing plays until start / Continue). Body {pause?}."""
    b = await body_of(request)
    return answer(run_runner("new", *pause_flag(b.get("pause"))))


@router.post("/start")
async def start(request: Request) -> dict[str, Any]:
    """Start the demo (the overlay's Continue): body {pause} = pause between steps; uses the open overlay run if any."""
    b = await body_of(request)
    return answer(run_runner("start", *pause_flag(b.get("pause"))))


@router.post("/pause")
def pause() -> dict[str, Any]:
    """Pause (hold) the demo where it is: the countdown and the acts stop until resume."""
    return event("hold")


@router.post("/resume")
def resume() -> dict[str, Any]:
    """Resume a paused (held) demo: the countdown goes on from where it was."""
    return event("resume")


@router.post("/next")
def next_act() -> dict[str, Any]:
    """Next: with Pause between steps on, leave the act being shown; the next one is focused after the 30 s gap."""
    return event("next")


@router.post("/skip")
async def skip(request: Request) -> dict[str, Any]:
    """Skip the current act (recorded as skipped, with why). Body {why?}."""
    b = await body_of(request)
    why = str(b.get("why") or "").strip()[:200]
    return event("skip", *(["--why", why] if why else []))


@router.post("/stop")
async def stop(request: Request) -> dict[str, Any]:
    """Stop the demo at once and clean up every demo-* build, branch and alert; the summary goes in the run record."""
    b = await body_of(request)
    why = str(b.get("why") or "").strip()[:200]
    return event("stop", *(["--why", why] if why else []))


@router.put("/pause-between-steps")
async def set_pause_between_steps(request: Request) -> dict[str, Any]:
    """Turn Pause between steps on or off for the run now and as the default. Body {pause: true|false}."""
    b = await body_of(request)
    if "pause" not in b:
        raise HTTPException(400, "send {pause: true|false}", headers={"X-Axf-Code": "usage"})
    on = "true" if pause_flag(b["pause"]) == ["--pause"] else "false"
    settings = answer(run_runner("settings", "--pause", on)).get("settings")
    res = run_runner("event", "set-pause", "--pause", on)
    return {"ok": True, "settings": settings, "state": res.get("state") if res.get("ok") else None}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """The plugin settings: Pause between steps default, the minimum gap between acts (30 s, never lower)."""
    return answer(run_runner("settings"))


@router.get("/summary")
def summary() -> dict[str, Any]:
    """The last run's summary: passed / failed / skipped per act with what failed and the evidence, and the cleanup."""
    return answer(run_runner("summary"))
