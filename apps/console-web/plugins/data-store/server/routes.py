"""Data store routes (mounted at /api/plugins/data-store/, console token on every route).

Brett, Nov 15 2026: "the console goes down, all the data is still available, all the notes are available, and the
builds keep running. That's what I need."

  GET  state                    data-store-state@1: axf-data reachable, keys per namespace on axf-data, mode / drift /
                                next step per namespace (framework/cli/data-mode.mjs status), last backup + verify
  GET  drift?ns=&tail=          the drift log of one namespace (data-drift@1 lines)
  POST backup                   Backup now on axf-data (a background job; GET state shows it)
  POST verify                   re-check the newest backup against the live store
  POST mode {ns, to, window?, acceptDrift?}   to = shadow | cutover | rollback | local (data-mode.mjs: same guards)
  POST voice {phrase, confirm?}  AmberX: a spoken phrase → one of the above (a move needs confirm: true)

The same calls are plugin commands (MCP), `axf data …` on the CLI and voice actions; Settings → Plugins → Data store
shows them. Nothing here holds data: the plugin reads axf-data and the mode document, and runs the data-mode CLI.
"""
from __future__ import annotations

import json
import os
import re
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


# ── voice (AmberX): a phrase → one of the routes above ───────────────────────────────────────────────────────────────
_NS_WORDS = {"settings": "settings", "setting": "settings", "changes": "changes", "change log": "changes", "notes": "notes", "note": "notes",
             "planner": "planner", "plans": "planner", "plan studio": "planner", "ui review": "ui-review", "reviews": "ui-review",
             "sessions": "sessions", "chats": "sessions", "console": "console", "builds": "builds", "build store": "builds"}
_MOVES = (("roll back", "rollback"), ("rollback", "rollback"), ("cut over", "cutover"), ("cutover", "cutover"), ("cut", "cutover"),
          ("shadow", "shadow"), ("back to local", "local"), ("stop shadow", "local"))


def parse_phrase(phrase: str) -> dict[str, Any]:
    """Pure: what a phrase asks for ({action, ns?, to?}); tests call it directly."""
    p = " ".join(phrase.lower().replace("-", " ").split())
    if any(w in p for w in ("verify", "check the backup", "is the backup good")):
        return {"action": "verify"}
    if "back up" in p or "backup" in p.replace("backups", "") and "roll" not in p:
        return {"action": "backup"}
    for words, to in _MOVES:
        if words in p:
            ns = next((v for k, v in sorted(_NS_WORDS.items(), key=lambda kv: -len(kv[0])) if k in p), "")
            m = re.search(r"plugins? ([a-z0-9][a-z0-9-]*)", " ".join(phrase.lower().split()))
            if m:
                ns = f"plugins/{m.group(1)}"
            return {"action": "mode", "to": to, "ns": ns}
    if "drift" in p:
        ns = next((v for k, v in sorted(_NS_WORDS.items(), key=lambda kv: -len(kv[0])) if k in p), "")
        return {"action": "drift", "ns": ns}
    return {"action": "state"}


class VoiceBody(BaseModel):
    phrase: str
    confirm: bool = False


@router.post("/voice")
def voice(body: VoiceBody) -> dict[str, Any]:
    a = parse_phrase(body.phrase)
    if a["action"] == "backup":
        backup()
        return {"did": "backup", "say": "Backup started on axf-data. I'll have the result in the data store state."}
    if a["action"] == "verify":
        verify()
        return {"did": "verify", "say": "Checking the newest backup against the live store."}
    if a["action"] == "drift":
        if not a["ns"]:
            return {"did": "nothing", "say": "Which namespace's drift log? Settings, planner, notes, builds…"}
        d = drift(a["ns"], 5)
        return {"did": "drift", "entries": d["entries"], "say": f"{len(d['entries'])} recent drift entries for {a['ns']}." if d["entries"] else f"No drift logged for {a['ns']}."}
    if a["action"] == "mode":
        if not a["ns"]:
            return {"did": "nothing", "say": "Which namespace? Settings, planner, notes, builds, or a plugin."}
        if not body.confirm:
            return {"did": "ask", "would": a, "say": f"That moves {a['ns']} to {a['to']}. Say yes to go ahead."}
        r = mode(ModeBody(ns=a["ns"], to=a["to"]))
        return {"did": "mode", "result": r, "say": f"Done: {a['ns']} is {a['to'] if a['to'] != 'rollback' else 'back on the local files'}."}
    s = state()
    moved = [n for n in s["namespaces"] if n["mode"] != "local"]
    head = "axf-data is up" if s["reachable"] else ("axf-data isn't connected yet" if not s["configured"] else "axf-data isn't answering")
    last = (s.get("backup") or {}).get("last") or {}
    return {"did": "state", "state": s, "say": f"{head}. {len(moved)} of {len(s['namespaces'])} namespaces moved{': ' + ', '.join(n['ns'] + ' ' + n['mode'] for n in moved) if moved else ''}. " + (f"Last backup {last.get('at', '?')}, {'verified' if (last.get('verify') or {}).get('ok') else 'not verified'}." if last else "No backup yet.")}
