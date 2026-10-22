"""MCP client engine — Python port of framework/core/engines/mcp.ts (stdlib only).

Pure functions: JSON-RPC framing, SSE parsing, Streamable HTTP rules, pagination, error mapping onto the kernel's
wire codes, tool effects and the outbound call gate. Pinned by framework/spec/fixtures/mcp-client.json, which
test.py replays. The transport lives in client.py and never leaks into here.
"""
from __future__ import annotations

import json
import re
from dataclasses import dataclass, field
from typing import Any, Iterable

MCP_PROTOCOL_VERSION = "2025-06-18"
MCP_SUPPORTED_VERSIONS = ("2025-06-18", "2025-03-26", "2024-11-05")
MCP_SESSION_HEADER = "mcp-session-id"
MCP_VERSION_HEADER = "mcp-protocol-version"
MCP_CLIENT_INFO = {"name": "amberx-axf", "version": "0.2.0", "title": "AmberX AXF MCP client"}
MCP_DEFAULT_TIMEOUT_S = 30.0

MCP_PERMISSIONS = {"MANAGE": "mcp.servers.manage", "CALL": "mcp.call", "WRITE": "mcp.call.write", "DESTRUCTIVE": "mcp.call.destructive"}

INVALID, NOT_IMPLEMENTED, DENIED, NOT_FOUND, UNAVAILABLE = "invalid", "not_implemented", "denied", "not_found", "unavailable"
VALIDATION, UNEXPECTED, CANCELLED, TIMEOUT, CONFIRMATION_REQUIRED = "validation", "unexpected", "cancelled", "timeout", "confirmation_required"

# ---------------------------------------------------------------- JSON-RPC framing


def rpc_request(id: int | str, method: str, params: dict | None = None) -> dict:
    m: dict[str, Any] = {"jsonrpc": "2.0", "id": id, "method": method}
    if params is not None:
        m["params"] = params
    return m


def rpc_notification(method: str, params: dict | None = None) -> dict:
    m: dict[str, Any] = {"jsonrpc": "2.0", "method": method}
    if params is not None:
        m["params"] = params
    return m


def _is_id(v: Any) -> bool:
    return isinstance(v, str) or (isinstance(v, int) and not isinstance(v, bool))


def parse_message(raw: Any) -> dict:
    """Classify one parsed JSON value: request | notification | result | error | invalid (same shapes as the TS engine)."""
    if not isinstance(raw, dict):
        return {"kind": "invalid", "reason": "not an object"}
    if raw.get("jsonrpc") != "2.0":
        return {"kind": "invalid", "reason": 'jsonrpc must be "2.0"'}
    params = raw.get("params") if isinstance(raw.get("params"), dict) else {}
    if isinstance(raw.get("method"), str):
        if "id" in raw and raw["id"] is not None:
            if _is_id(raw["id"]):
                return {"kind": "request", "id": raw["id"], "method": raw["method"], "params": params}
            return {"kind": "invalid", "reason": "id must be a string or number"}
        return {"kind": "notification", "method": raw["method"], "params": params}
    if "error" in raw:
        e = raw["error"]
        if not isinstance(e, dict) or not isinstance(e.get("code"), int) or isinstance(e.get("code"), bool) or not isinstance(e.get("message"), str):
            return {"kind": "invalid", "reason": "error needs a numeric code and a message"}
        err = {"code": e["code"], "message": e["message"]}
        if "data" in e:
            err["data"] = e["data"]
        return {"kind": "error", "id": raw["id"] if _is_id(raw.get("id")) else None, "error": err}
    if "result" in raw:
        if _is_id(raw.get("id")):
            return {"kind": "result", "id": raw["id"], "result": raw["result"]}
        return {"kind": "invalid", "reason": "result needs an id"}
    return {"kind": "invalid", "reason": "neither a request, a notification nor a response"}


def parse_messages(text: str) -> list[dict]:
    try:
        raw = json.loads(text)
    except ValueError:
        return [{"kind": "invalid", "reason": "not valid JSON"}]
    if isinstance(raw, list):
        return [parse_message(m) for m in raw] if raw else [{"kind": "invalid", "reason": "empty batch"}]
    return [parse_message(raw)]


