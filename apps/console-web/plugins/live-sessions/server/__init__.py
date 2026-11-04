"""Live sessions (server part). Mounted at /api/plugins/live-sessions/ (console token on every route, 404 while off).

Every Claude session going on (human and headless, every account), who is running it, and Watch live:

  GET  sessions                       rows (claude-live-session@1), counts ('2 human · 4 headless'), accounts, agents, viewer
  GET  live                           server-sent events: `sessions` with the whole list whenever it changes
  POST checkin                        a session says it is there (Claude Code hook, AmberX / Gizmo, helper accounts):
                                      its row fields + optional transcript `lines` / `events`; answers the notice to show
  POST sessions/{id}/events           more lines / events for a session (same answer)
  POST sessions/{id}/audio            a voice segment (?track=mic|tts&offsetMs=&ext=), raw bytes, from AmberX
  GET  sessions/{id}/notice           'You're being watched' / 'Recording' for the watched side
  POST sessions/{id}/agent            who runs it ({agent}); one agent never runs two live human sessions
  POST sessions/{id}/watch            start watching ({voice}); owner only, voice only on a human session with AmberX
  POST sessions/{id}/watch/{w}/beat   keep a watch alive (every 15 s); DELETE sessions/{id}/watch/{w} ends it
  GET  sessions/{id}/stream           server-sent events: `event` per message / tool call / result, `audio` per voice
                                      segment (voice watchers), `status`; ?watcher= is required
  GET  sessions/{id}/audio/{file}     one voice segment or compacted chunk (owner)
  GET  recordings                     past sessions (owner): search across transcripts, favourites
  GET  recordings/{id}                meta, timeline (markers, speech spans, context counts) and events
  GET  recordings/{id}/context?t=     what was in the context window at session time t
  GET  recordings/{id}/export         the whole recording as a .zip
  POST recordings/{id}/flags          {pinned?, favourite?}
  POST recordings/{id}/compact        run the silence compaction now
  DELETE recordings/{id}              delete it (owner, logged)
  GET/PUT settings                    recording on, keep raw hours, pad, retention, cap (settings-interface@1 tab)
  GET/PUT storage                     targets (own container, VPS container, repo, local), primary + mirrors, status
  POST storage/move                   move recordings to a new own-container path ({path, dryRun}), hashes verified
  POST storage/local-ack              a device says which recordings it holds (the local target's status)
  GET  audit                          every watch start / stop, delete, move and storage change

Sources are capabilities looked up per request: ``axf.session-feed@1`` (claude.ai chats and voice through the axHub
connector), ``axf.headless@1`` (tmux runs on the VPS + meters), ``axf.crew@1`` (agents, the Breakroom line),
``axf.containers@1`` (container dropdown + mirror). Check-ins are this plugin's own. It provides ``axf.claude-live@1``
(snapshot + subscribe), so the handoff session channel reuses this push stream instead of building a second.
No model is ever called.
"""
from __future__ import annotations

import asyncio
import base64
import fcntl
import hashlib
import io
import json
import os
import re
import secrets
import subprocess
import threading
import time
import urllib.request
import zipfile
from contextlib import contextmanager
from pathlib import Path
from typing import Any, Callable, Iterator

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse, Response, StreamingResponse

import console_context as cx
import plugin_services

from . import lines as ln
from . import recordings as rec
from . import sessions as ss

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
FEED, HEADLESS, CREW, CONTAINERS = "axf.session-feed@1", "axf.headless@1", "axf.crew@1", "axf.containers@1"
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
SNAPSHOT_TTL = 2.0
LIVE_EVERY = 2.0
SWEEP_EVERY = 60.0
DEFAULTS: dict[str, Any] = {"record": True, "keepRawHours": 24, "padMs": 200, "keepDays": 90, "capMb": 20_480, "watchNotice": True}
_lock = threading.RLock()
_cache: dict[str, Any] = {"at": 0.0, "rows": None, "sig": ""}
WATCH = ss.Watchers()
_subs: list[Callable[[dict[str, Any]], None]] = []


def data_dir() -> Path:
    return Path(os.environ.get("AXF_LIVE_DIR") or (Path(os.environ.get("AXF_ROOT") or cx.ROOT) / ".axf-console" / "plugins" / FOLDER))


def now_ms() -> int:
    return int(time.time() * 1000)


# ---------------------------------------------------------------- state file (check-ins, picks, settings, storage)

def _norm(o: Any) -> dict[str, Any]:
    o = o if isinstance(o, dict) else {}
    s = o.get("settings") if isinstance(o.get("settings"), dict) else {}
    settings = {k: (s[k] if type(s.get(k)) is type(v) or (isinstance(v, (int, float)) and isinstance(s.get(k), (int, float)) and not isinstance(s.get(k), bool)) else v)
                for k, v in DEFAULTS.items()}
    settings["watchNotice"] = True  # always on (Brett, Nov 4 2026): not a setting anyone can turn off
    return {"$axf": "claude-live@1", "settings": settings, "checkins": {k: v for k, v in (o.get("checkins") or {}).items() if isinstance(v, dict)},
            "picks": {str(k)[:120]: str(v)[:80] for k, v in (o.get("picks") or {}).items()}, "storage": rec.norm_storage(o.get("storage")),
            "local": o.get("local") if isinstance(o.get("local"), dict) else {}, "mirrors": o.get("mirrors") if isinstance(o.get("mirrors"), dict) else {}}


@contextmanager
def state() -> Iterator[dict[str, Any]]:
    f = data_dir() / "state.json"
    f.parent.mkdir(parents=True, exist_ok=True)
    with _lock, open(f.with_suffix(".lock"), "w") as lk:
        fcntl.flock(lk, fcntl.LOCK_EX)
        try:
            d = _norm(json.loads(f.read_text()) if f.exists() else {})
        except (OSError, ValueError):
            d = _norm({})
        before = json.dumps(d, sort_keys=True)
        yield d
        if json.dumps(d, sort_keys=True) != before:
            tmp = f.with_suffix(f".tmp-{os.getpid()}")
            tmp.write_text(json.dumps(d, indent=1) + "\n")
            os.chmod(tmp, 0o600)
            tmp.replace(f)


