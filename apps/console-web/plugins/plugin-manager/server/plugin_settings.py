"""plugin-settings@1 on the server: every plugin's Settings → Plugins sub-tab as data (pure, IO-free).

Python twin of framework/core/plugin-settings.mjs (defaultSettings, normalizeSettings, settingsAddress, settingsTarget);
it replays framework/spec/fixtures/plugin-settings.json in test.py. The routes in __init__.py use it so REST, MCP
(plugin-commands@1 auto) and the CLI read and change a plugin's default sections (enable, info, logs) and its own
options without a browser:

    GET  /settings                     every plugin: tab, address, sections, option keys, gear, enabled
    GET  /settings/{folder}            one plugin: the above + info (version, builtWith, dependencies) + option states
    PUT  /settings/{folder}            {"options": {"<key>": value, …}}  set its own options (console-control set)
    POST /settings/{folder}/enable     switch it on    (console-control plugin.enable)
    POST /settings/{folder}/disable    switch it off   (console-control plugin.disable; {"force": true} past dependents)
    GET  /settings/{folder}/logs       its recent log lines (?limit=&level=)
"""
from __future__ import annotations

import re
from typing import Any

SCHEMA = "plugin-settings@1"
PARENT = "plugins"
DEFAULT_SECTIONS = ("enable", "info", "logs")
TAB_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
SETTINGS_VIEW = "view:settings"
SETTINGS_TAB_ROW = "settings.tabs"
SETTINGS_SUBTAB_ROW = "settings.subtabs"


def _provides(m: Any) -> list[str]:
    p = m.get("provides") if isinstance(m, dict) else None
    return [x for x in p if isinstance(x, str)] if isinstance(p, list) else []


def plugin_views(m: Any) -> list[str]:
    return [p[5:] for p in _provides(m) if p.startswith("view:")]


def plugin_settings_tabs(m: Any) -> list[str]:
    return [p[13:] for p in _provides(m) if p.startswith("settings-tab:")]


def has_screen(m: Any) -> bool:
    return bool(plugin_views(m))


def _short(folder: str) -> str:
    parts = [x for x in str(folder or "").split("/") if x]
    return parts[-1] if parts else ""


def default_settings(m: Any, folder: str = "") -> dict[str, Any]:
    tabs = plugin_settings_tabs(m)
    tab = tabs[0] if tabs else _short(folder)
    return {"$axf": SCHEMA, "tab": tab, "parent": PARENT, "sections": list(DEFAULT_SECTIONS), "options": [], "gear": has_screen(m)}


def normalize_settings(m: Any, folder: str = "") -> dict[str, Any]:
    d = default_settings(m, folder)
    s = m.get("settings") if isinstance(m, dict) and isinstance(m.get("settings"), dict) else {}
    sections = s.get("sections") if isinstance(s.get("sections"), list) else d["sections"]
    return {
        "$axf": SCHEMA,
        "tab": s["tab"] if isinstance(s.get("tab"), str) and s.get("tab") else d["tab"],
        "parent": PARENT if "parent" not in s else s["parent"],
        "sections": list(DEFAULT_SECTIONS) + [x for x in sections if x not in DEFAULT_SECTIONS],
        "options": list(s["options"]) if isinstance(s.get("options"), list) else d["options"],
        "gear": s["gear"] if isinstance(s.get("gear"), bool) else d["gear"],
    }


def settings_address(tab: str) -> str:
    if not isinstance(tab, str) or not TAB_ID.match(tab):
        raise ValueError(f"bad settings tab id {tab!r}")
    return f"{SETTINGS_VIEW}/tab:{SETTINGS_TAB_ROW}={PARENT}/subtab:{SETTINGS_SUBTAB_ROW}={tab}"


def settings_target(m: Any, folder: str = "") -> dict[str, Any]:
    s = normalize_settings(m, folder)
    tab = s["tab"] if isinstance(s["tab"], str) and TAB_ID.match(s["tab"]) else default_settings(m, folder)["tab"]
    ok = isinstance(tab, str) and bool(TAB_ID.match(tab))
    name = m.get("name") if isinstance(m, dict) and isinstance(m.get("name"), str) and m.get("name") else tab
    return {"tab": tab, "address": settings_address(tab) if ok else "", "action": f"settings.open:{tab}" if ok else "", "label": f"{name} settings", "gear": s["gear"]}


def option_specs(options: list[str], inventory_settings: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Each declared option key with its console-control setting (address, label, type, runs) when the inventory has it."""
    by_key = {s.get("key"): s for s in inventory_settings if isinstance(s, dict)}
    out = []
    for k in options:
        s = by_key.get(k)
        if s is None:
            out.append({"key": k, "address": f"setting:{k}", "known": False})
            continue
        out.append({"key": k, "known": True, **{f: s[f] for f in ("address", "label", "type", "runs", "options", "min", "max", "personOnly", "ownerRaise", "locked") if f in s}})
    return out


def summary(folder: str, manifest: dict[str, Any] | None, enabled: bool) -> dict[str, Any]:
    """One plugin's row in GET /settings."""
    m = manifest or {}
    s = normalize_settings(m, folder)
    t = settings_target(m, folder)
    return {"folder": folder, "id": m.get("id"), "name": m.get("name") or folder, "enabled": enabled, "tab": t["tab"], "address": t["address"],
            "action": t["action"], "sections": s["sections"], "options": s["options"], "gear": s["gear"], "declared": isinstance(m.get("settings"), dict)}


def detail(folder: str, manifest: dict[str, Any] | None, item: dict[str, Any] | None, inventory_settings: list[dict[str, Any]]) -> dict[str, Any]:
    """GET /settings/{folder}: the summary + info (plugin-inventory@1 item) + each option's console-control spec."""
    it = item or {}
    m = manifest or {}
    out = summary(folder, m, bool(it.get("enabled")))
    out["info"] = {
        "version": m.get("version"), "description": m.get("description", ""), "builtWith": m.get("builtWith") or None,
        "health": it.get("health"), "dependencies": it.get("dependencies", []), "dependents": it.get("dependents", []),
    }
    out["optionSpecs"] = option_specs(out["options"], inventory_settings)
    return out


def bad_options(declared: list[str], body: Any) -> tuple[dict[str, Any], list[str]]:
    """The {key: value} map of a PUT body and the keys the plugin doesn't declare (refused, never set)."""
    opts = body.get("options", body) if isinstance(body, dict) else {}
    if not isinstance(opts, dict):
        return {}, ["options is an object {key: value}"]
    unknown = [k for k in opts if k not in declared]
    return opts, unknown
