"""Theme manager — server part. Mounted at /api/plugins/theme-manager/ (console token, 404 when disabled).

Keeps the themes you save from a roll (standard asset@1 files, one per asset type) and your named roll presets
(which tokens a roll may change) in the plugin's data folder, so they follow you to every browser. Built-in assets
are never changed: a saved theme can't reuse a built-in id. Nothing here names another plugin.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,59}$")
TYPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
MAX_BYTES = 200_000
MAX_THEMES = 500
MAX_PRESETS = 50
NEVER = {"uac-policy"}  # access policies are never themes
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_THEME_MANAGER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "theme-manager"))


def _write(p: Path, value: Any) -> None:
    storage.write_json(p, value)  # atomic, 0600, folder 0700 (axf_server.storage)


def asset_types() -> set[str]:
    try:
        spec = json.loads((cx.ROOT / "framework" / "schemas" / "asset-types.json").read_text("utf-8"))
        return {t for t in spec.get("types", {}) if t not in NEVER}
    except (OSError, ValueError):
        return set()


def builtin_ids(t: str) -> set[str]:
    out: set[str] = set()
    for base in (cx.ROOT / "framework" / "assets" / t, cx.ROOT / "apps" / "console-web" / "src" / "assets" / t):
        for f in base.glob("*.json") if base.is_dir() else []:
            try:
                out.add(json.loads(f.read_text("utf-8")).get("id", ""))
            except (OSError, ValueError):
                pass
    return out


def clean(raw: Any) -> dict[str, Any]:
    """Validate the asset@1 envelope; keep only known envelope keys."""
    if not isinstance(raw, dict) or raw.get("$axf") != "asset@1":
        raise HTTPException(400, "not an asset@1 file")
    t, iid = raw.get("type"), raw.get("id")
    if not isinstance(t, str) or not TYPE_RE.match(t) or t not in asset_types():
        raise HTTPException(400, f"unknown or excluded asset type: {t!r}")
    if not isinstance(iid, str) or not ID_RE.match(iid) or iid.startswith("tm-preview-"):
        raise HTTPException(400, "id must be 1–60 lowercase letters, digits, . _ -")
    if iid in builtin_ids(t):
        raise HTTPException(409, f"{iid} is a built-in {t}; save under another name")
    if not isinstance(raw.get("data"), dict):
        raise HTTPException(400, "data must be an object")
    name = str(raw.get("name") or iid).strip()[:120] or iid
    tags = [str(x)[:40] for x in (raw.get("tags") or []) if isinstance(x, (str, int))][:20]
    out = {"$axf": "asset@1", "type": t, "id": iid, "name": name, "version": str(raw.get("version") or "1.0.0")[:20],
           "description": str(raw.get("description") or "")[:500], "author": str(raw.get("author") or "")[:80], "tags": tags, "data": raw["data"]}
    if len(json.dumps(out)) > MAX_BYTES:
        raise HTTPException(413, f"theme is larger than {MAX_BYTES // 1000} KB")
    return out


def _path(t: str, iid: str) -> Path:
    if not TYPE_RE.match(t or "") or not ID_RE.match(iid or ""):
        raise HTTPException(404, "no such theme")
    return data_dir() / "themes" / t / f"{iid}.json"


def themes() -> list[dict[str, Any]]:
    out = []
    root = data_dir() / "themes"
    for f in sorted(root.glob("*/*.json")) if root.is_dir() else []:
        try:
            out.append(json.loads(f.read_text("utf-8")))
        except (OSError, ValueError):
            continue
    return out


@router.get("/themes")
def list_themes():
    return {"items": themes()}


@router.post("/themes")
def save_theme(body: dict = Body(...)):
    a = clean(body.get("asset"))
    with _lock:
        p = _path(a["type"], a["id"])
        if not p.exists() and len(themes()) >= MAX_THEMES:
            raise HTTPException(409, f"at most {MAX_THEMES} saved themes; delete some first")
        _write(p, a)
    return {"asset": a}


@router.put("/themes/{t}/{iid}")
def update_theme(t: str, iid: str, body: dict = Body(...)):
    p = _path(t, iid)
    if not p.exists():
        raise HTTPException(404, "no such theme")
    a = clean({**body, "type": t, "id": iid})
    with _lock:
        _write(p, a)
    return {"asset": a}


@router.delete("/themes/{t}/{iid}")
def delete_theme(t: str, iid: str):
    p = _path(t, iid)
    if not p.exists():
        raise HTTPException(404, "no such theme")
    p.unlink()
    return {"ok": True}


def presets() -> dict[str, list[str]]:
    try:
        v = json.loads((data_dir() / "presets.json").read_text("utf-8"))
        return v if isinstance(v, dict) else {}
    except (OSError, ValueError):
        return {}


@router.get("/presets")
def get_presets():
    return {"presets": presets()}


@router.put("/presets")
def put_presets(body: dict = Body(...)):
    if len(body) > MAX_PRESETS:
        raise HTTPException(400, f"at most {MAX_PRESETS} presets")
    out: dict[str, list[str]] = {}
    for k, v in body.items():
        name = str(k).strip()[:40]
        if not name or not isinstance(v, list):
            raise HTTPException(400, "a preset is a name and a list of token ids")
        out[name] = [str(x)[:200] for x in v if isinstance(x, str)][:5000]
    with _lock:
        _write(data_dir() / "presets.json", out)
    return {"presets": out}


# ---- skins: every app's own look on the hub (framework/cli/skins.mjs is the one writer) ----

SKINS_CLI = cx.ROOT / "framework" / "cli" / "skins.mjs"


def _skins(*args: str) -> Any:
    try:
        proc = subprocess.run(["node", str(SKINS_CLI), *args, "--json"], cwd=cx.ROOT, capture_output=True, text=True, timeout=30)
        out = json.loads(proc.stdout or "{}")
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        raise HTTPException(status_code=502, detail=f"skins: {e}") from e
    if not out.get("ok"):
        raise HTTPException(status_code=400, detail=str(out.get("error") or "skins failed"))
    return out["result"]


@router.get("/skins")
def skins() -> dict[str, Any]:
    """The skins that can be used, every app's skin switch and scopes, and the hub-wide skin."""
    return {"skins": _skins("list"), "apps": _skins("apps"), "global": _skins("global").get("global")}


