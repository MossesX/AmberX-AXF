"""agent-definition@1 — the Python port of framework/core/agents.ts (the reference) and the Kotlin kernel's
ai.amberx.axf.kernel.agents (framework/python, `axf.contracts.agents`). All three replay
framework/spec/fixtures/agents.json (framework/python/axf/contracts/test.py checks this port). Hosts import it: the
console's agent-manager plugin, Build Pilot's server (baked copy).

Pure: validation + normalisation of every collection, the system-prompt composer, memory config resolution, the
memory text engine (tokens, BM25, chunking, trimming), workflow template filling, router parsing, tool templates,
and the add-on checks and risk rules. Nothing here touches a model, the network or storage — a host does, on top of
this. Registries (memory types, tool kinds, source types, builtins) are open: the host passes what
it knows in a Context.
"""
from __future__ import annotations

import json
import math
import re
from collections import Counter
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import quote

AGENT_CONTRACT = "agent-definition@1"
AGENT_ADDON_TAG = "agent-addon@1"
AGENT_LIBRARY_ITEM_TAG = "agent-library-item@1"
AGENT_MEMORY_TAG = "agent-memory@1"
AGENTS_CAPABILITY = "axf.agents"

COLLECTIONS = ("agents", "skills", "personas", "lingo", "tools", "workflows", "training")
ADDON_SECTIONS = ("personas", "lingo", "skills", "tools", "agents", "workflows", "training")
MEMORY_TYPES = ("none", "buffer", "summary", "keyword", "vector", "hybrid")
MEMORY_KINDS = ("fact", "episode", "summary", "knowledge", "note")
MEMORY_RECORD_MODES = ("episodes", "facts", "both", "off")
TOOL_KINDS = ("builtin", "http", "mcp", "prompt", "agent", "workflow")
HTTP_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE")
WORKFLOW_MODES = ("sequential", "parallel", "router", "critic")
TRAINING_SOURCE_TYPES = ("firecrawl-scrape", "firecrawl-crawl", "firecrawl-search", "url", "repo", "text", "mcp-resource", "mcp-tool")
TRAINING_SCHEDULES = ("manual", "hourly", "daily", "weekly")
SCHEDULE_SECONDS = {"hourly": 3600, "daily": 86400, "weekly": 7 * 86400}
MEMORY_TOOL_NAMES = ("memory_search", "memory_save")
MEMORY_SECTION = "## Memory\nYou have persistent memory across conversations. Relevant items are provided; use memory_search for more and memory_save for durable facts the user would want remembered."
TOOLS_SECTION_PREFIX = "## Tools\nUse your tools when they help; read before you claim. Tools: "

ID_RE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
TOOL_NAME_RE = re.compile(r"^[a-zA-Z_][a-zA-Z0-9_]{0,63}$")
ADDON_ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
_URL_RE = re.compile(r"^https?://")
_SECRET_HEADER = re.compile(r"(?:bearer\s+\S{12,}|sk-|key)", re.I)

LIMITS = {"name": 120, "description": 1000, "instructions": 30000, "listItems": 200, "listItem": 400, "glossary": 300, "examples": 30, "example": 4000,
          "samples": 20, "voice": 200, "steps": 40, "sources": 40, "memoryText": 8000, "tags": 10, "tag": 30, "workflowLoops": 6, "delegationDepth": 3}
MEMORY_DEFAULTS = {"type": "hybrid", "topK": 6, "window": 8, "maxItems": 2000, "record": "both", "decayDays": 0, "minScore": 0.0}
TRAINING_DEFAULTS = {"chunkSize": 1200, "overlap": 120, "chunkMin": 300, "chunkMax": 6000, "overlapMax": 1000}


@dataclass
class Context:
    """What a validator may consult: known ids per collection (None = unchecked), builtins {name: {description, parameters}}, registries."""
    known: dict[str, set[str]] = field(default_factory=dict)
    builtins: dict[str, dict[str, Any]] | None = None
    memory_types: tuple[str, ...] = MEMORY_TYPES
    tool_kinds: tuple[str, ...] = TOOL_KINDS
    source_types: tuple[str, ...] = TRAINING_SOURCE_TYPES

    def has(self, coll: str, iid: str) -> bool:
        k = self.known.get(coll)
        return True if k is None else iid in k


@dataclass
class Validation:
    errors: list[str]
    warnings: list[str]
    item: dict[str, Any]

    @property
    def ok(self) -> bool:
        return not self.errors


# ---------------------------------------------------------------- helpers

def _is_obj(v: Any) -> bool:
    return isinstance(v, dict)


