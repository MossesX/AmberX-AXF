"""Data store routes (mounted at /api/plugins/data-store/, console token on every route).

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

  GET  state                    data-store-state@1: axf-data reachable, keys per namespace on axf-data, mode / drift /
                                next step per namespace (framework/cli/data-mode.mjs status), last backup + verify
  GET  drift?ns=&tail=          the drift log of one namespace (data-drift@1 lines)
  POST backup                   Backup now on axf-data (a background job; GET state shows it)
  POST verify                   re-check the newest backup against the live store
  POST mode {ns, to, window?, acceptDrift?}   to = shadow | cutover | rollback | local (data-mode.mjs: same guards)

The same calls are plugin commands (MCP), `axf data …` on the CLI and voice actions; Settings → Plugins → Data store
shows them. Nothing here holds data: the plugin reads axf-data and the mode document, and runs the data-mode CLI.
"""
from __future__ import annotations

import json
import os
import subprocess
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

import data_store

router = APIRouter()
ROOT = Path(__file__).resolve().parents[5]
MODE_CLI = ROOT / "framework" / "cli" / "data-mode.mjs"
MODES = ("shadow", "cutover", "rollback", "local")
_cache: dict[str, Any] = {"at": 0.0, "status": None}


def _node(*args: str, timeout: int = 300) -> dict[str, Any]:
    p = subprocess.run(["node", str(MODE_CLI), *args, "--json"], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env={**os.environ})
    try:
        return json.loads(p.stdout)
    except ValueError:
        raise HTTPException(502, (p.stderr or p.stdout or "data-mode answered nothing").strip()[-300:]) from None


def _remote(method: str, path: str, body: Any = None) -> Any:
    try:
        return data_store.REMOTE.json(method, path, body)
    except data_store.DataStoreError as e:
        raise HTTPException(e.status or 502, f"axf-data: {e.code}: {e}") from None


def mode_status(force: bool = False) -> dict[str, Any]:
    """data-mode status (cached 20 s: it walks the local data folders)."""
    if force or not _cache["status"] or time.time() - _cache["at"] > 20:
        _cache.update(status=_node("status"), at=time.time())
    return _cache["status"]


@router.get("/state")
def state(fresh: bool = False) -> dict[str, Any]:
    st = data_store.status()
    out: dict[str, Any] = {"$axf": "data-store-state@1", "configured": st["configured"], "reachable": False, "health": None,
                           "counts": {}, "backup": None, "namespaces": [], "mode": st["mode"]}
    if st["configured"]:
        try:
            out["health"] = data_store.REMOTE.json("GET", "health")
            out["reachable"] = bool(out["health"].get("ok"))
        except data_store.DataStoreError as e:
            out["error"] = f"{e.code}: {e}"
    if out["reachable"]:
        try:
            out["counts"] = data_store.REMOTE.json("GET", "_meta/counts").get("counts", {})
            out["backup"] = data_store.REMOTE.json("GET", "_meta/backup")
        except data_store.DataStoreError as e:
            out["error"] = f"{e.code}: {e}"
    try:
        ms = mode_status(fresh)
        out["namespaces"] = [{**n, "keys": out["counts"].get(n["ns"])} for n in ms.get("namespaces", [])]
        out["summary"] = ms.get("summary", [])
    except (HTTPException, subprocess.TimeoutExpired) as e:
        out["error"] = str(getattr(e, "detail", e))
    return out


@router.get("/drift")
def drift(ns: str, tail: int = 20) -> dict[str, Any]:
    r = _node("drift", ns, "--tail", str(max(1, min(tail, 500))))
    rows = r.get("namespaces") or []
    return {"$axf": "data-drift-log@1", "ns": ns, "entries": rows[0].get("entries", []) if rows else []}


@router.post("/backup")
def backup() -> dict[str, Any]:
    if not data_store.REMOTE.configured:
        raise HTTPException(409, "axf-data isn't connected to this console (AXF_DATA_URL)")
    return _remote("POST", "_meta/backup", {})


@router.post("/verify")
def verify() -> dict[str, Any]:
    if not data_store.REMOTE.configured:
        raise HTTPException(409, "axf-data isn't connected to this console (AXF_DATA_URL)")
    return _remote("POST", "_meta/backup", {"verify": True})


class ModeBody(BaseModel):
    ns: str
    to: str
    window: int | None = None
    acceptDrift: bool = False


@router.post("/mode")
def mode(body: ModeBody) -> dict[str, Any]:
    if body.to not in MODES:
        raise HTTPException(400, f"to must be one of {', '.join(MODES)}")
    if not body.ns or len(body.ns) > 120:
        raise HTTPException(400, "ns is a namespace (settings, planner, plugins/<folder>, …)")
    args = [body.to, body.ns, "--by", "svc:console"]
    if body.window is not None:
        args += ["--window", str(max(0, int(body.window)))]
    if body.acceptDrift:
        args.append("--accept-drift")
    r = _node(*args, timeout=900)
    _cache["status"] = None
    if not r.get("ok"):
        res = (r.get("results") or [{}])[0]
        raise HTTPException(409, res.get("reason") or "refused")
    return r
