"""Where a shipped feature lives in the console: its console-control@1 address, or why it has none.

A feature@1 record has no screen field, so the target is derived from what every record carries (plugin, files, the
name's "Area:" prefix, app) and checked against the console-control registry (the console's static inventory,
apps/console-web/src/control/inventory.json) before it is offered. Pure apart from reading the registry, so the REST
routes, the MCP commands, the CLI and voice all answer the same thing for the same record.

    open_target(feature, registry)  -> {"target": address, "label", "via", "status"}
                                     | {"target": None, "code", "reason", "status"}
"""
from __future__ import annotations

import json
import re
from collections import Counter
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parents[5]
INVENTORY = ROOT / "apps" / "console-web" / "src" / "control" / "inventory.json"

NOT_LIVE = ("planned", "queued", "building", "in-pr")
OPENABLE = ("merged", "live")
# apps that are not the console: a feature there has no console screen unless something else on it points into one
OTHER_APPS = {
    "amberx-droid": "the AmberX phone app", "axhub-android": "the axHub phone app", "axhub-web": "axHub web",
    "walkthrough-studio": "Walkthrough Studio", "walkthrough": "Walkthrough Studio", "voicevault": "VoiceVault", "demo": "the demo app",
}
CONSOLE_APPS = {"", "console", "console-web", "framework"}
PLUGIN_FILE = re.compile(r"^apps/console-web/plugins/([a-z0-9][a-z0-9-]*)/")
REASONS = {
    "not-live": "not landed yet",
    "cancelled": "the build was cancelled, so it never shipped",
    "removed": "this feature was removed",
    "no-screen": "it has no screen of its own (framework, tooling or docs)",
    "unknown-address": "its screen is not in the console any more",
    "not-found": "no such feature",
}


class Registry:
    """The console-control targets the open-target check accepts: views and plugins by address, label and folder."""

    def __init__(self, targets: list[dict[str, Any]]):
        self.addresses: dict[str, dict[str, Any]] = {}
        self.plugins: dict[str, dict[str, Any]] = {}
        self.labels: dict[str, str] = {}
        for t in targets:
            a = str(t.get("address") or "")
            if not a:
                continue
            self.addresses[a] = t
            kind = t.get("kind") or a.split(":", 1)[0]
            if kind == "plugin":
                for k in (t.get("folder"), t.get("id"), *(t.get("aliases") or [])):
                    if k:
                        self.plugins[str(k).lower()] = t
            if kind in ("view", "plugin") and t.get("label"):
                self.labels.setdefault(_key(str(t["label"])), a)

    def known(self, address: str) -> bool:
        return address in self.addresses

    def label(self, address: str) -> str:
        return str((self.addresses.get(address) or {}).get("label") or address)


def _key(s: str) -> str:
    return re.sub(r"[^a-z0-9]+", " ", s.lower()).strip()


def load_registry() -> Registry:
    """The console's registry: its console_control module when running in the console, else the inventory file."""
    try:
        import console_control  # the console server's module (absent when the plugin runs outside the console)
        return Registry(console_control.static_targets())
    except ImportError:
        pass
    try:
        inv = json.loads(INVENTORY.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return Registry([])
    views = [{"address": v["address"], "kind": "view", "label": v.get("label", "")} for v in inv.get("views", []) if v.get("address")]
    rest = [t for k in ("settings", "functions", "buttons", "plugins") for t in inv.get(k, []) or [] if isinstance(t, dict) and t.get("address")]
    return Registry(views + rest)


def _plugin_place(reg: Registry, folder: str) -> tuple[str, str] | None:
    """A plugin's own screen (its view), else its Settings → Plugins sub-tab: (address, label)."""
    p = reg.plugins.get(folder.lower())
    if not p:
        return None
    view = str(p.get("view") or "")
    if view:
        return view, reg.label(view) if reg.known(view) else str(p.get("label") or folder)
    tab = str(p.get("settingsTab") or "")
    if tab:
        return tab, f"Settings › Plugins › {p.get('label') or folder}"
    return None


def _candidates(f: dict[str, Any]) -> list[tuple[str, str]]:
    """(how, value) pairs to try, best first."""
    out: list[tuple[str, str]] = []
    if f.get("plugin"):
        out.append(("plugin", str(f["plugin"])))
    folders = Counter(m.group(1) for p in f.get("files") or [] if (m := PLUGIN_FILE.match(str(p))))
    for folder, _ in folders.most_common(1):
        out.append(("files", folder))
    name = str(f.get("name") or "")
    if ":" in name[:60]:
        out.append(("name", name.split(":", 1)[0]))
    if f.get("app") and f["app"] not in CONSOLE_APPS and f["app"] not in OTHER_APPS:
        out.append(("app", str(f["app"])))
    return out


def open_target(f: dict[str, Any] | None, reg: Registry) -> dict[str, Any]:
    """Where to open one feature@1 record, or why it can't be opened."""
    if not f:
        return {"target": None, "code": "not-found", "reason": REASONS["not-found"], "status": ""}
    status = str(f.get("status") or "")
    base = {"feature": f.get("id"), "name": f.get("name"), "status": status}

    def no(code: str, reason: str = "") -> dict[str, Any]:
        return {**base, "target": None, "code": code, "reason": reason or REASONS[code]}

    if status in NOT_LIVE:
        return no("not-live")
    if status in ("cancelled", "removed"):
        return no(status)
    missing = ""
    for how, value in _candidates(f):
        place: tuple[str, str] | None = None
        if how in ("plugin", "files"):
            place = _plugin_place(reg, value)
            if place is None and how == "plugin":
                missing = f"plugin:{value}"
        elif how == "name":
            a = reg.labels.get(_key(value))
            place = (a, reg.label(a)) if a else None
        elif how == "app":
            a = f"view:{value}"
            place = (a, reg.label(a)) if reg.known(a) else None
        if place is None:
            continue
        address, label = place
        if not reg.known(address) and not address.startswith("view:settings/"):
            missing = address
            continue
        return {**base, "target": address, "label": label, "via": how}
    if missing:
        return no("unknown-address", f"its screen ({missing}) is not in the console any more")
    app = str(f.get("app") or "")
    if app in OTHER_APPS:
        return no("no-screen", f"it lives in {OTHER_APPS[app]}, not the console")
    return no("no-screen")
