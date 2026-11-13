"""Context menus — server part (context-menu@1, capability context-menus@1). Mounted at /api/plugins/context-menus/.

Every route runs the plugin's Node store (menus.mjs `api`), which keeps every menu on the hub's shared data: ONE TRUE
SOURCE for every plugin, app and Claude session. Claude generation: the store builds the prompt with zero tokens, this
part sends it through the AI assistant's `axf.llm@1` service, and the store turns the reply into a draft the person
previews before applying. Without a working Claude (no provider, or the Claude badge not green) `POST /generate` says so
(`aiMissing`) and the page greys the button out.

Other plugins' server parts read and write menus through `plugin_services.get("context-menus@1")` (never by folder).
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
FOLDER = "context-menus"
CLI = Path(__file__).resolve().parent.parent / "menus.mjs"
ROOT = CLI.parents[4]
LEVELS = ("beginner", "amateur", "pro", "advanced")


def run(req: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), "api", "-"], input=json.dumps(req), cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"Context menus could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _by(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")


def _ok(r: dict[str, Any], missing: int = 404) -> dict[str, Any]:
    if r.get("ok") is False:
        raise HTTPException(missing if "no such" in str(r.get("error", "")) else 400, r.get("error") or "; ".join(r.get("errors", [])) or "failed")
    return r


def _level(level: str) -> str:
    if level not in LEVELS:
        raise HTTPException(400, f"level must be one of {', '.join(LEVELS)}")
    return level


# ---------------- Claude readiness ----------------

def claude_status(live: bool = False) -> dict[str, Any]:
    """Is Claude usable right now? The AI assistant's models service (axf.llm@1) must be there with at least one profile;
    `live` also runs its credits check (one tiny request, the same test the Claude badge shows green for). Capability only,
    never a plugin folder; never returns a key or a reply."""
    svc = plugin_services.get("axf.llm@1")
    if svc is None:
        return {"ready": False, "reason": "The AI assistant plugin is off or has no Claude provider (it provides models: axf.llm@1).", "state": "none"}
    try:
        profiles = svc.profiles() if hasattr(svc, "profiles") else []
    except Exception:  # noqa: BLE001 — a broken provider store reads as not ready
        profiles = []
    if not profiles:
        return {"ready": False, "reason": "The AI assistant has no model profile yet (Settings → Plugins → AI assistant).", "state": "none"}
    if live and hasattr(svc, "credits"):
        try:
            c = svc.credits(auto_switch=False)
        except Exception as e:  # noqa: BLE001
            return {"ready": False, "reason": f"Claude check failed: {str(e)[:200]}", "state": "error"}
        st = str(c.get("state") or "ok")
        if st != "ok":
            return {"ready": False, "reason": "Claude is out of credits or over its limit (the Claude badge is not green)." if st == "no-credit" else f"Claude is not answering ({st}).", "state": st}
        return {"ready": True, "reason": "", "state": "ok"}
    return {"ready": True, "reason": "", "state": "untested"}


# ---------------- reads ----------------

@router.get("/state")
def state(app: str = "") -> dict[str, Any]:
    """Everything the page shows: every menu (with which one each app shows), the levels, the zone registry, drafts, where the store is."""
    return {**run({"op": "state", "app": app}), "claude": claude_status()}


@router.get("/menus")
def menus(q: str = "", app: str = "", level: str = "", zone: str = "", source: str = "") -> dict[str, Any]:
    """List every context menu (search words, app, level, zone, source)."""
    return run({"op": "list", "q": q, "app": app, "level": level, "zone": zone, "source": source})


@router.get("/menus/{mid}")
def menu(mid: str) -> dict[str, Any]:
    return _ok(run({"op": "get", "id": mid}))


@router.get("/menus/{mid}/history")
def menu_history(mid: str) -> dict[str, Any]:
    return _ok(run({"op": "history", "id": mid}))


@router.get("/zones")
def zones(scan: bool = False) -> dict[str, Any]:
    """The zone registry (every data-fx-ctx-target the code draws + what open consoles reported); scan=true rescans the code."""
    return run({"op": "zones", "scan": scan})


@router.get("/levels")
def levels() -> dict[str, Any]:
    return run({"op": "levels"})


@router.get("/actions")
def actions() -> dict[str, Any]:
    """The actions a menu item may run (the console's control inventory)."""
    return run({"op": "actions"})


@router.get("/active")
def active(app: str = "console-web") -> dict[str, Any]:
    return run({"op": "active", "app": app})


@router.get("/drafts")
def drafts() -> dict[str, Any]:
    return run({"op": "drafts"})


@router.get("/drafts/{did}")
def draft(did: str) -> dict[str, Any]:
    return _ok(run({"op": "get-draft", "id": did}))


@router.get("/claude")
def claude(live: bool = False) -> dict[str, Any]:
    """Whether Generate can run: the models service is there; live=true also runs the credits check the Claude badge shows green for."""
    return claude_status(live)


@router.get("/prompt")
def prompt(level: str = "pro", app: str = "console-web", page: str = "") -> dict[str, Any]:
    """The prompt Claude would get for a level (zero tokens): read it before spending any."""
    return _ok(run({"op": "prompt", "level": _level(level), "app": app, "page": page}))


# ---------------- commands ----------------

@router.put("/menus/{mid}")
async def save(mid: str, request: Request) -> dict[str, Any]:
    """Save a context-menu@1 document (validated against the rules; the previous version goes to its history)."""
    body = await request.json()
    doc = body.get("menu", body) if isinstance(body, dict) else body
    if not isinstance(doc, dict):
        raise HTTPException(400, "send the menu document")
    doc = {**doc, "id": mid}
    return _ok(run({"op": "save", "menu": doc, "by": _by(request), "source": body.get("source") if isinstance(body, dict) else None}))


@router.delete("/menus/{mid}")
def delete(mid: str) -> dict[str, Any]:
    return _ok(run({"op": "delete", "id": mid}))


@router.post("/menus/{mid}/restore")
async def restore(mid: str, request: Request) -> dict[str, Any]:
    """Restore one snapshot (v) of a menu, like a skin."""
    body = await request.json()
    return _ok(run({"op": "restore", "id": mid, "v": (body or {}).get("v"), "by": _by(request)}))


@router.post("/menus/{mid}/use")
def use(mid: str, request: Request) -> dict[str, Any]:
    """Make a menu the one its app shows (every open console follows)."""
    return _ok(run({"op": "use", "id": mid, "by": _by(request)}))


@router.post("/zones/report")
async def report_zones(request: Request) -> dict[str, Any]:
    """An open console reports the zones on its screen (items: [{id, label, elements}], page)."""
    body = await request.json() or {}
    return run({"op": "report-zones", "items": body.get("items") or [], "page": body.get("page") or ""})


@router.post("/generate")
async def generate(request: Request) -> dict[str, Any]:
    """Generate the context menus of an app at a coder level with Claude: builds the prompt (zero tokens), sends it through
    axf.llm@1, turns the reply into a DRAFT with a preview (menu, warnings, what changes). Nothing is applied until
    POST /apply, unless `apply` is true. Body: { level, app?, page?, name?, actions?: [{id,label}], apply? }."""
    body = await request.json() or {}
    level = _level(str(body.get("level") or "pro"))
    app = str(body.get("app") or "console-web")
    page = str(body.get("page") or "")
    name = str(body.get("name") or "")
    acts = body.get("actions") if isinstance(body.get("actions"), list) else None
    status = claude_status()
    if not status["ready"]:
        return {"ok": False, "aiMissing": True, "error": status["reason"]}
    prompt = run({"op": "prompt", "level": level, "app": app, "page": page, "name": name, "actions": acts})
    if not prompt.get("ok"):
        raise HTTPException(400, prompt.get("error") or "no prompt")
    svc = plugin_services.get("axf.llm@1")
    try:
        out = svc.complete(prompt["prompt"]["messages"], system=prompt["prompt"]["system"], params={"max_tokens": 6000})
    except Exception as e:  # noqa: BLE001 — shown to the person
        return {"ok": False, "error": f"Claude failed: {str(e)[:300]}"}
    r = run({"op": "draft", "reply": out.get("text") or "", "level": level, "app": app, "page": page, "name": name, "actions": acts,
             "by": _by(request), "model": out.get("model") or ""})
    if r.get("ok") and body.get("apply"):
        return {**run({"op": "apply", "id": r["draft"]["id"], "by": _by(request)}), "draft": r["draft"], "model": out.get("model") or ""}
    return {**r, "model": out.get("model") or ""}


@router.post("/apply")
async def apply(request: Request) -> dict[str, Any]:
    """Apply a draft: save it as a menu and make it the one its app shows (use=false keeps the current one)."""
    body = await request.json() or {}
    return _ok(run({"op": "apply", "id": str(body.get("id") or ""), "use": body.get("use", True) is not False, "by": _by(request)}))


@router.post("/discard")
async def discard(request: Request) -> dict[str, Any]:
    body = await request.json() or {}
    return _ok(run({"op": "discard", "id": str(body.get("id") or "")}))


@router.post("/voice")
async def voice(request: Request) -> dict[str, Any]:
    """One spoken sentence → the command it means and, when it is a generate, the draft (or the applied menu when the
    sentence says apply). 'generate pro context menus', 'preview beginner menus', 'apply', 'list context menus', 'use menu <id>'."""
    body = await request.json() or {}
    p = run({"op": "voice", "text": str(body.get("text") or "")})
    if not p.get("ok"):
        return p
    op = p.get("op")
    if op == "generate":
        return await generate(_FakeRequest(request, {"level": p["level"], "app": p["app"], "apply": not p.get("preview") and bool(body.get("applyWhenSure"))}))
    if op == "apply":
        ds = run({"op": "drafts"}).get("drafts") or []
        if not ds:
            return {"ok": False, "error": "there is no draft to apply: generate one first"}
        return run({"op": "apply", "id": ds[0]["id"], "by": _by(request)})
    if op == "list":
        return run({"op": "list", "level": p.get("level", ""), "app": p.get("app", "")})
    if op == "use":
        return run({"op": "use", "id": p["id"], "by": _by(request)})
    return p


class _FakeRequest:
    """A request wrapper carrying another body (the voice route re-uses generate)."""

    def __init__(self, request: Request, body: dict[str, Any]) -> None:
        self.state = request.state
        self._body = body

    async def json(self) -> dict[str, Any]:
        return self._body


# ---------------- capability for other plugins ----------------

class ContextMenusService:
    """context-menus@1: other plugins' server parts read, save and switch menus without naming this folder."""

    contract = "context-menus@1"

    def list(self, **filters: str) -> list[dict[str, Any]]:
        return run({"op": "list", **filters}).get("menus") or []

    def get(self, mid: str) -> dict[str, Any] | None:
        r = run({"op": "get", "id": mid})
        return r.get("menu") if r.get("ok") else None

    def active(self, app: str = "console-web") -> dict[str, Any] | None:
        return run({"op": "active", "app": app}).get("menu")

    def save(self, menu: dict[str, Any], by: str = "plugin") -> dict[str, Any]:
        return run({"op": "save", "menu": menu, "by": by})

    def use(self, mid: str, by: str = "plugin") -> dict[str, Any]:
        return run({"op": "use", "id": mid, "by": by})

    def zones(self) -> list[dict[str, Any]]:
        return run({"op": "zones"}).get("items") or []

    def report_zones(self, items: list[dict[str, Any]], page: str = "") -> dict[str, Any]:
        return run({"op": "report-zones", "items": items, "page": page})


plugin_services.provide("context-menus@1", ContextMenusService(), FOLDER)
