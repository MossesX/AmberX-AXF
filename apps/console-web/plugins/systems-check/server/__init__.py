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
  POST autofix/{id} | GET autofix   Auto fix a VPS host check: its fixed command through axHub's vps.run (approval pops up)
  GET  claude | POST claude/{id}    Claude on failure: a failed fix handed to headless Claude Code on the VPS (setting
                                    claudeOnFail; vps.run, so it needs approval; reports on a change-log entry = building banner)
  GET  ai                           the AI switches + what they need (and which plugin would provide it)
  PUT  settings                     {ai: {systems, whatsnew}, whatsNewBanner}
  GET  routine | POST routine/run | DELETE routine
  GET  whats-new[?summary=1]         changes since the shared "seen" point (+ canClear: is this caller an admin)
  POST whats-new/seen               {head} admins only: mark everything up to head seen, for every viewer
"""
from __future__ import annotations

import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

import console_context as cx
import plugin_services
from credentials import CREDENTIALS

from . import claudefix, derive, hostfix, routine, store, whatsnew
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

    def activity(self) -> list[dict[str, Any]]:
        """Work in progress for any activity feed (read through this service, no plugin named): VPS Auto fix jobs."""
        labels = {i.get("id"): i.get("label") or i.get("title") for i in (self._cache[1] if self._cache else [])}
        out = []
        for j in HOSTFIX.all():
            state = {"asking": "running", "waiting": "waiting", "running": "running", "done": "done", "failed": "failed"}.get(j.get("state"), "running")
            out.append({"id": f"syscheck:autofix:{j['id']}", "kind": "fix", "state": state,
                        "title": f"VPS Auto fix: {labels.get(j['id']) or j['id']}",
                        "detail": f"{j.get('message', '')}\n$ {j.get('command', '')}".strip(),
                        "startedAt": j.get("startedAt"), "updatedAt": j.get("updatedAt") or j.get("startedAt"),
                        "finishedAt": j.get("updatedAt") if state in ("done", "failed") else None})
        for j in CLAUDE.all():  # sessions handed to headless Claude Code; once launched, its change-log entry reports instead
            if j.get("state") not in ("asking", "waiting", "failed"):
                continue
            state = {"asking": "running", "waiting": "waiting", "failed": "failed"}[j["state"]]
            out.append({"id": f"syscheck:claude:{j['id']}", "kind": "build", "state": state, "title": f"Claude on the VPS: {j.get('title') or j['id']}",
                        "detail": str(j.get("message", "")), "startedAt": j.get("startedAt"), "updatedAt": j.get("updatedAt") or j.get("startedAt"),
                        "finishedAt": j.get("updatedAt") if state == "failed" else None})
        return out

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
    try:
        msg = fn()
    except HTTPException as e:
        _hand_to_claude(cid, f"the console's fix failed: {e.detail}")
        raise
    except Exception as e:  # noqa: BLE001
        _hand_to_claude(cid, f"the console's fix failed: {str(e)[:200]}")
        raise HTTPException(500, f"the fix failed: {str(e)[:200]}") from None
    SVC.invalidate()
    cx.log("system", f"{cid}: {msg}", "ok")
    after = SVC.core.run_one(cid)
    claude = _hand_to_claude(cid, f"the console's fix ran ({msg}) but the check still fails: {after.get('summary', '')}", after) \
        if after.get("status") not in ("ok", "info") else None
    return {"ok": True, "message": msg, "check": after, "claude": claude}


# ---------------------------------------------------------------- Claude on failure (headless Claude Code on the VPS)

CLAUDE = claudefix.Launches(store.settings)


def _hand_to_claude(cid: str, why: str, check: dict[str, Any] | None = None, force: bool = False) -> dict[str, Any] | None:
    """Hand a failed fix to headless Claude Code on the VPS when the setting is on (never raises)."""
    try:
        c = check or SVC.run_one(cid)
        job = CLAUDE.maybe_launch(c, why, force=force)
        if job and job.get("state") == "asking":
            cx.log("system", f"{cid}: fix failed, asked axHub to start Claude Code on the VPS (needs your approval)", "info")
        return job
    except Exception:  # noqa: BLE001
        return None


class ClaudeReq(BaseModel):
    reason: str = Field(default="", max_length=400)
    force: bool = False


@router.get("/claude")
def claude_list() -> dict[str, Any]:
    """The setting, and every hand-over to headless Claude Code (state, approval, entry id, branch)."""
    s = store.settings()
    return {"on": bool(s.get("claudeOnFail")), "shell": bool(s.get("claudeShell")), "hubToken": bool(os.environ.get("AXHUB_TOKEN")),
            "changes": plugin_services.get(claudefix.CHANGES) is not None,
            "jobs": {j["id"]: {k: v for k, v in j.items() if k != "command"} for j in CLAUDE.all()}}


@router.post("/claude/{cid:path}")
def claude_start(cid: str, req: ClaudeReq) -> dict[str, Any]:
    """A fix failed in the browser (Fix all): hand it over if the setting is on. `force` = by hand, skips the cooldown."""
    if not store.settings().get("claudeOnFail"):
        raise HTTPException(409, "Turn on “Hand failed fixes to Claude Code on the VPS” first")
    try:
        c = SVC.run_one(cid)
    except KeyError:
        raise HTTPException(404, f"no check {cid}") from None
    if c.get("status") in ("ok", "info"):
        return {"ok": True, "job": None, "message": "It passes now: nothing to hand over."}
    job = _hand_to_claude(cid, req.reason or "a fix failed in the console", c, req.force)
    if not job:
        raise HTTPException(400, "This check can't be handed over")
    return {"ok": True, "job": {k: v for k, v in job.items() if k != "command"}}


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
        _AI_STATE.update({"ok": False, "model": "", "error": msg, "at": time.time()})
        return {"ok": False, "error": msg, "agent": agent.get("name") or "Mosses", "ms": int((time.time() - started) * 1000)}
    text = str(out.get("text") or "").strip()
    res = {"ok": bool(text), "agent": agent.get("name") or "Mosses", "model": out.get("model") or "", "profile": out.get("profile") or "",
           "ms": int((time.time() - started) * 1000), "reply": text[:200], "error": "" if text else "the model answered with nothing"}
    _AI_STATE.update({"ok": res["ok"], "model": res["model"], "error": res["error"], "at": time.time()})
    cx.log("system", f"AI connection test: {'ok' if res['ok'] else 'empty reply'} ({res['model'] or 'model unknown'}, {res['ms']} ms)", "ok" if res["ok"] else "warn")
    return res


_AI_STATE: dict[str, Any] = {"ok": False, "model": "", "error": "not tested yet", "at": 0.0}
AI_STATE_TTL = 300


@router.get("/ai/state")
def ai_state(refresh: bool = False) -> dict[str, Any]:
    """Is Claude connected and working? The last connection test, re-run when older than 5 minutes (or on refresh).
    Key Auto fix is only offered while this is ok."""
    req = derive.requirement_status()
    if not req["ok"]:
        missing = [x for x, ok in (("the AI assistant", req["assistant"]["ok"]), ("the Mosses agent", req["mosses"]["ok"])) if not ok]
        return {"ok": False, "model": "", "error": f"Claude isn't connected: install {' and '.join(missing)} first", "at": time.time()}
    if refresh or time.time() - float(_AI_STATE["at"]) > AI_STATE_TTL:
        ai_test()
    return dict(_AI_STATE)


# Where each key is made, pre-filled where the site allows it (GitHub fine-grained token template URL, decision: Oct 20 2026).
def _create_page(key: str) -> str:
    import os
    import urllib.parse as up
    if key == "GITHUB_TOKEN":
        q = {"name": "AXF Dev Console", "description": "AmberX AXF Dev Console on the VPS: clone updates, CI downloads, Build Pilot APKs, plugin publishing",
             "target_name": "MossesX", "expires_in": "90", "contents": "write", "actions": "write", "metadata": "read"}
        return "https://github.com/settings/personal-access-tokens/new?" + up.urlencode(q)
    if key == "ANTHROPIC_API_KEY":
        return "https://console.anthropic.com/settings/keys"
    if key == "HOSTINGER_API_TOKEN":
        return "https://hpanel.hostinger.com/profile/api"
    if key == "COOLIFY_TOKEN":
        base = (os.environ.get("COOLIFY_URL") or "").rstrip("/")
        # http://coolify:8080 only works inside the VPS, so there's no page to open from a phone for it.
        return f"{base}/security/api-tokens" if re.match(r"^https?://[^\s/]+(:\d+)?$", base) and "//coolify:" not in base else ""
    if key == "AXHUB_TOKEN":
        base = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
        return base if re.match(r"^https://[^\s/]+$", base) else ""
    return ""


@router.post("/keys/{key}/guide")
def key_guide(key: str) -> dict[str, Any]:
    """Key Auto fix (Claude connected only): the page where this key is made (pre-filled when the site allows) plus
    Claude's short steps for exactly this console's needs. The key itself is never fetched or made here: you paste it,
    and the console tests it on save. axHub's vault is write-only, so the hub never hands keys out."""
    meta = CREDENTIALS.get(key)
    if not meta or not meta.get("secret"):
        raise HTTPException(404, "not a key the console asks for")
    st = ai_state()
    if not st["ok"]:
        raise HTTPException(409, st["error"] or "Claude isn't connected")
    url = _create_page(key)
    llm = plugin_services.get("axf.llm@1")
    prompt = (f"Brett needs a {meta['label']} for the AmberX AXF Dev Console (it runs on his VPS). What it needs: {meta['help']} "
              f"{'He will open this page: ' + url if url else 'There is no direct page for it.'} "
              "Write 3 to 5 numbered steps, each under 20 words, for making it on his phone and pasting it into the console's field. "
              "Plain words, no preamble, never ask him to share the key with anyone.")
    try:
        out = llm.complete([{"role": "user", "content": prompt}], system="You write short, exact setup steps.", params={"temperature": 0, "max_tokens": 300})
    except Exception as e:  # noqa: BLE001
        _AI_STATE.update({"ok": False, "error": str(e)[:300], "at": time.time()})
        raise HTTPException(409, f"Claude isn't connected: {str(e)[:200]}") from None
    steps = [ln.strip() for ln in str(out.get("text") or "").splitlines() if ln.strip()][:6]
    cx.log("system", f"key Auto fix guide for {meta['label']}", "ok")
    return {"key": key, "label": meta["label"], "url": url, "steps": steps, "model": out.get("model") or ""}


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


# ---------------------------------------------------------------- Auto fix for VPS host checks (through axHub)

HOSTFIX = hostfix.Jobs(lambda cid: SVC.invalidate(), on_fail=lambda cid, why: _hand_to_claude(cid, why))


@router.get("/autofix")
def autofix_list() -> dict[str, Any]:
    """Which host checks Auto fix can run (and their exact commands), and every job's state."""
    return {"commands": {k: hostfix.command(k) for k in hostfix.FIX_COMMANDS}, "jobs": {k: HOSTFIX.get(k) for k in list(HOSTFIX.jobs)}}


@router.post("/autofix/{cid}")
def autofix_start(cid: str) -> dict[str, Any]:
    if not HOSTFIX.allowed(cid):
        raise HTTPException(400, "This one needs you at the machine: follow its steps.")
    try:
        job = HOSTFIX.start(cid)
    except hostfix.HubError as e:
        raise HTTPException(409, str(e)) from None
    cx.log("system", f"Auto fix {cid}: asked axHub to run its fix (needs your approval)", "info")
    return job

