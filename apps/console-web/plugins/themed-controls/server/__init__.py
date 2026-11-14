"""Server part of the Themed controls plugin (themed-controls@1, framework/spec/THEMED-CONTROLS.md → API).

Mounted at /api/plugins/themed-controls/. Every route needs the console token and answers 404 while the plugin is off
(the console adds both). Plugin commands (plugin-commands@1) put the same routes on REST /api/control/themed-controls/*,
MCP themed-controls_* and the CLI `axf themed-controls <command>`; voice reaches them through the console actions the web
part registers (themed-controls.toggle, themed-controls.family:<f>:on|off, …) and the settings they change.

The switches are the console's own settings (axf.themedControls.*). This server keeps the desired values in its data
folder (settings.json, with a revision number) so they can be read and changed with no console open: a change is pushed
to the open console at once through console-control (when a console is open) and picked up by every console the next
time it asks (the web part reads /state on start, on focus and every half minute). The open console reports what it has
themed and what is open (live.json) through POST /report, so /state answers "what is on the page" too.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

FOLDER = "themed-controls"
ROOT = Path(__file__).resolve().parents[5]

# The family list and keys mirror framework/core/engines/themed-controls(-rules) (THEMED_FAMILIES, TC_KEYS).
FAMILIES = ("checkbox", "radio", "range", "number", "datetime", "color", "dialogs", "file", "tooltip", "scrollbar")
KEY_ON = "axf.themedControls.on"
KEY_SHEET = "axf.themedControls.sheet"
TRUE_WORDS = {"1", "true", "on", "yes", "enable", "enabled"}
FALSE_WORDS = {"0", "false", "off", "no", "disable", "disabled"}

router = APIRouter()
_lock = threading.Lock()


def family_key(f: str) -> str:
    return f"axf.themedControls.{f}"


def data_dir() -> Path:
    return Path(os.environ.get("AXF_THEMED_CONTROLS_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _read(name: str, default: Any) -> Any:
    try:
        return json.loads((data_dir() / name).read_text("utf-8"))
    except (OSError, ValueError):
        return default


def _write(name: str, value: Any) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / f".{name}.tmp"
    tmp.write_text(json.dumps(value, indent=2), "utf-8")
    tmp.replace(d / name)


def as_bool(v: Any, field: str = "on") -> bool:
    if isinstance(v, bool):
        return v
    s = str(v).strip().lower()
    if s in TRUE_WORDS:
        return True
    if s in FALSE_WORDS:
        return False
    raise HTTPException(422, f"{field} must be on or off")


def check_family(f: Any) -> str:
    s = str(f or "").strip().lower()
    if s not in FAMILIES:
        raise HTTPException(422, f"family must be one of {', '.join(FAMILIES)}")
    return s


def settings() -> dict[str, Any]:
    """The stored switches (every one on unless stored off, like themedControlsConfig) and their revision."""
    raw = _read("settings.json", {})
    values = raw.get("values") if isinstance(raw.get("values"), dict) else {}
    on = lambda k: values.get(k) is not False  # noqa: E731
    return {"rev": int(raw.get("rev") or 0), "at": raw.get("at"), "by": raw.get("by"),
            "on": on(KEY_ON), "sheet": on(KEY_SHEET), "families": {f: on(family_key(f)) for f in FAMILIES}}


def config_values(s: dict[str, Any]) -> dict[str, bool]:
    return {KEY_ON: s["on"], KEY_SHEET: s["sheet"], **{family_key(f): s["families"][f] for f in FAMILIES}}


def write_settings(changes: dict[str, bool], by: str) -> dict[str, Any]:
    with _lock:
        cur = settings()
        values = {**config_values(cur), **changes}
        _write("settings.json", {"rev": cur["rev"] + 1, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": by, "values": values})
        return settings()


def push_to_console(changes: dict[str, Any], by: str) -> list[dict[str, Any]]:
    """Set the changed settings in the open console now (console-control `set setting:<key>`); quiet when none is open."""
    out: list[dict[str, Any]] = []
    try:
        import console_control_api as api  # the console server's /api/console-control half
    except Exception:  # noqa: BLE001 — tests run without the console
        return out
    for key, value in changes.items():
        try:
            r = api.run(api.normalize({"verb": "set", "address": f"setting:{key}", "value": "on" if value is True else "off" if value is False else value}), by or FOLDER, api.OWNER)
            out.append({"key": key, "ok": bool(r.get("ok")), **({"code": r.get("code")} if not r.get("ok") else {})})
        except Exception as e:  # noqa: BLE001
            out.append({"key": key, "ok": False, "code": "unavailable", "message": str(e)[:200]})
    return out


def run_in_console(action: str, value: Any = None, by: str = "") -> dict[str, Any]:
    """Run one of the web part's actions in the open console (press function:<action> with value)."""
    try:
        import console_control_api as api
    except Exception:  # noqa: BLE001
        return {"ok": False, "code": "unavailable", "message": "the console server is not running"}
    body: dict[str, Any] = {"verb": "press", "address": f"function:{action}"}
    if value not in (None, ""):
        body["value"] = value
    return api.run(api.normalize(body), by or FOLDER, api.OWNER)


