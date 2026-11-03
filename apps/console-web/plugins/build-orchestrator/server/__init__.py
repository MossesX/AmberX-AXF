"""Server part of the build orchestrator. Mounted at /api/plugins/build-orchestrator/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (orchestrator.mjs --json), so the console, the CLI and other sessions share one set of
rules and one tracker file (_claude/builds/orchestrator.json). Never exposed on the console MCP.

Model upgrades (framework/core/model-switch.mjs, Brett, Nov 3 2026): approving an upgrade (or answering an upgrade
request) counts only as Brett's own click: a browser signed in to axHub as an admin (wall session), with no
X-Axhub-Session / X-Axhub-Source header naming a session, build or agent. Only then does this route hand the CLI
AXF_APPROVER (his hub name) and AXF_APPROVER_VIA=console. The console token alone is not Brett: scripts and Claude
sessions hold it too. Downgrades need nobody.

Live sync (Nov 3 2026, orch-live-sync): the systems check gets the item `builds-live` (axf.health@1): red when store
changes can't reach main (framework/cli/builds-live.mjs keeps them queued), amber when the reconciler
(framework/cli/builds-reconcile.mjs) finds open PRs or claude/* branches that belong to no build, or hasn't run lately.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "orchestrator.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 256 * 1024
FOLDER = CLI.parent.name
LIVE_CLI = ROOT / "framework" / "cli" / "builds-live.mjs"
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "builds-live"
STUCK_MIN = 15  # store changes waiting this long for main = red
STALE_MIN = 40  # no reconciler report this long (it runs every 10 min) = amber


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
    ensure_health()
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


# ---- what Brett said (build-origin@1): framework/cli/build-origin.mjs, zero tokens

ORIGIN_CLI = ROOT / "framework" / "cli" / "build-origin.mjs"
SAID_MAX = 8000


def _origin(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(ORIGIN_CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}
    if not res.get("ok"):
        raise HTTPException(404 if "no build" in str(res.get("error", "")) else 400, str(res.get("error", "failed")))
    return res


def _said_args(body: dict[str, Any], who: str) -> list[str]:
    said = body.get("said")
    if not isinstance(said, str) or not said.strip():
        raise HTTPException(400, "said is required: Brett's exact words, unedited")
    if len(said) > SAID_MAX:
        raise HTTPException(413, "said is too long")
    args = ["--said", said, "--by", str(body.get("by") or who or "console")[:120]]
    for k in ("source", "at", "session", "link"):
        v = body.get(k)
        if isinstance(v, str) and v.strip():
            args += [f"--{k}", v.strip()[:500]]
    return args


async def _json_body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(body, dict):
        raise HTTPException(400, "a JSON object is needed")
    return body


@router.get("/origin/{build_id}")
def origin_get(build_id: str) -> dict[str, Any]:
    """What Brett said that started a build: his verbatim words, when, where, who launched it, the brief, addenda."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    return _origin("get", build_id)


@router.post("/origin/{build_id}")
async def origin_set(build_id: str, request: Request) -> dict[str, Any]:
    """Record what Brett said (verbatim) on a build that has no words yet; his words are never replaced."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    body = await _json_body(request)
    return _origin("set", build_id, *_said_args(body, brett_click(request)))


@router.post("/origin/{build_id}/addendum")
async def origin_addendum(build_id: str, request: Request) -> dict[str, Any]:
    """Add a later change Brett asked for (verbatim) to a build's origin."""
    if len(build_id) > 80:
        raise HTTPException(400, "id too long")
    body = await _json_body(request)
    return _origin("addendum", build_id, *_said_args(body, brett_click(request)))


# ---- systems check: live sync + reconciler (axf.health@1)

def _report_file() -> Path:
    data = os.environ.get("AXF_DATA_DIR") or ""
    if data and data != "off":
        return Path(data) / "builds" / "reconcile.json"
    hub = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data"
    return hub / "builds" / "reconcile.json" if hub.is_dir() else ROOT / ".axf-console" / "builds-reconcile.json"


def _age_min(iso: str, now: float) -> float:
    try:
        return (now - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()) / 60
    except (ValueError, AttributeError):
        return 1e9


def health_probe(live: dict[str, Any] | None = None, report: dict[str, Any] | None = None, now: float | None = None) -> dict[str, Any]:
    """Red: changes stuck before main. Amber: orphans, or the reconciler hasn't run. Green otherwise."""
    now = now if now is not None else time.time()
    if live is None:
        try:
            p = subprocess.run(["node", str(LIVE_CLI), "status", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=20)
            live = json.loads(p.stdout.strip().splitlines()[-1]) if p.stdout.strip() else {}
        except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError):
            live = {}
    if report is None:
        try:
            report = json.loads(_report_file().read_text())
        except (OSError, json.JSONDecodeError):
            report = {}
    details: list[str] = []
    queued = int(live.get("queued") or 0)
    if queued and live.get("error") and _age_min(str(live.get("lastError") or ""), now) < 60 and _age_min(str(live.get("lastOk") or ""), now) >= STUCK_MIN:
        return {"status": "error", "summary": f"{queued} build change(s) haven't reached main: {str(live.get('error'))[:200]}",
                "details": ["Banners and THREADS on main are behind until they go through.", "On the VPS: `node framework/cli/builds-live.mjs flush` retries and prints why."]}
    orphans = report.get("orphans") or {}
    prs, branches = orphans.get("prs") or [], orphans.get("branches") or []
    if report.get("at"):
        details.append(f"Reconciled {report.get('at')}: {report.get('prs', 0)} PRs, {report.get('branches', 0)} branches; {len(report.get('changes') or [])} fix(es), {len(report.get('suggestions') or [])} to check.")
    if not report.get("at") or _age_min(str(report.get("at")), now) > STALE_MIN:
        return {"status": "warn", "summary": "The builds reconciler hasn't run lately: PRs and branches may not be linked to their builds.", "details": details + [
            "It runs at session start and every 10 min (cron axf-builds-reconcile). Run it: `node framework/cli/builds-reconcile.mjs --apply`."]}
    if report.get("error"):
        return {"status": "warn", "summary": f"The builds reconciler couldn't read GitHub: {str(report.get('error'))[:200]}", "details": details}
    if prs or branches:
        lines = [f"PR #{p.get('number')} {p.get('branch')}: {p.get('title')}" for p in prs[:12]] + [f"branch {b.get('branch')} ({b.get('ahead')} commits, no PR)" for b in branches[:12]]
        return {"status": "warn", "summary": f"{len(prs)} open PR(s) and {len(branches)} branch(es) belong to no build.", "details": details + lines + [
            "Add each to a build in the Build orchestrator (set its branch / PR), or close it."]}
    return {"status": "ok", "summary": f"Builds are live on main; every open PR belongs to a build ({queued} change(s) queued).", "details": details}


_health_done = False


def ensure_health() -> bool:
    """Registers the live-sync item on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Builds reach main live", "service": "github", "order": 55, "severity": "error",
                      "run": lambda: health_probe(), "interval": 300,
                      "breaks": "The Build orchestrator, banners and THREADS on main show stale build status; finished work shows as pending.",
                      "instructions": ["`node framework/cli/builds-live.mjs status` / `flush` on the VPS.",
                                       "`node framework/cli/builds-reconcile.mjs` lists what it would link; `--apply` writes it (live)."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the orchestrator works without its health item
        return False
    _health_done = True
    return True


ensure_health()

