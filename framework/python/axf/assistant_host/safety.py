"""Safety helpers for assistant and agent hosts: a bounded calculator and an SSRF-safe HTTP client
(framework/python, `axf.assistant_host.safety`; one copy for the console's ai-assistant + agent-manager plugins and
Build Pilot's server — reviewed independently, keep every guard).

calc(expr)          arithmetic only; AST size, exponent and result size are capped, each operand evaluated once
fetch(url, ...)     http(s) with the host resolved ONCE, the address checked (`is_global` unless allow_private) and the
                    connection pinned to that address (no DNS-rebinding window); redirects re-checked hop by hop;
                    a total deadline and a byte cap on the body.
"""
from __future__ import annotations

import ast
import http.client
import ipaddress
import operator
import socket
import ssl
import time
from typing import Any
from urllib.parse import urljoin, urlparse

# ---------------------------------------------------------------- calculator

_OPS = {ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul, ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv,
        ast.Mod: operator.mod, ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos}
MAX_BITS = 4096


def _check(v: Any) -> Any:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        raise ValueError("only numbers")
    if isinstance(v, int) and v.bit_length() > MAX_BITS:
        raise ValueError("result too large")
    if isinstance(v, float) and v != v:
        raise ValueError("not a number")
    return v


def calc(expr: str) -> str:
    tree = ast.parse(str(expr)[:300], mode="eval")
    if sum(1 for _ in ast.walk(tree)) > 120:
        raise ValueError("expression too long")

    def ev(n: ast.AST) -> Any:
        if isinstance(n, ast.Expression):
            return ev(n.body)
        if isinstance(n, ast.Constant) and isinstance(n.value, (int, float)) and not isinstance(n.value, bool):
            return _check(n.value)
        if isinstance(n, ast.UnaryOp) and type(n.op) in _OPS:
            return _check(_OPS[type(n.op)](ev(n.operand)))
        if isinstance(n, ast.BinOp) and type(n.op) in _OPS:
            left, right = ev(n.left), ev(n.right)  # each side exactly once
            if isinstance(n.op, ast.Pow):
                if abs(right) > 10_000:
                    raise ValueError("exponent too large")
                if isinstance(left, int) and isinstance(right, int) and right > 0 and abs(left) > 1 and abs(left).bit_length() * right > MAX_BITS:
                    raise ValueError("result too large")
            if isinstance(n.op, (ast.Mult,)) and isinstance(left, int) and isinstance(right, int) and left.bit_length() + right.bit_length() > MAX_BITS:
                raise ValueError("result too large")
            try:
                return _check(_OPS[type(n.op)](left, right))
            except (OverflowError, ZeroDivisionError) as e:
                raise ValueError(str(e)) from None
        raise ValueError("only numbers and arithmetic operators are allowed")
    return str(ev(tree))


# ---------------------------------------------------------------- SSRF-safe fetch

USER_AGENT = "AmberX-AXF/1"  # a host may set its own

def _resolve(host: str, port: int, allow_private: bool) -> str:
    infos = socket.getaddrinfo(host, port, type=socket.SOCK_STREAM)
    for info in infos:
        ip = ipaddress.ip_address(info[4][0])
        if allow_private or ip.is_global:
            return str(ip)
    raise ValueError("that address is not public")


class _PinnedHTTPS(http.client.HTTPSConnection):
    def __init__(self, host: str, ip: str, port: int, timeout: float):
        super().__init__(host, port, timeout=timeout, context=ssl.create_default_context())
        self._ip = ip

    def connect(self) -> None:
        sock = socket.create_connection((self._ip, self.port), self.timeout)
        self.sock = self._context.wrap_socket(sock, server_hostname=self.host)  # SNI + cert check against the name


class _PinnedHTTP(http.client.HTTPConnection):
    def __init__(self, host: str, ip: str, port: int, timeout: float):
        super().__init__(host, port, timeout=timeout)
        self._ip = ip

    def connect(self) -> None:
        self.sock = socket.create_connection((self._ip, self.port), self.timeout)


def fetch(url: str, method: str = "GET", headers: dict[str, str] | None = None, body: bytes | None = None, *, allow_private: bool = False,
          timeout: float = 20, deadline: float = 60, max_bytes: int = 2_000_000, redirects: int = 5) -> tuple[int, str, str]:
    """Returns (status, content-type, text)."""
    end = time.monotonic() + deadline
    for _hop in range(redirects + 1):
        u = urlparse(url)
        if u.scheme not in ("http", "https") or not u.hostname:
            raise ValueError("only http(s) URLs")
        port = u.port or (443 if u.scheme == "https" else 80)
        ip = _resolve(u.hostname, port, allow_private)
        cls = _PinnedHTTPS if u.scheme == "https" else _PinnedHTTP
        conn = cls(u.hostname, ip, port, timeout=min(timeout, max(1.0, end - time.monotonic())))
        path = (u.path or "/") + (f"?{u.query}" if u.query else "")
        h = {"user-agent": USER_AGENT, "accept-encoding": "identity", **(headers or {})}
        try:
            conn.request(method.upper(), path, body=body, headers=h)
            r = conn.getresponse()
            if r.status in (301, 302, 303, 307, 308) and r.getheader("location"):
                url = urljoin(url, r.getheader("location") or "")
                if r.status == 303:
                    method, body = "GET", None
                conn.close()
                continue
            chunks: list[bytes] = []
            size = 0
            while size < max_bytes:
                if time.monotonic() > end:
                    raise ValueError("the page took too long")
                c = r.read(min(65536, max_bytes - size))
                if not c:
                    break
                chunks.append(c)
                size += len(c)
            ctype = r.getheader("content-type") or ""
            charset = "utf-8"
            if "charset=" in ctype:
                charset = ctype.split("charset=", 1)[1].split(";")[0].strip() or "utf-8"
            try:
                text = b"".join(chunks).decode(charset, "replace")
            except LookupError:
                text = b"".join(chunks).decode("utf-8", "replace")
            return r.status, ctype, text
        finally:
            conn.close()
    raise ValueError("too many redirects")
