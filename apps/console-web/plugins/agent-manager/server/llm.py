"""Model access for the agent manager.

1. If a plugin provides `axf.llm@1` (the AI assistant does) and settings.preferAssistant is on, use it: same provider
   profiles, keys, fallback chain and usage accounting as the chat.
2. Otherwise use the manager's own minimal client (settings.llm): Anthropic Messages or any OpenAI-compatible
   Chat Completions endpoint, non-streaming, with tools. Standard library only.
"""
from __future__ import annotations

import json
import ssl
import urllib.error
import urllib.request
from typing import Any

import plugin_services

from . import store

_SSL = ssl.create_default_context()
BASES = {"anthropic": "https://api.anthropic.com", "openai": "https://api.openai.com/v1", "ollama": "http://localhost:11434/v1"}


class LlmError(Exception):
    pass


def assistant():
    s = store.load_settings()
    return plugin_services.get("axf.llm@1") if s.get("preferAssistant", True) else None


def describe() -> dict[str, Any]:
    svc = assistant()
    if svc:
        try:
            profs = svc.profiles()
        except Exception:  # noqa: BLE001
            profs = []
        return {"source": "assistant", "profiles": [{"id": p["id"], "label": p["label"], "defaultModel": p["defaultModel"], "ready": p.get("keyReady")} for p in profs]}
    llm = store.load_settings()["llm"]
    return {"source": "own", "kind": llm.get("kind"), "model": llm.get("model"), "ready": bool(store.secret("llm")) or llm.get("kind") == "ollama", "profiles": []}


def _post(url: str, headers: dict[str, str], body: dict[str, Any], timeout: float = 300) -> dict[str, Any]:
    req = urllib.request.Request(url, data=json.dumps(body).encode(), headers={"content-type": "application/json", **headers}, method="POST")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_SSL) as r:  # noqa: S310 — owner-configured endpoint
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            j = json.loads(e.read())
            msg = (j.get("error") or {}).get("message") if isinstance(j.get("error"), dict) else j.get("error")
        except Exception:  # noqa: BLE001
            msg = e.reason
        raise LlmError(f"HTTP {e.code}: {str(msg)[:300]}") from None
    except urllib.error.URLError as e:
        raise LlmError(f"cannot reach {url}: {e.reason}") from None


