"""Phone Connect (phone-connect@1): the console side of the companion app. Mounted at /api/plugins/phone-connect/.

Contract: framework/spec/PHONE-CONNECT.md; reference engine framework/core/phone-connect.mjs (engine.py is its Python
port, held to framework/spec/fixtures/phone-connect.json by test.py). Data: data-store@1 namespace `phone` (store.py).

Console routes (console token or the wall's signed-in admin; `person` = the wall admin's own browser, never the token):
  POST   pair/start                 issue a pairing code (cancels the pending one)          anyone
  POST   pair/cancel                cancel the pending code                                 anyone
  GET    pair                       the pending code, if any
  POST   pair/confirm {code, device}  claim: returns the device token once                  person only
  GET    devices                    every phone (presence, never the token hash)
  GET    devices/{id}
  DELETE devices/{id}               revoke (?forget=1 also drops the record)                person only
  POST   devices/{id}/revoke | forget | settings                                            person only
  POST   command {command, arguments, deviceId?, approvalId?, correlationId?}   queue one command (dispatch-checked)
  POST   open {url, where?} · notify {kind, title, body?, url?, notifyId?} · voice {mode, text?, timeoutSeconds?}
  POST   recorder/start {session, group?, note?, approvalId} · recorder/stop · GET recorder/status
  GET    commands?deviceId= · commands/{id}?wait=<s>   a command with its ack and result
  POST   open-url {url, browser?}    an https amberxai.com page in Chrome (or the default browser), in front; waits
                                    for the phone's answer: `how` = direct, or notification (one tap opens it)
  GET    presence                   is a phone paired and online, when did it last check in (MCP phone_status)
  GET    status                     presence, link, pairing, features, recorder, the approvals watcher
  GET    state                      status + devices + settings + recent commands + the console-control addresses
  GET    settings · POST settings {features: {open_url|notify|approval|recorder|voice: bool}}

Device routes (device_router, /api/plugins/phone-connect/device/…, no console token: `Authorization: Bearer tok_…` and
`X-AXPP: axpp@1` on every call):
  POST hello {device}  ·  GET next?wait=25 (204 = nothing)  ·  POST ack {…}  ·  POST answer {…}  ·  POST rotate
  POST voice-in {text}   a phrase spoken on the phone → the console runs it (console action phone.voice)
  WS   ws   the same loop over one socket: the server sends calls, the phone sends ack / result / error messages

A device token the console refuses is answered with a wire error whose `detail.reason` is "pair": the phone stops
retrying with it (engine `linkVerdict`) and shows "Disconnected: tap to re-pair"; `status.link` says the same here.

Capability axf.phone@1 (plugin_services): status(), presence(), available(), send(), open_url(), notify(), approval(),
follow(), command(). Approve / deny / shelve are on none of these: an approval prompt is decided only by Brett's tap
on the phone. New axHub approvals reach the phone from approvals.py (a watcher in this server, console open or not).
"""
from __future__ import annotations

from typing import Any

import asyncio

from fastapi import APIRouter, Request, Response, WebSocket, WebSocketDisconnect
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services

from . import approvals
from . import engine as E
from . import service as svc

router = APIRouter()
device_router = APIRouter()

HTTP = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "unpaired": 409, "revoked": 410, "expired": 410,
        "offline": 409, "timeout": 504, "unavailable": 503, "confirmation_required": 428, "consent_required": 409, "unexpected": 500}


def answer(fn, *a: Any, **k: Any) -> Any:
    """Run a service call; a PhoneError becomes its HTTP status with the wire error as the body."""
    try:
        return fn(*a, **k)
    except svc.PhoneError as e:
        return JSONResponse({"ok": False, "error": e.err}, status_code=HTTP.get(e.err["code"], 400))


def actor(request: Request) -> dict[str, Any]:
    """Who is asking. Only the wall's signed-in admin browser, from the console's own origin, is a person; the console
    token (every Claude session, MCP, CLI, voice) is a session, named by its X-AXF-Session header when it sends one."""
    import wall
    c = getattr(request.state, "axf_user", None)
    if c is not None and c is not wall.TOKEN_CALLER and getattr(c, "admin", False) and getattr(c, "via", "") != "token" and wall.same_origin(request):
        return {"kind": "person", "who": c.name[:160], "via": "console"}
    who = (request.headers.get("x-axf-session") or request.headers.get("x-axhub-session") or "console-token")[:160]
    via = request.headers.get("x-axf-via") or "console"
    return {"kind": "session", "who": who, "via": via if via in E.VIAS else "console"}


async def body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except ValueError:
        b = {}
    return b if isinstance(b, dict) else {}


# ---- pairing

@router.get("/pair")
def get_pair() -> dict[str, Any]:
    return {"ok": True, "pairing": svc.pairing_view(svc.current_pairing())}


