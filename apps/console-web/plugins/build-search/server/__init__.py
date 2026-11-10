"""Build search (server part). Mounted at /api/plugins/build-search/ (console token on every route, 404 while off).

Every route runs the plugin's CLI (search.mjs --json), so the console, REST, MCP (plugin-commands@1:
`build-search_<command>`), the CLI (`axf build-search <command>`) and a terminal share one set of rules. No route calls
a model. AI features stay refused (409) until the AI switch is turned on by an explicit call; nothing turns it on.

  GET  search?q=&type=&build=&limit=&perDoc=   every hit, grouped per document, instances numbered 1, 2, 3…
  GET  open?id=<hit or doc id>&line=&context=  the document around that spot (the log viewer)
  GET  sources                                 built-in sources with counts + the user's own
  POST sources        {name, path, type?}      add a source (file, folder or glob)
  POST sources/remove {id}                     remove one of the user's sources
  GET  actions                                 built-in + user hit actions
  POST actions        {label, run, types?, icon?}   add an action
  POST actions/remove {id}                     remove a user action
  GET  settings                                every setting
  PUT  settings       {key, value}             set maxHits / maxPerDoc / context / snippet / types
  GET  ai                                      the AI switch ({enabled}); off by default
  PUT  ai             {enabled}                turn AI features on or off (explicit only)
  POST command        {text}                   a typed command (the same as '>' in the search box)
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException

router = APIRouter()
CLI = Path(__file__).resolve().parent.parent / "search.mjs"
ROOT = CLI.parents[4]


def _run(*args: str, timeout: int = 120) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"build search could not run: {str(e)[:200]}") from e
    lines = proc.stdout.strip().splitlines()
    try:
        out = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        out = None
    if not isinstance(out, dict):
        raise HTTPException(500, (proc.stderr or proc.stdout or "no output").strip()[-600:])
    if out.get("ok") is False:
        raise HTTPException(400, str(out.get("error") or "refused")[:600])
    return out


def _s(v: Any, n: int = 500) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


@router.get("/search")
def search(q: str = "", type: str = "", build: str = "", limit: int = 0, perDoc: int = 0) -> dict[str, Any]:  # noqa: A002
    args = ["search", q[:500]]
    if type:
        args += ["--type", type[:200]]
    if build:
        args += ["--build", build[:200]]
    if limit:
        args += ["--limit", str(limit)]
    if perDoc:
        args += ["--per-doc", str(perDoc)]
    return _run(*args)


@router.get("/open")
def open_hit(id: str, line: int = 0, context: int = 400) -> dict[str, Any]:  # noqa: A002
    args = ["open", id[:600], "--context", str(max(1, min(context, 5000)))]
    if line:
        args += ["--line", str(line)]
    return _run(*args)


@router.get("/sources")
def sources() -> dict[str, Any]:
    return _run("sources")


@router.post("/sources")
def add_source(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    name, path = _s(body.get("name"), 80), _s(body.get("path"))
    if not name or not path:
        raise HTTPException(400, "name and path are required")
    return _run("source-add", name, path, "--type", _s(body.get("type"), 40) or "file")


@router.post("/sources/remove")
def remove_source(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _run("source-remove", _s(body.get("id"), 80))


@router.get("/actions")
def actions() -> dict[str, Any]:
    return _run("actions")


@router.post("/actions")
def add_action(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    label, run = _s(body.get("label"), 80), _s(body.get("run"))
    if not label or not run:
        raise HTTPException(400, "label and run are required")
    args = ["action-add", label, run]
    types = body.get("types")
    if isinstance(types, list) and types:
        args += ["--types", ",".join(_s(t, 40) for t in types)]
    if _s(body.get("icon"), 40):
        args += ["--icon", _s(body.get("icon"), 40)]
    return _run(*args)


@router.post("/actions/remove")
def remove_action(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _run("action-remove", _s(body.get("id"), 80))


@router.get("/settings")
def settings() -> dict[str, Any]:
    return _run("settings")


@router.put("/settings")
def set_setting(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    key = _s(body.get("key"), 40)
    value = body.get("value")
    if key == "types" and isinstance(value, list):
        value = ",".join(_s(v, 40) for v in value)
    if key not in ("maxHits", "maxPerDoc", "context", "snippet", "types"):
        raise HTTPException(400, "key must be maxHits, maxPerDoc, context, snippet or types")
    return _run("set", key, str(value))


@router.get("/ai")
def ai_state() -> dict[str, Any]:
    return _run("ai")


@router.put("/ai")
def ai_set(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    if not isinstance(body.get("enabled"), bool):
        raise HTTPException(400, "enabled must be true or false")
    return _run("ai", "on" if body["enabled"] else "off")


@router.post("/command")
def command(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    text = _s(body.get("text"))
    if not text:
        raise HTTPException(400, "text is required")
    return _run("run", text)
