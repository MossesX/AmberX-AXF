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

Lazy loader (plugin-lazy@1, src/pluginLoader.tsx; Settings → Plugins → Plugin Manager → Lazy loader). These routes are
the REST / MCP / CLI surface too (plugin-commands@1 auto: `axf plugin-manager lazy`, MCP `plugin-manager_lazy…`):
    GET  /lazy                       the config + the open console's last live table (state, size, load time, uses)
    PUT  /lazy                       change it (partial: idle / cache / modes merge, lists replace); returns the config
    PUT  /lazy/plugin/{folder}       one plugin's mode: {"mode": "start" | "open" | "off"} (core plugins can't be off)
    POST /lazy/reset                 back to the defaults
    POST /lazy/report                the console's live table (sent by the loader)

Plugin settings (plugin-settings@1, server/plugin_settings.py): every plugin's Settings → Plugins sub-tab as data. The
REST / MCP / CLI surface of the default sections (enable, info, logs) and of each plugin's own options:
    GET  /settings                   every plugin's tab, address, sections, option keys, gear, enabled
    GET  /settings/{folder}          one plugin: + info (version, builtWith, dependencies) + its option specs
    PUT  /settings/{folder}          {"options": {key: value}}: each through console control `set` (owner-only refused)
    POST /settings/{folder}/enable   console control plugin.enable
    POST /settings/{folder}/disable  console control plugin.disable ({"force": true} past dependents)
    GET  /settings/{folder}/logs     its recent log lines (?limit=&level=)
"""
from __future__ import annotations

import json
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services

from . import inventory as inv
from . import lazy as lz
from . import plugin_settings as ps

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


def _lazy() -> lz.Store:
    return lz.Store(cx.ROOT / ".axf-console" / "plugins" / "plugin-manager")


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


@router.get("/lazy")
def lazy_get() -> dict[str, Any]:
    st = _lazy()
    return {"config": st.get(), "defaults": lz.normalize({}), "core": lz.CORE, "report": st.report()}


@router.put("/lazy")
def lazy_put(body: dict[str, Any]) -> dict[str, Any]:
    st = _lazy()
    patch = body.get("config", body) if isinstance(body, dict) else {}
    return {"ok": True, "config": st.put(lz.merge(st.get(), patch))}


@router.put("/lazy/plugin/{folder}")
def lazy_plugin(folder: str, body: dict[str, Any]) -> dict[str, Any]:
    folder = _folder(folder)
    mode = body.get("mode") if isinstance(body, dict) else None
    if mode not in lz.MODES:
        raise HTTPException(400, "mode is start, open or off")
    if mode == "off" and folder in lz.CORE:
        raise HTTPException(400, f"{folder} is a core plugin and can't be switched off")
    st = _lazy()
    cfg = st.get()
    cfg["modes"][folder] = mode
    return {"ok": True, "config": st.put(cfg)}


@router.post("/lazy/reset")
def lazy_reset() -> dict[str, Any]:
    return {"ok": True, "config": _lazy().reset()}


@router.post("/lazy/report")
def lazy_report(body: dict[str, Any]) -> dict[str, Any]:
    try:
        _lazy().save_report(body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    return {"ok": True}


# ---------------------------------------------------------------------- plugin settings (plugin-settings@1)

def _control() -> Any:
    """The console-control modules (server/console_control*.py); None in a bare test run."""
    try:
        import console_control as cc  # noqa: PLC0415
        import console_control_api as api  # noqa: PLC0415
        return cc, api
    except Exception:  # noqa: BLE001
        return None


def _inventory_settings() -> list[dict[str, Any]]:
    c = _control()
    try:
        return list((c[0].inventory().get("settings") or [])) if c else []
    except Exception:  # noqa: BLE001
        return []


def _manifest(folder: str) -> dict[str, Any]:
    m, _err = inv.read_manifest(_plugins_dir() / folder)
    if m is None:
        raise HTTPException(404, f"no plugin {folder}")
    return m


def _run(cmd: dict[str, Any]) -> dict[str, Any]:
    c = _control()
    if c is None:
        raise HTTPException(503, "console control isn't loaded")
    return c[1].run({"$axf": c[0].FRAME, **cmd}, by="plugin-settings", audience=c[1].OWNER)


@router.get("/settings")
def settings_index() -> dict[str, Any]:
    items = []
    for d in sorted(p for p in _plugins_dir().iterdir() if p.is_dir() and not p.name.startswith("_") and not p.is_symlink()):
        m, _err = inv.read_manifest(d)
        if m is not None:
            items.append(ps.summary(d.name, m, cx.plugin_enabled(d.name)))
    return {"$axf": ps.SCHEMA, "items": items}


@router.get("/settings/{folder}")
def settings_get(folder: str) -> dict[str, Any]:
    folder = _folder(folder)
    m = _manifest(folder)
    item = next((i for i in _inventory()["items"] if i["folder"] == folder), None)
    out = ps.detail(folder, m, item, _inventory_settings())
    c = _control()
    for o in out["optionSpecs"]:
        if c and o.get("runs") == "server":
            try:
                o["value"] = c[0].server_setting_value(c[0].setting_spec(o["address"]) or {})
            except Exception:  # noqa: BLE001 — a plugin that is off has no value to read
                o["value"] = None
    return out


@router.put("/settings/{folder}")
def settings_put(folder: str, body: dict[str, Any]) -> dict[str, Any]:
    folder = _folder(folder)
    m = _manifest(folder)
    declared = ps.normalize_settings(m, folder)["options"]
    opts, unknown = ps.bad_options(declared, body)
    if unknown:
        raise HTTPException(400, f"not an option of {m.get('name', folder)}: {', '.join(unknown)} (its options: {', '.join(declared) or 'none'})")
    specs = {o["key"]: o for o in ps.option_specs(declared, _inventory_settings())}
    results = {k: _run({"verb": "set", "address": specs[k]["address"], "value": v}) for k, v in opts.items()}
    return {"ok": all(r.get("ok") for r in results.values()), "folder": folder, "results": results}


def _toggle(folder: str, on: bool, body: dict[str, Any] | None) -> dict[str, Any]:
    folder = _folder(folder)
    m = _manifest(folder)
    force = bool((body or {}).get("force"))
    return _run({"verb": "plugin.enable" if on else "plugin.disable", "address": f"plugin:{m.get('id')}", **({"options": {"force": True}} if force else {})})


@router.post("/settings/{folder}/enable")
def settings_enable(folder: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return _toggle(folder, True, body)


@router.post("/settings/{folder}/disable")
def settings_disable(folder: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return _toggle(folder, False, body)


@router.get("/settings/{folder}/logs")
def settings_logs(folder: str, limit: int = 50, level: str = "") -> dict[str, Any]:
    return logs(folder, limit, level)
