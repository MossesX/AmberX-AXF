"""Console commands (server part): the console domain of control@1 (framework/spec/CONTROL.md → Console).

Brett tells a Claude session "open Plan Studio" and his open console goes there. Every open console (one per browser
tab) announces itself with its catalog (its search index: screens, settings tabs, dialogs, actions) and keeps a
stream open; a command is gated and resolved by the runner (`console.mjs run`, the same code the CLI and the tests
use) against the caller's own consoles, then sent down their streams; each console runs it through its own runtime
and acks what it opened, and the answer carries those acks.

One mailbox per signed-in user: the console token and hub admins share the owner's consoles (Brett's), a hub user
only reaches their own. Commands go to the console used last unless `input.to` says `all` or a client id.

Nothing is lost because no tab is connected right now (console-wake, Nov 3 2026, Brett: "no matter what, a console
command must reach a console: even if the browser is closed, open it"): a command that finds no open console is queued
for that user (default 2 minutes, Settings → Plugins → Console commands) and delivered, once, the moment a console says
hello; the call waits up to a minute for it. When nothing connects within a few seconds, the owner's AmberX phone is
asked through axHub (`amberx.open_url`) to open the console with `?axf-cmd=<id>`. The answer's `delivery.how` says
how it got there: `live`, `after reconnect`, `woke via AmberX`, or `queued` (still waiting when the call returned).

Mounted twice: /api/plugins/console-commands/… (the plugin mount; the console client uses it) and /api/console/…
(the contract path, main.py's CAPABILITY_MOUNTS; console token or a hub admin).

  POST hello {client, app, title, device, catalog, here, used?}    a console announces itself (and its catalog)
  POST seen  {client, here?, used?}                                heartbeat; used = Brett touched that console
  POST bye   {client}                                              the tab closed
  GET  stream?client=<id>                                          server-sent events: one console-command@1 per `data:`
  POST ack   {client, id, ok, message, here?}                      what the console did with a command
  GET  clients · GET recent · GET queue                           the caller's open consoles · the last commands · what waits
  GET  settings · POST settings {wake, ttlS, browser}              queue + wake settings (the owner changes them)
  POST ""                                                          a whole control@1 command of the console domain
  POST open {screen} · dialog {id, arg?} (close: {"action": "close", id?}) · settings {tab, anchor?} · action {id, args?, confirm?} · back · home · close   (each takes `to`)
  GET  where · GET list?kind=screens|dialogs|settings|actions&q=…&limit=…

Capability console-commands@1: plugin_services.get("console-commands@1").run(command, grants=[…], by="…", audience="owner").
"""
from __future__ import annotations

import asyncio
import json
import os
import re
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
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
ACK_WAIT_S = 10.0       # how long an answer waits for the consoles to say what they did (4 s was too short on a
                        # busy VPS: the ack itself queued behind other requests, Nov 3 2026)
