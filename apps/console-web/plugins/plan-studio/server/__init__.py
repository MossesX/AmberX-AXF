"""Plan Studio (server part). Mounted at /api/plugins/plan-studio/ (console token on every route, 404 while off,
never on the console MCP). Every read and write goes through the plugin's CLI (plans.mjs api), so the console, the CLI,
claude.ai sessions (axHub memory_write on the same files) and the AmberX app share one set of rules.

  GET  state        plans, categories, templates, saved views, build profiles (+ live build progress synced)
  POST api          {op, …} one change: get | save | delete | restore | bulk | category | template-save | template-delete
                    | view-save | view-delete | import | export | catalog | feature | plan-feature | build | sync-builds
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
