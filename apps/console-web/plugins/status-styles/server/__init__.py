"""Status styles — server part. Mounted at /api/plugins/status-styles/ (console token on every method, 404 when the
plugin is off, never on the console MCP).

    GET /config | PUT /config        Brett's changes over the shipped status → style map (status-styles@1); PUT
                                     {"reset": true} goes back to the shipped map
    GET /presets                     his own presets (the built-in library ships with the plugin's web part)
    POST /presets                    save one of his own presets (same id = replace)
    DELETE /presets/{preset_id}      remove one of his own presets

Display data only: a status id, the preset on its row, the preset on its badge. No status is decided or stored here.
Every value is checked against the lists in assets/status-style/library.json (the same file the web part draws from),
so nothing free-form ever reaches the stylesheet.
"""
from __future__ import annotations

import json
import os
import re
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()

HERE = Path(__file__).resolve().parent.parent
LIBRARY = json.loads((HERE / "assets" / "status-style" / "library.json").read_text(encoding="utf-8"))["data"]
LIMITS = LIBRARY["limits"]
BUILT_IN = {p["id"] for p in LIBRARY["presets"]}
ID_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,59}\Z")
STATUS_RE = re.compile(r"[a-z0-9][a-z0-9-]{0,39}\Z")
CONTROL_RE = re.compile(r"[\x00-\x1f\x7f]")
STATUS_KEYS = {"label", "preset", "badgePreset", "animated"}
FLAGS = ("enabled", "rows", "badges")
NUMBERS = ("speed", "strength", "tint", "dim")
SWITCHES = ("edge", "bold", "italic")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_STATUS_STYLES_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "status-styles"))


def _text(v: Any, n: int) -> str:
    return CONTROL_RE.sub(" ", v).strip()[:n] if isinstance(v, str) else ""


def clean_config(body: Any) -> dict[str, Any]:
    """The saved changes, checked. Raises 400 with the reason when something isn't a status style."""
    if not isinstance(body, dict):
        raise HTTPException(400, "send an object: {enabled, rows, badges, statuses}")
    out: dict[str, Any] = {"$axf": "status-styles@1"}
    for k in FLAGS:
        if k in body:
            if not isinstance(body[k], bool):
                raise HTTPException(400, f"{k} is true or false")
            out[k] = body[k]
    statuses = body.get("statuses", {})
    if not isinstance(statuses, dict):
        raise HTTPException(400, "statuses is an object: status id → {preset, badgePreset, animated}")
    if len(statuses) > LIMITS["statuses"] * 2:
        raise HTTPException(400, "too many statuses")
    clean: dict[str, Any] = {}
    for sid, st in statuses.items():
        if not isinstance(sid, str) or not STATUS_RE.match(sid):
            raise HTTPException(400, f"not a status id: {_text(sid, 60)!r} (lower-case letters, digits and dashes)")
        if not isinstance(st, dict) or set(st) - STATUS_KEYS:
            raise HTTPException(400, f"{sid}: only label, preset, badgePreset and animated can be set")
        one: dict[str, Any] = {}
        for k in ("preset", "badgePreset"):
            if k in st:
                if not isinstance(st[k], str) or not ID_RE.match(st[k]):
                    raise HTTPException(400, f"{sid}: {k} is a preset id")
                one[k] = st[k]
        if "animated" in st:
            if not isinstance(st["animated"], bool):
                raise HTTPException(400, f"{sid}: animated is true or false")
            one["animated"] = st["animated"]
        if _text(st.get("label"), 40):
            one["label"] = _text(st.get("label"), 40)
        clean[sid] = one
    if clean:
        out["statuses"] = clean
    return out


