"""UI shortcuts (server part): open anything in the UI by name or by voice (ui-registry@1, Brett Nov 6 2026: "Create a
registry so I can open them with my voice"). Mounted at /api/plugins/ui-shortcuts/.

The registry is every app's `src/assets/ui-registry/<app>.json` (made by framework/cli/ui-registry.mjs) merged with what
the open consoles report live (POST /live: a plugin installed a minute ago is already in it). Matching (id, label,
alias, kind words, fuzzy words, the user's shortcuts) is the one rules file, core/engines/ui-registry-rules.mjs, run
through the CLI (`ui-registry.mjs say|search|get --json`), so the console, the CLI, the MCP tools and Molly agree.
Opening goes through console-commands@1 as a control@1 console command: navigate-only for screens, dialogs, settings
and element items (never a veto); an action that changes data runs with the caller's own grants.

  GET  registry                       apps, counts, live items
  GET  items?q&kind&app&limit         list / search
  GET  item?id=                       one item (id or name) + the command that opens it
  POST open {id, to?, arg?}           open it in the console used last (to: all | <client>)
  POST say {text, to?, app?, open?}   what was said → what opens; answer sentence (`say`)
  GET/POST/DELETE shortcuts           your shortcuts (phrase → item, aliases, say)
  GET  voice                          voice-command@1 commands (generic open + shortcuts)
  POST live {app, items}              an open console's live registry (console token / owner)
  GET  coverage · GET recent
Capability ui-registry@1: plugin_services.get("ui-registry@1").say(text, by=…, to=…, open=True) / .open(id, …) / .items(q=…) / .shortcuts().
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

import plugin_services

router = APIRouter()
FOLDER = "ui-shortcuts"
ROOT = Path(__file__).resolve().parents[5]
CLI = ROOT / "framework" / "cli" / "ui-registry.mjs"
DATA_DIR = Path(os.environ.get("AXF_UI_SHORTCUTS_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
SHORTCUTS = DATA_DIR / "shortcuts.json"
LIVE = DATA_DIR / "live.json"
NAVIGATE = ["control.console.navigate"]
LIVE_TTL_S = 15 * 60          # a console's live items are forgotten this long after its last report
LIVE_MAX = 5000
OWNER = "owner"
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "ambiguous": 409, "not_implemented": 501, "unexpected": 500}
_lock = threading.Lock()
_recent: deque[dict[str, Any]] = deque(maxlen=50)
_live: dict[str, dict[str, Any]] = {}   # "<audience>/<app>/<client>" → {at, app, items}


# ---------------------------------------------------------------------- the rules, through the CLI

def _node(args: list[str], timeout: int = 60) -> Any:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    env = {**os.environ, "AXF_ROOT": str(os.environ.get("AXF_UI_SHORTCUTS_ROOT") or ROOT), "AXF_UI_SHORTCUTS_FILE": str(SHORTCUTS), "AXF_UI_LIVE_FILE": str(LIVE)}
    p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout, env=env)
    out = p.stdout.strip()
    if not out:
        raise RuntimeError((p.stderr or "ui-registry.mjs gave no output").strip()[-600:])
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return json.loads(out.splitlines()[-1])


def _text(v: Any, n: int = 400) -> str:
    return str(v).strip()[:n] if isinstance(v, (str, int, float)) else ""


# ---------------------------------------------------------------------- who is calling

def _caller(request: Request | None) -> tuple[list[str], str, str]:
    """(grants, name, audience): the console token and hub admins = everything, the owner's consoles; a hub user = their perms."""
    user = getattr(getattr(request, "state", None), "axf_user", None) if request is not None else None
    if user is None:
        return ["*"], "console", OWNER
    name = str(getattr(user, "name", "") or "console")
    if getattr(user, "admin", False):
        return ["*"], name, OWNER
    return sorted(set(getattr(user, "perms", ()) or ())), name, f"user:{name}"


