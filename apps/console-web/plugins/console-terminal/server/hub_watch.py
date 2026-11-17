"""Claude link — the console server's own outgoing axHub and Claude traffic, from one observer on axf_server.http.

Every console call to axHub goes through `axf_server.http.request("POST", "<hub>/mcp", …)` (agent-manager hubtools,
claude-session, maintenance, console-commands wake, plugins-menu): one `http.observe` listener sees them all, so no
call site changes. Headers never reach the observer; arguments are redacted by the bus.

  axHub /mcp     → kind axhub per call (tool, held / veto / denied / ok / error state, ms); connect / disconnect on the
                   first success after a failure and the first failure after a success; 401/403 → error (auth)
  Anthropic API  → connect / disconnect / error only (no line per call: the assistant's traffic would drown the log)
"""
from __future__ import annotations

import json
import re
import threading
from typing import Any, Callable
from urllib.parse import urlsplit

HELD = re.compile(r"\b(held|waiting for (approval|brett)|pending approval|countdown|veto)\b", re.I)
DENIED = re.compile(r"\b(denied|vetoed|refused|rejected)\b", re.I)
ANTHROPIC = "api.anthropic.com"


def _rpc(body: bytes | None) -> dict[str, Any]:
    try:
        m = json.loads((body or b"{}").decode("utf-8", "replace"))
        return m if isinstance(m, dict) else {}
    except ValueError:
        return {}


def _answer(resp: Any) -> dict[str, Any]:
    """The JSON-RPC message in an answer (plain JSON or the last data: line of an event stream)."""
    if resp is None:
        return {}
    try:
        raw = resp.text() if hasattr(resp, "text") else ""
    except Exception:  # noqa: BLE001
        return {}
    if "data:" in raw[:20] or "\ndata:" in raw:
        for ln in reversed(raw.splitlines()):
            if ln.startswith("data:") and ln[5:].strip():
                try:
                    return json.loads(ln[5:].strip())
                except ValueError:
                    return {}
        return {}
    try:
        m = json.loads(raw or "{}")
        return m if isinstance(m, dict) else {}
    except ValueError:
        return {}


def tool_of(rpc: dict[str, Any]) -> tuple[str, dict[str, Any]]:
    """('call vps.run', {…}) for axHub's call tool, ('list_services', {}) for a plain tool, ('initialize', {}) else."""
    method = str(rpc.get("method") or "")
    p = rpc.get("params") if isinstance(rpc.get("params"), dict) else {}
    if method != "tools/call":
        return method or "request", {}
    name = str(p.get("name") or "?")
    args = p.get("arguments") if isinstance(p.get("arguments"), dict) else {}
    if name == "call":
        svc, act = args.get("service") or "", args.get("action") or args.get("tool") or ""
        target = ".".join(x for x in (str(svc), str(act)) if x)
        reason = args.get("reason") if isinstance(args.get("reason"), dict) else {}
        return f"call {target}".strip(), {"service": svc, "action": act, "reason": reason.get("title", "")}
    return name, {"args": sorted(args.keys())[:20]}


def state_of(status: int, error: str, msg: dict[str, Any]) -> str:
    if error or status == 0:
        return "error"
    if status in (401, 403):
        return "auth"
    if status >= 400:
        return "error"
    if "error" in msg:
        return "error"
    res = msg.get("result") if isinstance(msg.get("result"), dict) else {}
    text = " ".join(str(c.get("text", "")) for c in (res.get("content") or []) if isinstance(c, dict))[:2000]
    if res.get("isError"):
        return "denied" if DENIED.search(text) else "error"
    if HELD.search(text):
        return "veto" if re.search(r"\bveto\b", text, re.I) else "held"
    return "ok"


class HubWatch:
    """The observer: (info) → events on the bus through `append`."""

    def __init__(self, append: Callable[[dict[str, Any]], Any], console_hosts: set[str] | None = None):
        self.append = append
        self.console_hosts = {h.lower() for h in (console_hosts or set())}
        self.up: dict[str, bool] = {}
        self._lock = threading.Lock()

    def _link(self, host: str, ok: bool, source: str, why: str, ms: int) -> None:
        with self._lock:
            was = self.up.get(host)
            self.up[host] = ok
        if was is ok:
            return
        if ok:
            self.append({"kind": "connect", "source": source, "summary": f"{host} answered{' again' if was is False else ''}", "detail": {"host": host, "ms": ms}})
        elif was is True or was is None:
            self.append({"kind": "disconnect", "source": source, "summary": f"{host} unreachable: {why}"[:200], "detail": {"host": host, "why": why, "ms": ms}, "level": "warn"})

    def __call__(self, info: dict[str, Any]) -> None:
        try:
            u = urlsplit(str(info.get("url") or ""))
        except ValueError:
            return
        host = (u.hostname or "").lower()
        if not host or host in self.console_hosts:
            return
        status, error, ms = int(info.get("status") or 0), str(info.get("error") or ""), int(info.get("ms") or 0)
        if host == ANTHROPIC:
            ok = 0 < status < 500 and status not in (401, 403)
            self._link(host, ok and not error, "anthropic-api", error or f"HTTP {status}", ms)
            if status in (401, 403):
                self.append({"kind": "error", "source": "anthropic-api", "summary": f"Anthropic API refused the key ({status})", "detail": {"path": u.path, "status": status}})
            return
        if not (info.get("method") == "POST" and u.path.rstrip("/").endswith("/mcp")):
            return
        rpc = _rpc(info.get("body"))
        tool, extra = tool_of(rpc)
        msg = _answer(info.get("response"))
        st = state_of(status, error, msg)
        reachable = status != 0 and status < 500
        self._link(host, reachable, "axhub-client", error or f"HTTP {status}", ms)
        if st == "auth":
            self.append({"kind": "error", "source": "axhub-client", "summary": f"axHub refused the token ({status}) on {tool}", "detail": {"host": host, "tool": tool, "status": status, "ms": ms}})
            return
        if rpc.get("method") in ("initialize", "notifications/initialized", "tools/list") and st == "ok":
            return  # handshake noise: the connect line says the hub answered
        why = error or (str((msg.get("error") or {}).get("message", ""))[:160] if isinstance(msg.get("error"), dict) else "")
        level = "error" if st == "error" else "warn" if st in ("denied", "held", "veto") else "info"
        self.append({"kind": "axhub", "source": "axhub-client", "summary": f"{tool} → {st} ({ms} ms){': ' + why if why else ''}"[:200], "level": level,
                     "detail": {"host": host, "tool": tool, "state": st, "status": status, "ms": ms, **extra, **({"error": why} if why else {})}})


def install(append: Callable[[dict[str, Any]], Any], console_hosts: set[str] | None = None) -> Callable[[], None]:
    """Start watching (returns the stop). Without axf_server (a bare test) it does nothing."""
    try:
        from axf_server import http as axf_http
    except ImportError:
        return lambda: None
    return axf_http.observe(HubWatch(append, console_hosts))
