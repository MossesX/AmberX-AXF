"""Who is calling. Brett's own click = a signed-in hub admin session through the wall (via "session"); the console
token (agents, MCP, CLI) is a machine. personOnly actions refuse a machine."""
from __future__ import annotations

from typing import Any

from .core import PhoneError


def caller(request: Any) -> tuple[str, bool]:
    """(name, is_person) for a request."""
    u = getattr(getattr(request, "state", None), "axf_user", None)
    if u is None:
        return "console-token", False
    name = str(getattr(u, "name", "") or "")
    via = str(getattr(u, "via", "token") or "token")
    admin = bool(getattr(u, "admin", False))
    return name or "console-token", via == "session" and admin


def require_person(request: Any, what: str) -> str:
    name, person = caller(request)
    if not person:
        raise PhoneError("denied", f"{what} is Brett's own decision: only his signed-in hub session does it, never a command.", requires="person", personOnly=True)
    return name
