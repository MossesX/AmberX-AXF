"""File watchdog: watch files, folders or globs and run actions when they change. Mounted at /api/plugins/file-watchdog/.

The engine (engine.py) runs with no AI at all. This file lends it the console's services (alerts, console actions,
control@1, axf.llm@1 for the optional AI action), starts its loop and serves the routes. Every route needs the console
token (the console adds that check); every route is also a plugin command, so REST, MCP, the CLI and AmberX reach the
same thing: `axf file-watchdog <command>`, MCP `file-watchdog_<command>`, /api/control/file-watchdog/<command>.
"""
from __future__ import annotations

import os
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from starlette.concurrency import run_in_threadpool

import console_context as cx
import plugin_services

sys.path.insert(0, str(Path(__file__).resolve().parent))
from engine import ACTION_TYPES, EVENTS, NEEDS_APPROVAL, Engine, Hooks, WatchError  # noqa: E402

FOLDER = Path(__file__).resolve().parents[1].name
router = APIRouter()


def _root() -> Path:
    return Path(os.environ.get("AXF_WATCHDOG_ROOT") or os.environ.get("AXF_ROOT") or cx.ROOT).resolve()


def _data() -> Path:
    return Path(os.environ.get("AXF_WATCHDOG_DATA_DIR") or (Path(cx.ROOT) / ".axf-console" / "plugins" / FOLDER))


def _notify_allowed() -> bool:
    gate = plugin_services.get("axf.notify@1")
    return True if gate is None else bool(gate.allowed("watchdog.fired", "banner") or gate.allowed("watchdog.fired", "amberx"))


def _console(cmd: dict[str, Any]) -> dict[str, Any]:
    svc = plugin_services.get("console-commands@1")
    if svc is None:
        return {"ok": False, "code": "not_implemented", "message": "the Console commands plugin is off or missing"}
    return svc.run(cmd, ["control.console.read", "control.console.navigate", "control.console.write"], "file-watchdog")


def _control(cmd: dict[str, Any]) -> dict[str, Any]:
    svc = plugin_services.get("control@1")
    if svc is None:
        return {"ok": False, "code": "not_implemented", "message": "control@1 is off or missing"}
    # a destructive command still needs its confirm token, which a watch can't carry: it is logged as failed, never run
    return svc.run(cmd, ["*"], "file-watchdog")


def _llm(messages: list[dict[str, Any]], **kw: Any) -> dict[str, Any]:
    svc = plugin_services.get("axf.llm@1")
    if svc is None:
        raise RuntimeError("no model service (axf.llm@1): the AI assistant plugin is off")
    return svc.complete(messages, **kw)


class _Hooks(Hooks):
    notify = staticmethod(lambda a: cx.raise_alert(a))
    notify_allowed = staticmethod(_notify_allowed)
    console = staticmethod(_console)
    control = staticmethod(_control)
    llm = staticmethod(_llm)
    log = staticmethod(lambda text, level: cx.log("plugins", text, level))


ENGINE = Engine(_data(), _root(), _Hooks())
if os.environ.get("AXF_WATCHDOG_NO_LOOP") != "1":
    ENGINE.start(active=lambda: cx.plugin_enabled(FOLDER), poll_s=float(os.environ.get("AXF_WATCHDOG_POLL", "2") or 2))


def _get(wid: str) -> dict[str, Any]:
    try:
        return ENGINE.get(wid)
    except KeyError:
        raise HTTPException(404, f"no watch '{wid}'") from None


def _bad(e: Exception) -> HTTPException:
    return HTTPException(400, str(e))


def _approver(request: Request) -> dict[str, str] | None:
    """Brett's approval as this request carries it (control@1 owner), never from the request body."""
    c = plugin_services.get("control@1")
    try:
        return c.owner(request) if c is not None else None
    except Exception:  # noqa: BLE001
        return None


# ---------------------------------------------------------------------- reads

@router.get("/state")
def state() -> dict[str, Any]:
    ws = ENGINE.watches()
    held = sum(1 for w in ws for a in w["actions"] if a["type"] in NEEDS_APPROVAL and a.get("approval", {}).get("state") != "approved")
    return {"engine": ENGINE.status(), "root": str(ENGINE.root), "watches": [ENGINE.view(w) for w in ws],
            "counts": {"watches": len(ws), "enabled": sum(1 for w in ws if w.get("enabled")), "ai": sum(1 for w in ws if w.get("ai", {}).get("enabled")), "needApproval": held},
            "recent": ENGINE.events(25), "actionTypes": list(ACTION_TYPES), "eventTypes": list(EVENTS),
            "services": {"alerts": True, "console": plugin_services.get("console-commands@1") is not None,
                         "control": plugin_services.get("control@1") is not None, "llm": plugin_services.get("axf.llm@1") is not None}}


