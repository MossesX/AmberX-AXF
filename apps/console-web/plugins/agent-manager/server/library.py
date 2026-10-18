"""The reusable library: skills, tools, personas and lingo as standalone items.

  * versions: every save from the console keeps the previous copy (last 30 per item) with who/when; rollback restores
    one (itself a new version, so it can be undone);
  * used by: which agents use an item (directly, or a tool through a skill);
  * duplicate, fork for one agent (a private copy, swapped in for that agent only), export / import (imports lose
    env-var secrets, private network access and tokens unless trusted, like add-ons);
  * plain-English drafts: the AXF expert (when installed) or the agent manager's model writes a new item from a
    description, returned for review, never saved by itself.
Versions live in <dataDir>/versions/<collection>/<id>.json, so uninstalling the plugin removes them too.
"""
from __future__ import annotations

import json
import re
import time
from typing import Any

from . import store

LIBRARY = ("skills", "tools", "personas", "lingo", "agents")
KEEP = 30


def _vpath(coll: str, iid: str):
    if coll not in store.COLLECTIONS or not store.ID_RE.match(iid or ""):
        raise KeyError("no such item")
    return store.DATA / "versions" / coll / f"{iid}.json"


def versions(coll: str, iid: str) -> list[dict[str, Any]]:
    p = _vpath(coll, iid)
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return []


def record(coll: str, previous: dict[str, Any] | None, note: str = "saved") -> None:
    """Keep the copy that was there before a save (nothing to keep for a brand-new item)."""
    if not previous or not previous.get("id"):
        return
    p = _vpath(coll, previous["id"])
    vs = versions(coll, previous["id"])
    vs.insert(0, {"at": store.now_ms(), "note": note, "item": {k: v for k, v in previous.items() if k not in ("createdAt",)}})
    store._write(p, vs[:KEEP], private=True)  # noqa: SLF001 — same private writer the collections use


def drop_versions(coll: str, iid: str) -> None:
    try:
        _vpath(coll, iid).unlink(missing_ok=True)
    except KeyError:
        pass


def rollback(coll: str, iid: str, at: int) -> dict[str, Any]:
    v = next((x for x in versions(coll, iid) if x.get("at") == at), None)
    if not v:
        raise KeyError("no such version")
    cur = store.get(coll, iid)
    record(coll, cur, f"before rolling back to {time.strftime('%Y-%m-%d %H:%M', time.localtime(at / 1000))}")
    item = {k: val for k, val in v["item"].items() if k not in ("updatedAt",)}
    return store.upsert(coll, {**item, "id": iid}, origin=cur.get("origin"))


def used_by(coll: str, iid: str) -> list[dict[str, Any]]:
    out = []
    skills = store.items("skills")
    for a in store.items("agents").values():
        how = ""
        if coll == "skills" and iid in (a.get("skillIds") or []):
            how = "skill"
        elif coll == "tools":
            if iid in (a.get("toolIds") or []):
                how = "tool"
            elif any(iid in (skills.get(s, {}).get("toolIds") or []) for s in a.get("skillIds") or []):
                how = "through a skill"
        elif coll == "personas" and a.get("personaId") == iid:
            how = "persona"
        elif coll == "lingo" and iid in (a.get("lingoIds") or []):
            how = "lingo"
        elif coll == "agents" and iid in (a.get("delegates") or []):
            how = "delegate"
        if how:
            out.append({"id": a["id"], "name": a.get("name", a["id"]), "how": how})
    if coll == "tools":
        for s in skills.values():
            if iid in (s.get("toolIds") or []):
                out.append({"id": s["id"], "name": s.get("name", s["id"]), "how": "skill needs it", "kind": "skill"})
    return out


def _unique_id(coll: str, base: str) -> str:
    have = store.items(coll)
    base = re.sub(r"[^a-z0-9._-]+", "-", base.lower()).strip("-")[:60] or coll[:-1]
    iid, n = base, 2
    while iid in have:
        iid, n = f"{base}-{n}", n + 1
    return iid


def duplicate(coll: str, iid: str, name: str | None = None) -> dict[str, Any]:
    src = store.get(coll, iid)
    copy = {k: v for k, v in src.items() if k not in ("id", "createdAt", "updatedAt", "origin")}
    copy["name"] = name or f"{src.get('name', iid)} (copy)"
    copy["id"] = _unique_id(coll, f"{iid}-copy")
    return store.upsert(coll, copy, origin="user")


_REF = {"skills": "skillIds", "tools": "toolIds", "lingo": "lingoIds"}


