"""Terminal — systems check item (axf.health@1): "Terminal reaches the VPS host" (Nov 3 2026, build terminal-vps-host).

Red when the VPS tab isn't set up or its ssh fails: headless build tabs, their meters and VPS tabs all need it. Auto fix
makes the console's key, fills in the host (AXF_VPS_HOST, else the Docker gateway = the host on Coolify's network) and,
when the host still refuses the key, adds the public key to root's authorized_keys as one veto call (vps_run).
"""
from __future__ import annotations

import shlex
from typing import Any, Callable

import plugin_services

from . import sessions, store

CAPABILITY = "axf.health@1"
CHECK_ID = "terminal-vps-host"
OWNER = "console-terminal"
KEY_FROM = "172.16.0.0/12"  # Docker networks on the VPS: the key only works from a container


def probe() -> dict[str, Any]:
    st = store.settings()
    host = st["vps"].get("host")
    if not host or not st["sshKey"]:
        missing = " and ".join(x for x, ok in (("host", host), ("key", st["sshKey"])) if not ok)
        return {"status": "error", "summary": f"The Terminal's VPS host isn't set up (no {missing}): build tabs can't open.",
                "details": ["Settings → Plugins → Terminal → VPS host, or Auto fix."]}
    sessions._headless_cache["value"] = None
    v = sessions.vps_tmux()
    if not v["ready"]:
        return {"status": "error", "summary": f"The Terminal can't reach the VPS host {host}: {v.get('why') or 'ssh failed'}",
                "details": [f"ssh {st['vps'].get('user') or 'root'}@{host}:{st['vps'].get('port') or 22} with the Terminal's key."]}
    n = sum(1 for x in v["items"] if x["name"].startswith("axf-"))
    return {"status": "ok", "summary": f"The Terminal reaches the VPS host {host}: {n} headless session{'s' if n != 1 else ''} running."}


def authorize_command(pub: str) -> str:
    """One idempotent command that lets the console's key in as root, from Docker networks only."""
    line = f'from="{KEY_FROM}" {pub}'
    return ("mkdir -p /root/.ssh && chmod 700 /root/.ssh && touch /root/.ssh/authorized_keys && "
            f"(grep -qF {shlex.quote(pub)} /root/.ssh/authorized_keys || printf '%s\\n' {shlex.quote(line)} >> /root/.ssh/authorized_keys) && "
            "chmod 600 /root/.ssh/authorized_keys")


def autofix(vps_run: Callable[[str], dict[str, Any]] | None) -> dict[str, Any]:
    st = store.settings()
    pub = store.keygen(False)
    if not st["vps"].get("host"):
        host = store.default_host()
        if not host:
            return {"state": "failed", "message": "No VPS host known: set AXF_VPS_HOST on the console or type it in Settings → Plugins → Terminal."}
        store.save_settings({"vps": {"host": host}})
    if probe()["status"] == "ok":
        return {"state": "done", "message": "VPS host set up; the Terminal reaches it."}
    if not callable(vps_run) or not pub:
        return {"state": "failed", "message": "The host refuses the Terminal's key; add its public key (Settings → Plugins → Terminal) to /root/.ssh/authorized_keys."}
    return vps_run(authorize_command(pub))


_done = False


def ensure() -> bool:
    """Registers the check once the systems check provides axf.health@1 (plugins load in any order)."""
    global _done
    if _done:
        return True
    reg = plugin_services.get(CAPABILITY)
    if reg is None:
        return False
    try:
        reg.register({"id": CHECK_ID, "label": "Terminal reaches the VPS host", "service": "vps", "order": 62,
                      "run": probe,
                      "breaks": "The Terminal shows no headless build tabs (no agent, model or live cost), and VPS tabs and Claude Code on the VPS don't open.",
                      "instructions": ["Settings → Plugins → Terminal → VPS host: host (the Docker gateway, e.g. 172.16.1.1, from the console), user root, Generate key.",
                                       "Add the public key to /root/.ssh/authorized_keys on the VPS (Auto fix does both)."],
                      "autoFix": {"label": "Set up the VPS host", "run": lambda: autofix(getattr(reg, "vps_run", None))}}, OWNER)
    except Exception:  # noqa: BLE001 — the Terminal works without its check
        return False
    _done = True
    return True
