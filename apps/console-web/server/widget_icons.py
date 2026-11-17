"""Widget icons REST (widget-icons@1, framework/spec/WIDGET-ICONS.md): /api/widget-icons.

Every banner and settings widget of an app with the icon it draws, how it is drawn, and the person's pick, read and
written without a browser. The picks are appearance settings (`axf.widget.<id>.icon` / `.mode`) in the app's own look
document on the hub (`shared/settings/looks/<app>.json`, `own.settings`), so an open console follows through the hub's
change feed and every device of the app gets them.

    GET    /api/widget-icons?app=&q=              every inventoried widget (+ every widget with a pick): icon, via, mode, pick
    GET    /api/widget-icons/glyphs?q=            the icons that can be picked (framework set)
    GET    /api/widget-icons/{id}?app=            one widget
    PUT    /api/widget-icons/{id}  {icon?, mode?, app?}   pick an icon (`<glyph>`, `<pack>/<glyph>`, `own`) and / or a mode
    DELETE /api/widget-icons/{id}?app=            back to its default icon and the long-text rule
    POST   /api/widget-icons/reset {app?}         every widget back to its default
    POST   /api/widget-icons/{id}/open {to?}      open the picker on that widget in the open console (console_dialog
                                                  axf.widget.icons with arg=<id>; needs the Console commands plugin)

The same resolution as the browser for what the server knows (the pick, else the inventory default); the live text and
the long-text rule are the console's (mode `auto` here means "the rule decides").
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

HERE = Path(__file__).resolve().parent
APP_DIR = HERE.parent
ROOT = APP_DIR.parent.parent
FRAME = "widget-icons@1"
DIALOG = "axf.widget.icons"
DEFAULT_APP = "axf-console"
MODES = ("icon", "icon+text", "text")
HOSTS = ("banner", "toolbar", "settings")
WIDGET_ID = re.compile(r"^([a-z0-9-]{1,40}):([a-z0-9-]{1,40}):([A-Za-z0-9._-]{1,80})$")
PACK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
GLYPH_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
APP_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
ALIASES = {"console": "axf-console", "console-web": "axf-console", "axhub": "axhub-web", "amberx": "amberx-droid"}
# = WIDGET_KIND_ICONS (core/engines/widget-icons.ts)
KIND_ICONS = {
    "status": "info", "counter": "chart", "progress": "chart", "action-button": "zap", "link": "external", "label": "type", "badge": "bell",
    "logo": "star", "avatar": "user", "clock": "clock", "search-bar": "search", "theme-switch": "sun", "tab": "folder", "group": "list", "setting": "sliders",
}
_lock = threading.Lock()


class WidgetIconError(Exception):
    def __init__(self, code: str, message: str, status: int = 400) -> None:
        super().__init__(message)
        self.code, self.message, self.status = code, message, status


def _first(*paths: Path) -> Path:
    return next((p for p in paths if p.exists()), paths[0])


def defaults_file() -> Path:
    return _first(ROOT / "framework/schemas/widget-icon-defaults.json", APP_DIR / "src/axf/schemas/widget-icon-defaults.json")


def icon_file() -> Path:
    return _first(ROOT / "framework/react/components/Icon.tsx", APP_DIR / "src/axf/react/components/Icon.tsx")


def looks_dir() -> Path:
    if os.environ.get("AXF_LOOKS_DIR"):
        return Path(os.environ["AXF_LOOKS_DIR"])
    shared = Path(os.environ.get("AXF_APPEARANCE_FILE") or "/projects/_shared/_data/settings/appearance.json")
    return shared.parent / "looks"


def inventory() -> dict[str, Any]:
    try:
        return json.loads(defaults_file().read_text())
    except (OSError, ValueError):
        return {"widgets": [], "rules": []}


def glyphs() -> list[str]:
    try:
        src = icon_file().read_text()
    except OSError:
        return []
    return sorted(set(re.findall(r"^  '?([a-z0-9-]+)'?: '", src, flags=re.M)))


def parse_id(raw: Any) -> tuple[str, str, str] | None:
    m = WIDGET_ID.match(raw) if isinstance(raw, str) else None
    return (m.group(1), m.group(2), m.group(3)) if m and m.group(1) in HOSTS else None


def parse_ref(raw: Any) -> tuple[str | None, str] | None:
    """= parseIconRef: `<glyph>`, `<pack>/<glyph>`, `pack:<pack>/<glyph>` → (pack, glyph)."""
    if not isinstance(raw, str):
        return None
    s = raw.strip()
    if s.startswith("pack:"):
        s = s[5:]
    if "/" not in s:
        return (None, s) if GLYPH_ID.match(s) else None
    pack, glyph = s.split("/", 1)
    return (pack, glyph) if PACK_ID.match(pack) and GLYPH_ID.match(glyph) else None


def app_of(raw: Any) -> str:
    a = ALIASES.get(str(raw or ""), str(raw or "")) or DEFAULT_APP
    if not APP_ID.match(a):
        raise WidgetIconError("bad_app", f'"{a}" is not an app id')
    return a


def _look_path(app: str) -> Path:
    return looks_dir() / f"{app}.json"


def read_look(app: str) -> dict[str, Any] | None:
    try:
        doc = json.loads(_look_path(app).read_text())
    except (OSError, ValueError):
        return None
    return doc if isinstance(doc, dict) else None


def picks_of(app: str) -> dict[str, Any]:
    doc = read_look(app) or {}
    own = doc.get("own") if isinstance(doc.get("own"), dict) else {}
    s = own.get("settings") if isinstance(own.get("settings"), dict) else {}
    return {k: v for k, v in s.items() if k.startswith("axf.widget.")}


def _write_settings(app: str, changes: dict[str, Any], by: str) -> None:
    """Merge `changes` (None = drop the key) into the look document's own.settings, atomically."""
    with _lock:
        doc = read_look(app)
        if doc is None:
            raise WidgetIconError("no_look", f'app "{app}" has no look document on the hub yet (node framework/cli/skins.mjs snapshot {app})', 404)
        own = doc.get("own") if isinstance(doc.get("own"), dict) else {}
        settings = dict(own.get("settings") or {})
        for k, v in changes.items():
            if v is None:
                settings.pop(k, None)
            else:
                settings[k] = v
        doc["own"] = {**own, "settings": settings}
        doc["updatedBy"] = f"widget-icons:{by}"[:80]
        doc["updatedAt"] = datetime.now(timezone.utc).isoformat()
        p = _look_path(app)
        tmp = p.with_suffix(f".{os.getpid()}.tmp")
        tmp.write_text(json.dumps(doc) + "\n")
        tmp.replace(p)