def read_state() -> dict[str, Any]:
    with state() as d:
        return json.loads(json.dumps(d))


def audit(op: str, by: str, **kw: Any) -> None:
    f = data_dir() / "audit.jsonl"
    f.parent.mkdir(parents=True, exist_ok=True)
    with open(f, "a") as out:
        out.write(json.dumps({"at": now_ms(), "op": op, "by": by, **kw}, default=str) + "\n")


def store_root(d: dict[str, Any] | None = None) -> Path:
    """The working store: the own-container target's folder (AXF_RECORDINGS_DIR, else the plugin's data volume)."""
    d = d or read_state()
    own = next((t for t in d["storage"]["targets"] if t["kind"] == "own-container"), None)
    p = (own or {}).get("path") or os.environ.get("AXF_RECORDINGS_DIR") or str(data_dir() / "recordings")
    return Path(p)


def STORE() -> rec.Store:
    return rec.Store(store_root())


# ---------------------------------------------------------------- who is asking

def owner(request: Request) -> str:
    """Brett's name when this is his own signed-in click in the console (not a session, agent or the bare token)."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "Brett")[:80].title()


def viewer(request: Request) -> dict[str, Any]:
    name = owner(request)
    return {"owner": bool(name), "name": name or "helper"}


def need_owner(request: Request, what: str) -> str:
    name = owner(request)
    if not name:
        raise HTTPException(403, f"Only Brett can {what} (his own signed-in click in the console).")
    return name


async def body(request: Request, limit: int = 2_000_000) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "too large")
    try:
        o = json.loads(raw or b"{}")
    except json.JSONDecodeError:
        raise HTTPException(400, "not JSON") from None
    if not isinstance(o, dict):
        raise HTTPException(400, "an object is needed")
    return o


# ---------------------------------------------------------------- sources → rows

def roster() -> list[dict[str, Any]]:
    svc = plugin_services.get(CREW)
    try:
        return list(svc.crew()) if svc else []
    except Exception:  # noqa: BLE001 — no crew = initials
        return []


def _feeds() -> list[dict[str, Any]]:
    svc = plugin_services.get(FEED)
    try:
        items = svc.feeds() if svc else []
    except Exception:  # noqa: BLE001
        return []
    return [{"id": f"chat:{x['id']}", "source": x.get("source"), "title": x.get("title"), "agent": x.get("agent"), "model": x.get("model"), "costUsd": x.get("costUsd"),
             "url": x.get("url"), "startedAt": x.get("startedAt"), "lastAt": x.get("lastAt"), "ended": x.get("status") == "ended", "doing": x.get("lastLine"),
             "client": "voice" if "voice" in str(x.get("source")) else "chat", "account": "main"} for x in items]


def _headless() -> list[dict[str, Any]]:
    svc = plugin_services.get(HEADLESS)
    if not svc:
        return []
    try:
        items = (svc.sessions() or {}).get("items") or []
        heads = [x for x in items if str(x.get("name", "")).startswith("axf-")]
        meters = (svc.meters([x["name"] for x in heads]) or {}).get("items") or {} if heads else {}
    except Exception:  # noqa: BLE001
        return []
    out = []
    for t in heads:
        m = meters.get(t["name"]) or {}
        out.append({"id": f"tmux:{t['name']}", "name": t["name"], "client": "headless", "surface": "headless", "account": m.get("account") or "main", "device": "VPS",
                    "title": m.get("build") or t["name"].removeprefix("axf-"), "build": m.get("build") or "", "step": m.get("step") or "", "doing": m.get("doing") or m.get("status") or "",
                    "agent": m.get("agent") or t.get("agent"), "model": m.get("model"), "thinking": m.get("effort") or m.get("thinking"), "costUsd": m.get("costUsd"),
                    "startedAt": t.get("createdAt"), "lastAt": m.get("lastAt") or m.get("lastEventAt") or now_ms(), "cwd": t.get("cwd", ""), "job": m.get("job")})
    return out


def collect(force: bool = False) -> list[dict[str, Any]]:
    with _lock:
        now = time.time()
        if not force and _cache["rows"] is not None and now - _cache["at"] < SNAPSHOT_TTL:
            return _cache["rows"]
        d = read_state()
        crew = roster()
        raws = [*d["checkins"].values(), *_feeds(), *_headless()]
        rows = ss.merge(ss.normalize(r, crew, now_ms()) for r in raws)
        cwd = {r["id"]: r.get("cwd", "") for r in raws}
        for r in rows:
            r["watchers"] = WATCH.active(r["id"])
            r["notice"] = ss.notice(r, r["watchers"])
            r["recording"] = r["recording"] and d["settings"]["record"]
            r["_cwd"] = cwd.get(r["id"], "")
        sig = hashlib.sha1(json.dumps([{k: v for k, v in r.items() if k != "_cwd"} for r in rows], sort_keys=True, default=str).encode()).hexdigest()
        changed = sig != _cache["sig"]
        _cache.update(at=now, rows=rows, sig=sig)
    if changed:
        snap = snapshot_of(rows)
        for f in list(_subs):
            try:
                f(snap)
            except Exception:  # noqa: BLE001 — a broken subscriber never breaks the list
                pass
    return rows


def public(r: dict[str, Any]) -> dict[str, Any]:
    return {k: v for k, v in r.items() if not k.startswith("_")}


def snapshot_of(rows: list[dict[str, Any]]) -> dict[str, Any]:
    return {"rows": [public(r) for r in rows], "counts": ss.counts(rows), "at": now_ms()}


def find(sid: str) -> dict[str, Any]:
    for r in collect():
        if r["id"] == sid:
            return r
    raise HTTPException(404, f"no session {sid!r}")


class LiveService:
    """Capability `axf.claude-live@1`: the session list and its push stream, for the handoff session channel and others."""

    def snapshot(self) -> dict[str, Any]:
        return snapshot_of(collect())

    def subscribe(self, fn: Callable[[dict[str, Any]], None]) -> Callable[[], None]:
        _subs.append(fn)
        return lambda: _subs.remove(fn) if fn in _subs else None

    def notice(self, session: str) -> dict[str, Any]:
        return find(session)["notice"]


plugin_services.provide("axf.claude-live@1", LiveService(), FOLDER)


# ---------------------------------------------------------------- list + live

@router.get("/sessions")
def sessions(request: Request, kind: str = "", account: str = "", agent: str = "", ended: bool = False, q: str = "") -> dict[str, Any]:
    """Every Claude session (human + headless, every account) with who runs it; filters kind / account / agent / q."""
    rows = collect()
    shown = ss.filter_rows(rows, kind, account, agent, ended, q)
    return {"rows": [public(r) for r in shown], "counts": ss.counts(rows), "accounts": sorted({r["account"] for r in rows}),
            "agents": sorted({r["agent"]["name"] for r in rows if r["agent"]["name"]}), "viewer": viewer(request),
            "crew": [ss.agent_view(a.get("id"), roster()) for a in roster()][:60]}


@router.get("/live")
async def live() -> StreamingResponse:
    """Server-sent events: `sessions` with every row and the counts at once and again whenever anything changes."""
    async def gen():
        sent, idle = "", 0.0
        yield "retry: 3000\n\n"
        while True:
            rows = await asyncio.to_thread(collect)
            if _cache["sig"] != sent:
                sent, idle = _cache["sig"], 0.0
                yield f"event: sessions\ndata: {json.dumps(snapshot_of(rows), default=str)}\n\n"
            else:
                idle += LIVE_EVERY
                if idle >= 20:
                    idle = 0.0
                    yield ": keepalive\n\n"
            await asyncio.sleep(LIVE_EVERY)
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})


# ---------------------------------------------------------------- intake

ROW_FIELDS = ("client", "surface", "entrypoint", "account", "device", "app", "title", "doing", "build", "step", "progress", "model", "thinking", "agent",
              "costUsd", "mode", "amberx", "url", "source")


def _checkin(sid: str, o: dict[str, Any]) -> dict[str, Any]:
    if not ss.ID.match(sid):
        raise HTTPException(400, "id is letters, digits, dots, colons, dashes and underscores (at most 120)")
    t = now_ms()
    with state() as d:
        c = d["checkins"].get(sid) or {"id": sid, "startedAt": t}
        for k in ROW_FIELDS:
            if k in o and o[k] is not None:
                c[k] = o[k] if isinstance(o[k], (bool, int, float)) else str(o[k])[:300]
        key = f"{c.get('account') or 'main'}|{c.get('device') or ''}"
        if o.get("agent"):
            d["picks"][key] = str(o["agent"])[:80]
        elif not c.get("agent") and d["picks"].get(key):
            c["agent"] = d["picks"][key]  # the last pick on this account / device is the default
        c["lastAt"] = t
        c["ended"] = o.get("ended") is True
        d["checkins"][sid] = c
        for k in [k for k, v in d["checkins"].items() if t - int(v.get("lastAt") or 0) > 7 * 86_400_000]:
            d["checkins"].pop(k)  # a week of silence: off the list (the recording stays)
        record = d["settings"]["record"]
    row = ss.normalize(c, roster(), t)
    events = [*ln.events_from_lines(o.get("lines") or []), *[e for e in o.get("events") or [] if isinstance(e, dict)]]
    if row["kind"] == "human" and record:
        st = STORE()
        st.begin(sid, row, t)
        if events:
            st.append(sid, events, t)
        if row["status"] == "ended":
            finish(sid)
    elif events:  # headless check-ins with events: kept for Watch live only
        _buffer(sid, events)
    rows = collect(force=True)
    r = next((x for x in rows if x["id"] == sid), row)
    return {"ok": True, "session": sid, "kind": row["kind"], "agent": r["agent"], "notice": ss.notice(r, WATCH.active(sid)), "saved": len(events)}


_buffers: dict[str, list[dict[str, Any]]] = {}


def _buffer(sid: str, events: list[dict[str, Any]]) -> None:
    b = _buffers.setdefault(sid, [])
    base = len(b)
    for i, e in enumerate(events):
        b.append({**(rec.clean_event(e, 0) or {"kind": "note"}), "seq": base + i})
    del b[:-2000]


@router.post("/checkin")
async def checkin(request: Request) -> dict[str, Any]:
    """A session says it is there: {id, client, account, device, app, title, doing, agent, model, thinking, mode, amberx, ended,
    lines? (raw transcript JSON lines), events?}. Answers the agent it runs as and the notice to show its human."""
    o = await body(request)
    return _checkin(str(o.get("id") or ""), o)


@router.post("/sessions/{sid}/events")
async def add_events(sid: str, request: Request) -> dict[str, Any]:
    """More transcript lines / events for a checked-in session (same answer as checkin)."""
    o = await body(request)
    return _checkin(sid, {"lines": o.get("lines"), "events": o.get("events")})


@router.post("/sessions/{sid}/audio")
async def add_audio(sid: str, request: Request, track: str = "mic", offsetMs: int = -1, ext: str = "webm") -> dict[str, Any]:
    """A voice segment from AmberX (mic = the human, tts = Claude), raw bytes; offsetMs on the session clock (default: now)."""
    r = find(sid)
    if r["kind"] != "human":
        raise HTTPException(400, "voice is only recorded for human sessions")
    data = await request.body()
    if not data or len(data) > 20 * 1024 * 1024:
        raise HTTPException(413, "a segment is 1 byte to 20 MB")
    st = STORE()
    m = st.begin(sid, public(r))
    off = offsetMs if offsetMs >= 0 else now_ms() - int(m["startMs"])
    try:
        out = st.add_audio(sid, track, off, data, ext)
    except ValueError as e:
        raise HTTPException(400, str(e)) from None
    with state() as d:
        c = d["checkins"].get(sid)
        if c:
            c["amberx"] = True
            c["lastAt"] = now_ms()
    collect(force=True)
    return {"ok": True, **out}


@router.get("/sessions/{sid}/notice")
def get_notice(sid: str) -> dict[str, Any]:
    """What the watched side shows now: 'You're being watched by …' and 'Recording' (always on while true)."""
    r = find(sid)
    return r["notice"]


