"""Systems check — server part. Mounted at /api/plugins/systems-check/ (console token, 404 when disabled).

Three sources of checks, all in one report:
  1. the built-in checks (checks.py: console token, credentials, GitHub, Anthropic, Hostinger, Coolify, axHub, data,
     VPS host items from deploy/console-doctor.sh);
  2. checks the codebase declares (derive.py: every plugin, its required services and its own self-checks, every
     project manifest, the shared data files) — found by reading the code, no AI;
  3. the saved AI routine (routine.py): with "Use AI" on, Mosses reads the codebase and adds checks, saved so they keep
     running when AI is off.
Plus What's new (whatsnew.py). Provides ``axf.syscheck@1`` (run_all) for the console's alerts.

  GET  check[?force=1&ai=1]         every check (cached 60 s unless forced); ai=1 refreshes the routine first when allowed
  POST check/{id}                   re-run one check
  POST secret | secret/clear        save / remove a console credential (core credential store; never returned)
  POST fix/{id}                     run a check's automatic fix
  GET  ai                           the AI switches + what they need (and which plugin would provide it)
  PUT  settings                     {ai: {systems, whatsnew}, whatsNewBanner}
  GET  routine | POST routine/run | DELETE routine
  GET  whats-new[?summary=1]         changes since the shared "seen" point (+ canClear: is this caller an admin)
  POST whats-new/seen               {head} admins only: mark everything up to head seen, for every viewer
"""
from __future__ import annotations

import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import console_context as cx
import plugin_services
from credentials import CREDENTIALS

from . import derive, routine, store, whatsnew
from .checks import HOST_SCRIPT, SERVICES, SysCheck

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SERVICES_ALL = [*SERVICES,
                {"id": "plugins", "label": "Plugins", "icon": "package", "description": "Every console plugin: loaded, what it needs, and its own declared self-checks."},
                {"id": "routine", "label": "AI routine", "icon": "sparkles", "description": "Checks Mosses worked out from the codebase, saved so they run without AI."}]


class Service:
    """axf.syscheck@1"""
    version = 1

    def __init__(self) -> None:
        self.core = SysCheck(cx.ROOT, cx.current_token, cx.persist_root, cx.PLUGINS, cx.log, cx.GITHUB_REPO)
        self._cache: tuple[float, list[dict[str, Any]]] | None = None

    def run_all(self, force: bool = False) -> list[dict[str, Any]]:
        if self._cache and not force and time.time() - self._cache[0] < 60:
            return self._cache[1]
        items = self.core.run_all(force=True)
        try:
            items += derive.derive(self.core.item)
        except Exception as e:  # noqa: BLE001
            items.append(self.core.item("derived", "plugins", "Codebase checks", "unknown", f"couldn't read the codebase: {str(e)[:160]}", order=70))
        items += routine.run_saved(self.core.item)
        items.sort(key=lambda c: (c["order"], c["id"]))
        self._cache = (time.time(), items)
        return items

    def run_one(self, cid: str) -> dict[str, Any]:
        if cid in self.core.checks:
            return self.core.run_one(cid)
        hit = next((c for c in self.run_all(force=True) if c["id"] == cid), None)
        if not hit:
            raise KeyError(f"no check {cid}")
        return hit

    def invalidate(self) -> None:
        self._cache = None
        self.core._cache = None  # noqa: SLF001


SVC = Service()
plugin_services.provide("axf.syscheck@1", SVC, FOLDER)


def _ai_allowed(kind: str) -> bool:
    return bool(store.settings()["ai"].get(kind)) and derive.requirement_status()["ok"]


def _report(items: list[dict[str, Any]], extra: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"at": int(time.time() * 1000), "services": SERVICES_ALL, "checks": items, "hostScript": HOST_SCRIPT,
            "counts": {s: sum(1 for c in items if c["status"] == s) for s in ("ok", "warn", "error", "info", "unknown")}, **(extra or {})}


@router.get("/check")
def check(force: bool = False, ai: bool = False) -> dict[str, Any]:
    note = None
    if ai and _ai_allowed("systems") and routine.stale():
        try:
            routine.generate(SVC.run_all(force=True))
            SVC.invalidate()
            force = True
        except Exception as e:  # noqa: BLE001 — the check still runs without the new routine
            note = f"AI routine not refreshed: {str(e)[:200]}"
    r = store.routine()
    return _report(SVC.run_all(force), {"routine": {"source": r.get("source"), "generatedAt": r.get("generatedAt"), "checks": len(r.get("checks", [])),
                                                    "stale": routine.stale()} if r else None, "aiNote": note, "aiOn": _ai_allowed("systems")})