def _str(v: Any, n: int) -> str:
    if v is None:
        return ""
    if isinstance(v, bool):
        return ("true" if v else "false")[:n]
    if isinstance(v, (dict, list)):
        return json.dumps(v, separators=(",", ":"), ensure_ascii=False)[:n]
    if isinstance(v, float) and v.is_integer():
        return str(int(v))[:n]
    return str(v)[:n]


def _num(v: Any) -> float | None:
    if isinstance(v, bool):
        return 1.0 if v else 0.0
    if isinstance(v, (int, float)):
        return float(v)
    if isinstance(v, str):
        try:
            return float(v.strip()) if v.strip() else None
        except ValueError:
            return None
    return None


def _blank(v: Any) -> bool:
    return v is None or v == ""


def _int(n: float) -> int:
    return int(math.floor(n))


def to_lines(v: Any, max_items: int = LIMITS["listItems"], max_len: int = LIMITS["listItem"]) -> list[str]:
    """A newline-separated string or an array becomes a trimmed, non-empty list (capped)."""
    if isinstance(v, str):
        raw = v.split("\n")
    elif isinstance(v, list):
        raw = ["" if x is None else _str(x, 10**9) for x in v]
    else:
        raw = []
    return [x.strip()[:max_len] for x in (y.strip() for y in raw) if x][:max_items]


def _voice(v: Any) -> dict[str, str]:
    o = v if _is_obj(v) else {}
    return {k: _str(o.get(k), LIMITS["voice"]) for k in ("provider", "voiceId", "hint")}


def _tags(v: Any) -> list[str] | None:
    if v is None:
        return None
    src = v if isinstance(v, list) else v.split(",") if isinstance(v, str) else []
    return to_lines(src, LIMITS["tags"], LIMITS["tag"])


def _refs(ctx: Context, coll: str, ids: Any, self_id: str, warnings: list[str], what: str) -> list[str]:
    out: list[str] = []
    for raw in to_lines(ids):
        if raw == self_id:
            continue
        if not ctx.has(coll, raw):
            warnings.append(f"dropped unknown {what} {raw}")
            continue
        if raw not in out:
            out.append(raw)
    return out


# ---------------------------------------------------------------- validation

