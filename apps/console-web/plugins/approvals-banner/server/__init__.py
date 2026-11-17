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

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import approvals_relay as relay_core

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


# ---- axf.hub-relay@1: the same session for the Hub plugin's reads and writes (hub-console@1, Nov 17 2026)

RELAY_CAP = "axf.hub-relay@1"


class RelayService:
    """What the Hub plugin (hub-admin) borrows: one `/auth/api` read or write through the console's own hub session, the
    cookie never leaving this module. Reads use the tapping browser's session, else the owner sign-in. A write marked
    `person` goes only for a wall admin's same-origin browser request (Brett's own tap); any other write (a `confirm` or
    `command` action of the route table) may come from the console token too and is audited in relay.jsonl."""

    def state(self, request: Request) -> dict[str, Any]:
        return relay_state(wall.wall_caller(request.headers), bool(request.cookies.get(COOKIE)))

    def _sessions(self, request: Request, c: wall.Caller | None) -> list[tuple[str, str]]:
        out: list[tuple[str, str]] = []
        cookie = request.cookies.get(COOKIE) or ""
        if cookie:
            out.append(("browser", cookie))
        return out

    def read(self, request: Request, path: str, params: dict[str, Any] | None = None, timeout: float = TIMEOUT_S) -> dict[str, Any]:
        """→ {ok, status, json, via} or {ok: False, code: signed_out | unreachable | old_hub | forbidden | hub_error, status, message}."""
        hub = hub_base()
        if not hub:
            return {"ok": False, "code": "unreachable", "status": 0, "message": "The console has no https hub address (AXF_WALL_HUB)."}
        c = wall.wall_caller(request.headers)
        cred = owner_credential() if (c is None or owner_may(c) or getattr(getattr(request, "state", None), "axf_user", None) is not None) else None
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False) as client:
                for via, cookie in self._sessions(request, c):
                    r = relay_core.get_json(hub, cookie, path, client, params)
                    if r["status"] != 401:
                        return _read_reply(r, via)
                if cred:
                    for attempt in (1, 2):
                        s = OWNER.get(hub, cred, client)
                        if not s["ok"]:
                            return {"ok": False, "code": s.get("code", "signed_out"), "status": 0, "message": s.get("message", "")}
                        r = relay_core.get_json(hub, s["cookie"], path, client, params)
                        if r["status"] != 401:
                            return _read_reply(r, "owner")
                        OWNER.drop(s["cookie"])
        except httpx.HTTPError as e:
            return {"ok": False, "code": "unreachable", "status": 0, "message": f"Couldn't reach axHub ({type(e).__name__})."}
        return {"ok": False, "code": "signed_out", "status": 401, "message": NO_CREDENTIAL if not cred else "axHub didn't take any session."}

    def write(self, request: Request, path: str, body: Any, person: bool, timeout: float = TIMEOUT_S) -> dict[str, Any]:
        c = wall.wall_caller(request.headers)
        if person and (c is None or not c.admin or not wall.same_origin(request)):
            return {"ok": False, "code": "person_required", "status": 403, "message": "Only your own tap in your signed-in console browser does this."}
        hub = hub_base()
        if not hub:
            return {"ok": False, "code": "unreachable", "status": 0, "message": "The console has no https hub address (AXF_WALL_HUB)."}
        cred = owner_credential() if (c is None or owner_may(c)) else None
        who = c.name if c else "token"
        out: dict[str, Any]
        try:
            with httpx.Client(timeout=timeout, follow_redirects=False) as client:
                out = {"ok": False, "code": "signed_out", "status": 401, "message": NO_CREDENTIAL if not cred else "axHub didn't take any session."}
                for via, cookie in self._sessions(request, c):
                    r = relay_core.post_json(hub, cookie, path, body, client)
                    if r.get("code") != "no_session":
                        out = _write_reply(r, via)
                        break
                else:
                    if cred:
                        for attempt in (1, 2):
                            s = OWNER.get(hub, cred, client)
                            if not s["ok"]:
                                out = {"ok": False, "code": s.get("code", "signed_out"), "status": 0, "message": s.get("message", "")}
                                break
                            r = relay_core.post_json(hub, s["cookie"], path, body, client)
                            if r.get("code") != "no_session":
                                out = _write_reply(r, "owner")
                                break
                            OWNER.drop(s["cookie"])
        except httpx.HTTPError as e:
            out = {"ok": False, "code": "unreachable", "status": 0, "message": f"Couldn't reach axHub ({type(e).__name__})."}
        _log({"by": who, "path": path, "person": person, "ok": out["ok"], "via": out.get("via", ""), "status": out.get("status"), "code": out.get("code", "")})
        return out


def _read_reply(r: dict[str, Any], via: str) -> dict[str, Any]:
    st = r["status"]
    if st == 200:
        return {"ok": True, "status": 200, "json": r["json"], "via": via}
    code = "old_hub" if st == 404 else "forbidden" if st == 403 else "hub_error"
    err = r["json"].get("error") if isinstance(r["json"].get("error"), dict) else {}
    return {"ok": False, "code": code, "status": st, "via": via, "message": str(err.get("message") or f"axHub answered {st}.")[:MESSAGE_MAX]}


def _write_reply(r: dict[str, Any], via: str) -> dict[str, Any]:
    if r["status"] == 200:
        return {"ok": True, "status": 200, "json": r["json"], "via": via}
    err = r["json"].get("error") if isinstance(r["json"].get("error"), dict) else {}
    return {"ok": False, "status": r["status"], "via": via, "code": str(r.get("code") or err.get("code") or "hub_refused"), "json": r["json"],
            "message": str(err.get("message") or f"axHub answered {r['status']}.")[:MESSAGE_MAX]}


plugin_services.provide(RELAY_CAP, RelayService(), FOLDER)

