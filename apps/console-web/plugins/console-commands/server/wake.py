"""Wake a closed console (console-wake, Nov 3 2026): ask Brett's AmberX phone, through axHub, to open the Dev Console.

axHub's `amberx` device service relays `open_url` to the AmberX app over AXPP (axHub repo, packages/connectors/
device-relay); the phone opens the URL in Chrome (or the default browser) and, where Android holds back a start from
the background, posts a high-priority notification that opens it with one tap. The hub refuses any URL outside
Brett's own domains (amberxai.com), and so does the phone.

Needs AXHUB_URL (default https://axhub.amberxai.com) + AXHUB_TOKEN in the console's environment; the token goes only
to the hub (https only, no redirects).
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any

TOOL = "amberx.open_url"
REASON = {"title": "Open the Dev Console on Brett's phone",
          "description": "A console command (from a Claude session) is waiting and no console is open; AmberX opens console.amberxai.com in the browser so it can run."}


def _rpc(url: str, tok: str, sid: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
    from axf_server import http as axf_http, hub_session  # the console's own helpers (framework/python)

    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
    headers.update(hub_session.headers())
    if sid:
        headers["mcp-session-id"] = sid
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=timeout, max_bytes=500_000, truncate=True)
    if not r.ok:
        raise RuntimeError(f"axHub answered {r.status}" + (" (check the axHub token)" if r.status in (401, 403) else ""))
    raw = r.text()
    if "text/event-stream" in r.headers.get("content-type", ""):
        msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
    else:
        msg = json.loads(raw or "{}")
    if "error" in msg:
        raise RuntimeError(str(msg["error"].get("message", "axHub error"))[:300])
    return msg.get("result") or {}, r.headers.get("mcp-session-id") or sid


def open_url(target: str, browser: str = "chrome") -> dict[str, Any]:
    """→ {ok, message}. Never raises for a hub or phone failure: the command stays queued and the answer says why."""
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        return {"ok": False, "message": "axHub isn't connected (no AXHUB_TOKEN), so AmberX can't be asked to open the console"}
    if not url.startswith("https://"):
        return {"ok": False, "message": "the axHub address must be https"}
    try:
        _, sid = _rpc(url, tok, None, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-wake", "version": "1"}}, 15)
        res, _ = _rpc(url, tok, sid, "tools/call", {"name": "call", "arguments": {"tool": TOOL, "arguments": {"url": target, "browser": browser}, "reason": REASON, "timeout_seconds": 20}}, 40)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "message": f"couldn't reach axHub: {str(e)[:200]}"}
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except Exception:  # noqa: BLE001
            err = {"message": text}
        return {"ok": False, "message": f"AmberX couldn't open the console: {str(err.get('message') or text)[:240]}"}
    return {"ok": True, "message": text[:300] or "AmberX is opening the console"}
