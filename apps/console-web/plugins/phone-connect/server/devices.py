"""The device registry and pairing (phone-connect@1): devices.json (phone-devices@1) and pairing.json (phone-pairing@1).

  issue    a code, 10 minutes, single use (anyone with the console token may ask: the code alone pairs nothing)
  claim    the phone sends the code with its hello, signed in with Brett's own hub session (personOnly)
  cancel   drop the waiting code
  list/get every device with its presence (online = heartbeat within 45 s)
  revoke   the phone is refused from then on; forget drops a revoked record
  beat     a paired phone's heartbeat: lastSeenAt and capability state
"""
from __future__ import annotations

from typing import Any

from . import core as C
from . import store

DEVICES = "devices.json"
PAIRING = "pairing.json"
DEVICES_FRAME = "phone-devices@1"


def _doc() -> dict[str, Any]:
    d = store.read(DEVICES, None)
    if not isinstance(d, dict) or not isinstance(d.get("devices"), list):
        d = {"$axf": DEVICES_FRAME, "devices": []}
    return d


def _save(doc: dict[str, Any]) -> None:
    store.write(DEVICES, doc)


def view(device: dict[str, Any], at: str) -> dict[str, Any]:
    d = C.norm_device(device, at)
    return {**d, "online": C.is_online(d, at), "presence": C.presence(d, at)}


def list_devices(at: str | None = None) -> list[dict[str, Any]]:
    at = at or C.now_iso()
    return [view(d, at) for d in _doc()["devices"]]


def find(device_id: str) -> dict[str, Any]:
    for d in _doc()["devices"]:
        if d.get("deviceId") == device_id:
            return d
    raise C.PhoneError("not_found", f"No phone {device_id!r}.")


def get(device_id: str, at: str | None = None) -> dict[str, Any]:
    return view(find(device_id), at or C.now_iso())


def current(at: str | None = None) -> dict[str, Any] | None:
    """The paired phone (the newest pairing when there are several), or None."""
    paired = [d for d in _doc()["devices"] if d.get("state") == "paired"]
    paired.sort(key=lambda d: d.get("pairedAt") or "", reverse=True)
    return view(paired[0], at or C.now_iso()) if paired else None


def _put(device: dict[str, Any]) -> None:
    with store.LOCK:
        doc = _doc()
        doc["devices"] = [d for d in doc["devices"] if d.get("deviceId") != device["deviceId"]] + [device]
        _save(doc)


def pairing(at: str | None = None) -> dict[str, Any] | None:
    """The waiting pairing (expired ones end here), or None."""
    at = at or C.now_iso()
    with store.LOCK:
        p = store.read(PAIRING, None)
        if not isinstance(p, dict) or p.get("state") != "pending":
            return None
        if C.pairing_expired(p, at):
            store.write(PAIRING, C.end_pairing(p, "expire", at))
            return None
        return p


def issue(by: str, device_id: str = "", at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    with store.LOCK:
        p = C.issue_pairing(C.new_code(), at, by, device_id)
        store.write(PAIRING, p)
        return {**p, "qr": f"axf-phone://pair?code={p['code']}"}


def cancel(at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    with store.LOCK:
        p = pairing(at)
        if not p:
            raise C.PhoneError("not_found", "No pairing is waiting.")
        ended = C.end_pairing(p, "cancel", at)
        store.write(PAIRING, ended)
        return ended


def claim(hello: dict[str, Any], owner: str, at: str | None = None) -> dict[str, Any]:
    """The phone's code + hello, from Brett's own hub session (the route checks personOnly before this)."""
    at = at or C.now_iso()
    with store.LOCK:
        p = pairing(at)
        if not p:
            raise C.PhoneError("not_found", "No pairing is waiting. Start one on the console.")
        device, done = C.confirm_pairing(p, hello, at, owner)
        try:
            old = find(device["deviceId"])
            if old.get("migratedFrom"):
                device["migratedFrom"] = old["migratedFrom"]
        except C.PhoneError:
            pass
        _put(device)
        store.write(PAIRING, done)
        return view(device, at)


def beat(device_id: str, payload: dict[str, Any], at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    with store.LOCK:
        d = C.seen(find(device_id), payload or {}, at)
        _put(d)
        return view(d, at)


def revoke(device_id: str, by: str, why: str = "", at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    with store.LOCK:
        d = C.revoke(find(device_id), at, by, why)
        _put(d)
        return view(d, at)


def forget(device_id: str) -> dict[str, Any]:
    with store.LOCK:
        d = find(device_id)
        if C.transition(d.get("state", ""), "forget") is None:
            raise C.PhoneError("invalid", "Only a revoked phone can be forgotten. Revoke it first.")
        doc = _doc()
        doc["devices"] = [x for x in doc["devices"] if x.get("deviceId") != device_id]
        _save(doc)
        return {"forgotten": device_id}


def status(at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    cur = current(at)
    p = pairing(at)
    return {"device": cur, "online": bool(cur and cur["online"]), "presence": cur["presence"] if cur else "not paired",
            "pairing": {k: p[k] for k in ("code", "expiresAt", "by")} if p else None, "devices": len(_doc()["devices"])}
