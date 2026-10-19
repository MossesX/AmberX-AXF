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


# ---------------------------------------------------------------- signed-in hub *users* in the console (Oct 18 2026)
#
# With the wall on, any signed-in hub user may open the console (the installer passes user_paths=/). What a user can
# do is decided here, default-deny: the page itself, a short list of read-only framework data, and the routes of
# plugins an admin granted them on the hub's users page. Everything else (every write, the terminal, secrets, alerts,
# the token, MCP) stays admin-only.

THEMES_PERM = "console.themes"
_FOLDER = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")


def plugin_perm(folder: str) -> str:
    return f"console.plugin.{folder}"


# GET routes any signed-in user may read (framework catalog data, no secrets, no host details).
USER_READ_PATHS = frozenset({
    "/api/health", "/api/me", "/api/catalog", "/api/tracker", "/api/libraries", "/api/boilerplates",
    "/api/boilerplates/items", "/api/plugin-index", "/api/modules", "/api/templates", "/api/ported-kits",
    "/api/library-templates", "/api/plan", "/api/pending", "/api/build-queue", "/api/plugins",
})


def user_may(caller: Caller, method: str, path: str, wall_user_plugins: frozenset[str] = frozenset()) -> bool:
    """May this signed-in hub *user* (not admin) make this request? Plugin routes: granted or wallUsers plugins."""
    if caller.admin:
        return True
    if not (path == "/api" or path.startswith("/api/") or path == "/mcp" or path.startswith("/mcp/")):
        return True  # the page and its static files; every API below is checked
    if path.startswith("/api/plugins/"):
        folder = path[len("/api/plugins/"):].split("/", 1)[0]
        if not _FOLDER.match(folder) or "/." in path or "%" in path or "\\" in path:
            return False  # only a plain plugin folder name counts (no dot segments or encoded tricks)
        return folder in wall_user_plugins or caller.can(plugin_perm(folder))
    return method.upper() in SAFE_METHODS and path.rstrip("/") in USER_READ_PATHS


def ui_role(caller: Caller) -> str:
    """The console's access-policy role for a caller (uac-policy asset `console-access`)."""
    if caller.admin:
        return "admin"
    return "themes" if caller.can(THEMES_PERM) else "user"
