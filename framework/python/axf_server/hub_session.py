"""Who asks axHub (axHub decision 109, Nov 1 2026): the `X-Axhub-Session` header every axHub MCP caller here sends.

Brett: every approval just said "vps.run"; he wants to know WHO asked. The hub derives the source (Claude.ai, Claude Code,
headless build, console, agent, system) from the sign-in, the MCP clientInfo and this header, and shows it on every
approval. Values here:

- the console's own token caller (GitHub link, build manager, systems check): ``console``;
- an agent (Vinny, Mosses, …) calling through ``axhub_call``: ``agent:<agent name>``;
- a headless build: its ``--name`` from ``AXF_SESSION`` (deploy/claude-headless.sh sets it; Claude Code sends it through
  ``.mcp.json``).

The hub takes only ``^[A-Za-z0-9][A-Za-z0-9._:-]{0,59}$`` and drops anything else, so values are made to fit here
(other characters become ``-``, at most 60). The name is the caller's word: shown on the approval, never used for access.
"""
from __future__ import annotations

import contextvars
import re
from typing import Iterator
from contextlib import contextmanager

HEADER = "x-axhub-session"
PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,59}\Z")
CONSOLE = "console"

_current: contextvars.ContextVar[str] = contextvars.ContextVar("axhub_session", default="")


def session_value(name: object, prefix: str = "") -> str:
    """`name` made to fit the hub's pattern (with an optional `agent:` / `build:` prefix), or "" when nothing is left."""
    raw = re.sub(r"[^A-Za-z0-9._-]+", "-", str(name or "")).strip("-._")
    if not raw:
        return ""
    value = f"{prefix}:{raw}" if prefix else raw
    value = value[:60].rstrip("-._:")
    return value if PATTERN.match(value) else ""


def agent_session(agent_name: object) -> str:
    """`agent:<name>` for an agent's calls (e.g. ``agent:Vinny``)."""
    return session_value(agent_name, "agent")


def headers(value: str | None = None) -> dict[str, str]:
    """The header for `value` (else the one set by :func:`acting_as`, else ``console``), or {} when it doesn't fit."""
    v = value if value is not None else (_current.get() or CONSOLE)
    return {HEADER: v} if v and PATTERN.match(v) else {}


@contextmanager
def acting_as(value: str) -> Iterator[None]:
    """Calls to axHub inside this block say `value` (an agent's turn: ``agent:<name>``)."""
    token = _current.set(value if value and PATTERN.match(value) else "")
    try:
        yield
    finally:
        _current.reset(token)