CATALOG_MAX_BYTES = 1_500_000
OWNER = "owner"
DELIVERY_WAIT_S = 60.0  # how long a call waits for a queued (or reconnecting) command to reach a console
WAKE_AFTER_S = 3.0      # no console connected this long after queuing → ask AmberX to open one
WAKE_AGAIN_S = 45.0     # one wake per this long per user (Chrome takes a moment to open)
CONSOLE_URL = (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")
DATA_DIR = Path(os.environ.get("AXF_CONSOLE_COMMANDS_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
DEFAULTS: dict[str, Any] = {"wake": True, "ttlS": 120, "browser": "chrome"}
BROWSERS = ("chrome", "default")

_lock = threading.Lock()
_clients: dict[str, dict[str, Any]] = {}
_acks: dict[str, dict[str, Any]] = {}
_recent: deque[dict[str, Any]] = deque(maxlen=50)
_queue: list[dict[str, Any]] = []            # commands that found no console: {id, audience, command, grants, by, at, expires, state, …}
_catalogs: dict[str, dict[str, Any]] = {}    # the last catalog each audience's console sent (checks a queued command early)
_draining: set[str] = set()
_woke_at: dict[str, float] = {}


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
    return {"id": c["id"], "app": c.get("app", "console-web"), **({"host": c["host"]} if c.get("host") else {}), **({"instance": c["instance"]} if c.get("instance") else {}), "front": c.get("front", True),
            "title": c.get("title", ""), "device": c.get("device", ""), "user": c.get("user", ""),
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


HOST_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,30}$")


def _front_of(c: dict[str, Any], b: dict[str, Any]) -> None:
    """What a console says about where it is (under _lock): `front` = visible and shown by its host; `host` = the app it
    runs inside (embed@1, e.g. molly)."""
    if isinstance(b.get("front"), bool):
        c["front"] = b["front"]
    if isinstance(b.get("host"), str):
        c["host"] = b["host"] if HOST_RE.match(b["host"]) else ""
    # a further copy of the console inside its host, by the name the host gave it ("Console 2"; molly-multi-instance-tabs)
    if isinstance(b.get("instance"), str):
        c["instance"] = " ".join(b["instance"].split())[:80]


def _prune() -> None:
    cut = _now() - STALE_S * 4
    with _lock:
        for cid in [k for k, c in _clients.items() if c["queue"] is None and c["lastSeen"] < cut]:
            del _clients[cid]


def clients_of(audience: str) -> list[dict[str, Any]]:
    _prune()
    with _lock:
        return [_public(c) for c in _clients.values() if c["audience"] == audience]


def _ready(c: dict[str, Any]) -> bool:
    """A console that can take a command: it sent its catalog (after a server restart a reconnecting stream has none
    until it says hello again, and a command resolved against nothing would wrongly say "no such screen")."""
    return bool((c.get("catalog") or {}).get("items"))


def ready_clients(audience: str) -> list[dict[str, Any]]:
    _prune()
    with _lock:
        return [_public(c) for c in _clients.values() if c["audience"] == audience and _ready(c)]


def _push(c: dict[str, Any], message: dict[str, Any]) -> bool:
    """Send down the console's stream; a console whose stream is reconnecting keeps it until the stream is back."""
    q, loop = c.get("queue"), c.get("loop")
    if q is None or loop is None:
        ttl = float(settings()["ttlS"])
        c["pending"] = [p for p in c["pending"] if p[0] > _now() - ttl][-9:] + [(_now(), message)]
        return False
    loop.call_soon_threadsafe(q.put_nowait, message)
    return True


def deliver(to: list[str], message: dict[str, Any], audience: str, wait: float = ACK_WAIT_S) -> list[dict[str, Any]]:
    """Send a console-command@1 to these consoles (the caller's only) and wait for their acks: a few seconds when the
    stream is open, up to DELIVERY_WAIT_S when it is reconnecting (the message goes down as soon as it is back)."""
    mid = str(message.get("id") or "")
    ev = threading.Event()
    with _lock:
        targets = [_clients[t] for t in to if t in _clients and _clients[t]["audience"] == audience]
        _acks[mid] = {"event": ev, "want": {c["id"] for c in targets}, "results": {}}
        live = [_push(c, message) for c in targets]
    if targets:
        ev.wait(wait if all(live) else max(wait, DELIVERY_WAIT_S))
    with _lock:
        a = _acks.pop(mid, {"results": {}})
    out = []
    for c, was_live in zip(targets, live):
        r = a["results"].get(c["id"])
        if r and not was_live:
            r = {**r, "afterReconnect": True}
        out.append(r if r else {"client": c["id"], "ok": False, "pending": True, "message": "sent; the console didn't answer yet (it runs it when the tab wakes)"})
    return out


# ---------------------------------------------------------------------- settings (Settings → Plugins → Console commands)

def _settings_file() -> Path:
    return DATA_DIR / "settings.json"


def settings() -> dict[str, Any]:
    try:
        raw = json.loads(_settings_file().read_text())
    except (OSError, ValueError):
        raw = {}
    return clean_settings(raw if isinstance(raw, dict) else {})


def clean_settings(raw: dict[str, Any]) -> dict[str, Any]:
    out = dict(DEFAULTS)
    if isinstance(raw.get("wake"), bool):
        out["wake"] = raw["wake"]
    try:
        out["ttlS"] = max(30, min(int(raw.get("ttlS", out["ttlS"])), 900))
    except (TypeError, ValueError):
        pass
    if raw.get("browser") in BROWSERS:
        out["browser"] = raw["browser"]
    return out


def save_settings(change: dict[str, Any]) -> dict[str, Any]:
    s = clean_settings({**settings(), **(change or {})})
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    _settings_file().write_text(json.dumps(s, indent=2) + "\n")
    return s


# ---------------------------------------------------------------------- the last catalog (checks a queued command early)

def _catalog_file(audience: str) -> Path:
    return DATA_DIR / f"catalog-{re.sub(r'[^A-Za-z0-9_-]', '_', audience)[:80]}.json"


def remember_catalog(audience: str, catalog: dict[str, Any]) -> None:
    if not (catalog or {}).get("items"):
        return
    with _lock:
        same = _catalogs.get(audience) == catalog
        _catalogs[audience] = catalog
    if not same:
        try:
            DATA_DIR.mkdir(parents=True, exist_ok=True)
            _catalog_file(audience).write_text(json.dumps(catalog))
        except OSError:
            pass


def remembered_catalog(audience: str) -> dict[str, Any] | None:
    with _lock:
        if audience in _catalogs:
            return _catalogs[audience]
    try:
        cat = json.loads(_catalog_file(audience).read_text())
    except (OSError, ValueError):
        return None
    if isinstance(cat, dict) and cat.get("items"):
        with _lock:
            _catalogs.setdefault(audience, cat)
        return cat
    return None


# ---------------------------------------------------------------------- waking a closed console through AmberX

def _hub_wake(url: str, browser: str) -> dict[str, Any]:
    """Ask Brett's AmberX phone (axHub device service `amberx`, AXPP) to open the console. → {ok, message}."""
    from . import wake
    return wake.open_url(url, browser)


WAKER: Callable[[str, str], dict[str, Any]] = _hub_wake  # tests swap in a fake phone


def _wake_later(entry: dict[str, Any]) -> None:
    """WAKE_AFTER_S after queuing: still no console → open one on the owner's phone (once per WAKE_AGAIN_S)."""
    def go() -> None:
        with _lock:
            if entry["state"] != "queued":
                return
            audience = entry["audience"]
            recent = _now() - _woke_at.get(audience, 0) < WAKE_AGAIN_S
            if not recent:
                _woke_at[audience] = _now()
        st = settings()
        if audience != OWNER or not st["wake"]:
            entry["wake"] = {"sent": False, "message": "waking through AmberX is off" if audience == OWNER else "only the owner's console is woken through AmberX"}
            return
        if recent:
            entry["wake"] = {"sent": True, "message": "AmberX was already asked to open the console"}
            return
        try:
            r = WAKER(f"{CONSOLE_URL}/?axf-cmd={entry['id']}", st["browser"])
        except Exception as e:  # noqa: BLE001 — a failed wake leaves the command queued; the answer says why
            r = {"ok": False, "message": str(e)[:300]}
        entry["wake"] = {"sent": bool(r.get("ok")), "message": str(r.get("message") or "")[:300], "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if not r.get("ok"):
            with _lock:
                _woke_at.pop(audience, None)

    t = threading.Timer(WAKE_AFTER_S, go)
    t.daemon = True
    t.start()


# ---------------------------------------------------------------------- the queue

def _iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def _expire() -> None:
    now = _now()
    with _lock:
        for e in _queue:
            if e["state"] == "queued" and e["expires"] <= now:
                e["state"] = "expired"
                e["event"].set()
        _queue[:] = [e for e in _queue if e["state"] in ("queued", "delivering") or now - e["at"] < 600][-200:]


def _enqueue(command: dict[str, Any], grants: list[str], by: str, audience: str) -> dict[str, Any]:
    ttl = float(settings()["ttlS"])
    e = {"id": f"cq-{int(_now() * 1000):x}-{os.urandom(3).hex()}", "audience": audience, "command": command, "grants": grants, "by": by,
         "at": _now(), "expires": _now() + ttl, "state": "queued", "event": threading.Event(), "result": None, "wake": None, "picked": False}
    with _lock:
        _queue.append(e)
    _wake_later(e)
    return e


def queued_for(audience: str) -> list[dict[str, Any]]:
    _expire()
    with _lock:
        return [{"id": e["id"], "state": e["state"], "at": _iso(e["at"]), "expiresAt": _iso(e["expires"]), "target": e["command"].get("target"),
                 "path": e["command"].get("path"), "action": e["command"].get("action"), "by": e["by"], "wake": e["wake"]}
                for e in _queue if e["audience"] == audience]


def _how(e: dict[str, Any]) -> str:
    return "woke via AmberX" if e["picked"] or (e["wake"] or {}).get("sent") else "after reconnect"


def drain(audience: str, pick: str = "") -> None:
    """A console of this audience said hello: deliver its queued commands, oldest first, each exactly once."""
    _expire()
    with _lock:
        if audience in _draining:
            return
        _draining.add(audience)
        if pick:
            for e in _queue:
                if e["id"] == pick and e["audience"] == audience:
                    e["picked"] = True
    try:
        while True:
            with _lock:
                e = next((x for x in _queue if x["audience"] == audience and x["state"] == "queued"), None)
                if e is None:
                    return
                e["state"] = "delivering"  # nobody else takes it: delivered once, even if two consoles say hello
            r = _runner(e["command"], e["grants"], e["by"], ready_clients(audience))
            d = r.pop("deliver", None)
            if not r.get("ok") and r.get("noConsole"):
                with _lock:  # the console went away again before it could take it
                    e["state"] = "queued" if e["expires"] > _now() else "expired"
                    if e["state"] == "expired":
                        e["event"].set()
                return
            if r.get("ok") and isinstance(d, dict):
                message = {**(d.get("message") or {}), "delivery": "woke" if _how(e) == "woke via AmberX" else "queued"}
                r["sent"] = message
                r["delivered"] = deliver([str(x) for x in d.get("to") or []], message, audience, wait=10.0)
            r["delivery"] = {"how": _how(e), "id": e["id"], "queuedFor": round(_now() - e["at"], 1), **({"wake": e["wake"]} if e["wake"] else {})}
            with _lock:
                e["result"], e["state"] = r, "delivered" if r.get("ok") else "failed"
            e["event"].set()
            _log(e["command"], r, e["by"], audience)
    finally:
        with _lock:
            _draining.discard(audience)


def _drain_soon(audience: str, pick: str = "") -> None:
    threading.Thread(target=drain, args=(audience, pick), daemon=True).start()


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


def _log(command: dict[str, Any], r: dict[str, Any], by: str, audience: str) -> None:
    if command.get("op") != "act":
        return
    _recent.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": r.get("audit", {}).get("by") or by or command.get("by", ""), "target": command.get("target"),
                        "path": command.get("path"), "action": command.get("action"), "ok": bool(r.get("ok")), "code": r.get("code", ""), "message": r.get("message", ""),
                        "audience": audience, "how": (r.get("delivery") or {}).get("how", ""),
                        "delivered": [{"client": x.get("client"), "ok": x.get("ok"), "message": x.get("message", "")} for x in r.get("delivered") or []]})


def _queueable(command: dict[str, Any], r: dict[str, Any]) -> bool:
    """No console is connected and the command is one to carry out later: an act for the recent console (or all)."""
    to = str((command.get("input") or {}).get("to") or "recent") if isinstance(command.get("input"), dict) else "recent"
    return not r.get("ok") and bool(r.get("noConsole")) and command.get("op") == "act" and to in ("recent", "all")


def run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER, wait: float | None = None) -> dict[str, Any]:
    """One console command for a caller → the control@1 answer, with `delivered` (the consoles' acks) and `delivery`
    (how it got there) on a sent command. No console connected: queued, and the call waits up to `wait` seconds."""
    command = {k: v for k, v in (command or {}).items() if v not in (None, "")}
    grants = grants if grants is not None else ["*"]
    by = by or str(command.get("by") or "")
    r = _runner(command, grants, by, ready_clients(audience))
    if _queueable(command, r):
        return _run_queued(command, grants, by, audience, DELIVERY_WAIT_S if wait is None else wait)
    d = r.pop("deliver", None)
    if r.get("ok") and isinstance(d, dict):
        r["sent"] = d.get("message")
        r["delivered"] = deliver([str(x) for x in d.get("to") or []], d.get("message") or {}, audience)
        r["delivery"] = {"how": "after reconnect" if r["delivered"] and all(x.get("afterReconnect") for x in r["delivered"] if x.get("ok")) and any(x.get("ok") for x in r["delivered"]) else "live"}
    _log(command, r, by, audience)
    return r


def _run_queued(command: dict[str, Any], grants: list[str], by: str, audience: str, wait: float) -> dict[str, Any]:
    # Checked first against the last catalog this user's console sent, so a wrong name or a missing permission
    # answers now instead of after the console opens.
    pre: dict[str, Any] | None = None
    cat = remembered_catalog(audience)
    if cat:
        pre = _runner(command, grants, by, [{"id": "remembered", "lastSeen": int(_now() * 1000), "lastUsed": int(_now() * 1000), "catalog": cat, "here": {}}])
        pre.pop("deliver", None)
        if not pre.get("ok"):
            return pre
    e = _enqueue(command, grants, by, audience)
    if ready_clients(audience):  # a console said hello while this was being checked
        _drain_soon(audience)
    e["event"].wait(max(0.0, min(wait, e["expires"] - _now())))
    with _lock:
        state, result = e["state"], e["result"]
    if state in ("delivered", "failed") and result is not None:
        return result
    base = pre or {"$axf": "control@1", "ok": True, "op": command.get("op"), "target": command.get("target"), **({"path": command["path"]} if command.get("path") else {}), "data": {"changed": []}}
    waiting = state in ("queued", "delivering")
    out = {**base, "ok": waiting, "queued": waiting,
           "delivery": {"how": "queued" if waiting else state, "id": e["id"], "expiresAt": _iso(e["expires"]), **({"wake": e["wake"]} if e["wake"] else {})}}
    if waiting:
        woke = (e["wake"] or {}).get("sent")
        out["message"] = f"queued, waiting for the console: it runs the moment one opens (until {_iso(e['expires'])})" + (
            "; AmberX was asked to open it on Brett's phone" if woke else (f"; {e['wake']['message']}" if e["wake"] else ""))
    else:
        out.update({"code": "not_found", "message": "no console opened before the command expired (Settings → Plugins → Console commands: how long a command waits)"})
    _log(command, out, by, audience)
    return out


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


async def go(request: Request, command: dict[str, Any]) -> JSONResponse:
    """Run off the event loop: the answer waits for the consoles' acks, which arrive on this same loop."""
    return answer(await run_in_threadpool(run_for, request, command))


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
        _front_of(c, b)
        if b.get("used") or not c["lastUsed"]:
            c["lastUsed"] = _now()
    remember_catalog(audience, cat)
    pick = str(b.get("pick") or "")[:40]
    if _ready(c):
        _drain_soon(audience, pick)  # anything that waited for a console goes now (each command once)
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
        _front_of(c, b)
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
    ttl = float(settings()["ttlS"])
    with _lock:
        c["queue"], c["loop"], c["lastSeen"] = q, loop, _now()
        if not _ready(c):  # the server restarted (or the tab never said hello): ask for the catalog again
            q.put_nowait({"$axf": "console-hello@1"})
        for at, m in c["pending"]:
            if at > _now() - ttl:
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
        _front_of(c, b)
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
                                  for c in sorted(clients_of(audience), key=lambda x: (not x.get("front", True), -x["lastUsed"]))]}


