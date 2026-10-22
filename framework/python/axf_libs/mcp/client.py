"""MCP protocol client over Streamable HTTP — Python port of framework/libs/mcp/client.ts (stdlib urllib, synchronous).

The client asks a `Transport` to perform each request; the default `UrllibTransport` takes a credential provider
(server id → Authorization header value) so the client itself never holds a token. Same method order and error
codes as the TS and Kotlin clients: initialize (version negotiation, session id), lists with pagination, tools/call
(JSON or SSE reply), resources/read, prompts/get, a forgotten session (404) re-initializes once, DELETE on close.
"""
from __future__ import annotations

import json
import socket
import ssl
import threading
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Iterator, Protocol

from . import engine as E


@dataclass
class TransportResponse:
    status: int
    headers: dict[str, str]
    body: bytes | None = None
    stream: Iterator[bytes] | None = None
    status_text: str = ""

    def text(self) -> str:
        if self.body is not None:
            return self.body.decode("utf-8", "replace")
        return b"".join(self.stream or []).decode("utf-8", "replace")

    def chunks(self) -> Iterator[str]:
        if self.stream is None:
            yield self.text()
            return
        for b in self.stream:
            yield b.decode("utf-8", "replace")


class Transport(Protocol):
    def request(self, server_id: str, url: str, method: str, headers: dict[str, str], body: str | None, timeout: float) -> TransportResponse: ...


CredentialProvider = Callable[[str], str | None]
"""server id → Authorization header value (e.g. "Bearer …") or None."""


class UrllibTransport:
    """stdlib transport; redirects are not followed (a token must never travel to another host)."""

    def __init__(self, credentials: CredentialProvider | None = None, context: ssl.SSLContext | None = None) -> None:
        self.credentials = credentials
        self.opener = urllib.request.build_opener(_NoRedirect(), urllib.request.HTTPSHandler(context=context) if context else urllib.request.HTTPSHandler())

    def request(self, server_id: str, url: str, method: str, headers: dict[str, str], body: str | None, timeout: float) -> TransportResponse:
        h = dict(headers)
        auth = self.credentials(server_id) if self.credentials else None
        if auth:
            h["Authorization"] = auth
        req = urllib.request.Request(url, data=body.encode("utf-8") if body is not None else None, method=method, headers=h)
        try:
            resp = self.opener.open(req, timeout=timeout)
        except urllib.error.HTTPError as e:
            data = e.read() if hasattr(e, "read") else b""
            return TransportResponse(e.code, {k.lower(): v for k, v in (e.headers or {}).items()}, data, status_text=e.reason if isinstance(e.reason, str) else "")
        except socket.timeout as e:
            raise TimeoutError(str(e) or "timeout") from e
        except urllib.error.URLError as e:
            if isinstance(e.reason, socket.timeout):
                raise TimeoutError(str(e.reason) or "timeout") from e
            raise ConnectionError(str(e.reason)) from e
        headers_out = {k.lower(): v for k, v in resp.headers.items()}
        if headers_out.get("content-type", "").lower().startswith("text/event-stream"):
            def stream() -> Iterator[bytes]:
                with resp:
                    while True:
                        line = resp.readline()
                        if not line:
                            break
                        yield line
            return TransportResponse(resp.status, headers_out, None, stream(), getattr(resp, "reason", "") or "")
        with resp:
            return TransportResponse(resp.status, headers_out, resp.read(), status_text=getattr(resp, "reason", "") or "")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D102
        return None


@dataclass
class SessionInfo:
    protocol_version: str
    session_id: str | None
    capabilities: dict
    server_info: dict | None
    instructions: str


@dataclass
class Connected:
    session: SessionInfo
    tools: list[dict] = field(default_factory=list)
    resources: list[dict] = field(default_factory=list)
    resource_templates: list[dict] = field(default_factory=list)
    prompts: list[dict] = field(default_factory=list)
    resources_error: str | None = None
    prompts_error: str | None = None


