"""Phone Connect service: what every surface calls (REST routes, capability axf.phone@1, MCP plugin commands, CLI, voice).

Pure of FastAPI: callers pass who is asking as an actor `{kind, who, via}`; only `person` actors (Brett's own signed-in
browser through the wall) may claim a pairing, revoke or forget a phone. Errors are wire errors (`engine.wire_error`).
"""
from __future__ import annotations

import time
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
    clear_rejection()
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
        # the dead token's hash stays so its calls answer `revoked` (not `denied`) until the phone pairs again
        S.save_device({**r["device"], "revokedHash": (d.get("token") or {}).get("hash", "")})
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


# ---- command queue (s8): send → queued → sent (the phone took it off `next`) → acked → done | failed

OPEN = ("queued", "sent", "acked")
KEEP_DAYS = 7  # finished commands are kept a week, then dropped by the sweep


def default_device() -> dict | None:
    """The phone a command goes to when none is named: the paired one seen last."""
    ps = sorted(S.paired(), key=lambda d: d.get("lastSeenAt") or "", reverse=True)
    return ps[0] if ps else None


def send(command: str, arguments: dict | None, by: dict, device_id: str = "", approval_id: str = "", correlation_id: str = "",
         ttl: Any = None, at: str = "") -> dict[str, Any]:
    """Queue one command for a phone after every dispatch check (PHONE-CONNECT.md → Dispatch). Never carries a decision."""
    at = at or now()
    d = S.device(device_id) if device_id else default_device()
    if device_id and not d:
        fail("not_found", f"no device {device_id}")
    if not d:
        fail("unpaired", "no phone is paired: open Settings → Plugins → Phone Connect for a code")
    by = by if isinstance(by, dict) and by.get("kind") in E.FROM_KINDS else {"kind": "session", "who": "unknown", "via": "console"}
    m = E.make_command(command=command, arguments=arguments or {}, deviceId=d["deviceId"], from_=by, id=new_id(), at=at,
                       approvalId=approval_id or "", correlationId=(correlation_id or "")[:160], ttl=ttl)
    if not m["ok"]:
        raise PhoneError(m["error"])
    c = m["command"]
    if not S.feature_on(c["command"]):
        fail("denied", f"{S.FEATURES[S.FEATURE_OF[c['command']]]['label']} is switched off in Settings → Plugins → Phone Connect")
    if c["command"] == "notify" and not (by.get("kind") == "service" and by.get("who") == "alerts"):
        # every notification asks axf.notify@1 first (the alert hub already did for its own pushes)
        gate = _notify_gate()
        if gate is not None and not gate.allowed(c["arguments"]["notifyId"], "amberx"):
            fail("denied", f"{c['arguments']['notifyId']} is switched off for the phone in Settings → Plugins → Notifications")
    e = E.dispatch_errors(c, d, at, origin=origin())
    if e:
        S.log({"at": at, "op": "command", "ok": False, "command": c["command"], "deviceId": d["deviceId"], "code": e["code"], "from": by})
        raise PhoneError(e)
    rec = {**c, "status": "queued", "results": [], "updatedAt": at, **({"deprecated": m["deprecated"]} if m["deprecated"] else {})}
    S.save_command(rec)
    S.log({"at": at, "op": "command", "ok": True, "id": c["id"], "command": c["command"], "deviceId": d["deviceId"], "from": by})
    return {"ok": True, "id": c["id"], "command": command_view(rec), **({"deprecated": m["deprecated"]} if m["deprecated"] else {})}


def command_view(c: dict) -> dict[str, Any]:
    results = c.get("results") or []
    last = results[-1] if results else None
    v = {**c, "result": last if last and last.get("stage") == "done" else None, "ack": next((r for r in results if r.get("stage") == "ack"), None)}
    if c.get("command") == "open_url":
        # what really happened, the same words on every surface (REST, MCP, `axf phone command`, voice)
        v["opened"] = opened_how(v)
    return v


def sweep(at: str = "") -> int:
    """Time out what the phone never took or never answered: no ack in HUB.ackSeconds, no result within the ttl."""
    at = at or now()
    n = 0
    for c in S.commands(limit=100000):  # every command: the oldest are the ones to drop
        t = E.ms(at)
        if c.get("status") not in OPEN:
            if t - E.ms(c.get("updatedAt") or c["at"]) > KEEP_DAYS * 86400_000:
                S.drop_command(c["id"])
            continue
        if c["status"] == "queued" and t > E.ms(c["at"]) + c["ttl"] * 1000:
            why = f"the phone did not collect {c['command']} within its ttl ({c['ttl']} s)"
        elif c["status"] == "sent" and t > E.ms(c.get("sentAt") or c["at"]) + E.HUB["ackSeconds"] * 1000:
            why = f"the phone did not acknowledge {c['command']} within {E.HUB['ackSeconds']} s"
        elif c["status"] == "acked" and t > E.ms(c["at"]) + (c["ttl"] + E.HUB["ackSeconds"]) * 1000:
            why = f"no answer to {c['command']} within its ttl ({c['ttl']} s)"
        else:
            continue
        _finish(c, E.wire_error("timeout", why), at)
        n += 1
    if n:
        S.log({"at": at, "op": "sweep", "timedOut": n})
    return n