def validate_item(collection: str, raw: Any, ctx: Context | None = None) -> Validation:  # noqa: C901 — one branch per collection, like the reference
    ctx = ctx or Context()
    errors: list[str] = []
    warnings: list[str] = []
    if not _is_obj(raw):
        return Validation(["an item must be a JSON object"], warnings, {})
    if collection not in COLLECTIONS:
        return Validation([f"no collection {collection}"], warnings, {})
    item: dict[str, Any] = {k: v for k, v in raw.items() if k not in ("createdAt", "updatedAt", "origin")}
    if item.get("id") is not None and item.get("id") != "":
        iid = _str(item["id"], 10**9).strip()
        if not ID_RE.match(iid):
            errors.append("ids are lowercase letters, digits, dots, dashes and underscores (1–64 characters)")
        item["id"] = iid
    else:
        item.pop("id", None)
    self_id = item.get("id") if isinstance(item.get("id"), str) else ""
    if collection != "training":
        name = _str(item.get("name"), LIMITS["name"] + 1).strip()
        if not name:
            errors.append("a name is required")
        elif len(name) > LIMITS["name"]:
            errors.append(f"name can be at most {LIMITS['name']} characters")
        item["name"] = name
    if "description" in item:
        item["description"] = _str(item["description"], LIMITS["description"])
    tags = _tags(item.get("tags"))
    if tags is not None:
        item["tags"] = tags
    else:
        item.pop("tags", None)

    if collection == "agents":
        m = dict(item["memory"]) if _is_obj(item.get("memory")) else {}
        if m.get("type") and str(m["type"]) not in ctx.memory_types:
            errors.append(f"memory type must be one of {', '.join(ctx.memory_types)}")
        if m.get("record") and str(m["record"]) not in MEMORY_RECORD_MODES:
            errors.append("memory record is episodes, facts, both or off")
        if "scope" in m and not _blank(m["scope"]) and not ID_RE.match(_str(m["scope"], 10**9)):
            errors.append("memory scope must look like an id")
        for k in ("topK", "window", "maxItems", "decayDays"):
            if k in m and not _blank(m[k]):
                n = _num(m[k])
                if n is None or n < 0:
                    errors.append(f"memory {k} must be a number")
                else:
                    m[k] = _int(n)
            else:
                m.pop(k, None)
        item["memory"] = m
        item["skillIds"] = _refs(ctx, "skills", item.get("skillIds"), "", warnings, "skill")
        item["lingoIds"] = _refs(ctx, "lingo", item.get("lingoIds"), "", warnings, "lingo pack")
        item["toolIds"] = _refs(ctx, "tools", item.get("toolIds"), "", warnings, "tool")
        item["delegates"] = _refs(ctx, "agents", item.get("delegates"), self_id, warnings, "delegate")
        persona = _str(item.get("personaId"), LIMITS["name"])
        if persona and not ctx.has("personas", persona):
            warnings.append(f"dropped unknown persona {persona}")
            item["personaId"] = ""
        else:
            item["personaId"] = persona
        if "instructions" in item:
            item["instructions"] = _str(item["instructions"], 10**9)
            if len(item["instructions"]) > LIMITS["instructions"]:
                errors.append(f"instructions can be at most {LIMITS['instructions']} characters")
        if "enabled" in item:
            item["enabled"] = item["enabled"] is not False
        if item.get("voice") is not None:
            if not _is_obj(item["voice"]):
                errors.append("voice is an object {provider, voiceId, hint} or null")
            else:
                item["voice"] = _voice(item["voice"])
        if "model" in item:
            if not _is_obj(item["model"]):
                errors.append("model is an object {profile, model, temperature, max_tokens}")
            else:
                mo: dict[str, Any] = {}
                src = item["model"]
                if src.get("profile"):
                    mo["profile"] = _str(src["profile"], LIMITS["name"])
                if src.get("model"):
                    mo["model"] = _str(src["model"], LIMITS["name"])
                if not _blank(src.get("temperature")):
                    t = _num(src["temperature"])
                    if t is None or t < 0 or t > 2:
                        errors.append("temperature is between 0 and 2")
                    else:
                        mo["temperature"] = int(t) if float(t).is_integer() else t
                if not _blank(src.get("max_tokens")):
                    n = _num(src["max_tokens"])
                    if n is None or n < 1:
                        errors.append("max_tokens is a positive number")
                    else:
                        mo["max_tokens"] = _int(n)
                item["model"] = mo
    elif collection == "personas":
        for k in ("role", "voice", "tone"):
            if k in item:
                item[k] = _str(item[k], LIMITS["description"])
        item["traits"] = to_lines(item.get("traits"))
        item["rules"] = to_lines(item.get("rules"))
        item["samples"] = to_lines(item.get("samples"), LIMITS["samples"], LIMITS["example"])
        if item.get("voiceSlot") is not None:
            if not _is_obj(item["voiceSlot"]):
                errors.append("voiceSlot is an object {provider, voiceId, hint} or null")
            else:
                item["voiceSlot"] = _voice(item["voiceSlot"])
    elif collection == "skills":
        if "instructions" in item:
            item["instructions"] = _str(item["instructions"], 10**9)
            if len(item["instructions"]) > LIMITS["instructions"]:
                errors.append(f"instructions can be at most {LIMITS['instructions']} characters")
        item["triggers"] = to_lines(item.get("triggers"))
        ex = item.get("examples") if isinstance(item.get("examples"), list) else []
        item["examples"] = [{"input": _str(e.get("input"), LIMITS["example"]), "output": _str(e.get("output"), LIMITS["example"])} for e in ex if _is_obj(e)][:LIMITS["examples"]]
        item["toolIds"] = _refs(ctx, "tools", item.get("toolIds"), "", warnings, "tool")
    elif collection == "lingo":
        if "style" in item:
            item["style"] = _str(item["style"], LIMITS["description"])
        g = item.get("glossary") if isinstance(item.get("glossary"), list) else []
        rows = [{"term": _str(e.get("term"), LIMITS["listItem"]), "meaning": _str(e.get("meaning"), LIMITS["listItem"])} for e in g if _is_obj(e)][:LIMITS["glossary"]]
        item["glossary"] = [r for r in rows if r["term"]]
        item["phrases"] = to_lines(item.get("phrases"))
        item["avoid"] = to_lines(item.get("avoid"))
    elif collection == "tools":
        name = _str(item.get("name"), 10**9)
        if not TOOL_NAME_RE.match(name):
            errors.append("tool name must be a function name: letters, digits, underscores (e.g. get_weather)")
        kind = _str(item.get("kind"), 10**9) or "builtin"
        if kind not in ctx.tool_kinds:
            errors.append(f"tool kind must be one of {', '.join(ctx.tool_kinds)}")
        cfg: dict[str, Any] = dict(item["config"]) if _is_obj(item.get("config")) else {}
        params = item.get("parameters")
        if kind == "builtin":
            b = _str(cfg.get("builtin"), 10**9)
            if ctx.builtins is not None and b not in ctx.builtins:
                errors.append(f"unknown builtin; choose one of {', '.join(ctx.builtins)}")
            elif not b:
                errors.append("builtin tools name which builtin they run")
            spec = (ctx.builtins or {}).get(b)
            if not params and spec and spec.get("parameters"):
                params = spec["parameters"]
            if not item.get("description") and spec and spec.get("description"):
                item["description"] = spec["description"]
        if kind == "http":
            if not _URL_RE.match(_str(cfg.get("url"), 10**9)):
                errors.append("http tools need a URL starting with http:// or https://")
            method = (_str(cfg.get("method"), 10**9) or "GET").upper()
            if method not in HTTP_METHODS:
                errors.append("unsupported method")
            else:
                cfg["method"] = method
            for k, v in (cfg.get("headers") if _is_obj(cfg.get("headers")) else {}).items():
                if not isinstance(v, str):
                    errors.append("header values must be strings (use env:VAR for secrets)")
                    continue
                if not v.startswith("env:") and _SECRET_HEADER.search(v) and k.lower() in ("authorization", "x-api-key", "api-key"):
                    errors.append(f"put secrets in an environment variable: set header {k} to env:MY_VAR")
        if kind == "mcp" and (not _URL_RE.match(_str(cfg.get("url"), 10**9)) or not cfg.get("tool")):
            errors.append("mcp tools need a server URL and the remote tool name")
        if kind == "prompt" and not _str(cfg.get("template"), 10**9).strip():
            errors.append("prompt tools need a template")
        if kind == "agent":
            if not cfg.get("agentId"):
                errors.append("agent tools need the agent to delegate to")
            elif not ctx.has("agents", _str(cfg["agentId"], 10**9)):
                errors.append(f"unknown agent {_str(cfg['agentId'], 10**9)}")
        if kind == "workflow":
            if not cfg.get("workflowId"):
                errors.append("workflow tools need a workflow")
            elif not ctx.has("workflows", _str(cfg["workflowId"], 10**9)):
                errors.append(f"unknown workflow {_str(cfg['workflowId'], 10**9)}")
        if params is None:
            params = {"type": "object", "properties": {}}
        if not _is_obj(params) or params.get("type") != "object":
            errors.append("parameters must be a JSON Schema object ({type: object, properties: {...}})")
        item.update(name=name, kind=kind, config=cfg, parameters=params, description=_str(item.get("description"), LIMITS["description"]), dangerous=item.get("dangerous") is True)
        if "enabled" in item:
            item["enabled"] = item["enabled"] is not False
    elif collection == "workflows":
        mode = _str(item.get("mode"), 10**9) or "sequential"
        if mode not in WORKFLOW_MODES:
            errors.append("mode is sequential, parallel, router or critic")
        item["mode"] = mode
        steps = [s for s in (item.get("steps") if isinstance(item.get("steps"), list) else []) if _is_obj(s)][:LIMITS["steps"]]
        out_steps = []
        for i, s in enumerate(steps):
            sid = re.sub(r"[^a-zA-Z0-9_-]", "", _str(s.get("id"), 10**9) or f"s{i + 1}")[:40] or f"s{i + 1}"
            agent_id = _str(s.get("agentId"), 10**9)
            if not agent_id or not ctx.has("agents", agent_id):
                errors.append(f"step {sid}: unknown agent {agent_id}")
            o: dict[str, Any] = {"id": sid, "agentId": agent_id}
            if "prompt" in s:
                o["prompt"] = _str(s["prompt"], LIMITS["instructions"])
            if "label" in s:
                o["label"] = _str(s["label"], LIMITS["name"])
            if "when" in s:
                o["when"] = _str(s["when"], LIMITS["description"])
            if "memory" in s:
                o["memory"] = s["memory"] is not False
            out_steps.append(o)
        item["steps"] = out_steps
        ids = [s["id"] for s in out_steps]
        if len(set(ids)) != len(ids):
            errors.append("step ids must be unique")
        if mode == "router":
            if not item.get("routerAgentId"):
                errors.append("router workflows need a router agent")
            elif not ctx.has("agents", _str(item["routerAgentId"], 10**9)):
                errors.append(f"unknown router agent {_str(item['routerAgentId'], 10**9)}")
        if mode == "parallel" and item.get("synthAgentId") and not ctx.has("agents", _str(item["synthAgentId"], 10**9)):
            errors.append(f"unknown merge agent {_str(item['synthAgentId'], 10**9)}")
        if mode == "critic" and len(out_steps) < 2:
            errors.append("critic workflows need a writer step and a reviewer step")
        if not _blank(item.get("maxLoops")):
            n = _num(item["maxLoops"])
            if n is None or n < 1:
                errors.append("maxLoops is a positive number")
            else:
                item["maxLoops"] = min(_int(n), LIMITS["workflowLoops"])
        else:
            item.pop("maxLoops", None)
    elif collection == "training":
        agent_id = _str(item.get("agentId"), 10**9)
        if not agent_id:
            errors.append("a training job trains one agent: choose it")
        elif not ctx.has("agents", agent_id):
            errors.append(f"unknown agent {agent_id}")
        item["agentId"] = agent_id
        if "name" in item:
            item["name"] = _str(item["name"], LIMITS["name"])
        srcs = [s for s in (item.get("sources") if isinstance(item.get("sources"), list) else []) if _is_obj(s)][:LIMITS["sources"]]
        if not srcs:
            errors.append("add at least one source")
        out_srcs = []
        for s in srcs:
            t = _str(s.get("type"), 10**9)
            o = {**s, "type": t}
            if t not in ctx.source_types:
                errors.append(f"unknown source type {t}")
                out_srcs.append(o)
                continue
            if t in ("firecrawl-scrape", "firecrawl-crawl", "url", "mcp-resource", "mcp-tool") and not _URL_RE.match(_str(s.get("url"), 10**9)):
                errors.append(f"{t} sources need a URL starting with http:// or https://")
            if t == "firecrawl-search" and not _str(s.get("query"), 10**9).strip():
                errors.append("firecrawl-search sources need a query")
            if t == "repo":
                o["paths"] = to_lines(s.get("paths"))
                if not o["paths"]:
                    errors.append("repo sources need at least one file glob")
            if t == "text" and not _str(s.get("text"), 10**9).strip():
                errors.append("text sources need text")
            if t == "mcp-resource" and not s.get("uri"):
                errors.append("mcp-resource sources need the resource uri")
            if t == "mcp-tool" and not s.get("tool"):
                errors.append("mcp-tool sources need the tool name")
            if "tokenEnv" in s:
                o["tokenEnv"] = _str(s["tokenEnv"], LIMITS["name"])
            if "include" in s:
                o["include"] = to_lines(s["include"])
            out_srcs.append(o)
        item["sources"] = out_srcs
        sched = _str(item.get("schedule"), 10**9) or "manual"
        if sched not in TRAINING_SCHEDULES:
            errors.append("schedule is manual, hourly, daily or weekly")
        item["schedule"] = sched
        cs = _num(item.get("chunkSize"))
        cs = TRAINING_DEFAULTS["chunkSize"] if cs is None else cs
        item["chunkSize"] = max(TRAINING_DEFAULTS["chunkMin"], min(_int(cs) if cs > 0 else TRAINING_DEFAULTS["chunkSize"], TRAINING_DEFAULTS["chunkMax"]))
        ov = _num(item.get("overlap"))
        ov = TRAINING_DEFAULTS["overlap"] if ov is None else ov
        item["overlap"] = max(0, min(_int(ov) if ov >= 0 else TRAINING_DEFAULTS["overlap"], TRAINING_DEFAULTS["overlapMax"]))
        item["replace"] = item.get("replace") is not False
        if "autoRun" in item:
            item["autoRun"] = item["autoRun"] is True
    return Validation(errors, warnings, item)


