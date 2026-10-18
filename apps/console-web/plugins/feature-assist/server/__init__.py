"""Feature assistant — server part. Mounted at /api/plugins/feature-assist/ (console token, 404 when disabled).

Two things for the Feature Planner (the console's Plan view), through its extension points:
  1. "Describe a feature": plain English → the AXF expert agent drafts proper plan entries (title, summary, area,
     kind, parent, sub-features, dependencies, ports, acceptance, model) and flags clashes; you edit and approve; they
     are written to the plan (framework/plan/plan.json → catalog/tracker sync) and, if you like, the pending list.
  2. "Build with Mosses" on a feature that isn't built: confirm → Mosses plans the work (files, modules, prerequisites)
     → a before/after build order → you pick the model (Opus now, Fable or park for Fable, Sonnet; Opus now + Fable
     later adds the Fable rebuild to the pending list) → approve → Mosses builds it in the AI assistant's chat, with
     approval cards and snapshots. You mark it built or partial when it's done.
Everything goes through capability services (axf.llm@1, axf.agents@1, axf.containers@1, axf.snapshots@1) and the build
engine (framework/cli/engine-rpc.mjs). Nothing here names another plugin.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services

router = APIRouter()
EXPERT = os.environ.get("AXF_FEATURE_EXPERT", "axf-expert")
MOSSES = os.environ.get("AXF_FEATURE_BUILDER", "coder")
MODELS = {"fable": "Fable", "opus": "Opus", "sonnet": "Sonnet"}
API_MODEL = {"fable": "claude-fable-5-1", "opus": "claude-opus-5-5", "sonnet": "claude-sonnet-5-5"}
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_FEATURE_ASSIST_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "feature-assist"))


def _log(entry: dict[str, Any]) -> None:
    p = data_dir() / "builds.jsonl"
    with _lock:
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
        with os.fdopen(fd, "a", encoding="utf-8") as f:
            f.write(json.dumps({"at": int(time.time() * 1000), **entry}) + "\n")


def _builds() -> list[dict[str, Any]]:
    try:
        return [json.loads(x) for x in (data_dir() / "builds.jsonl").read_text("utf-8").splitlines() if x.strip()]
    except (OSError, ValueError):
        return []


def engine(op: str, **args: Any) -> dict[str, Any]:
    r = subprocess.run(["node", str(cx.ROOT / "framework" / "cli" / "engine-rpc.mjs"), op, json.dumps(args)], cwd=str(cx.ROOT), capture_output=True, text=True, timeout=300)
    lines = r.stdout.strip().splitlines()
    try:
        out = json.loads(lines[-1]) if lines else {"ok": False, "error": r.stderr.strip()[-400:] or "no output"}
    except ValueError:
        out = {"ok": False, "error": (r.stderr or r.stdout).strip()[-400:]}
    for line in out.get("log", []):
        cx.log("plan", str(line).strip())
    if not out.get("ok"):
        raise RuntimeError(out.get("error") or f"{op} failed")
    return out


def _json_from(text: str) -> Any:
    m = re.search(r"\{.*\}", text or "", re.S)
    if not m:
        return None
    try:
        return json.loads(m.group(0))
    except ValueError:
        return None


def _status() -> dict[str, Any]:
    llm = plugin_services.get("axf.llm@1")
    agents = plugin_services.get("axf.agents@1")
    expert = mosses = None
    if agents:
        try:
            expert, mosses = agents.get_agent(EXPERT), agents.get_agent(MOSSES)
        except Exception:  # noqa: BLE001
            pass
    return {"assistant": llm is not None, "agents": agents is not None, "expert": bool(expert), "mosses": bool(mosses),
            "mossesName": (mosses or {}).get("name"), "expertName": (expert or {}).get("name"),
            "containers": plugin_services.get("axf.containers@1") is not None, "snapshots": plugin_services.get("axf.snapshots@1") is not None,
            "describe": bool(llm and expert), "build": bool(llm and mosses)}


def _ask(agent_id: str, prompt: str, max_tokens: int = 6000) -> tuple[Any, dict[str, Any]]:
    llm = plugin_services.get("axf.llm@1")
    agents = plugin_services.get("axf.agents@1")
    if not llm or not agents:
        raise PermissionError("needs the AI assistant and the agent manager")
    agent = agents.get_agent(agent_id)
    if not agent:
        raise PermissionError(f"the {agent_id} agent isn't installed (Agent manager → Add-on agents)")
    memory = ""
    try:
        memory = agents.memory_context(agent_id, prompt[:2000]) or ""
    except Exception:  # noqa: BLE001
        pass
    system = (agent.get("system_prompt") or "") + ("\n\nRelevant knowledge:\n" + memory if memory else "") + "\n\nFor this task reply with JSON only."
    out = llm.complete([{"role": "user", "content": prompt}], system=system, params={"temperature": 0.2, "max_tokens": max_tokens})
    return _json_from(out.get("text") or ""), {"agent": agent.get("name"), "llmModel": out.get("model")}


def _plan() -> list[dict[str, Any]]:
    return engine("plan").get("features", [])


def _slug(t: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", t.lower()).strip("-")[:40] or "feature"


def _err(e: Exception) -> HTTPException:
    if isinstance(e, PermissionError):
        return HTTPException(409, str(e))
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    return HTTPException(502, f"{type(e).__name__}: {str(e)[:300]}")


@router.get("/status")
def status() -> dict[str, Any]:
    s = _status()
    open_builds: dict[str, dict[str, Any]] = {}
    for b in _builds():
        if b.get("op") == "start":
            open_builds[b["feature"]] = b
        elif b.get("op") == "finish":
            open_builds.pop(b.get("feature"), None)
    return {**s, "building": open_builds}


# ---------------------------------------------------------------- 1. describe a feature

DRAFT = """Brett described a feature for the AmberX AXF framework in plain words (below). Turn it into proper Feature
Planner entries that fit the existing plan. Reply with JSON only:
{"features": [{"title": "...", "summary": "2-4 sentences", "area": "an existing area if one fits", "kind": "epic|feature|task",
  "parent": "existing feature id or empty", "dependsOn": ["existing ids"], "ports": {"web": "planned", "android": "planned"},
  "capabilities": ["short"], "acceptance": ["testable sentence"], "priority": "P0|P1|P2|P3", "model": "fable|opus|sonnet",
  "modelReason": "why", "where": "framework|port|plugin|app", "subFeatures": [same shape without subFeatures]}],
 "clashes": [{"text": "what clashes or duplicates (with an existing feature, a rule, or the catalog)", "featureId": "id or empty"}],
 "notes": "anything Brett should decide"}