def command(cid: str) -> dict[str, Any]:
    sweep()
    c = S.command(cid)
    if not c:
        fail("not_found", f"no command {cid}")
    return {"ok": True, "command": command_view(c)}  # type: ignore[arg-type]


def commands(device_id: str = "", limit: int = 50) -> dict[str, Any]:
    sweep()
    return {"ok": True, "commands": [command_view(c) for c in S.commands(device_id, limit)]}


# ---- the phone's side of the link (device token; PHONE-CONNECT.md → The link)

REJECTED_KEEP_S = 7 * 86400  # a refused token older than this no longer reads as "disconnected"
REPAIR = {"reason": "pair"}  # machine-readable on every refused token: the phone stops retrying and asks to re-pair


def device_for(token: str, at: str = "") -> dict:
    """`device_by_token` for the phone's own routes: a refused token is recorded (status → link "disconnected", one
    banner alert, the systems check) and answered with `detail.reason: "pair"` so the phone stops retrying with it."""
    try:
        return device_by_token(token)
    except PhoneError as e:
        if e.err.get("code") in E.LINK["rejectedCodes"]:
            if E.is_token(token):  # only a real device key counts as a phone; anything else is just a wrong caller
                note_rejection(token, e.err["code"], at)
            raise PhoneError({**e.err, "detail": {**(e.err.get("detail") or {}), **REPAIR}}) from None
        raise


def note_rejection(token: str, code: str, at: str = "") -> dict[str, Any]:
    """One refused device token: when, how often, why, its prefix (never the token) and the phone it once belonged to."""
    at = at or now()
    prefix = token[: E.HUB["tokenPrefixChars"]]
    h = E.sha256hex(token)
    was = next((d for d in S.devices() if d.get("revokedHash") == h), None)
    with S.LOCK:
        old = S.link().get("rejected") or {}
        fresh = not old or old.get("prefix") != prefix
        rec = {"at": at, "first": at if fresh else old.get("first") or at, "count": 1 if fresh else int(old.get("count") or 0) + 1,
               "code": code, "prefix": prefix, "deviceId": (was or {}).get("deviceId", ""), "name": (was or {}).get("name", "")}
        S.save_link({"rejected": rec})
    if fresh:
        S.log({"at": at, "op": "rejected", "code": code, "prefix": prefix, "deviceId": rec["deviceId"]})
        _alert("rejected", prefix, f"{rec['name'] or 'A phone'} is trying to connect with an old key: re-pair it in Settings → Plugins → Phone Connect", "warning")
    return rec


def clear_rejection() -> None:
    """A phone greeted or paired again: the refused key is history, and its banner alert goes."""
    rej = S.link().get("rejected")
    if not rej:
        return
    S.save_link({})
    try:
        import console_context as cx
        cx.resolve_alerts([f"phone-connect:rejected:{rej.get('prefix', '')}"])
    except Exception:  # noqa: BLE001 — an alert that can't be resolved never stops the call
        pass


def link_state(d: dict | None, at: str = "") -> dict[str, Any]:
    """The link in one word for every surface: connected · offline · disconnected (a refused token after the phone was
    last seen: it will not come back by itself, re-pair) · not-paired."""
    at = at or now()
    rej = S.link().get("rejected") or None
    if rej and (E.ms(at) - E.ms(rej["at"])) / 1000 > REJECTED_KEEP_S:
        rej = None
    if d and E.is_online(d, at):
        return {"state": "connected", "message": f"{d['name']} is connected.", "rejected": None, "repair": ""}
    seen_at = (d or {}).get("lastSeenAt") or ""
    if rej and (not E.is_timestamp(seen_at) or E.ms(rej["at"]) > E.ms(seen_at)):
        who = rej.get("name") or (d or {}).get("name") or "The phone"
        return {"state": "disconnected", "message": f"Disconnected: {who} used a key the console no longer accepts. Tap to re-pair.", "rejected": rej, "repair": PAIR_ADDRESS}
    if d:
        return {"state": "offline", "message": f"{d['name']} is {E.presence(d, at)}.", "rejected": None, "repair": ""}
    return {"state": "not-paired", "message": "No phone is paired. Tap to pair.", "rejected": None, "repair": PAIR_ADDRESS}