def default_icon(wid: str, rows: dict[str, dict[str, Any]], rules: list[dict[str, Any]]) -> str:
    if wid in rows:
        return str(rows[wid]["icon"])
    for r in rules:
        m = str(r.get("match", ""))
        if m.endswith("*") and wid.startswith(m[:-1]):
            return str(r["icon"])
    kind = (parse_id(wid) or ("", "", ""))[1]
    return KIND_ICONS.get(kind, "box")


def resolve(wid: str, picks: dict[str, Any], rows: dict[str, dict[str, Any]], rules: list[dict[str, Any]], known: set[str]) -> dict[str, Any]:
    pick = picks.get(f"axf.widget.{wid}.icon")
    mode = picks.get(f"axf.widget.{wid}.mode")
    fell: list[str] = []
    icon, via = default_icon(wid, rows, rules), "default"
    if pick not in (None, "", "own"):
        ref = parse_ref(pick)
        if ref is None:
            fell.append(f'icon "{pick}" is not an icon ref')
        elif ref[0] is None and ref[1] not in known:
            fell.append(f'icon "{pick}" is not a glyph of the framework')
        else:
            icon, via = (f"{ref[0]}/{ref[1]}" if ref[0] else ref[1]), "pick"
    if mode not in (None, "") and mode not in MODES:
        fell.append(f'mode "{mode}" is not one of {", ".join(MODES)}')
        mode = None
    row = rows.get(wid, {})
    return {
        "id": wid, "label": row.get("label", wid.split(":", 2)[2]), "owner": row.get("owner", ""), "icon": icon, "via": via,
        "mode": mode or "auto", "pick": pick if pick not in (None, "") else None, "default": default_icon(wid, rows, rules),
        "hadIcon": row.get("hadIcon"), "longText": row.get("longText"), "fell": fell,
        "keys": {"icon": f"axf.widget.{wid}.icon", "mode": f"axf.widget.{wid}.mode"},
        "open": {"dialog": DIALOG, "arg": wid, "action": f"widget.icons:{wid}"},
    }