@router.post("/sessions/{sid}/agent")
async def set_agent(sid: str, request: Request) -> dict[str, Any]:
    """Who runs this session ({agent, force?}). A clash (that agent is on another live human session) answers 409 with
    the free agents to offer instead, unless force."""
    name = need_owner(request, "pick a session's agent")
    o = await body(request)
    agent = str(o.get("agent") or "").strip()[:80]
    rows = collect()
    r = find(sid)
    clash = ss.agent_clash(rows, agent, sid) if r["kind"] == "human" else None
    if clash and o.get("force") is not True:
        raise HTTPException(409, {"error": f"{clash['agent']} is already on a live session ({clash['title'] or clash['session']}).", "clash": clash,
                                  "free": ss.free_agents(rows, roster())})
    with state() as d:
        c = d["checkins"].setdefault(sid, {"id": sid, "startedAt": r["startedAt"], "lastAt": r["lastAt"], "client": r["client"], "account": r["account"], "device": r["device"]})
        c["agent"] = agent
        d["picks"][f"{c.get('account') or 'main'}|{c.get('device') or ''}"] = agent
    audit("agent", name, session=sid, agent=agent)
    return {"ok": True, "agent": find_fresh(sid)["agent"]}


def find_fresh(sid: str) -> dict[str, Any]:
    collect(force=True)
    return find(sid)