def active(s: dict[str, Any]) -> list[str]:
    return [f for f in FAMILIES if s["on"] and s["families"][f]]


def state() -> dict[str, Any]:
    s = settings()
    live = _read("live.json", {})
    return {"$axf": "themed-controls@1", **s, "active": active(s), "live": live,
            "deepLink": "console_show settings:plugins/themed-controls", "settingsTab": "plugins/themed-controls"}


def _by(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    return str(getattr(u, "name", "") or request.headers.get("x-axf-by") or "api")


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001
        return {}
    return b if isinstance(b, dict) else {}


def changed(changes: dict[str, bool], request: Request) -> dict[str, Any]:
    by = _by(request)
    write_settings(changes, by)
    return {**state(), "changed": list(changes), "console": push_to_console(changes, by)}


@router.get("/state")
def get_state() -> dict[str, Any]:
    """The switches (master, phone sheet, each family), the active families and what the open console last reported."""
    return state()


@router.post("/on")
def turn_on(request: Request) -> dict[str, Any]:
    """Master switch on: every family whose own switch is on is themed again."""
    return changed({KEY_ON: True}, request)


@router.post("/off")
def turn_off(request: Request) -> dict[str, Any]:
    """Master switch off: every control is the browser's own again."""
    return changed({KEY_ON: False}, request)


@router.post("/family")
async def set_family(request: Request) -> dict[str, Any]:
    """One family on or off: {family, on}."""
    b = await _body(request)
    return changed({family_key(check_family(b.get("family"))): as_bool(b.get("on", True))}, request)


@router.post("/sheet")
async def set_sheet(request: Request) -> dict[str, Any]:
    """Bottom sheet on a phone on or off: {on}."""
    b = await _body(request)
    return changed({KEY_SHEET: as_bool(b.get("on", True))}, request)


@router.post("/report")
async def report(request: Request) -> dict[str, Any]:
    """The open console's report: its switches (a change made on screen) and what it has themed / open right now."""
    b = await _body(request)
    out: dict[str, Any] = {}
    vals = b.get("settings") if isinstance(b.get("settings"), dict) else None
    if vals is not None:
        cur = config_values(settings())
        changes = {k: bool(v) for k, v in vals.items() if k in cur and bool(v) != cur[k]}
        if changes and int(b.get("rev") or 0) >= settings()["rev"]:
            write_settings(changes, "console")
            out["changed"] = list(changes)
    live = b.get("live") if isinstance(b.get("live"), dict) else None
    if live is not None:
        _write("live.json", {**live, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())})
    return {"ok": True, "rev": settings()["rev"], **out}


def _live() -> dict[str, Any]:
    live = _read("live.json", {})
    return live if isinstance(live, dict) else {}


@router.get("/controls")
def controls(family: str = "") -> dict[str, Any]:
    """The themed controls on the open console's screen (ref, family, label, value, console-control address)."""
    live = _live()
    items = [c for c in live.get("controls") or [] if not family or c.get("family") == family]
    return {"controls": items, "at": live.get("at"), "note": "as the open console last reported it (every few seconds)"}


@router.post("/set")
async def set_control(request: Request) -> dict[str, Any]:
    """Set one themed control in the open console like a person would: {ref, value}. ref = element id, name or label words."""
    b = await _body(request)
    ref = str(b.get("ref") or "").strip()
    if not ref:
        raise HTTPException(422, "ref is required (the control's id, name or label)")
    value = b.get("value")
    if isinstance(value, bool):
        value = "on" if value else "off"
    return run_in_console("themed-controls.set", f"{ref}:{'' if value is None else value}", _by(request))


@router.get("/pickers")
def pickers() -> dict[str, Any]:
    """The open date / time / colour picker and open dialogs in the console, as it last reported them."""
    live = _live()
    return {"open": live.get("open") or [], "dialogs": (live.get("globals") or {}).get("dialogs"), "at": live.get("at")}


@router.post("/open")
async def open_picker(request: Request) -> dict[str, Any]:
    """Open the picker of a date / time / colour control in the console: {ref, family?}. The deep link of a picker."""
    b = await _body(request)
    ref = str(b.get("ref") or "").strip()
    fam = str(b.get("family") or "").strip()
    if fam:
        check_family(fam)
    if not ref and not fam:
        raise HTTPException(422, "ref (the control's id, name or label) or family is required")
    return run_in_console("themed-controls.open", ":".join(x for x in (fam, ref) if x), _by(request))


@router.post("/close")
async def close_picker(request: Request) -> dict[str, Any]:
    """Close the open picker (or the one of {ref})."""
    b = await _body(request)
    return run_in_console("themed-controls.close", str(b.get("ref") or "").strip(), _by(request))