# ---------------------------------------------------------------- Server-Sent Events

_LINE = re.compile(r"\r\n|\r|\n")


class SseParser:
    """Incremental SSE parser: event/data/id/retry, comments, CRLF/CR/LF, blank line dispatches; end() flushes."""

    def __init__(self) -> None:
        self.buf = ""
        self.event = ""
        self.data: list[str] = []
        self.id: str | None = None
        self.retry: int | None = None

    def feed(self, chunk: str) -> list[dict]:
        self.buf += chunk
        out: list[dict] = []
        while True:
            m = _LINE.search(self.buf)
            if not m:
                break
            line, self.buf = self.buf[: m.start()], self.buf[m.end():]
            ev = self._line(line)
            if ev:
                out.append(ev)
        return out

    def end(self) -> list[dict]:
        out: list[dict] = []
        if self.buf:
            ev = self._line(self.buf)
            self.buf = ""
            if ev:
                out.append(ev)
        last = self._dispatch()
        if last:
            out.append(last)
        return out

    def _line(self, line: str) -> dict | None:
        if line == "":
            return self._dispatch()
        if line.startswith(":"):
            return None
        i = line.find(":")
        field_, value = (line, "") if i < 0 else (line[:i], line[i + 1:])
        if value.startswith(" "):
            value = value[1:]
        if field_ == "event":
            self.event = value
        elif field_ == "data":
            self.data.append(value)
        elif field_ == "id":
            if "\0" not in value:
                self.id = value
        elif field_ == "retry":
            if value.isdigit():
                self.retry = int(value)
        return None

    def _dispatch(self) -> dict | None:
        if not self.data:
            self.event = ""
            return None
        ev: dict[str, Any] = {"event": self.event or "message", "data": "\n".join(self.data)}
        if self.id is not None:
            ev["id"] = self.id
        if self.retry is not None:
            ev["retry"] = self.retry
        self.event, self.data, self.retry = "", [], None
        return ev


def parse_sse(text: str) -> list[dict]:
    p = SseParser()
    return p.feed(text) + p.end()


# ---------------------------------------------------------------- Streamable HTTP rules


def mcp_headers(session_id: str | None = None, protocol_version: str | None = None, method: str = "POST") -> dict[str, str]:
    h = {"accept": "text/event-stream" if method == "GET" else "application/json, text/event-stream"}
    if method == "POST":
        h["content-type"] = "application/json"
    if session_id:
        h[MCP_SESSION_HEADER] = session_id
    if protocol_version:
        h[MCP_VERSION_HEADER] = protocol_version
    return h


def initialize_params(client: dict | None = None, protocol_version: str = MCP_PROTOCOL_VERSION) -> dict:
    c = client or MCP_CLIENT_INFO
    info: dict[str, Any] = {"name": c["name"], "version": c["version"]}
    if c.get("title"):
        info["title"] = c["title"]
    return {"protocolVersion": protocol_version, "capabilities": {}, "clientInfo": info}


def negotiate(result: Any) -> dict:
    if not isinstance(result, dict):
        return {"ok": False, "error": wire(INVALID, "initialize returned no result object")}
    v = result.get("protocolVersion") if isinstance(result.get("protocolVersion"), str) else ""
    if v not in MCP_SUPPORTED_VERSIONS:
        return {"ok": False, "error": wire(INVALID, f"server protocol version {v or '(none)'} is not supported (client speaks {', '.join(MCP_SUPPORTED_VERSIONS)})")}
    si = result.get("serverInfo") if isinstance(result.get("serverInfo"), dict) else None
    server_info = None
    if si and isinstance(si.get("name"), str):
        server_info = {"name": si["name"], "version": si["version"] if isinstance(si.get("version"), str) else ""}
        if isinstance(si.get("title"), str):
            server_info["title"] = si["title"]
    caps = result.get("capabilities") if isinstance(result.get("capabilities"), dict) else {}
    return {"ok": True, "protocolVersion": v, "capabilities": caps, "serverInfo": server_info, "instructions": result.get("instructions") if isinstance(result.get("instructions"), str) else ""}