def _scope_args(scope: str | None) -> list[str]:
    """A ui:<id> / plugin:<id> scope as CLI arguments; the CLI refuses anything else."""
    return ["--scope", str(scope)] if scope else []


@router.get("/skins/coverage")
def skin_coverage() -> Any:
    """skin-coverage@1: how a skin reaches every registered asset type (slot / parts / reference / bundle / none)."""
    return _skins("coverage")


@router.get("/skins/covers/{skin}")
def skin_covers(skin: str) -> Any:
    """What one skin (or design package) sets or styles, type by type: 'what does the Windows skin cover?'."""
    return _skins("covers", skin)


@router.get("/skins/global")
def skin_global() -> Any:
    """The hub-wide skin (every app that follows it)."""
    return _skins("global")


@router.post("/skins/global")
def skin_global_set(body: dict[str, Any] = Body(...)) -> Any:
    """Set the hub-wide skin, body {skin} ('off' clears it): 'make Windows the hub-wide skin'."""
    return _skins("global", str(body.get("skin") or "off"))


@router.post("/skins/global/color")
def skin_global_color(body: dict[str, Any] = Body(...)) -> Any:
    """Switch the colour theme inside the hub-wide skin, body {theme} ('default' = the skin's own): the skin stays."""
    return _skins("global-color", str(body.get("theme") or "default"))


@router.get("/skins/{app}/at")
def skin_at(app: str, scope: str | None = None) -> Any:
    """Which skin is in force in an app, or in one of its screens / plugins (scope=ui:<id> | plugin:<id>), and which level decided."""
    return _skins("at", app, *_scope_args(scope))


@router.post("/skins/{app}/follow")
def skin_follow(app: str, body: dict[str, Any] = Body(...)) -> Any:
    """Follow the hub-wide skin while Use skin is off, body {on}: 'let the console follow the hub skin'."""
    return _skins("follow", app, "on" if body.get("on", True) else "off")


@router.post("/skins/{app}/inherit")
def skin_inherit(app: str, body: dict[str, Any] = Body(...)) -> Any:
    """A screen or plugin follows its parent again, body {scope: ui:<id> | plugin:<id>}."""
    return _skins("inherit", app, str(body.get("scope") or ""))


@router.post("/skins/{app}/use")
def skin_use(app: str, body: dict[str, Any] = Body(...)) -> Any:
    """Use skin on in one app, body {skin, scope?}: 'use the Windows skin in the console', 'skin the notes plugin with Windows' (scope=plugin:<id> | ui:<id>)."""
    return _skins("use", app, str(body.get("skin") or ""), *_scope_args(body.get("scope")))


@router.post("/skins/{app}/off")
def skin_off(app: str, body: dict[str, Any] | None = Body(None)) -> Any:
    """Use skin off: back to that app's own look; body {scope} = no skin inside that screen / plugin only."""
    return _skins("off", app, *_scope_args((body or {}).get("scope")))


@router.post("/skins/{app}/back")
def skin_back(app: str, body: dict[str, Any] = Body(...)) -> Any:
    """Drop one override, body {slot}."""
    return _skins("back", app, str(body.get("slot") or ""))


@router.get("/skins/{app}/color")
def skin_color(app: str, scope: str | None = None) -> Any:
    """The colour theme inside the skin in force in an app (or one screen / plugin, scope=ui:<id> | plugin:<id>): what shows, the skin's own, and whether it was switched."""
    return _skins("color", app, *_scope_args(scope))


@router.post("/skins/{app}/color")
def skin_color_set(app: str, body: dict[str, Any] = Body(...)) -> Any:
    """Switch the colour theme inside the skin in force, body {theme, scope?}: 'make the console's skin aurora night'. The skin stays the same skin and no skin is created; theme 'default' = the skin's own colours."""
    return _skins("color", app, str(body.get("theme") or "default"), *_scope_args(body.get("scope")))


@router.post("/skins/{app}/restore")
def skin_restore(app: str) -> Any:
    """Restore an app to its default look: 'restore AmberX to default'. Keeps one undo."""
    return _skins("restore", app)


@router.post("/skins/{app}/undo")
def skin_undo(app: str) -> Any:
    """Undo the last restore of an app."""
    return _skins("undo", app)
