"""Phone Connect service: what every surface calls (REST routes, capability axf.phone@1, MCP plugin commands, CLI, voice).

Pure of FastAPI: callers pass who is asking as an actor `{kind, who, via}`; only `person` actors (Brett's own signed-in
browser through the wall) may claim a pairing, revoke or forget a phone. Errors are wire errors (`engine.wire_error`).
"""
from __future__ import annotations

import os
import secrets
import uuid
from typing import Any

from . import engine as E
from . import store as S


class PhoneError(Exception):
    def __init__(self, err: dict[str, Any]):
        super().__init__(err.get("message", ""))
        self.err = err


def fail(code: str, message: str = "", detail: Any = None) -> None:
    raise PhoneError(E.wire_error(code, message, detail))


def rnd() -> float:
    return secrets.randbelow(1 << 53) / (1 << 53)


def origin() -> str:
    for k in ("AXF_PHONE_CONNECT_ORIGIN", "AXF_CONSOLE_PUBLIC_URL", "AXF_CONSOLE_URL", "AXF_PUBLIC_URL"):
        v = (os.environ.get(k) or "").strip().rstrip("/")
        if v.startswith("https://"):
            return v
    return "https://console.amberxai.com"


def now() -> str:
    return E.now_iso()


# ---- views (never the token hash)

def device_view(d: dict, at: str = "") -> dict[str, Any]:
    at = at or now()
    tok = d.get("token")
    return {**{k: v for k, v in d.items() if k != "token"},
            "token": {"prefix": tok.get("prefix"), "issuedAt": tok.get("issuedAt"), "rotatedAt": tok.get("rotatedAt")} if isinstance(tok, dict) else None,
            "online": E.is_online(d, at), "presence": E.presence(d, at)}


def pairing_view(p: dict | None, at: str = "") -> dict[str, Any] | None:
    if not p:
        return None
    at = at or now()
    left = max(0, int((E.ms(p["expiresAt"]) - E.ms(at)) / 1000)) if p.get("state") == "pending" else 0
    return {**p, "secondsLeft": left, "claimUrl": f"{origin()}/api/plugins/phone-connect/pair/confirm", "pairPage": f"{origin()}/?axf-open=view:settings/tab:settings.tabs=plugins/subtab:phone-connect"}


# ---- pairing

def current_pairing(at: str = "") -> dict | None:
    """The pending code, expired in place once past its 10 minutes."""
    at = at or now()
    p = S.pending_pairing()
    if p and E.pairing_expired(p, at):
        S.save_pairing(E.expire_pairing(p, at))
        S.log({"at": at, "op": "expire", "code": p["code"]})
        return None
    return p


def pair_start(by: dict, at: str = "") -> dict[str, Any]:
    """issue: a new code; issuing again cancels the old one. Anyone may issue, a session included."""
    at = at or now()
    with S.LOCK:
        old = current_pairing(at)
        if old:
            S.save_pairing(E.cancel_pairing(old, at))
        p = E.issue_pairing(at, by, rnd)
        v = E.validate_pairing(p)
        if not v["ok"]:
            fail("validation", E.rejection(v["errors"]))
        S.save_pairing(p)
    S.log({"at": at, "op": "issue", "code": p["code"], "by": by})
    return {"ok": True, "pairing": pairing_view(p, at)}


def pair_cancel(by: dict, at: str = "") -> dict[str, Any]:
    at = at or now()
    p = current_pairing(at)
    if not p:
        return {"ok": True, "cancelled": False}
    S.save_pairing(E.cancel_pairing(p, at))
    S.log({"at": at, "op": "cancel", "code": p["code"], "by": by})
    return {"ok": True, "cancelled": True}


def pair_confirm(hello: dict, person: dict | None, at: str = "") -> dict[str, Any]:
    """claim (personOnly). `person` comes from the request's wall sign-in, never from the body: a body claiming to be
    a person counts for nothing. Returns the device token exactly once."""
    at = at or now()
    hello = {**(hello if isinstance(hello, dict) else {}), "person": person}
    with S.LOCK:
        code = hello.get("code") if isinstance(hello.get("code"), str) else ""
        p = S.pairing(code) if E.is_code(code) else None
        existing = S.device(str((hello.get("device") or {}).get("deviceId") or "")) if isinstance(hello.get("device"), dict) else None
        r = E.claim_pairing(p, hello, at, rnd, existing)
        if not r["ok"]:
            S.log({"at": at, "op": "claim", "ok": False, "code": r["error"]["code"], "by": person})
            raise PhoneError(r["error"])
        S.save_pairing(r["pairing"])
        S.save_device(r["device"])
    S.log({"at": at, "op": "claim", "ok": True, "deviceId": r["device"]["deviceId"], "by": person})
    _alert("pair", r["device"]["deviceId"], f"{r['device']['name']} is paired with the console", "info")
    return {"ok": True, "token": r["token"], "device": device_view(r["device"], at), "origin": origin(), "link": E.LINK, "hub": E.HUB}


