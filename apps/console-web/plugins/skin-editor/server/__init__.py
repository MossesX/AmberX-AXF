"""Skin editor — server part. Mounted at /api/plugins/skin-editor/ (console token, 404 when disabled).

The token registry (framework/schemas/token-registry.json, token-registry@1) is read here and searched with the same
rule as the engine (every word must hit id, element, description, area, state, source, level). Skin sessions
(skin-snapshot@1: one chain per picked UI) and exported skins (asset@1 `skin`) live in the plugin's data folder, so
they follow Brett to every browser and every transport (REST, MCP, CLI, voice) sees the same chain. The snapshot rules
here are the Python twin of framework/core/engines/token-registry.mjs; test.py replays the engine's fixture against them.
Nothing here names another plugin.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path

router = APIRouter()

FRAME = "skin-snapshot@1"
DEFAULT_SKIN_ID = "default"
DEFAULT_SKIN_LABEL = "Default skin"
SNAPSHOT_MAX = 1000
TOKEN_ID = re.compile(r"^--fx-[a-z0-9]+(-[a-z0-9]+)*$")
SKIN_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,59}$")
UI_KINDS = ("view", "dialog", "plugin", "element", "screen")
UI_KEY = re.compile(r"^(view|dialog|plugin|element|screen):[a-z0-9][a-z0-9._:-]{0,79}$", re.I)
LEVEL_RANK = {"basic": 0, "pro": 1, "advanced": 2}
SKIN_VARS_KEY = "axf.skin-editor.vars"
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SKIN_EDITOR_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "skin-editor"))


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def _dict(body: Any) -> dict[str, Any]:
    """A request body as a dict (a direct call without one, as the tests make, hands over FastAPI's Body marker)."""
    return body if isinstance(body, dict) else {}


def _write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(f".{os.getpid()}.tmp")
    tmp.write_text(json.dumps(doc, indent=2) + "\n", "utf-8")
    tmp.replace(path)


# ---------------------------------------------------------------- the registry (read side)

def registry_file() -> Path:
    return cx.ROOT / "framework" / "schemas" / "token-registry.json"


def registry() -> list[dict[str, Any]]:
    try:
        doc = json.loads(registry_file().read_text("utf-8"))
    except (OSError, ValueError):
        return []
    return [t for t in doc.get("tokens", []) if isinstance(t, dict) and TOKEN_ID.match(str(t.get("id", "")))]


def search_tokens(tokens: list[dict[str, Any]], q: str = "", area: str = "", element: str = "", level: str = "", state: str = "", scheme: str = "", source: str = "") -> list[dict[str, Any]]:
    words = [w for w in (q or "").lower().split() if w]
    out = []
    for t in tokens:
        if area and t.get("area") != area:
            continue
        if element and t.get("element") != element:
            continue
        if level and LEVEL_RANK.get(t.get("level"), 2) > LEVEL_RANK.get(level, 2):
            continue
        if state and t.get("state") != state:
            continue
        if scheme and t.get("scheme") not in (scheme, "both"):
            continue
        if source and source not in str(t.get("source", "")) and not any(source in s for s in t.get("sources", [])):
            continue
        hay = f"{t.get('id')} {t.get('element')} {t.get('description')} {t.get('area')} {t.get('state')} {t.get('source')} {t.get('level')}".lower()
        if all(w in hay for w in words):
            out.append(t)
    return out


@router.get("/registry")
def get_registry(q: str = "", area: str = "", element: str = "", level: str = "", state: str = "", scheme: str = "", source: str = "") -> dict[str, Any]:
    tokens = registry()
    hits = search_tokens(tokens, q, area, element, level, state, scheme, source)
    return {"total": len(tokens), "hits": len(hits), "tokens": hits}


@router.get("/registry/summary")
def get_registry_summary() -> dict[str, Any]:
    tokens = registry()

    def count(k: str) -> dict[str, int]:
        out: dict[str, int] = {}
        for t in tokens:
            out[str(t.get(k))] = out.get(str(t.get(k)), 0) + 1
        return out

    return {"total": len(tokens), "elements": count("element"), "areas": count("area"), "levels": count("level"), "states": count("state")}


@router.get("/registry/token/{token}")
def get_registry_token(token: str) -> dict[str, Any]:
    for t in registry():
        if t["id"] == token:
            return t
    raise HTTPException(404, f"no token {token} in the registry")


# ---------------------------------------------------------------- the UIs a sandbox can draw

ELEMENTS = ["button", "field", "segmented", "chip", "tab-group", "container", "grid", "note", "toolbar", "slider", "dialog"]


@router.get("/uis")
def get_uis() -> dict[str, Any]:
    out: list[dict[str, Any]] = []
    plugins = cx.ROOT / "apps" / "console-web" / "plugins"
    if plugins.is_dir():
        for d in sorted(plugins.iterdir()):
            f = d / "plugin.json"
            if d.name.startswith("_") or not f.is_file():
                continue
            try:
                m = json.loads(f.read_text("utf-8"))
            except (OSError, ValueError):
                continue
            out.append({"kind": "plugin", "id": d.name, "label": str(m.get("name") or d.name), "source": f"plugin:{d.name}"})
            for p in m.get("provides", []) or []:
                if isinstance(p, str) and p.startswith("view:"):
                    out.append({"kind": "view", "id": p[5:], "label": p[5:].replace("-", " ").title(), "source": f"plugin:{d.name}"})
                elif isinstance(p, str) and p.startswith("dialog:"):
                    out.append({"kind": "dialog", "id": p[7:], "label": p[7:].replace("-", " ").title(), "source": f"plugin:{d.name}"})
    for e in ELEMENTS:
        out.append({"kind": "element", "id": e, "label": e.replace("-", " ").title(), "source": "elements"})
    return {"uis": out}


# ---------------------------------------------------------------- sessions (skin-snapshot@1, the Python twin)

def _b36(n: int) -> str:
    digits = "0123456789abcdefghijklmnopqrstuvwxyz"
    if n == 0:
        return "0"
    out = ""
    while n:
        n, r = divmod(n, 36)
        out = digits[r] + out
    return out


def _ms(iso: str) -> int:
    return int(datetime.fromisoformat(iso.replace("Z", "+00:00")).timestamp() * 1000)


def snapshot_id(at: str, n: int) -> str:
    return f"s{_b36(_ms(at))}{_b36(n)}"


def normalize_ui(ui: Any) -> dict[str, str]:
    kind = ui.get("kind") if isinstance(ui, dict) and ui.get("kind") in UI_KINDS else "view"
    iid = str(ui.get("id", "") if isinstance(ui, dict) else "")[:80] or "home"
    return {"kind": kind, "id": iid, "label": str(ui.get("label", "") if isinstance(ui, dict) else "")[:120]}


def ui_of_key(key: str, label: str = "") -> dict[str, str]:
    if not UI_KEY.match(key or ""):
        raise HTTPException(400, "a UI is <kind>:<id> with kind view | dialog | plugin | element | screen")
    kind, iid = key.split(":", 1)
    return {"kind": kind, "id": iid, "label": label[:120]}


def root_snapshot(ui: dict[str, str], by: str, at: str) -> dict[str, Any]:
    return {"$axf": FRAME, "id": DEFAULT_SKIN_ID, "parent": None, "at": at, "by": by, "label": DEFAULT_SKIN_LABEL, "kind": "default", "ui": normalize_ui(ui), "edits": [], "state": {}}


def _scalar(v: Any) -> bool:
    return isinstance(v, (str, bool)) or (isinstance(v, (int, float)) and not isinstance(v, bool) and v == v)


def apply_edits(state: dict[str, Any], edits: list[dict[str, Any]]) -> dict[str, Any]:
    out = dict(state)
    for e in edits:
        if e.get("to") in (None, ""):
            out.pop(e["token"], None)
        else:
            out[e["token"]] = e["to"]
    return out


def diff_states(a: dict[str, Any], b: dict[str, Any]) -> list[dict[str, Any]]:
    out = []
    for k in sorted(set(a) | set(b)):
        if a.get(k) != b.get(k):
            out.append({"token": k, "from": a.get(k), "to": b.get(k)})
    return out


def edit_label(edits: list[dict[str, Any]]) -> str:
    if len(edits) == 1:
        to = edits[0]["to"]
        return f"{edits[0]['token']} → {'default' if to is None else to}"
    return f"{len(edits)} tokens changed"


def edit_snapshot(chain: list[dict[str, Any]], head: dict[str, Any], raw: Any, by: str, at: str, label: str = "") -> dict[str, Any] | None:
    items = raw if isinstance(raw, list) else [raw]
    edits = []
    for e in items:
        if not isinstance(e, dict) or not TOKEN_ID.match(str(e.get("token", ""))):
            continue
        to = e.get("to")
        to = to if _scalar(to) and to != "" else None
        frm = head["state"].get(e["token"])
        if frm != to:
            edits.append({"token": e["token"], "from": frm, "to": to})
    if not edits:
        return None
    if len(chain) >= SNAPSHOT_MAX:
        raise HTTPException(409, f"snapshot chain is full ({SNAPSHOT_MAX}): export a skin and start again")
    return {"$axf": FRAME, "id": snapshot_id(at, len(chain)), "parent": head["id"], "at": at, "by": by, "label": (label or edit_label(edits))[:160], "kind": "edit", "ui": head["ui"], "edits": edits, "state": apply_edits(head["state"], edits)}


def chain_to(chain: list[dict[str, Any]], sid: str) -> list[dict[str, Any]]:
    by_id = {s["id"]: s for s in chain}
    out: list[dict[str, Any]] = []
    cur = by_id.get(sid)
    seen: set[str] = set()
    while cur and cur["id"] not in seen:
        out.insert(0, cur)
        seen.add(cur["id"])
        cur = by_id.get(cur["parent"]) if cur.get("parent") else None
    return out


def snapshot_rows(chain: list[dict[str, Any]], head_id: str) -> list[dict[str, Any]]:
    on_path = {s["id"] for s in chain_to(chain, head_id)}
    by_id = {s["id"]: s for s in chain}

    def depth(s: dict[str, Any]) -> int:
        d, cur, seen = 0, s, set()
        while cur and cur.get("parent") in by_id and cur["id"] not in seen:
            seen.add(cur["id"])
            cur = by_id[cur["parent"]]
            d += 1
        return d

    rows = sorted(chain, key=lambda s: (s["at"], s["id"]))
    return [{"id": s["id"], "parent": s["parent"], "at": s["at"], "by": s["by"], "label": s["label"], "kind": s["kind"], "edits": len(s["edits"]), "tokens": len(s["state"]), "depth": depth(s), "onPath": s["id"] in on_path, "head": s["id"] == head_id} for s in rows]


def revert_snapshot(chain: list[dict[str, Any]], head: dict[str, Any], target_id: str, by: str, at: str) -> dict[str, Any] | None:
    target = next((s for s in chain if s["id"] == target_id), None)
    if not target:
        raise HTTPException(404, f'no snapshot "{target_id}"')
    edits = diff_states(head["state"], target["state"])
    if not edits:
        return None
    return {"$axf": FRAME, "id": snapshot_id(at, len(chain)), "parent": head["id"], "at": at, "by": by, "label": f"Reverted to {target['label'] or target['id']}", "kind": "revert", "ui": head["ui"], "edits": edits, "state": dict(target["state"])}


def snapshot_before(chain: list[dict[str, Any]], head_id: str, iso: str) -> dict[str, Any] | None:
    path = chain_to(chain, head_id)
    t = _ms(iso)
    pick = path[0] if path else None
    for s in path:
        if _ms(s["at"]) <= t:
            pick = s
    return pick


def export_skin(state: dict[str, Any], sid: str, name: str, base: dict[str, Any], sets: dict[str, Any], description: str = "", author: str = "Skin editor") -> dict[str, Any]:
    sid = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9-]+", "-", (sid or "").lower()))[:60]
    if not SKIN_ID.match(sid):
        raise HTTPException(400, "a skin id is 1–60 lowercase letters, digits and dashes")
    if not isinstance(base, dict) or not all(isinstance(base.get(k), str) and base.get(k) for k in ("layoutTheme", "colorTheme", "styleTheme")) or not isinstance(base.get("assets"), dict):
        raise HTTPException(400, "a base skin with layoutTheme, colorTheme, styleTheme and assets is required")
    extras = base.get("extras") if isinstance(base.get("extras"), dict) else {}
    settings = dict(extras.get("settings") or {}) if isinstance(extras.get("settings"), dict) else {}
    mapped, unmapped = [], {}
    for token, value in state.items():
        s = sets.get(token)
        if isinstance(s, dict) and s.get("target") and s.get("path"):
            key = "axf.tokens." + re.sub(r"^tokens\.", "", s["target"])
            cur = settings.get(key) if isinstance(settings.get(key), dict) else {}
            star = dict(cur.get("*") or {}) if isinstance(cur.get("*"), dict) else {}
            star[s["path"]] = value
            settings[key] = {**cur, "*": star}
            mapped.append(token)
        else:
            unmapped[token] = value
    if unmapped:
        prev = settings.get(SKIN_VARS_KEY) if isinstance(settings.get(SKIN_VARS_KEY), dict) else {}
        settings[SKIN_VARS_KEY] = {**prev, **unmapped}
    data: dict[str, Any] = {"layoutTheme": base["layoutTheme"], "colorTheme": base["colorTheme"], "styleTheme": base["styleTheme"]}
    if isinstance(base.get("behaviorTheme"), str) and base["behaviorTheme"]:
        data["behaviorTheme"] = base["behaviorTheme"]
    data["assets"] = dict(base["assets"])
    data["preview"] = {"caption": (description or f"{name or sid}: exported from the Skin editor.")[:160]}
    data["extras"] = {**extras, "settings": settings}
    if isinstance(base.get("iconPack"), str) and base["iconPack"]:
        data["iconPack"] = base["iconPack"]
    if isinstance(base.get("parts"), dict):
        data["parts"] = base["parts"]
    tags = ["skin", "exported"]
    asset = {"$axf": "asset@1", "type": "skin", "id": sid, "name": (name or sid)[:120], "version": "1.0.0", "description": (description or f"Exported from the Skin editor with {len(state)} token edit(s).")[:500], "author": author[:80] or "Skin editor", "tags": tags, "data": data}
    return {"asset": asset, "mapped": sorted(mapped), "unmapped": sorted(unmapped)}


