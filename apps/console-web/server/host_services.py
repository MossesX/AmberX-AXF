"""The console's client for the host services (host-service@1, framework/spec/HOST-SERVICES.md).

The console keeps the UI; the parts that must outlive the container (builds-live, shipped-features, hub-sync,
agent-swarm, systems-check, maintenance, the lander and the watchdogs) run on the VPS as systemd units behind
one host API. This module talks to it:

- over the unix socket ``/run/axf-host/api.sock`` (``AXF_HOST_API``; the socket's file mode is the auth: the console
  runs with the ``axf-host`` group), then over loopback (``AXF_HOST_API_FALLBACK``, default
  ``http://host.docker.internal:7788``, with ``AXF_HOST_TOKEN``), once each;
- caches the service list for a few seconds (the Host services view polls it, the systems check reads it every pass);
- turns every failure into a ``host-error@1`` frame: a transport failure on both endpoints is ``host_service_down``
  for ``host-api`` (the UI's "Host service down" state), a frame from the host passes through as is;
- is offered to plugins as capability ``axf.host-services@1`` (``plugin_services.get("axf.host-services@1")``), so a
  moved plugin asks its host service without importing this module by name.

Twin of the engine's ``resolveEndpoints`` / ``toHostError`` in framework/core/host-services.mjs (the REST answers,
MCP tool errors, CLI exit codes and voice lines all come from the same codes).
"""
from __future__ import annotations

import http.client
import json
import os
import socket
import threading
import time
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from fastapi import HTTPException

ROOT = Path(__file__).resolve().parents[3]
REGISTRY_FILE = ROOT / "framework" / "schemas" / "host-service.json"
CAPABILITY = "axf.host-services@1"
FOLDER = "host-services"
DEFAULT_SOCKET = "/run/axf-host/api.sock"
DEFAULT_FALLBACK = "http://host.docker.internal:7788"
HOST_API = "host-api"
CACHE_S = 5.0
ERROR_FRAME = "host-error@1"


def _registry() -> dict[str, Any]:
    try:
        return json.loads(REGISTRY_FILE.read_text())
    except Exception:  # noqa: BLE001 — the codes below are the fallback
        return {}


ERRORS: dict[str, dict[str, Any]] = _registry().get("errors") or {
    "host_service_down": {"http": 503, "console": "down"}, "unknown_service": {"http": 404, "console": "caller"},
    "unknown_action": {"http": 404, "console": "caller"}, "unknown_setting": {"http": 404, "console": "caller"},
    "invalid_body": {"http": 400, "console": "caller"}, "invalid_manifest": {"http": 500, "console": "caller"},
    "unauthorized": {"http": 401, "console": "caller"}, "confirm_required": {"http": 428, "console": "confirm"},
    "forbidden_command": {"http": 403, "console": "caller"}, "mode_refused": {"http": 409, "console": "caller"},
    "busy": {"http": 409, "console": "retry"}, "timeout": {"http": 504, "console": "retry"}, "internal": {"http": 500, "console": "retry"},
}


class HostServiceError(HTTPException):
    """A host-error@1 frame as an HTTP error: raise it from a route and the console answers with the host's status and frame."""

    def __init__(self, code: str, message: str, service: str = "", action: str = "", **extra: Any) -> None:
        self.code = code if code in ERRORS else "internal"
        self.message = message or self.code
        self.service = service
        self.action = action
        self.extra = {k: v for k, v in extra.items() if v not in (None, "")}
        super().__init__(status_code=int(ERRORS[self.code]["http"]), detail=self.frame())

    @property
    def down(self) -> bool:
        return ERRORS[self.code].get("console") == "down"

    def frame(self) -> dict[str, Any]:
        f: dict[str, Any] = {"$axf": ERROR_FRAME, "code": self.code, "message": self.message}
        if self.service:
            f["service"] = self.service
        if self.action:
            f["action"] = self.action
        f.update(self.extra)
        return f

    def voice(self) -> str:
        if self.down:
            who = "The host API" if self.service in ("", HOST_API) else f"The {self.service} service"
            return f"{who} is down. {self.message}"
        return self.message


# ------------------------------------------------------------------ endpoints

def endpoints(env: dict[str, str] | None = None) -> list[dict[str, str]]:
    """Ordered endpoints, as the engine's resolveEndpoints: socket first, loopback second; a blank value drops one."""
    e = os.environ if env is None else env
    out: list[dict[str, str]] = []
    for role, raw in (("primary", e.get("AXF_HOST_API", f"unix:{DEFAULT_SOCKET}")), ("fallback", e.get("AXF_HOST_API_FALLBACK", DEFAULT_FALLBACK))):
        v = (raw or "").strip()
        if not v:
            continue
        if v.startswith("unix:") or v.startswith("/"):
            p = v[5:] if v.startswith("unix:") else v
            p = p[2:] if p.startswith("//") else p
            ep = {"role": role, "kind": "socket", "path": p, "url": f"unix:{p}"}
        elif v.startswith("http://") or v.startswith("https://"):
            ep = {"role": role, "kind": "http", "url": v.rstrip("/")}
        else:
            continue
        if all(x["url"] != ep["url"] for x in out):
            out.append(ep)
    return out