class McpClient:
    """One session with one server. Thread-safe for one call at a time; `cancel(id)` aborts from another thread."""

    def __init__(self, server_id: str, url: str, transport: Transport, timeout: float = E.MCP_DEFAULT_TIMEOUT_S,
                 on_notification: Callable[[str, dict], None] | None = None, on_call: Callable[[str, bool, int, str], None] | None = None,
                 now: Callable[[], float] | None = None) -> None:
        import time
        self.server_id, self.url, self.transport, self.timeout = server_id, url, transport, timeout
        self.on_notification, self.on_call = on_notification, on_call
        self._now = now or time.monotonic
        self._next_id = 1
        self.session_id: str | None = None
        self.protocol_version: str | None = None
        self.info: SessionInfo | None = None
        self._cancelled: set[int | str] = set()
        self._lock = threading.Lock()

    @property
    def connected(self) -> bool:
        return self.info is not None

    # ---------- lifecycle

    def initialize(self) -> SessionInfo:
        if self.info:
            return self.info
        self.session_id = self.protocol_version = None
        result, sid = self._exchange("initialize", E.initialize_params(), with_session=False)
        n = E.negotiate(result)
        if not n["ok"]:
            raise E.McpWireError(n["error"])
        self.protocol_version, self.session_id = n["protocolVersion"], sid
        self.info = SessionInfo(n["protocolVersion"], sid, n["capabilities"], n["serverInfo"], n["instructions"])
        self._notify("notifications/initialized")
        return self.info

    def close(self) -> None:
        sid = self.session_id
        self.info = self.session_id = None
        pv, self.protocol_version = self.protocol_version, None
        if not sid:
            return
        try:
            self.transport.request(self.server_id, self.url, "DELETE", E.mcp_headers(sid, pv or E.MCP_PROTOCOL_VERSION, "DELETE"), None, self.timeout)
        except Exception:  # noqa: BLE001 — a server without DELETE answers 405; the session is gone for us either way
            pass

    def cancel(self, request_id: int | str, reason: str = "cancelled by the user") -> None:
        self._cancelled.add(request_id)
        try:
            self._notify("notifications/cancelled", {"requestId": request_id, "reason": reason})
        except Exception:  # noqa: BLE001
            pass

    # ---------- MCP methods

    def list_tools(self) -> dict:
        return self._list_all("tools/list", "tools")

    def list_resources(self) -> dict:
        return self._list_all("resources/list", "resources")

    def list_resource_templates(self) -> dict:
        return self._list_all("resources/templates/list", "resourceTemplates")

    def list_prompts(self) -> dict:
        return self._list_all("prompts/list", "prompts")

    def call_tool(self, name: str, arguments: dict | None = None) -> dict:
        r = self._request("tools/call", {"name": name, "arguments": arguments or {}}, op=f"call {name}")
        o = r if isinstance(r, dict) else {}
        out: dict[str, Any] = {"isError": o.get("isError") is True, "content": o.get("content") if isinstance(o.get("content"), list) else []}
        if "structuredContent" in o:
            out["structured"] = o["structuredContent"]
        return out

    def read_resource(self, uri: str) -> list[dict]:
        r = self._request("resources/read", {"uri": uri}, op=f"read {uri}")
        return r.get("contents", []) if isinstance(r, dict) and isinstance(r.get("contents"), list) else []

    def get_prompt(self, name: str, arguments: dict | None = None) -> dict:
        r = self._request("prompts/get", {"name": name, "arguments": arguments or {}}, op=f"prompt {name}")
        o = r if isinstance(r, dict) else {}
        out: dict[str, Any] = {"messages": o.get("messages") if isinstance(o.get("messages"), list) else []}
        if isinstance(o.get("description"), str):
            out["description"] = o["description"]
        return out

    def ping(self) -> None:
        self._request("ping", None, op="ping")

    def connect(self) -> Connected:
        s = self.initialize()
        out = Connected(s)
        if E.offers(s.capabilities, "tools"):
            out.tools = self.list_tools()["items"]
        if E.offers(s.capabilities, "resources"):
            try:
                out.resources = self.list_resources()["items"]
            except E.McpWireError as e:
                out.resources_error = str(e)
            try:
                out.resource_templates = self.list_resource_templates()["items"]
            except E.McpWireError:
                pass
        if E.offers(s.capabilities, "prompts"):
            try:
                out.prompts = self.list_prompts()["items"]
            except E.McpWireError as e:
                out.prompts_error = str(e)
        return out

    # ---------- plumbing

    def _list_all(self, method: str, key: str) -> dict:
        pages: list[dict] = []
        cursor: str | None = None
        seen: set[str] = set()
        for _ in range(100):
            r = self._request(method, E.page_params(cursor), op=method)
            o = r if isinstance(r, dict) else {}
            nxt = o.get("nextCursor") if isinstance(o.get("nextCursor"), str) and o.get("nextCursor") else None
            pages.append({"items": o.get(key) if isinstance(o.get(key), list) else [], "nextCursor": nxt})
            if not nxt or nxt in seen:
                break
            seen.add(nxt)
            cursor = nxt
        m = E.merge_pages(pages)
        return {"items": m["items"], "truncated": m["truncated"] or m["loop"]}

    def _request(self, method: str, params: dict | None, op: str) -> Any:
        self.initialize()
        try:
            return self._exchange(method, params, True, op)[0]
        except E.McpWireError as e:
            if e.error.get("details", {}).get("session") == "expired":
                self.info = self.session_id = None
                self.initialize()
                return self._exchange(method, params, True, op)[0]
            raise

    def _headers(self) -> dict[str, str]:
        return E.mcp_headers(self.session_id, self.protocol_version)

    def _notify(self, method: str, params: dict | None = None) -> None:
        res = self.transport.request(self.server_id, self.url, "POST", self._headers(), json.dumps(E.rpc_notification(method, params)), self.timeout)
        if E.classify_response(res.status, res.headers.get("content-type"), bool(self.session_id)) == "error":
            raise E.McpWireError(E.error_from_http(res.status, res.status_text))

    def _exchange(self, method: str, params: dict | None, with_session: bool, op: str | None = None) -> tuple[Any, str | None]:
        with self._lock:
            rid = self._next_id
            self._next_id += 1
        started = self._now()
        op = op or method

        def done(ok: bool, detail: str = "") -> None:
            if self.on_call:
                self.on_call(op, ok, int(max(0.0, self._now() - started) * 1000), detail)

        try:
            try:
                res = self.transport.request(self.server_id, self.url, "POST", self._headers() if with_session else E.mcp_headers(), json.dumps(E.rpc_request(rid, method, params)), self.timeout)
            except TimeoutError as e:
                raise E.McpWireError(E.error_from_transport("timeout", f"no answer within {int(self.timeout * 1000)} ms")) from e
            except (ConnectionError, OSError) as e:
                raise E.McpWireError(E.error_from_transport("network", str(e) or type(e).__name__)) from e
            kind = E.classify_response(res.status, res.headers.get("content-type"), with_session and bool(self.session_id))
            if kind == "expired":
                raise E.McpWireError(E.wire(E.NOT_FOUND, "the server forgot this session", {"session": "expired"}))
            if kind == "error":
                raise E.McpWireError(E.wire(E.INVALID, f"unexpected content type {res.headers.get('content-type') or '(none)'} from the server") if 200 <= res.status < 300 else E.error_from_http(res.status, res.status_text))
            if kind == "accepted":
                raise E.McpWireError(E.wire(E.INVALID, "the server accepted the request but sent no response"))
            sid = res.headers.get(E.MCP_SESSION_HEADER) or self.session_id
            messages = E.parse_messages(res.text()) if kind == "json" else self._read_sse(res, rid)
            hit = self._pick(messages, rid)
            if rid in self._cancelled:
                self._cancelled.discard(rid)
                raise E.McpWireError(E.error_from_transport("cancelled", "cancelled"))
            if hit is None:
                raise E.McpWireError(E.wire(E.INVALID, "no response to the request in the server's reply"))
            if hit["kind"] == "error":
                raise E.McpWireError(E.error_from_rpc(hit["error"]))
            done(True)
            return hit["result"], sid
        except E.McpWireError as e:
            done(False, str(e))
            raise

    def _read_sse(self, res: TransportResponse, rid: int | str) -> list[dict]:
        parser = E.SseParser()
        out: list[dict] = []

        def take(events: list[dict]) -> bool:
            for ev in events:
                if ev["event"] != "message":
                    continue
                for m in E.parse_messages(ev["data"]):
                    if m["kind"] == "notification":
                        if self.on_notification:
                            self.on_notification(m["method"], m["params"])
                    elif m["kind"] != "request":
                        out.append(m)
                    if m["kind"] in ("result", "error") and m.get("id") == rid:
                        return True
            return False

        for chunk in res.chunks():
            if rid in self._cancelled:
                break
            if take(parser.feed(chunk)):
                return out
        take(parser.end())
        return out

    def _pick(self, messages: list[dict], rid: int | str) -> dict | None:
        for m in messages:
            if m["kind"] == "notification" and self.on_notification:
                self.on_notification(m["method"], m["params"])
            if m["kind"] in ("result", "error") and (m.get("id") == rid or (m["kind"] == "error" and m.get("id") is None)):
                return m
        return None
