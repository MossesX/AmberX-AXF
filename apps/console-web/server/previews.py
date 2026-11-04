"""Watch live (watch-live@1): the console side of a headless session's live previews.

framework/cli/watch-live.mjs (started by deploy/claude-headless.sh next to every headless session) runs a hot-reloading
preview for each app the session touches and writes one registry file per session. This module reads that registry
and proxies each preview at ``/preview/<session>/<app>/…`` (HTTP and the HMR WebSocket) behind the console's own auth,
so previews never get a public port. Who may watch: whoever may use the console API (the console token, or an axHub
admin behind the wall); an iframe can't send the token, so ``GET /api/previews`` hands out a signed key per preview
(``?axfKey=``, 12 h) that the proxy turns into a cookie scoped to that one preview's path.
"""
from __future__ import annotations

import asyncio
import hashlib
import hmac
import http.client
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import HTTPException, Request, WebSocket
from fastapi.responses import JSONResponse, RedirectResponse, StreamingResponse
from starlette.concurrency import run_in_threadpool

CONTRACT = "watch-live@1"
STALE_MS = 120_000  # = framework/cli/watch-live.mjs STALE_MS
NAME_RE = re.compile(r"^[A-Za-z0-9._-]{1,64}$")
KEY_PARAM = "axfKey"
COOKIE = "axf_pv"
KEY_TTL = 12 * 3600
HOP = {"connection", "keep-alive", "date", "server", "proxy-authenticate", "proxy-authorization", "te", "trailer", "transfer-encoding", "upgrade",
       "host", "cookie", "authorization", "x-auth-via", "content-length", "origin", "referer"}
ANDROID_NOTE = ("Android/Compose screen shown through the web port: asset and layout changes render live here; "
                "Kotlin/Compose code changes only show in the next APK.")


def registry_dir(root: Path) -> Path:
    env = os.environ.get("AXF_PREVIEW_REGISTRY", "")
    return Path(env) if env else root / ".axf-console" / "previews"


