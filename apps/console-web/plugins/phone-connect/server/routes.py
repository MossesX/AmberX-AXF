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

Overlay (the phone's toolbar, popups and button; synced on the phone's next poll)
  GET    overlay                    the config (phone-overlay@1)
  POST   overlay                    a patch: items (whole list), popups.<approval|alert|notification>.*, buttonSize, …
  GET    overlay/presets            named starting points; POST overlay/presets/{id} applies one

Recorder (Audio Output Recorder, moved in whole)
  GET    recorder/status            running, session, current part, parts, upload queue, mic, transcripts
  POST   recorder/start             {session_name, group?, note?, approvalId?}: a straight approval on axHub
  POST   recorder/stop
  GET    recorder/transcripts       the transcription worker; POST recorder/transcripts/run looks now

Auto-approval rules (the Monitor watch; never destructive tools, personOnly actions, recorder_start or vps.run)
  GET    rules                      every rule (active or not)
  POST   rules                      {what, scope?, expiresAt?, note?}: on at once from Brett's click, proposed from a command
  POST   rules/{id}/enable          {on}: turning a rule on is personOnly
  DELETE rules/{id}
  POST   rules/evaluate             {tool, project?, agent?, build?, destructive?, personOnly?} → {approve, rule?, why}

Every error answers {"error": {code, message, retryable}} with the HTTP status for its code.
"""
from __future__ import annotations

from typing import Any, Callable

from fastapi import APIRouter, Body, Request
from fastapi.responses import JSONResponse

from . import commands as Q
from . import devices as D
from . import recorder as R
from . import rules as RU
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
    return answer(lambda: {"commands": Q.take(device_id, body), "settings": S.get(), "rules": RU.synced()})


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


# ------------------------------------------------------------------ recorder (moved in from the old output recorder)

@router.get("/recorder/status")
def recorder_status() -> Any:
    return answer(R.status)


@router.post("/recorder/start")
def recorder_start(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    """{session_name, group?, note?, approvalId?, reason?: {title, description}} — a straight approval on axHub."""
    reason = body.get("reason") if isinstance(body.get("reason"), dict) else None
    return answer(lambda: R.start(str(body.get("session_name") or ""), str(body.get("group") or ""), str(body.get("note") or ""), reason,
                                  str(body.get("approvalId") or ""), caller(request)[0], _via(request, body)))


@router.post("/recorder/stop")
def recorder_stop(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: R.stop(caller(request)[0], _via(request, body)))


@router.get("/recorder/transcripts")
def recorder_transcripts() -> Any:
    return answer(R.transcripts_status)


@router.post("/recorder/transcripts/run")
def recorder_transcripts_run() -> Any:
    return answer(R.run_now)


# ------------------------------------------------------------------ auto-approval rules

@router.get("/rules")
def rules_list() -> Any:
    return answer(lambda: {"rules": RU.list_rules()})


@router.post("/rules")
def rules_add(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    name, person = caller(request)
    return answer(lambda: RU.add(str(body.get("what") or ""), str(body.get("scope") or "any"), str(body.get("expiresAt") or ""),
                                 str(body.get("note") or ""), name, person))


@router.post("/rules/{rule_id}/enable")
def rules_enable(rule_id: str, request: Request, body: dict = Body(default_factory=dict)) -> Any:
    on = body.get("on", True) is not False
    return answer(lambda: RU.enable(rule_id, on) if not on else (require_person(request, "Turning an auto-approval rule on") and RU.enable(rule_id, True)))


@router.delete("/rules/{rule_id}")
def rules_remove(rule_id: str) -> Any:
    return answer(lambda: RU.remove(rule_id))


@router.post("/rules/evaluate")
def rules_evaluate(body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: RU.evaluate(body))


# ------------------------------------------------------------------ AmberX aliases (one release, answered as deprecated)

def _deprecated(old: str, new: str, fn: Callable[[], Any]) -> Any:
    out = answer(fn)
    if isinstance(out, dict):
        return {**out, "deprecated": f"{old} is deprecated: use {new}"}
    return out


@router.post("/amberx/open_url")
def amberx_open_url(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return _deprecated("amberx.open_url", "phone.open_url", lambda: Q.open_url(str(body.get("url") or ""), caller(request)[0], _via(request, body), str(body.get("browser") or "")))


@router.post("/amberx/recorder_start")
def amberx_recorder_start(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    reason = body.get("reason") if isinstance(body.get("reason"), dict) else None
    return _deprecated("amberx.recorder_start", "phone.recorder_start", lambda: R.start(str(body.get("session_name") or ""), str(body.get("group") or ""), str(body.get("note") or ""),
                                                                                         reason, str(body.get("approvalId") or ""), caller(request)[0], _via(request, body)))


@router.post("/amberx/recorder_stop")
def amberx_recorder_stop(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return _deprecated("amberx.recorder_stop", "phone.recorder_stop", lambda: R.stop(caller(request)[0], _via(request, body)))


@router.get("/amberx/recorder_status")
def amberx_recorder_status() -> Any:
    return _deprecated("amberx.recorder_status", "phone.recorder_status", R.status)


# ------------------------------------------------------------------ pairing QR

@router.get("/pair/qr.svg")
def pair_qr() -> Any:
    """The waiting code as a QR (axf-phone://pair?code=…), for the phone's one-time sign-in page to scan."""
    from fastapi.responses import Response

    p = D.pairing()
    if not p:
        return JSONResponse({"error": PhoneError("not_found", "No pairing is waiting.").as_dict()}, status_code=404)
    try:
        import io

        import segno
    except ImportError:
        return JSONResponse({"error": PhoneError("unavailable", "The QR engine isn't installed; type the code on the phone.").as_dict()}, status_code=503)
    buf = io.BytesIO()
    segno.make(f"axf-phone://pair?code={p['code']}", error="m").save(buf, kind="svg", scale=6, border=2, dark="currentColor", light=None, xmldecl=False, svgns=True)
    return Response(buf.getvalue(), media_type="image/svg+xml", headers={"cache-control": "no-store"})


# ------------------------------------------------------------------ overlay (synced to the phone)

@router.get("/overlay")
def overlay_get() -> Any:
    return answer(lambda: S.get()["overlay"])


@router.post("/overlay")
def overlay_set(request: Request, body: dict = Body(default_factory=dict)) -> Any:
    return answer(lambda: S.put({"overlay": body}, caller(request)[1])["overlay"])


@router.get("/overlay/presets")
def overlay_presets() -> Any:
    return answer(lambda: {"presets": S.presets()})


@router.post("/overlay/presets/{preset_id}")
def overlay_preset(preset_id: str, request: Request) -> Any:
    return answer(lambda: S.apply_preset(preset_id, caller(request)[1])["overlay"])