def offers(capabilities: dict | None, cap: str) -> bool:
    return bool(capabilities) and cap in capabilities and capabilities[cap] is not None and capabilities[cap] is not False


def classify_response(status: int, content_type: str | None, had_session: bool) -> str:
    if status == 202:
        return "accepted"
    if status == 404 and had_session:
        return "expired"
    if status < 200 or status >= 300:
        return "error"
    ct = (content_type or "").lower()
    if ct.startswith("text/event-stream"):
        return "sse"
    if ct.startswith("application/json") or ct == "":
        return "json"
    return "error"


# ---------------------------------------------------------------- pagination


def page_params(cursor: str | None) -> dict | None:
    return {"cursor": cursor} if cursor else None


def merge_pages(pages: list[dict], max_pages: int = 100) -> dict:
    items: list = []
    cursors: list[str] = []
    seen: set[str] = set()
    truncated = loop = False
    for p in pages:
        items.extend(p.get("items", []))
        nxt = p.get("nextCursor") or None
        if not nxt:
            break
        if nxt in seen:
            loop = True
            break
        if len(cursors) + 1 >= max_pages:
            truncated = True
            break
        seen.add(nxt)
        cursors.append(nxt)
    return {"items": items, "cursors": cursors, "truncated": truncated, "loop": loop}


# ---------------------------------------------------------------- errors


def wire(code: str, message: str, details: dict | None = None) -> dict:
    e: dict[str, Any] = {"code": code, "message": message, "retryable": code == UNAVAILABLE}
    if details:
        e["details"] = details
    return e


_RPC_MAP = {-32700: INVALID, -32600: INVALID, -32601: NOT_FOUND, -32602: VALIDATION, -32603: UNEXPECTED, -32002: NOT_FOUND, -32001: TIMEOUT, -32800: CANCELLED}


def error_from_rpc(e: dict) -> dict:
    code = e.get("code", 0)
    return wire(_RPC_MAP.get(code, UNEXPECTED), e.get("message") or f"JSON-RPC error {code}", {"rpc": str(code)})


def error_from_http(status: int, status_text: str = "") -> dict:
    d = {"http": str(status)}
    txt = f" {status_text}" if status_text else ""
    if status in (401, 403):
        return wire(DENIED, f"HTTP {status}{txt}: the server refused the credentials", d)
    if status == 404:
        return wire(NOT_FOUND, f"HTTP 404{txt}: no MCP endpoint at that URL", d)
    if status == 405:
        return wire(NOT_IMPLEMENTED, f"HTTP 405{txt}: the server does not offer that transport method", d)
    if status in (408, 504):
        return wire(TIMEOUT, f"HTTP {status}{txt}", d)
    if status in (429, 502, 503):
        return wire(UNAVAILABLE, f"HTTP {status}{txt}: try again later", d)
    if status >= 500:
        return wire(UNAVAILABLE, f"HTTP {status}{txt}", d)
    if status >= 400:
        return wire(INVALID, f"HTTP {status}{txt}", d)
    if status >= 300:
        return wire(INVALID, f"HTTP {status}{txt}: redirects are not followed (a credential must never travel to another address)", d)
    return wire(UNEXPECTED, f"HTTP {status}{txt}", d)


def error_from_transport(kind: str, message: str) -> dict:
    return wire({"timeout": TIMEOUT, "cancelled": CANCELLED, "network": UNAVAILABLE}.get(kind, INVALID), message)


# ---------------------------------------------------------------- tools: effects and the call gate


def tool_effect(annotations: dict | None, strict: bool = False) -> str:
    a = annotations or {}
    if a.get("readOnlyHint") is True:
        return "read"
    if a.get("destructiveHint") is True:
        return "destructive"
    if a.get("destructiveHint") is False:
        return "write"
    return "destructive" if strict else "write"


