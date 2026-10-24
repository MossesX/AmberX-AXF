"""Claude connection — server part. Mounted at /api/plugins/claude-connection/ (console token, 404 when disabled).

GET /status checks the Claude Code connection: one tiny request through the AI assistant's model service (axf.llm@1)
on its default provider, which must be a Claude one (`claude-code` = subscription, `anthropic` = API key). It returns
whether it answered, how it signs in, and the active account's email: the Claude plan sign-in's
`oauthAccount.emailAddress` in ~/.claude.json (same field the host doctor reads with jq), else the host doctor's
"signed in as …" line, else (API key) the AI keys plugin's label for the active key. Never returns keys or reply text.
Results are cached 30 s so several pages loading at once make one request. Patches' server reads this route.
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter

import console_context as cx
import plugin_services

router = APIRouter()
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "res": None}
TTL = 30.0
PROMPT = "Connection check from the AmberX console. Reply with one word: OK."
MODES = {"claude-code": "subscription", "anthropic": "api-key"}
EMAIL_RE = re.compile(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}")


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
            return _cache["res"]
        res = run_check()
        _cache.update(at=time.time(), res=res)
        return res
