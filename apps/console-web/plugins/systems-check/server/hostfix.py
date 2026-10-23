"""Auto fix for VPS host checks, through axHub (Oct 20 2026).

The console can't change the host from its container. For the host checks listed in FIX_COMMANDS, Auto fix asks
axHub to run that check's exact, fixed command on the VPS with the hub's `vps.run` tool. `vps.run` always needs
Brett's approval on the hub, and the approval page shows the whole command: it pops up in the console by itself
(approvals banner), he approves or rejects it, and this job sends the same call again with the confirmation id and
reports the result. Nothing runs on the host without that approval, and only commands from this table are ever sent.

Checks that need him at the machine (sign-ins, the Moshi key's fingerprint, a Coolify volume) are not here.
Needs AXHUB_URL + AXHUB_TOKEN (Keys banner → axHub connection). One job per check at a time; jobs live in memory.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import uuid
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http

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
    "host-walkthrough": "bash /opt/axf/apps/walkthrough-studio/deploy/install.sh",
}
WAIT_S = 30 * 60  # hub approvals expire after 30 minutes


def command(cid: str) -> str | None:
    c = FIX_COMMANDS.get(cid)
    return f"{c} && {_REPORT}" if c else None


class HubError(Exception):
    pass


def _hub() -> tuple[str, str]:
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        raise HubError("Add the axHub token first (Keys needed → axHub connection), so the console can ask the hub.")
    if not url.startswith("https://"):
        raise HubError("The axHub address must be https.")
    return url, tok


def _rpc(url: str, tok: str, session: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
    if session:
        headers["mcp-session-id"] = session
    try:  # axf_server.http: https only (checked in _hub too), never follows a redirect: the token must not go anywhere else
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=timeout, max_bytes=2_000_000, truncate=True)
    except axf_http.HttpError as e:
        raise HubError(f"Couldn't reach axHub ({type(e).__name__})") from None
    if not r.ok:
        raise HubError(f"axHub answered {r.status}" + (" (check the axHub token)" if r.status in (401, 403) else ""))
    sid = r.headers.get("mcp-session-id") or session
    raw = r.text()
    ctype = r.headers.get("content-type", "")
    if "text/event-stream" in ctype:
        msgs = [json.loads(line[5:].strip()) for line in raw.splitlines() if line.startswith("data:") and line[5:].strip()]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
    else:
        msg = json.loads(raw or "{}")
    if "error" in msg:
        raise HubError(str(msg["error"].get("message", "axHub error"))[:300])
    return msg.get("result") or {}, sid


def call_hub(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600) -> dict[str, Any]:
    """axHub's `call` meta-tool. Returns {"ok": text}, {"confirm": id} (waiting for approval), or raises HubError."""
    url, tok = _hub()
    _, sid = _rpc(url, tok, None, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-autofix", "version": "1"}}, 30)
    args: dict[str, Any] = {"tool": tool, "arguments": arguments, "timeout_seconds": int(timeout)}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    res, _ = _rpc(url, tok, sid, "tools/call", {"name": "call", "arguments": args}, timeout + 30)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except Exception:  # noqa: BLE001
            err = {"message": text}
        if err.get("code") == "confirmation_required":
            cid = str((err.get("details") or {}).get("confirmationId", ""))
            if not re.match(r"^[0-9a-f-]{36}$", cid):
                raise HubError("axHub asked for an approval without an id")
            return {"confirm": cid}
        raise HubError(str(err.get("message") or text)[:400])
    return {"ok": text}


class Jobs:
    """One background job per host check: ask the hub, wait for the approval, run, report."""

    def __init__(self, recheck: Callable[[str], Any], call: Callable[..., dict[str, Any]] = call_hub, poll_s: float = 4) -> None:
        self.recheck = recheck
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
        _hub()  # fail fast without a token
        with self.lock:
            cur = self.jobs.get(cid)
            if cur and cur["state"] in ("asking", "waiting", "running"):
                return dict(cur)
            self.jobs[cid] = {"id": cid, "state": "asking", "message": "Asking axHub…", "confirmationId": None, "output": "", "startedAt": time.time(), "command": cmd}
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
        except HubError as e:
            self._set(cid, state="failed", message=str(e))
        except Exception as e:  # noqa: BLE001
            self._set(cid, state="failed", message=f"Auto fix stopped ({type(e).__name__}).")
