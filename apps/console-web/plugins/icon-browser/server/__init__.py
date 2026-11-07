"""Icon Browser — server part. Mounted at /api/plugins/icon-browser/ (console token, 404 when disabled).

Serves the framework's icon library (`framework/icon-library/`, icon-library@1: index.json, one folder per set with
icon-pack assets and a sidecar index of every icon) read-only, so the console bundle never carries its ~4.5 MB, and
keeps this plugin's own data in its data folder (plugin-lifecycle@1):

    config.json      settings (view, tile size, tree thumbnails, sort, open sections …)
    sources/<id>.json  icon-source assets (icon-source@1) — never a secret inside
    secrets.json     the secure store: { ref: value } (0600); a value is written and never read back by any route
    packs/<id>.json  icon-pack assets you composed or imported
    maps/<id>.json   icon-map assets saved by the Icon Manager

    GET  /library                          the index (sets, packs, counts, categories, licences)
    GET  /search?q&set&category&style&limit&offset   icons across every set and saved pack (name, tags, category)
    GET  /sets/<id>                        one set's icon index (name → pack, category, tags)
    GET  /pack/<id>                        one icon-pack asset (library or saved)
    GET  /packs   PUT /packs/<id>   DELETE /packs/<id>        your packs
    GET  /maps    PUT /maps/<id>    DELETE /maps/<id>         saved icon maps (+ the framework's and the apps' shipped ones, read-only)
    GET  /sources PUT /sources/<id> DELETE /sources/<id>      icon sources; POST /sources/<id>/test checks reachability
    GET  /secrets                          the refs that have a value (never the values); POST /secrets/<ref> sets one; DELETE forgets it
    POST /import  { source | folder, id, style?, grid?, stroke? }   convert a local folder of SVGs into packs (icon-import.mjs)
    GET  /config  PUT /config              this plugin's settings

Secrets never leave the server: a source's auth names its secret by `secretRef`; the value is used only by the server
when it reads that source. Nothing here names another plugin.
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
from axf_server import storage, http

router = APIRouter()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
GLYPH_RE = re.compile(r"^[a-z][a-z0-9-]*$")
PATH_RE = re.compile(r"^[MmZzLlHhVvCcSsQqTtAa0-9 ,.\-+eE\n\r\t]+$")
SECRET_NAMES = {"password", "pass", "passwd", "token", "accesstoken", "access_token", "refreshtoken", "refresh_token", "apikey", "api_key", "secret", "clientsecret", "client_secret", "privatekey", "private_key", "key"}
SOURCE_KINDS = ("local", "http", "rest", "mcp", "ftp", "sftp", "gdrive", "gphotos", "dropbox", "repo")
AUTH_MODES = ("none", "basic", "password", "key", "token", "apikey", "oauth")
VIEWS = ("tree", "grid", "list")
TILES = ("sm", "md", "lg")
SORTS = ("name", "set", "category", "pack")
_lock = threading.Lock()
_cache: dict[str, Any] = {}

DEFAULT_CONFIG: dict[str, Any] = {
    "view": "grid", "tile": "md", "names": True, "treeThumbs": True, "sort": "name", "set": "", "category": "", "style": "",
    "panes": {"library": True, "composer": True, "details": True}, "openNewGroup": "docked", "sections": {},
}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_ICON_BROWSER_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "icon-browser"))


def library_dir() -> Path:
    return Path(os.environ.get("AXF_ICON_LIBRARY_SOURCE") or (cx.ROOT / "framework" / "icon-library"))


def _read(p: Path) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return None


def _stamp(p: Path) -> int:
    try:
        return p.stat().st_mtime_ns
    except OSError:
        return 0


def _cached(key: str, stamp: int, make):
    with _lock:
        hit = _cache.get(key)
        if hit and hit[0] == stamp:
            return hit[1]
    value = make()
    with _lock:
        _cache[key] = (stamp, value)
    return value


def _folder_stamp(folder: Path) -> int:
    try:
        return max([_stamp(folder)] + [_stamp(f) for f in folder.glob("*.json")])
    except OSError:
        return 0


def _is_secret_name(k: str) -> bool:
    return re.sub(r"[-\s]", "", str(k)).lower() in SECRET_NAMES


# ---------------------------------------------------------------- the library

def library_index() -> dict[str, Any]:
    f = library_dir() / "index.json"
    idx = _cached("index", _stamp(f), lambda: _read(f))
    if not isinstance(idx, dict) or idx.get("$axf") != "icon-library@1":
        raise HTTPException(503, "the icon library is missing: run node framework/cli/icon-import.mjs fetch all && build all")
    return idx


def set_index(set_id: str) -> dict[str, Any]:
    if not ID_RE.match(set_id):
        raise HTTPException(404, f"unknown set {set_id!r}")
    f = library_dir() / set_id / "index.json"
    side = _cached(f"set:{set_id}", _stamp(f), lambda: _read(f))
    if not isinstance(side, dict) or side.get("$axf") != "icon-library-set@1":
        raise HTTPException(404, f"no set {set_id!r} in the icon library")
    return side


def _pack_file(pid: str) -> Path | None:
    """A pack by id: one of the library's (any set folder), else a saved one."""
    if not ID_RE.match(pid):
        return None
    for e in library_index().get("sets", []):
        for p in e.get("packs", []):
            if p.get("id") == pid:
                f = library_dir() / str(p.get("file", ""))
                return f if f.is_file() and f.resolve().is_relative_to(library_dir().resolve()) else None
    f = data_dir() / "packs" / f"{pid}.json"
    return f if f.is_file() else None


