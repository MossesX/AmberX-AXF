"""Brand library — server part. Mounted at /api/plugins/brand-library/ (console token, 404 when disabled).

Serves the framework's brand library (`framework/brand-library/`, brand-library@1: logo marks, animated logos, icon
packs, branding packages) read-only, so the console bundle never carries its ~650 KB, and keeps this plugin's own
settings (which tab opens, tile size, brand filter, the last brand you applied) in the plugin's data folder.

    GET  /index                         counts + facets (brands, forms, presets, styles) per type
    GET  /assets/<type>                 every asset of one type (full asset@1 files), with a `facets` block each
    GET  /closure/<type>/<id>           the asset and everything it needs (branding -> marks, animated mark, icon pack)
    GET  /config  PUT /config           this plugin's settings

Nothing here writes to the brand library, and nothing names another plugin.
"""
from __future__ import annotations

import json
import os
import re
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
TYPES = ("logo-mark", "animated-logo", "icon-pack", "branding")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
TABS = ("logos", "animated", "packs", "branding")
TILES = ("sm", "md", "lg")
_lock = threading.Lock()
_cache: dict[str, Any] = {}

DEFAULT_CONFIG: dict[str, Any] = {"tab": "logos", "tile": "md", "brand": "", "names": True, "motion": True, "applied": None}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_BRAND_LIBRARY_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "brand-library"))


def library_dir() -> Path:
    return Path(os.environ.get("AXF_BRAND_LIBRARY_SOURCE") or (cx.ROOT / "framework" / "brand-library"))


def _read(p: Path) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _facets(a: dict[str, Any]) -> dict[str, str]:
    d = a.get("data") if isinstance(a.get("data"), dict) else {}
    tags = [t for t in a.get("tags", []) if isinstance(t, str)]
    brand = d.get("brand")
    if isinstance(brand, dict):
        brand = brand.get("name")
    if not isinstance(brand, str) or not brand:
        brand = "GizmoX" if "gizmox" in tags or str(a.get("id", "")).startswith("gizmox") else "AmberX" if "amberx" in tags or str(a.get("id", "")).startswith("amberx") else ""
    out = {"brand": brand}
    if a.get("type") == "logo-mark":
        out["form"] = str(d.get("form", ""))
    elif a.get("type") == "animated-logo":
        out["preset"] = str(d.get("preset", ""))
        out["loop"] = str(d.get("loop", ""))
    elif a.get("type") == "icon-pack":
        out["style"] = str(d.get("style", ""))
        out["brand"] = ""
    elif a.get("type") == "branding":
        style = next((t for t in tags if t not in ("amberx", "gizmox", "brand-library", "generated")), "")
        out["style"] = style
    return out


def load_type(t: str) -> list[dict[str, Any]]:
    """Every asset of one type, sorted by id; cached by the folder's mtime so a regenerated library shows up."""
    if t not in TYPES:
        raise HTTPException(404, f"unknown brand type {t!r}")
    folder = library_dir() / t
    try:
        stamp = folder.stat().st_mtime_ns
    except OSError:
        return []
    with _lock:
        hit = _cache.get(t)
        if hit and hit[0] == stamp:
            return hit[1]
    items: list[dict[str, Any]] = []
    for f in sorted(folder.glob("*.json")):
        a = _read(f)
        if isinstance(a, dict) and a.get("type") == t and isinstance(a.get("id"), str) and ID_RE.match(a["id"]):
            items.append({**a, "facets": _facets(a)})
    with _lock:
        _cache[t] = (stamp, items)
    return items


def find(t: str, i: str) -> dict[str, Any] | None:
    if t not in TYPES or not ID_RE.match(i):
        return None
    return next((a for a in load_type(t) if a["id"] == i), None)


def deps(a: dict[str, Any]) -> list[tuple[str, str]]:
    d = a.get("data") if isinstance(a.get("data"), dict) else {}
    out: list[tuple[str, str]] = []
    if a.get("type") == "branding":
        for k, v in (d.get("marks") or {}).items():
            if isinstance(v, str) and v:
                out.append(("animated-logo" if k == "animated" else "logo-mark", v))
        if isinstance(d.get("iconPack"), str) and d["iconPack"]:
            out.append(("icon-pack", d["iconPack"]))
    if a.get("type") == "animated-logo" and isinstance(d.get("mark"), str):
        out.append(("logo-mark", d["mark"]))
    return out


def closure(t: str, i: str) -> tuple[list[dict[str, Any]], list[str]]:
    seen: dict[str, dict[str, Any]] = {}
    missing: list[str] = []
    stack = [(t, i)]
    while stack:
        tt, ii = stack.pop()
        key = f"{tt}/{ii}"
        if key in seen or key in missing:
            continue
        a = find(tt, ii)
        if not a:
            missing.append(key)
            continue
        seen[key] = a
        stack.extend(deps(a))
    return [{k: v for k, v in a.items() if k != "facets"} for a in seen.values()], missing


def clean_config(raw: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    """Known keys with valid values from `raw`; anything else keeps `base` (the defaults when none)."""
    c = dict(base or DEFAULT_CONFIG)
    if not isinstance(raw, dict):
        return c
    if raw.get("tab") in TABS:
        c["tab"] = raw["tab"]
    if raw.get("tile") in TILES:
        c["tile"] = raw["tile"]
    if isinstance(raw.get("brand"), str) and len(raw["brand"]) <= 40:
        c["brand"] = raw["brand"]
    for k in ("names", "motion"):
        if isinstance(raw.get(k), bool):
            c[k] = raw[k]
    ap = raw.get("applied")
    if "applied" in raw and ap is None:
        c["applied"] = None
    elif isinstance(ap, dict) and ap.get("type") in TYPES and isinstance(ap.get("id"), str) and ID_RE.match(ap["id"]):
        c["applied"] = {"type": ap["type"], "id": ap["id"], "at": str(ap.get("at", ""))[:40]}
        # a derived branding package (a mark, animation or pack swapped into the active brand) is kept whole
        if isinstance(ap.get("asset"), dict) and ap["asset"].get("type") == "branding":
            text = json.dumps(ap["asset"])
            if len(text) <= 16_000:
                c["applied"]["asset"] = ap["asset"]
    return c


@router.get("/index")
def index() -> dict[str, Any]:
    out: dict[str, Any] = {"types": {}}
    for t in TYPES:
        items = load_type(t)
        facets: dict[str, set[str]] = {}
        for a in items:
            for k, v in a["facets"].items():
                if v:
                    facets.setdefault(k, set()).add(v)
        out["types"][t] = {"count": len(items), "facets": {k: sorted(v) for k, v in facets.items()}}
    return out


@router.get("/assets/{t}")
def assets(t: str) -> dict[str, Any]:
    return {"type": t, "items": load_type(t)}


@router.get("/closure/{t}/{i}")
def get_closure(t: str, i: str) -> dict[str, Any]:
    if not find(t, i):
        raise HTTPException(404, f"no {t} {i!r} in the brand library")
    items, missing = closure(t, i)
    return {"items": items, "missing": missing}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return clean_config(_read(data_dir() / "config.json"))


@router.put("/config")
def put_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with _lock:
        c = clean_config(body, clean_config(_read(data_dir() / "config.json")))
        storage.write_json(data_dir() / "config.json", c)  # atomic, 0600, folder 0700
    return c
