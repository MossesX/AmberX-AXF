"""Badges — server part (folder claude-badge). Mounted at /api/plugins/claude-badge/ (console token, 404 when disabled).

POST /test runs one tiny request through the AI assistant's model service (axf.llm@1) and says whether AI answers and
which model did, and which of three states it is in: `ok` (answers), `no-credit` (the account or key works but is out
of credits / over its usage limit) or `error` (can't connect: bad token, invalid account, no assistant); GET /status returns the last result (kept in the plugin's data folder, no reply text, no keys).

GET /vps reads the Claude Code login on the VPS, the second badge: `ok` (logged in, no recent limit), `no-credit` (it hit a
limit) or `error` (not logged in, expired, or the VPS can't be read; `reachable` says which). It never calls a model, so it
costs no tokens: `claude auth status` on the host through axf.claude-accounts@1 (30 s cache there) and the limit mark
through axf.ai-keys@1. Only the owner gets the email and plan.
GET /usage is the usage meter: 5-hour and weekly use of every saved Claude login (server/usage_host.py on the host, plain HTTP,
no model call). Cached 5 minutes in memory and on disk; `?refresh=1` reads again, at most every 30 s. A login whose copy can't
be read keeps its last numbers with the time they are from, so the list never goes blank.

GET /amberx says whether the AmberX phone is connected: axHub's `amberx.recorder_status` through axf.vinny@1, which runs at
once (no veto, no tokens). Cached for a minute.
Every usage row also carries the account health check's result (capability axf.account-status@1, the one shared store):
status, models, when it was checked; a row the host read missed takes the check's newer numbers.
Nothing here names another plugin: no service = "AI unavailable" / "can't read the VPS".
"""
from __future__ import annotations

import base64
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


# ---------------------------------------------------------------------- usage meter

USAGE_TTL_S = 300.0
USAGE_MIN_S = 30.0
WARN_AT = 80.0
USAGE_WHY = {
    -1: "No login saved for this account",
    0: "The usage service didn't answer",
    401: "This saved login is out of date: its numbers come back when it is next used",
    403: "A token login can't show its usage",
    429: "The usage service is busy: try again in a few minutes",
}
_usage_lock = threading.Lock()
_usage: dict[str, Any] = {"at": 0.0, "value": None}


def usage_command() -> str:
    """The host read as one command: the script travels base64 so no shell quoting can touch it."""
    code = base64.b64encode((Path(__file__).parent / "usage_host.py").read_bytes()).decode()
    return f"python3 -c \"import base64;exec(base64.b64decode('{code}'))\""


