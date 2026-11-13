"""Console control (console-control@1, framework/spec/CONSOLE-CONTROL.md): the server half.

One address names any piece of the console (a screen, a tab, a setting, a button, a plugin, a grid row, a build step,
a scroll pane) and ten verbs read or drive it. The open console answers from its live target registry; this module
knows the console's static inventory (src/control/inventory.json, written by scripts/control-inventory.mjs) so it can
list, search and check addresses while no console is open.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
APP = HERE.parent
INVENTORY_FILE = APP / "src" / "control" / "inventory.json"
FRAME = "console-control@1"
TARGETS_FRAME = "console-control-targets@1"

_inventory: dict[str, Any] | None = None
_inventory_mtime = 0.0


def inventory() -> dict[str, Any]:
    """The static inventory (re-read when the file changes)."""
    global _inventory, _inventory_mtime
    try:
        m = INVENTORY_FILE.stat().st_mtime
    except OSError:
        return {"$axf": "console-control-inventory@1", "views": [], "nav": [], "tabGroups": [], "settings": [], "functions": [], "plugins": []}
    if _inventory is None or m != _inventory_mtime:
        _inventory = json.loads(INVENTORY_FILE.read_text(encoding="utf-8"))
        _inventory_mtime = m
    return _inventory


def _target(address: str, kind: str, label: str, **more: Any) -> dict[str, Any]:
    t: dict[str, Any] = {"address": address, "kind": kind, "label": label}
    t.update({k: v for k, v in more.items() if v not in (None, "", [], {})})
    if "/" in address and "parent" not in t:
        t["parent"] = address.rsplit("/", 1)[0]
    return t


def static_targets() -> list[dict[str, Any]]:
    """Every target the inventory knows, as console-control-targets@1 items (virtual: not rendered)."""
    inv = inventory()
    views = {v["id"]: v["label"] for v in inv.get("views", [])}
    out: list[dict[str, Any]] = []
    for v in inv.get("views", []):
        out.append(_target(v["address"], "view", v["label"], icon=v.get("icon"), keywords=v.get("keywords"), detail="Page" + (f" · {v['nav']}" if v.get("nav") else ""), virtual=True))
    for g in inv.get("tabGroups", []):
        if not g.get("address"):
            continue
        where = views.get(g.get("view") or "", "Console")
        out.append(_target(g["address"], "tab", f"{where} tabs", detail="Tab row", keywords=[g.get("id")], virtual=True,
                           tabs=[{"value": t["value"], "label": t["label"]} for t in g.get("tabs", [])]))
        for t in g.get("tabs", []):
            if t.get("address"):
                out.append(_target(t["address"], "tab", t["label"], detail=f"Tab · {where}", keywords=[t["value"], where], virtual=True))
    for key in ("settings", "functions", "buttons", "plugins"):
        for t in inv.get(key, []) or []:
            if isinstance(t, dict) and t.get("address"):
                out.append({**t, "virtual": True})
    return out


def view_of(address: str) -> str | None:
    """The view an address lives in (its leading `view:` segment, or the tab row's view), else None."""
    m = re.match(r"^view:([^/]+)", address or "")
    if m:
        return m.group(1).replace("%2F", "/").replace("%25", "%")
    for g in inventory().get("tabGroups", []):
        a = g.get("address")
        if a and (address == a or address.startswith(a + "=") or address.startswith(a + "/")):
            return g.get("view")
    return None


# ---------------------------------------------------------------------- search (no console open)

KIND_LABELS = {"view": "Page", "tab": "Tab", "subtab": "Tab", "setting": "Setting", "button": "Button", "function": "Action", "plugin": "Plugin",
               "grid": "Grid", "row": "Row", "step": "Step", "panel": "Panel", "scroll": "Pane"}
# same boosts as src/control/search.ts (the inventory source; kinds rank places before things)
KIND_BOOST = {"view": 6, "tab": 4, "subtab": 3, "setting": 3, "plugin": 3, "row": 2, "step": 2, "panel": 1}
SEARCH_DEFAULT_LIMIT = 20
SEARCH_MAX_LIMIT = 200


def _norm(s: str) -> str:
    import unicodedata
    return "".join(c for c in unicodedata.normalize("NFKD", (s or "").lower()) if not unicodedata.combining(c))


def score_entry(label: str, detail: str | None, keywords: list[str] | None, kind: str, query: str) -> float:
    """Port of core/engines/search.ts scoreEntry: every word must match; label hits rank highest. 0 = no match."""
    words = [w for w in _norm(query).split() if w]
    if not words:
        return 0.0
    lab = _norm(label)
    rest = _norm(" ".join([detail or "", *[str(k) for k in (keywords or []) if k], KIND_LABELS.get(kind, kind)]))
    full = _norm(query).strip()
    score = 0.0
    for w in words:
        if lab == w:
            s = 100
        elif lab.startswith(w):
            s = 60
        elif re.search(r"(^|[^a-z0-9])" + re.escape(w), lab):
            s = 40
        elif w in lab:
            s = 25
        elif w in rest:
            s = 10
        else:
            return 0.0
        score += s
    if len(words) > 1 and full in lab:
        score += 30
    return score - min(len(lab), 60) / 60


def _address_ids(address: str) -> list[str]:
    return [re.sub(r"[-_.=]", " ", seg.split(":", 1)[1]) for seg in (address or "").split("/") if ":" in seg]


def search(q: str, kinds: list[str] | None = None, limit: int | None = None, targets: list[dict[str, Any]] | None = None) -> list[dict[str, Any]]:
    """Rank the static inventory (or the given targets) for words; each hit carries its address. Raises invalid on no words."""
    q = str(q or "").strip()
    if not q:
        raise ControlError("invalid", "search needs words (query.q)", field="query.q")
    lim = max(1, min(int(limit or SEARCH_DEFAULT_LIMIT), SEARCH_MAX_LIMIT))
    pool = targets if targets is not None else static_targets() + [
        _target(t["address"], "subtab" if "/subtab:" in t["address"] else "tab", t.get("label") or t.get("id"), detail="Settings", keywords=[t.get("id"), "settings"], virtual=True)
        for t in inventory().get("settingsTabs", []) or [] if t.get("address")]
    best: dict[str, dict[str, Any]] = {}
    for t in pool:
        kind = t.get("kind", "")
        if kinds and kind not in kinds:
            continue
        s = score_entry(t.get("label", ""), t.get("detail"), [*(t.get("keywords") or []), *(t.get("aliases") or []), *_address_ids(t["address"])], kind, q)
        if s <= 0:
            continue
        hit = {"address": t["address"], "kind": kind, "label": t.get("label", ""), "score": round(s + KIND_BOOST.get(kind, 0), 3), "source": "inventory"}
        for k in ("detail", "icon"):
            if t.get(k):
                hit[k] = t[k]
        if t["address"] not in best or hit["score"] > best[t["address"]]["score"]:
            best[t["address"]] = hit
    return sorted(best.values(), key=lambda h: (-h["score"], h["label"], h["address"]))[:lim]


# ---------------------------------------------------------------------- answers

STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "ambiguous": 409, "confirmation_required": 409,
          "unavailable": 503, "not_implemented": 501, "unexpected": 500}


