"""Server part of the bugs board. Mounted at /api/plugins/bugs-board/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (bugs.mjs --json), so the console, the MCP tools, the CLI and sessions share one set of rules.
A change from the console is Brett's (his drag is his call: the handoff is posted, the move stands).

Capability `axf.bugs@1` (for other plugins, e.g. a banner or the Build manager): board() = the board view;
change(c, by) = one bugs@1 change.
"""
from __future__ import annotations

import json
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "bugs.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 64 * 1024
ACTIONS = {"add", "update", "move", "reorder", "fix", "remove", "settings", "apply-moves", "optimize", "undo", "ask-brett", "new-build"}
WORD = re.compile(r"^[A-Za-z0-9 ._-]{0,80}$")


def _run(*args: str, timeout: int = 90) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": str(e)[:300]}
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _check(r: dict[str, Any]) -> dict[str, Any]:
    if not r.get("ok"):
        raise HTTPException(400, r.get("error") or "failed")
    return r


class BugsService:
    """Capability `axf.bugs@1`: the confirmed bugs board."""

    version = 1

    def board(self, status: str = "open") -> dict[str, Any]:
        return _run("list", "--status", status)

    def change(self, change: dict[str, Any], by: str = "console") -> dict[str, Any]:
        return _run("act", json.dumps(change), "--by", by)


plugin_services.provide("axf.bugs@1", BugsService(), CLI.parent.name)


@router.get("/board")
def board(status: str = "open", app: str = "", profile: str = "") -> dict[str, Any]:
    if status not in ("open", "all", "fixed", "wontfix", "confirmed", "in-build") or not WORD.match(app) or not WORD.match(profile):
        raise HTTPException(400, "bad filter")
    args = ["list", "--status", status]
    if app:
        args += ["--app", app]
    if profile:
        args += ["--profile", profile]
    return _check(_run(*args))


@router.get("/optimize")
def optimize_preview(all: bool = False) -> dict[str, Any]:
    """The optimizer's proposed moves (zero tokens; nothing changes)."""
    return _check(_run("optimize", *(["--all"] if all else [])))


@router.get("/banner")
def banner() -> dict[str, Any]:
    r = _run("list", "--status", "open")
    return {"ok": bool(r.get("ok")), **(r.get("banner") or {"open": 0, "unassigned": 0, "needsBrett": 0})}


@router.post("/act")
async def act(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "change too large")
    try:
        change = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(change, dict) or change.get("action") not in ACTIONS:
        raise HTTPException(400, f"a change needs one of: {', '.join(sorted(ACTIONS))}")
    return _check(_run("act", json.dumps(change), "--by", "brett"))
