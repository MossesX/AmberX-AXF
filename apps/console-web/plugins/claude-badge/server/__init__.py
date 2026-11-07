"""Claude badge — server part. Mounted at /api/plugins/claude-badge/ (console token, 404 when disabled).

POST /test runs one tiny request through the AI assistant's model service (axf.llm@1) and says whether AI answers and
which model did, and which of three states it is in: `ok` (answers), `no-credit` (the account or key works but is out
of credits / over its usage limit) or `error` (can't connect: bad token, invalid account, no assistant); GET /status returns the last result (kept in the plugin's data folder, no reply text, no keys).

GET /vps reads the Claude Code login on the VPS, the second badge: `ok` (logged in, no recent limit), `no-credit` (it hit a
limit) or `error` (not logged in, expired, or the VPS can't be read; `reachable` says which). It never calls a model, so it
costs no tokens: `claude auth status` on the host through axf.claude-accounts@1 (30 s cache there) and the limit mark
through axf.ai-keys@1. Only the owner gets the email and plan.
Nothing here names another plugin: no service = "AI unavailable" / "can't read the VPS".
"""
from __future__ import annotations

import json
import os
import re
import threading
import time
from datetime import datetime
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
_lock = threading.Lock()
# Same wording the AI assistant's credit check matches (ai-assistant `_NO_CREDIT`); kept here so no plugin is named.
NO_CREDIT = re.compile(r"hit your (?:weekly |daily |session |5-hour )?limit|weekly limit|credit balance|out of credits?|insufficient[ _-]?(credit|funds|balance)|billing|usage limit|limit reached|quota|payment required|\b402\b", re.I)
STATES = ("ok", "no-credit", "error")
PROMPT = "Connection check from the AmberX console. Reply with one word: OK."