@router.get("/recent")
def recent(request: Request, n: int = 20) -> dict[str, Any]:
    _, _, audience = caller(request)
    return {"ok": True, "items": [r for r in list(_recent) if r["audience"] == audience][: max(1, min(n, 50))]}


@router.get("/queue")
def queue(request: Request) -> dict[str, Any]:
    _, _, audience = caller(request)
    return {"ok": True, "items": queued_for(audience)}


@router.get("/settings")
def get_settings(request: Request) -> dict[str, Any]:
    _, _, audience = caller(request)
    return {"ok": True, "settings": settings(), "owner": audience == OWNER, "browsers": list(BROWSERS)}


@router.post("/settings")
async def set_settings(request: Request) -> dict[str, Any]:
    _, _, audience = caller(request)
    if audience != OWNER:
        raise HTTPException(403, "only the console's owner changes the console commands settings")
    b = await _body(request)
    return {"ok": True, "settings": save_settings({k: b[k] for k in DEFAULTS if k in b})}


# ---------------------------------------------------------------------- routes: commands

@router.post("")
@router.post("/")
async def any_command(request: Request) -> JSONResponse:
    return await go(request, await _body(request))


@router.post("/open")
async def open_screen(request: Request) -> JSONResponse:
    b = await _body(request)
    return await go(request, {"op": "act", "target": "console.screens", "path": b.get("screen") or b.get("path") or b.get("q"), "action": "open", **_to(b), **_audit(b)})


