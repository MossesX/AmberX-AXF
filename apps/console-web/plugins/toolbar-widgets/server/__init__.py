"""Toolbar widgets (server part, toolbar-widgets@1). Mounted at /api/plugins/toolbar-widgets/.

Every toolbar takes the same widgets the banner takes, drawn banner style. What is on a toolbar lives in the person's
look settings (axf.toolbar.<id>.widgets), which the open console owns, so every route here is one console-control@1
command to the open console (console_control_api.command: the same guards, audit, rate limit and confirm as
/api/console-control, MCP console_control_*, `axf console …` and voice). The addresses:

  toolbar:<id>/widget:all                 state = every widget row (drawn / hidden / addable), the slots, the style
  toolbar:<id>/widget:<type:id>           state = one row; press value = attach | move | style | hide | show | reset
  toolbar:<id>/widget:<type:id>/button:detach   destructive: answers confirmation_required until confirm is set

  GET  /widgets[?toolbar=<id>]            one toolbar's widgets (state), or every toolbar's widget targets (list)
  POST /widgets/attach {toolbar, widget, side?, size?, shape?}
  POST /widgets/detach {toolbar, widget, confirm?}
  POST /widgets/move   {toolbar, widget, side, index?}            index: a number, prev or next
  POST /widgets/style  {toolbar, widget, field, value?}           field: size|show|priority|hideWhenEmpty|overflow|hidden|shape|label
  POST /widgets/open   {toolbar, widget?}                         deep link: the Toolbar widgets dialog in the open console

Every body may carry `to` (recent | all | a console client id), `reason` and `by`. 503 when no console is open.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()

INSTANCE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._:-]{0,119}$")
WIDGET = re.compile(r"^[a-z0-9-]{1,40}:[A-Za-z0-9._-]{1,80}$")
SIDES = ("start", "end")
SIZES = ("icon", "compact", "normal", "wide")
FIELDS = ("size", "show", "priority", "hideWhenEmpty", "overflow", "hidden", "shape", "label")
PASS = ("to", "reason", "by")


class Invalid(Exception):
    def __init__(self, message: str, field: str = "") -> None:
        super().__init__(message)
        self.field = field


def _api() -> Any:
    import console_control_api as api  # the console server's console-control half (server/)
    return api


def toolbar_of(v: Any) -> str:
    t = str(v or "app").strip() or "app"
    if t.startswith("toolbar:"):
        t = t[len("toolbar:"):]
    if not INSTANCE.match(t):
        raise Invalid(f"toolbar must be a toolbar settings id (app, gate.auto-lander, …), not {t!r}", "toolbar")
    return t


def widget_of(v: Any) -> str:
    w = str(v or "").strip()
    if not WIDGET.match(w):
        raise Invalid("widget must be <type>:<id> (status:cpu, clock:digital-12h)", "widget")
    return w


def list_address(toolbar: str) -> str:
    return f"toolbar:{toolbar}/widget:all"


def widget_address(toolbar: str, widget: str) -> str:
    return f"toolbar:{toolbar}/widget:{widget}"


def detach_address(toolbar: str, widget: str) -> str:
    return f"{widget_address(toolbar, widget)}/button:detach"


def attach_value(b: dict[str, Any]) -> str:
    side = str(b.get("side") or "end")
    if side not in SIDES:
        raise Invalid("side must be start or end", "side")
    size = str(b.get("size") or "")
    if size and size not in SIZES:
        raise Invalid(f"size must be one of {', '.join(SIZES)}", "size")
    shape = str(b.get("shape") or "")
    if shape and not re.match(r"^[a-z0-9][a-z0-9-]{1,47}$", shape):
        raise Invalid("shape must be a shape asset id (circle, pill, squircle, …)", "shape")
    return ":".join(["attach", side, size, shape]).rstrip(":")


def move_value(b: dict[str, Any]) -> str:
    side = str(b.get("side") or "")
    if side not in SIDES:
        raise Invalid("side must be start or end", "side")
    index = b.get("index")
    if index is not None and str(index) not in ("prev", "next") and not str(index).lstrip("-").isdigit():
        raise Invalid("index must be a number, prev or next", "index")
    return f"move:{side}" + (f":{index}" if index is not None else "")


def style_value(b: dict[str, Any]) -> str:
    field = str(b.get("field") or "")
    if field not in FIELDS:
        raise Invalid(f"field must be one of {', '.join(FIELDS)}", "field")
    value = b.get("value")
    v = "default" if value is None or value == "" else ("true" if value is True else "false" if value is False else str(value))
    return f"style:{field}:{v}"


def plan(op: str, b: dict[str, Any]) -> dict[str, Any]:
    """One REST call → the console-control@1 body it sends (pure: the tests and the MCP / CLI parity check use it)."""
    extra = {k: b[k] for k in PASS if isinstance(b.get(k), str) and b[k]}
    if op == "list":
        t = b.get("toolbar")
        if t:
            return {"verb": "state", "address": list_address(toolbar_of(t)), **extra}
        return {"verb": "list", "kinds": ["widget"], **extra}
    toolbar = toolbar_of(b.get("toolbar"))
    if op == "open":
        w = b.get("widget")
        return {"verb": "open", "address": widget_address(toolbar, widget_of(w)) if w else list_address(toolbar), **extra}
    widget = widget_of(b.get("widget"))
    if op == "detach":
        out = {"verb": "press", "address": detach_address(toolbar, widget), **extra}
        if b.get("confirm"):
            out["confirm"] = True
        return out
    values: dict[str, Callable[[dict[str, Any]], str]] = {"attach": attach_value, "move": move_value, "style": style_value}
    if op not in values:
        raise Invalid(f"unknown operation {op!r}")
    return {"verb": "press", "address": widget_address(toolbar, widget), "value": values[op](b), **extra}


def _run(request: Request, body: dict[str, Any]) -> dict[str, Any]:
    api = _api()
    audience, name = api.audience_of(request)
    return api.command(body, name, audience, api.grants_of(request))


def _invalid(e: Invalid) -> JSONResponse:
    return JSONResponse({"$axf": "console-control@1", "ok": False, "code": "invalid", "message": str(e), **({"field": e.field} if e.field else {})}, status_code=400)


async def _go(request: Request, op: str, b: dict[str, Any]) -> JSONResponse:
    try:
        body = plan(op, b)
    except Invalid as e:
        return _invalid(e)
    if body["verb"] == "list":
        api = _api()
        audience, name = api.audience_of(request)
        r = await run_in_threadpool(api.targets, "", ["widget"], "console", name, audience, api.grants_of(request))
        return api.answer(r)
    r = await run_in_threadpool(_run, request, body)
    return _api().answer(r)


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — empty or non-JSON body = no fields
        return {}


@router.get("/widgets")
async def widgets(request: Request, toolbar: str = "", to: str = "") -> JSONResponse:
    """One toolbar's widgets (?toolbar=<id>: rows, slots, style) or every toolbar's widget targets."""
    return await _go(request, "list", {"toolbar": toolbar, "to": to})


@router.post("/widgets/attach")
async def attach(request: Request) -> JSONResponse:
    """Attach a widget to a toolbar: {toolbar, widget: <type>:<id>, side?: start|end, size?, shape?}."""
    return await _go(request, "attach", await _body(request))


@router.post("/widgets/detach")
async def detach(request: Request) -> JSONResponse:
    """Detach a widget from a toolbar (a widget the toolbar or a plugin put there is hidden): {toolbar, widget, confirm}. Needs confirm."""
    return await _go(request, "detach", await _body(request))


@router.post("/widgets/move")
async def move(request: Request) -> JSONResponse:
    """Move a widget on its toolbar: {toolbar, widget, side: start|end, index?: n|prev|next}."""
    return await _go(request, "move", await _body(request))


@router.post("/widgets/style")
async def style(request: Request) -> JSONResponse:
    """Style one widget banner style: {toolbar, widget, field: size|show|priority|hideWhenEmpty|overflow|hidden|shape|label, value?} (no value = back to the default)."""
    return await _go(request, "style", await _body(request))


@router.post("/widgets/open")
async def open_(request: Request) -> JSONResponse:
    """Open the Toolbar widgets dialog in the open console (on one widget when widget is given): {toolbar, widget?}."""
    return await _go(request, "open", await _body(request))
