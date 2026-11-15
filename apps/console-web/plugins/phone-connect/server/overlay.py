"""The phone's overlay, set in the console and synced live (phone-overlay@1; the phone parses the same ranges in
OverlayConfig.kt). Toolbar buttons and widgets, each popup type's look and motion, and the button itself. Presets are
named starting points; saving one copies it in.
"""
from __future__ import annotations

import copy
import re
from typing import Any

from .core import PhoneError, own_domain

FRAME = "phone-overlay@1"
POSITIONS = ("top", "bottom", "center", "top-left", "top-right", "bottom-left", "bottom-right", "from-button")
ANIMATIONS = ("slide-top", "burst", "circle", "fade", "scale", "bounce")
SIZES = ("small", "medium", "large")
SHAPES = ("circle", "rounded", "square")
KINDS = ("button", "widget")
POPUP_KINDS = ("approval", "alert", "notification")
ACTIONS = ("approvals", "recorder", "recorder:start", "recorder:stop", "notifications", "build-status")
ID_RE = re.compile(r"^[a-z0-9-]{1,40}$")
MAX_ITEMS = 12

DEFAULT: dict[str, Any] = {
    "$axf": FRAME,
    "items": [
        {"id": "approvals", "kind": "button", "icon": "check", "label": "Approvals", "action": "approvals"},
        {"id": "recorder", "kind": "button", "icon": "mic", "label": "Recorder", "action": "recorder"},
        {"id": "notifications", "kind": "button", "icon": "bell", "label": "Notifications", "action": "notifications"},
        {"id": "build", "kind": "widget", "icon": "hammer", "label": "Build", "action": "build-status"},
        {"id": "assistant", "kind": "button", "icon": "sparkles", "label": "Assistant", "action": "open:https://console.amberxai.com/api/plugins/ai-assistant/app"},
        {"id": "console", "kind": "button", "icon": "monitor", "label": "Console", "action": "open:https://console.amberxai.com/"},
    ],
    "popups": {
        "approval": {"position": "center", "enter": "scale", "exit": "fade", "speedMs": 260, "size": "medium", "stayMs": 0, "sound": True, "vibrate": True, "opacity": 1.0},
        "alert": {"position": "top", "enter": "slide-top", "exit": "fade", "speedMs": 260, "size": "medium", "stayMs": 10000, "sound": True, "vibrate": True, "opacity": 1.0},
        "notification": {"position": "top", "enter": "fade", "exit": "fade", "speedMs": 260, "size": "medium", "stayMs": 6000, "sound": False, "vibrate": True, "opacity": 1.0},
    },
    "buttonSize": 56, "buttonShape": "circle", "edgeSnap": True, "autoCollapseMs": 6000, "toolbarOpacity": 1.0,
}


def _preset(**changes: Any) -> dict[str, Any]:
    d = copy.deepcopy(DEFAULT)
    for k, v in changes.items():
        if k == "popups":
            for kind, p in v.items():
                d["popups"][kind].update(p)
        else:
            d[k] = v
    return d


PRESETS: dict[str, dict[str, Any]] = {
    "default": {"label": "Default", "config": copy.deepcopy(DEFAULT)},
    "quiet": {"label": "Quiet", "config": _preset(popups={k: {"sound": False, "vibrate": False, "enter": "fade"} for k in POPUP_KINDS}, buttonSize=44, toolbarOpacity=0.8)},
    "loud": {"label": "Loud", "config": _preset(popups={"approval": {"enter": "burst", "size": "large"}, "alert": {"enter": "bounce", "size": "large", "stayMs": 0}}, buttonSize=64)},
    "minimal": {"label": "Minimal", "config": _preset(items=[DEFAULT["items"][0], DEFAULT["items"][1]], buttonShape="rounded", autoCollapseMs=3000)},
}


def _action_ok(a: str) -> bool:
    if a in ACTIONS:
        return True
    if a.startswith("open:https://"):
        host = a[len("open:https://"):].split("/", 1)[0].lower()
        return ":" not in host and "@" not in host and own_domain(host)
    return False


