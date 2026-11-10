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


# ---------- Who does what (crew-roles@1): every role's employee, the actor behind each activity entry ----------

ROLE_ID = re.compile(r"^[a-z][a-z0-9.-]{0,59}$")


@router.get("/roles")
def roles() -> dict[str, Any]:
    """The Who does what board: every role (orchestrator, dispatcher, apps, actions) and the employee holding it."""
    return _run("roles")


async def _json_body(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "send a JSON object")
    return data


@router.post("/roles/assign")
async def roles_assign(request: Request) -> dict[str, Any]:
    """Give a role to another employee: {role, agent, note?}. Kept with its history; posted in the group chat."""
    data = await _json_body(request)
    role, agent, note = data.get("role"), data.get("agent"), data.get("note") or ""
    if not isinstance(role, str) or not ROLE_ID.match(role) or not isinstance(agent, str) or not agent.strip() or len(agent) > 60:
        raise HTTPException(400, "a role and an agent are needed")
    if not isinstance(note, str) or len(note) > 200:
        raise HTTPException(400, "note must be a short text")
    r = _run("assign", role, agent.strip(), *([note] if note.strip() else []))
    ROLES._at = 0.0  # the next annotation reads the new holder
    return r


@router.get("/roles/who")
def roles_who(source: str = "", kind: str = "", title: str = "", id: str = "", by: str = "") -> dict[str, Any]:
    """The employee behind one activity entry (any of id, source, kind, title, by). Read-only."""
    item = {k: v[:300] for k, v in {"id": id, "source": source, "kind": kind, "title": title, "by": by}.items() if v}
    return _run("who", json.dumps(item))


@router.get("/agents/{agent}/history")
def agent_history(agent: str, limit: int = 100) -> dict[str, Any]:
    """One employee: the roles they hold, their Activity Monitor history (newest first), their runs and reassignments."""
    if not ID.match(agent):
        raise HTTPException(400, "bad agent id")
    return _run("history", agent, str(max(1, min(limit, 1000))))


class RolesService:
    """Capability `axf.crew-roles@1`: who did what. `annotate(items)` sets `actor` on Activity Monitor entries
    ({agent, name, title, avatar, roleId, roleLabel, why}) and logs each new entry state to that employee's history.
    One `swarm.mjs who` call only when entries the service hasn't seen (id + state) appear; answers are kept per id."""
    version = 1
    MAX_CACHE = 2000

    def __init__(self) -> None:
        self._at = 0.0
        self._cache: dict[str, dict[str, Any] | None] = {}

    def board(self) -> dict[str, Any]:
        r = _run("roles")
        return r.get("board") or {}

    def annotate(self, items: list[dict[str, Any]]) -> list[dict[str, Any]]:
        import time
        if self._at == 0.0:
            self._cache.clear()
        key = lambda it: f"{it.get('id', '')}\u0000{it.get('state', '')}"  # noqa: E731
        fresh = [it for it in items if key(it) not in self._cache]
        if fresh:
            fresh = fresh[:200]
            slim = [{k: str(it.get(k))[:400] for k in ("id", "source", "kind", "title", "detail", "state", "url", "by", "agent") if it.get(k) is not None} for it in fresh]
            actors = _run("who", json.dumps(slim), "--record").get("actors") or []
            for i, it in enumerate(fresh):  # a failed read is remembered too: no node call per poll
                self._cache[key(it)] = (actors[i] or {}).get("actor") if i < len(actors) else None
            if len(self._cache) > self.MAX_CACHE:
                self._cache = dict(list(self._cache.items())[-self.MAX_CACHE // 2:])
            self._at = time.time()
        for it in items:
            a = self._cache.get(key(it))
            if a:
                it["actor"] = a
        return items


ROLES = RolesService()
_provide("axf.crew-roles@1", ROLES, "agent-swarm")
