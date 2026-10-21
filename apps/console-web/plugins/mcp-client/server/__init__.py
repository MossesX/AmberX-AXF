"""MCP client — the console's connection to other MCP servers. Mounted at /api/plugins/mcp-client/.

Fable rebuild (Oct 20 2026) on the framework's MCP client library: the protocol core is `axf_libs.mcp` (framework/python,
stdlib, the same engine the web and Kotlin ports replay) and the server registry is its `FileRegistry`. Routes, data
file and behaviour are the Opus plugin's (Oct 18 2026), so the console UI and anything scripted against it keep working.

The console adds two checks to every route: the console token (every method, reads included) and 404 while the
plugin is disabled. Plugin routes are never exposed through the console's own MCP server.

Servers are kept in a private JSON file (mcp-servers@1): AXF_MCP_SERVERS, default <dataDir>/mcp-servers.json
(.axf-console/plugins/mcp-client/, 0600; the pre-lifecycle .axf-console/mcp-servers.json is still read when the new
one doesn't exist, and install.mjs moves it). Credentials never go back to the browser:
  * tokenEnv — the name of an environment variable holding the bearer token (preferred), or
  * token    — typed once in the console; stored server-side only and shown as "set".
Only Streamable HTTP servers (http/https URLs) are supported: this plugin never launches local commands.
Everything a remote server returns is data; the web part renders it as text, never as HTML.
"""
from __future__ import annotations

import os
import sys
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from starlette.concurrency import run_in_threadpool

_ROOT = Path(__file__).resolve().parents[5]
_PY = _ROOT / "framework" / "python"
if str(_PY) not in sys.path:
    sys.path.insert(0, str(_PY))

from axf_libs.mcp import FileRegistry, McpClient, McpWireError, UrllibTransport  # noqa: E402
from axf_libs.mcp import engine as E  # noqa: E402

router = APIRouter()

_DATA = _ROOT / ".axf-console" / "plugins" / "mcp-client"
_LEGACY = _ROOT / ".axf-console" / "mcp-servers.json"


def _file() -> Path:
    env = os.environ.get("AXF_MCP_SERVERS")
    if env:
        return Path(env)
    new = _DATA / "mcp-servers.json"
    return new if new.exists() or not _LEGACY.exists() else _LEGACY


TIMEOUT = float(os.environ.get("AXF_MCP_TIMEOUT", "30"))
_LOG: deque[dict[str, Any]] = deque(maxlen=200)
# wire code → HTTP status for failures the server itself detects (the remote server's failures are 502 below)
_STATUS = {E.VALIDATION: 400, E.INVALID: 400, E.NOT_FOUND: 404, E.DENIED: 403}


def _registry() -> FileRegistry:
    return FileRegistry(_file())


def _log(sid: str, op: str, ok: bool, ms: int, detail: str = "") -> None:
    _LOG.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "server": sid, "op": op, "ok": ok, "ms": ms, "detail": detail[:300]})


def _get(sid: str) -> dict[str, Any]:
    s = _registry().get(sid)
    if not s:
        raise HTTPException(404, f"no MCP server {sid!r}")
    return s


def _client(sid: str, s: dict[str, Any]) -> McpClient:
    reg = _registry()

    def creds(_sid: str) -> str | None:
        try:
            return reg.authorization(_sid)
        except McpWireError as e:  # env var unset → a 400 the person can act on (same as the Opus build)
            raise HTTPException(400, e.error["message"]) from None

    return McpClient(sid, s["url"], UrllibTransport(creds), timeout=TIMEOUT, on_call=lambda op, ok, ms, d: _log(sid, op, ok, ms, d))


