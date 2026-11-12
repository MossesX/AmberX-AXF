"""Approvals banner (server part): the relay that lets Approve / Deny stay in the console.

Brett, Nov 6 2026: "How come when I click approve, it's going back to axHub, not staying on console?" The hub takes a
decision only with its own Origin and the session's CSRF value, and the browser can't send that from the console's
origin. So the tap comes here and this route posts it to the hub with the hub session cookie the same browser just
sent, and the answer goes back to the tap. The hub records it as Brett's (`web:<him>`), as if he tapped on its page.

  GET  relay                    {ok, relay}: can this browser decide through the relay right now?
  POST decide {id, action, rev?}   action: approve | decline | deny | approve-now | shelve

What keeps it Brett's own tap, never a session's:
  - only a browser the wall signed in as a hub admin: the console token (every Claude session, MCP, CLI, AmberX's server
    forwarding) is refused, and so is a request without the hub session cookie, which no session holds;
  - the request must come from the console's own origin as JSON (`wall.same_origin`), like every browser write;
  - only the `axhub_session` cookie is sent on, only to the wall's own hub over https, with redirects refused;
  - the cookie is never stored or logged. `relay.jsonl` in the plugin's data folder records who, what and the outcome;
  - nothing here decides by itself: the route exists for the tap, and is left out of the plugin's commands.

The owner sign-in (Brett, Nov 7 2026: Approve did nothing because the browser's hub cookie never reached the console):
when the tapping browser brings no hub session (or the hub no longer takes it), the console decides with its own
server-side owner sign-in to the hub, `AXF_HUB_RELAY_USER` + `AXF_HUB_RELAY_PASSWORD` (env only, never in the repo,
never logged, never sent anywhere but the wall's https hub). Same rules as above: only the wall's signed-in hub admin
browser may trigger it (optionally narrowed to `AXF_HUB_RELAY_OWNERS`, comma-separated usernames), from the console's
own pages, as JSON. The console token and every Claude session are still refused, so no session can approve its own
call. The hub records the decision as that account (`web:<relay user>`); `relay.jsonl` records who tapped, `via:
"owner"`, the action and the outcome. The session is kept in memory only and signed in again once when the hub drops it.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import plugin_services
import wall

router = APIRouter()
FOLDER = "approvals-banner"
ROOT = Path(__file__).resolve().parents[5]
COOKIE = "axhub_session"
# The hub's own id rule (lib-hub isApprovalId).
ID_RE = re.compile(r"^[0-9a-f-]{36}$")
# Veto holds have a route per action; approve + decline go through the plain decide route (approve on a veto call is
# turned into approve-now by the hub itself, decision 105).
VETO_ROUTES = ("deny", "approve-now", "shelve")
PLAIN = ("approve", "decline")
TIMEOUT_S = 12.0
MESSAGE_MAX = 300
HEALTH_CAP = "axf.health@1"
HEALTH_ID = "approvals-relay"
COOKIE_RE = re.compile(rf"(?:^|,\s*){COOKIE}=([^;,\s]+)")
NO_CREDENTIAL = ("Nothing was decided: this browser's axHub session didn't reach the console, and the console server has "
                 "no axHub owner sign-in (AXF_HUB_RELAY_USER / AXF_HUB_RELAY_PASSWORD). Settings → Plugins → Systems check "
                 "→ Approvals relay says how to set it.")


def _data() -> Path:
    return Path(os.environ.get("AXF_APPROVALS_BANNER_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def hub_base() -> str:
    """The wall's hub (same value as /api/me), https only; '' when it can't be trusted."""
    hub = os.environ.get("AXF_WALL_HUB", "https://axhub.amberxai.com").strip().rstrip("/")
    u = urlsplit(hub)
    return hub if u.scheme == "https" and u.hostname and not u.path and not u.query else ""


def _log(entry: dict[str, Any]) -> None:
    """One line per decision relayed (never the cookie); a log that can't be written never stops a tap."""
    try:
        d = _data()
        d.mkdir(parents=True, exist_ok=True)
        with (d / "relay.jsonl").open("a") as f:
            f.write(json.dumps({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry}) + "\n")
    except OSError:
        pass


