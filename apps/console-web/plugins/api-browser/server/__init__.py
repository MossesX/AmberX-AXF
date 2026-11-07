"""API Browser (server part). Mounted at /api/plugins/api-browser/ (console token; 404 while the plugin is off).

Serves the one generated API registry (api-registry@1, framework/cli/api-registry.mjs): every control@1 target and
action, every plugin read and command, every MCP tool and REST route of the console, every axf CLI command, each with
its policy and REST / MCP / CLI names, and the UI coverage (api-coverage@1: every UI element of the console and the API
path that reaches it). The generator runs in Node; its answer is cached in memory and in the data folder, and made again
when one of the files it reads changes (or on refresh=1).

  GET registry[?refresh=1]          every entry + the summary (no coverage rows)
  GET entry?id=<id>                 one entry, with the UI elements it stands for
  GET coverage[?status=&q=]         the UI coverage rows + their summary
  GET settings · PUT settings {defaultView, look, tryWrites}

Running an entry ("Try it") goes straight from the browser to the console's own endpoints (POST /api/control and the
REST paths), with the browser's own session, so it follows the same policy as any other click in the console.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx

router = APIRouter()
FOLDER = "api-browser"
VIEWS = ("grid", "tree", "cards", "coverage")
LOOKS = ("api-browser-tabs", "api-browser-rail", "api-browser-chips")
DEFAULTS: dict[str, Any] = {"defaultView": "grid", "look": "api-browser-tabs", "tryWrites": True}
TTL_S = 300.0  # remade at least this often even when no source file changed (the plugin list can change without a file we watch)
# the files the generator reads: a change to any of them (or anything under the plugin folders) makes the registry again
WATCH = ("framework/core/engines/control-rules.mjs", "framework/core/engines/plugin-commands.mjs", "framework/cli/api-registry.mjs",
         "framework/cli/api-coverage.mjs", "apps/console-web/server/mcp_server.py", "apps/console-web/server/main.py", "framework/cli/axf.mjs")

_lock = threading.Lock()
_cache: dict[str, Any] = {"key": None, "at": 0.0, "value": None}


def root() -> Path:
    return Path(cx.ROOT)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_API_BROWSER_DIR") or root() / ".axf-console" / "plugins" / FOLDER)


_fp: dict[str, Any] = {"at": 0.0, "value": ""}
FP_TTL_S = 10.0  # walking every plugin's files costs a moment: once per 10 s is plenty


def _fingerprint() -> str:
    if time.time() - _fp["at"] < FP_TTL_S and _fp["value"]:
        return _fp["value"]
    _fp.update(at=time.time(), value=_scan())
    return _fp["value"]


def _scan() -> str:
    r = root()
    parts: list[str] = []
    for rel in WATCH:
        try:
            parts.append(f"{rel}:{(r / rel).stat().st_mtime_ns}")
        except OSError:
            parts.append(f"{rel}:-")
    plugins = r / "apps" / "console-web" / "plugins"
    try:  # newest plugin.json / server / web file: a plugin added, removed or changed
        newest = max((p.stat().st_mtime_ns for d in plugins.iterdir() if d.is_dir() for p in d.rglob("*") if p.suffix in (".json", ".py", ".tsx", ".ts") and "node_modules" not in p.parts), default=0)
        parts.append(f"plugins:{newest}:{sum(1 for _ in plugins.iterdir())}")
    except OSError:
        pass
    return "|".join(parts)


def generate() -> dict[str, Any]:
    """Run the generator (framework/cli/api-registry.mjs --json)."""
    p = subprocess.run(["node", str(root() / "framework" / "cli" / "api-registry.mjs"), "--json"], cwd=root(), capture_output=True, text=True, timeout=120)
    if p.returncode != 0:
        raise RuntimeError((p.stderr or p.stdout).strip()[-400:] or "the registry generator failed")
    return json.loads(p.stdout)


def registry(refresh: bool = False) -> dict[str, Any]:
    key = _fingerprint()
    with _lock:
        if not refresh and _cache["value"] is not None and _cache["key"] == key and time.time() - _cache["at"] < TTL_S:
            return _cache["value"]
    value = generate()
    with _lock:
        _cache.update(key=key, at=time.time(), value=value)
    try:
        data_dir().mkdir(parents=True, exist_ok=True)
        (data_dir() / "registry.json").write_text(json.dumps({"key": key, "at": value.get("generatedAt"), "summary": value.get("summary")}, indent=1))
    except OSError:
        pass
    return value


def _settings_file() -> Path:
    return data_dir() / "settings.json"


def settings() -> dict[str, Any]:
    try:
        raw = json.loads(_settings_file().read_text())
    except (OSError, ValueError):
        raw = {}
    out = {**DEFAULTS, **{k: v for k, v in raw.items() if k in DEFAULTS}}
    if out["defaultView"] not in VIEWS:
        out["defaultView"] = DEFAULTS["defaultView"]
    if out["look"] not in LOOKS:
        out["look"] = DEFAULTS["look"]
    return out


def _err(e: Exception) -> HTTPException:
    return HTTPException(502, f"{type(e).__name__}: {str(e)[:300]}")


@router.get("/registry")
def get_registry(refresh: bool = False) -> dict[str, Any]:
    """Every API path (control@1, plugin commands and reads, MCP tools, REST routes, CLI) with policy and names."""
    try:
        r = registry(refresh)
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    return {"$axf": r.get("$axf"), "generatedAt": r.get("generatedAt"), "summary": r.get("summary"), "entries": r.get("entries", [])}


@router.get("/entry")
def get_entry(id: str) -> dict[str, Any]:
    """One API path by its id (control/console.values/set, plugins/ui-review/decide, mcp/build_next …)."""
    try:
        r = registry()
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    hit = next((x for x in r.get("entries", []) if x.get("id") == id), None)
    if not hit:
        raise HTTPException(404, f"no API path {id!r}")
    return hit


@router.get("/coverage")
def get_coverage(status: str = "", q: str = "", limit: int = 5000) -> dict[str, Any]:
    """The console's UI elements and the API path of each (red = a gap: no way in)."""
    try:
        r = registry()
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    rows = r.get("coverage", [])
    if status:
        rows = [x for x in rows if x.get("status") == status]
    words = [w for w in q.lower().split() if w]
    if words:
        rows = [x for x in rows if all(w in f"{x.get('kind')} {x.get('id')} {x.get('label')} {x.get('where')} {x.get('api')}".lower() for w in words)]
    return {"summary": r.get("coverageSummary"), "total": len(rows), "items": rows[: max(1, min(limit, 10000))]}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {**settings(), "views": list(VIEWS), "looks": list(LOOKS)}


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    """Default view (grid | tree | cards | coverage), the look (one of the three tab-group assets) and whether Try it may run writes."""
    cur = settings()
    if "defaultView" in body:
        if body["defaultView"] not in VIEWS:
            raise HTTPException(400, f"defaultView is one of {', '.join(VIEWS)}")
        cur["defaultView"] = body["defaultView"]
    if "look" in body:
        if body["look"] not in LOOKS:
            raise HTTPException(400, f"look is one of {', '.join(LOOKS)}")
        cur["look"] = body["look"]
    if "tryWrites" in body:
        cur["tryWrites"] = bool(body["tryWrites"])
    data_dir().mkdir(parents=True, exist_ok=True)
    _settings_file().write_text(json.dumps(cur, indent=1) + "\n")
    return {**cur, "views": list(VIEWS), "looks": list(LOOKS)}
