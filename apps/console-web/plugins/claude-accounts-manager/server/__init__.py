"""Server part of the Claude accounts manager. Mounted at /api/plugins/claude-accounts-manager/.

One ordered list of every Claude account on the VPS, subscription and API alike (Brett, Nov 10 2026: "API is no longer
a fallback, it's included like any other"). It owns no account data: it joins three capabilities and writes back
through them.
  axf.claude-accounts@1   names, kinds, roles, labels, emails, plans, limits, API spend; rename; sign-in (held)
  axf.claude-usage@1      each login's 5-hour and weekly usage in percent (optional: without it, no percentages)
  axf.build-dispatch@1    the dispatcher's view of each account and the one order it follows; set the order
Its own data is only its settings (banner widget, Terminal column, floating overlay, plan prices) in its data folder.

  GET  accounts      { accounts: [row…], order, mode, customOrder, orderSaved, totals, ready, why }   (model.rows)
  GET  mode          { mode: custom|auto, order, customOrder }: the switch
  POST mode          { mode: custom|auto } (Brett, Nov 10 2026: "a switch if you want to customize it or do that
                     automatically"): custom = the orchestrator follows the drag-and-drop order exactly, subscriptions
                     and API alike; auto = subscriptions first, then any API. Auto while an API account is outside the
                     custom order lets it bill per token, so that is Brett's own click.
  POST order         { order: [names] }: the whole custom order (drag and drop); saved in either mode, followed in custom
  POST move          { name, to: up|down|top|bottom|out|<position> }: one account in the custom order (voice: "move hulu-api to 2")
  POST rename        { name, label }
  POST add           { name, kind: subscription|api }: the Terminal tab that adds it ({open}); subscription also
                     sends the held sign-in when asked from outside the console (MCP, voice)
  POST session       { name }: the Terminal tab that opens Claude Code as that account ({open})
  GET  settings / POST settings  claude-accounts-manager@1 (patch: widget, column, overlay, prices, accountPrices)
  GET  widget        what the banner widget shows now

Putting an API account in the order or moving one earlier bills per token: only Brett's own click does that (the
dispatcher's capability enforces it; sessions, MCP and voice may move API accounts later or take them out).
Owner only: a signed-in non-admin gets 403. Never a credential: API keys are typed at the VPS host's hidden prompt.
"""
from __future__ import annotations

import json
import os
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.concurrency import run_in_threadpool

import axf_framework  # noqa: F401 — framework/python on sys.path
import plugin_services
from axf_server import storage

from . import model

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_ACCOUNTS_MANAGER_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def settings() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "settings.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    return model.norm_settings(raw)


def save_settings(patch: Any) -> dict[str, Any]:
    with _lock:
        new = model.merge_settings(settings(), patch)
        storage.write_json(data_dir() / "settings.json", new)
    return new


def _owner(request: Request) -> str:
    """The caller when it is the owner (his session or the console token), else 403."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return "console"
    if getattr(user, "admin", False):
        return str(getattr(user, "name", "") or "owner")[:80]
    raise HTTPException(403, "The Claude accounts manager is for the owner only.")


def brett_click(request: Request) -> str:
    """Brett's name when this request is his own click in the console (not a session, MCP or voice), else ''."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def _svc(cap: str, need: bool = True) -> Any:
    s = plugin_services.get(cap)
    if s is None and need:
        raise HTTPException(503, f"{cap} is not installed: the Claude accounts manager needs it.")
    return s


def _detail(e: Exception) -> str:
    return str(getattr(e, "detail", "") or e)[:300]


def read() -> dict[str, Any]:
    """Every account, joined and ordered (model.rows)."""
    view = _svc("axf.claude-accounts@1").view()
    usage_svc = _svc("axf.claude-usage@1", need=False)
    try:
        usage = usage_svc.usage(False) if usage_svc is not None else {}
    except Exception:  # noqa: BLE001 — usage is a nice-to-have; the list stands without it
        usage = {}
    dispatch = _svc("axf.build-dispatch@1", need=False)
    try:
        d_accounts = dispatch.accounts() if dispatch is not None and hasattr(dispatch, "accounts") else []
        order = dispatch.order() if dispatch is not None and hasattr(dispatch, "order") else []
        mode = dispatch.order_mode() if dispatch is not None and hasattr(dispatch, "order_mode") else "custom"
    except Exception:  # noqa: BLE001
        d_accounts, order, mode = [], [], "custom"
    out = model.rows(view, usage if isinstance(usage, dict) else {}, d_accounts, order, settings(), mode)
    return {"ok": True, "ready": bool(view.get("ready")), "why": str(view.get("why") or ""), "active": view.get("active") or "",
            "usage": usage_svc is not None, "dispatch": dispatch is not None, "pending": view.get("pending"), **out}


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except ValueError:
        b = {}
    return b if isinstance(b, dict) else {}


def _name(b: dict[str, Any]) -> str:
    n = model.clean_name(b.get("name"))
    if not n:
        raise HTTPException(400, "name is a saved account name: 1 to 32 lower-case letters, digits or dashes")
    return n


def set_order(names: list[str], brett: str) -> dict[str, Any]:
    d = _svc("axf.build-dispatch@1")
    if not hasattr(d, "set_order"):
        raise HTTPException(503, "The build orchestrator on this console can't take an account order yet.")
    new = d.set_order(names, brett)
    mode = d.order_mode() if hasattr(d, "order_mode") else "custom"
    tail = "" if mode == "custom" else " (saved; the switch is on Automatic, so it is followed once you switch to Custom)"
    return {"ok": True, "order": new, "mode": mode, "message": f"Account order: {' → '.join(new) or 'not set (subscriptions only)'}{tail}"}