def _admin_browser(request: Request) -> wall.Caller:
    """The wall's signed-in hub admin, or 403: the console token alone never decides."""
    c = wall.wall_caller(request.headers)
    if c is None or not c.admin:
        raise HTTPException(403, "Only your own signed-in browser can decide")
    return c


def _reply_json(r: httpx.Response) -> dict[str, Any]:
    try:
        j = r.json()
        return j if isinstance(j, dict) else {}
    except ValueError:
        return {}


def owner_credential() -> tuple[str, str] | None:
    """The console's server-side hub sign-in (env only), or None when it isn't set."""
    u = (os.environ.get("AXF_HUB_RELAY_USER") or "").strip()
    p = os.environ.get("AXF_HUB_RELAY_PASSWORD") or ""
    return (u, p) if u and p else None


def owner_may(c: wall.Caller) -> bool:
    """Only a wall admin, and only the names in AXF_HUB_RELAY_OWNERS when it is set."""
    if not c.admin:
        return False
    names = {n.strip().lower() for n in (os.environ.get("AXF_HUB_RELAY_OWNERS") or "").split(",") if n.strip()}
    return not names or c.name.lower() in names


class OwnerSession:
    """The owner's hub session cookie, in memory only; one sign-in at a time, signed in again when the hub drops it."""

    def __init__(self) -> None:
        self.cookie = ""
        self.lock = threading.Lock()

    def drop(self, cookie: str) -> None:
        with self.lock:
            if self.cookie == cookie:
                self.cookie = ""

    def get(self, hub: str, cred: tuple[str, str], client: httpx.Client) -> dict[str, Any]:
        """→ {ok, cookie} or {ok: False, code, message}."""
        with self.lock:
            if self.cookie:
                return {"ok": True, "cookie": self.cookie}
            r = sign_in(hub, cred, client)
            if r["ok"]:
                self.cookie = r["cookie"]
            return r


OWNER = OwnerSession()


def sign_in(hub: str, cred: tuple[str, str], client: httpx.Client) -> dict[str, Any]:
    """The hub's own sign-in form, posted from the server with the hub's Origin; → {ok, cookie} or why not."""
    r = client.post(f"{hub}/auth/login", headers={"Origin": hub, "Accept": "text/html"},
                    data={"username": cred[0], "password": cred[1], "rd": "/"})
    cookie = ""
    for v in r.headers.get_list("set-cookie"):
        m = COOKIE_RE.search(v)
        if m:
            cookie = m.group(1)
    where = r.headers.get("location") or ""
    if cookie and "/auth/first" in where:
        return {"ok": False, "code": "owner_password", "message": "Nothing was decided: the console's axHub sign-in must pick a new password first (sign in to axHub as that account once)."}
    if cookie and r.status_code in (302, 303):
        return {"ok": True, "cookie": cookie}
    if "err=busy" in where:
        return {"ok": False, "code": "owner_busy", "message": "Nothing was decided: axHub is slowing sign-ins down right now. Try again in a minute."}
    if "err=" in where:
        return {"ok": False, "code": "owner_refused", "message": "Nothing was decided: axHub refused the console's sign-in (AXF_HUB_RELAY_USER / AXF_HUB_RELAY_PASSWORD are wrong or the account is gone)."}
    return {"ok": False, "code": "owner_refused", "message": f"Nothing was decided: axHub didn't sign the console in (it answered {r.status_code})."}


def owner_decision(hub: str, cred: tuple[str, str], aid: str, action: str, rev: Any, client: httpx.Client, owner: OwnerSession = OWNER) -> dict[str, Any]:
    """One decision with the console's own owner session; a session the hub dropped is signed in again once."""
    for attempt in (1, 2):
        s = owner.get(hub, cred, client)
        if not s["ok"]:
            return s
        r = relay_decision(hub, s["cookie"], aid, action, rev, client)
        if r.get("code") != "no_session":
            return r
        owner.drop(s["cookie"])
    return {**r, "message": "Nothing was decided: axHub keeps refusing the console's sign-in session."}