def fork(coll: str, iid: str, agent_id: str) -> dict[str, Any]:
    """A private copy for one agent: that agent now uses the copy; everyone else keeps the shared item."""
    if coll not in ("skills", "tools", "personas", "lingo"):
        raise ValueError("fork works on skills, tools, personas and lingo")
    agent = store.get("agents", agent_id)
    src = store.get(coll, iid)
    copy = {k: v for k, v in src.items() if k not in ("id", "createdAt", "updatedAt", "origin")}
    copy["name"] = f"{src.get('name', iid)} ({agent.get('name', agent_id)})"
    copy["id"] = _unique_id(coll, f"{iid}.{agent_id}")
    copy["forkedFrom"] = iid
    new = store.upsert(coll, copy, origin="user")
    if coll == "personas":
        agent["personaId"] = new["id"]
    else:
        key = _REF[coll]
        refs = list(agent.get(key) or [])
        if iid in refs:
            refs[refs.index(iid)] = new["id"]
        else:
            refs.append(new["id"])  # e.g. a tool the agent only had through a skill
        agent[key] = refs
    record("agents", store.get("agents", agent_id), f"forked {coll[:-1]} {iid}")
    store.upsert("agents", agent, origin=agent.get("origin"))
    return new


def strip_risky(coll: str, item: dict[str, Any]) -> tuple[dict[str, Any], list[str]]:
    """Imports lose what could reach your secrets or private network (like add-on imports)."""
    item = json.loads(json.dumps(item))
    warnings = []
    if coll == "tools":
        cfg = item.get("config") or {}
        for k, v in list((cfg.get("headers") or {}).items()):
            if isinstance(v, str) and v.startswith("env:"):
                warnings.append(f"header {k} read environment variable {v[4:]}")
                cfg["headers"].pop(k)
        if cfg.pop("allowPrivate", None):
            warnings.append("could call private/internal addresses")
        if cfg.pop("tokenEnv", None):
            warnings.append("sent an environment variable to its server")
    return item, warnings


DRAFT_SHAPES = {
    "skills": '{"name": "...", "description": "...", "instructions": "how to do it, step by step", "triggers": ["when to use"], "examples": [{"input": "...", "output": "..."}]}',
    "tools": '{"name": "snake_case_function_name", "description": "what it does", "kind": "http|prompt|builtin", "config": {"method": "GET", "url": "https://…/{{arg}}", "headers": {"Authorization": "env:MY_VAR"}} or {"template": "…{{arg}}…"} or {"builtin": "…"}, "parameters": {"type": "object", "properties": {"arg": {"type": "string", "description": "…"}}, "required": ["arg"]}}',
    "personas": '{"name": "...", "role": "...", "voice": "how it speaks", "tone": "...", "traits": ["..."], "rules": ["always / never ..."], "samples": ["a short sample reply"]}',
    "lingo": '{"name": "...", "description": "...", "style": "...", "glossary": [{"term": "...", "meaning": "..."}], "phrases": ["..."], "avoid": ["..."]}',
}


def draft(coll: str, text: str, expert: dict[str, Any] | None) -> dict[str, Any]:
    from . import llm
    if coll not in DRAFT_SHAPES:
        raise ValueError("drafts are for skills, tools, personas and lingo")
    if not text.strip() or len(text) > 4000:
        raise ValueError("describe it in 1–4000 characters")
    system = (expert or {}).get("system") or "You design reusable building blocks for AI agents in the AmberX AXF Dev Console."
    prompt = (f"Brett wants a new {coll[:-1]} for his agents, described in plain words below. Write it. Reply with JSON only, shaped like:\n"
              f"{DRAFT_SHAPES[coll]}\nNever put secret values anywhere (use env:VAR for keys). Safety rules can't be weakened by a persona.\n\n"
              f"Description:\n\"\"\"\n{text}\n\"\"\"")
    out = llm.complete([{"role": "user", "content": prompt}], system=system + "\n\nReply with JSON only.", model_cfg={"temperature": 0.3, "max_tokens": 3000})
    m = re.search(r"\{.*\}", out.get("text") or "", re.S)
    try:
        item = json.loads(m.group(0)) if m else None
    except ValueError:
        item = None
    if not isinstance(item, dict) or not str(item.get("name") or "").strip():
        raise RuntimeError("the draft didn't come back in the expected format; try again or reword it")
    item.pop("id", None)
    item, warnings = strip_risky(coll, item)
    if coll == "tools":
        item.setdefault("kind", "prompt")
        if item.get("kind") == "builtin" and str((item.get("config") or {}).get("builtin", "")).startswith("container_"):
            warnings.append("container tools are dangerous: only agents allowed in Settings → Safety get them")
    return {"item": item, "warnings": warnings, "by": (expert or {}).get("name") or "the agent manager's model"}