# ---- devices

def devices(at: str = "") -> list[dict[str, Any]]:
    at = at or now()
    return [device_view(d, at) for d in S.devices()]


def device_or_fail(device_id: str) -> dict:
    d = S.device(device_id)
    if not d:
        fail("not_found", f"no device {device_id}")
    return d  # type: ignore[return-value]


def revoke(device_id: str, by: dict, at: str = "") -> dict[str, Any]:
    at = at or now()
    with S.LOCK:
        d = device_or_fail(device_id)
        r = E.revoke_device(d, by, at)
        if not r["ok"]:
            raise PhoneError(r["error"])
        S.save_device(r["device"])
        for c in S.commands(device_id, limit=1000):
            if c.get("status") in ("queued", "sent", "acked"):
                _finish(c, E.wire_error("revoked", f"{d['name']} was revoked; pair it again"), at)
    S.log({"at": at, "op": "revoke", "deviceId": device_id, "by": by})
    _alert("pair", device_id, f"{d['name']} was revoked: its token no longer works", "info")
    return {"ok": True, "device": device_view(r["device"], at)}


def forget(device_id: str, by: dict, at: str = "") -> dict[str, Any]:
    at = at or now()
    if not isinstance(by, dict) or by.get("kind") != "person":
        fail("denied", "only the owner forgets a phone (a person's confirm, never a session)")
    d = device_or_fail(device_id)
    if d.get("state") == "paired":
        revoke(device_id, by, at)
    S.forget_device(device_id)
    S.log({"at": at, "op": "forget", "deviceId": device_id, "by": by})
    return {"ok": True, "forgotten": device_id}


def set_device(device_id: str, patch: dict, by: dict, at: str = "") -> dict[str, Any]:
    """Owner settings of one phone: watch {on, ring} and urlPolicy {mode, allowlist}. A person only."""
    at = at or now()
    if not isinstance(by, dict) or by.get("kind") != "person":
        fail("denied", "a phone's settings are the owner's (a person's tap, never a session)")
    with S.LOCK:
        d = device_or_fail(device_id)
        nd = dict(d)
        if isinstance(patch.get("watch"), dict):
            nd["watch"] = {**d["watch"], **{k: v for k, v in patch["watch"].items() if k in ("on", "ring") and isinstance(v, bool)}}
        if isinstance(patch.get("urlPolicy"), dict):
            nd["urlPolicy"] = {**d["urlPolicy"], **{k: v for k, v in patch["urlPolicy"].items() if k in ("mode", "allowlist")}}
        nd["updatedAt"] = at
        v = E.validate_device(nd)
        if not v["ok"]:
            fail("validation", E.rejection(v["errors"]), {"fields": [e["field"] for e in v["errors"]]})
        S.save_device(nd)
    S.log({"at": at, "op": "settings", "deviceId": device_id, "by": by})
    return {"ok": True, "device": device_view(nd, at)}


def new_id() -> str:
    return str(uuid.uuid4())


# ---- hooks filled by later parts of this module (queue, alerts)

def _finish(c: dict, error: dict, at: str) -> dict:
    res = {"$axf": E.FRAMES["result"], "id": c["id"], "deviceId": c["deviceId"], "command": c["command"], "at": at, "stage": "done", "ok": False, "error": error}
    c = {**c, "status": "failed", "results": [*(c.get("results") or []), res], "updatedAt": at}
    S.save_command(c)
    return c


def _alert(kind: str, ref: str, text: str, severity: str = "info") -> None:
    """Into the console's alert hub (it asks axf.notify@1 first); source phone-connect, key phone-connect:<kind>:<ref>."""
    try:
        import console_context as cx
        cx.raise_alert({"source": "phone-connect", "key": f"phone-connect:{kind}:{ref}", "title": text[:160], "severity": severity})
    except Exception:  # noqa: BLE001 — an alert that can't be raised never stops the call
        pass
