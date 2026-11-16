"""Retired apps (health@1): what a removed app left on the VPS and in DNS, shown until it is gone.

Each retired app gets two checks (Nov 16 2026, build remove-old-molly-app-project-keep-axf):
  retired-<id>-host   its update cron, update script, container and checkout on the VPS. The Auto fix removes them in
                      one veto call (axHub vps.run: runs after the countdown unless Brett denies it) and leaves a marker
                      under /opt/axf/.axf-console/retired/<id>, which the console sees through its /opt/axf mount.
  retired-<id>-dns    its subdomain still resolving. The record is removed through the Hostinger connector (axHub
                      `hostinger` service, `dns_records_*`); the check turns green once the name stops resolving.

Open list: a later retirement adds an entry to RETIRED and nothing else. Never names an app that is still live.
"""
from __future__ import annotations

import socket
from pathlib import Path
from typing import Any, Callable

VPS_IP = "31.97.13.252"

# The removed Molly app (apps/molly, molly.amberxai.com). Its leftovers on the VPS were written by its installer.
RETIRED: tuple[dict[str, Any], ...] = (
    {"id": "molly", "label": "the old Molly app", "domain": "molly.amberxai.com", "container": "molly",
     "paths": ["/etc/cron.d/molly", "/usr/local/bin/molly-update", "/var/log/molly-update.log", "/opt/molly"],
     "since": "2026-11-16"},
)


def host_command(app: dict[str, Any]) -> str:
    """The one VPS command that removes an app's leftovers and leaves the marker. Only fixed paths from RETIRED."""
    marker = f"/opt/axf/.axf-console/retired/{app['id']}"
    rm = " ".join(app["paths"])
    return (f"docker rm -f {app['container']} >/dev/null 2>&1; rm -rf {rm} && mkdir -p /opt/axf/.axf-console/retired "
            f"&& date -u +%FT%TZ > {marker} && echo removed")


def dns_record(app: dict[str, Any]) -> str:
    return f"{app['domain']} A {VPS_IP} (zone amberxai.com, name {app['domain'].split('.')[0]})"


def host_state(app: dict[str, Any], root: Path) -> dict[str, Any]:
    marker = root / ".axf-console" / "retired" / app["id"]
    if marker.exists():
        return {"status": "ok", "summary": f"{app['label'].capitalize()} is gone from the VPS (since {marker.read_text().strip() or 'cleanup'})."}
    return {"status": "warn",
            "summary": f"{app['label'].capitalize()} was removed from the repo on {app['since']}, but its update cron, update script and checkout are still on the VPS.",
            "breaks": "The cron runs every 5 minutes, pulls main and tries an installer that no longer exists, so it fails every run and fills its log.",
            "details": [f"Leftovers: {', '.join(app['paths'])} (container {app['container']}, if any)."]}


def dns_state(app: dict[str, Any], resolve: Callable[[str], str] = socket.gethostbyname) -> dict[str, Any]:
    try:
        ip = resolve(app["domain"])
    except OSError:
        return {"status": "ok", "summary": f"{app['domain']} no longer resolves."}
    return {"status": "warn", "summary": f"{app['domain']} still points at {ip}, but {app['label']} is gone.",
            "breaks": "Nothing serves it any more, so the name answers with Traefik's 404.",
            "details": [f"Remove the record: {dns_record(app)}."]}


def register(reg: Any, *, root: Path, owner: str, resolve: Callable[[str], str] = socket.gethostbyname) -> None:
    for i, app in enumerate(RETIRED):
        hid, did = f"retired-{app['id']}-host", f"retired-{app['id']}-dns"
        reg.register({"id": hid, "label": f"Leftovers of {app['label']} on the VPS", "service": "vps", "order": 90 + i * 2,
                      "interval": 30 * 60, "run": (lambda a=app: host_state(a, root)),
                      "fix": {"type": "host", "command": host_command(app)},
                      "instructions": [f"Auto fix sends one veto call through axHub: {host_command(app)}",
                                       "By hand on the VPS as root: the same command."]}, owner)
        reg.add_autofix(hid, {"label": f"Remove {app['label']} from the VPS", "mode": "ask",
                              "run": (lambda a=app: reg.vps_run(host_command(a)) if callable(getattr(reg, "vps_run", None))
                                      else {"state": "failed", "message": "No route to the VPS (axHub vps.run)."})}, owner)
        reg.register({"id": did, "label": f"DNS record of {app['label']}", "service": "hostinger", "order": 91 + i * 2,
                      "interval": 6 * 60 * 60, "run": (lambda a=app: dns_state(a, resolve)),
                      "links": [{"label": "Hostinger DNS zone", "url": "https://hpanel.hostinger.com/domain/amberxai.com/dns"}],
                      "instructions": [f"Delete exactly this record and nothing else: {dns_record(app)}.",
                                       "A session does it through axHub's hostinger service (dns_records_list, then delete that one record), "
                                       "reads the zone again to confirm, and logs it in /projects/_shared/_data/dns/log.md."]}, owner)
