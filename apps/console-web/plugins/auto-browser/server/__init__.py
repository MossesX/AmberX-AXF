"""Automated Browser server part. Mounted at /api/plugins/auto-browser/ (console token on every method; the live view's
websocket uses a one-time ticket from POST /api/ws-ticket).

The browser itself runs in the browser host (host/host.mjs, container `axf-browser` on the console's network); this
part relays it so the token and the host address stay on the server. Every body takes an optional `workspace`
(default from the config: one persistent Chromium profile per workspace) and optional `tab`.

    GET    /status                    host reachable?, its health, config
    GET    /config                    PUT /config {hostUrl?, workspace?, device?, quality?, homeUrl?}
    GET    /sessions                  open browsers
    POST   /open                      {workspace?, device?, url?}   open (or return) a workspace's browser
    POST   /close                     {workspace?}                  close it (profile kept)
    GET    /state?workspace=          tabs, active tab, url, device
    POST   /navigate {url}   /back   /forward   /reload   /tab/new {url?}   /tab/activate {tab}   /tab/close {tab?}
    POST   /device {preset}           desktop | phone | tablet
    POST   /click {selector | x,y}   /type {text, selector?}   /fill {selector, value}   /press {key, selector?}
    POST   /select {selector, value}   /scroll {selector | dx,dy}   /wait {selector | url | ms}
    POST   /extract {selector, kind: text|attr|html|value|table|count, attr?, all?}
    POST   /screenshot {selector?, fullPage?}   → {type, data (base64)}; GET /screenshot.png?workspace=
    POST   /run {cmd, args}           any host command by name
    GET    /downloads?workspace=      GET /download?workspace=&name=
    WS     /live?workspace=&device=   frames + state out; input + commands in
"""
from __future__ import annotations

import asyncio
import os
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Query, WebSocket, WebSocketDisconnect
from fastapi.responses import Response

import console_context as cx

from . import health
from .host_client import HostClient, HostError

FOLDER = "auto-browser"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_BROWSER_PLUGIN_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


HOST = HostClient(data_dir() / "config.json")
router = APIRouter()


def _ws(body: dict[str, Any] | None) -> str:
    return str((body or {}).get("workspace") or HOST.config()["workspace"])


def _args(body: dict[str, Any] | None) -> dict[str, Any]:
    return {k: v for k, v in (body or {}).items() if k != "workspace"}


async def _call(fn: Any, *a: Any) -> Any:
    try:
        return await asyncio.get_running_loop().run_in_executor(None, fn, *a)
    except HostError as e:
        raise HTTPException(e.status, e.detail) from e


async def _cmd(cmd: str, body: dict[str, Any] | None) -> Any:
    """Run a command, opening the workspace's browser first when it isn't open yet."""
    ws = _ws(body)
    try:
        return await asyncio.get_running_loop().run_in_executor(None, HOST.run, ws, cmd, _args(body))
    except HostError as e:
        if e.status != 404 or "no open browser" not in e.detail:
            raise HTTPException(e.status, e.detail) from e
    await _call(HOST.ensure, ws, HOST.config()["device"])
    return await _call(HOST.run, ws, cmd, _args(body))


# ---- status + config ---------------------------------------------------------------------------------------------

@router.get("/status")
async def status() -> dict[str, Any]:
    cfg = HOST.config()
    try:
        h = await _call(HOST.health)
        return {"reachable": True, "health": h, "config": cfg}
    except HTTPException as e:
        return {"reachable": False, "error": e.detail, "config": cfg}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return HOST.config()


@router.put("/config")
def put_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return HOST.save_config(body)
    except HostError as e:
        raise HTTPException(e.status, e.detail) from e


# ---- sessions ----------------------------------------------------------------------------------------------------

@router.get("/sessions")
async def sessions() -> Any:
    return await _call(HOST.call, "GET", "/sessions")


@router.post("/open")
async def open_browser(body: dict[str, Any] = Body(default={})) -> Any:
    return await _call(HOST.ensure, _ws(body), body.get("device") or HOST.config()["device"], body.get("url"))


@router.post("/close")
async def close_browser(body: dict[str, Any] = Body(default={})) -> Any:
    from urllib.parse import quote
    return await _call(HOST.call, "DELETE", f"/sessions/{quote(_ws(body), safe='')}")


@router.get("/state")
async def state(workspace: str = "") -> Any:
    return await _cmd("state", {"workspace": workspace} if workspace else {})


