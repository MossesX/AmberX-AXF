"""Server part of the agent swarm. Mounted at /api/plugins/agent-swarm/.

The console adds the console-token check (every method) and the 404 while disabled. Every read and change goes
through the plugin's CLI (swarm.mjs --json), so the console, the CLI and the orchestrator share one set of rules.
Build-step runs (claude -p) are started from the CLI, never from here: a page request can't spend tokens. The one
exception is Breakroom → Jobs → Run: an explicit POST that routes one job-type run to its owning agent (jobs.mjs), so a
GET never spends anything.
Never exposed on the console MCP.

Capability axf.crew@1 (for other plugins, e.g. the Claude plugin's agent picker): crew() = every agent with status,
pay, spend, hours and stats; book(entry) = book a Claude session on an agent's card (swarm.mjs book).
Capability axf.crew-sections@1 (crew-sections@1, sections.mjs): say(section, event, text, ref) = a section's event in the
group chat as its owner; GET sections / POST sections/assign = the owners board in the settings tab.
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


# ---------------------------------------------------------------- HR: builder hires (Brett approves) and training
APPROVER_KEYS = ("AXF_APPROVER", "AXF_APPROVER_VIA")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
AGENT_ID = re.compile(r"^[a-z0-9-]{1,40}$")


def _hr(*args: str, approver: str = "") -> dict[str, Any]:
    """jobs.mjs HR commands. The approver is never inherited: only Brett's own console click sets it."""
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}
    if approver:
        env.update(AXF_APPROVER=approver, AXF_APPROVER_VIA="console")
    proc = subprocess.run(["node", str(JOBS), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=120, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


async def _json(request: Request) -> dict[str, Any]:
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    if not isinstance(data, dict):
        raise HTTPException(400, "a JSON object is needed")
    return data


@router.get("/hr/hire-requests")
def hr_hire_requests() -> dict[str, Any]:
    """Builder hire requests (hire-request@1), open first."""
    return _hr("hire-requests")


@router.post("/hr/hire-request")
async def hr_hire_request(request: Request) -> dict[str, Any]:
    """File a builder hire request (one open at a time) and notify Brett. Body: {build?, why?}."""
    data = await _json(request)
    args = ["hire-request"]
    if isinstance(data.get("build"), str) and ID.match(data["build"]):
        args += ["--build", data["build"]]
    if isinstance(data.get("why"), str):
        args += ["--why", data["why"][:400]]
    return _hr(*args)


@router.post("/hr/hire-requests/{request_id}/{decision}")
def hr_decide(request_id: str, decision: str, request: Request) -> dict[str, Any]:
    """Approve (hire a builder, assign the waiting build) or deny. Only Brett's own signed-in console click decides."""
    if not ID.match(request_id) or decision not in ("approve", "deny"):
        raise HTTPException(400, "approve or deny a known request")
    who = _brett_click(request)
    if not who:
        raise HTTPException(403, "only Brett's own signed-in console click (or an axHub approval) can decide a hire")
    return _hr(f"hire-{decision}", request_id, approver=who)


@router.get("/hr/knowledge/{agent}")
def hr_knowledge(agent: str) -> dict[str, Any]:
    """The website pages an employee was trained on, and the digest their briefs carry."""
    if not AGENT_ID.match(agent):
        raise HTTPException(400, "bad agent id")
    return _hr("knowledge", agent)


@router.post("/hr/knowledge/{agent}")
async def hr_train(agent: str, request: Request) -> dict[str, Any]:
    """Train an employee on a website: {url, crawl?} (crawl = up to 20 more same-site pages)."""
    data = await _json(request)
    url = data.get("url")
    if not AGENT_ID.match(agent) or not isinstance(url, str) or not re.match(r"^https?://", url) or len(url) > 1000:
        raise HTTPException(400, "an employee and an http(s) url are needed")
    crawl = data.get("crawl", 0)
    if not isinstance(crawl, int) or not 0 <= crawl <= 20:
        raise HTTPException(400, "crawl is 0 to 20")
    return _hr("train", agent, url, "--crawl", str(crawl))


@router.delete("/hr/knowledge/{agent}/{page}")
def hr_forget(agent: str, page: str) -> dict[str, Any]:
    """Remove one trained page (or `all`)."""
    if not AGENT_ID.match(agent) or not re.match(r"^(all|p[a-z0-9]{1,12})$", page):
        raise HTTPException(400, "bad agent or page id")
    return _hr("forget", agent, page)


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


# ---------------------------------------------------------------- section owners (crew-sections@1)

SECTIONS = CLI.parent / "sections.mjs"
SECTION_ID = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
EVENTS = ("start", "done", "failed", "blocked", "waiting")


class CrewSectionsService:
    """Capability `axf.crew-sections@1`: a section that acts on its own posts its key events in the group chat as the
    employee who owns it. `say` returns at once (the post runs on a side thread, one at a time) and never raises, so a
    monitor or a notification is never held up by the chat. Node callers use framework/cli/crew-say.mjs instead."""
    version = 1

    def __init__(self) -> None:
        import threading
        self._lock = threading.Lock()

    def owners(self) -> dict[str, Any]:
        return _run("list", cli=SECTIONS).get("board") or {}

    def say(self, section: str, event: str, text: str, ref: str = "") -> bool:
        import threading
        if not SECTION_ID.match(str(section or "")) or event not in EVENTS or not str(text or "").strip():
            return False
        args = ["post", section, event, str(text)[:600]]
        if ref:
            args += ["--ref", str(ref)[:80]]

        def go() -> None:
            with self._lock:  # one writer at a time: posts read, change and save the swarm state
                try:
                    _run(*args, cli=SECTIONS)
                except Exception:  # noqa: BLE001
                    pass
        threading.Thread(target=go, name="crew-say", daemon=True).start()
        return True


_provide("axf.crew-sections@1", CrewSectionsService(), "agent-swarm")


@router.get("/sections")
def sections() -> dict[str, Any]:
    """Every section that acts on its own, its owner (default and current), the events it posts, reassignment history."""
    return _run("list", cli=SECTIONS)


@router.post("/sections/assign")
async def sections_assign(request: Request) -> dict[str, Any]:
    """Brett reassigns a section: {section, agent, note?}. Saved in the data folder; Boss says it in the chat."""
    body = await request.body()
    if len(body) > MAX_BODY:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(body or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON")
    sec, agent = data.get("section") if isinstance(data, dict) else None, data.get("agent") if isinstance(data, dict) else None
    if not isinstance(sec, str) or not SECTION_ID.match(sec) or not isinstance(agent, str) or not ID.match(agent):
        raise HTTPException(400, "section and agent are needed")
    args = ["assign", sec, agent]
    note = data.get("note")
    if isinstance(note, str) and note.strip():
        args += ["--note", note.strip()[:200]]
    return _run(*args, cli=SECTIONS)
