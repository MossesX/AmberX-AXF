"""Server part of the Claude plugin (agent-pick@1). Mounted at /api/plugins/claude-session/.

Every Claude session (voice / chat Amber, Claude Code, headless) works AS a crew agent Brett assigns (Brett, Nov 3
2026). A session calls `claude_session_start` first; with "Ask me every session" on, the console pops the agent
picker for Brett (and axHub gets one held approval as the fallback, which reaches his phone through the AmberX app).
Until he answers, the session is the default agent. `claude_session_agent` tells a session who it is now; `claude_session_book`
puts its cost, time and commits on that agent's card (capability axf.crew@1, the Agent swarm).

The console adds the console-token check (every method) and the 404 while disabled; the plugin commands plugin turns
these routes into REST, MCP (`claude_session_<command>`) and CLI (`axf claude-session <command>`) commands. Only Brett answers an ask:
his own signed-in click in the console (an admin wall session with no X-Axhub-Session naming a session or agent), or
the axHub approval that carries the ask's ticket. Tickets are never shown to a session (only `asks` shows them, and
only to Brett's click). Nothing here calls a model.
"""
from __future__ import annotations

import fcntl
import json
import os
import re
import secrets
import threading
import time
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from . import hub

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
TAG = "agent-pick@1"
CREW = "axf.crew@1"
SLOTS = "axf.agent-slots@1"
CLIENTS = ("voice", "chat", "code", "headless")
ID = re.compile(r"^[A-Za-z0-9._-]{1,80}$")
SHA = re.compile(r"^[0-9a-f]{7,40}$")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
ASK_TTL_S = 30 * 60  # an unanswered ask lapses to the default agent after this
ACTIVE_S = 2 * 3600  # a session not heard from for this long no longer counts as working
KEEP = 300
DEFAULTS: dict[str, Any] = {"defaultAgent": "", "askEverySession": True, "askHeadless": False}
CREW_CACHE_S = 5
_crew_cache: dict[str, Any] = {"at": 0.0, "value": None}


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _age_s(iso: str) -> float:
    try:
        return time.time() - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except (ValueError, AttributeError):
        return 1e12


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_DIR") or (Path(os.environ.get("AXF_ROOT") or cx.ROOT) / ".axf-console" / "plugins" / FOLDER))


def _file() -> Path:
    return data_dir() / "agent-pick.json"


def _norm(raw: Any) -> dict[str, Any]:
    o = raw if isinstance(raw, dict) else {}
    s = o.get("settings") if isinstance(o.get("settings"), dict) else {}
    settings = {
        "defaultAgent": str(s.get("defaultAgent") or "")[:80],
        "askEverySession": s.get("askEverySession") is not False,
        "askHeadless": s.get("askHeadless") is True,
    }
    personas = {str(k)[:80]: {"persona": str((v or {}).get("persona") or "")[:1200], "voice": str((v or {}).get("voice") or "")[:300]}
                for k, v in (o.get("personas") or {}).items() if isinstance(v, dict)}
    sessions = [x for x in (o.get("sessions") or []) if isinstance(x, dict) and ID.match(str(x.get("id", "")))][-KEEP:]
    return {"$axf": TAG, "settings": settings, "personas": personas, "sessions": sessions}


