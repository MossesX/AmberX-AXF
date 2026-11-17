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
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

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
