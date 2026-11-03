"""Console commands (server part): the console domain of control@1 (framework/spec/CONTROL.md → Console).

Brett tells a Claude session "open Plan Studio" and his open console goes there. Every open console (one per browser
tab) announces itself with its catalog (its search index: screens, settings tabs, dialogs, actions) and keeps a
stream open; a command is gated and resolved by the runner (`console.mjs run`, the same code the CLI and the tests
use) against the caller's own consoles, then sent down their streams; each console runs it through its own runtime
and acks what it opened, and the answer carries those acks.

One mailbox per signed-in user: the console token and hub admins share the owner's consoles (Brett's), a hub user
only reaches their own. Commands go to the console used last unless `input.to` says `all` or a client id.

Mounted twice: /api/plugins/console-commands/… (the plugin mount; the console client uses it) and /api/console/…
(the contract path, main.py's CAPABILITY_MOUNTS; console token or a hub admin).

  POST hello {client, app, title, device, catalog, here, used?}    a console announces itself (and its catalog)
  POST seen  {client, here?, used?}                                heartbeat; used = Brett touched that console
  POST bye   {client}                                              the tab closed
  GET  stream?client=<id>                                          server-sent events: one console-command@1 per `data:`
  POST ack   {client, id, ok, message, here?}                      what the console did with a command
  GET  clients · GET recent                                        the caller's open consoles · the last commands
  POST ""                                                          a whole control@1 command of the console domain
  POST open {screen} · dialog {id, arg?} · settings {tab, anchor?} · action {id, args?, confirm?} · back · home · close   (each takes `to`)
  GET  where · GET list?kind=screens|dialogs|settings|actions&q=…&limit=…

Capability console-commands@1: plugin_services.get("console-commands@1").run(command, grants=[…], by="…", audience="owner").
"""
from __future__ import annotations

import asyncio
import json
import re
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, StreamingResponse

import plugin_services

router = APIRouter()
FOLDER = "console-commands"
RUNNER = Path(__file__).resolve().parent.parent / "console.mjs"
ROOT = RUNNER.parents[4]
POLICY = ROOT / "apps" / "console-web" / "src" / "assets" / "uac-policy" / "console-access.json"
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "confirmation_required": 409, "not_implemented": 501, "unexpected": 500}
CLIENT_RE = re.compile(r"^[A-Za-z0-9_-]{6,64}$")
STALE_S = 90.0          # = CONSOLE_CLIENT_STALE_MS in core/engines/console-commands.mjs
ACK_WAIT_S = 4.0        # how long an answer waits for the consoles to say what they did
PENDING_S = 30.0        # a command for a console whose stream is reconnecting is kept this long
CATALOG_MAX_BYTES = 1_500_000
OWNER = "owner"

_lock = threading.Lock()
_clients: dict[str, dict[str, Any]] = {}
_acks: dict[str, dict[str, Any]] = {}
_recent: deque[dict[str, Any]] = deque(maxlen=50)


# ---------------------------------------------------------------------- who is asking

def _role_grants(role: str) -> list[str]:
    try:
        roles = json.loads(POLICY.read_text()).get("data", {}).get("roles", [])
    except (OSError, ValueError):
        return []
    r = next((x for x in roles if x.get("id") == role), None)
    return list(r.get("permissions") or []) if r else []