@contextmanager
def store() -> Iterator[dict[str, Any]]:
    """The plugin's one file, read and written under a lock (sessions, settings and personas)."""
    f = _file()
    f.parent.mkdir(parents=True, exist_ok=True)
    with open(f.with_suffix(".lock"), "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            data = _norm(json.loads(f.read_text()) if f.exists() else {})
        except (OSError, ValueError):
            data = _norm({})
        before = json.dumps(data, sort_keys=True)
        yield data
        _lapse(data)
        if json.dumps(data, sort_keys=True) != before:
            tmp = f.with_suffix(f".tmp-{os.getpid()}")
            tmp.write_text(json.dumps(data, indent=1) + "\n")
            os.chmod(tmp, 0o600)
            tmp.replace(f)


def read() -> dict[str, Any]:
    with store() as d:
        return json.loads(json.dumps(d))


def _lapse(d: dict[str, Any]) -> None:
    """Asks nobody answered in time keep the default agent."""
    for s in d["sessions"]:
        if s.get("status") == "asking" and _age_s(s.get("startedAt", "")) > ASK_TTL_S:
            s.update(status="default", answeredAt=now_iso(), answeredBy="no answer (kept the default)")


# ---------------------------------------------------------------- the crew (capability axf.crew@1, the Agent swarm)

def crew(fresh: bool = False) -> list[dict[str, Any]]:
    svc = plugin_services.get(CREW)
    if svc is None:
        return []
    if not fresh and _crew_cache["value"] is not None and time.time() - _crew_cache["at"] < CREW_CACHE_S:
        return _crew_cache["value"]
    try:
        value = svc.crew()
    except Exception as e:  # noqa: BLE001 — the picker still works with what it has
        cx.log("plugins", f"claude: crew read failed: {str(e)[:200]}", "warn")
        value = _crew_cache["value"] or []
    _crew_cache.update(at=time.time(), value=value)
    return value


def find_agent(ref: str, roster: list[dict[str, Any]]) -> dict[str, Any] | None:
    r = str(ref or "").strip().lower()
    return next((a for a in roster if r and (a.get("id", "").lower() == r or a.get("name", "").lower() == r)), None)


def default_agent(d: dict[str, Any], roster: list[dict[str, Any]]) -> tuple[str, str]:
    """(agent id, source): the agent Brett set as default, else the first crew agent who can work."""
    a = find_agent(d["settings"]["defaultAgent"], roster)
    if a:
        return a["id"], "default"
    if d["settings"]["defaultAgent"] and not roster:
        return d["settings"]["defaultAgent"], "default"
    a = next((x for x in roster if x.get("works") and x.get("status") == "on-duty"), roster[0] if roster else None)
    return (a["id"], "fallback") if a else ("", "none")


def agent_card(agent_id: str, d: dict[str, Any], roster: list[dict[str, Any]]) -> dict[str, Any]:
    """What a session needs to be the agent: id, name, avatar, persona / voice notes, how to introduce itself, env."""
    a = find_agent(agent_id, roster) or {"id": agent_id, "name": agent_id}
    p = d["personas"].get(a["id"], {})
    name = a.get("name") or a["id"]
    return {"id": a["id"], "name": name, "role": a.get("role", ""), "avatar": a.get("avatar"), "catchphrase": a.get("catchphrase", ""),
            "persona": p.get("persona", "") or a.get("personaLine", ""), "voice": p.get("voice", ""),
            "intro": f"I'm {name}{', ' + a['role'] if a.get('role') else ''}, on this session for Brett." if a["id"] else "",
            "env": {"AXF_AGENT": a["id"]} if a["id"] else {}}


def should_ask(settings: dict[str, Any], client: str) -> bool:
    if not settings["askEverySession"]:
        return False
    return client != "headless" or settings["askHeadless"]


def _public(s: dict[str, Any], d: dict[str, Any], roster: list[dict[str, Any]]) -> dict[str, Any]:
    """A session as the session itself may see it (never the ticket)."""
    return {"session": s["id"], "client": s["client"], "summary": s.get("summary", ""), "status": s["status"], "source": s.get("source", ""),
            "startedAt": s["startedAt"], "answeredAt": s.get("answeredAt", ""), "answeredBy": s.get("answeredBy", ""),
            "asking": s["status"] == "asking", "agent": agent_card(s["agent"], d, roster)}


def _session(d: dict[str, Any], sid: str) -> dict[str, Any]:
    s = next((x for x in d["sessions"] if x["id"] == sid), None)
    if not s:
        raise HTTPException(404, f"no Claude session {sid!r}")
    return s


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "brett")[:120]


async def _body(request: Request, limit: int = 16_000) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "too large")
    try:
        data = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON") from None
    if not isinstance(data, dict):
        raise HTTPException(400, "an object is needed")
    return data


# ---------------------------------------------------------------- asks: console pop-up, bell, axHub approval

def _send_hub(sid: str, agent_name: str) -> None:
    with store() as d:
        s = next((x for x in d["sessions"] if x["id"] == sid), None)
        snap = dict(s) if s else None
    if not snap:
        return
    try:
        r = hub.ask(snap, agent_name)
        note = f"held on axHub ({r.get('job') or r.get('confirm') or 'sent'})" if (r.get("held") or r.get("confirm")) else "sent to axHub"
    except hub.HubError as e:
        note = f"axHub: {e}"
    with store() as d:
        s = next((x for x in d["sessions"] if x["id"] == sid), None)
        if s:
            s["hub"] = note[:200]


