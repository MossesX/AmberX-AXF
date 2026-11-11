"""The provider bridge of the control registry (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s9).

A registry action whose ref is `provider:<connection>/<op>` runs as one axHub `call` from the console, with the console's
own hub token (AXHUB_URL + AXHUB_TOKEN; never in the repo, the browser or a model). The console never holds a Hostinger,
Coolify or VPS secret: axHub does, and axHub decides.

    provider:axhub/call      → the hub tool named by params.tool, with params.arguments
    provider:axhub/catalog   → the hub's tool list (tools/list), filtered by params.service
    provider:<service>/<op>  → hub tool <service>.<op> with the action's params as its arguments
                               (hostinger.*, coolify.*, vps.*: their registry.json files declare each op)

A read is sent with hold false (it runs or says why not). Anything that changes something carries
reason {title, description} (what Brett sees first on the approval page) and is sent once with hold true: the answer is
the result, or `held` / `confirmation_required` with the approval id. Nothing here polls, re-sends or approves.

`transport(method, params, session)` is swappable (tests use a mock hub: the provider mocks of s17).
"""
from __future__ import annotations

import json
import os
import re
import uuid
from typing import Any, Callable

Transport = Callable[[str, dict[str, Any], "str | None"], "tuple[dict[str, Any], str | None]"]
TOOL_RE = re.compile(r"^[a-z][a-z0-9_-]{0,40}\.[A-Za-z0-9_./-]{1,120}$")
CONNECTIONS = ("axhub", "hostinger", "coolify", "vps", "amberx")
ALWAYS_APPROVED = frozenset({"vps.run"})


class ProviderError(Exception):
    pass


def _http(method: str, params: dict[str, Any], session: str | None) -> tuple[dict[str, Any], str | None]:
    """One JSON-RPC request to axHub's MCP endpoint (https only, the console's hub token)."""
    import axf_framework  # noqa: F401,PLC0415 - framework/python on sys.path
    from axf_server import http as axf_http, hub_session  # noqa: PLC0415
    url = (os.environ.get("AXHUB_URL") or os.environ.get("AXF_WALL_HUB") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "").strip()
    if not tok:
        raise ProviderError("axHub isn't connected on this console (no AXHUB_TOKEN): Keys needed → axHub connection")
    if not url.startswith("https://"):
        raise ProviderError("the axHub address must be https")
    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream", **hub_session.headers()}
    if session:
        headers["mcp-session-id"] = session
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    try:
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=60, max_bytes=8_000_000)
    except Exception as e:  # noqa: BLE001
        raise ProviderError(f"couldn't reach axHub ({type(e).__name__})") from None
    if r.status in (401, 403):
        raise ProviderError(f"axHub refused the console's hub token ({r.status})")
    raw = r.text()
    try:
        if "text/event-stream" in r.headers.get("content-type", ""):
            msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
            msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
        else:
            msg = json.loads(raw or "{}")
    except ValueError:
        raise ProviderError("axHub's answer isn't JSON-RPC") from None
    if "error" in msg:
        raise ProviderError(str((msg["error"] or {}).get("message") or "axHub error")[:300])
    return msg.get("result") or {}, r.headers.get("mcp-session-id") or session


transport: Transport = _http


def connected() -> bool:
    return bool(os.environ.get("AXHUB_TOKEN")) or transport is not _http


def _session() -> str | None:
    _, sid = transport("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-registry", "version": "1"}}, None)
    return sid


def reason_of(reason: Any, title: str, tool: str) -> dict[str, str]:
    """{title, description} for the approval page: the caller's reason when given, else the entry and action."""
    if isinstance(reason, dict) and reason.get("title"):
        t, d = str(reason["title"]), str(reason.get("description") or "")
    elif isinstance(reason, str) and reason.strip():
        t, d = reason, ""
    else:
        t, d = title or tool, ""
    t = " ".join(t.split())[:120]
    return {"title": t, "description": (d.strip() or f"{t}. Runs {tool} through the console's control registry with the arguments shown.")[:1000]}


def tool_for(provider: str, op: str, params: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """The hub tool and its arguments for a provider plan."""
    if provider == "axhub" and op == "call":
        tool = str(params.get("tool") or "")
        if not TOOL_RE.match(tool):
            raise ProviderError("tool must be a hub tool name like service.tool")
        args = params.get("arguments") or {}
        if not isinstance(args, dict):
            raise ProviderError("arguments must be an object")
        return tool, args
    return f"{provider}.{op}", {k: v for k, v in params.items() if v is not None}


def _texts(res: dict[str, Any]) -> str:
    return "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))


def catalog(service: str = "") -> dict[str, Any]:
    """The hub's tools (tools/list on the hub, plus its `search` meta tool when it has one), filtered by service."""
    sid = _session()
    res, _ = transport("tools/list", {}, sid)
    tools = [t.get("name") for t in res.get("tools", []) if isinstance(t, dict)]
    found: list[str] = []
    if "search" in tools:
        r2, _ = transport("tools/call", {"name": "search", "arguments": {"query": service or "*"}}, sid)
        try:
            body = json.loads(_texts(r2) or "{}")
            found = [str(x.get("name") if isinstance(x, dict) else x) for x in (body.get("tools") or body.get("results") or [])]
        except ValueError:
            found = []
    names = sorted({*(n for n in found if n), *(n for n in tools if n and "." in n)})
    if service:
        names = [n for n in names if n.startswith(f"{service}.")]
    return {"ok": True, "tools": names, "meta": tools}


def call(provider: str, op: str, params: dict[str, Any], *, effect: str = "write", reason: Any = None, title: str = "") -> dict[str, Any]:
    """Run one provider op through axHub. → {ok, output} | {ok: False, code, message, confirmationId?, held?}."""
    if provider not in CONNECTIONS:
        return {"ok": False, "code": "not_found", "message": f"no provider connection '{provider}' (axhub, hostinger, coolify, vps, amberx)"}
    try:
        if provider == "axhub" and op == "catalog":
            return catalog(str(params.get("service") or ""))
        tool, args = tool_for(provider, op, params)
        sid = _session()
        hold = effect not in ("read", "navigate") or tool in ALWAYS_APPROVED  # axHub asks Brett for every vps.run, reads too
        call_args: dict[str, Any] = {"tool": tool, "arguments": args, "hold": hold}
        if hold:
            call_args["reason"] = reason_of(reason, title, tool)
        res, _ = transport("tools/call", {"name": "call", "arguments": call_args}, sid)
    except ProviderError as e:
        return {"ok": False, "code": "unexpected", "message": str(e)}
    text = _texts(res)
    try:
        body = json.loads(text) if text else {}
    except ValueError:
        body = {}
    if isinstance(body, dict) and body.get("held"):
        return {"ok": False, "code": "held", "held": True, "message": "sent to axHub once: it waits for Brett's approval there", "job": str(body.get("job_id") or body.get("jobId") or "")[:80], "tool": tool}
    err = body.get("error") if isinstance(body, dict) else None
    if res.get("isError"):
        if isinstance(err, dict) and err.get("code") == "confirmation_required":
            return {"ok": False, "code": "confirmation_required", "message": "axHub holds this call for Brett's approval", "confirmationId": str((err.get("details") or {}).get("confirmationId", ""))[:80], "tool": tool}
        return {"ok": False, "code": "unexpected", "message": (str((err or {}).get("message")) if isinstance(err, dict) else text or "axHub refused the call")[:400], "tool": tool}
    return {"ok": True, "tool": tool, "output": body if body else text[:20_000]}
