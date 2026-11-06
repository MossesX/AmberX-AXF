"""The notification registry and its decisions (notify-registry@1). Pure: no FastAPI, no files except the registry reads.

A *type* is one kind of notification. `decide()` answers, for one type right now, which channels it may use and why.
The order is fixed: a type that can't be switched (`required`, `feed`) keeps its defaults, then the master switch and the
per-app switches, then the type's own switch and channels, then priority, then quiet hours. Guarded types (approvals
and veto: they are how Brett stops a call) ignore the master and app switches and are changed one by one by Brett only.
"""
from __future__ import annotations

import json
import re
from datetime import datetime
from pathlib import Path
from typing import Any, Iterable
from zoneinfo import ZoneInfo

PRIORITIES = ["low", "normal", "high", "urgent"]
ENFORCED = {
    "gate": "Checked by the console's alert hub",
    "browser": "Checked in the open console",
    "device": "Checked by the AmberX app",
    "required": "Android needs it, it can't be switched off",
    "feed": "Nothing to switch here",
    "elsewhere": "Switched where it lives",
    "discovered": "Seen on the alert hub, not in the registry yet",
}
OPT_IN = ("sound", "popup")
FIXED = ("required", "feed", "elsewhere")  # the panel shows these but can't change them
TIME_RE = re.compile(r"^([01]\d|2[0-3]):[0-5]\d$")
ID_RE = re.compile(r"^[a-z][a-z0-9.-]{0,63}$")


def read_registry(file: Path) -> dict[str, Any]:
    return json.loads(file.read_text())


def plugin_types(plugins_dir: Path) -> list[dict[str, Any]]:
    """Every plugin's own notify.json: a plugin brings its types and takes them along when it goes."""
    out: list[dict[str, Any]] = []
    for f in sorted(plugins_dir.glob("*/notify.json")):
        if f.parent.name.startswith("_"):
            continue
        try:
            doc = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        for t in doc.get("types") or []:
            if isinstance(t, dict):
                out.append({**t, "plugin": f.parent.name})
    return out


def plugin_banners(plugins_dir: Path) -> list[dict[str, Any]]:
    """Every banner a plugin puts on screen (plugin.json `banner`). They are status, not events: Settings → Banners owns them."""
    out: list[dict[str, Any]] = []
    for f in sorted(plugins_dir.glob("*/plugin.json")):
        try:
            doc = json.loads(f.read_text())
        except (OSError, ValueError):
            continue
        for b in doc.get("banner") or [] if isinstance(doc.get("banner"), list) else []:
            if isinstance(b, str):
                name = str(doc.get("name") or b) if b == f.parent.name else b.replace("-", " ").capitalize()
                out.append({"id": f"banner.{b}", "label": name if name.lower().endswith("banner") else f"{name} banner", "group": "banners",
                            "app": "console", "source": str(doc.get("name") or b), "description": "Show or hide it from its right-click menu.",
                            "enforced": "elsewhere", "only": ["banner"], "plugin": f.parent.name})
    return out


def normal(t: dict[str, Any], channels: list[str]) -> dict[str, Any]:
    """A registry entry with every field filled in. `only` limits the channels it can use; `channels` sets defaults."""
    only = t.get("only")
    allowed = [c for c in channels if only is None or c in only]
    # Sound and pop-up are new for alerts, so they start off; a type that only exists on one of them already rings there.
    start = {c: c not in OPT_IN or only is not None for c in allowed}
    defaults = {c: (t.get("channels") or {}).get(c, start[c]) is True for c in allowed}
    pri = t.get("priority") if t.get("priority") in PRIORITIES else "normal"
    return {**t, "enforced": t.get("enforced") or "gate", "allowed": allowed, "defaults": defaults, "priority": pri,
            "guarded": t.get("guarded") is True, "match": t.get("match") or None}


def build_types(reg: dict[str, Any], extra: Iterable[dict[str, Any]]) -> list[dict[str, Any]]:
    """Registry + plugin types + runtime registrations, ids unique (the first one stays), most specific match first."""
    channels = [c["id"] for c in reg["channels"]]
    seen: dict[str, dict[str, Any]] = {}
    for t in [*reg.get("types", []), *extra]:
        if isinstance(t.get("id"), str) and ID_RE.match(t["id"]) and t["id"] not in seen:
            seen[t["id"]] = normal(t, channels)
    return list(seen.values())


def classify(types: list[dict[str, Any]], source: str, key: str, forced: str = "") -> dict[str, Any] | None:
    """The type of an alert: the longest matching key prefix within its source, else the type that takes the whole source."""
    if forced:
        hit = next((t for t in types if t["id"] == forced), None)
        if hit:
            return hit
    best, length = None, -1
    for t in types:
        m = t["match"]
        if not m or m.get("source") != source:
            continue
        prefix = m.get("keyPrefix") or ""
        if key.startswith(prefix) and len(prefix) > length:
            best, length = t, len(prefix)
    return best


