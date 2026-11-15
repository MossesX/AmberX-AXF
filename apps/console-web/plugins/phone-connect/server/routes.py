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

Every error answers {"error": {code, message, retryable}} with the HTTP status for its code.
"""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from . import devices as D
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
