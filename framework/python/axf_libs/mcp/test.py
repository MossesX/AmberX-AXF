#!/usr/bin/env python3
"""Self-test for the Python MCP client (stdlib only).

    python3 framework/python/axf_libs/mcp/test.py

1. replays framework/spec/fixtures/mcp-client.json against engine.py (the TS and Kotlin engines replay the same file)
2. runs McpClient + UrllibTransport against a fake Streamable HTTP MCP server on localhost: session id, version
   negotiation, pagination, SSE tool call with a notification in the stream, forgotten session (404 → re-init once),
   JSON-RPC and HTTP errors, timeout, DELETE on close, bearer header from the credential provider, no redirects
3. the file registry: validation, ids, tokens never in public records, env var preferred, 0600
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from axf_libs.mcp import FileRegistry, McpClient, McpWireError, UrllibTransport, env_or_stored_credentials  # noqa: E402
from axf_libs.mcp import engine as E  # noqa: E402

FIX = json.loads((PY.parent / "spec" / "fixtures" / "mcp-client.json").read_text())
n = 0


def eq(a, b, what):
    global n
    a2, b2 = json.loads(json.dumps(a)), json.loads(json.dumps(b))
    if a2 != b2:
        raise SystemExit(f"FAIL {what}:\n  got      {json.dumps(a2)[:400]}\n  expected {json.dumps(b2)[:400]}")
    n += 1


# ---------------------------------------------------------------- 1. fixture replay
f = FIX
eq(E.MCP_PROTOCOL_VERSION, f["version"], "version")
eq(list(E.MCP_SUPPORTED_VERSIONS), f["supported"], "supported")
eq(E.MCP_SESSION_HEADER, f["sessionHeader"], "session header")
eq(E.MCP_VERSION_HEADER, f["versionHeader"], "version header")
eq(E.MCP_PERMISSIONS, f["permissions"], "permissions")
eq(E.initialize_params(), f["initialize"], "initialize")
eq([E.rpc_request(1, "tools/list"), E.rpc_request("x", "tools/call", {"name": "t", "arguments": {"a": 1}}), E.rpc_notification("notifications/initialized"), E.rpc_notification("notifications/cancelled", {"requestId": 3, "reason": "user"})], f["requests"], "requests")
for m in f["messages"]:
    eq(E.parse_messages(m["text"]), m["parsed"], f"parse {m['text'][:40]}")
for s in f["sse"]:
    eq(E.parse_sse(s["text"]), s["events"], f"sse {s['text'][:30]!r}")
p = E.SseParser()
ev = [e for c in f["sseChunked"]["chunks"] for e in p.feed(c)] + p.end()
eq(ev, f["sseChunked"]["events"], "sse chunked")
for h in f["headers"]:
    o = h["options"]
    eq(E.mcp_headers(o.get("sessionId"), o.get("protocolVersion"), o.get("method", "POST")), h["headers"], f"headers {o}")
for r in f["responses"]:
    eq(E.classify_response(r["status"], r["contentType"], r["hadSession"]), r["kind"], f"classify {r['status']} {r['contentType']}")
for ng in f["negotiate"]:
    eq(E.negotiate(ng["result"]), ng["outcome"], f"negotiate {str(ng['result'])[:40]}")
for o in f["offers"]:
    eq({"tools": E.offers(o["capabilities"], "tools"), "resources": E.offers(o["capabilities"], "resources"), "prompts": E.offers(o["capabilities"], "prompts"), "logging": E.offers(o["capabilities"], "logging")}, {k: o[k] for k in ("tools", "resources", "prompts", "logging")}, f"offers {o['capabilities']}")
for pp in f["pageParams"]:
    eq(E.page_params(pp["cursor"]), pp["params"], f"pageParams {pp['cursor']}")
for pg in f["pages"]:
    eq(E.merge_pages(pg["pages"], pg["maxPages"]), pg["merged"], f"pages {pg['merged']['cursors']}")
for e in f["rpcErrors"]:
    eq(E.error_from_rpc(e["error"]), e["wire"], f"rpc {e['error']['code']}")
for e in f["httpErrors"]:
    eq(E.error_from_http(e["status"]), e["wire"], f"http {e['status']}")
for e in f["transportErrors"]:
    eq(E.error_from_transport(e["kind"], e["message"]), e["wire"], f"transport {e['kind']}")
for e in f["effects"]:
    eq(E.tool_effect(e["annotations"], e["strict"]), e["effect"], f"effect {e['annotations']} {e['strict']}")
for g in f["gates"]:
    eq(E.call_gate(g["effect"], g["granted"]), g["gate"], f"gate {g['effect']} {g['granted']}")
for g in f["mappedGates"]:
    eq(E.call_gate(g["effect"], g["granted"], g["perms"]), g["gate"], f"mapped gate {g['effect']} {g['granted']}")
for c in f["contentText"]:
    eq(E.content_text(c["content"]), c["text"], f"contentText {str(c['content'])[:40]}")
for s in f["serverIds"]:
    eq(E.server_id_for(s["name"], s["taken"]), s["id"], f"serverId {s['name']!r}")
for v in f["validate"]:
    eq(E.validate_server_input(v["input"]), v["problems"], f"validate {str(v['input'])[:40]}")
for s in f["skeletons"]:
    eq(E.argument_skeleton(s["schema"]), s["args"], f"skeleton {str(s['schema'])[:40]}")
print(f"fixture replay: {n} checks")

# ---------------------------------------------------------------- 2. the client against a fake server


class Fake(BaseHTTPRequestHandler):
    inits = 0
    forget = False
    seen: list[dict] = []
    mode = "ok"

    def log_message(self, *a):  # quiet
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
        Fake.seen.append({"method": "DELETE", "headers": {k.lower(): v for k, v in self.headers.items()}})
        self._send(200)

    def do_POST(self):
        length = int(self.headers.get("Content-Length") or 0)
        raw = self.rfile.read(length).decode()
        hdr = {k.lower(): v for k, v in self.headers.items()}
        Fake.seen.append({"method": "POST", "headers": hdr, "body": raw})
        try:
            m = json.loads(raw)
        except ValueError:
            return self._send(400)
        if Fake.mode == "redirect":
            return self._send(302, extra={"Location": "https://evil.example/mcp"})
        if Fake.mode == "slow":
            import time
            time.sleep(1.5)
        if Fake.mode.startswith("http:"):
            return self._send(int(Fake.mode[5:]))
        method, rid = m.get("method"), m.get("id")
        res = lambda r, extra=None: self._send(200, json.dumps({"jsonrpc": "2.0", "id": rid, "result": r}).encode(), extra=extra)  # noqa: E731
        if method == "initialize":
            Fake.inits += 1
            v = "2030-01-01" if Fake.mode == "badversion" else "2025-06-18"
            return res({"protocolVersion": v, "capabilities": {"tools": {}, "resources": {}, "prompts": {}}, "serverInfo": {"name": "fake", "version": "1"}, "instructions": "hi"}, {"Mcp-Session-Id": f"S{Fake.inits}"})
        if method in ("notifications/initialized", "notifications/cancelled"):
            return self._send(202, ctype=None)
        if Fake.forget and hdr.get("mcp-session-id") == "S1":
            return self._send(404, b"gone", "text/plain")
        if method == "tools/list":
            c = (m.get("params") or {}).get("cursor")
            return res({"tools": [{"name": "b", "annotations": {"destructiveHint": True}}]} if c else {"tools": [{"name": "a", "annotations": {"readOnlyHint": True}}], "nextCursor": "p2"})
        if method == "resources/list":
            return res({"resources": [{"uri": "file:///x", "name": "x"}]})
        if method == "resources/templates/list":
            return res({"resourceTemplates": []})
        if method == "prompts/list":
            return res({"prompts": [{"name": "p"}]})
        if method == "tools/call":
            body = ('event: message\ndata: {"jsonrpc":"2.0","method":"notifications/progress","params":{"progress":0.5}}\n\n'
                    + "event: message\ndata: " + json.dumps({"jsonrpc": "2.0", "id": rid, "result": {"content": [{"type": "text", "text": "done"}], "structuredContent": {"ok": 1}}}) + "\n\n").encode()
            return self._send(200, body, "text/event-stream")
        if method == "resources/read":
            return res({"contents": [{"uri": "file:///x", "text": "body"}]})
        if method == "prompts/get":
            return res({"description": "d", "messages": [{"role": "user", "content": {"type": "text", "text": "hello"}}]})
        return self._send(200, json.dumps({"jsonrpc": "2.0", "id": rid, "error": {"code": -32601, "message": "nope"}}).encode())


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
URL = f"http://127.0.0.1:{srv.server_port}/mcp"

notes: list[str] = []
calls: list[tuple] = []
c = McpClient("s", URL, UrllibTransport(lambda sid: "Bearer tok-" + sid), on_notification=lambda m, p: notes.append(m), on_call=lambda op, ok, ms, d: calls.append((op, ok)))
conn = c.connect()
eq(conn.session.session_id, "S1", "session id")
eq(conn.session.protocol_version, "2025-06-18", "negotiated")
eq([t["name"] for t in conn.tools], ["a", "b"], "paginated tools")
eq(len(conn.resources), 1, "resources")
eq(len(conn.prompts), 1, "prompts")
eq(Fake.seen[0]["headers"].get("mcp-session-id"), None, "initialize has no session")
eq(Fake.seen[0]["headers"].get("authorization"), "Bearer tok-s", "bearer from the credential provider")
eq(Fake.seen[1]["headers"].get("mcp-session-id"), "S1", "session on later requests")
eq(Fake.seen[1]["headers"].get("mcp-protocol-version"), "2025-06-18", "version header")
r = c.call_tool("t", {"a": 1})
eq(r, {"isError": False, "content": [{"type": "text", "text": "done"}], "structured": {"ok": 1}}, "tool call over SSE")
eq(notes, ["notifications/progress"], "notification from the stream")
eq(c.read_resource("file:///x")[0]["text"], "body", "read resource")
eq(len(c.get_prompt("p")["messages"]), 1, "get prompt")
try:
    c.ping()
    raise SystemExit("FAIL: ping should map the rpc error")
except McpWireError as e:
    eq(e.code, "not_found", "rpc error → not_found")
Fake.forget = True
eq([t["name"] for t in c.list_tools()["items"]], ["a", "b"], "forgotten session: retried after re-initialize")
eq(Fake.inits, 2, "initialized twice")
eq(c.session_id, "S2", "new session kept")
Fake.forget = False
c.close()
eq(Fake.seen[-1]["method"], "DELETE", "close deletes")
eq(Fake.seen[-1]["headers"].get("mcp-session-id"), "S2", "delete carries the session")
eq(c.connected, False, "closed")
eq(any(op == "initialize" and ok for op, ok in calls) and any(op == "ping" and not ok for op, ok in calls), True, "call log")

Fake.mode = "badversion"
try:
    McpClient("s", URL, UrllibTransport()).initialize()
    raise SystemExit("FAIL: bad version accepted")
except McpWireError as e:
    eq(e.code, "invalid", "unsupported version refused")
for status, code in ((401, "denied"), (404, "not_found"), (503, "unavailable"), (418, "invalid")):
    Fake.mode = f"http:{status}"
    try:
        McpClient("s", URL, UrllibTransport()).initialize()
        raise SystemExit(f"FAIL: http {status} accepted")
    except McpWireError as e:
        eq(e.code, code, f"http {status} → {code}")
Fake.mode = "slow"
try:
    McpClient("s", URL, UrllibTransport(), timeout=0.2).initialize()
    raise SystemExit("FAIL: no timeout")
except McpWireError as e:
    eq(e.code, "timeout", "timeout")
Fake.mode = "redirect"
try:
    McpClient("s", URL, UrllibTransport(lambda sid: "Bearer secret")).initialize()
    raise SystemExit("FAIL: redirect followed")
except McpWireError as e:
    eq(e.code, "invalid", "redirect not followed (token never leaves the host)")
Fake.mode = "ok"
try:
    McpClient("s", "http://127.0.0.1:1/mcp", UrllibTransport(), timeout=1).initialize()
    raise SystemExit("FAIL: connection refused accepted")
except McpWireError as e:
    eq(e.code, "unavailable", "network error → unavailable")
    eq(e.error["retryable"], True, "retryable")
srv.shutdown()

# ---------------------------------------------------------------- 3. file registry
d = Path(tempfile.mkdtemp(prefix="axf-mcp-"))
env = {"AXHUB_TOKEN": "fromenv"}
reg = FileRegistry(d / "mcp-servers.json", env=lambda k: env.get(k))
s = reg.upsert({"name": "axHub", "url": "https://hub/mcp", "token": "sEcReT-1"})
eq(s["id"], "axhub", "id from name")
eq(s["auth"], "token", "auth kind")
eq("sEcReT-1" in json.dumps(reg.list()), False, "token not in public records")
eq(oct(os.stat(d / "mcp-servers.json").st_mode & 0o777), "0o600", "file is 0600")
eq(reg.authorization("axhub"), "Bearer sEcReT-1", "stored token → bearer")
s2 = reg.upsert({"name": "axHub", "url": "https://hub/mcp"})
eq(s2["id"], "axhub-2", "new server never replaces another")
eq(reg.upsert({"id": "axhub", "name": "axHub", "url": "https://hub/mcp", "token": None})["auth"], "token", "None keeps the token")
eq(reg.upsert({"id": "axhub", "name": "axHub", "url": "https://hub/mcp", "token": ""})["auth"], "none", "'' clears the token")
e1 = reg.upsert({"id": "axhub", "name": "axHub", "url": "https://hub/mcp", "tokenEnv": "AXHUB_TOKEN", "token": "ignored"})
eq((e1["auth"], e1["envPresent"]), ("env", True), "env var preferred over a token")
eq(reg.authorization("axhub"), "Bearer fromenv", "env token → bearer")
eq("ignored" in (d / "mcp-servers.json").read_text(), False, "a token is never stored next to tokenEnv")
env.clear()
try:
    reg.authorization("axhub")
    raise SystemExit("FAIL: unset env var accepted")
except McpWireError as e:
    eq(e.code, "invalid", "unset env var → invalid")
try:
    reg.upsert({"name": "", "url": "ftp://x"})
    raise SystemExit("FAIL: validation")
except McpWireError as e:
    eq(e.code, "validation", "validation error")
eq(env_or_stored_credentials(reg)("missing"), None, "unknown server → no auth")
reg.touch("axhub", True, 3)
eq(reg.get("axhub")["lastCheck"]["tools"], 3, "touch")
eq(reg.remove("axhub") and not reg.remove("axhub"), True, "remove once")
print(f"mcp python self-test ok: {n} checks")
