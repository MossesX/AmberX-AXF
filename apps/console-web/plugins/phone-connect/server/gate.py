"""Systems check item for the AmberX retirement gate: red until a phone is paired and online, with the exact steps.
The full gate (test notify and open_url acked, recorder status answers) is retire-check.mjs; this item says where it
stands without sending anything."""
from __future__ import annotations

import threading
from typing import Any

from . import devices as D
from . import store

HEALTH_ID = "phone-connect-gate"
STEPS = [
    "Install Phone Connect on the phone: the APK phone-connect-debug.apk from the app catalog (Apps) or the Android CI run.",
    "Open it once: sign in with your hub account, then Settings → Plugins → Phone Connect → Pair a phone and scan the QR (or type the code).",
    "Allow notifications and 'Display over other apps', tap Done.",
    "Run `node apps/console-web/plugins/phone-connect/retire-check.mjs` on the VPS (or ask Amber); when it passes, AmberX is retired.",
]


def probe() -> dict[str, Any]:
    st = D.status()
    dev = st.get("device")
    if not dev:
        return {"status": "warn", "summary": "Phone Connect: no phone paired yet, so AmberX can't be retired.", "details": STEPS}
    if not dev.get("online"):
        return {"status": "warn", "summary": f"Phone Connect: {dev.get('name') or 'the phone'} is {dev.get('presence')}.", "details": ["Open Phone Connect on the phone and leave Monitor on."]}
    return {"status": "ok", "summary": f"Phone Connect: {dev.get('name') or 'the phone'} is paired and online."}


def register(tries: int = 12) -> None:
    try:
        import plugin_services
    except Exception:  # noqa: BLE001 — tests
        return
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        if tries > 1:
            t = threading.Timer(5.0, register, args=(tries - 1,))
            t.daemon = True
            t.start()
        return
    try:
        reg.register({"id": HEALTH_ID, "label": "Phone Connect paired (AmberX retirement gate)", "service": "console", "order": 64, "severity": "warn",
                      "run": probe, "breaks": "Approvals, alerts, open-page and the recorder don't reach the phone; AmberX stays until this passes.",
                      "instructions": STEPS}, store.FOLDER)
    except Exception:  # noqa: BLE001
        pass
