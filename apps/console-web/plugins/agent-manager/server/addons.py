"""Add-on agents (agent-addon@1): installable bundles of agents with their personas, lingo, skills, tools, workflows,
training jobs and seed memory.

Sources: bundled in the plugin's addons/<id>/addon.json (removed with the plugin), imported JSON or a URL (kept in the
data folder's addons/). Installing records exactly what was created, so uninstalling an add-on removes all of it —
entities, memory files and training jobs — and nothing else. Entity ids are taken from the bundle (namespace them
with the add-on id, e.g. "coder.persona"), and an install never overwrites something the user made.
"""
from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Any

from . import memory, store, toolkit, training

BUNDLED = store.PLUGIN_DIR / "addons"
IMPORTED = store.DATA / "addons"
SECTIONS = ("personas", "lingo", "skills", "tools", "agents", "workflows", "training")


def _valid(b: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(b, dict) or b.get("$axf") != "agent-addon@1":
        raise ValueError('not an agent add-on (expected "$axf": "agent-addon@1")')
    if not re.match(r"^[a-z0-9][a-z0-9-]{1,47}$", str(b.get("id", ""))):
        raise ValueError("add-on id must be lowercase letters, digits and dashes")
    if not isinstance(b.get("provides"), dict):
        raise ValueError("add-on has nothing in provides")
    return b


def bundles() -> dict[str, tuple[dict[str, Any], str]]:
    out: dict[str, tuple[dict[str, Any], str]] = {}
    for base, origin in ((BUNDLED, "bundled"), (IMPORTED, "imported")):
        if not base.exists():
            continue
        files = sorted(base.glob("*/addon.json")) + sorted(base.glob("*.json"))
        for f in files:
            try:
                b = _valid(json.loads(f.read_text()))
                out.setdefault(b["id"], (b, origin))
            except (OSError, ValueError):
                continue
    return out


def listing() -> list[dict[str, Any]]:
    recs = store.addon_records()
    out = []
    for aid, (b, origin) in bundles().items():
        r = recs.get(aid)
        counts = {k: len(v) for k, v in b["provides"].items() if isinstance(v, list)}
        out.append({"id": aid, "name": b.get("name", aid), "version": b.get("version", "0"), "description": b.get("description", ""), "author": b.get("author", ""),
                    "icon": b.get("icon", "package"), "source": origin, "provides": counts, "installed": bool(r), "installedVersion": (r or {}).get("version"),
                    "updateAvailable": bool(r) and r.get("version") != b.get("version"), "requires": b.get("requires", {})})
    for aid, r in recs.items():
        if aid not in {x["id"] for x in out}:
            out.append({"id": aid, "name": r.get("name", aid), "version": r.get("version"), "installed": True, "source": "missing", "provides": {}, "description": "Installed, but its bundle is gone — uninstall to clean up."})
    return sorted(out, key=lambda x: (not x["installed"], x["name"].lower()))


def install(aid: str, run_training: bool = True) -> dict[str, Any]:
    b = bundles().get(aid)
    if not b:
        raise KeyError(f"no add-on {aid}")
    bundle = b[0]
    if aid in store.addon_records():
        uninstall(aid, keep_memory=True)  # upgrade/reinstall: replace its entities, keep what the agents learned
    origin = f"addon:{aid}"
    created: dict[str, list[str]] = {k: [] for k in SECTIONS}
    skipped: list[str] = []
    for sec in SECTIONS:
        for rec in bundle["provides"].get(sec) or []:
            rid = rec.get("id")
            existing = store.items(sec).get(rid) if rid else None
            if existing and existing.get("origin") != origin:
                skipped.append(f"{sec}/{rid} (you already have one with that id)")
                continue
            if sec == "tools":
                rec = toolkit.validate(rec)
            if sec == "training":
                rec = training.validate(rec)
            out = store.upsert(sec, rec, origin=origin)
            created[sec].append(out["id"])
    seeded = 0
    for agent_id, items in (bundle["provides"].get("memory") or {}).items():
        if agent_id not in created["agents"]:
            continue
        a = store.get("agents", agent_id)
        cfg = memory.config(a)
        for it in items:
            memory.add_many(cfg["scope"], memory.chunk(it.get("text", ""), 1500, 100) if len(it.get("text", "")) > 1500 else [it.get("text", "")],
                            it.get("kind", "knowledge"), it.get("tags") or [], source=it.get("source") or f"add-on {aid}", job_id=f"addon:{aid}", max_items=max(cfg["maxItems"], 20_000))
            seeded += 1
    recs = store.addon_records()
    recs[aid] = {"id": aid, "name": bundle.get("name", aid), "version": bundle.get("version", "0"), "installedAt": store.now_ms(), "created": created}
    store.save_addon_records(recs)
    queued = []
    if run_training:
        for jid in created["training"]:
            j = store.get("training", jid)
            if j.get("autoRun"):
                needs_fc = any(s.get("type", "").startswith("firecrawl") for s in j.get("sources") or [])
                if needs_fc and not store.secret("firecrawl"):
                    continue
                training.run_async(jid)
                queued.append(jid)
    return {"installed": aid, "created": created, "skipped": skipped, "seeded": seeded, "training": queued}


def uninstall(aid: str, keep_memory: bool = False) -> dict[str, Any]:
    recs = store.addon_records()
    r = recs.get(aid)
    if not r:
        raise KeyError(f"add-on {aid} is not installed")
    origin = f"addon:{aid}"
    removed: dict[str, int] = {}
    for sec in reversed(SECTIONS):
        n = 0
        for iid in list((r.get("created") or {}).get(sec) or []):
            it = store.items(sec).get(iid)
            if it and it.get("origin") == origin:
                if sec == "agents" and not keep_memory:
                    memory.clear(memory.config(it)["scope"])
                store.delete(sec, iid)
                n += 1
        removed[sec] = n
    recs.pop(aid, None)
    store.save_addon_records(recs)
    return {"uninstalled": aid, "removed": removed, "memoryKept": keep_memory}


def import_bundle(data: dict[str, Any] | None = None, url: str | None = None) -> dict[str, Any]:
    if url:
        code, _ct, text = toolkit.http("GET", url, limit=5_000_000)
        if code >= 400:
            raise ValueError(f"{url}: HTTP {code}")
        data = json.loads(text)
    b = _valid(data or {})
    if (BUNDLED / b["id"]).exists():
        raise ValueError(f"{b['id']} is a bundled add-on; imported add-ons need their own id")
    IMPORTED.mkdir(parents=True, exist_ok=True, mode=0o700)
    (IMPORTED / f"{b['id']}.json").write_text(json.dumps(b, indent=2))
    return {"imported": b["id"], "name": b.get("name")}


def remove_imported(aid: str) -> None:
    p = IMPORTED / f"{aid}.json"
    if not p.exists():
        raise KeyError(aid)
    p.unlink()


def export_agent(agent_id: str) -> dict[str, Any]:
    """An agent and everything it uses as an agent-addon@1 bundle, ready to share or re-import."""
    a = store.get("agents", agent_id)
    pick = lambda sec, ids: [{k: v for k, v in store.items(sec)[i].items() if k not in ("createdAt", "updatedAt", "origin")} for i in ids if i in store.items(sec)]  # noqa: E731
    skills = pick("skills", a.get("skillIds") or [])
    tool_ids = list(dict.fromkeys([*(a.get("toolIds") or []), *[t for s in skills for t in s.get("toolIds") or []]]))
    mem = memory.load(memory.config(a)["scope"])
    return {"$axf": "agent-addon@1", "id": f"{agent_id}-export".replace(".", "-")[:48], "name": a.get("name"), "version": "1.0.0", "description": a.get("description", ""),
            "provides": {"personas": pick("personas", [a["personaId"]] if a.get("personaId") else []), "lingo": pick("lingo", a.get("lingoIds") or []), "skills": skills,
                         "tools": pick("tools", tool_ids), "agents": [{k: v for k, v in a.items() if k not in ("createdAt", "updatedAt", "origin")}],
                         "memory": {agent_id: [{"kind": d["kind"], "text": d["text"], "tags": d.get("tags", []), "source": d.get("source", "")} for d in mem["items"] if d.get("kind") in ("fact", "knowledge", "note")][:2000]}}}


def bundled_path(aid: str) -> Path:
    return BUNDLED / aid / "addon.json"
