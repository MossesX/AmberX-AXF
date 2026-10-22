"""MCP client library — Python port of ai.amberx.axf.mcp (stdlib only).

    from axf_libs.mcp import McpClient, UrllibTransport
    client = McpClient("axhub", "https://axhub.amberxai.com/mcp", UrllibTransport(lambda sid: "Bearer " + token_for(sid)))
    conn = client.connect()          # initialize + every list the server offers
    client.call_tool("ping", {})
    client.close()

`engine` holds the pure protocol functions (same fixture as the TS and Kotlin engines); `client` the Streamable HTTP
client; `registry` a file-backed server registry whose records never hold tokens (a credential provider does).
The Dev Console's mcp-client plugin builds its routes on these.
"""
from __future__ import annotations

from axf.library import Kernel, Library

from . import engine
from .client import Connected, CredentialProvider, McpClient, SessionInfo, Transport, TransportResponse, UrllibTransport
from .engine import MCP_PERMISSIONS, MCP_PROTOCOL_VERSION, McpWireError, call_gate, content_text, tool_effect
from .registry import FileRegistry, env_or_stored_credentials

__all__ = [
    "engine", "McpClient", "UrllibTransport", "Transport", "TransportResponse", "CredentialProvider", "Connected", "SessionInfo",
    "McpWireError", "MCP_PERMISSIONS", "MCP_PROTOCOL_VERSION", "call_gate", "content_text", "tool_effect", "FileRegistry", "env_or_stored_credentials", "LIBRARY",
]


def register(kernel: Kernel) -> None:
    kernel.register_service("axf.remote.mcp", {"client": McpClient, "transport": UrllibTransport, "registry": FileRegistry})
    kernel.contribute("actions", "ai.amberx.axf.mcp", {"id": "mcp.open", "label": "MCP servers"})
    kernel.contribute("settings", "ai.amberx.axf.mcp", {"tab": "mcp", "label": "MCP servers"})


LIBRARY = Library(id="ai.amberx.axf.mcp", label="MCP client", version="0.2.0", provides=["axf.remote.mcp"], register=register)