@router.post("/pair/start")
def post_pair_start(request: Request) -> Any:
    return answer(svc.pair_start, actor(request))


@router.post("/pair/cancel")
def post_pair_cancel(request: Request) -> Any:
    return answer(svc.pair_cancel, actor(request))


@router.post("/pair/confirm")
async def post_pair_confirm(request: Request) -> Any:
    """personOnly: the phone opens this through the wall with Brett's own hub sign-in. The console token is refused."""
    who = actor(request)
    b = await body(request)
    return answer(svc.pair_confirm, {"code": b.get("code"), "device": b.get("device")}, who if who["kind"] == "person" else None)


# ---- devices

@router.get("/devices")
def get_devices() -> dict[str, Any]:
    return {"ok": True, "devices": svc.devices()}


@router.get("/devices/{device_id}")
def get_device(device_id: str) -> Any:
    def one() -> dict[str, Any]:
        return {"ok": True, "device": svc.device_view(svc.device_or_fail(device_id))}
    return answer(one)


@router.delete("/devices/{device_id}")
def delete_device(device_id: str, request: Request, forget: int = 0) -> Any:
    return answer(svc.forget if forget else svc.revoke, device_id, actor(request))


@router.post("/devices/{device_id}/revoke")
def post_revoke(device_id: str, request: Request) -> Any:
    return answer(svc.revoke, device_id, actor(request))


@router.post("/devices/{device_id}/forget")
def post_forget(device_id: str, request: Request) -> Any:
    return answer(svc.forget, device_id, actor(request))


@router.post("/devices/{device_id}/settings")
async def post_device_settings(device_id: str, request: Request) -> Any:
    return answer(svc.set_device, device_id, await body(request), actor(request))


# ---- commands (s8)

DEFAULT_NOTIFY_ID = "phone-connect.direct"


@router.post("/command")
async def post_command(request: Request) -> Any:
    b = await body(request)
    return answer(svc.send, str(b.get("command") or ""), b.get("arguments") if isinstance(b.get("arguments"), dict) else {}, actor(request),
                  str(b.get("deviceId") or ""), str(b.get("approvalId") or ""), str(b.get("correlationId") or ""))


@router.post("/open")
async def post_open(request: Request) -> Any:
    b = await body(request)
    args = {k: b[k] for k in ("url", "where", "browser") if k in b}
    return answer(svc.send, "open_url", args, actor(request), str(b.get("deviceId") or ""))


@router.post("/open-url")
async def post_open_url(request: Request) -> Any:
    """Open an https amberxai.com page on the paired phone in Chrome (or the default browser) and bring it to the front."""
    b = await body(request)
    who = actor(request)
    try:
        return await run_in_threadpool(svc.open_page, b.get("url"), b.get("browser") or "chrome", who, str(b.get("deviceId") or ""))
    except svc.PhoneError as e:
        return JSONResponse({"ok": False, "error": e.err}, status_code=HTTP.get(e.err["code"], 400))


@router.get("/presence")
def get_presence() -> dict[str, Any]:
    """Whether a phone is paired and online and when it last checked in."""
    return svc.presence()


@router.post("/notify")
async def post_notify(request: Request) -> Any:
    b = await body(request)
    args = {k: b[k] for k in ("kind", "title", "body", "url", "priority") if k in b}
    args.setdefault("kind", "fyi")
    args["notifyId"] = str(b.get("notifyId") or DEFAULT_NOTIFY_ID)
    return answer(svc.send, "notify", args, actor(request), str(b.get("deviceId") or ""))


@router.post("/voice")
async def post_voice(request: Request) -> Any:
    b = await body(request)
    args = {k: b[k] for k in ("mode", "text", "timeoutSeconds") if k in b}
    return answer(svc.send, "voice", args, actor(request), str(b.get("deviceId") or ""))


@router.post("/recorder/start")
async def post_recorder_start(request: Request) -> Any:
    b = await body(request)
    args = {k: b[k] for k in ("session", "group", "note") if k in b}
    return answer(svc.send, "recorder.start", args, actor(request), str(b.get("deviceId") or ""), str(b.get("approvalId") or ""))


@router.post("/recorder/stop")
async def post_recorder_stop(request: Request) -> Any:
    b = await body(request)
    return answer(svc.send, "recorder.stop", {}, actor(request), str(b.get("deviceId") or ""))


@router.get("/recorder/status")
def get_recorder_status(request: Request, deviceId: str = "", ask: int = 0) -> Any:  # noqa: N803
    """The last state the phone reported; ?ask=1 also queues a recorder.status command for a fresh one."""
    def run() -> dict[str, Any]:
        st = svc.status()
        out: dict[str, Any] = {"ok": True, "recorder": st["recorder"], "presence": st["presence"]}
        if ask:
            out["asked"] = svc.send("recorder.status", {}, actor(request), deviceId)["id"]
        return out
    return answer(run)