class ControlError(Exception):
    """A console-control failure with its wire code (CONSOLE-CONTROL.md → Answers)."""

    def __init__(self, code: str, message: str, **extra: Any) -> None:
        super().__init__(message)
        self.code, self.message, self.extra = code, message, extra

    def envelope(self) -> dict[str, Any]:
        return {"$axf": FRAME, "ok": False, "code": self.code, "message": self.message, **self.extra}


def ok(verb: str, address: str | None = None, **data: Any) -> dict[str, Any]:
    return {"$axf": FRAME, "ok": True, "verb": verb, **({"address": address} if address else {}), **{k: v for k, v in data.items() if v is not None}}


# ---------------------------------------------------------------------- settings

TRUE_WORDS = {"on", "true", "yes", "1", "enable", "enabled"}
FALSE_WORDS = {"off", "false", "no", "0", "disable", "disabled"}


def setting_spec(address_or_key: str) -> dict[str, Any] | None:
    """A setting from the inventory by full address, short `setting:<key>` form or bare key."""
    a = address_or_key or ""
    key = a.rsplit("setting:", 1)[-1] if "setting:" in a else a
    key = key.replace("%2F", "/").replace("%25", "%")
    for s in inventory().get("settings", []) or []:
        if s.get("address") == a or s.get("key") == key:
            return s
    return None


