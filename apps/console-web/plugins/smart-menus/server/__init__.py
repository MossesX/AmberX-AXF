"""Menus (smart menus, smart-menu@1) — server part. Mounted at /api/plugins/smart-menus/ (console token on every method,
404 while the plugin is off).

What the menus learn and show is kept here, per person, in this plugin's data folder on the VPS that hosts axHub (it
never leaves it): settings, pinned items, the pick log the ranking learns from, and a snapshot of the latest
suggestions each menu drew. "Talking about" topics are one rolling list for the console (Amber reports them with the
`console_context` MCP tool), so every open console shows the same ones. The ranking itself runs in the open console
(framework/core/engines/smartmenu.ts); nothing here calls a model.

    GET  /state                      {settings, pins, picks, topics, suggestions} for the caller
    PUT  /settings                   merge settings (sections, learning, suggestions, showWhy, topicTtlMin, perMenu, behavior)
    POST /picks                      {picks: [{key, item, at}]}: add to the pick log (bounded)
    POST /pins                       {menu, item, on}: pin or unpin an item on one menu
    POST /reset                      {menu?, key?}: forget learning (one menu, one context, or all)
    GET  /topics                     the live topics (newest first)
    POST /topics                     {topics: [{kind, id, label?}], ttl_min?, replace?}: what the conversation is about now
    POST /topics/clear               drop every topic
    GET  /suggestions?menu=          what each menu suggested the last time it opened (the open console reports it)
    POST /suggestions                {menu, key, items}: the open console's report (internal)
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx

FOLDER = "smart-menus"
router = APIRouter()

TOPIC_KINDS = ("build", "plugin", "screen", "pr", "agent", "setting", "profile", "note")
SECTION_KINDS = ("talking", "pinned", "suggested", "context", "static")
MAX_PICKS = 4000
MAX_TOPICS = 12
TOPIC_TTL_DEFAULT = 30
TOPIC_TTL_RANGE = (1, 24 * 60)
DEFAULT_SETTINGS: dict[str, Any] = {
    "enabled": True,
    "learning": True,
    "suggestions": 4,
    "showWhy": True,
    "topicTtlMin": TOPIC_TTL_DEFAULT,
    "sections": [
        {"kind": "talking", "on": True, "max": 4, "label": "Talking about", "icon": "mic"},
        {"kind": "pinned", "on": True, "max": 8, "label": "Pinned", "icon": "star"},
        {"kind": "suggested", "on": True, "max": 4, "label": "Suggested", "icon": "sparkles"},
        {"kind": "context", "on": True, "max": 8, "label": "For this", "icon": "eye"},
        {"kind": "static", "on": True},
    ],
    "perMenu": {},
    "behavior": {"openOnHover": False, "longPressMs": 0, "keyboard": True},
}

_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SMART_MENUS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _read(name: str, default: Any) -> Any:
    p = data_dir() / name
    try:
        return json.loads(p.read_text())
    except (OSError, ValueError):
        return default


def _write(name: str, value: Any) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{name}.tmp"
    tmp.write_text(json.dumps(value, separators=(",", ":")))
    os.chmod(tmp, 0o600)
    tmp.replace(d / name)


def _who(request: Request | None) -> str:
    """The person the data belongs to: the signed-in console user, else the console owner."""
    u = getattr(getattr(request, "state", None), "axf_user", None) if request is not None else None
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    safe = "".join(c for c in str(name or "owner").lower() if c.isalnum() or c in "-_")[:40]
    return safe or "owner"


def _user_file(who: str) -> str:
    return f"user-{who}.json"


def _user(who: str) -> dict[str, Any]:
    d = _read(_user_file(who), {})
    return {"$axf": "smart-menus-user@1", "settings": d.get("settings") or {}, "pins": d.get("pins") or {}, "picks": d.get("picks") or [], "suggestions": d.get("suggestions") or {}}


def _save_user(who: str, d: dict[str, Any]) -> None:
    _write(_user_file(who), d)


def _num(v: Any, lo: float, hi: float, d: float) -> float:
    return min(hi, max(lo, v)) if isinstance(v, (int, float)) and not isinstance(v, bool) else d


def clean_sections(v: Any) -> list[dict[str, Any]] | None:
    if not isinstance(v, list):
        return None
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for s in v:
        if not isinstance(s, dict) or s.get("kind") not in SECTION_KINDS or s["kind"] in seen:
            continue
        seen.add(s["kind"])
        c: dict[str, Any] = {"kind": s["kind"], "on": s.get("on") is not False or s["kind"] == "static"}
        if s["kind"] != "static" and "max" in s:
            c["max"] = int(_num(s.get("max"), 0, 12, 4))
        for k in ("label", "icon"):
            if isinstance(s.get(k), str) and s[k].strip():
                c[k] = s[k].strip()[:40]
        if isinstance(s.get("collapsed"), bool):
            c["collapsed"] = s["collapsed"]
        out.append(c)
    if "static" not in seen:
        out.append({"kind": "static", "on": True})
    return out


def clean_settings(patch: dict[str, Any], current: dict[str, Any]) -> dict[str, Any]:
    """Merge a settings patch into the current settings (unknown keys dropped, values clamped)."""
    s = {**current}
    for k in ("enabled", "learning", "showWhy"):
        if isinstance(patch.get(k), bool):
            s[k] = patch[k]
    if "suggestions" in patch:
        s["suggestions"] = int(_num(patch["suggestions"], 0, 8, 4))
    if "topicTtlMin" in patch:
        s["topicTtlMin"] = int(_num(patch["topicTtlMin"], *TOPIC_TTL_RANGE, TOPIC_TTL_DEFAULT))
    if "sections" in patch:
        secs = clean_sections(patch["sections"])
        if secs is not None:
            s["sections"] = secs
    if isinstance(patch.get("perMenu"), dict):
        per = dict(s.get("perMenu") or {})
        for menu, o in patch["perMenu"].items():
            if not isinstance(menu, str) or not menu.startswith(("ctx:", "app:")):
                continue
            if o is None:
                per.pop(menu, None)
                continue
            if not isinstance(o, dict):
                continue
            m: dict[str, Any] = {}
            secs = clean_sections(o.get("sections"))
            if secs is not None:
                m["sections"] = secs
            if isinstance(o.get("off"), bool):
                m["off"] = o["off"]
            if m:
                per[menu[:120]] = m
            else:
                per.pop(menu, None)
        s["perMenu"] = per
    if isinstance(patch.get("behavior"), dict):
        b = {**DEFAULT_SETTINGS["behavior"], **(s.get("behavior") or {})}
        p = patch["behavior"]
        for k in ("openOnHover", "keyboard"):
            if isinstance(p.get(k), bool):
                b[k] = p[k]
        if "longPressMs" in p:
            b["longPressMs"] = int(_num(p["longPressMs"], 0, 2000, 0))
        s["behavior"] = b
    return s


def effective_settings(saved: dict[str, Any]) -> dict[str, Any]:
    return clean_settings(saved, json.loads(json.dumps(DEFAULT_SETTINGS)))


def _now_ms() -> int:
    return int(time.time() * 1000)


def prune_picks(picks: list[dict[str, Any]], now: int) -> list[dict[str, Any]]:
    floor = now - 140 * 86_400_000  # 20 half-lives of the default 7 days: older picks weigh nothing
    ok = [p for p in picks if isinstance(p, dict) and isinstance(p.get("key"), str) and isinstance(p.get("item"), str) and isinstance(p.get("at"), (int, float)) and floor <= p["at"] <= now + 60_000]
    ok.sort(key=lambda p: p["at"])
    return ok[-MAX_PICKS:]


def reset_picks(picks: list[dict[str, Any]], menu: str = "", key: str = "") -> list[dict[str, Any]]:
    if key:
        return [p for p in picks if p["key"] != key]
    if menu:
        return [p for p in picks if p["key"].split("|")[0] != menu]
    return []


# ------------------------------------------------------------------ topics (one rolling list for the console)

def live_topics(now: int | None = None) -> list[dict[str, Any]]:
    now = now or _now_ms()
    ttl_default = int(_read("topics.json", {}).get("ttlMin") or TOPIC_TTL_DEFAULT)
    out, seen = [], set()
    for t in sorted(_read("topics.json", {}).get("topics") or [], key=lambda t: -t.get("at", 0)):
        k = f"{t.get('kind')}:{t.get('id')}"
        if k in seen or now - int(t.get("at", 0)) >= int(t.get("ttlMin") or ttl_default) * 60_000:
            continue
        seen.add(k)
        out.append(t)
    return out[:MAX_TOPICS]


def set_topics(topics: list[Any], ttl_min: int | None = None, replace: bool = False, by: str = "") -> dict[str, Any]:
    """Merge what the conversation is about now into the rolling list (a repeat refreshes it); replace drops the rest."""
    now = _now_ms()
    fresh: list[dict[str, Any]] = []
    bad: list[str] = []
    for t in topics if isinstance(topics, list) else []:
        if not isinstance(t, dict) or t.get("kind") not in TOPIC_KINDS or not str(t.get("id") or "").strip():
            bad.append(str(t)[:80])
            continue
        x: dict[str, Any] = {"kind": t["kind"], "id": str(t["id"]).strip()[:200], "at": now}
        if str(t.get("label") or "").strip():
            x["label"] = str(t["label"]).strip()[:120]
        if ttl_min:
            x["ttlMin"] = int(_num(ttl_min, *TOPIC_TTL_RANGE, TOPIC_TTL_DEFAULT))
        if by:
            x["by"] = by[:60]
        fresh.append(x)
    if bad and not fresh:
        raise HTTPException(400, f"no usable topic (kind must be one of {', '.join(TOPIC_KINDS)}, id required)")
    with _lock:
        keys = {f"{t['kind']}:{t['id']}" for t in fresh}
        old = [] if replace else [t for t in live_topics(now) if f"{t['kind']}:{t['id']}" not in keys]
        doc = _read("topics.json", {})
        doc["topics"] = (fresh + old)[:MAX_TOPICS]
        doc["updatedAt"] = now
        _write("topics.json", doc)
    cx.log("smart-menus", f"talking about: {', '.join(t.get('label') or t['id'] for t in fresh)}", "info")
    return {"ok": True, "topics": live_topics(now), "ignored": bad}


# ------------------------------------------------------------------ routes

@router.get("/state")
def state(request: Request) -> dict[str, Any]:
    who = _who(request)
    u = _user(who)
    return {"$axf": "smart-menus-state@1", "user": who, "settings": effective_settings(u["settings"]), "pins": u["pins"],
            "picks": prune_picks(u["picks"], _now_ms()), "topics": live_topics(), "suggestions": u["suggestions"], "repo": cx.GITHUB_REPO}


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "settings must be an object")
    who = _who(request)
    with _lock:
        u = _user(who)
        u["settings"] = clean_settings(body, u["settings"])
        _save_user(who, u)
    return {"ok": True, "settings": effective_settings(u["settings"])}


@router.post("/picks")
async def add_picks(request: Request) -> dict[str, Any]:
    body = await request.json()
    picks = body.get("picks") if isinstance(body, dict) else None
    if not isinstance(picks, list):
        raise HTTPException(400, "picks must be a list of {key, item, at}")
    who = _who(request)
    with _lock:
        u = _user(who)
        if not effective_settings(u["settings"]).get("learning", True):
            return {"ok": True, "added": 0, "learning": False}
        clean = [{"key": str(p["key"])[:300], "item": str(p["item"])[:200], "at": int(p["at"])} for p in picks[:200]
                 if isinstance(p, dict) and isinstance(p.get("key"), str) and isinstance(p.get("item"), str) and isinstance(p.get("at"), (int, float))]
        u["picks"] = prune_picks(u["picks"] + clean, _now_ms())
        _save_user(who, u)
    return {"ok": True, "added": len(clean), "total": len(u["picks"])}


@router.post("/pins")
async def pin(request: Request) -> dict[str, Any]:
    body = await request.json()
    menu, item = str(body.get("menu") or ""), str(body.get("item") or "")
    if not menu.startswith(("ctx:", "app:")) or not item:
        raise HTTPException(400, "menu (ctx:<target> | app:<menu id>) and item are required")
    who = _who(request)
    with _lock:
        u = _user(who)
        pins = [p for p in u["pins"].get(menu, []) if p != item]
        if body.get("on", True) is not False:
            pins.append(item)
        if pins:
            u["pins"][menu] = pins[:12]
        else:
            u["pins"].pop(menu, None)
        _save_user(who, u)
    return {"ok": True, "menu": menu, "pins": u["pins"].get(menu, [])}


@router.post("/reset")
async def reset(request: Request) -> dict[str, Any]:
    body = await request.json() if (await request.body()) else {}
    menu, key = str(body.get("menu") or ""), str(body.get("key") or "")
    who = _who(request)
    with _lock:
        u = _user(who)
        before = len(u["picks"])
        u["picks"] = reset_picks(u["picks"], menu, key)
        if not key:
            u["suggestions"] = {m: s for m, s in u["suggestions"].items() if menu and m != menu}
        _save_user(who, u)
    return {"ok": True, "forgot": before - len(u["picks"]), "scope": key or menu or "all"}


@router.get("/topics")
def topics() -> dict[str, Any]:
    return {"topics": live_topics()}


@router.post("/topics")
async def post_topics(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        raise HTTPException(400, "body must be {topics: [{kind, id, label?}], ttl_min?, replace?}")
    return set_topics(body.get("topics") or [], body.get("ttl_min") or body.get("ttlMin"), bool(body.get("replace")), _who(request))


@router.post("/topics/clear")
def clear_topics() -> dict[str, Any]:
    with _lock:
        _write("topics.json", {"topics": [], "updatedAt": _now_ms()})
    return {"ok": True, "topics": []}


@router.get("/suggestions")
def suggestions(request: Request, menu: str = "") -> dict[str, Any]:
    s = _user(_who(request))["suggestions"]
    return {"suggestions": {menu: s.get(menu)} if menu else s}


@router.post("/suggestions")
async def report_suggestions(request: Request) -> dict[str, Any]:
    body = await request.json()
    menu = str(body.get("menu") or "")
    if not menu.startswith(("ctx:", "app:")):
        raise HTTPException(400, "menu is required")
    who = _who(request)
    with _lock:
        u = _user(who)
        u["suggestions"][menu[:120]] = {"key": str(body.get("key") or "")[:300], "items": [
            {"id": str(i.get("id"))[:200], "label": str(i.get("label") or "")[:120], "section": str(i.get("section") or "")[:20], "why": str(i.get("why") or "")[:60]}
            for i in (body.get("items") or [])[:24] if isinstance(i, dict)], "at": _now_ms()}
        _save_user(who, u)
    return {"ok": True}


# ------------------------------------------------------------------ MCP: console_context

CONTEXT_TOOL = "console_context"
_tool_added = False


async def console_context(topics: list[dict[str, Any]], ttl_min: int = 0, replace: bool = False) -> dict[str, Any]:
    """What Brett and Amber are talking about right now, so every console menu puts it at the top ("Talking about").
    Call it whenever the conversation moves to something in the console. topics = [{kind, id, label}] with kind one of
    build, plugin, screen, pr, agent, setting, profile, note (id = the build id, plugin folder, view id, PR number…).
    Topics fade after ttl_min minutes (default 30) or when replace=true sends a new set. Navigation only: it changes
    no data, nothing waits on a veto."""
    return set_topics(topics, ttl_min or None, replace, "amber")


def sync_mcp() -> None:
    """Add console_context to the console's MCP server while the plugin is on; remove it when it is off."""
    global _tool_added
    mcp = getattr(cx, "mcp_server", None)
    if mcp is None:
        return
    on = bool(cx.plugin_enabled(FOLDER))
    if on and not _tool_added:
        from mcp.types import ToolAnnotations
        mcp.add_tool(console_context, name=CONTEXT_TOOL, title="Console context (Talking about)", description=console_context.__doc__,
                     annotations=ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False))
        _tool_added = True
    elif not on and _tool_added:
        try:
            mcp.remove_tool(CONTEXT_TOOL)
        except Exception:  # noqa: BLE001
            pass
        _tool_added = False


def _loop() -> None:
    """Keep console_context in step with the plugin's switch (turned on or off in Settings → Plugins)."""
    while True:
        try:
            sync_mcp()
        except Exception as e:  # noqa: BLE001 — a missing MCP server never stops the routes
            cx.log("smart-menus", f"console_context not synced: {str(e)[:200]}", "warn")
        time.sleep(30)


if os.environ.get("AXF_SMART_MENUS_SYNC", "1") != "0":
    threading.Thread(target=_loop, name="smart-menus-mcp", daemon=True).start()


@router.get("/mcp")
def mcp_status() -> dict[str, Any]:
    sync_mcp()
    return {"tool": CONTEXT_TOOL, "added": _tool_added}
