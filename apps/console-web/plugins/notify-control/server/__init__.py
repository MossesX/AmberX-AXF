"""Notifications control panel (server part): one registry, one decision, every sender goes through it.

Brett, Nov 6 2026: "You need to have an administration panel. I need to control all the notifications."

Every console sender raises through the alert hub, so the hub asks this plugin (capability axf.notify@1) before it
delivers and before it hands a list to a reader: the gate is one seam, not a change in each sender. Senders outside the
hub ask the same capability (`allowed`) or the policy AmberX receives in its alerts reply. No plugin here = the hub
behaves as it always did. Anything the gate can't answer lets the notification through: a broken panel never loses one.

  GET  state                    everything the panel shows
  GET  types                    the registry with each type's decision now
  GET  check?type=<id>          what happens to this type right now, and why
  GET  recent                   what the gate decided lately, blocked ones included
  POST master {on}              the master switch
  POST app {app, on}            one app: console, amberx, webpush
  POST set {type, enabled?, channel?, on?, channels?, priority?}
  POST quiet {enabled?, start?, end?}
  POST test {type}              send a real test through the same path
  POST reset {type?, confirm}   back to the registry's defaults

Guarded types (approvals and veto) ignore the master and app switches, and only Brett's own signed-in session may turn
them down: a session that could mute the veto notice could act unseen. Data: .axf-console/plugins/notify-control/.
"""
from __future__ import annotations

import json
import os
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

from . import core as C

router = APIRouter()
FOLDER = "notify-control"
HERE = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]
SETTINGS_TTL_S = 30
TEST_CLEAR_S = 90
LOUD = ("warning", "error", "critical")

_lock = threading.RLock()
_recent: deque[dict[str, Any]] = deque(maxlen=200)
_runtime: dict[str, dict[str, Any]] = {}  # types registered at run time (register())
_seen: dict[str, dict[str, Any]] = {}  # sources nobody registered
_settings: dict[str, Any] = {}
_settings_at = 0.0
_refreshing = False
_cache: tuple[float, dict[str, Any], list[dict[str, Any]]] = (0.0, {}, [])


