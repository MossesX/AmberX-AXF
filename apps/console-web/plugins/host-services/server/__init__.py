"""Host services plugin: server part. Mounted at /api/plugins/host-services/ (console token, 404 while the plugin is off).

The routes the plugin commands in plugin.json name (and so the MCP tools host_services_* and the CLI runner), each a
thin call into the console core's host_services_routes.py, the same code behind /api/host-services. The client and
the health checks live in the core (host_services.py) and the systems check (host_health.py), so they keep working
with this plugin switched off; switching it off hides the view and the commands.

    GET  /                    host_services_list
    GET  /mode                host_services_mode
    GET  /{id}                host_services_get        (?lines=)
    GET  /{id}/logs           host_services_logs       (?lines=)
    POST /{id}/act            host_services_action     { do, action?, args?, to?, set?, why?, confirm? }
    PUT  /{id}/mode           host_services_set_mode   { to, why?, acceptDrift?, confirm? }
    POST /{id}/rollback       host_services_rollback   { to?, why?, confirm }
    GET  /{id}/settings       host_services_settings
    PUT  /{id}/settings       host_services_settings_set { set }
"""
from __future__ import annotations

from typing import Any

from fastapi import APIRouter, Request

import host_services as hs
import host_services_routes as core

router = APIRouter()
_core = core.router_for(None, prefix="")


def _endpoint(path: str, method: str) -> Any:
    for r in _core.routes:
        if getattr(r, "path", None) == path and method in getattr(r, "methods", set()):
            return r.endpoint  # type: ignore[attr-defined]
    raise RuntimeError(f"host_services_routes has no {method} {path}")


@router.get("/")
def list_services(fresh: bool = False) -> dict[str, Any]:
    return _endpoint("/", "GET")(fresh=fresh)


# The same list without the trailing slash: a plugin command route "GET /" is asked as /api/plugins/<folder>, which
# answered 404 (the Home card and the `list` read on every console load).
router.add_api_route("", list_services, methods=["GET"], include_in_schema=False)


@router.get("/mode")
def whole_mode() -> dict[str, Any]:
    return hs.client().mode()


@router.get("/{id}")
def get_service(id: str, lines: int = 30) -> dict[str, Any]:  # noqa: A002 — the command input names it id
    return _endpoint("/{sid}", "GET")(sid=id, lines=lines)


@router.get("/{id}/logs")
def get_logs(id: str, lines: int = 200) -> dict[str, Any]:  # noqa: A002
    return hs.client().logs(core._id(id), lines)


@router.post("/{id}/act")
async def act(id: str, request: Request) -> dict[str, Any]:  # noqa: A002
    return await _endpoint("/{sid}/act", "POST")(sid=id, request=request)


@router.put("/{id}/mode")
async def put_mode(id: str, request: Request) -> dict[str, Any]:  # noqa: A002
    body = await core._body(request)
    return core._set_mode(hs.client(), core._id(id), body, core._by(request))


@router.post("/{id}/rollback")
async def rollback(id: str, request: Request) -> dict[str, Any]:  # noqa: A002
    body = await core._body(request)
    return core._rollback(hs.client(), core._id(id), body, core._by(request))


@router.get("/{id}/settings")
def get_settings(id: str) -> dict[str, Any]:  # noqa: A002
    return hs.client().settings(core._id(id))


@router.put("/{id}/settings")
async def put_settings(id: str, request: Request) -> dict[str, Any]:  # noqa: A002
    body = await core._body(request)
    if not isinstance(body.get("set"), dict):
        raise hs.HostServiceError("invalid_body", "send { set: { key: value } }", service=id)
    return hs.client().set_settings(core._id(id), body["set"], by=core._by(request), reason=core._reason(body, f"Settings of {id}", ", ".join(body["set"])))