def list_widgets(app: str = DEFAULT_APP, q: str = "") -> dict[str, Any]:
    app = app_of(app)
    inv = inventory()
    rows = {w["id"]: w for w in inv.get("widgets", [])}
    rules = list(inv.get("rules", []))
    picks = picks_of(app)
    known = set(glyphs())
    ids = list(rows)
    for k in picks:
        wid = k[len("axf.widget."):].rsplit(".", 1)[0]
        if parse_id(wid) and wid not in ids:
            ids.append(wid)
    out = [resolve(w, picks, rows, rules, known) for w in ids]
    if q:
        ql = q.lower()
        out = [w for w in out if ql in w["id"].lower() or ql in str(w["label"]).lower()]
    return {"$axf": FRAME, "ok": True, "app": app, "look": read_look(app) is not None, "widgets": out}


def get_widget(wid: str, app: str = DEFAULT_APP) -> dict[str, Any]:
    if not parse_id(wid):
        raise WidgetIconError("bad_widget", f'"{wid}" is not a widget id (<host>:<kind>:<id>, host one of {", ".join(HOSTS)})')
    app = app_of(app)
    inv = inventory()
    w = resolve(wid, picks_of(app), {x["id"]: x for x in inv.get("widgets", [])}, list(inv.get("rules", [])), set(glyphs()))
    return {"$axf": FRAME, "ok": True, "app": app, "widget": w}


def set_widget(wid: str, icon: Any = None, mode: Any = None, app: str = DEFAULT_APP, by: str = "api") -> dict[str, Any]:
    if not parse_id(wid):
        raise WidgetIconError("bad_widget", f'"{wid}" is not a widget id (<host>:<kind>:<id>, host one of {", ".join(HOSTS)})')
    if icon is None and mode is None:
        raise WidgetIconError("nothing_to_set", "give an icon, a mode or both")
    changes: dict[str, Any] = {}
    if icon is not None:
        if icon in ("", "own"):
            changes[f"axf.widget.{wid}.icon"] = None
        else:
            ref = parse_ref(icon)
            if ref is None:
                raise WidgetIconError("bad_icon", f'"{icon}" is not an icon ref (<glyph>, <pack>/<glyph> or own)')
            if ref[0] is None and ref[1] not in set(glyphs()):
                raise WidgetIconError("unknown_icon", f'no icon "{icon}" (GET /api/widget-icons/glyphs lists them)')
            changes[f"axf.widget.{wid}.icon"] = f"{ref[0]}/{ref[1]}" if ref[0] else ref[1]
    if mode is not None:
        if mode in ("", "auto"):
            changes[f"axf.widget.{wid}.mode"] = None
        elif mode in MODES:
            changes[f"axf.widget.{wid}.mode"] = mode
        else:
            raise WidgetIconError("bad_mode", f'mode must be one of auto, {", ".join(MODES)}')
    _write_settings(app_of(app), changes, by)
    return get_widget(wid, app)