def validate_addon(raw: Any) -> tuple[list[str], dict[str, Any] | None]:
    errors: list[str] = []
    if not _is_obj(raw):
        return ["an add-on must be a JSON object"], None
    if raw.get("$axf") != AGENT_ADDON_TAG:
        errors.append(f'not an agent add-on (expected "$axf": "{AGENT_ADDON_TAG}")')
    if not ADDON_ID_RE.match(_str(raw.get("id"), 10**9)):
        errors.append("add-on id must be lowercase letters, digits and dashes (2–48 characters)")
    if not _is_obj(raw.get("provides")):
        errors.append("add-on has nothing in provides")
    else:
        for k, v in raw["provides"].items():
            if k == "memory":
                if not _is_obj(v):
                    errors.append("provides.memory maps agent ids to lists of items")
                continue
            if k not in ADDON_SECTIONS:
                errors.append(f"unknown section provides.{k}")
            elif not isinstance(v, list):
                errors.append(f"provides.{k} must be a list")
            else:
                for it in v:
                    if not _is_obj(it) or not it.get("id") or not ID_RE.match(_str(it["id"], 10**9)):
                        errors.append(f"every item in provides.{k} needs a valid id")
    return errors, (raw if not errors else None)


# ---------------------------------------------------------------- memory config + text engine

