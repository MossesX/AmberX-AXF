"""REST for the host services (host-service@1, framework/spec/HOST-SERVICES.md): /api/host-services/…

Same paths and bodies as the host API (deploy/host-services/axf-hostd.mjs, /v1/…), behind the console token, so the
Host services view, MCP (plugin commands), the CLI fallback and voice (console control) all drive the same calls.

    GET  /api/host-services                         every service (host-service-state@1) + the host API's own state
    GET  /api/host-services/mode                    host-service-mode@1 (the whole document)
    GET  /api/host-services/{id}                    state, since, last heartbeat, manifest, mode, logs tail (?lines=)
    GET  /api/host-services/{id}/health             the service's own answer
    GET  /api/host-services/{id}/logs?lines=        journal lines
    POST /api/host-services/{id}/unit/{verb}        start | stop | restart | run      (stop, restart: confirm)
    POST /api/host-services/{id}/actions/{action}   { args, confirm? }                (confirm when the manifest says so)
    POST /api/host-services/{id}/act                { do: restart|start|stop|run|run-action|set-mode|rollback, … }
    GET  /api/host-services/{id}/settings           { settings, declared }
    PUT  /api/host-services/{id}/settings           { set: {…} }  merged key by key, last save wins
    GET  /api/host-services/{id}/mode               the service's mode entry and plan
    PUT  /api/host-services/{id}/mode               { to: container|shadow|host, why?, confirm? }  (backward: confirm)
    POST /api/host-services/{id}/rollback           { to?: container|shadow, why?, confirm }
    GET  /api/host-services/{id}/shadow             the shadow log (runs, drift)

Destructive presses (stop, restart, a confirm action, any move back from host, rollback) answer 428
`confirm_required` (host-error@1) until the call carries `confirm: true`, the console-control rule. A dead host API
answers 503 `host_service_down`: the UI's "Host service down" state.
"""
from __future__ import annotations

import re
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request

import host_services as hs

ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
VERBS = ("start", "stop", "restart", "run")
DESTRUCTIVE_VERBS = ("stop", "restart")
MODES = ("container", "shadow", "host")
ORDER = {"container": 0, "shadow": 1, "host": 2}


def _id(sid: str) -> str:
    if not ID.match(sid or ""):
        raise hs.HostServiceError("unknown_service", f"no service {sid!r}", service=str(sid)[:40])
    return sid


def _by(request: Request) -> str:
    v = (request.headers.get("x-axf-by") or "console").strip()
    return re.sub(r"[^A-Za-z0-9 ._:@-]", "", v)[:80] or "console"


def _reason(body: dict[str, Any], title: str, description: str = "") -> dict[str, str]:
    r = body.get("reason") if isinstance(body.get("reason"), dict) else {}
    return {"title": str(r.get("title") or title)[:200], "description": str(r.get("description") or description)[:600]}


def _need_confirm(body: dict[str, Any], sid: str, what: str, action: str = "") -> None:
    if body.get("confirm") is not True:
        raise hs.HostServiceError("confirm_required", f"{what} on {sid} is destructive: send it again with confirm", service=sid, action=action)


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001 — an empty body is {}
        return {}
    if not isinstance(b, dict):
        raise hs.HostServiceError("invalid_body", "the body must be a JSON object")
    return b


def _manifest(c: hs.HostServices, sid: str) -> dict[str, Any]:
    st = c.service(sid)
    return st.get("manifest") or {}


