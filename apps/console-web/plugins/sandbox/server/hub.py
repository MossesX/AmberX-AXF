"""The sandbox's road to GitHub: axHub's `github` service, read-only tools only.

Uses the framework's MCP client (`axf_libs.mcp`, no redirects, so the hub token never travels elsewhere) against
axHub's `/mcp` with `AXHUB_URL` + `AXHUB_TOKEN` (the same pair the systems check asks for). The token stays on the server.
Only `call(tool, args)` with a tool from `shield.READ_TOOLS` is ever sent; anything the hub answers is data.
"""
from __future__ import annotations

import json
import os
import threading
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_libs.mcp.client import McpClient, Transport, UrllibTransport

from .shield import READ_TOOLS, ShieldError

TIMEOUT_S = 30


class HubError(Exception):
    pass


def hub_config() -> tuple[str, str]:
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    return url, tok


class HubReader:
    """One MCP session with axHub, reopened when it drops. Thread-safe (one call at a time)."""

    def __init__(self, transport_factory: Callable[[Callable[[str], str | None]], Transport] | None = None,
                 config: Callable[[], tuple[str, str]] = hub_config) -> None:
        self._factory = transport_factory or (lambda creds: UrllibTransport(creds))
        self._config = config
        self._client: McpClient | None = None
        self._key: tuple[str, str] | None = None
        self._lock = threading.Lock()

    def ready(self) -> tuple[bool, str]:
        url, tok = self._config()
        if not tok:
            return False, "The console has no axHub token yet (Settings → Plugins → Systems check → Keys: axHub)."
        if not url.startswith("https://"):
            return False, "The axHub address must be https."
        return True, ""

    def _session(self) -> McpClient:
        url, tok = self._config()
        ok, why = self.ready()
        if not ok:
            raise HubError(why)
        if self._client is None or self._key != (url, tok):
            client = McpClient("axhub-sandbox", f"{url}/mcp", self._factory(lambda _sid: f"Bearer {tok}"), timeout=TIMEOUT_S)
            client.initialize()
            self._client, self._key = client, (url, tok)
        return self._client

    def call(self, tool: str, arguments: dict[str, Any]) -> Any:
        """Run one read-only hub tool (`github.<name>`); returns the parsed JSON answer (or text)."""
        name = tool.split(".", 1)[1] if tool.startswith("github.") else ""
        if name not in READ_TOOLS:
            raise ShieldError("not a read-only tool")
        with self._lock:
            for attempt in (0, 1):
                try:
                    res = self._session().call_tool("call", {"tool": tool, "arguments": arguments, "timeout_seconds": TIMEOUT_S})
                    break
                except HubError:
                    raise
                except Exception as e:  # noqa: BLE001 — session expired or network: retry once on a fresh session
                    self._client = None
                    if attempt:
                        raise HubError(f"Couldn't reach axHub ({type(e).__name__})") from None
        text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
        if res.get("isError"):
            try:
                err = json.loads(text).get("error", {})
            except (ValueError, AttributeError):
                err = {"message": text}
            if isinstance(err, dict) and err.get("code") == "confirmation_required":
                # never asked for by a read tool; if the hub ever wants approval, the sandbox refuses rather than wait
                raise HubError("axHub wants an approval for this, so the sandbox won't do it.")
            msg = err.get("message") if isinstance(err, dict) else None
            raise HubError(str(msg or text or "axHub error")[:300])
        try:
            return json.loads(text)
        except ValueError:
            return text