# ---------------------------------------------------------------- watch

def _post_chat(text: str) -> None:
    svc = plugin_services.get(CREW)
    if svc and hasattr(svc, "post"):
        threading.Thread(target=lambda: _safe(svc.post, text), daemon=True).start()


def _safe(fn: Callable[..., Any], *a: Any) -> None:
    try:
        fn(*a)
    except Exception as e:  # noqa: BLE001
        cx.log("plugins", f"live-sessions: {str(e)[:200]}", "warn")


def _watch_started(r: dict[str, Any], who: str, voice: bool) -> None:
    if r["kind"] != "human":
        return
    _post_chat(ss.chat_line(r, who, True))
    _safe(cx.raise_alert, {"source": "live-sessions", "key": f"live-watch:{r['id']}", "severity": "info", "title": f"You're being watched: {r['title'] or r['agent']['name']}"[:160],
                           "body": f"{who} is watching this session{' with voice' if voice else ''}.", "link": "action:live-sessions.open"})


def _watch_ended(r: dict[str, Any], who: str) -> None:
    if r["kind"] != "human":
        return
    _post_chat(ss.chat_line(r, who, False))
    _safe(cx.resolve_alerts, [f"live-watch:{r['id']}"])


@router.post("/sessions/{sid}/watch")
async def watch(sid: str, request: Request) -> dict[str, Any]:
    """Start watching ({voice?}). Owner only; voice only on a human session whose device runs AmberX. Logged."""
    o = await body(request)
    r = find(sid)
    v = viewer(request)
    voice = o.get("voice") is True
    allowed, why = ss.can_watch(v, r, voice)
    if not allowed:
        audit("watch-refused", v["name"], session=sid, voice=voice, why=why)
        raise HTTPException(403, why)
    wid = secrets.token_urlsafe(9)
    first = WATCH.start(sid, wid, v["name"], voice)
    audit("watch-start", v["name"], session=sid, kind=r["kind"], voice=voice, watcher=wid)
    if first:
        _watch_started(r, v["name"], voice)
    r = find_fresh(sid)
    return {"ok": True, "watcher": wid, "beatEveryS": 15, "session": public(r)}


@router.post("/sessions/{sid}/watch/{wid}/beat")
def beat(sid: str, wid: str) -> dict[str, Any]:
    if not WATCH.beat(sid, wid):
        raise HTTPException(404, "that watch ended")
    return {"ok": True}


@router.delete("/sessions/{sid}/watch/{wid}")
def unwatch(sid: str, wid: str, request: Request) -> dict[str, Any]:
    """Stop watching. The notice goes off when the last watcher leaves."""
    who = next((w["by"] for w in WATCH.by.get(sid, {}).values() if w["id"] == wid), viewer(request)["name"])
    last = WATCH.stop(sid, wid)
    audit("watch-stop", who, session=sid, watcher=wid)
    if last:
        try:
            _watch_ended(find(sid), who)
        except HTTPException:
            pass
    collect(force=True)
    return {"ok": True, "last": last}


def _source(r: dict[str, Any]) -> tuple[str, Any]:
    if r["kind"] == "human" and STORE().meta(r["id"]):
        return "store", None
    log = ln.stream_log(r.get("_cwd") or "", r["id"].removeprefix("tmux:"))
    if log:
        return "log", log
    return "buffer", None