@router.get("/watches")
def watches() -> dict[str, Any]:
    return {"watches": [ENGINE.view(w) for w in ENGINE.watches()]}


@router.get("/watch")
def watch(id: str) -> dict[str, Any]:
    return {"watch": ENGINE.view(_get(id)), "events": ENGINE.events(50, id)}


@router.get("/events")
def events(limit: int = 100, watch: str = "") -> dict[str, Any]:
    return {"events": ENGINE.events(max(1, min(1000, limit)), watch)}


# ---------------------------------------------------------------------- commands

@router.post("/add")
async def add(body: dict[str, Any]) -> dict[str, Any]:
    try:
        w = await run_in_threadpool(ENGINE.add, body or {})
    except WatchError as e:
        raise _bad(e) from None
    return {"ok": True, "watch": w}


@router.post("/update")
async def update(body: dict[str, Any]) -> dict[str, Any]:
    wid = str((body or {}).get("id") or "")
    _get(wid)
    try:
        w = await run_in_threadpool(ENGINE.update, wid, {k: v for k, v in body.items() if k != "id"})
    except WatchError as e:
        raise _bad(e) from None
    return {"ok": True, "watch": w}


@router.post("/enable")
def enable(body: dict[str, Any]) -> dict[str, Any]:
    wid = str((body or {}).get("id") or "")
    _get(wid)
    return {"ok": True, "watch": ENGINE.update(wid, {"enabled": bool(body.get("enabled", True))})}


@router.post("/ai")
def ai(body: dict[str, Any]) -> dict[str, Any]:
    """The watch's Enable AI switch and its prompt (model / profile optional; the assistant's routing picks otherwise)."""
    wid = str((body or {}).get("id") or "")
    _get(wid)
    patch = {k: body[k] for k in ("enabled", "prompt", "model", "profile", "maxTokens") if k in body}
    return {"ok": True, "watch": ENGINE.update(wid, {"ai": patch})}


@router.post("/approve")
def approve(body: dict[str, Any], request: Request) -> dict[str, Any]:
    """Approve one script or shell action of a watch. Only Brett's own signed-in console session approves; anyone else
    turns it into a request (an alert asks him)."""
    wid = str((body or {}).get("id") or "")
    w = _get(wid)
    try:
        index = int(body.get("action", 0))
        who = _approver(request)
        a = ENGINE.approve(wid, index, who, revoke=bool(body.get("revoke")))
    except (WatchError, ValueError) as e:
        raise _bad(e) from None
    if a["approval"]["state"] == "requested":
        cx.raise_alert({"source": "file-watchdog", "key": f"file-watchdog-approve:{wid}:{index}", "severity": "warning",
                        "title": f"Approve a {a['type']} action on watch '{w['name']}'",
                        "body": (a.get("command") or a.get("script") or "")[:300], "link": "nav:file-watchdog"})
    return {"ok": True, "action": a, "approved": a["approval"]["state"] == "approved",
            "message": "approved" if a["approval"]["state"] == "approved" else ("approval revoked" if body.get("revoke") else "asked Brett: it runs once he approves it in the console")}


@router.post("/test")
async def test(body: dict[str, Any]) -> dict[str, Any]:
    """Fire a watch now as if `path` had changed with `event` (default: its first path, modified). Logged as a test."""
    w = _get(str((body or {}).get("id") or ""))
    ev = body.get("event") if body.get("event") in EVENTS else "modified"
    path = str(body.get("path") or w["paths"][0])
    rec = await run_in_threadpool(ENGINE.fire, w, ev, str(ENGINE.root / path) if not os.path.isabs(path) else path, test=True)
    return {"ok": True, "event": rec}


@router.post("/scan")
async def scan() -> dict[str, Any]:
    """One pass now (the loop runs on its own; this is for checking a new watch without waiting)."""
    n = await run_in_threadpool(ENGINE.scan)
    return {"ok": True, "fired": n}


@router.delete("/watch")
def remove(id: str) -> dict[str, Any]:
    _get(id)
    return {"ok": True, **ENGINE.remove(id)}


@router.post("/events/clear")
def clear() -> dict[str, Any]:
    return {"ok": True, **ENGINE.clear_events()}