def relay_decision(hub: str, cookie: str, aid: str, action: str, rev: Any, client: httpx.Client) -> dict[str, Any]:
    """Posts one decision to the hub with this browser's session; → {ok, state?, message, status, code?}."""
    head = {"Cookie": f"{COOKIE}={cookie}", "Accept": "application/json"}
    s = client.get(f"{hub}/auth/api/session", headers=head)
    csrf = _reply_json(s).get("csrf") if s.status_code == 200 else None
    if not isinstance(csrf, str) or not csrf:
        return {"ok": False, "code": "no_session", "status": s.status_code, "message": "axHub didn't take your session. Sign in to axHub again, then tap it again."}
    body: dict[str, Any] = {}
    if isinstance(rev, int) and not isinstance(rev, bool):
        body["rev"] = rev
    if action in PLAIN:
        url, body = f"{hub}/auth/api/approvals/{aid}", {**body, "action": action}
    else:
        url = f"{hub}/auth/api/approvals/{aid}/{action}"
    r = client.post(url, headers={**head, "Origin": hub, "Content-Type": "application/json", "X-AxHub-CSRF": csrf}, content=json.dumps(body))
    j = _reply_json(r)
    if r.status_code == 200 and j.get("ok") is not False:
        return {"ok": True, "status": 200, "state": j.get("state"), "message": str(j.get("message") or "")[:MESSAGE_MAX]}
    err = j.get("error") if isinstance(j.get("error"), dict) else {}
    return {"ok": False, "status": r.status_code, "code": str(err.get("code") or "hub_refused"), "state": j.get("state"),
            "message": str(err.get("message") or f"axHub answered {r.status_code}.")[:MESSAGE_MAX]}


def relay_state(c: wall.Caller | None, has_cookie: bool) -> dict[str, Any]:
    """Can this caller decide in place, through which sign-in, and if not, exactly why not."""
    if not hub_base():
        return {"relay": False, "via": "", "reason": "The console has no https hub address (AXF_WALL_HUB)."}
    if c is None or not c.admin:
        return {"relay": False, "via": "", "reason": "Only your own signed-in console browser (an axHub admin) can approve or deny here."}
    if has_cookie:
        return {"relay": True, "via": "browser", "reason": ""}
    if owner_credential() and owner_may(c):
        return {"relay": True, "via": "owner", "reason": ""}
    if owner_credential():
        return {"relay": False, "via": "", "reason": f"{c.name} isn't one of the console's approval owners (AXF_HUB_RELAY_OWNERS)."}
    return {"relay": False, "via": "", "reason": NO_CREDENTIAL}


@router.get("/relay")
def get_relay(request: Request) -> dict[str, Any]:
    """Decides in place only for a wall admin's browser (AmberX's token forwarding gets relay: false and keeps its own hosts)."""
    ensure_health()
    return {"ok": True, **relay_state(wall.wall_caller(request.headers), bool(request.cookies.get(COOKIE)))}


@router.post("/decide")
async def post_decide(request: Request) -> dict[str, Any]:
    c = _admin_browser(request)
    if not wall.same_origin(request):
        raise HTTPException(403, "Only from the console's own pages")
    if "application/json" not in (request.headers.get("content-type") or ""):
        raise HTTPException(415, "Send JSON")
    try:
        b = await request.json()
    except ValueError:
        raise HTTPException(400, "Send JSON") from None
    b = b if isinstance(b, dict) else {}
    aid, action, rev = b.get("id"), b.get("action"), b.get("rev")
    if not isinstance(aid, str) or not ID_RE.match(aid):
        raise HTTPException(400, "Not a request id")
    if action not in (*VETO_ROUTES, *PLAIN):
        raise HTTPException(400, "action must be approve, decline, deny, approve-now or shelve")
    hub = hub_base()
    if not hub:
        raise HTTPException(503, "The console has no https hub address (AXF_WALL_HUB)")
    cookie = request.cookies.get(COOKIE) or ""
    cred = owner_credential() if owner_may(c) else None
    if not cookie and not cred:
        r = {"ok": False, "code": "no_credential", "message": relay_state(c, False)["reason"]}
        _log({"by": c.name, "id": aid, "action": action, "ok": False, "via": "", "code": r["code"]})
        return r

    def send() -> dict[str, Any]:
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
            if cookie:
                r = relay_decision(hub, cookie, aid, action, rev, client)
                # The browser's own session first (the hub then names him); a session it no longer takes falls back.
                if r.get("code") != "no_session" or not cred:
                    return {**r, "via": "browser"}
            assert cred
            return {**owner_decision(hub, cred, aid, action, rev, client), "via": "owner"}

    try:
        r = await run_in_threadpool(send)
    except httpx.HTTPError as e:
        r = {"ok": False, "code": "unreachable", "via": "", "message": f"Couldn't reach axHub ({type(e).__name__}). Nothing was decided."}
    _log({"by": c.name, "id": aid, "action": action, "ok": r["ok"], "via": r.get("via", ""), "status": r.get("status"), "code": r.get("code", "")})
    return r


