"""Server part of the agent swarm. Mounted at /api/plugins/agent-swarm/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (swarm.mjs --json), so the console, the CLI and the orchestrator share one set of rules.
Build-step runs (claude -p) are started from the CLI, never from here: a page request can't spend tokens. The one
exception is Breakroom → Jobs → Run: an explicit POST that routes one job-type run to its owning agent (jobs.mjs), so a
GET never spends anything.
Never exposed on the console MCP.

Capability axf.crew@1 (for other plugins, e.g. the Claude plugin's agent picker): crew() = every agent with status,
pay, spend, hours and stats; book(entry) = book a Claude session on an agent's card (swarm.mjs book).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "swarm.mjs"
JOBS = CLI.parent / "jobs.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _run(*args: str, cli: Path = CLI, env: dict[str, str] | None = None) -> dict[str, Any]:
    proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=90,
                          env={**os.environ, **env} if env else None)
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


class CrewService:
    """Capability `axf.crew@1`: the crew for the Claude agent picker, and session booking on an agent's card."""

    def crew(self) -> list[dict[str, Any]]:
        r = _run("crew")
        if not r.get("ok"):
            raise RuntimeError(r.get("error") or "crew read failed")
        return r.get("crew") or []

    def book(self, entry: dict[str, Any]) -> dict[str, Any]:
        r = _run("book", json.dumps(entry))
        if not r.get("ok"):
            raise ValueError(r.get("error") or "booking failed")
        return r.get("run") or {}

    # ---- crew-profile@1: the one roster (every employee is an agent with a job title; crew-profiles.mjs)

    def profiles(self, sort: str = "working") -> list[dict[str, Any]]:
        r = _run("crew-list", "--sort", sort if sort in ("working", "name", "title") else "working", "--assistants", json.dumps(_assistants()))
        if not r.get("ok"):
            raise RuntimeError(r.get("error") or "crew read failed")
        return r.get("members") or []

    def profile(self, member: str) -> dict[str, Any]:
        r = _run("crew-get", member, "--assistants", json.dumps(_assistants()))
        if not r.get("ok"):
            raise LookupError(r.get("error") or "not found")
        return {**r["member"], "personaLine": r.get("personaLine", "")}

    def update(self, member: str, patch: dict[str, Any], owner: bool = False) -> dict[str, Any]:
        """Owner-only sections (pay, tools, safety, job title) need `owner` = Brett's signed-in console session; the
        MCP tool and other plugins never pass it."""
        args = ["crew-update", member, json.dumps(patch), "--assistants", json.dumps(_assistants())]
        r = _run(*args, "--owner", env={"AXF_CREW_OWNER": "1"}) if owner else _run(*args, env={"AXF_CREW_OWNER": ""})
        if not r.get("ok"):
            raise ValueError(r.get("error") or "update failed")
        return r.get("member") or {}


def _assistants() -> list[dict[str, Any]]:
    """The Agent manager's agents (axf.agents@1): on the roster with job title Assistant. Only a link, never a copy of
    their persona / skills / tools, which stay in the Agent manager."""
    svc = plugin_services.get("axf.agents@1")
    try:
        return [{k: a.get(k) for k in ("id", "name", "description", "origin", "dangerous")} for a in (svc.list_agents() if svc else [])][:60]
    except Exception:  # noqa: BLE001 — a broken Agent manager never breaks the roster
        return []


CREW = CrewService()
plugin_services.provide("axf.crew@1", CREW, CLI.parent.name)


def _owner(request: Request) -> bool:
    c = plugin_services.get("control@1")
    try:
        return bool(c is not None and hasattr(c, "owner") and c.owner(request))
    except Exception:  # noqa: BLE001
        return False


def _err(e: Exception) -> HTTPException:
    msg = str(e)
    code = 403 if msg.startswith("owner_only") else 404 if msg.startswith("not_found") else 400
    return HTTPException(code, msg)


@router.get("/crew")
def crew_list(sort: str = "working") -> dict[str, Any]:
    """The one roster: every member (owner, crew, assistants) with every profile section, working on top."""
    try:
        return {"ok": True, "$axf": "crew-roster@1", "members": CREW.profiles(sort)}
    except Exception as e:  # noqa: BLE001
        raise _err(e)


@router.get("/crew/{member}")
def crew_get(member: str) -> dict[str, Any]:
    if not ID.match(member):
        raise HTTPException(400, "bad member id")
    try:
        return {"ok": True, "member": CREW.profile(member)}
    except Exception as e:  # noqa: BLE001
        raise _err(e)


@router.patch("/crew/{member}")
async def crew_update(member: str, request: Request) -> dict[str, Any]:
    """Change profile sections ({persona: {...}, skills: [...], ...}). Pay, tools, safety and job title only from
    Brett's signed-in console session (403 owner_only otherwise)."""
    if not ID.match(member):
        raise HTTPException(400, "bad member id")
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        patch = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    try:
        return {"ok": True, "member": CREW.update(member, patch, owner=_owner(request))}
    except Exception as e:  # noqa: BLE001
        raise _err(e)


@router.get("/state")
def state() -> dict[str, Any]:
    return _run("state")


@router.get("/chat/mentions")
def chat_mentions(limit: int = 100, negative: bool = False) -> dict[str, Any]:
    """Group-chat messages about Brett (the boss, the owner), newest first, secrets redacted. Read-only."""
    args = ["mentions", str(max(1, min(limit, 500)))]
    if negative:
        args.append("--negative")
    return _run(*args)


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


class RosterService:
    """Capability `axf.swarm-roster@1`: the crew (roster + hired agents with their custom names, avatars, status, pay and
    today's spend), for plugins that show agents (the Crew, avatars everywhere). One `swarm.mjs state` read, kept 30 s."""
    version = 1
    TTL = 30.0

    def __init__(self) -> None:
        self._at = 0.0
        self._value: list[dict[str, Any]] = []

    def agents(self) -> list[dict[str, Any]]:
        import time
        if self._value and time.time() - self._at < self.TTL:
            return self._value
        st = (_run("state").get("state") or {})
        sw = (st.get("swarm") or {}).get("agents") or {}
        spend, pay = st.get("spend") or {}, st.get("pay") or {}
        out = []
        for a in (st.get("roster") or {}).get("agents") or []:
            s = sw.get(a.get("id")) or {}
            custom = ((s.get("custom") or {}).get("name") or "").strip()
            out.append({"id": a.get("id"), "name": custom or a.get("name"), "role": a.get("role"), "avatar": a.get("avatar"),
                        "salary": a.get("salary"), "status": s.get("status") or "", "catchphrase": a.get("catchphrase") or "",
                        "spentToday": ((spend.get(a.get("id")) or {}).get("today") or {}).get("usd") or 0,
                        "payLeft": (pay.get(a.get("id")) or {}).get("left")})
        self._value, self._at = out, time.time()
        return out


from plugin_services import provide as _provide  # noqa: E402

_provide("axf.swarm-roster@1", RosterService(), "agent-swarm")