def token_sets() -> dict[str, Any]:
    """token → control@1 set, as the registry records it (the CLI's sync fills `set`)."""
    return {t["id"]: t["set"] for t in registry() if isinstance(t.get("set"), dict)}


def default_base() -> dict[str, Any]:
    """The console's own look (axf.manifest.json defaults): the default skin's base when the caller gives none."""
    try:
        d = json.loads((cx.ROOT / "apps" / "console-web" / "axf.manifest.json").read_text("utf-8")).get("defaults", {})
    except (OSError, ValueError):
        d = {}
    sections = {"layout", "color-theme", "style-theme", "behavior-theme", "skin", "design-package"}
    return {"layoutTheme": d.get("layout", "focus-top"), "colorTheme": d.get("color-theme", "hub-night"), "styleTheme": d.get("style-theme", "hub"), "behaviorTheme": d.get("behavior-theme", "standard"), "assets": {k: v for k, v in d.items() if k not in sections and isinstance(v, str)}}


# ---------------------------------------------------------------- storage

def _session_path(key: str) -> Path:
    return data_dir() / "sessions" / (re.sub(r"[^a-z0-9._-]+", "_", key.lower()) + ".json")


def load_session(key: str, label: str = "", create: bool = False) -> dict[str, Any]:
    ui = ui_of_key(key, label)
    p = _session_path(key)
    if p.is_file():
        try:
            doc = json.loads(p.read_text("utf-8"))
            if isinstance(doc, dict) and isinstance(doc.get("chain"), list) and doc["chain"]:
                if label and not doc["ui"].get("label"):
                    doc["ui"]["label"] = label
                return doc
        except (OSError, ValueError):
            pass
    if not create:
        raise HTTPException(404, f"no skin session for {key}: pick it first")
    at = now_iso()
    root = root_snapshot(ui, "skin-editor", at)
    return {"$axf": "skin-session@1", "key": key, "ui": root["ui"], "head": root["id"], "chain": [root], "updatedAt": at}