@router.post("/dialog")
async def open_dialog(request: Request) -> JSONResponse:
    b = await _body(request)
    action = "close" if b.get("action") == "close" or b.get("close") is True else "open"
    path = b.get("id") or b.get("path") or b.get("q") or ("current" if action == "close" else None)
    return await go(request, {"op": "act", "target": "console.dialogs", "path": path, "action": action, **_to(b, arg=b.get("arg")), **_audit(b)})


@router.post("/settings")
async def open_settings(request: Request) -> JSONResponse:
    b = await _body(request)
    return await go(request, {"op": "act", "target": "console.settings", "path": b.get("tab") or b.get("path") or b.get("q"), "action": "open", **_to(b, anchor=b.get("anchor")), **_audit(b)})


@router.post("/action")
async def run_action(request: Request) -> JSONResponse:
    b = await _body(request)
    cmd = {"op": "act", "target": "console.actions", "path": b.get("id") or b.get("path") or b.get("q"), "action": "run", **_to(b, args=b.get("args")), **_audit(b)}
    if b.get("confirm"):
        cmd["confirm"] = b["confirm"]
    return await go(request, cmd)


@router.post("/back")
@router.post("/home")
@router.post("/close")
async def nav(request: Request) -> JSONResponse:
    b = await _body(request)
    return await go(request, {"op": "act", "target": "console.nav", "path": "here", "action": request.url.path.rstrip("/").rsplit("/", 1)[-1], **_to(b), **_audit(b)})


