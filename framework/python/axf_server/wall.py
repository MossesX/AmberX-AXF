"""Who is calling, when an AXF app sits behind axHub's sign-in wall (axHub decisions #77, #80, #81).

Traefik asks axHub (`/auth/verify`) before every request; for a signed-in browser axHub answers with `X-Auth-User`,
`X-Auth-Role` (admin|user), `X-Auth-Perms` (comma list, "*" for admins), `X-Auth-Via: session` and `X-Auth-Sig`.
A strip middleware removes any copy a client sends, but a container on the same Docker network could reach the app
without the proxy, so the headers count only when they carry axHub's signature:

    X-Auth-Sig = "v1." + ts + "." + hex(HMAC-SHA256(secret, "v1|<ts>|<user>|<role>|<perms>|<host lowercased>"))

at most 120 s old (either way), for this request's Host, made with the secret shared as AXHUB_WALL_SECRET on the hub
and `<PREFIX>WALL_SECRET` here (≥ 32 characters), and only when the installer said the wall is on
(`<PREFIX>TRUST_WALL=1`). Otherwise only the app's own token counts. The fixture
`framework/spec/fixtures/wall-signature.json` pins the scheme for every port (Python here, Node in
`framework/spec/check-axf-server.mjs`).

    wall = Wall("AXF_")          # the Dev Console (AXF_WALL_SECRET, AXF_TRUST_WALL)
    wall = Wall("BP_")           # Build Pilot (BP_WALL_SECRET, BP_TRUST_WALL)
    c = wall.caller(request.headers)      # Caller | None
    wall.same_origin(request)             # browser-session writes come from this site
    user_may(c, method, path, …)          # the console's default-deny rules for signed-in hub users

The env is read on every call (an installer or a test may change it), never cached.
"""
from __future__ import annotations

import hashlib
import hmac
import os
import re
import time
from dataclasses import dataclass, field
from typing import Any, Callable, Mapping
from urllib.parse import urlsplit

__all__ = ["MAX_AGE_S", "MIN_SECRET", "SAFE_METHODS", "SIG_VERSION", "Caller", "TOKEN_CALLER", "Wall", "sign", "verify",
           "signed_message", "same_origin", "caller_of", "plugin_perm", "plugin_granted", "user_may", "ui_role",
           "THEMES_PERM", "USER_READ_PATHS", "ADMIN_PAGES", "NAME_RE", "PERM_RE"]

SIG_VERSION = "v1"
MAX_AGE_S = 120
MIN_SECRET = 32
SAFE_METHODS = frozenset({"GET", "HEAD", "OPTIONS"})
PERM_RE = re.compile(r"^[a-z0-9][a-z0-9._*-]{0,63}$")
NAME_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{1,31}$")


# ---------------------------------------------------------------- the signature (pure; pinned by the fixture)

def signed_message(ts: int, user: str, role: str, perms: str, host: str) -> str:
    return f"{SIG_VERSION}|{ts}|{user}|{role}|{perms}|{host.lower()}"


def sign(secret: str, user: str, role: str, perms: str, host: str, ts: int) -> str:
    """What axHub sends (for tests and for a hub written in Python)."""
    mac = hmac.new(secret.encode(), signed_message(ts, user, role, perms, host).encode(), hashlib.sha256).hexdigest()
    return f"{SIG_VERSION}.{ts}.{mac}"


def verify(secret: str, sig: str, user: str, role: str, perms: str, host: str, now: float | None = None,
           max_age: int = MAX_AGE_S) -> bool:
    """Constant-time check of `v1.<ts>.<64 hex>`: recent (±max_age s), this host, untouched user/role/perms.
    A secret shorter than MIN_SECRET never verifies anything."""
    if not isinstance(secret, str) or len(secret) < MIN_SECRET or not isinstance(sig, str):
        return False
    parts = sig.split(".")
    if len(parts) != 3 or parts[0] != SIG_VERSION or not parts[1].isdigit() or len(parts[1]) > 12 or len(parts[2]) != 64:
        return False
    ts = int(parts[1])
    if abs((now if now is not None else time.time()) - ts) > max_age:
        return False
    want = hmac.new(secret.encode(), signed_message(ts, user, role, perms, host).encode(), hashlib.sha256).hexdigest()
    return hmac.compare_digest(want, parts[2])


# ---------------------------------------------------------------- the caller

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
        """Admins can do everything; users need the permission itself, an `assistant.*` style prefix or `*`."""
        if self.admin or "*" in self.perms or perm in self.perms:
            return True
        parts = perm.split(".")
        return any(".".join(parts[:i]) + ".*" in self.perms for i in range(1, len(parts)))

    def public(self) -> dict[str, Any]:
        return {"name": self.name, "role": self.role, "perms": sorted(self.perms), "via": self.via}


TOKEN_CALLER = Caller("console-token", "admin", frozenset({"*"}), "token")


def _hdr(headers: Any, name: str) -> str:
    v = headers.get(name) if headers is not None else None
    return v if isinstance(v, str) else ""


def same_origin(request: Any) -> bool:
    """For browser-session writes: Origin (or Referer) must be this site's own Host. Safe methods always pass."""
    if str(request.method).upper() in SAFE_METHODS:
        return True
    host = _hdr(request.headers, "host").lower()
    src = _hdr(request.headers, "origin") or _hdr(request.headers, "referer")
    if not src or src == "null" or not host:
        return False
    try:
        return urlsplit(src).netloc.lower() == host
    except ValueError:
        return False


def caller_of(request: Any) -> Caller | None:
    return getattr(request.state, "axf_user", None)


