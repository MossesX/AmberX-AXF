"""A plugin's own options as a server-run settings service (plugin-settings@1 options, console-control@1 `set`).

Brett, Nov 16 2026: "They all need a settings page. They all need a settings interface." Many plugins keep their
options in their own config file behind GET/PUT /config. This turns that config into the service console control
reads and writes (`runs: server`), so the options listed in plugin.json `settings.options` are read and set without a
browser through REST (the Plugin Manager's settings routes), MCP, the CLI and voice, with the plugin's own
validation:

    plugin_options.provide("brand-library", read=lambda: get_config(), write=lambda patch: put_config(patch),
                           fields={"brand-library.tab": "tab", "brand-library.tile": "tile"})

The plugin also lists each key in its `registry.json` (claude-settings-registry@1 entries with "service" set to the
name below), which is how scripts/control-inventory.mjs gives every option its `setting:` address, label and type.
Owner-only keys (`owner: true` there) are refused by console control before this is ever called.
"""
from __future__ import annotations

from typing import Any, Callable

import plugin_services


def service_name(folder: str) -> str:
    """The service a plugin's options run through (registry.json "service")."""
    return f"axf.plugin-options.{folder}@1"


class ConfigOptions:
    """get() → {"values": {key: value}}; set({key: value}, by) → {"ok": True} (console_control.server_setting_value / set)."""

    def __init__(self, read: Callable[[], dict[str, Any]], write: Callable[[dict[str, Any]], Any], fields: dict[str, str]) -> None:
        self.read, self.write, self.fields = read, write, dict(fields)

    def get(self) -> dict[str, Any]:
        c = self.read() or {}
        return {"values": {k: c.get(f) for k, f in self.fields.items()}}

    def set(self, patch: dict[str, Any], by: str = "") -> dict[str, Any]:
        unknown = [k for k in patch if k not in self.fields]
        if unknown:
            return {"ok": False, "code": "not_found", "message": f"not an option here: {', '.join(unknown)}"}
        before = self.read() or {}
        try:
            out = self.write({self.fields[k]: v for k, v in patch.items()}) or {}
        except Exception as e:  # noqa: BLE001 — the plugin refused the value (ValueError, its route's HTTPException …)
            return {"ok": False, "code": "validation", "message": str(getattr(e, "detail", "") or e) or "refused by the plugin"}
        # the plugin's own clean-up drops a bad value and keeps the old one: say so instead of reporting success
        rejected = [k for k, v in patch.items() if isinstance(out, dict) and self.fields[k] in out and out[self.fields[k]] != v and out[self.fields[k]] == before.get(self.fields[k])]
        if rejected:
            return {"ok": False, "code": "validation", "message": f"refused by the plugin: {', '.join(rejected)}"}
        return {"ok": True}


def provide(folder: str, read: Callable[[], dict[str, Any]], write: Callable[[dict[str, Any]], Any], fields: dict[str, str]) -> ConfigOptions:
    svc = ConfigOptions(read, write, fields)
    plugin_services.provide(service_name(folder), svc, folder)
    return svc
