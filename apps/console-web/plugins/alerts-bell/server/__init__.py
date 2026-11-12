"""Alerts bell (server part): the console's notifications as commands. Mounted at /api/plugins/alerts-bell/.

Build move-amberx-web-app-into-the-console-amberx-andr, s9 (contract C33–C35b). The alerts hub (server/alerts.py)
answers /api/alerts for the bell, the phone and the browsers; these routes put the same hub behind plugin commands, so
Claude has MCP tools (alerts-bell_feed, _history, _raise, _read, _dismiss, _resolve) and the CLI `axf alerts-bell …`:

  GET  feed?device=&since=        the alerts (phone view with device), unread count, version
  GET  history?device=&since=&limit=   every alert delivered to a device: deliveredAt, readAt, tappedAt
  POST raise {source, severity, title, body?, key?, link?}   raise (or refresh) an alert; the hub pushes it
  POST read {ids?, all?, device?}  mark read (the alert and the device's history)
  POST dismiss {ids}               dismiss
  POST resolve {keys}              resolve by key
  POST tapped {id, device}         a device's tap
"""
from __future__ import annotations

import json
import re
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx

router = APIRouter()
SEVERITIES = ("info", "success", "warning", "error", "critical")
SOURCE_RE = re.compile(r"^[a-z][a-z0-9._-]{0,39}$")


def hub() -> Any:
    h = cx.alerts_hub
    if h is None:
        raise HTTPException(503, "the console's alert hub is not running")
    return h


async def body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > 16 * 1024:
        raise HTTPException(413, "at most 16 KB")
    try:
        b = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "send JSON") from e
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


def ids_of(b: dict[str, Any], key: str = "ids") -> list[str]:
    v = b.get(key)
    if not isinstance(v, list) or not all(isinstance(x, str) for x in v) or len(v) > 1000:
        raise HTTPException(400, f"send {{ {key}: [ … ] }}")
    return v


@router.get("/feed")
def feed(device: str = "", since: int = -1) -> dict[str, Any]:
    h = hub()
    snap = h.snapshot(phone=bool(device))
    if device:
        h.delivered(device, [a for a in snap["alerts"] if not a.get("resolved")], "feed")
    if since == snap["version"]:
        return {"ok": True, "unchanged": True, "version": snap["version"], "unread": snap["unread"]}
    return {"ok": True, **snap}


@router.get("/history")
def history(device: str = "", since: str = "", limit: int = 100) -> dict[str, Any]:
    return {"ok": True, **hub().history(device, since[:40], limit)}


@router.post("/raise")
async def raise_alert(request: Request) -> dict[str, Any]:
    b = await body(request)
    if not isinstance(b.get("title"), str) or not b["title"].strip():
        raise HTTPException(400, "send { source, severity, title, body?, key?, link? }")
    src = b.get("source") or "fyi"
    if not isinstance(src, str) or not SOURCE_RE.match(src):
        raise HTTPException(400, "source is lower case letters, digits, . _ - (at most 40)")
    sev = b.get("severity") or "info"
    if sev not in SEVERITIES:
        raise HTTPException(400, f"severity is one of {', '.join(SEVERITIES)}")
    link = b.get("link")
    if link is not None and (not isinstance(link, str) or not re.match(r"^(https?://|view:|settings:)", link)):
        raise HTTPException(400, "link must be http(s)://, view:<id> or settings:<tab>")
    inp = {"source": src, "severity": sev, "title": b["title"][:200], **{k: str(b[k])[:2000] for k in ("body", "key", "link") if isinstance(b.get(k), str)}}
    alert, event, targets = hub().raise_alert(inp)
    return {"ok": True, "event": event, "targets": targets, "alert": alert or None}


@router.post("/read")
async def read(request: Request) -> dict[str, Any]:
    b = await body(request)
    ids = None if b.get("all") is True else ids_of(b)
    h = hub()
    h.ack(ids)
    n = h.mark("readAt", ids, str(b.get("device") or ""))
    return {"ok": True, "historyMarked": n, "unread": h.snapshot()["unread"]}


@router.post("/dismiss")
async def dismiss(request: Request) -> dict[str, Any]:
    h = hub()
    h.dismiss(ids_of(await body(request)))
    return {"ok": True, "unread": h.snapshot()["unread"]}


@router.post("/resolve")
async def resolve(request: Request) -> dict[str, Any]:
    h = hub()
    h.resolve(ids_of(await body(request), "keys"))
    return {"ok": True}


@router.post("/tapped")
async def tapped(request: Request) -> dict[str, Any]:
    b = await body(request)
    if not isinstance(b.get("id"), str):
        raise HTTPException(400, "send { id, device }")
    h = hub()
    n = h.mark("tappedAt", [b["id"]], str(b.get("device") or ""))
    h.mark("readAt", [b["id"]], str(b.get("device") or ""))
    h.ack([b["id"]])
    return {"ok": True, "marked": n}
