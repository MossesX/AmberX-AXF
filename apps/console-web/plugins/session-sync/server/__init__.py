"""Server part of the Session sync plugin (handoff@1 + session-link@1, framework/spec/HANDOFF.md). Mounted at
/api/plugins/session-sync/.

Two Claude sessions on one project (any accounts) talk in the Breakroom's Sessions channel, claim areas, and split the
work through the orchestrator (offers, accept / reject / hold / release, take back, replan, dedupe). The link document
(`link.json` in this plugin's data folder) is the record; every read and change goes through the plugin's CLI
(sync.mjs `op`, zero tokens), so the console, the CLI, the hook and MCP share one set of rules (handoff.mjs).

Roles are enforced here, not just hidden in the UI: the caller is the session named by `X-Axf-Session` /
`X-Axf-Account` / `X-Axf-Agent` (the CLI, the hook, a claude.ai session through axHub), or Brett's own signed-in click
(a wall admin session with no X-Axhub-Session / X-Axhub-Source naming a session or agent), which may do anything. A
secondary that tries an orchestrator write gets 403 "secondary sessions can't do that" and an audit line.

Live push (spec § 9): every link write (a route here, or the CLI writing the same file) becomes typed SSE events on
`GET /events?after=<seq>` (`id:` = seq, `event:` = type) and one Breakroom line each (handoff.mjs channelLine) posted
through `axf.crew@1.post` — this server is the only Breakroom poster, so the CLI never names another plugin. The
plugin commands plugin turns the routes into REST, MCP (`session_sync_<command>`) and CLI (`axf session-sync …`).
A new account's first join files one axHub approval (`axf.session_sync_approve_account`) so Brett can approve it from
his phone; his console click approves it too. No model is ever called.
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import StreamingResponse

import console_context as cx
import plugin_services

from . import hub

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "sync.mjs"
ROOT = CLI.parents[4]  # the repo root (sync.mjs sits in apps/console-web/plugins/session-sync)
FOLDER = CLI.parent.name
TAG = "session-link@1"
CREW = "axf.crew@1"
HEALTH = "axf.health@1"
MAX_BODY = 256 * 1024
ID = re.compile(r"^[A-Za-z0-9._:@-]{1,120}$")
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
SESSION_HEADERS = ("x-axf-session", "x-axf-account", "x-axf-agent", "x-axf-client")
OWNER_ONLY = {"approve-account", "make-primary"}
APPROVER_KEYS = ("AXF_APPROVER", "AXF_APPROVER_VIA")
CREW_CACHE_S = 30
_crew_cache: dict[str, Any] = {"at": 0.0, "names": {}, "ids": set()}
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()
_loop: asyncio.AbstractEventLoop | None = None
_posted_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SESSION_SYNC_DIR") or (Path(os.environ.get("AXF_ROOT") or cx.ROOT) / ".axf-console" / "plugins" / FOLDER))


def link_file() -> Path:
    return Path(os.environ.get("AXF_SESSION_LINK_FILE") or (data_dir() / "link.json"))


def posted_file() -> Path:
    return data_dir() / "posted.json"


def _names() -> dict[str, str]:
    """Agent id → display name from the crew (cached), for channel lines."""
    if time.time() - _crew_cache["at"] < CREW_CACHE_S:
        return _crew_cache["names"]
    names: dict[str, str] = {}
    crew = plugin_services.get(CREW)
    if crew is not None:
        try:
            for a in crew.crew():
                if isinstance(a, dict) and a.get("id"):
                    names[str(a["id"])] = str(a.get("name") or a["id"])
        except Exception:  # noqa: BLE001 — the crew is optional
            pass
    _crew_cache.update(at=time.time(), names=names, ids=set(names))
    return names


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    for h in SESSION_HEADERS:
        if (request.headers.get(h) or "").strip():
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def caller(request: Request, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Who is calling: a session (headers, or `session` / `account` / `agent` in the body), a hub user, or Brett's click."""
    b = body or {}
    who = brett_click(request)
    link = _read_link()
    if who:
        primary = link.get("primary") or {}
        return {"session": f"console-{who}"[:120], "account": str(primary.get("account") or who)[:120], "agent": str(primary.get("agent") or "")[:40], "client": "console", "brett": True, "name": who}
    get = lambda h, k: (request.headers.get(h) or str(b.get(k) or "")).strip()[:120]  # noqa: E731
    session = get("x-axf-session", "session")
    account = get("x-axf-account", "account")
    agent = get("x-axf-agent", "agent")[:40]
    client = get("x-axf-client", "client")[:20] or "code"
    c = getattr(request.state, "axf_user", None)
    if c is not None and getattr(c, "via", "token") == "session":  # a hub user (not admin) in a console: their own account
        name = str(getattr(c, "name", "") or "user")[:120]
        session = session or f"console-{name}"
        account = account or name
        client = "console"
    if session and not ID.match(session):
        raise HTTPException(400, "bad session id")
    if account and not ID.match(account):
        raise HTTPException(400, "bad account")
    if not session:
        raise HTTPException(400, "say who you are: X-Axf-Session (and X-Axf-Account) headers, or session / account in the body")
    return {"session": session, "account": account or session, "agent": agent, "client": client if client in ("code", "chat", "voice", "headless", "console") else "code", "brett": False}