@router.get("/where")
async def where(request: Request) -> JSONResponse:
    return await go(request, {"op": "get", "target": "console.nav", "path": "here"})


@router.get("/list")
async def list_(request: Request, kind: str = "screens", q: str = "", limit: int = 50, client: str = "") -> JSONResponse:
    target = {"screens": "console.screens", "dialogs": "console.dialogs", "settings": "console.settings", "actions": "console.actions", "clients": "console.clients"}.get(kind, f"console.{kind}")
    select: dict[str, Any] = {k: v for k, v in {"q": q, "client": client}.items() if v}
    if target != "console.clients" or limit != 50:
        select["limit"] = max(1, min(limit, 500))
    return await go(request, {"op": "list", "target": target, **({"select": select} if select else {})})


class ConsoleCommands:
    """console-commands@1 for other plugins (Token control's /api/control hands console.* targets here), the /api/console
    mount and the console's MCP tools."""

    router = router

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER) -> dict[str, Any]:
        return run(command, grants, by, audience)

    def run_for(self, request: Request, command: dict[str, Any]) -> dict[str, Any]:
        return run_for(request, command)

    def queue(self, audience: str = OWNER) -> list[dict[str, Any]]:
        return queued_for(audience)

    def clients(self, audience: str = OWNER) -> list[dict[str, Any]]:
        return [{k: v for k, v in c.items() if k != "catalog"} for c in clients_of(audience)]


plugin_services.provide("console-commands@1", ConsoleCommands(), folder=FOLDER)