def save_session(doc: dict[str, Any]) -> None:
    doc["updatedAt"] = now_iso()
    _write(_session_path(doc["key"]), doc)
    _write(data_dir() / "current.json", {"key": doc["key"], "at": doc["updatedAt"]})


def head_of(doc: dict[str, Any]) -> dict[str, Any]:
    return next((s for s in doc["chain"] if s["id"] == doc["head"]), doc["chain"][0])


def view(doc: dict[str, Any], snapshot: dict[str, Any] | None = None) -> dict[str, Any]:
    head = head_of(doc)
    out = {"ui": doc["ui"], "head": doc["head"], "chain": doc["chain"], "rows": snapshot_rows(doc["chain"], doc["head"]), "state": head["state"], "updatedAt": doc.get("updatedAt", "")}
    if snapshot is not None or "snapshot" in (doc.get("_extra") or {}):
        out["snapshot"] = snapshot
    return out


def summary(doc: dict[str, Any]) -> dict[str, Any]:
    return {"key": doc["key"], "ui": doc["ui"], "head": doc["head"], "snapshots": len(doc["chain"]), "tokens": len(head_of(doc)["state"]), "updatedAt": doc.get("updatedAt", "")}


def current_key() -> str:
    try:
        return str(json.loads((data_dir() / "current.json").read_text("utf-8")).get("key", ""))
    except (OSError, ValueError):
        return ""