async def _with_client(sid: str, op: str, fn):
    """One session per operation (connect, do it, close) in a worker thread; remote failures become a clean 502."""
    s = _get(sid)
    started = time.monotonic()

    def run():
        c = _client(sid, s)
        try:
            return fn(c)
        finally:
            c.close()

    try:
        return await run_in_threadpool(run)
    except HTTPException:
        raise
    except McpWireError as e:
        msg = e.error["message"]
        _log(sid, op, False, int((time.monotonic() - started) * 1000), msg)
        raise HTTPException(502, f"{s.get('name') or sid}: {msg}") from None
    except Exception as e:  # noqa: BLE001
        msg = str(e) or type(e).__name__
        _log(sid, op, False, int((time.monotonic() - started) * 1000), msg)
        raise HTTPException(502, f"{s.get('name') or sid}: {msg[:400]}") from None


# ---------------------------------------------------------------- routes (unchanged from the Opus build)

class ServerIn(BaseModel):
    id: str = ""
    name: str = Field(min_length=1, max_length=80)
    url: str = Field(min_length=1, max_length=500)
    description: str = Field(default="", max_length=500)
    tokenEnv: str = ""
    token: str | None = None  # None = keep the stored one; "" = clear it


@router.get("/servers")
def list_servers() -> dict[str, Any]:
    f = _file()
    return {"items": _registry().list(), "file": str(f.relative_to(_ROOT)) if f.is_relative_to(_ROOT) else str(f), "timeout": TIMEOUT}


@router.post("/servers")
def save_server(body: ServerIn) -> dict[str, Any]:
    try:
        rec = _registry().upsert({"id": body.id, "name": body.name, "url": body.url, "description": body.description, "tokenEnv": body.tokenEnv, "token": body.token})
    except McpWireError as e:
        raise HTTPException(_STATUS.get(e.code, 400), e.error["message"]) from None
    return {"server": rec}


@router.delete("/servers/{sid}")
def delete_server(sid: str) -> dict[str, Any]:
    if not _registry().remove(sid):
        raise HTTPException(404, f"no MCP server {sid!r}")
    return {"deleted": sid}


@router.post("/servers/{sid}/connect")
async def connect(sid: str) -> dict[str, Any]:
    """Initialize, then list tools, resources and prompts (whatever the server offers)."""
    def run(c: McpClient):
        conn = c.connect()
        out: dict[str, Any] = {"server": conn.session.server_info, "instructions": conn.session.instructions, "protocol": conn.session.protocol_version,
                               "sessionId": conn.session.session_id, "capabilities": conn.session.capabilities,
                               "tools": conn.tools, "resources": conn.resources, "resourceTemplates": conn.resource_templates, "prompts": conn.prompts}
        if conn.resources_error:
            out["resourcesError"] = conn.resources_error
        if conn.prompts_error:
            out["promptsError"] = conn.prompts_error
        return out
    result = await _with_client(sid, "connect", run)
    _registry().touch(sid, True, len(result["tools"]))
    return result


class CallIn(BaseModel):
    tool: str = Field(min_length=1, max_length=200)
    arguments: dict[str, Any] = Field(default_factory=dict)


@router.post("/servers/{sid}/call")
async def call_tool(sid: str, body: CallIn) -> dict[str, Any]:
    return await _with_client(sid, f"call {body.tool}", lambda c: c.call_tool(body.tool, body.arguments))


class ReadIn(BaseModel):
    uri: str = Field(min_length=1, max_length=1000)


@router.post("/servers/{sid}/read")
async def read_resource(sid: str, body: ReadIn) -> dict[str, Any]:
    return await _with_client(sid, f"read {body.uri}", lambda c: {"contents": c.read_resource(body.uri)})


class PromptIn(BaseModel):
    name: str = Field(min_length=1, max_length=200)
    arguments: dict[str, str] = Field(default_factory=dict)


@router.post("/servers/{sid}/prompt")
async def get_prompt(sid: str, body: PromptIn) -> dict[str, Any]:
    """New in the rebuild: prompts/get (the Opus build only listed prompts)."""
    return await _with_client(sid, f"prompt {body.name}", lambda c: c.get_prompt(body.name, body.arguments))


@router.get("/log")
def call_log() -> dict[str, Any]:
    return {"items": list(_LOG)}
