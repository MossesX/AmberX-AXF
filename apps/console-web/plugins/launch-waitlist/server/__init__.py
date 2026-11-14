"""Launch waitlist: the AmberX site's waitlist and settings, controlled from the console.

Mounted at /api/plugins/launch-waitlist/ (console token required). Every route proxies the site's admin API
(apps/amberx-site, /api/admin/*), so the console view, REST, MCP tools (plugin-commands@1) and the CLI all drive the
same data. Environment:
    AMBERX_SITE_URL           the public site (default https://join.amberxai.com)
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

import plugin_services

router = APIRouter()

VPS_IP = "31.97.13.252"

CODE = re.compile(r"^[\w-]{4,32}$")


def _site() -> str:
    return (os.environ.get("AMBERX_SITE_URL") or "https://join.amberxai.com").rstrip("/")


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


def site_check() -> dict[str, Any]:
    """Systems check item: the public site answers over valid HTTPS, and the console can reach its admin API."""
    host = urllib.parse.urlparse(_site()).hostname or ""
    try:
        with urllib.request.urlopen(urllib.request.Request(_site() + "/api/health", headers={"user-agent": "axf-console-launch-waitlist"}), timeout=10) as r:
            ok = r.status == 200
    except Exception as e:  # noqa: BLE001 - DNS, TLS or HTTP: all mean "not public yet"
        return {"status": "error", "summary": f"{host} is not reachable over HTTPS yet ({getattr(e, 'reason', e)}).",
                "details": [f"Add a DNS A record {host} -> {VPS_IP} in Hostinger (hPanel -> Domains -> amberxai.com -> DNS / Nameservers).",
                            "The certificate is issued by the Coolify proxy within a minute of the record resolving."]}
    if not ok:
        return {"status": "error", "summary": f"{host} answered, but not with the AmberX site."}
    if not os.environ.get("AMBERX_SITE_ADMIN_TOKEN"):
        return {"status": "warn", "summary": f"{host} is live; the console can't manage the waitlist: AMBERX_SITE_ADMIN_TOKEN is not set."}
    return {"status": "ok", "summary": f"{_site()} is live over HTTPS and the console manages its waitlist."}


_registered = False


def ensure_health() -> None:
    """Registers the site check once the systems check provides axf.health@1 (plugins load in any order)."""
    global _registered
    reg = None if _registered else plugin_services.get("axf.health@1")
    if reg is None:
        return
    try:
        reg.register({"id": "launch-site", "label": "AmberX launch site is public", "service": "coolify", "order": 52, "interval": 900,
                      "run": site_check,
                      "breaks": "The AmberX landing page and waitlist aren't reachable on their public address, or the console can't manage the waitlist.",
                      "instructions": [f"Hostinger hPanel -> Domains -> amberxai.com -> DNS: add an A record, name 'join', points to {VPS_IP}, TTL 300.",
                                       "Console env: AMBERX_SITE_URL=https://join.amberxai.com and AMBERX_SITE_ADMIN_TOKEN = the SITE_ADMIN_TOKEN in /opt/amberx-site/.env on the VPS (root only), then restart the console.",
                                       "To serve it on amberxai.com itself: see apps/amberx-site/DEPLOY.md (the apex is claimed by the amberx-app web container today)."]}, "launch-waitlist")
        _registered = True
    except Exception:  # noqa: BLE001 - the plugin works without its banner item
        pass


ensure_health()


@router.get("/status")
def status() -> dict[str, Any]:
    ensure_health()
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