def validate_setting(spec: dict[str, Any], value: Any, current: Any = None) -> Any:
    """The value a setting accepts (type, range and choice checked), else ControlError(validation). Mirrors the console's
    consoleFieldValue so a REST / MCP / CLI set fails the same way as a set in the open console."""
    kind = str(spec.get("type") or "text")
    label = spec.get("label") or spec.get("key")
    if kind in ("secret",):
        raise ControlError("validation", f"{label} is a secret: it is never set from a command", problems=["secret"])
    if kind in ("action", "link", "section", "custom", "asset_slot"):
        raise ControlError("not_implemented", f"{label} is not a value (press it instead)", can=["open", "state", "focus"])
    if kind == "toggle":
        if isinstance(value, bool):
            return value
        w = str(value).strip().lower()
        if w == "toggle":
            return not bool(current)
        if w in TRUE_WORDS:
            return True
        if w in FALSE_WORDS:
            return False
        raise ControlError("validation", f"{label} is on or off, not {value!r}", problems=["not a toggle value"])
    if kind in ("number", "slider"):
        try:
            n = float(value)
        except (TypeError, ValueError):
            raise ControlError("validation", f"{label} takes a number, not {value!r}", problems=["not a number"]) from None
        lo, hi = spec.get("min"), spec.get("max")
        if lo is not None and n < lo or hi is not None and n > hi:
            raise ControlError("validation", f"{label} must be between {lo if lo is not None else '-∞'} and {hi if hi is not None else '∞'}, not {value}", problems=["out of range"])
        return int(n) if n == int(n) else n
    if kind == "choice":
        opts = spec.get("options") or []
        v = str(value).strip()
        hit = next((o for o in opts if o.lower() == v.lower()), None)
        if opts and hit is None:
            raise ControlError("validation", f"{label} is one of {', '.join(opts)}, not {value!r}", problems=["not a choice"])
        return hit or v
    if kind == "multi_choice":
        items = value if isinstance(value, list) else [x.strip() for x in str(value).split(",") if x.strip()]
        opts = spec.get("options") or []
        bad = [x for x in items if opts and x not in opts]
        if bad:
            raise ControlError("validation", f"{label}: {', '.join(bad)} is not a choice ({', '.join(opts)})", problems=["not a choice"])
        return items
    if kind == "time":
        v = str(value).strip()
        if not re.match(r"^([01]?\d|2[0-3]):[0-5]\d$", v):
            raise ControlError("validation", f"{label} is a time like 21:30, not {value!r}", problems=["not a time"])
        return v
    return "" if value is None else str(value)


def refuse_person_only(spec: dict[str, Any], value: Any = None, current: Any = None) -> None:
    """Owner-only settings change only from Brett's own click: never a command (CONTROL.md personOnly)."""
    label = spec.get("label") or spec.get("key")
    if spec.get("locked"):
        raise ControlError("unavailable", f"{label} is locked: nobody changes it", because="locked")
    if spec.get("personOnly"):
        raise ControlError("denied", f"{label} is owner-only: only Brett's own click in the console changes it", requires="person", personOnly=True)
    if spec.get("ownerRaise") and current is not None and value is not None:
        try:
            raising = (value is True and current is False) or float(value) > float(current)
        except (TypeError, ValueError):
            raising = False
        if raising:
            raise ControlError("denied", f"{label} can only be lowered from a command; only Brett raises it", requires="person", personOnly=True)


def _service(name: str) -> Any:
    try:
        import plugin_services  # the console's capability registry
        return plugin_services.get(name)
    except Exception:  # noqa: BLE001 — tests run without the console
        return None


