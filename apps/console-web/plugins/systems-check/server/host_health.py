"""health@1 checks for the host services (host-service@1, framework/spec/HOST-SERVICES.md).

One check per host service, `host-service:<id>`: the unit is active, its socket answers (the host API's health
probe), its heartbeat is fresh. Red when the service is down, amber when it limps; green while the service is in
`container` mode (the console still runs that part, by design). The Auto fix restarts the unit through the host API
(whitelisted sudo: /etc/sudoers.d/axf-host), or starts the timer of a stopped tick.

One more check, `host-api`: when the host API itself cannot be reached the banner says what broke (the host API),
what that breaks (every moved part can no longer be seen or driven from the console; the units keep running) and
since when. Its Auto fix restarts axf-host-api.service on the VPS as a veto call (the host API cannot restart itself
when it is dead), falling back to re-running the installer.

The service list comes from the manifests in the checkout the console mounts (deploy/host-services/services), so
every check exists from the first pass, even before the host API answered once.
"""
from __future__ import annotations

import json
import os
import time
from datetime import datetime
from pathlib import Path
from typing import Any, Callable

import host_services as hs

def installed() -> bool:
    """deploy/install-host-services.sh ran: it writes AXF_HOST_API into the console's env (console.env). Before that
    nothing has moved and a silent host API is not a fault."""
    return bool(os.environ.get("AXF_HOST_API")) or os.environ.get("AXF_HOST_SERVICES") == "1"


NOT_INSTALLED = {"status": "ok", "summary": "host services not installed on this VPS yet (bash /opt/axf/deploy/install-host-services.sh); every part runs in the console"}
HOST_API_FIX = "systemctl restart axf-host-api.service || bash /opt/axf/deploy/install-host-services.sh"


def _ago(ts: float | None) -> str:
    if not ts:
        return ""
    return time.strftime("%Y-%m-%d %H:%M UTC", time.gmtime(ts))


def _age_s(iso: str | None) -> float | None:
    if not iso:
        return None
    try:
        return time.time() - datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return None


def manifests(root: Path) -> list[dict[str, Any]]:
    out = []
    for f in sorted((root / "deploy/host-services/services").glob("*.json")):
        try:
            m = json.loads(f.read_text())
            if isinstance(m, dict) and m.get("id"):
                out.append(m)
        except Exception:  # noqa: BLE001
            continue
    return out


def _state(client: Callable[[], hs.HostServices], sid: str) -> dict[str, Any] | None:
    lst = client().services()
    return next((s for s in lst.get("services") or [] if s.get("id") == sid), None)


def service_probe(client: Callable[[], hs.HostServices], m: dict[str, Any]) -> Callable[[], dict[str, Any]]:
    sid = m["id"]
    interval = int((m.get("health") or {}).get("intervalSec") or 30)

    def run() -> dict[str, Any]:
        if not installed():
            return NOT_INSTALLED
        st = _state(client, sid)
        if st is None:
            return {"status": "warn", "summary": f"{sid} is not in the host API's list (installed? run deploy/install-host-services.sh)"}
        if st.get("reachable") is False:
            return {"status": "warn", "summary": "the host API cannot be reached: see Host API", "unreachable": True}
        mode = st.get("mode") or "container"
        if mode == "container" and m.get("kind") != "tick":
            return {"status": "ok", "summary": "mode container: the console runs this part; the host copy is installed and idle"}
        status = st.get("status")
        hb = (st.get("heartbeat") or {}).get("at")
        details = [f"unit {st.get('unit')}: {st.get('unitState')}", f"mode {mode}"]
        if st.get("health"):
            details.append(f"socket: {'answers' if st['health'].get('ok') else 'no answer'} ({st['health'].get('message') or ''})".strip())
        if hb:
            details.append(f"heartbeat {hb}")
        if st.get("lastRun"):
            details.append(f"last run {st['lastRun'].get('at')}: {st['lastRun'].get('result')} {st['lastRun'].get('message') or ''}".strip())
        since = st.get("since") or ""
        if status == "up":
            age = _age_s(hb) if hb else None
            if m.get("kind") == "daemon" and age is not None and age > interval * 4 + 60:
                return {"status": "warn", "summary": f"{st.get('unit')} answers but its heartbeat is {int(age)} s old", "details": details}
            return {"status": "ok", "summary": f"{st.get('unit')} up since {since}", "details": details}
        sev = "warn" if status == "degraded" else "error"
        return {"status": sev, "summary": f"{st.get('unit')} is {status} since {since}: {st.get('reason') or ''}".strip(), "details": details}

    return run


