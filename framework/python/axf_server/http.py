"""Outbound HTTP for AXF servers (stdlib urllib, no third-party packages).

    from axf_server import http
    r = http.request("GET", "https://api.github.com/repos/x/y", headers={"Authorization": f"Bearer {tok}"})
    r.status, r.headers["content-type"], r.body, r.json(), r.text()
    data = http.get_json("https://…")                    # raises HttpStatusError on a non-2xx answer
    http.target_ok("http://127.0.0.1:8080/")             # True: plain http only to this machine

Rules (from the copies this replaced, the strictest of each):
  * **Targets:** https anywhere; plain http only to loopback (127.0.0.1, localhost, [::1]) or to hosts the caller
    names in `allow_http_hosts` (a Docker-network service such as `axf-console`); every other scheme is refused
    (`TargetRefused`) before any connection, and so is a URL carrying user:password.
  * **Redirects:** `redirects="never"` (default): a 3xx is returned as the answer and never followed, so a token
    never travels to another host. `redirects="strip-auth"`: follow up to `max_redirects`; every hop must pass the
    target rules, and credential headers (Authorization, Cookie, Proxy-Authorization, X-Api-Key, and the caller's
    `secret_headers`) are dropped unless the new URL's origin is in `auth_origins` (e.g. api.github.com → blob storage).
  * **Size:** the body is read up to `max_bytes`; more raises `ResponseTooLarge` (or is cut with `truncate=True`).
    Error answers (4xx/5xx) keep at most 64 KB.
  * **Timeouts:** every call has one (default 30 s).
  * 4xx/5xx are answers, not exceptions (`Response.ok`, `raise_for_status()`); network trouble raises `HttpError`.
  * A `transport` callable can replace the network in tests: (Request) → Response.

Extension point — `HttpClient` keeps a base URL, default headers and a credential provider; `axf_server.github`
(lib-github) subclasses it as `GitHubClient` (token only to the API origin, no redirects on API calls, downloads
follow GitHub's redirect without credentials). Use that for GitHub rather than calling `request` with a token.
"""
from __future__ import annotations

import json
import socket
import urllib.error
import urllib.request
from dataclasses import dataclass, field
from typing import Any, Callable, Iterable, Mapping
from urllib.parse import urljoin, urlsplit

__all__ = ["HttpError", "TargetRefused", "ResponseTooLarge", "HttpStatusError", "Request", "Response", "Transport",
           "target_ok", "origin_of", "request", "get_json", "post_json", "HttpClient", "LOOPBACK_HOSTS",
           "CREDENTIAL_HEADERS", "DEFAULT_TIMEOUT", "DEFAULT_MAX_BYTES"]

DEFAULT_TIMEOUT = 30.0
DEFAULT_MAX_BYTES = 8 * 1024 * 1024
ERROR_BODY_MAX = 64 * 1024
LOOPBACK_HOSTS = frozenset({"127.0.0.1", "localhost", "::1"})
CREDENTIAL_HEADERS = frozenset({"authorization", "proxy-authorization", "cookie", "x-api-key"})
REDIRECT_CODES = frozenset({301, 302, 303, 307, 308})


class HttpError(Exception):
    """The request could not be made or finished (network, TLS, timeout, refused target, body too large)."""


class TargetRefused(HttpError):
    pass


class ResponseTooLarge(HttpError):
    pass


class HttpStatusError(HttpError):
    def __init__(self, response: "Response") -> None:
        self.response = response
        self.status = response.status
        super().__init__(f"HTTP {response.status}")


@dataclass
class Request:
    method: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    body: bytes | None = None
    timeout: float = DEFAULT_TIMEOUT
    max_bytes: int = DEFAULT_MAX_BYTES
    truncate: bool = False