def caller(request: Request) -> tuple[list[str], str, str]:
    """(grants, name, audience). The console token and hub admins = `*` and the owner's consoles; a hub user = their own
    perms plus their role's grants in the console's uac-policy, and only their own consoles."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return ["*"], "console", OWNER
    name = str(getattr(user, "name", "") or "console")
    if getattr(user, "admin", False):
        return ["*"], name, OWNER
    grants = sorted(set(getattr(user, "perms", ()) or ()) | set(_role_grants(str(getattr(user, "role", "") or ""))))
    return grants, name, f"user:{name}"


# ---------------------------------------------------------------------- clients

def _now() -> float:
    return time.time()


def _public(c: dict[str, Any]) -> dict[str, Any]:
    """A client as the runner sees it (ms times, no queue)."""
    return {"id": c["id"], "app": c.get("app", "console-web"), "title": c.get("title", ""), "device": c.get("device", ""), "user": c.get("user", ""),
            "lastUsed": int(c.get("lastUsed", 0) * 1000), "lastSeen": int(c.get("lastSeen", 0) * 1000), "here": c.get("here") or {}, "catalog": c.get("catalog") or {"items": []}}


def _client_of(body: dict[str, Any], audience: str, user: str) -> dict[str, Any]:
    cid = str(body.get("client") or "")
    if not CLIENT_RE.match(cid):
        raise HTTPException(400, "client must be 6-64 letters, digits, - or _")
    with _lock:
        c = _clients.get(cid)
        if c is not None and c["audience"] != audience:
            raise HTTPException(403, "that console belongs to someone else")
        if c is None:
            c = _clients[cid] = {"id": cid, "audience": audience, "user": user, "lastUsed": 0.0, "lastSeen": _now(), "queue": None, "loop": None, "pending": []}
        return c


def _prune() -> None:
    cut = _now() - STALE_S * 4
    with _lock:
        for cid in [k for k, c in _clients.items() if c["queue"] is None and c["lastSeen"] < cut]:
            del _clients[cid]


def clients_of(audience: str) -> list[dict[str, Any]]:
    _prune()
    with _lock:
        return [_public(c) for c in _clients.values() if c["audience"] == audience]


def _push(c: dict[str, Any], message: dict[str, Any]) -> bool:
    q, loop = c.get("queue"), c.get("loop")
    if q is None or loop is None:
        c["pending"] = [p for p in c["pending"] if p[0] > _now() - PENDING_S][-9:] + [(_now(), message)]
        return False
    loop.call_soon_threadsafe(q.put_nowait, message)
    return True


def deliver(to: list[str], message: dict[str, Any], audience: str, wait: float = ACK_WAIT_S) -> list[dict[str, Any]]:
    """Send a console-command@1 to these consoles (the caller's only) and wait a little for their acks."""
    mid = str(message.get("id") or "")
    ev = threading.Event()
    with _lock:
        targets = [_clients[t] for t in to if t in _clients and _clients[t]["audience"] == audience]
        _acks[mid] = {"event": ev, "want": {c["id"] for c in targets}, "results": {}}
        for c in targets:
            _push(c, message)
    if targets:
        ev.wait(wait)
    with _lock:
        a = _acks.pop(mid, {"results": {}})
    out = []
    for c in targets:
        r = a["results"].get(c["id"])
        out.append(r if r else {"client": c["id"], "ok": False, "pending": True, "message": f"sent; the console didn't answer within {wait:g} s (it runs it when the tab wakes)"})
    return out


# ---------------------------------------------------------------------- running a command

def _runner(command: dict[str, Any], grants: list[str], by: str, clients: list[dict[str, Any]]) -> dict[str, Any]:
    body = json.dumps({"command": command, "grants": grants, "by": by, "clients": clients})
    try:
        p = subprocess.run(["node", str(RUNNER), "run"], input=body, cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": f"the console commands runner could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"$axf": "control@1", "ok": False, "code": "unexpected", "message": p.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-600:]}


def run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER) -> dict[str, Any]:
    """One console command for a caller → the control@1 answer, with `delivered` (the consoles' acks) on a sent command."""
    command = {k: v for k, v in (command or {}).items() if v not in (None, "")}
    r = _runner(command, grants if grants is not None else ["*"], by or str(command.get("by") or ""), clients_of(audience))
    d = r.pop("deliver", None)
    if r.get("ok") and isinstance(d, dict):
        r["sent"] = d.get("message")
        r["delivered"] = deliver([str(x) for x in d.get("to") or []], d.get("message") or {}, audience)
    if command.get("op") == "act":
        _recent.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": r.get("audit", {}).get("by") or by or command.get("by", ""), "target": command.get("target"),
                            "path": command.get("path"), "action": command.get("action"), "ok": bool(r.get("ok")), "code": r.get("code", ""), "message": r.get("message", ""),
                            "audience": audience, "delivered": [{"client": x.get("client"), "ok": x.get("ok"), "message": x.get("message", "")} for x in r.get("delivered") or []]})
    return r


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — an empty or non-JSON body = no fields
        return {}


