"""The axHub side of a new account's first join: one held `call` the hub shows Brett as an approval (and pushes to his
phone through the AmberX app). Approving it runs `axf.session_sync_approve_account` on this console (the plugin's
`approve-account` command, Brett only), so the new account's sessions may claim and take work. Denying leaves them pending.

Needs AXHUB_URL (default https://axhub.amberxai.com) + AXHUB_TOKEN in the console's environment; without the token the
ask stays in the console only (bell alert + the Sessions panel's Approve button). No model is ever called. `transport`
is swapped out by the tests (a fake axHub).
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http, hub_session

TOOL = "axf.session_sync_approve_account"


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


def ask(account: str, agent: str, client: str) -> dict[str, Any]:
    """Send the approval once. {"held": True, "job": id} | {"ok": text} | {"confirm": id}; HubError otherwise."""
    _, sid = transport("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-session-sync", "version": "1"}}, None)
    who = {"voice": "voice Amber", "chat": "a claude.ai chat", "code": "Claude Code", "headless": "a headless build", "console": "a console"}.get(client, "a Claude session")
    args = {
        "tool": TOOL,
        "arguments": {"input": {"account": account}},
        "reason": {
            "title": f"Session sync: let account {account} join?"[:120],
            "description": (f"{who.capitalize()} on account {account} joined the project's session link as {agent or 'a helper'} (secondary). "
                            f"Approve = it may claim areas and take the work the orchestrator offers it (it can never add, start or reorder builds, "
                            f"or change settings and approvals). Deny = it stays pending and can only read.")[:1000],
        },
    }
    res, _ = transport("tools/call", {"name": "call", "arguments": args}, sid)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    try:
        body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        body = {}
    if isinstance(body, dict) and body.get("held"):
        return {"held": True, "job": str(body.get("job_id") or body.get("jobId") or "")[:80]}
    err = body.get("error") if isinstance(body, dict) else None
    if res.get("isError") and isinstance(err, dict) and err.get("code") == "confirmation_required":
        return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))[:80]}
    if res.get("isError"):
        raise HubError((text or "axHub refused the ask")[:300])
    return {"ok": text[:300]}
