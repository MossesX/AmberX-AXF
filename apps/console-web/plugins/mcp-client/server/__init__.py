"""MCP client — the console's connection to other MCP servers. Mounted at /api/plugins/mcp-client/.

The console adds two checks to every route: the console token (every method, reads included) and 404 while the
plugin is disabled. Plugin routes are never exposed through the console's own MCP server.

Servers are kept in a private JSON file next to the console state (AXF_MCP_SERVERS, default
.axf-console/mcp-servers.json, written with 0600). Credentials never go back to the browser:
  * tokenEnv — the name of an environment variable holding the bearer token (preferred), or
  * token    — typed once in the console; stored server-side only and shown as "set".
Only Streamable HTTP servers (http/https URLs) are supported: this plugin never launches local commands.
Everything a remote server returns is data; the web part renders it as text, never as HTML.
"""
from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

_ROOT = Path(__file__).resolve().parents[5]
_FILE = Path(os.environ.get("AXF_MCP_SERVERS", _ROOT / ".axf-console" / "mcp-servers.json"))
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
_ENV = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")
_LOG: deque[dict[str, Any]] = deque(maxlen=200)
TIMEOUT = float(os.environ.get("AXF_MCP_TIMEOUT", "30"))


# ---------------------------------------------------------------- storage

def _load() -> dict[str, dict[str, Any]]:
    try:
        raw = json.loads(_FILE.read_text())
        return {k: v for k, v in raw.get("servers", {}).items() if isinstance(v, dict)}
    except (OSError, ValueError):
        return {}


def _save(servers: dict[str, dict[str, Any]]) -> None:
    _FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = _FILE.with_suffix(".tmp")
    tmp.write_text(json.dumps({"$axf": "mcp-servers@1", "servers": servers}, indent=2))
    os.chmod(tmp, 0o600)
    tmp.replace(_FILE)


def _public(sid: str, s: dict[str, Any]) -> dict[str, Any]:
    """What the browser may see: never the token itself."""
    env = s.get("tokenEnv") or ""
    return {
        "id": sid, "name": s.get("name") or sid, "url": s.get("url", ""), "description": s.get("description", ""),
        "tokenEnv": env, "auth": "env" if env else ("token" if s.get("token") else "none"),
        "envPresent": bool(env and os.environ.get(env)),
        "createdAt": s.get("createdAt", ""), "lastCheck": s.get("lastCheck"),
    }


def _log(sid: str, op: str, ok: bool, ms: int, detail: str = "") -> None:
    _LOG.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "server": sid, "op": op, "ok": ok, "ms": ms, "detail": detail[:300]})


def _get(sid: str) -> dict[str, Any]:
    s = _load().get(sid)
    if not s:
        raise HTTPException(404, f"no MCP server {sid!r}")
    return s


# ---------------------------------------------------------------- MCP calls

def _headers(s: dict[str, Any]) -> dict[str, str]:
    token = os.environ.get(s["tokenEnv"], "") if s.get("tokenEnv") else s.get("token", "")
    if s.get("tokenEnv") and not token:
        raise HTTPException(400, f"environment variable {s['tokenEnv']} is not set on the console server")
    return {"Authorization": f"Bearer {token}"} if token else {}


async def _with_client(sid: str, op: str, fn):
    """Open a client for one operation (stateless: connect, do it, close) and log the outcome."""
    from mcp import Client
    from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client

    s = _get(sid)
    started = time.monotonic()
    try:
        import httpx2  # the SDK's HTTP client package
        http = create_mcp_http_client(headers=_headers(s), timeout=httpx2.Timeout(TIMEOUT))
    except ImportError:
        http = create_mcp_http_client(headers=_headers(s))
    try:
        async with http:
            async with Client(streamable_http_client(s["url"], http_client=http), read_timeout_seconds=TIMEOUT) as client:
                out = await fn(client)
        _log(sid, op, True, int((time.monotonic() - started) * 1000))
        return out
    except HTTPException:
        raise
    except BaseException as e:  # noqa: BLE001 — remote failures (incl. exception groups) become a clean 502
        msg = _describe(e)
        _log(sid, op, False, int((time.monotonic() - started) * 1000), msg)
        raise HTTPException(502, f"{s.get('name') or sid}: {msg}") from None


def _describe(e: BaseException) -> str:
    inner = getattr(e, "exceptions", None)
    if inner:
        return "; ".join(_describe(x) for x in inner[:3])
    text = str(e) or type(e).__name__
    return text if len(text) < 400 else text[:400] + "…"


