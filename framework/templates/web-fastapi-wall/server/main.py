"""{{APP_NAME}} — API + web app in one process (AmberX AXF template `web-fastapi-wall`).

Every /api route needs the caller to be allowed: the app token (`Authorization: Bearer $APP_TOKEN`, machines and
local dev) or a browser signed in to axHub as an **admin** (only when the installer turned the wall on; see wall.py).
Signed-in hub *users* (not admins) reach only `/api/health` and `/api/me` until you decide otherwise in `user_may`
(default-deny). Browser-session writes must come from this app's own origin.

Env: APP_TOKEN (required in production; empty = open, local dev only), APP_TRUST_WALL=1 + APP_WALL_SECRET (the
installer sets both), APP_WALL_HUB (hub address for sign-out links), APP_THEMES_PERM (hub permission that lets a
user change themes; default "{{APP_ID}}.themes"), APP_DATA_DIR (default ./data), PORT.

Run: APP_TOKEN=dev uvicorn main:app --app-dir server --port 7290   (npm run dev proxies /api here)
"""
from __future__ import annotations

import hmac
import os
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

import wall

APP_ID = "{{APP_ID}}"
ROOT = Path(__file__).resolve().parent.parent
DIST = Path(os.environ.get("APP_DIST", ROOT / "dist"))
DATA = Path(os.environ.get("APP_DATA_DIR", ROOT / "data"))
HUB = os.environ.get("APP_WALL_HUB", "https://axhub.amberxai.com").rstrip("/")
THEMES_PERM = os.environ.get("APP_THEMES_PERM", f"{APP_ID}.themes")

# Routes a signed-in hub *user* (not admin) may call. Everything else is admin / token only.
USER_PATHS = frozenset({"/api/health", "/api/me"})

app = FastAPI(title="{{APP_NAME}} API", version="0.1.0")


def _token() -> str:
    return os.environ.get("APP_TOKEN", "").strip()


def _token_ok(request: Request) -> bool:
    tok = _token()
    got = request.headers.get("authorization") or ""
    return bool(tok) and hmac.compare_digest(got.encode(), f"Bearer {tok}".encode())


def user_may(caller: wall.Caller, method: str, path: str) -> bool:
    """May this signed-in hub user (not admin) make this request? Default-deny: extend for your app's user features."""
    return caller.admin or (method.upper() in wall.SAFE_METHODS and path.rstrip("/") in USER_PATHS)


@app.middleware("http")
async def _gate(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Runs before every route: bearer-via-hub needs the real token, bad sessions are refused, users are limited."""
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        if request.headers.get("x-auth-via") == "token" and not _token_ok(request):
            return JSONResponse({"detail": "app token required (Authorization: Bearer APP_TOKEN)"}, status_code=401)
        if wall.malformed_session(request.headers) and not _token_ok(request):
            return JSONResponse({"detail": "sign-in not understood: sign in again at the hub, or use the app token"}, status_code=403)
        c = wall.wall_caller(request.headers)
        if c and not c.admin:
            if not user_may(c, request.method, path):
                return JSONResponse({"detail": "admins only: ask an admin to grant you this on the hub"}, status_code=403)
        if c and request.method.upper() not in wall.SAFE_METHODS and not wall.same_origin(request):
            return JSONResponse({"detail": "cross-site request refused"}, status_code=403)
    return await call_next(request)


def caller(request: Request) -> wall.Caller | None:
    """Who is calling: the token (admin), a signed-in hub account, or nobody."""
    if not _token() or _token_ok(request):
        return wall.TOKEN_CALLER
    return wall.wall_caller(request.headers)


def auth(request: Request) -> wall.Caller:
    """Dependency for every /api route: someone allowed must be calling (the middleware already limited users)."""
    c = caller(request)
    if c is None:
        raise HTTPException(401, "unauthorized")
    request.state.caller = c
    return c


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "app": APP_ID}


@app.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    """Who this browser is: with the wall on, the signed-in hub account and its hub-accounts policy role."""
    c = wall.wall_caller(request.headers)
    return {"wall": wall.trusted(), "hub": HUB, "user": c.public() if c else None, "role": wall.ui_role(c, THEMES_PERM) if c else None}


@app.get("/api/hello")
def hello(c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    return {"message": f"Hello {c.name} from {APP_ID}"}


# ---------------------------------------------------------------- the built web app (dist/), single-page fallback

@app.get("/{path:path}", include_in_schema=False)
def web(path: str) -> Any:
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "no such API route")
    if not DIST.is_dir():
        return JSONResponse({"detail": "web app not built (npm run build)"}, status_code=404)
    root = DIST.resolve()
    f = (DIST / path).resolve()
    if path and f.is_file() and f.is_relative_to(root):
        return FileResponse(f)
    return FileResponse(root / "index.html")
