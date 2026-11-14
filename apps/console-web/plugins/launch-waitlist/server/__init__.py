"""Launch waitlist: the AmberX site's waitlist and settings, controlled from the console.

Mounted at /api/plugins/launch-waitlist/ (console token required). Every route proxies the site's admin API
(apps/amberx-site, /api/admin/*), so the console view, REST, MCP tools (plugin-commands@1) and the CLI all drive the
same data. Environment:
    AMBERX_SITE_URL           the public site (default https://amberxai.com)
    AMBERX_SITE_ADMIN_TOKEN   the site's SITE_ADMIN_TOKEN

    GET    /status                    site reachable, public settings, waiting count
    GET    /stats                     waiting / invited / today / via referral / top referrers
    GET    /entries?q=&limit=         the line, in order
    GET    /entries/{code}            one entry
    POST   /entries/{code}/invite     let someone in (leaves the line)
    POST   /entries/{code}/requeue    put an invited entry back in line
    DELETE /entries/{code}            remove (their referrer loses the credit)
    GET    /export                    CSV of everyone, in line order
    GET    /settings                  every site setting + the theme lists
    PUT    /settings                  change settings (partial: hook, sub, videoUrl, colorTheme, pricing{…} …)
    POST   /settings/reset            back to the defaults
"""
from __future__ import annotations

import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request
from typing import Any

from fastapi import APIRouter, Body, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter()

CODE = re.compile(r"^[\w-]{4,32}$")


def _site() -> str:
    return (os.environ.get("AMBERX_SITE_URL") or "https://amberxai.com").rstrip("/")


def _call(method: str, path: str, body: Any = None, admin: bool = True, raw: bool = False) -> Any:
    headers = {"content-type": "application/json", "user-agent": "axf-console-launch-waitlist"}
    if admin:
        token = os.environ.get("AMBERX_SITE_ADMIN_TOKEN", "")
        if not token:
            raise HTTPException(503, "AMBERX_SITE_ADMIN_TOKEN is not set on the console")
        headers["authorization"] = f"Bearer {token}"
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(_site() + path, data=data, method=method, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            text = r.read().decode()
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read().decode()).get("error") or e.reason
        except Exception:  # noqa: BLE001 - any unreadable body
            detail = e.reason
        raise HTTPException(e.code, f"site: {detail}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise HTTPException(502, f"site unreachable at {_site()}: {getattr(e, 'reason', e)}") from None
    return text if raw else json.loads(text or "{}")


def _code(code: str) -> str:
    if not CODE.match(code):
        raise HTTPException(400, "bad referral code")
    return code


@router.get("/status")
def status() -> dict[str, Any]:
    pub = _call("GET", "/api/site", admin=False)
    return {"site": _site(), "adminToken": bool(os.environ.get("AMBERX_SITE_ADMIN_TOKEN")), "waiting": pub["waitlist"]["total"], "settings": pub["settings"]}


@router.get("/stats")
def stats() -> dict[str, Any]:
    return _call("GET", "/api/admin/waitlist/stats")


@router.get("/entries")
def entries(q: str = "", limit: int = 500) -> dict[str, Any]:
    qs = urllib.parse.urlencode({"q": q, "limit": max(1, min(limit, 5000))})
    return _call("GET", f"/api/admin/waitlist?{qs}")


@router.get("/entries/{code}")
def entry(code: str) -> dict[str, Any]:
    return _call("GET", f"/api/admin/waitlist/{_code(code)}")


@router.post("/entries/{code}/invite")
def invite(code: str) -> dict[str, Any]:
    return _call("PATCH", f"/api/admin/waitlist/{_code(code)}", {"status": "invited"})


@router.post("/entries/{code}/requeue")
def requeue(code: str) -> dict[str, Any]:
    return _call("PATCH", f"/api/admin/waitlist/{_code(code)}", {"status": "waiting"})


@router.delete("/entries/{code}")
def remove(code: str) -> dict[str, Any]:
    return _call("DELETE", f"/api/admin/waitlist/{_code(code)}")


@router.get("/export")
def export() -> PlainTextResponse:
    return PlainTextResponse(_call("GET", "/api/admin/waitlist.csv", raw=True), media_type="text/csv")


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return _call("GET", "/api/admin/settings")


@router.put("/settings")
def put_settings(patch: dict[str, Any] = Body(...)) -> dict[str, Any]:
    return _call("PUT", "/api/admin/settings", patch)


@router.post("/settings/reset")
def reset_settings() -> dict[str, Any]:
    return _call("POST", "/api/admin/settings/reset")
