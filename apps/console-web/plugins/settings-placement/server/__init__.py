"""Settings placement (settings-placement@1): where each plugin's settings open, kept on the console server.

The framework draws the placements and the picker (framework/react/settingsHost.tsx, engine
framework/core/engines/settingsplacement.ts). The console keeps every pick in the browser's settings; this server part
is the shared copy, so a pick follows Brett between browsers and Claude, the API and the CLI can read and change it
(plugin-commands@1: REST /api/control/settings-placement/<command>, MCP settings-placement_<command>, CLI
`axf settings-placement <command>`). The web part pulls it on load and on focus and pushes local changes; newest wins.

Store: <dataDir>/placements.json = { "$axf": "settings-placement-store@1", "rev", "updatedAt", "default": pick|null,
"owners": { "<plugin id>": pick } }.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
LOCK = threading.Lock()

# the engine's vocabulary (framework/core/engines/settingsplacement.ts); check-settings-placement.mts replays the engine
PLACEMENTS = ["inside", "dialog", "window", "main"]
MODES = ["pane", "dropdown", "tab", "split", "inline"]
LOOK_KEYS = [f"inside:{m}" for m in MODES] + ["dialog", "window", "fallback"]
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


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SETTINGS_PLACEMENT_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _file() -> Path:
    return data_dir() / "placements.json"


def _read() -> dict[str, Any]:
    try:
        d = json.loads(_file().read_text("utf-8"))
        if isinstance(d, dict) and isinstance(d.get("owners"), dict):
            return d
    except (OSError, ValueError):
        pass
    return {"$axf": "settings-placement-store@1", "rev": 0, "updatedAt": "", "default": None, "owners": {}}


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


def normalize(body: dict[str, Any]) -> dict[str, Any] | None:
    """A pick from a request → a valid settings-placement@1 pick; placement 'default' → None (forget it). Unknown values are refused, naming the field."""
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object: { placement, mode?, looks? }")
    p = body.get("placement")
    if p == "default":
        return None
    if p not in PLACEMENTS:
        raise HTTPException(400, f"placement must be one of {', '.join(PLACEMENTS + ['default'])}")
    mode = body.get("mode", "pane")
    if mode not in MODES:
        raise HTTPException(400, f"mode must be one of {', '.join(MODES)}")
    looks: dict[str, Any] = {}
    for k, v in (body.get("looks") or {}).items():
        if k not in LOOK_KEYS:
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
        looks[k] = look
    return {"$axf": "settings-placement@1", "placement": p, "mode": mode, "looks": looks}


@router.get("/placements")
def list_placements() -> dict[str, Any]:
    d = _read()
    return {**d, "count": len(d["owners"])}


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
    return {"placements": PLACEMENTS + ["default"], "modes": MODES, "lookKeys": LOOK_KEYS, "look": LOOK_VALUES}