def _own_complete(messages, system, tools, model, params) -> dict[str, Any]:
    cfg = store.load_settings()["llm"]
    kind = cfg.get("kind", "anthropic")
    key = store.secret("llm")
    model = model or cfg.get("model")
    base = (cfg.get("baseUrl") or BASES.get(kind, BASES["openai"])).rstrip("/")
    if kind == "anthropic":
        if not key:
            raise LlmError("no model is configured: install the AI assistant, or add a key in Settings → Agent manager → Model")
        wire = []
        for m in messages:
            if m["role"] == "tool":
                blk = {"type": "tool_result", "tool_use_id": m["tool_call_id"], "content": m["content"]}
                if wire and wire[-1]["role"] == "user" and isinstance(wire[-1]["content"], list) and wire[-1]["content"] and wire[-1]["content"][0].get("type") == "tool_result":
                    wire[-1]["content"].append(blk)
                else:
                    wire.append({"role": "user", "content": [blk]})
            elif m["role"] == "assistant" and m.get("tool_calls"):
                wire.append({"role": "assistant", "content": ([{"type": "text", "text": m["content"]}] if m.get("content") else []) +
                             [{"type": "tool_use", "id": t["id"], "name": t["name"], "input": t.get("arguments") or {}} for t in m["tool_calls"]]})
            else:
                wire.append({"role": m["role"], "content": m.get("content") or "(empty)"})
        body: dict[str, Any] = {"model": model, "max_tokens": int(params.get("max_tokens") or 4096), "messages": wire}
        if system:
            body["system"] = system
        if params.get("temperature") is not None:
            body["temperature"] = params["temperature"]
        if tools:
            body["tools"] = [{"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("parameters") or {"type": "object", "properties": {}}} for t in tools]
        j = _post(f"{base}/v1/messages", {"x-api-key": key, "anthropic-version": "2023-06-01"}, body)
        text = "".join(b.get("text", "") for b in j.get("content", []) if b.get("type") == "text")
        calls = [{"id": b["id"], "name": b["name"], "arguments": b.get("input") or {}} for b in j.get("content", []) if b.get("type") == "tool_use"]
        u = j.get("usage", {})
        return {"text": text, "tool_calls": calls, "usage": {"input": u.get("input_tokens", 0), "output": u.get("output_tokens", 0)}, "model": model, "profile": "own"}
    wire = [{"role": "system", "content": system}] if system else []
    for m in messages:
        if m["role"] == "tool":
            wire.append({"role": "tool", "tool_call_id": m["tool_call_id"], "content": m["content"]})
        elif m["role"] == "assistant" and m.get("tool_calls"):
            wire.append({"role": "assistant", "content": m.get("content") or "", "tool_calls": [{"id": t["id"], "type": "function", "function": {"name": t["name"], "arguments": json.dumps(t.get("arguments") or {})}} for t in m["tool_calls"]]})
        else:
            wire.append({"role": m["role"], "content": m.get("content") or ""})
    body = {"model": model, "messages": wire}
    if params.get("temperature") is not None:
        body["temperature"] = params["temperature"]
    if params.get("max_tokens"):
        body["max_tokens"] = int(params["max_tokens"])
    if tools:
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t.get("parameters") or {"type": "object", "properties": {}}}} for t in tools]
    j = _post(f"{base}/chat/completions", {"authorization": f"Bearer {key}"} if key else {}, body)
    msg = (j.get("choices") or [{}])[0].get("message") or {}
    calls = []
    for t in msg.get("tool_calls") or []:
        try:
            args = json.loads(t["function"].get("arguments") or "{}")
        except ValueError:
            args = {}
        calls.append({"id": t.get("id") or "call", "name": t["function"]["name"], "arguments": args})
    u = j.get("usage") or {}
    return {"text": msg.get("content") or "", "tool_calls": calls, "usage": {"input": u.get("prompt_tokens", 0), "output": u.get("completion_tokens", 0)}, "model": model, "profile": "own"}


def complete(messages: list[dict[str, Any]], system: str | None = None, tools: list[dict[str, Any]] | None = None,
             model_cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    mc = model_cfg or {}
    params = {k: mc[k] for k in ("temperature", "max_tokens") if mc.get(k) not in (None, "")}
    svc = assistant()
    if svc:
        return svc.complete(messages, system=system, profile=mc.get("profile") or None, model=mc.get("model") or None, tools=tools, params=params)
    return _own_complete(messages, system, tools, mc.get("model") or None, params)


def embed(texts: list[str], profile: str | None = None) -> list[list[float]] | None:
    """Vectors for memory, or None when no embedding model is reachable (memory then uses keyword search)."""
    if not texts:
        return []
    svc = assistant()
    try:
        if svc:
            return svc.embed(texts, profile=profile or None)
        cfg = store.load_settings()["llm"]
        if cfg.get("kind") == "anthropic" and not cfg.get("embedModel"):
            return None
        base = (cfg.get("baseUrl") or BASES.get(cfg.get("kind", "openai"), BASES["openai"])).rstrip("/")
        key = store.secret("llm")
        j = _post(f"{base}/embeddings", {"authorization": f"Bearer {key}"} if key else {}, {"model": cfg.get("embedModel") or "text-embedding-3-small", "input": texts[:64]}, timeout=60)
        return [d.get("embedding", []) for d in sorted(j.get("data", []), key=lambda d: d.get("index", 0))]
    except Exception:  # noqa: BLE001 — memory must keep working without embeddings
        return None


def test() -> dict[str, Any]:
    out = complete([{"role": "user", "content": "Reply with exactly: OK"}], system="Connection test.", model_cfg={"max_tokens": 16, "temperature": 0})
    return {"ok": True, "reply": out["text"].strip()[:60], "source": describe()["source"], "model": out.get("model")}