def _data() -> Path:
    return Path(os.environ.get("AXF_NOTIFY_DATA_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _timezone() -> str:
    return os.environ.get("AXF_TIMEZONE") or "America/New_York"


# ---------------------------------------------------------------------- config

def load_config() -> dict[str, Any]:
    try:
        c = json.loads((_data() / "config.json").read_text())
    except (OSError, ValueError):
        c = {}
    return {"master": c.get("master", True) is not False, "apps": c.get("apps") if isinstance(c.get("apps"), dict) else {},
            "types": c.get("types") if isinstance(c.get("types"), dict) else {},
            "quiet": c.get("quiet") if isinstance(c.get("quiet"), dict) else {}}


def save_config(c: dict[str, Any]) -> None:
    d = _data()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "config.json.tmp"
    tmp.write_text(json.dumps(c, indent=2))
    os.chmod(tmp, 0o600)
    os.replace(tmp, d / "config.json")
    cx.alerts_changed()  # open consoles and the next phone read get the new answers


# ---------------------------------------------------------------------- the registry

def registry() -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """The registry and every type. Read at most once a minute: the gate runs on every raise."""
    global _cache
    if time.time() - _cache[0] < 60:
        return _cache[1], _cache[2]
    reg = C.read_registry(HERE / "registry.json")
    plugins = HERE.parent
    types = C.build_types(reg, [*C.plugin_types(plugins), *C.plugin_banners(plugins), *_runtime.values()])
    _cache = (time.time(), reg, types)
    return reg, types


def _app_of(reg: dict[str, Any]) -> dict[str, str]:
    return {c["id"]: c["app"] for c in reg["channels"]}


def _channels(reg: dict[str, Any]) -> list[str]:
    return [c["id"] for c in reg["channels"]]


def all_types() -> list[dict[str, Any]]:
    return [*registry()[1], *_seen.values()]


# ---------------------------------------------------------------------- Claude settings (the one home of quiet hours)

def _refresh_settings() -> None:
    global _settings, _settings_at, _refreshing
    try:
        svc = plugin_services.get("axf.claude-settings@1")
        view = svc.get() if svc is not None else {}
        if isinstance(view.get("values"), dict):
            _settings = view["values"]
    except Exception:  # noqa: BLE001 — stale values beat no gate
        pass
    _settings_at = time.time()
    _refreshing = False


def settings() -> dict[str, Any]:
    """Claude settings as last read. Reading them runs Node, so it happens on a side thread and never inside a raise."""
    global _refreshing
    if time.time() - _settings_at > SETTINGS_TTL_S and not _refreshing:
        _refreshing = True
        threading.Thread(target=_refresh_settings, name="notify-settings", daemon=True).start()
    return _settings


def quiet_config() -> dict[str, Any]:
    s = settings()
    q = load_config()["quiet"]
    if "notify.quietHours" in s:
        return {"enabled": s.get("notify.quietHours") is True, "start": str(s.get("notify.quietStart") or "22:00"), "end": str(s.get("notify.quietEnd") or "07:00"), "home": "settings"}
    return {"enabled": q.get("enabled") is True, "start": str(q.get("start") or "22:00"), "end": str(q.get("end") or "07:00"), "home": "panel"}


def quiet_now(at: float | None = None) -> bool:
    q = quiet_config()
    return q["enabled"] and C.in_window(C.local_now(_timezone(), at), q["start"], q["end"])


# ---------------------------------------------------------------------- decisions

def verdict_for(t: dict[str, Any]) -> dict[str, Any]:
    reg = registry()[0]
    return C.decide(t, load_config(), settings(), quiet_now(), _app_of(reg))


def type_of(source: str, key: str, forced: str = "") -> dict[str, Any]:
    reg, types = registry()
    t = C.classify([*types, *_seen.values()], source, key, forced)
    if t is not None:
        return t
    t = C.discovered(source, _channels(reg))
    _seen[t["id"]] = t
    return t


def alert_verdict(a: dict[str, Any]) -> dict[str, Any]:
    meta = a.get("meta") if isinstance(a.get("meta"), dict) else {}
    src, key = str(a.get("source") or ""), str(a.get("key") or "")
    t = type_of(src, key or plain_key(src, str(a.get("title") or "")), str(meta.get("notifyType") or ""))
    # AmberX shows warnings and worse. A type promoted past its severity (by the registry or by a click here) must still buzz.
    picked = ((load_config()["types"].get(t["id"]) or {}).get("channels") or {}).get("amberx") is True
    return {**verdict_for(t), "promote": t.get("push") is True or picked}


def plain_key(source: str, title: str) -> str:
    return f"{source}:{title}"  # the hub's key for an alert raised without one


def note(alert: dict[str, Any], v: dict[str, Any]) -> None:
    used = [c for c, on in v["channels"].items() if on]
    key = str(alert.get("key") or plain_key(str(alert.get("source")), str(alert.get("title"))))
    with _lock:
        last = _recent[0] if _recent else None
        if last and last["key"] == key and last["why"] == v["why"]:
            last["count"] += 1
            last["at"] = int(time.time() * 1000)
            return
        _recent.appendleft({"at": int(time.time() * 1000), "key": key[:200], "type": v["type"], "label": v["label"], "title": str(alert.get("title") or "")[:200],
                            "severity": alert.get("severity") or "info", "allow": v["allow"], "channels": used, "why": v["why"], "count": 1})


class Notify:
    """axf.notify@1. The alert hub calls check() and view(); any other sender calls allowed(type, channel)."""

    def check(self, inp: dict[str, Any]) -> dict[str, Any]:
        v = alert_verdict(inp)
        note(inp, v)
        return v

    def view(self, items: list[dict[str, Any]], phone: bool = False) -> list[dict[str, Any]]:
        """The alerts as one reader should see them. Live, so a change here or the end of quiet hours applies at once.
        The phone gets only what may buzz it; a browser gets banner-off alerts already read."""
        out = []
        for a in items:
            v = alert_verdict(a)
            na = {**a, "notify": {k: v[k] for k in ("type", "priority", "channels", "held")}}
            if phone:
                done = a.get("resolved") or a.get("ack")
                if not done and not v["channels"].get("amberx"):
                    continue
                if not done and v["promote"] and a.get("severity") not in LOUD:
                    na["severity"] = "warning"
            elif not v["channels"].get("banner") and not a.get("ack"):
                na["ack"] = True
            out.append(na)
        return out

    def allowed(self, type_id: str, channel: str) -> bool:
        t = next((x for x in all_types() if x["id"] == type_id), None)
        return True if t is None else verdict_for(t)["channels"].get(channel, False) is True

    def device_off(self) -> list[str]:
        """Device-side types the AmberX app must not show: it gets this list with its alerts."""
        return [t["id"] for t in registry()[1] if t["enforced"] == "device" and not verdict_for(t)["channels"].get("amberx")]

    def register(self, types: list[dict[str, Any]]) -> None:
        """A sender adds its types while the console runs (a plugin's notify.json does the same at load)."""
        global _cache
        for t in types:
            if isinstance(t.get("id"), str):
                _runtime[t["id"]] = t
        _cache = (0.0, {}, [])


plugin_services.provide("axf.notify@1", Notify(), FOLDER)


# ---------------------------------------------------------------------- what the panel reads

def type_row(t: dict[str, Any]) -> dict[str, Any]:
    cfg, s = load_config(), settings()
    eff = C.effective(t, cfg, s)
    return {k: t.get(k) for k in ("id", "label", "group", "app", "source", "description", "enforced", "guarded", "setting", "plugin", "allowed", "defaults")} | {
        "enforcedText": C.ENFORCED.get(t["enforced"], ""), "fixed": t["enforced"] in C.FIXED, "settings": eff, "customized": t["id"] in cfg["types"],
        "linkedOff": s.get(t.get("setting") or "", True) is False, "now": verdict_for(t)}


def state() -> dict[str, Any]:
    reg, _ = registry()
    cfg = load_config()
    rows = [type_row(t) for t in all_types()]
    return {"ok": True, "master": cfg["master"], "apps": [{**a, "on": cfg["apps"].get(a["id"], True) is not False} for a in reg["apps"]],
            "channels": reg["channels"], "groups": reg["groups"], "priorities": C.PRIORITIES, "quiet": {**quiet_config(), "now": quiet_now(), "timeZone": _timezone()},
            "types": rows, "recent": list(_recent)[:30], "counts": {"types": len(rows), "off": sum(1 for r in rows if not r["fixed"] and not r["settings"]["enabled"]),
                                                                     "blocked": sum(1 for x in _recent if not x["allow"])}}


def find(tid: Any) -> dict[str, Any]:
    t = next((x for x in all_types() if x["id"] == tid), None)
    if t is None:
        raise HTTPException(404, f"no notification type {tid!r} (GET types lists them)")
    return t


def owner(request: Request) -> bool:
    c = plugin_services.get("control@1")
    return bool(c is not None and hasattr(c, "owner") and c.owner(request))


def need_owner(request: Request, t: dict[str, Any], patch: dict[str, Any]) -> None:
    """A guarded type can always be turned back up; turning it down is Brett's own click."""
    if not t["guarded"] or owner(request):
        return
    down = patch.get("enabled") is False or any(v is False for v in (patch.get("channels") or {}).values()) or patch.get("priority") in ("low", "normal", "high")
    if down:
        raise HTTPException(403, f"{t['label']} is how you stop a held call: only your own signed-in console click turns it down")


async def body_of(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except ValueError:
        b = {}
    return b if isinstance(b, dict) else {}


# ---------------------------------------------------------------------- routes

@router.get("/state")
def get_state() -> dict[str, Any]:
    return state()


@router.get("/types")
def get_types() -> dict[str, Any]:
    return {"ok": True, "types": [type_row(t) for t in all_types()]}


@router.get("/check")
def check_type(type: str) -> dict[str, Any]:  # noqa: A002 — the public query name
    return {"ok": True, **verdict_for(find(type)), "quiet": quiet_now()}


@router.get("/recent")
def get_recent() -> dict[str, Any]:
    return {"ok": True, "items": list(_recent)}


@router.post("/master")
async def set_master(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    if not isinstance(b.get("on"), bool):
        raise HTTPException(400, "send { on: true | false }")
    with _lock:
        save_config({**load_config(), "master": b["on"]})
    return state()


@router.post("/app")
async def set_app(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    ids = [a["id"] for a in registry()[0]["apps"]]
    if b.get("app") not in ids or not isinstance(b.get("on"), bool):
        raise HTTPException(400, f"send {{ app, on }}; apps: {', '.join(ids)}")
    with _lock:
        c = load_config()
        save_config({**c, "apps": {**c["apps"], b["app"]: b["on"]}})
    return state()


@router.post("/set")
async def set_type(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    t = find(b.get("type"))
    try:
        patch = C.clean_patch(t, b)
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    need_owner(request, t, patch)
    if t.get("setting") and "enabled" in patch and t["setting"] in settings():
        write_settings({t["setting"]: patch["enabled"]}, "Notifications panel")  # one switch: the Claude setting is the same one
    with _lock:
        save_config(C.merge(load_config(), t["id"], patch))
    return state()


def write_settings(values: dict[str, Any], by: str) -> bool:
    svc = plugin_services.get("axf.claude-settings@1")
    if svc is None or not hasattr(svc, "set"):
        return False
    r = svc.set(values, by)
    if not r.get("ok"):
        raise HTTPException(400, str(r.get("message") or "Claude settings said no"))
    _refresh_settings()
    return True


@router.post("/quiet")
async def set_quiet(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    for k in ("start", "end"):
        if b.get(k) is not None and not C.TIME_RE.match(str(b[k])):
            raise HTTPException(400, f"{k} must be HH:MM (24 hour)")
    if b.get("enabled") is not None and not isinstance(b["enabled"], bool):
        raise HTTPException(400, "enabled must be true or false")
    q = {k: b[k] for k in ("enabled", "start", "end") if b.get(k) is not None}
    if not q:
        raise HTTPException(400, "send enabled, start or end")
    names = {"enabled": "notify.quietHours", "start": "notify.quietStart", "end": "notify.quietEnd"}
    if "notify.quietHours" not in settings() or not write_settings({names[k]: v for k, v in q.items()}, "Notifications panel"):
        with _lock:
            c = load_config()
            save_config({**c, "quiet": {**c["quiet"], **q}})
    cx.alerts_changed()
    return state()


@router.post("/test")
async def send_test(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    t = find(b.get("type"))
    if t["enforced"] in C.FIXED:
        raise HTTPException(400, f"{t['label']} can't be tested from here: {C.ENFORCED[t['enforced']]}")
    v = verdict_for(t)
    key = f"notify-test:{t['id']}"
    cx.resolve_alerts([key])  # resolved first, so a second test buzzes again
    cx.raise_alert({"source": "notify-test", "severity": "warning", "key": key, "title": f"Test: {t['label']}"[:200],
                    "body": "Sent from the Notifications panel. It clears by itself.", "link": "view:notify-control",
                    "meta": {"notifyType": t["id"], "label": "Test", "test": True}})
    timer = threading.Timer(TEST_CLEAR_S, lambda: cx.resolve_alerts([key]))
    timer.daemon = True
    timer.start()
    return {"ok": True, "type": t["id"], "sent": [c for c, on in v["channels"].items() if on], "why": v["why"], "held": v["held"]}


@router.post("/reset")
async def reset(request: Request) -> dict[str, Any]:
    b = await body_of(request)
    if b.get("confirm") != "reset":
        raise HTTPException(400, 'send { confirm: "reset" } (and type, or everything goes back to its defaults)')
    with _lock:
        c = load_config()
        if b.get("type"):
            find(b["type"])
            c = {**c, "types": {k: v for k, v in c["types"].items() if k != b["type"]}}
        else:
            c = {**c, "master": True, "apps": {}, "types": {}}
        save_config(c)
    return state()