def server_setting_value(spec: dict[str, Any]) -> Any:
    svc = _service(str(spec.get("service") or ""))
    if svc is None:
        raise ControlError("unavailable", f"{spec.get('label')} lives in a plugin that is turned off", because="plugin off")
    view = svc.get() or {}
    for s in view.get("settings") or []:
        if s.get("key") == spec.get("key"):
            return s.get("value")
    return (view.get("values") or {}).get(spec.get("key"))


def setting_state(spec: dict[str, Any]) -> dict[str, Any]:
    st: dict[str, Any] = {"address": spec["address"], "kind": "setting", "label": spec.get("label"), "type": spec.get("type"),
                          **{k: spec[k] for k in ("options", "min", "max", "personOnly", "ownerRaise", "locked", "requires") if k in spec}}
    if spec.get("runs") == "server":
        st["value"] = server_setting_value(spec)
        st["can"] = ["open", "state", "focus"] + ([] if spec.get("personOnly") or spec.get("locked") else ["set"])
    return st


def set_server_setting(spec: dict[str, Any], value: Any, by: str) -> dict[str, Any]:
    """Change a server-side setting without a browser (the plugin's own service applies its rules too)."""
    refuse_person_only(spec, value)  # owner-only and locked refuse before anything is read
    current = server_setting_value(spec)
    refuse_person_only(spec, value, current)
    v = validate_setting(spec, value, current)
    refuse_person_only(spec, v, current)
    svc = _service(str(spec.get("service")))
    r = svc.set({spec["key"]: v}, by or "console-control")
    if not r.get("ok", True):
        raise ControlError(str(r.get("code") or "denied"), str(r.get("message") or "refused"))
    return ok("set", spec["address"], changed=[spec["address"]], value=v)


# ---------------------------------------------------------------------- functions and buttons

DESTRUCTIVE_RE = re.compile(r"(^|[.:_-])(delete|remove|purge|wipe|reset|uninstall|drop|clear|discard|revoke|destroy|erase|kill|force-?push|hard-?delete)([.:_-]|$)", re.I)
DECIDING_RE = re.compile(r"(^|[.:_-])(approve|deny|reject|veto|shelve|decide|sign-?off)([.:_-]|$)", re.I)


def press_spec(address: str) -> dict[str, Any] | None:
    """A function or button from the inventory by full or short address (`function:x`, `button:y`, or a bare action id)."""
    a = (address or "").strip()
    leaf = a.rsplit("/", 1)[-1]
    for key in ("functions", "buttons"):
        for t in inventory().get(key, []) or []:
            if t.get("address") in (a, leaf) or t.get("id") == a:
                return t
    if leaf.startswith("function:"):
        fid = leaf[9:]
        return {"address": leaf, "kind": "function", "id": fid, "label": fid, "destructive": bool(DESTRUCTIVE_RE.search(fid)), "personOnly": bool(DECIDING_RE.search(fid)), "derived": True}
    return None


def check_press(spec: dict[str, Any] | None, address: str, confirm: Any) -> None:
    """Deciding actions are Brett's own tap; destructive ones need `confirm` (the same rule the open console applies)."""
    leaf = (address or "").rsplit("/", 1)[-1]
    word = leaf.split(":", 1)[-1]
    person = bool(spec and spec.get("personOnly")) or bool(DECIDING_RE.search(word))
    destructive = bool(spec and spec.get("destructive")) or bool(DESTRUCTIVE_RE.search(word))
    label = (spec or {}).get("label") or word
    if person:
        raise ControlError("denied", f"{label} is a decision only Brett makes with his own tap", requires="person", personOnly=True)
    if destructive and not confirm:
        raise ControlError("confirmation_required", f"{label} deletes or resets something: send it again with confirm", confirm="required")


# ---------------------------------------------------------------------- plugins

def _ctx() -> Any:
    try:
        import console_context  # the console's core context (plugin table, enable / disable)
        return console_context
    except Exception:  # noqa: BLE001
        return None