def all_sessions() -> list[dict[str, Any]]:
    out = []
    folder = data_dir() / "sessions"
    for f in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            doc = json.loads(f.read_text("utf-8"))
            if isinstance(doc, dict) and doc.get("chain"):
                out.append(doc)
        except (OSError, ValueError):
            continue
    return sorted(out, key=lambda d: d.get("updatedAt", ""), reverse=True)


@router.get("/state")
def get_state() -> dict[str, Any]:
    key = current_key()
    cur = None
    if key:
        try:
            cur = summary(load_session(key))
        except HTTPException:
            cur = None
    return {"current": cur, "sessions": len(all_sessions())}


@router.get("/sessions")
def get_sessions() -> dict[str, Any]:
    return {"sessions": [summary(d) for d in all_sessions()]}


@router.get("/sessions/{ui}")
def get_session(ui: str) -> dict[str, Any]:
    with _lock:
        return view(load_session(ui))


@router.post("/sessions/{ui}/pick")
def pick_session(ui: str, body: dict = Body(default={})) -> dict[str, Any]:
    body = _dict(body)
    with _lock:
        doc = load_session(ui, str(body.get("label") or ""), create=True)
        save_session(doc)
        return view(doc)


def _snapshot_result(doc: dict[str, Any], snap: dict[str, Any] | None) -> dict[str, Any]:
    if snap is not None:
        doc["chain"].append(snap)
        doc["head"] = snap["id"]
        save_session(doc)
    out = view(doc)
    out["snapshot"] = snap
    return out


