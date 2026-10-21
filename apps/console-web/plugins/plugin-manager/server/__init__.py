"""Plugin Manager server part. Mounted at /api/plugins/plugin-manager/ (console token on every method, 404 while off).

Read-only inventory of every console plugin. Enabling, disabling, installing and uninstalling go through the
console's own routes (/api/plugins/<folder>/enabled, /api/plugin-lifecycle/...), so they keep working even while
this plugin is off or removed. Never exposed through the console's MCP server (plugin rule).

    GET /inventory                   every plugin: manifest, status, parts, data, env (set/unset only), services,
                                     dependencies with details, dependents, conflicts, health, log counts
    GET /plugin/{folder}             one plugin's inventory entry + its file list + raw plugin.json
    GET /logs/{folder}?limit=&level= console terminal lines from or about that plugin
    GET /records                     the plain plugin-inventory@1 records + context (what the shared engine resolves:
                                     framework/core/engines/plugins.ts = Kotlin PluginInventoryEngine = server/engine.py)
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services

from . import inventory as inv

router = APIRouter()


def _plugins_dir():
    return cx.ROOT / "apps" / "console-web" / "plugins"


def _inventory() -> dict[str, Any]:
    return inv.build_inventory(
        plugins_dir=_plugins_dir(),
        root=cx.ROOT,
        table=cx.PLUGINS,
        is_enabled=cx.plugin_enabled,
        services=plugin_services.available(),
        terminal=cx.terminal_lines(),
        backups_dir=cx.ROOT / ".axf-console" / "plugin-backups",
    )


def _folder(folder: str) -> str:
    if not inv.FOLDER_RE.match(folder):
        raise HTTPException(400, "bad plugin folder")
    return folder


@router.get("/inventory")
def inventory() -> dict[str, Any]:
    return _inventory()


@router.get("/records")
def records() -> dict[str, Any]:
    """Unresolved facts, so any port (or a test) can run its own engine over this console's plugins."""
    live = plugin_services.available()
    out = []
    for folder in sorted(p for p in _plugins_dir().iterdir() if p.is_dir() and not p.name.startswith("_") and not p.is_symlink()):
        info = dict(cx.PLUGINS.get(folder.name, {}))
        info["_table"] = cx.PLUGINS
        rec, _ = inv.plugin_record(folder, cx.ROOT, info, cx.plugin_enabled(folder.name), live, dict(__import__("os").environ))
        out.append(rec)
    return {"frame": inv.engine.FRAME, "records": out, "context": inv.context(live)}


@router.get("/plugin/{folder}")
def plugin(folder: str) -> dict[str, Any]:
    folder = _folder(folder)
    data = _inventory()
    item = next((i for i in data["items"] if i["folder"] == folder), None)
    if not item:
        raise HTTPException(404, f"no plugin {folder}")
    path = _plugins_dir() / folder
    try:
        manifest = json.loads((path / "plugin.json").read_text())
    except (OSError, ValueError):
        manifest = None
    return {"item": item, "files": inv.file_list(path), "manifest": manifest,
            "conflicts": [c for c in data["conflicts"] if folder in c["folders"]]}


@router.get("/logs/{folder}")
def logs(folder: str, limit: int = 200, level: str = "") -> dict[str, Any]:
    folder = _folder(folder)
    name = (cx.PLUGINS.get(folder) or {}).get("name", "")
    if level and level not in ("info", "ok", "warn", "error"):
        raise HTTPException(400, "level is info, ok, warn or error")
    return {"folder": folder, "lines": inv.logs_for(cx.terminal_lines(), folder, name, limit, level)}
