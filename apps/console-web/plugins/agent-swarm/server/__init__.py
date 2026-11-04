"""Server part of the agent swarm. Mounted at /api/plugins/agent-swarm/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (swarm.mjs --json), so the console, the CLI and the orchestrator share one set of rules.
Build-step runs (claude -p) are started from the CLI, never from here: a page request can't spend tokens. The one
exception is Breakroom → Jobs → Run: an explicit POST that routes one job-type run to its owning agent (jobs.mjs), so a
GET never spends anything.
Never exposed on the console MCP.

Capability axf.crew@1 (for other plugins, e.g. the Claude plugin's agent picker): crew() = every agent with status,
pay, spend, hours and stats; book(entry) = book a Claude session on an agent's card (swarm.mjs book); post(msgs) /
messages(limit, channel) = the group chat for another plugin's server part (the Session sync plugin's Sessions channel).
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
CLI = Path(__file__).resolve().parent.parent / "swarm.mjs"
JOBS = CLI.parent / "jobs.mjs"
ROOT = CLI.parents[3]
MAX_BODY = 64 * 1024
ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")


def _run(*args: str, cli: Path = CLI) -> dict[str, Any]:
    proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=90)
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

    def post(self, msgs: list[dict[str, Any]]) -> int:
        """Post lines into the group chat (validated like every line: speaker, kind, job; `channel` picks the Sessions channel)."""
        r = _run("post", json.dumps(msgs))
        if not r.get("ok"):
            raise ValueError("; ".join(f"{e.get('field')}: {e.get('message')}" for e in r.get("errors") or []) or r.get("error") or "post failed")
        return int(r.get("posted") or 0)

    def messages(self, limit: int = 200, channel: str = "") -> list[dict[str, Any]]:
        """The chat's last `limit` messages (optionally one channel), newest last."""
        r = _run("messages", str(max(1, min(limit, 2000))), *([f"--channel={channel}"] if channel else []))
        if not r.get("ok"):
            raise RuntimeError(r.get("error") or "messages read failed")
        return r.get("messages") or []


plugin_services.provide("axf.crew@1", CrewService(), CLI.parent.name)


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