# ---- driving -----------------------------------------------------------------------------------------------------

@router.post("/navigate")
async def navigate(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("navigate", body)


@router.post("/back")
async def back(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("back", body)


@router.post("/forward")
async def forward(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("forward", body)


@router.post("/reload")
async def reload(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("reload", body)


@router.post("/tab/new")
async def tab_new(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("newTab", body)


@router.post("/tab/activate")
async def tab_activate(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("activate", body)


@router.post("/tab/close")
async def tab_close(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("closeTab", body)


@router.post("/device")
async def device(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("device", body)


@router.post("/click")
async def click(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("click", body)


@router.post("/type")
async def type_text(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("type", body)


@router.post("/fill")
async def fill(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("fill", body)


@router.post("/press")
async def press(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("press", body)


@router.post("/select")
async def select(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("select", body)


@router.post("/scroll")
async def scroll(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("scroll", body)


@router.post("/wait")
async def wait(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("waitFor", body)


@router.post("/extract")
async def extract(body: dict[str, Any] = Body(...)) -> Any:
    return await _cmd("extract", body)


@router.post("/screenshot")
async def screenshot(body: dict[str, Any] = Body(default={})) -> Any:
    return await _cmd("screenshot", body)


@router.get("/screenshot.png")
async def screenshot_png(workspace: str = "", full: bool = False) -> Response:
    import base64
    r = await _cmd("screenshot", {"workspace": workspace, "fullPage": full} if workspace else {"fullPage": full})
    return Response(base64.b64decode(r["data"]), media_type="image/png", headers={"cache-control": "no-store"})


@router.post("/run")
async def run(body: dict[str, Any] = Body(...)) -> Any:
    cmd = str(body.get("cmd") or "")
    if not cmd:
        raise HTTPException(400, "cmd is required")
    return await _cmd(cmd, {"workspace": body.get("workspace"), **(body.get("args") or {})})


@router.get("/downloads")
async def downloads(workspace: str = "") -> Any:
    from urllib.parse import quote
    return await _call(HOST.call, "GET", f"/sessions/{quote(workspace or HOST.config()['workspace'], safe='')}/downloads")


@router.get("/download")
async def download(name: str = Query(...), workspace: str = "") -> Response:
    from urllib.parse import quote
    ws = quote(workspace or HOST.config()["workspace"], safe="")
    _, raw, _ = await _call(HOST.raw, "GET", f"/sessions/{ws}/downloads/{quote(name, safe='')}")
    safe = name.replace('"', "").replace("\n", "")
    return Response(raw, media_type="application/octet-stream", headers={"content-disposition": f'attachment; filename="{safe}"'})


# ---- live view ---------------------------------------------------------------------------------------------------

@router.websocket("/live")
async def live(ws: WebSocket) -> None:
    """Relays the host's live view: frames and state to the browser, input and commands to the host."""
    workspace = ws.query_params.get("workspace") or HOST.config()["workspace"]
    url, headers = HOST.ws_url(workspace, {"device": ws.query_params.get("device") or ""})
    try:
        upstream = await _connect(url, headers)
    except Exception as e:  # noqa: BLE001 — host down: tell the page why, then close
        await ws.accept()
        await ws.send_json({"t": "error", "error": f"browser host not reachable: {e}"})
        await ws.close(code=4503)
        return
    await ws.accept()

    async def down() -> None:
        async for msg in upstream:
            await ws.send_text(msg if isinstance(msg, str) else msg.decode("utf8", "replace"))

    task = asyncio.create_task(down())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (txt := msg.get("text")) is not None:
                await upstream.send(txt)
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    except Exception:  # noqa: BLE001 — upstream closed mid-send
        pass
    finally:
        task.cancel()
        await upstream.close()


async def _connect(url: str, headers: dict[str, str]) -> Any:
    try:
        from websockets.asyncio.client import connect  # websockets >= 13
        return await connect(url, additional_headers=headers, max_size=8 * 1024 * 1024, open_timeout=60)
    except ImportError:
        import websockets
        return await websockets.connect(url, extra_headers=headers, max_size=8 * 1024 * 1024, open_timeout=60)  # type: ignore[attr-defined]


health.ensure(HOST)


@router.get("/health-check")
def health_check() -> dict[str, Any]:
    """The systems check item, run on demand (also registers it if the systems check loaded after this plugin)."""
    health.ensure(HOST)
    return health.check(HOST)

