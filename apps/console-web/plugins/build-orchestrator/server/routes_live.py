"""Live build status (build-live@1): snapshot, settings and broke routes, and the systems check item `build-live`.

The SSE stream is live.py. Health (axf.health@1): red when the 15-second liveness pass (deploy/systemd/axf-liveness.timer
→ liveness.mjs pass) left no heartbeat summary for 3 passes while builds are marked running, amber when the channel has
never had one; Auto fix reinstalls and restarts the timer on the VPS.
"""
from __future__ import annotations

import json
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter

import plugin_services

from . import live

HEALTH_CAP = "axf.health@1"
HEALTH_ID = "build-live"
STALE_PASSES = 3
FIX_COMMAND = ("cd /opt/axf && . framework/deploy/axf-deploy.sh"
               " && axf_systemd_unit deploy/systemd/axf-liveness.service /opt/axf && axf_systemd_unit deploy/systemd/axf-liveness.timer /opt/axf"
               " && systemctl daemon-reload && systemctl enable --now axf-liveness.timer && systemctl restart axf-liveness.timer"
               " && node apps/console-web/plugins/build-orchestrator/liveness.mjs pass")


def _age_sec(at: str) -> float | None:
    try:
        t = datetime.fromisoformat(at.replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    return (datetime.now(timezone.utc) - t).total_seconds()


def health_probe(state: dict[str, Any] | None = None) -> dict[str, Any]:
    st = state if state is not None else live.read_state()
    tick = st.get("lastTick") or {}
    every = int(tick.get("everySec") or st.get("everySec") or 15)
    running = [b for b in st.get("builds") or [] if b.get("state") in ("running", "stale")]
    if not tick:
        return {"status": "warning" if running else "ok",
                "summary": "The 15-second liveness pass has not run yet: running rows can't show when a build stops." if running else "No liveness pass yet (nothing is running).",
                "details": ["The systemd timer axf-liveness runs it on the VPS; Auto fix installs and starts it."]}
    age = _age_sec(str(tick.get("at") or ""))
    if age is None or age > STALE_PASSES * every:
        since = tick.get("at") or "never"
        return {"status": "error" if running else "warning",
                "summary": f"Liveness pass silent since {since}: the grids can't tell a running build from a dead one.",
                "details": [f"It should run every {every} s (axf-liveness.timer on the VPS).", f"{len(running)} build(s) shown running.",
                            "Auto fix reinstalls and restarts the timer and runs one pass."]}
    return {"status": "ok", "summary": f"Liveness pass ran {int(age)} s ago: {tick.get('running', 0)} running, {tick.get('stale', 0)} stale, {tick.get('broke', 0)} broke.", "details": []}


def autofix(vps: Callable[[str], Any] | None) -> dict[str, Any]:
    if callable(vps):
        return vps(FIX_COMMAND)
    return {"state": "failed", "message": "the timer runs on the VPS host: no VPS runner in this console"}


_health_done = False


def ensure_health(owner: str) -> bool:
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None:
        return False
    vps = getattr(reg, "vps_run", None)
    try:
        reg.register({"id": HEALTH_ID, "label": "Build liveness pass (15 s)", "service": "console", "order": 58, "severity": "error",
                      "run": lambda: health_probe(), "interval": 30,
                      "breaks": "Running rows keep spinning after a build stops: no red row, no Broke alert, no dialog.",
                      "instructions": [f"On the VPS: {FIX_COMMAND}", "`node apps/console-web/plugins/build-orchestrator/liveness.mjs status` shows the last pass."],
                      "links": [{"label": "Live status settings", "href": "view:settings/tab:settings.tabs=plugins"}],
                      "autoFix": {"label": "Restart the liveness timer", "run": lambda: autofix(vps)}}, owner)
    except Exception:  # noqa: BLE001 — live status works without its health item
        return False
    _health_done = True
    return True


def router_for(owner: str, actor: Callable[..., str] | None = None) -> APIRouter:
    r = APIRouter()

    @r.get("/live/health")
    def live_health() -> dict[str, Any]:
        ensure_health(owner)
        return {"ok": True, **health_probe()}

    return r


def dumps(v: Any) -> str:
    return json.dumps(v, separators=(",", ":"))
