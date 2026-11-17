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
    return {**c, "result": last if last and last.get("stage") == "done" else None, "ack": next((r for r in results if r.get("stage") == "ack"), None)}


def sweep(at: str = "") -> int:
    """Time out what the phone never took or never answered: no ack in HUB.ackSeconds, no result within the ttl."""
    at = at or now()
    n = 0
    for c in S.commands(limit=500):
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
    return {"ok": True, "deviceId": nd["deviceId"], "watch": nd["watch"], "urlPolicy": nd["urlPolicy"], "features": S.settings()["features"],
            "rotate": bool(nd.get("rotateRequested")), "hub": E.HUB, "link": E.LINK}


def next_call(d: dict, at: str = "") -> dict[str, Any] | None:
    """The oldest queued command for this phone as an AXPP call (status → sent), or None. Touches lastSeenAt."""
    at = at or now()
    with S.LOCK:
        S.save_device(E.seen(S.device(d["deviceId"]) or d, at))
        sweep(at)
        for c in sorted(S.commands(d["deviceId"], limit=200), key=lambda c: c["at"]):
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
    """Filled in by the approvals relay (s9)."""
    return {"ok": False, "code": "unavailable", "message": "the approvals relay is not wired yet"}


def _resolve_offline(d: dict) -> None:
    try:
        import console_context as cx
        cx.resolve_alerts([f"phone-connect:offline:{d['deviceId']}"])
    except Exception:  # noqa: BLE001
        pass


# ---- status (what every surface reads)

def status(at: str = "") -> dict[str, Any]:
    at = at or now()
    d = default_device()
    rec = (d or {}).get("capabilityState", {}).get("recorder@1") if d else None
    return {"ok": True, "$axf": "phone-connect-status@1", "at": at, "paired": bool(d), "device": device_view(d, at) if d else None,
            "presence": E.presence(d, at) if d else "not paired", "online": E.is_online(d, at) if d else False,
            "devices": len(S.devices()), "pairing": pairing_view(current_pairing(at), at), "features": S.settings()["features"],
            "recorder": rec or {"running": False}, "origin": origin()}


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
