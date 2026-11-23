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
how it got there: `live`, `after retry`, `after reconnect`, `woke via AmberX`, or `queued` (still waiting when the
call returned).

Reliable delivery (console-commands-reliable, Nov 11 2026: commands sat with a sleeping phone tab while the console in
front of Brett had dropped off the list):
  - Only the console proves it is alive: hello, seen (every 15 s and on every wake), ack, opening its stream. The
    server's keep-alive on the stream never counts, since a frozen tab keeps its socket open. Quiet for STALE_S = gone.
  - A beat from a console the server doesn't know with its catalog (a restart) answers `hello: true`, and the console
    says hello again at once, so it never drops off console.clients.
  - A command for the recent console goes to the live console used last; no ack within LIVE_TRY_S → the next live one
    (up to MAX_TRIES), and a console that didn't answer counts as asleep until it beats again. Nobody answered: a
    navigate-only command is queued and AmberX opens the console on the phone straight away; a command that changes
    data is never re-sent (the sleeping tab skips it once it is CONSOLE_LATE_MS old, see consoleMessageLate).
  - The answer is truthful: `status` = delivered (a console acked it), pending (sent or queued, nobody acked yet) or
    failed (a console acked it as not done, or it expired), with `delivery.tried` = the consoles asked in turn.

Straight to the screen (console-open-no-reload, Nov 23 2026: every open on the phone reloaded the console to its home
screen and the screen never opened):
  - A console whose stream is open but whose beat went quiet (the console app's page while its overlay is folded:
    its timers are throttled) is asked first, for QUIET_TRY_S, before anything is queued or the phone is woken. An
    answer is a normal live delivery: no wake, no reload.
  - A queued command is done only when a console acks it. One that was sent and not acked (the page was reloading
    under it) stays queued under the same message id and goes to the next page that says hello; a hello from a new
    page load (`page`) ends the wait on the old one at once.
  - The wake link carries the target (`&axf-open=<address>`), so a page the phone has to load comes up on the
    screen, not at home.
  - A name the console doesn't know yet is asked for again (`console-hello@1` down the stream) and waited for while
    the page is still loading its plugins (CATALOG_YOUNG_WAIT_S), instead of answering "no screen".
  - The call answers fast: DELIVERY_WAIT_S / RETRY_WAIT_S are a few seconds; the answer says what is still pending
    and why. `wait` (seconds, on the REST body or `run(..., wait=)`) asks for longer.