# ---- systems check: can the console decide in place?

def health_probe() -> dict[str, Any]:
    if not hub_base():
        return {"status": "error", "summary": "Approve / Deny can't work in the console: no https hub address (AXF_WALL_HUB).", "details": []}
    if owner_credential():
        return {"status": "ok", "summary": "Approve / Deny decide in the console (the console's own axHub owner sign-in is set).", "details": []}
    return {"status": "warn", "summary": "Approve / Deny in the console work only when your browser's axHub session reaches the console: the console has no owner sign-in.",
            "details": ["Set AXF_HUB_RELAY_USER and AXF_HUB_RELAY_PASSWORD (an axHub admin account) in the console's env, then redeploy."]}


_health_done = False


def ensure_health() -> bool:
    """Registers the relay item on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Approvals relay (Approve / Deny in the console)", "service": "axhub", "order": 40, "severity": "warn",
                      "run": lambda: health_probe(),
                      "breaks": "Without it Approve and Deny in the console only work when the browser's axHub cookie reaches the console; otherwise they say so and you decide on axHub.",
                      "instructions": ["On the hub: `axhub users add console-relay --admin` (or use your own admin account) and note its password.",
                                       "In the console's Coolify env (or the installer's env file): AXF_HUB_RELAY_USER=<that user>, AXF_HUB_RELAY_PASSWORD=<its password>; optionally AXF_HUB_RELAY_OWNERS=<your hub username>.",
                                       "Redeploy the console; this item turns green."]}, FOLDER)
    except Exception:  # noqa: BLE001 — the relay works without its health item
        return False
    _health_done = True
    return True


# ---- approvals as console alerts (watch.py): the console tells the phone, not the AmberX web app

from . import watch as _watch  # noqa: E402

import console_context as cx  # noqa: E402

WATCH = _watch.Watch(hub_base, owner_credential, OWNER, lambda i: bool(ID_RE.match(i)),
                     raise_alert=lambda a: cx.raise_alert(a), resolve=lambda keys: cx.resolve_alerts(keys),
                     open_keys=lambda prefix: cx.open_alert_keys(prefix), on=lambda: cx.plugin_enabled(FOLDER))
_watch_stop = _watch.start(WATCH)


@router.get("/watch")
def get_watch() -> dict[str, Any]:
    """What the approvals watch saw last: on, state (ok | error | unreachable | off | idle), waiting, lastAt, error."""
    return {"ok": True, **WATCH.state()}


@router.post("/watch/poll")
async def post_watch_poll() -> dict[str, Any]:
    """Read axHub's approvals feed now and bring the approval alerts in line (it reads by itself every 30 s)."""
    return {"ok": True, **(await run_in_threadpool(WATCH.poll))}


# ---- the console's own approvals screen (build move-amberx-web-app-into-the-console-amberx-andr, s6; contract C20)
#
#   GET  pending?since=<version>   the waiting calls the watch last read: {pending[], count, version, signedIn, admin}
#                                  (`unchanged: true` and no list when `since` is the current version)
#   GET  approval?id=              one waiting call with its comments (404 once it is no longer waiting and has none)
#   GET  comments?id=              the comments on one call (every call when no id), newest last
#   POST comment {id, text}        a comment on a call, kept on the console with who wrote it (axHub has no comment
#                                  field: the comment never changes the call and is not a decision)
#   GET  settings · PUT settings {pollSeconds?, keepComments?}
# Deciding is unchanged: POST decide, a signed-in admin browser only (the console token, MCP and the CLI are refused).

COMMENT_MAX = 2000
SETTINGS_DEFAULTS: dict[str, Any] = {"pollSeconds": _watch.POLL_S, "keepComments": 500}
SETTINGS_RANGES: dict[str, tuple[int, int]] = {"pollSeconds": (10, 300), "keepComments": (10, 5000)}


