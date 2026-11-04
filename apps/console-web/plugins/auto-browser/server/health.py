"""Systems check item for the browser host (axf.health@1, optional: without the systems check nothing registers).

  browser-host   The Automated Browser's host container answers /health. Red when it can't be reached (the live view,
                 routines and schedules all stop); Auto fix runs the plugin's deploy script on the VPS as a veto call.
"""
from __future__ import annotations

import os
from typing import Any

import plugin_services

CAPABILITY = "axf.health@1"
OWNER = "auto-browser"
_done = False


def deploy_command() -> str:
    host = os.environ.get("AXF_HOST_DIR") or "/opt/axf"
    return f'sh "{host}/apps/console-web/plugins/auto-browser/deploy.sh"'


def check(client: Any) -> dict[str, Any]:
    try:
        h = client.health()
    except Exception as e:  # noqa: BLE001 — HostError or anything else = not reachable
        return {"status": "error", "summary": f"Browser host not reachable ({getattr(e, 'detail', e)}).", "unreachable": True}
    n, mx, rss = h.get("sessions", 0), h.get("max", 0), h.get("rssMb", 0)
    return {"status": "ok", "summary": f"Browser host up: {n}/{mx} browsers open, host process {rss} MB.", "details": h}


def ensure(client: Any) -> bool:
    global _done
    if _done:
        return True
    reg = plugin_services.get(CAPABILITY)
    if reg is None:
        return False
    vps = getattr(reg, "vps_run", None)
    try:
        reg.register({"id": "browser-host", "label": "Automated Browser host answers", "service": "browser", "order": 60, "severity": "warn",
                      "run": lambda: check(client),
                      "breaks": "The Automated Browser's live view, routines and schedules can't run.",
                      "instructions": [f"On the VPS: {deploy_command()}",
                                       "It builds the axf-browser image from the plugin's host/ folder and runs it on the console's Docker network (never published on a port)."],
                      **({"autoFix": {"label": "Start the browser host on the VPS", "run": lambda: vps(deploy_command())}} if callable(vps) else {})}, OWNER)
    except Exception:  # noqa: BLE001 — the plugin works without its check
        return False
    _done = True
    return True