def _num(v: Any) -> float | None:
    return float(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else None


def clean_window(w: Any) -> dict[str, Any] | None:
    """One usage window: percent used (of 100; the service gives no absolute total) and when it resets."""
    if not isinstance(w, dict) or _num(w.get("used")) is None:
        return None
    return {"used": round(max(0.0, min(100.0, float(w["used"]))), 1), "resetsAt": str(w.get("resetsAt") or "")[:40], "locked": w.get("locked") is True}


def settle(w: dict[str, Any] | None, now_ms: int) -> dict[str, Any] | None:
    """An old reading whose window has reset since is back at zero, whatever it said then."""
    if w and 0 < _ms(str(w.get("resetsAt") or "")) <= now_ms:
        return {**w, "used": 0.0, "locked": False, "resetsAt": ""}
    return w


def account_status(row: dict[str, Any]) -> str:
    """ok | limit (a window is full) | old (last numbers kept) | no-meter (nothing to show for this kind of login)."""
    full = [w for w in (row.get("fiveHour"), row.get("weekly")) if w and (w["used"] >= 100 or w["locked"])]
    if full:
        return "limit"
    if row.get("fresh"):
        return "ok"
    return "old" if row.get("asOf") else "no-meter"


def merge_usage(prev: dict[str, Any], read: dict[str, Any], now_ms: int) -> list[dict[str, Any]]:
    """This read over the last one: a login that answered is fresh, one that didn't keeps its numbers and its date."""
    out = []
    for r in read.get("rows") or []:
        if not isinstance(r, dict) or not r.get("name"):
            continue
        name = str(r["name"])[:64]
        http = r.get("http")
        old = prev.get(name) or {}
        row = {"name": name, "type": str(r.get("kind") or "login"), "active": r.get("active") is True, "plan": str(r.get("plan") or old.get("plan") or "")[:40]}
        if http == 200:
            row.update(fresh=True, asOf=now_ms, fiveHour=clean_window(r.get("fiveHour")), weekly=clean_window(r.get("weekly")), why="")
        else:
            why = "An API key has no usage meter" if row["type"] == "api-key" else USAGE_WHY.get(http, f"The usage service answered {http}")
            row.update(fresh=False, asOf=old.get("asOf") or 0, fiveHour=settle(old.get("fiveHour"), now_ms), weekly=settle(old.get("weekly"), now_ms), why=why)
        row["status"] = account_status(row)
        out.append(row)
    return out


HEALTH_WORDS = {"ok": "ok", "limited": "limited", "no-credits": "no credits", "expired": "login expired", "unknown": "not checked"}


def with_health(accounts: list[dict[str, Any]], store: dict[str, Any] | None) -> list[dict[str, Any]]:
    """The account health check's shared store (capability axf.account-status@1, account-status@1) on every usage row:
    its status, models and check time; a row the host read missed takes the check's numbers when they are newer; an
    API key shows its last-known spend against its cap. No store = the rows as they were."""
    rows = (store or {}).get("accounts") if isinstance(store, dict) else None
    if not isinstance(rows, dict):
        return accounts
    out = []
    for a in accounts:
        h = rows.get(a.get("name"))
        if not isinstance(h, dict):
            out.append(a)
            continue
        checked = _ms(str(h.get("checkedAt") or ""))
        b = {**a, "health": {"status": h.get("status") if h.get("status") in HEALTH_WORDS else "unknown", "why": str(h.get("why") or "")[:200],
                             "models": [m for m in h.get("models") or [] if m in ("opus", "fable")] if isinstance(h.get("models"), list) else None,
                             "checkedAt": str(h.get("checkedAt") or "")[:40], "warn": bool(h.get("warn"))}}
        u = h.get("usage") if isinstance(h.get("usage"), dict) else {}
        if not a.get("fresh") and checked > int(a.get("asOf") or 0) and (u.get("fiveHour") or u.get("weekly")):
            b.update(asOf=checked, fiveHour=clean_window(u.get("fiveHour")) or a.get("fiveHour"), weekly=clean_window(u.get("weekly")) or a.get("weekly"), why="From the last account check")
        api = h.get("api") if isinstance(h.get("api"), dict) else None
        if a.get("type") == "api-key" and api:
            cap = f" of ${api.get('capDay')}" if api.get("capDay") else ""
            b["why"] = f"${float(api.get('spendDay') or 0):.2f} today{cap} (an API key has no usage meter)"
        if h.get("status") in ("expired", "no-credits"):
            b["status"] = "limit"
        elif b.get("status") != a.get("status") or b.get("fiveHour") is not a.get("fiveHour"):
            b["status"] = account_status(b)
        out.append(b)
    return out


def meter_state(active: dict[str, Any] | None) -> str:
    """The badge: ok, warn from 80% of either window, error when one is full, off when there is nothing to read."""
    if not active or active["status"] == "no-meter":
        return "off"
    if active["status"] == "limit":
        return "error"
    used = [w["used"] for w in (active.get("fiveHour"), active.get("weekly")) if w]
    return "warn" if used and max(used) >= WARN_AT else "ok"


def _usage_saved() -> dict[str, Any]:
    try:
        v = json.loads((data_dir() / "usage.json").read_text("utf-8"))
    except (OSError, ValueError):
        return {}
    return {str(a.get("name")): a for a in v.get("accounts") or [] if isinstance(a, dict)}


def read_usage(refresh: bool = False) -> dict[str, Any]:
    """The cached read, or a new one when it is old or asked for. The host read holds the lock: one at a time."""
    with _usage_lock:
        now = time.time()
        age = now - _usage["at"]
        value = _usage["value"]
        if value is not None and age < (USAGE_MIN_S if refresh else USAGE_TTL_S):
            return {**value, "cached": True, "age": int(age)}
        svc = plugin_services.get("axf.headless@1")
        r = svc.vps_read(usage_command(), 40) if svc is not None and hasattr(svc, "vps_read") else {"ready": False, "out": "", "why": "The Terminal plugin is off, so the console can't reach the VPS"}
        prev = {str(a["name"]): a for a in (value or {}).get("accounts") or []} or _usage_saved()
        now_ms = int(now * 1000)
        try:
            read = json.loads(str(r.get("out") or "").strip().splitlines()[-1])
        except (ValueError, IndexError):
            read = {}
        accounts = merge_usage(prev, read, now_ms) if isinstance(read, dict) else []
        if not accounts and prev:  # the host didn't answer: last numbers, marked as old
            accounts = [{**a, "fresh": False, "fiveHour": settle(a.get("fiveHour"), now_ms), "weekly": settle(a.get("weekly"), now_ms)} for a in prev.values()]
            for a in accounts:
                a["status"] = account_status(a)
        hs = plugin_services.get("axf.account-status@1")   # the account checks' shared store, when that plugin is on
        try:
            accounts = with_health(accounts, hs.status() if hs is not None else None)
        except Exception:  # noqa: BLE001 — the meter never breaks on the store
            pass
        active = next((a for a in accounts if a.get("active")), None)
        value = {"at": now_ms, "ready": bool(accounts), "why": "" if accounts else str(r.get("why") or "Couldn't read the accounts on the VPS")[:200],
                 "active": active["name"] if active else "", "state": meter_state(active), "accounts": accounts}
        _usage.update(at=now, value=value)
        if accounts:
            with _lock:
                storage.write_json(data_dir() / "usage.json", value, indent=None)
        return {**value, "cached": False, "age": 0}


@router.get("/usage")
def usage(request: Request, refresh: int = 0) -> dict[str, Any]:
    res = read_usage(refresh == 1)
    user = getattr(request.state, "axf_user", None)
    if user is not None and not getattr(user, "admin", False):  # the state for everyone, which accounts only for the owner
        res = {**res, "active": "", "accounts": []}
    return res


# ---------------------------------------------------------------------- AmberX phone

AMBERX_TTL_S = 60.0
WARN_OFFLINE_S = 3600
_amberx: dict[str, Any] = {"at": 0.0, "value": None}
_amberx_lock = threading.Lock()


def amberx_classify(text: str, now_ms: int) -> dict[str, Any]:
    """axHub's recorder_status words → the badge. Offline under an hour is amber: phones sleep."""
    m = re.search(r'"lastSeen"\s*:\s*"([^"]+)"', text)
    seen = _ms(m.group(1)) if m else 0
    if "No AmberX phone is paired" in text:
        return {"state": "off", "online": False, "lastSeen": 0, "text": "No AmberX phone is paired with axHub"}
    if "is offline" in text:
        recent = bool(seen) and now_ms - seen < WARN_OFFLINE_S * 1000
        return {"state": "warn" if recent else "error", "online": False, "lastSeen": seen, "text": "The AmberX phone is offline"}
    return {"state": "ok", "online": True, "lastSeen": seen or now_ms, "text": "The AmberX phone is connected"}


def read_amberx() -> dict[str, Any]:
    with _amberx_lock:
        now = time.time()
        if _amberx["value"] is not None and now - _amberx["at"] < AMBERX_TTL_S:
            return _amberx["value"]
        svc = plugin_services.get("axf.vinny@1")
        res: dict[str, Any] = {"state": "off", "online": False, "lastSeen": 0, "text": "The console has no axHub tool to ask (Agent manager off)"}
        if svc is not None:
            try:
                ready, why = svc.ready()
                if not ready:
                    res["text"] = str(why)[:200]
                else:
                    r = svc.call("amberx.recorder_status", {}, timeout=15, reason="Badges: is the AmberX phone connected")
                    res = amberx_classify(str(r.get("ok") or ""), int(now * 1000)) if "ok" in r else {**res, "text": "axHub wants an approval for this read"}
            except Exception as e:  # noqa: BLE001 — the badge says why
                res["text"] = (str(e).strip("'\"") or e.__class__.__name__)[:200]
        res["at"] = int(now * 1000)
        _amberx.update(at=now, value=res)
        return res


@router.get("/amberx")
def amberx() -> dict[str, Any]:
    return read_amberx()


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