def device_by_token(token: str) -> dict:
    """The phone a device token belongs to: `revoked`, `unpaired` or `denied` otherwise (never says which phone)."""
    if not E.is_token(token):
        fail("denied", "bad device token")
    h = E.sha256hex(token)
    last: dict | None = None
    for d in S.devices():
        if isinstance(d.get("token"), dict) and d["token"].get("hash") == h:
            e = E.verify_token(d, token)
            if e:
                raise PhoneError(e)
            return d
        if d.get("revokedHash") == h:
            last = d
    if last:
        raise PhoneError(E.wire_error("revoked", f"{last['name']} was revoked; pair it again"))
    raise PhoneError(E.wire_error("denied", "bad device token"))


def hello(d: dict, body: dict, at: str = "") -> dict[str, Any]:
    at = at or now()
    e = E.hello_errors(d)
    if e:
        raise PhoneError(e)
    info = body.get("device") if isinstance(body.get("device"), dict) else {}
    nd = E.seen(d, at, info.get("capabilityState"))
    if isinstance(info.get("capabilities"), list):
        caps = [c for c in dict.fromkeys(info["capabilities"]) if c in E.CAPABILITIES]
        nd["capabilities"] = caps
    if isinstance(info.get("appVersion"), str):
        nd["appVersion"] = info["appVersion"][:40]
    if nd.get("app") == "amberx-droid":
        nd["app"] = "phone-connect-droid"
    S.save_device(nd)
    _resolve_offline(nd)
    clear_rejection()
    return {"ok": True, "deviceId": nd["deviceId"], "watch": nd["watch"], "urlPolicy": nd["urlPolicy"], "features": S.settings()["features"],
            "rotate": bool(nd.get("rotateRequested")), "hub": E.HUB, "link": E.LINK}


# The phone's long poll asks for its next call every second. Marking the phone seen (a file write) and sweeping every
# command for timeouts are paced: lastSeenAt only has to stay inside HUB.onlineSeconds, a timeout is seconds-coarse.
SEEN_EVERY_S = 10
SWEEP_EVERY_S = 5
_paced: dict[str, dict[str, float]] = {}


def next_call(d: dict, at: str = "") -> dict[str, Any] | None:
    """The oldest queued command for this phone as an AXPP call (status → sent), or None. Touches lastSeenAt."""
    timed = bool(at)  # a caller that names the time (tests, replays) gets every step; the live poll is paced
    at = at or now()
    with S.LOCK:
        tick = time.monotonic()
        last = _paced.setdefault(d["deviceId"], {"seen": 0.0, "sweep": 0.0})
        if timed or tick - last["seen"] >= SEEN_EVERY_S:
            last["seen"] = tick
            S.save_device(E.seen(S.device(d["deviceId"]) or d, at))
        if timed or tick - last["sweep"] >= SWEEP_EVERY_S:
            last["sweep"] = tick
            sweep(at)
        for c in sorted(S.commands(d["deviceId"], limit=200, open_only=True), key=lambda c: c["at"]):
            if c.get("status") == "queued":
                S.save_command({**c, "status": "sent", "sentAt": at, "updatedAt": at})
                return E.to_wire(c)
    return None


def _merge_state(d: dict, state: Any, at: str) -> None:
    if isinstance(state, dict):
        S.save_device(E.seen(S.device(d["deviceId"]) or d, at, state))


def take_reply(d: dict, msg: dict, at: str = "") -> dict[str, Any]:
    """ack / result / error from the phone → phone-result@1 on the command. A decision is checked personOnly here."""
    at = at or now()
    cid = msg.get("correlationId") if isinstance(msg, dict) else None
    c = S.command(cid) if isinstance(cid, str) else None
    if not c or c.get("deviceId") != d["deviceId"]:
        fail("not_found", f"no command {cid} for this phone")
    if c.get("status") in ("done", "failed"):
        return {"ok": True, "already": c["status"]}
    r = E.from_wire(msg, c, at)
    v = E.validate_result(r)
    if not v["ok"]:
        fail("validation", E.rejection(v["errors"]))
    de = E.decision_errors(r, c, {"kind": "device"})
    if de:
        S.log({"at": at, "op": "decision", "ok": False, "id": c["id"], "code": de["code"]})
        raise PhoneError(de)
    if r["stage"] == "ack":
        c = {**c, "status": "acked", "results": [*(c.get("results") or []), r], "updatedAt": at}
    else:
        c = {**c, "status": "done" if r["ok"] else "failed", "results": [*(c.get("results") or []), r], "updatedAt": at}
        _merge_state(d, r.get("state"), at)
        if not r["ok"]:
            _alert("failed", c["id"], f"Phone: {c['command']} failed: {r['error']['message']}"[:160], "warning")
    S.save_command(c)
    S.log({"at": at, "op": r["stage"], "id": c["id"], "command": c["command"], "ok": r["ok"]})
    out: dict[str, Any] = {"ok": True, "status": c["status"]}
    if r["stage"] == "done" and r["ok"] and c["command"] == "approval" and isinstance(r.get("data"), dict) and "decision" in r["data"]:
        out["relay"] = relay_decision(c, r, at)
    return out


