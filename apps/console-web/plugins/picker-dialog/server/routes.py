"""picker-dialog REST routes (picker@1, framework/spec/PICKER.md § 2 "API"). Mounted at /api/plugins/picker-dialog/.

    GET  /state                          the open console's pickers: every picker on screen (id, address, label, value,
                                         chosen labels, options), which one is open, its search and active row, plus
                                         the last action's answer and the plugin settings
    POST /state      (the console)       the console reports its pickers here after every change
    POST /open       {target}            open a picker (target = its id, `button:picker-<id>` or `picker:<id>`)
    POST /choose     {target?, option}   choose by value, else by spoken name / position; no target = the open picker
    POST /search     {target?, text}     type into its search field
    POST /clear      {target}            empty its value
    POST /close      {target?}           close it (no target = the open one)
    GET  /settings                       the picker settings (axf.picker.*)
    POST /settings   {key: value, …}     set any of them (enabled, swapSelectFields, swapSelects, searchThreshold,
                                         sheetOnPhone, excludeApps; with or without the `axf.picker.` prefix)

Every action runs the console action `picker.<verb>:<target>:<arg>` in the open console (console-commands@1), the same
handler MCP (`console_action`), the axf CLI (`axf picker …`) and voice use, then answers with the state the console
reports back. No console open → 503 with `openUrl`. Settings go through console-control@1 `set` / `state`, the same
path as every other setting.
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

FOLDER = "picker-dialog"
PREFIX = "axf.picker."
SETTINGS = {
    "enabled": bool, "swapSelectFields": bool, "swapSelects": bool, "searchThreshold": int, "sheetOnPhone": bool, "excludeApps": list,
}
VERBS = ("open", "choose", "toggle", "search", "clear", "close", "list")
WAIT_S = 2.0

router = APIRouter()
_lock = threading.Condition()
_state: dict[str, Any] = {"pickers": [], "open": None, "last": None, "at": None, "seq": 0}


def _root() -> Path:
    try:
        import console_context as cx
        return Path(cx.ROOT)
    except Exception:  # noqa: BLE001 — tests without the console
        return Path(__file__).resolve().parents[5]


def data_dir() -> Path:
    return Path(os.environ.get("AXF_PICKER_DIALOG_DIR") or (_root() / ".axf-console" / "plugins" / FOLDER))


def _relay() -> Any:
    try:
        import plugin_services
        return plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001
        return None


def _console_url() -> str:
    return os.environ.get("AXF_CONSOLE_URL", "").rstrip("/") + "/"


def bare(target: Any) -> str:
    t = str(target or "").strip()
    t = t.rsplit("/", 1)[-1]
    for p in ("picker:", "button:picker-"):
        if t.startswith(p):
            t = t[len(p):]
    return t


def action_spec(verb: str, target: Any = None, arg: Any = None) -> str:
    """The console action for a verb: `picker.choose:<id>:<name>` ('-' = the open picker)."""
    if verb not in VERBS:
        raise ValueError(f"verb must be one of {', '.join(VERBS)}")
    t = bare(target)
    if verb == "open" and not t:
        raise ValueError("open needs a target (the picker's id)")
    if verb in ("choose", "toggle") and not str(arg or "").strip():
        raise ValueError(f"{verb} needs an option (its name or value)")
    if verb in ("list",):
        return "picker.list"
    parts = [f"picker.{verb}", t or "-"]
    if arg is not None and str(arg) != "":
        parts.append(str(arg))
    return ":".join(parts)


def snapshot() -> dict[str, Any]:
    with _lock:
        return {k: v for k, v in _state.items() if k != "seq"}


def record(body: dict[str, Any]) -> dict[str, Any]:
    with _lock:
        _state.update({
            "pickers": body.get("pickers") if isinstance(body.get("pickers"), list) else [],
            "open": body.get("open") if isinstance(body.get("open"), str) else None,
            "last": body.get("last") if isinstance(body.get("last"), dict) else _state.get("last"),
            "at": body.get("at") or time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "seq": int(_state["seq"]) + 1,
        })
        _lock.notify_all()
        return {"ok": True, "seq": _state["seq"]}


def run_action(spec: str, by: str = "picker-dialog", wait: float = WAIT_S) -> dict[str, Any]:
    """Run a picker console action in the open console and wait for the state it reports back."""
    relay = _relay()
    if relay is None:
        return {"ok": False, "code": "unavailable", "message": "the Console commands plugin is off, so no console can be reached", "openUrl": _console_url()}
    with _lock:
        seq = int(_state["seq"])
    r = relay.run({"op": "act", "target": "console.actions", "path": spec, "action": "run"}, None, by)
    if not r.get("ok"):
        return {"ok": False, "code": r.get("code") or "unavailable", "message": r.get("message") or r.get("error") or "the console did not run it", "action": spec, "relay": r}
    end = time.monotonic() + wait
    with _lock:
        while int(_state["seq"]) == seq and time.monotonic() < end:
            _lock.wait(max(0.0, end - time.monotonic()))
        out = {k: v for k, v in _state.items() if k != "seq"}
        fresh = int(_state["seq"]) != seq
    last = out.get("last") or {}
    ok = bool(last.get("ok", True)) if fresh else True
    return {"ok": ok, "action": spec, "fresh": fresh, **({"error": last.get("error")} if not ok and last.get("error") else {}), "state": out}


def _control(cmd: dict[str, Any], by: str) -> dict[str, Any]:
    try:
        import console_control_api as cca
        return cca.run({"$axf": "console-control@1", **cmd}, by, cca.OWNER)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "code": "unavailable", "message": str(e)}


def setting_key(k: str) -> str:
    k = str(k or "").strip()
    short = k[len(PREFIX):] if k.startswith(PREFIX) else k
    if short not in SETTINGS:
        raise ValueError(f"unknown picker setting {k!r}; one of {', '.join(SETTINGS)}")
    return PREFIX + short


def coerce(key: str, value: Any) -> Any:
    kind = SETTINGS[key[len(PREFIX):]]
    if kind is bool:
        if isinstance(value, bool):
            return value
        return str(value).strip().lower() in ("1", "true", "on", "yes", "enabled")
    if kind is int:
        n = int(float(value))
        return max(0, min(200, n))
    if isinstance(value, list):
        return [str(v) for v in value]
    return [s for s in str(value or "").replace(",", " ").split() if s]


def settings_get(by: str = "picker-dialog") -> dict[str, Any]:
    out: dict[str, Any] = {}
    for short in SETTINGS:
        r = _control({"verb": "state", "address": f"setting:{PREFIX}{short}"}, by)
        st = r.get("state") if isinstance(r.get("state"), dict) else {}
        out[short] = st.get("value") if "value" in st else r.get("value")
    return out


def settings_set(values: dict[str, Any], by: str = "picker-dialog") -> dict[str, Any]:
    results: dict[str, Any] = {}
    for k, v in values.items():
        key = setting_key(k)
        r = _control({"verb": "set", "address": f"setting:{key}", "value": coerce(key, v)}, by)
        results[key[len(PREFIX):]] = {"ok": bool(r.get("ok")), **({"message": r.get("message")} if not r.get("ok") else {})}
    return {"ok": all(x["ok"] for x in results.values()), "results": results}


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001
        return {}


def _answer(r: dict[str, Any]) -> JSONResponse:
    status = 200 if r.get("ok") else 503 if r.get("code") == "unavailable" else 422 if r.get("error") else 502
    return JSONResponse(r, status_code=status)


@router.get("/state")
def get_state() -> dict[str, Any]:
    return {"ok": True, **snapshot()}


@router.post("/state")
async def post_state(request: Request) -> dict[str, Any]:
    r = record(await _body(request))
    save_snapshot()
    return r


def _verb_route(verb: str, arg_key: str | None = None):
    async def handler(request: Request) -> JSONResponse:
        b = await _body(request)
        try:
            spec = action_spec(verb, b.get("target") or b.get("id"), b.get(arg_key) if arg_key else None)
        except ValueError as e:
            return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
        by = str(b.get("by") or "rest")
        return _answer(await run_in_threadpool(run_action, spec, by))
    handler.__name__ = f"picker_{verb}"
    return handler


router.add_api_route("/open", _verb_route("open"), methods=["POST"])
router.add_api_route("/choose", _verb_route("choose", "option"), methods=["POST"])
router.add_api_route("/toggle", _verb_route("toggle", "option"), methods=["POST"])
router.add_api_route("/search", _verb_route("search", "text"), methods=["POST"])
router.add_api_route("/clear", _verb_route("clear"), methods=["POST"])
router.add_api_route("/close", _verb_route("close"), methods=["POST"])
router.add_api_route("/list", _verb_route("list"), methods=["POST"])


@router.get("/settings")
async def get_settings() -> dict[str, Any]:
    return {"ok": True, "settings": await run_in_threadpool(settings_get)}


@router.post("/settings")
async def post_settings(request: Request) -> JSONResponse:
    b = await _body(request)
    vals = b.get("settings") if isinstance(b.get("settings"), dict) else {k: v for k, v in b.items() if k not in ("by", "reason")}
    try:
        r = await run_in_threadpool(settings_set, vals, str(b.get("by") or "rest"))
    except ValueError as e:
        return JSONResponse({"ok": False, "error": str(e)}, status_code=400)
    return JSONResponse(r, status_code=200 if r["ok"] else 502)


def save_snapshot() -> None:
    """Keep the last reported state in the data folder (lifecycle dataDir) for the CLI when the server restarts."""
    try:
        d = data_dir()
        d.mkdir(parents=True, exist_ok=True)
        (d / "state.json").write_text(json.dumps(snapshot(), indent=2), encoding="utf-8")
    except OSError:
        pass
