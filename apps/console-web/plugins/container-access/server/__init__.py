"""Container access — server part. Mounted at /api/plugins/container-access/ (console token, 404 when disabled).

The master switch for reaching other containers on the VPS: it's the only code that talks to the Docker socket proxy,
and it provides ``axf.containers@1`` (see service.py). Uninstall it and nothing in the console can touch another
container. Consumers: Snapshot Manager (``axf.snapshots@1``), the agent manager's container tools, the terminal.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import plugin_services

from . import store
from .docker_api import DockerError
from .service import ContainersService

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SERVICE = ContainersService()
plugin_services.provide("axf.containers@1", SERVICE, FOLDER)
USER = {"kind": "user", "id": "console", "name": "Brett (console)"}


def _err(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(403, str(e))
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    if isinstance(e, DockerError):
        return HTTPException(502 if e.status not in (400, 404, 409) else 400, f"Docker: {e}")
    return HTTPException(500, f"{type(e).__name__}: {e}")


def _wrap(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise _err(e) from e


@router.get("/status")
def status() -> dict[str, Any]:
    return {"proxy": SERVICE.status(), "snapshots": plugin_services.get("axf.snapshots@1") is not None,
            "coolify": bool(__import__("os").environ.get("COOLIFY_URL") and __import__("os").environ.get("COOLIFY_TOKEN")),
            "settings": store.settings(), "builtinProtected": [{"id": r["id"], "label": r["label"]} for r in store.BUILTIN]}


@router.get("/containers")
def containers() -> dict[str, Any]:
    return {"items": _wrap(SERVICE.list)}


@router.get("/containers/{name}/dir")
def list_dir(name: str, path: str = "/") -> dict[str, Any]:
    return _wrap(SERVICE.list_dir, name, path)


@router.get("/containers/{name}/file")
def read_file(name: str, path: str) -> dict[str, Any]:
    return _wrap(SERVICE.read_file, name, path)


@router.get("/containers/{name}/workdir")
def workdir(name: str) -> dict[str, Any]:
    return {"workdir": _wrap(SERVICE.workdir, name)}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return store.settings()


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    s = _wrap(store.save_settings, body)
    store.audit({"op": "settings", "actor": USER, "ok": True, "reach": s["reach"], "protect": s["protect"], "allow": s["allow"]})
    return s


@router.get("/audit")
def audit(limit: int = 200, container: str = "", op: str = "", batch: str = "") -> dict[str, Any]:
    return {"items": store.read_audit(max(1, min(limit, 2000)), container, op, batch)}


@router.get("/batches")
def batches(status: str = "", conversation: str = "", limit: int = 50) -> dict[str, Any]:
    return {"items": [_public(b) for b in store.list_batches(status, conversation, max(1, min(limit, 200)))]}


@router.get("/batches/{bid}")
def batch(bid: str) -> dict[str, Any]:
    return _public(_wrap(store.get_batch, bid))


@router.post("/batches/{bid}/reject")
def reject(bid: str) -> dict[str, Any]:
    return _public(_wrap(SERVICE.reject_batch, bid, USER))


@router.post("/batches/{bid}/undo")
def undo(bid: str, body: dict[str, Any]) -> dict[str, Any]:
    if body.get("confirm") != "undo":
        raise HTTPException(400, 'send {"confirm": "undo"}')
    return _public(_wrap(SERVICE.undo_batch, bid, USER))


@router.post("/batches/{bid}/approve")
def approve(bid: str, body: dict[str, Any]) -> StreamingResponse:
    """Server-sent events: snapshot-start, snapshot, item-start, output, item-done, done | error, then batch."""
    items = body.get("items")
    return StreamingResponse(SERVICE.approve_stream(bid, items if isinstance(items, list) else None, USER), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})




_public = SERVICE.public_batch