def rotate(d: dict, token: str, at: str = "") -> dict[str, Any]:
    at = at or now()
    r = E.rotate_token(d, token, at, rnd)
    if not r["ok"]:
        raise PhoneError(r["error"])
    nd = {k: v for k, v in r["device"].items() if k != "rotateRequested"}
    S.save_device(nd)
    S.log({"at": at, "op": "rotate", "deviceId": d["deviceId"]})
    return {"ok": True, "token": r["token"]}


def relay_decision(c: dict, r: dict, at: str) -> dict[str, Any]:
    """Brett tapped approve / deny / shelve on the phone (personOnly already checked by the engine): hand it to the
    approvals relay (approvals-relay@1, the approvals banner), which decides with the console's owner sign-in."""
    relay = _relay()
    d = S.device(c["deviceId"]) or {}
    owner = (d.get("owner") or {}).get("who", "") if isinstance(d.get("owner"), dict) else ""
    tap = {"kind": "phone-tap", "auth": "device", "by": r["by"], "deviceId": c["deviceId"], "owner": owner,
           "approvalId": c["arguments"]["approvalId"], "prompt": c["arguments"].get("kind", "approval"), "decision": r["data"]["decision"],
           **({"rev": c["arguments"]["rev"]} if isinstance(c["arguments"].get("rev"), int) else {})}
    if relay is None:
        out = {"ok": False, "code": "unavailable", "message": "The approvals banner is off, so the console can't pass your tap on. Open the approval on axHub."}
    else:
        try:
            out = relay.decide_from_phone_tap(tap)
        except Exception as e:  # noqa: BLE001
            out = {"ok": False, "code": "unexpected", "message": f"The relay failed ({type(e).__name__}). Nothing was decided."}
    S.log({"at": at, "op": "decision", "id": c["id"], "approvalId": tap["approvalId"], "decision": tap["decision"], "ok": bool(out.get("ok")), "code": out.get("code", "")})
    return out


def _notify_gate() -> Any:
    import plugin_services
    return plugin_services.get("axf.notify@1")


def _relay() -> Any:
    import plugin_services
    return plugin_services.get("approvals-relay@1")


def _resolve_offline(d: dict) -> None:
    try:
        import console_context as cx
        cx.resolve_alerts([f"phone-connect:offline:{d['deviceId']}"])
    except Exception:  # noqa: BLE001
        pass


def voice_in(d: dict, text: Any, at: str = "") -> dict[str, Any]:
    """A phrase Brett spoke on the phone (an Android voice intent) → the open console runs it as phone.voice:<phrase>
    (console-commands@1, owner audience). Never a decision: approve / deny are not console actions."""
    at = at or now()
    if not S.feature_on("voice"):
        fail("denied", "Voice is switched off in Settings → Plugins → Phone Connect")
    t = str(text or "").strip()[: E.LIMITS["text"]]
    if not t:
        fail("validation", "say something first")
    import plugin_services
    cc = plugin_services.get("console-commands@1")
    if cc is None:
        fail("unavailable", "The console commands plugin is off, so the phrase can't reach the console.")
    who = (d.get("owner") or {}).get("who", "phone") if isinstance(d.get("owner"), dict) else "phone"
    r = cc.run({"op": "act", "target": "console.actions", "path": "phone.voice", "action": "run", "input": {"args": [t]}, "by": f"phone:{who}"}, by=f"phone:{who}")
    S.log({"at": at, "op": "voice-in", "deviceId": d["deviceId"], "ok": bool(r.get("ok", True))})
    return {"ok": True, "sent": t, "console": {k: r.get(k) for k in ("ok", "status", "message") if k in r}}


# ---- status (what every surface reads)

def status(at: str = "") -> dict[str, Any]:
    at = at or now()
    d = default_device()
    rec = (d or {}).get("capabilityState", {}).get("recorder@1") if d else None
    return {"ok": True, "$axf": "phone-connect-status@1", "at": at, "paired": bool(d), "device": device_view(d, at) if d else None,
            "presence": E.presence(d, at) if d else "not paired", "online": E.is_online(d, at) if d else False,
            "devices": len(S.devices()), "pairing": pairing_view(current_pairing(at), at), "features": S.settings()["features"],
            "link": link_state(d, at), "lastSeenAt": (d or {}).get("lastSeenAt", ""), "approvals": _approvals_last(),
            "recorder": rec or {"running": False}, "origin": origin()}