def plugin_spec(ref: str) -> dict[str, Any] | None:
    """A plugin by address (`plugin:<id>`), manifest id, short id, folder or name (case-insensitive)."""
    r = (ref or "").strip()
    r = r.rsplit("/", 1)[-1]
    r = r[7:] if r.startswith("plugin:") else r
    low = r.lower()
    for p in inventory().get("plugins", []) or []:
        if p.get("id") == r or low == str(p.get("id", "")).lower() or low in [a.lower() for a in p.get("aliases") or []]:
            return p
    return None


def plugin_enabled(p: dict[str, Any], is_enabled: Any = None) -> bool:
    fn = is_enabled or getattr(_ctx(), "plugin_enabled", None)
    if fn is None:
        return p.get("enabledByDefault") is not False
    try:
        return bool(fn(p["folder"]))
    except Exception:  # noqa: BLE001
        return p.get("enabledByDefault") is not False


def _services_of(p: dict[str, Any]) -> set[str]:
    return {s[8:] for s in p.get("provides") or [] if s.startswith("service:")}


def plugin_dependents(p: dict[str, Any], is_enabled: Any = None) -> list[dict[str, Any]]:
    """Who needs this plugin: every other plugin that requires (or optionally uses) a service it provides or the plugin
    itself (the same rule as the plugin inventory engine's dependents_of)."""
    mine = _services_of(p)
    out: list[dict[str, Any]] = []
    for other in inventory().get("plugins", []) or []:
        if other.get("id") == p.get("id"):
            continue
        for required, entries in ((True, other.get("requires") or []), (False, other.get("optional") or [])):
            for e in entries:
                svc = e[8:] if e.startswith("service:") else None
                hit = svc if svc and svc in mine else (e if e == f"plugin:{p['id']}" else None)
                if hit and not any(d["plugin"] == other["id"] and d["service"] == hit for d in out):
                    out.append({"plugin": other["id"], "address": other["address"], "name": other["label"], "service": hit, "required": required, "enabled": plugin_enabled(other, is_enabled)})
    return out


def plugin_needs(p: dict[str, Any], is_enabled: Any = None) -> list[dict[str, Any]]:
    """What this plugin needs that is off right now (a required service no enabled plugin provides)."""
    out = []
    plugins = inventory().get("plugins", []) or []
    for e in p.get("requires") or []:
        if not e.startswith("service:"):
            continue
        svc = e[8:]
        providers = [x for x in plugins if svc in _services_of(x)]
        if providers and not any(plugin_enabled(x, is_enabled) for x in providers):
            out.append({"service": svc, "providers": [x["address"] for x in providers]})
    return out


def plugin_state(p: dict[str, Any], is_enabled: Any = None) -> dict[str, Any]:
    deps = plugin_dependents(p, is_enabled)
    return {"address": p["address"], "kind": "plugin", "label": p["label"], "id": p["id"], "version": p.get("version"), "enabled": plugin_enabled(p, is_enabled),
            **({"core": True} if p.get("core") else {}), **({"view": p["view"]} if p.get("view") else {}), **({"settingsTab": p["settingsTab"]} if p.get("settingsTab") else {}),
            "neededBy": [d for d in deps if d["required"]], "usedBy": [d for d in deps if not d["required"]], "needsOff": plugin_needs(p, is_enabled),
            "can": ["open", "state", "focus", "plugin.enable", "plugin.disable"]}


