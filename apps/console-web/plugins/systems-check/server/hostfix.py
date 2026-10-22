"""Auto fix for VPS host checks, through Mosses and axHub (Oct 20 2026; through Mosses since Oct 22 2026).

The console can't change the host from its container. For the host checks listed in FIX_COMMANDS, Auto fix hands that
check's exact, fixed command to Mosses (his `axhub_call` tool, mosses.py), who passes it to axHub's `vps.run`. `vps.run` always needs
Brett's approval on the hub, and the approval page shows the whole command: it pops up in the console by itself
(approvals banner), he approves or rejects it, and this job sends the same call again with the confirmation id and
reports the result. Nothing runs on the host without that approval, and only commands from this table are ever sent.

Checks that need him at the machine (sign-ins, the Moshi key's fingerprint, a Coolify volume) are not here.
Needs the agent manager with Mosses (allowed dangerous tools) and AXHUB_URL + AXHUB_TOKEN (Keys banner → axHub connection). One job per check at a time; jobs live in memory.
"""
from __future__ import annotations

import re
import threading
import time
from typing import Any, Callable


# Each fix ends by refreshing the host report, so the console sees the result at once (not after the 15-minute cron).
_REPORT = "bash /opt/axf/deploy/console-doctor.sh --report"
FIX_COMMANDS: dict[str, str] = {
    "host-mosh": "DEBIAN_FRONTEND=noninteractive apt-get install -y -qq mosh",
    "host-mosh-ports": "ufw allow 60000:61000/udp",
    "host-anthropic-keyfile": "chmod 600 /root/.anthropic-key",
    "host-claude-pick": "bash /opt/axf/deploy/claude-pick.sh --install",
    "host-claude-cli": "curl -fsSL https://claude.ai/install.sh | bash",
    "host-docker": "bash /opt/axf/deploy/install-console.sh",
    "host-update-cron": "bash /opt/axf/deploy/install-console.sh",
}
WAIT_S = 30 * 60  # hub approvals expire after 30 minutes


def command(cid: str) -> str | None:
    c = FIX_COMMANDS.get(cid)
    return f"{c} && {_REPORT}" if c else None


class HubError(Exception):
    pass


def call_hub(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600) -> dict[str, Any]:
    """axHub's `call`, through Mosses (mosses.py): {"ok": text} | {"confirm": id} (waiting for approval), or HubError.
    Imported late: mosses.py imports this module for HubError."""
    from . import mosses
    return mosses.call(tool, arguments, confirmation_id, timeout)


def ready() -> tuple[bool, str]:
    from . import mosses
    return mosses.ready()


class Jobs:
    """One background job per host check: ask the hub, wait for the approval, run, report."""

    def __init__(self, recheck: Callable[[str], Any], call: Callable[..., dict[str, Any]] = call_hub, poll_s: float = 4,
                 on_fail: Callable[[str, str], Any] | None = None, ready_check: Callable[[], tuple[bool, str]] | None = None) -> None:
        self.recheck = recheck
        # Is Mosses there to take it? Part of the default route (call_hub); a caller passing its own `call` checks itself.
        self.ready = ready_check or (ready if call is call_hub else (lambda: (True, "")))
        self.on_fail = on_fail  # a fix that ran (or couldn't) and failed; never called for one Brett rejected
        self.call = call
        self.poll_s = poll_s
        self.jobs: dict[str, dict[str, Any]] = {}
        self.lock = threading.Lock()

    @staticmethod
    def allowed(cid: str) -> bool:
        return cid in FIX_COMMANDS

    def get(self, cid: str) -> dict[str, Any] | None:
        with self.lock:
            j = self.jobs.get(cid)
            return dict(j) if j else None

    def all(self) -> list[dict[str, Any]]:
        with self.lock:
            return [dict(j) for j in self.jobs.values()]

    def start(self, cid: str) -> dict[str, Any]:
        cmd = command(cid)
        if not cmd:
            raise HubError("This one needs you at the machine: follow its steps.")
        ok, why = self.ready()  # fail fast: no Mosses (or he can't reach axHub) = no Auto fix
        if not ok:
            raise HubError(why)
        with self.lock:
            cur = self.jobs.get(cid)
            if cur and cur["state"] in ("asking", "waiting", "running"):
                return dict(cur)
            self.jobs[cid] = {"id": cid, "state": "asking", "message": "Handing it to Mosses for axHub…", "confirmationId": None, "output": "", "startedAt": time.time(), "command": cmd}
        threading.Thread(target=self._run, args=(cid, cmd), daemon=True).start()
        return self.get(cid) or {}

    def _set(self, cid: str, **kw: Any) -> None:
        with self.lock:
            self.jobs[cid].update(kw, updatedAt=time.time())

    def _run(self, cid: str, cmd: str) -> None:
        args = {"command": cmd, "timeout_seconds": 600}
        try:
            r = self.call("vps.run", args)
            if "confirm" in r:
                conf = r["confirm"]
                self._set(cid, state="waiting", confirmationId=conf, message="Approve it in the pop-up (it shows the exact command).")
                deadline = time.time() + WAIT_S
                while "confirm" in r:
                    if time.time() > deadline:
                        self._set(cid, state="failed", message="The approval expired."); return
                    time.sleep(self.poll_s)
                    try:
                        r = self.call("vps.run", args, conf)
                    except HubError as e:
                        m = str(e).lower()
                        self._set(cid, state="failed", message="Rejected on the hub." if "reject" in m else "The approval expired." if "expired" in m else str(e)); return
            self._set(cid, state="running", message="Ran on the VPS; checking again…")
            out = r.get("ok", "")
            ok = re.search(r"^exit 0\b", out, re.M) is not None
            try:
                self.recheck(cid)
            except Exception:  # noqa: BLE001
                pass
            self._set(cid, state="done" if ok else "failed", output=out[-4000:], message="Fixed." if ok else "The fix command failed: see the output.")
            if not ok:
                tail = [ln for ln in out.strip().splitlines() if ln.strip()][-3:]
                self._failed(cid, "the VPS fix command failed: " + " / ".join(tail)[:240])
        except HubError as e:
            self._set(cid, state="failed", message=str(e))
            self._failed(cid, str(e))
        except Exception as e:  # noqa: BLE001
            self._set(cid, state="failed", message=f"Auto fix stopped ({type(e).__name__}).")
            self._failed(cid, f"Auto fix stopped ({type(e).__name__})")

    def _failed(self, cid: str, why: str) -> None:
        if self.on_fail:
            try:
                self.on_fail(cid, why)
            except Exception:  # noqa: BLE001 — the hand-over never breaks the job
                pass
