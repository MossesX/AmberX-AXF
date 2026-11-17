"""Drag REST (drag-move@1, framework/spec/DRAG-MOVE.md): /api/drag/*, every draggable thing on the open console.

    GET  /hosts?kind=&container=&to=          the hosts on the page in front (kind, container, label, items in order)
    GET  /zones?kind=&container=&id=&to=      where that item may land (each target a ready drag-move@1 target)
    POST /move     {kind, source, target, by?, reason?, to?}          move an item (reorder, another container, a side)
    POST /add      {kind, source, target, by?, reason?, to?}          add an item to a host
    POST /remove   {kind, source, confirm?, by?, reason?, to?}        remove an item from a host
    POST /preview  {kind, source, target, …}                          plan it and highlight it on the screen, move nothing

The command is checked here (drag_move.py, the engine's twin) and relayed to the open console over the console-commands
relay (`control` op, verb `drag.*`); the console plans it against its live hosts and answers drag-move-result@1. No
console open → 503 `unavailable` with `openUrl`. Reads need control.console.read, moves control.console.write (the same
grants and rate limits as console-control@1, console_control_api.py).
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import drag_move as dm

WRITE_VERBS = ("move", "add", "remove")
READ_PERM = "control.console.read"
WRITE_PERM = "control.console.write"
NAV_PERM = "control.console.navigate"


def _cc_api() -> Any:
    import console_control_api
    return console_control_api


def status_of(r: dict[str, Any]) -> int:
    if r.get("ok"):
        return 200
    if r.get("because") == "rate limit":
        return 429
    return dm.STATUS.get(str(r.get("code") or "failed"), 500)


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=status_of(r))


def relay(request_: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
    """Send one drag request ({verb: drag.*, …}) to the open console; its answer, or `unavailable`."""
    api = _cc_api()
    out = api.to_console(request_, by, audience, to)
    if not out.get("ok") and out.get("code") == "unavailable":
        return {**out, "$axf": dm.RESULT_FRAME}
    return out


def guarded(request_: dict[str, Any], perm: str, write: bool, by: str, audience: str, grants: set[str], to: str = "recent") -> dict[str, Any]:
    """Permission and rate (console-control's own), then relay. Never raises."""
    api = _cc_api()
    if not api.granted(grants, perm):
        return {"$axf": dm.RESULT_FRAME, "ok": False, "code": "denied", "message": f"{request_['verb']} needs {perm}", "requires": perm}
    try:
        api.check_rate(f"{audience}|{by}", write)
    except Exception as e:  # noqa: BLE001 — cc.ControlError (rate limit)
        env = e.envelope() if hasattr(e, "envelope") else {"ok": False, "code": "denied", "message": str(e)}
        return {**env, "$axf": dm.RESULT_FRAME}
    return relay(request_, by, audience, to)


def move_request(op: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    """The relayed request for a write (or a preview): the command checked and normalized. Raises DragMoveError."""
    raw = {k: v for k, v in body.items() if k not in ("to", "verb", "preview")}
    if op in WRITE_VERBS:
        raw["op"] = op
    cmd = dm.normalize(raw)
    cmd.setdefault("by", by)
    return {"verb": f"drag.{op}", "command": cmd, "by": cmd["by"]}


def command(verb: str, body: dict[str, Any], by: str = "", audience: str = "owner", grants: set[str] | None = None) -> dict[str, Any]:
    """One drag request without HTTP (the MCP tools in the console process, tests): verb = hosts | zones | move | add |
    remove | preview, body = the query fields or the command. Same checks, grants and relay as the routes."""
    g = grants if grants is not None else {"*"}
    who = str(body.get("by") or by or "api")[:80]
    to = str(body.get("to") or "recent")
    if verb == "hosts":
        req = {"verb": "drag.list", **{k: body[k] for k in ("kind", "container") if body.get(k)}, "by": who}
        return guarded(req, READ_PERM, False, who, audience, g, to)
    if verb == "zones":
        if not (body.get("kind") and body.get("container") and body.get("id")):
            return {"$axf": "drag-zones@1", "ok": False, "code": "invalid", "message": "zones needs kind, container and id"}
        return guarded({"verb": "drag.zones", "kind": body["kind"], "container": body["container"], "id": body["id"], "by": who}, READ_PERM, False, who, audience, g, to)
    if verb not in (*WRITE_VERBS, "preview"):
        return {"$axf": dm.RESULT_FRAME, "ok": False, "code": "invalid", "message": f"verb must be hosts, zones, move, add, remove or preview, not {verb}"}
    try:
        req = move_request(verb, body, who)
    except dm.DragMoveError as e:
        return e.envelope()
    perm, is_write = (NAV_PERM, False) if verb == "preview" else (WRITE_PERM, True)
    return guarded(req, perm, is_write, who, audience, g, to)


def router_for(auth: Any) -> APIRouter:
    from fastapi import Depends
    r = APIRouter(prefix="/api/drag", dependencies=[Depends(auth)])

    def who(request: Request, body_by: Any = None) -> tuple[str, str, set[str]]:
        api = _cc_api()
        audience, name = api.audience_of(request)
        return audience, (str(body_by)[:80] if body_by else name), api.grants_of(request)

    @r.get("/hosts")
    async def hosts(request: Request, kind: str = "", container: str = "", to: str = "recent") -> JSONResponse:
        audience, by, grants = who(request)
        req = {"verb": "drag.list", **({"kind": kind} if kind else {}), **({"container": container} if container else {}), "by": by}
        return answer(await run_in_threadpool(guarded, req, READ_PERM, False, by, audience, grants, to))

    @r.get("/zones")
    async def zones(request: Request, kind: str = "", container: str = "", id: str = "", to: str = "recent") -> JSONResponse:  # noqa: A002 — the item id
        if not (kind and container and id):
            return answer({"$axf": "drag-zones@1", "ok": False, "code": "invalid", "message": "zones needs kind, container and id"})
        audience, by, grants = who(request)
        req = {"verb": "drag.zones", "kind": kind, "container": container, "id": id, "by": by}
        return answer(await run_in_threadpool(guarded, req, READ_PERM, False, by, audience, grants, to))

    async def write(request: Request, op: str) -> JSONResponse:
        try:
            body = await request.json()
        except Exception:  # noqa: BLE001 — empty or non-JSON = no fields
            body = None
        if not isinstance(body, dict):
            return answer(dm.DragMoveError("invalid", "the body must be a drag-move@1 command (JSON object)").envelope())
        audience, by, grants = who(request, body.get("by"))
        try:
            req = move_request(op, body, by)
        except dm.DragMoveError as e:
            return answer(e.envelope())
        perm, is_write = (NAV_PERM, False) if op == "preview" else (WRITE_PERM, True)
        return answer(await run_in_threadpool(guarded, req, perm, is_write, by, audience, grants, str(body.get("to") or "recent")))

    @r.post("/move")
    async def move(request: Request) -> JSONResponse:
        return await write(request, "move")

    @r.post("/add")
    async def add(request: Request) -> JSONResponse:
        return await write(request, "add")

    @r.post("/remove")
    async def remove(request: Request) -> JSONResponse:
        return await write(request, "remove")

    @r.post("/preview")
    async def preview(request: Request) -> JSONResponse:
        return await write(request, "preview")

    return r