def resolve_memory(agent: dict[str, Any], defaults: dict[str, Any] | None = None) -> dict[str, Any]:
    d = {**MEMORY_DEFAULTS, **(defaults or {})}
    m = agent.get("memory") or {}

    def num(v: Any, fb: int) -> int:
        n = _num(v)
        return fb if n is None or n <= 0 else _int(n)

    dd = _num(m.get("decayDays"))
    ms = _num(m.get("minScore"))
    return {"type": m.get("type") or d["type"], "scope": m.get("scope") or agent.get("id") or "", "topK": num(m.get("topK"), d["topK"]), "window": num(m.get("window"), d["window"]),
            "maxItems": num(m.get("maxItems"), d["maxItems"]), "record": m.get("record") or d["record"], "decayDays": _int(dd) if dd and dd > 0 else d["decayDays"],
            "embedProfile": m.get("embedProfile") or "", "minScore": ms if ms and ms > 0 else d["minScore"]}


_WORD = re.compile(r"[a-z0-9][a-z0-9_.+#-]*")
_STOP = set("a an the and or but if then else of to in on at for with by from is are was were be been being it its this that these those i you he she we they me my your our their as not no do does did have has had can could will would should may might just so than too very what which who whom how when where why all any some such own same other into over under again further once here there about out up down off".split())


