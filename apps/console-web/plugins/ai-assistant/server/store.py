"""Storage for the AI assistant: everything lives in ONE folder (plugin-lifecycle@1 dataDir).

    .axf-console/plugins/ai-assistant/        (AXF_AI_ASSISTANT_DIR overrides; 0700)
      config.json          settings + provider profiles (stored keys live only here, 0600; never sent to the browser)
      usage.json           calls and tokens per day / profile / model
      usage-users.json     tokens per hub user per day (the per-user daily cap)
      conversations/<id>.json   ai-conversation@1
      sessions/<id>.json   live-session@1 event logs (sessions.py)
      providers.json       optional: extra provider kinds (ai-providers@1 shape) merged over the framework registry

Formats are unchanged from the Opus build (ai-assistant-config@1, ai-conversation@1), so nothing migrates today; the
`migrate()` runner below is where a later format change goes (it stamps `schema` in config.json and runs the steps
once, in order).
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from copy import deepcopy
from pathlib import Path
from typing import Any, Callable

from axf.contracts import assistant as contract

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
DATA = Path(os.environ.get("AXF_AI_ASSISTANT_DIR", ROOT / ".axf-console" / "plugins" / "ai-assistant"))
CONV = DATA / "conversations"
_lock = threading.RLock()
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,47}$")
CONV_ID_RE = re.compile(r"^[a-z0-9-]{4,64}$")
MASK = "••••••••"
SCHEMA = 1  # data-folder schema version; bump with a migration step

PERSONAS: dict[str, str] = {
    "professional": "Be precise, well structured and professional. Prefer short paragraphs and lists; use code blocks for code, commands and paths.",
    "friendly": "Be warm, encouraging and conversational while staying accurate and to the point.",
    "concise": "Answer in as few words as accuracy allows. No preamble, no recap.",
    "teacher": "Explain step by step, check understanding, and give small examples. Define terms the first time you use them.",
    "engineer": "Think like a senior software engineer: name trade-offs, edge cases and failure modes; show working code; prefer the simplest robust design.",
    "custom": "",
}

DEFAULT_CONFIG: dict[str, Any] = {
    "$axf": "ai-assistant-config@1",
    "schema": SCHEMA,
    "setupComplete": False,
    "assistantName": "Amber",
    "persona": "professional",
    "instructions": "",
    "defaultProfile": "",
    "fallback": [],
    "params": {"temperature": 0.7, "max_tokens": 4096, "top_p": None, "thinking": False, "thinking_budget": 4096, "reasoning_effort": ""},
    "contextMessages": 40,
    "tools": {"repo": True, "utility": True, "web": False},
    "maxToolRounds": 12,
    "autoTitle": True,
    "showUsage": True,
    "showThinking": False,
    "redactSecrets": True,
    "dailyTokenBudget": 0,
    "agentIntegration": True,
    "defaultAgent": "",
    "sessionHost": "local",
    "userDailyTokens": 50000,
    "keepInterrupted": True,
    "suggestions": [
        "Explain how the theme engine compiles a color-theme asset",
        "Where are console plugins loaded, and how do I write one?",
        "Summarise the open build-queue steps",
        "Review this TypeScript for bugs",
    ],
    "prompts": [
        {"id": "review", "title": "Code review", "shortcut": "/review", "text": "Review the following code for bugs, edge cases and readability. List issues by severity, then show a corrected version:\n\n"},
        {"id": "explain", "title": "Explain simply", "shortcut": "/explain", "text": "Explain this simply, then in technical depth:\n\n"},
        {"id": "plan", "title": "Implementation plan", "shortcut": "/plan", "text": "Write a step-by-step implementation plan (files, functions, tests, risks) for:\n\n"},
        {"id": "commit", "title": "Commit message", "shortcut": "/commit", "text": "Write a clear git commit message (subject ≤ 72 chars, then body) for this diff:\n\n"},
    ],
    "profiles": {},
}


def _write(path: Path, data: Any, private: bool = False) -> None:
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    if private:
        os.chmod(tmp, 0o600)
    tmp.replace(path)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return deepcopy(default)


def now_ms() -> int:
    return int(time.time() * 1000)


def new_id(prefix: str = "") -> str:
    return f"{prefix}{time.strftime('%y%m%d')}-{secrets.token_hex(4)}"


# ---------------------------------------------------------------- migrations (format changes land here)

# (from_schema, step): each step takes the raw config dict and the data folder and returns the new config dict.
MIGRATIONS: list[tuple[int, Callable[[dict[str, Any], Path], dict[str, Any]]]] = []
_migrated = False


def migrate() -> int:
    """Run pending migration steps once per process; returns the schema version in force."""
    global _migrated
    with _lock:
        if _migrated:
            return SCHEMA
        _migrated = True
        raw = _read(DATA / "config.json", None)
        if not isinstance(raw, dict):
            return SCHEMA
        have = int(raw.get("schema") or 0)
        changed = False
        for frm, step in sorted(MIGRATIONS, key=lambda m: m[0]):
            if have <= frm < SCHEMA:
                raw = step(raw, DATA)
                have = frm + 1
                changed = True
        if changed or raw.get("schema") != SCHEMA:
            raw["schema"] = SCHEMA
            _write(DATA / "config.json", raw, private=True)
        return SCHEMA


# ---------------------------------------------------------------- config + profiles

def load_config() -> dict[str, Any]:
    with _lock:
        migrate()
        raw = _read(DATA / "config.json", {})
        cfg = {**deepcopy(DEFAULT_CONFIG), **raw}
        cfg["params"] = {**DEFAULT_CONFIG["params"], **(raw.get("params") or {})}
        cfg["tools"] = {**DEFAULT_CONFIG["tools"], **(raw.get("tools") or {})}
        return cfg


def save_config(cfg: dict[str, Any]) -> None:
    with _lock:
        cfg["schema"] = SCHEMA
        _write(DATA / "config.json", cfg, private=True)


def extra_provider_kinds() -> list[dict[str, Any]]:
    """App-added provider kinds (ai-providers@1 shape) from the data folder; merged over the framework registry."""
    raw = _read(DATA / "providers.json", {})
    items = raw.get("providers") if isinstance(raw, dict) else raw
    return [p for p in (items or []) if isinstance(p, dict) and isinstance(p.get("kind"), str) and p.get("kind")]


def public_profile(pid: str, p: dict[str, Any]) -> dict[str, Any]:
    from . import providers
    env = p.get("keyEnv") or ""
    cat = providers.kind(p.get("kind", ""))
    return {
        "id": pid, "kind": p.get("kind", "custom"), "label": p.get("label") or pid, "baseUrl": p.get("baseUrl", ""),
        "auth": p.get("auth") or cat.get("auth", "bearer"),
        "keyEnv": env, "hasKey": bool(p.get("key")), "envPresent": bool(env and os.environ.get(env)),
        "keyReady": bool(providers.resolve_key(p)) or bool(cat.get("local")) or p.get("auth") == "none",
        "defaultModel": p.get("defaultModel", ""), "models": p.get("models", []), "embedModel": p.get("embedModel", ""),
        "enabled": p.get("enabled", True) is not False, "headers": {k: MASK for k in (p.get("headers") or {})},
        "lastTest": p.get("lastTest"), "createdAt": p.get("createdAt"),
    }


def public_config(cfg: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = cfg or load_config()
    out = {k: v for k, v in cfg.items() if k != "profiles"}
    out["profiles"] = [public_profile(k, v) for k, v in cfg.get("profiles", {}).items()]
    return out


def upsert_profile(body: dict[str, Any]) -> dict[str, Any]:
    from . import providers
    with _lock:
        cfg = load_config()
        profiles = cfg.setdefault("profiles", {})
        kind = str(body.get("kind") or "custom")
        cat = providers.kind(kind)
        if not cat:
            raise ValueError(f"unknown provider kind {kind}")
        pid = str(body.get("id") or "").strip()
        if not pid:
            base = re.sub(r"[^a-z0-9]+", "-", str(body.get("label") or kind).lower()).strip("-")[:40] or kind
            pid, n = base, 2
            while pid in profiles:
                pid, n = f"{base}-{n}", n + 1
        if not ID_RE.match(pid):
            raise ValueError("profile id must be lowercase letters, digits and dashes")
        old = profiles.get(pid, {})
        env = str(body.get("keyEnv", old.get("keyEnv", cat.get("keyEnv", ""))) or "")
        if env and not re.match(r"^[A-Z_][A-Z0-9_]{0,63}$", env):
            raise ValueError("keyEnv must be an environment variable name like OPENAI_API_KEY")
        base_url = str(body.get("baseUrl") or old.get("baseUrl") or cat.get("baseUrl", "")).strip()
        if base_url and not re.match(r"^https?://", base_url) and cat["protocol"] != "claude-cli":
            raise ValueError("baseUrl must start with http:// or https://")
        headers = body.get("headers", old.get("headers", {})) or {}
        if isinstance(headers, dict):  # the browser only ever sees masked values: keep the stored one for those
            headers = {k: (old.get("headers", {}).get(k, "") if v == MASK else v) for k, v in headers.items()}
        if not isinstance(headers, dict) or any(not isinstance(k, str) or not isinstance(v, str) for k, v in headers.items()):
            raise ValueError("headers must be a map of strings")
        rec = {
            "kind": kind, "label": str(body.get("label") or old.get("label") or cat["label"])[:80], "baseUrl": base_url,
            "auth": str(body.get("auth") or old.get("auth") or cat.get("auth", "bearer")), "keyEnv": env,
            "defaultModel": str(body.get("defaultModel", old.get("defaultModel", (cat.get("models") or [""])[0])) or "")[:200],
            "models": [str(m)[:200] for m in (body.get("models", old.get("models", [])) or [])][:500],
            "embedModel": str(body.get("embedModel", old.get("embedModel", "")) or "")[:200],
            "enabled": body.get("enabled", old.get("enabled", True)) is not False,
            "headers": {k[:80]: v[:400] for k, v in headers.items()},
            "createdAt": old.get("createdAt") or now_ms(), "lastTest": old.get("lastTest"),
        }
        key = body.get("key")
        if key is None or key == MASK:
            if old.get("key"):
                rec["key"] = old["key"]
        elif str(key).strip():
            k = re.sub(r"\s+", "", str(key))
            if cat["protocol"] == "anthropic" and k.startswith("sk-ant-oat"):
                raise ValueError("that's a Claude Code subscription token (sk-ant-oat…), not an API key: put it in the “Claude Code (subscription)” provider. Anthropic API keys start with sk-ant-api…")
            if cat["protocol"] == "claude-cli" and k.startswith("sk-ant-api"):
                raise ValueError("that's an Anthropic API key (sk-ant-api…): put it in the “Anthropic (Claude)” provider. The subscription provider needs the token from `claude setup-token` (sk-ant-oat…)")
            rec["key"] = k
        profiles[pid] = rec
        if not cfg.get("defaultProfile"):
            cfg["defaultProfile"] = pid
        save_config(cfg)
        return public_profile(pid, rec)


def delete_profile(pid: str) -> None:
    with _lock:
        cfg = load_config()
        if cfg.get("profiles", {}).pop(pid, None) is None:
            raise KeyError(pid)
        if cfg.get("defaultProfile") == pid:
            cfg["defaultProfile"] = next(iter(cfg["profiles"]), "")
        cfg["fallback"] = [f for f in cfg.get("fallback", []) if f != pid]
        save_config(cfg)


def get_profile(pid: str | None) -> tuple[str, dict[str, Any]]:
    cfg = load_config()
    profiles = cfg.get("profiles", {})
    pid = pid or cfg.get("defaultProfile") or next(iter(profiles), "")
    if not pid or pid not in profiles:
        raise KeyError("no provider is set up yet: run the setup wizard in Settings → Plugins → AI assistant")
    return pid, profiles[pid]


def record_test(pid: str, result: dict[str, Any]) -> None:
    with _lock:
        cfg = load_config()
        if pid in cfg.get("profiles", {}):
            cfg["profiles"][pid]["lastTest"] = {"at": now_ms(), **{k: v for k, v in result.items() if k in ("ok", "ms", "reply", "error", "model")}}
            save_config(cfg)


# ---------------------------------------------------------------- usage

def add_usage(pid: str, model: str, usage: dict[str, Any]) -> None:
    with _lock:
        u = _read(DATA / "usage.json", {"days": {}})
        day = time.strftime("%Y-%m-%d")
        slot = u.setdefault("days", {}).setdefault(day, {}).setdefault(f"{pid}|{model}", {"calls": 0, "input": 0, "output": 0})
        slot["calls"] += 1
        slot["input"] += int(usage.get("input", 0) or 0)
        slot["output"] += int(usage.get("output", 0) or 0)
        for d in sorted(u["days"])[:-120]:
            u["days"].pop(d, None)
        _write(DATA / "usage.json", u)


def usage_summary() -> dict[str, Any]:
    u = _read(DATA / "usage.json", {"days": {}})
    today = time.strftime("%Y-%m-%d")
    by_key: dict[str, dict[str, int]] = {}
    per_day = []
    for day in sorted(u.get("days", {})):
        tot = {"calls": 0, "input": 0, "output": 0}
        for k, v in u["days"][day].items():
            agg = by_key.setdefault(k, {"calls": 0, "input": 0, "output": 0})
            for f in tot:
                agg[f] += v.get(f, 0)
                tot[f] += v.get(f, 0)
        per_day.append({"day": day, **tot})
    t = next((d for d in per_day if d["day"] == today), {"calls": 0, "input": 0, "output": 0})
    return {"today": t, "days": per_day[-30:], "byProfileModel": [{"profile": k.split("|")[0], "model": k.split("|", 1)[1], **v} for k, v in sorted(by_key.items())]}


def tokens_today() -> int:
    t = usage_summary()["today"]
    return int(t.get("input", 0)) + int(t.get("output", 0))


def add_user_usage(user: str, usage: dict[str, Any]) -> None:
    """Tokens per hub user per day (for the per-user daily cap)."""
    with _lock:
        u = _read(DATA / "usage-users.json", {"days": {}})
        day = time.strftime("%Y-%m-%d")
        slot = u.setdefault("days", {}).setdefault(day, {})
        slot[user] = int(slot.get(user, 0)) + int(usage.get("input", 0) or 0) + int(usage.get("output", 0) or 0)
        for d in sorted(u["days"])[:-31]:
            u["days"].pop(d, None)
        _write(DATA / "usage-users.json", u)


def user_tokens_today(user: str) -> int:
    u = _read(DATA / "usage-users.json", {"days": {}})
    return int((u.get("days", {}).get(time.strftime("%Y-%m-%d"), {}) or {}).get(user, 0))


def user_usage_summary() -> list[dict[str, Any]]:
    """Per-user token totals for today and the last 30 days (admins' usage panel)."""
    u = _read(DATA / "usage-users.json", {"days": {}})
    today = time.strftime("%Y-%m-%d")
    out: dict[str, dict[str, int]] = {}
    for day, users in sorted(u.get("days", {}).items())[-30:]:
        for name, n in (users or {}).items():
            slot = out.setdefault(name, {"today": 0, "month": 0})
            slot["month"] += int(n or 0)
            if day == today:
                slot["today"] += int(n or 0)
    return [{"user": k, **v} for k, v in sorted(out.items())]


# ---------------------------------------------------------------- conversations

def _cpath(cid: str) -> Path:
    if not CONV_ID_RE.match(cid or ""):
        raise KeyError(cid)
    return CONV / f"{cid}.json"


def _summary(c: dict[str, Any]) -> dict[str, Any]:
    msgs = c.get("messages", [])
    last = next((m for m in reversed(msgs) if m.get("role") in ("user", "assistant")), None)
    return {"id": c["id"], "title": c.get("title", "New conversation"), "pinned": bool(c.get("pinned")), "archived": bool(c.get("archived")),
            "tags": c.get("tags", []), "updatedAt": c.get("updatedAt"), "createdAt": c.get("createdAt"),
            "messages": sum(1 for m in msgs if m.get("role") in ("user", "assistant")),
            "agentId": (c.get("settings") or {}).get("agentId", ""), "owner": c.get("owner") or "", "preview": str((last or {}).get("content", ""))[:120]}


# Listing re-reads only files that changed (mtime + size), so a big history stays cheap to list and search.
_index: dict[str, tuple[tuple[int, int], dict[str, Any], str]] = {}


def _scan() -> list[tuple[dict[str, Any], str]]:
    """(summary, searchable text) for every conversation file, from the cache where unchanged."""
    out = []
    if not CONV.exists():
        return out
    seen = set()
    with _lock:
        for f in CONV.glob("*.json"):
            try:
                st = f.stat()
            except OSError:
                continue
            key = (int(st.st_mtime_ns), st.st_size)
            seen.add(f.name)
            hit = _index.get(f.name)
            if hit and hit[0] == key:
                out.append((hit[1], hit[2]))
                continue
            c = _read(f, None)
            if not isinstance(c, dict) or not c.get("id"):
                continue
            text = (c.get("title", "") + "\n" + "\n".join(str(m.get("content", "")) for m in c.get("messages", []))).lower()
            s = _summary(c)
            _index[f.name] = (key, s, text)
            out.append((s, text))
        for gone in [k for k in _index if k not in seen]:
            _index.pop(gone, None)
    return out


def list_conversations(q: str = "", archived: bool = False, owner: str | None = None, tag: str = "") -> list[dict[str, Any]]:
    """owner=None lists everything (admins); otherwise only that hub user's conversations."""
    ql = q.lower().strip()
    out = []
    for s, text in _scan():
        if s["archived"] != archived:
            continue
        if owner is not None and s["owner"] != owner:
            continue
        if tag and tag not in s["tags"]:
            continue
        if ql and ql not in text:
            continue
        out.append(dict(s))
    out.sort(key=lambda c: (not c["pinned"], -(c["updatedAt"] or 0)))
    return out


def all_tags(owner: str | None = None) -> list[str]:
    tags: dict[str, int] = {}
    for s, _ in _scan():
        if owner is not None and s["owner"] != owner:
            continue
        for t in s["tags"]:
            tags[t] = tags.get(t, 0) + 1
    return [t for t, _ in sorted(tags.items(), key=lambda kv: (-kv[1], kv[0]))]


def create_conversation(settings: dict[str, Any] | None = None, title: str = "New conversation", owner: str | None = None) -> dict[str, Any]:
    c = {"$axf": contract.CONVERSATION_CONTRACT, "id": new_id("c"), "title": title[:120], "createdAt": now_ms(), "updatedAt": now_ms(),
         "pinned": False, "archived": False, "tags": [], "settings": settings or {}, "messages": []}
    if owner:
        c["owner"] = owner  # a hub user's conversation (live-session / wall users); admins' have no owner
    save_conversation(c)
    return c


def get_conversation(cid: str) -> dict[str, Any]:
    c = _read(_cpath(cid), None)
    if not isinstance(c, dict):
        raise KeyError(cid)
    return c


def save_conversation(c: dict[str, Any]) -> None:
    with _lock:
        _write(_cpath(c["id"]), c)


def delete_conversation(cid: str) -> None:
    p = _cpath(cid)
    if not p.exists():
        raise KeyError(cid)
    p.unlink()
    _index.pop(p.name, None)