@router.post("/sessions/{ui}/edit")
def edit_session(ui: str, body: dict = Body(...)) -> dict[str, Any]:
    edits = body.get("edits")
    if not isinstance(edits, list) or not edits:
        raise HTTPException(400, "edits: [{ token, to }] required (to = null puts the token back to the default skin)")
    with _lock:
        doc = load_session(ui, create=True)
        snap = edit_snapshot(doc["chain"], head_of(doc), edits, str(body.get("by") or "skin-editor")[:80], now_iso(), str(body.get("label") or ""))
        return _snapshot_result(doc, snap)


def revert_target(doc: dict[str, Any], body: dict[str, Any]) -> str:
    if body.get("snapshot"):
        sid = str(body["snapshot"])
        if sid in ("default", "start", "beginning", "original"):
            return doc["chain"][0]["id"]
        if not any(s["id"] == sid for s in doc["chain"]):
            raise HTTPException(404, f'no snapshot "{sid}"')
        return sid
    if body.get("minutesAgo") is not None:
        try:
            minutes = float(body["minutesAgo"])
        except (TypeError, ValueError):
            raise HTTPException(400, "minutesAgo must be a number")
        iso = (datetime.now(timezone.utc) - timedelta(minutes=minutes)).isoformat(timespec="milliseconds").replace("+00:00", "Z")
        return (snapshot_before(doc["chain"], doc["head"], iso) or doc["chain"][0])["id"]
    if body.get("at"):
        try:
            return (snapshot_before(doc["chain"], doc["head"], str(body["at"])) or doc["chain"][0])["id"]
        except ValueError:
            raise HTTPException(400, "at must be an ISO time")
    raise HTTPException(400, "give snapshot (an id or 'default'), minutesAgo or at")


