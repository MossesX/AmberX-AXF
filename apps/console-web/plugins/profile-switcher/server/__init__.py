"""Server part of the Profile switcher plugin. Mounted at /api/plugins/profile-switcher/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (switcher.mjs --json), so the widget, the CLI and MCP share one filter and one active
profile. plugin-commands@1 turns these routes into REST (/api/control/profile-switcher/<command>), MCP tools and
`axf profile-switcher <command>`; the ids below are the command names (profiles_list, profile_select,
profile_current, profile_filter, …).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "switcher.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 32 * 1024
TARGET = re.compile(r"^(all|[a-z0-9][a-z0-9-]{0,39})$")
FILTER = re.compile(r"^(all|[a-z0-9][a-z0-9-]{0,39}(,[a-z0-9][a-z0-9-]{0,39}){0,19})$")


def _run(*args: str) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=60,
                          env={**os.environ, "AXF_ACTOR": "profile-switcher"})
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


async def _json(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "an object is needed")
    return data


def _filter_arg(v: Any) -> str:
    if isinstance(v, list):
        v = ",".join(str(x) for x in v)
    if isinstance(v, dict):
        v = "all" if v.get("all") else ",".join(str(x) for x in v.get("ids") or [])
    s = str(v or "all").strip().lower() or "all"
    if not FILTER.match(s):
        raise HTTPException(400, "profiles: 'all' or profile ids separated by commas")
    return s


@router.get("/profiles")
def profiles_list() -> dict[str, Any]:
    """Every build profile with its build counts (open, running), the active profile and the view filter."""
    return _run("list")


@router.get("/current")
def profile_current() -> dict[str, Any]:
    """The active profile (where new builds go) and the view filter every builds table draws."""
    return _run("current")


@router.post("/select")
async def profile_select(request: Request) -> dict[str, Any]:
    """{id}: make that profile the active one and show only it. {id: "all"}: show every profile (active unchanged)."""
    data = await _json(request)
    target = str(data.get("id") or "").strip().lower()
    if not TARGET.match(target):
        raise HTTPException(400, "id: a profile id or 'all'")
    return _run("select", target)


@router.get("/filter")
def profile_filter() -> dict[str, Any]:
    """The view filter (profile-filter@1) and what it hides."""
    return _run("filter")


@router.post("/filter")
async def profile_filter_set(request: Request) -> dict[str, Any]:
    """{profiles: 'all' | 'a,b' | [ids]} sets the view filter; {toggle: id} adds or takes off one profile. Active profile unchanged."""
    data = await _json(request)
    if data.get("toggle"):
        t = str(data["toggle"]).strip().lower()
        if not TARGET.match(t) or t == "all":
            raise HTTPException(400, "toggle: a profile id")
        return _run("filter", "--toggle", t)
    return _run("filter", _filter_arg(data.get("profiles")))


@router.get("/visible")
def profile_visible(profiles: str | None = None) -> dict[str, Any]:
    """The builds the filter shows: what every bulk command acts on. profiles='all' or 'a,b' overrides the saved filter."""
    return _run("visible", *(["--profiles", _filter_arg(profiles)] if profiles else []))


@router.get("/settings")
def switcher_settings() -> dict[str, Any]:
    """The widget's settings: counts on/off, compact/full, hidden profiles, order, chip tones, placements."""
    return _run("settings")


@router.post("/settings")
async def switcher_settings_save(request: Request) -> dict[str, Any]:
    """Save widget settings (any of counts, mode, hidden, order, tones, placements); the rest stay."""
    data = await _json(request)
    return _run("settings", json.dumps(data))
