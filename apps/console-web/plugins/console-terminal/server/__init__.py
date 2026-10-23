"""Terminal — server part. Mounted at /api/plugins/console-terminal/ (console token; WebSockets use a one-time ticket from
POST /api/ws-ticket; 404 when disabled).

Tabs: Container (root shell in a container through axf.containers@1; protected ones need a confirm), Console (the
console's own container), VPS (root on the host over SSH with a dedicated key, red HOST ROOT badge), Claude Code (an
interactive CLI session). Sessions live on the server (sessions.py) so Mosh mode survives dropped connections.

  GET  status | targets | sessions | log
  POST sessions {kind, container?, cwd?, confirmProtected?, mosh?, cols, rows}
  POST sessions/{id}/mosh {on}       DELETE sessions/{id}
  WS   sessions/{id}/ws?ticket=…&have=<offset>
  GET/PUT settings      POST ssh/keygen {replace?}
"""
from __future__ import annotations

import asyncio
import json
import os
import shlex
import subprocess
import time
from typing import Any

from fastapi import APIRouter, HTTPException, WebSocket, WebSocketDisconnect

import plugin_services

from . import sessions, store

router = APIRouter()


def _err(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(403, str(e))
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    return HTTPException(502, f"{type(e).__name__}: {e}")


@router.get("/status")
def status() -> dict[str, Any]:
    exe = os.environ.get("CLAUDE_BIN", "claude")
    cli = bool(subprocess.run(["sh", "-c", f"command -v {shlex.quote(exe)}"], capture_output=True).stdout.strip())
    s = store.settings()
    return {"containers": plugin_services.get("axf.containers@1") is not None, "claude": cli, "ssh": bool(subprocess.run(["sh", "-c", "command -v ssh"], capture_output=True).stdout.strip()),
            "vps": {"ready": bool(s["vps"]["host"]) and s["sshKey"], "host": s["vps"]["host"]}, "settings": s, "sessions": sessions.MANAGER.list()}


@router.get("/targets")
def targets() -> dict[str, Any]:
    cs = plugin_services.get("axf.containers@1")
    if not cs:
        return {"available": False, "items": []}
    try:
        items = [{"name": c["name"], "image": c["image"], "state": c["state"], "protected": (c.get("protected") or {}).get("label"), "reachable": c["reachable"]}
                 for c in cs.list() if c["state"] == "running"]
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    return {"available": True, "items": items}


@router.get("/sessions")
def list_sessions() -> dict[str, Any]:
    return {"items": sessions.MANAGER.list()}


@router.post("/sessions")
def open_session(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return sessions.MANAGER.open(body).info()
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/sessions/{sid}/mosh")
def set_mosh(sid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        s = sessions.MANAGER.get(sid)
    except KeyError as e:
        raise _err(e) from None
    s.mosh = bool(body.get("on"))
    return s.info()


@router.delete("/sessions/{sid}")
def close_session(sid: str) -> dict[str, Any]:
    sessions.MANAGER.close(sid, "closed by you")
    return {"ok": True}


@router.websocket("/sessions/{sid}/ws")
async def attach(ws: WebSocket, sid: str) -> None:
    try:
        s = sessions.MANAGER.get(sid)
    except KeyError:
        await ws.close(code=4404)
        return
    await ws.accept()
    loop = asyncio.get_running_loop()
    q: asyncio.Queue = asyncio.Queue()
    try:
        have = int(ws.query_params.get("have") or 0)
    except ValueError:
        have = 0
    replay, reset, offset = s.attach(loop, q, have)
    await ws.send_text(json.dumps({"type": "hello", "id": s.id, "reset": reset, "offset": offset - len(replay), "info": s.info()}))
    if replay:
        await ws.send_bytes(replay)

    async def pump() -> None:
        while True:
            data = await q.get()
            if data is None:
                await ws.send_text(json.dumps({"type": "exit"}))
                await ws.close()
                return
            await ws.send_bytes(data)

    task = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (txt := msg.get("text")) is not None:
                if txt.startswith("\x00resize:"):
                    try:
                        cols, rows = (int(x) for x in txt[8:].split(","))
                        await loop.run_in_executor(None, s.backend.resize, cols, rows)
                    except (ValueError, OSError):
                        pass
                elif txt == "\x00ping":
                    await ws.send_text(json.dumps({"type": "pong"}))
                else:
                    await loop.run_in_executor(None, s.write, txt.encode())
            elif (data := msg.get("bytes")) is not None:
                await loop.run_in_executor(None, s.write, data)
    except (WebSocketDisconnect, RuntimeError, OSError):
        pass
    finally:
        task.cancel()
        s.detach(loop, q)


@router.get("/hub-runs")
def hub_runs(since: int = 0) -> dict[str, Any]:
    """Approved VPS / shell commands that ran through Mosses's axhub_call (capability axf.hub-runs@1, the agent manager),
    newer than `since` (epoch ms): the browser opens an output tab for each new one. Empty without the capability."""
    svc = plugin_services.get("axf.hub-runs@1")
    on = bool(store.settings().get("showHubRuns", True))
    items = svc.runs(max(0, int(since))) if svc and on else []
    return {"available": svc is not None, "on": on, "items": items[-20:], "now": int(time.time() * 1000)}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {**store.settings(), "publicKey": store.public_key()}


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return {**store.save_settings(body), "publicKey": store.public_key()}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/ssh/keygen")
def keygen(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"publicKey": store.keygen(bool(body.get("replace")))}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.get("/log")
def session_log(limit: int = 200) -> dict[str, Any]:
    return {"items": store.read_log(max(1, min(limit, 2000)))}
