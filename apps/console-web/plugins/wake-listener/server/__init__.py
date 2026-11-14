"""Wake listener (server part, wake-listener@1). Mounted at /api/plugins/wake-listener/.

The settings (wake phrases, the off switch, the engine) and the last state the open console reported live in the
plugin's data folder through the plugin's Node core (listener.mjs → core.mjs), so the console page, the MCP tools
(plugin-commands@1: wake-listener_*), the CLI (`axf wake-listener …`) and this share one implementation.

  GET  settings              the settings (on, phrases, engine, awakeSec, answerSec, speak, chime, indicator, pauseHidden,
                             useClaude = axf.voice.useClaude, claudeTimeoutSec = axf.voice.claudeTimeoutSec)
  POST settings {patch}      change any of them; addPhrase / removePhrase add or drop one wake phrase
  POST on | POST off         the switch (the open console follows within a few seconds)
  GET  state                 the last state the console reported: phase (off / idle / awake / wizard), engine, mic open,
                             last heard, last command, last reply; `fresh` = a console is listening right now
  POST report {state}        the open console reports its state (left out of the commands: the page's own)
  GET  catalog [?q=]         the voice command catalog (every console action, plugin command, control@1 target and
                             pipeline command with its spoken forms and fields)
  POST match {text}          dry run: which catalog entry a phrase lands on, the fields it filled and the ones a wizard asks

Running a phrase in the open console (hear a command, review approvals, answer a wizard, start one) is the plugin's web
action `wake-listener.heard:<text>` and its siblings: plugin-commands dispatches those to the open console.
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
CLI = Path(__file__).resolve().parents[1] / "listener.mjs"
ROOT = Path(__file__).resolve().parents[5]
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}
MAX_BODY = 32 * 1024


def cli(*args: str, stdin: str | None = None, timeout: int = 30) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, input=stdin)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"wake-listener could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def _who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return {}
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return {}
    return body if isinstance(body, dict) else {}


def _pairs(patch: dict[str, Any]) -> list[str]:
    out: list[str] = []
    for k, v in patch.items():
        if not isinstance(k, str):
            continue
        if isinstance(v, list):
            v = ",".join(str(x) for x in v if isinstance(x, (str, int, float)))
        if isinstance(v, bool):
            out.append(f"{k}={'true' if v else 'false'}")
        elif isinstance(v, (int, float, str)):
            out.append(f"{k}={v}")
    return out


@router.get("/settings")
async def settings() -> JSONResponse:
    return answer(await run_in_threadpool(cli, "settings"))


@router.post("/settings")
async def set_settings(request: Request) -> JSONResponse:
    body = await _body(request)
    patch = body.get("patch") if isinstance(body.get("patch"), dict) else body
    pairs = _pairs(patch)
    if not pairs:
        return answer({"ok": False, "code": "invalid", "message": "send { on?, phrases?, engine?, awakeSec?, answerSec?, speak?, chime?, indicator?, pauseHidden?, useClaude?, claudeTimeoutSec?, addPhrase?, removePhrase? }"})
    return answer(await run_in_threadpool(cli, "set", *pairs, "--by", _who(request)))


@router.post("/on")
async def switch_on(request: Request) -> JSONResponse:
    return answer(await run_in_threadpool(cli, "on", "--by", _who(request)))


@router.post("/off")
async def switch_off(request: Request) -> JSONResponse:
    return answer(await run_in_threadpool(cli, "off", "--by", _who(request)))


@router.get("/state")
async def state() -> JSONResponse:
    return answer(await run_in_threadpool(cli, "state"))


@router.post("/report")
async def report(request: Request) -> JSONResponse:
    body = await _body(request)
    st = body.get("state") if isinstance(body.get("state"), dict) else body
    return answer(await run_in_threadpool(cli, "report", stdin=json.dumps(st)))


@router.get("/catalog")
async def catalog(q: str = "") -> JSONResponse:
    return answer(await run_in_threadpool(cli, "catalog", *([q[:200]] if q else []), timeout=60))


@router.post("/match")
async def match(request: Request) -> JSONResponse:
    body = await _body(request)
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        return answer({"ok": False, "code": "invalid", "message": "send { text }"})
    return answer(await run_in_threadpool(cli, "match", text[:500], timeout=60))
