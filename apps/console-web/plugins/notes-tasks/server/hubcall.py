"""The console's calls to axHub's Google services (Gmail, Calendar): `available` says whether a service is there and
switched on, `call` runs one tool, `job` reads a held call's result. Needs AXHUB_URL + AXHUB_TOKEN; without them the
calendar works on its own. The hub decides what needs Brett: a held answer is passed back and never sent again here.

`transport` is swapped out by the tests (a fake hub).
"""
from __future__ import annotations

import json
import os
import time
import uuid
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http, hub_session


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
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=30, max_bytes=2_000_000, truncate=True)
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
_services: tuple[float, set[str]] = (0.0, set())
SERVICES_TTL = 300


def _tool(name: str, args: dict[str, Any]) -> tuple[Any, dict[str, Any]]:
    _, sid = transport("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-calendar", "version": "1"}}, None)
    res, _ = transport("tools/call", {"name": name, "arguments": args}, sid)
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    try:
        return json.loads(text) if text else {}, res
    except json.JSONDecodeError:
        return {"text": text}, res


def available(service: str, now: Callable[[], float] = time.time) -> bool:
    """Whether the hub has this service switched on. Asked at most every 5 minutes; a hub that can't be reached = no."""
    global _services
    if now() - _services[0] > SERVICES_TTL:
        found: set[str] = set()
        try:
            body, _ = _tool("list_services", {})
            for s in (body.get("services") if isinstance(body, dict) else body) or []:
                if isinstance(s, dict) and s.get("enabled", True) is not False:
                    found.add(str(s.get("id") or s.get("namespace") or s.get("name") or ""))
        except HubError:
            pass
        _services = (now(), found)
    return service in _services[1]


def forget() -> None:
    global _services
    _services = (0.0, set())


def call(tool: str, args: dict[str, Any], title: str, why: str) -> dict[str, Any]:
    """{"result": …} | {"held": True, "job": id} | {"confirm": id}. Raises HubError when the hub refuses."""
    body, res = _tool("call", {"tool": tool, "arguments": args, "reason": {"title": title[:120], "description": why[:1000]}})
    if isinstance(body, dict) and body.get("held"):
        return {"held": True, "job": str(body.get("job_id") or body.get("jobId") or "")[:80]}
    err = body.get("error") if isinstance(body, dict) else None
    if res.get("isError") and isinstance(err, dict) and err.get("code") == "confirmation_required":
        return {"confirm": str((err.get("details") or {}).get("confirmationId", ""))[:80]}
    if res.get("isError"):
        raise HubError(str(err or body)[:300])
    return {"result": body}


def job(job_id: str) -> dict[str, Any]:
    """{"state": "waiting" | "done" | "denied", "result"?, "error"?}. Read only: it never touches the held call."""
    body, _ = _tool("get_job", {"job_id": job_id})
    b = body if isinstance(body, dict) else {}
    st = str(b.get("status") or b.get("state") or "").lower()
    if st in ("completed", "complete", "done", "succeeded", "success"):
        return {"state": "done", "result": b.get("result") if b.get("result") is not None else b}
    if st in ("denied", "failed", "cancelled", "canceled", "expired", "error"):
        return {"state": "denied", "error": str(b.get("error") or st)[:300]}
    return {"state": "waiting"}