# ---------------------------------------------------------------------- shortcuts + live items (files the CLI reads too)

def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def shortcuts() -> list[dict[str, Any]]:
    j = _read(SHORTCUTS, {})
    return list(j.get("shortcuts", []) if isinstance(j, dict) else j)


def _save_shortcuts(items: list[dict[str, Any]]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    SHORTCUTS.write_text(json.dumps({"$axf": "ui-shortcuts@1", "shortcuts": items}, indent=1))


def _write_live() -> None:
    now = time.time()
    with _lock:
        for k in [k for k, v in _live.items() if now - v["at"] > LIVE_TTL_S]:
            _live.pop(k, None)
        items: list[dict[str, Any]] = []
        seen: set[str] = set()
        for v in sorted(_live.values(), key=lambda x: -x["at"]):
            for it in v["items"]:
                if it.get("id") in seen:
                    continue
                seen.add(it["id"])
                items.append(it)
                if len(items) >= LIVE_MAX:
                    break
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    LIVE.write_text(json.dumps({"$axf": "ui-registry@1", "source": "live", "items": items}))


# ---------------------------------------------------------------------- opening

def _console() -> Any | None:
    if not any(s["name"] == "console-commands@1" for s in plugin_services.available()):
        return None
    return plugin_services.get("console-commands@1")


def _deliver(command: dict[str, Any], effect: str, grants: list[str], by: str, audience: str) -> dict[str, Any]:
    svc = _console()
    if svc is None:
        return {"ok": False, "code": "not_implemented", "message": "the Console commands plugin is off or missing (Settings → Plugins), so nothing can be opened"}
    cmd = {**command, "by": by, "reason": "UI shortcuts: open what was asked for"}
    # a screen, dialog, settings tab or element only navigates: the navigate grant alone, never a veto; an action that
    # changes data runs under the caller's own grants (the runner refuses what they can't do)
    use = NAVIGATE if effect == "navigate" else grants
    return svc.run(cmd, use, by, audience)


def _remember(kind: str, text: str, res: dict[str, Any], by: str) -> None:
    item = res.get("item") or {}
    _recent.appendleft({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "kind": kind, "text": text, "item": item.get("id"), "label": item.get("label"), "via": res.get("via"), "ok": bool(res.get("ok")), "by": by, "message": res.get("message") or res.get("say")})


def say(text: str, by: str = "console", to: str = "recent", app: str = "", open_it: bool = True, grants: list[str] | None = None, audience: str = OWNER) -> dict[str, Any]:
    t = _text(text)
    if not t:
        return {"ok": False, "code": "invalid", "message": "say what to open"}
    args = ["say", t]
    if app:
        args += ["--app", app]
    if to and to != "recent":
        args += ["--to", to]
    r = _node(args)
    out: dict[str, Any] = {"ok": False, "text": t, "say": r.get("say", ""), "via": r.get("via")}
    if r.get("item"):
        out.update({"item": r["item"], "effect": r.get("effect", "navigate"), "command": r.get("command")})
        if open_it:
            d = _deliver(r["command"], r.get("effect", "navigate"), grants or ["*"], by, audience)
            out.update({"ok": bool(d.get("ok")), "opened": bool(d.get("ok")), "delivery": d, "message": d.get("message", "")})
            if not d.get("ok"):
                out["say"] = f"I found {r['item']['label']} but could not open it: {d.get('message', d.get('code', 'no console'))}."
        else:
            out["ok"] = True
    elif r.get("ambiguous"):
        out.update({"code": "ambiguous", "candidates": r.get("candidates", [])})
    else:
        out.update({"code": "not_found", "candidates": []})
    _remember("say", t, out, by)
    return out


def open_item(ident: str, by: str = "console", to: str = "recent", arg: str = "", grants: list[str] | None = None, audience: str = OWNER) -> dict[str, Any]:
    i = _text(ident)
    if not i:
        return {"ok": False, "code": "invalid", "message": "which item? its id (<kind>:<key>) or its name"}
    r = _node(["say", i] + (["--to", to] if to and to != "recent" else []))
    if not r.get("item"):
        res = {"ok": False, "code": "ambiguous" if r.get("ambiguous") else "not_found", "message": r.get("say", "not found"), "candidates": r.get("candidates", [])}
        _remember("open", i, res, by)
        return res
    cmd = dict(r["command"])
    if arg:
        cmd["input"] = {**cmd.get("input", {}), "arg": _text(arg, 200)}
    d = _deliver(cmd, r.get("effect", "navigate"), grants or ["*"], by, audience)
    res = {"ok": bool(d.get("ok")), "item": r["item"], "via": r.get("via"), "effect": r.get("effect"), "command": cmd, "delivery": d, "message": d.get("message", ""), "say": r.get("say") if d.get("ok") else f"I could not open {r['item']['label']}: {d.get('message', d.get('code', 'no console'))}."}
    _remember("open", i, res, by)
    return res


# ---------------------------------------------------------------------- routes

def _answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 400))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001 — an empty or malformed body is an empty command
        return {}
    return b if isinstance(b, dict) else {}


