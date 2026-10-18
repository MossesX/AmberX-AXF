"""Snapshot Manager — server part. Mounted at /api/plugins/snapshot-manager/ (console token, 404 when disabled).

Provides ``axf.snapshots@1`` (snapshots.py): take / list / get / diff / restore / delete / prune / usage. Uses
``axf.containers@1`` to read and restore container files; without it there is nothing to snapshot. Container access
refuses to apply any change batch while this service is missing, so nothing is ever written without a snapshot.
"""
from __future__ import annotations

import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import plugin_services

from . import snapshots

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SERVICE = snapshots.SnapshotsService()
plugin_services.provide("axf.snapshots@1", SERVICE, FOLDER)
USER = {"kind": "user", "id": "console", "name": "Brett (console)"}


def _err(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(403, str(e))
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    return HTTPException(502, f"{type(e).__name__}: {e}")


def _wrap(fn, *a, **kw):
    try:
        return fn(*a, **kw)
    except HTTPException:
        raise
    except Exception as e:  # noqa: BLE001
        raise _err(e) from e


def _pruner() -> None:
    while True:
        time.sleep(3600)
        try:
            if plugin_services.get("axf.snapshots@1") is SERVICE:
                SERVICE.prune()
        except Exception:  # noqa: BLE001
            pass


threading.Thread(target=_pruner, daemon=True, name="snapshot-prune").start()


@router.get("/status")
def status() -> dict[str, Any]:
    cs = plugin_services.get("axf.containers@1")
    return {"containers": cs is not None, "usage": SERVICE.usage(), "settings": snapshots.settings()}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return snapshots.settings()


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    s = _wrap(snapshots.save_settings, body)
    SERVICE.prune()
    return s


@router.get("/snapshots")
def list_snapshots(container: str = "", batch: str = "", limit: int = 200) -> dict[str, Any]:
    return {"items": SERVICE.list(container, batch, max(1, min(limit, 2000))), "usage": SERVICE.usage()}


@router.post("/snapshots")
def take(body: dict[str, Any]) -> dict[str, Any]:
    paths = body.get("paths") or []
    if not isinstance(paths, list) or not paths:
        raise HTTPException(400, "paths: a list of absolute paths")
    return _wrap(SERVICE.take, str(body.get("container") or ""), [str(p) for p in paths][:20], reason=str(body.get("reason") or "manual snapshot"), actor=USER)


@router.get("/snapshots/{sid}")
def get(sid: str) -> dict[str, Any]:
    return _wrap(SERVICE.get, sid)


@router.get("/snapshots/{sid}/diff")
def diff(sid: str, file: str = "") -> dict[str, Any]:
    return _wrap(SERVICE.diff, sid, file)


@router.post("/snapshots/{sid}/restore")
def restore(sid: str, body: dict[str, Any]) -> dict[str, Any]:
    if body.get("confirm") != "restore":
        raise HTTPException(400, 'send {"confirm": "restore"}')
    return _wrap(SERVICE.restore, sid, USER)


@router.delete("/snapshots/{sid}")
def delete(sid: str) -> dict[str, Any]:
    return _wrap(SERVICE.delete, sid)


@router.post("/prune")
def prune() -> dict[str, Any]:
    return SERVICE.prune()


@router.get("/containers")
def containers() -> dict[str, Any]:
    cs = plugin_services.get("axf.containers@1")
    if not cs:
        return {"items": [], "available": False}
    return {"items": [c for c in _wrap(cs.list) if c["reachable"]], "available": True}


@router.get("/changes")
def changes(limit: int = 200, container: str = "", batch: str = "") -> dict[str, Any]:
    """The audit log of every change (who, what, when, snapshot id), read from axf.containers@1."""
    cs = plugin_services.get("axf.containers@1")
    if not cs:
        return {"items": [], "available": False}
    return {"items": cs.audit(max(1, min(limit, 2000)), container, "", batch), "available": True}
