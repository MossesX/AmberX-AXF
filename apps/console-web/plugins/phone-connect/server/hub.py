"""axHub tool calls for Phone Connect (the recorder's straight approval goes through the hub). AXHUB_URL + AXHUB_TOKEN.

`tool(name, args, reason)` → the tool's data, {"confirm": id} when Brett has to approve it on axHub, HubError otherwise.
A hub that doesn't know `phone.*` yet gets the old `amberx.*` alias (same tool, same policy). `transport` is swapped
out by the tests.
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any, Callable

from .core import ALIASES


class HubError(Exception):
    pass


def _http(method: str, params: dict[str, Any], sid: str | None) -> tuple[dict[str, Any], str | None]:
    import axf_framework  # noqa: F401 — framework/python on sys.path
    from axf_server import http as axf_http, hub_session

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
LEGACY = {v: k for k, v in ALIASES.items()}


def _call(name: str, arguments: dict[str, Any], reason: dict[str, str] | None) -> tuple[dict[str, Any], dict[str, Any]]:
    _, sid = transport("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-phone-connect", "version": "1"}}, None)
    res, _ = transport("tools/call", {"name": "call", "arguments": {"tool": name, "arguments": arguments, **({"reason": reason} if reason else {})}}, sid)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    try:
        body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        body = {"message": text}
    return res, body if isinstance(body, dict) else {}


def tool(name: str, arguments: dict[str, Any], reason: dict[str, str] | None = None) -> dict[str, Any]:
    res, body = _call(name, arguments, reason)
    err = body.get("error") if isinstance(body.get("error"), dict) else None
    if res.get("isError") and err and err.get("code") == "not_found" and name in LEGACY:
        res, body = _call(LEGACY[name], arguments, reason)  # a hub without phone.* yet: the alias, same policy
        err = body.get("error") if isinstance(body.get("error"), dict) else None
    if res.get("isError") and err and err.get("code") == "confirmation_required":
        return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))[:80]}
    if res.get("isError"):
        raise HubError(str((err or {}).get("message") or body.get("message") or "axHub refused")[:300])
    if body.get("held"):
        return {"held": True, "job": str(body.get("job_id") or body.get("jobId") or "")[:80]}
    return body.get("data") if isinstance(body.get("data"), dict) else body