@router.get("/sessions/{sid}/stream")
async def stream(sid: str, watcher: str, after: int = -1) -> StreamingResponse:
    """Server-sent events for one watch: `event` per message / tool call / result (secrets redacted), `audio` per voice
    segment (only for a voice watcher), `status` with the row. Ends when the watch does."""
    r = find(sid)
    w = WATCH.by.get(sid, {}).get(watcher)
    if not w:
        raise HTTPException(403, "start a watch first (POST sessions/{id}/watch)")
    voice = bool(w.get("voice")) and r["kind"] == "human"

    async def gen():
        kind, log = _source(r)
        seq, offset, audio_after, last_status = after, 0, -1, ""
        if kind == "log" and after < 0:
            size = log.stat().st_size
            offset = max(0, size - 256 * 1024)  # start from the recent part of a long log
            if offset:
                with open(log, "rb") as f:
                    f.seek(offset)
                    f.readline()
                    offset = f.tell()
        yield "retry: 3000\n\n"
        n = 0
        while sid in WATCH.by and watcher in WATCH.by[sid]:
            WATCH.beat(sid, watcher)
            out: list[dict[str, Any]] = []
            if kind == "store":
                out = await asyncio.to_thread(STORE().events, sid, seq, 500)
            elif kind == "log":
                evs, offset = await asyncio.to_thread(ln.tail, log, offset)
                out = [{**(rec.clean_event(e, 0) or {}), "seq": seq + 1 + i} for i, e in enumerate(evs)]
            else:
                out = [e for e in _buffers.get(sid, []) if e["seq"] > seq]
            for e in out:
                seq = max(seq, int(e.get("seq", seq)))
                yield f"event: event\ndata: {json.dumps(e, default=str)}\n\n"
            if voice:
                for a in await asyncio.to_thread(STORE().raw_audio, sid, audio_after):
                    audio_after = max(audio_after, a["offsetMs"])
                    yield f"event: audio\ndata: {json.dumps(a)}\n\n"
            if n % 5 == 0:
                try:
                    row = public(await asyncio.to_thread(find, sid))
                except HTTPException:
                    break
                s = json.dumps(row, sort_keys=True, default=str)
                if s != last_status:
                    last_status = s
                    yield f"event: status\ndata: {s}\n\n"
            n += 1
            await asyncio.sleep(1.0)
        yield "event: end\ndata: {}\n\n"
    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})


AUDIO_FILE = re.compile(r"^(mic|tts)-\d{10}\.(webm|opus|ogg|m4a|wav|mp3|aac)$")
MIME = {"webm": "audio/webm", "opus": "audio/ogg", "ogg": "audio/ogg", "m4a": "audio/mp4", "wav": "audio/wav", "mp3": "audio/mpeg", "aac": "audio/aac"}


@router.get("/sessions/{sid}/audio/{file}")
def audio_file(sid: str, file: str, request: Request) -> FileResponse:
    """One voice segment (live) or compacted chunk (played back). Owner only."""
    need_owner(request, "listen to a session")
    if not AUDIO_FILE.match(file):
        raise HTTPException(400, "bad file")
    st = STORE()
    for sub in ("raw", "chunks"):
        f = st.dir(sid) / "audio" / sub / file
        if f.exists():
            return FileResponse(f, media_type=MIME[file.rsplit(".", 1)[1]], headers={"cache-control": "private, max-age=3600"})
    raise HTTPException(404, "no such audio")


# ---------------------------------------------------------------- recordings

def finish(sid: str) -> None:
    """A human session ended: close its recording and queue the silence compaction (low priority, background)."""
    st = STORE()
    m = st.end(sid)
    if m and m.get("audio", {}).get("raw") and not m["audio"].get("compacted"):
        settings = read_state()["settings"]
        threading.Thread(target=lambda: _safe(_compact_nice, sid, int(settings["padMs"])), daemon=True).start()


def _compact_nice(sid: str, pad: int) -> None:
    try:
        os.nice(10)
    except OSError:
        pass
    rec.compact(STORE(), sid, pad_ms=pad, log=lambda s: cx.log("plugins", f"live-sessions: {s}", "info"))


def _search(m: dict[str, Any], q: str) -> bool:
    row = m.get("row") or {}
    hay = " ".join(str(x) for x in (row.get("title"), row.get("agent", {}).get("name"), row.get("device"), row.get("app"), row.get("account"), " ".join(m.get("topics") or []))).lower()
    if q in hay:
        return True
    try:
        with open(STORE().dir(m["id"]) / "events.jsonl") as f:
            return any(q in line.lower() for line in f)
    except OSError:
        return False


def _summary(m: dict[str, Any]) -> dict[str, Any]:
    row = m.get("row") or {}
    c = (m.get("audio") or {}).get("compacted") or {}
    return {"id": m["id"], "agent": row.get("agent") or {}, "account": row.get("account"), "device": row.get("device"), "app": row.get("app"), "client": row.get("client"),
            "mode": row.get("mode"), "title": row.get("title"), "startMs": m.get("startMs"), "endMs": m.get("endMs"), "lastMs": m.get("lastMs"),
            "lengthMs": max(0, int(m.get("endMs") or m.get("lastMs") or 0) - int(m.get("startMs") or 0)), "events": m.get("events", 0), "bytes": m.get("bytes", 0),
            "topics": m.get("topics") or [], "costUsd": m.get("costUsd") if m.get("costUsd") is not None else row.get("costUsd"), "pinned": bool(m.get("pinned")),
            "favourite": bool(m.get("favourite")), "audio": bool((m.get("audio") or {}).get("raw")), "savedBytes": c.get("savedBytes"), "compacted": bool(c), "verified": c.get("verified")}


@router.get("/recordings")
def recordings(request: Request, q: str = "", favourites: bool = False, agent: str = "", account: str = "") -> dict[str, Any]:
    """Past (and running) human sessions, newest first; q searches titles, topics and every transcript line."""
    need_owner(request, "browse recordings")
    q = q.strip().lower()
    out = []
    for m in STORE().list():
        if favourites and not m.get("favourite"):
            continue
        s = _summary(m)
        if agent and agent.lower() not in (str(s["agent"].get("id", "")).lower(), str(s["agent"].get("name", "")).lower()):
            continue
        if account and s["account"] != account:
            continue
        if q and not _search(m, q):
            continue
        out.append(s)
    return {"items": out[:500], "total": len(out)}


def _meta(sid: str) -> dict[str, Any]:
    try:
        m = STORE().meta(sid)
    except ValueError:
        raise HTTPException(400, "bad id") from None
    if not m:
        raise HTTPException(404, "no such recording")
    return m


