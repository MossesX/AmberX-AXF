"""Plan Studio (server part). Mounted at /api/plugins/plan-studio/ (console token on every route, 404 while off,
never on the console MCP). Every read and write goes through the plugin's CLI (plans.mjs api), so the console, the CLI,
claude.ai sessions (axHub memory_write on the same files) and the AmberX app share one set of rules.

  GET  state        plans, categories, templates, saved views, build profiles (+ live build progress synced)
  POST api          {op, …} one change: get | save | delete | restore | bulk | category | template-save | template-delete
                    | view-save | view-delete | import | export | catalog | feature | plan-feature | build | sync-builds | mirror-builds | check-builds
                    | ai-apply
  GET  catalog      every plugin / app / library / module / axHub with its features (have / partial / planned / idea)
  GET  ai/status    is an AI provider there (axf.llm@1, the AI assistant's providers)?
  POST ai           {text, plan?} plain English → edits (not applied: the page shows them as a diff, then ai-apply).
                    Rules first (no model); anything else goes to axf.llm@1 with the plugin's prompt.

Capability plans@1: other plugins read and add plans through plugin_services.get("plans@1") (list/get/save/ai).
"""
from __future__ import annotations

import json
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import plugin_services

router = APIRouter()
FOLDER = "plan-studio"
CLI = Path(__file__).resolve().parent.parent / "plans.mjs"
ROOT = CLI.parents[4]
OPS = {"get", "save", "delete", "restore", "bulk", "category", "template-save", "template-delete", "view-save", "view-delete",
       "import", "export", "catalog", "feature", "plan-feature", "build", "sync-builds", "ai-apply"}


def run(req: dict[str, Any], timeout: int = 90) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), "api"], input=json.dumps(req), cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "error": f"Plan Studio could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:]}


def _by(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    return str(getattr(user, "name", "") or "console")


def _llm():
    return plugin_services.get("axf.llm@1")


@router.get("/state")
def state() -> dict[str, Any]:
    return run({"op": "state"})


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    return run({"op": "catalog"})


@router.post("/api")
async def api(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict) or body.get("op") not in OPS:
        raise HTTPException(400, f"op must be one of {', '.join(sorted(OPS))}")
    return run({**body, "by": _by(request)})


@router.get("/ai/status")
def ai_status() -> dict[str, Any]:
    svc = _llm()
    if not svc:
        return {"ok": True, "available": False, "setup": "ai-assistant.open", "message": "No AI provider: install or switch on the AI assistant and add a provider (Settings → AI)."}
    try:
        profs = svc.profiles()
    except Exception:  # noqa: BLE001 — a provider problem is shown, not raised
        profs = []
    return {"ok": True, "available": True, "profiles": [{"id": p.get("id"), "label": p.get("label"), "model": p.get("defaultModel")} for p in profs]}


@router.post("/ai")
async def ai(request: Request) -> dict[str, Any]:
    body = await request.json()
    text = str((body or {}).get("text") or "").strip()[:4000]
    plan = str((body or {}).get("plan") or "")
    if not text:
        raise HTTPException(400, "say what to add or change")
    first = run({"op": "ai", "text": text, "plan": plan})
    if not first.get("needsAi"):
        return first
    svc = _llm()
    if not svc:
        return {**first, "aiMissing": True}
    prompt = run({"op": "ai-prompt", "text": text, "plan": plan})
    if not prompt.get("ok"):
        return prompt
    try:
        out = svc.complete(prompt["messages"], system=prompt["system"], params={"max_tokens": 1500})
    except Exception as e:  # noqa: BLE001 — shown to the person
        return {"ok": False, "error": f"The AI provider failed: {str(e)[:300]}"}
    return {**run({"op": "ai", "text": text, "plan": plan, "reply": out.get("text") or ""}), "model": out.get("model") or ""}


class PlansService:
    """plans@1: other plugins' server parts read and add plans without naming this folder."""

    contract = "plans@1"

    def list(self) -> list[dict[str, Any]]:
        return run({"op": "state"}).get("plans", [])

    def get(self, plan_id: str) -> dict[str, Any] | None:
        r = run({"op": "get", "id": plan_id})
        return r.get("plan") if r.get("ok") else None

    def save(self, plan: dict[str, Any], by: str = "", force: bool = False) -> dict[str, Any]:
        return run({"op": "save", "plan": plan, "by": by, "force": force})

    def park(self, title: str, summary: str = "", category: str = "", by: str = "") -> dict[str, Any]:
        """"Put it in a plan for later": a parked plan, never a build."""
        return run({"op": "save", "plan": {"title": title, "summary": summary, "category": category, "status": "parked"}, "by": by, "force": True})

    def ai(self, text: str, plan_id: str = "") -> dict[str, Any]:
        return run({"op": "ai", "text": text, "plan": plan_id})


plugin_services.provide("plans@1", PlansService(), FOLDER)


# build-mirror@1 (Brett, Nov 8 2026): every open orchestrator build has its stepped plan here, steps matching the split
# exactly. A mismatch is a systems check item (red, pushed once) whose auto-fix re-mirrors the plans from the store.
HEALTH_ID = "plan-studio-build-mirror"
_health_done = False


def mirror_probe() -> dict[str, Any]:
    r = run({"op": "check-builds"}, timeout=120)
    if "mismatches" not in r:
        return {"status": "warn", "summary": f"Plan Studio couldn't check the build plans: {r.get('error') or 'no answer'}."}
    bad = r["mismatches"]
    if not bad:
        return {"status": "ok", "summary": "Every open build has its stepped plan in Plan Studio, steps in sync."}
    names = ", ".join(m["build"] for m in bad[:4])
    return {"status": "error", "summary": f"{len(bad)} build(s) out of sync with their Plan Studio plan: {names}.",
            "details": [f"{m['build']} → {m.get('plan') or '(no plan)'}: " + "; ".join(f"{p.get('step') or '-'} {p.get('field')}" for p in m["problems"][:6]) for m in bad[:40]]}


def mirror_fix() -> dict[str, Any]:
    r = run({"op": "mirror-builds", "by": "systems-check"}, timeout=300)
    if not r.get("ok"):
        return {"state": "failed", "message": r.get("error") or "mirror failed"}
    return {"state": "done", "message": f"Re-mirrored the plans: {len(r.get('created', []))} made, {len(r.get('updated', []))} updated."}


def ensure_health() -> bool:
    """Registers the check on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "Plan Studio plans match the builds", "service": "console", "order": 63, "severity": "error",
                      "run": mirror_probe,
                      "autoFix": {"label": "Re-mirror the plans", "run": mirror_fix},
                      "breaks": "Plan Studio shows a build's steps that differ from what the orchestrator will build.",
                      "instructions": ["Run `node apps/console-web/plugins/plan-studio/plans.mjs check-builds` to see the drift.",
                                       "`plans.mjs mirror-builds` rebuilds every open build's plan from the builds store."]}, FOLDER)
    except Exception:  # noqa: BLE001 — Plan Studio works without its health item
        return False
    _health_done = True
    return True


def _register_later(tries: int = 12) -> None:
    if not ensure_health() and tries > 1:
        t = threading.Timer(5.0, _register_later, args=(tries - 1,))
        t.daemon = True
        t.start()


_register_later()
