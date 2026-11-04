"""Reference links (server part): ref@1 over REST, and through plugin-commands@1 the MCP tools and `axf ref-links …`.

Brett (Nov 3 2026): text in the banners that mentions a part of the UI (a screen, a settings page, a plugin, a toolbar,
a build, a PR) is a link that opens it. The console draws those links itself (framework RefText); this part lets a
Claude session, the REST API or the CLI do the same: find the references in a line of text, resolve one, and open it
in Brett's open console (highlighted, the same as a double-tap).

Targets: this checkout's builds store (each build with its declared `touches:` and PR) and plugins (refs.mjs), the
open console's catalog (screens, dialogs, settings tabs, actions; capability console-commands@1), agents
(capability axf.agents@1) and, for builds still in progress, their UI Review items (capability ui-review@1). Each
capability is optional: without it those targets are simply not there.

  GET  targets                              every target known now
  POST find     {text, touches?}            the references in the text (spans + targets)
  POST resolve  {ref}                       one ref: an id (settings.terminal, build:<id>, #123) or a few words
  POST open     {ref, how?, to?}            open it in the console (how: open | window | review | build)

Capability ref-links@1: plugin_services.get("ref-links@1").find(text, touches=[]) / .resolve(ref).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services
import readcache  # server/readcache.py

router = APIRouter()
FOLDER = "ref-links"
RUNNER = Path(__file__).resolve().parent.parent / "refs.mjs"
ROOT = RUNNER.parents[4]
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "unexpected": 500}
HOWS = ("open", "window", "review", "build")
REVIEW_STATES = ("running", "built", "pending")


def _runner(req: dict[str, Any]) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(RUNNER), "run"], input=json.dumps(req), cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unexpected", "message": f"the reference links runner could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-600:]}


def _console_items() -> list[dict[str, Any]]:
    """The open console's catalog (screens, dialogs, settings tabs, actions), when Console commands is there."""
    cc = plugin_services.get("console-commands@1")
    if not cc:
        return []
    out: list[dict[str, Any]] = []
    for target in ("console.screens", "console.dialogs", "console.settings"):
        try:
            r = cc.run({"op": "list", "target": target, "select": {"limit": 500}})
        except Exception:  # noqa: BLE001 — no console open = no catalog
            continue
        items = (r.get("data") or {}).get("items") if isinstance(r.get("data"), dict) else r.get("items")
        out.extend(i for i in items or [] if isinstance(i, dict))
    return out


def _agents() -> list[dict[str, Any]]:
    svc = plugin_services.get("axf.agents@1")
    if not svc:
        return []
    try:
        return [{"id": f"agent:{a.get('id')}", "kind": "agent", "label": a.get("name") or a.get("id"), "detail": f"Agent · {a.get('role') or a.get('kind') or ''}".rstrip(" ·"), "icon": "user"}
                for a in svc.list_agents() if isinstance(a, dict) and a.get("id")]
    except Exception:  # noqa: BLE001
        return []


def _with_reviews(targets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Builds still in progress get their UI Review items (what a new, not-live part looks like)."""
    svc = plugin_services.get("ui-review@1")
    if not svc:
        return targets
    for t in targets:
        if t.get("kind") != "build" or t.get("status") not in REVIEW_STATES:
            continue
        branch = next((p.strip() for p in str(t.get("detail", "")).split("·") if p.strip().startswith(("claude/", "fable/", "rebuild/", "harvest/"))), "")
        if not branch:
            continue
        try:
            items = svc.items(branch=branch)
        except Exception:  # noqa: BLE001
            continue
        if items:
            t["reviews"] = [{k: i.get(k) for k in ("id", "name", "status", "kind", "screen", "app") if i.get(k) is not None} for i in items[:20]]
    return targets


def _extra() -> list[dict[str, Any]]:
    return [*_console_items(), *_agents()]


def targets() -> dict[str, Any]:
    r = _runner({"op": "targets", "extra": _extra()})
    if r.get("ok"):
        r["targets"] = _with_reviews(r.get("targets") or [])
    return r


def find(text: str, touches: list[str] | str | None = None) -> dict[str, Any]:
    return _runner({"op": "find", "text": text, "touches": touches or [], "extra": _extra()})


def resolve(ref: str) -> dict[str, Any]:
    return _runner({"op": "resolve", "query": ref, "extra": _extra()})


def open_ref(ref: str, how: str = "open", to: str = "", by: str = "") -> dict[str, Any]:
    if how not in HOWS:
        return {"ok": False, "code": "validation", "message": f"how must be one of {', '.join(HOWS)}"}
    r = resolve(ref)
    target = r.get("target") if r.get("ok") else None
    ref_id = target["id"] if target else str(ref)
    if not target and not ref_id.startswith(("pr:", "file:")):
        return r
    cc = plugin_services.get("console-commands@1")
    if not cc:
        return {"ok": False, "code": "not_found", "message": "Console commands is not installed, so nothing can open in the console", "target": target}
    from urllib.parse import quote
    cmd: dict[str, Any] = {"op": "act", "target": "console.actions", "path": f"refs.{how}", "action": "run", "input": {"args": [quote(ref_id, safe="")]}}
    if to:
        cmd["input"]["to"] = to
    if by:
        cmd["by"] = by
    out = cc.run(cmd, by=by)
    out["target"] = target
    if r.get("ambiguous"):
        out["ambiguous"] = True
        out["candidates"] = r.get("candidates")
    return out


def _answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — an empty or non-JSON body = no fields
        return {}


@router.get("/targets")
async def get_targets() -> JSONResponse:
    # every open console asks on load; one shared answer (refs.mjs + the console catalog) per 15 s, fresh after a
    # builds store write (server/readcache.py)
    store = ROOT / "_claude" / "builds" / "store.json"
    return _answer(await run_in_threadpool(readcache.cached, "ref-links:targets", targets, 15, (store,)))


@router.post("/find")
async def post_find(request: Request) -> JSONResponse:
    b = await _body(request)
    return _answer(await run_in_threadpool(find, str(b.get("text") or ""), b.get("touches")))


@router.post("/resolve")
async def post_resolve(request: Request) -> JSONResponse:
    b = await _body(request)
    return _answer(await run_in_threadpool(resolve, str(b.get("ref") or b.get("q") or "")))


@router.post("/open")
async def post_open(request: Request) -> JSONResponse:
    b = await _body(request)
    return _answer(await run_in_threadpool(open_ref, str(b.get("ref") or b.get("q") or ""), str(b.get("how") or "open"), str(b.get("to") or ""), str(b.get("by") or "")))


class RefLinks:
    """ref-links@1 for other plugins: find the references in a text, resolve one."""

    router = router

    def find(self, text: str, touches: list[str] | None = None) -> dict[str, Any]:
        return find(text, touches)

    def resolve(self, ref: str) -> dict[str, Any]:
        return resolve(ref)

    def targets(self) -> dict[str, Any]:
        return targets()


plugin_services.provide("ref-links@1", RefLinks(), folder=FOLDER)