@router.get("/registry")
def get_registry() -> dict[str, Any]:
    r = _node(["registry"])
    return {"ok": True, "apps": r.get("apps", []), "items": len(r.get("items", [])), "live": r.get("live", 0), "shortcuts": len(shortcuts())}


@router.get("/items")
def get_items(q: str = "", kind: str = "", app: str = "", limit: int = 50) -> dict[str, Any]:
    lim = max(1, min(int(limit or 50), 5000))
    if q.strip():
        args = ["search", *q.strip().split(), "--limit", str(lim)]
        if kind:
            args += ["--kind", kind]
        if app:
            args += ["--app", app]
        items = _node(args)
    else:
        items = _node(["registry"]).get("items", [])
        items = [i for i in items if (not kind or i.get("kind") == kind) and (not app or i.get("app") == app)][:lim]
    return {"ok": True, "items": items, "count": len(items)}


@router.get("/item")
def get_item(id: str = "") -> JSONResponse:  # noqa: A002 — the query parameter is called id
    if not id.strip():
        raise HTTPException(400, "id is needed: the item id (<kind>:<key>) or its name")
    r = _node(["get", *id.strip().split()])
    if r.get("item"):
        return JSONResponse({"ok": True, **r})
    return _answer({"ok": False, "code": "ambiguous" if r.get("ambiguous") else "not_found", "message": "ambiguous" if r.get("ambiguous") else f"nothing registered as {id}", "candidates": r.get("candidates", [])})


@router.post("/open")
async def post_open(request: Request) -> JSONResponse:
    b = await _body(request)
    grants, name, audience = _caller(request)
    return _answer(open_item(b.get("id") or b.get("q") or b.get("text") or "", _text(b.get("by"), 60) or name, _text(b.get("to"), 80) or "recent", _text(b.get("arg"), 200), grants, audience))


@router.post("/say")
async def post_say(request: Request) -> JSONResponse:
    b = await _body(request)
    grants, name, audience = _caller(request)
    return _answer(say(b.get("text") or b.get("q") or "", _text(b.get("by"), 60) or name, _text(b.get("to"), 80) or "recent", _text(b.get("app"), 63), b.get("open") is not False, grants, audience))


@router.get("/shortcuts")
def get_shortcuts() -> dict[str, Any]:
    return {"ok": True, "shortcuts": shortcuts()}