@router.post("/sessions/{ui}/revert")
def revert_session(ui: str, body: dict = Body(default={})) -> dict[str, Any]:
    body = _dict(body)
    with _lock:
        doc = load_session(ui)
        target = revert_target(doc, body)
        snap = revert_snapshot(doc["chain"], head_of(doc), target, str(body.get("by") or "skin-editor")[:80], now_iso())
        out = _snapshot_result(doc, snap)
        out["target"] = target
        return out


@router.post("/sessions/{ui}/undo")
def undo_session(ui: str, body: dict = Body(default={})) -> dict[str, Any]:
    body = _dict(body)
    with _lock:
        doc = load_session(ui)
        head = head_of(doc)
        if not head.get("parent"):
            raise HTTPException(409, "already at the default skin: nothing to undo")
        snap = revert_snapshot(doc["chain"], head, head["parent"], str(body.get("by") or "skin-editor")[:80], now_iso())
        return _snapshot_result(doc, snap)


# ---------------------------------------------------------------- exported skins

def _skin_path(sid: str) -> Path:
    if not SKIN_ID.match(sid or ""):
        raise HTTPException(404, "no such skin")
    return data_dir() / "skins" / f"{sid}.json"


@router.post("/sessions/{ui}/export")
def export_session(ui: str, body: dict = Body(...)) -> dict[str, Any]:
    name = str(body.get("name") or "").strip()
    if not name:
        raise HTTPException(400, "name required")
    sid = str(body.get("id") or name)
    with _lock:
        doc = load_session(ui)
        snap = head_of(doc)
        if body.get("snapshot"):
            snap = next((s for s in doc["chain"] if s["id"] == body["snapshot"]), None) or _not_found(body["snapshot"])
        base = body.get("base") if isinstance(body.get("base"), dict) else default_base()
        r = export_skin(snap["state"], sid, name, base, token_sets(), str(body.get("description") or ""), str(body.get("by") or "Skin editor"))
        path = _skin_path(r["asset"]["id"])
        _write(path, r["asset"])
        r["file"] = str(path.relative_to(data_dir()))
        r["snapshot"] = snap["id"]
        return r


def _not_found(sid: Any) -> dict[str, Any]:
    raise HTTPException(404, f'no snapshot "{sid}"')


