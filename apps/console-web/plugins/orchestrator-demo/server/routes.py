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
STATUS = {"missing-deps": 409, "busy": 409, "invalid-transition": 409, "no-act": 409, "no-run": 404, "usage": 400, "bad-result": 400}


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


@router.get("/deps")
def deps() -> dict[str, Any]:
    """What the demo needs from the live build status build (real-time grids, break alert, broke dialog) and what is missing."""
    return answer(run_runner("deps"))


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """The plugin settings: Pause between steps default, the minimum gap between acts (30 s, never lower)."""
    return answer(run_runner("settings"))


@router.get("/summary")
def summary() -> dict[str, Any]:
    """The last run's summary: passed / failed / skipped per act with what failed and the evidence, and the cleanup."""
    return answer(run_runner("summary"))


# ---------------------------------------------------------------- the lander self-test (demo-selftest@1, Nov 18 2026)
SELFTEST_TIMEOUT_S = 120
HEALTH_ID = "demo-selftest"
_health = {"done": False}


@router.post("/selftest")
def selftest() -> dict[str, Any]:
    """Run the lander self-test now (demo-selftest@1): the live gate verdict on a throwaway PR (a missing review lands flagged, a
    waiting one holds), the real review lookup in the console, the merge queue in check mode and the held-prs state. The demo
    runs it before its landing act; a failure stops the demo and raises the demo-selftest systems check item. Same call as MCP
    orchestrator-demo_selftest, `axf demo selftest` and the voice phrase "run the demo self-test"."""
    _ensure_health()
    try:
        p = subprocess.run(["node", str(RUNNER), "selftest"], cwd=str(ROOT), capture_output=True, text=True, timeout=SELFTEST_TIMEOUT_S, env=os.environ.copy())
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(500, f"the self-test could not run: {type(e).__name__}: {e}"[:400], headers={"X-Axf-Code": "runner-failed"}) from None
    line = next((x for x in reversed(p.stdout.strip().splitlines()) if x.startswith("{")), "")
    try:
        res = json.loads(line) if line else {"ok": False, "code": "runner-failed", "error": (p.stderr or "no answer")[-400:]}
    except json.JSONDecodeError:
        res = {"ok": False, "code": "runner-failed", "error": line[-400:]}
    return answer(res)


@router.get("/selftest")
def selftest_last() -> dict[str, Any]:
    """The saved result of the last lander self-test (demo-selftest@1), or ran: false when none has run."""
    _ensure_health()
    return answer(run_runner("selftest", "--last"))


def _selftest_check() -> dict[str, Any]:
    """health@1 run(): red when the last self-test failed (the demo stopped before its landing act), green when it passed."""
    res = run_runner("selftest", "--last")
    t = res.get("selftest") if res.get("ok") else None
    if not t:
        return {"status": "info", "summary": "The lander self-test has not run yet: it runs before the demo's landing act, or on demand (axf demo selftest)."}
    bad = [c for c in (t.get("checks") or []) if not c.get("ok")]
    when = str(t.get("at") or "").replace("T", " ")[:16]
    if bad:
        return {"status": "error", "summary": f"The lander failed its own test at {when} UTC: {', '.join(str(c.get('id')) for c in bad)}. The demo stopped before its landing act. Press Run the self-test again once fixed.",
                "details": [f"{c.get('id')}: {c.get('detail')}" for c in (t.get("checks") or [])],
                "breaks": "The demo cannot prove the lander path, and a lander that fails this test would hold or mishandle real PRs too."}
    return {"status": "ok", "summary": f"The lander passed its self-test at {when} UTC ({len(t.get('checks') or [])} checks: gate verdict, review lookup, queue check, held PRs).",
            "details": [f"{c.get('id')}: {c.get('detail')}" for c in (t.get("checks") or [])]}


def _selftest_fix() -> dict[str, Any]:
    r = selftest()
    t = r.get("selftest") or {}
    if t.get("ok"):
        return {"state": "done", "message": "The lander self-test passed."}
    bad = [c for c in (t.get("checks") or []) if not c.get("ok")]
    return {"state": "failed", "message": f"Still failing: {'; '.join(f"{c.get('id')}: {c.get('detail')}" for c in bad)[:300]}"}


def _ensure_health() -> None:
    """Register the demo-selftest item with the systems check (axf.health@1) once it is there."""
    if _health["done"]:
        return
    try:
        import plugin_services  # the console's capability registry (absent in a bare test import)
        reg = plugin_services.get("axf.health@1")
    except Exception:  # noqa: BLE001
        return
    if reg is None:
        return
    try:
        reg.register({"id": HEALTH_ID, "label": "The lander passes its own test", "service": "github", "order": 33, "interval": 300,
                      "run": _selftest_check,
                      "breaks": "The orchestrator demo cannot prove the lander path; a lander that fails this test would hold or mishandle real PRs too.",
                      "autoFix": {"label": "Run the self-test again", "mode": "ask", "run": _selftest_fix},
                      "instructions": ["Read which check failed (gate verdict, review lookup, queue check, held PRs) and fix that part; then press Run the self-test again.",
                                       "CLI: axf demo selftest · REST POST /api/plugins/orchestrator-demo/selftest · MCP orchestrator-demo_selftest · voice: run the demo self-test.",
                                       "The demo runs this test by itself before its landing act and stops when it fails."]}, "orchestrator-demo")
        _health["done"] = True
    except Exception:  # noqa: BLE001 — the plugin works without its item
        return


_ensure_health()
