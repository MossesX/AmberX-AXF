"""Who is calling, when this app sits behind axHub's sign-in wall (axHub decision #77).

Traefik asks axHub (`/auth/verify`) before every request; for a signed-in browser axHub answers with `X-Auth-User`,
`X-Auth-Role` (admin|user), `X-Auth-Perms` (comma list, "*" for admins), `X-Auth-Via: session` and `X-Auth-Sig`.
The installer's strip middleware removes any copy a client sends, but a container on the same Docker network could
reach the app without the proxy, so the headers count only when they carry axHub's signature (`X-Auth-Sig`:
HMAC-SHA256 over `v1|ts|user|role|perms|host` with the secret shared as AXHUB_WALL_SECRET on the hub and
APP_WALL_SECRET here, at most 120 s old, for this host) and the installer says the wall is on (`APP_TRUST_WALL=1`).

Same rules as the Dev Console's `server/wall.py` (kept in step; the shared copy is moving to the framework's Python
server helpers, `framework/python/axf_server`, after which this file can import it instead).
"""
from __future__ import annotations

import hashlib
import hmac
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
    return os.environ.get("APP_WALL_SECRET", "").strip()


def trusted() -> bool:
    """The wall's headers count only when the installer turned the wall on and the shared secret is long enough."""
    return os.environ.get("APP_TRUST_WALL", "").strip() == "1" and len(_secret()) >= 32


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
        """Admins can do everything; users need the permission itself, an `app.*` style wildcard or `*`."""
        if self.admin or "*" in self.perms or perm in self.perms:
            return True
        parts = perm.split(".")
        return any(".".join(parts[:i]) + ".*" in self.perms for i in range(1, len(parts)))

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "role": self.role, "perms": sorted(self.perms), "via": self.via}


TOKEN_CALLER = Caller("app-token", "admin", frozenset({"*"}), "token")


def wall_caller(headers: Any) -> Caller | None:
    """The signed-in person from the wall's headers, or None (wall off, not a session, bad signature, malformed)."""
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


def malformed_session(headers: Any) -> bool:
    """The wall said "a signed-in browser" but its headers don't check out: refuse (never fall back to anonymous)."""
    return trusted() and headers.get("x-auth-via") == "session" and wall_caller(headers) is None


def same_origin(request: Any) -> bool:
    """For browser-session writes: Origin (or Referer) must be this app's own host."""
    if request.method.upper() in SAFE_METHODS:
        return True
    host = (request.headers.get("host") or "").lower()
    src = request.headers.get("origin") or request.headers.get("referer") or ""
    if not src or src == "null":
        return False
    return urlsplit(src).netloc.lower() == host and bool(host)


def ui_role(caller: Caller, themes_perm: str) -> str:
    """The hub-accounts policy role (framework starter uac-policy/hub-accounts): admin | themes | user."""
    if caller.admin:
        return "admin"
    return "themes" if caller.can(themes_perm) else "user"
