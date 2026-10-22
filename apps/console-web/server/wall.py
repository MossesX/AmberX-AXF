"""Who is calling, when the console sits behind axHub's sign-in wall — the console's face of `axf_server.wall`.

The scheme, the Caller and the user rules live in the framework (framework/python/axf_server/wall.py, fixture
framework/spec/fixtures/wall-signature.json); this module binds them to the console's env prefix `AXF_`
(AXF_WALL_SECRET = AXHUB_WALL_SECRET on the hub, AXF_TRUST_WALL=1 set by the installer) and keeps the names main.py
and plugins have always used (`import wall`; `wall.wall_caller(headers)`, `wall.Caller`, `wall.user_may`, …).

- A wall **admin** is treated like the console token (so a signed-in browser needs no pasted token).
- A wall **user** may open the console; what they reach is decided by `user_may`: the page, read-only framework data,
  `"wallUsers": true` plugins (which decide per user) and `"userGrantable"` plugins an admin granted; a plugin decides
  what they may do from `request.state.axf_user` (name, role, perms).
- Browser-session requests that change something must come from the console's own origin.
"""
from __future__ import annotations

from typing import Any

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server.wall import (  # noqa: F401 — re-exported for main.py and plugins
    ADMIN_PAGES, MAX_AGE_S, SAFE_METHODS, THEMES_PERM, TOKEN_CALLER, USER_READ_PATHS, Caller, Wall, caller_of,
    plugin_granted, plugin_perm, same_origin, ui_role, user_may,
)

WALL = Wall("AXF_")


def trusted() -> bool:
    return WALL.trusted()


def signature_ok(sig: str, user: str, role: str, perms: str, host: str, now: float | None = None) -> bool:
    """Checks axHub's `v1.<ts>.<hex>` over `v1|ts|user|role|perms|host` (constant-time, recent, this host)."""
    return WALL.signature_ok(sig, user, role, perms, host, now)


def wall_caller(headers: Any) -> Caller | None:
    """The signed-in person from the wall's headers, or None (wall off, not a session, malformed)."""
    return WALL.caller(headers)


def malformed_session(headers: Any) -> bool:
    """The wall said "a signed-in browser" but its headers don't parse: refuse (never fall back to anonymous)."""
    return WALL.malformed_session(headers)