@router.get("/recordings/{sid}")
def recording(sid: str, request: Request) -> dict[str, Any]:
    """One recording for the player: summary, timeline (markers, speech spans, context counts), every event, audio chunks
    (compacted; else the raw segments)."""
    need_owner(request, "play a recording")
    m = _meta(sid)
    st = STORE()
    evs = st.events(sid)
    ch = rec.chunks(st, sid)
    audio = ch or [{"track": a["track"], "startMs": a["offsetMs"], "endMs": None, "file": a["file"], "bytes": a["bytes"]} for a in st.raw_audio(sid)]
    return {"recording": _summary(m), "timeline": rec.timeline(m, evs, ch), "events": evs, "audio": audio, "compaction": (m.get("audio") or {}).get("compacted")}


@router.get("/recordings/{sid}/context")
def recording_context(sid: str, request: Request, t: int = 0) -> dict[str, Any]:
    """What was in the context window at session time t (ms): events since the last compaction, tokens, compacted count."""
    need_owner(request, "play a recording")
    _meta(sid)
    return rec.context_at(STORE().events(sid), t)


@router.get("/recordings/{sid}/export")
def export(sid: str, request: Request) -> Response:
    """The whole recording (meta, events, audio) as one .zip file."""
    need_owner(request, "export a recording")
    _meta(sid)
    d = STORE().dir(sid)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(d.rglob("*")):
            if f.is_file():
                z.write(f, f.relative_to(d))
    audit("export", owner(request), session=sid)
    return Response(buf.getvalue(), media_type="application/zip", headers={"content-disposition": f'attachment; filename="session-{sid.replace(":", "_")}.zip"'})


@router.post("/recordings/{sid}/flags")
async def flags(sid: str, request: Request) -> dict[str, Any]:
    """Pin (keep forever, past retention) and favourite."""
    need_owner(request, "pin a recording")
    o = await body(request)
    st = STORE()
    m = _meta(sid)
    for k in ("pinned", "favourite"):
        if isinstance(o.get(k), bool):
            m[k] = o[k]
    st.write_meta(sid, m)
    return {"ok": True, "recording": _summary(m)}


@router.post("/recordings/{sid}/compact")
def compact_now(sid: str, request: Request) -> dict[str, Any]:
    """Run the silence compaction now (it also runs by itself when the session ends)."""
    need_owner(request, "compact a recording")
    _meta(sid)
    try:
        return {"ok": True, "report": rec.compact(STORE(), sid, pad_ms=int(read_state()["settings"]["padMs"]))}
    except (RuntimeError, KeyError) as e:
        raise HTTPException(409, str(e)) from None


@router.delete("/recordings/{sid}")
def delete_recording(sid: str, request: Request) -> dict[str, Any]:
    """Delete one recording for good (owner only, logged). The browser confirms first."""
    name = need_owner(request, "delete a recording")
    m = _meta(sid)
    ok = STORE().delete(sid)
    audit("delete", name, session=sid, bytes=m.get("bytes", 0))
    return {"ok": ok}


# ---------------------------------------------------------------- settings + storage

@router.get("/settings")
def get_settings() -> dict[str, Any]:
    d = read_state()
    st = STORE()
    used = st.used()
    return {"settings": d["settings"], "defaults": DEFAULTS, "usedBytes": used, "cap": rec.cap_state(used, float(d["settings"]["capMb"])),
            "ffmpeg": bool(rec.ffmpeg()), "savedBytes": sum(int(((m.get("audio") or {}).get("compacted") or {}).get("savedBytes") or 0) for m in st.list())}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    """Recording on, keep raw N hours, speech padding, retention days, size cap (owner)."""
    name = need_owner(request, "change recording settings")
    o = await body(request)
    with state() as d:
        for k, v in DEFAULTS.items():
            if k in o and k != "watchNotice":
                if isinstance(v, bool) and isinstance(o[k], bool):
                    d["settings"][k] = o[k]
                elif not isinstance(v, bool) and isinstance(o[k], (int, float)) and not isinstance(o[k], bool) and o[k] >= 0:
                    d["settings"][k] = o[k]
        out = dict(d["settings"])
    audit("settings", name, settings=out)
    return {"ok": True, "settings": out}


def _containers() -> list[dict[str, Any]]:
    svc = plugin_services.get(CONTAINERS)
    try:
        return [{"id": c.get("id", "")[:12], "name": c.get("name", ""), "state": c.get("state", ""), "image": c.get("image", "")} for c in (svc.list(include_hidden=False) if svc else [])
                if c.get("state") in ("running", "", None)]
    except Exception:  # noqa: BLE001
        return []


def _gh(path: str) -> Any:
    tok = os.environ.get("GITHUB_TOKEN") or ""
    if not tok:
        raise RuntimeError("no GitHub token (Settings → Plugins → GitHub)")
    req = urllib.request.Request(f"https://api.github.com{path}", headers={"authorization": f"Bearer {tok}", "accept": "application/vnd.github+json", "user-agent": "axf-live-sessions"})
    with urllib.request.urlopen(req, timeout=15) as r:  # noqa: S310 — fixed https host
        return json.loads(r.read())


_repo_cache: dict[str, Any] = {"at": 0.0, "items": [], "why": ""}


def _repos() -> dict[str, Any]:
    if time.time() - _repo_cache["at"] < 300:
        return _repo_cache
    try:
        j = _gh("/installation/repositories?per_page=100")
        items = [{"repo": r["full_name"], "private": bool(r.get("private"))} for r in j.get("repositories") or []]
        _repo_cache.update(at=time.time(), items=items, why="")
    except Exception as e:  # noqa: BLE001
        _repo_cache.update(at=time.time(), why=str(e)[:200])
    return _repo_cache


