"""Approve / Deny in place, with the person's own axHub session (approvals-relay@1).

The hub takes a decision only with its own Origin and the session's CSRF value, which a page on another subdomain can't
send. An app server behind the hub's sign-in wall gets the browser's `axhub_session` cookie (the hub sets it for the
whole domain, `AXHUB_COOKIE_DOMAIN`), so it can post the tap on: it reads the session's CSRF value, then posts the
decision with the hub's Origin. The hub records it as that person (`web:<name>`), exactly as a tap on its own page.

Used by AmberX's server (`/api/approvals/decide`, Brett Nov 8 2026: "The approve and deny dialogue is still saying
open") and mirrored by the console's approvals-banner relay. Rules every caller keeps:
  - only a wall session caller who is a hub admin, from the app's own origin, as JSON; never a token;
  - only the `axhub_session` cookie is sent on, only to the wall's own https hub, redirects refused;
  - the cookie is never stored or logged.
"""
from __future__ import annotations

import json
import re
from typing import Any
from urllib.parse import urlsplit

import httpx

COOKIE = "axhub_session"
# The hub's own id rule (lib-hub isApprovalId).
ID_RE = re.compile(r"^[0-9a-f-]{36}$")
# Veto holds have a route per action; approve + decline go through the plain decide route (approve on a veto call is
# turned into approve-now by the hub itself, axHub decision 105).
VETO_ROUTES = ("deny", "approve-now", "shelve")
PLAIN = ("approve", "decline")
ACTIONS = (*VETO_ROUTES, *PLAIN)
TIMEOUT_S = 12.0
MESSAGE_MAX = 300


def hub_base(raw: str | None) -> str:
    """The wall's hub as `https://host`, or "" (only https, no path)."""
    u = urlsplit((raw or "").strip())
    return f"https://{u.netloc}" if u.scheme == "https" and u.netloc else ""


def _json(r: httpx.Response) -> dict[str, Any]:
    try:
        j = r.json()
        return j if isinstance(j, dict) else {}
    except ValueError:
        return {}


def check_request(body: Any) -> tuple[str, str, Any] | str:
    """(id, action, rev) from a decide body, or the reason it's refused."""
    b = body if isinstance(body, dict) else {}
    aid, action, rev = b.get("id"), b.get("action"), b.get("rev")
    if not isinstance(aid, str) or not ID_RE.match(aid):
        return "Not a request id"
    if action not in ACTIONS:
        return "action must be approve, decline, deny, approve-now or shelve"
    return aid, action, rev


def decide(hub: str, cookie: str, aid: str, action: str, rev: Any, client: httpx.Client) -> dict[str, Any]:
    """Posts one decision to the hub with this session; → {ok, state?, message, status, code?}."""
    head = {"Cookie": f"{COOKIE}={cookie}", "Accept": "application/json"}
    s = client.get(f"{hub}/auth/api/session", headers=head)
    csrf = _json(s).get("csrf") if s.status_code == 200 else None
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
    j = _json(r)
    if r.status_code == 200 and j.get("ok") is not False:
        return {"ok": True, "status": 200, "state": j.get("state"), "message": str(j.get("message") or "")[:MESSAGE_MAX]}
    err = j.get("error") if isinstance(j.get("error"), dict) else {}
    return {"ok": False, "status": r.status_code, "code": str(err.get("code") or "hub_refused"), "state": j.get("state"),
            "message": str(err.get("message") or f"axHub answered {r.status_code}.")[:MESSAGE_MAX]}


def send(hub: str, cookie: str, aid: str, action: str, rev: Any, transport: httpx.BaseTransport | None = None) -> dict[str, Any]:
    """`decide` with its own client (no redirects); an unreachable hub is an answer, never an exception."""
    try:
        with httpx.Client(timeout=TIMEOUT_S, follow_redirects=False, transport=transport) as client:
            return decide(hub, cookie, aid, action, rev, client)
    except httpx.HTTPError as e:
        return {"ok": False, "code": "unreachable", "message": f"Couldn't reach axHub ({type(e).__name__}). Nothing was decided."}