def service_fix(client: Callable[[], hs.HostServices], m: dict[str, Any]) -> Callable[[], dict[str, Any]]:
    sid = m["id"]

    def run() -> dict[str, Any]:
        if not installed():
            return NOT_INSTALLED
        st = _state(client, sid) or {}
        if m.get("cron") or st.get("cron"):
            # cron starts it: there is no unit to restart. The console installer writes every schedule again.
            try:
                client().action("systems-check", "fix", {"check": "host-update-cron"}, by="systems-check", confirm=True,
                                reason={"title": f"Auto fix: re-install the host schedules ({sid})", "description": f"/etc/cron.d/{m.get('cron') or st.get('cron')} is missing or its schedule stopped running; the systems check host service re-runs the console installer, which writes every schedule again."})
                return {"state": "done", "message": "the console installer wrote the host schedules again"}
            except hs.HostServiceError as e:
                return {"state": "failed", "message": e.message}
        verb = "start" if m.get("kind") == "tick" and st.get("timerState") not in ("active", "activating") else "restart"
        try:
            r = client().unit(sid, verb, by="systems-check", reason={"title": f"Auto fix: {verb} {st.get('unit') or sid}", "description": "The host service is down; the systems check restarts its unit through the host API's sudo whitelist."})
            return {"state": "done", "message": f"{verb} {r.get('unit')}: {r.get('state')}"}
        except hs.HostServiceError as e:
            return {"state": "failed", "message": e.message}

    return run


def host_api_probe(client: Callable[[], hs.HostServices], ids: list[str]) -> Callable[[], dict[str, Any]]:
    def run() -> dict[str, Any]:
        if not installed():
            return NOT_INSTALLED
        c = client()
        try:
            h = c.health()
            return {"status": "ok", "summary": f"host API answers ({c.endpoint_used}), {h.get('services', '?')} services"}
        except hs.HostServiceError as e:
            if not e.down:
                return {"status": "warn", "summary": f"host API: {e.code}: {e.message}"}
            since = _ago(c.down_since)
            return {"status": "error", "summary": f"The host API cannot be reached since {since}.",
                    "details": [f"What broke: axf-host-api.service on the VPS does not answer on {', '.join(c.status()['endpoints'])}.",
                                f"What that breaks: the console can't see or drive {', '.join(i for i in ids if i != hs.HOST_API)}; every row shows unknown. The units themselves keep running.",
                                f"Since: {since}.", f"Last error: {e.message}"]}

    return run


def register(registry: Any, root: Path, client: Callable[[], hs.HostServices] = hs.client) -> list[str]:
    """Register host-api and one check per manifest; returns the ids."""
    ms = manifests(root)
    ids = [m["id"] for m in ms]
    out = []
    registry.register({"id": "host-api", "label": "Host API (host services)", "service": "host", "order": 26, "severity": "error",
                       "run": host_api_probe(client, ids), "interval": 60,
                       "breaks": "Every part of the console that runs on the host (builds-live, shipped-features, hub sync, agent jobs, host checks, maintenance, the lander and watchdogs) can't be seen or driven from the console.",
                       "instructions": ["On the VPS: systemctl status axf-host-api", "Not installed yet: bash /opt/axf/deploy/install-host-services.sh",
                                        "From the console: Settings → Plugins → Host services"],
                       "autoFix": {"label": "Restart the host API", "run": lambda: _vps(registry, HOST_API_FIX)}}, "systems-check")
    out.append("host-api")
    for m in ms:
        if m["id"] == hs.HOST_API:
            continue
        cid = f"host-service:{m['id']}"
        registry.register({"id": cid, "label": f"Host service: {m.get('title') or m['id']}", "service": "host", "order": 27, "severity": "error",
                           "run": service_probe(client, m), "interval": max(60, int((m.get("health") or {}).get("intervalSec") or 60)),
                           "breaks": f"{m.get('description') or m['id']} — stops while the unit is down.",
                           "instructions": [f"journalctl -u {m.get('unit')} -n 100", f"node framework/cli/host-services.mjs status {m['id']}",
                                            f"Roll back to the console's copy: node framework/cli/host-services.mjs rollback {m['id']}"],
                           "autoFix": {"label": f"Restart {m.get('unit')}", "run": service_fix(client, m)}}, "systems-check")
        out.append(cid)
    return out


def _vps(registry: Any, command: str) -> dict[str, Any]:
    run = getattr(registry, "vps_run", None)
    if not callable(run):
        return {"state": "failed", "message": "no VPS route for the fix (axHub vps.run)"}
    r = run(command)
    return r if isinstance(r, dict) else {"state": "started", "message": str(r)}
