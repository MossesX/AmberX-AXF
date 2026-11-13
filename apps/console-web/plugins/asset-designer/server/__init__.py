"""Asset designer — server part. Mounted at /api/plugins/asset-designer/ (console token, 404 when disabled).

Keeps every asset designed in the console as a standard asset@1 file with its designed@1 manifest in the plugin's data
folder (assets/<type>/<id>.json), so it follows you to every browser and loads in any AXF app. Every save passes the
framework validator first (the same one `axf validate` and the build engine run, through server/designer.mjs): an
invalid asset is never written. Built-in assets are never changed: a designed asset cannot reuse a built-in id. Any
asset type the registry (framework/schemas/asset-types.json) knows is accepted. Nothing here names another plugin.

Routes (every one is a plugin command, plugin-commands@1):
  GET  /types                      every asset type with its fields           GET  /chrome   chrome settings fields + defaults
  GET  /builtin/{t}                built-in assets of a type (to start from)   GET  /library  designer-library@1 index
  GET  /assets[?type=]             designed assets                             GET  /assets/{t}/{iid}
  POST /validate {asset}           ok + errors, nothing saved
  POST /assets {asset, overwrite?, by?}   validate, make / bump the manifest, write
  POST /assets/{t}/{iid}/duplicate {id, name?}                                 DELETE /assets/{t}/{iid}
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
HERE = Path(__file__).resolve().parent
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
TYPE_RE = re.compile(r"^[a-z][a-z0-9-]{0,39}$")
PREVIEW = "ad-preview-"  # the designer's live-preview ids, never saved
MAX_BYTES = 400_000
MAX_ASSETS = 2000
APP_ID = "axf-console"
_lock = threading.Lock()
_spec_cache: tuple[float, dict[str, Any]] | None = None


def data_dir() -> Path:
    return Path(os.environ.get("AXF_ASSET_DESIGNER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "asset-designer"))


def spec() -> dict[str, Any]:
    """framework/schemas/asset-types.json, re-read when it changes."""
    global _spec_cache
    f = cx.ROOT / "framework" / "schemas" / "asset-types.json"
    mtime = f.stat().st_mtime
    if _spec_cache is None or _spec_cache[0] != mtime:
        _spec_cache = (mtime, json.loads(f.read_text("utf-8")))
    return _spec_cache[1]


def known_type(t: str) -> bool:
    return isinstance(t, str) and bool(TYPE_RE.match(t)) and t in spec().get("types", {})


def node(op: str, payload: dict[str, Any]) -> dict[str, Any]:
    """One call into server/designer.mjs (the framework validator and manifest maker)."""
    try:
        proc = subprocess.run(["node", str(HERE / "designer.mjs"), op], input=json.dumps(payload), cwd=str(cx.ROOT),
                              capture_output=True, text=True, timeout=60)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the framework validator did not answer: {e}") from e
    lines = proc.stdout.strip().splitlines()
    try:
        res = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        res = None
    if not isinstance(res, dict):
        raise HTTPException(503, "the framework validator did not answer: " + (proc.stderr or proc.stdout).strip()[-600:])
    return res


def builtin_dirs(t: str) -> list[Path]:
    return [cx.ROOT / "framework" / "assets" / t, cx.ROOT / "apps" / "console-web" / "src" / "assets" / t,
            cx.ROOT / "apps" / "console-web" / "src" / "axf" / "assets" / t]


def builtin_assets(t: str) -> list[dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    for base in builtin_dirs(t):
        for f in sorted(base.glob("*.json")) if base.is_dir() else []:
            try:
                a = json.loads(f.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(a, dict) and a.get("type") == t and isinstance(a.get("id"), str) and a["id"] not in out:
                out[a["id"]] = a
    return list(out.values())


def builtin_ids(t: str) -> set[str]:
    return {a["id"] for a in builtin_assets(t)}


def clean(raw: Any) -> dict[str, Any]:
    """Check the asset@1 envelope (the data itself is checked by the framework validator); keep only known envelope keys."""
    if not isinstance(raw, dict) or raw.get("$axf") != "asset@1":
        raise HTTPException(400, "not an asset@1 file")
    t, iid = raw.get("type"), raw.get("id")
    if not known_type(t):
        raise HTTPException(400, f"unknown asset type {t!r}")
    if not isinstance(iid, str) or not ID_RE.match(iid) or iid.startswith(PREVIEW):
        raise HTTPException(400, "id must be 2–48 lowercase letters, digits and dashes")
    data = raw.get("data")
    if not isinstance(data, dict):
        raise HTTPException(400, "data must be an object")
    name = str(raw.get("name") or iid).strip()[:120] or iid
    tags = [str(x)[:40] for x in (raw.get("tags") or []) if isinstance(x, (str, int))][:20]
    out: dict[str, Any] = {"$axf": "asset@1", "type": t, "id": iid, "name": name, "version": str(raw.get("version") or "1.0.0")[:20],
                           "description": str(raw.get("description") or "")[:500], "author": str(raw.get("author") or "")[:80], "tags": tags, "data": data}
    if isinstance(raw.get("roll"), bool):
        out["roll"] = raw["roll"]
    if isinstance(raw.get("designed"), dict):
        out["designed"] = raw["designed"]
    if len(json.dumps(out)) > MAX_BYTES:
        raise HTTPException(413, f"asset is larger than {MAX_BYTES // 1000} KB")
    return out


def _path(t: str, iid: str) -> Path:
    if not known_type(t) or not ID_RE.match(iid or ""):
        raise HTTPException(404, "no such asset")
    return data_dir() / "assets" / t / f"{iid}.json"


def saved(t: str | None = None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    root = data_dir() / "assets"
    types = [t] if t else sorted(p.name for p in root.iterdir() if p.is_dir()) if root.is_dir() else []
    for tt in types:
        d = root / tt
        for f in sorted(d.glob("*.json")) if d.is_dir() else []:
            try:
                a = json.loads(f.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            if isinstance(a, dict) and a.get("$axf") == "asset@1":
                out.append(a)
    return out


def _write(a: dict[str, Any], previous: dict[str, Any] | None, by: str) -> dict[str, Any]:
    """Validate + manifest through the framework (designer.mjs prepare), then write atomically."""
    res = node("prepare", {"asset": a, "previous": previous, "app": APP_ID, "by": by[:80]})
    if not res.get("ok"):
        raise HTTPException(422, {"message": "the asset is not valid; nothing was saved", "errors": [str(e) for e in res.get("errors") or []]})
    asset = res["asset"]
    storage.write_json(_path(asset["type"], asset["id"]), asset)  # atomic, 0600, folder 0700
    return asset


@router.get("/types")
def list_types():
    return node("types", {})


@router.get("/chrome")
def chrome_fields():
    return node("chrome", {})


@router.get("/builtin/{t}")
def list_builtin(t: str):
    if not known_type(t):
        raise HTTPException(404, f"unknown asset type {t!r}")
    return {"items": builtin_assets(t)}


@router.get("/assets")
def list_assets(type: str | None = None):
    if type is not None and not known_type(type):
        raise HTTPException(404, f"unknown asset type {type!r}")
    return {"items": saved(type)}


@router.get("/assets/{t}/{iid}")
def get_asset(t: str, iid: str):
    p = _path(t, iid)
    if not p.exists():
        raise HTTPException(404, "no such asset")
    return {"asset": json.loads(p.read_text("utf-8"))}


@router.get("/library")
def library():
    items = []
    for a in saved():
        m = a.get("designed") if isinstance(a.get("designed"), dict) else None
        if not m:
            continue
        items.append({"uid": m.get("uid"), "ref": m.get("ref"), "type": a["type"], "id": a["id"], "name": a.get("name", a["id"]), "addon": m.get("addon"),
                      "revision": m.get("revision"), "updatedAt": m.get("updatedAt"), "app": m.get("app", APP_ID), "path": f"assets/{a['type']}/{a['id']}.json"})
    return {"$axf": "designer-library@1", "items": items}


@router.post("/validate")
def validate(body: dict = Body(...)):
    """The framework validator on an asset, nothing saved: {ok, errors}."""
    res = node("validate", {"asset": body.get("asset")})
    return {"ok": bool(res.get("ok")), "errors": [str(e) for e in res.get("errors") or []]}


@router.post("/assets")
def save_asset(body: dict = Body(...)):
    """Save (create or overwrite) one designed asset. `overwrite: false` refuses an id that is already saved."""
    a = clean(body.get("asset"))
    if a["id"] in builtin_ids(a["type"]):
        raise HTTPException(409, f"{a['id']} is a built-in {a['type']}; save under another id (built-ins are never overwritten)")
    with _lock:
        p = _path(a["type"], a["id"])
        previous = None
        if p.exists():
            if body.get("overwrite") is False:
                raise HTTPException(409, f"{a['id']} is already saved; pick another id or overwrite it")
            try:
                previous = json.loads(p.read_text("utf-8"))
            except (OSError, ValueError):
                previous = None
        elif len(saved()) >= MAX_ASSETS:
            raise HTTPException(409, f"at most {MAX_ASSETS} designed assets; delete some first")
        asset = _write(a, previous, str(body.get("by") or ""))
    return {"ok": True, "asset": asset}


@router.post("/assets/{t}/{iid}/duplicate")
def duplicate_asset(t: str, iid: str, body: dict = Body(...)):
    src = _path(t, iid)
    if not src.exists():
        raise HTTPException(404, "no such asset")
    new_id = body.get("id")
    if not isinstance(new_id, str) or not ID_RE.match(new_id) or new_id.startswith(PREVIEW):
        raise HTTPException(400, "id must be 2–48 lowercase letters, digits and dashes")
    if new_id in builtin_ids(t):
        raise HTTPException(409, f"{new_id} is a built-in {t}; pick another id")
    with _lock:
        if _path(t, new_id).exists():
            raise HTTPException(409, f"{new_id} is already saved")
        a = json.loads(src.read_text("utf-8"))
        a.pop("designed", None)
        a["id"] = new_id
        a["name"] = str(body.get("name") or f"{a.get('name', iid)} copy")[:120]
        asset = _write(clean(a), None, str(body.get("by") or ""))
    return {"ok": True, "asset": asset}


@router.delete("/assets/{t}/{iid}")
def delete_asset(t: str, iid: str):
    p = _path(t, iid)
    if not p.exists():
        raise HTTPException(404, "no such asset")
    p.unlink()
    return {"ok": True}
