"""Agent manager — server part. Mounted at /api/plugins/agent-manager/ (console token on every method, 404 when disabled).

Create, edit, manage and orchestrate AI agents built from reusable parts — personas, lingo packs, skills, tools — each
with its own persistent memory (type and settings per agent), trained from Firecrawl, web pages, the repo, pasted text
and MCP servers. Add-on agents install as bundles (five ship with the plugin: coder = Mosses, vinny = Vinny (VPS root through axHub), molly = Molly (AmberX developer agent, walkthroughs), axf-expert, ai-expert).

The definition format is the framework contract agent-definition@1 (framework/core/agents.ts = Python
`axf.contracts.agents` in framework/python = Kotlin ai.amberx.axf.kernel.agents), so Build Pilot and other AXF apps
load the same agents; the safety helpers come from `axf.assistant_host.safety` (harvested Oct 21 2026).

Integration (plugin_services, capability names only — never another plugin's folder):
  provides  axf.agents@1  list_agents / get_agent / memory_context / run_tool / record_turn — the AI assistant uses it
                          to chat *as* an agent when both plugins are installed
  consumes  axf.llm@1     models from the AI assistant when it's installed (else the manager's own model settings)
"""
from __future__ import annotations

import json
import queue
import sys
import threading
from pathlib import Path
from typing import Any, Iterator

from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse

import plugin_services

_PY = Path(__file__).resolve().parents[5] / "framework" / "python"
if str(_PY) not in sys.path:
    sys.path.insert(0, str(_PY))

from axf.contracts import agents as contract  # noqa: E402

from . import addons, containers, engine, library, llm, memory, store, toolkit, training  # noqa: E402
from . import hubtools  # noqa: E402,F401 — registers Mosses's axhub_call builtin before add-ons are checked
from . import vinny  # noqa: E402 — Vinny's command book (vinny-commands@1), provides axf.vinny@1

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
VERSION = "0.2.0"