def tokens(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]


def bm25_rank(query: str, docs: list[dict[str, Any]], k1: float = 1.4, b: float = 0.75) -> list[tuple[float, int]]:
    """(score rounded to 6 decimals, index) pairs, best first, zero scores dropped."""
    q = tokens(query)
    if not q or not docs:
        return []
    toks = [tokens(f"{d.get('text', '')} {' '.join(d.get('tags') or [])}") for d in docs]
    avg = sum(len(t) for t in toks) / max(1, len(toks))
    df: Counter[str] = Counter()
    for t in toks:
        df.update(set(t))
    n = len(docs)
    out: list[tuple[float, int]] = []
    for i, t in enumerate(toks):
        tf = Counter(t)
        s = 0.0
        for w in q:
            f = tf.get(w)
            if not f:
                continue
            idf = math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5))
            s += idf * f * (k1 + 1) / (f + k1 * (1 - b + b * len(t) / max(1.0, avg)))
        if s > 0:
            out.append((round(s * 1e6) / 1e6, i))
    return sorted(out, key=lambda x: (-x[0], x[1]))


def chunk(text: str, size: int = TRAINING_DEFAULTS["chunkSize"], overlap: int = TRAINING_DEFAULTS["overlap"]) -> list[str]:
    t = re.sub(r"\n{3,}", "\n\n", text.strip())
    if len(t) <= size:
        return [t] if t else []
    paras = re.split(r"\n(?=#{1,6} )|\n\n", t)
    out: list[str] = []
    cur = ""
    for p in paras:
        if len(cur) + len(p) + 2 <= size:
            cur = f"{cur}\n\n{p}" if cur else p
            continue
        if cur:
            out.append(cur)
        while len(p) > size:
            out.append(p[:size])
            p = p[size - overlap:]
        cur = (out[-1][-overlap:] + "\n" if out and overlap else "") + p
    if cur.strip():
        out.append(cur)
    return out


def trim_memory(items: list[dict[str, Any]], max_items: int) -> list[dict[str, Any]]:
    """Which items to forget first when a store is over `max_items`: episodes, then the least used, then the oldest."""
    if len(items) <= max_items:
        return items
    s = sorted(items, key=lambda d: (d.get("kind") != "episode", d.get("hits", 0) or 0, d.get("createdAt", 0) or 0))
    return s[len(s) - max_items:]


# ---------------------------------------------------------------- system prompt

def compose_system_prompt(agent: dict[str, Any], persona: dict[str, Any] | None = None, skills: list[dict[str, Any]] | None = None, lingo: list[dict[str, Any]] | None = None,
                          extras: list[str] | None = None, memory: bool = False, tools: list[str] | None = None) -> str:
    parts = [f"You are {agent.get('name') or agent.get('id')}." + (f" {agent['description']}" if agent.get("description") else "")]
    p = persona
    if p:
        bits = [f"Role: {p['role']}" if p.get("role") else "", f"Voice: {p['voice']}" if p.get("voice") else "", f"Tone: {p['tone']}" if p.get("tone") else ""]
        if p.get("traits"):
            bits.append("Traits: " + ", ".join(p["traits"]))
        txt = "## Persona\n" + "\n".join(x for x in bits if x)
        if p.get("rules"):
            txt += "\nRules:\n" + "\n".join(f"- {r}" for r in p["rules"])
        if p.get("samples"):
            txt += "\nSample replies (match this way of talking, not their content):\n" + "\n".join(f"- {x}" for x in p["samples"][:5])
        parts.append(txt)
    if skills:
        txt = "## Skills"
        for s in skills:
            txt += f"\n\n### {s.get('name', '')}\n{(s.get('instructions') or '').strip()}"
            if s.get("triggers"):
                txt += f"\nUse when: {', '.join(s['triggers'])}"
            for ex in (s.get("examples") or [])[:3]:
                if ex.get("input"):
                    txt += f"\nExample — input: {ex['input'][:400]}\n          output: {(ex.get('output') or '')[:600]}"
        parts.append(txt)
    if lingo:
        txt = "## Lingo"
        for L in lingo:
            if L.get("style"):
                txt += f"\nStyle: {L['style']}"
            if L.get("glossary"):
                txt += "\nGlossary (use these terms exactly):\n" + "\n".join(f"- {g.get('term')}: {g.get('meaning')}" for g in L["glossary"][:80])
            if L.get("phrases"):
                txt += "\nPreferred phrasing: " + "; ".join(L["phrases"][:30])
            if L.get("avoid"):
                txt += "\nAvoid: " + "; ".join(L["avoid"][:30])
        parts.append(txt)
    if (agent.get("instructions") or "").strip():
        parts.append(f"## Instructions\n{agent['instructions'].strip()}")
    for e in extras or []:
        if e.strip():
            parts.append(e.strip())
    if memory:
        parts.append(MEMORY_SECTION)
    if tools:
        parts.append(TOOLS_SECTION_PREFIX + ", ".join(tools))
    return "\n\n".join(parts)