def _read_link() -> dict[str, Any]:
    try:
        return json.loads(link_file().read_text())
    except (OSError, ValueError):
        return {}


def _run(op: str, args: dict[str, Any], who: dict[str, Any]) -> dict[str, Any]:
    env = {k: v for k, v in os.environ.items() if k not in APPROVER_KEYS}
    env.update(AXF_SESSION_LINK_FILE=str(link_file()), AXF_SESSION_SYNC_CALLER=json.dumps(who), AXF_SESSION_SYNC_NAMES=json.dumps(_names()))
    if who.get("brett"):
        env.update(AXF_APPROVER=str(who.get("name") or "Brett"), AXF_APPROVER_VIA="console")
    proc = subprocess.run(["node", str(CLI), "op", op, json.dumps(args)], cwd=ROOT, capture_output=True, text=True, timeout=90, env=env)
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {"ok": False, "code": "error", "message": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        res = {"ok": False, "code": "error", "message": (proc.stderr or proc.stdout).strip()[-600:]}
    if res.get("events"):
        _deliver(res["events"])
    return res


def _answer(res: dict[str, Any]) -> dict[str, Any]:
    if res.get("ok") is False:
        code = res.get("code", "")
        status = 403 if code in ("secondary", "owner", "primary") else 409 if code in ("claimed", "confirm", "taken") else 404 if code in ("not-found", "no-session") else 400
        raise HTTPException(status, str(res.get("message") or res.get("error") or "refused"))
    res.pop("events", None)
    return res


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


# ---------------------------------------------------------------- live push: SSE + Breakroom

def _channel_lines(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Breakroom messages for events (handoff.mjs channelLine, run in node once per batch)."""
    if not events:
        return []
    code = ("import * as H from %s; let d=''; process.stdin.on('data',(c)=>d+=c).on('end',()=>{const {events,names}=JSON.parse(d);"
            "console.log(JSON.stringify(events.map((e)=>({seq:e.seq,session:e.session,line:H.channelLine(e,names)}))));});" % json.dumps((ROOT / "framework/core/engines/handoff.mjs").as_uri()))
    proc = subprocess.run(["node", "--input-type=module", "-e", code], input=json.dumps({"events": events, "names": _names()}), capture_output=True, text=True, timeout=30, cwd=ROOT)
    try:
        rows = json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        return []
    link = _read_link()
    sessions = link.get("sessions") or {}
    ids = _crew_cache["ids"]
    out = []
    for r in rows:
        line = r.get("line")
        if not line:
            continue
        agent = str(line.get("from") or (sessions.get(r.get("session") or "") or {}).get("agent") or "")
        frm = agent if agent in ids else "boss"
        text = line["text"] if frm != "boss" or not agent else f"[{agent}] {line['text']}"
        out.append({"from": frm, "kind": line["kind"], "text": text[:1000], "jobId": line.get("jobId") or "", "channel": "sessions"})
    return out


def _deliver(events: list[dict[str, Any]]) -> None:
    """SSE to every open client + one Breakroom line each, once per seq (the CLI's writes arrive through the watcher)."""
    with _posted_lock:
        try:
            last = int(json.loads(posted_file().read_text()).get("seq", 0))
        except (OSError, ValueError):
            last = 0
        fresh = [e for e in events if int(e.get("seq", 0)) > last]
        if not fresh:
            return
        try:
            posted_file().parent.mkdir(parents=True, exist_ok=True)
            posted_file().write_text(json.dumps({"seq": max(int(e["seq"]) for e in fresh), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}))
        except OSError:
            pass
    for e in fresh:
        _broadcast(e)
    crew = plugin_services.get(CREW)
    if crew is not None and hasattr(crew, "post"):
        try:
            msgs = _channel_lines(fresh)
            if msgs:
                crew.post(msgs)
        except Exception as exc:  # noqa: BLE001 — the chat is best effort
            cx.log(FOLDER, f"Breakroom post failed: {exc}", "warn")
    if any(e.get("type") in ("handover", "assignment", "session") for e in fresh):
        _emit_health()


def _broadcast(event: dict[str, Any]) -> None:
    if _loop is None:
        return
    for q in list(_subscribers):
        try:
            _loop.call_soon_threadsafe(q.put_nowait, event)
        except RuntimeError:
            pass


def _watch() -> None:
    """The CLI and the hook write the same link file: watch its mtime and deliver their events too."""
    seen = 0.0
    while True:
        try:
            f = link_file()
            m = f.stat().st_mtime if f.exists() else 0.0
            if m != seen:
                seen = m
                link = _read_link()
                try:
                    last = int(json.loads(posted_file().read_text()).get("seq", 0))
                except (OSError, ValueError):
                    last = 0
                fresh = [e for e in (link.get("events") or []) if int(e.get("seq", 0)) > last]
                if fresh:
                    _deliver(fresh)
        except Exception as exc:  # noqa: BLE001
            cx.log(FOLDER, f"link watcher: {exc}", "warn")
        time.sleep(float(os.environ.get("AXF_SESSION_SYNC_WATCH_S") or 1.0))


if os.environ.get("AXF_SESSION_SYNC_WATCH") != "0":
    threading.Thread(target=_watch, name="session-sync-watch", daemon=True).start()


@router.get("/events")
async def events(request: Request, after: int = 0) -> StreamingResponse:
    """Server-sent events: every link change as it happens (`id:` = seq, `event:` = type); `after` replays from there, `gap` when trimmed."""
    global _loop
    _loop = asyncio.get_running_loop()
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _subscribers.add(q)
    link = _read_link()
    evs = [e for e in (link.get("events") or []) if int(e.get("seq", 0)) > after]
    oldest = (link.get("events") or [{}])[0].get("seq", 0) if link.get("events") else 0
    gap = after > 0 and oldest and after + 1 < oldest

    async def gen():
        try:
            yield "retry: 3000\n\n"
            if gap:
                yield f"event: gap\nid: {after}\ndata: {json.dumps({'oldest': oldest, 'seq': link.get('seq', 0)})}\n\n"
            for e in evs:
                yield f"event: {e.get('type', 'link')}\nid: {e.get('seq', 0)}\ndata: {json.dumps(e)}\n\n"
            last = evs[-1]["seq"] if evs else after
            while True:
                if await request.is_disconnected():
                    break
                try:
                    e = await asyncio.wait_for(q.get(), timeout=25)
                    if int(e.get("seq", 0)) <= last:
                        continue
                    last = int(e.get("seq", 0))
                    yield f"event: {e.get('type', 'link')}\nid: {last}\ndata: {json.dumps(e)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store"})


# ---------------------------------------------------------------- reads

@router.get("/state")
def state(request: Request, for_session: str = "") -> dict[str, Any]:
    who = caller(request)
    return _answer(_run("state", {"for": for_session or ("" if who["brett"] else who["session"])}, who))


@router.get("/snapshot")
def snapshot(request: Request) -> dict[str, Any]:
    """The join dialog's detail: who is working on what (progress, model), done today, needs attention, offers, queued jobs."""
    who = caller(request)
    res = _answer(_run("snapshot", {}, who))
    health = plugin_services.get(HEALTH)
    if health is not None and hasattr(health, "items"):
        try:
            for it in health.items():
                if isinstance(it, dict) and it.get("state") in ("red", "amber") and it.get("id") != "session-sync":
                    res.setdefault("attention", []).append({"kind": it.get("state", "red"), "ref": it.get("id", ""), "text": str(it.get("title") or it.get("detail") or "")[:300]})
        except Exception:  # noqa: BLE001
            pass
    return res


@router.get("/claims")
def claims(request: Request) -> dict[str, Any]:
    return _answer(_run("claims", {}, caller(request)))


@router.get("/offers")
def offers(request: Request) -> dict[str, Any]:
    return _answer(_run("offers", {}, caller(request)))


@router.get("/audit")
def audit(request: Request, limit: int = 200) -> dict[str, Any]:
    return _answer(_run("audit", {"limit": max(1, min(limit, 2000))}, caller(request)))


@router.get("/messages")
def messages(request: Request, limit: int = 200, filter: str = "all") -> dict[str, Any]:
    """The Breakroom's Sessions channel (read-only here; post with /send). Filters: all, handovers, blockers, mine."""
    who = caller(request)
    crew = plugin_services.get(CREW)
    msgs: list[dict[str, Any]] = []
    if crew is not None and hasattr(crew, "messages"):
        try:
            msgs = [m for m in crew.messages(max(1, min(limit, 1000))) if isinstance(m, dict) and m.get("channel") == "sessions"]
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(502, f"Breakroom unavailable: {exc}")
    link = _read_link()
    mine = [a.get("build") for a in (link.get("assignments") or {}).values() if a.get("session") == who["session"]]
    if filter == "handovers":
        msgs = [m for m in msgs if m.get("kind") == "handover"]
    elif filter == "blockers":
        msgs = [m for m in msgs if re.search(r"blocked|rejected|on hold|claimed by", str(m.get("text", "")), re.I)]
    elif filter == "mine":
        msgs = [m for m in msgs if m.get("from") == who.get("agent") or any(m.get("jobId") == b or str(m.get("jobId", "")).startswith(f"{b}.") for b in mine)]
    return {"ok": True, "messages": msgs, "channel": "sessions", "filter": filter, "available": crew is not None}


@router.get("/sync-file")
def sync_file(request: Request) -> dict[str, Any]:
    """The project's sync file (handoff@1) as written to the repo, and whether it is fresh."""
    caller(request)
    link = _read_link()
    project = str(link.get("project") or os.environ.get("AXF_PROJECT") or "amberx-axf")
    f = ROOT / "_claude" / "sync" / f"{project}.json"
    try:
        doc = json.loads(f.read_text())
    except (OSError, ValueError):
        return {"ok": True, "exists": False, "path": f"_claude/sync/{project}.json"}
    written = doc.get("writtenAt", "")
    try:
        age = time.time() - time.mktime(time.strptime(written[:19], "%Y-%m-%dT%H:%M:%S")) + time.timezone
    except ValueError:
        age = 1e12
    return {"ok": True, "exists": True, "path": f"_claude/sync/{project}.json", "fresh": age <= float(doc.get("freshForSec") or 1800), "doc": doc}


@router.get("/consistency")
def consistency(request: Request) -> dict[str, Any]:
    caller(request)
    return _consistency(False)


@router.get("/settings")
def get_settings(request: Request) -> dict[str, Any]:
    return _answer(_run("settings", {}, caller(request)))


# ---------------------------------------------------------------- writes

async def _write(request: Request, op: str) -> dict[str, Any]:
    body = await _json_body(request)
    who = caller(request, body)
    for k in ("session", "agent", "client", "brett", "approver", *(() if op == "approve-account" else ("account",))):
        body.pop(k, None)  # identity comes from the headers / the click, never from the body (approve-account's `account` is its argument)
    if op in OWNER_ONLY and not who["brett"]:
        raise HTTPException(403, f"only Brett can do that: {op} (his own click in the console, or the axHub approval)")
    return _answer(_run(op, body, who))


@router.post("/sync")
async def sync(request: Request) -> dict[str, Any]:
    """Write _claude/sync/<project>.{json,md} (handoff@1) and publish it to main: the console's Sync session button."""
    body = await _json_body(request)
    who = caller(request, body)
    link = _read_link()
    if who["session"] not in (link.get("sessions") or {}):
        _run("join", {"agent": who.get("agent", "")}, who)
    res = _answer(_run("sync", {"publish": body.get("publish", True) is not False}, who))
    res["connected"] = [s for s in (_read_link().get("sessions") or {}).values() if not s.get("endedAt")]
    return res


@router.post("/join")
async def join(request: Request) -> dict[str, Any]:
    body = await _json_body(request)
    who = caller(request, body)
    res = _answer(_run("join", {"agent": body.get("agent") or who.get("agent", ""), "client": body.get("client") or who.get("client", "")}, who))
    if res.get("needsApproval"):
        res["approval"] = _ask_approval(res.get("session") or {}, who)
    return res


def _ask_approval(session: dict[str, Any], who: dict[str, Any]) -> dict[str, Any]:
    """A new account's first join: one axHub approval (Vinnie) + a bell alert; Brett's console click approves it too."""
    account = str(session.get("account") or who.get("account") or "")
    try:
        cx.raise_alert({"source": FOLDER, "severity": "warning", "title": f"New account wants to join: {account}", "body": f"{session.get('agent') or session.get('id')} joined the session link from account {account}. Approve it in Builds → Sessions, or on axHub.", "key": f"session-sync:approve:{account}", "link": "nav:session-sync"})
    except Exception:  # noqa: BLE001
        pass
    try:
        return hub.ask(account, str(session.get("agent") or session.get("id") or ""), str(who.get("client") or ""))
    except hub.HubError as exc:
        return {"error": str(exc)}


@router.post("/heartbeat")
async def heartbeat(request: Request) -> dict[str, Any]:
    """I'm alive: what I'm doing (build, step, note); renews my claims. `pause: {reason, until?}` = lunch break, `pause: null` = back."""
    return await _write(request, "heartbeat")


@router.post("/end")
async def end(request: Request) -> dict[str, Any]:
    """End this session: release its claims, give its work back, post a closing line."""
    return await _write(request, "end")


@router.post("/claim")
async def claim(request: Request) -> dict[str, Any]:
    """Lease an area (`kind: area, area`) or paths (`kind: path, paths: [...]`) before editing; 409 names who holds it."""
    return await _write(request, "claim")


@router.post("/release")
async def release(request: Request) -> dict[str, Any]:
    """Release one claim (`claim`) or all of mine."""
    return await _write(request, "release")


@router.post("/send")
async def send(request: Request) -> dict[str, Any]:
    """Post a line in the Breakroom's Sessions channel (`text`, optional kind / build / step / files)."""
    return await _write(request, "send")


@router.post("/inbox")
async def inbox(request: Request) -> dict[str, Any]:
    """Unread channel lines, claim changes and offers for me; moves my cursor unless `peek`."""
    return await _write(request, "inbox")


@router.post("/request-work")
async def request_work(request: Request) -> dict[str, Any]:
    """Helper: ask the orchestrator for work (`minutes`, `areas`, `model`); it offers whole jobs or steps split out of running builds."""
    return await _write(request, "request-work")


@router.post("/offer")
async def offer(request: Request) -> dict[str, Any]:
    """Primary: offer a build (`build`) or steps as a new build (`steps`) to a helper (`to`), with a reason."""
    return await _write(request, "offer")


@router.post("/respond")
async def respond(request: Request) -> dict[str, Any]:
    """Helper: answer an offer or my assignment (`id`, `response`: accept | reject | hold | release, `reason`, `backAt`). The orchestrator reacts."""
    return await _write(request, "respond")


@router.post("/step")
async def step(request: Request) -> dict[str, Any]:
    """Helper: mark my assigned step (`assignment`, `step`, `state`: started | done | blocked, `reason`)."""
    return await _write(request, "step")


@router.post("/take-back")
async def take_back(request: Request) -> dict[str, Any]:
    """Primary: take work back from a helper (`assignment` or `build`, optional `steps`; `confirm` when it is being worked on)."""
    return await _write(request, "take-back")


@router.post("/undo")
async def undo(request: Request) -> dict[str, Any]:
    """Primary: undo a handover event (`seq`)."""
    return await _write(request, "undo")


@router.post("/replan")
async def replan(request: Request) -> dict[str, Any]:
    """Primary: re-plan the whole picture on both sides (`dryRun` previews; applied = store order changed, moves posted)."""
    return await _write(request, "replan")


@router.post("/claim-job")
async def claim_job(request: Request) -> dict[str, Any]:
    """Register a job before work starts (`id` / `title`, `branch`): matches a queued build and takes it off the main queue, or registers new work with a warning."""
    return await _write(request, "claim-job")


@router.post("/approve-account")
async def approve_account(request: Request) -> dict[str, Any]:
    """Brett only: approve a new account's sessions (`account`)."""
    return await _write(request, "approve-account")


@router.post("/make-primary")
async def make_primary(request: Request) -> dict[str, Any]:
    """Brett only: make a session the primary (`session`)."""
    return await _write(request, "make-primary")


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    """Change the plugin's settings (owner-only keys: enforce, approveNewAccounts, slotSplit — Brett's click only)."""
    body = await _json_body(request)
    who = caller(request, body)
    for k in ("session", "account", "agent", "client", "brett"):
        body.pop(k, None)
    return _answer(_run("settings", body, who))


@router.post("/consistency")
async def fix_consistency(request: Request) -> dict[str, Any]:
    """Make every store that tracks a handover agree with the link (Auto fix)."""
    body = await _json_body(request)
    caller(request, body)
    return _consistency(True)


def _consistency(fix: bool) -> dict[str, Any]:
    proc = subprocess.run(["node", str(CLI), "consistency", *(["--fix"] if fix else []), "--json"], cwd=ROOT, capture_output=True, text=True, timeout=90, env={**os.environ, "AXF_SESSION_LINK_FILE": str(link_file())})
    try:
        return json.loads(proc.stdout.strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise HTTPException(500, (proc.stderr or proc.stdout).strip()[-400:] or "consistency check failed")


# ---------------------------------------------------------------- capability + health

class SessionSyncService:
    """Capability `axf.session-sync@1`: the link for other plugins (helper badges, lists, Home cards), never a folder name."""

    def link(self) -> dict[str, Any]:
        return _read_link()

    def assigned(self, build_id: str, step_id: str = "") -> dict[str, Any] | None:
        link = _read_link()
        for a in (link.get("assignments") or {}).values():
            if a.get("status") in ("queued", "working", "held", "blocked") and (a.get("build") == build_id or a.get("parent") == build_id) and (not step_id or not a.get("steps") or step_id in a["steps"]):
                return a
        return None

    def role_of(self, session: str, account: str = "") -> str:
        link = _read_link()
        p = link.get("primary") or {}
        if not p:
            return "primary"
        if p.get("session") == session or (account and p.get("account") == account):
            return "primary"
        return "secondary"

    def enforce(self) -> bool:
        return bool((_read_link().get("settings") or {}).get("enforce", True)) and cx.plugin_enabled(FOLDER)


plugin_services.provide("axf.session-sync@1", SessionSyncService(), FOLDER)


_HEALTH_DONE = False


def _emit_health() -> None:
    """One health@1 row (systems check): drift between the link and the stores it projects into, with Auto fix."""
    global _HEALTH_DONE
    health = plugin_services.get(HEALTH)
    if health is None or not hasattr(health, "register") or _HEALTH_DONE:
        return
    try:
        health.register({
            "id": "session-sync", "label": "Session sync: every store agrees with the link", "run": _health_item, "severity": "warn", "service": "console",
            "breaks": "Helper badges, scoped lists and the orchestrator's picture could show stale handover status.",
            "autoFix": {"label": "Make every store agree with the link", "run": lambda: {"state": "done", "message": json.dumps(_consistency(True))[:300]}},
            "fix": {"label": "Fix now", "action": "plugin:session-sync/consistency"}, "interval": 300,
        }, owner=FOLDER)
        _HEALTH_DONE = True
    except Exception:  # noqa: BLE001
        pass


def _health_item() -> dict[str, Any]:
    r = _consistency(False)
    link = _read_link()
    live = [s for s in (link.get("sessions") or {}).values() if not s.get("endedAt")]
    if not cx.plugin_enabled(FOLDER):
        return {"status": "warn", "summary": "Session sync is off: claims are not enforced, builds run unrestricted"}
    if r.get("drift"):
        return {"status": "warn", "summary": f"{r['drift']} place(s) disagree with the session link", "details": {k: r.get(k) for k in ("patches", "missingChildren", "staleStore")}}
    return {"status": "ok", "summary": f"{len(live)} session(s) linked, every store agrees"}


_emit_health()