def has_permission(granted: Iterable[str], perm: str) -> bool:
    g = set(granted)
    if "*" in g or perm in g:
        return True
    parts = perm.split(".")
    for i in range(len(parts) - 1, 0, -1):
        if ".".join(parts[:i]) + ".*" in g:
            return True
    return False


def call_gate(effect: str, granted: Iterable[str], perms: dict | None = None) -> dict:
    """The outbound gate; `perms` maps the four permissions onto the app's own policy (default MCP_PERMISSIONS)."""
    p = perms or MCP_PERMISSIONS
    requires = p["CALL"] if effect == "read" else p["WRITE"] if effect == "write" else p["DESTRUCTIVE"]
    allowed = has_permission(granted, requires)
    gate: dict[str, Any] = {"allowed": allowed, "requires": requires, "confirm": effect == "destructive", "effect": effect}
    if not allowed:
        gate["error"] = wire(DENIED, f"Your role can't call {effect} tools (needs {requires})", {"permission": requires})
    return gate


# ---------------------------------------------------------------- tool results, server records


def content_text(content: list[dict] | None) -> str:
    out = []
    for c in content or []:
        t = c.get("type")
        if t == "text":
            out.append(c.get("text") or "")
        elif t == "resource":
            r = c.get("resource") or {}
            body = r.get("text")
            if body is None:
                body = f"(binary resource, {len(r['blob'])} base64 chars)" if r.get("blob") else "(binary resource)"
            out.append(f"{r.get('uri') or ''}\n{body}")
        elif t == "resource_link":
            out.append(f"{c.get('uri') or ''}{(' (' + c['mimeType'] + ')') if c.get('mimeType') else ''}")
        else:
            out.append(f"{t}{(' (' + c['mimeType'] + ')') if c.get('mimeType') else ''}{(': ' + c['uri']) if c.get('uri') else ''}{(' · ' + str(len(c['data'])) + ' base64 chars') if c.get('data') else ''}")
    return "\n\n".join(out)


MCP_SERVER_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
MCP_ENV_NAME_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,63}$")


def server_id_for(name: str, taken: Iterable[str] = ()) -> str:
    base = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")[:48] or "server"
    used = set(taken)
    sid, n = base, 2
    while sid in used:
        sid = f"{base}-{n}"
        n += 1
    return sid


_URL = re.compile(r"^(https?)://([^/?#\s]+)", re.I)


def validate_server_input(s: dict) -> list[str]:
    out: list[str] = []
    name = (s.get("name") or "").strip()
    if not name:
        out.append("name is required")
    elif len(name) > 80:
        out.append("name is too long (80 characters)")
    url = (s.get("url") or "").strip()
    if not url:
        out.append("url is required")
    elif len(url) > 500:
        out.append("url is too long (500 characters)")
    elif not _URL.match(url):
        out.append("url must be an http(s) URL of a Streamable HTTP MCP endpoint, e.g. https://example.com/mcp")
    if s.get("id") and not MCP_SERVER_ID_RE.match(s["id"]):
        out.append("id must be lowercase letters, digits and dashes")
    if s.get("tokenEnv") and not MCP_ENV_NAME_RE.match(s["tokenEnv"]):
        out.append("tokenEnv must be an environment variable name like AXHUB_TOKEN")
    return out


def argument_skeleton(schema: dict | None) -> dict:
    out: dict[str, Any] = {}
    props = (schema or {}).get("properties") or {}
    required = (schema or {}).get("required") or []
    for k, p in props.items():
        if "default" in p:
            out[k] = p["default"]
        elif k in required:
            t = p.get("type")
            t = t[0] if isinstance(t, list) else t
            enum = p.get("enum")
            out[k] = enum[0] if enum else 0 if t in ("number", "integer") else False if t == "boolean" else [] if t == "array" else {} if t == "object" else ""
    return out


@dataclass
class McpWireError(Exception):
    """Raised by the client; `error` is the wire error dict (stable codes)."""
    error: dict = field(default_factory=dict)

    @property
    def code(self) -> str:
        return self.error.get("code", UNEXPECTED)

    def __str__(self) -> str:
        return self.error.get("message", "MCP error")
