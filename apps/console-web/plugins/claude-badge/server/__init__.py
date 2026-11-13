"""Badges — server part (folder claude-badge). Mounted at /api/plugins/claude-badge/ (console token, 404 when disabled).

GET /build is the Claude badge: can Claude build? The build orchestrator's ready read through axf.build-dispatch@1, the
dispatcher's own check: an account counts when the dispatcher may put a build on it and the latest account health sweep
says it signs in and has credits. `ok` (green) when one or more is ready, `error` (red) when none is, `off` when the
orchestrator can't be read. Per account: ready, signed in, credits, Fable, when it was checked and why not (names only for
the owner). Plain reads: no model call, no login touched; the VPS root `claude auth status` / `.active` login is not used.
GET /vps is the VPS badge from the same read: can the console see the build accounts on the host (live, or the host
dispatcher's snapshot and how old it is).

POST /test runs one tiny request through the AI assistant's model service (axf.llm@1), on demand only (Settings → Badges →
AI assistant test): `ok`, `no-credit` or `error`; GET /status returns the last result (no reply text, no keys).
GET /usage is the usage meter: 5-hour and weekly use of every saved Claude login (server/usage_host.py on the host, plain HTTP,
no model call). Cached 5 minutes in memory and on disk; `?refresh=1` reads again, at most every 30 s. A login whose copy can't
be read keeps its last numbers with the time they are from, so the list never goes blank.

GET /amberx says whether the AmberX phone is connected: axHub's `amberx.recorder_status` through axf.vinny@1, which runs at
once (no veto, no tokens). Cached for a minute.
Nothing here names another plugin: no service = "AI unavailable" / "can't tell whether Claude can build".
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


# ---------------------------------------------------------------------- can Claude build (Claude + VPS badges)

BUILD_TTL_S = 30.0
BUILD_MIN_S = 5.0
SNAPSHOT_OLD_MIN = 10
_build_lock = threading.Lock()
_build: dict[str, Any] = {"at": 0.0, "value": None}


def build_classify(r: dict[str, Any]) -> tuple[str, str]:
    """(state, line) for the Claude badge from the dispatcher's ready read: green when one build account or more can sign
    in and has credits, red when none can."""
    n, total = int(r.get("ready") or 0), int(r.get("total") or 0)
    if n > 0:
        return "ok", f"Claude can build: {n} of {total} build account{'s' if total != 1 else ''} ready"
    if not total:
        return "error", "Claude can't build: no build account found" + (f" ({r.get('why')})" if r.get("why") else "")
    return "error", f"Claude can't build: none of {total} build account{'s' if total != 1 else ''} can sign in with credits left"


def vps_classify(source: str, at: str, why: str, now_ms: int) -> tuple[str, bool, str]:
    """(state, reachable, line) for the VPS badge: can the console see the build accounts on the host? `host` = read live,
    `snapshot` = the host dispatcher's account snapshot (amber once it is over 10 minutes old: the host tick stopped),
    `none` = nothing to read. Never the root `claude auth status`."""
    if source == "host":
        return "ok", True, "The console reads the build accounts on the VPS live"
    if source == "snapshot":
        t = _ms(at)
        age = (now_ms - t) // 60000 if t else -1
        if 0 <= age <= SNAPSHOT_OLD_MIN:
            return "ok", True, f"The VPS dispatcher reported the build accounts {age} min ago"
        return "warn", True, f"The VPS dispatcher's account snapshot is {age if age >= 0 else '?'} min old: its tick may have stopped"
    return "error", False, why or "The console can't see the build accounts on the VPS"


def _clean_account(a: Any) -> dict[str, Any] | None:
    if not isinstance(a, dict) or not a.get("name"):
        return None
    tri = lambda v: v if isinstance(v, bool) else None  # noqa: E731
    return {"name": str(a["name"])[:40], "label": str(a.get("label") or "")[:40], "kind": "api" if a.get("kind") == "api" else "subscription",
            "ready": a.get("ready") is True, "signedIn": tri(a.get("signedIn")), "credits": tri(a.get("credits")), "fable": tri(a.get("fable")),
            "healthAt": str(a.get("healthAt") or "")[:40], "why": str(a.get("why") or "")[:200]}


def read_build(refresh: bool = False) -> dict[str, Any]:
    """Can Claude build? The orchestrator's ready read (axf.build-dispatch@1): the dispatcher's own check over the latest
    account health sweep. Plain reads, no model call, no login touched. Cached 30 s; refresh reads again (at most every 5 s)."""
    with _build_lock:
        now = time.time()
        value = _build["value"]
        if value is not None and now - _build["at"] < (BUILD_MIN_S if refresh else BUILD_TTL_S):
            return {**value, "cached": True}
        now_ms = int(now * 1000)
        res: dict[str, Any] = {"at": now_ms, "ok": False, "state": "off", "ready": 0, "total": 0, "accounts": [], "source": "none", "from": "",
                               "healthAt": "", "text": "", "error": "", "vps": {}}
        svc = plugin_services.get("axf.build-dispatch@1")
        if svc is None or not hasattr(svc, "ready"):
            res["text"] = res["error"] = "The build orchestrator is off, so the console can't tell whether Claude can build"
        else:
            try:
                r = svc.ready()
                accounts = [c for c in (_clean_account(a) for a in r.get("accounts") or []) if c]
                res.update(ready=sum(1 for a in accounts if a["ready"]), total=len(accounts), accounts=accounts, source=str(r.get("source") or "none"),
                           **{"from": str(r.get("from") or "")[:40]}, healthAt=str(r.get("health") or "")[:40])
                state, line = build_classify({**r, "ready": res["ready"], "total": res["total"]})
                res.update(ok=state == "ok", state=state, text=line, error="" if state == "ok" else str(r.get("why") or "")[:300])
            except Exception as e:  # noqa: BLE001 — the badge says why instead of failing
                res["text"] = res["error"] = ("Can't read the build accounts: " + (str(getattr(e, "detail", "") or e).strip("'\"") or e.__class__.__name__))[:300]
        vs, reachable, vline = vps_classify(res["source"], res["from"], res["error"] if res["state"] == "off" else "", now_ms)
        res["vps"] = {"state": "off" if res["state"] == "off" else vs, "reachable": reachable, "text": vline if res["state"] != "off" else res["text"], "source": res["source"], "from": res["from"]}
        _build.update(at=now, value=res)
        return {**res, "cached": False}


def _owner(request: Request) -> bool:
    user = getattr(request.state, "axf_user", None)
    return user is None or bool(getattr(user, "admin", False))


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


@router.get("/build")
def build(request: Request, refresh: int = 0) -> dict[str, Any]:
    """The Claude badge: can Claude build, and which build accounts are ready (account names only for the owner)."""
    res = read_build(refresh == 1)
    return res if _owner(request) else {**res, "accounts": []}


@router.get("/vps")
def vps(refresh: int = 0) -> dict[str, Any]:
    """The VPS badge: can the console see the build accounts on the host (from the same read as /build)."""
    r = read_build(refresh == 1)
    v = r["vps"]
    return {"at": r["at"], "ok": v["state"] == "ok", "state": v["state"], "reachable": v["reachable"], "text": v["text"], "source": v["source"], "from": v["from"]}