@router.get("/skins")
def get_skins() -> dict[str, Any]:
    out = []
    folder = data_dir() / "skins"
    for f in sorted(folder.glob("*.json")) if folder.is_dir() else []:
        try:
            a = json.loads(f.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        settings = ((a.get("data") or {}).get("extras") or {}).get("settings") or {}
        n = sum(len(v.get("*", {})) for k, v in settings.items() if k.startswith("axf.tokens.") and isinstance(v, dict)) + len(settings.get(SKIN_VARS_KEY) or {})
        out.append({"id": a.get("id"), "name": a.get("name"), "description": a.get("description", ""), "tokens": n, "file": f.name})
    return {"skins": out}


@router.get("/skins/{id}")
def get_skin(id: str) -> dict[str, Any]:
    p = _skin_path(id)
    if not p.is_file():
        raise HTTPException(404, "no such skin")
    return json.loads(p.read_text("utf-8"))


@router.delete("/skins/{id}")
def delete_skin(id: str) -> dict[str, Any]:
    p = _skin_path(id)
    if not p.is_file():
        raise HTTPException(404, "no such skin")
    p.unlink()
    return {"ok": True}


# ---------------------------------------------------------------- voice (the Python twin of skinVoiceIntent)

NUM = {"a": 1, "an": 1, "one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "fifteen": 15, "twenty": 20, "thirty": 30, "forty": 40, "fifty": 50, "sixty": 60, "half": 0.5}
UNIT_MIN = {"second": 1 / 60, "seconds": 1 / 60, "minute": 1, "minutes": 1, "min": 1, "mins": 1, "hour": 60, "hours": 60, "day": 1440, "days": 1440}
REVERT = r"(?:revert|roll back|rollback|roll|go back|take|put|reset)(?: the)?(?: skin| look| theme)?(?: back)?"


def clean_phrase(text: str) -> str:
    p = (text or "").lower()
    p = re.sub(r"[“”\"'’,!?;:]+", " ", p)
    p = re.sub(r"^\s*(hey |ok |okay )?(amber|amberx)\b[\s,]*", " ", p)
    p = re.sub(r"\b(please|can you|could you|would you|for me|now)\b", " ", p)
    return re.sub(r"\s+", " ", p).strip()


def voice_intent(text: str) -> dict[str, Any] | None:
    p = clean_phrase(text)
    if not p:
        return None
    m = re.match(rf"^{REVERT} to (?:about |around |roughly )?(\d+(?:\.\d+)?|[a-z]+)(?: and a half)? (seconds?|minutes?|mins?|hours?|days?) ago$", p)
    if m:
        n = float(m.group(1)) if m.group(1)[0].isdigit() else NUM.get(m.group(1))
        if n is not None and m.group(2) in UNIT_MIN:
            minutes = round(n * UNIT_MIN[m.group(2)] * 1000) / 1000
            return {"verb": "revert", "minutes": int(minutes) if minutes == int(minutes) else minutes}
    if re.match(rf"^{REVERT} to (?:the )?(default|start|beginning|original)(?: skin)?$", p):
        return {"verb": "revert", "snapshot": DEFAULT_SKIN_ID}
    m = re.match(rf"^{REVERT} to (?:the )?(?:snapshot |point |edit )?([a-z0-9]+)$", p)
    if m:
        return {"verb": "revert", "snapshot": m.group(1)}
    m = re.match(r"^(?:export|save)(?: this| the current| the| current)?(?: skin| look)?(?: as(?: a)?(?: new)?(?: skin)?)?(?: called| named| as)? ([a-z0-9][a-z0-9 -]{0,59})$", p)
    if m and m.group(1).strip() not in ("skin", "look"):
        return {"verb": "export", "name": " ".join(w[:1].upper() + w[1:] for w in m.group(1).strip().split())}
    if re.match(r"^undo(?: the)?(?: last)?(?: skin)?(?: edit| change)?$", p):
        return {"verb": "undo"}
    m = re.match(r"^(?:open|show|load|put) (?:the )?(.+?) in the skin editor$", p)
    if m:
        return {"verb": "open", "ui": re.sub(r"^(the|a|an) ", "", m.group(1)).strip()}
    if re.match(r"^(?:open|show|go to|launch)(?: the)? skin editor$", p):
        return {"verb": "open"}
    m = re.match(r"^(?:in the skin editor )?(?:skin(?: editor)?[ :]+)?set (?:the )?(--fx-[a-z0-9-]+|[a-z][a-z0-9 -]*?) to (.+?)(?: in the skin(?: editor)?)?$", p)
    if m:
        raw = m.group(1)
        token = raw if raw.startswith("--fx-") else "--fx-" + re.sub(r"\s+", "-", raw.strip())
        if TOKEN_ID.match(token) and ("skin" in p or raw.startswith("--fx-")):
            return {"verb": "set", "token": token, "value": m.group(2).strip()}
    m = re.match(r"^(?:search|find|look up)(?: in)?(?: the)? token registry for (.+)$", p)
    if m:
        return {"verb": "registry", "q": m.group(1).strip()}
    m = re.match(r"^(?:find|search for|look up) (.+?) in the token registry$", p)
    if m:
        return {"verb": "registry", "q": m.group(1).strip()}
    if re.match(r"^(?:open|show|list|go to)(?: me)?(?: the)? token registry$", p) or re.match(r"^(?:list|show) (?:every|all)(?: the)? tokens$", p):
        return {"verb": "registry"}
    return None


def resolve_token(word_or_token: str) -> str | None:
    """'accent' → --fx-accent; 'button radius' → --fx-btn-radius when the registry has it (words match the id or description)."""
    tokens = registry()
    if any(t["id"] == word_or_token for t in tokens):
        return word_or_token
    words = word_or_token.replace("--fx-", "").replace("-", " ").split()
    hits = search_tokens(tokens, " ".join(words))
    exact = [t for t in hits if t["id"].replace("--fx-", "").replace("-", " ") == " ".join(words)]
    pick = exact or sorted(hits, key=lambda t: (LEVEL_RANK.get(t.get("level"), 2), len(t["id"])))
    return pick[0]["id"] if pick else None


@router.post("/voice")
def voice(body: dict = Body(...)) -> dict[str, Any]:
    body = _dict(body)
    phrase = str(body.get("phrase") or "")
    intent = voice_intent(phrase)
    dry = bool(body.get("dry"))
    out: dict[str, Any] = {"intent": intent, "ran": False, "say": ""}
    if not intent:
        out["say"] = "That is not a Skin editor command."
        return out
    key = str(body.get("ui") or current_key() or "")
    verb = intent["verb"]
    if verb == "registry":
        hits = search_tokens(registry(), intent.get("q", ""))
        out.update(ran=True, result={"hits": len(hits), "tokens": hits[:20]}, say=f"{len(hits)} token(s)" + (f" for {intent['q']}" if intent.get("q") else " in the registry") + ".", open={"view": "token-registry", "q": intent.get("q", "")})
        return out
    if verb == "open":
        out.update(ran=True, say="Opening the Skin editor" + (f" on {intent['ui']}" if intent.get("ui") else "") + ".", open={"view": "skin-editor", "ui": intent.get("ui", "")})
        return out
    if not key:
        out["say"] = "Pick a UI in the Skin editor first."
        return out
    if dry:
        out["say"] = f"Would {verb} on {key}."
        return out
    with _lock:
        doc = load_session(key)
        at = now_iso()
        if verb == "revert":
            target = revert_target(doc, {"snapshot": intent.get("snapshot")} if intent.get("snapshot") else {"minutesAgo": intent["minutes"]})
            snap = revert_snapshot(doc["chain"], head_of(doc), target, "voice", at)
            r = _snapshot_result(doc, snap)
            out.update(ran=True, result={"target": target, "snapshot": snap}, say=f"Reverted {doc['ui'].get('label') or key} to {next(s['label'] for s in doc['chain'] if s['id'] == target)}." if snap else "Already there: nothing to revert.")
        elif verb == "undo":
            head = head_of(doc)
            if not head.get("parent"):
                out["say"] = "Already at the default skin."
                return out
            snap = revert_snapshot(doc["chain"], head, head["parent"], "voice", at)
            _snapshot_result(doc, snap)
            out.update(ran=True, result={"snapshot": snap}, say="Undone.")
        elif verb == "set":
            token = resolve_token(intent["token"])
            if not token:
                out["say"] = f"No token matches {intent['token'].replace('--fx-', '').replace('-', ' ')}."
                return out
            snap = edit_snapshot(doc["chain"], head_of(doc), [{"token": token, "to": intent["value"]}], "voice", at)
            _snapshot_result(doc, snap)
            out.update(ran=True, result={"token": token, "snapshot": snap}, say=f"{token} set to {intent['value']}." if snap else f"{token} already is {intent['value']}.")
        elif verb == "export":
            r = export_skin(head_of(doc)["state"], intent["name"], intent["name"], default_base(), token_sets(), "", "voice")
            path = _skin_path(r["asset"]["id"])
            _write(path, r["asset"])
            out.update(ran=True, result={"id": r["asset"]["id"], "mapped": r["mapped"], "unmapped": r["unmapped"]}, say=f"Exported the skin {intent['name']} ({r['asset']['id']}) with {len(r['mapped']) + len(r['unmapped'])} token(s).")
    return out
