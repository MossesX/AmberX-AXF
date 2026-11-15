"""The command queue (phone-connect@1 commands for the paired phone), with delivery acks. commands.json in the data dir.

A command is queued even while the phone is offline; the phone takes it on its next poll (delivered) and answers it
(acked, with a phone-result@1). Lifecycle: queued → delivered → acked | failed; queued for 24 h without a poll →
expired. The newest 200 are kept.

  open_url   amberxai.com over https only (and its subdomains), opened in Chrome or the default browser
  notify     FYI, fix updates, alerts, approvals: checked against this plugin's per-type switches and axf.notify@1
"""
from __future__ import annotations

import uuid
from datetime import timedelta
from typing import Any

from . import core as C
from . import devices as D
from . import settings as S
from . import store

FILE = "commands.json"
KEEP = 200
QUEUED_HOURS = 24
# notify kind → the phone channel and priority (notify.json types phone-connect.<kind>)
KIND_CHANNEL = {"fyi": ("console", "normal"), "fix-update": ("console", "normal"), "alert": ("alerts", "high"), "approval": ("approvals", "high")}


def _load() -> list[dict[str, Any]]:
    d = store.read(FILE, {})
    return d.get("commands", []) if isinstance(d, dict) else []


def _save(items: list[dict[str, Any]]) -> None:
    store.write(FILE, {"$axf": "phone-command-queue@1", "commands": items[-KEEP:]})


def _expire(items: list[dict[str, Any]], at: str) -> None:
    now = C._parse(at)
    for it in items:
        q = C._parse(it.get("queuedAt"))
        if it["status"] == "queued" and now and q and now - q > timedelta(hours=QUEUED_HOURS):
            it["status"] = "expired"


def enqueue(tool: str, arguments: dict[str, Any], who: str, via: str, approval_id: str = "", extra: dict[str, Any] | None = None,
            device_id: str = "", at: str | None = None) -> dict[str, Any]:
    at = at or C.now_iso()
    dev = D.get(device_id, at) if device_id else D.current(at)
    if not dev:
        raise C.PhoneError("unpaired", "No phone is paired. Pair one from the console.")
    cmd = C.norm_command({"id": str(uuid.uuid4()), "at": at, "deviceId": dev["deviceId"], "tool": tool, "arguments": arguments,
                          "from": {"who": who, "via": via}, **({"approvalId": approval_id} if approval_id else {})}, at)
    errs = C.args_errors(cmd["tool"] or tool, arguments)
    if errs:
        raise C.PhoneError("validation", errs[0])
    err = C.dispatch_error(cmd, dev)
    if err:
        raise err
    entry = {"command": {**cmd, **(extra or {})}, "status": "queued", "queuedAt": at, "deliveredAt": "", "ackedAt": "", "result": None,
             "online": dev["online"], "presence": dev["presence"]}
    with store.LOCK:
        items = _load()
        items.append(entry)
        _save(items)
    return entry


def open_url(url: str, who: str, via: str, browser: str = "", at: str | None = None) -> dict[str, Any]:
    clean = C.open_url_allowed(url, "own")
    b = browser or S.get()["browser"]
    if b not in C.BROWSERS:
        raise C.PhoneError("validation", f"browser is one of {', '.join(C.BROWSERS)}.")
    return enqueue("phone.open_url", {"url": clean, "where": "browser", "browser": b}, who, via, at=at)


def notify(kind: str, title: str, body: str, who: str, via: str, url: str = "", at: str | None = None) -> dict[str, Any]:
    if kind not in KIND_CHANNEL:
        raise C.PhoneError("validation", f"kind is one of {', '.join(KIND_CHANNEL)}.")
    if not S.get()["notify"].get(kind, True):
        return {"status": "skipped", "why": f"{kind} notifications are switched off for the phone (Settings → Plugins → Phone Connect)."}
    gate = _notify_gate()
    if gate is not None and not gate.allowed(f"phone-connect.{kind}", "amberx"):
        return {"status": "skipped", "why": f"phone-connect.{kind} is off for the phone in the Notifications panel."}
    channel, priority = KIND_CHANNEL[kind]
    args: dict[str, Any] = {"title": title, "channel": channel, "priority": priority}
    if body:
        args["body"] = body
    if url:
        args["url"] = C.open_url_allowed(url, "own")
    return enqueue("phone.notify", args, who, via, extra={"kind": kind}, at=at)


def _notify_gate() -> Any:
    try:
        import plugin_services
        return plugin_services.get("axf.notify@1")
    except Exception:  # noqa: BLE001 — tests run without the console
        return None


def recent(limit: int = 50, at: str | None = None) -> list[dict[str, Any]]:
    with store.LOCK:
        items = _load()
        _expire(items, at or C.now_iso())
        _save(items)
    return list(reversed(items))[: max(1, min(limit, KEEP))]


def get(cid: str) -> dict[str, Any]:
    for it in _load():
        if it["command"]["id"] == cid:
            return it
    raise C.PhoneError("not_found", f"No command {cid!r}.")


def take(device_id: str, payload: dict[str, Any] | None = None, at: str | None = None) -> list[dict[str, Any]]:
    """The phone's poll: counts as a heartbeat, hands over every queued command for it and marks them delivered."""
    at = at or C.now_iso()
    D.beat(device_id, payload or {}, at)
    out = []
    with store.LOCK:
        items = _load()
        _expire(items, at)
        for it in items:
            if it["status"] == "queued" and it["command"]["deviceId"] == device_id:
                it["status"], it["deliveredAt"] = "delivered", at
                out.append(it["command"])
        _save(items)
    return out


def ack(cid: str, device_id: str, result: dict[str, Any], at: str | None = None) -> dict[str, Any]:
    """The phone's answer to one command (phone-result@1: ok, data or error)."""
    at = at or C.now_iso()
    with store.LOCK:
        items = _load()
        for it in items:
            if it["command"]["id"] != cid:
                continue
            if it["command"]["deviceId"] != device_id:
                raise C.PhoneError("denied", "That command was sent to another phone.")
            if it["status"] in ("acked", "failed"):
                return it
            ok = bool((result or {}).get("ok"))
            err = (result or {}).get("error") if not ok else None
            if err is not None:
                code = err.get("code") if err.get("code") in C.ERROR_CODES else "unexpected"
                err = {"code": code, "message": C._s(err.get("message"), C.TEXT_MAX), "retryable": code in C.RETRYABLE}
            it["result"] = {"$axf": C.RESULT_FRAME, "id": cid, "tool": it["command"]["tool"], "deviceId": device_id, "at": at, "ok": ok,
                            **({"data": result.get("data") if isinstance(result.get("data"), dict) else {}} if ok else {"error": err})}
            it["status"], it["ackedAt"] = ("acked" if ok else "failed"), at
            _save(items)
            return it
    raise C.PhoneError("not_found", f"No command {cid!r}.")