def _err(e: Exception) -> HTTPException:
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, (ValueError, llm.LlmError)):
        return HTTPException(400, str(e))
    return HTTPException(500, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------- service: axf.agents@1

class AgentsService:
    """Capability `axf.agents@1` — the contract's AgentRuntime (core/agents.ts), as the AI assistant and the systems check call it."""
    version = 1

    def list_agents(self) -> list[dict[str, Any]]:
        dangerous = store.dangerous_agents()
        return [{"id": a["id"], "name": a.get("name", a["id"]), "icon": a.get("icon", "user"), "description": a.get("description", ""), "origin": a.get("origin", "user"),
                 "dangerous": a["id"] in dangerous}
                for a in sorted(store.items("agents").values(), key=lambda a: a.get("name", "").lower()) if a.get("enabled", True) is not False]

    def get_agent(self, agent_id: str) -> dict[str, Any] | None:
        try:
            c = engine.compose(agent_id)
        except KeyError:
            return None
        if c["agent"].get("enabled", True) is False:
            return None
        out = {"id": agent_id, "name": c["agent"].get("name"), "icon": c["agent"].get("icon", "user"), "description": c["agent"].get("description", ""),
               "system_prompt": c["system"], "model": c["model"], "tools": [toolkit.spec(t) for t in c["tools"]], "memory": {"type": c["memory"]["type"]},
               "voice": _voice(c["agent"]), "writeMode": None}
        if c.get("writeMode"):
            cs = containers.service()
            try:
                reach = [x["name"] for x in cs.list() if x["reachable"]] if cs else []
            except Exception:  # noqa: BLE001 — proxy down: still in write mode, list unknown
                reach = []
            out["writeMode"] = {"containers": reach, "snapshots": True}
        return out

    def memory_context(self, agent_id: str, query: str) -> str:
        return memory.context_for(store.get("agents", agent_id), query)

    def run_tool(self, agent_id: str, name: str, args: dict[str, Any], ctx: dict[str, Any] | None = None) -> str:
        c = engine.compose(agent_id)
        t = next((x for x in c["tools"] if x["name"] == name), None)
        if not t:
            raise ValueError(f"{c['agent'].get('name')} has no tool {name}")
        # ctx["stage"] (from the assistant's chat turn) collects proposed container changes for its approval card.
        return toolkit.execute(t, args, {"agent": c["agent"], "scope": c["memory"]["scope"], "depth": 0, "run_agent": engine.run_agent, "run_workflow": engine.run_workflow,
                                         "stage": (ctx or {}).get("stage")})

    def run_task(self, agent_id: str, task: str, on_event: Any = None) -> dict[str, Any]:
        """One headless turn with the agent's tools and memory (Oct 23 2026: the systems check hands a check to Mosses to
        fix; his axhub_call waits for Brett's approval on the hub for every command). Returns {text, tools, ms}; the turn is
        recorded in his memory like a chat turn. Raises when the agent is missing or can't reach a model.
        Vinny (Oct 24 2026): triggers in the task run his mapped commands first, with no model; only a task with no
        trigger goes to the model."""
        if agent_id == vinny.VINNY:
            runs = vinny.handle(task, "task", wait=True)
            if runs:
                return {"text": vinny.summary(runs), "tools": [{"name": hubtools.TOOL, "command": r.get("command", ""), "ok": r.get("state") == "done"} for r in runs],
                        "ms": 0, "offline": True}
        r = engine.run_agent(agent_id, task, on_event=on_event)
        try:
            memory.record(store.get("agents", agent_id), task[:4000], str(r.get("text", ""))[:8000], {"source": "task"})
        except Exception:  # noqa: BLE001 — memory never fails the task
            pass
        return {"text": str(r.get("text", "")), "tools": r.get("tools") or [], "ms": r.get("ms")}

    def record_turn(self, agent_id: str, user_text: str, reply: str, meta: dict[str, Any] | None = None) -> None:
        memory.record(store.get("agents", agent_id), user_text, reply, meta)


def _voice(agent: dict[str, Any]) -> dict[str, Any] | None:
    """The agent's voice slot, else its persona's (empty until a voice plugin provides voices)."""
    v = agent.get("voice") or (store.items("personas").get(agent.get("personaId") or "") or {}).get("voiceSlot")
    return v if isinstance(v, dict) and any(v.values()) else None


plugin_services.provide("axf.agents@1", AgentsService(), FOLDER)


def _migrate_mosses() -> None:
    """Coder 1.x → Mosses 2.x (same add-on id `coder`): reinstall keeps the agent's memory, swaps persona, skills and tools."""
    try:
        rec = store.addon_records().get("coder")
        # 1.x → Mosses 2; 2.0 → 2.1 (Oct 22 2026: his axhub_call tool, which every console Auto fix goes through)
        if rec and str(rec.get("version", "")).startswith(("1.", "2.0")) and "coder" in addons.bundles():
            addons.install("coder", run_training=False)
    except Exception:  # noqa: BLE001 — never block the console start
        pass


try:
    store.migrate()
except Exception:  # noqa: BLE001
    pass
_migrate_mosses()


def _offer_vinny() -> None:
    """Vinny (Oct 24 2026): installed once on start and allowed dangerous tools (his axhub_call runs as root through
    axHub approvals). An uninstall or a Safety change afterwards is respected: this never runs twice."""
    try:
        rec = store.addon_records().get("vinny")
        if rec and str(rec.get("version", "")).startswith(("1.0", "1.1")) and "vinny" in addons.bundles():
            addons.install("vinny", run_training=False)  # 1.0 → 1.1 command book, → 1.2 app tokens (memory kept)
        s = store.load_settings()
        if s.get("vinnyOffered") or "vinny" not in addons.bundles():
            return
        if "vinny" not in store.addon_records():
            addons.install("vinny", run_training=False)
        s = store.load_settings()
        s["safety"] = {**s["safety"], "dangerousAgents": sorted(set(s["safety"].get("dangerousAgents") or []) | {"vinny"})}
        s["vinnyOffered"] = True
        store.save_settings(s)
    except Exception:  # noqa: BLE001 — never block the console start
        pass


_offer_vinny()


def _offer_molly() -> None:
    """Molly (Oct 28 2026): AmberX's developer agent, installed once on start like Vinny and allowed dangerous tools
    (axhub_call as root through axHub approvals; container changes through the snapshot + approval batch). An
    uninstall or a Safety change afterwards is respected: this never runs twice."""
    try:
        s = store.load_settings()
        if s.get("mollyOffered") or "molly" not in addons.bundles():
            return
        if "molly" not in store.addon_records():
            addons.install("molly", run_training=False)
        s = store.load_settings()
        s["safety"] = {**s["safety"], "dangerousAgents": sorted(set(s["safety"].get("dangerousAgents") or []) | {"molly"})}
        s["mollyOffered"] = True
        store.save_settings(s)
    except Exception:  # noqa: BLE001 — never block the console start
        pass


_offer_molly()
training.start_scheduler(lambda: plugin_services.get("axf.agents@1") is not None)


# ---------------------------------------------------------------- status + settings + contract

@router.get("/status")
def status() -> dict[str, Any]:
    counts = {c: len(store.items(c)) for c in store.COLLECTIONS}
    cont = containers.available()
    return {"version": VERSION, "contract": contract.AGENT_CONTRACT, "counts": counts, "llm": llm.describe(), "assistant": plugin_services.get("axf.llm@1") is not None,
            "firecrawl": bool(store.secret("firecrawl")), "trainingRunning": training.running(), "schedulerTick": training.last_tick,
            "addons": {"available": len(addons.bundles()), "installed": len(store.addon_records())},
            "memoryTypes": list(memory.TYPES), "memoryKinds": list(memory.KINDS), "toolKinds": list(toolkit.KINDS),
            "builtins": {k: v["description"] for k, v in toolkit.BUILTINS.items()}, "dangerousBuiltins": sorted(k for k, v in toolkit.BUILTINS.items() if v.get("dangerous") or k in containers.ALL),
            "sourceTypes": list(training.SOURCE_TYPES), "workflowModes": list(contract.WORKFLOW_MODES), "services": {"containers": cont["containers"], "snapshots": cont["snapshots"]},
            "safety": {"dangerousAgents": sorted(store.dangerous_agents())}}


@router.get("/contract")
def contract_info() -> dict[str, Any]:
    """The definition contract this server implements, for apps that load the same agents (Build Pilot)."""
    return {"$axf": contract.AGENT_CONTRACT, "collections": list(contract.COLLECTIONS), "addon": contract.AGENT_ADDON_TAG, "libraryItem": contract.AGENT_LIBRARY_ITEM_TAG,
            "memory": contract.AGENT_MEMORY_TAG, "memoryTypes": list(contract.MEMORY_TYPES), "memoryKinds": list(contract.MEMORY_KINDS), "toolKinds": list(contract.TOOL_KINDS),
            "workflowModes": list(contract.WORKFLOW_MODES), "sourceTypes": list(contract.TRAINING_SOURCE_TYPES), "schedules": list(contract.TRAINING_SCHEDULES),
            "limits": contract.LIMITS, "builtins": {k: {"description": v["description"], "parameters": v["parameters"]} for k, v in toolkit.BUILTINS.items()}}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return store.public_settings()


@router.put("/settings")
def put_settings(body: dict[str, Any]) -> dict[str, Any]:
    s = store.load_settings()
    for sec in ("llm", "firecrawl"):
        if isinstance(body.get(sec), dict):
            inc = dict(body[sec])
            key = inc.pop("key", None)
            for k in ("hasKey", "envPresent"):
                inc.pop(k, None)
            s[sec] = {**s[sec], **{k: str(v)[:500] for k, v in inc.items() if k in store.DEFAULT_SETTINGS[sec]}}
            if key is not None and key != store.MASK:
                s[sec]["key"] = str(key).strip()
    if isinstance(body.get("defaults"), dict):
        d = body["defaults"]
        if d.get("memoryType") and d["memoryType"] not in memory.TYPES:
            raise HTTPException(400, "unknown memory type")
        nums = {}
        for k in ("topK", "window", "maxItems"):
            if k in d:
                try:
                    nums[k] = max(1, min(int(d[k]), 50_000))
                except (TypeError, ValueError):
                    raise HTTPException(400, f"{k} must be a number") from None
        s["defaults"] = {**s["defaults"], **({"memoryType": d["memoryType"]} if d.get("memoryType") else {}), **nums}
    for k in ("preferAssistant", "scheduler"):
        if k in body:
            s[k] = bool(body[k])
    if isinstance(body.get("safety"), dict) and isinstance(body["safety"].get("dangerousAgents"), list):
        ids = [str(x) for x in body["safety"]["dangerousAgents"] if store.ID_RE.match(str(x))][:20]
        s["safety"] = {**s["safety"], "dangerousAgents": sorted(set(ids))}
    store.save_settings(s)
    return store.public_settings()


@router.post("/settings/test")
def test_llm() -> dict[str, Any]:
    try:
        return llm.test()
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/settings/test-firecrawl")
def test_firecrawl(body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        r = toolkit.fc_scrape((body or {}).get("url") or "https://example.com")
        return {"ok": True, "title": r["title"], "chars": len(r["markdown"])}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


# ---------------------------------------------------------------- generic collections

def _validate(coll: str, rec: dict[str, Any]) -> dict[str, Any]:
    if coll == "training":
        return training.validate(rec)
    v = contract.validate_item(coll, rec, toolkit.context())
    if not v.ok:
        raise ValueError(v.errors[0])
    return v.item


@router.post("/validate/{coll}")
def validate_only(coll: str, body: dict[str, Any]) -> dict[str, Any]:
    """Dry run: the contract's errors, warnings and the normalised item, nothing saved (forms and wizards use it live)."""
    if coll not in store.COLLECTIONS:
        raise HTTPException(404, f"no collection {coll}")
    v = contract.validate_item(coll, body, toolkit.context())
    return {"ok": v.ok, "errors": v.errors, "warnings": v.warnings, "item": v.item}


@router.get("/c/{coll}")
def list_items(coll: str) -> dict[str, Any]:
    try:
        return {"items": sorted(store.items(coll).values(), key=lambda x: str(x.get("name", x["id"])).lower())}
    except KeyError:
        raise HTTPException(404, f"no collection {coll}") from None


@router.get("/c/{coll}/{iid}")
def get_item(coll: str, iid: str) -> dict[str, Any]:
    try:
        return {"item": store.get(coll, iid)}
    except KeyError as e:
        raise _err(e) from None


@router.post("/c/{coll}")
def save_item(coll: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        rec = _validate(coll, body)
        prev = store.items(coll).get(str(rec.get("id") or ""))
        library.record(coll, prev, str(body.get("_note") or "saved in the console")[:120])
        return {"item": store.upsert(coll, rec)}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.delete("/c/{coll}/{iid}")
def delete_item(coll: str, iid: str) -> dict[str, Any]:
    try:
        if coll == "agents":
            a = store.get("agents", iid)
            if memory.config(a)["scope"] == iid:
                memory.clear(iid)
            for j in [j for j in store.items("training").values() if j.get("agentId") == iid]:
                store.delete("training", j["id"])
        store.delete(coll, iid)
        library.drop_versions(coll, iid)
        return {"deleted": iid}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


# ---------------------------------------------------------------- library: versions, used by, duplicate, fork, import/export, drafts

def _lib(fn, *a, **k):
    try:
        return fn(*a, **k)
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.get("/c/{coll}/{iid}/versions")
def item_versions(coll: str, iid: str) -> dict[str, Any]:
    return {"items": _lib(library.versions, coll, iid)}


@router.post("/c/{coll}/{iid}/rollback")
def item_rollback(coll: str, iid: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"item": _lib(library.rollback, coll, iid, int(body.get("at") or 0))}


@router.get("/c/{coll}/{iid}/used-by")
def item_used_by(coll: str, iid: str) -> dict[str, Any]:
    return {"items": _lib(library.used_by, coll, iid)}


@router.post("/c/{coll}/{iid}/duplicate")
def item_duplicate(coll: str, iid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    return {"item": _lib(library.duplicate, coll, iid, (body or {}).get("name"))}


@router.post("/c/{coll}/{iid}/fork")
def item_fork(coll: str, iid: str, body: dict[str, Any]) -> dict[str, Any]:
    return {"item": _lib(library.fork, coll, iid, str(body.get("agentId") or ""))}


@router.get("/c/{coll}/{iid}/export")
def item_export(coll: str, iid: str) -> dict[str, Any]:
    it = _lib(store.get, coll, iid)
    return {"$axf": contract.AGENT_LIBRARY_ITEM_TAG, "collection": coll, "item": {k: v for k, v in it.items() if k not in ("createdAt", "updatedAt", "origin")}}


@router.post("/c/{coll}/import")
def item_import(coll: str, body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("item") if isinstance(body.get("item"), dict) else body
    if raw.get("$axf") == contract.AGENT_LIBRARY_ITEM_TAG:
        if raw.get("collection") != coll:
            raise HTTPException(400, f"that file is a {raw.get('collection')} item, not {coll}")
        raw = raw.get("item") or {}
    item, warnings = library.strip_risky(coll, raw)
    if body.get("trust"):
        item, warnings = raw, []
    item.pop("origin", None)
    if item.get("id") in store.items(coll):
        item["id"] = library._unique_id(coll, f"{item['id']}-imported")  # noqa: SLF001
    try:
        rec = _validate(coll, item)
        return {"item": store.upsert(coll, rec, origin="user"), "warnings": warnings}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/draft/{coll}")
def item_draft(coll: str, body: dict[str, Any]) -> dict[str, Any]:
    """Plain English → a new item for review (never saved here). Written by the AXF expert when it's installed."""
    expert = None
    try:
        c = engine.compose("axf-expert")
        expert = {"system": c["system"], "name": c["agent"].get("name")}
    except Exception:  # noqa: BLE001
        expert = None
    return _lib(library.draft, coll, str(body.get("text") or ""), expert)


# ---------------------------------------------------------------- whole library export / import (agent-addon@1 of everything)

@router.get("/export")
def export_all() -> dict[str, Any]:
    """Every user-made item as one agent-addon@1 bundle (add-on items stay with their add-on; no memory, no keys)."""
    prov: dict[str, Any] = {}
    for sec in contract.ADDON_SECTIONS:
        prov[sec] = [{k: v for k, v in it.items() if k not in ("createdAt", "updatedAt", "origin", "log", "status", "lastRun", "lastAdded", "nextRun")}
                     for it in store.items(sec).values() if it.get("origin", "user") == "user"]
    return {"$axf": contract.AGENT_ADDON_TAG, "id": "library-export", "name": "Agent library export", "version": "1.0.0", "description": "Everything made in this console's agent manager.", "provides": prov}


# ---------------------------------------------------------------- agents

@router.get("/agents/{aid}/resolved")
def resolved(aid: str) -> dict[str, Any]:
    try:
        c = engine.compose(aid)
        return {"system": c["system"], "tools": [toolkit.spec(t) | {"kind": t["kind"], "dangerous": toolkit.is_dangerous(t)} for t in c["tools"]], "model": c["model"], "memory": c["memory"],
                "stats": memory.stats(c["memory"]["scope"]), "writeMode": c["writeMode"], "dropped": c["dropped"]}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/agents/{aid}/chat")
def playground(aid: str, body: dict[str, Any]) -> dict[str, Any]:
    """Playground: one turn with history, tools and memory (not streamed)."""
    try:
        hist = [m for m in (body.get("history") or []) if m.get("role") in ("user", "assistant")][-20:]
        r = engine.run_agent(aid, str(body.get("message") or ""), history=[{"role": m["role"], "content": str(m.get("content", ""))} for m in hist], use_memory=body.get("memory", True) is not False)
        store.add_run({"kind": "playground", "agentId": aid, "input": str(body.get("message"))[:1000], "output": r["text"][:6000], "tools": r["tools"], "ms": r.get("ms")})
        return r
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/agents/{aid}/clone")
def clone(aid: str) -> dict[str, Any]:
    try:
        a = dict(store.get("agents", aid))
        for k in ("id", "createdAt", "updatedAt", "origin"):
            a.pop(k, None)
        a["name"] = f"{a.get('name', aid)} (copy)"
        a.setdefault("memory", {})
        a["memory"] = {**a["memory"], "scope": ""}
        return {"item": store.upsert("agents", a, origin="user")}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.get("/agents/{aid}/export")
def export_agent(aid: str) -> dict[str, Any]:
    try:
        return addons.export_agent(aid)
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/compose")
def compose_all(body: dict[str, Any]) -> dict[str, Any]:
    """The all-in-one wizard: create or reuse a persona, lingo, skills and tools, then the agent, then (optionally) its training job."""
    created: dict[str, list[str]] = {"personas": [], "lingo": [], "skills": [], "tools": [], "agents": [], "training": []}
    try:
        def take(coll: str, v: Any) -> str:
            if isinstance(v, str):
                store.get(coll, v)
                return v
            if isinstance(v, dict) and (v.get("name") or v.get("id")):
                rec = store.upsert(coll, _validate(coll, v))
                created[coll].append(rec["id"])
                return rec["id"]
            return ""
        persona = take("personas", body.get("persona")) if body.get("persona") else ""
        lingo_ids = [x for x in (take("lingo", v) for v in body.get("lingo") or []) if x]
        tool_ids = [x for x in (take("tools", v) for v in body.get("tools") or []) if x]
        skill_ids = [x for x in (take("skills", v) for v in body.get("skills") or []) if x]
        agent = dict(body.get("agent") or {})
        agent.update({"personaId": persona or agent.get("personaId", ""), "lingoIds": [*agent.get("lingoIds", []), *lingo_ids], "skillIds": [*agent.get("skillIds", []), *skill_ids], "toolIds": [*agent.get("toolIds", []), *tool_ids]})
        a = store.upsert("agents", _validate("agents", agent))
        created["agents"].append(a["id"])
        job = None
        if (body.get("training") or {}).get("sources"):
            job = store.upsert("training", training.validate({"name": f"Train {a.get('name')}", **body["training"], "agentId": a["id"]}))
            created["training"].append(job["id"])
            if body["training"].get("runNow"):
                training.run_async(job["id"])
        return {"agent": a, "created": created, "trainingJob": job}
    except Exception as e:  # noqa: BLE001 — roll back what this call created
        for coll, ids in created.items():
            for i in ids:
                try:
                    store.delete(coll, i)
                except KeyError:
                    pass
        raise _err(e) from None


# ---------------------------------------------------------------- memory

def _scope(aid: str) -> str:
    try:
        return memory.config(store.get("agents", aid))["scope"]
    except KeyError as e:
        raise _err(e) from None


@router.get("/memory/{aid}")
def memory_list(aid: str, q: str = "", kind: str = "", limit: int = 200) -> dict[str, Any]:
    try:
        scope = _scope(aid)
        mem = memory.load(scope)
        limit = max(1, min(int(limit), 500))
        if q:
            items = memory.search(scope, q, min(limit, 50), "hybrid", (kind,) if kind else None)
        else:
            items = [{k: v for k, v in d.items() if k != "vector"} for d in mem["items"] if not kind or d.get("kind") == kind][-limit:][::-1]
        return {"scope": scope, "summary": mem.get("summary", ""), "items": items, "stats": memory.stats(scope)}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/memory/{aid}")
def memory_add(aid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        a = store.get("agents", aid)
        cfg = memory.config(a)
        kind = body.get("kind") or "note"
        if kind not in ("fact", "note", "knowledge"):
            raise ValueError("by hand you can add facts, notes and knowledge")
        return {"items": memory.add(cfg["scope"], str(body.get("text") or ""), kind, body.get("tags") or [], source="manual",
                                    embed=cfg["type"] in ("vector", "hybrid"), embed_profile=cfg["embedProfile"], max_items=cfg["maxItems"])}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.put("/memory/{aid}/summary")
def memory_summary(aid: str, body: dict[str, Any]) -> dict[str, Any]:
    scope = _scope(aid)
    mem = memory.load(scope)
    mem["summary"] = str(body.get("summary") or "")[:4000]
    memory.save(scope, mem)
    return {"summary": mem["summary"]}


@router.delete("/memory/{aid}/{item_id}")
def memory_delete(aid: str, item_id: str) -> dict[str, Any]:
    return {"removed": memory.remove(_scope(aid), item_id=item_id)}


@router.post("/memory/{aid}/clear")
def memory_clear(aid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    scope = _scope(aid)
    kind = (body or {}).get("kind") or ""
    if kind:
        return {"removed": memory.remove(scope, kind=kind)}
    memory.clear(scope)
    return {"cleared": scope}


@router.get("/memory")
def memory_scopes() -> dict[str, Any]:
    """Every memory store (agents and shared scopes) with its size — the Memory tab's overview."""
    agents = store.items("agents")
    by_scope: dict[str, list[str]] = {}
    for a in agents.values():
        by_scope.setdefault(memory.config(a)["scope"], []).append(a["id"])
    rows = []
    for sc in sorted(set(memory.scopes()) | set(by_scope)):
        st = memory.stats(sc)
        rows.append({**st, "agents": by_scope.get(sc, []), "orphan": sc not in by_scope})
    return {"items": rows}


# ---------------------------------------------------------------- tools, training, workflows, runs

@router.post("/tools/{tid}/test")
def tool_test(tid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        t = store.get("tools", tid)
        if containers.is_container_tool(t) and (t.get("config") or {}).get("builtin") in containers.WRITE_TOOLS:
            return {"ok": False, "output": "Change-proposing container tools only run inside an assistant chat, where Brett approves the batch. Nothing was changed."}
        out = toolkit.execute(t, body.get("args") or {}, {"agent": None, "scope": body.get("scope") or "", "depth": 0, "run_agent": engine.run_agent, "run_workflow": engine.run_workflow})
        return {"ok": True, "output": str(out)[:20_000]}
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "output": f"Error: {e}"}


@router.post("/training/{jid}/run")
def training_run(jid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        store.get("training", jid)
        if (body or {}).get("wait"):
            return training.run(jid)
        training.run_async(jid)
        return {"started": jid}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/workflows/{wid}/run")
def workflow_run(wid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        return engine.run_workflow(wid, str(body.get("input") or ""))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/workflows/{wid}/run/stream")
def workflow_run_stream(wid: str, body: dict[str, Any]) -> StreamingResponse:
    """The same run as SSE: `step` / `step_done` while it works, then `done` {output, trace, runId} or `error`."""
    try:
        store.get("workflows", wid)
    except KeyError as e:
        raise _err(e) from None
    q: queue.Queue[tuple[str, dict[str, Any]] | None] = queue.Queue()

    def work() -> None:
        try:
            r = engine.run_workflow(wid, str(body.get("input") or ""), on_event=lambda k, d: q.put((k, d)))
            q.put(("done", r))
        except Exception as e:  # noqa: BLE001
            q.put(("error", {"error": str(e)}))
        q.put(None)

    threading.Thread(target=work, daemon=True).start()

    def gen() -> Iterator[str]:
        while True:
            ev = q.get()
            if ev is None:
                return
            yield f"event: {ev[0]}\ndata: {json.dumps(ev[1], ensure_ascii=False)}\n\n"

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store", "x-accel-buffering": "no"})


@router.get("/runs")
def list_runs(kind: str = "") -> dict[str, Any]:
    return {"items": store.runs(kind)[:60]}


# ---------------------------------------------------------------- add-ons

@router.get("/addons")
def addon_list() -> dict[str, Any]:
    return {"items": addons.listing()}


@router.post("/addons/{aid}/install")
def addon_install(aid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return addons.install(aid, run_training=(body or {}).get("train", True) is not False)
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/addons/{aid}/uninstall")
def addon_uninstall(aid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        return addons.uninstall(aid, keep_memory=bool((body or {}).get("keepMemory")))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/addons/import")
def addon_import(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return addons.import_bundle(body.get("bundle"), body.get("url"), trust=bool(body.get("trust")))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.delete("/addons/{aid}")
def addon_forget(aid: str) -> dict[str, Any]:
    try:
        addons.remove_imported(aid)
        return {"removed": aid}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


# ---------------------------------------------------------------- Vinny's command book (vinny-commands@1, Oct 24 2026)
# Triggers → VPS / git / GitHub commands Vinny runs with no model, through axHub (each vps.run approved there).

def _vinny_err(e: Exception) -> HTTPException:
    return HTTPException(400, str(e)) if isinstance(e, (vinny.VinnyError, ValueError)) else _err(e)


@router.get("/vinny")
def vinny_book() -> dict[str, Any]:
    ok, why = vinny.ready()
    book = vinny.load()
    return {**book, "ready": ok, "why": why, "kinds": list(vinny.KINDS), "where": str(vinny.data_dir()), "runs": vinny.runner().all()[-30:]}


@router.post("/vinny/commands")
def vinny_save(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"command": vinny.upsert(body)}
    except Exception as e:  # noqa: BLE001
        raise _vinny_err(e) from None


@router.delete("/vinny/commands/{cid}")
def vinny_delete(cid: str) -> dict[str, Any]:
    if not vinny.remove(cid):
        raise HTTPException(404, f"no command {cid}")
    return {"removed": cid}


@router.post("/vinny/defaults")
def vinny_defaults() -> dict[str, Any]:
    return vinny.reset_defaults()


@router.put("/vinny/settings")
def vinny_settings(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"settings": vinny.save_settings(body or {})}
    except Exception as e:  # noqa: BLE001
        raise _vinny_err(e) from None


@router.post("/vinny/test")
def vinny_test(body: dict[str, Any]) -> dict[str, Any]:
    """Which commands a message would run, and the exact axHub call for each; nothing is sent."""
    book = vinny.load()
    out = []
    for c in vinny.matches(book["commands"], str((body or {}).get("text") or ""), int(book["settings"].get("maxPerMessage") or 5)):
        try:
            tool, args = vinny.build(c, (body or {}).get("context") or {})
            out.append({"id": c["id"], "name": c["name"], "tool": tool, "arguments": args})
        except vinny.VinnyError as e:
            out.append({"id": c["id"], "name": c["name"], "error": str(e)})
    return {"matches": out, "listening": bool(book["settings"].get("listen", True))}


@router.post("/vinny/message")
def vinny_message(body: dict[str, Any]) -> dict[str, Any]:
    """A message to Vinny from code (or the dialog's Send box): every trigger in it runs its command, no model."""
    text = str((body or {}).get("text") or "")
    if not text.strip():
        raise HTTPException(400, "text is required")
    ok, why = vinny.ready()
    if not ok:
        raise HTTPException(409, why)
    return {"runs": vinny.handle(text, str((body or {}).get("source") or "api")[:60], (body or {}).get("context") or {})}


@router.post("/vinny/commands/{cid}/run")
def vinny_run(cid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    ok, why = vinny.ready()
    if not ok:
        raise HTTPException(409, why)
    c = next((x for x in vinny.load()["commands"] if x["id"] == cid), None)
    if not c:
        raise HTTPException(404, f"no command {cid}")
    try:
        return vinny.runner().start(c, "dialog", (body or {}).get("context") or {})
    except Exception as e:  # noqa: BLE001
        raise _vinny_err(e) from None


@router.get("/vinny/runs")
def vinny_runs(since: int = 0) -> dict[str, Any]:
    return {"runs": vinny.runner().all(since)}
