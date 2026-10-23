"""The Dev Console's token and its API, for servers (the console itself, Build Pilot, any AXF app server).

Token file — the console's env file (`.axf-console/env`, written by install-console.sh and by a token reset) holds an
`AXF_TOKEN=<token>` line among others; Build Pilot gets a copy holding just the token. `TokenFile` reads either,
re-reading only when the file's mtime changes, and falls back to a fixed value (an env var) when the file is missing:

    tok = TokenFile(path, fallback=os.environ.get("AXF_TOKEN", ""))
    tok()                    # the current token ("" when none)
    tok.write(new)           # replace the AXF_TOKEN line (other lines kept), atomically, 0600

Client — server-to-server calls to the console API, token as a Bearer header, never following a redirect (a redirect
means the sign-in wall answered; the token must not follow it), JSON in and out, readable errors:

    console = ConsoleClient("http://axf-console:7090", token=lambda: os.environ.get("BP_CONSOLE_TOKEN") or tok(),
                            token_hint="BP_CONSOLE_TOKEN")
    console.call("GET", "/api/libraries")         # parsed JSON, or ConsoleError
    console.raw("/api/apps/apk/file?dir=apps/x")  # bytes (an APK), size-capped
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

from . import http, storage

__all__ = ["TOKEN_KEY", "TokenFile", "read_token_text", "ConsoleClient", "ConsoleError"]

TOKEN_KEY = "AXF_TOKEN"


def read_token_text(text: str, key: str = TOKEN_KEY, allow_bare: bool = True) -> str:
    """The token in an env file's text: the last non-empty `KEY=` line (quotes stripped), or, with `allow_bare`, for
    a one-line file without any `=`, the whole text (a file holding just the token)."""
    found = ""
    for line in text.splitlines():
        if line.startswith(f"{key}="):
            v = line.split("=", 1)[1].strip().strip('"').strip("'")
            if v:
                found = v
    if found:
        return found
    if allow_bare and "=" not in text and text.strip() and "\n" not in text.strip():
        return text.strip()
    return ""


class TokenFile:
    def __init__(self, path: str | os.PathLike[str] | None, fallback: str | Callable[[], str] = "", key: str = TOKEN_KEY,
                 allow_bare: bool = True) -> None:
        self.path = Path(path) if path else None
        self.key = key
        self.allow_bare = allow_bare
        self._fallback = fallback
        self._lock = threading.Lock()
        self._mtime: int | None = None
        self._value: str | None = None

    def fallback(self) -> str:
        return self._fallback() if callable(self._fallback) else self._fallback

    def __call__(self) -> str:
        """The token: the file's (re-read when its mtime changes), else the fallback. Once a token was read it stays
        in force while the file is missing or holds none (a reset token must not fall back to the old env value)."""
        if not self.path:
            return self.fallback()
        with self._lock:
            try:
                m = self.path.stat().st_mtime_ns
            except OSError:
                return self._value or self.fallback()
            if m != self._mtime:
                try:
                    self._value = read_token_text(self.path.read_text(), self.key, self.allow_bare) or self._value
                except OSError:
                    pass  # keep the last good value
                self._mtime = m
            return self._value or self.fallback()

    def write(self, new: str) -> None:
        """Replace the KEY line (first line), keep every other line, owner-only and atomic."""
        if not self.path:
            raise ValueError("no token file configured")
        if not new or any(c in new for c in "\r\n\0="):
            raise ValueError("not a token")
        text = storage.read_text(self.path)
        lines = [ln for ln in text.splitlines() if not ln.startswith(f"{self.key}=")]
        storage.write_text(self.path, "\n".join([f"{self.key}={new}", *lines]) + "\n")
        with self._lock:
            self._value, self._mtime = new, self.path.stat().st_mtime_ns


class ConsoleError(Exception):
    pass


class ConsoleClient:
    def __init__(self, base_url: str, token: Callable[[], str], *, timeout: float = 30.0, token_hint: str = "the console token",
                 allow_http_hosts: tuple[str, ...] | None = None, transport: http.Transport | None = None) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.token_hint = token_hint
        # Server to server on a Docker network is plain http to a container name: allow exactly that host.
        host = urlsplit(self.base_url).hostname or ""
        self.allow_http_hosts = allow_http_hosts if allow_http_hosts is not None else ((host,) if host else ())
        self.transport = transport

    def _req(self, method: str, path: str, body: Any, timeout: float | None, max_bytes: int, accept: str) -> http.Response:
        if not path.startswith("/api/") or "\\" in path or "/../" in path:
            raise ConsoleError("bad console path")
        headers = {"Accept": accept}
        tok = self.token()
        if tok:
            headers["Authorization"] = f"Bearer {tok}"
        try:
            return http.request(method, self.base_url + path, headers=headers, json_body=body, timeout=timeout or self.timeout,
                                max_bytes=max_bytes, redirects="never", allow_http_hosts=self.allow_http_hosts, transport=self.transport)
        except http.ResponseTooLarge:
            raise ConsoleError("file too large") from None
        except http.HttpError as e:
            raise ConsoleError(f"console not reachable: {e}") from None

    def _fail(self, r: http.Response) -> ConsoleError:
        detail = ""
        try:
            j = json.loads(r.body or b"{}")
            if isinstance(j, dict):
                detail = str(j.get("detail") or j.get("error") or "")
        except ValueError:
            pass
        if r.redirect:
            return ConsoleError(f"the console redirected (sign-in wall?): set {self.token_hint}")
        if r.status == 401:
            if not self.token():
                return ConsoleError(f"no console token ({self.token_hint}, or its token file is missing or unreadable)")
            return ConsoleError(f"the console refused the token ({self.token_hint})")
        return ConsoleError(f"console {r.status}: {detail or 'request failed'}")

    def call(self, method: str, path: str, body: Any = None, timeout: float | None = None, max_bytes: int = 8 * 1024 * 1024) -> Any:
        """Call the console API; parsed JSON or ConsoleError with a readable reason."""
        r = self._req(method, path, body, timeout, max_bytes, "application/json")
        if not r.ok:
            raise self._fail(r)
        try:
            return json.loads(r.body)
        except ValueError:
            raise ConsoleError("the console answered with something that isn't JSON (sign-in page?)") from None

    def raw(self, path: str, limit: int = 200 * 1024 * 1024, timeout: float | None = None) -> bytes:
        """GET a file from the console (e.g. an APK), at most `limit` bytes."""
        r = self._req("GET", path, None, timeout or self.timeout * 4, limit, "*/*")
        if not r.ok:
            raise self._fail(r)
        return r.body
