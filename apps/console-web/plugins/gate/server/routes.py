"""Gate & rules REST routes (gate-rules@1, framework/spec/GATE.md). Mounted at /api/plugins/gate/.

Every route runs the plugin's one Node implementation (gate.mjs api <op>), so the console page, the MCP tools
(plugin-commands@1: gate_*), the CLI (`axf gate …`) and voice give the same record for the same input.

  GET  rules [?kind&enabled&owner]      gate-rule-set@1
  GET  rules/<id>                       the rule + what Reset would give it
  PUT  rules/<id> {enabled?, severity?, settings?, owner?, title?, description?, reason?}
  POST rules/<id>/toggle {enabled}      switch one rule on or off
  POST rules/reset {id?, confirm?}      two-step: the first call answers confirmation_required with a token
  GET  check ?pr= | ?branch=            gate-verdict@1 for one PR (changes nothing)
  GET  history [?kind&since&pr&rule&action&limit]
  GET  lander                           lander-state@1 without the bodies (status, mode, counts, last run)
  GET  lander/waiting [?rule&state]     waiting PRs with the rule that holds each and why
  GET  lander/runs [?limit&result]      the last runs, newest first
  GET  lander/mode · POST lander/mode {mergeQueue}   the one Merge queue on/off switch (takes effect at once)
  POST lander/land-now {pr, confirm?}   two-step: puts the PR at the head of the line in the current mode
  POST lander/pause {why?} · POST lander/resume
  GET  settings · PUT settings {refreshSec?, historySize?, defaultTab?}

Writes take `by` and `reason` ({title, description} or text) from the body; `by` defaults to the signed-in user.
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
PLUGIN_DIR = Path(__file__).resolve().parents[1]
CLI = PLUGIN_DIR / "gate.mjs"
ROOT = Path(__file__).resolve().parents[5]
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503, "failed": 502}
MAX_BODY = 64 * 1024


def run(op: str, data: dict[str, Any] | None = None, timeout: int = 90) -> dict[str, Any]:
    """One gate op through the Node implementation: { ok, … } or { ok: false, code, message }."""
    try:
        p = subprocess.run(["node", str(CLI), "api", op], cwd=ROOT, capture_output=True, text=True, timeout=timeout, input=json.dumps(data or {}))
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the gate could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "failed", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "failed", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    # a two-step press's first call is an answer, not an error: the token is in it
    ok = r.get("ok") or r.get("code") == "confirmation_required"
    return JSONResponse(r, status_code=200 if ok else STATUS.get(str(r.get("code")), 500))


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
    body = body if isinstance(body, dict) else {}
    # plugin-commands sends {input: {...}, by, reason}; a page sends the fields themselves
    if isinstance(body.get("input"), dict):
        body = {**body["input"], **{k: body[k] for k in ("by", "reason", "confirm") if body.get(k)}}
    return body


async def _write(op: str, request: Request, extra: dict[str, Any] | None = None) -> JSONResponse:
    body = await _body(request)
    data = {**body, **(extra or {})}
    if not data.get("by"):
        data["by"] = _who(request)
    return answer(await run_in_threadpool(run, op, data))


async def _read(op: str, data: dict[str, Any]) -> JSONResponse:
    return answer(await run_in_threadpool(run, op, {k: v for k, v in data.items() if v not in (None, "")}))


# ---------------------------------------------------------------------- rules

@router.get("/rules")
async def rules_list(kind: str = "", enabled: str = "", owner: str = "") -> JSONResponse:
    """The gate rule set (gate-rule-set@1), optionally filtered by kind, enabled (true/false) and owner."""
    return await _read("rules_list", {"kind": kind, "enabled": enabled, "owner": owner})


@router.post("/rules/reset")
async def rules_reset(request: Request) -> JSONResponse:
    """Reset one rule ({id}) or the whole set to the defaults; the first call answers confirmation_required with a token."""
    return await _write("rules_reset", request)


@router.get("/rules/{rule_id}")
async def rules_get(rule_id: str) -> JSONResponse:
    """One gate rule and the default it would get on Reset."""
    return await _read("rules_get", {"id": rule_id})


@router.put("/rules/{rule_id}")
async def rules_set(rule_id: str, request: Request) -> JSONResponse:
    """Change one rule: enabled, severity (block, warn, info), owner, settings (merged), title, description."""
    return await _write("rules_set", request, {"id": rule_id})


@router.post("/rules/{rule_id}/toggle")
async def rules_toggle(rule_id: str, request: Request) -> JSONResponse:
    """Switch one gate rule on or off ({enabled: true|false})."""
    return await _write("rules_toggle", request, {"id": rule_id})


@router.get("/check")
async def check_pr(pr: str = "", branch: str = "") -> JSONResponse:
    """Can this PR land? The gate verdict for one PR (gate-verdict@1) from what the lander knows; changes nothing."""
    return await _read("check_pr", {"pr": pr, "branch": branch})


@router.get("/history")
async def history(kind: str = "", since: str = "", pr: str = "", rule: str = "", action: str = "", limit: int = 100) -> JSONResponse:
    """Rule changes and lander actions, newest first, filtered by kind (rule, lander), since, pr, rule, action."""
    return await _read("history", {"kind": kind, "since": since, "pr": pr, "rule": rule, "action": action, "limit": limit})


# ---------------------------------------------------------------------- the auto-lander

@router.get("/lander")
async def lander_status() -> JSONResponse:
    """The auto-lander: status (running, paused, idle, off, error), the Merge queue switch, the PR landing, counts, last run."""
    return await _read("lander_status", {})


@router.get("/lander/waiting")
async def lander_waiting(rule: str = "", state: str = "") -> JSONResponse:
    """PRs waiting to land, each with the gate rule that holds it and why."""
    return await _read("lander_waiting", {"rule": rule, "state": state})


@router.get("/lander/runs")
async def lander_runs(limit: int = 20, result: str = "") -> JSONResponse:
    """The lander's last runs, newest first (auto-lander-run@1)."""
    return await _read("lander_runs", {"limit": limit, "result": result})


@router.get("/lander/mode")
async def lander_mode() -> JSONResponse:
    """The Merge queue switch: on = the stacked merge queue, off (default) = one at a time."""
    return await _read("lander_mode", {})


@router.post("/lander/mode")
async def lander_mode_set(request: Request) -> JSONResponse:
    """Flip the Merge queue switch ({mergeQueue: true|false}); takes effect at once and is logged in History."""
    return await _write("lander_mode", request)


@router.post("/lander/land-now")
async def lander_land_now(request: Request) -> JSONResponse:
    """Land a PR next ({pr}); two-step: the first call answers confirmation_required with a token. Never a direct merge."""
    return await _write("lander_land_now", request)


@router.post("/lander/pause")
async def lander_pause(request: Request) -> JSONResponse:
    """Pause the auto-lander ({why}): the entry in flight finishes, nothing new starts."""
    return await _write("lander_pause", request)


@router.post("/lander/resume")
async def lander_resume(request: Request) -> JSONResponse:
    """Resume the auto-lander in its current mode."""
    return await _write("lander_resume", request)


# ---------------------------------------------------------------------- the plugin's settings

@router.get("/settings")
async def settings_get() -> JSONResponse:
    """The plugin's settings: refreshSec, historySize, defaultTab."""
    return await _read("settings_get", {})


@router.put("/settings")
async def settings_set(request: Request) -> JSONResponse:
    """Change the plugin's settings (refreshSec 5-600, historySize 50-20000, defaultTab rules|auto-lander|history)."""
    return await _write("settings_set", request)