def _approvals_last() -> dict[str, Any]:
    from . import approvals  # late: approvals.py imports this module
    return approvals.last()


SETTINGS_ADDRESS = "view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect"
PAIR_ADDRESS = f"{SETTINGS_ADDRESS}/tab:phone-connect.tabs=pair"


def presence(at: str = "") -> dict[str, Any]:
    """Is a phone there before Amber calls (MCP `phone_status`): paired, online, when it last checked in, and whether
    the link needs Brett (a refused key = re-pair). Read only; never a token."""
    at = at or now()
    d = default_device()
    seen_at = (d or {}).get("lastSeenAt") or ""
    feats = S.settings()["features"]
    return {"ok": True, "$axf": "phone-connect-presence@1", "at": at, "paired": bool(d), "online": bool(d) and E.is_online(d, at),
            "presence": E.presence(d, at) if d else "not paired", "lastSeenAt": seen_at,
            "lastSeenAgo": E.ago(seen_at, at) if E.is_timestamp(seen_at) else "",
            "device": {k: d.get(k) for k in ("deviceId", "name", "appVersion", "capabilities")} if d else None,
            "link": link_state(d, at), "features": feats, "appOutdated": app_outdated(d),
            "canOpenPages": bool(d) and E.is_online(d, at) and feats.get("open_url", True) and "open-url@1" in (d.get("capabilities") or [])}


# ---- open a page and bring it to the front (MCP `phone_open_url`)

BROWSERS = E.COMMANDS["open_url"]["arguments"]["browser"]["enum"]
WHERES = E.COMMANDS["open_url"]["arguments"]["where"]["enum"]
OPEN_WAIT_S = 8.0
HOW_WORDS = {"direct": "It is open and in front.", "console-overlay": "It is open in the console app's overlay.",
             "console-app": "The console app is open on it, in front.",
             "notification": "Android would not let it open by itself, so a high-priority notification is on the phone: one tap opens it.",
             "full-screen-intent": "A high-priority notification is on the phone: one tap opens it."}
NOTIFIED_HOWS = ("notification", "full-screen-intent")
WHY_WORDS = {"no-permission": "Not opened: Phone Connect may not display over other apps, so a notification is on the phone and one tap opens it. Allow it on the app's screen and pages open by themselves.",
             "launch-failed": "Not opened: the phone was allowed to open it but nothing came to the front, so a notification is on the phone and one tap opens it."}


def opened_how(c: dict[str, Any]) -> dict[str, Any]:
    """What the phone really did with one open_url command, never more than it said: {answered, opened, notified, how,
    why, message}. `opened` is true only when the phone answered that the page is on screen; a tap-to-open
    notification is `notified`, not opened (an app before 0.3.0 answered `opened: true` for both, so `how` decides);
    no answer yet is neither."""
    res = c.get("result") or {}
    data = res.get("data") or {}
    answered = c.get("status") == "done"
    how = str(data.get("how") or "")
    notified = answered and (how in NOTIFIED_HOWS or data.get("notified") is True)
    opened = answered and not notified and data.get("opened") is not False
    if not answered:
        message = "Sent to the phone; it has not answered yet, so nothing says it opened (read the command for its result)."
    elif notified:
        message = WHY_WORDS.get(str(data.get("why") or ""), HOW_WORDS["notification"])
    elif opened:
        message = HOW_WORDS.get(how, "The phone opened it.")
    else:
        message = "The phone took it and opened nothing (an overlay verb, or nothing to open)."
    return {"answered": answered, "opened": opened, "notified": notified, "how": how, "why": str(data.get("why") or ""), "message": message}


def open_page(url: Any, browser: Any = "", by: dict | None = None, device_id: str = "", wait_s: float = OPEN_WAIT_S) -> dict[str, Any]:
    """Open an https page on one of Brett's own sites (amberxai.com) on the paired phone, in Chrome or the default
    browser, in front. Waits a few seconds for the phone's answer, so the caller hears what really happened:
    `opened` with `how: direct` (in front), or `notified` with `how: notification` and `why` (it did not open; a
    notification waits for one tap). No answer in time is neither."""
    browser = str(browser or "chrome")
    if browser not in BROWSERS:
        fail("validation", f"browser must be one of {', '.join(BROWSERS)}")
    if not isinstance(url, str) or not url.strip():
        fail("validation", "url is needed: an https amberxai.com address")
    url = url.strip()
    try:
        scheme, host, _ = E._host(url)  # noqa: SLF001 — the engine's own url reader
    except (ValueError, KeyError):
        scheme, host = "", ""
    if scheme == "https:" and not E.own_site(host):
        fail("denied", f"{host} is not one of your own sites ({', '.join(E.OWN_SITES)}): this tool opens only those")
    r = send("open_url", {"url": url, "where": "browser", "browser": browser}, by or {"kind": "service", "who": "console", "via": "console"}, device_id)
    c = _wait(r["id"], wait_s)
    res = c.get("result") or {}
    if c["status"] == "failed":
        raise PhoneError((res.get("error") or E.wire_error("unexpected", "the phone failed to open it")))
    o = opened_how(c)
    return {"ok": True, "id": r["id"], "status": c["status"], "opened": o["opened"], "notified": o["notified"], "how": o["how"], "why": o["why"],
            "browser": browser, "url": url, "message": o["message"]}