def raise_ask(s: dict[str, Any], agent_name: str, background: bool = True) -> None:
    cx.raise_alert({"source": "claude-sessions", "key": f"claude-ask:{s['id']}", "severity": "info", "title": f"Pick Claude's agent: {s.get('summary') or s['client']}"[:160],
                    "body": f"A {s['client']} session started and is working as {agent_name} until you pick (Console → Choose Claude's agent).", "link": "action:claude.pick"})
    if not os.environ.get("AXHUB_TOKEN") and hub.transport is hub._http:
        s["hub"] = "axHub isn't connected: console pop-up only"
        return
    if background:
        threading.Thread(target=_send_hub, args=(s["id"], agent_name), daemon=True).start()
    else:
        _send_hub(s["id"], agent_name)


# ---------------------------------------------------------------- routes

@router.get("/agent-settings")
def agent_settings() -> dict[str, Any]:
    """Claude agent settings: the default agent, Ask me every session (default on) and Ask for headless too (default off)."""
    d = read()
    roster = crew()
    return {**d["settings"], "defaultName": (find_agent(d["settings"]["defaultAgent"], roster) or {}).get("name", "")}


@router.put("/agent-settings")
async def agent_settings_set(request: Request) -> dict[str, Any]:
    """Change the Claude agent settings (defaultAgent, askEverySession, askHeadless)."""
    body = await _body(request)
    roster = crew()
    with store() as d:
        if "defaultAgent" in body:
            ref = str(body.get("defaultAgent") or "")
            a = find_agent(ref, roster)
            if ref and roster and not a:
                raise HTTPException(400, f"no agent {ref!r} on the crew")
            d["settings"]["defaultAgent"] = a["id"] if a else ref[:80]
        for k in ("askEverySession", "askHeadless"):
            if k in body:
                if not isinstance(body[k], bool):
                    raise HTTPException(400, f"{k} is true or false")
                d["settings"][k] = body[k]
        return dict(d["settings"])


@router.post("/assign")
async def assign(request: Request) -> dict[str, Any]:
    """Assign to Claude: make this agent the one every new Claude session works as (the default agent)."""
    body = await _body(request)
    roster = crew()
    a = find_agent(str(body.get("agent") or ""), roster)
    if not a:
        raise HTTPException(400, f"no agent {body.get('agent')!r} on the crew")
    with store() as d:
        d["settings"]["defaultAgent"] = a["id"]
    return {"defaultAgent": a["id"], "name": a.get("name", a["id"])}


@router.put("/persona")
async def persona_set(request: Request) -> dict[str, Any]:
    """An agent's persona / voice notes (how it talks): every session working as that agent follows them."""
    body = await _body(request)
    roster = crew()
    a = find_agent(str(body.get("agent") or ""), roster)
    if not a:
        raise HTTPException(400, f"no agent {body.get('agent')!r} on the crew")
    with store() as d:
        d["personas"][a["id"]] = {"persona": str(body.get("persona") or "")[:1200], "voice": str(body.get("voice") or "")[:300]}
        if not any(d["personas"][a["id"]].values()):
            d["personas"].pop(a["id"])
        return {"agent": a["id"], **d["personas"].get(a["id"], {"persona": "", "voice": ""})}


