"""Context menu designer — server part. Mounted at /api/plugins/context-menu-designer/ (console token, 404 when disabled).

Keeps your designs (context menus and "chunks", reusable pieces of a menu) in the plugin's data folder so they follow
you to every browser: `designs.json` (context-menu-designs@1, 0600). The browser compiles a menu into a standard
context-menu asset@1; this part only stores and checks the designs. Nothing here names another plugin.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
HEX_RE = re.compile(r"^#[0-9a-fA-F]{6}$")
TOKENS = {"text", "muted", "accent", "accent-text", "accent-soft", "surface", "surface2", "surface3", "bg", "border", "info", "success", "warning", "danger"}
FONTS = {"", "display", "mono", "sans-serif", "serif", "system-ui", "monospace", "cursive"}
WEIGHTS = {"", "normal", "medium", "bold"}
FONT_STYLES = {"", "normal", "italic"}
VARIANTS = {"compact", "roomy", "glass"}
COLOR_KEYS = ("color", "background", "hoverColor", "hoverBackground")
MAX_BYTES = 200_000
MAX_DESIGNS = 300
MAX_ITEMS = 200
MAX_DEPTH = 4
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CONTEXT_MENU_DESIGNER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "context-menu-designer"))


def _file() -> Path:
    return data_dir() / "designs.json"


def load() -> dict[str, dict[str, Any]]:
    raw = storage.read_json(_file(), {})
    items = raw.get("designs") if isinstance(raw, dict) else None
    return {k: v for k, v in (items or {}).items() if isinstance(v, dict) and ID_RE.match(k)}


def _save(designs: dict[str, dict[str, Any]]) -> None:
    storage.write_json(_file(), {"$axf": "context-menu-designs@1", "designs": designs})


def _s(v: Any, n: int) -> str:
    return v[:n] if isinstance(v, str) else ""


def _color(v: Any, key: str) -> str:
    if v in ("", None):
        return ""
    if isinstance(v, str) and ((v.startswith("token:") and v[6:] in TOKENS) or HEX_RE.match(v)):
        return v
    raise HTTPException(400, f"style.{key} must be a theme colour (token:<name>) or #rrggbb")


def clean_style(raw: Any) -> dict[str, Any]:
    s = raw if isinstance(raw, dict) else {}
    size = s.get("size", 0)
    if not isinstance(size, (int, float)) or isinstance(size, bool):
        size = 0
    size = int(size)
    out = {
        "font": s.get("font") if s.get("font") in FONTS else "",
        "size": 0 if size == 0 else max(60, min(200, size)),
        "weight": s.get("weight") if s.get("weight") in WEIGHTS else "",
        "fontStyle": s.get("fontStyle") if s.get("fontStyle") in FONT_STYLES else "",
    }
    for k in COLOR_KEYS:
        out[k] = _color(s.get(k), k)
    return out


def clean_entries(raw: Any, depth: int = 1) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        return []
    if len(raw) > MAX_ITEMS:
        raise HTTPException(400, f"at most {MAX_ITEMS} entries in one list")
    out: list[dict[str, Any]] = []
    for e in raw:
        if not isinstance(e, dict):
            continue
        eid = _s(e.get("id"), 48) or f"e{len(out) + 1}"
        kind = e.get("kind")
        if kind == "separator":
            out.append({"kind": "separator", "id": eid})
        elif kind == "chunk":
            ref = _s(e.get("chunk"), 80).strip()
            if not ref:
                raise HTTPException(400, "a chunk entry needs the chunk's name")
            out.append({"kind": "chunk", "id": eid, "chunk": ref})
        else:
            it: dict[str, Any] = {"kind": "item", "id": eid, "label": _s(e.get("label"), 80)}
            for k, n in (("icon", 40), ("action", 200), ("shortcut", 40)):
                if _s(e.get(k), n):
                    it[k] = _s(e.get(k), n)
            if isinstance(e.get("items"), list) and e["items"]:
                if depth >= MAX_DEPTH:
                    raise HTTPException(400, f"submenus nest at most {MAX_DEPTH} deep")
                it["items"] = clean_entries(e["items"], depth + 1)
            out.append(it)
    return out


def clean(raw: Any, did: str) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise HTTPException(400, "a design is an object")
    if not ID_RE.match(did):
        raise HTTPException(400, "id must be 1–48 lowercase letters, digits and dashes")
    kind = raw.get("kind")
    if kind not in ("menu", "chunk"):
        raise HTTPException(400, "kind must be menu or chunk")
    name = _s(raw.get("name"), 80).strip()
    if not name:
        raise HTTPException(400, "give it a name")
    out = {
        "id": did, "name": name, "kind": kind,
        "inherit": kind == "chunk" and raw.get("inherit") is not False,
        "style": clean_style(raw.get("style")),
        "items": clean_entries(raw.get("items")),
        "variant": raw.get("variant") if raw.get("variant") in VARIANTS else "compact",
        "showIcons": raw.get("showIcons") is not False,
        "showShortcuts": raw.get("showShortcuts") is not False,
        "base": _s(raw.get("base"), 80),
        "updatedAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }
    if len(json.dumps(out)) > MAX_BYTES:
        raise HTTPException(413, f"design is larger than {MAX_BYTES // 1000} KB")
    return out


@router.get("/designs")
def list_designs():
    return {"items": sorted(load().values(), key=lambda d: (d.get("kind") != "menu", str(d.get("name", "")).lower()))}


@router.put("/designs/{did}")
def put_design(did: str, body: dict = Body(...)):
    d = clean(body, did)
    with _lock:
        designs = load()
        if did not in designs and len(designs) >= MAX_DESIGNS:
            raise HTTPException(409, f"at most {MAX_DESIGNS} designs")
        for o in designs.values():
            if o.get("id") != did and o.get("kind") == d["kind"] and str(o.get("name", "")).strip().lower() == d["name"].lower():
                raise HTTPException(409, f"another {d['kind']} is already called \"{o.get('name')}\"")
        designs[did] = d
        _save(designs)
    return {"design": d}


@router.delete("/designs/{did}")
def delete_design(did: str):
    with _lock:
        designs = load()
        if did not in designs:
            raise HTTPException(404, "no such design")
        del designs[did]
        _save(designs)
    return {"ok": True}
