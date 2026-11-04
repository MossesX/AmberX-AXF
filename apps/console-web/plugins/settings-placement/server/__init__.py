"""Settings placement (settings-placement@1): where settings open, kept on the console server.

The framework draws the placements and the picker (framework/react/settingsHost.tsx, engine
framework/core/engines/settingsplacement.ts, vocabulary framework/core/engines/settingsplacement-rules.mjs). The console
keeps every pick in the browser's settings; this server part is the shared copy, so a pick follows Brett between
browsers and Claude, the API and the CLI can read and change it (plugin-commands@1: REST
/api/control/settings-placement/<command>, MCP settings-placement_<command>, CLI `axf settings-placement <command>`;
the live console is driven through the console commands' `console.placement` target too). The web part pulls it on
load and on focus and pushes local changes; newest wins.

Since Nov 4 2026 (Brett: "select in every screen where its settings pops up") a pick is per screen as well as per
plugin: placements dialog / panel (side left | right) / sheet / inside (mode) / page / window.

Store: <dataDir>/placements.json = { "$axf": "settings-placement-store@1", "rev", "updatedAt", "default": pick|null,
"owners": { "<plugin id>": pick }, "screens": { "<view id>": pick } }.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
LOCK = threading.Lock()

# the engine's vocabulary (framework/core/engines/settingsplacement-rules.mjs); check-settings-placement.mts replays the engine
PLACEMENTS = ["dialog", "panel", "sheet", "inside", "page", "window"]
ALIASES = {"main": "page", "full-page": "page", "full": "page", "settings-page": "page", "pane": "panel", "side-panel": "panel", "side": "panel", "drawer": "panel",
           "bottom-sheet": "sheet", "bottom": "sheet", "popup": "dialog", "pop-up": "dialog", "modal": "dialog", "floating": "window", "floating-window": "window", "float": "window",
           "inline": "inside", "in-screen": "inside", "screen": "inside"}
CHOICES = ["dialog", "panel-left", "panel-right", "sheet", "inside", "page", "window"]
SIDES = ["left", "right"]
MODES = ["pane", "dropdown", "tab", "split", "inline"]
LOOK_KEYS = [f"inside:{m}" for m in MODES] + ["dialog", "window", "panel", "sheet"]
LOOK_KEY_ALIASES = {"fallback": "panel", "page-pane": "panel"}
LOOK_VALUES: dict[str, list[Any]] = {
    "animation": ["slide", "fade", "scale", "drop", "push", "none"],
    "speed": ["instant", "fast", "normal", "slow", "slower"],
    "easing": ["theme", "standard", "decelerate", "accelerate", "linear", "spring"],
    "edge": ["left", "right", "top", "bottom"],
    "size": ["narrow", "medium", "wide", "half", "full"],
    "position": ["center", "top", "bottom", "left", "right"],
    "dim": [True, False],
    "blur": [True, False],
    "radius": ["none", "sm", "md", "lg"],
    "shadow": ["none", "sm", "md", "lg"],
}
VIEW_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,120}$", re.I)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SETTINGS_PLACEMENT_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _file() -> Path:
    return data_dir() / "placements.json"


def _read() -> dict[str, Any]:
    try:
        d = json.loads(_file().read_text("utf-8"))
        if isinstance(d, dict) and isinstance(d.get("owners"), dict):
            d.setdefault("screens", {})
            if not isinstance(d["screens"], dict):
                d["screens"] = {}
            return d
    except (OSError, ValueError):
        pass
    return {"$axf": "settings-placement-store@1", "rev": 0, "updatedAt": "", "default": None, "owners": {}, "screens": {}}


def _write(d: dict[str, Any]) -> dict[str, Any]:
    d["rev"] = int(d.get("rev") or 0) + 1
    d["updatedAt"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    _file().parent.mkdir(parents=True, exist_ok=True)
    tmp = _file().with_suffix(".tmp")
    tmp.write_text(json.dumps(d, indent=1) + "\n", "utf-8")
    tmp.replace(_file())
    return d


def _plugin_ids() -> dict[str, str]:
    """folder → plugin id, for every console plugin (so `console-terminal` works as well as its id)."""
    out: dict[str, str] = {}
    root = Path(__file__).resolve().parents[2]
    for mf in root.glob("*/plugin.json"):
        try:
            out[mf.parent.name] = json.loads(mf.read_text("utf-8")).get("id") or ""
        except (OSError, ValueError):
            continue
    return out


def _owner(owner: str) -> str:
    owner = owner.strip()
    if not owner:
        raise HTTPException(400, "owner is needed: a plugin id or its folder")
    return _plugin_ids().get(owner) or owner


def _placement(p: Any) -> str | None:
    if not isinstance(p, str):
        return None
    w = p.strip().lower().replace(" ", "-").replace("_", "-")
    if w in PLACEMENTS:
        return w
    return ALIASES.get(w)


def normalize(body: dict[str, Any]) -> dict[str, Any] | None:
    """A pick from a request → a valid settings-placement@1 pick; placement 'default' → None (forget it). Unknown values are refused, naming the field.
    A choice word (panel-left / panel-right) sets the side; older names (main, a fallback look) still load."""
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object: { placement, side?, mode?, looks? }")
    p = body.get("placement")
    if p == "default":
        return None
    side = body.get("side", "right")
    if isinstance(p, str) and p in ("panel-left", "panel-right"):
        side, p = p.split("-")[1], "panel"
    placement = _placement(p)
    if not placement:
        raise HTTPException(400, f"placement must be one of {', '.join(PLACEMENTS + ['panel-left', 'panel-right', 'default'])}")
    if side not in SIDES:
        raise HTTPException(400, f"side must be one of {', '.join(SIDES)}")
    mode = body.get("mode", "inline")
    if mode not in MODES:
        raise HTTPException(400, f"mode must be one of {', '.join(MODES)}")
    looks: dict[str, Any] = {}
    for k, v in (body.get("looks") or {}).items():
        key = k if k in LOOK_KEYS else LOOK_KEY_ALIASES.get(k)
        if not key:
            raise HTTPException(400, f"looks.{k}: the look keys are {', '.join(LOOK_KEYS)}")
        if not isinstance(v, dict):
            raise HTTPException(400, f"looks.{k} must be an object")
        look = {}
        for f, x in v.items():
            if f not in LOOK_VALUES:
                raise HTTPException(400, f"looks.{k}.{f}: the look fields are {', '.join(LOOK_VALUES)}")
            if x not in LOOK_VALUES[f]:
                raise HTTPException(400, f"looks.{k}.{f} must be one of {', '.join(map(str, LOOK_VALUES[f]))}")
            look[f] = x
        looks[key] = look
    return {"$axf": "settings-placement@1", "placement": placement, "side": side, "mode": mode, "looks": looks}


def _view(view: str) -> str:
    view = view.strip()
    if not view or not VIEW_ID.match(view):
        raise HTTPException(400, "screen is needed: a view id (home, plan-studio, …)")
    return view


@router.get("/placements")
def list_placements() -> dict[str, Any]:
    d = _read()
    return {**d, "count": len(d["owners"]) + len(d["screens"])}


@router.get("/screens")
def list_screens() -> dict[str, Any]:
    d = _read()
    return {"screens": d["screens"], "default": d.get("default"), "rev": d["rev"], "count": len(d["screens"])}


@router.get("/screens/{view}")
def get_screen(view: str) -> dict[str, Any]:
    v = _view(view)
    d = _read()
    pick = d["screens"].get(v)
    return {"screen": v, "pick": pick, "source": "own" if pick else ("app default" if d.get("default") else "default"), "default": d.get("default"), "rev": d["rev"]}


@router.put("/screens/{view}")
def set_screen(view: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    v = _view(view)
    pick = normalize(body)
    with LOCK:
        d = _read()
        if pick is None:
            d["screens"].pop(v, None)
        else:
            d["screens"][v] = pick
        d = _write(d)
    return {"ok": True, "screen": v, "pick": pick, "rev": d["rev"]}


@router.get("/placements/{owner}")
def get_placement(owner: str) -> dict[str, Any]:
    oid = _owner(owner)
    d = _read()
    pick = d["owners"].get(oid)
    return {"owner": oid, "pick": pick, "source": "own" if pick else ("app default" if d.get("default") else "plugin default"), "default": d.get("default"), "rev": d["rev"]}


@router.put("/placements/{owner}")
def set_placement(owner: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    oid = _owner(owner)
    pick = normalize(body)
    with LOCK:
        d = _read()
        if pick is None:
            d["owners"].pop(oid, None)
        else:
            d["owners"][oid] = pick
        d = _write(d)
    return {"ok": True, "owner": oid, "pick": pick, "rev": d["rev"]}


@router.put("/default")
def set_default(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    pick = normalize(body)
    with LOCK:
        d = _read()
        d["default"] = pick
        d = _write(d)
    return {"ok": True, "default": pick, "rev": d["rev"]}


@router.get("/choices")
def choices() -> dict[str, Any]:
    return {"placements": PLACEMENTS + ["default"], "choices": CHOICES + ["default"], "sides": SIDES, "modes": MODES, "lookKeys": LOOK_KEYS, "look": LOOK_VALUES, "aliases": ALIASES}