def _status(d: dict[str, Any]) -> dict[str, Any]:
    out = {}
    root = store_root(d)
    for t in d["storage"]["targets"]:
        info = next((r for r in _repo_cache["items"] if r["repo"] == t["repo"]), None) if t["kind"] == "repo" else None
        problems = rec.check_target(t, info)
        mirror = d["mirrors"].get(t["id"]) or {}
        if t["kind"] == "own-container":
            s = {"state": "synced", "usedBytes": rec.Store(root).used(), "path": str(root)}
        elif t["kind"] == "local":
            have = d["local"].get(t["id"]) or {}
            s = {"state": "synced" if have.get("ids") and set(have["ids"]) >= {m["id"] for m in rec.Store(root).list() if m.get("endMs")} else "pending",
                 "usedBytes": int(have.get("bytes") or 0), "device": have.get("device", ""), "at": have.get("at")}
        else:
            s = {"state": mirror.get("state") or "pending", "usedBytes": int(mirror.get("bytes") or 0), "error": mirror.get("error", ""), "at": mirror.get("at")}
        if problems:
            s = {**s, "state": "error", "error": " ".join(problems)}
        out[t["id"]] = s
    return out


@router.get("/storage")
def get_storage(request: Request) -> dict[str, Any]:
    """Recording targets, primary + mirrors, per-target status and space, and the dropdowns (containers, repos)."""
    d = read_state()
    repos = _repos() if viewer(request)["owner"] else {"items": [], "why": "owner only"}
    return {"storage": d["storage"], "status": _status(d), "containers": _containers(), "repos": repos["items"], "reposWhy": repos.get("why", ""),
            "kinds": list(rec.TARGET_KINDS)}


@router.put("/storage")
async def put_storage(request: Request) -> dict[str, Any]:
    """Save targets ({primary, mirrors, targets}). A public repo needs allowPublic (Brett's 'I understand'). The primary
    is the own container (the working store); other targets are synced mirrors. Moving the working store is storage/move."""
    name = need_owner(request, "change where recordings are stored")
    o = await body(request)
    new = rec.norm_storage(o)
    _repos()
    for t in new["targets"]:
        info = next((r for r in _repo_cache["items"] if r["repo"] == t["repo"]), None) if t["kind"] == "repo" else None
        problems = rec.check_target(t, info)
        if problems and (t["id"] == new["primary"] or t["id"] in new["mirrors"]):
            raise HTTPException(400, f"{t['label'] or t['id']}: {' '.join(problems)}")
    prim = next(t for t in new["targets"] if t["id"] == new["primary"])
    if prim["kind"] != "own-container":
        raise HTTPException(400, "The primary is the own container (the working store the console writes live sessions to); add the others as mirrors.")
    with state() as d:
        old_own = next((t for t in d["storage"]["targets"] if t["kind"] == "own-container"), {})
        new_own = next((t for t in new["targets"] if t["kind"] == "own-container"), {})
        if (old_own.get("path") or "") != (new_own.get("path") or ""):
            raise HTTPException(409, "Changing the own container's path moves every recording: use Move (storage/move) so nothing is lost.")
        d["storage"] = new
    audit("storage", name, storage=new)
    threading.Thread(target=lambda: _safe(sync_mirrors), daemon=True).start()
    return {"ok": True, "storage": new}


@router.post("/storage/move")
async def move_store(request: Request) -> dict[str, Any]:
    """Move every recording to a new working-store path ({path, dryRun?}): copy, verify each SHA-256 there, then delete
    the source. Dry run answers the plan (files, bytes) without touching anything."""
    name = need_owner(request, "move recordings")
    o = await body(request)
    path = str(o.get("path") or "").strip()
    if not path.startswith("/") or ".." in path.split("/"):
        raise HTTPException(400, "an absolute path without ..")
    src, dst = store_root(), Path(path)
    if src.resolve() == dst.resolve():
        raise HTTPException(400, "that is where they are now")
    if o.get("dryRun") is not False:
        plan = rec.plan_move(rec.manifest(src), {f["rel"]: f["sha256"] for f in rec.manifest(dst)})
        return {"ok": True, "dryRun": True, "files": len(plan), "copy": sum(1 for p in plan if p["action"] == "copy"), "bytes": sum(p["bytes"] for p in plan), "from": str(src), "to": path}
    with _lock:
        r = rec.move(src, dst)
        if r["ok"]:
            with state() as d:
                for t in d["storage"]["targets"]:
                    if t["kind"] == "own-container":
                        t["path"] = path
    audit("move", name, src=str(src), dst=path, result=r)
    if not r["ok"]:
        raise HTTPException(409, {"error": "Some files didn't verify at the destination; nothing was deleted.", **r})
    return {"ok": True, **r}


@router.post("/storage/local-ack")
async def local_ack(request: Request) -> dict[str, Any]:
    """A device (AmberX, a browser) reports the recordings it keeps for a local target: {target, device, ids, bytes}."""
    o = await body(request, 200_000)
    tid = str(o.get("target") or "")
    with state() as d:
        if not any(t["id"] == tid and t["kind"] == "local" for t in d["storage"]["targets"]):
            raise HTTPException(404, "no such local target")
        d["local"][tid] = {"device": str(o.get("device") or "")[:80], "ids": [str(x)[:120] for x in (o.get("ids") or [])][:5000], "bytes": int(o.get("bytes") or 0), "at": now_ms()}
    return {"ok": True}


def _mirror_container(t: dict[str, Any], src: Path, synced: dict[str, str]) -> dict[str, Any]:
    svc = plugin_services.get(CONTAINERS)
    if not svc:
        raise RuntimeError("Container access is off, so nothing can write into a container")
    n = 0
    for f in rec.manifest(src):
        if synced.get(f["rel"]) == f["sha256"]:
            continue
        data = base64.b64encode((src / f["rel"]).read_bytes()).decode()
        svc.write_file(t["container"], f"{t['path'].rstrip('/')}/{f['rel']}", data, actor={"kind": "plugin", "id": FOLDER, "name": "Live sessions"}, encoding="base64")
        synced[f["rel"]] = f["sha256"]
        n += 1
    return {"files": n}