@dataclass
class Response:
    status: int
    headers: dict[str, str]
    body: bytes
    url: str

    @property
    def ok(self) -> bool:
        return 200 <= self.status < 300

    @property
    def redirect(self) -> bool:
        return self.status in REDIRECT_CODES

    def text(self, encoding: str = "utf-8") -> str:
        return self.body.decode(encoding, "replace")

    def json(self) -> Any:
        """The body as JSON (ValueError when it isn't); an empty body is None."""
        return json.loads(self.body) if self.body.strip() else None

    def raise_for_status(self) -> "Response":
        if not self.ok:
            raise HttpStatusError(self)
        return self


Transport = Callable[[Request], Response]


def _host_of(url: str) -> tuple[str, str]:
    u = urlsplit(url)
    return u.scheme.lower(), (u.hostname or "").lower()


def target_ok(url: str, allow_http_hosts: Iterable[str] = ()) -> bool:
    """https to any host; http only to loopback or a host in `allow_http_hosts`; nothing else (no file:, ftp:, …)."""
    if not isinstance(url, str) or any(c in url for c in "\r\n\t\0 "):
        return False
    try:
        u = urlsplit(url)
        u.port  # noqa: B018 — raises ValueError on a bad port
    except ValueError:
        return False
    scheme, host = u.scheme.lower(), (u.hostname or "").lower()
    if not host or u.username is not None or u.password is not None:
        return False
    if scheme == "https":
        return True
    if scheme == "http":
        return host in LOOPBACK_HOSTS or host in {h.lower() for h in allow_http_hosts}
    return False


def origin_of(url: str) -> str:
    u = urlsplit(url)
    port = u.port
    default = {"https": 443, "http": 80}.get(u.scheme.lower())
    host = (u.hostname or "").lower()
    if ":" in host:
        host = f"[{host}]"
    return f"{u.scheme.lower()}://{host}" + (f":{port}" if port and port != default else "")