def validate(cfg: Any) -> dict[str, Any]:
    """A full config, checked. Raises PhoneError(validation) naming the first bad field."""
    if not isinstance(cfg, dict):
        raise PhoneError("validation", "overlay is an object (phone-overlay@1).")
    out = copy.deepcopy(DEFAULT)
    if "items" in cfg:
        items = cfg["items"]
        if not isinstance(items, list) or not 1 <= len(items) <= MAX_ITEMS:
            raise PhoneError("validation", f"items is a list of 1 to {MAX_ITEMS} buttons and widgets.")
        seen: set[str] = set()
        out["items"] = []
        for i, it in enumerate(items):
            if not isinstance(it, dict):
                raise PhoneError("validation", f"items[{i}] is an object.")
            iid, kind, action = str(it.get("id") or ""), it.get("kind", "button"), str(it.get("action") or "")
            if not ID_RE.match(iid) or iid in seen:
                raise PhoneError("validation", f"items[{i}].id is a unique short id (a-z, 0-9, -).")
            if kind not in KINDS:
                raise PhoneError("validation", f"items[{i}].kind is button or widget.")
            if not _action_ok(action):
                raise PhoneError("validation", f"items[{i}].action is one of {', '.join(ACTIONS)} or open:https://<page on amberxai.com>.")
            seen.add(iid)
            out["items"].append({"id": iid, "kind": kind, "icon": str(it.get("icon") or "box")[:40], "label": str(it.get("label") or iid)[:40], "action": action})
    for kind, p in (cfg.get("popups") or {}).items():
        if kind not in POPUP_KINDS or not isinstance(p, dict):
            raise PhoneError("validation", f"popups has {', '.join(POPUP_KINDS)}.")
        cur = out["popups"][kind]
        for key, allowed in (("position", POSITIONS), ("enter", ANIMATIONS), ("exit", ANIMATIONS), ("size", SIZES)):
            if key in p:
                if p[key] not in allowed:
                    raise PhoneError("validation", f"popups.{kind}.{key} is one of {', '.join(allowed)}.")
                cur[key] = p[key]
        for key, lo, hi in (("speedMs", 80, 2000), ("stayMs", 0, 120000)):
            if key in p:
                if not isinstance(p[key], int) or not lo <= p[key] <= hi:
                    raise PhoneError("validation", f"popups.{kind}.{key} is a whole number from {lo} to {hi}.")
                cur[key] = p[key]
        for key in ("sound", "vibrate"):
            if key in p:
                if not isinstance(p[key], bool):
                    raise PhoneError("validation", f"popups.{kind}.{key} is true or false.")
                cur[key] = p[key]
        if "opacity" in p:
            if not isinstance(p["opacity"], (int, float)) or not 0.3 <= float(p["opacity"]) <= 1:
                raise PhoneError("validation", f"popups.{kind}.opacity is from 0.3 to 1.")
            cur["opacity"] = float(p["opacity"])
    for key, lo, hi in (("buttonSize", 40, 80), ("autoCollapseMs", 0, 60000)):
        if key in cfg:
            if not isinstance(cfg[key], int) or not lo <= cfg[key] <= hi:
                raise PhoneError("validation", f"{key} is a whole number from {lo} to {hi}.")
            out[key] = cfg[key]
    if "buttonShape" in cfg:
        if cfg["buttonShape"] not in SHAPES:
            raise PhoneError("validation", f"buttonShape is one of {', '.join(SHAPES)}.")
        out["buttonShape"] = cfg["buttonShape"]
    if "edgeSnap" in cfg:
        if not isinstance(cfg["edgeSnap"], bool):
            raise PhoneError("validation", "edgeSnap is true or false.")
        out["edgeSnap"] = cfg["edgeSnap"]
    if "toolbarOpacity" in cfg:
        if not isinstance(cfg["toolbarOpacity"], (int, float)) or not 0.3 <= float(cfg["toolbarOpacity"]) <= 1:
            raise PhoneError("validation", "toolbarOpacity is from 0.3 to 1.")
        out["toolbarOpacity"] = float(cfg["toolbarOpacity"])
    return out


def merge(current: dict[str, Any], patch: dict[str, Any]) -> dict[str, Any]:
    """A patch over the current config (popups merged per type; items replaced whole), then validated."""
    nxt = copy.deepcopy(current)
    for k, v in (patch or {}).items():
        if k == "popups" and isinstance(v, dict):
            for kind, p in v.items():
                if isinstance(p, dict):
                    nxt.setdefault("popups", {}).setdefault(kind, {}).update(p)
                else:
                    nxt["popups"][kind] = p
        elif k != "$axf":
            nxt[k] = v
    return validate(nxt)
