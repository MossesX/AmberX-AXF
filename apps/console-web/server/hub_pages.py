"""The hub's own pages inside the console (hub-pages@1): one relay from the console's axHub plugins to the hub's JSON API.

Brett, Nov 19 2026: every axHub web page becomes a console plugin and apps/axhub-web retires. Those pages call the
hub's `/auth/api/*` (axHub decision #96), which takes a call only from a browser session: the `axhub_session` cookie,
the session's CSRF value (`X-AxHub-CSRF`) and the hub's own Origin. A page on the console's origin can't send that,
so the console's axHub plugins call this relay and it calls the hub for them.

  GET  /api/hub-pages/<path>?<query>     → GET  <hub>/<path>?<query>    (path: auth/api/… or apps.json)
  POST /api/hub-pages/<path>  {json}     → POST <hub>/<path> with Origin + CSRF read from the same session
  GET  /api/hub-pages-state              → {ok, relay, via, reason}: can this browser use the hub's pages here

What keeps it a person's own browser, never a session:
  - only a browser the wall signed in as a hub admin; the console token alone (every Claude session, MCP, the CLI)
    is refused, so nothing an AI client holds reads or changes the hub through it;
  - writes must come from the console's own origin as JSON (`wall.same_origin`), like every browser write;
  - only the `axhub_session` cookie is sent on, only to the wall's own https hub, redirects refused, replies capped;
  - when the browser brings no hub session (its cookie is host-only on the hub), the console's server-side owner
    sign-in is used instead, the same one the approvals relay uses: AXF_HUB_RELAY_USER + AXF_HUB_RELAY_PASSWORD (env
    only), optionally narrowed to AXF_HUB_RELAY_OWNERS. The hub then records writes as that account;
  - the session reply never carries the CSRF value back to the page; nothing secret is logged. `hub-pages.jsonl` in
    the console's state folder records every write: who, which path, the status.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

import httpx
from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import data_store
import wall

COOKIE = "axhub_session"
COOKIE_RE = re.compile(rf"(?:^|,\s*){COOKIE}=([^;,\s]+)")
# The hub paths the pages use: its JSON API and the app catalog. Nothing else goes through.
PATH_RE = re.compile(r"^(auth/api(/[A-Za-z0-9][A-Za-z0-9._-]{0,99}){0,6}|apps\.json)$")
QUERY_MAX = 2000
BODY_MAX = 256_000
REPLY_MAX = 2_000_000
TIMEOUT_S = 15.0
NO_CREDENTIAL = ("This browser's axHub session didn't reach the console, and the console server has no axHub owner "
                 "sign-in (AXF_HUB_RELAY_USER / AXF_HUB_RELAY_PASSWORD). Settings → Plugins → Systems check → "
                 "Approvals relay says how to set it.")


def hub_base() -> str:
    """The wall's hub (same value as /api/me), https only; '' when it can't be trusted."""
    hub = os.environ.get("AXF_WALL_HUB", "https://axhub.amberxai.com").strip().rstrip("/")
    u = urlsplit(hub)
    return hub if u.scheme == "https" and u.hostname and not u.path and not u.query else ""


def owner_credential() -> tuple[str, str] | None:
    u = (os.environ.get("AXF_HUB_RELAY_USER") or "").strip()
    p = os.environ.get("AXF_HUB_RELAY_PASSWORD") or ""
    return (u, p) if u and p else None


def owner_may(c: wall.Caller) -> bool:
    if not c.admin:
        return False
    names = {n.strip().lower() for n in (os.environ.get("AXF_HUB_RELAY_OWNERS") or "").split(",") if n.strip()}
    return not names or c.name.lower() in names


def valid_path(path: str) -> bool:
    return bool(PATH_RE.match(path)) and ".." not in path


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
        return {"ok": False, "message": "The console's axHub sign-in must pick a new password first (sign in to axHub as that account once)."}
    if cookie and r.status_code in (302, 303):
        return {"ok": True, "cookie": cookie}
    if "err=busy" in where:
        return {"ok": False, "message": "axHub is slowing sign-ins down right now. Try again in a minute."}
    return {"ok": False, "message": "axHub refused the console's sign-in (AXF_HUB_RELAY_USER / AXF_HUB_RELAY_PASSWORD)."}


def _json(r: httpx.Response) -> Any:
    if len(r.content) > REPLY_MAX:
        return {"error": {"code": "too_large", "message": "Reply too large."}}
    try:
        return r.json()
    except ValueError:
        return None


def call_hub(hub: str, cookie: str, method: str, path: str, query: str, body: Any, client: httpx.Client) -> tuple[int, Any]:
    """One call with one session cookie. Writes read the session's CSRF value first. → (status, json)."""
    head = {"Cookie": f"{COOKIE}={cookie}", "Accept": "application/json"} if cookie else {"Accept": "application/json"}
    url = f"{hub}/{path}" + (f"?{query}" if query else "")
    if method == "GET":
        r = client.get(url, headers=head)
        return r.status_code, _json(r)
    s = client.get(f"{hub}/auth/api/session", headers=head)
    sj = _json(s) if s.status_code == 200 else None
    csrf = sj.get("csrf") if isinstance(sj, dict) else None
    if not isinstance(csrf, str) or not csrf:
        return 401, {"error": {"code": "no_session", "message": "axHub didn't take the session. Sign in to axHub again."}}
    r = client.post(url, headers={**head, "Origin": hub, "Content-Type": "application/json", "X-AxHub-CSRF": csrf},
                    content=json.dumps(body if body is not None else {}))
    return r.status_code, _json(r)