Mounted twice: /api/plugins/console-commands/… (the plugin mount; the console client uses it) and /api/console/…
(the contract path, main.py's CAPABILITY_MOUNTS; console token or a hub admin).

  POST hello {client, app, title, device, catalog, here, used?, page?, shell?}
                                                                   a console announces itself (and its catalog); page = this
                                                                   page load, shell = the app it runs in (console-droid)
  POST seen  {client, here?, used?, working?}                      heartbeat; used = Brett touched that console; working = <command id> it is busy on
  POST bye   {client, page?}                                       the tab closed
  GET  stream?client=<id>&page=<page load>                                       server-sent events: one console-command@1 per `data:`
  POST ack   {client, id, ok, message, here?}                      what the console did with a command
  POST shot?client=<id>&id=<command id>  (image/png body)          a console's screenshot for a screenshot command it was sent
  GET  clients · GET recent · GET queue                           the caller's open consoles · the last commands · what waits
  GET  settings · POST settings {wake, ttlS, browser}              queue + wake settings (the owner changes them)
  POST ""                                                          a whole control@1 command of the console domain
  POST open {screen} · dialog {id, arg?} (close: {"action": "close", id?}) · settings {tab, anchor?} · action {id, args?, confirm?} · back · home · close · refresh {hard?}
       · screenshot {selector?, address?}   (each takes `to`)

Screenshots (console.nav act screenshot): the console captures what it shows as a PNG (at most 1600 px wide), uploads it
to `shot` and acks with the screen state. The answer carries `images` [{client, mime, data (base64), bytes, width,
height}] and `state` (screen, tabs, dialog, selection, scroll). An upload lives in a temp folder (AXF_CONSOLE_SHOT_DIR,
default <tmp>/axf-console-shots) only until the answer reads it, and is swept after SHOT_TTL_S whatever happens.
A capture takes seconds, so the console says `seen {working: <id>}` as soon as it gets one and then has SHOT_WORK_S to ack
before the next console is tried; an ack that lands after the call moved on (a late ack) still brings its image back.
  GET  where · GET list?kind=screens|dialogs|settings|actions&q=…&limit=…

Capability console-commands@1: plugin_services.get("console-commands@1").run(command, grants=[…], by="…", audience="owner").
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import re
import subprocess
import tempfile
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote, urlsplit

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
STALE_S = 45.0          # = CONSOLE_CLIENT_STALE_MS in core/engines/console-commands.mjs
ACK_RESULT_MAX = 256_000  # bytes of a console-control answer kept from an ack (search hits, a long target list)
KEEPALIVE_S = 15.0      # a comment down every stream this often (the client drops a stream silent for 45 s)
LIVE_TRY_S = 2.5        # how long one live console gets to ack before the next live one is tried
QUIET_TRY_S = 2.0       # how long a console with an open stream but no recent beat gets before the phone is woken
MAX_TRIES = 3           # live consoles tried in turn for one command
LATE_ACK_S = 120.0      # how long an unanswered command still records a late ack
ACK_WAIT_S = 10.0       # how long an answer waits for the consoles to say what they did (4 s was too short on a
                        # busy VPS: the ack itself queued behind other requests, Nov 3 2026)
CATALOG_MAX_BYTES = 1_500_000
OWNER = "owner"
DELIVERY_WAIT_S = 4.0   # how long a call waits for a queued (or reconnecting) command to reach a console; the
                        # command stays queued after the call answered (Brett, Nov 23 2026: opens hung 20 to 45 s)
RECONNECT_WAIT_S = 60.0  # how long a message held for a console whose stream is reconnecting waits for its ack
MAX_WAIT_S = 60.0       # the longest `wait` a caller may ask for
WAKE_AFTER_S = 1.0      # no console connected this long after queuing → ask AmberX to open one
RETRY_WAIT_S = 3.0      # after every live console was tried and the command was queued, how long the call waits
CATALOG_WAIT_S = 2.0    # a name the console doesn't know: how long its fresh catalog is waited for
CATALOG_YOUNG_WAIT_S = 8.0  # the same while the page is still loading (its plugins add their screens one by one)
YOUNG_S = 30.0          # a page counts as still loading this long after its first hello
FALLBACK_KEY = "console:wake-fallback"
WAKE_AGAIN_S = 45.0     # one wake per this long per user (Chrome takes a moment to open)
CONSOLE_URL = (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")
DATA_DIR = Path(os.environ.get("AXF_CONSOLE_COMMANDS_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
DEFAULTS: dict[str, Any] = {"wake": True, "ttlS": 120, "browser": "chrome"}
SHOT_DIR = Path(os.environ.get("AXF_CONSOLE_SHOT_DIR") or Path(tempfile.gettempdir()) / "axf-console-shots")
SHOT_MAX_BYTES = 4_000_000  # = CONSOLE_SHOT_MAX_BYTES in core/engines/console-commands.mjs
SHOT_TTL_S = 120.0          # = CONSOLE_SHOT_TTL_MS: an upload nobody read is deleted after this
SHOT_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,80}$")
# A capture takes longer than a navigation (clone, draw, encode, upload): a console that said it is working on a
# screenshot (`seen` with `working: <id>`) gets this long to ack before the next console is tried. It is longer than the
# console's own capture time limit (CAPTURE_TIMEOUT_MS in web/capture.ts), so a working console always answers in time.
SHOT_WORK_S = 30.0
SHOT_ACK_WAIT_S = 30.0      # how long a screenshot sent to every console (to="all") or from the queue waits for acks
PNG_MAGIC = b"\x89PNG\r\n\x1a\n"
BROWSERS = ("chrome", "default")

_lock = threading.Lock()
_clients: dict[str, dict[str, Any]] = {}
_acks: dict[str, dict[str, Any]] = {}
_recent: deque[dict[str, Any]] = deque(maxlen=50)
_queue: list[dict[str, Any]] = []            # commands that found no console: {id, audience, command, grants, by, at, expires, state, …}
_catalogs: dict[str, dict[str, Any]] = {}    # the last catalog each audience's console sent (checks a queued command early)
_draining: set[str] = set()
_woke_at: dict[str, float] = {}
_late: dict[str, dict[str, Any]] = {}      # message id → {entry, at}: commands nobody answered in time (a late ack lands here)
_hello_cv = threading.Condition(_lock)     # told on every hello (a catalog arrived)
_hello_seq: dict[str, int] = {}            # audience → how many hellos so far
_drain_again: set[str] = set()             # a console said hello while its audience's queue was being delivered
PAGE_RE = re.compile(r"^[A-Za-z0-9_-]{4,40}$")
ADDRESS_ID_RE = re.compile(r"^[A-Za-z0-9._-]{1,120}$")


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
    return {"id": c["id"], "app": c.get("app", "console-web"), **({"host": c["host"]} if c.get("host") else {}), "front": c.get("front", True),
            **({"shell": c["shell"]} if c.get("shell") else {}), "title": c.get("title", ""), "device": c.get("device", ""), "user": c.get("user", ""),
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
    stream is open, up to RECONNECT_WAIT_S when it is reconnecting (the message goes down as soon as it is back). A
    hello from a new page load of a console ends the wait on its old page (`_new_page`)."""
    mid = str(message.get("id") or "")
    ev = threading.Event()
    with _lock:
        targets = [_clients[t] for t in to if t in _clients and _clients[t]["audience"] == audience]
        _acks[mid] = {"event": ev, "want": {c["id"] for c in targets}, "results": {}}
        live = [_push(c, message) for c in targets]
    if targets:
        ev.wait(wait if all(live) else max(wait, RECONNECT_WAIT_S))
    with _lock:
        a = _acks.pop(mid, {"results": {}})
    out = []
    for c, was_live in zip(targets, live):
        r = a["results"].get(c["id"])
        if r and not was_live:
            r = {**r, "afterReconnect": True}
        out.append(r if r else {"client": c["id"], "ok": False, "pending": True, "message": "sent; the console didn't answer yet (it runs it when the tab wakes)"})
    return out


def _live(c: dict[str, Any], now: float | None = None) -> bool:
    """Proved alive lately (by the console itself) and its stream is open."""
    return c.get("queue") is not None and (now or _now()) - c["lastSeen"] <= STALE_S


def _quiet(c: dict[str, Any], now: float | None = None) -> bool:
    """Its stream is open but its beat went quiet, and it has not been asked in vain since: a page that is still there
    with throttled timers (the console app's page while the overlay is folded) answers a command at once; a frozen one
    doesn't, and is not asked again until it beats."""
    return c.get("queue") is not None and _ready(c) and not _live(c, now) and float(c.get("missed") or 0) <= c["lastSeen"]


def quiet_clients(audience: str) -> list[dict[str, Any]]:
    """The audience's quiet consoles as the runner sees live ones (in front first, used last first)."""
    now = _now()
    with _lock:
        cs = [c for c in _clients.values() if c["audience"] == audience and _quiet(c, now)]
        cs.sort(key=lambda c: (c.get("front", True) is False, -float(c.get("lastUsed") or 0)))
        return [{**_public(c), "lastSeen": int(now * 1000)} for c in cs]


def _turn_order(audience: str, first: str, app: str) -> list[str]:
    """The consoles to try for a `recent` command: the runner's pick, then every other live, ready console of the same
    app, in front first, used last first. Only consoles with an open stream (a push can reach them now)."""
    now = _now()
    with _lock:
        cs = [c for c in _clients.values() if c["audience"] == audience and _ready(c) and _live(c, now) and c.get("app", "console-web") == app]
        f = _clients.get(first)
        head = [first] if f is not None and f["audience"] == audience and f.get("queue") is not None else []
    cs.sort(key=lambda c: (c.get("front", True) is False, -float(c.get("lastUsed") or 0)))
    return (head + [c["id"] for c in cs if c["id"] != first])[:MAX_TRIES]


def _working(mid: str, cid: str) -> bool:
    with _lock:
        return cid in ((_acks.get(mid) or {}).get("working") or ())


def try_in_turn(ids: list[str], message: dict[str, Any], audience: str, each: float | None = None, work: float = 0.0) -> tuple[list[str], dict[str, dict[str, Any]]]:
    """Send to one console at a time until one acks. A console that doesn't answer within `each` seconds counts as
    asleep (out of `recent`) until it beats again, unless it said it is working on the command (a screenshot): then it
    gets up to `work` seconds more. → (the consoles asked, their acks by client id)."""
    each = LIVE_TRY_S if each is None else each  # read at call time (a default argument froze it at import)
    mid = str(message.get("id") or "")
    ev = threading.Event()
    with _lock:
        _acks[mid] = {"event": ev, "want": set(), "results": {}, "any": True, "working": set()}
    tried: list[str] = []
    for cid in ids:
        with _lock:
            c = _clients.get(cid)
            if c is None or c["audience"] != audience or c.get("queue") is None:
                continue
            _acks[mid]["want"].add(cid)
            _push(c, message)
        tried.append(cid)
        if ev.wait(each):
            break
        if work > 0 and _working(mid, cid) and ev.wait(work):
            break
        with _lock:
            c["lastSeen"] = min(c["lastSeen"], _now() - STALE_S - 1)
            c["missed"] = _now()
    with _lock:
        a = _acks.get(mid) or {"results": {}}
        results = dict(a["results"])
        if results or not tried:
            _acks.pop(mid, None)
        else:  # nobody answered: keep listening, a late ack is recorded (and stops a queued copy)
            _late[mid] = {"entry": None, "at": _now(), "audience": audience}
    return tried, results


def _late_prune() -> None:
    cut = _now() - LATE_ACK_S
    with _lock:
        for mid in [k for k, v in _late.items() if v["at"] < cut]:
            _late.pop(mid, None)
            _acks.pop(mid, None)


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


def open_address(command: dict[str, Any], r: dict[str, Any]) -> str:
    """The console-control@1 address a resolved open lands on (`view:<id>`, a settings tab or sub-tab), or "" for what
    has none (dialogs, actions, moves). It rides on the wake link, so a page the phone loads comes up on the screen."""
    if command.get("op") != "act" or command.get("action") != "open":
        return ""
    item = r.get("item") or ((r.get("data") or {}).get("item") if isinstance(r.get("data"), dict) else None)
    if not isinstance(item, dict):
        return ""
    iid, kind, parent = str(item.get("id") or ""), item.get("kind"), str(item.get("parent") or "")
    if kind == "field":  # a single setting: its tab
        iid, parent, kind = parent, "", "settings"
    if not ADDRESS_ID_RE.match(iid) or (parent and not ADDRESS_ID_RE.match(parent)):
        return ""
    if kind == "screen" and command.get("target") == "console.screens":
        return f"view:{iid}"
    if kind == "settings" and command.get("target") == "console.settings":
        return f"view:settings/tab:settings.tabs={parent}/subtab:settings.subtabs={iid}" if parent else f"view:settings/tab:settings.tabs={iid}"
    return ""


def wake_link(cid: str, address: str = "") -> str:
    """The link a wake opens: the console, the queued command it is for, and where that command lands."""
    return f"{CONSOLE_URL}/?axf-cmd={cid}" + (f"&axf-open={quote(address, safe=':/=.,_-')}" if address else "")


def _fallback_alert(entry: dict[str, Any], why: str) -> None:
    """The phone can't be reached right now: a console alert AmberX's watch reads, whose tap opens the console."""
    try:
        import console_context as cx
        cx.raise_alert({"source": "console", "severity": "warning", "key": FALLBACK_KEY, "title": "Tap to open the Dev Console", "body": f"Amber has something to show you. {why}"[:300],
                        "link": wake_link(entry["id"], str(entry.get("open") or "")), "meta": {"label": "Dev Console"}})
    except Exception:  # noqa: BLE001 — the command stays queued either way
        pass


def _fallback_clear() -> None:
    try:
        import console_context as cx
        cx.resolve_alerts([FALLBACK_KEY])
    except Exception:  # noqa: BLE001
        pass


def _wake_later(entry: dict[str, Any], after: float | None = None) -> None:
    """WAKE_AFTER_S after queuing (`after`: 0 when every live console was already tried): still no console → open one
    on the owner's phone (once per WAKE_AGAIN_S)."""
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
            r = WAKER(wake_link(entry["id"], str(entry.get("open") or "")), st["browser"])
        except Exception as e:  # noqa: BLE001 — a failed wake leaves the command queued; the answer says why
            r = {"ok": False, "message": str(e)[:300]}
        entry["wake"] = {"sent": bool(r.get("ok")), "opened": r.get("opened") is True, "notified": r.get("notified") is True, "how": str(r.get("how") or "")[:40], "message": str(r.get("message") or "")[:300],
                         "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
        if not r.get("ok"):
            with _lock:
                _woke_at.pop(audience, None)
        if not r.get("ok") or not (r.get("opened") or r.get("notified")):
            _fallback_alert(entry, str(r.get("message") or ""))

    t = threading.Timer(WAKE_AFTER_S if after is None else after, go)
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


def _enqueue(command: dict[str, Any], grants: list[str], by: str, audience: str, wake_after: float | None = None, tried: list[str] | None = None,
             open_at: str = "") -> dict[str, Any]:
    """Queue a command for the next console that says hello. `open_at`: the address it lands on (for the wake link)."""
    ttl = float(settings()["ttlS"])
    e = {"id": f"cq-{int(_now() * 1000):x}-{os.urandom(3).hex()}", "audience": audience, "command": command, "grants": grants, "by": by,
         "at": _now(), "expires": _now() + ttl, "state": "queued", "event": threading.Event(), "result": None, "wake": None, "picked": False, "tried": list(tried or []),
         "open": open_at, "message": None, "sent": 0}
    with _lock:
        _queue.append(e)
    _wake_later(e, wake_after)
    return e


def queue_for_owner(command: dict[str, Any], grants: list[str], by: str) -> dict[str, Any]:
    """Queue a navigate-only command for the next console that opens, and wake one: for a console that is connected but
    never answered (a frozen phone tab). Never for anything that changes data: the frozen tab may still run its copy."""
    return _enqueue({k: v for k, v in command.items() if v not in (None, "")}, grants, by, OWNER)


def queued_for(audience: str) -> list[dict[str, Any]]:
    _expire()
    with _lock:
        return [{"id": e["id"], "state": e["state"], "at": _iso(e["at"]), "expiresAt": _iso(e["expires"]), "target": e["command"].get("target"),
                 "path": e["command"].get("path"), "action": e["command"].get("action"), "by": e["by"], "wake": e["wake"]}
                for e in _queue if e["audience"] == audience]


def _how(e: dict[str, Any]) -> str:
    # only the console that opened from the wake link proves the wake; the phone's own yes never does
    return "woke via AmberX" if e["picked"] else "after reconnect"


def drain(audience: str, pick: str = "") -> None:
    """A console of this audience said hello: deliver its queued commands, oldest first. A command is done when a
    console acks it; one that was sent and not acked (the page was going away under it) stays queued, under the same
    message id, for the next page that says hello, so it is never lost and never run twice by one page."""
    _expire()
    with _lock:
        if pick:
            for e in _queue:
                if e["id"] == pick and e["audience"] == audience:
                    e["picked"] = True
        if audience in _draining:
            _drain_again.add(audience)  # the delivery under way looks again when it is done
            return
        _draining.add(audience)
    try:
        held: set[str] = set()  # sent in this pass and not acked: left for the next hello
        while True:
            with _lock:
                if audience in _drain_again:
                    _drain_again.discard(audience)
                    held.clear()  # a console said hello meanwhile: what was not acked goes to it
                e = next((x for x in _queue if x["audience"] == audience and x["state"] == "queued" and x["id"] not in held), None)
                if e is None:
                    return
                if not any(_ready(c) and c["audience"] == audience for c in _clients.values()):
                    return
                e["state"] = "delivering"  # nobody else takes it, even if two consoles say hello
            r = _resolve(e["command"], e["grants"], e["by"], audience)
            d = r.pop("deliver", None)
            if not r.get("ok") and r.get("noConsole"):
                with _lock:  # the console went away again before it could take it
                    e["state"] = "queued" if e["expires"] > _now() else "expired"
                    if e["state"] == "expired":
                        e["event"].set()
                return
            if r.get("ok") and isinstance(d, dict):
                # the same message every time it is sent, so a page that already ran it only acks it again
                message = e["message"] or {**(d.get("message") or {}), "delivery": "woke" if _how(e) == "woke via AmberX" else "queued"}
                e["message"] = message
                e["sent"] += 1
                r["sent"] = message
                r["delivered"] = deliver([str(x) for x in d.get("to") or []], message, audience, wait=SHOT_ACK_WAIT_S if _is_shot(e["command"]) else ACK_WAIT_S)
            r["delivery"] = {"how": _how(e), "id": e["id"], "queuedFor": round(_now() - e["at"], 1), **({"tried": e["tried"]} if e.get("tried") else {}), **({"wake": e["wake"]} if e["wake"] else {})}
            r["status"] = _status_of(r)
            if r["status"] == "pending" and e["expires"] > _now():
                with _lock:
                    e["result"], e["state"] = r, "queued"
                held.add(e["id"])
                continue
            with _lock:
                e["result"], e["state"] = r, "delivered" if r.get("ok") else "failed"
            e["event"].set()
            _log(e["command"], r, e["by"], audience)
            _fallback_clear()
    finally:
        with _lock:
            _draining.discard(audience)
            again = audience in _drain_again
            _drain_again.discard(audience)
        if again and _has_queued(audience):
            _drain_soon(audience)


def _has_queued(audience: str) -> bool:
    with _lock:
        return any(e["audience"] == audience and e["state"] == "queued" for e in _queue)


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


def _catalog_miss(command: dict[str, Any], r: dict[str, Any]) -> bool:
    """The console is there but its catalog has no such name (rather than: no console, or several matches)."""
    return (not r.get("ok") and r.get("code") == "not_found" and not r.get("noConsole")
            and command.get("op") in ("act", "get") and command.get("target") in ("console.screens", "console.dialogs", "console.settings", "console.actions"))


def _young(audience: str) -> bool:
    """A console of this audience that can answer is still loading: its page said its first hello less than YOUNG_S ago."""
    now = _now()
    with _lock:
        return any(c["audience"] == audience and now - float(c.get("born") or 0) < YOUNG_S and (_live(c, now) or _quiet(c, now)) for c in _clients.values())


def _ask_catalog(audience: str) -> int:
    """Ask the audience's consoles that can answer (live, or quiet with an open stream) to send their catalog now.
    → how many were asked."""
    n, now = 0, _now()
    with _lock:
        for c in _clients.values():
            if c["audience"] == audience and c.get("queue") is not None and c.get("loop") is not None and (_live(c, now) or _quiet(c, now)):
                c["loop"].call_soon_threadsafe(c["queue"].put_nowait, {"$axf": "console-hello@1"})
                n += 1
    return n


def _resolve(command: dict[str, Any], grants: list[str], by: str, audience: str, clients: Callable[[], list[dict[str, Any]]] | None = None) -> dict[str, Any]:
    """Run the command through the runner against the audience's consoles. A name the console doesn't know may only be
    missing from the catalog the server holds (a page says hello before its plugins have added their screens, and the
    next catalog used to come with the next beat): the console is asked for its catalog now and the command is looked
    up again when it arrives, for CATALOG_WAIT_S, or CATALOG_YOUNG_WAIT_S while the page is still loading."""
    clients = clients or (lambda: ready_clients(audience))
    r = _runner(command, grants, by, clients())
    if not _catalog_miss(command, r):
        return r
    start = _now()
    while True:
        end = start + (CATALOG_YOUNG_WAIT_S if _young(audience) else CATALOG_WAIT_S)
        with _hello_cv:
            seq = _hello_seq.get(audience, 0)
        if not _ask_catalog(audience):
            return r
        with _hello_cv:
            arrived = _hello_cv.wait_for(lambda: _hello_seq.get(audience, 0) != seq, timeout=max(0.0, min(end - _now(), CATALOG_WAIT_S)))
        if not arrived:
            return r
        r = _runner(command, grants, by, clients())
        if not _catalog_miss(command, r) or not _young(audience) or _now() >= end:
            return r
        time.sleep(min(0.7, max(0.0, end - _now())))  # still loading: its next plugins get a moment


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


def _status_of(r: dict[str, Any]) -> str:
    """delivered = a console acked it as done; failed = refused, acked as not done, or expired; pending = nobody acked yet."""
    if not r.get("ok") and not r.get("queued"):
        return "failed"
    acks = [x for x in r.get("delivered") or [] if isinstance(x, dict)]
    if any(x.get("ok") for x in acks):
        return "delivered"
    if any(not x.get("ok") and not x.get("pending") for x in acks):
        return "failed"
    return "pending"


def _navigates(command: dict[str, Any], r: dict[str, Any]) -> bool:
    """Only moves the console (safe to queue and carry out on another console later)."""
    t = command.get("target")
    if t in ("console.screens", "console.settings", "console.dialogs", "console.nav"):
        return True
    return t == "console.actions" and (r.get("data") or {}).get("effect") == "navigate"


# Items another plugin knows by name (a build id) open on that plugin's screen, focused on the item: the capability
# console-focus@1 (provided by the plugin that owns the screen) turns a path into {screen, focus}. `<kind>:<name>` is
# always that plugin's; a bare name only when it is no screen's exact id.
def _focus_provider() -> Any | None:
    return plugin_services.get("console-focus@1")


def focus_rewrite(command: dict[str, Any], audience: str) -> dict[str, Any]:
    """`build:<id>` (or a bare build id that is no screen's id) on console.screens → the screen that lists it, focused on
    it: the console opens its tab, scrolls the row into view, expands and highlights it."""
    if command.get("target") != "console.screens" or command.get("op") not in ("act", "get"):
        return command
    svc = _focus_provider()
    path = str(command.get("path") or "").strip()
    if svc is None or not path:
        return command
    try:
        hit = svc.resolve(path)
    except Exception:  # noqa: BLE001 — a broken provider never stops a plain screen command
        hit = None
    if not isinstance(hit, dict) or not hit.get("screen") or not hit.get("focus"):
        return command
    if not hit.get("explicit"):
        screens = {str(i.get("id") or "").lower() for c in ready_clients(audience)[:1] for i in (c.get("catalog") or {}).get("items") or [] if i.get("kind") == "screen"}
        if path.lower() in screens:
            return command
    inp = dict(command.get("input") or {}) if isinstance(command.get("input"), dict) else {}
    inp.setdefault("focus", str(hit["focus"]))
    return {**command, "path": str(hit["screen"]), "input": inp}


def run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER, wait: float | None = None) -> dict[str, Any]:
    """One console command for a caller → the control@1 answer, with `delivered` (the consoles' acks), `delivery` (how it
    got there, which consoles were tried) and `status` (delivered / pending / failed) on a sent command. No console
    connected: queued, and the call waits up to `wait` seconds. A screenshot answer also carries `images` and `state`."""
    r = _run(command, grants, by, audience, wait)
    # every way a screenshot can come back (live, after retry, a late ack, from the queue) carries the image
    return attach_shots(r) if _is_shot(command or {}) and (r.get("sent") or r.get("delivered")) else r


def _run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", audience: str = OWNER, wait: float | None = None) -> dict[str, Any]:
    command = {k: v for k, v in (command or {}).items() if v not in (None, "")}
    grants = grants if grants is not None else ["*"]
    by = by or str(command.get("by") or "")
    if command.get("target") == "console.control":
        return control_target(command, grants, by, audience)
    if command.get("target") == "console.pluginsettings":
        return plugin_settings_target(command, grants, by, audience)
    if command.get("target") == "console.toolbars":
        return toolbars_target(command, grants, by, audience)
    command = focus_rewrite(command, audience)
    _late_prune()
    r = _resolve(command, grants, by, audience)
    if _queueable(command, r):
        out = _run_quiet(command, grants, by, audience, wait) if _to_of(command) == "recent" else None
        if out is None:
            out = _run_queued(command, grants, by, audience, DELIVERY_WAIT_S if wait is None else wait)
            out["status"] = _status_of(out)
        return out
    r = _send(command, grants, by, audience, r, wait)
    _log(command, r, by, audience)
    return r


def _send(command: dict[str, Any], grants: list[str], by: str, audience: str, r: dict[str, Any], wait: float | None,
          order: list[str] | None = None, each: float | None = None) -> dict[str, Any]:
    """Send a resolved command to its consoles and add what they answered. `order`: the consoles to ask in turn (the
    quiet ones); without it a command for the recent console asks the live ones in turn."""
    d = r.pop("deliver", None)
    if not (r.get("ok") and isinstance(d, dict)):
        return r
    message = d.get("message") or {}
    to = [str(x) for x in d.get("to") or []]
    r["sent"] = message
    recent = _to_of(command) == "recent" and len(to) == 1
    if recent and order is None:
        first = _clients.get(to[0]) or {}
        order = _turn_order(audience, to[0], str(first.get("app") or "console-web"))
    if recent and order:
        tried, acks = try_in_turn(order, message, audience, each=each, work=SHOT_WORK_S if _is_shot(command) else 0.0)
        r["delivered"] = [acks[c] if c in acks else {"client": c, "ok": False, "pending": True, "message": "didn't answer (asleep?)"} for c in tried]
        who = next((c for c in tried if c in acks), "")
        r["delivery"] = {"how": "live" if who and who == tried[0] else "after retry" if who else "pending", "tried": tried, **({"client": who} if who else {})}
        if not who:
            r = _nobody_answered(command, grants, by, audience, r, tried, message, RETRY_WAIT_S if wait is None else wait)
    else:
        r["delivered"] = deliver(to, message, audience, wait=SHOT_ACK_WAIT_S if _is_shot(command) else ACK_WAIT_S)
        r["delivery"] = {"how": "after reconnect" if r["delivered"] and all(x.get("afterReconnect") for x in r["delivered"] if x.get("ok")) and any(x.get("ok") for x in r["delivered"]) else "live"}
    r["status"] = _status_of(r)
    if r["status"] == "pending" and not r.get("queued"):
        r["message"] = r.get("message") or "sent, but no console answered yet"
    return r


def _run_quiet(command: dict[str, Any], grants: list[str], by: str, audience: str, wait: float | None) -> dict[str, Any] | None:
    """No console beat lately, but one still holds its stream open (the console app's page with its overlay folded):
    ask it before anything is queued or the phone is woken. It answers → a live delivery, no reload. It doesn't → the
    command is queued and the phone is asked at once (`_nobody_answered`). None: there is no such console."""
    quiet = quiet_clients(audience)
    if not quiet:
        return None
    r = _resolve(command, grants, by, audience, lambda: quiet_clients(audience) or quiet)
    if r.get("noConsole"):
        return None
    app = str(quiet[0].get("app") or "console-web")
    order = [c["id"] for c in quiet if str(c.get("app") or "console-web") == app][:MAX_TRIES]
    r = _send(command, grants, by, audience, r, wait, order=order, each=QUIET_TRY_S)
    _log(command, r, by, audience)
    return r


def _to_of(command: dict[str, Any]) -> str:
    inp = command.get("input")
    return str((inp or {}).get("to") or "recent") if isinstance(inp, dict) else "recent"


def _nobody_answered(command: dict[str, Any], grants: list[str], by: str, audience: str, r: dict[str, Any], tried: list[str], message: dict[str, Any], wait: float) -> dict[str, Any]:
    """Every live console was asked and none answered. A navigate-only command waits for the next console and AmberX
    opens one now; anything else is not re-sent (it may still run if the sleeping tab wakes within CONSOLE_LATE_MS)."""
    mid = str(message.get("id") or "")
    if not _navigates(command, r):
        return {**r, "ok": False, "code": "not_found", "status": "failed",
                "message": f"no console answered (tried {', '.join(tried)}); it was not re-sent because it changes data. Open the console and send it again"}
    e = _enqueue(command, grants, by, audience, wake_after=0.0, tried=tried, open_at=open_address(command, r))
    with _lock:
        if mid in _late:
            _late[mid]["entry"] = e
    if any(_ready(c) and _live(c) and c["id"] not in tried for c in _clients.values() if c["audience"] == audience):
        _drain_soon(audience)
    e["event"].wait(max(0.0, min(wait, e["expires"] - _now())))
    with _lock:
        state, result = e["state"], e["result"]
    if state in ("delivered", "failed") and result is not None:
        # a late ack answers for the message that was sent live (a screenshot's upload is filed under its id)
        return result if result.get("sent") else {**result, "sent": message}
    waiting = state in ("queued", "delivering")
    out = {**r, "ok": waiting, "queued": waiting,
           "delivery": {"how": "queued" if waiting else state, "id": e["id"], "tried": tried, "expiresAt": _iso(e["expires"]), **({"wake": e["wake"]} if e["wake"] else {})}}
    if waiting:
        out["message"] = (f"not shown yet: no open console answered (tried {', '.join(tried)}). It stays queued and opens the moment a console answers (until {_iso(e['expires'])})"
                          + (f"; {e['wake']['message']}" if e["wake"] else "; the phone is asked to open the console there"))
    else:
        out.update({"code": "not_found", "message": "no console opened before the command expired"})
    return out


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
    e = _enqueue(command, grants, by, audience, open_at=open_address(command, pre or {}))
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
        out["message"] = (f"not shown yet: no console is open. It stays queued and opens the moment one is (until {_iso(e['expires'])})"
                          + (f"; {e['wake']['message']}" if e["wake"] else "; the phone is asked to open the console there"))
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


def control(command: dict[str, Any], by: str = "", audience: str = OWNER, to: str = "recent") -> dict[str, Any]:
    """A console-control@1 command (spec/CONSOLE-CONTROL.md) for the open console: sent as console-command@1 op
    `control`, answered with the console's own envelope (result + live state) and `client` / `delivery`. Nothing is
    queued: no console open answers `unavailable` with `openUrl` (open the console, then send it again)."""
    mid = "ctl-" + os.urandom(8).hex()
    message = {"$axf": "console-command@1", "id": mid, "op": "control", "command": command, "by": by or "api", "at": _iso(_now())}
    now = _now()
    with _lock:
        live = [c for c in _clients.values() if c["audience"] == audience and _ready(c) and _live(c, now)]
        if not live:  # none beat lately: one that still holds its stream open (a folded overlay's page) is asked
            live = [c for c in _clients.values() if c["audience"] == audience and _quiet(c, now)]
            quiet = bool(live)
        else:
            quiet = False
    live.sort(key=lambda c: (c.get("front", True) is False, -float(c.get("lastUsed") or 0)))
    no_console = {"$axf": "console-control@1", "ok": False, "code": "unavailable", "because": "no console open",
                  "message": "no console open: open the console (openUrl), then send the command again", "openUrl": CONSOLE_URL + "/"}
    if to == "all":
        if not live:
            return no_console
        acks = deliver([c["id"] for c in live], message, audience)
        results = [a.get("result") or {"ok": False, "code": "unavailable", "message": a.get("message") or "no answer", "client": a.get("client")} for a in acks]
        return {"$axf": "console-control@1", "ok": any(r.get("ok") for r in results), "verb": command.get("verb"), "results": results, "delivery": {"how": "all", "clients": [c["id"] for c in live]}}
    if to != "recent":
        with _lock:
            c = _clients.get(to)
            ok = c is not None and c["audience"] == audience and c.get("queue") is not None
        if not ok:
            return {**no_console, "code": "not_found", "message": f"no open console {to} (GET /api/console/clients lists them)"}
        order = [to]
    else:
        if not live:
            return no_console
        app = str(live[0].get("app") or "console-web")
        order = [c["id"] for c in live if str(c.get("app") or "console-web") == app][:MAX_TRIES] if quiet else _turn_order(audience, live[0]["id"], app)
    tried, acks = try_in_turn(order, message, audience, each=QUIET_TRY_S if quiet else None)
    with _lock:
        _late.pop(mid, None)  # a control command is never queued: a late ack has nothing to stop
    who = next((c for c in tried if c in acks), "")
    if not who:
        return {**no_console, "message": f"no console answered (tried {', '.join(tried)}): open the console (openUrl), then send the command again", "tried": tried}
    a = acks[who]
    res = a.get("result") if isinstance(a.get("result"), dict) else {"$axf": "console-control@1", "ok": bool(a.get("ok")), **({} if a.get("ok") else {"code": "unexpected"}), "message": a.get("message") or ""}
    out = {**res, "client": who, **({"shell": a["shell"]} if a.get("shell") else {}), **({"surfaced": True} if a.get("surfaced") else {}),
           "delivery": {"how": "live" if who == tried[0] else "after retry", "tried": tried}}
    _recent.appendleft({"at": _iso(_now()), "by": by or "api", "target": "console.control", "path": command.get("address") or "", "action": command.get("verb"), "ok": bool(out.get("ok")),
                        "code": out.get("code", ""), "message": out.get("message", ""), "audience": audience, "how": out["delivery"]["how"], "delivered": [{"client": who, "ok": bool(out.get("ok")), "message": a.get("message", "")}]})
    return out


CONTROL_VERBS = ("open", "state", "press", "set", "scroll", "focus", "search", "list", "plugin.enable", "plugin.disable")


def control_target(command: dict[str, Any], grants: list[str], by: str, audience: str) -> dict[str, Any]:
    """control@1 `console.control` (core/engines/control-rules.mjs): list / get / act <verb> on a console-control@1 address,
    through the console server's console-control guards (permission, policy tag, rate limit, audit)."""
    import console_control_api as api  # the console server's /api/console-control half
    op, path = str(command.get("op") or ""), str(command.get("path") or "")
    inp = command.get("input") if isinstance(command.get("input"), dict) else {}
    if op == "list":
        sel = command.get("select") if isinstance(command.get("select"), dict) else {}
        kinds = [k for k in str(sel.get("kinds") or "").split(",") if k] or None
        r = api.targets(path, kinds, str(sel.get("source") or "auto"), by or "control", audience, set(grants))
    elif op in ("get", "act"):
        verb = "state" if op == "get" else str(command.get("action") or "")
        if verb not in CONTROL_VERBS:
            return {"$axf": "control@1", "ok": False, "code": "invalid", "message": f"console.control act takes one of {', '.join(CONTROL_VERBS)}"}
        body = {"verb": verb, **({"address": path} if path else {}), **{k: inp[k] for k in ("value", "options", "scroll", "query", "reason") if k in inp}}
        if inp.get("confirm") or command.get("confirm"):
            body["confirm"] = True
        r = api.command({**body, "to": str(inp.get("to") or "recent")}, by or "control", audience, set(grants))
    else:
        return {"$axf": "control@1", "ok": False, "code": "invalid", "message": "console.control takes list, get or act"}
    out = {"$axf": "control@1", "ok": bool(r.get("ok")), "target": "console.control", "op": op, **({"path": path} if path else {}), "data": r}
    if not r.get("ok"):
        out.update({k: r[k] for k in ("code", "message", "openUrl") if k in r})
    _recent.appendleft({"at": _iso(_now()), "by": by, "target": "console.control", "path": path, "action": command.get("action") or op, "ok": out["ok"],
                        "code": out.get("code", ""), "message": out.get("message", ""), "audience": audience, "how": "control@1", "delivered": []})
    return out


def plugin_settings_target(command: dict[str, Any], grants: list[str], by: str, audience: str) -> dict[str, Any]:
    """control@1 `console.pluginsettings` (core/engines/control-rules.mjs): one plugin's Settings → Plugins sub-tab and
    the gear on its screen. get = the state REST answers at /api/console-control/plugins/<id>/settings; act open / set /
    enable / disable run through the console-control guards like console.control."""
    import console_control as cc  # the console server's console-control half
    import console_control_api as api
    op, path = str(command.get("op") or ""), str(command.get("path") or "")
    inp = command.get("input") if isinstance(command.get("input"), dict) else {}
    try:
        if op == "list":
            items = [cc.plugin_state(p) | {"settingsTab": p.get("settingsTab"), "settingsGear": p.get("settingsGear")} for p in cc.inventory().get("plugins", []) or [] if p.get("settingsTab")]
            lim = int((command.get("select") or {}).get("limit") or 0) if isinstance(command.get("select"), dict) else 0
            r: dict[str, Any] = {"ok": True, "items": items[:lim] if lim > 0 else items}
        elif op == "get":
            r = cc.plugin_settings_state(path)
        elif op == "act":
            st = cc.plugin_settings_state(path)
            action = str(command.get("action") or "")
            if action == "open":
                if not st.get("tab"):
                    raise cc.ControlError("not_found", f"{st.get('label')} has no settings sub-tab")
                body: dict[str, Any] = {"verb": "open", "address": st["tab"]["address"]}
            elif action == "set":
                key = str(inp.get("key") or "")
                spec = next((x for x in st.get("settings") or [] if key and (x.get("key") == key or x.get("address") == key)), None)
                if spec is None:
                    raise cc.ControlError("not_found", f"{st.get('label')} has no setting {key or '(no key)'}")
                body = {"verb": "set", "address": spec["address"], "value": inp.get("value")}
            elif action in ("enable", "disable"):
                body = {"verb": f"plugin.{action}", "address": path, **({"options": inp["options"]} if isinstance(inp.get("options"), dict) else {})}
            else:
                raise cc.ControlError("invalid", "console.pluginsettings act takes open, set, enable or disable")
            if inp.get("reason"):
                body["reason"] = inp["reason"]
            r = api.command({**body, "to": str(inp.get("to") or "recent")}, by or "control", audience, set(grants))
        else:
            raise cc.ControlError("invalid", "console.pluginsettings takes list, get or act")
    except cc.ControlError as e:
        r = e.envelope()
    out = {"$axf": "control@1", "ok": bool(r.get("ok")), "target": "console.pluginsettings", "op": op, **({"path": path} if path else {}), "data": r}
    if not r.get("ok"):
        out.update({k: r[k] for k in ("code", "message", "openUrl") if k in r})
    _recent.appendleft({"at": _iso(_now()), "by": by, "target": "console.pluginsettings", "path": path, "action": command.get("action") or op, "ok": out["ok"],
                        "code": out.get("code", ""), "message": out.get("message", ""), "audience": audience, "how": "control@1", "delivered": []})
    return out


def toolbars_target(command: dict[str, Any], grants: list[str], by: str, audience: str) -> dict[str, Any]:
    """control@1 `console.toolbars` (core/engines/control-rules.mjs; page-toolbar@1): the page toolbars the open console
    shows. list = the live toolbar targets (select.view narrows), get = one toolbar's state (path = its settings id),
    act press = one button (input.button, input.value, confirm), act open = bring it on screen. All through the
    console-control guards like console.control, so REST, MCP, the CLI and voice take one path."""
    import console_control as cc  # the console server's console-control half
    import console_control_api as api
    op, path = str(command.get("op") or ""), str(command.get("path") or "")
    inp = command.get("input") if isinstance(command.get("input"), dict) else {}
    sel = command.get("select") if isinstance(command.get("select"), dict) else {}
    to = str(inp.get("to") or "recent")
    try:
        if op == "list":
            view = str(sel.get("view") or "")
            r = api.targets(f"view:{view}" if view else "", [cc.TOOLBAR_KIND], "console", by or "control", audience, set(grants))
            lim = int(sel.get("limit") or 0)
            if r.get("ok") and lim > 0 and isinstance(r.get("targets"), list):
                r["targets"] = r["targets"][:lim]
        elif op == "get":
            r = api.command({"verb": "state", "address": cc.toolbar_address(path), "to": to}, by or "control", audience, set(grants))
        elif op == "act":
            action = str(command.get("action") or "")
            if action == "press":
                body: dict[str, Any] = {"verb": "press", "address": cc.toolbar_button_address(path, str(inp.get("button") or ""))}
                if inp.get("value") is not None:
                    body["value"] = inp["value"]
                if command.get("confirm"):
                    body["confirm"] = True
            elif action == "open":
                body = {"verb": "open", "address": cc.toolbar_address(path)}
            else:
                raise cc.ControlError("invalid", "console.toolbars act takes press or open")
            if inp.get("reason") or command.get("reason"):
                body["reason"] = inp.get("reason") or command.get("reason")
            r = api.command({**body, "to": to}, by or "control", audience, set(grants))
        else:
            raise cc.ControlError("invalid", "console.toolbars takes list, get or act")
    except cc.ControlError as e:
        r = e.envelope()
    out = {"$axf": "control@1", "ok": bool(r.get("ok")), "target": "console.toolbars", "op": op, **({"path": path} if path else {}), "data": r}
    if not r.get("ok"):
        out.update({k: r[k] for k in ("code", "message", "openUrl") if k in r})
    _recent.appendleft({"at": _iso(_now()), "by": by, "target": "console.toolbars", "path": path, "action": command.get("action") or op, "ok": out["ok"],
                        "code": out.get("code", ""), "message": out.get("message", ""), "audience": audience, "how": "control@1", "delivered": []})
    return out


def run_for(request: Request, command: dict[str, Any]) -> dict[str, Any]:
    """`wait` (seconds, at most MAX_WAIT_S) on the command: how long the call waits for a console that has to open
    first. Without it the call answers within a few seconds and says what is still pending."""
    grants, name, audience = caller(request)
    command = dict(command or {})
    wait = command.pop("wait", None)
    try:
        wait = max(0.0, min(float(wait), MAX_WAIT_S)) if wait is not None and not isinstance(wait, bool) else None
    except (TypeError, ValueError):
        wait = None
    return run(command, grants, command.get("by") or name, audience, wait)


async def go(request: Request, command: dict[str, Any]) -> JSONResponse:
    """Run off the event loop: the answer waits for the consoles' acks, which arrive on this same loop."""
    return answer(await run_in_threadpool(run_for, request, command))


def _audit(b: dict[str, Any]) -> dict[str, Any]:
    """Who and why, and how long the call may wait (`wait`, seconds: run_for)."""
    return {**{k: b[k] for k in ("by", "reason") if isinstance(b.get(k), str) and b[k]}, **({"wait": b["wait"]} if isinstance(b.get("wait"), (int, float)) and not isinstance(b.get("wait"), bool) else {})}


def _to(b: dict[str, Any], **more: Any) -> dict[str, Any]:
    inp = {k: v for k, v in more.items() if v not in (None, "", [])}
    if isinstance(b.get("to"), str) and b["to"]:
        inp["to"] = b["to"]
    return {"input": inp} if inp else {}


# ---------------------------------------------------------------------- screenshots

def _shot_file(mid: str, cid: str) -> Path:
    return SHOT_DIR / f"{mid}--{cid}.png"


def sweep_shots(max_age: float = SHOT_TTL_S) -> int:
    """Delete uploads older than `max_age` seconds (nobody read them). → how many were removed."""
    cut, n = _now() - max_age, 0
    try:
        files = list(SHOT_DIR.glob("*.png"))
    except OSError:
        return 0
    for f in files:
        try:
            if f.stat().st_mtime < cut:
                f.unlink()
                n += 1
        except OSError:
            pass
    return n


def _awaited(mid: str, cid: str) -> bool:
    """A command this console was sent and the server still waits on (or records a late ack for)."""
    with _lock:
        a = _acks.get(mid)
        return (a is not None and cid in a["want"]) or mid in _late


def save_shot(mid: str, cid: str, data: bytes) -> int:
    """Keep one console's PNG for one command until the answer reads it. → bytes written."""
    if not SHOT_ID_RE.match(mid) or not CLIENT_RE.match(cid):
        raise HTTPException(400, "bad command or client id")
    if len(data) > SHOT_MAX_BYTES:
        raise HTTPException(413, f"a screenshot is at most {SHOT_MAX_BYTES} bytes")
    if not data.startswith(PNG_MAGIC):
        raise HTTPException(415, "a screenshot is a PNG")
    sweep_shots()
    SHOT_DIR.mkdir(parents=True, exist_ok=True, mode=0o700)
    f = _shot_file(mid, cid)
    tmp = f.with_suffix(".part")
    tmp.write_bytes(data)
    os.chmod(tmp, 0o600)
    tmp.replace(f)
    return len(data)


def _is_shot(command: dict[str, Any]) -> bool:
    return command.get("target") == "console.nav" and command.get("op") == "act" and command.get("action") == "screenshot"


def attach_shots(r: dict[str, Any]) -> dict[str, Any]:
    """A screenshot answer: each console's upload read once into `images` (base64) and deleted, the first console's screen
    state as `state`. A console that acked without an image says why in its ack message."""
    mid = str((r.get("sent") or {}).get("id") or "")
    images: list[dict[str, Any]] = []
    state: dict[str, Any] | None = None
    for a in r.get("delivered") or []:
        if not isinstance(a, dict) or not a.get("client"):
            continue
        res = a.get("result") if isinstance(a.get("result"), dict) else {}
        f = _shot_file(mid, str(a["client"])) if mid and SHOT_ID_RE.match(mid) and CLIENT_RE.match(str(a["client"])) else None
        data = b""
        if f is not None:
            try:
                data = f.read_bytes()
            except OSError:
                data = b""
            try:
                f.unlink()
            except OSError:
                pass
        if state is None and isinstance(res.get("state"), dict):
            state = res["state"]
        if a.get("ok") and data:
            images.append({"client": a["client"], "mime": "image/png", "data": base64.b64encode(data).decode(), "bytes": len(data),
                           **{k: res[k] for k in ("width", "height", "scale", "capture") if k in res}})
        elif a.get("ok"):
            a["ok"] = False
            a["message"] = a.get("message") or "the console said it captured the screen, but no image arrived"
    out = {**r, "images": images}
    if state is not None:
        out["state"] = state
    if r.get("ok") and not r.get("queued"):
        out["status"] = _status_of(out)
        if not images and out["status"] != "pending":
            out["message"] = "; ".join(str(a.get("message") or "") for a in r.get("delivered") or [] if isinstance(a, dict)) or "no screenshot came back"
    return out


# ---------------------------------------------------------------------- routes: the consoles' side

def _new_page(c: dict[str, Any], page: str) -> bool:
    """A console said which page load it is (under _lock). A new one (the tab was reloaded, the phone loaded the wake
    link) means everything sent to the old page and not acked is gone with it: its stream is dropped, and whoever
    waits for its ack stops waiting now, so a queued command goes to the new page at once."""
    if not PAGE_RE.match(page) or c.get("page") == page:
        return False
    had = bool(c.get("page"))
    c["page"], c["born"] = page, _now()
    if c.get("streamPage") != page and c.get("queue") is not None:
        c["queue"], c["loop"] = None, None
    if had:
        for a in _acks.values():
            if not a.get("any") and c["id"] in a["want"] and c["id"] not in a["results"]:
                a["event"].set()
    return True


@router.post("/hello")
async def hello(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, name, audience = caller(request)
    cat = b.get("catalog") if isinstance(b.get("catalog"), dict) else {"items": []}
    if len(json.dumps(cat)) > CATALOG_MAX_BYTES:
        raise HTTPException(413, "catalog too large")
    c = _client_of(b, audience, name)
    with _lock:
        _new_page(c, str(b.get("page") or ""))
        c.update({"app": str(b.get("app") or "console-web")[:60], "title": str(b.get("title") or "")[:120], "device": str(b.get("device") or "")[:20],
                  "catalog": cat, "here": b.get("here") if isinstance(b.get("here"), dict) else {}, "lastSeen": _now()})
        c["shell"] = b["shell"] if isinstance(b.get("shell"), str) and HOST_RE.match(b["shell"]) else ""
        _front_of(c, b)
        if b.get("used") or not c["lastUsed"]:
            c["lastUsed"] = _now()
        loading = _now() - float(c.get("born") or 0) < YOUNG_S
        _hello_seq[audience] = _hello_seq.get(audience, 0) + 1
        _hello_cv.notify_all()
    # a page that is still loading knows fewer names than the one before it: the fuller catalog stays the reference
    known = remembered_catalog(audience) if loading else None
    if not (known and len(known.get("items") or []) > len(cat.get("items") or [])):
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
        # "working on <id>": the console got a command that takes a while (a screenshot) and is on it
        a = _acks.get(str(b.get("working") or ""))
        if a is not None and c["id"] in a["want"]:
            a.setdefault("working", set()).add(c["id"])
        hello_again = not _ready(c)
    if not hello_again and c.get("queue") is not None and _has_queued(audience):
        _drain_soon(audience)
    # a console the server holds no catalog for (it restarted): the console says hello again at once
    return {"ok": True, **({"hello": True} if hello_again else {})}


@router.post("/bye")
async def bye(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, _, audience = caller(request)
    with _lock:
        c = _clients.get(str(b.get("client") or ""))
        page = str(b.get("page") or "")
        # a bye that arrives after the tab's next page said hello (a reload) is the old page's: the new one stays
        if c and c["audience"] == audience and (not page or not c.get("page") or c["page"] == page):
            c["lastSeen"] = 0.0
            c["lastUsed"] = 0.0
            c["missed"] = _now()  # gone, not quiet: nothing is sent here until it beats again
    return {"ok": True}


@router.get("/stream")
async def stream(request: Request, client: str = "", page: str = "") -> StreamingResponse:
    _, name, audience = caller(request)
    c = _client_of({"client": client}, audience, name)
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    loop = asyncio.get_running_loop()
    ttl = float(settings()["ttlS"])
    with _lock:
        fresh = _new_page(c, page)  # the stream of a new page load can arrive before its hello
        old = None if fresh else c.get("queue")
        c["queue"], c["loop"], c["lastSeen"], c["streamPage"] = q, loop, _now(), page if PAGE_RE.match(page) else ""
        if not _ready(c):  # the server restarted (or the tab never said hello): ask for the catalog again
            q.put_nowait({"$axf": "console-hello@1"})
        if old is not None:  # a reconnect replaced a stream: what it hadn't sent yet goes down the new one
            while not old.empty():
                q.put_nowait(old.get_nowait())
        for at, m in c["pending"]:
            if at > _now() - ttl:  # held while the stream was down: the console runs it even though it is late
                q.put_nowait({**m, "delivery": m.get("delivery") or "queued"})
        c["pending"] = []
        ready = _ready(c)
    if ready and _has_queued(audience):
        _drain_soon(audience)  # anything queued while this console's stream was down goes now

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                if await request.is_disconnected():
                    break
                try:
                    m = await asyncio.wait_for(q.get(), timeout=KEEPALIVE_S)
                    yield f"data: {json.dumps(m)}\n\n"
                except asyncio.TimeoutError:
                    # keeps proxies from closing the stream; never proof the console is alive (a frozen tab keeps
                    # its socket open), so lastSeen is left alone
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
        if b.get("skipped") is True:  # a tab that woke up and skipped a command it got too late: not an answer
            return {"ok": True, "skipped": True}
        a = _acks.get(mid)
        res = {"client": cid, "ok": bool(b.get("ok")), "message": str(b.get("message") or "")[:300], "here": b.get("here") if isinstance(b.get("here"), dict) else {}}
        # op control: the console-control@1 answer (result + live state), kept whole up to a size cap
        if isinstance(b.get("result"), dict):
            res["result"] = b["result"] if len(json.dumps(b["result"], default=str)) <= ACK_RESULT_MAX else {"ok": bool(b.get("ok")), "truncated": True, "message": res["message"]}
        if c.get("shell"):
            res["shell"] = c["shell"]
        if b.get("surfaced") is True:  # the page asked its app to bring it to the front
            res["surfaced"] = True
        if a is not None and cid in a["want"]:
            a["results"][cid] = res
            if a.get("any") or set(a["results"]) >= a["want"]:
                a["event"].set()
        late = _late.pop(mid, None)
        if late is not None:
            _acks.pop(mid, None)
        e = (late or {}).get("entry")
        if e is None and mid:  # the ack of a queued command that came after its delivery stopped waiting
            e = next((x for x in _queue if x["audience"] == audience and x["state"] == "queued" and (x.get("message") or {}).get("id") == mid), None)
        if e is not None and e["state"] == "queued":
            # the sleeping console woke in time and did it after all: the queued copy never runs, nobody is woken
            e["result"] = {"$axf": "control@1", "ok": bool(res["ok"]), "op": e["command"].get("op"), "target": e["command"].get("target"), "delivered": [res],
                           "delivery": {"how": "late ack", "id": e["id"], "tried": e.get("tried") or [], "client": cid}, "data": {"changed": []}}
            e["result"]["status"] = "delivered" if res["ok"] else "failed"
            e["state"] = "delivered" if res["ok"] else "failed"
            e["event"].set()
    return {"ok": True, **({"late": True} if late else {})}


@router.post("/shot")
async def shot(request: Request, client: str = "", id: str = "") -> dict[str, Any]:
    """A console's PNG for a screenshot command it was sent (the body is the image). Kept until the answer reads it."""
    _, _, audience = caller(request)
    with _lock:
        c = _clients.get(client)
        if not c or c["audience"] != audience:
            raise HTTPException(404, "no such console")
    try:
        if int(request.headers.get("content-length") or 0) > SHOT_MAX_BYTES:
            raise HTTPException(413, f"a screenshot is at most {SHOT_MAX_BYTES} bytes")
    except ValueError:
        raise HTTPException(400, "bad content-length") from None
    if not _awaited(id, client):
        raise HTTPException(409, "no screenshot is waited for from this console under that id")
    data = await request.body()
    n = await run_in_threadpool(save_shot, id, client, data)
    return {"ok": True, "bytes": n}


@router.post("/screenshot")
async def screenshot(request: Request) -> JSONResponse:
    """Capture what the open console shows: {selector?, address?, to?} → images + state."""
    b = await _body(request)
    return await go(request, {"op": "act", "target": "console.nav", "path": "here", "action": "screenshot",
                              **_to(b, selector=b.get("selector"), address=b.get("address")), **_audit(b)})


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
async def set_settings(request: Request) -> Any:
    """Two commands share this path (/api/console/settings and /api/plugins/console-commands/settings are one router):
    a body naming a tab ({tab | path | q, anchor?, to?}) opens that Settings tab in the open console; any other body is a
    patch of this plugin's own settings (wake, ttlS, browser; the owner only). Two routes on one path left the second
    (open a tab) unreachable."""
    b = await _body(request)
    if any(isinstance(b.get(k), str) and b[k] for k in ("tab", "path", "q")):
        return await open_settings(request, b)
    _, _, audience = caller(request)
    if audience != OWNER:
        raise HTTPException(403, "only the console's owner changes the console commands settings")
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


async def open_settings(request: Request, b: dict[str, Any]) -> JSONResponse:
    """POST /settings with a tab (routed by set_settings): open that Settings tab in the open console."""
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


@router.post("/refresh")
async def refresh(request: Request) -> JSONResponse:
    """Reload the open console: soft, or hard {"hard": true} (clears its caches first). `to` as every command."""
    b = await _body(request)
    cmd = {"op": "act", "target": "console.nav", "path": "here", "action": "refresh", **_to(b), **_audit(b)}
    if b.get("hard") is True:
        cmd["input"] = {**(cmd.get("input") or {}), "hard": True}
    return await go(request, cmd)


# ---------------------------------------------------------------------- routes: the phone's overlay

OVERLAY_VERBS = ("expand", "collapse", "open")


def overlay_url(verb: str, url: str = "") -> str:
    """The URL that carries an overlay verb to the phone through axHub's `amberx.open_url` (AXPP `browser.open`): expand
    and collapse are the console with `axf-overlay=<verb>` (AmberX's OverlayPageRules.verb), open is the page itself."""
    return url if verb == "open" else f"{CONSOLE_URL}/?axf-overlay={verb}"


def overlay_page_ok(url: str) -> bool:
    """https on Brett's own domain, no credentials: the same rule as the phone (OpenUrlRules) and the hub."""
    try:
        u = urlsplit(url)
    except ValueError:
        return False
    host = (u.hostname or "").lower()
    return u.scheme == "https" and not u.username and not u.password and (host == "amberxai.com" or host.endswith(".amberxai.com"))


def overlay(verb: str, url: str = "") -> dict[str, Any]:
    """overlay.expand / overlay.collapse / overlay.open {url} on Brett's phone. → {ok, verb, opened, message} (never raises)."""
    if verb not in OVERLAY_VERBS:
        return {"ok": False, "verb": verb, "code": "bad_request", "message": f"overlay verbs are {', '.join(OVERLAY_VERBS)}"}
    if verb == "open" and not overlay_page_ok(url):
        return {"ok": False, "verb": verb, "code": "bad_request", "message": "overlay.open takes one of your own pages (https://…amberxai.com)"}
    try:
        r = WAKER(overlay_url(verb, url), settings()["browser"])
    except Exception as e:  # noqa: BLE001 — the phone or the hub failing is an answer, not a crash
        r = {"ok": False, "message": str(e)[:300]}
    return {"ok": bool(r.get("ok")), "verb": verb, "opened": r.get("opened") is True, "message": str(r.get("message") or "")[:300]}


@router.post("/overlay")
async def overlay_route(request: Request) -> JSONResponse:
    """Expand the phone's overlay into its full-screen browser, collapse it to the toolbar, or open one of Brett's pages
    in it: {"verb": "expand" | "collapse" | "open", "url"?}. The owner only (it reaches his phone)."""
    _, _, audience = caller(request)
    if audience != OWNER:
        raise HTTPException(403, "only the console's owner drives the phone's overlay")
    b = await _body(request)
    out = await run_in_threadpool(overlay, str(b.get("verb") or ""), str(b.get("url") or ""))
    return JSONResponse(out, status_code=400 if out.get("code") == "bad_request" else 200)


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

    def control(self, command: dict[str, Any], by: str = "", audience: str = OWNER, to: str = "recent") -> dict[str, Any]:
        """A console-control@1 command for the open console → its answer (result + live state), or unavailable + openUrl."""
        return control(command, by, audience, to)

    def queue_for_owner(self, command: dict[str, Any], grants: list[str], by: str = "") -> dict[str, Any]:
        e = queue_for_owner(command, grants, by)
        return {"id": e["id"], "expiresAt": _iso(e["expires"])}

    def queue(self, audience: str = OWNER) -> list[dict[str, Any]]:
        return queued_for(audience)

    def clients(self, audience: str = OWNER) -> list[dict[str, Any]]:
        return [{k: v for k, v in c.items() if k != "catalog"} for c in clients_of(audience)]


plugin_services.provide("console-commands@1", ConsoleCommands(), folder=FOLDER)