MODE_TEXT = {"custom": "Custom: the orchestrator follows the drag-and-drop order exactly",
             "auto": "Automatic: subscriptions first, then API"}


def set_mode(raw: Any, brett: str) -> dict[str, Any]:
    mode = model.clean_mode(raw)
    if not mode:
        raise HTTPException(400, "mode is custom (follow the drag-and-drop order) or auto (subscriptions first, then API)")
    d = _svc("axf.build-dispatch@1")
    if not hasattr(d, "set_order_mode"):
        raise HTTPException(503, "The build orchestrator on this console has no Custom / Automatic switch yet.")
    new = d.set_order_mode(mode, brett)
    return {"ok": True, "mode": new, "message": f"Account order: {MODE_TEXT[new]}."}


@router.get("/accounts")
def accounts(request: Request) -> dict[str, Any]:
    _owner(request)
    return read()


@router.get("/mode")
def get_mode(request: Request) -> dict[str, Any]:
    _owner(request)
    cur = read()
    return {"ok": True, "mode": cur["mode"], "text": MODE_TEXT[cur["mode"]], "order": cur["order"], "customOrder": cur["customOrder"]}


@router.post("/mode")
async def post_mode(request: Request) -> dict[str, Any]:
    _owner(request)
    b = await _body(request)
    raw = b.get("mode")
    if raw == "toggle":
        raw = "custom" if (await run_in_threadpool(read))["mode"] == "auto" else "auto"
    return await run_in_threadpool(set_mode, raw, brett_click(request))


@router.post("/order")
async def order(request: Request) -> dict[str, Any]:
    _owner(request)
    b = await _body(request)
    raw = b.get("order")
    names = [model.clean_name(n) for n in (raw.split(",") if isinstance(raw, str) else raw if isinstance(raw, list) else [])]
    return await run_in_threadpool(set_order, [n for n in names if n], brett_click(request))


@router.post("/move")
async def move(request: Request) -> dict[str, Any]:
    _owner(request)
    b = await _body(request)
    name = _name(b)

    def go() -> dict[str, Any]:
        cur = read()
        if name not in [r["name"] for r in cur["accounts"]]:
            raise HTTPException(404, f"No account called {name}.")
        try:
            new = model.moved(cur["customOrder"], name, b.get("to"))
        except ValueError as e:
            raise HTTPException(400, str(e)) from None
        return set_order(new, brett_click(request))

    return await run_in_threadpool(go)


@router.post("/rename")
async def rename(request: Request) -> dict[str, Any]:
    by = _owner(request)
    b = await _body(request)
    name = _name(b)
    svc = _svc("axf.claude-accounts@1")
    if not hasattr(svc, "label"):
        raise HTTPException(503, "The Claude accounts plugin on this console can't rename yet.")
    return await run_in_threadpool(svc.label, name, str(b.get("label") or ""), by)


@router.post("/add")
async def add(request: Request) -> dict[str, Any]:
    """The Terminal tab that adds an account. The console opens it at once (action claude-accounts-manager.add). From
    outside the console (MCP, voice: signin=true) a subscription's sign-in is sent as one held axHub call instead, and
    runs in the tmux session axf-signin-<name> that the Terminal can jump into."""
    by = _owner(request)
    b = await _body(request)
    name = _name(b)
    kind = "api" if b.get("kind") == "api" else "subscription"
    res: dict[str, Any] = {"ok": True, "name": name, "kind": kind, "open": model.add_open(name, kind),
                           "action": f"claude-accounts-manager.add:{kind}:{name}"}
    if b.get("signin") is True and kind == "subscription":
        svc = _svc("axf.claude-accounts@1")
        if hasattr(svc, "signin"):
            try:
                res["signin"] = await run_in_threadpool(svc.signin, name, by)
            except HTTPException as e:
                raise HTTPException(e.status_code, _detail(e)) from None
        res["terminal"] = f"axf-signin-{name}"
    res["message"] = (f"Paste the API key for {name} at the hidden prompt in the Terminal; it stays on the VPS." if kind == "api"
                      else f"Finish the Claude login for {name} in the Terminal; it signs in in its own folder.")
    return res


@router.post("/session")
async def session(request: Request) -> dict[str, Any]:
    _owner(request)
    b = await _body(request)
    name = _name(b)
    rows = await run_in_threadpool(read)
    r = next((x for x in rows["accounts"] if x["name"] == name), None)
    if not r:
        raise HTTPException(404, f"No account called {name}.")
    return {"ok": True, "name": name, "open": model.session_open(name, r["kind"]), "action": f"claude-accounts-manager.session:{name}"}


@router.get("/settings")
def get_settings(request: Request) -> dict[str, Any]:
    _owner(request)
    return {"ok": True, "settings": settings()}


@router.post("/settings")
async def post_settings(request: Request) -> dict[str, Any]:
    _owner(request)
    b = await _body(request)
    patch = b.get("settings") if isinstance(b.get("settings"), dict) else b
    return {"ok": True, "settings": await run_in_threadpool(save_settings, patch)}


@router.get("/widget")
def widget(request: Request) -> dict[str, Any]:
    _owner(request)
    s = settings()
    cur = read()
    pick = s["widget"]["account"] or cur["active"] or (cur["order"][0] if cur["order"] else "")
    r = next((x for x in cur["accounts"] if x["name"] == pick), None)
    return {"ok": True, "account": pick, "text": model.widget_text(r, s["widget"]["show"]), "show": s["widget"]["show"], "row": r}


class ManagerService:
    """axf.claude-accounts-manager@1: the ordered list (rows) for other plugins. Read only."""

    def accounts(self) -> dict[str, Any]:
        return read()


plugin_services.provide("axf.claude-accounts-manager@1", ManagerService(), FOLDER)