def toggle_plugin(ref: str, enabled: bool, by: str = "", force: bool = False, is_enabled: Any = None, set_enabled: Any = None) -> dict[str, Any]:
    """plugin.enable / plugin.disable without a browser. A core plugin, or one an enabled plugin requires, refuses to
    turn off (invalid, naming why); the answer reports the dependency effects either way."""
    verb = "plugin.enable" if enabled else "plugin.disable"
    p = plugin_spec(ref)
    if p is None:
        near = [x["address"] for x in inventory().get("plugins", []) if (ref or "").lower().split(":")[-1][:4] in x["label"].lower()][:5]
        raise ControlError("not_found", f"no plugin {ref}", nearest=near)
    deps = plugin_dependents(p, is_enabled)
    needed_by = [d for d in deps if d["required"] and d["enabled"]]
    if not enabled:
        if p.get("core"):
            raise ControlError("invalid", f"{p['label']} is a core plugin: the console needs it, so it can't be turned off", field="address", reason="core")
        if needed_by and not force:
            raise ControlError("invalid", f"{p['label']} can't be turned off: {', '.join(d['name'] for d in needed_by)} need{'s' if len(needed_by) == 1 else ''} it (turn {'that' if len(needed_by) == 1 else 'those'} off first, or send force)",
                               field="address", reason="needed", neededBy=needed_by)
    setter = set_enabled or getattr(_ctx(), "set_plugin_enabled", None)
    if setter is None:
        raise ControlError("unavailable", "the console server isn't running here", because="no server")
    was = plugin_enabled(p, is_enabled)
    setter(p["folder"], enabled)
    effects: dict[str, Any] = {}
    if not enabled:
        effects["stopsWorking"] = needed_by
        effects["loses"] = [d for d in deps if not d["required"] and d["enabled"]]
    else:
        effects["needsOff"] = plugin_needs(p, is_enabled)
        effects["nowWorks"] = [d for d in deps if d["required"] and d["enabled"]]
    return ok(verb, p["address"], plugin=p["id"], enabled=enabled, changed=[p["address"]] if was != enabled else [], effects=effects,
              reload="the open console reloads its plugin list" if was != enabled else None, **({"by": by} if by else {}))


# ---------------------------------------------------------------------- voice (twin of core/engines/console-control-voice.mjs)

VOICE_NUMBERS = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10, "eleven": 11, "twelve": 12, "thirteen": 13,
                 "fourteen": 14, "fifteen": 15, "sixteen": 16, "seventeen": 17, "eighteen": 18, "nineteen": 19, "twenty": 20, "first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5}
VOICE_AMOUNTS = {"a bit": 0.25, "a little": 0.25, "a little bit": 0.25, "a lot": 2, "a page": 1, "one page": 1, "half a page": 0.5}
_GO = r"(?:open|go to|show(?: me)?|take me to|switch to)"


def clean_phrase(text: Any) -> str:
    p = str(text or "").lower()
    p = re.sub(r"(?<!\d)\.|\.(?!\d)", " ", p)
    p = re.sub(r"[“”\"'’,!?;:]+", " ", p)
    p = re.sub(r"^\s*(hey |ok |okay )?(amber|amberx)\b[\s,]*", " ", p)
    p = re.sub(r"\b(please|can you|could you|would you|for me|now)\b", " ", p)
    return re.sub(r"\s+", " ", p).strip()


def _strip(s: str) -> str:
    s = re.sub(r"^(the|a|an|my)\s+", "", s)
    return re.sub(r"\s+(screen|page|view)$", "", s).strip()


def _slug(s: str) -> str:
    """A glyph name from spoken words: "check circle" → check-circle (twin of slug in console-control-voice.mjs)."""
    return re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9]+", "-", _strip(s).lower()))


def _num(w: str) -> int | None:
    return int(w) if w.isdigit() else VOICE_NUMBERS.get(w)