class _NoFollow(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[no-untyped-def]
        return None  # urllib then raises HTTPError with the 3xx, which becomes the answer


_OPENER = urllib.request.build_opener(_NoFollow)


def _read(fp: Any, limit: int, truncate: bool) -> bytes:
    data: bytes = fp.read(limit + 1)
    if len(data) > limit:
        if not truncate:
            raise ResponseTooLarge(f"response larger than {limit} bytes")
        data = data[:limit]
    return data


def urllib_transport(req: Request) -> Response:
    """One request, one answer: never follows a redirect (the caller decides)."""
    r = urllib.request.Request(req.url, data=req.body, method=req.method.upper(), headers=req.headers)
    try:
        with _OPENER.open(r, timeout=req.timeout) as fp:
            return Response(fp.status, {k.lower(): v for k, v in fp.headers.items()}, _read(fp, req.max_bytes, req.truncate), req.url)
    except urllib.error.HTTPError as e:
        hdrs = {k.lower(): v for k, v in (e.headers or {}).items()}
        try:
            body = e.read(min(req.max_bytes, ERROR_BODY_MAX)) or b""
        except Exception:  # noqa: BLE001 — an unreadable error body is just empty
            body = b""
        return Response(e.code, hdrs, body, req.url)
    except (urllib.error.URLError, socket.timeout, TimeoutError, OSError, ValueError) as e:
        raise HttpError(str(getattr(e, "reason", e)) or type(e).__name__) from None


def request(method: str, url: str, *, headers: Mapping[str, str] | None = None, body: bytes | None = None,
            json_body: Any = None, timeout: float = DEFAULT_TIMEOUT, max_bytes: int = DEFAULT_MAX_BYTES,
            truncate: bool = False, redirects: str = "never", max_redirects: int = 5,
            auth_origins: Iterable[str] = (), secret_headers: Iterable[str] = (),
            allow_http_hosts: Iterable[str] = (), transport: Transport | None = None) -> Response:
    """Make one outbound request under the rules in the module docstring."""
    if redirects not in ("never", "strip-auth"):
        raise ValueError("redirects is 'never' or 'strip-auth'")
    allow = tuple(allow_http_hosts)
    hdrs = dict(headers or {})
    if json_body is not None:
        body = json.dumps(json_body).encode()
        if not any(k.lower() == "content-type" for k in hdrs):
            hdrs["Content-Type"] = "application/json"
    send = transport or urllib_transport
    secret = CREDENTIAL_HEADERS | {h.lower() for h in secret_headers}
    keep_auth = {o.rstrip("/").lower() for o in auth_origins}
    first_origin = origin_of(url) if target_ok(url, allow) else ""
    method = method.upper()
    for _hop in range(max_redirects + 1):
        if not target_ok(url, allow):
            raise TargetRefused(f"refused target: {url.split('?')[0][:120]} (https only; plain http only to this machine)")
        resp = send(Request(method, url, hdrs, body, timeout, max_bytes, truncate))
        if redirects == "never" or not resp.redirect or not resp.headers.get("location"):
            return resp
        nxt = urljoin(url, resp.headers["location"])
        if origin_of(nxt) != first_origin and origin_of(nxt) not in keep_auth:
            hdrs = {k: v for k, v in hdrs.items() if k.lower() not in secret}
        if resp.status == 303 or (resp.status in (301, 302) and method == "POST"):
            method, body = "GET", None
            hdrs = {k: v for k, v in hdrs.items() if k.lower() not in ("content-type", "content-length")}
        url = nxt
    raise HttpError("too many redirects")


def get_json(url: str, **kw: Any) -> Any:
    """GET and parse JSON; non-2xx raises HttpStatusError, a body that isn't JSON raises ValueError."""
    return request("GET", url, **{"headers": {"Accept": "application/json"}, **kw}).raise_for_status().json()


def post_json(url: str, data: Any, **kw: Any) -> Any:
    return request("POST", url, json_body=data, **kw).raise_for_status().json()


class HttpClient:
    """A base URL + default headers + a credential provider. Paths are joined to the base and must stay on its
    origin (an absolute URL elsewhere is refused unless `allow_other_origins`), so a value from an API answer can't
    point the client — and its token — at another host. Subclass it for an API (see the module docstring)."""

    def __init__(self, base_url: str, *, auth: Callable[[], str] | None = None, headers: Mapping[str, str] | None = None,
                 timeout: float = DEFAULT_TIMEOUT, max_bytes: int = DEFAULT_MAX_BYTES, redirects: str = "never",
                 auth_origins: Iterable[str] = (), allow_http_hosts: Iterable[str] = (), user_agent: str = "axf-server",
                 transport: Transport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.auth = auth
        self.headers = {"User-Agent": user_agent, **(headers or {})}
        self.timeout, self.max_bytes, self.redirects = timeout, max_bytes, redirects
        self.auth_origins = tuple(auth_origins)
        self.allow_http_hosts = tuple(allow_http_hosts)
        self.transport = transport

    def url(self, path: str, allow_other_origins: bool = False) -> str:
        full = path if "://" in path else f"{self.base_url}/{path.lstrip('/')}"
        if not allow_other_origins and origin_of(full) != origin_of(self.base_url):
            raise TargetRefused("a path on another host was refused")
        return full

    def request(self, method: str, path: str, *, headers: Mapping[str, str] | None = None, auth: bool = True,
                allow_other_origins: bool = False, **kw: Any) -> Response:
        hdrs = dict(self.headers)
        if auth and self.auth:
            cred = self.auth()
            if cred:
                hdrs["Authorization"] = cred
        hdrs.update(headers or {})
        opts: dict[str, Any] = {"timeout": self.timeout, "max_bytes": self.max_bytes, "redirects": self.redirects,
                                "auth_origins": self.auth_origins, "allow_http_hosts": self.allow_http_hosts,
                                "transport": self.transport, **kw}
        return request(method, self.url(path, allow_other_origins), headers=hdrs, **opts)

    def get_json(self, path: str, **kw: Any) -> Any:
        return self.request("GET", path, **kw).raise_for_status().json()

    def post_json(self, path: str, data: Any, **kw: Any) -> Any:
        return self.request("POST", path, json_body=data, **kw).raise_for_status().json()
