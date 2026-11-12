"""Brains: who answers a chat — Claude (the Claude plan / API) or the local Ollama on the VPS (amberx-llama).

Build rebuild-gizmo-from-scratch-full-claude-style-cha (Nov 2026, Brett: "a full-blown Claude interface where I can
either talk to Claude or talk to my Ollama"). A brain is a named pair of conversation settings (profileId + model, plus
the tool mode a local model starts in); switching a chat's brain is a settings patch, so every assistant@1 surface (the
console chat, Gizmo in AmberX, the hub chat page, REST, MCP, CLI, voice) switches the same way.

The local Ollama runs in its own container, internal only: AXF_OLLAMA_URL (default http://amberx-llama:11434). Its
provider profile (`amberx-llama`, kind ollama, OpenAI-compatible /v1) is created on first use, never with a key.
"""
from __future__ import annotations

import json
import os
import urllib.request
from typing import Any

LOCAL_PROFILE = "amberx-llama"
DEFAULT_LOCAL_URL = "http://amberx-llama:11434"

BRAINS: list[dict[str, Any]] = [
    {"id": "claude-opus", "family": "claude", "label": "Claude Opus", "short": "Opus", "model": "claude-opus-5-5",
     "description": "Claude on the Claude plan: tools, connectors, the crew."},
    {"id": "claude-fable", "family": "claude", "label": "Claude Fable", "short": "Fable", "model": "claude-fable-5-1",
     "description": "Claude's most capable model, for the hard ones."},
    {"id": "local-24b", "family": "local", "label": "Mistral Small 24B (local)", "short": "Mistral 24B", "model": "mistral-small:24b",
     "description": "Your Ollama on the VPS (amberx-llama). Private, free, slower.", "default": True},
    {"id": "local-7b", "family": "local", "label": "Mistral 7B (local)", "short": "Mistral 7B", "model": "mistral:7b",
     "description": "Your Ollama, the small fast model."},
]
DEFAULT_BRAIN = "claude-opus"
_BY_ID = {b["id"]: b for b in BRAINS}


def local_root() -> str:
    """Ollama's root URL (no /v1)."""
    u = (os.environ.get("AXF_OLLAMA_URL") or DEFAULT_LOCAL_URL).strip().rstrip("/")
    return u[:-3] if u.endswith("/v1") else u


def get(brain_id: str) -> dict[str, Any] | None:
    return _BY_ID.get(str(brain_id or ""))


def settings_for(brain_id: str) -> dict[str, Any]:
    """The conversation settings patch for a brain ('' = drop the key). Claude brains clear the profile so the chat
    follows the agent's / default Claude profile; local brains pin the amberx-llama profile and start in chat mode
    (tool rounds on a CPU model are slow; the tool-mode chip still turns them on)."""
    b = get(brain_id)
    if not b:
        raise ValueError(f"unknown brain {brain_id}; one of {', '.join(_BY_ID)}")
    if b["family"] == "claude":
        return {"profileId": "", "model": b["model"]}
    return {"profileId": LOCAL_PROFILE, "model": b["model"], "toolMode": "chat"}


def brain_of(settings: dict[str, Any] | None) -> str:
    """Which brain a conversation's settings amount to (a model nobody listed maps to its family's first brain)."""
    s = settings or {}
    model = str(s.get("model") or "")
    if s.get("profileId") == LOCAL_PROFILE:
        return next((b["id"] for b in BRAINS if b["family"] == "local" and b["model"] == model), "local-24b")
    return next((b["id"] for b in BRAINS if b["family"] == "claude" and b["model"] == model), DEFAULT_BRAIN)


def probe(timeout: float = 1.5) -> dict[str, Any]:
    """Is the local Ollama up, and which models has it pulled? Never raises."""
    try:
        with urllib.request.urlopen(f"{local_root()}/api/tags", timeout=timeout) as r:  # noqa: S310 — internal URL from env
            data = json.loads(r.read().decode() or "{}")
        names = [str(m.get("name") or m.get("model") or "") for m in data.get("models") or []]
        return {"reachable": True, "models": [n for n in names if n], "error": ""}
    except Exception as e:  # noqa: BLE001
        return {"reachable": False, "models": [], "error": str(e)[:200]}


def _pulled(model: str, models: list[str]) -> bool:
    return model in models or f"{model}:latest" in models or any(m.split(":")[0] == model for m in models)


def ensure_local_profile(store: Any) -> dict[str, Any]:
    """Create (or repoint) the amberx-llama provider profile. Idempotent; keeps a label or default model Brett changed."""
    cfg = store.load_config()
    old = (cfg.get("profiles") or {}).get(LOCAL_PROFILE) or {}
    want = f"{local_root()}/v1"
    if old and old.get("baseUrl") == want and old.get("enabled", True):
        return {"id": LOCAL_PROFILE, **{k: old.get(k) for k in ("label", "baseUrl", "defaultModel")}}
    return store.upsert_profile({"id": LOCAL_PROFILE, "kind": "ollama", "label": old.get("label") or "AmberX Llama (Ollama)", "baseUrl": want,
                                 "auth": "none", "keyEnv": "", "enabled": True,
                                 "defaultModel": old.get("defaultModel") or "mistral-small:24b",
                                 "models": [b["model"] for b in BRAINS if b["family"] == "local"]})


def describe(store: Any, check: bool = True) -> dict[str, Any]:
    """brains@1: the list a switcher shows, with what is ready."""
    cfg = store.load_config()
    profs = cfg.get("profiles") or {}
    local = probe() if check else {"reachable": None, "models": [], "error": ""}
    claude_ready = any(p.get("enabled", True) and p.get("kind") in ("claude-code", "anthropic") for p in profs.values())
    items = []
    for b in BRAINS:
        if b["family"] == "claude":
            ready, why = claude_ready, "" if claude_ready else "No Claude provider on the assistant yet (Settings → Plugins → AI assistant)."
        else:
            pulled = _pulled(b["model"], local["models"])
            ready = bool(local["reachable"]) and pulled
            why = "" if ready else ("The local Ollama (amberx-llama) isn't reachable." if not local["reachable"] else f"{b['model']} isn't pulled yet: ollama pull {b['model']}")
        items.append({**b, "ready": ready, "why": why})
    return {"$axf": "brains@1", "items": items, "default": DEFAULT_BRAIN, "localDefault": "local-24b",
            "local": {"url": local_root(), "profile": LOCAL_PROFILE, "profileExists": LOCAL_PROFILE in profs, **local}}