# ---------------------------------------------------------------- workflows + templates

def fill_workflow_template(tpl: str, input_text: str, steps: dict[str, str], previous: str) -> str:
    out = tpl.replace("{{input}}", input_text).replace("{{previous}}", previous)
    return re.sub(r"\{\{\s*steps\.([a-zA-Z0-9_-]+)\s*\}\}", lambda m: steps.get(m.group(1), ""), out)


def parse_router_pick(reply: str, step_ids: list[str]) -> list[str]:
    m = re.search(r"\{.*\}", reply, re.S)
    if not m:
        return []
    try:
        j = json.loads(m.group(0))
    except ValueError:
        return []
    picked = [str(x) for x in j.get("steps", [])] if isinstance(j, dict) and isinstance(j.get("steps"), list) else []
    return [s for s in step_ids if s in picked]


def fill_tool_template(template: str, args: dict[str, Any], url: bool = False) -> str:
    def rep(m: re.Match[str]) -> str:
        v = args.get(m.group(1))
        s = "" if v is None else v if isinstance(v, str) else json.dumps(v, separators=(",", ":"), ensure_ascii=False)
        return quote(s, safe="-_.!~*'()") if url else s
    return re.sub(r"\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}", rep, template)


# ---------------------------------------------------------------- add-ons: risks + stripping + export

def tool_risks(tool: dict[str, Any], label: str = "") -> list[str]:
    out: list[str] = []
    cfg = tool.get("config") if _is_obj(tool.get("config")) else {}
    who = f"{label}: " if label else ""
    for k, v in (cfg.get("headers") if _is_obj(cfg.get("headers")) else {}).items():
        if isinstance(v, str) and v.startswith("env:"):
            out.append(f"{who}header {k} reads environment variable {v[4:]}")
    if cfg.get("allowPrivate"):
        out.append(f"{who}may call private/internal addresses")
    if cfg.get("tokenEnv"):
        out.append(f"{who}sends environment variable {cfg['tokenEnv']} to {cfg.get('url', 'its server')}")
    return out


def addon_risks(bundle: dict[str, Any]) -> list[str]:
    out: list[str] = []
    prov = bundle.get("provides") or {}
    for t in prov.get("tools") or []:
        out += tool_risks(t, f"tool {t.get('name') or t.get('id')}")
    for j in prov.get("training") or []:
        for s in (j.get("sources") if isinstance(j.get("sources"), list) else []):
            if _is_obj(s) and s.get("tokenEnv"):
                out.append(f"training {j.get('id')}: sends environment variable {s['tokenEnv']} to {s.get('url', '')}")
    return out


def strip_tool_risks(tool: dict[str, Any]) -> dict[str, Any]:
    t = json.loads(json.dumps(tool))
    cfg = t.get("config") if _is_obj(t.get("config")) else {}
    cfg["headers"] = {k: v for k, v in (cfg.get("headers") if _is_obj(cfg.get("headers")) else {}).items() if not (isinstance(v, str) and v.startswith("env:"))}
    cfg.pop("allowPrivate", None)
    cfg.pop("tokenEnv", None)
    t["config"] = cfg
    return t


def strip_addon_risks(bundle: dict[str, Any]) -> dict[str, Any]:
    b = json.loads(json.dumps(bundle))
    prov = b.setdefault("provides", {})
    prov["tools"] = [strip_tool_risks(t) for t in prov.get("tools") or []]
    for j in prov.get("training") or []:
        for s in (j.get("sources") if isinstance(j.get("sources"), list) else []):
            if _is_obj(s):
                s.pop("tokenEnv", None)
    return b


