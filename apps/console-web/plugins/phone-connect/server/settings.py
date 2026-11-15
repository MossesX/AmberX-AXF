"""Phone Connect settings (settings.json in the data dir). Every key is readable and settable through REST, MCP, CLI and voice."""
from __future__ import annotations

from typing import Any

from . import store
from .core import BROWSERS, PhoneError

NOTIFY_KINDS = ("fyi", "fix-update", "alert", "approval")
DEFAULTS: dict[str, Any] = {
    "browser": "chrome",            # chrome | default: where open_url lands on the phone
    "notify": {k: True for k in NOTIFY_KINDS},  # per-type switches, synced to the phone's channels
    "monitor": True,                # the phone's WatchService (approvals watch, alerts)
    "recorderMic": False,           # Record my mic too (opt-in, off by default)
}
# Settings a machine may not turn on by itself: only Brett's own click raises them.
OWNER_RAISE = ("recorderMic",)


def get() -> dict[str, Any]:
    s = store.read("settings.json", {})
    out = {**DEFAULTS, **{k: v for k, v in (s if isinstance(s, dict) else {}).items() if k in DEFAULTS}}
    out["notify"] = {**DEFAULTS["notify"], **{k: bool(v) for k, v in (out.get("notify") or {}).items() if k in NOTIFY_KINDS}}
    return out


def put(patch: dict[str, Any], person: bool) -> dict[str, Any]:
    cur = get()
    nxt = dict(cur)
    for k, v in (patch or {}).items():
        if k not in DEFAULTS:
            raise PhoneError("validation", f"{k} is not a Phone Connect setting ({', '.join(DEFAULTS)}).")
        if k == "browser" and v not in BROWSERS:
            raise PhoneError("validation", f"browser is one of {', '.join(BROWSERS)}.")
        if k == "notify":
            if not isinstance(v, dict) or any(x not in NOTIFY_KINDS or not isinstance(b, bool) for x, b in v.items()):
                raise PhoneError("validation", f"notify is {{kind: true|false}} for {', '.join(NOTIFY_KINDS)}.")
            v = {**cur["notify"], **v}
        elif k in ("monitor", "recorderMic") and not isinstance(v, bool):
            raise PhoneError("validation", f"{k} is true or false.")
        if k in OWNER_RAISE and v is True and cur[k] is False and not person:
            raise PhoneError("denied", f"{k} can only be turned on by Brett's own click; a command may only turn it off.", requires="person", personOnly=True)
        nxt[k] = v
    with store.LOCK:
        store.write("settings.json", nxt)
    return nxt
