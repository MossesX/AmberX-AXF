"""The axHub side of a clean-up run: one held `vps.run` call that the hub shows Brett as an approval (and pushes to his
phone through the AmberX app). Approving it runs the engine on the VPS with the plan's id and fingerprint; denying it, or
letting it expire, drops it and nothing is removed.

Needs AXHUB_URL (default https://axhub.amberxai.com) + AXHUB_TOKEN in the console's environment. Without the token the
run falls back to the systems check's VPS route (axf.health@1 `vps_run`: a veto call through Vinny, else an approval
through Mosses); with neither, the run is refused. No model is ever called. `transport` is swapped out by the tests.
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http, hub_session

TOOL = "vps.run"


class HubError(Exception):
    pass


def _http(method: str, params: dict[str, Any], sid: str | None) -> tuple[dict[str, Any], str | None]:
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        raise HubError("axHub isn't connected (no AXHUB_TOKEN)")
    if not url.startswith("https://"):
        raise HubError("the axHub address must be https")
    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
    headers.update(hub_session.headers())
    if sid:
        headers["mcp-session-id"] = sid
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    try:
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=30, max_bytes=500_000, truncate=True)
    except axf_http.HttpError as e:
        raise HubError(f"couldn't reach axHub ({type(e).__name__})") from None
    if not r.ok:
        raise HubError(f"axHub answered {r.status}")
    raw = r.text()
    if "text/event-stream" in r.headers.get("content-type", ""):
        msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
    else:
        msg = json.loads(raw or "{}")
    if "error" in msg:
        raise HubError(str(msg["error"].get("message", "axHub error"))[:300])
    return msg.get("result") or {}, r.headers.get("mcp-session-id") or sid


transport: Callable[[str, dict[str, Any], str | None], tuple[dict[str, Any], str | None]] = _http


def connected() -> bool:
    return bool(os.environ.get("AXHUB_TOKEN")) or transport is not _http


def hold(command: str, title: str, description: str) -> dict[str, Any]:
    """Send the held call once → {"held": True, "job": id} | {"confirm": id} | {"ok": text}; HubError otherwise."""
    _, sid = transport("initialize", {"protocolVersion": "2025-06-18", "capabilities": {},
                                      "clientInfo": {"name": "axf-console-maintenance", "version": "1"}}, None)
    args = {"tool": TOOL, "arguments": {"command": command, "timeout_seconds": 1200}, "hold": True,
            "reason": {"title": title[:120], "description": description[:1000]}}
    res, _ = transport("tools/call", {"name": "call", "arguments": args}, sid)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    try:
        body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        body = {}
    if isinstance(body, dict) and body.get("held"):
        return {"held": True, "job": str(body.get("job_id") or body.get("jobId") or "")[:80],
                **({"runsAt": str(body["runsAt"])[:40]} if body.get("runsAt") else {})}
    err = body.get("error") if isinstance(body, dict) else None
    if res.get("isError") and isinstance(err, dict) and err.get("code") == "confirmation_required":
        return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))[:80]}
    if res.get("isError"):
        raise HubError((text or "axHub refused the run")[:300])
    return {"ok": text[:600]}
