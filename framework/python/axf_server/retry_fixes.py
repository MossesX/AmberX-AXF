"""Ready-made fix handlers for retry-ladder@1 (axf_server.retry): the rungs that need the outside world.

Each is `fix(ctx, job) -> None`; it changes `ctx` for the next call or raises to say why it could not be done here (the
ladder records that under `missing` and moves on). What a call needs in `ctx`:

  base            the service's base URL (the call reads it back each time)
  service         a short name ("console", "axhub"): picks the env settings below
  token_file      a file with an `AXF_TOKEN=` line (refresh-token re-reads it)

Env: AXF_<SERVICE>_INTERNAL_URL (internal-address), AXF_COOLIFY_<SERVICE>_APP (the Coolify application uuid) with
COOLIFY_URL + COOLIFY_TOKEN (restart-container; the console's Credentials screen sets them).
"""
from __future__ import annotations

import json
import os
import urllib.error
import urllib.request
from typing import Any


def _env(ctx: dict[str, Any], suffix: str) -> str:
    svc = str(ctx.get("service") or "").upper().replace("-", "_")
    return os.environ.get(f"AXF_{svc}_{suffix}", "") if svc else ""


def internal_address(ctx: dict[str, Any], job: dict[str, Any]) -> None:
    url = _env(ctx, "INTERNAL_URL")
    if not url:
        raise RuntimeError(f"no internal address set (AXF_{str(ctx.get('service') or 'SERVICE').upper()}_INTERNAL_URL)")
    ctx["base"] = url.rstrip("/")


def health_check(ctx: dict[str, Any], job: dict[str, Any]) -> None:
    base = str(ctx.get("base") or "").rstrip("/")
    if not base:
        raise RuntimeError("no service address to health-check")
    try:
        with urllib.request.urlopen(base + str(ctx.get("health_path") or "/api/health"), timeout=10) as r:
            ctx["health"] = {"ok": 200 <= r.status < 300, "status": r.status}
    except urllib.error.HTTPError as e:
        ctx["health"] = {"ok": False, "status": e.code}
    except OSError as e:
        ctx["health"] = {"ok": False, "error": str(e)[:200]}


def restart_container(ctx: dict[str, Any], job: dict[str, Any]) -> None:
    url, token = os.environ.get("COOLIFY_URL", "").rstrip("/"), os.environ.get("COOLIFY_TOKEN", "")
    svc = str(ctx.get("service") or "").upper().replace("-", "_")
    app = os.environ.get(f"AXF_COOLIFY_{svc}_APP", "") if svc else ""
    missing = [n for n, v in (("COOLIFY_URL", url), ("COOLIFY_TOKEN", token), (f"AXF_COOLIFY_{svc or 'SERVICE'}_APP", app)) if not v]
    if missing:
        raise RuntimeError(f"Coolify restart needs {', '.join(missing)}")
    req = urllib.request.Request(f"{url}/api/v1/applications/{app}/restart", headers={"authorization": f"Bearer {token}", "accept": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            ctx["restarted"] = json.loads(r.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        raise RuntimeError(f"Coolify answered {e.code}") from None
    except OSError as e:
        raise RuntimeError(f"Coolify unreachable: {str(e)[:120]}") from None


def refresh_token(ctx: dict[str, Any], job: dict[str, Any]) -> None:
    f = ctx.get("token_file")
    if not f:
        raise RuntimeError("no token file to re-read")
    try:
        for line in open(f, encoding="utf-8"):
            if line.startswith("AXF_TOKEN="):
                ctx["token"] = line.split("=", 1)[1].strip()
                return
    except OSError as e:
        raise RuntimeError(f"token file unreadable: {e.strerror}") from None
    raise RuntimeError("the token file has no AXF_TOKEN line")


HTTP_FIXES = {"internal-address": internal_address, "health-check": health_check, "restart-container": restart_container, "refresh-token": refresh_token}
