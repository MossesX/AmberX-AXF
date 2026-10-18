"""Persistent agent memory. One store per scope (an agent's own id, or a named shared scope several agents use).

Memory types (per agent, agent.memory.type)
  none      nothing recalled, nothing recorded
  buffer    the last `window` exchanges, in order
  summary   one rolling summary the model rewrites after each exchange
  keyword   BM25 search over every item (facts, knowledge, episodes), top `topK`
  vector    embedding similarity (needs an embedding model; falls back to keyword when none is reachable)
  hybrid    summary + best search hits (vector or keyword) + the last few exchanges   ← default

Recording (agent.memory.record): episodes (each exchange, condensed), facts (the model extracts durable facts),
both, or off. Training jobs add `knowledge` items; people add `note`/`fact` items by hand.
Items: {id, kind, text, tags, source, jobId, createdAt, hits, lastUsed, vector?}
"""
from __future__ import annotations

import json
import math
import re
import threading
import time
from collections import Counter
from pathlib import Path
from typing import Any

from . import llm, store

_lock = threading.RLock()
TYPES = ("none", "buffer", "summary", "keyword", "vector", "hybrid")
KINDS = ("fact", "episode", "summary", "knowledge", "note")
_WORD = re.compile(r"[a-z0-9][a-z0-9_.+#-]*")
_STOP = set("a an the and or but if then else of to in on at for with by from is are was were be been being it its this that these those i you he she we they me my your our their as not no do does did have has had can could will would should may might just so than too very what which who whom how when where why all any some such own same other into over under again further once here there about out up down off".split())


def config(agent: dict[str, Any]) -> dict[str, Any]:
    d = store.load_settings()["defaults"]
    m = agent.get("memory") or {}
    return {"type": m.get("type") or d.get("memoryType", "hybrid"), "scope": m.get("scope") or agent["id"], "topK": int(m.get("topK") or d.get("topK", 6)),
            "window": int(m.get("window") or d.get("window", 8)), "maxItems": int(m.get("maxItems") or d.get("maxItems", 2000)),
            "record": m.get("record") or "both", "decayDays": int(m.get("decayDays") or 0), "embedProfile": m.get("embedProfile") or "",
            "minScore": float(m.get("minScore") or 0.0)}


def _path(scope: str) -> Path:
    if not re.match(r"^[a-z0-9][a-z0-9._-]{0,63}$", scope):
        raise ValueError("bad memory scope")
    return store.DATA / "memory" / f"{scope}.json"


def load(scope: str) -> dict[str, Any]:
    try:
        return json.loads(_path(scope).read_text())
    except (OSError, ValueError):
        return {"$axf": "agent-memory@1", "scope": scope, "summary": "", "items": []}


def save(scope: str, mem: dict[str, Any]) -> None:
    with _lock:
        p = _path(scope)
        p.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = p.with_suffix(".tmp")
        tmp.write_text(json.dumps(mem, ensure_ascii=False))
        tmp.replace(p)


def tokens(text: str) -> list[str]:
    return [w for w in _WORD.findall(text.lower()) if w not in _STOP and len(w) > 1]


def _bm25(query: str, docs: list[dict[str, Any]], k1: float = 1.4, b: float = 0.75) -> list[tuple[float, dict[str, Any]]]:
    q = tokens(query)
    if not q or not docs:
        return []
    toks = [tokens(d["text"] + " " + " ".join(d.get("tags") or [])) for d in docs]
    avg = sum(len(t) for t in toks) / max(1, len(toks))
    df: Counter[str] = Counter()
    for t in toks:
        df.update(set(t))
    n = len(docs)
    out = []
    for d, t in zip(docs, toks):
        tf = Counter(t)
        s = 0.0
        for w in q:
            if w not in tf:
                continue
            idf = math.log(1 + (n - df[w] + 0.5) / (df[w] + 0.5))
            s += idf * tf[w] * (k1 + 1) / (tf[w] + k1 * (1 - b + b * len(t) / max(1.0, avg)))
        if s > 0:
            out.append((s, d))
    return sorted(out, key=lambda x: -x[0])