Rules: status is always planned; prefer adding sub-features under an existing epic over a new epic; model: Fable for
kernel / cross-port contracts / heavy refactors, Opus for most work and anything security-related, Sonnet only for
simple self-contained UI or content."""


@router.post("/draft")
def draft(body: dict[str, Any]) -> dict[str, Any]:
    text = str(body.get("text") or "").strip()
    if not text or len(text) > 6000:
        raise HTTPException(400, "describe the feature in 1–6000 characters")
    try:
        feats = _plan()
        index = "\n".join(f"- {f['id']} [{f.get('status')}] {f.get('area')}: {f.get('title')}" for f in feats[:900])
        areas = sorted({f.get("area", "") for f in feats if f.get("area")})
        raw, meta = _ask(EXPERT, f"{DRAFT}\n\nAreas: {', '.join(areas)}\n\nExisting features (id [status] area: title):\n{index}\n\nBrett's description:\n\"\"\"\n{text}\n\"\"\"")
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    if not isinstance(raw, dict) or not isinstance(raw.get("features"), list):
        raise HTTPException(502, "the AXF expert didn't answer in the expected format; try again or reword it")
    ids = {f["id"] for f in feats}
    clean = [_clean_draft(f, ids) for f in raw["features"][:8] if isinstance(f, dict) and str(f.get("title") or "").strip()]
    return {"features": clean, "clashes": [c for c in raw.get("clashes", []) if isinstance(c, dict) and c.get("text")][:20],
            "notes": str(raw.get("notes") or "")[:1500], **meta}


def _clean_draft(f: dict[str, Any], ids: set[str]) -> dict[str, Any]:
    kind = f.get("kind") if f.get("kind") in ("epic", "feature", "task") else "feature"
    model = f.get("model") if f.get("model") in MODELS else "opus"
    ports = {p: str(v) for p, v in (f.get("ports") or {}).items() if p in ("web", "android", "python") and isinstance(v, str)}
    out = {"title": str(f["title"]).strip()[:120], "summary": str(f.get("summary") or "")[:1200], "area": str(f.get("area") or "Plugins & apps")[:60],
           "kind": kind, "parent": f.get("parent") if f.get("parent") in ids else "", "dependsOn": [d for d in f.get("dependsOn") or [] if d in ids][:20],
           "ports": ports, "capabilities": [str(x)[:80] for x in f.get("capabilities") or []][:12], "acceptance": [str(x)[:300] for x in f.get("acceptance") or []][:12],
           "priority": f.get("priority") if f.get("priority") in ("P0", "P1", "P2", "P3") else "P2", "model": model,
           "modelReason": str(f.get("modelReason") or "")[:300], "where": str(f.get("where") or "")[:30]}
    out["subFeatures"] = [_clean_draft({**s, "subFeatures": []}, ids) for s in (f.get("subFeatures") or [])[:12] if isinstance(s, dict) and s.get("title")] if f.get("subFeatures") else []
    return out


@router.post("/approve")
def approve(body: dict[str, Any]) -> dict[str, Any]:
    """Write the (edited) drafts to the plan; optionally add each to the pending list. Sub-features get the parent."""
    feats = body.get("features")
    if not isinstance(feats, list) or not feats:
        raise HTTPException(400, "features: the drafts to save")
    try:
        existing = {f["id"] for f in _plan()}
        saved: list[str] = []
        pending: list[str] = []

        def save(d: dict[str, Any], parent: str = "") -> str:
            d = _clean_draft(d, existing | set(saved))
            base = f"u.{_slug(d['title'])}"
            fid, n = base, 2
            while fid in existing or fid in saved:
                fid, n = f"{base}-{n}", n + 1
            ports = {p: {"status": v if v in ("planned", "placeholder", "partial", "built") else "planned", "where": ""} for p, v in d["ports"].items()}
            feature = {"id": fid, "title": d["title"], "area": d["area"], "kind": d["kind"], "status": "planned", "priority": d["priority"], "wave": 2,
                       "effort": "", "summary": d["summary"], "ports": ports, "capabilities": d["capabilities"], "dependsOn": d["dependsOn"], "catalog": [],
                       "modules": [], "files": [], "acceptance": [{"text": a, "done": False} for a in d["acceptance"]], "warnings": [], "recommendations": [],
                       "previews": [], "screenshots": [], "links": [], "tags": ["plain-english"], "notes": f"Drafted by the AXF expert ({d['where'] or 'framework'})",
                       "source": "user", "history": [], "model": d["model"], "modelReason": d["modelReason"] or "Suggested by the AXF expert"}
            if parent or d["parent"]:
                feature["parent"] = parent or d["parent"]
            engine("plan-upsert", feature=feature, note="Added from a plain-English description (AXF expert)")
            saved.append(fid)
            if body.get("pending", True):
                r = engine("pending-act", change={"action": "add", "title": d["title"], "detail": d["summary"], "model": MODELS[d["model"]], "planId": fid, "source": "feature-assist"})
                if r.get("item"):
                    pending.append(r["item"]["id"])
            for s in d.get("subFeatures") or []:
                save(s, fid)
            return fid

        for d in feats[:8]:
            if isinstance(d, dict) and str(d.get("title") or "").strip():
                save(d)
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    _log({"op": "describe", "saved": saved, "pending": pending})
    return {"saved": saved, "pending": pending}


# ---------------------------------------------------------------- 2. build with Mosses

PLAN_PROMPT = """Plan how to build this AmberX AXF feature (JSON below) in this repository. Use what you know about the
codebase. Reply with JSON only:
{"summary": "2-3 sentences", "steps": ["ordered, concrete"], "files": ["paths to add or change"], "modules": ["modules/plugins"],
 "prerequisites": ["existing feature ids that must be built first"], "assets": ["asset types/ids touched"],
 "risks": ["short"], "model": "fable|opus|sonnet", "modelReason": "why (Opus for anything security-related or touching servers; Fable for the kernel and cross-port contracts)"}"""


def _queue() -> dict[str, Any]:
    return engine("build-queue").get("view") or {}


def _step_of(fid: str, feats: dict[str, dict[str, Any]], order: list[str]) -> str | None:
    seen = set()
    cur: str | None = fid
    while cur and cur not in seen:
        if cur in order:
            return cur
        seen.add(cur)
        f = feats.get(cur) or {}
        cur = f.get("epic") or f.get("parent")
    return None


@router.post("/build/plan")
def build_plan(body: dict[str, Any]) -> dict[str, Any]:
    fid = str(body.get("featureId") or "")
    try:
        feats = {f["id"]: f for f in _plan()}
        f = feats.get(fid)
        if not f:
            raise KeyError(f"no feature {fid}")
        if f.get("status") == "built":
            raise ValueError("that feature is already built")
        deps = [{"id": d, "title": feats[d].get("title"), "status": feats[d].get("status")} for d in f.get("dependsOn", []) if d in feats]
        slim = {k: f.get(k) for k in ("id", "title", "area", "kind", "summary", "ports", "capabilities", "acceptance", "modules", "files", "epic", "parent", "status")}
        raw, meta = _ask(MOSSES, f"{PLAN_PROMPT}\n\nFeature:\n{json.dumps(slim, indent=1)}\n\nIts dependencies:\n{json.dumps(deps)}", max_tokens=5000)
        if not isinstance(raw, dict):
            raise RuntimeError("Mosses didn't answer in the expected format; try again")
        prereq = [p for p in dict.fromkeys([*(raw.get("prerequisites") or []), *f.get("dependsOn", [])]) if p in feats and feats[p].get("status") != "built"]
        q = _queue()
        order: list[str] = list(q.get("order") or [])
        target = _step_of(fid, feats, order)
        after = list(order)
        moved: list[str] = []
        if target:
            for p in prereq:
                ps = _step_of(p, feats, order)
                if ps and ps != target and after.index(ps) > after.index(target):
                    after.remove(ps)
                    after.insert(after.index(target), ps)
                    moved.append(ps)
        model = raw.get("model") if raw.get("model") in MODELS else (f.get("model") or "opus")
        titles = {s["id"]: s.get("title") for s in q.get("steps", [])}
        return {"feature": slim, "plan": {"summary": str(raw.get("summary") or "")[:1500], "steps": [str(s)[:400] for s in raw.get("steps") or []][:30],
                                          "files": [str(s)[:200] for s in raw.get("files") or []][:60], "modules": [str(s)[:120] for s in raw.get("modules") or []][:20],
                                          "assets": [str(s)[:120] for s in raw.get("assets") or []][:20], "risks": [str(s)[:300] for s in raw.get("risks") or []][:12],
                                          "prerequisites": prereq},
                "order": {"target": target, "before": order, "after": after, "moved": moved, "titles": titles, "changed": after != order},
                "model": {"recommend": model, "reason": str(raw.get("modelReason") or "")[:400]}, **meta}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/build/start")
def build_start(body: dict[str, Any]) -> dict[str, Any]:
    """Apply the approved order, record the model, park or start. Returns what the console needs to open the chat."""
    fid = str(body.get("featureId") or "")
    model = body.get("model")
    if model not in MODELS:
        raise HTTPException(400, "model is fable, opus or sonnet")
    plan = body.get("plan") if isinstance(body.get("plan"), dict) else {}
    try:
        feats = {f["id"]: f for f in _plan()}
        f = feats.get(fid)
        if not f:
            raise KeyError(f"no feature {fid}")
        order = body.get("order")
        if isinstance(order, list) and order:
            engine("build-reorder", order=[str(x) for x in order], by="feature-assist")
        added: list[str] = []
        detail = (plan.get("summary") or f.get("summary") or "") + ("\n\nSteps:\n" + "\n".join(f"- {s}" for s in plan.get("steps", [])) if plan.get("steps") else "")
        if model == "fable" and body.get("park", True):
            r = engine("pending-act", change={"action": "add", "title": f"Build {f['title']} with Mosses", "detail": detail[:4000], "model": "Fable", "planId": fid, "source": "feature-assist"})
            added.append(r["item"]["id"])
            _note(f, "Build with Mosses parked until Fable is available", model)
            _log({"op": "park", "feature": fid, "model": model, "pending": added})
            return {"parked": True, "pending": added}
        if body.get("fableLater") and model != "fable":
            r = engine("pending-act", change={"action": "add", "title": f"Fable rebuild: {f['title']}", "model": "Fable", "planId": fid, "source": "feature-assist",
                                              "detail": f"Built on {MODELS[model]} with Mosses. The Fable build starts by running the {MODELS[model]} version's uninstall script.\n\n{detail}"[:4000]})
            added.append(r["item"]["id"])
        _note(f, f"Build with Mosses started on {MODELS[model]}" + (" (Fable rebuild on the pending list)" if added else ""), model)
        _log({"op": "start", "feature": fid, "title": f.get("title"), "model": model, "fableLater": bool(added), "pending": added})
        llm = plugin_services.get("axf.llm@1")
        profile = None
        if llm:
            try:
                profile = next((p["id"] for p in llm.profiles() if p.get("kind") in ("anthropic", "claude-code") and p.get("enabled", True) is not False and p.get("keyReady", True)), None)
            except Exception:  # noqa: BLE001
                profile = None
        message = (f"Build this feature from the AmberX AXF plan with me, step by step: **{f['title']}** (`{fid}`), on {MODELS[model]}.\n\n"
                   f"{f.get('summary', '')}\n\nApproved plan:\n" + "\n".join(f"{i + 1}. {s}" for i, s in enumerate(plan.get("steps", []))) +
                   ("\n\nFiles: " + ", ".join(plan.get("files", [])) if plan.get("files") else "") +
                   "\n\nRead the code first, then propose each change for approval (one batch per reply, snapshot first). "
                   "Tell me when it's done or what's left, so I can mark the feature built or partial.")
        return {"parked": False, "pending": added, "chat": {"agentId": MOSSES, "message": message, "title": f"Build: {f['title']}"[:120],
                                                            "profile": profile, "model": API_MODEL[model] if profile else None}}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/build/finish")
def build_finish(body: dict[str, Any]) -> dict[str, Any]:
    fid = str(body.get("featureId") or "")
    st = body.get("status")
    if st not in ("built", "partial"):
        raise HTTPException(400, "status is built or partial")
    try:
        feats = {f["id"]: f for f in _plan()}
        f = feats.get(fid)
        if not f:
            raise KeyError(f"no feature {fid}")
        notes = str(body.get("notes") or "").strip()[:2000]
        f = {**f, "status": st, "notes": (f.get("notes", "") + (f"\n\n{notes}" if notes else "")).strip()}
        engine("plan-upsert", feature=f, note=f"Mosses build finished: {st}" + (f" ({notes[:120]})" if notes else ""))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None
    _log({"op": "finish", "feature": fid, "status": st})
    return {"ok": True}


def _note(f: dict[str, Any], text: str, model: str) -> None:
    engine("plan-upsert", feature={**f, "model": model, "modelReason": f"Picked for Build with Mosses ({MODELS[model]})", "modelEdited": True}, note=text)


@router.get("/builds")
def builds(limit: int = 100) -> dict[str, Any]:
    return {"items": list(reversed(_builds()))[: max(1, min(limit, 1000))]}
