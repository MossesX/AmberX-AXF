"""Agent manager storage — everything in ONE folder (plugin-lifecycle@1 dataDir).

    .axf-console/plugins/agent-manager/          (AXF_AGENT_MANAGER_DIR overrides; 0700)
      settings.json        fallback model + Firecrawl settings (stored keys only here, 0600)
      agents.json skills.json personas.json lingo.json tools.json workflows.json training.json   one collection each
      addons.json          installed add-ons and exactly what each created
      runs.json            last workflow / playground / training runs
      memory/<scope>.json  persistent memory per agent (or shared scope), agent-memory@1
      versions/<coll>/<id>.json   previous copies of library items (last 30)
      addons/<id>.json     add-ons imported from JSON or a URL (bundled ones ship in the plugin's addons/ folder)

Same layout and file tags as the Opus build, so existing data loads unchanged. A `$axf` tag per collection file lets
a later format change migrate (see `migrate()`).
"""
from __future__ import annotations

import os
import re
import secrets
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf.contracts import agents as contract  # framework/python
from axf_server import storage

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_AGENT_MANAGER_DIR", ROOT / ".axf-console" / "plugins" / "agent-manager"))
PLUGIN_DIR = Path(__file__).resolve().parents[1]
COLLECTIONS = contract.COLLECTIONS
ID_RE = contract.ID_RE
MASK = "••••••••"
_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "$axf": "agent-manager-settings@1",
    "llm": {"kind": "anthropic", "baseUrl": "", "keyEnv": "ANTHROPIC_API_KEY", "key": "", "model": "claude-sonnet-5-5", "embedModel": ""},
    "preferAssistant": True,
    "firecrawl": {"baseUrl": "https://api.firecrawl.dev", "version": "v2", "keyEnv": "FIRECRAWL_API_KEY", "key": ""},
    "defaults": {"memoryType": "hybrid", "topK": 6, "window": 8, "maxItems": 2000},
    "scheduler": True,
    # Agents allowed to use dangerous tools (container access, writes, commands). Personas and skills can't change this.
    "safety": {"dangerousAgents": ["coder"]},
}


def now_ms() -> int:
    return int(time.time() * 1000)


def slug(text: str, fallback: str = "item") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:48]
    return s or fallback


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(3)}"


def _write(path: Path, data: Any, private: bool = True) -> None:
    """Atomic, 0600, folder 0700 (axf_server.storage). Every file is private now; `private` is kept for callers."""
    storage.write_json(path, data, ensure_ascii=False)


def _read(path: Path, default: Any) -> Any:
    return storage.read_json(path, default)  # a deep copy of the default when missing or damaged


# ---------------------------------------------------------------- settings

def load_settings() -> dict[str, Any]:
    raw = _read(DATA / "settings.json", {})
    s = {**deepcopy(DEFAULT_SETTINGS), **raw}
    for k in ("llm", "firecrawl", "defaults", "safety"):
        s[k] = {**DEFAULT_SETTINGS[k], **(raw.get(k) or {})}
    return s


def save_settings(s: dict[str, Any]) -> None:
    with _lock:
        _write(DATA / "settings.json", s, private=True)


def public_settings() -> dict[str, Any]:
    s = load_settings()
    out = deepcopy(s)
    for k in ("llm", "firecrawl"):
        out[k]["hasKey"] = bool(s[k].get("key"))
        out[k]["envPresent"] = bool(s[k].get("keyEnv") and os.environ.get(s[k]["keyEnv"]))
        out[k].pop("key", None)
    return out


def secret(section: str) -> str:
    s = load_settings()[section]
    return s.get("key") or (os.environ.get(s.get("keyEnv") or "", "") if s.get("keyEnv") else "")


def memory_defaults() -> dict[str, Any]:
    d = load_settings()["defaults"]
    return {"type": d.get("memoryType", "hybrid"), "topK": d.get("topK", 6), "window": d.get("window", 8), "maxItems": d.get("maxItems", 2000)}


def dangerous_agents() -> set[str]:
    return set(load_settings().get("safety", {}).get("dangerousAgents") or [])


# ---------------------------------------------------------------- collections

def items(coll: str) -> dict[str, dict[str, Any]]:
    if coll not in COLLECTIONS:
        raise KeyError(coll)
    return _read(DATA / f"{coll}.json", {"items": {}}).get("items", {})