def all_icons() -> list[dict[str, Any]]:
    """Every icon of every set and saved pack, flat: { name, set, pack, category, tags, style, ref }."""
    idx = library_index()
    packs_dir = data_dir() / "packs"
    stamp = _stamp(library_dir() / "index.json") ^ _folder_stamp(packs_dir)

    def make() -> list[dict[str, Any]]:
        out: list[dict[str, Any]] = []
        for e in idx.get("sets", []):
            sid = str(e.get("id", ""))
            try:
                side = set_index(sid)
            except HTTPException:
                continue
            style = str(e.get("style", ""))
            for name, m in (side.get("icons") or {}).items():
                if not isinstance(m, dict) or not GLYPH_RE.match(str(name)):
                    continue
                out.append({"name": name, "set": sid, "pack": str(m.get("pack", "")), "category": str(m.get("category", "")), "tags": [t for t in m.get("tags", []) if isinstance(t, str)][:8], "style": style, "ref": f"pack:{m.get('pack', '')}/{name}"})
        for f in sorted(packs_dir.glob("*.json")) if packs_dir.is_dir() else []:
            a = _read(f)
            if not isinstance(a, dict) or a.get("type") != "icon-pack" or not ID_RE.match(str(a.get("id", ""))):
                continue
            d = a.get("data") if isinstance(a.get("data"), dict) else {}
            for name in (d.get("glyphs") or {}):
                if GLYPH_RE.match(str(name)):
                    out.append({"name": name, "set": "mine", "pack": a["id"], "category": str(a.get("name", a["id"])), "tags": [t for t in a.get("tags", []) if isinstance(t, str)][:8], "style": str(d.get("style", "")), "ref": f"pack:{a['id']}/{name}"})
        return out

    return _cached("all-icons", stamp, make)


@router.get("/library")
def get_library() -> dict[str, Any]:
    idx = library_index()
    packs_dir = data_dir() / "packs"
    mine = [a for a in (_read(f) for f in sorted(packs_dir.glob("*.json"))) if isinstance(a, dict)] if packs_dir.is_dir() else []
    return {**idx, "mine": [{"id": a.get("id"), "name": a.get("name"), "count": len((a.get("data") or {}).get("glyphs") or {}), "style": (a.get("data") or {}).get("style", "")} for a in mine]}


