"""Who is calling, when the console sits behind axHub's sign-in wall.

Traefik asks axHub (`/auth/verify`) before every request; for a signed-in browser axHub answers with
`X-Auth-User`, `X-Auth-Role` (admin|user), `X-Auth-Perms` (comma list, "*" for admins) and `X-Auth-Via: session`.
A strip middleware removes any copy a client sends — but a container on the same Docker network could reach the
console without the proxy, so the headers are trusted only when they carry axHub's signature (`X-Auth-Sig`:
HMAC-SHA256 with the secret shared as AXHUB_WALL_SECRET on the hub and AXF_WALL_SECRET here, at most 120 s old,
for this host) and the installer says the wall is on (`AXF_TRUST_WALL=1`). Otherwise only the console token counts.

- A wall **admin** is treated like the console token (so a signed-in browser needs no pasted token).
- A wall **user** reaches only plugins whose plugin.json says `"wallUsers": true`; the plugin decides what they may
  do from `request.state.axf_user` (name, role, perms).
- Browser-session requests that change something must come from the console's own origin (no cross-site requests
  from sibling subdomains that share the cookie).
"""
from __future__ import annotations

import hmac
import hashlib
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlsplit

_PERM = re.compile(r"^[a-z0-9][a-z0-9._*-]{0,63}$")
_NAME = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")
SAFE_METHODS = {"GET", "HEAD", "OPTIONS"}


MAX_AGE_S = 120


def _secret() -> str:
    return os.environ.get("AXF_WALL_SECRET", "").strip()


def trusted() -> bool:
    return os.environ.get("AXF_TRUST_WALL", "").strip() == "1" and len(_secret()) >= 32


def signature_ok(sig: str, user: str, role: str, perms: str, host: str, now: float | None = None) -> bool:
    """Checks axHub's `v1.<ts>.<hex>` over `v1|ts|user|role|perms|host` (constant-time, recent, this host)."""
    parts = (sig or "").split(".")
    if len(parts) != 3 or parts[0] != "v1" or not parts[1].isdigit() or len(parts[2]) != 64:
        return False
    ts = int(parts[1])
    if abs((now if now is not None else time.time()) - ts) > MAX_AGE_S:
        return False
    want = hmac.new(_secret().encode(), f"v1|{ts}|{user}|{role}|{perms}|{host.lower()}".encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, parts[2])


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
    raw_user = headers.get("x-auth-user") or ""
    raw_role = headers.get("x-auth-role") or ""
    raw_perms = headers.get("x-auth-perms") or ""
    host = headers.get("host") or ""  # Traefik passes the original Host; the hub signed X-Forwarded-Host = the same
    if not signature_ok(headers.get("x-auth-sig") or "", raw_user, raw_role, raw_perms, host):
        return None
    name = raw_user.strip().lower()
    role = raw_role.strip().lower()
    if not _NAME.match(name) or role not in ("admin", "user"):
        return None
    perms = frozenset(p for p in (x.strip().lower() for x in raw_perms.split(",")) if _PERM.match(p))
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