@router.get("/commands")
def get_commands(deviceId: str = "", limit: int = 50) -> Any:  # noqa: N803
    return answer(svc.commands, deviceId, max(1, min(limit, 500)))


@router.get("/commands/{cid}")
async def get_command(cid: str, wait: int = 0) -> Any:
    """?wait=<seconds> (≤ 30) holds until the command is done or failed."""
    end = asyncio.get_event_loop().time() + max(0, min(wait, 30))
    while True:
        try:
            r = await run_in_threadpool(svc.command, cid)
        except svc.PhoneError as e:
            return JSONResponse({"ok": False, "error": e.err}, status_code=HTTP.get(e.err["code"], 400))
        if r["command"]["status"] in ("done", "failed") or asyncio.get_event_loop().time() >= end:
            return r
        await asyncio.sleep(0.5)


@router.get("/status")
def get_status() -> dict[str, Any]:
    svc.ensure_health()
    return svc.status()


@router.get("/state")
def get_state() -> dict[str, Any]:
    return svc.state()


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    from . import store as S
    return {"ok": True, **S.settings(), "catalog": S.FEATURES}


@router.post("/settings")
async def post_settings(request: Request) -> Any:
    from . import store as S
    return {"ok": True, **S.save_settings(await body(request))}


# ---- the phone's link (device_router: no console token, the device token on every call)

def _token(headers: Any) -> str:
    a = headers.get("authorization") or ""
    return a[7:].strip() if a.lower().startswith("bearer ") else ""


def device_of(request: Request) -> dict:
    if (request.headers.get(E.LINK["header"]) or "") != E.LINK["protocol"]:
        svc.fail("invalid", f"send {E.LINK['header']}: {E.LINK['protocol']}")
    return svc.device_for(_token(request.headers))


@device_router.post("/hello")
async def device_hello(request: Request) -> Any:
    b = await body(request)
    return answer(lambda: svc.hello(device_of(request), b))


@device_router.get("/next")
async def device_next(request: Request, wait: int = 0) -> Any:
    """Long poll: the next call for this phone, or 204 after `wait` seconds (≤ HUB.pollWaitSeconds)."""
    try:
        d = await run_in_threadpool(device_of, request)
    except svc.PhoneError as e:
        return JSONResponse({"ok": False, "error": e.err}, status_code=HTTP.get(e.err["code"], 400))
    end = asyncio.get_event_loop().time() + max(0, min(wait, E.HUB["pollWaitSeconds"]))
    while True:
        call = await run_in_threadpool(svc.next_call, d)
        if call:
            return call
        if asyncio.get_event_loop().time() >= end or await request.is_disconnected():
            return Response(status_code=E.LINK["noContent"])
        await asyncio.sleep(1)


@device_router.post("/ack")
async def device_ack(request: Request) -> Any:
    b = await body(request)
    return answer(lambda: svc.take_reply(device_of(request), {**b, "kind": "ack"}))


@device_router.post("/answer")
async def device_answer(request: Request) -> Any:
    b = await body(request)
    return answer(lambda: svc.take_reply(device_of(request), b))


@device_router.post("/voice-in")
async def device_voice_in(request: Request) -> Any:
    b = await body(request)
    return answer(lambda: svc.voice_in(device_of(request), b.get("text")))


@device_router.post("/rotate")
def device_rotate(request: Request) -> Any:
    return answer(lambda: svc.rotate(device_of(request), _token(request.headers)))


@device_router.websocket("/ws")
async def device_ws(ws: WebSocket) -> None:
    """The same loop over one socket. The device token comes in the Authorization header of the upgrade."""
    try:
        d = await run_in_threadpool(svc.device_for, _token(ws.headers))
    except svc.PhoneError as e:
        await ws.close(code=4401, reason=e.err["code"])
        return
    await ws.accept()

    async def pump() -> None:
        while True:
            call = await run_in_threadpool(svc.next_call, d)
            if call:
                await ws.send_json(call)
            else:
                await asyncio.sleep(1)

    task = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive_json()
            try:
                r = await run_in_threadpool(svc.take_reply, d, msg if isinstance(msg, dict) else {})
            except svc.PhoneError as e:
                r = {"ok": False, "error": e.err}
            await ws.send_json({"protocol": E.LINK["protocol"], "kind": "receipt", "correlationId": (msg or {}).get("correlationId"), **r})
    except (WebSocketDisconnect, ValueError, RuntimeError):
        pass
    finally:
        task.cancel()


# ---- capability

plugin_services.provide("axf.phone@1", svc.PhoneCapability(), folder="phone-connect")
svc.ensure_health()
approvals.start()
