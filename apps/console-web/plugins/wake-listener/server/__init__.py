"""Wake listener (server part, wake-listener@1). Mounted at /api/plugins/wake-listener/.

The settings (wake phrases, the off switch, the engine) and the last state the open console reported live in the
plugin's data folder through the plugin's Node core (listener.mjs → core.mjs), so the console page, the MCP tools
(plugin-commands@1: wake-listener_*), the CLI (`axf wake-listener …`) and this share one implementation.

  GET  settings              the settings (on, phrases, engine, awakeSec, answerSec, speak, chime, indicator, pauseHidden,
                             useClaude = axf.voice.useClaude, claudeTimeoutSec = axf.voice.claudeTimeoutSec)
  POST settings {patch}      change any of them; addPhrase / removePhrase add or drop one wake phrase
  POST on | POST off         the switch (the open console follows within a few seconds)
  GET  state                 the last state the console reported: phase (off / idle / awake / wizard), engine, mic open,
                             last heard, last command, last reply; `fresh` = a console is listening right now; Claude
                             mode: mode (claude / scripted), useClaude, claudeConnected, lastMode, lastFallbackReason,
                             offline + offlineReason (the offline indicator)
  POST report {state}        the open console reports its state (left out of the commands: the page's own)
  GET  catalog [?q=]         the voice command catalog (every console action, plugin command, control@1 target and
                             pipeline command with its spoken forms and fields)
  POST match {text}          dry run: which catalog entry a phrase lands on, the fields it filled and the ones a wizard asks
  GET  history [?mode=claude|scripted&limit=]
                             recent commands, newest first: heard, command, reply, ok, mode (claude / scripted) and the
                             fallback reason of a scripted one; entries from before Claude mode read as scripted
  POST history {entry}       the open console records one (left out of the commands: the page's own)
  POST understand {text, context?, pending?}
                             Claude mode (claude_intent.py): Claude picks the command through axf.llm@1 and fills its
                             fields → {mode:'claude', command, args, ask?, confirm?, run, pending?}; the setting off,
                             approve / deny words, no Claude, a timeout or an error → {mode:'offline', reason}

Running a phrase in the open console (hear a command, review approvals, answer a wizard, start one) is the plugin's web
action `wake-listener.heard:<text>` and its siblings: plugin-commands dispatches those to the open console.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services

from . import claude_intent

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
CLI = Path(__file__).resolve().parents[1] / "listener.mjs"
ROOT = Path(__file__).resolve().parents[5]
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}
MAX_BODY = 32 * 1024
CATALOG_TTL_S = 60
DATA_DIR = Path(os.environ.get("AXF_WAKE_LISTENER_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))
STATUS_FILE = DATA_DIR / "claude.json"
_status: claude_intent.Status | None = None
_catalog: dict[str, Any] = {"at": 0.0, "entries": []}
_catalog_lock = threading.Lock()


def claude_status() -> claude_intent.Status:
    global _status
    if _status is None:
        _status = claude_intent.Status(STATUS_FILE)
    return _status


def catalog_entries() -> list[dict[str, Any]]:
    """The voice command catalog, cached for a minute (the Node CLI builds it from the registry)."""
    with _catalog_lock:
        if time.time() - _catalog["at"] < CATALOG_TTL_S and _catalog["entries"]:
            return _catalog["entries"]
    r = cli("catalog", timeout=60)
    entries = r.get("entries") if r.get("ok") and isinstance(r.get("entries"), list) else []
    with _catalog_lock:
        if entries:
            _catalog.update(at=time.time(), entries=entries)
        return entries or _catalog["entries"]


def run_understand(text: str, context: dict[str, Any] | None = None, pending: dict[str, Any] | None = None) -> dict[str, Any]:
    """One understand call with the stored settings (the switch, the timeout) and the live axf.llm@1 service."""
    s = cli("settings")
    settings = s.get("settings") if s.get("ok") else {}
    use_claude = bool((settings or {}).get("useClaude", True))
    timeout_s = float((settings or {}).get("claudeTimeoutSec", 8))
    if not use_claude:
        return claude_intent.offline("off")  # nothing is sent to Claude
    res = claude_intent.understand(text, llm=plugin_services.get("axf.llm@1"), entries=catalog_entries(), status=claude_status(),
                                   use_claude=use_claude, timeout_s=timeout_s, context=context, pending=pending)
    if res.get("ok"):
        claude_status().handled("claude" if res.get("mode") == "claude" else "scripted", str(res.get("reason") or ""))
    return res


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


def read_state() -> dict[str, Any]:
    """The page's last report plus Claude mode: mode (claude / scripted), useClaude, claudeConnected, lastFallbackReason,
    offline (Claude mode on but the fallback answered or Claude is away) and why."""
    r = cli("state")
    if not r.get("ok"):
        return r
    s = cli("settings")
    use_claude = bool(((s.get("settings") if s.get("ok") else None) or {}).get("useClaude", True))
    view = claude_status().view(plugin_services.get("axf.llm@1") is not None, use_claude)
    st = r.get("state") or {}
    # the page's report knows who answered the last command; the route's record is the fallback when no page reported
    page_newer = bool(st.get("lastMode")) and int(st.get("updatedAt") or 0) >= view["lastHandledAt"]
    last_mode = st.get("lastMode") if page_newer else view["lastMode"]
    last_reason = st.get("lastFallbackReason", "") if page_newer else view["lastFallbackReason"]
    by_design = ("", "off", "approvals")
    offline = use_claude and (not view["claudeConnected"] or (last_mode == "scripted" and last_reason not in by_design))
    claude = {**view, "lastMode": last_mode or "", "lastFallbackReason": last_reason or "", "offline": offline,
              "offlineReason": (last_reason if last_mode == "scripted" and last_reason not in by_design else view["offlineReason"]) if offline else "",
              "mode": "claude" if use_claude and not offline else "scripted"}
    return {**r, "state": {**st, **claude}, "claude": claude}


@router.get("/state")
async def state() -> JSONResponse:
    return answer(await run_in_threadpool(read_state))


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


@router.post("/understand")
async def understand(request: Request) -> JSONResponse:
    body = await _body(request)
    text = body.get("text")
    if not isinstance(text, str) or not text.strip():
        return answer({"ok": False, "code": "invalid", "message": "send { text, context?, pending? }"})
    ctx = body.get("context") if isinstance(body.get("context"), dict) else None
    pending = body.get("pending") if isinstance(body.get("pending"), dict) else None
    return answer(await run_in_threadpool(run_understand, text[:500], ctx, pending))


@router.get("/history")
async def history(mode: str = "", limit: int = 100) -> JSONResponse:
    if mode and mode not in ("claude", "scripted"):
        return answer({"ok": False, "code": "invalid", "message": "mode is claude or scripted"})
    args = ["history", "--limit", str(max(1, min(500, int(limit))))] + (["--mode", mode] if mode else [])
    return answer(await run_in_threadpool(cli, *args))


@router.post("/history")
async def record(request: Request) -> JSONResponse:
    body = await _body(request)
    entry = body.get("entry") if isinstance(body.get("entry"), dict) else body
    return answer(await run_in_threadpool(cli, "record", stdin=json.dumps(entry)))
