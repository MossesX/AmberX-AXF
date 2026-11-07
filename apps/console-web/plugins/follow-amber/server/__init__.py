"""Follow Amber (server part): one switch for the owner's consoles, and what Amber shows on it.

Brett, Nov 3 2026: with Follow Amber on, whatever Amber (a Claude session through the console's MCP or axHub) talks
about opens on his screen right away, and axHub's held / confirm calls pop up in the console as approval dialogs.

  GET  state                                      {on, by, at, clients}: is it on (Amber reads this before showing)
  POST state {on, by?}                            switch it (the owner's signed-in console, the CLI or the API)
  POST show  {target, kind?, highlight?, say?, to?, by?}
                                                  open what Amber names, focused and highlighted; a no-op when off
  POST approval {id?, by?}                        a held / confirm call is waiting: every follow client reads the
                                                  approvals feed now and pops it up (a no-op when off)
  GET  stream?client=<id>                         server-sent events, one follow-amber@1 frame per `data:`
  GET  recent                                     the last things shown

Showing only ever navigates. A show runs through the Console commands plugin (capability console-commands@1) with the
single grant `control.console.navigate`, so its runner refuses anything that would change data; screens, settings
tabs and dialogs open, navigation-only actions run, nothing else. When no console is open, Console commands' own
delivery applies (queue + wake through AmberX where that is installed).

Approvals are never decided here: the console's pop-up reads the hub's feed and a tap goes through the approvals
banner's relay with Brett's own browser session (lib-approvals / veto@1). This server holds no hub session.

Only the owner's consoles follow Amber (the console token or a hub admin); a hub user who isn't an admin gets 403.
State lives in .axf-console/plugins/follow-amber/state.json; the open streams live in memory.
Capability follow-amber@1: plugin_services.get("follow-amber@1").state() / .show(...) / .approval(...).
"""
from __future__ import annotations

import asyncio
import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import StreamingResponse

import plugin_services

router = APIRouter()
FOLDER = "follow-amber"
FRAME = "follow-amber@1"
ROOT = Path(__file__).resolve().parents[5]
KINDS = ("screen", "settings", "dialog", "action")
TARGET_OF = {"screen": "console.screens", "settings": "console.settings", "dialog": "console.dialogs", "action": "console.actions"}
# The order a bare name is tried in: a screen first, then a settings tab, then a dialog.
TRY_ORDER = ("screen", "settings", "dialog")
NAVIGATE = ["control.console.navigate"]
TEXT_MAX = 300
CLIENT_MAX = 64

_lock = threading.Lock()
_clients: dict[str, dict[str, Any]] = {}
_recent: deque[dict[str, Any]] = deque(maxlen=30)