def picker_rows(d: dict[str, Any], roster: list[dict[str, Any]], slots: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """One row per crew agent for the picker: working / idle, current job, today's cost, hours, pay, rating, details."""
    live = [s for s in d["sessions"] if s.get("status") != "ended" and _age_s(s.get("lastSeen") or s["startedAt"]) < ACTIVE_S]
    desks = {r.get("agent"): r for r in ((slots or {}).get("running") or []) if r.get("agent") and r.get("state") != "finished"}
    rows = []
    for a in roster:
        mine = [s for s in live if s["agent"] == a["id"]]
        run = (a.get("running") or [None])[0]
        desk = desks.get(a["id"]) or desks.get(a.get("name"))
        job = (mine[0].get("summary") or f"Claude {mine[0]['client']} session") if mine else (run.get("summary") or run.get("jobId")) if run else (desk.get("name") if desk else "")
        rate = a.get("rating")
        if rate is None and (a.get("stats") or {}).get("successRate") is not None:
            rate = round(a["stats"]["successRate"] * 5, 1)
        pay = a.get("pay") or {}
        rows.append({
            "id": a["id"], "name": a.get("name", a["id"]), "role": a.get("role", ""), "avatar": a.get("avatar"), "status": a.get("status", ""), "statusLabel": a.get("statusLabel", ""),
            "works": a.get("works", True), "working": bool(mine or run or desk), "currentJob": job or "", "todayUsd": (a.get("spend") or {}).get("today", 0),
            "hoursToday": round(((a.get("minutes") or {}).get("today", 0)) / 60, 1), "hoursWeek": round(((a.get("minutes") or {}).get("week", 0)) / 60, 1),
            "salary": pay.get("salary"), "hourly": pay.get("hourly", a.get("hourly")), "payLeft": pay.get("left"), "broke": pay.get("broke", False), "rating": rate,
            "sessions": [{"session": s["id"], "client": s["client"], "summary": s.get("summary", ""), "startedAt": s["startedAt"]} for s in mine],
            "details": {"stats": a.get("stats") or {}, "spend": a.get("spend") or {}, "minutes": a.get("minutes") or {}, "feed": a.get("feed") or [],
                        "raises": a.get("raises") or [], "writeups": a.get("writeups") or [], "bonuses": a.get("bonuses", 0), "specialty": a.get("specialty", ""),
                        "catchphrase": a.get("catchphrase", ""), "bio": a.get("bio", ""), **d["personas"].get(a["id"], {"persona": "", "voice": ""})},
        })
    return rows


@router.get("/picker")
def picker() -> dict[str, Any]:
    """The agent picker: every crew agent (avatar, status, current job, today's cost, hours, pay, rating, all stats), the settings and live sessions."""
    roster = crew()
    d = read()
    slots_svc = plugin_services.get(SLOTS)
    try:
        slots = slots_svc.status() if slots_svc else None
    except Exception:  # noqa: BLE001
        slots = None
    return {"settings": d["settings"], "default": default_agent(d, roster)[0], "crew": bool(roster), "rows": picker_rows(d, roster, slots),
            "sessions": [_public(s, d, roster) for s in reversed(d["sessions"][-30:])]}


@router.post("/session-start")
async def session_start(request: Request) -> dict[str, Any]:
    """Every Claude session calls this first: {client: voice|chat|code|headless, summary, agent? (a headless brief's named agent), session? (its own id)}.
    Answers the agent to work as now (the default until Brett picks), its persona / voice notes, avatar and how to introduce itself.
    With Ask me every session on, Brett gets the picker as a console pop-up (and an axHub approval as the fallback); poll claude_session_agent for his answer."""
    body = await _body(request)
    client = str(body.get("client") or "")
    if client not in CLIENTS:
        raise HTTPException(400, f"client is one of {', '.join(CLIENTS)}")
    sid = str(body.get("session") or "") or f"cs-{int(time.time() * 1000):x}{secrets.token_hex(3)}"
    if not ID.match(sid):
        raise HTTPException(400, "session is letters, digits, dots, dashes and underscores (at most 80)")
    roster = crew()
    with store() as d:
        old = next((x for x in d["sessions"] if x["id"] == sid), None)
        if old:  # a session that calls again (a resume) keeps what it has
            old["lastSeen"] = now_iso()
            return _public(old, d, roster)
        brief = find_agent(str(body.get("agent") or ""), roster) if body.get("agent") else None
        if body.get("agent") and roster and not brief:
            raise HTTPException(400, f"no agent {body.get('agent')!r} on the crew")
        agent, source = (brief["id"], "brief") if brief else default_agent(d, roster)
        ask = should_ask(d["settings"], client) and not (client == "headless" and brief and not d["settings"]["askHeadless"])
        s = {"id": sid, "client": client, "summary": str(body.get("summary") or "")[:300], "agent": agent, "source": source,
             "status": "asking" if ask and roster else "set", "startedAt": now_iso(), "lastSeen": now_iso(), "ticket": secrets.token_urlsafe(18)}
        d["sessions"].append(s)
        name = agent_card(agent, d, roster)["name"]
        if s["status"] == "asking":
            raise_ask(s, name)
        return _public(s, d, roster)


@router.get("/agent")
def agent_get(session: str = "", agent: str = "") -> dict[str, Any]:
    """Who this Claude session is: its agent (id, name, avatar, persona / voice notes, intro), whether Brett's pick is still pending. No session = the default agent."""
    roster = crew()
    d = read()
    if session:
        if not ID.match(session):
            raise HTTPException(400, "bad session id")
        return _public(_session(d, session), d, roster)
    aid = (find_agent(agent, roster) or {}).get("id") or agent or default_agent(d, roster)[0]
    return {"session": "", "status": "default", "asking": False, "agent": agent_card(aid, d, roster)}


@router.get("/asks")
def asks(request: Request) -> dict[str, Any]:
    """Sessions waiting for Brett's pick (the console pop-up). Tickets only for his own signed-in click."""
    me = brett_click(request)
    d = read()
    roster = crew()
    out = []
    for s in d["sessions"]:
        if s["status"] == "asking":
            p = _public(s, d, roster)
            if me:
                p["ticket"] = s["ticket"]
            p["hub"] = s.get("hub", "")
            out.append(p)
    return {"asks": out, "brett": bool(me)}


@router.post("/answer")
async def answer(request: Request) -> dict[str, Any]:
    """Brett's pick for a session: {session, agent, ticket}. Only his signed-in click or the axHub approval (with the ask's ticket) counts."""
    body = await _body(request)
    sid = str(body.get("session") or "")
    me = brett_click(request)
    roster = crew()
    a = find_agent(str(body.get("agent") or ""), roster)
    if not a and not (roster == [] and body.get("agent")):
        raise HTTPException(400, f"no agent {body.get('agent')!r} on the crew")
    with store() as d:
        s = _session(d, sid)
        ticket = str(body.get("ticket") or "")
        if not me and not (ticket and secrets.compare_digest(ticket, s.get("ticket", ""))):
            raise HTTPException(403, "only Brett picks a session's agent (his click in the console, or the axHub approval)")
        s.update(agent=a["id"] if a else str(body["agent"])[:80], status="picked", source="picked", answeredAt=now_iso(),
                 answeredBy=me or "axHub approval", ticket=secrets.token_urlsafe(18))
        out = _public(s, d, roster)
    cx.resolve_alerts([f"claude-ask:{sid}"])
    return out


@router.post("/book")
async def book(request: Request) -> dict[str, Any]:
    """Book a session's work on its agent's card: {session, usd?, usage?, model?, summary?, commits?, branch?, build?, final?, status?}.
    The agent is the session's (or AXF_AGENT's `agent` when the session never called session-start)."""
    body = await _body(request, 64_000)
    sid = str(body.get("session") or "")
    if not ID.match(sid):
        raise HTTPException(400, "a session id is needed")
    roster = crew()
    with store() as d:
        s = next((x for x in d["sessions"] if x["id"] == sid), None)
        agent = s["agent"] if s else ((find_agent(str(body.get("agent") or ""), roster) or {}).get("id") or "")
        if not agent:
            raise HTTPException(400, "unknown session and no agent: call session-start first, or pass agent (AXF_AGENT)")
        if s:
            s["lastSeen"] = now_iso()
            if body.get("final") is True:
                s["status"] = "ended" if s["status"] != "asking" else s["status"]
    commits = [c for c in (body.get("commits") or []) if isinstance(c, str) and SHA.match(c)][:40]
    entry = {"session": sid, "agent": agent, "summary": str(body.get("summary") or (s or {}).get("summary") or "")[:300], "commits": commits,
             "final": body.get("final") is True, "status": "failed" if body.get("status") == "failed" else "done"}
    for k in ("usd", "usage", "model", "branch", "build"):
        if body.get(k) is not None:
            entry[k] = body[k]
    svc = plugin_services.get(CREW)
    if svc is None:
        raise HTTPException(503, "the Agent swarm (axf.crew@1) is off: nothing to book on")
    try:
        run = svc.book(entry)
    except ValueError as e:
        raise HTTPException(400, str(e)[:300]) from None
    _crew_cache["value"] = None
    return {"booked": run.get("jobId"), "agent": agent, "status": run.get("status"), "usd": run.get("reportedCost")}
