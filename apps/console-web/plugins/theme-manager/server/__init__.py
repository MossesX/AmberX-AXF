"""Theme manager — server part. Mounted at /api/plugins/theme-manager/ (console token, 404 when disabled).

Keeps the themes you save from a roll (standard asset@1 files, one per asset type) and your named roll presets
(which tokens a roll may change) in the plugin's data folder, so they follow you to every browser. Built-in assets
are never changed: a saved theme can't reuse a built-in id. Nothing here names another plugin.
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
    p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = p.with_suffix(".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as f:
        json.dump(value, f, indent=2)
    os.replace(tmp, p)


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
