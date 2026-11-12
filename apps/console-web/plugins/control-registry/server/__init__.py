"""Registry page (server part). Mounted at /api/plugins/control-registry/ (console token on every method, 404 while disabled).

The page's own state and actions, so everything it shows and does is reachable without it:

    GET  state                         the page: filters, the open entry, counts, whether the Claude fallback is on
    GET  entries?q&owner&type&surface&gaps&limit&offset    list (or search, with q) registry entries
    GET  entry?id=<entry>              one entry: actions, parameters, allowed values, surfaces, gaps
    POST run {id, action, params, confirm?, reason?, dry?}    run one action (the registry checks the parameters)
    POST resolve {input, run?, confirm?}                    a phrase or CLI words → entry + action (+ run)
    POST open {id?, q?, owner?, type?, to?}                 open the page in the console on an entry or a search
    POST page {q, owner, type, surface, gaps, id}           the filters (the page reports them as they change)

Everything goes through the console's registry functions (server/registry_api.py: the same as /api/registry and
/api/control, the MCP registry_* / control_* tools and `axf ctl`). State: .axf-console/plugins/control-registry/state.json.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import registry_api

router = APIRouter()
FOLDER = "control-registry"
ROOT = Path(__file__).resolve().parents[5]
FIELDS = ("q", "owner", "type", "surface", "gaps", "id")
OWNERS = ("", "console-web", "molly", "axhub-web", "hostinger", "coolify", "vps", "amberx-droid", "moshi")


def _data() -> Path:
    return Path(os.environ.get("AXF_REGISTRY_PAGE_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _load() -> dict[str, Any]:
    try:
        s = json.loads((_data() / "state.json").read_text())
        return s if isinstance(s, dict) else {}
    except (OSError, ValueError):
        return {}


def _save(page: dict[str, Any], by: str) -> dict[str, Any]:
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    state = {"page": page, "at": int(time.time() * 1000), "by": by}
    tmp = d / f"state.json.tmp-{os.getpid()}"
    tmp.write_text(json.dumps(state))
    tmp.replace(d / "state.json")
    return state


def _clean(body: dict[str, Any]) -> dict[str, str]:
    page = {k: str(body.get(k) or "")[:300] for k in FIELDS}
    if page["owner"] not in OWNERS:
        page["owner"] = ""
    if page["type"] not in ("",) + registry_api.TYPES:
        page["type"] = ""
    if page["surface"] not in ("", "rest", "mcp", "cli", "voice", "deepLink"):
        page["surface"] = ""
    if page["gaps"] not in ("", "only", "none"):
        page["gaps"] = ""
    return page


def _control():
    try:
        from mcp_server import control_runner  # noqa: PLC0415 - the console's control@1 runner (core)
    except ImportError:
        return None
    return control_runner(ROOT)


def _by(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", "") if u is not None else ""
    return f"registry-page:{name}" if isinstance(name, str) and name else "registry-page"


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except ValueError:
        return {}
    return b if isinstance(b, dict) else {}


@router.get("/state")
def state() -> dict[str, Any]:
    s = _load()
    stats = registry_api.read({"op": "stats"})
    ai = registry_api.read({"op": "ai"})
    return {"ok": True, "page": s.get("page") or {k: "" for k in FIELDS}, "at": s.get("at", 0), "by": s.get("by", ""),
            "stats": {k: stats.get(k) for k in ("entries", "actions", "gaps", "needsAI", "byType", "surfaces", "hash", "generatedAt") if k in stats},
            "ai": {k: ai.get(k) for k in ("available", "source", "why", "label") if k in ai}}


@router.get("/entries")
def entries(q: str = "", owner: str = "", type: str = "", surface: str = "", gaps: str = "", limit: int = 100, offset: int = 0) -> dict[str, Any]:
    limit = max(1, min(limit, 500))
    if q.strip() and not (owner or type or surface or gaps):
        r = registry_api.read({"op": "search", "q": q, "limit": limit})
        return {"ok": bool(r.get("ok")), "total": len(r.get("items") or []), "items": r.get("items") or [], "search": True}
    r = registry_api.read({"op": "list", "filter": {"q": q, "owner": owner, "type": type, "surface": surface, "limit": 2000 if gaps else limit, "offset": 0 if gaps else max(0, offset)}})
    items = r.get("items") or []
    if gaps == "only":
        items = [i for i in items if i.get("gaps")]
    elif gaps == "none":
        items = [i for i in items if not i.get("gaps")]
    total = len(items) if gaps else r.get("total", 0)
    if gaps:
        items = items[max(0, offset):max(0, offset) + limit]
    return {"ok": bool(r.get("ok")), "total": total, "items": items}


@router.get("/entry")
def entry(id: str) -> Any:
    r = registry_api.read({"op": "get", "id": id})
    if not r.get("ok"):
        raise HTTPException(404, r.get("message") or "no such entry")
    return r


@router.post("/run")
async def run(request: Request) -> dict[str, Any]:
    b = await _body(request)
    if not b.get("id") or not b.get("action"):
        raise HTTPException(422, "send {id, action, params}")
    params = b.get("params") if isinstance(b.get("params"), dict) else {}
    ctl = _control()
    return await run_in_threadpool(lambda: registry_api.invoke(str(b["id"]), str(b["action"]), params, ctl, confirm=str(b.get("confirm") or ""),
                                                                reason=str(b.get("reason") or ""), by=_by(request), dry=bool(b.get("dry"))))


@router.post("/resolve")
async def resolve(request: Request) -> dict[str, Any]:
    b = await _body(request)
    text = str(b.get("input") or "").strip()
    if not text:
        raise HTTPException(422, "send {input: a phrase or CLI words}")
    ctl = _control()
    return await run_in_threadpool(lambda: registry_api.resolve(text[:500], ctl, run=bool(b.get("run")), confirm=str(b.get("confirm") or ""), by=_by(request)))


@router.post("/page")
async def page(request: Request) -> dict[str, Any]:
    return {"ok": True, **_save(_clean(await _body(request)), _by(request))}


@router.post("/open")
async def open_page(request: Request) -> dict[str, Any]:
    """Set the page on an entry or a search, then open it in the console (console.screens act open registry)."""
    b = await _body(request)
    saved = _save({**_clean(b), "pending": "1"}, _by(request))
    ctl = _control()
    to = str(b.get("to") or "")
    opened = await run_in_threadpool(lambda: ctl({"$axf": "control@1", "op": "act", "target": "console.screens", "path": "registry", "action": "open",
                                                  "input": {"to": to} if to and to != "recent" else {}, "by": _by(request)}) if ctl else {"ok": False, "message": "no control runner"})
    return {"ok": bool(opened.get("ok")), "page": saved["page"], "opened": opened}
