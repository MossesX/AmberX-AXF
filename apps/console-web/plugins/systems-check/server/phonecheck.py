"""Phone gets approvals (Nov 5 2026): is AmberX's watch alive on the paired phone, and a test approval that proves it.

AmberX keeps an AXPP link to axHub for as long as its watch runs, so `amberx.recorder_status` (a read that needs no
approval) says whether the phone was heard from in the last minute. The test is a real held call of a harmless command,
so it takes the same road as any approval: the hub holds it, the phone's watch reads the feed and raises the card.
"""
from __future__ import annotations

import json
import threading
from typing import Any, Callable

TEST_COMMAND = 'echo "AmberX test approval: nothing changes"; date'
BREAKS = "Approvals and held calls don't reach the phone until AmberX is opened; a held call runs when its countdown ends."
STEPS = [
    "Open AmberX once: the watch starts and re-arms itself.",
    "AmberX → Settings → Plugins → Monitoring → Phone gets approvals: fix anything marked red (battery, notifications, alarms).",
    "Send test approval, with the app closed and the screen off.",
]


def online(text: str) -> bool | None:
    """`online` from recorder_status' answer; None when the answer doesn't say."""
    try:
        v = json.loads(text)
    except (TypeError, ValueError):
        return None
    if isinstance(v, dict):
        for o in (v, v.get("data"), v.get("result")):
            if isinstance(o, dict) and isinstance(o.get("online"), bool):
                return o["online"]
    return None


def check(call: Callable[..., dict[str, Any]]) -> dict[str, Any]:
    try:
        r = call("amberx.recorder_status", {}, None, 20)
    except Exception as e:  # noqa: BLE001 — the hub's refusal or a dead link: nothing here knows the phone's state
        return {"status": "warn", "unreachable": True, "summary": f"Couldn't ask axHub about the phone: {str(e)[:160]}"}
    up = online(str(r.get("ok", "")))
    if up is None:
        return {"status": "warn", "summary": "axHub didn't say whether the phone is online."}
    if up:
        return {"status": "ok", "summary": "AmberX's watch is talking to axHub, so approvals reach the phone with the app closed."}
    return {"status": "warn", "summary": "AmberX hasn't been heard from: approvals may wait until the app is opened (or the phone is off).", "breaks": BREAKS}


def send_test(call: Callable[..., dict[str, Any]]) -> dict[str, Any]:
    """Sends the held test call in the background: answers at once, the phone is the proof."""
    def run() -> None:
        try:
            call("vps.run", {"command": TEST_COMMAND}, None, 30)
        except Exception:  # noqa: BLE001 — shows as no card on the phone; the hub logs its own refusal
            pass
    threading.Thread(target=run, name="phone-test", daemon=True).start()
    return {"state": "started", "message": "Test approval sent: it should pop up on the phone within a minute.", "waitS": 120}