@router.get("/search")
def search(q: str = "", set: str = "", category: str = "", style: str = "", limit: int = 400, offset: int = 0, sort: str = "name") -> dict[str, Any]:
    words = [w for w in q.lower().split() if w]
    items = all_icons()
    if set:
        items = [i for i in items if i["set"] == set]
    if category:
        items = [i for i in items if i["category"] == category]
    if style:
        items = [i for i in items if i["style"] == style]
    if words:
        def hit(i: dict[str, Any]) -> bool:
            hay = f"{i['name']} {' '.join(i['tags'])} {i['category']}".lower()
            return all(w in hay for w in words)
        items = [i for i in items if hit(i)]
    key = sort if sort in SORTS else "name"
    items = sorted(items, key=lambda i: (str(i.get(key, "")), i["name"], i["set"]))
    limit = max(1, min(int(limit), 2000))
    offset = max(0, int(offset))
    cats: dict[str, int] = {}
    for i in items:
        if i["category"]:
            cats[i["category"]] = cats.get(i["category"], 0) + 1
    return {"total": len(items), "offset": offset, "items": items[offset:offset + limit], "categories": dict(sorted(cats.items()))}


@router.get("/sets/{sid}")
def get_set(sid: str) -> dict[str, Any]:
    return set_index(sid)


@router.get("/pack/{pid}")
def get_pack(pid: str) -> dict[str, Any]:
    f = _pack_file(pid)
    if not f:
        raise HTTPException(404, f"no icon pack {pid!r}")
    a = _cached(f"pack:{pid}", _stamp(f), lambda: _read(f))
    if not isinstance(a, dict):
        raise HTTPException(404, f"no icon pack {pid!r}")
    return a


# ---------------------------------------------------------------- saved assets (packs, maps, sources)

def _check_pack(a: Any, pid: str) -> dict[str, Any]:
    if not isinstance(a, dict) or a.get("$axf") != "asset@1" or a.get("type") != "icon-pack" or a.get("id") != pid:
        raise HTTPException(422, "body must be an asset@1 icon-pack with this id")
    d = a.get("data")
    if not isinstance(d, dict) or not isinstance(d.get("glyphs"), dict) or not d["glyphs"]:
        raise HTTPException(422, "data.glyphs: at least one glyph")
    if len(d["glyphs"]) > 600:
        raise HTTPException(422, "data.glyphs: at most 600 glyphs per pack")
    for name, g in d["glyphs"].items():
        path = g if isinstance(g, str) else g.get("d") if isinstance(g, dict) else None
        if not GLYPH_RE.match(str(name)) or not isinstance(path, str) or not PATH_RE.match(path) or len(path) > 2000:
            raise HTTPException(422, f"data.glyphs.{name}: a lowercase name and path commands only (up to 2000 characters)")
    if len(json.dumps(a)) > 600_000:
        raise HTTPException(422, "pack too large")
    return a


def _check_map(a: Any, mid: str) -> dict[str, Any]:
    if not isinstance(a, dict) or a.get("$axf") != "asset@1" or a.get("type") != "icon-map" or a.get("id") != mid:
        raise HTTPException(422, "body must be an asset@1 icon-map with this id")
    d = a.get("data")
    if not isinstance(d, dict) or not isinstance(d.get("scope"), dict) or not isinstance(d.get("slots"), dict):
        raise HTTPException(422, "data.scope and data.slots are required")
    for slot, ref in d["slots"].items():
        if not re.match(r"^[a-z][a-z0-9-]*(\.[a-z0-9-]+)*$", str(slot)) or not isinstance(ref, str) or not (ref == "none" or GLYPH_RE.match(ref) or re.match(r"^pack:[a-z0-9][a-z0-9-]{0,63}/[a-z][a-z0-9-]*$", ref)):
            raise HTTPException(422, f"data.slots.{slot}: a ref is a glyph name, pack:<pack id>/<glyph> or none")
    if len(json.dumps(a)) > 400_000:
        raise HTTPException(422, "map too large")
    return a


