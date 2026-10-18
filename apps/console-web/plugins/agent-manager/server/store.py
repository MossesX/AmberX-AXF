"""Agent manager storage — everything in ONE folder (plugin-lifecycle@1 dataDir).

    .axf-console/plugins/agent-manager/          (AXF_AGENT_MANAGER_DIR overrides; 0700)
      settings.json        fallback model + Firecrawl settings (stored keys only here, 0600)
      agents.json skills.json personas.json lingo.json tools.json workflows.json training.json   one collection each
      addons.json          installed add-ons and exactly what each created
      runs.json            last workflow / playground / training runs
      memory/<scope>.json  persistent memory per agent (or shared scope)
      addons/<id>.json     add-ons imported from JSON or a URL (bundled ones ship in the plugin's addons/ folder)
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_AGENT_MANAGER_DIR", ROOT / ".axf-console" / "plugins" / "agent-manager"))
PLUGIN_DIR = Path(__file__).resolve().parents[1]
COLLECTIONS = ("agents", "skills", "personas", "lingo", "tools", "workflows", "training")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
MASK = "••••••••"
_lock = threading.RLock()

DEFAULT_SETTINGS: dict[str, Any] = {
    "$axf": "agent-manager-settings@1",
    "llm": {"kind": "anthropic", "baseUrl": "", "keyEnv": "ANTHROPIC_API_KEY", "key": "", "model": "claude-sonnet-5-5", "embedModel": ""},
    "preferAssistant": True,
    "firecrawl": {"baseUrl": "https://api.firecrawl.dev", "version": "v2", "keyEnv": "FIRECRAWL_API_KEY", "key": ""},
    "defaults": {"memoryType": "hybrid", "topK": 6, "window": 8, "maxItems": 2000},
    "scheduler": True,
}


def now_ms() -> int:
    return int(time.time() * 1000)


def slug(text: str, fallback: str = "item") -> str:
    s = re.sub(r"[^a-z0-9]+", "-", str(text).lower()).strip("-")[:48]
    return s or fallback


def new_id(prefix: str) -> str:
    return f"{prefix}-{secrets.token_hex(3)}"


def _write(path: Path, data: Any, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    if private:
        os.chmod(tmp, 0o600)
    tmp.replace(path)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return deepcopy(default)


# ---------------------------------------------------------------- settings

def load_settings() -> dict[str, Any]:
    raw = _read(DATA / "settings.json", {})
    s = {**deepcopy(DEFAULT_SETTINGS), **raw}
    for k in ("llm", "firecrawl", "defaults"):
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
        if coll in ("skills", "personas", "lingo", "tools"):
            field = {"skills": "skillIds", "lingo": "lingoIds", "tools": "toolIds"}.get(coll)
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