def reset_widget(wid: str = "", app: str = DEFAULT_APP, by: str = "api") -> dict[str, Any]:
    app = app_of(app)
    if wid:
        if not parse_id(wid):
            raise WidgetIconError("bad_widget", f'"{wid}" is not a widget id')
        _write_settings(app, {f"axf.widget.{wid}.icon": None, f"axf.widget.{wid}.mode": None}, by)
        return get_widget(wid, app)
    _write_settings(app, {k: None for k in picks_of(app)}, by)
    return list_widgets(app)


def open_picker(wid: str, to: str = "recent", by: str = "api") -> dict[str, Any]:
    if wid and not parse_id(wid):
        raise WidgetIconError("bad_widget", f'"{wid}" is not a widget id')
    try:
        import plugin_services
        relay = plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001 — tests and servers without the console relay
        relay = None
    if relay is None:
        raise WidgetIconError("unavailable", "the Console commands plugin is off, so no console can be reached", 503)
    cmd = {"op": "act", "target": "console.dialogs", "path": DIALOG, "action": "open", "input": {"arg": wid, **({"to": to} if to and to != "recent" else {})}}
    return relay.run(cmd, by=by)


# ---------------------------------------------------------------------- voice (= src/actions/widget-icon-voice.ts)

MODE_WORDS = {"icon only": "icon", "an icon": "icon", "icon": "icon", "just an icon": "icon", "icon and text": "icon+text", "icon plus text": "icon+text",
              "icon with text": "icon+text", "text only": "text", "text": "text", "just text": "text", "automatic": "auto", "auto": "auto"}


def _clean(t: str) -> str:
    p = re.sub(r"[.!?,]", " ", str(t or "").lower())
    p = re.sub(r"\s+", " ", p).strip()
    p = re.sub(r"^(please|hey amber|amber)\s+", "", p)
    return re.sub(r"\s+please$", "", p).strip()


def _target(w: str) -> str:
    w = re.sub(r"^(?:the|my)\s+", "", w.strip())
    return re.sub(r"\s+(?:widget|tab|setting|chip|badge)$", "", w).strip()


def _glyph(w: str) -> str:
    w = re.sub(r"^(?:the|a|an)\s+", "", w.strip())
    return re.sub(r"\s+", "-", re.sub(r"\s+icon$", "", w))


def voice_intent(text: str) -> dict[str, Any] | None:
    """A phrase → {op: icon | mode | reset, widget: words, value?}, or None (not a widget-icon phrase)."""
    p = _clean(text)
    if re.match(r"^(?:reset|restore) (?:all|every)(?: the)? widget icons?$", p):
        return {"op": "reset", "widget": "*"}
    if m := re.match(r"^(?:reset|restore)(?: the)? (.+?)(?:'s)? icon(?: to (?:its )?default)?$", p):
        return {"op": "reset", "widget": _target(m.group(1))}
    if m := re.match(r"^(?:use|give|put)(?: the| a| an)? (.+?) icon (?:for|on|to)(?: the)? (.+)$", p):
        return {"op": "icon", "widget": _target(m.group(2)), "value": _glyph(m.group(1))}
    if m := re.match(r"^(?:set|change|make)(?: the)? (.+?)(?:'s)? icon (?:to|into)(?: the| a| an)? (.+)$", p):
        return {"op": "icon", "widget": _target(m.group(1)), "value": _glyph(m.group(2))}
    if (m := re.match(r"^show(?: the)? (.+?) as (.+)$", p)) and m.group(2) in MODE_WORDS:
        return {"op": "mode", "widget": _target(m.group(1)), "value": MODE_WORDS[m.group(2)]}
    return None


def find_widget(words: str, app: str = DEFAULT_APP) -> dict[str, Any] | None:
    if parse_id(words):
        return {"id": words, "label": words}
    rows = list_widgets(app)["widgets"]
    w = words.lower()
    dash = re.sub(r"\s+", "-", w)
    for test in (lambda x: str(x["label"]).lower() == w, lambda x: x["id"].split(":", 2)[2].lower() == dash, lambda x: str(x["label"]).lower().startswith(w),
                 lambda x: w in str(x["label"]).lower(), lambda x: dash in x["id"].lower()):
        hit = next((x for x in rows if test(x)), None)
        if hit:
            return hit
    return None


