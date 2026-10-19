"""Who is calling, when the console sits behind axHub's sign-in wall.

Traefik asks axHub (`/auth/verify`) before every request; for a signed-in browser axHub answers with
`X-Auth-User`, `X-Auth-Role` (admin|user), `X-Auth-Perms` (comma list, "*" for admins) and `X-Auth-Via: session`.
A strip middleware removes any copy a client sends, so these headers can be trusted — but only when the installer
says the wall is on (`AXF_TRUST_WALL=1`). Without that, they are ignored and only the console token counts.

- A wall **admin** is treated like the console token (so a signed-in browser needs no pasted token).
- A wall **user** reaches only plugins whose plugin.json says `"wallUsers": true`; the plugin decides what they may
  do from `request.state.axf_user` (name, role, perms).
- Browser-session requests that change something must come from the console's own origin (no cross-site requests
  from sibling subdomains that share the cookie).
"""
from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

_PERM = re.compile(r"^[a-z0-9][a-z0-9._*-]{0,63}$")
_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


def trusted() -> bool:
    return os.environ.get("AXF_TRUST_WALL", "").strip() == "1"


@dataclass(frozen=True)
class Caller:
    name: str
    role: str  # "admin" | "user"
    perms: frozenset[str] = field(default_factory=frozenset)
    via: str = "token"  # "token" | "session"

    @property
    def admin(self) -> bool:
        return self.role == "admin"

    def can(self, perm: str) -> bool:
        """Admins can do everything; users need the permission itself, `assistant.*` style or `*`."""
        if self.admin or "*" in self.perms or perm in self.perms:
            return True
        parts = perm.split(".")
        return any(".".join(parts[:i]) + ".*" in self.perms for i in range(1, len(parts)))

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "role": self.role, "perms": sorted(self.perms), "via": self.via}


TOKEN_CALLER = Caller("console-token", "admin", frozenset({"*"}), "token")


def wall_caller(headers: Any) -> Caller | None:
    """The signed-in person from the wall's headers, or None (wall off, not a session, malformed)."""
    if not trusted() or headers.get("x-auth-via") != "session":
        return None
    name = (headers.get("x-auth-user") or "").strip().lower()
    role = (headers.get("x-auth-role") or "").strip().lower()
    if not _NAME.match(name) or role not in ("admin", "user"):
        return None
    perms = frozenset(p for p in (x.strip().lower() for x in (headers.get("x-auth-perms") or "").split(",")) if _PERM.match(p))
    if role == "admin":
        perms = frozenset({"*"})
    return Caller(name, role, perms, "session")


def same_origin(request: Any) -> bool:
    """For browser-session writes: Origin (or Referer) must be this console's own host."""
    if request.method.upper() in SAFE_METHODS:
        return True
    host = (request.headers.get("host") or "").lower()
    src = request.headers.get("origin") or request.headers.get("referer") or ""
    if not src or src == "null":
        return False
    return urlsplit(src).netloc.lower() == host and bool(host)


def caller_of(request: Any) -> Caller | None:
    return getattr(request.state, "axf_user", None)
