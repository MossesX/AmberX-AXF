"""What the console core shares with its plugins' server parts (set by main.py before plugins load).

    import console_context as cx
    cx.ROOT, cx.current_token(), cx.persist_root(), cx.PLUGINS, cx.log(channel, text, level), cx.GITHUB_REPO,
    cx.terminal_lines()

Read-only by convention. Plugins never import main.py.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Callable

ROOT: Path = Path(".").resolve()
GITHUB_REPO = ""
PLUGINS: dict[str, dict[str, Any]] = {}
current_token: Callable[[], str] = lambda: ""  # noqa: E731
persist_root: Callable[[], Path | None] = lambda: None  # noqa: E731
log: Callable[..., None] = lambda *a, **k: None  # noqa: E731
plugin_enabled: Callable[[str], bool] = lambda folder: True  # noqa: E731
terminal_lines: Callable[[], list[dict[str, Any]]] = lambda: []  # noqa: E731 — copy of the console terminal (channel, level, text, at)


def set_context(**kw: Any) -> None:
    g = globals()
    for k, v in kw.items():
        if k not in g or k.startswith("_") or k == "set_context":
            raise KeyError(k)
        g[k] = v
