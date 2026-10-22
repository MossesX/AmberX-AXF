#!/usr/bin/env python3
"""Self-test for the MCP client plugin (server part on the framework's Python MCP library, fake Streamable HTTP server).

    python3 apps/console-web/plugins/mcp-client/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
DATA = Path(tempfile.mkdtemp(prefix="axf-mcp-plugin-"))
os.environ["AXF_MCP_SERVERS"] = str(DATA / "mcp-servers.json")
os.environ["AXF_MCP_TIMEOUT"] = "3"
os.environ["X_TOKEN"] = "env-secret"
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.mcp_client_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


class Fake(BaseHTTPRequestHandler):
    auth: list[str | None] = []

    def log_message(self, *a):
        pass

    def _send(self, status, body=b"", ctype="application/json", extra=None):
        self.send_response(status)
        if ctype:
            self.send_header("Content-Type", ctype)
        for k, v in (extra or {}).items():
            self.send_header(k, v)
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_DELETE(self):
        self._send(200)

    def do_POST(self):
        Fake.auth.append(self.headers.get("Authorization"))
        m = json.loads(self.rfile.read(int(self.headers.get("Content-Length") or 0)).decode())
        method, rid = m.get("method"), m.get("id")
        res = lambda r, extra=None: self._send(200, json.dumps({"jsonrpc": "2.0", "id": rid, "result": r}).encode(), extra=extra)  # noqa: E731
        if method == "initialize":
            return res({"protocolVersion": "2025-06-18", "capabilities": {"tools": {}, "prompts": {}}, "serverInfo": {"name": "fake", "version": "1"}, "instructions": "hi"}, {"Mcp-Session-Id": "S1"})
        if method and method.startswith("notifications/"):
            return self._send(202, ctype=None)
        if method == "tools/list":
            return res({"tools": [{"name": "echo", "inputSchema": {"type": "object", "properties": {"text": {"type": "string"}}, "required": ["text"]}, "annotations": {"readOnlyHint": True}}, {"name": "wipe", "annotations": {"destructiveHint": True}}]})
        if method == "prompts/list":
            return res({"prompts": [{"name": "greet", "arguments": [{"name": "who", "required": True}]}]})
        if method == "tools/call":
            args = (m.get("params") or {}).get("arguments") or {}
            body = "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": "echo:" + str(args.get("text"))}]}}) + "\n\n"
            return self._send(200, body.encode(), "text/event-stream")
        if method == "prompts/get":
            return res({"messages": [{"role": "user", "content": {"type": "text", "text": "hello " + ((m.get("params") or {}).get("arguments") or {}).get("who", "?")}}]})
        return self._send(200, json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "nope"}}).encode())


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/mcp"

print("mcp-client plugin self-test")
check(c.get("/p/servers").json()["items"] == [], "no servers at start")
r = c.post("/p/servers", json={"name": "Env Hub", "url": URL, "tokenEnv": "X_TOKEN"}).json()["server"]
check(r["id"] == "env-hub" and r["auth"] == "env" and r["envPresent"] is True, "server with an env token")
r2 = c.post("/p/servers", json={"name": "Stored", "url": URL, "token": "sEcReT-9"}).json()["server"]
check(r2["auth"] == "token" and "sEcReT-9" not in json.dumps(c.get("/p/servers").json()), "stored token never returned")
check(oct(os.stat(DATA / "mcp-servers.json").st_mode & 0o777) == "0o600", "servers file is 0600")
check(c.post("/p/servers", json={"name": "x", "url": "ftp://x"}).status_code == 400, "bad url → 400")
check(c.post("/p/servers", json={"name": "x", "url": URL, "tokenEnv": "lower"}).status_code == 400, "bad env name → 400")
check(c.post("/p/servers", json={"name": "x", "url": URL, "id": "Bad Id"}).status_code == 400, "bad id → 400")
check(c.post("/p/servers", json={"name": "Env Hub", "url": URL}).json()["server"]["id"] == "env-hub-2", "a new server never replaces another")

conn = c.post("/p/servers/env-hub/connect").json()
check(conn["server"]["name"] == "fake" and conn["protocol"] == "2025-06-18" and conn["sessionId"] == "S1", "connect: server info, protocol, session")
check([t["name"] for t in conn["tools"]] == ["echo", "wipe"] and [p["name"] for p in conn["prompts"]] == ["greet"], "connect lists tools and prompts")
check(conn["resources"] == [] and "resourcesError" not in conn, "no resources capability → empty, no error")
check(Fake.auth[0] == "Bearer env-secret", "bearer token taken from the environment variable")
check(c.get("/p/servers").json()["items"][0]["lastCheck"]["tools"] == 2, "lastCheck recorded")
r = c.post("/p/servers/env-hub/call", json={"tool": "echo", "arguments": {"text": "hi"}}).json()
check(r["isError"] is False and r["content"][0]["text"] == "echo:hi", "tool call over SSE")
r = c.post("/p/servers/env-hub/prompt", json={"name": "greet", "arguments": {"who": "Brett"}}).json()
check(r["messages"][0]["content"]["text"] == "hello Brett", "prompts/get (new route)")
r = c.post("/p/servers/stored/call", json={"tool": "echo", "arguments": {}}).json()
check(Fake.auth[-1] == "Bearer sEcReT-9", "stored token used as bearer")
check(c.post("/p/servers/env-hub/read", json={"uri": "file:///x"}).status_code == 502, "rpc error from the server → 502")
log = c.get("/p/log").json()["items"]
check(log[0]["op"] == "read file:///x" and log[0]["ok"] is False and any(x["op"] == "connect" or x["op"] == "initialize" for x in log), "call log rows")
check(all("sEcReT" not in json.dumps(x) and "env-secret" not in json.dumps(x) for x in log), "no secrets in the log")
check(c.post("/p/servers/nope/connect").status_code == 404, "unknown server → 404")
del os.environ["X_TOKEN"]
check(c.post("/p/servers/env-hub/call", json={"tool": "echo"}).status_code == 400, "env var unset → 400")
srv.shutdown()
check(c.post("/p/servers/stored/connect").status_code == 502, "unreachable server → 502")
check(c.delete("/p/servers/stored").json()["deleted"] == "stored" and c.delete("/p/servers/stored").status_code == 404, "delete once")

# legacy file fallback (pre-lifecycle Opus data location) is read when AXF_MCP_SERVERS is unset and the new file is absent
del os.environ["AXF_MCP_SERVERS"]
legacy_default = mod._file()
check(legacy_default.name == "mcp-servers.json" and ".axf-console" in str(legacy_default), "default file lives under .axf-console")
print(f"ok: {ok} checks")