def voice_intent(text: Any) -> dict[str, Any] | None:
    """A phrase → an intent (same shape and rules as voiceIntent in console-control-voice.mjs), or None."""
    p = clean_phrase(text)
    if not p:
        return None
    if m := re.match(r"^(?:scroll|go|jump)(?: all the way)?(?: to)?(?: the)? (top|bottom|start|end)(?: of(?: the)? (?:page|list|screen))?$", p):
        return {"verb": "scroll", "scroll": {"dir": "top" if m.group(1) in ("top", "start") else "bottom"}}
    if m := re.match(r"^page (up|down)$", p):
        return {"verb": "scroll", "scroll": {"dir": f"page-{m.group(1)}"}}
    if m := re.match(r"^scroll (up|down)(?: (a bit|a little bit|a little|a lot|a page|one page|half a page|(\d+|\w+) pages?))?$", p):
        amount = (VOICE_AMOUNTS.get(m.group(2)) or (_num(m.group(3)) if m.group(3) else None)) if m.group(2) else None
        return {"verb": "scroll", "scroll": {"dir": m.group(1), **({"amount": amount} if amount else {})}}
    if m := re.match(r"^(?:find|search for|search|look for|look up)\s+(.+)$", p):
        return {"verb": "search", "query": {"q": _strip(m.group(1))}}
    if m := re.match(r"^(?:show (?:me )?|open |go to |focus (?:on )?)?(?:the )?(?:step (\w+)|(\w+) step) of (?:the )?(?:build )?(.+?)(?: build)?$", p):
        n = _num(m.group(1) or m.group(2) or "")
        if n is not None:
            return {"verb": "focus", "find": {"q": _strip(m.group(3)), "kinds": ["row"]}, "step": n, "options": {"expand": True}}
    if m := re.match(r"^(enable|disable|turn on|turn off|switch on|switch off)(?: the)? (?:plugin (.+)|(.+?) plugin)$", p):
        on = bool(re.search(r"enable|on", m.group(1)))
        return {"verb": "plugin.enable" if on else "plugin.disable", "find": {"q": _strip(m.group(2) or m.group(3)), "kinds": ["plugin"]}}
    if m := re.match(r"^(?:turn|switch)(?: the)? (.+?) plugin (on|off)$", p):
        return {"verb": "plugin.enable" if m.group(2) == "on" else "plugin.disable", "find": {"q": _strip(m.group(1)), "kinds": ["plugin"]}}
    # icon packs (icon-map@1, the Icon map plugin's actions; twin of the rules in console-control-voice.mjs, before the generic set rule)
    if re.match(r"^(?:restore|undo|bring back)(?: the)? (?:previous |last |old )?(?:icon pack|icons|icon set)(?: change)?(?: from (?:axhub|the hub))?$", p):
        return {"verb": "press", "address": "function:icon-map.pack.restore", "value": "hub" if re.search(r"from (?:axhub|the hub)$", p) else "previous"}
    if m := re.match(r"^(?:share|publish)(?: the)? (.+?) (?:icon pack|icons|icon set)(?: on (?:axhub|the hub))?$", p):
        return {"verb": "press", "address": "function:icon-map.pack.share", "value": _slug(m.group(1))}
    if (m := re.match(r"^(?:export|download|save)(?: the)? (.+?) (?:icon pack|icon set)$", p)) and not m.group(1).endswith("template"):
        return {"verb": "press", "address": "function:icon-map.pack.export", "value": _slug(m.group(1))}
    if re.match(r"^(?:download|get|make|give me)(?: the| an| a)? icon (?:pack )?template$", p):
        return {"verb": "press", "address": "function:icon-map.template"}
    if re.match(r"^(?:(?:switch|go|change|set) )?(?:back )?(?:to |use )?(?:the )?(?:default|original|normal|branding|standard|framework) (?:icon pack|icons|icon set)$", p) or re.match(r"^(?:reset|clear|drop) (?:the )?(?:icon pack|icons|icon set)$", p):
        return {"verb": "press", "address": "function:icon-map.pack.clear"}
    m = re.match(r"^(?:switch to|use|apply|turn on|put on|go to|change to|set)(?: the)? (.+?) (?:icon pack|icons|icon set)$", p) or re.match(r"^set (?:the )?icon pack (?:to|at) (.+)$", p) or re.match(r"^(?:switch|change) (?:the )?icon pack to (.+)$", p)
    if m:
        return {"verb": "press", "address": "function:icon-map.pack.use", "value": _strip(m.group(1))}
    if m := re.match(r"^(?:change|set|make|switch) (?:the )?(.+?) icon (?:to|into|draw) (?:the |a |an )?(.+?)(?: icon| glyph)?$", p):
        return {"verb": "press", "address": "function:icon-map.slot.set", "value": f"{_strip(m.group(1))}:{_slug(m.group(2))}"}
    if m := re.match(r"^set (?:the )?(.+?) (?:to|at) (.+)$", p):
        return {"verb": "set", "find": {"q": _strip(m.group(1)), "kinds": ["setting"]}, "value": m.group(2).strip()}
    if m := re.match(r"^(?:turn|switch) (?:the )?(.+?) (on|off)$", p):
        return {"verb": "set", "find": {"q": _strip(m.group(1)), "kinds": ["setting"]}, "value": m.group(2) == "on"}
    if m := re.match(r"^(?:press|click|tap|hit|push)(?: on)?(?: the)? (.+?)(?: button)?$", p):
        return {"verb": "press", "find": {"q": _strip(m.group(1)), "kinds": ["button", "function"]}}
    if m := re.match(rf"^{_GO}(?: the)? (.+?) settings?$", p):
        return {"verb": "open", "find": {"q": _strip(m.group(1)), "kinds": ["tab", "subtab"]}, "within": "view:settings"}
    if m := re.match(rf"^{_GO}(?: the)? (.+?) tab$", p):
        return {"verb": "open", "find": {"q": _strip(m.group(1)), "kinds": ["tab", "subtab"]}}
    if re.match(r"^(?:open |go to |show(?: me)? |take me to )?(?:the )?settings$", p):
        return {"verb": "open", "address": "view:settings"}
    if m := re.match(r"^(?:open|go to|show(?: me)?|take me to|switch to|bring up)(?: the)? (.+)$", p):
        return {"verb": "open", "find": {"q": _strip(m.group(1)), "kinds": ["view", "tab", "subtab", "plugin"]}}
    return None