def _cos(a: list[float], b: list[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(y * y for y in b))
    return dot / (na * nb) if na and nb else 0.0


def search(scope: str, query: str, k: int = 6, mode: str = "keyword", kinds: tuple[str, ...] | None = None, embed_profile: str = "") -> list[dict[str, Any]]:
    mem = load(scope)
    docs = [d for d in mem["items"] if not kinds or d.get("kind") in kinds]
    hits: list[tuple[float, dict[str, Any]]] = []
    if mode in ("vector", "hybrid") and any(d.get("vector") for d in docs):
        qv = llm.embed([query], embed_profile or None)
        if qv:
            hits = sorted(((_cos(qv[0], d["vector"]), d) for d in docs if d.get("vector")), key=lambda x: -x[0])
            hits = [h for h in hits if h[0] > 0.2]
    if not hits:
        hits = _bm25(query, docs)
    top = [dict(d, score=round(s, 3)) for s, d in hits[:k]]
    if top:
        ids = {d["id"] for d in top}
        with _lock:
            m2 = load(scope)
            for d in m2["items"]:
                if d["id"] in ids:
                    d["hits"] = int(d.get("hits", 0)) + 1
                    d["lastUsed"] = store.now_ms()
            save(scope, m2)
    return [{k2: v for k2, v in d.items() if k2 != "vector"} for d in top]


def add(scope: str, text: str, kind: str = "note", tags: list[str] | None = None, source: str = "", job_id: str = "", embed: bool = False,
        embed_profile: str = "", max_items: int = 5000) -> list[dict[str, Any]]:
    """Add one item (or many, if text is a list of chunks via add_many)."""
    return add_many(scope, [text], kind, tags, source, job_id, embed, embed_profile, max_items)


def add_many(scope: str, texts: list[str], kind: str = "knowledge", tags: list[str] | None = None, source: str = "", job_id: str = "",
             embed: bool = False, embed_profile: str = "", max_items: int = 5000) -> list[dict[str, Any]]:
    if kind not in KINDS:
        raise ValueError(f"memory kind must be one of {', '.join(KINDS)}")
    texts = [t.strip()[:8000] for t in texts if t and t.strip()]
    vectors: list[list[float]] | None = None
    if embed and texts:
        vectors = []
        for i in range(0, len(texts), 32):
            v = llm.embed(texts[i:i + 32], embed_profile or None)
            if v is None:
                vectors = None
                break
            vectors += v
    new = []
    for i, t in enumerate(texts):
        it = {"id": store.new_id("mem"), "kind": kind, "text": t, "tags": [str(x)[:30] for x in (tags or [])][:10], "source": source[:300],
              "jobId": job_id, "createdAt": store.now_ms(), "hits": 0, "lastUsed": None}
        if vectors and i < len(vectors):
            it["vector"] = vectors[i]
        new.append(it)
    with _lock:
        mem = load(scope)
        mem["items"].extend(new)
        if len(mem["items"]) > max_items:  # forget the least useful episodes first, then the oldest others
            mem["items"].sort(key=lambda d: (d.get("kind") != "episode", d.get("hits", 0), d.get("createdAt", 0)))
            mem["items"] = mem["items"][len(mem["items"]) - max_items:]
        save(scope, mem)
    return [{k: v for k, v in d.items() if k != "vector"} for d in new]


def remove(scope: str, item_id: str = "", job_id: str = "", kind: str = "") -> int:
    with _lock:
        mem = load(scope)
        before = len(mem["items"])
        mem["items"] = [d for d in mem["items"] if not ((item_id and d["id"] == item_id) or (job_id and d.get("jobId") == job_id) or (kind and d.get("kind") == kind))]
        save(scope, mem)
        return before - len(mem["items"])


def clear(scope: str) -> None:
    p = _path(scope)
    if p.exists():
        p.unlink()


def stats(scope: str) -> dict[str, Any]:
    mem = load(scope)
    c = Counter(d.get("kind") for d in mem["items"])
    return {"scope": scope, "items": len(mem["items"]), "byKind": dict(c), "summary": bool(mem.get("summary")), "vectors": sum(1 for d in mem["items"] if d.get("vector")),
            "bytes": _path(scope).stat().st_size if _path(scope).exists() else 0}


def decay(scope: str, days: int) -> int:
    if days <= 0:
        return 0
    cutoff = store.now_ms() - days * 86_400_000
    with _lock:
        mem = load(scope)
        before = len(mem["items"])
        mem["items"] = [d for d in mem["items"] if d.get("kind") != "episode" or (d.get("lastUsed") or d.get("createdAt", 0)) >= cutoff]
        save(scope, mem)
        return before - len(mem["items"])


# ---------------------------------------------------------------- what chats use

def context_for(agent: dict[str, Any], query: str) -> str:
    cfg = config(agent)
    t = cfg["type"]
    if t == "none":
        return ""
    mem = load(cfg["scope"])
    parts: list[str] = []
    if t in ("summary", "hybrid") and mem.get("summary"):
        parts.append(f"Summary of earlier conversations:\n{mem['summary']}")
    if t in ("keyword", "vector", "hybrid") and query.strip():
        hits = search(cfg["scope"], query, cfg["topK"], "vector" if t in ("vector", "hybrid") else "keyword",
                      ("fact", "knowledge", "note", "episode") if t != "hybrid" else ("fact", "knowledge", "note"), cfg["embedProfile"])
        if hits:
            parts.append("Relevant items:\n" + "\n".join(f"- [{h['kind']}{' · ' + h['source'] if h.get('source') else ''}] {h['text'][:1200]}" for h in hits))
    if t in ("buffer", "hybrid"):
        eps = [d for d in mem["items"] if d.get("kind") == "episode"][-(cfg["window"] if t == "buffer" else min(3, cfg["window"])):]
        if eps:
            parts.append("Recent exchanges:\n" + "\n".join(f"- {d['text'][:600]}" for d in eps))
    return "\n\n".join(parts)[:16_000]


def record(agent: dict[str, Any], user_text: str, reply: str, meta: dict[str, Any] | None = None) -> None:
    cfg = config(agent)
    if cfg["type"] == "none" or cfg["record"] == "off" or not (user_text or reply):
        return
    scope = cfg["scope"]
    embed = cfg["type"] in ("vector", "hybrid")
    if cfg["record"] in ("episodes", "both"):
        ep = f"User: {user_text.strip()[:500]} → {agent.get('name', 'Agent')}: {reply.strip()[:700]}"
        add(scope, ep, "episode", source=f"chat {(meta or {}).get('conversationId', '')}".strip(), embed=embed, embed_profile=cfg["embedProfile"], max_items=cfg["maxItems"])
    if cfg["record"] in ("facts", "both") or cfg["type"] in ("summary", "hybrid"):
        threading.Thread(target=_reflect, args=(agent, cfg, user_text, reply), daemon=True).start()
    if cfg["decayDays"]:
        decay(scope, cfg["decayDays"])


def _reflect(agent: dict[str, Any], cfg: dict[str, Any], user_text: str, reply: str) -> None:
    """Background: extract durable facts and/or roll the summary forward. Best effort; failures are silent."""
    try:
        mem = load(cfg["scope"])
        want_facts = cfg["record"] in ("facts", "both")
        want_summary = True  # same call either way; keeps the summary ready if the agent switches to summary/hybrid
        ask = (
            "You maintain an AI agent's long-term memory. Given the previous summary and the latest exchange, reply with JSON only: "
            '{"facts": ["durable fact about the user, their projects, preferences or decisions", ...], "summary": "updated summary, <= 1200 characters"}. '
            "Facts must be stated or clearly implied by the user, useful later, and not already in the summary. Use [] when there are none."
        )
        out = llm.complete([{"role": "user", "content": f"Previous summary:\n{mem.get('summary') or '(none)'}\n\nLatest exchange:\nUser: {user_text[:3000]}\nAgent: {reply[:3000]}"}],
                           system=ask, model_cfg={**(agent.get("model") or {}), "temperature": 0, "max_tokens": 800})
        m = re.search(r"\{.*\}", out.get("text", ""), re.S)
        if not m:
            return
        j = json.loads(m.group(0))
        if want_facts:
            facts = [str(f) for f in (j.get("facts") or []) if isinstance(f, str) and len(f) > 8][:6]
            existing = {d["text"].lower() for d in mem["items"] if d.get("kind") == "fact"}
            facts = [f for f in facts if f.lower() not in existing]
            if facts:
                add_many(cfg["scope"], facts, "fact", source="reflection", embed=cfg["type"] in ("vector", "hybrid"), embed_profile=cfg["embedProfile"], max_items=cfg["maxItems"])
        if want_summary and isinstance(j.get("summary"), str) and j["summary"].strip():
            with _lock:
                m2 = load(cfg["scope"])
                m2["summary"] = j["summary"].strip()[:1500]
                m2["summaryAt"] = store.now_ms()
                save(cfg["scope"], m2)
    except Exception:  # noqa: BLE001
        return


def chunk(text: str, size: int = 1200, overlap: int = 120) -> list[str]:
    """Split on headings/paragraphs into ~size-character chunks with a little overlap."""
    text = re.sub(r"\n{3,}", "\n\n", text.strip())
    if len(text) <= size:
        return [text] if text else []
    paras = re.split(r"\n(?=#{1,6} )|\n\n", text)
    out, cur = [], ""
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


def now() -> float:
    return time.time()