def _check_source(a: Any, sid: str) -> dict[str, Any]:
    if not isinstance(a, dict) or a.get("$axf") != "asset@1" or a.get("type") != "icon-source" or a.get("id") != sid:
        raise HTTPException(422, "body must be an asset@1 icon-source with this id")
    d = a.get("data")
    if not isinstance(d, dict) or d.get("kind") not in SOURCE_KINDS or not isinstance(d.get("root"), str) or not d["root"].strip():
        raise HTTPException(422, "data.kind and data.root are required")
    auth = d.get("auth") if isinstance(d.get("auth"), dict) else {"mode": "none"}
    if auth.get("mode") not in AUTH_MODES:
        raise HTTPException(422, "data.auth.mode must be one of " + ", ".join(AUTH_MODES))
    for scope, obj in (("data", d), ("data.auth", auth), ("data.options", d.get("options") if isinstance(d.get("options"), dict) else {})):
        for k in obj:
            if _is_secret_name(k):
                raise HTTPException(422, f"{scope}.{k}: secrets never go in a source; store it with POST /secrets/<ref> and name it by auth.secretRef")
    if auth.get("mode") != "none" and not isinstance(auth.get("secretRef"), str):
        raise HTTPException(422, "data.auth.secretRef is required when auth.mode is not none")
    return a


def _folder_list(sub: str, typ: str) -> list[dict[str, Any]]:
    folder = data_dir() / sub
    if not folder.is_dir():
        return []
    out = []
    for f in sorted(folder.glob("*.json")):
        a = _read(f)
        if isinstance(a, dict) and a.get("type") == typ and ID_RE.match(str(a.get("id", ""))):
            out.append(a)
    return out


def _save(sub: str, aid: str, a: dict[str, Any]) -> None:
    storage.write_json(data_dir() / sub / f"{aid}.json", a)
    with _lock:
        _cache.pop("all-icons", None)


def _delete(sub: str, aid: str) -> bool:
    if not ID_RE.match(aid):
        raise HTTPException(404, "unknown id")
    f = data_dir() / sub / f"{aid}.json"
    if not f.is_file():
        return False
    f.unlink()
    with _lock:
        _cache.pop("all-icons", None)
    return True


@router.get("/packs")
def list_packs() -> dict[str, Any]:
    return {"items": _folder_list("packs", "icon-pack")}