class Wall:
    """The wall as seen by one app; `prefix` names its env vars (`AXF_` → AXF_WALL_SECRET, AXF_TRUST_WALL)."""

    def __init__(self, prefix: str = "AXF_", env: Callable[[str], str | None] | None = None, max_age: int = MAX_AGE_S) -> None:
        if not re.fullmatch(r"[A-Z][A-Z0-9_]{0,30}_", prefix):
            raise ValueError("prefix looks like AXF_ or BP_")
        self.prefix = prefix
        self.env = env or os.environ.get
        self.max_age = max_age

    def secret(self) -> str:
        return (self.env(f"{self.prefix}WALL_SECRET") or "").strip()

    def trusted(self) -> bool:
        return (self.env(f"{self.prefix}TRUST_WALL") or "").strip() == "1" and len(self.secret()) >= MIN_SECRET

    def signature_ok(self, sig: str, user: str, role: str, perms: str, host: str, now: float | None = None) -> bool:
        return verify(self.secret(), sig, user, role, perms, host, now, self.max_age)

    def caller(self, headers: Mapping[str, str] | Any, now: float | None = None) -> Caller | None:
        """The signed-in person from the wall's headers, or None (wall off, not a session, bad signature, bad name)."""
        if not self.trusted() or _hdr(headers, "x-auth-via") != "session":
            return None
        raw_user, raw_role, raw_perms = _hdr(headers, "x-auth-user"), _hdr(headers, "x-auth-role"), _hdr(headers, "x-auth-perms")
        host = _hdr(headers, "host")  # Traefik passes the original Host; the hub signed X-Forwarded-Host = the same
        if not self.signature_ok(_hdr(headers, "x-auth-sig"), raw_user, raw_role, raw_perms, host, now):
            return None
        name, role = raw_user.strip().lower(), raw_role.strip().lower()
        if not NAME_RE.match(name) or role not in ("admin", "user"):
            return None
        perms = frozenset(p for p in (x.strip().lower() for x in raw_perms.split(",")) if PERM_RE.match(p))
        if role == "admin":
            perms = frozenset({"*"})
        return Caller(name, role, perms, "session")

    def malformed_session(self, headers: Any, now: float | None = None) -> bool:
        """The wall said "a signed-in browser" but its headers don't check out: refuse (never treat as anonymous)."""
        return self.trusted() and _hdr(headers, "x-auth-via") == "session" and self.caller(headers, now) is None

    def admin(self, request: Any) -> Caller | None:
        """A signed-in hub admin whose request may act (writes only from this site's own Origin), else None."""
        c = self.caller(request.headers)
        if not c or not c.admin or not same_origin(request):
            return None
        return c

    same_origin = staticmethod(same_origin)


# ---------------------------------------------------------------- signed-in hub *users* (the console's rules)
#
# With the wall on, any signed-in hub user may open the console. What a user can do is decided here, default-deny:
# the page itself, a short list of read-only framework data, and the routes of plugins an admin granted them.
# Everything else (every write, the terminal, secrets, alerts, the token, MCP) stays admin-only.

THEMES_PERM = "console.themes"
_FOLDER = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")

# GET routes any signed-in user may read (framework catalog data, no secrets, no host details).
USER_READ_PATHS = frozenset({
    "/api/health", "/api/me", "/api/catalog", "/api/tracker", "/api/libraries", "/api/boilerplates",
    "/api/boilerplates/items", "/api/app-defaults", "/api/plugin-index", "/api/modules", "/api/templates", "/api/ported-kits",
    "/api/library-templates", "/api/plan", "/api/pending", "/api/build-queue", "/api/plugins",
})
ADMIN_PAGES = ("/data/", "/panel")


def plugin_perm(folder: str) -> str:
    return f"console.plugin.{folder}"


def plugin_granted(caller: Caller, folder: str, wall_user_plugins: frozenset[str], grantable: frozenset[str]) -> bool:
    """A user reaches a plugin's routes only when the plugin is open to every user (wallUsers: it checks each user
    itself) or it says it is safe to hand to a user ("userGrantable": true) *and* the admin granted exactly
    console.plugin.<folder> (no wildcards: a wildcard must never open a plugin that wasn't meant for users)."""
    if caller.admin:
        return True
    if folder in wall_user_plugins:
        return True
    return folder in grantable and plugin_perm(folder) in caller.perms


def user_may(caller: Caller, method: str, path: str, wall_user_plugins: frozenset[str] = frozenset(),
             grantable: frozenset[str] = frozenset(), read_paths: frozenset[str] = USER_READ_PATHS,
             admin_pages: tuple[str, ...] = ADMIN_PAGES) -> bool:
    """May this signed-in hub *user* (not admin) make this request? Plugin routes: see plugin_granted."""
    if caller.admin:
        return True
    low = path.lower()
    if any(low == p.rstrip("/") or low.startswith(p) for p in admin_pages):
        return False  # the static data copies and the server panel are admins' (they hold what the API keeps back)
    if not (low == "/api" or low.startswith("/api/") or low == "/mcp" or low.startswith("/mcp/")):
        return True  # the page and its static files; every API below is checked
    if path.startswith("/api/plugins/"):
        folder = path[len("/api/plugins/"):].split("/", 1)[0]
        if not _FOLDER.match(folder) or "/." in path or "%" in path or "\\" in path:
            return False  # only a plain plugin folder name counts (no dot segments or encoded tricks)
        return plugin_granted(caller, folder, wall_user_plugins, grantable)
    return method.upper() in SAFE_METHODS and path.rstrip("/") in read_paths


def ui_role(caller: Caller) -> str:
    """The console's access-policy role for a caller (uac-policy asset `console-access`)."""
    if caller.admin:
        return "admin"
    return "themes" if caller.can(THEMES_PERM) else "user"
