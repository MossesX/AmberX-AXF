"""Plugin services: how console plugins work together without naming each other.

A plugin *provides* a service under a versioned capability name (``axf.agents@1``, ``axf.llm@1`` …) and another
plugin *looks it up* by that name at request time. ``get`` returns None when no installed, enabled plugin provides
it, so every integration is optional by construction and uninstalling either side leaves no dangling code.

    import plugin_services
    plugin_services.provide("axf.llm@1", MyLlm(), folder="ai-assistant")   # at import time of the provider
    llm = plugin_services.get("axf.llm@1")                                  # at request time of the consumer
    if llm: ...

Names are capabilities, never plugin folders. The console wires ``configure`` to its enabled check (main.py).
"""
from __future__ import annotations

from typing import Any, Callable

_services: dict[str, tuple[str, Any]] = {}
_is_enabled: Callable[[str], bool] = lambda folder: True  # noqa: E731 — replaced by main.py


def configure(is_enabled: Callable[[str], bool]) -> None:
    global _is_enabled
    _is_enabled = is_enabled


def provide(name: str, impl: Any, folder: str) -> None:
    """Register (or replace) the provider of a capability. Last provider wins; the folder is kept for the enabled check."""
    _services[name] = (folder, impl)


def withdraw(folder: str) -> None:
    """Drop every service a plugin provides (used when its code is uninstalled while the console runs)."""
    for name in [n for n, (f, _) in _services.items() if f == folder]:
        _services.pop(name, None)


def get(name: str) -> Any | None:
    entry = _services.get(name)
    if not entry:
        return None
    folder, impl = entry
    try:
        return impl if _is_enabled(folder) else None
    except Exception:  # noqa: BLE001
        return None


def available() -> list[dict[str, Any]]:
    return [{"name": n, "folder": f, "enabled": bool(_is_enabled(f))} for n, (f, _) in sorted(_services.items())]