def _mirror_repo(t: dict[str, Any], src: Path, synced: dict[str, str]) -> dict[str, Any]:
    tok = os.environ.get("GITHUB_TOKEN") or ""
    if not tok:
        raise RuntimeError("no GitHub token")
    work = data_dir() / "repo-mirrors" / t["id"]
    url = f"https://x-access-token:{tok}@github.com/{t['repo']}.git"
    env = {**os.environ, "GIT_TERMINAL_PROMPT": "0", "GIT_LFS_SKIP_SMUDGE": "1"}

    def git(*a: str) -> str:
        p = subprocess.run(["git", "-C", str(work), *a], capture_output=True, text=True, timeout=600, env=env)
        if p.returncode:
            raise RuntimeError(rec.redact(p.stderr.strip()[-300:]))
        return p.stdout
    if not (work / ".git").exists():
        work.mkdir(parents=True, exist_ok=True)
        git("init", "-q")
        git("remote", "add", "origin", url)
    git("remote", "set-url", "origin", url)
    if subprocess.run(["git", "lfs", "version"], capture_output=True).returncode:
        raise RuntimeError("git-lfs isn't installed in the console image")
    try:
        git("fetch", "-q", "--depth", "1", "origin", t["branch"])
        git("checkout", "-q", "-B", t["branch"], "FETCH_HEAD")
    except RuntimeError:
        git("checkout", "-q", "--orphan", t["branch"])
    git("lfs", "install", "--local")
    git("lfs", "track", f"{t['folder']}/**/audio/**")
    n = 0
    for f in rec.manifest(src):
        if synced.get(f["rel"]) == f["sha256"]:
            continue
        to = work / t["folder"] / f["rel"]
        to.parent.mkdir(parents=True, exist_ok=True)
        to.write_bytes((src / f["rel"]).read_bytes())
        synced[f["rel"]] = f["sha256"]
        n += 1
    if n:
        git("add", "-A")
        git("-c", "user.name=AXF Live sessions", "-c", "user.email=noreply@amberxai.com", "commit", "-qm", f"Recordings: {n} file(s)")
        git("push", "-q", "origin", f"HEAD:{t['branch']}")
    return {"files": n}


def sync_mirrors() -> None:
    """Append-only sync of the working store to every mirror (container, repo); status per target, retried each sweep."""
    d = read_state()
    src = store_root(d)
    for tid in d["storage"]["mirrors"]:
        t = next((x for x in d["storage"]["targets"] if x["id"] == tid), None)
        if not t or t["kind"] in ("own-container", "local"):
            continue
        info = next((r for r in _repo_cache["items"] if r["repo"] == t["repo"]), None) if t["kind"] == "repo" else None
        if rec.check_target(t, info):
            continue
        prev = d["mirrors"].get(tid) or {}
        synced = dict(prev.get("synced") or {})
        try:
            r = (_mirror_container if t["kind"] == "vps-container" else _mirror_repo)(t, src, synced)
            st = {"state": "synced", "files": r["files"], "error": ""}
        except Exception as e:  # noqa: BLE001
            st = {"state": "error", "error": rec.redact(str(e))[:300]}
        with state() as dd:
            dd["mirrors"][tid] = {**prev, **st, "synced": synced, "bytes": sum((src / k).stat().st_size for k in synced if (src / k).exists()), "at": now_ms()}


@router.get("/audit")
def get_audit(request: Request, limit: int = 200) -> dict[str, Any]:
    """Every watch start / stop, refused watch, delete, export, move, settings and storage change, newest first."""
    need_owner(request, "read the watch log")
    try:
        lines = (data_dir() / "audit.jsonl").read_text().splitlines()[-max(1, min(limit, 2000)):]
    except OSError:
        lines = []
    return {"items": [json.loads(x) for x in reversed(lines) if x.strip()]}


# ---------------------------------------------------------------- the sweep (watchers, ends, compaction, retention, cap)

def sweep() -> dict[str, Any]:
    out: dict[str, Any] = {"watchEnded": [], "finished": [], "purged": [], "expired": []}
    for sid, w in WATCH.sweep():
        audit("watch-stop", w["by"], session=sid, watcher=w["id"], why="no heartbeat")
        try:
            _watch_ended(find(sid), w["by"])
        except HTTPException:
            pass
        out["watchEnded"].append(sid)
    d = read_state()
    st = STORE()
    live = {r["id"]: r for r in collect(force=True)}
    for m in st.list():
        r = live.get(m["id"])
        if not m.get("endMs") and (r is None or r["status"] == "ended"):
            finish(m["id"])
            out["finished"].append(m["id"])
    out["purged"] = rec.purge_raw(st, float(d["settings"]["keepRawHours"]))
    for sid in rec.expired(st.list(), float(d["settings"]["keepDays"]), now_ms()):
        st.delete(sid)
        audit("retention", "sweep", session=sid)
        out["expired"].append(sid)
    cap = rec.cap_state(st.used(), float(d["settings"]["capMb"]))
    if cap["level"] != "ok":
        _safe(cx.raise_alert, {"source": "live-sessions", "key": "live-recordings-cap", "severity": "warn" if cap["level"] == "warn" else "error",
                               "title": f"Session recordings at {cap['pct']}% of their cap", "body": "Raise the cap, shorten retention or move them (Settings → Plugins → Live sessions → Recordings).",
                               "link": "action:settings.open:live-sessions"})
    if d["storage"]["mirrors"]:
        _safe(sync_mirrors)
    return {**out, "cap": cap}


_sweeper: dict[str, Any] = {"started": False}


def _loop() -> None:
    while True:
        time.sleep(SWEEP_EVERY)
        if os.environ.get("AXF_LIVE_SWEEP") == "off":
            continue
        _safe(sweep)


if not _sweeper["started"] and os.environ.get("AXF_LIVE_SWEEP") != "off":
    _sweeper["started"] = True
    threading.Thread(target=_loop, daemon=True, name="live-sessions-sweep").start()
