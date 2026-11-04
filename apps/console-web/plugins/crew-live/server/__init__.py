"""Crew (server part). Mounted at /api/plugins/crew-live/ (console token on every route, 404 while the plugin is off).

Every agent working right now and exactly what each is doing, read from files and git only (zero tokens; crew.py):

  GET  agents                      the crew@1 snapshot: runs (working / waiting / stuck first, then recently finished),
                                   off-the-clock crew members, totals (working, cost running now, cost today)
  GET  agents/{run}                one run (a tmux session name ``axf-…`` or an agent id) with its steps and tool calls
  GET  agents/{run}/files          the files its build changed vs the base (created / modified / deleted)
  GET  agents/{run}/diff?path=…    one file's diff vs the base, as hunks
  POST agents/{run}/stop           end the run (its tmux session on the VPS); needs a confirm
  GET  live                        server-sent events: a ``crew`` frame with the snapshot whenever it changes

Sources are capabilities, looked up per request, never other plugins' folders: ``axf.headless@1`` (the Terminal: tmux
list, live meters, kill) and ``axf.swarm-roster@1`` (the agent swarm: names, avatars, pay). Without them the Crew still
lists runs from the worktrees' stream logs and shows unnamed agents with initials. One snapshot is computed at most
every SNAPSHOT_TTL seconds however many browsers watch; the live feed only sends when it changed.
"""
from __future__ import annotations

import asyncio
import hashlib
import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import plugin_services

from . import crew

router = APIRouter()
HEADLESS = "axf.headless@1"
ROSTER = "axf.swarm-roster@1"
SNAPSHOT_TTL = 2.0
LIVE_EVERY = 2.0
STORE = crew.ROOT / "_claude" / "builds" / "store.json"
BUILDS_ROOT = os.environ.get("AXF_BUILDS_ROOT", "/root/axf-builds")

_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "value": None, "sig": ""}


def _roster() -> list[dict[str, Any]]:
    svc = plugin_services.get(ROSTER)
    try:
        return list(svc.agents()) if svc else []
    except Exception:  # noqa: BLE001 — a broken roster never breaks the Crew
        return []


def _sessions(now: float) -> tuple[list[dict[str, Any]], dict[str, Any], dict[str, Any]]:
    """Live tmux sessions (live=True) + recent stream logs no tmux lists (live=False when tmux could be read)."""
    svc = plugin_services.get(HEADLESS)
    live: list[dict[str, Any]] = []
    source = {"headless": svc is not None, "ready": False, "why": ""}
    meters: dict[str, Any] = {}
    if svc:
        try:
            v = svc.sessions()
            source.update(ready=bool(v.get("ready")), why=str(v.get("why") or ""))
            live = [{**x, "live": True} for x in v.get("items") or []]
            if live:
                meters = (svc.meters([x["name"] for x in live]) or {}).get("items") or {}
        except Exception as e:  # noqa: BLE001
            source["why"] = str(e)[:200]
    names = {x["name"] for x in live}
    for s in crew.discover_sessions(BUILDS_ROOT, now):
        if s["name"] not in names:
            out = {**s, "live": False if source["ready"] else None}
            live.append(out)
    return live, meters, source


def snapshot(force: bool = False) -> dict[str, Any]:
    with _lock:
        now = time.time()
        if not force and _cache["value"] is not None and now - _cache["at"] < SNAPSHOT_TTL:
            return _cache["value"]
        sessions, meters, source = _sessions(now)
        roster = _roster()
        value = crew.snapshot(sessions, meters, crew.store_builds(STORE), roster, now)
        value["source"] = {**source, "roster": bool(roster)}
        body = json.dumps({k: v for k, v in value.items() if k != "now"}, sort_keys=True, default=str)
        _cache.update(at=now, value=value, sig=hashlib.sha1(body.encode()).hexdigest())
        return value


def _find(run: str) -> dict[str, Any]:
    snap = snapshot()
    for r in snap["runs"]:
        if r["id"] == run or r["name"] == run:
            return r
    for r in snap["runs"]:  # an agent id: their newest run that isn't finished, else their newest
        if r["agent"]["id"] == run and r["status"] != "idle":
            return r
    for r in reversed(snap["runs"]):
        if r["agent"]["id"] == run:
            return r
    raise HTTPException(404, "no such run or agent at work")


@router.get("/agents")
def agents() -> dict[str, Any]:
    """Every agent working right now (and recently finished), with what each is doing, cost, tokens and build step."""
    return snapshot()


@router.get("/agents/{run}")
def agent(run: str) -> dict[str, Any]:
    """One run in full: what it is doing now, its steps done / now / next, its recent tool calls with their cost."""
    return {"run": _find(run)}


@router.get("/agents/{run}/files")
def files(run: str) -> dict[str, Any]:
    """The files this run's build created, modified or deleted vs its base (git, the build's worktree)."""
    r = _find(run)
    if not r["cwd"]:
        return {"ok": False, "files": [], "why": "this run has no worktree"}
    return crew.changed_files(r["cwd"], crew.parse_ts(r["startedAt"]))


@router.get("/agents/{run}/diff")
def diff(run: str, path: str) -> dict[str, Any]:
    """One file's change vs the build's base as a unified diff and hunks."""
    r = _find(run)
    try:
        return crew.file_diff(r["cwd"], path)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.post("/agents/{run}/stop")
def stop(run: str) -> dict[str, Any]:
    """Stop the run: its tmux session on the VPS ends (the agent is killed). The browser confirms first."""
    r = _find(run)
    svc = plugin_services.get(HEADLESS)
    if not svc:
        raise HTTPException(409, "the Terminal plugin (axf.headless@1) is off, so nothing can stop a run")
    if r["status"] == "idle":
        return {"ok": True, "already": True, "run": r["id"]}
    try:
        out = svc.kill(r["id"])
    except KeyError as e:
        raise HTTPException(404, str(e)) from None
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    snapshot(force=True)
    return {"ok": True, "run": r["id"], **(out if isinstance(out, dict) else {})}


@router.get("/live")
async def live() -> StreamingResponse:
    """Server-sent events: `crew` with the whole snapshot at once and again whenever anything in it changes."""
    async def gen():
        sent = ""
        yield "retry: 3000\n\n"
        idle = 0.0
        while True:
            snap = await asyncio.to_thread(snapshot)
            if _cache["sig"] != sent:
                sent = _cache["sig"]
                idle = 0.0
                yield f"event: crew\ndata: {json.dumps(snap, default=str)}\n\n"
            else:
                idle += LIVE_EVERY
                if idle >= 20:
                    idle = 0.0
                    yield ": keepalive\n\n"
            await asyncio.sleep(LIVE_EVERY)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})