def agent_to_addon(agent: dict[str, Any], personas: list[dict[str, Any]], lingo: list[dict[str, Any]], skills: list[dict[str, Any]], tools: list[dict[str, Any]],
                   memory: list[dict[str, Any]] | None = None) -> dict[str, Any]:
    clean = lambda x: {k: v for k, v in x.items() if k not in ("createdAt", "updatedAt", "origin")}  # noqa: E731
    aid = agent["id"]
    return {"$axf": AGENT_ADDON_TAG, "id": f"{aid}-export".replace(".", "-")[:48], "name": agent.get("name") or aid, "version": "1.0.0", "description": agent.get("description", ""),
            "provides": {"personas": [clean(x) for x in personas], "lingo": [clean(x) for x in lingo], "skills": [clean(x) for x in skills], "tools": [clean(x) for x in tools], "agents": [clean(agent)],
                         "memory": {aid: [{"kind": d["kind"], "text": d["text"], "tags": d.get("tags") or [], "source": d.get("source") or ""} for d in (memory or []) if d.get("kind") in ("fact", "knowledge", "note")][:2000]}}}


# ---------------------------------------------------------------- conformance

def check_fixture(fixture: dict[str, Any]) -> list[str]:
    """Replays spec/fixtures/agents.json; returns the mismatches (empty = this port matches the reference)."""
    bad: list[str] = []
    c = fixture["context"]
    ctx = Context(known={k: set(v) for k, v in c["known"].items()}, builtins=c["builtins"])
    for case in fixture["validation"]:
        got = validate_item(case["collection"], case["raw"], ctx)
        exp = case["result"]
        label = f"{case['collection']}/{case['case']}"
        if (got.ok, got.errors, got.warnings) != (exp["ok"], exp["errors"], exp["warnings"]):
            bad.append(f"{label}: {got.errors} {got.warnings} != {exp['errors']} {exp['warnings']}")
        if json.loads(json.dumps(got.item)) != exp["item"]:
            bad.append(f"{label} item: {json.dumps(got.item, sort_keys=True)[:300]} != {json.dumps(exp['item'], sort_keys=True)[:300]}")
    for case in fixture["memoryConfigs"]:
        got = resolve_memory(case["agent"], case["defaults"])
        if got != case["result"]:
            bad.append(f"memory config {case['agent']}: {got} != {case['result']}")
    for case in fixture["tokens"]:
        if tokens(case["text"]) != case["tokens"]:
            bad.append(f"tokens {case['text']!r}")
    docs = fixture["bm25"]["docs"]
    for case in fixture["bm25"]["cases"]:
        got = [[s, i] for s, i in bm25_rank(case["query"], docs)]
        if got != case["rank"]:
            bad.append(f"bm25 {case['query']!r}: {got} != {case['rank']}")
    for case in fixture["chunks"]:
        if chunk(case["text"], case["size"], case["overlap"]) != case["chunks"]:
            bad.append(f"chunk size={case['size']}")
    items = [{"id": "m1", "kind": "episode", "createdAt": 1, "hits": 5}, {"id": "m2", "kind": "fact", "createdAt": 2, "hits": 0}, {"id": "m3", "kind": "episode", "createdAt": 3, "hits": 0},
             {"id": "m4", "kind": "knowledge", "createdAt": 4, "hits": 2}, {"id": "m5", "kind": "fact", "createdAt": 5, "hits": 0}]
    for case in fixture["trim"]:
        if [i["id"] for i in trim_memory(items, case["maxItems"])] != case["kept"]:
            bad.append(f"trim {case['maxItems']}")
    for case in fixture["compose"]:
        i = case["input"]
        got = compose_system_prompt(i["agent"], i.get("persona"), i.get("skills"), i.get("lingo"), i.get("extras"), bool(i.get("memory")), i.get("tools"))
        if got != case["prompt"]:
            bad.append(f"compose {i['agent'].get('id')}")
    for case in fixture["templates"]:
        if fill_workflow_template(case["tpl"], case["input"], case["steps"], case["previous"]) != case["filled"]:
            bad.append(f"template {case['tpl']!r}")
    for case in fixture["router"]:
        if parse_router_pick(case["reply"], case["stepIds"]) != case["picked"]:
            bad.append(f"router {case['reply']!r}")
    for case in fixture["toolTemplates"]:
        if fill_tool_template(case["template"], case["args"], case["url"]) != case["filled"]:
            bad.append(f"tool template {case['template']!r}: {fill_tool_template(case['template'], case['args'], case['url'])!r}")
    for case in fixture["addons"]:
        errors, bundle = validate_addon(case["raw"])
        if (not errors) != case["ok"] or errors != case["errors"]:
            bad.append(f"addon {case['case']}: {errors} != {case['errors']}")
        if bundle is not None:
            if addon_risks(bundle) != case["risks"]:
                bad.append(f"addon risks {case['case']}")
            if strip_addon_risks(bundle) != case["stripped"]:
                bad.append(f"addon strip {case['case']}")
    return bad