def read_settings() -> dict[str, Any]:
    out = dict(SETTINGS_DEFAULTS)
    try:
        saved = json.loads((_data() / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    if isinstance(saved, dict):
        for k, (lo, hi) in SETTINGS_RANGES.items():
            v = saved.get(k)
            if isinstance(v, int) and not isinstance(v, bool) and lo <= v <= hi:
                out[k] = v
    return out


WATCH.interval = lambda: read_settings()["pollSeconds"]


def _author(request: Request) -> str:
    c = wall.wall_caller(request.headers)
    if c is not None and c.name and c.via == "session":
        return f"web:{c.name}"[:80]
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


def _comments(aid: str = "") -> list[dict[str, Any]]:
    try:
        lines = (_data() / "comments.jsonl").read_text().splitlines()
    except OSError:
        return []
    out = []
    for line in lines:
        try:
            c = json.loads(line)
        except ValueError:
            continue
        if isinstance(c, dict) and (not aid or c.get("id") == aid):
            out.append(c)
    return out


def _add_comment(entry: dict[str, Any]) -> None:
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    rows = _comments() + [entry]
    keep = read_settings()["keepComments"]
    tmp = d / f".comments-{os.getpid()}"
    tmp.write_text("".join(json.dumps(r) + "\n" for r in rows[-keep:]))
    os.replace(tmp, d / "comments.jsonl")


@router.get("/pending")
def get_pending(since: int = -1) -> dict[str, Any]:
    f = WATCH.feed()
    st = WATCH.state()
    signed = st.get("state") not in ("off",)
    base = {"ok": True, "version": f["version"], "count": f["count"], "lastAt": f["lastAt"], "state": st.get("state"), "signedIn": signed, "admin": signed and st.get("state") != "error"}
    if since == f["version"]:
        return {**base, "unchanged": True}
    return {**base, "pending": f["pending"]}


@router.get("/approval")
def get_approval(id: str = "") -> Any:  # noqa: A002
    if not ID_RE.match(id or ""):
        raise HTTPException(400, "send ?id=<approval id>")
    item = next((i for i in WATCH.feed()["pending"] if i["id"] == id), None)
    notes = _comments(id)
    if item is None and not notes:
        raise HTTPException(404, "that call is not waiting (decided, expired or never seen by the console)")
    return {"ok": True, "approval": item, "waiting": item is not None, "comments": notes}


@router.get("/comments")
def get_comments(id: str = "") -> dict[str, Any]:  # noqa: A002
    if id and not ID_RE.match(id):
        raise HTTPException(400, "id is an approval id")
    rows = _comments(id)
    return {"ok": True, "comments": rows, "count": len(rows)}


@router.post("/comment")
async def post_comment(request: Request) -> dict[str, Any]:
    raw = await request.body()
    try:
        b = json.loads(raw or b"{}") if len(raw) <= 16 * 1024 else {}
    except ValueError:
        b = {}
    aid, text = (b.get("id"), b.get("text")) if isinstance(b, dict) else (None, None)
    if not isinstance(aid, str) or not ID_RE.match(aid) or not isinstance(text, str) or not text.strip():
        raise HTTPException(400, "send { id: <approval id>, text }")
    entry = {"id": aid, "text": " ".join(text.split())[:COMMENT_MAX], "by": _author(request), "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    await run_in_threadpool(_add_comment, entry)
    return {"ok": True, "comment": entry}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": read_settings(), "defaults": SETTINGS_DEFAULTS}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    try:
        b = json.loads(await request.body() or b"{}")
    except ValueError:
        b = None
    if not isinstance(b, dict) or not b:
        raise HTTPException(400, "send { pollSeconds?: 10-300, keepComments?: 10-5000 }")
    for k, v in b.items():
        lo_hi = SETTINGS_RANGES.get(k)
        if lo_hi is None:
            raise HTTPException(400, f"no setting {k} ({', '.join(SETTINGS_RANGES)})")
        if not isinstance(v, int) or isinstance(v, bool) or not lo_hi[0] <= v <= lo_hi[1]:
            raise HTTPException(400, f"{k} is a whole number from {lo_hi[0]} to {lo_hi[1]}")
    s = {**read_settings(), **b}
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".settings-{os.getpid()}"
    tmp.write_text(json.dumps(s, indent=1))
    os.replace(tmp, d / "settings.json")
    return {"ok": True, "settings": s, "changed": sorted(b)}