def intent_command(intent: dict[str, Any], hit: str | None = None) -> dict[str, Any]:
    cmd: dict[str, Any] = {"verb": intent["verb"]}
    if intent["verb"] == "search":
        cmd["query"] = intent["query"]
    elif intent["verb"] == "scroll":
        cmd["scroll"] = intent["scroll"]
    else:
        base = intent.get("address") or hit or ""
        cmd["address"] = f"{base}/step:s{intent['step']}" if base and intent.get("step") is not None else base
    if "value" in intent:
        cmd["value"] = intent["value"]
    if intent.get("options"):
        cmd["options"] = intent["options"]
    return cmd


def voice_reply(intent: dict[str, Any], answer: dict[str, Any] | None, label: str = "") -> str:
    """What to say back (same lines as voiceReply)."""
    if not answer or answer.get("ok") is False:
        if (answer or {}).get("code") == "confirmation_required":
            return "That deletes something. Say it again with confirm, or do it on screen."
        if (answer or {}).get("code") == "unavailable" and (answer or {}).get("openUrl"):
            return "No console is open. Open it and ask again."
        return f"Couldn't: {(answer or {}).get('message') or 'that did not work'}"
    what = label or answer.get("address") or ""
    v = intent["verb"]
    if v == "scroll":
        s = answer.get("scroll") or (answer.get("state") or {}).get("scroll")
        if not s:
            return "Scrolled."
        return "At the bottom." if s.get("atBottom") else "At the top." if s.get("atTop") else f"Scrolled, {round((s.get('fraction') or 0) * 100)} percent down."
    if v == "search":
        hits = answer.get("hits") or []
        return f"{len(hits)} result{'' if len(hits) == 1 else 's'}. Top: {hits[0]['label']}." if hits else "Nothing found."
    if v == "open":
        return f"Opened {what}."
    if v == "focus":
        return f"Showing {what}."
    if v == "press":
        return f"Pressed {what}."
    if v == "set":
        val = answer.get("value", intent.get("value"))
        return f"Set {what} to {('on' if val else 'off') if isinstance(val, bool) else val}."
    if v == "plugin.enable":
        return f"{what} is on."
    if v == "plugin.disable":
        loses = (answer.get("effects") or {}).get("loses") or []
        return f"{what} is off." + (f" {', '.join(d['name'] for d in loses)} lose{'s' if len(loses) == 1 else ''} a feature." if loses else "")
    return "Done."