@router.put("/packs/{pid}")
def put_pack(pid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not ID_RE.match(pid):
        raise HTTPException(422, "pack id: lowercase letters, digits and dashes (2-48)")
    a = _check_pack(body, pid)
    _save("packs", pid, a)
    return {"ok": True, "id": pid, "count": len(a["data"]["glyphs"])}


@router.delete("/packs/{pid}")
def delete_pack(pid: str) -> dict[str, Any]:
    return {"ok": True, "removed": _delete("packs", pid)}


def _shipped_maps() -> list[dict[str, Any]]:
    """The framework's and the apps' icon-map assets (read-only here): framework/assets/icon-map + apps/*/src/assets/icon-map."""
    out: list[dict[str, Any]] = []
    roots = [cx.ROOT / "framework" / "assets" / "icon-map"] + sorted((cx.ROOT / "apps").glob("*/src/assets/icon-map"))
    for folder in roots:
        if not folder.is_dir():
            continue
        where = "framework" if "framework" in folder.parts else folder.parts[folder.parts.index("apps") + 1]
        for f in sorted(folder.glob("*.json")):
            a = _read(f)
            if isinstance(a, dict) and a.get("type") == "icon-map" and ID_RE.match(str(a.get("id", ""))):
                out.append({**a, "shipped": where})
    return out


@router.get("/maps")
def list_maps() -> dict[str, Any]:
    return {"items": _shipped_maps() + [{**a, "shipped": ""} for a in _folder_list("maps", "icon-map")]}


@router.put("/maps/{mid}")
def put_map(mid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not ID_RE.match(mid):
        raise HTTPException(422, "map id: lowercase letters, digits and dashes (2-48)")
    a = _check_map(body, mid)
    a.pop("shipped", None)
    _save("maps", mid, a)
    return {"ok": True, "id": mid, "slots": len(a["data"]["slots"])}


@router.delete("/maps/{mid}")
def delete_map(mid: str) -> dict[str, Any]:
    return {"ok": True, "removed": _delete("maps", mid)}


@router.get("/sources")
def list_sources() -> dict[str, Any]:
    return {"items": _folder_list("sources", "icon-source")}


@router.put("/sources/{sid}")
def put_source(sid: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not ID_RE.match(sid):
        raise HTTPException(422, "source id: lowercase letters, digits and dashes (2-48)")
    a = _check_source(body, sid)
    _save("sources", sid, a)
    return {"ok": True, "id": sid}


@router.delete("/sources/{sid}")
def delete_source(sid: str) -> dict[str, Any]:
    return {"ok": True, "removed": _delete("sources", sid)}


@router.post("/sources/{sid}/test")
def test_source(sid: str) -> dict[str, Any]:
    """Is the source reachable? Local: the folder exists and holds SVG or icon-pack files. HTTP / REST: a GET answers. Others: configured, not probed here."""
    if not ID_RE.match(sid):
        raise HTTPException(404, "unknown source")
    a = _read(data_dir() / "sources" / f"{sid}.json")
    if not isinstance(a, dict):
        raise HTTPException(404, f"no source {sid!r}")
    d = a.get("data") or {}
    kind, root = d.get("kind"), str(d.get("root", ""))
    if kind == "local":
        p = (cx.ROOT / root) if not os.path.isabs(root) else Path(root)
        if not p.is_dir():
            return {"ok": False, "detail": f"{p} is not a folder"}
        svgs = len(list(p.glob("*.svg")))
        packs = len([f for f in p.glob("**/*.json") if isinstance(_read(f), dict) and _read(f).get("type") == "icon-pack"])
        return {"ok": svgs + packs > 0, "detail": f"{svgs} SVG file(s), {packs} icon-pack asset(s)", "svgs": svgs, "packs": packs}
    if kind in ("http", "rest"):
        headers = _auth_headers(d)
        try:
            r = http.request("GET", root, headers=headers, timeout=15, max_bytes=65536)
            return {"ok": 200 <= r.status < 400, "detail": f"HTTP {r.status}", "status": r.status}
        except Exception as e:  # noqa: BLE001 — the reason is the answer
            return {"ok": False, "detail": str(e)[:200]}
    return {"ok": True, "detail": f"{kind}: configured (connectors for this kind read it when importing)"}


def _secrets() -> dict[str, str]:
    s = storage.read_json(data_dir() / "secrets.json", {})
    return s if isinstance(s, dict) else {}


def _auth_headers(d: dict[str, Any]) -> dict[str, str]:
    auth = d.get("auth") if isinstance(d.get("auth"), dict) else {}
    mode, ref = auth.get("mode", "none"), str(auth.get("secretRef", ""))
    value = _secrets().get(ref, "") if ref else ""
    if not value or mode == "none":
        return {}
    if mode in ("token", "oauth"):
        return {"Authorization": f"Bearer {value}"}
    if mode == "apikey":
        return {"X-API-Key": value}
    if mode == "basic":
        import base64
        return {"Authorization": "Basic " + base64.b64encode(value.encode()).decode()}
    return {}


@router.get("/secrets")
def list_secrets() -> dict[str, Any]:
    return {"refs": sorted(_secrets().keys())}


@router.post("/secrets/{ref}")
def set_secret(ref: str, body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not re.match(r"^[a-z0-9][a-z0-9._-]{0,119}$", ref):
        raise HTTPException(422, "ref: lowercase letters, digits, dots, dashes")
    value = body.get("value")
    if not isinstance(value, str) or not value or len(value) > 8192:
        raise HTTPException(422, "value: a non-empty string")
    with _lock:
        s = _secrets()
        s[ref] = value
        storage.write_json(data_dir() / "secrets.json", s, indent=None)
    return {"ok": True, "ref": ref}


@router.delete("/secrets/{ref}")
def delete_secret(ref: str) -> dict[str, Any]:
    with _lock:
        s = _secrets()
        had = ref in s
        s.pop(ref, None)
        storage.write_json(data_dir() / "secrets.json", s, indent=None)
    return {"ok": True, "removed": had}


# ---------------------------------------------------------------- import

@router.post("/import")
def import_folder(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    """Convert a local folder of SVG files (a local source's root, or a folder under the repo) into icon packs saved here."""
    pid = str(body.get("id", ""))
    if not ID_RE.match(pid):
        raise HTTPException(422, "id: lowercase letters, digits and dashes (2-48)")
    folder = ""
    if isinstance(body.get("source"), str):
        a = _read(data_dir() / "sources" / f"{body['source']}.json") if ID_RE.match(body["source"]) else None
        if not isinstance(a, dict) or (a.get("data") or {}).get("kind") != "local":
            raise HTTPException(422, "source: a local icon source")
        folder = str((a.get("data") or {}).get("root", ""))
    elif isinstance(body.get("folder"), str):
        folder = body["folder"]
    p = (cx.ROOT / folder) if folder and not os.path.isabs(folder) else Path(folder or "/nonexistent")
    if not p.is_dir():
        raise HTTPException(422, f"{p} is not a folder")
    out = data_dir() / "packs"
    out.mkdir(parents=True, exist_ok=True)
    args = ["node", str(cx.ROOT / "framework" / "cli" / "icon-import.mjs"), "convert", str(p), "--id", pid, "--out", str(out), "--json"]
    for k in ("name", "style", "grid", "stroke", "linecap", "category", "license"):
        v = body.get(k)
        if isinstance(v, (str, int, float)) and str(v):
            args += [f"--{k}", str(v)[:80]]
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=120, cwd=str(cx.ROOT), check=False)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(500, f"import failed: {e}") from e
    if r.returncode != 0:
        raise HTTPException(422, (r.stderr or r.stdout or "import failed").strip()[:400])
    with _lock:
        _cache.pop("all-icons", None)
    try:
        return {"ok": True, **json.loads(r.stdout.strip().splitlines()[-1])}
    except (ValueError, IndexError):
        return {"ok": True, "detail": r.stdout.strip()[:400]}


# ---------------------------------------------------------------- settings

def clean_config(raw: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    c = json.loads(json.dumps(base or DEFAULT_CONFIG))
    if not isinstance(raw, dict):
        return c
    if raw.get("view") in VIEWS:
        c["view"] = raw["view"]
    if raw.get("tile") in TILES:
        c["tile"] = raw["tile"]
    if raw.get("sort") in SORTS:
        c["sort"] = raw["sort"]
    for k in ("names", "treeThumbs"):
        if isinstance(raw.get(k), bool):
            c[k] = raw[k]
    for k in ("set", "category", "style"):
        if isinstance(raw.get(k), str) and len(raw[k]) <= 60:
            c[k] = raw[k]
    if raw.get("openNewGroup") in ("docked", "floating"):
        c["openNewGroup"] = raw["openNewGroup"]
    if isinstance(raw.get("panes"), dict):
        c["panes"] = {k: bool(raw["panes"].get(k, c["panes"].get(k, True))) for k in ("library", "composer", "details")}
    if isinstance(raw.get("sections"), dict):
        c["sections"] = {str(k)[:40]: bool(v) for k, v in list(raw["sections"].items())[:40]}
    return c


@router.get("/config")
def get_config() -> dict[str, Any]:
    return clean_config(_read(data_dir() / "config.json"))


@router.put("/config")
def put_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    with _lock:
        cur = clean_config(_read(data_dir() / "config.json"))
        new = clean_config(body, cur)
        storage.write_json(data_dir() / "config.json", new)
    return new