def data_dir() -> Path:
    return Path(os.environ.get("AXF_CLAUDE_BADGE_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "claude-badge"))


def pretty_model(model: str) -> str:
    """claude-opus-5-5 → Claude Opus 5.5; claude-sonnet-5-5-20261001 → Claude Sonnet 5.5; anything else as given."""
    m = re.match(r"^claude-([a-z]+)-(\d+)(?:-(\d{1,2}))?(?:-\d{8})?$", (model or "").strip().lower())
    if m:
        fam, major, minor = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    m = re.match(r"^claude-(\d+)(?:-(\d{1,2}))?-([a-z]+)", (model or "").strip().lower())  # older claude-3-5-sonnet style
    if m:
        major, minor, fam = m.groups()
        return f"Claude {fam.capitalize()} {major}{'.' + minor if minor else ''}"
    return (model or "").strip()[:60]


def classify(ok: bool, error: str) -> str:
    """ok → `ok`; an error saying the account is out of credits / over its limit → `no-credit`; anything else → `error`."""
    if ok:
        return "ok"
    return "no-credit" if NO_CREDIT.search(error or "") else "error"


def _save(res: dict[str, Any]) -> None:
    p = data_dir() / "status.json"
    with _lock:
        storage.write_json(p, res, indent=None)  # atomic, 0600, folder 0700 (axf_server.storage)


def run_test() -> dict[str, Any]:
    started = time.time()
    llm = plugin_services.get("axf.llm@1")
    res: dict[str, Any] = {"at": int(started * 1000), "ok": False, "model": "", "name": "", "provider": "", "ms": 0, "error": ""}
    if not llm:
        res["error"] = "The AI assistant isn't installed or enabled"
    else:
        try:
            out = llm.complete([{"role": "user", "content": PROMPT}], params={"temperature": 0, "max_tokens": 16})
            text = str(out.get("text") or "").strip()
            res.update(ok=bool(text), model=str(out.get("model") or ""), provider=str(out.get("profile") or ""), error="" if text else "the model answered with nothing")
        except Exception as e:  # noqa: BLE001
            res["error"] = (str(e).strip("'\"") or e.__class__.__name__)[:300]
    res["ms"] = int((time.time() - started) * 1000)
    res["name"] = pretty_model(res["model"]) if res["ok"] else ""
    res["claude"] = res["name"].startswith("Claude")
    res["state"] = classify(res["ok"], res["error"])
    keys = plugin_services.get("axf.ai-keys@1")  # the signed-in Claude account's email, when the AI keys plugin has one
    try:
        acct = keys.active_account("claude-code") if keys and hasattr(keys, "active_account") else {}
    except Exception:  # noqa: BLE001 — the badge never fails over the email
        acct = {}
    res["account"] = str((acct or {}).get("email") or "")
    _save(res)
    said = {"ok": "ok, " + (res["name"] or "model unknown"), "no-credit": "out of credits (" + res["error"][:120] + ")", "error": "unavailable (" + res["error"][:120] + ")"}
    cx.log("system", f"AI connection: {said[res['state']]}", "ok" if res["ok"] else "warn")
    return res


def _ms(iso: str) -> int:
    """ISO time → ms, 0 when it can't be read."""
    try:
        return int(datetime.fromisoformat((iso or "").replace("Z", "+00:00")).timestamp() * 1000)
    except ValueError:
        return 0


def vps_classify(view: dict[str, Any], limited_at: int, now_ms: int) -> tuple[str, bool, str]:
    """(state, reachable, why) for one read of the VPS login. Unreadable says so: it never reads as logged out."""
    if not view.get("ready"):
        return "error", False, str(view.get("why") or "The console can't reach the VPS")
    if not view.get("checked"):
        return "error", False, "The VPS didn't answer `claude auth status`"
    if not (view.get("login") or {}).get("email"):
        return "error", True, "Claude Code isn't logged in on the VPS"
    if 0 < _ms(str(view.get("expiresAt") or "")) <= now_ms:
        return "error", True, "The Claude Code login on the VPS has expired"
    if limited_at:
        return "no-credit", True, "The Claude Code login on the VPS hit its limit"
    return "ok", True, ""


def read_vps() -> dict[str, Any]:
    """The Claude Code login on the VPS, read with plain code: no model call, no tokens, no credential."""
    now = int(time.time() * 1000)
    accounts = plugin_services.get("axf.claude-accounts@1")
    res: dict[str, Any] = {"at": now, "ok": False, "state": "error", "reachable": False, "account": "", "email": "", "plan": "", "expiresAt": "", "limitedAt": 0, "error": ""}
    if not accounts:
        res["error"] = "The Claude accounts plugin is off, so the console can't read the VPS login"
        return res
    try:
        view = accounts.view()
    except Exception as e:  # noqa: BLE001 — the badge says why instead of failing
        res["error"] = (str(e).strip("'\"") or e.__class__.__name__)[:300]
        return res
    keys = plugin_services.get("axf.ai-keys@1")
    try:
        limited = int(keys.limited_at(str(view.get("active") or ""))) if keys and hasattr(keys, "limited_at") else 0
    except Exception:  # noqa: BLE001 — no limit mark is not a broken login
        limited = 0
    state, reachable, why = vps_classify(view, limited, now)
    login = view.get("login") or {}
    res.update(ok=state == "ok", state=state, reachable=reachable, error=why, limitedAt=limited, account=str(view.get("active") or ""),
               email=str(login.get("email") or ""), plan=str(login.get("plan") or ""), expiresAt=str(view.get("expiresAt") or ""))
    return res


@router.post("/test")
def test() -> dict[str, Any]:
    return run_test()


@router.get("/status")
def status() -> dict[str, Any]:
    try:
        last = json.loads((data_dir() / "status.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {"last": None}
    if isinstance(last, dict) and last.get("state") not in STATES:  # saved before the out-of-credits state existed
        last["state"] = classify(bool(last.get("ok")), str(last.get("error") or ""))
    return {"last": last}


@router.get("/vps")
def vps(request: Request) -> dict[str, Any]:
    res = read_vps()
    user = getattr(request.state, "axf_user", None)
    if user is not None and not getattr(user, "admin", False):  # the state for everyone, who it is only for the owner
        res.update(account="", email="", plan="")
    return res