@router.post("/pick")
async def pick(request: Request) -> dict[str, Any]:
    """Set the open picker's control to {value} and close it (a date 2026-03-03, a time 14:30, a colour #3366cc)."""
    b = await _body(request)
    v = str(b.get("value") or "").strip()
    if not v:
        raise HTTPException(422, "value is required")
    return run_in_console("themed-controls.pick", v, _by(request))


@router.get("/colors")
def colors() -> dict[str, Any]:
    """The colour controls on the open console's screen (ref, label, value), the open colour picker and the recent colours."""
    live = _live()
    return {"controls": [c for c in live.get("controls") or [] if c.get("family") == "color"],
            "open": next((o for o in live.get("open") or [] if o.get("family") == "color"), None),
            "recent": live.get("recentColors") or [], "at": live.get("at")}


@router.get("/dialogs")
def get_dialogs() -> dict[str, Any]:
    """The themed alert / confirm / prompt open in the console (kind, title, message, destructive, prompt text) and how many wait."""
    live = _live()
    d = (live.get("globals") or {}).get("dialogs") or {"open": None, "waiting": 0}
    return {**d, "at": live.get("at")}


@router.post("/answer")
async def answer(request: Request) -> dict[str, Any]:
    """Answer the open themed dialog: {answer: ok|cancel, text?, confirm?}. OK on a destructive confirm answers
    confirmation_required until it is sent again with confirm: true (tell Brett what it deletes first)."""
    b = await _body(request)
    a = str(b.get("answer") or "ok").strip().lower()
    if a not in ("ok", "cancel"):
        raise HTTPException(422, "answer must be ok or cancel")
    try:
        import console_control_api as api
    except Exception:  # noqa: BLE001
        return {"ok": False, "code": "unavailable", "message": "the console server is not running"}
    body: dict[str, Any] = {"verb": "press", "address": f"button:themed-controls.dialog.{a}"}
    if a == "ok" and b.get("text") not in (None, ""):
        body["value"] = str(b.get("text"))
    if b.get("confirm") is True or str(b.get("confirm")).lower() in TRUE_WORDS:
        body["confirm"] = True
    return api.run(api.normalize(body), _by(request), api.OWNER)


@router.get("/files")
def get_files() -> dict[str, Any]:
    """The file drop zones on the open console's screen: their chosen files (name, size, type) and upload progress."""
    live = _live()
    return {"zones": [c for c in live.get("controls") or [] if c.get("family") == "file"], "at": live.get("at")}


@router.post("/files")
async def file_action(request: Request) -> dict[str, Any]:
    """Clear a file drop zone or cancel its uploads: {ref, action: clear|cancel, name?} (cancel without a name = every upload)."""
    b = await _body(request)
    ref = str(b.get("ref") or "").strip()
    action = str(b.get("action") or "clear").strip().lower()
    if not ref:
        raise HTTPException(422, "ref (the file control's id, name or label) is required")
    if action not in ("clear", "cancel"):
        raise HTTPException(422, "action must be clear or cancel")
    return run_in_console("themed-controls.files", ":".join([ref, action] + ([str(b["name"])] if b.get("name") else [])), _by(request))


TOKENS = {"tooltip.delayMs": (0, 2000), "tooltip.hideMs": (0, 1000), "tooltip.longPressMs": (200, 1200), "scrollbar.width": (4, 20)}


@router.get("/tokens")
def get_tokens() -> dict[str, Any]:
    """Tooltip delay / hide delay / long-press time and scrollbar width in force (as the open console last reported them)."""
    live = _live()
    return {"tokens": live.get("tokens") or {}, "ranges": {k: {"min": a, "max": b} for k, (a, b) in TOKENS.items()},
            "also": "axf token controls set <path> <value> (control@1 tokens.controls)", "at": live.get("at")}


def _token(path: str, key: str, v: Any, by: str) -> dict[str, Any]:
    lo, hi = TOKENS[path]
    if v in (None, "", "reset", "theme"):
        return run_in_console("themed-controls.token", f"{path}:reset", by)
    try:
        n = float(v)
    except (TypeError, ValueError):
        raise HTTPException(422, f"{key} must be a number from {lo} to {hi}, or reset") from None
    if not lo <= n <= hi:
        raise HTTPException(422, f"{key} must be from {lo} to {hi}")
    return run_in_console("themed-controls.token", f"{path}:{int(round(n))}", by)


@router.post("/tooltip")
async def set_tooltip(request: Request) -> dict[str, Any]:
    """Tooltip timing: {delayMs?, hideMs?, longPressMs?} (each a number, or "reset" for the theme's value)."""
    b = await _body(request)
    out = {key: _token(f"tooltip.{key}", key, b[key], _by(request)) for key in ("delayMs", "hideMs", "longPressMs") if key in b}
    if not out:
        raise HTTPException(422, "send delayMs, hideMs or longPressMs")
    return {"ok": all(r.get("ok") for r in out.values()), "results": out}


@router.post("/scrollbar")
async def set_scrollbar(request: Request) -> dict[str, Any]:
    """Scrollbar width in px: {width} (4 to 20, or "reset")."""
    b = await _body(request)
    return _token("scrollbar.width", "width", b.get("width"), _by(request))
