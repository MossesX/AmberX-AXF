"""axHub connection — server part. Mounted at /api/plugins/hub-connection/ (console token, 404 when disabled).

GET /status checks the console's axHub connection: its hub token (`AXHUB_TOKEN`) against `<AXHUB_URL>/mcp` with one
MCP `initialize` (the same check as the systems check's axHub row; https only, no redirects, the token never leaves the
server). It returns ok, the hub, and why not. Cached 30 s so several pages loading at once make one request. Patches'
server reads this route and fills in the signed-in hub account.

GET/PUT /config: the badge's look per state (`look`: two icons, or one icon in two colours; icons are picks
`name[@anim[:still]]`, colours are theme tones; = `normalizeStateLook` in core/engines/iconpick.ts), picked in
Settings → Plugins → axHub connection. Stored in the plugin's data folder (config.json, 0600).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx

router = APIRouter()
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "res": None}
TTL = 30.0
ICON_RE = re.compile(r"[a-z0-9-]{1,40}(@[a-z]{1,12}(:still)?)?")
TONES = ("success", "danger", "warning", "accent", "neutral", "muted")
DEFAULT_ICON = "hub"
DEFAULT_HUB = "https://axhub.amberxai.com"
FOLDER = Path(__file__).resolve().parents[1].name


def data_dir() -> Path:
    return Path(cx.ROOT) / ".axf-console" / "plugins" / FOLDER


def normalize_look(raw: Any) -> dict[str, Any]:
    """= normalizeStateLook (core/engines/iconpick.ts): bad values fall back, a bare pick = one icon in two colours."""
    r = {"icon": raw} if isinstance(raw, str) else raw if isinstance(raw, dict) else {}
    pick = lambda v, d: v if isinstance(v, str) and ICON_RE.fullmatch(v) else d  # noqa: E731
    base = pick(r.get("icon"), DEFAULT_ICON)
    return {"mode": "icons" if r.get("mode") == "icons" else "colors", "icon": base, "on": pick(r.get("on"), base), "off": pick(r.get("off"), base),
            "onTone": r.get("onTone") if r.get("onTone") in TONES else "success", "offTone": r.get("offTone") if r.get("offTone") in TONES else "danger"}


def read_config() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "config.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    return {"look": normalize_look(raw.get("look") if isinstance(raw, dict) else None)}


def write_config(cfg: dict[str, Any]) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = d / "config.json.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh)
    os.replace(tmp, d / "config.json")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a: Any, **k: Any) -> None:  # a token never follows a redirect
        return None


def hub_url() -> str:
    return (os.environ.get("AXHUB_URL") or DEFAULT_HUB).strip().rstrip("/")


def post(url: str, body: bytes, headers: dict[str, str]) -> int:
    """POST and return the HTTP status (0 = not reached). Tests replace it."""
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=15) as r:
            r.read(4096)
            return r.status
    except urllib.error.HTTPError as e:
        return e.code
    except (urllib.error.URLError, OSError, ValueError):
        return 0


def run_check() -> dict[str, Any]:
    started = time.time()
    hub = hub_url()
    res: dict[str, Any] = {"at": int(started * 1000), "ok": False, "mode": "token", "hub": hub, "account": "", "ms": 0, "error": ""}
    u = urllib.parse.urlsplit(hub)
    tok = os.environ.get("AXHUB_TOKEN", "").strip()
    if u.scheme != "https" and u.hostname not in ("localhost", "127.0.0.1"):
        res["error"] = "AXHUB_URL must be https"
    elif not tok:
        res["error"] = "The console has no axHub token (AXHUB_TOKEN)"
    else:
        body = json.dumps({"jsonrpc": "2.0", "id": 1, "method": "initialize", "params": {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console", "version": "1"}}}).encode()
        code = post(f"{hub}/mcp", body, {"Authorization": f"Bearer {tok}", "Content-Type": "application/json", "Accept": "application/json, text/event-stream"})
        if code == 200:
            res["ok"] = True
        else:
            res["error"] = "axHub refused the token" if code in (401, 403) else f"axHub answered {code}" if code else f"Can't reach {u.hostname}"
    res["ms"] = int((time.time() - started) * 1000)
    cx.log("system", f"axHub connection: {'ok, ' + hub if res['ok'] else 'none (' + res['error'][:120] + ')'}", "ok" if res["ok"] else "warn")
    return res


@router.get("/status")
def status(refresh: bool = False) -> dict[str, Any]:
    with _lock:
        if refresh or not _cache["res"] or time.time() - _cache["at"] >= TTL:
            _cache.update(at=time.time(), res=run_check())
        res = _cache["res"]
    return {**res, **read_config()}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return read_config()


@router.put("/config")
async def put_config(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "send JSON")
    raw = body.get("look") if isinstance(body, dict) else None
    if not isinstance(raw, dict):
        raise HTTPException(400, "send {look: {mode, icon, on, off, onTone, offTone}}")
    if any(not isinstance(raw[k], str) or (raw[k] and not ICON_RE.fullmatch(raw[k])) for k in ("icon", "on", "off") if k in raw):
        raise HTTPException(400, "icons must be icon names or picks (name@anim, name@anim:still)")
    write_config({"look": normalize_look(raw)})
    return read_config()
