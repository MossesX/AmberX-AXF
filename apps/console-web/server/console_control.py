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


# ---------------------------------------------------------------------- answers

STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "ambiguous": 409, "confirmation_required": 409,
          "unavailable": 503, "not_implemented": 501, "unexpected": 500}


class ControlError(Exception):
    """A console-control failure with its wire code (CONSOLE-CONTROL.md → Answers)."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra

    def envelope(self) -> dict[str, Any]:
        return {"$axf": FRAME, "ok": False, "code": self.code, "message": self.message, **self.extra}


def ok(verb: str, address: str | None = None, **data: Any) -> dict[str, Any]:
    return {"$axf": FRAME, "ok": True, "verb": verb, **({"address": address} if address else {}), **data}


# ---------------------------------------------------------------------- settings

TRUE_WORDS = {"on", "true", "yes", "1", "enable", "enabled"}
FALSE_WORDS = {"off", "false", "no", "0", "disable", "disabled"}


def setting_spec(address_or_key: str) -> dict[str, Any] | None:
    """A setting from the inventory by full address, short `setting:<key>` form or bare key."""
    a = address_or_key or ""
    key = a.rsplit("setting:", 1)[-1] if "setting:" in a else a
    key = key.replace("%2F", "/").replace("%25", "%")
    for s in inventory().get("settings", []) or []:
        if s.get("address") == a or s.get("key") == key:
            return s
    return None


def validate_setting(spec: dict[str, Any], value: Any, current: Any = None) -> Any:
    """The value a setting accepts (type, range and choice checked), else ControlError(validation). Mirrors the console's
    consoleFieldValue so a REST / MCP / CLI set fails the same way as a set in the open console."""
    kind = str(spec.get("type") or "text")
    label = spec.get("label") or spec.get("key")
    if kind in ("secret",):
        raise ControlError("validation", f"{label} is a secret: it is never set from a command", problems=["secret"])
    if kind in ("action", "link", "section", "custom", "asset_slot"):
        raise ControlError("not_implemented", f"{label} is not a value (press it instead)", can=["open", "state", "focus"])
    if kind == "toggle":
        if isinstance(value, bool):
            return value
        w = str(value).strip().lower()
        if w == "toggle":
            return not bool(current)
        if w in TRUE_WORDS:
            return True
        if w in FALSE_WORDS:
            return False
        raise ControlError("validation", f"{label} is on or off, not {value!r}", problems=["not a toggle value"])
    if kind in ("number", "slider"):
        try:
            n = float(value)
        except (TypeError, ValueError):
            raise ControlError("validation", f"{label} takes a number, not {value!r}", problems=["not a number"]) from None
        lo, hi = spec.get("min"), spec.get("max")
        if lo is not None and n < lo or hi is not None and n > hi:
            raise ControlError("validation", f"{label} must be between {lo if lo is not None else '-∞'} and {hi if hi is not None else '∞'}, not {value}", problems=["out of range"])
        return int(n) if n == int(n) else n
    if kind == "choice":
        opts = spec.get("options") or []
        v = str(value).strip()
        hit = next((o for o in opts if o.lower() == v.lower()), None)
        if opts and hit is None:
            raise ControlError("validation", f"{label} is one of {', '.join(opts)}, not {value!r}", problems=["not a choice"])
        return hit or v
    if kind == "multi_choice":
        items = value if isinstance(value, list) else [x.strip() for x in str(value).split(",") if x.strip()]
        opts = spec.get("options") or []
        bad = [x for x in items if opts and x not in opts]
        if bad:
            raise ControlError("validation", f"{label}: {', '.join(bad)} is not a choice ({', '.join(opts)})", problems=["not a choice"])
        return items
    if kind == "time":
        v = str(value).strip()
        if not re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", v):
            raise ControlError("validation", f"{label} is a time like 21:30, not {value!r}", problems=["not a time"])
        return v
    return "" if value is None else str(value)


def refuse_person_only(spec: dict[str, Any], value: Any = None, current: Any = None) -> None:
    """Owner-only settings change only from Brett's own click: never a command (CONTROL.md personOnly)."""
    label = spec.get("label") or spec.get("key")
    if spec.get("locked"):
        raise ControlError("unavailable", f"{label} is locked: nobody changes it", because="locked")
    if spec.get("personOnly"):
        raise ControlError("denied", f"{label} is owner-only: only Brett's own click in the console changes it", requires="person", personOnly=True)
    if spec.get("ownerRaise") and current is not None and value is not None:
        try:
            raising = (value is True and current is False) or float(value) > float(current)
        except (TypeError, ValueError):
            raising = False
        if raising:
            raise ControlError("denied", f"{label} can only be lowered from a command; only Brett raises it", requires="person", personOnly=True)


def _service(name: str) -> Any:
    try:
        import plugin_services  # the console's capability registry
        return plugin_services.get(name)
    except Exception:  # noqa: BLE001 — tests run without the console
        return None


def server_setting_value(spec: dict[str, Any]) -> Any:
    svc = _service(str(spec.get("service") or ""))
    if svc is None:
        raise ControlError("unavailable", f"{spec.get('label')} lives in a plugin that is turned off", because="plugin off")
    view = svc.get() or {}
    for s in view.get("settings") or []:
        if s.get("key") == spec.get("key"):
            return s.get("value")
    return (view.get("values") or {}).get(spec.get("key"))


def setting_state(spec: dict[str, Any]) -> dict[str, Any]:
    st: dict[str, Any] = {"address": spec["address"], "kind": "setting", "label": spec.get("label"), "type": spec.get("type"),
                          **{k: spec[k] for k in ("options", "min", "max", "personOnly", "ownerRaise", "locked", "requires") if k in spec}}
    if spec.get("runs") == "server":
        st["value"] = server_setting_value(spec)
        st["can"] = ["open", "state", "focus"] + ([] if spec.get("personOnly") or spec.get("locked") else ["set"])
    return st


def set_server_setting(spec: dict[str, Any], value: Any, by: str) -> dict[str, Any]:
    """Change a server-side setting without a browser (the plugin's own service applies its rules too)."""
    current = server_setting_value(spec)
    refuse_person_only(spec, value, current)
    v = validate_setting(spec, value, current)
    refuse_person_only(spec, v, current)
    svc = _service(str(spec.get("service")))
    r = svc.set({spec["key"]: v}, by or "console-control")
    if not r.get("ok", True):
        raise ControlError(str(r.get("code") or "denied"), str(r.get("message") or "refused"))
    return ok("set", spec["address"], changed=[spec["address"]], value=v)