def voice(text: str, app: str = DEFAULT_APP, by: str = "voice") -> dict[str, Any] | None:
    """Run a widget-icon phrase. None = not one (the console-control grammar takes it)."""
    intent = voice_intent(text)
    if intent is None:
        return None
    base = {"$axf": FRAME, "heard": text, "intent": intent}
    try:
        if intent["op"] == "reset" and intent["widget"] == "*":
            reset_widget("", app, by)
            return {**base, "ok": True, "say": "Every widget icon is back to its default."}
        hit = find_widget(intent["widget"], app)
        if hit is None:
            return {**base, "ok": False, "code": "not_found", "say": f"I couldn't find a widget called {intent['widget']}."}
        if intent["op"] == "reset":
            reset_widget(hit["id"], app, by)
            return {**base, "ok": True, "widget": hit["id"], "say": f"{hit['label']} is back to its default icon."}
        if intent["op"] == "icon":
            set_widget(hit["id"], icon=intent["value"], app=app, by=by)
            return {**base, "ok": True, "widget": hit["id"], "say": f"{hit['label']} now uses the {intent['value']} icon."}
        set_widget(hit["id"], mode=intent["value"], app=app, by=by)
        shown = "icon and text" if intent["value"] == "icon+text" else intent["value"]
        return {**base, "ok": True, "widget": hit["id"], "say": f"{hit['label']} now shows as {shown}."}
    except WidgetIconError as e:
        return {**base, "ok": False, "code": e.code, "message": e.message, "say": e.message}


def router_for(auth: Any) -> APIRouter:
    from fastapi import Depends
    r = APIRouter(prefix="/api/widget-icons", dependencies=[Depends(auth)])

    def wrap(fn: Any, *a: Any, **k: Any) -> JSONResponse:
        try:
            return JSONResponse(fn(*a, **k))
        except WidgetIconError as e:
            return JSONResponse({"$axf": FRAME, "ok": False, "code": e.code, "message": e.message}, status_code=e.status)

    async def body(request: Request) -> dict[str, Any]:
        try:
            b = await request.json()
        except ValueError:
            return {}
        return b if isinstance(b, dict) else {}

    @r.get("")
    async def list_route(app: str = DEFAULT_APP, q: str = "") -> JSONResponse:
        return wrap(list_widgets, app, q)

    @r.get("/glyphs")
    async def glyphs_route(q: str = "") -> JSONResponse:
        g = [x for x in glyphs() if q.lower() in x]
        return JSONResponse({"$axf": FRAME, "ok": True, "glyphs": g, "refs": "<glyph> | <pack>/<glyph> | own"})

    @r.post("/reset")
    async def reset_all(request: Request) -> JSONResponse:
        b = await body(request)
        return wrap(reset_widget, "", str(b.get("app") or DEFAULT_APP), str(b.get("by") or "api"))

    @r.get("/{wid}")
    async def get_route(wid: str, app: str = DEFAULT_APP) -> JSONResponse:
        return wrap(get_widget, wid, app)

    @r.put("/{wid}")
    async def put_route(wid: str, request: Request) -> JSONResponse:
        b = await body(request)
        return wrap(set_widget, wid, b.get("icon"), b.get("mode"), str(b.get("app") or DEFAULT_APP), str(b.get("by") or "api"))

    @r.delete("/{wid}")
    async def delete_route(wid: str, app: str = DEFAULT_APP) -> JSONResponse:
        return wrap(reset_widget, wid, app)

    @r.post("/{wid}/open")
    async def open_route(wid: str, request: Request) -> JSONResponse:
        b = await body(request)
        return await run_in_threadpool(wrap, open_picker, wid, str(b.get("to") or "recent"), str(b.get("by") or "api"))

    return r
