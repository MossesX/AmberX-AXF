"""Add-on agents (agent-addon@1): installable bundles of agents with their personas, lingo, skills, tools, workflows,
training jobs and seed memory.

Sources: bundled in the plugin's addons/<id>/addon.json (removed with the plugin), imported JSON or a URL (kept in the
data folder's addons/). Installing records exactly what was created, so uninstalling an add-on removes all of it —
entities, memory files and training jobs — and nothing else. Entity ids are taken from the bundle (namespace them
with the add-on id, e.g. "coder.persona"), and an install never overwrites something the user made.
Bundle checks, risk rules and export come from the contract (contract.py = core/agents.ts = Agents.kt).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

from . import contract, memory, store, toolkit, training

BUNDLED = store.PLUGIN_DIR / "addons"
IMPORTED = store.DATA / "addons"
SECTIONS = contract.ADDON_SECTIONS


def _valid(b: Any) -> dict[str, Any]:
    errors, bundle = contract.validate_addon(b)
    if errors:
        raise ValueError(errors[0])
    return bundle  # type: ignore[return-value]


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
                    "updateAvailable": bool(r) and r.get("version") != b.get("version"), "requires": b.get("requires", {}), "risks": contract.addon_risks(b),
                    "agents": [{"id": a.get("id"), "name": a.get("name")} for a in b["provides"].get("agents") or []]})
    for aid, r in recs.items():
        if aid not in {x["id"] for x in out}:
            out.append({"id": aid, "name": r.get("name", aid), "version": r.get("version"), "installed": True, "source": "missing", "provides": {}, "description": "Installed, but its bundle is gone — uninstall to clean up.", "risks": [], "agents": []})
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
    # References inside the bundle may point forward (a skill to a tool installed after it): validate against what exists plus what the bundle brings.
    known = store.known()
    for sec in SECTIONS:
        known[sec] = set(known.get(sec, set())) | {str(r.get("id")) for r in bundle["provides"].get(sec) or [] if isinstance(r, dict) and r.get("id")}
    ctx = contract.Context(known=known, builtins=toolkit.BUILTINS)
    for sec in SECTIONS:
        for rec in bundle["provides"].get(sec) or []:
            rid = rec.get("id")
            existing = store.items(sec).get(rid) if rid else None
            if existing and existing.get("origin") != origin:
                skipped.append(f"{sec}/{rid} (you already have one with that id)")
                continue
            v = contract.validate_item(sec, rec, ctx)
            if not v.ok:
                raise ValueError(f"{sec}/{rid}: {v.errors[0]}")
            rec = v.item if sec != "training" else {**v.item, "nextRun": training.next_run(v.item["schedule"])}
            if sec == "agents":
                scope = (rec.get("memory") or {}).get("scope") or rec.get("id")
                taken = {memory.config(a)["scope"] for a in store.items("agents").values() if a.get("origin") != origin}
                if scope in taken or (scope != rec.get("id") and not str(scope).startswith(f"{aid}")):
                    rec = {**rec, "memory": {**(rec.get("memory") or {}), "scope": ""}}  # never share or take over your agents' memory
            out = store.upsert(sec, rec, origin=origin)
            created[sec].append(out["id"])
    seeded = 0
    for agent_id, items in (bundle["provides"].get("memory") or {}).items():
        if agent_id not in created["agents"]:
            continue
        a = store.get("agents", agent_id)
        cfg = memory.config(a)
        for it in items:
            if not isinstance(it, dict):
                continue
            text = str(it.get("text", ""))
            memory.add_many(cfg["scope"], memory.chunk(text, 1500, 100) if len(text) > 1500 else [text],
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
                    scope = memory.config(it)["scope"]
                    users = [a for a in store.items("agents").values() if a["id"] != iid and memory.config(a)["scope"] == scope]
                    if not users:
                        memory.clear(scope)
                store.delete(sec, iid)
                from . import library
                library.drop_versions(sec, iid)
                n += 1
        removed[sec] = n
    recs.pop(aid, None)
    store.save_addon_records(recs)
    return {"uninstalled": aid, "removed": removed, "memoryKept": keep_memory}


risky = contract.addon_risks


def import_bundle(data: dict[str, Any] | None = None, url: str | None = None, trust: bool = False) -> dict[str, Any]:
    if url:
        code, _ct, text = toolkit.http("GET", url, limit=5_000_000)
        if code >= 400:
            raise ValueError(f"{url}: HTTP {code}")
        data = json.loads(text)
    b = _valid(data or {})
    if (BUNDLED / b["id"]).exists():
        raise ValueError(f"{b['id']} is a bundled add-on; imported add-ons need their own id")
    warnings = risky(b)
    if warnings and not trust:
        b = contract.strip_addon_risks(b)  # imported bundles don't get your secrets or private network unless you say so
    IMPORTED.mkdir(parents=True, exist_ok=True, mode=0o700)
    (IMPORTED / f"{b['id']}.json").write_text(json.dumps(b, indent=2))
    return {"imported": b["id"], "name": b.get("name"), "warnings": warnings, "stripped": bool(warnings and not trust)}


def remove_imported(aid: str) -> None:
    p = IMPORTED / f"{aid}.json"
    if not p.exists():
        raise KeyError(aid)
    p.unlink()


def export_agent(agent_id: str) -> dict[str, Any]:
    """An agent and everything it uses as an agent-addon@1 bundle, ready to share or re-import."""
    a = store.get("agents", agent_id)
    pick = lambda sec, ids: [store.items(sec)[i] for i in ids if i in store.items(sec)]  # noqa: E731
    skills = pick("skills", a.get("skillIds") or [])
    tool_ids = list(dict.fromkeys([*(a.get("toolIds") or []), *[t for s in skills for t in s.get("toolIds") or []]]))
    mem = memory.load(memory.config(a)["scope"])
    return contract.agent_to_addon(a, pick("personas", [a["personaId"]] if a.get("personaId") else []), pick("lingo", a.get("lingoIds") or []), skills, pick("tools", tool_ids), mem["items"])


def bundled_path(aid: str) -> Path:
    return BUNDLED / aid / "addon.json"
