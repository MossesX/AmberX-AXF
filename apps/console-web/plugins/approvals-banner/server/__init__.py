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
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path
from typing import Any
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

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


@router.get("/relay")
def get_relay(request: Request) -> dict[str, Any]:
    """Decides in place only for a wall admin's browser carrying the hub session (AmberX's forwarding gets relay: false)."""
    c = wall.wall_caller(request.headers)
    return {"ok": True, "relay": bool(c and c.admin and request.cookies.get(COOKIE) and hub_base())}


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
    cookie = request.cookies.get(COOKIE)
    if not cookie:
        return {"ok": False, "code": "no_session", "message": "This browser has no axHub session. Sign in to axHub, then tap it again."}

    def send() -> dict[str, Any]:
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False) as client:
            return relay_decision(hub, cookie, aid, action, rev, client)

    try:
        r = await run_in_threadpool(send)
    except httpx.HTTPError as e:
        r = {"ok": False, "code": "unreachable", "message": f"Couldn't reach axHub ({type(e).__name__}). Nothing was decided."}
    _log({"by": c.name, "id": aid, "action": action, "ok": r["ok"], "status": r.get("status"), "code": r.get("code", "")})
    return r