def run_for(request: Request, command: dict[str, Any]) -> dict[str, Any]:
    grants, name, audience = caller(request)
    return run(command, grants, command.get("by") or name, audience)


def _audit(b: dict[str, Any]) -> dict[str, Any]:
    return {k: b[k] for k in ("by", "reason") if isinstance(b.get(k), str) and b[k]}


def _to(b: dict[str, Any], **more: Any) -> dict[str, Any]:
    inp = {k: v for k, v in more.items() if v not in (None, "", [])}
    if isinstance(b.get("to"), str) and b["to"]:
        inp["to"] = b["to"]
    return {"input": inp} if inp else {}


# ---------------------------------------------------------------------- routes: the consoles' side

@router.post("/hello")
async def hello(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, name, audience = caller(request)
    cat = b.get("catalog") if isinstance(b.get("catalog"), dict) else {"items": []}
    if len(json.dumps(cat)) > CATALOG_MAX_BYTES:
        raise HTTPException(413, "catalog too large")
    c = _client_of(b, audience, name)
    with _lock:
        c.update({"app": str(b.get("app") or "console-web")[:60], "title": str(b.get("title") or "")[:120], "device": str(b.get("device") or "")[:20],
                  "catalog": cat, "here": b.get("here") if isinstance(b.get("here"), dict) else {}, "lastSeen": _now()})
        if b.get("used") or not c["lastUsed"]:
            c["lastUsed"] = _now()
    return {"ok": True, "client": c["id"], "items": len(cat.get("items") or [])}


@router.post("/seen")
async def seen(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, name, audience = caller(request)
    c = _client_of(b, audience, name)
    with _lock:
        c["lastSeen"] = _now()
        if isinstance(b.get("here"), dict):
            c["here"] = b["here"]
        if b.get("used"):
            c["lastUsed"] = _now()
    return {"ok": True}


@router.post("/bye")
async def bye(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, _, audience = caller(request)
    with _lock:
        c = _clients.get(str(b.get("client") or ""))
        if c and c["audience"] == audience:
            c["lastSeen"] = 0.0
            c["lastUsed"] = 0.0
    return {"ok": True}


@router.get("/stream")
async def stream(request: Request, client: str = "") -> StreamingResponse:
    _, name, audience = caller(request)
    c = _client_of({"client": client}, audience, name)
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    with _lock:
        c["queue"], c["loop"], c["lastSeen"] = q, loop, _now()
        for at, m in c["pending"]:
            if at > _now() - PENDING_S:
                q.put_nowait(m)
        c["pending"] = []

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    m = await asyncio.wait_for(q.get(), timeout=20)
                    yield f"data: {json.dumps(m)}\n\n"
                except asyncio.TimeoutError:
                    with _lock:
                        c["lastSeen"] = _now()
                    yield ": keepalive\n\n"
        finally:
            with _lock:
                if c.get("queue") is q:
                    c["queue"], c["loop"] = None, None

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/ack")
async def ack(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, _, audience = caller(request)
    cid, mid = str(b.get("client") or ""), str(b.get("id") or "")
    with _lock:
        c = _clients.get(cid)
        if not c or c["audience"] != audience:
            raise HTTPException(404, "no such console")
        c["lastSeen"] = _now()
        if isinstance(b.get("here"), dict):
            c["here"] = b["here"]
        a = _acks.get(mid)
        if a is not None and cid in a["want"]:
            a["results"][cid] = {"client": cid, "ok": bool(b.get("ok")), "message": str(b.get("message") or "")[:300], "here": b.get("here") if isinstance(b.get("here"), dict) else {}}
            if set(a["results"]) >= a["want"]:
                a["event"].set()
    return {"ok": True}


@router.get("/clients")
def clients(request: Request) -> dict[str, Any]:
    _, _, audience = caller(request)
    now = _now() * 1000
    return {"ok": True, "items": [{k: v for k, v in c.items() if k != "catalog"} | {"items": len((c.get("catalog") or {}).get("items") or []), "live": now - c["lastSeen"] <= STALE_S * 1000}
                                  for c in sorted(clients_of(audience), key=lambda x: -x["lastUsed"])]}


@router.get("/recent")
def recent(request: Request, n: int = 20) -> dict[str, Any]:
    _, _, audience = caller(request)
    return {"ok": True, "items": [r for r in list(_recent) if r["audience"] == audience][: max(1, min(n, 50))]}


# ---------------------------------------------------------------------- routes: commands

@router.post("")
@router.post("/")
async def any_command(request: Request) -> JSONResponse:
    return answer(run_for(request, await _body(request)))


@router.post("/open")
async def open_screen(request: Request) -> JSONResponse:
    b = await _body(request)
    return answer(run_for(request, {"op": "act", "target": "console.screens", "path": b.get("screen") or b.get("path") or b.get("q"), "action": "open", **_to(b), **_audit(b)}))


@router.post("/dialog")
async def open_dialog(request: Request) -> JSONResponse:
    b = await _body(request)
    return answer(run_for(request, {"op": "act", "target": "console.dialogs", "path": b.get("id") or b.get("path") or b.get("q"), "action": "open", **_to(b, arg=b.get("arg")), **_audit(b)}))


@router.post("/settings")
async def open_settings(request: Request) -> JSONResponse:
    b = await _body(request)
    return answer(run_for(request, {"op": "act", "target": "console.settings", "path": b.get("tab") or b.get("path") or b.get("q"), "action": "open", **_to(b, anchor=b.get("anchor")), **_audit(b)}))


@router.post("/action")
async def run_action(request: Request) -> JSONResponse:
    b = await _body(request)
    cmd = {"op": "act", "target": "console.actions", "path": b.get("id") or b.get("path") or b.get("q"), "action": "run", **_to(b, args=b.get("args")), **_audit(b)}
    if b.get("confirm"):
        cmd["confirm"] = b["confirm"]
    return answer(run_for(request, cmd))


@router.post("/back")
@router.post("/home")
@router.post("/close")
async def nav(request: Request) -> JSONResponse:
    b = await _body(request)
    return answer(run_for(request, {"op": "act", "target": "console.nav", "path": "here", "action": request.url.path.rstrip("/").rsplit("/", 1)[-1], **_to(b), **_audit(b)}))


@router.get("/where")
def where(request: Request) -> JSONResponse:
    return answer(run_for(request, {"op": "get", "target": "console.nav", "path": "here"}))


@router.get("/list")
def list_(request: Request, kind: str = "screens", q: str = "", limit: int = 50, client: str = "") -> JSONResponse:
    target = {"screens": "console.screens", "dialogs": "console.dialogs", "settings": "console.settings", "actions": "console.actions", "clients": "console.clients"}.get(kind, f"console.{kind}")
    select: dict[str, Any] = {k: v for k, v in {"q": q, "client": client}.items() if v}
    if target != "console.clients" or limit != 50:
        select["limit"] = max(1, min(limit, 500))
    return answer(run_for(request, {"op": "list", "target": target, **({"select": select} if select else {})}))


class ConsoleCommands:
    """console-commands@1 for other plugins (Token control's /api/control hands console.* targets here), the /api/console
    mount and the console's MCP tools."""

    router = router

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER) -> dict[str, Any]:
        return run(command, grants, by, audience)

    def run_for(self, request: Request, command: dict[str, Any]) -> dict[str, Any]:
        return run_for(request, command)

    def clients(self, audience: str = OWNER) -> list[dict[str, Any]]:
        return [{k: v for k, v in c.items() if k != "catalog"} for c in clients_of(audience)]


plugin_services.provide("console-commands@1", ConsoleCommands(), folder=FOLDER)
