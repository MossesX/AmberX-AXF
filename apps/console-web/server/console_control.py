"""Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the server half.

One address names any piece of the console (a screen, a tab, a setting, a button, a plugin, a grid row, a build step,
a scroll pane) and ten verbs read or drive it. The open console answers from its live target registry; this module
knows the console's static inventory (src/control/inventory.json, written by scripts/control-inventory.mjs) so it can
list, search and check addresses while no console is open.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
APP = HERE.parent
INVENTORY_FILE = APP / "src" / "control" / "inventory.json"
FRAME = "console-control@1"
TARGETS_FRAME = "console-control-targets@1"

_inventory: dict[str, Any] | None = None
_inventory_mtime = 0.0


def inventory() -> dict[str, Any]:
    """The static inventory (re-read when the file changes)."""
    global _inventory, _inventory_mtime
    try:
        m = INVENTORY_FILE.stat().st_mtime
    except OSError:
        return {"$axf": "console-control-inventory@1", "views": [], "nav": [], "tabGroups": [], "settings": [], "functions": [], "plugins": []}
    if _inventory is None or m != _inventory_mtime:
        _inventory = json.loads(INVENTORY_FILE.read_text(encoding="utf-8"))
        _inventory_mtime = m
    return _inventory


def _target(address: str, kind: str, label: str, **more: Any) -> dict[str, Any]:
    t: dict[str, Any] = {"address": address, "kind": kind, "label": label}
    t.update({k: v for k, v in more.items() if v not in (None, "", [], {})})
    if "/" in address and "parent" not in t:
        t["parent"] = address.rsplit("/", 1)[0]
    return t


def static_targets() -> list[dict[str, Any]]:
    """Every target the inventory knows, as console-control-targets@1 items (virtual: not rendered)."""
    inv = inventory()
    views = {v["id"]: v["label"] for v in inv.get("views", [])}
    out: list[dict[str, Any]] = []
    for v in inv.get("views", []):
        out.append(_target(v["address"], "view", v["label"], icon=v.get("icon"), keywords=v.get("keywords"), detail="Page" + (f" · {v['nav']}" if v.get("nav") else ""), virtual=True))
    for g in inv.get("tabGroups", []):
        if not g.get("address"):
            continue
        where = views.get(g.get("view") or "", "Console")
        out.append(_target(g["address"], "tab", f"{where} tabs", detail="Tab row", keywords=[g.get("id")], virtual=True,
                           tabs=[{"value": t["value"], "label": t["label"]} for t in g.get("tabs", [])]))
        for t in g.get("tabs", []):
            if t.get("address"):
                out.append(_target(t["address"], "tab", t["label"], detail=f"Tab · {where}", keywords=[t["value"], where], virtual=True))
    for key in ("settings", "functions", "plugins"):
        for t in inv.get(key, []) or []:
            if isinstance(t, dict) and t.get("address"):
                out.append({**t, "virtual": True})
    return out


def view_of(address: str) -> str | None:
    """The view an address lives in (its leading `view:` segment, or the tab row's view), else None."""
    m = re.match(r"^view:([^/]+)", address or "")
    if m:
        return m.group(1).replace("%2F", "/").replace("%25", "%")
    for g in inventory().get("tabGroups", []):
        a = g.get("address")
        if a and (address == a or address.startswith(a + "=") or address.startswith(a + "/")):
            return g.get("view")
    return None