class _UnixConnection(http.client.HTTPConnection):
    def __init__(self, path: str, timeout: float) -> None:
        super().__init__("localhost", timeout=timeout)
        self._path = path

    def connect(self) -> None:
        s = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        s.settimeout(self.timeout)
        s.connect(self._path)
        self.sock = s


# ------------------------------------------------------------------ client

class HostServices:
    """Capability axf.host-services@1: state, health, actions, settings, logs and mode of every host service."""

    version = 1

    def __init__(self, env: dict[str, str] | None = None) -> None:
        self._env = env
        self._lock = threading.Lock()
        self._cache: tuple[float, dict[str, Any]] | None = None
        self._last_good: dict[str, Any] | None = None
        self.down_since: float | None = None
        self.last_error: dict[str, Any] | None = None
        self.last_ok: float | None = None
        self.endpoint_used = ""

    # ---- transport
    def _token(self) -> str:
        e = os.environ if self._env is None else self._env
        return (e.get("AXF_HOST_TOKEN") or "").strip()

    def request(self, method: str, path: str, body: Any = None, timeout: float = 10.0) -> Any:
        """One call to the host API (path under /v1). Returns the parsed body or raises HostServiceError."""
        data = None if body is None else json.dumps(body).encode()
        headers = {"accept": "application/json", "content-type": "application/json"}
        tok = self._token()
        if tok:
            headers["authorization"] = f"Bearer {tok}"
        errors: list[str] = []
        for ep in endpoints(self._env):
            try:
                if ep["kind"] == "socket":
                    conn: http.client.HTTPConnection = _UnixConnection(ep["path"], timeout)
                else:
                    u = urlparse(ep["url"])
                    cls = http.client.HTTPSConnection if u.scheme == "https" else http.client.HTTPConnection
                    conn = cls(u.hostname or "localhost", u.port or (443 if u.scheme == "https" else 80), timeout=timeout)
                conn.request(method, f"/v1{path}", body=data, headers=headers)
                r = conn.getresponse()
                raw = r.read().decode("utf-8", "replace")
                status = r.status
                conn.close()
            except (OSError, http.client.HTTPException) as e:  # refused, missing socket, timeout, reset: next endpoint
                errors.append(f"{ep['url']}: {type(e).__name__}: {e}"[:200])
                continue
            self.endpoint_used = ep["url"]
            try:
                parsed: Any = json.loads(raw) if raw else {}
            except json.JSONDecodeError:
                parsed = raw
            self._mark_up()
            if 200 <= status < 300:
                return parsed
            raise self._error(status, parsed)
        err = HostServiceError("host_service_down", "the host API cannot be reached (" + "; ".join(errors or ["no endpoint configured"]) + ")", service=HOST_API)
        self._mark_down(err)
        raise err

    def _error(self, status: int, body: Any) -> HostServiceError:
        if isinstance(body, dict) and body.get("$axf") == ERROR_FRAME and body.get("code") in ERRORS:
            extra = {k: body[k] for k in ("unit", "retryAfterMs", "requestId") if k in body}
            return HostServiceError(body["code"], body.get("message") or body["code"], service=body.get("service", ""), action=body.get("action", ""), **extra)
        if status in (502, 503, 504):
            return HostServiceError("host_service_down", f"the host API answered {status} without a frame", service=HOST_API)
        if status in (401, 403):
            return HostServiceError("unauthorized", f"the host API refused the token ({status})", service=HOST_API)
        return HostServiceError("internal", f"the host API answered {status}", service=HOST_API)

    def _mark_up(self) -> None:
        self.down_since = None
        self.last_error = None
        self.last_ok = time.time()

    def _mark_down(self, err: HostServiceError) -> None:
        if self.down_since is None:
            self.down_since = time.time()
        self.last_error = err.frame()

    # ---- reads
    def health(self) -> dict[str, Any]:
        return self.request("GET", "/health", timeout=3)

    def services(self, fresh: bool = False) -> dict[str, Any]:
        """host-service-list@1. When the host API is down: the last list with every service `unknown`, plus `down`."""
        with self._lock:
            if not fresh and self._cache and time.time() - self._cache[0] < CACHE_S:
                return self._cache[1]
        try:
            v = self.request("GET", "/services")
            with self._lock:
                self._cache = (time.time(), v)
                self._last_good = v
            return v
        except HostServiceError as e:
            if not e.down:
                raise
            return self.unreachable(e)

    def unreachable(self, err: HostServiceError) -> dict[str, Any]:
        since = time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime(self.down_since or time.time()))
        known = (self._last_good or {}).get("services") or [{"id": i, "manifest": None} for i in declared_services()]
        rows = []
        for s in known:
            rows.append({**{k: s.get(k) for k in ("id", "unit", "kind", "plugin", "mode", "manifest") if k in s}, "$axf": "host-service-state@1",
                         "status": "unknown", "since": since, "at": since, "reason": "the host API cannot be reached", "code": "host_service_down", "reachable": False})
        return {"$axf": "host-service-list@1", "at": since, "services": rows, "down": err.frame(), "downSince": since}

    def service(self, sid: str) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}")

    def service_health(self, sid: str) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}/health")

    def settings(self, sid: str) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}/settings")

    def logs(self, sid: str, lines: int = 200) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}/logs?lines={max(1, min(2000, int(lines)))}", timeout=15)

    def mode(self) -> dict[str, Any]:
        return self.request("GET", "/mode")

    def get_mode(self, sid: str) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}/mode")

    def shadow(self, sid: str) -> dict[str, Any]:
        return self.request("GET", f"/services/{quote(sid)}/shadow")

    # ---- writes (every one carries who and why)
    def _write(self, method: str, path: str, body: dict[str, Any], timeout: float = 30.0) -> dict[str, Any]:
        r = self.request(method, path, body, timeout=timeout)
        with self._lock:
            self._cache = None
        return r

    def unit(self, sid: str, verb: str, by: str = "console", reason: dict[str, str] | None = None) -> dict[str, Any]:
        return self._write("POST", f"/services/{quote(sid)}/unit/{quote(verb)}", {"by": by, "reason": reason or {}}, timeout=70)

    def action(self, sid: str, action: str, args: dict[str, Any] | None = None, by: str = "console", reason: dict[str, str] | None = None,
               confirm: bool = False, timeout: float = 900.0) -> dict[str, Any]:
        return self._write("POST", f"/services/{quote(sid)}/actions/{quote(action)}", {"args": args or {}, "by": by, "reason": reason or {}, "confirm": bool(confirm)}, timeout=timeout)

    def set_settings(self, sid: str, values: dict[str, Any], by: str = "console", reason: dict[str, str] | None = None) -> dict[str, Any]:
        return self._write("PUT", f"/services/{quote(sid)}/settings", {"set": values, "by": by, "reason": reason or {}})

    def set_mode(self, sid: str, to: str, by: str = "console", why: str = "", reason: dict[str, str] | None = None, accept_drift: list[str] | None = None) -> dict[str, Any]:
        return self._write("PUT", f"/services/{quote(sid)}/mode", {"to": to, "by": by, "why": why, "reason": reason or {}, "acceptDrift": accept_drift or []}, timeout=70)

    def rollback(self, sid: str, to: str = "container", by: str = "console", why: str = "", reason: dict[str, str] | None = None) -> dict[str, Any]:
        return self._write("POST", f"/services/{quote(sid)}/rollback", {"to": to, "by": by, "why": why, "reason": reason or {}}, timeout=120)

    def report_shadow(self, sid: str, result: str, effects: list[Any] | None = None, error: str = "") -> dict[str, Any]:
        """The console's copy says what it did in shadow mode; the host compares it with its dry run."""
        body: dict[str, Any] = {"at": time.strftime("%Y-%m-%dT%H:%M:%S.000Z", time.gmtime()), "result": result, "effects": effects or []}
        if error:
            body["error"] = error
        return self._write("POST", f"/services/{quote(sid)}/shadow", body)

    # ---- state for the banner
    def status(self) -> dict[str, Any]:
        """One line for Amber and the banner: is the host API up, since when is it down, the last error."""
        return {"up": self.down_since is None and self.last_ok is not None, "downSince": self.down_since, "lastOk": self.last_ok,
                "error": self.last_error, "endpoint": self.endpoint_used, "endpoints": [e["url"] for e in endpoints(self._env)]}


def declared_services() -> list[str]:
    """Service ids plugins declare (plugin.json → hostServices), so rows show while the host API is down."""
    out: list[str] = [HOST_API]
    plugins = ROOT / "apps" / "console-web" / "plugins"
    for f in sorted(plugins.glob("*/plugin.json")) if plugins.is_dir() else []:
        try:
            for sid in json.loads(f.read_text()).get("hostServices") or []:
                if isinstance(sid, str) and sid not in out:
                    out.append(sid)
        except Exception:  # noqa: BLE001
            continue
    return out


_client: HostServices | None = None
_client_lock = threading.Lock()


def client() -> HostServices:
    global _client
    with _client_lock:
        if _client is None:
            _client = HostServices()
        return _client


def set_client(c: HostServices | None) -> None:
    """Tests: swap the shared client."""
    global _client
    with _client_lock:
        _client = c


def register() -> None:
    """Offer the client to plugins (capability axf.host-services@1, owned by the host-services plugin folder)."""
    import plugin_services  # noqa: PLC0415

    plugin_services.provide(CAPABILITY, client(), FOLDER)
