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
  POST shipped      {manifest} or {build}: a shipped-manifest@1 for a build → the build's plan is created / updated with
                    every field; an invalid one is refused ({ok: false, refused, reason, errors}) and the plan flagged
  GET  shipped/{plan}   the manifest a plan carries (by plan or build id), its summary, actual cost, the flag
  POST shipped/backfill {since?, dry?} every stored manifest the plans have not taken yet
  GET  shipped-log  the last receipts (taken / refused, with the reason)
  GET  check-builds every shipped manifest has its plan, at its rev, valid and matching

Capability plans@1: other plugins read and add plans through plugin_services.get("plans@1") (list/get/save/ai/shipped).
"""
from __future__ import annotations

import json
import re
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
       "import", "export", "catalog", "feature", "plan-feature", "build", "sync-builds", "ai-apply",
       "shipped", "shipped-get", "shipped-backfill", "shipped-log", "check-builds"}
PLAN_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,79}$")


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


# ------------------------------------------------------------------ shipped manifests (shipped-manifest@1 → the build's plan)


@router.post("/shipped")
async def shipped(request: Request) -> dict[str, Any]:
    """Receive a build's shipped manifest: the build's plan is created or updated with every field; an invalid manifest is refused with the field errors and the plan flagged."""
    body = await request.json()
    body = body if isinstance(body, dict) else {}
    manifest = body.get("manifest") if isinstance(body.get("manifest"), dict) else (body if isinstance(body.get("build"), dict) else None)
    build = str(body.get("build") or body.get("build_id") or "").strip() if not isinstance(body.get("build"), dict) else ""
    if manifest is None and not PLAN_ID.match(build):
        raise HTTPException(400, "give a manifest (shipped-manifest@1) or a build id")
    req: dict[str, Any] = {"op": "shipped", "by": _by(request)}
    if manifest is not None:
        req["manifest"] = manifest
    else:
        req["build"] = build
    if body.get("source"):
        req["source"] = str(body["source"])[:40]
    return run(req, timeout=120)


@router.get("/shipped/{plan}")
def shipped_get(plan: str) -> dict[str, Any]:
    """The shipped manifest a plan carries (by plan or build id), its summary, actual cost and tokens, and the flag when the last one was refused."""
    if not PLAN_ID.match(plan):
        raise HTTPException(400, "bad plan id")
    r = run({"op": "shipped-get", "id": plan})
    if not r.get("ok"):
        raise HTTPException(404, r.get("error") or "no plan")
    return r


@router.post("/shipped/backfill")
async def shipped_backfill(request: Request) -> dict[str, Any]:
    """Receive every stored shipped manifest the plans have not taken yet (since = landings from that date; dry = list only)."""
    body = await request.json()
    body = body if isinstance(body, dict) else {}
    since = str(body.get("since") or "")[:25]
    if since and not re.match(r"^\d{4}-\d{2}-\d{2}", since):
        raise HTTPException(400, "since is a date (YYYY-MM-DD)")
    return run({"op": "shipped-backfill", "since": since, "dry": bool(body.get("dry")), "by": _by(request)}, timeout=600)


@router.get("/shipped-log")
def shipped_log(n: int = 50) -> dict[str, Any]:
    """The last shipped-manifest receipts: taken or refused, with the reason."""
    return run({"op": "shipped-log", "n": max(1, min(int(n), 500))})


@router.get("/check-builds")
def check_builds() -> dict[str, Any]:
    """Every shipped manifest has its plan, at the manifest's rev, valid and matching; flagged plans are listed as warnings."""
    return run({"op": "check-builds"}, timeout=120)


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

    def shipped(self, manifest: dict[str, Any], by: str = "", source: str = "") -> dict[str, Any]:
        """A shipped-manifest@1 for a build → its plan (refused with the field errors when invalid)."""
        return run({"op": "shipped", "manifest": manifest, "by": by, **({"source": source} if source else {})}, timeout=120)


plugin_services.provide("plans@1", PlansService(), FOLDER)