def _wait(cid: str, wait_s: float) -> dict[str, Any]:
    """The command once it is done or failed, or as it stands when the wait runs out."""
    import time
    end = time.time() + max(0.0, wait_s)
    c = command(cid)["command"]
    while time.time() < end and c["status"] not in ("done", "failed"):
        time.sleep(0.25)
        c = command(cid)["command"]
    return c


def state(at: str = "") -> dict[str, Any]:
    """Everything the settings tab shows, in one read (REST GET state, MCP phone_connect_state, `axf phone state`), with
    the console-control@1 addresses that open each part (console_show / console_open)."""
    at = at or now()
    devs = devices(at)
    return {"ok": True, "$axf": "phone-connect-state@1", "status": status(at), "devices": devs, "settings": S.settings(),
            "commands": [command_view(c) for c in S.commands(limit=20)],
            "links": {"settings": SETTINGS_ADDRESS, "tabs": {t: f"tab:phone-connect.tabs={t}" for t in ("pair", "phones", "features", "activity")},  # axf-not-plugin:activity (a tab of this panel)
                      "devices": {d["deviceId"]: f"row:device/{d['deviceId']}" for d in devs},
                      "features": {k: f"setting:phone-connect.feature.{k}" for k in S.FEATURES},
                      "actions": {"open": "phone.open", "device": "phone.device:<deviceId>", "tab": "phone.tab:<pair|phones|features|activity>"}}}


def json_text(v: Any) -> str:
    import json
    return json.dumps(v, ensure_ascii=False)