def _signed_out(status: int, j: Any) -> bool:
    """Did the hub not take this session (so the owner sign-in may be tried)?"""
    if status == 401:
        return True
    return isinstance(j, dict) and j.get("signedIn") is False


def _scrub(path: str, j: Any) -> Any:
    """The session reply never carries the CSRF value to the page (the relay reads it itself)."""
    if path == "auth/api/session" and isinstance(j, dict):
        return {k: v for k, v in j.items() if k != "csrf"}
    return j


def relay_state(c: wall.Caller | None, has_cookie: bool) -> dict[str, Any]:
    if not hub_base():
        return {"relay": False, "via": "", "reason": "The console has no https hub address (AXF_WALL_HUB)."}
    if c is None or not c.admin:
        return {"relay": False, "via": "", "reason": "Only your own signed-in console browser (an axHub admin) can open the hub's pages here."}
    if has_cookie:
        return {"relay": True, "via": "browser", "reason": ""}
    if owner_credential() and owner_may(c):
        return {"relay": True, "via": "owner", "reason": ""}
    return {"relay": False, "via": "", "reason": NO_CREDENTIAL}


def router_for(state_dir: Path, client_factory: Callable[[], httpx.Client] | None = None, owner: OwnerSession = OWNER) -> APIRouter:
    """The relay's routes. `client_factory` lets tests stand in for the hub."""
    router = APIRouter()
    make = client_factory or (lambda: httpx.Client(timeout=TIMEOUT_S, follow_redirects=False))

    def log(entry: dict[str, Any]) -> None:
        # no-json-data@1: the write goes through the data layer (a journal), never a bare file append
        try:
            state_dir.mkdir(parents=True, exist_ok=True)
            data_store.append_jsonl(state_dir / "hub-pages.jsonl", {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), **entry})
        except (OSError, data_store.DataStoreError):
            pass

    def caller(request: Request) -> wall.Caller:
        c = wall.wall_caller(request.headers)
        if c is None or not c.admin:
            raise HTTPException(403, "Only your own signed-in browser (an axHub admin) can open the hub's pages here")
        return c

    @router.get("/api/hub-pages-state")
    def get_state(request: Request) -> dict[str, Any]:
        return {"ok": True, "hub": hub_base(), **relay_state(wall.wall_caller(request.headers), bool(request.cookies.get(COOKIE)))}

    async def relay(request: Request, path: str, method: str) -> JSONResponse:
        c = caller(request)
        if not valid_path(path):
            raise HTTPException(400, "Not one of the hub's page paths")
        query = request.url.query
        if len(query) > QUERY_MAX:
            raise HTTPException(414, "Query too long")
        body: Any = None
        if method == "POST":
            if not wall.same_origin(request):
                raise HTTPException(403, "Only from the console's own pages")
            if "application/json" not in (request.headers.get("content-type") or ""):
                raise HTTPException(415, "Send JSON")
            raw = await request.body()
            if len(raw) > BODY_MAX:
                raise HTTPException(413, "Too large")
            try:
                body = json.loads(raw or b"{}")
            except ValueError:
                raise HTTPException(400, "Send JSON") from None
        hub = hub_base()
        if not hub:
            raise HTTPException(503, "The console has no https hub address (AXF_WALL_HUB)")
        cookie = request.cookies.get(COOKIE) or ""
        cred = owner_credential() if owner_may(c) else None

        def send() -> tuple[int, Any, str]:
            with make() as client:
                if cookie:
                    st, j = call_hub(hub, cookie, method, path, query, body, client)
                    if not _signed_out(st, j) or not cred:
                        return st, j, "browser"
                if not cred:
                    # No session of any kind: say so the way the hub's session route would.
                    if path == "auth/api/session":
                        return 200, {"signedIn": False, "hub": hub, "loginUrl": f"{hub}/auth/login", "reason": NO_CREDENTIAL}, ""
                    return 401, {"error": {"code": "no_credential", "message": NO_CREDENTIAL}}, ""
                for _ in (1, 2):
                    s = owner.get(hub, cred, client)
                    if not s["ok"]:
                        return 502, {"error": {"code": "owner_refused", "message": s["message"]}}, "owner"
                    st, j = call_hub(hub, s["cookie"], method, path, query, body, client)
                    if not _signed_out(st, j):
                        return st, j, "owner"
                    owner.drop(s["cookie"])
                return st, j, "owner"

        try:
            status, j, via = await run_in_threadpool(send)
        except httpx.HTTPError as e:
            status, j, via = 502, {"error": {"code": "unreachable", "message": f"Couldn't reach axHub ({type(e).__name__})."}}, ""
        if method == "POST":
            log({"by": c.name, "path": path, "status": status, "via": via})
        out = _scrub(path, j)
        if path == "auth/api/session" and isinstance(out, dict):
            out = {**out, "via": via}
        return JSONResponse(out, status_code=status if 100 <= status < 600 else 502,
                            headers={"Cache-Control": "no-store", "X-Hub-Via": via})

    @router.get("/api/hub-pages/{path:path}")
    async def get_page(request: Request, path: str) -> JSONResponse:
        return await relay(request, path, "GET")

    @router.post("/api/hub-pages/{path:path}")
    async def post_page(request: Request, path: str) -> JSONResponse:
        return await relay(request, path, "POST")

    return router
