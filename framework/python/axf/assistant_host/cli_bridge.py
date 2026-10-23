"""MCP stdio server the Claude Code CLI starts for one chat turn: it hands the CLI the host's tools
(framework/python, `axf.assistant_host.cli_bridge`; started by providers._Bridge, run as a script, never imported).

The CLI's own Edit/Write/Bash stay off. Instead, the tools the assistant would give any provider (the agent's tools,
including Mosses's container tools) are offered here, and every call is forwarded over a private unix socket to the
host's turn engine, which runs it exactly as for API providers: same safety list, same staging into one approval
card, same snapshot rule. No token or secret is involved: the socket lives in a 0700 temp folder for this turn only.

Env: AXF_BRIDGE_SOCKET (socket path), AXF_BRIDGE_TOOLS (JSON file with [{name, description, parameters}]).
Stdlib only; newline-delimited JSON-RPC 2.0 on stdin/stdout.
"""
from __future__ import annotations

import json
import os
import socket
import sys

PROTOCOL = "2025-06-18"


def _send(msg: dict) -> None:
    sys.stdout.write(json.dumps(msg) + "\n")
    sys.stdout.flush()


def _call(name: str, args: dict) -> tuple[bool, str]:
    s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    s.settimeout(900)
    try:
        s.connect(os.environ["AXF_BRIDGE_SOCKET"])
        s.sendall((json.dumps({"name": name, "arguments": args}) + "\n").encode())
        buf = b""
        while not buf.endswith(b"\n"):
            chunk = s.recv(65536)
            if not chunk:
                break
            buf += chunk
        r = json.loads(buf or b"{}")
        return bool(r.get("ok")), str(r.get("text", ""))
    except (OSError, ValueError, KeyError) as e:
        return False, f"Error: the console bridge is gone ({e})"
    finally:
        s.close()


def main() -> None:
    try:
        with open(os.environ["AXF_BRIDGE_TOOLS"], encoding="utf-8") as f:
            tools = json.load(f)
    except (OSError, ValueError, KeyError):
        tools = []
    names = {t["name"] for t in tools}
    for line in sys.stdin:
        line = line.strip()
        if not line:
            continue
        try:
            msg = json.loads(line)
        except ValueError:
            continue
        mid, method, params = msg.get("id"), msg.get("method", ""), msg.get("params") or {}
        if mid is None:  # notifications (initialized, cancelled…)
            continue
        if method == "initialize":
            _send({"jsonrpc": "2.0", "id": mid, "result": {"protocolVersion": params.get("protocolVersion") or PROTOCOL,
                                                           "capabilities": {"tools": {}}, "serverInfo": {"name": "axf-console", "version": "1.0.0"}}})
        elif method == "ping":
            _send({"jsonrpc": "2.0", "id": mid, "result": {}})
        elif method == "tools/list":
            _send({"jsonrpc": "2.0", "id": mid, "result": {"tools": [{"name": t["name"], "description": t.get("description", ""),
                                                                       "inputSchema": t.get("parameters") or {"type": "object", "properties": {}}} for t in tools]}})
        elif method == "tools/call":
            name = str(params.get("name") or "")
            if name not in names:
                _send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": f"Unknown tool {name}"}], "isError": True}})
                continue
            ok, text = _call(name, params.get("arguments") or {})
            _send({"jsonrpc": "2.0", "id": mid, "result": {"content": [{"type": "text", "text": text}], "isError": not ok}})
        else:
            _send({"jsonrpc": "2.0", "id": mid, "error": {"code": -32601, "message": f"method not found: {method}"}})


if __name__ == "__main__":
    main()