class PhoneCapability:
    """axf.phone@1: other plugins reach the phone without naming this one. Every method raises PhoneError on a wire error.
    Deciding an approval is not here and never will be (personOnly)."""

    version = "axf.phone@1"

    def status(self) -> dict[str, Any]:
        return status()

    def available(self) -> bool:
        d = default_device()
        return bool(d) and E.is_online(d, now())

    def send(self, command: str, arguments: dict | None = None, *, by: dict | None = None, device_id: str = "", approval_id: str = "", correlation_id: str = "") -> dict[str, Any]:
        return send(command, arguments, by or {"kind": "service", "who": "console", "via": "console"}, device_id, approval_id, correlation_id)

    def open_url(self, url: str, *, by: dict | None = None, where: str = "overlay") -> dict[str, Any]:
        return self.send("open_url", {"url": url, "where": where}, by=by)

    def notify(self, kind: str, title: str, body: str = "", *, notify_id: str, url: str = "", priority: str = "normal", by: dict | None = None) -> dict[str, Any]:
        args = {"kind": kind, "title": title[: E.LIMITS["title"]], "notifyId": notify_id, "priority": priority}
        if body:
            args["body"] = body[: E.LIMITS["body"]]
        if url:
            args["url"] = url
        return self.send("notify", args, by=by)

    def approval(self, approval_id: str, *, kind: str = "approval", tool: str = "", summary: str = "", seconds_left: int = 0, by: dict | None = None) -> dict[str, Any]:
        args: dict[str, Any] = {"approvalId": approval_id, "kind": kind}
        if tool:
            args["tool"] = tool[: E.LIMITS["tool"]]
        if summary:
            args["summary"] = summary[: E.LIMITS["summary"]]
        if seconds_left:
            args["secondsLeft"] = int(seconds_left)
        return self.send("approval", args, by=by)

    def command(self, cid: str) -> dict[str, Any]:
        return command(cid)

    def presence(self) -> dict[str, Any]:
        return presence()

    def follow(self, address: str, *, by: dict | None = None) -> dict[str, Any]:
        """Follow Amber on the phone: bring the console to the front there at a console-control@1 address (or an
        action deep link such as `hub.review:<id>`). A no-op when the switch is off or no phone is online. Only ever
        opens the console's own page; never raises."""
        address = str(address or "").strip()[:500]
        if not address:
            return {"ok": False, "shown": False, "message": "nothing to show"}
        if not S.feature("follow"):
            return {"ok": True, "shown": False, "message": "Follow Amber on the phone is off (Settings → Plugins → Phone Connect → Features)"}
        if not self.available():
            return {"ok": True, "shown": False, "message": f"the phone is {status()['presence']}"}
        from urllib.parse import quote
        url = f"{origin()}/?axf-open={quote(address, safe=':/=.,_-')}"
        try:
            r = send("open_url", {"url": url}, by or {"kind": "service", "who": "follow", "via": "console"})
        except PhoneError as e:
            return {"ok": False, "shown": False, "message": e.err["message"], "error": e.err}
        return {"ok": True, "shown": True, "id": r["id"], "url": url, "message": "the phone is opening the console there"}

    # axHub tool names that the console answers from the paired phone first (callers keep their names). recorder_start
    # is not here: its approval is the hub's (decision #108); the hub's adapter relays it with the approvalId.
    HUB_TOOLS = {"amberx.open_url": "open_url", "phone.open_url": "open_url", "amberx.recorder_stop": "recorder.stop",
                 "phone.recorder_stop": "recorder.stop", "amberx.recorder_status": "recorder.status", "phone.recorder_status": "recorder.status"}

    def hub_tool(self, tool: str, arguments: dict | None = None, *, by: dict | None = None, wait_s: float = 12) -> dict[str, Any] | None:
        """An axHub `amberx.*` / `phone.*` call answered by the paired phone: None when no phone is online (the caller
        goes on to axHub as before), else {ok, output (text, like the hub's), command}. Never raises."""
        cmd = self.HUB_TOOLS.get(tool)
        if not cmd or not self.available():
            return None
        args = dict(arguments or {})
        if cmd == "open_url":
            # a caller that names only a browser wants the page in that browser (chrome | default), in front; one that
            # says where: overlay gets the console app first (its overlay, or the app in front), the browser after it
            where = args.get("where") if args.get("where") in WHERES else "browser" if args.get("browser") else "overlay"
            args = {"url": str(args.get("url") or ""), "where": where,
                    **({"browser": args["browser"]} if args.get("browser") in BROWSERS else {})}
        else:
            args = {}
        try:
            r = send(cmd, args, by or {"kind": "service", "who": "hub-tool", "via": "hub"})
        except PhoneError as e:
            return {"ok": False, "output": e.err["message"], "error": e.err}
        import time
        end = time.time() + max(0.0, wait_s)
        c = r["command"]
        while time.time() < end and c["status"] not in ("done", "failed"):
            time.sleep(0.5)
            c = command(r["id"])["command"]
        res = c.get("result") or {}
        if c["status"] == "failed":
            return {"ok": False, "output": (res.get("error") or {}).get("message", "the phone failed"), "command": c}
        data = res.get("data") or {}
        if cmd == "recorder.status":
            data = data or (status().get("recorder") or {})
        opened = opened_how(c) if cmd == "open_url" else None
        text = {"open_url": (opened or {}).get("message", ""),
                "recorder.stop": "Phone Connect stopped the recorder", "recorder.status": json_text(data)}[cmd]
        return {"ok": True, "output": text, "command": c, "data": data, **({"opened": opened} if opened else {})}

    def push_alert(self, alert: dict[str, Any], notify_id: str = "", url: str = "") -> dict[str, Any]:
        """The alert hub's phone channel: one console alert (it already passed axf.notify@1) as a phone notification."""
        sev = str(alert.get("severity") or "info")
        kind = "alert" if sev in ("error", "critical") else "fix" if str(alert.get("source") or "").startswith(("fix", "build")) else "fyi"
        d = default_device()
        link = url if url.startswith("https://") and d and not E.url_errors(url, d, origin()) else ""
        return self.notify(kind, str(alert.get("title") or "Console alert"), str(alert.get("body") or ""), notify_id=(notify_id or "phone-connect.direct")[: E.LIMITS["tool"]],
                           url=link, priority="high" if sev in ("error", "critical") else "normal", by={"kind": "service", "who": "alerts", "via": "console"})


# ---- systems check (health@1): "Phone offline / not paired" with an auto-fix that re-sends the pairing notice

HEALTH_ID = "phone-connect"
OFFLINE_RED_S = 600  # paired and watched, but silent this long = red
# The first app build that opens the console straight on the phone (the tap-to-open notification only as the fallback,
# and it says so) and floats a held approval over the screen with Approve / Deny on it. An older app still works, but
# a console wake arrives as a notification to tap and approvals only as a notification.
MIN_APP = "0.3.0"
APP_WHERE = "axHub → Apps → Phone Connect → Download (https://axhub.amberxai.com/apps)"


def app_outdated(d: dict | None) -> bool:
    """Is this phone's app older than MIN_APP? Unknown or odd versions count as old."""
    def parts(v: Any) -> tuple[int, ...]:
        try:
            return tuple(int(x) for x in str(v or "").split("-")[0].split("."))
        except ValueError:
            return ()
    return bool(d) and parts(d.get("appVersion")) < parts(MIN_APP)


