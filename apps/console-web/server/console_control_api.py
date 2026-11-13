"""Console control REST (console-control@1, framework/spec/CONSOLE-CONTROL.md): /api/console-control/*.

    GET  /targets?under=&kinds=&source=     every addressable target (the open console's live list, else the static inventory)
    GET  /state?address=                    the console's live state, or one target's state
    POST /do        {verb, address?, value?, confirm?, options?, scroll?, query?, by?, reason?, to?}   any verb
    GET  /search?q=&kinds=&limit=           ranked hits, each with its address (POST {q, kinds, limit} too)
    POST /focus     {address, options?}     bring a target into view (opens its screen, tab, row first) and highlight it
    POST /scroll    {dir, amount?, to?, address?}   scroll the active pane (or the pane of `address`)
    POST /plugins/{id}/enable|disable  {force?, by?}  turn a plugin on / off (server-side, no browser needed)

Commands that need the page go to the open console over the console-commands relay (console-commands@1 `control`); the
answer is the console's own envelope with its live `state`. No console open → 503 `unavailable` with `openUrl`.
Server-side settings, plugin toggles, and search / targets / state of the static inventory answer without a browser.
"""
from __future__ import annotations

import os
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import console_control as cc

VERBS = ("open", "state", "press", "set", "scroll", "focus", "search", "list", "plugin.enable", "plugin.disable")
SCROLL_DIRS = ("up", "down", "page-up", "page-down", "top", "bottom", "to")  # = CONSOLE_CONTROL_SCROLL_DIRS
OWNER = "owner"
CONSOLE_URL = (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")


def _relay() -> Any:
    try:
        import plugin_services
        return plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001 — tests without the console
        return None


def audience_of(request: Request) -> tuple[str, str]:
    """(audience, name): the console token and hub admins reach the owner's consoles; a hub user only their own."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return OWNER, "console"
    name = str(getattr(user, "name", "") or "console")
    return (OWNER if getattr(user, "admin", False) else f"user:{name}"), name


def answer(r: dict[str, Any]) -> JSONResponse:
    status = 200 if r.get("ok") else cc.STATUS.get(str(r.get("code") or "unexpected"), 500)
    return JSONResponse(r, status_code=status)


def fail(e: cc.ControlError) -> JSONResponse:
    return answer(e.envelope())


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — empty or non-JSON = no fields
        return {}


def normalize(b: dict[str, Any]) -> dict[str, Any]:
    """A command from a request body, checked for shape (the console checks it fully). Raises invalid."""
    verb = str(b.get("verb") or "").strip()
    if verb not in VERBS:
        raise cc.ControlError("invalid", f"verb must be one of {', '.join(VERBS)}", field="verb")
    cmd: dict[str, Any] = {"$axf": cc.FRAME, "verb": verb}
    address = str(b.get("address") or "").strip()
    if address:
        cmd["address"] = address
    elif verb in ("open", "press", "set", "focus", "plugin.enable", "plugin.disable"):
        raise cc.ControlError("invalid", f"{verb} needs an address", field="address")
    for k in ("value", "options", "confirm", "reason"):
        if k in b and b[k] not in (None, ""):
            cmd[k] = b[k]
    if verb == "scroll":
        s = b.get("scroll") if isinstance(b.get("scroll"), dict) else {k: b[k] for k in ("dir", "amount", "to") if k in b}
        if str(s.get("dir") or "") not in SCROLL_DIRS:
            raise cc.ControlError("invalid", f"scroll.dir must be one of {', '.join(SCROLL_DIRS)}", field="scroll.dir")
        if s.get("dir") == "to" and not s.get("to"):
            raise cc.ControlError("invalid", "scroll to needs scroll.to (an address)", field="scroll.to")
        cmd["scroll"] = {k: v for k, v in s.items() if k in ("dir", "amount", "to") and v not in (None, "")}
    if verb == "search":
        q = b.get("query") if isinstance(b.get("query"), dict) else {"q": b.get("q"), "kinds": b.get("kinds"), "limit": b.get("limit")}
        if not str(q.get("q") or "").strip():
            raise cc.ControlError("invalid", "search needs words (query.q)", field="query.q")
        cmd["query"] = {k: v for k, v in q.items() if v not in (None, "", [])}
    return cmd


def server_side(cmd: dict[str, Any], by: str) -> dict[str, Any] | None:
    """Commands that need no browser: plugin toggles and server-run settings. Prechecks for the rest (refusals that
    don't depend on the page: owner-only settings, deciding / destructive presses). None = send it to the console."""
    verb, address = cmd["verb"], cmd.get("address", "")
    if verb in ("plugin.enable", "plugin.disable"):
        return cc.toggle_plugin(address, verb == "plugin.enable", by=by, force=bool(cmd.get("value") == "force" or (cmd.get("options") or {}).get("force")))
    if verb in ("set", "state") and address:
        spec = cc.setting_spec(address)
        if spec is not None:
            if verb == "state" and spec.get("runs") == "server":
                return cc.ok("state", spec["address"], state=cc.setting_state(spec))
            if verb == "set":
                if spec.get("runs") == "server":
                    return cc.set_server_setting(spec, cmd.get("value"), by)
                cc.refuse_person_only(spec, cmd.get("value"))
        if verb == "set" and address.rsplit("/", 1)[-1].startswith("plugin:"):
            on = str(cmd.get("value")).strip().lower() in cc.TRUE_WORDS
            return cc.toggle_plugin(address, on, by=by)
        if verb == "state" and address.rsplit("/", 1)[-1].startswith("plugin:"):
            p = cc.plugin_spec(address)
            if p is not None:
                return cc.ok("state", p["address"], state=cc.plugin_state(p))
    if verb == "press":
        cc.check_press(cc.press_spec(address), address, cmd.get("confirm"))
    return None


def to_console(cmd: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
    relay = _relay()
    if relay is None or not hasattr(relay, "control"):
        return {"$axf": cc.FRAME, "ok": False, "code": "unavailable", "because": "no relay",
                "message": "the Console commands plugin is off, so no console can be reached (turn it on in Settings › Plugins)", "openUrl": CONSOLE_URL + "/"}
    return relay.control(cmd, by, audience, to)


def run(cmd: dict[str, Any], by: str, audience: str, to: str = "recent") -> dict[str, Any]:
    """One command: server-side when it can be, else the open console; read-only verbs fall back to the inventory."""
    try:
        r = server_side(cmd, by)
    except cc.ControlError as e:
        return e.envelope()
    if r is not None:
        return {**r, "source": "server"}
    out = to_console(cmd, by, audience, to)
    if out.get("ok") or out.get("code") != "unavailable":
        return out
    # no console open: what the inventory can answer, it answers (marked), with the link to open the console
    link = {"openUrl": out.get("openUrl")} if out.get("openUrl") else {}
    try:
        if cmd["verb"] == "search":
            q = cmd["query"]
            return cc.ok("search", hits=cc.search(q.get("q", ""), q.get("kinds"), q.get("limit")), source="inventory", console=False, **link)
        if cmd["verb"] == "list":
            return cc.ok("list", targets=_static(cmd.get("address")), source="inventory", console=False, **link)
        if cmd["verb"] == "state" and not cmd.get("address"):
            return {**out, "state": None}
    except cc.ControlError as e:
        return e.envelope()
    return out


def _static(under: str | None, kinds: list[str] | None = None) -> list[dict[str, Any]]:
    ts = cc.static_targets()
    if under:
        ts = [t for t in ts if t["address"] == under or t["address"].startswith(under + "/") or t["address"].startswith(under + "=")]
    if kinds:
        ts = [t for t in ts if t.get("kind") in kinds]
    return ts


def _kinds(v: str | None) -> list[str] | None:
    ks = [k.strip() for k in (v or "").split(",") if k.strip()]
    return ks or None


def router_for(auth: Any) -> APIRouter:
    from fastapi import Depends
    r = APIRouter(prefix="/api/console-control", dependencies=[Depends(auth)])

    async def go(request: Request, cmd: dict[str, Any], to: str = "recent") -> JSONResponse:
        audience, name = audience_of(request)
        by = str(cmd.pop("by", "") or "") or name
        return answer(await run_in_threadpool(run, cmd, by, audience, to))

    async def from_body(request: Request, b: dict[str, Any]) -> JSONResponse:
        try:
            cmd = normalize(b)
        except cc.ControlError as e:
            return fail(e)
        if b.get("by"):
            cmd["by"] = str(b["by"])[:80]
        return await go(request, cmd, str(b.get("to") or "recent"))

    @r.get("/targets")
    async def targets(request: Request, under: str = "", kinds: str = "", source: str = "auto") -> JSONResponse:
        """source=inventory: the static list only; console: the open console's live list (503 when none); auto: live, else static."""
        if source != "inventory":
            audience, name = audience_of(request)
            live = await run_in_threadpool(to_console, {"$axf": cc.FRAME, "verb": "list", **({"address": under} if under else {})}, name, audience)
            if live.get("ok"):
                ks = _kinds(kinds)
                ts = [t for t in live.get("targets") or [] if not ks or t.get("kind") in ks]
                return answer({"$axf": cc.TARGETS_FRAME, "ok": True, "source": "console", "client": live.get("client"), "view": live.get("view"), "targets": ts, "state": live.get("state")})
            if source == "console":
                return answer(live)
        return answer({"$axf": cc.TARGETS_FRAME, "ok": True, "source": "inventory", "targets": _static(under or None, _kinds(kinds)), "counts": cc.inventory().get("counts", {})})

    @r.get("/state")
    async def state(request: Request, address: str = "") -> JSONResponse:
        return await go(request, {"$axf": cc.FRAME, "verb": "state", **({"address": address} if address else {})})

    @r.post("/do")
    async def do(request: Request) -> JSONResponse:
        return await from_body(request, await _body(request))

    @r.get("/search")
    async def search_get(request: Request, q: str = "", kinds: str = "", limit: int = cc.SEARCH_DEFAULT_LIMIT) -> JSONResponse:
        return await from_body(request, {"verb": "search", "query": {"q": q, "kinds": _kinds(kinds), "limit": limit}})

    @r.post("/search")
    async def search_post(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "search"})

    @r.post("/focus")
    async def focus(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "focus"})

    @r.post("/scroll")
    async def scroll(request: Request) -> JSONResponse:
        b = await _body(request)
        return await from_body(request, {**b, "verb": "scroll"})

    @r.post("/plugins/{ref}/{op}")
    async def plugin(request: Request, ref: str, op: str) -> JSONResponse:
        if op not in ("enable", "disable"):
            return fail(cc.ControlError("invalid", "use /plugins/<id>/enable or /disable", field="op"))
        b = await _body(request)
        return await from_body(request, {**b, "verb": f"plugin.{op}", "address": ref, **({"options": {"force": True}} if b.get("force") else {})})

    return r