def clean_preset(body: Any) -> dict[str, Any]:
    """One of Brett's own presets, checked against the library's lists and limits."""
    if not isinstance(body, dict):
        raise HTTPException(400, "send one preset: {id, name, target, effect, tone, speed, strength, …}")
    pid = body.get("id")
    if not isinstance(pid, str) or not ID_RE.match(pid):
        raise HTTPException(400, "id: lower-case letters, digits and dashes (up to 60)")
    if pid in BUILT_IN:
        raise HTTPException(400, f"{pid} is a built-in preset; save yours under another name")
    target = body.get("target", "row")
    if target not in LIBRARY["targets"]:
        raise HTTPException(400, f"target is one of {', '.join(LIBRARY['targets'])}")
    effects = LIBRARY["textEffects"] if target == "text" else LIBRARY["effects"]
    effect = body.get("effect", "none")
    if effect not in effects:
        raise HTTPException(400, f"effect for {target} is one of {', '.join(effects)}")
    tone = body.get("tone", "accent")
    if tone not in LIBRARY["tones"]:
        raise HTTPException(400, f"tone is one of {', '.join(LIBRARY['tones'])}")
    direction = body.get("direction", "normal")
    if direction not in LIBRARY["directions"]:
        raise HTTPException(400, f"direction is one of {', '.join(LIBRARY['directions'])}")
    out: dict[str, Any] = {"id": pid, "name": _text(body.get("name"), 60) or pid, "target": target, "effect": effect, "tone": tone, "direction": direction}
    defaults = {"speed": 100, "strength": 60, "tint": 0, "dim": 0}
    for k in NUMBERS:
        v = body.get(k, defaults[k])
        lo, hi = LIMITS[k]
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not lo <= v <= hi:
            raise HTTPException(400, f"{k} is a number from {lo} to {hi}")
        out[k] = int(round(v))
    for k in SWITCHES:
        v = body.get(k, False)
        if not isinstance(v, bool):
            raise HTTPException(400, f"{k} is true or false")
        out[k] = v
    return out


def read_config() -> dict[str, Any]:
    c = storage.read_json(data_dir() / "config.json", {})
    try:
        return clean_config({k: v for k, v in c.items() if k != "$axf"}) if isinstance(c, dict) else {"$axf": "status-styles@1"}
    except HTTPException:
        return {"$axf": "status-styles@1"}


def read_presets() -> list[dict[str, Any]]:
    doc = storage.read_json(data_dir() / "presets.json", {})
    rows = doc.get("presets") if isinstance(doc, dict) else None
    out: list[dict[str, Any]] = []
    for p in rows if isinstance(rows, list) else []:
        try:
            out.append(clean_preset(p))
        except HTTPException:
            continue
    return out[: LIMITS["presets"]]


def write_presets(rows: list[dict[str, Any]]) -> None:
    storage.write_json(data_dir() / "presets.json", {"$axf": "status-style-presets@1", "presets": rows})


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {"config": read_config(), "presets": read_presets()}


@router.put("/config")
def put_config(body: Any = Body(...)) -> dict[str, Any]:
    clean = {"$axf": "status-styles@1"} if isinstance(body, dict) and body.get("reset") is True else clean_config(body)
    storage.write_json(data_dir() / "config.json", clean)
    return {"config": read_config(), "presets": read_presets()}


@router.get("/presets")
def get_presets() -> dict[str, Any]:
    return {"presets": read_presets(), "builtIn": len(BUILT_IN)}


@router.post("/presets")
def save_preset(body: Any = Body(...)) -> dict[str, Any]:
    preset = clean_preset(body)
    rows = [p for p in read_presets() if p["id"] != preset["id"]]
    if len(rows) >= LIMITS["presets"]:
        raise HTTPException(400, f"at most {LIMITS['presets']} presets of your own; remove one first")
    rows.append(preset)
    write_presets(rows)
    return {"saved": preset, "presets": rows}


@router.delete("/presets/{preset_id}")
def delete_preset(preset_id: str) -> dict[str, Any]:
    rows = read_presets()
    left = [p for p in rows if p["id"] != preset_id]
    if len(left) == len(rows):
        raise HTTPException(404, "no preset of yours has that id")
    write_presets(left)
    return {"removed": preset_id, "presets": left}