def router_for(auth: Callable[..., Any] | None, client: Callable[[], hs.HostServices] = hs.client, prefix: str = "/api/host-services") -> APIRouter:
    """The routes under `prefix` (the core mount), or with prefix "" for the host-services plugin's own mount
    (the plugin loader mounts it under the plugin prefix for the plugin commands, and so the MCP tools; it adds the auth)."""
    r = APIRouter(prefix=prefix, dependencies=[Depends(auth)] if auth else [])

    @r.get("" if prefix else "/")
    def list_services(fresh: bool = False) -> dict[str, Any]:
        c = client()
        out = c.services(fresh=fresh)
        states = out.get("services") or []
        counts: dict[str, int] = {}
        for s in states:
            counts[s.get("status", "unknown")] = counts.get(s.get("status", "unknown"), 0) + 1
        return {**out, "hostApi": c.status(), "counts": counts}

    @r.get("/mode")
    def whole_mode() -> dict[str, Any]:
        return client().mode()

    @r.get("/{sid}")
    def get_service(sid: str, lines: int = 30) -> dict[str, Any]:
        c = client()
        st = c.service(_id(sid))
        tail: list[Any] = []
        if lines > 0:
            try:
                tail = (c.logs(sid, lines).get("lines") or [])[-lines:]
            except hs.HostServiceError as e:
                tail = [{"at": "", "line": f"logs: {e.message}"}]
        mode: dict[str, Any] = {}
        try:
            mode = c.get_mode(sid)
        except hs.HostServiceError:
            mode = {}
        return {**st, "lastHeartbeat": (st.get("heartbeat") or {}).get("at"), "logs": tail, "modeEntry": mode.get("entry"), "modePlan": mode.get("plan")}

    @r.get("/{sid}/health")
    def get_health(sid: str) -> dict[str, Any]:
        return client().service_health(_id(sid))

    @r.get("/{sid}/logs")
    def get_logs(sid: str, lines: int = 200) -> dict[str, Any]:
        return client().logs(_id(sid), lines)

    @r.post("/{sid}/unit/{verb}")
    async def unit(sid: str, verb: str, request: Request) -> dict[str, Any]:
        body = await _body(request)
        return _unit(client(), _id(sid), verb, body, _by(request))

    @r.post("/{sid}/actions/{action}")
    async def action(sid: str, action: str, request: Request) -> dict[str, Any]:
        body = await _body(request)
        return _action(client(), _id(sid), action, body, _by(request))

    @r.post("/{sid}/act")
    async def act(sid: str, request: Request) -> dict[str, Any]:
        """One entry for console control and voice: { do, action?, args?, to?, why?, set?, confirm? }."""
        body = await _body(request)
        c, sid, by = client(), _id(sid), _by(request)
        do = str(body.get("do") or "")
        if do in VERBS:
            return _unit(c, sid, do, body, by)
        if do == "run-action":
            return _action(c, sid, str(body.get("action") or ""), body, by)
        if do == "set-mode":
            return _set_mode(c, sid, body, by)
        if do == "rollback":
            return _rollback(c, sid, body, by)
        if do == "set-settings":
            return c.set_settings(sid, body.get("set") or {}, by=by, reason=_reason(body, f"Settings of {sid}"))
        raise hs.HostServiceError("unknown_action", f"do must be one of {', '.join([*VERBS, 'run-action', 'set-mode', 'rollback', 'set-settings'])}", service=sid)

    @r.get("/{sid}/settings")
    def get_settings(sid: str) -> dict[str, Any]:
        return client().settings(_id(sid))

    @r.put("/{sid}/settings")
    async def put_settings(sid: str, request: Request) -> dict[str, Any]:
        body = await _body(request)
        if not isinstance(body.get("set"), dict):
            raise hs.HostServiceError("invalid_body", "send { set: { key: value } }", service=sid)
        return client().set_settings(_id(sid), body["set"], by=_by(request), reason=_reason(body, f"Settings of {sid}", ", ".join(body["set"])))

    @r.get("/{sid}/mode")
    def get_mode(sid: str) -> dict[str, Any]:
        return client().get_mode(_id(sid))

    @r.put("/{sid}/mode")
    async def put_mode(sid: str, request: Request) -> dict[str, Any]:
        body = await _body(request)
        return _set_mode(client(), _id(sid), body, _by(request))

    @r.post("/{sid}/rollback")
    async def rollback(sid: str, request: Request) -> dict[str, Any]:
        body = await _body(request)
        return _rollback(client(), _id(sid), body, _by(request))

    @r.get("/{sid}/shadow")
    def shadow(sid: str) -> dict[str, Any]:
        return client().shadow(_id(sid))

    return r


def _unit(c: hs.HostServices, sid: str, verb: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    if verb not in VERBS:
        raise hs.HostServiceError("unknown_action", f"unit verbs: {', '.join(VERBS)}", service=sid, action=verb)
    if verb in DESTRUCTIVE_VERBS:
        _need_confirm(body, sid, verb.capitalize(), verb)
    return c.unit(sid, verb, by=by, reason=_reason(body, f"{verb.capitalize()} {sid}", "Host services: unit action from the console."))


def _action(c: hs.HostServices, sid: str, action: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    if not ID.match(action or ""):
        raise hs.HostServiceError("unknown_action", f"no action {action!r}", service=sid)
    decl = next((a for a in _manifest(c, sid).get("actions") or [] if a.get("id") == action), None)
    if decl is None:
        raise hs.HostServiceError("unknown_action", f"{sid} has no action {action}", service=sid, action=action)
    if decl.get("confirm"):
        _need_confirm(body, sid, decl.get("title") or action, action)
    args = body.get("args") if isinstance(body.get("args"), dict) else {}
    return c.action(sid, action, args, by=by, reason=_reason(body, f"{decl.get('title') or action} ({sid})"), confirm=body.get("confirm") is True,
                    timeout=max(30.0, float(decl.get("timeoutMs") or 60000) / 1000 + 5))


def _set_mode(c: hs.HostServices, sid: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    to = body.get("to")
    if to not in MODES:
        raise hs.HostServiceError("invalid_body", "to must be container, shadow or host", service=sid)
    cur = (c.get_mode(sid) or {}).get("mode", "container")
    if ORDER.get(to, 0) < ORDER.get(cur, 0):
        _need_confirm(body, sid, f"Moving back to {to}", "set-mode")
    return c.set_mode(sid, to, by=by, why=str(body.get("why") or "")[:600], reason=_reason(body, f"{sid}: {cur} → {to}"),
                      accept_drift=[str(x) for x in body.get("acceptDrift") or []][:50])


def _rollback(c: hs.HostServices, sid: str, body: dict[str, Any], by: str) -> dict[str, Any]:
    _need_confirm(body, sid, "Rollback", "rollback")
    to = "shadow" if body.get("to") == "shadow" else "container"
    return c.rollback(sid, to=to, by=by, why=str(body.get("why") or "")[:600], reason=_reason(body, f"Roll back {sid} to {to}", "The console's copy takes over again."))