def _data() -> Path:
    return Path(os.environ.get("AXF_FOLLOW_AMBER_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _text(v: Any, cap: int = TEXT_MAX) -> str:
    return v.strip()[:cap] if isinstance(v, str) else ""


# ---------------------------------------------------------------------- the switch

def load_state() -> dict[str, Any]:
    """{on, by, at}. Off unless someone switched it on (new options default off)."""
    try:
        s = json.loads((_data() / "state.json").read_text())
        return {"on": s.get("on") is True, "by": _text(s.get("by"), 80), "at": _text(s.get("at"), 40)}
    except (OSError, ValueError):
        return {"on": False, "by": "", "at": ""}


def save_state(on: bool, by: str) -> dict[str, Any]:
    s = {"on": bool(on), "by": _text(by, 80) or "console", "at": _now_iso()}
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f"state.json.tmp-{os.getpid()}"
    tmp.write_text(json.dumps(s, indent=1) + "\n")
    tmp.replace(d / "state.json")
    broadcast({"type": "state", "on": s["on"], "by": s["by"], "at": s["at"]})
    return s


# ---------------------------------------------------------------------- follow clients (one stream per console tab)

def broadcast(frame: dict[str, Any]) -> int:
    """Send a follow-amber@1 frame to every open follow stream; → how many got it."""
    msg = {"$axf": FRAME, "at": _now_iso(), **frame}
    n = 0
    with _lock:
        for c in _clients.values():
            q, loop = c.get("queue"), c.get("loop")
            if q is not None and loop is not None:
                loop.call_soon_threadsafe(q.put_nowait, msg)
                n += 1
    return n


def client_count() -> int:
    with _lock:
        return sum(1 for c in _clients.values() if c.get("queue") is not None)


# ---------------------------------------------------------------------- showing

def parse_target(target: str, kind: str = "") -> tuple[str, str]:
    """`kind:name` or a bare name → (kind or "", name). Known prefixes: screen, settings, dialog, action, approval."""
    t = _text(target, 200)
    k = _text(kind, 20).lower()
    if not k and ":" in t:
        head, rest = t.split(":", 1)
        if head.lower() in (*KINDS, "approval") and rest.strip():
            k, t = head.lower(), rest.strip()
    return k, t


def _console() -> Any | None:
    if not any(s["name"] == "console-commands@1" for s in plugin_services.available()):
        return None
    return plugin_services.get("console-commands@1")


def _open(kind: str, name: str, to: str, by: str) -> dict[str, Any]:
    svc = _console()
    if svc is None:
        return {"ok": False, "code": "not_implemented", "message": "the Console commands plugin is off or missing (Settings → Plugins), so nothing can be opened"}
    action = "run" if kind == "action" else "open"
    cmd: dict[str, Any] = {"op": "act", "target": TARGET_OF[kind], "path": name, "action": action, "by": by, "reason": "Follow Amber: show what Amber is talking about"}
    if to and to != "recent":
        cmd["input"] = {"to": to}
    # navigate only: the runner refuses anything that would change data
    return svc.run(cmd, NAVIGATE, by)


def show(target: str, kind: str = "", highlight: str = "", say: str = "", to: str = "recent", by: str = "amber") -> dict[str, Any]:
    """Open what Amber names in the owner's consoles (focused + highlighted), or nothing when Follow Amber is off."""
    st = load_state()
    k, name = parse_target(target, kind)
    if not name:
        return {"ok": False, "code": "invalid", "message": "target is needed: a screen, settings tab, dialog or action (name, title or words), or kind:name"}
    if k and k not in (*KINDS, "approval"):
        return {"ok": False, "code": "invalid", "message": f"kind must be one of {', '.join((*KINDS, 'approval'))}"}
    base = {"follow": st["on"], "target": name, **({"kind": k} if k else {})}
    if not st["on"]:
        return {"ok": True, "shown": False, **base, "message": "Follow Amber is off: nothing was opened (Brett turns it on in the console)"}
    highlight, say = _text(highlight, 200), _text(say)
    if k == "approval":
        n = broadcast({"type": "approval", "id": name, "say": say, "by": by})
        r: dict[str, Any] = {"ok": True, "shown": n > 0, **base, "consoles": n, "message": f"approval pop-up asked for in {n} console(s)" if n else "no console is following right now"}
    else:
        tried: list[str] = []
        r = {}
        for kk in ([k] if k else list(TRY_ORDER)):
            tried.append(kk)
            r = _open(kk, name, to, by)
            # another kind is tried only when this one has no such name (no console open = the same for every kind)
            if r.get("ok") or r.get("code") != "not_found" or r.get("noConsole") or "no console is open" in str(r.get("message", "")):
                k = kk
                break
        if not r.get("ok"):
            r = {**{x: v for x, v in r.items() if x not in ("op", "path", "action")}, "shown": False, **base, "tried": tried}
        else:
            item = r.get("item") or {}
            label = item.get("label") or name
            n = broadcast({"type": "show", "kind": k, "target": name, "label": label, "highlight": highlight, "say": say, "by": by})
            r = {"ok": True, "shown": True, **base, "kind": k, "label": label, "consoles": n, "delivered": r.get("delivered") or [], **({"delivery": r["delivery"]} if r.get("delivery") else {}),
                 "message": f"opened {label}" + (f" and highlighted {highlight}" if highlight else "")}
    with _lock:
        _recent.appendleft({"at": _now_iso(), "by": by, "kind": r.get("kind", k), "target": name, "ok": bool(r.get("ok")), "shown": bool(r.get("shown")), "message": _text(r.get("message"))})
    return r


def approval(aid: str = "", by: str = "amber", say: str = "") -> dict[str, Any]:
    """A held / confirm call is waiting for Brett: the follow clients read the feed now and pop it up."""
    st = load_state()
    if not st["on"]:
        return {"ok": True, "shown": False, "follow": False, "message": "Follow Amber is off: the call waits in the approvals banner / axHub as usual"}
    n = broadcast({"type": "approval", "id": _text(aid, 80), "say": _text(say), "by": by})
    return {"ok": True, "shown": n > 0, "follow": True, "consoles": n, "message": f"{n} console(s) are reading the approvals feed now" if n else "no console is following right now; AmberX still notifies"}


# ---------------------------------------------------------------------- who is asking

def _owner(request: Request) -> str:
    """The caller's name when it is the owner (console token or a hub admin); anyone else → 403."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return "console"
    if getattr(user, "admin", False):
        return str(getattr(user, "name", "") or "owner")
    raise HTTPException(403, "Follow Amber is for the owner's consoles only")


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — an empty or non-JSON body = no fields
        return {}


# ---------------------------------------------------------------------- routes

@router.get("/state")
def get_state(request: Request) -> dict[str, Any]:
    _owner(request)
    return {"ok": True, **load_state(), "clients": client_count()}


@router.post("/state")
async def set_state(request: Request) -> dict[str, Any]:
    name = _owner(request)
    b = await _body(request)
    if not isinstance(b.get("on"), bool):
        raise HTTPException(400, "on must be true or false")
    return {"ok": True, **save_state(b["on"], _text(b.get("by"), 80) or name), "clients": client_count()}


@router.post("/show")
async def post_show(request: Request) -> dict[str, Any]:
    name = _owner(request)
    b = await _body(request)
    return await run_in_threadpool(show, _text(b.get("target"), 200), _text(b.get("kind"), 20), _text(b.get("highlight"), 200), _text(b.get("say")),
                                   _text(b.get("to"), 64) or "recent", _text(b.get("by"), 80) or name)


@router.post("/approval")
async def post_approval(request: Request) -> dict[str, Any]:
    name = _owner(request)
    b = await _body(request)
    return approval(_text(b.get("id"), 80), _text(b.get("by"), 80) or name, _text(b.get("say")))


@router.get("/recent")
def recent(request: Request) -> dict[str, Any]:
    _owner(request)
    with _lock:
        return {"ok": True, "items": list(_recent)}


@router.get("/stream")
async def stream(request: Request, client: str = "") -> StreamingResponse:
    _owner(request)
    cid = _text(client, CLIENT_MAX)
    if len(cid) < 6 or not all(ch.isalnum() or ch in "-_" for ch in cid):
        raise HTTPException(400, "client must be 6-64 letters, digits, - or _")
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    with _lock:
        _clients[cid] = {"queue": q, "loop": loop, "since": time.time()}
    st = load_state()

    async def gen():
        try:
            yield "retry: 3000\n\n"
            yield f"data: {json.dumps({'$axf': FRAME, 'type': 'state', 'on': st['on'], 'by': st['by'], 'at': st['at']})}\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    m = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"data: {json.dumps(m)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            with _lock:
                if _clients.get(cid, {}).get("queue") is q:
                    del _clients[cid]

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


class FollowAmber:
    """follow-amber@1 for the console's MCP tools (console_show, console_follow) and other plugins."""

    router = router

    def state(self) -> dict[str, Any]:
        return {**load_state(), "clients": client_count()}

    def show(self, target: str, kind: str = "", highlight: str = "", say: str = "", to: str = "recent", by: str = "amber") -> dict[str, Any]:
        return show(target, kind, highlight, say, to, by)

    def approval(self, aid: str = "", by: str = "amber", say: str = "") -> dict[str, Any]:
        return approval(aid, by, say)


plugin_services.provide("follow-amber@1", FollowAmber(), folder=FOLDER)
