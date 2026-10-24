"""Claude connection — server part. Mounted at /api/plugins/claude-connection/ (console token, 404 when disabled).

GET /status checks the Claude Code connection: one tiny request through the AI assistant's model service (axf.llm@1)
on its default provider, which must be a Claude one (`claude-code` = subscription, `anthropic` = API key). It returns
whether it answered, how it signs in, and the active account's email: the Claude plan sign-in's
`oauthAccount.emailAddress` in ~/.claude.json (same field the host doctor reads with jq), else the host doctor's
"signed in as …" line, else (API key) the AI keys plugin's label for the active key. Never returns keys or reply text.
Results are cached 30 s so several pages loading at once make one request. Patches' server reads this route.

GET/PUT /config: the badge's icon (`icon`, a name or an icon pick `name@anim[:still]`, empty = the Claude mark), picked
in Settings → Plugins → Claude connection; /status returns it so Patches paints its badge with it. Stored in the
plugin's data folder (config.json, 0600).
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import console_context as cx
import plugin_services

router = APIRouter()
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "res": None}
TTL = 30.0
PROMPT = "Connection check from the AmberX console. Reply with one word: OK."
MODES = {"claude-code": "subscription", "anthropic": "api-key"}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")
ICON_RE = re.compile(r"[a-z0-9-]{1,40}(@[a-z]{1,12}(:still)?)?")
FOLDER = Path(__file__).resolve().parents[1].name


def data_dir() -> Path:
    return Path(cx.ROOT) / ".axf-console" / "plugins" / FOLDER


def read_config() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "config.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    icon = raw.get("icon") if isinstance(raw, dict) else ""
    return {"icon": icon if isinstance(icon, str) and ICON_RE.fullmatch(icon) else ""}


def write_config(cfg: dict[str, Any]) -> None:
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = d / "config.json.tmp"
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as fh:
        json.dump(cfg, fh)
    os.replace(tmp, d / "config.json")


def claude_json() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_JSON") or (Path.home() / ".claude.json"))


def plan_email() -> str:
    """The Claude plan account's email: ~/.claude.json, else the host doctor's report (`host-claude-login`)."""
    try:
        e = str((json.loads(claude_json().read_text("utf-8")).get("oauthAccount") or {}).get("emailAddress") or "")
        if EMAIL_RE.fullmatch(e):
            return e
    except (OSError, ValueError, AttributeError):
        pass
    try:
        rep = json.loads((Path(cx.ROOT) / ".axf-console" / "host-check.json").read_text("utf-8"))
        it = (rep.get("checks") or {}).get("host-claude-login") or {}  # host-check@1: {id: {status, summary}}
        m = EMAIL_RE.search(str(it.get("summary") or ""))
        if m:
            return m.group(0)
    except (OSError, ValueError, AttributeError):
        pass
    return ""


def key_label(kind: str) -> str:
    """The AI keys plugin's label for the active key of `kind` (names only, never the key)."""
    svc = plugin_services.get("axf.ai-keys@1")
    try:
        lst = svc.list() if svc else {}
        kid = (lst.get("active") or {}).get(kind) or ""
        for k in lst.get("keys") or []:
            if isinstance(k, dict) and k.get("id") == kid:
                return str(k.get("label") or "")
    except Exception:  # noqa: BLE001
        pass
    return ""


def run_check() -> dict[str, Any]:
    started = time.time()
    res: dict[str, Any] = {"at": int(started * 1000), "ok": False, "mode": "", "email": "", "account": "", "model": "", "ms": 0, "error": ""}
    llm = plugin_services.get("axf.llm@1")
    if not llm:
        res["error"] = "The AI assistant isn't installed or enabled"
    else:
        try:
            out = llm.complete([{"role": "user", "content": PROMPT}], params={"temperature": 0, "max_tokens": 16})
            pid = str(out.get("profile") or "")
            kind = next((str(p.get("kind") or "") for p in llm.profiles() if isinstance(p, dict) and p.get("id") == pid), "")
            text = str(out.get("text") or "").strip()
            res["model"] = str(out.get("model") or "")
            res["mode"] = MODES.get(kind, "")
            if not res["mode"]:
                res["error"] = f"The default AI provider ({kind or pid or 'unknown'}) isn't Claude"
            elif not text:
                res["error"] = "Claude answered with nothing"
            else:
                res["ok"] = True
            if res["ok"]:
                res["email"] = plan_email() if kind == "claude-code" else ""
                label = key_label(kind)
                res["account"] = res["email"] or (f"API key · {label}" if kind == "anthropic" and label else "API key" if kind == "anthropic" else "Claude subscription")
        except Exception as e:  # noqa: BLE001
            res["error"] = (str(e).strip("'\"") or e.__class__.__name__)[:300]
    res["ms"] = int((time.time() - started) * 1000)
    cx.log("system", f"Claude connection: {'ok, ' + res['account'] if res['ok'] else 'none (' + res['error'][:120] + ')'}", "ok" if res["ok"] else "warn")
    return res


@router.get("/status")
def status(refresh: bool = False) -> dict[str, Any]:
    with _lock:
        if not refresh and _cache["res"] and time.time() - _cache["at"] < TTL:
            return {**_cache["res"], "icon": read_config()["icon"]}
        res = run_check()
        _cache.update(at=time.time(), res=res)
    return {**res, "icon": read_config()["icon"]}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return read_config()


@router.put("/config")
async def put_config(request: Request) -> dict[str, Any]:
    try:
        body = await request.json()
    except ValueError:
        raise HTTPException(400, "send JSON")
    icon = body.get("icon", "") if isinstance(body, dict) else None
    if not isinstance(icon, str) or (icon and not ICON_RE.fullmatch(icon)):
        raise HTTPException(400, "icon must be an icon name or pick (name@anim, name@anim:still)")
    write_config({"icon": icon})
    return read_config()
