"""Server registry (mcp-servers@1) for the Python port — the same file format the Dev Console plugin kept.

A JSON file `{"$axf": "mcp-servers@1", "servers": {id: record}}` written with mode 0600. Each record holds
name, url, description, tokenEnv (an environment variable name, preferred) or a stored token; `public()` is
what callers may show (never the token). `env_or_stored_credentials(registry)` turns a registry into a credential
provider for the transport.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any, Callable

from axf_server import storage

from . import engine as E


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class FileRegistry:
    label = "this server"

    def __init__(self, path: str | os.PathLike[str], env: Callable[[str], str | None] | None = None) -> None:
        self.path = Path(path)
        self.env = env or (lambda k: os.environ.get(k))

    # ---------- storage

    def load(self) -> dict[str, dict[str, Any]]:
        try:
            raw = json.loads(self.path.read_text())
            return {k: v for k, v in raw.get("servers", {}).items() if isinstance(v, dict)}
        except (OSError, ValueError, AttributeError):
            return {}

    def save(self, servers: dict[str, dict[str, Any]]) -> None:
        # atomic (unique tmp + fsync + replace), 0600 from the start; a new folder is 0700 (axf_server.storage)
        storage.write_json(self.path, {"$axf": "mcp-servers@1", "servers": servers})

    # ---------- records

    def public(self, sid: str, s: dict[str, Any]) -> dict[str, Any]:
        env = s.get("tokenEnv") or ""
        return {
            "id": sid, "name": s.get("name") or sid, "url": s.get("url", ""), "description": s.get("description", ""),
            "tokenEnv": env, "auth": "env" if env else ("token" if s.get("token") else "none"),
            "envPresent": bool(env and self.env(env)),
            "createdAt": s.get("createdAt", ""), "lastCheck": s.get("lastCheck"),
        }

    def list(self) -> list[dict[str, Any]]:
        return [self.public(k, v) for k, v in sorted(self.load().items(), key=lambda kv: (kv[1].get("name") or kv[0]).lower())]

    def get(self, sid: str) -> dict[str, Any] | None:
        return self.load().get(sid)

    def upsert(self, body: dict[str, Any]) -> dict[str, Any]:
        """Validate and save one server. body: id ('' = new), name, url, description, tokenEnv, token (None keep, '' clear)."""
        problems = E.validate_server_input(body)
        if problems:
            raise E.McpWireError(E.wire(E.VALIDATION, "; ".join(problems)))
        servers = self.load()
        sid = body.get("id") or E.server_id_for(body["name"], servers.keys())
        old = servers.get(sid, {}) if body.get("id") else {}
        rec: dict[str, Any] = {
            "name": body["name"].strip(), "url": body["url"].strip(), "description": (body.get("description") or "").strip(), "tokenEnv": body.get("tokenEnv") or "",
            "createdAt": old.get("createdAt") or _now(), "lastCheck": old.get("lastCheck"),
        }
        token = old.get("token", "") if body.get("token") is None else body.get("token")
        if token and not rec["tokenEnv"]:
            rec["token"] = token
        servers[sid] = rec
        self.save(servers)
        return self.public(sid, rec)

    def remove(self, sid: str) -> bool:
        servers = self.load()
        if servers.pop(sid, None) is None:
            return False
        self.save(servers)
        return True

    def touch(self, sid: str, ok: bool, tools: int) -> None:
        servers = self.load()
        if sid in servers:
            servers[sid]["lastCheck"] = {"at": _now(), "ok": ok, "tools": tools}
            self.save(servers)

    # ---------- credentials (never returned to callers of list/public)

    def authorization(self, sid: str) -> str | None:
        """Authorization header value for a server; raises McpWireError(invalid) when its env var is unset."""
        s = self.get(sid)
        if not s:
            return None
        if s.get("tokenEnv"):
            token = self.env(s["tokenEnv"]) or ""
            if not token:
                raise E.McpWireError(E.wire(E.INVALID, f"environment variable {s['tokenEnv']} is not set on this server", {"env": s["tokenEnv"]}))
            return f"Bearer {token}"
        return f"Bearer {s['token']}" if s.get("token") else None


def env_or_stored_credentials(registry: FileRegistry) -> Callable[[str], str | None]:
    return registry.authorization
