"""Agent manager — server part. Mounted at /api/plugins/agent-manager/ (console token on every method, 404 when disabled).

Create, edit, manage and orchestrate AI agents built from reusable parts — personas, lingo packs, skills, tools — each
with its own persistent memory (type and settings per agent), trained from Firecrawl, web pages, the repo, pasted text
and MCP servers. Add-on agents install as bundles (three ship with the plugin: coder, axf-expert, ai-expert).

Integration (plugin_services, capability names only — never another plugin's folder):
  provides  axf.agents@1  list_agents / get_agent / memory_context / run_tool / record_turn — the AI assistant uses it
                          to chat *as* an agent when both plugins are installed
  consumes  axf.llm@1     models from the AI assistant when it's installed (else the manager's own model settings)
"""
from __future__ import annotations

from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException

import plugin_services

from . import containers, addons, engine, library, llm, memory, store, toolkit, training

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name


def _err(e: Exception) -> HTTPException:
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, (ValueError, llm.LlmError)):
        return HTTPException(400, str(e))
    return HTTPException(500, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------- service: axf.agents@1

class AgentsService:
    version = 1

    def list_agents(self) -> list[dict[str, Any]]:
        return [{"id": a["id"], "name": a.get("name", a["id"]), "icon": a.get("icon", "user"), "description": a.get("description", ""), "origin": a.get("origin", "user"),
                 "dangerous": a["id"] in store.load_settings()["safety"]["dangerousAgents"]}
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
        if rec and str(rec.get("version", "")).startswith("1.") and "coder" in addons.bundles():
            addons.install("coder", run_training=False)
    except Exception:  # noqa: BLE001 — never block the console start
        pass


_migrate_mosses()
training.start_scheduler(lambda: plugin_services.get("axf.agents@1") is not None)


# ---------------------------------------------------------------- status + settings

@router.get("/status")
def status() -> dict[str, Any]:
    counts = {c: len(store.items(c)) for c in store.COLLECTIONS}
    return {"counts": counts, "llm": llm.describe(), "assistant": plugin_services.get("axf.llm@1") is not None,
            "firecrawl": bool(store.secret("firecrawl")), "trainingRunning": training.running(),
            "addons": {"available": len(addons.bundles()), "installed": len(store.addon_records())},
            "memoryTypes": list(memory.TYPES), "toolKinds": list(toolkit.KINDS), "builtins": {k: v["description"] for k, v in toolkit.BUILTINS.items()},
            "sourceTypes": list(training.SOURCE_TYPES)}


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
        s["defaults"] = {**s["defaults"], **{k: d[k] for k in ("memoryType", "topK", "window", "maxItems") if k in d}}
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
    rec = {k: v for k, v in rec.items() if k not in ("createdAt", "updatedAt", "origin")}
    if coll == "tools":
        return toolkit.validate(rec)
    if coll == "training":
        return training.validate(rec)
    if not str(rec.get("name") or "").strip():
        raise ValueError("a name is required")
    if coll == "agents":
        m = rec.get("memory") or {}
        if m.get("type") and m["type"] not in memory.TYPES:
            raise ValueError(f"memory type must be one of {', '.join(memory.TYPES)}")
        if m.get("record") and m["record"] not in ("episodes", "facts", "both", "off"):
            raise ValueError("memory record is episodes, facts, both or off")
        for f, c in (("skillIds", "skills"), ("lingoIds", "lingo"), ("toolIds", "tools"), ("delegates", "agents")):
            have = store.items(c)
            rec[f] = [x for x in rec.get(f) or [] if x in have and x != rec.get("id")]
        if rec.get("personaId") and rec["personaId"] not in store.items("personas"):
            rec["personaId"] = ""
        # Voice slot: empty until a voice plugin provides voices (provider + voice id); `hint` describes the wanted voice.
        v = rec.get("voice")
        if v is not None and not isinstance(v, dict):
            raise ValueError("voice is an object {provider, voiceId, hint} or null")
        if isinstance(v, dict):
            rec["voice"] = {k: str(v.get(k) or "")[:200] for k in ("provider", "voiceId", "hint")}
    if coll == "personas" and rec.get("voiceSlot") is not None:
        vs = rec["voiceSlot"]
        if not isinstance(vs, dict):
            raise ValueError("voiceSlot is an object {provider, voiceId, hint} or null")
        rec["voiceSlot"] = {k: str(vs.get(k) or "")[:200] for k in ("provider", "voiceId", "hint")}
    if coll == "workflows":
        if (rec.get("mode") or "sequential") not in ("sequential", "parallel", "router", "critic"):
            raise ValueError("mode is sequential, parallel, router or critic")
        agents = store.items("agents")
        for i, s in enumerate(rec.get("steps") or []):
            s.setdefault("id", f"s{i + 1}")
            if s.get("agentId") not in agents:
                raise ValueError(f"step {s['id']}: unknown agent {s.get('agentId')}")
    if coll in ("skills", "personas", "lingo"):
        for f in ("triggers", "traits", "rules", "phrases", "avoid", "toolIds", "samples"):
            if f in rec and isinstance(rec[f], str):
                rec[f] = [x.strip() for x in rec[f].split("\n") if x.strip()]
    return rec


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
    return {"$axf": "agent-library-item@1", "collection": coll, "item": {k: v for k, v in it.items() if k not in ("createdAt", "updatedAt", "origin")}}


@router.post("/c/{coll}/import")
def item_import(coll: str, body: dict[str, Any]) -> dict[str, Any]:
    raw = body.get("item") if isinstance(body.get("item"), dict) else body
    if raw.get("$axf") == "agent-library-item@1":
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


# ---------------------------------------------------------------- agents

@router.get("/agents/{aid}/resolved")
def resolved(aid: str) -> dict[str, Any]:
    try:
        c = engine.compose(aid)
        return {"system": c["system"], "tools": [toolkit.spec(t) | {"kind": t["kind"]} for t in c["tools"]], "model": c["model"], "memory": c["memory"], "stats": memory.stats(c["memory"]["scope"])}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/agents/{aid}/chat")
def playground(aid: str, body: dict[str, Any]) -> dict[str, Any]:
    """Playground: one turn with history, tools and memory (not streamed)."""
    try:
        hist = [m for m in (body.get("history") or []) if m.get("role") in ("user", "assistant")][-20:]
        r = engine.run_agent(aid, str(body.get("message") or ""), history=[{"role": m["role"], "content": str(m.get("content", ""))} for m in hist], use_memory=body.get("memory", True) is not False)
        store.add_run({"kind": "playground", "agentId": aid, "input": str(body.get("message"))[:1000], "output": r["text"][:6000], "tools": r["tools"]})
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
        return {"items": memory.add(cfg["scope"], str(body.get("text") or ""), body.get("kind") or "note", body.get("tags") or [], source="manual",
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


# ---------------------------------------------------------------- tools, training, workflows, runs

@router.post("/tools/{tid}/test")
def tool_test(tid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        t = store.get("tools", tid)
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