def _dump(x: Any) -> Any:
    if hasattr(x, "model_dump"):
        return x.model_dump(mode="json", by_alias=True, exclude_none=True)
    if isinstance(x, list):
        return [_dump(i) for i in x]
    return x


# ---------------------------------------------------------------- routes

class ServerIn(BaseModel):
    id: str = ""
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=500)
    tokenEnv: str = ""
    token: str | None = None  # None = keep the stored one; "" = clear it


@router.get("/servers")
def list_servers() -> dict[str, Any]:
    return {"items": [_public(k, v) for k, v in sorted(_load().items(), key=lambda kv: kv[1].get("name", kv[0]).lower())],
            "file": str(_FILE.relative_to(_ROOT)) if _FILE.is_relative_to(_ROOT) else str(_FILE), "timeout": TIMEOUT}


@router.post("/servers")
def save_server(body: ServerIn) -> dict[str, Any]:
    u = urlparse(body.url.strip())
    if u.scheme not in ("http", "https") or not u.netloc:
        raise HTTPException(400, "url must be an http(s) URL of a Streamable HTTP MCP endpoint, e.g. https://example.com/mcp")
    if body.tokenEnv and not _ENV.match(body.tokenEnv):
        raise HTTPException(400, "tokenEnv must be an environment variable name like AXHUB_TOKEN")
    servers = _load()
    sid = body.id or re.sub(r"[^a-z0-9]+", "-", body.name.lower()).strip("-")[:48] or "server"
    if not _ID.match(sid):
        raise HTTPException(400, "id must be lowercase letters, digits and dashes")
    old = servers.get(sid, {})
    if not body.id:  # a new server never silently replaces another
        base, n = sid, 2
        while sid in servers:
            sid = f"{base}-{n}"
            n += 1
        old = {}
    rec = {"name": body.name.strip(), "url": body.url.strip(), "description": body.description.strip(), "tokenEnv": body.tokenEnv,
           "createdAt": old.get("createdAt") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "lastCheck": old.get("lastCheck")}
    token = old.get("token", "") if body.token is None else body.token
    if token and not body.tokenEnv:
        rec["token"] = token
    servers[sid] = rec
    _save(servers)
    return {"server": _public(sid, rec)}


@router.delete("/servers/{sid}")
def delete_server(sid: str) -> dict[str, Any]:
    servers = _load()
    if servers.pop(sid, None) is None:
        raise HTTPException(404, f"no MCP server {sid!r}")
    _save(servers)
    return {"deleted": sid}


@router.post("/servers/{sid}/connect")
async def connect(sid: str) -> dict[str, Any]:
    """Initialize, then list tools, resources and prompts (whatever the server offers)."""
    async def run(c):
        caps = c.server_capabilities
        info = c.server_info
        out: dict[str, Any] = {"server": _dump(info) if info else None, "instructions": c.instructions or "",
                               "protocol": getattr(c, "protocol_version", None), "capabilities": _dump(caps) if caps else {},
                               "tools": [], "resources": [], "prompts": []}
        if caps is None or caps.tools is not None:
            out["tools"] = _dump((await c.list_tools()).tools)
        if caps is not None and caps.resources is not None:
            try: out["resources"] = _dump((await c.list_resources()).resources)
            except Exception as e: out["resourcesError"] = _describe(e)  # noqa: E701
        if caps is not None and caps.prompts is not None:
            try: out["prompts"] = _dump((await c.list_prompts()).prompts)
            except Exception as e: out["promptsError"] = _describe(e)  # noqa: E701
        return out
    result = await _with_client(sid, "connect", run)
    servers = _load()
    if sid in servers:
        servers[sid]["lastCheck"] = {"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "ok": True, "tools": len(result["tools"])}
        _save(servers)
    return result


class CallIn(BaseModel):
    tool: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.post("/servers/{sid}/call")
async def call_tool(sid: str, body: CallIn) -> dict[str, Any]:
    async def run(c):
        r = await c.call_tool(body.tool, body.arguments)
        return {"isError": bool(getattr(r, "is_error", False) or getattr(r, "isError", False)), "content": _dump(r.content),
                "structured": _dump(getattr(r, "structured_content", None) or getattr(r, "structuredContent", None))}
    return await _with_client(sid, f"call {body.tool}", run)


class ReadIn(BaseModel):
    uri: str = Field(min_length=1, max_length=1000)


@router.post("/servers/{sid}/read")
async def read_resource(sid: str, body: ReadIn) -> dict[str, Any]:
    async def run(c):
        return {"contents": _dump((await c.read_resource(body.uri)).contents)}
    return await _with_client(sid, f"read {body.uri}", run)


@router.get("/log")
def call_log() -> dict[str, Any]:
    return {"items": list(_LOG)}
