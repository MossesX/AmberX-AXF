"""Server part of the Glossary & Index plugin (glossary-catalog@1). Mounted at /api/plugins/glossary-index/.

The console adds the console-token check (every method) and the 404 while disabled. The catalog is built by the
plugin's own Node builder (catalog.mjs) from what the repo registers (plugins, help, assets, asset types, CLI tools,
build options, features, the UI registry) into the plugin's data folder, and rebuilt whenever it is missing or a build
lands (the orchestrator's post-build hook). No model, no tokens.

Routes: GET catalog · GET stats · GET search · GET entry · GET changes · POST rebuild.
Capability glossary@1: lookup(id), search(q), rebuild(reason, build) for other plugins (the demonstration designer and
the book builder read entries through it).
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

import plugin_services

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = HERE / "catalog.mjs"
SELF = "glossary@1"
_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": 0.0, "value": None, "raw": b""}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_GLOSSARY_DIR") or (ROOT / ".axf-console" / "plugins" / "glossary-index"))


def _run(*args: str, timeout: int = 120) -> tuple[int, str, str]:
    env = {**os.environ, "AXF_REPO_ROOT": str(ROOT), "AXF_GLOSSARY_DIR": str(data_dir())}
    p = subprocess.run(["node", str(CLI), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def rebuild(reason: str = "console", build: str = "") -> dict[str, Any]:
    """Rebuild the catalog from the registries (writes only when something moved)."""
    args = ["build", "--json", "--reason", reason[:80] or "console"]
    if build:
        args += ["--build", build[:120]]
    try:
        code, out, err = _run(*args)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the glossary builder didn't answer: {type(e).__name__}") from e
    if code != 0:
        raise HTTPException(500, (err or out or "the glossary builder failed")[-400:])
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"wrote": False, "output": out[-400:]}


def _load() -> tuple[dict[str, Any], bytes]:
    """The saved catalog (cached by modification time), built first when it doesn't exist yet."""
    f = data_dir() / "catalog.json"
    with _lock:
        if not f.exists():
            rebuild("first read")
        if not f.exists():
            raise HTTPException(503, "the glossary hasn't been built yet")
        m = f.stat().st_mtime
        if _cache["value"] is None or m != _cache["mtime"]:
            raw = f.read_bytes()
            _cache.update(mtime=m, raw=raw, value=json.loads(raw))
        return _cache["value"], _cache["raw"]


def lookup(entry_id: str) -> dict[str, Any] | None:
    cat, _ = _load()
    for e in cat.get("entries", []):
        if e.get("id") == entry_id:
            return e
    return None


def search(q: str, kind: str = "", limit: int = 30) -> list[dict[str, Any]]:
    """Same ranking as the CLI and the page: every word must match; exact and leading term matches first."""
    cat, _ = _load()
    words = [w for w in q.lower().split() if w]
    kinds = {k for k in kind.split(",") if k}
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for e in cat.get("entries", []):
        if kinds and e.get("kind") not in kinds:
            continue
        term = str(e.get("term", "")).lower()
        kw = e.get("keywords", [])
        hay = f"{term} {str(e.get('summary', '')).lower()} {' '.join(kw)} {str(e.get('category', '')).lower()} {e.get('id', '')}"
        if words and not all(w in hay for w in words):
            continue
        s = 0
        for w in words:
            s += 50 if term == w else 20 if term.startswith(w) else 10 if w in term else 4 if w in kw else 1
        s += 5 if e.get("kind") == "concept" else 3 if e.get("kind") == "plugin" else 0
        scored.append((s, term, e))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [e for _, _, e in scored[: max(1, min(limit, 200))]]


@router.get("/catalog")
def get_catalog() -> Response:
    _, raw = _load()
    return Response(content=raw, media_type="application/json")


@router.get("/stats")
def get_stats() -> dict[str, Any]:
    cat, _ = _load()
    return {k: cat.get(k) for k in ("generatedAt", "total", "counts", "generic", "kinds")}


@router.get("/search")
def get_search(q: str = "", kind: str = "", limit: int = 30) -> dict[str, Any]:
    return {"q": q, "results": search(q, kind, limit)}


@router.get("/entry")
def get_entry(id: str) -> dict[str, Any]:  # noqa: A002 - the query parameter is called id
    e = lookup(id)
    if e is None:
        raise HTTPException(404, f"no glossary entry {id}")
    cat, _ = _load()
    linked = [x["id"] for x in cat.get("entries", []) if id in (x.get("related") or []) or id in (x.get("children") or [])]
    return {**e, "linkedFrom": linked[:60]}


@router.get("/changes")
def get_changes() -> list[dict[str, Any]]:
    f = data_dir() / "changes.json"
    try:
        return json.loads(f.read_text()) if f.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


@router.post("/rebuild")
def post_rebuild(body: dict[str, Any] | None = None) -> dict[str, Any]:
    b = body or {}
    return rebuild(str(b.get("reason") or "console"), str(b.get("build") or ""))


class Service:
    """glossary@1 for other plugins: entries by id, ranked search, rebuild after a build lands."""

    def lookup(self, entry_id: str) -> dict[str, Any] | None:
        return lookup(entry_id)

    def search(self, q: str, kind: str = "", limit: int = 30) -> list[dict[str, Any]]:
        return search(q, kind, limit)

    def rebuild(self, reason: str = "service", build: str = "") -> dict[str, Any]:
        return rebuild(reason, build)


plugin_services.provide(SELF, Service(), HERE.name)
