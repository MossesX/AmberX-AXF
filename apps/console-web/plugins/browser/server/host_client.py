"""Client for the browser host (host/host.mjs, its own container on the console's network).

The host's address and token come from the environment (AXF_BROWSER_URL, default http://axf-browser:7095;
AXF_BROWSER_TOKEN) or the plugin's config file; the token never leaves the console server.
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

DEFAULT_URL = "http://axf-browser:7095"


class HostError(Exception):
    def __init__(self, status: int, detail: str) -> None:
        super().__init__(detail)
        self.status = status
        self.detail = detail


class HostClient:
    def __init__(self, config_file: Path) -> None:
        self.config_file = config_file

    # ---- config ------------------------------------------------------------------------------------------------------

    def config(self) -> dict[str, Any]:
        saved: dict[str, Any] = {}
        try:
            saved = json.loads(self.config_file.read_text())
        except (OSError, ValueError):
            pass
        return {
            "hostUrl": os.environ.get("AXF_BROWSER_URL") or saved.get("hostUrl") or DEFAULT_URL,
            "hostUrlFromEnv": bool(os.environ.get("AXF_BROWSER_URL")),
            "workspace": saved.get("workspace") or "default",
            "device": saved.get("device") if saved.get("device") in ("desktop", "phone", "tablet") else "desktop",
            "quality": int(saved.get("quality") or 60),
            "homeUrl": saved.get("homeUrl") or "https://books.toscrape.com/",
            "tokenSet": bool(self.token()),
        }

    def save_config(self, patch: dict[str, Any]) -> dict[str, Any]:
        cur: dict[str, Any] = {}
        try:
            cur = json.loads(self.config_file.read_text())
        except (OSError, ValueError):
            pass
        for k in ("hostUrl", "workspace", "device", "quality", "homeUrl"):
            if k in patch:
                cur[k] = patch[k]
        if "hostUrl" in cur and cur["hostUrl"] and not str(cur["hostUrl"]).startswith(("http://", "https://")):
            raise HostError(400, "hostUrl must start with http:// or https://")
        self.config_file.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = self.config_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(cur, indent=2))
        os.chmod(tmp, 0o600)
        tmp.replace(self.config_file)
        return self.config()

    # ---- calls -------------------------------------------------------------------------------------------------------

    def base(self) -> str:
        return str(self.config()["hostUrl"]).rstrip("/")

    def token(self) -> str:
        """AXF_BROWSER_TOKEN, else the token deploy.sh wrote next to the config (0600, never sent to a browser)."""
        tok = os.environ.get("AXF_BROWSER_TOKEN") or ""
        if not tok:
            try:
                tok = (self.config_file.parent / "host-token").read_text().strip()
            except OSError:
                tok = ""
        return tok

    def _headers(self) -> dict[str, str]:
        tok = self.token()
        return {"authorization": f"Bearer {tok}"} if tok else {}

    def raw(self, method: str, path: str, body: Any = None, timeout: float = 60) -> tuple[int, bytes, str]:
        data = json.dumps(body).encode() if body is not None else None
        headers = {**self._headers(), **({"content-type": "application/json"} if data is not None else {})}
        req = urllib.request.Request(self.base() + path, data=data, method=method, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:  # noqa: S310 — host URL is admin config
                return r.status, r.read(), r.headers.get("content-type", "")
        except urllib.error.HTTPError as e:
            raw = e.read()
            try:
                detail = json.loads(raw).get("detail") or str(e)
            except ValueError:
                detail = raw.decode("utf8", "replace")[:300] or str(e)
            raise HostError(e.code, detail) from e
        except (urllib.error.URLError, OSError, TimeoutError) as e:
            reason = getattr(e, "reason", e)
            raise HostError(503, f"browser host not reachable at {self.base()}: {reason}") from e

    def call(self, method: str, path: str, body: Any = None, timeout: float = 60) -> Any:
        _, raw, _ = self.raw(method, path, body, timeout)
        return json.loads(raw) if raw else {}

    def health(self) -> dict[str, Any]:
        return self.call("GET", "/health", timeout=5)

    def run(self, workspace: str, cmd: str, args: dict[str, Any] | None = None, timeout: float = 90) -> Any:
        ws = urllib.parse.quote(workspace, safe="")
        return self.call("POST", f"/sessions/{ws}/{urllib.parse.quote(cmd, safe='')}", args or {}, timeout)

    def ensure(self, workspace: str, device: str | None = None, url: str | None = None) -> Any:
        body: dict[str, Any] = {"workspace": workspace}
        if device:
            body["device"] = device
        if url:
            body["url"] = url
        return self.call("POST", "/sessions", body, timeout=90)

    def ws_url(self, workspace: str, query: dict[str, str]) -> tuple[str, dict[str, str]]:
        base = self.base().replace("http://", "ws://", 1).replace("https://", "wss://", 1)
        q = urllib.parse.urlencode({k: v for k, v in query.items() if v})
        return f"{base}/sessions/{urllib.parse.quote(workspace, safe='')}/live" + (f"?{q}" if q else ""), self._headers()
