"""REST routes for Phone Connect (phone-connect@1), mounted at /api/plugins/phone-connect/.

Devices and pairing
  GET    status                     the paired phone, presence, the waiting code
  GET    devices                    every device with presence
  GET    devices/{id}               one device
  POST   devices/{id}/revoke        {why?}
  POST   devices/{id}/forget        a revoked record goes
  POST   devices/{id}/heartbeat     the phone: {name?, appVersion?, capabilities?, state?}
  POST   pair                       issue a code (10 min, single use) {deviceId?}
  GET    pair                       the waiting code
  DELETE pair                       cancel it
  POST   pair/claim                 the phone: {code, deviceId, name, app, appVersion, capabilities, state}; personOnly

Commands (queued while the phone is offline; delivered on its poll; acked with a phone-result@1)
  POST   open                       {url, browser?}: https on amberxai.com only
  POST   notify                     {kind: fyi|fix-update|alert|approval, title, body?, url?}
  GET    commands, commands/{id}    the queue and each command's status and result
  POST   devices/{id}/next          the phone's poll (also its heartbeat): queued commands + settings
  POST   commands/{id}/ack          the phone's answer {deviceId, ok, data? | error?}
  GET/POST settings                 browser, notify per type, monitor, recorderMic (only Brett turns the mic on)

Every error answers {"error": {code, message, retryable}} with the HTTP status for its code.
"""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from . import commands as Q
from . import devices as D
from . import settings as S
from .core import PhoneError
from .identity import caller, require_person

router = APIRouter()

HTTP = {"invalid": 400, "validation": 422, "denied": 403, "revoked": 403, "not_found": 404, "timeout": 410,
        "confirmation_required": 409, "unpaired": 409, "offline": 503, "unavailable": 503, "consent_required": 409, "unexpected": 500}


def answer(fn: Callable[[], Any]) -> Any:
    try:
        return fn()
    except PhoneError as e:
        return JSONResponse({"error": e.as_dict()}, status_code=HTTP.get(e.code, 400))


@router.get("/health")
def health() -> dict:
    return {"ok": True, "contract": "phone-connect@1"}


@router.get("/status")
def status() -> Any:
    return answer(D.status)


@router.get("/devices")
def devices() -> Any:
    return answer(lambda: {"devices": D.list_devices()})


@router.get("/devices/{device_id}")
def device(device_id: str) -> Any:
    return answer(lambda: D.get(device_id))


@router.post("/devices/{device_id}/revoke")
def revoke(device_id: str, request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: D.revoke(device_id, caller(request)[0], str(body.get("why") or "")))


@router.post("/devices/{device_id}/forget")
def forget(device_id: str) -> Any:
    return answer(lambda: D.forget(device_id))


@router.post("/devices/{device_id}/heartbeat")
def heartbeat(device_id: str, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: D.beat(device_id, body))


@router.post("/pair")
def pair(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: D.issue(caller(request)[0], str(body.get("deviceId") or "")))


@router.get("/pair")
def pair_waiting() -> Any:
    return answer(lambda: {"pairing": D.pairing()})


@router.delete("/pair")
def pair_cancel() -> Any:
    return answer(D.cancel)


@router.post("/pair/claim")
def pair_claim(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: D.claim(body, require_person(request, "Pairing a phone")))


# ------------------------------------------------------------------ commands and settings

def _via(request: Request, body: dict) -> str:
    v = str(body.get("via") or request.headers.get("x-axf-via") or "console")
    return v if v in ("console", "mcp", "cli", "voice", "hub") else "console"


@router.post("/open")
def open_url(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    """{url, browser?: chrome|default} — https on amberxai.com only."""
    return answer(lambda: Q.open_url(str(body.get("url") or ""), caller(request)[0], _via(request, body), str(body.get("browser") or "")))


@router.post("/notify")
def notify(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    """{kind: fyi|fix-update|alert|approval, title, body?, url?}"""
    return answer(lambda: Q.notify(str(body.get("kind") or "fyi"), str(body.get("title") or ""), str(body.get("body") or ""),
                                   caller(request)[0], _via(request, body), str(body.get("url") or "")))


@router.get("/commands")
def commands(limit: int = 50) -> Any:
    return answer(lambda: {"commands": Q.recent(limit)})


@router.get("/commands/{cid}")
def command(cid: str) -> Any:
    return answer(lambda: Q.get(cid))


@router.post("/devices/{device_id}/next")
def next_commands(device_id: str, body: dict = Body(default_factory=dict)) -> Any:
    """The phone's poll: a heartbeat plus every queued command for it (marked delivered)."""
    return answer(lambda: {"commands": Q.take(device_id, body), "settings": S.get()})


@router.post("/commands/{cid}/ack")
def ack(cid: str, body: dict = Body(default_factory=dict)) -> Any:
    """The phone's delivery ack and result: {deviceId, ok, data? | error?}."""
    return answer(lambda: Q.ack(cid, str(body.get("deviceId") or ""), body))


@router.get("/settings")
def settings_get() -> Any:
    return answer(S.get)


@router.post("/settings")
def settings_put(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: S.put(body, caller(request)[1]))