def save_items(coll: str, data: dict[str, dict[str, Any]]) -> None:
    with _lock:
        _write(DATA / f"{coll}.json", {"$axf": f"agent-manager-{coll}@1", "items": data})


def get(coll: str, iid: str) -> dict[str, Any]:
    it = items(coll).get(iid)
    if not it:
        raise KeyError(f"no {coll[:-1] if coll.endswith('s') else coll} {iid!r}")
    return it


def known() -> dict[str, set[str]]:
    """The ids that exist, for the contract validator (references to anything else are dropped or refused)."""
    return {c: set(items(c)) for c in COLLECTIONS}


def upsert(coll: str, rec: dict[str, Any], *, origin: str | None = None) -> dict[str, Any]:
    with _lock:
        data = items(coll)
        iid = str(rec.get("id") or "").strip()
        if not iid:
            base = slug(rec.get("name") or coll[:-1], coll[:-1])
            iid, n = base, 2
            while iid in data:
                iid, n = f"{base}-{n}", n + 1
        if not ID_RE.match(iid):
            raise ValueError("ids are lowercase letters, digits, dots, dashes and underscores")
        old = data.get(iid, {})
        out = {**old, **rec, "id": iid, "updatedAt": now_ms(), "createdAt": old.get("createdAt") or now_ms()}
        if origin is not None:
            out["origin"] = origin
        out.setdefault("origin", "user")
        data[iid] = out
        save_items(coll, data)
        return out


def delete(coll: str, iid: str) -> None:
    with _lock:
        data = items(coll)
        if data.pop(iid, None) is None:
            raise KeyError(iid)
        save_items(coll, data)
        # drop dangling references so nothing points at a deleted thing
        if coll in ("skills", "personas", "lingo", "tools", "agents"):
            field = {"skills": "skillIds", "lingo": "lingoIds", "tools": "toolIds", "agents": "delegates"}.get(coll)
            agents = items("agents")
            changed = False
            for a in agents.values():
                if coll == "personas" and a.get("personaId") == iid:
                    a["personaId"] = ""
                    changed = True
                elif field and iid in (a.get(field) or []):
                    a[field] = [x for x in a[field] if x != iid]
                    changed = True
            if changed:
                save_items("agents", agents)
            if coll == "tools":
                skills = items("skills")
                if any(iid in (s.get("toolIds") or []) for s in skills.values()):
                    for s in skills.values():
                        s["toolIds"] = [x for x in s.get("toolIds") or [] if x != iid]
                    save_items("skills", skills)


# ---------------------------------------------------------------- add-on records, runs

def addon_records() -> dict[str, dict[str, Any]]:
    return _read(DATA / "addons.json", {"items": {}}).get("items", {})


def save_addon_records(recs: dict[str, dict[str, Any]]) -> None:
    with _lock:
        _write(DATA / "addons.json", {"$axf": "agent-manager-addons@1", "items": recs})


def add_run(run: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        runs = _read(DATA / "runs.json", {"items": []}).get("items", [])
        run = {"id": new_id("run"), "at": now_ms(), **run}
        runs.insert(0, run)
        _write(DATA / "runs.json", {"items": runs[:150]})
        return run


def runs(kind: str = "") -> list[dict[str, Any]]:
    r = _read(DATA / "runs.json", {"items": []}).get("items", [])
    return [x for x in r if not kind or x.get("kind") == kind]


# ---------------------------------------------------------------- migration

def migrate() -> list[str]:
    """Bring data written by older builds up to this one. Idempotent, never destructive; returns what it did."""
    done: list[str] = []
    with _lock:
        for coll in COLLECTIONS:
            p = DATA / f"{coll}.json"
            if not p.exists():
                continue
            raw = _read(p, {})
            if not isinstance(raw, dict) or "items" not in raw:
                continue
            changed = False
            for iid, rec in list(raw["items"].items()):
                if coll == "tools" and "dangerous" not in rec:  # Opus 0.1.0 tools had no explicit flag
                    rec["dangerous"] = False
                    changed = True
                if coll == "agents" and rec.get("memory") is None:
                    rec["memory"] = {}
                    changed = True
            if changed:
                _write(p, {"$axf": f"agent-manager-{coll}@1", "items": raw["items"]})
                done.append(f"{coll}: normalised {len(raw['items'])} records")
    return done