@router.post("/check/{cid:path}")
def check_one(cid: str) -> dict[str, Any]:
    try:
        c = SVC.run_one(cid)
    except KeyError as e:
        raise HTTPException(404, str(e).strip("'\"")) from None
    SVC.invalidate()
    return c


class SecretReq(BaseModel):
    key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")
    value: str = Field(min_length=1, max_length=500)


class ClearReq(BaseModel):
    key: str = Field(pattern=r"^[A-Z][A-Z0-9_]{1,63}$")


def _related(key: str) -> list[str]:
    return {"GITHUB_TOKEN": ["github-token"], "ANTHROPIC_API_KEY": ["anthropic-key"], "HOSTINGER_API_TOKEN": ["hostinger-token"],
            "COOLIFY_URL": ["coolify"], "COOLIFY_TOKEN": ["coolify"], "AXHUB_URL": ["axhub"], "AXHUB_TOKEN": ["axhub"], "MOSHI_SSH_PUBKEY": ["moshi-key"]}.get(key, [])


@router.post("/secret")
def set_secret(req: SecretReq) -> dict[str, Any]:
    meta = CREDENTIALS.get(req.key)
    if not meta:
        raise HTTPException(400, f"{req.key} isn't a credential the console stores")
    value = req.value.strip()
    if "\n" in value or "\r" in value or not re.match(meta["pattern"], value):
        raise HTTPException(400, f"That doesn't look right for {meta['label']} (expected: {meta['placeholder']}).")
    SVC.core.store.set(req.key, value.rstrip("/") if not meta["secret"] else value)
    SVC.invalidate()
    cx.log("system", f"{meta['label']} saved (server-side, owner-only)", "ok")
    return {"ok": True, "key": req.key, "checks": [SVC.core.run_one(c) for c in _related(req.key)]}


@router.post("/secret/clear")
def clear_secret(req: ClearReq) -> dict[str, Any]:
    if req.key not in CREDENTIALS:
        raise HTTPException(400, "unknown credential")
    SVC.core.store.clear(req.key)
    SVC.invalidate()
    cx.log("system", f"{CREDENTIALS[req.key]['label']} removed", "warn")
    return {"ok": True, "checks": [SVC.core.run_one(c) for c in _related(req.key)]}


@router.post("/fix/{cid}")
def fix(cid: str) -> dict[str, Any]:
    fn = SVC.core.fixes.get(cid)
    if not fn:
        raise HTTPException(400, "this check has no automatic fix")
    msg = fn()
    SVC.invalidate()
    cx.log("system", f"{cid}: {msg}", "ok")
    return {"ok": True, "message": msg, "check": SVC.core.run_one(cid)}


# ---------------------------------------------------------------- AI switches + routine

@router.get("/ai")
def ai_status() -> dict[str, Any]:
    req = derive.requirement_status()
    s = store.settings()
    return {"requirements": req, "settings": s, "effective": {k: bool(s["ai"].get(k)) and req["ok"] for k in ("systems", "whatsnew")}}


@router.post("/ai/test")
def ai_test() -> dict[str, Any]:
    """Test the AI connection the switches use: one tiny request through the AI assistant (axf.llm@1), as Mosses.
    Works whether or not the switches are on. Never returns keys; the reply is cut short."""
    req = derive.requirement_status()
    if not req["ok"]:
        missing = [x for x, ok in (("the AI assistant", req["assistant"]["ok"]), ("the Mosses agent", req["mosses"]["ok"])) if not ok]
        raise HTTPException(409, f"Install {' and '.join(missing)} first")
    llm = plugin_services.get("axf.llm@1")
    agent = (plugin_services.get("axf.agents@1").get_agent(derive.MOSSES) or {})
    started = time.time()
    try:
        out = llm.complete([{"role": "user", "content": "Connection test from the systems check. Reply with one short line that starts with OK."}],
                           system=(agent.get("system_prompt") or "")[:20000], params={"temperature": 0, "max_tokens": 60})
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip("'\"")[:300] or e.__class__.__name__
        cx.log("system", f"AI connection test failed: {msg}", "error")
        return {"ok": False, "error": msg, "agent": agent.get("name") or "Mosses", "ms": int((time.time() - started) * 1000)}
    text = str(out.get("text") or "").strip()
    res = {"ok": bool(text), "agent": agent.get("name") or "Mosses", "model": out.get("model") or "", "profile": out.get("profile") or "",
           "ms": int((time.time() - started) * 1000), "reply": text[:200], "error": "" if text else "the model answered with nothing"}
    cx.log("system", f"AI connection test: {'ok' if res['ok'] else 'empty reply'} ({res['model'] or 'model unknown'}, {res['ms']} ms)", "ok" if res["ok"] else "warn")
    return res


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    want = body.get("ai") if isinstance(body.get("ai"), dict) else {}
    if any(want.get(k) for k in ("systems", "whatsnew")) and not derive.requirement_status()["ok"]:
        raise HTTPException(409, "Install the AI assistant and the Mosses agent first (see what's missing above the switches)")
    s = store.save_settings(body)
    SVC.invalidate()
    return s


