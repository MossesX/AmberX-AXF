"""What the console core shares with its plugins' server parts (set by main.py before plugins load).

    import console_context as cx
    cx.ROOT, cx.current_token(), cx.persist_root(), cx.data_path(rel), cx.build_profile(), cx.PLUGINS, cx.set_plugin_enabled(folder, on), cx.log(channel, text, level), cx.GITHUB_REPO,
    cx.terminal_lines(), cx.raise_alert({source, severity, title, body?, key?, link?}), cx.resolve_alerts([keys])

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
# Build profiles (build-profiles@1): data_path(rel) = where the active profile keeps a shared work file (pending, plan,
# queue, status, tracker, plan media); other shared files resolve as before. build_profile() = the active profile.
data_path: Callable[[str], Path] = lambda rel: ROOT / rel  # noqa: E731
build_profile: Callable[[], dict[str, Any]] = lambda: {"id": "main-framework", "name": "Main framework", "base": True}  # noqa: E731
log: Callable[..., None] = lambda *a, **k: None  # noqa: E731
plugin_enabled: Callable[[str], bool] = lambda folder: True  # noqa: E731
# Switch a plugin on/off, as the admin's Settings → Plugins switch does (the systems check's Auto fix for a plugin
# another one needs). No-op until main.py wires it.
set_plugin_enabled: Callable[[str, bool], None] = lambda folder, on: None  # noqa: E731
terminal_lines: Callable[[], list[dict[str, Any]]] = lambda: []  # noqa: E731 — copy of the console terminal (channel, level, text, at)
# Developer alerts (alert@1, server/alerts.py): one alert per key, a repeat overwrites it instead of adding another.
# No-ops until main.py wires the alert hub (it is created after the plugins load); plugins call them at request time.
raise_alert: Callable[[dict[str, Any]], dict[str, Any]] = lambda inp: {}  # noqa: E731
resolve_alerts: Callable[[list[str]], None] = lambda keys: None  # noqa: E731


def set_context(**kw: Any) -> None:
    g = globals()
    for k, v in kw.items():
        if k not in g or k.startswith("_") or k == "set_context":
            raise KeyError(k)
        g[k] = v