def health_probe(at: str = "") -> dict[str, Any]:
    at = at or now()
    paired = S.paired()
    ls = link_state(default_device(), at)
    if ls["state"] == "disconnected":
        rej = ls["rejected"]
        return {"status": "error", "summary": "A phone is trying to connect with an old key: re-pair it in Settings → Plugins → Phone Connect. Until then approvals, pages and notifications don't reach it.",
                "details": [f"The console refused its key {rej['count']} time(s), last {E.ago(rej['at'], at)} ({rej['code']}).",
                            "On the phone: open Phone Connect, tap Re-pair, type the new code.", "Auto fix makes the code and sends you a notice with it."],
                "link": PAIR_ADDRESS}
    if not paired:
        revoked = [d for d in S.devices() if d.get("state") == "revoked"]
        return {"status": "warn", "summary": "No phone is paired with Phone Connect: pushes, approvals on the phone and the recorder can't reach you." + (" The last one was revoked." if revoked else ""),
                "details": ["Auto fix makes a pairing code and sends you a notice with it.", "Or: Settings → Plugins → Phone Connect → New code, then type it in the Phone Connect app."],
                "link": SETTINGS_ADDRESS}
    d = sorted(paired, key=lambda x: x.get("lastSeenAt") or "", reverse=True)[0]
    if E.is_online(d, at):
        if app_outdated(d):
            return {"status": "warn", "summary": f"{d['name']} runs Phone Connect {d.get('appVersion') or '?'}: update it to {MIN_APP} or newer so the console opens by itself (no notification to tap) and approvals float on screen with Approve / Deny.",
                    "details": [f"On the phone: {APP_WHERE}, install it over the old one.", "Open Phone Connect once afterwards; it keeps its pairing."],
                    "link": f"row:device/{d['deviceId']}"}
        return {"status": "ok", "summary": f"{d['name']} is online (Phone Connect).", "details": []}
    silent = (E.ms(at) - E.ms(d["lastSeenAt"])) / 1000 if E.is_timestamp(d.get("lastSeenAt")) else 1e9
    pres = E.presence(d, at)
    red = d.get("watch", {}).get("on") and silent > OFFLINE_RED_S
    return {"status": "error" if red else "warn", "summary": f"{d['name']} is {pres}: pushes, approvals and the recorder wait until it polls again.",
            "details": ["Open the Phone Connect app on the phone, or switch its watch on.", "Auto fix sends you a notice to open it (and a fresh pairing code if it was unpaired)."],
            "link": f"row:device/{d['deviceId']}"}


def health_fix(at: str = "") -> dict[str, Any]:
    """Re-send the pairing notice: a fresh code when nothing is paired, else a notice to open the app. Through the alert
    hub (axf.notify@1 decides where it goes: web push / ntfy, AmberX while it exists)."""
    at = at or now()
    paired = S.paired()
    if not paired or link_state(default_device(), at)["state"] == "disconnected":
        p = current_pairing(at) or pair_start({"kind": "service", "who": "systems-check", "via": "console"}, at)["pairing"]  # axf-not-plugin:systems-check (actor name)
        _alert("pair", "notice", f"Pair your phone: code {p['code']} in the Phone Connect app (10 min)", "warning")
        return {"state": "done", "message": f"Pairing code {p['code']} issued and sent as a notice.", "link": SETTINGS_ADDRESS}
    d = sorted(paired, key=lambda x: x.get("lastSeenAt") or "", reverse=True)[0]
    _alert("offline", d["deviceId"], f"{d['name']} is offline: open Phone Connect on it", "warning")
    return {"state": "started", "message": f"Sent a notice to open Phone Connect on {d['name']}.", "waitS": 300}


_health_done = False


def ensure_health() -> bool:
    """Registers the check once axf.health@1 is there (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    import plugin_services
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Phone Connect (phone paired and online)", "service": "phone", "order": 45, "severity": "warn",
                      "run": lambda: health_probe(),
                      "breaks": "Without a paired, online phone, notifications, approval prompts on the phone, open-a-page and the audio recorder can't reach you.",
                      "instructions": [f"Install or update the Phone Connect app ({MIN_APP} or newer) on the phone: {APP_WHERE}.",
                                       "Settings → Plugins → Phone Connect → New code (or Re-pair when it says disconnected).",
                                       "Open the Phone Connect app, sign in to axHub when it asks, type the code, tap Pair.", "Switch Watch on so the link stays open.",
                                       "For pages that come to the front by themselves: in the app, tap Allow opening pages in front."],
                      "autoFix": {"label": "Re-send the pairing notice", "run": lambda: health_fix()}}, "phone-connect")
    except Exception:  # noqa: BLE001 — the plugin works without its health item
        return False
    _health_done = True
    return True
