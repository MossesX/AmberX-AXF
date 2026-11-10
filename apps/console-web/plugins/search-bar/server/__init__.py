"""Search bar — server part. Mounted at /api/plugins/search-bar/ (console token on every method, 404 when the plugin is off).

    GET  /config          matching options {mode, caseSensitive, details, perCategory, total} + ai {enabled}
    PUT  /config          change any of them (partial); the open consoles pick it up on their next search
    GET  /ai              is AI ranking possible? {ollama, profile, capability, enabled, active}
    POST /ai/rank         {q, candidates: [{id, label, detail}]} → {ids} best first (only while AI is active)
    GET  /state           what the open search bars last reported: instances, scope, query, result counts
    PUT  /state           the browser's report (one per console tab; kept in memory, never on disk)

AI is used only when BOTH are true: a local Llama (an Ollama provider profile) is reachable through the AI capability
(`axf.llm@1`, looked up by name, never by plugin folder) AND AI assistance is on in this plugin's settings. Otherwise the
browser's own matcher (web/match.mjs) does everything.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()

MODES = ("words", "prefix", "exact", "regex")
DEFAULTS: dict[str, Any] = {"mode": "words", "caseSensitive": False, "details": True, "perCategory": 25, "total": 200, "ai": False}
MAX_CANDIDATES = 60
STATE_TTL_S = 10 * 60
_state: dict[str, dict[str, Any]] = {}
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SEARCH_BAR_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "search-bar"))


def clean_config(raw: Any, base: dict[str, Any] | None = None) -> dict[str, Any]:
    """Merge a partial config onto `base` (defaults when None). Raises ValueError with the reason on a bad value."""
    out = dict(base or DEFAULTS)
    if not isinstance(raw, dict):
        raise ValueError("config is an object")
    unknown = set(raw) - set(DEFAULTS)
    if unknown:
        raise ValueError(f"unknown keys: {', '.join(sorted(unknown))}")
    if "mode" in raw:
        if raw["mode"] not in MODES:
            raise ValueError(f"mode is one of {', '.join(MODES)}")
        out["mode"] = raw["mode"]
    for k in ("caseSensitive", "details", "ai"):
        if k in raw:
            if not isinstance(raw[k], bool):
                raise ValueError(f"{k} is true or false")
            out[k] = raw[k]
    for k, lo, hi in (("perCategory", 1, 100), ("total", 1, 1000)):
        if k in raw:
            v = raw[k]
            if not isinstance(v, int) or isinstance(v, bool) or not lo <= v <= hi:
                raise ValueError(f"{k} is a whole number {lo}–{hi}")
            out[k] = v
    return out


def load_config() -> dict[str, Any]:
    raw = storage.read_json(data_dir() / "config.json", {})
    try:
        return clean_config(raw if isinstance(raw, dict) else {})
    except ValueError:
        return dict(DEFAULTS)


def save_config(cfg: dict[str, Any]) -> None:
    data_dir().mkdir(parents=True, exist_ok=True)
    storage.write_json(data_dir() / "config.json", cfg)


def ollama_profile(llm: Any) -> str | None:
    """The id of the first Ollama provider profile the AI capability has, else None."""
    if llm is None:
        return None
    try:
        profs = llm.profiles()
    except Exception:  # noqa: BLE001 — the provider plugin failing means "no AI", never an error here
        return None
    items = profs.values() if isinstance(profs, dict) else profs if isinstance(profs, list) else []
    for p in items:
        if isinstance(p, dict) and (str(p.get("kind", "")).lower() == "ollama" or ":11434" in str(p.get("baseUrl", ""))):
            return str(p.get("id") or "") or None
    return None


def ai_status(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    llm = plugin_services.get("axf.llm@1")
    prof = ollama_profile(llm)
    return {"capability": llm is not None, "ollama": prof is not None, "profile": prof or "", "enabled": bool(cfg.get("ai")),
            "active": bool(llm is not None and prof and cfg.get("ai"))}


RANK_SYSTEM = ("You rank search results for a settings-heavy desktop console. Reply with JSON only: "
               '{"ids": [<the candidate ids, best match first>]}. Use only ids you were given.')


def parse_ids(text: str, allowed: set[str]) -> list[str]:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return []
    try:
        ids = json.loads(m.group(0)).get("ids", [])
    except (ValueError, AttributeError):
        return []
    seen: list[str] = []
    for i in ids if isinstance(ids, list) else []:
        if isinstance(i, str) and i in allowed and i not in seen:
            seen.append(i)
    return seen


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {"options": load_config(), "defaults": DEFAULTS, "modes": list(MODES)}


@router.put("/config")
def put_config(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        cfg = clean_config(body, load_config())
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    save_config(cfg)
    return {"options": cfg, "defaults": DEFAULTS, "modes": list(MODES)}


@router.get("/ai")
def get_ai() -> dict[str, Any]:
    return ai_status()


@router.post("/ai/rank")
def ai_rank(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    st = ai_status()
    if not st["active"]:
        raise HTTPException(409, "AI ranking is off: it needs an Ollama connection and AI assistance switched on")
    q = str(body.get("q") or "").strip()[:200]
    cands = body.get("candidates") if isinstance(body.get("candidates"), list) else []
    cands = [c for c in cands if isinstance(c, dict) and isinstance(c.get("id"), str)][:MAX_CANDIDATES]
    if not q or not cands:
        return {"ids": [], "profile": st["profile"]}
    lines = "\n".join(f'{c["id"]}\t{str(c.get("label", ""))[:80]}\t{str(c.get("detail", ""))[:80]}' for c in cands)
    llm = plugin_services.get("axf.llm@1")
    try:
        out = llm.complete([{"role": "user", "content": f"Query: {q}\n\nCandidates (id, label, where):\n{lines}"}],
                           system=RANK_SYSTEM, profile=st["profile"], params={"max_tokens": 600, "temperature": 0})
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"the local model didn't answer: {str(e)[:160]}") from e
    return {"ids": parse_ids(str(out.get("text") or ""), {c["id"] for c in cands}), "profile": st["profile"]}


def clean_state(raw: Any) -> dict[str, Any]:
    if not isinstance(raw, dict):
        raise ValueError("state is an object")
    tab = str(raw.get("tab") or "")[:64]
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,64}", tab):
        raise ValueError("tab is an id")
    inst = []
    for i in (raw.get("instances") or [])[:20]:
        if isinstance(i, dict):
            inst.append({"id": str(i.get("id") or "")[:64], "host": str(i.get("host") or "")[:24], "view": str(i.get("view") or "")[:24],
                         "scope": "settings" if i.get("scope") == "settings" else "everything", "query": str(i.get("query") or "")[:200],
                         "open": bool(i.get("open")), "results": int(i.get("results") or 0) if str(i.get("results") or "0").isdigit() else 0,
                         "categories": {str(k)[:32]: int(v) for k, v in (i.get("categories") or {}).items() if isinstance(v, int)} if isinstance(i.get("categories"), dict) else {}})
    return {"tab": tab, "instances": inst, "ai": bool(raw.get("ai")), "at": time.time()}


@router.get("/state")
def get_state() -> dict[str, Any]:
    now = time.time()
    with _lock:
        for k in [k for k, v in _state.items() if now - v["at"] > STATE_TTL_S]:
            _state.pop(k, None)
        tabs = list(_state.values())
    return {"tabs": tabs, "options": load_config(), "ai": ai_status()}


@router.put("/state")
def put_state(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        st = clean_state(body)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    with _lock:
        _state[st["tab"]] = st
    return {"ok": True}