@router.post("/shortcuts")
async def post_shortcut(request: Request) -> JSONResponse:
    b = await _body(request)
    grants, name, audience = _caller(request)
    if audience != OWNER:
        raise HTTPException(403, "only the console's owner edits the shortcuts")
    phrase = _text(b.get("phrase"), 120)
    ident = _text(b.get("item"), 200)
    if not phrase or not ident:
        return _answer({"ok": False, "code": "invalid", "message": "a shortcut needs a phrase and an item"})
    # the item may be named by words: settle it now so the shortcut points at an id
    r = _node(["get", *ident.split()])
    if not r.get("item"):
        return _answer({"ok": False, "code": "ambiguous" if r.get("ambiguous") else "not_found", "message": f"no registered item for \"{ident}\"", "candidates": r.get("candidates", [])})
    item_id = r["item"]["id"]
    sc: dict[str, Any] = {"id": _text(b.get("id"), 80) or "sc-" + "-".join("".join(c if c.isalnum() else " " for c in phrase.lower()).split())[:60], "phrase": phrase, "item": item_id}
    aliases = [_text(a, 120) for a in (b.get("aliases") or []) if _text(a, 120)]
    if aliases:
        sc["aliases"] = aliases[:12]
    if _text(b.get("say"), 200):
        sc["say"] = _text(b.get("say"), 200)
    if b.get("enabled") is False:
        sc["enabled"] = False
    items = [s for s in shortcuts() if s.get("id") != sc["id"]]
    items.append(sc)
    _save_shortcuts(items)
    return JSONResponse({"ok": True, "shortcut": sc, "item": r["item"], "shortcuts": items})


@router.delete("/shortcuts")
def delete_shortcut(request: Request, id: str = "") -> dict[str, Any]:  # noqa: A002
    _, _, audience = _caller(request)
    if audience != OWNER:
        raise HTTPException(403, "only the console's owner edits the shortcuts")
    items = shortcuts()
    left = [s for s in items if s.get("id") != id]
    if len(left) == len(items):
        raise HTTPException(404, f"no shortcut {id}")
    _save_shortcuts(left)
    return {"ok": True, "removed": id, "shortcuts": left}


@router.get("/voice")
def get_voice() -> dict[str, Any]:
    return {"ok": True, "$axf": "voice-command@1", "app": "axf-console-web", "source": "generated", "commands": _node(["voice"])}


@router.post("/live")
async def post_live(request: Request) -> dict[str, Any]:
    b = await _body(request)
    _, _, audience = _caller(request)
    app = _text(b.get("app"), 63) or "axf-console-web"
    client = _text(b.get("client"), 80) or "console"
    items = [i for i in (b.get("items") or []) if isinstance(i, dict) and isinstance(i.get("id"), str)][:LIVE_MAX]
    for it in items:
        it.setdefault("app", app)
        it["source"] = "live"
    with _lock:
        _live[f"{audience}/{app}/{client}"] = {"at": time.time(), "app": app, "items": items}
    _write_live()
    return {"ok": True, "kept": len(items), "clients": len(_live)}


@router.get("/coverage")
def get_coverage() -> dict[str, Any]:
    return {"ok": True, "apps": _node(["coverage"])}


@router.get("/recent")
def get_recent() -> dict[str, Any]:
    return {"ok": True, "recent": list(_recent)}


# ---------------------------------------------------------------------- the capability

class UiRegistry:
    """ui-registry@1 for other plugins (Voice commands, Molly, Follow Amber) and the console's MCP tools."""

    router = router

    def items(self, q: str = "", kind: str = "", app: str = "", limit: int = 50) -> list[dict[str, Any]]:
        return get_items(q, kind, app, limit)["items"]

    def say(self, text: str, by: str = "amber", to: str = "recent", app: str = "", open: bool = True) -> dict[str, Any]:  # noqa: A002
        return say(text, by, to, app, open)

    def open(self, ident: str, by: str = "amber", to: str = "recent", arg: str = "") -> dict[str, Any]:
        return open_item(ident, by, to, arg)

    def shortcuts(self) -> list[dict[str, Any]]:
        return shortcuts()

    def voice(self) -> list[dict[str, Any]]:
        return _node(["voice"])


plugin_services.provide("ui-registry@1", UiRegistry(), folder=FOLDER)