def discovered(source: str, channels: list[str]) -> dict[str, Any]:
    """A source nobody registered: behaves as it did before this panel, and shows up to be named."""
    safe = re.sub(r"[^a-z0-9-]+", "-", source.lower())[:40].strip("-") or "unknown"
    t = normal({"id": f"other.{safe}", "label": source or "Unknown", "group": "other", "app": "console", "source": "Alert hub",
                "description": f"Alerts from {source!r}: no notify.json names this source yet.", "enforced": "discovered",
                "match": {"source": source}}, channels)
    return {**t, "dynamic": True}


def effective(t: dict[str, Any], cfg: dict[str, Any], settings: dict[str, Any]) -> dict[str, Any]:
    """The type's own setting: {enabled, channels, priority}. A linked Claude setting is part of `enabled`."""
    o = (cfg.get("types") or {}).get(t["id"]) or {}
    linked = settings.get(t.get("setting") or "", True) is not False
    return {
        "enabled": o.get("enabled", True) is not False and linked,
        "channels": {c: (o.get("channels") or {}).get(c, t["defaults"][c]) is not False for c in t["allowed"]},
        "priority": o.get("priority") if o.get("priority") in PRIORITIES else t["priority"],
    }


def in_window(now: datetime, start: str, end: str) -> bool:
    """Is `now` between two HH:MM times? A window past midnight (22:00 to 07:00) works; equal times = never."""
    if not (TIME_RE.match(start or "") and TIME_RE.match(end or "")) or start == end:
        return False
    hhmm = now.strftime("%H:%M")
    return start <= hhmm < end if start < end else hhmm >= start or hhmm < end


def local_now(tz: str, at: float | None = None) -> datetime:
    return datetime.fromtimestamp(at, ZoneInfo(tz)) if at is not None else datetime.now(ZoneInfo(tz))


def decide(t: dict[str, Any], cfg: dict[str, Any], settings: dict[str, Any], quiet: bool, app_of: dict[str, str]) -> dict[str, Any]:
    """Which channels this type may use now. `why` is one plain line for the panel and the recent list."""
    eff = effective(t, cfg, settings)
    base = {"type": t["id"], "label": t["label"], "priority": eff["priority"]}
    if t["enforced"] in FIXED:
        return {**base, "allow": True, "channels": dict(t["defaults"]), "held": False, "why": ENFORCED[t["enforced"]]}
    none = {c: False for c in t["allowed"]}
    guarded = t["guarded"]
    if not guarded and cfg.get("master", True) is False:
        return {**base, "allow": False, "channels": none, "held": False, "why": "Master switch is off"}
    if not eff["enabled"]:
        off_by = "Off in Claude settings" if settings.get(t.get("setting") or "", True) is False else "Switched off"
        return {**base, "allow": False, "channels": none, "held": False, "why": off_by}
    apps = cfg.get("apps") or {}
    on = {c: v and (guarded or apps.get(app_of.get(c, ""), True) is not False) for c, v in eff["channels"].items()}
    if eff["priority"] == "low":  # low never interrupts: the banner only
        on = {c: v and c == "banner" for c, v in on.items()}
    held = bool(quiet and eff["priority"] != "urgent" and not guarded)
    if held:  # quiet hours hold everything that interrupts; the banner still counts it
        on = {c: v and c == "banner" for c, v in on.items()}
    used = [c for c, v in on.items() if v]
    why = "Held for quiet hours" if held else "Sending" if used else "No channel on"
    return {**base, "allow": bool(used), "channels": on, "held": held, "why": why}


def clean_patch(t: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """A panel change for one type, checked. Raises ValueError with a plain message."""
    if t["enforced"] in FIXED:
        raise ValueError(f"{t['label']} can't be changed here: {ENFORCED[t['enforced']]}")
    out: dict[str, Any] = {}
    if body.get("enabled") is not None:
        if not isinstance(body["enabled"], bool):
            raise ValueError("enabled must be true or false")
        out["enabled"] = body["enabled"]
    channels = dict(body["channels"]) if isinstance(body.get("channels"), dict) else {}
    if body.get("channel") is not None:
        channels[str(body["channel"])] = body.get("on") is not False
    for c, v in channels.items():
        if c not in t["allowed"]:
            raise ValueError(f"{t['label']} can't use the {c} channel (it can use: {', '.join(t['allowed']) or 'none'})")
        if not isinstance(v, bool):
            raise ValueError(f"{c} must be true or false")
    if channels:
        out["channels"] = channels
    if body.get("priority") is not None:
        if body["priority"] not in PRIORITIES:
            raise ValueError(f"priority must be one of {', '.join(PRIORITIES)}")
        out["priority"] = body["priority"]
    if not out:
        raise ValueError("nothing to change: send enabled, channel + on, channels or priority")
    return out


def merge(cfg: dict[str, Any], tid: str, patch: dict[str, Any]) -> dict[str, Any]:
    types = {**(cfg.get("types") or {})}
    old = types.get(tid) or {}
    new = {**old, **patch}
    if "channels" in patch:
        new["channels"] = {**(old.get("channels") or {}), **patch["channels"]}
    types[tid] = new
    return {**cfg, "types": types}