def list_entries(directory: Path, now_ms: float | None = None) -> list[dict[str, Any]]:
    """Every live session entry; stale (no heartbeat for 2 min) and broken files are skipped."""
    now_ms = now_ms if now_ms is not None else time.time() * 1000
    out: list[dict[str, Any]] = []
    if not directory.is_dir():
        return out
    for f in sorted(directory.glob("*.json")):
        try:
            e = json.loads(f.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            continue
        if not isinstance(e, dict) or e.get("contract") != CONTRACT or not NAME_RE.match(str(e.get("session", ""))):
            continue
        if now_ms - float(e.get("updatedAt") or 0) >= STALE_MS:
            continue
        out.append(e)
    return out


def find(directory: Path, session: str, app: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
    if not (NAME_RE.match(session) and NAME_RE.match(app)):
        return None
    for e in list_entries(directory):
        if e.get("session") == session:
            a = (e.get("apps") or {}).get(app)
            if isinstance(a, dict):
                return e, a
    return None


def sign(secret: str, session: str, app: str, now: float | None = None) -> str:
    exp = int((now if now is not None else time.time()) + KEY_TTL)
    mac = hmac.new(secret.encode(), f"{session}/{app}/{exp}".encode(), hashlib.sha256).hexdigest()[:40]
    return f"{exp}.{mac}"


def key_ok(secret: str, session: str, app: str, key: str | None, now: float | None = None) -> bool:
    if not secret or not key or "." not in key:
        return False
    exp_s, mac = key.split(".", 1)
    if not exp_s.isdigit() or int(exp_s) < (now if now is not None else time.time()):
        return False
    want = hmac.new(secret.encode(), f"{session}/{app}/{exp_s}".encode(), hashlib.sha256).hexdigest()[:40]
    return hmac.compare_digest(want, mac)


def focus_for(entry: dict[str, Any], app: str) -> dict[str, Any] | None:
    f = entry.get("focus")
    if not isinstance(f, dict) or not f.get("selector") and not f.get("note"):
        return None
    if f.get("app") and f.get("app") != app:
        return None
    return {k: f[k] for k in ("app", "route", "selector", "note", "auto", "at") if k in f}


def public_items(directory: Path, secret: str) -> list[dict[str, Any]]:
    """What the console UI gets: one item per (session, app) with its proxied URL (and key when the console has a token)."""
    items: list[dict[str, Any]] = []
    for e in list_entries(directory):
        s = str(e["session"])
        for app, a in sorted((e.get("apps") or {}).items()):
            if not isinstance(a, dict) or not NAME_RE.match(str(app)):
                continue
            focus = focus_for(e, app)
            route = str((focus or {}).get("route") or a.get("route") or "").lstrip("/")
            path, _, frag = route.partition("#")
            url = f"/preview/{s}/{app}/{path}"
            if secret:
                url += ("&" if "?" in url else "?") + f"{KEY_PARAM}={sign(secret, s, app)}"
            if frag:
                url += f"#{frag}"
            items.append({
                "session": s, "app": app, "label": a.get("label") or app, "status": a.get("status") or "starting", "why": a.get("why") or "",
                "url": url if a.get("status") == "ready" else "", "focus": focus, "android": bool(a.get("android")),
                "note": a.get("note") or (ANDROID_NOTE if a.get("android") else ""), "branch": e.get("branch") or "", "change": e.get("change") or "",
                "worktree": e.get("worktree") or "", "updatedAt": e.get("updatedAt") or 0,
            })
    return items


def upstream(entry: dict[str, Any], app_entry: dict[str, Any], path: str) -> tuple[str, int, str] | None:
    """Where a proxied path goes: (host, port, path). `__axf/assets/…` goes to the asset server (`axf dev`), the rest
    to the app's Vite server, which is started with base /preview/<session>/<app>/ and so gets the full path."""
    host = str(entry.get("host") or "127.0.0.1")
    if not re.fullmatch(r"[A-Za-z0-9.:-]{1,64}", host):
        return None
    marker = f"/preview/{entry['session']}/{app_entry.get('app', '')}/__axf/assets/"
    if path.startswith(marker):
        port = app_entry.get("assetsPort")
        return (host, int(port), "/" + path[len(marker):]) if isinstance(port, int) else None
    port = app_entry.get("port")
    return (host, int(port), path) if isinstance(port, int) and app_entry.get("status") == "ready" else None


def forward_headers(headers: Any, port: int) -> dict[str, str]:
    out = {k: v for k, v in headers.items() if k.lower() not in HOP}
    out["host"] = f"localhost:{port}"
    return out


def strip_key(query: str) -> str:
    return "&".join(p for p in query.split("&") if p and not p.startswith(f"{KEY_PARAM}="))


def mount(app: Any, root: Path, current_token: Callable[[], str], allowed: Callable[[Any, str, str], bool]) -> None:
    """Adds GET /api/previews and the /preview proxy (HTTP + WebSocket). `allowed(conn, session, app)` = the caller
    may use the console (token / wall admin / open console); the signed preview key is checked here."""
    def may(conn: Any, session: str, name: str) -> bool:
        if allowed(conn, session, name):
            return True
        tok = current_token()
        return key_ok(tok, session, name, conn.query_params.get(KEY_PARAM)) or key_ok(tok, session, name, conn.cookies.get(COOKIE))

    @app.get("/api/previews")
    def api_previews(request: Request) -> dict[str, Any]:
        if not allowed(request, "", ""):
            raise HTTPException(401, "unauthorized")
        return {"contract": CONTRACT, "items": public_items(registry_dir(root), current_token())}

    @app.api_route("/preview/{session}/{name}", methods=["GET", "HEAD"])
    def preview_root(session: str, name: str, request: Request) -> Any:
        q = request.url.query
        return RedirectResponse(f"/preview/{session}/{name}/" + (f"?{q}" if q else ""), status_code=307)

    @app.api_route("/preview/{session}/{name}/{rest:path}", methods=["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"])
    async def preview_http(session: str, name: str, rest: str, request: Request) -> Any:
        if not may(request, session, name):
            return JSONResponse({"detail": "sign in to the console to watch this preview"}, status_code=401)
        hit = find(registry_dir(root), session, name)
        if not hit:
            return JSONResponse({"detail": "no live preview (the session ended or hasn't touched this app)"}, status_code=404)
        entry, a = hit
        up = upstream(entry, {**a, "app": name}, request.url.path)
        if not up:
            return JSONResponse({"detail": f"preview {a.get('status') or 'not ready'}: {a.get('why') or 'starting'}"}, status_code=503)
        host, port, path = up
        q = strip_key(request.url.query)
        body = await request.body()
        headers = forward_headers(request.headers, port)

        def call() -> tuple[http.client.HTTPConnection, http.client.HTTPResponse]:
            conn = http.client.HTTPConnection(host, port, timeout=60)
            conn.request(request.method, path + (f"?{q}" if q else ""), body=body or None, headers=headers)
            return conn, conn.getresponse()

        try:
            conn, resp = await run_in_threadpool(call)
        except OSError as e:
            return JSONResponse({"detail": f"preview not answering yet ({type(e).__name__})"}, status_code=502)
        out_headers = {k: v for k, v in resp.getheaders() if k.lower() not in HOP and k.lower() != "set-cookie"}

        async def stream() -> Any:
            try:
                while True:
                    chunk = await run_in_threadpool(resp.read, 65536)
                    if not chunk:
                        break
                    yield chunk
            finally:
                conn.close()

        r = StreamingResponse(stream(), status_code=resp.status, headers=out_headers)
        key = request.query_params.get(KEY_PARAM)
        if key and key_ok(current_token(), session, name, key):
            r.set_cookie(COOKIE, key, max_age=KEY_TTL, path=f"/preview/{session}/{name}/", httponly=True, samesite="strict",
                         secure=request.headers.get("x-forwarded-proto", request.url.scheme) == "https")
        return r

    @app.websocket("/preview/{session}/{name}/{rest:path}")
    async def preview_ws(ws: WebSocket, session: str, name: str, rest: str) -> None:
        if not may(ws, session, name):
            await ws.close(code=4401)
            return
        hit = find(registry_dir(root), session, name)
        up = upstream(hit[0], {**hit[1], "app": name}, ws.url.path) if hit else None
        if not up:
            await ws.close(code=4404)
            return
        try:
            from websockets.asyncio.client import connect  # uvicorn[standard] ships it
        except ImportError:
            await ws.close(code=1011)
            return
        host, port, path = up
        q = strip_key(ws.url.query)
        protos = [p.strip() for p in ws.headers.get("sec-websocket-protocol", "").split(",") if p.strip()]
        try:
            async with connect(f"ws://{host}:{port}{path}" + (f"?{q}" if q else ""), subprotocols=protos or None,  # type: ignore[arg-type]
                               open_timeout=10) as upws:
                await ws.accept(subprotocol=upws.subprotocol)

                async def down() -> None:
                    async for msg in upws:
                        await (ws.send_text(msg) if isinstance(msg, str) else ws.send_bytes(msg))

                async def upward() -> None:
                    while True:
                        m = await ws.receive()
                        if m.get("type") == "websocket.disconnect":
                            return
                        await upws.send(m["text"] if m.get("text") is not None else m.get("bytes") or b"")

                tasks = [asyncio.create_task(down()), asyncio.create_task(upward())]
                _, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
                for t in pending:
                    t.cancel()
        except Exception:  # noqa: BLE001 — preview restarting or gone: the page's HMR client reconnects
            pass
        try:
            await ws.close()
        except Exception:  # noqa: BLE001
            pass
