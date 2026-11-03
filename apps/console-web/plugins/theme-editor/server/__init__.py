"""Theme editor — server part. Mounted at /api/plugins/theme-editor/ (console token, 404 when disabled).

Keeps the colour and style themes you save in the editor (standard asset@1 files) in the plugin's data folder, so
they follow you to every browser and load in any AXF app. Built-in assets are never changed: a saved theme can't
reuse a built-in id. Only colour themes and style themes are kept here. Nothing here names another plugin.
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
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,59}$")
TYPES = ("color-theme", "style-theme")
PREVIEW = "te-draft-"  # the editor's live-preview ids, never saved
MAX_BYTES = 100_000
MAX_THEMES = 300
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_THEME_EDITOR_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "theme-editor"))


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
    """Validate the asset@1 envelope (colour or style theme); keep only known envelope keys."""
    if not isinstance(raw, dict) or raw.get("$axf") != "asset@1":
        raise HTTPException(400, "not an asset@1 file")
    t, iid = raw.get("type"), raw.get("id")
    if t not in TYPES:
        raise HTTPException(400, f"the theme editor keeps colour and style themes only, not {t!r}")
    if not isinstance(iid, str) or not ID_RE.match(iid) or iid.startswith(PREVIEW):
        raise HTTPException(400, "id must be 1–60 lowercase letters, digits, . _ -")
    if iid in builtin_ids(t):
        raise HTTPException(409, f"{iid} is a built-in {t}; save under another name")
    data = raw.get("data")
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    if t == "color-theme" and (data.get("scheme") not in ("light", "dark") or not isinstance(data.get("tokens"), dict)):
        raise HTTPException(400, "a colour theme needs scheme (light | dark) and tokens")
    name = str(raw.get("name") or iid).strip()[:120] or iid
    tags = [str(x)[:40] for x in (raw.get("tags") or []) if isinstance(x, (str, int))][:20]
    out = {"$axf": "asset@1", "type": t, "id": iid, "name": name, "version": str(raw.get("version") or "1.0.0")[:20],
           "description": str(raw.get("description") or "")[:500], "author": str(raw.get("author") or "")[:80], "tags": tags, "data": data}
    if len(json.dumps(out)) > MAX_BYTES:
        raise HTTPException(413, f"theme is larger than {MAX_BYTES // 1000} KB")
    return out


def _path(t: str, iid: str) -> Path:
    if t not in TYPES or not ID_RE.match(iid or ""):
        raise HTTPException(404, "no such theme")
    return data_dir() / "themes" / t / f"{iid}.json"


def themes() -> list[dict[str, Any]]:
    out = []
    root = data_dir() / "themes"
    for t in TYPES:
        for f in sorted((root / t).glob("*.json")) if (root / t).is_dir() else []:
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
    """Save (create or overwrite) one theme. `overwrite: false` refuses an id that is already saved."""
    a = clean(body.get("asset"))
    with _lock:
        p = _path(a["type"], a["id"])
        if p.exists() and body.get("overwrite") is False:
            raise HTTPException(409, f"{a['id']} is already saved; pick another name or overwrite it")
        if not p.exists() and len(themes()) >= MAX_THEMES:
            raise HTTPException(409, f"at most {MAX_THEMES} saved themes; delete some first")
        storage.write_json(p, a)  # atomic, 0600, folder 0700
    return {"asset": a}


@router.delete("/themes/{t}/{iid}")
def delete_theme(t: str, iid: str):
    p = _path(t, iid)
    if not p.exists():
        raise HTTPException(404, "no such theme")
    p.unlink()
    return {"ok": True}