@router.get("/routine")
def get_routine() -> dict[str, Any]:
    return {"routine": store.routine(), "stale": routine.stale(), "kinds": list(routine.KINDS)}


@router.post("/routine/run")
def run_routine() -> dict[str, Any]:
    if not _ai_allowed("systems"):
        raise HTTPException(409, "Turn on “Use AI for the systems check” first (it needs the AI assistant and Mosses)")
    try:
        r = routine.generate(SVC.run_all(force=True))
    except PermissionError as e:
        raise HTTPException(409, str(e)) from None
    except Exception as e:  # noqa: BLE001
        raise HTTPException(502, f"the AI run failed: {str(e)[:300]}") from None
    SVC.invalidate()
    return {"routine": r}


@router.delete("/routine")
def delete_routine() -> dict[str, Any]:
    store.clear_routine()
    SVC.invalidate()
    return {"ok": True}


# ---------------------------------------------------------------- What's new

def _admin(request: Request) -> tuple[bool, str]:
    """Who may clear What's new: the console token or a hub admin (fail closed when the caller is unknown)."""
    c = getattr(request.state, "axf_user", None)
    return bool(c is not None and getattr(c, "admin", False)), str(getattr(c, "name", "") or "")


def _plugin_versions() -> dict[str, str]:
    return {p["folder"]: p["version"] for p in whatsnew.plugins()}


@router.get("/whats-new")
def whats_new(request: Request, summary: bool = False) -> dict[str, Any]:
    """Changes since the shared seen point. The point lives on the server, so clearing it clears it for everyone."""
    seen = store.whats_new_seen()
    try:
        r = whatsnew.commits(seen["sha"] if seen else "")
    except Exception as e:  # noqa: BLE001
        r = {"head": "", "commits": [], "known": False, "error": str(e)[:200]}
    r["plugins"] = whatsnew.plugins()
    if seen is None and r.get("head"):  # first run: start counting from now
        seen = store.save_whats_new_seen(r["head"], _plugin_versions(), "first run")
        r["commits"], r["known"] = [], True
    r["seen"] = seen
    r["canClear"] = _admin(request)[0]
    r["banner"] = store.settings().get("whatsNewBanner", True)
    r["aiOn"] = _ai_allowed("whatsnew")
    if summary and r["commits"] and r.get("known"):
        try:
            if r["aiOn"]:
                r["summary"] = whatsnew.summarize(r["commits"])
            else:
                import hashlib
                key = hashlib.sha256((r["commits"][-1]["sha"] + ".." + r["commits"][0]["sha"]).encode()).hexdigest()[:24]
                hit = store.summary(key)
                if hit:
                    r["summary"] = {**hit, "cached": True}
        except Exception as e:  # noqa: BLE001
            r["summaryError"] = str(e)[:200]
    return r


class SeenBody(BaseModel):
    head: str = Field(..., min_length=7, max_length=40)


@router.post("/whats-new/seen")
def whats_new_seen(body: SeenBody, request: Request) -> dict[str, Any]:
    """Admins only: everything up to `head` (what the admin was shown) is seen, for every viewer."""
    ok, who = _admin(request)
    if not ok:
        raise HTTPException(403, "only an admin can clear What's new")
    h = body.head.strip().lower()
    if not whatsnew.SHA.match(h):
        raise HTTPException(400, "head is a commit id")
    try:
        whatsnew._git("cat-file", "-e", f"{h}^{{commit}}")
        whatsnew._git("merge-base", "--is-ancestor", h, "HEAD")
    except Exception:  # noqa: BLE001
        raise HTTPException(400, "head isn't a commit on the console's branch") from None
    return {"seen": store.save_whats_new_seen(h, _plugin_versions(), who)}
