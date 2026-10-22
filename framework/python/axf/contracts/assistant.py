"""assistant@1 — the pure rules of the framework's assistant contract, Python port.

Reference: framework/core/assistant.ts (web) = Kotlin ai.amberx.axf.kernel.assistant = this module (framework/python,
`axf.contracts.assistant`); it must give the same answers, checked by framework/python/axf/contracts/test.py against
framework/spec/fixtures/assistant.json. Everything here is pure (no I/O): secret redaction, the history window sent to
a model, the profile fallback chain, what a non-admin may set and how their params are clamped, permission wildcards,
batch titles, tool-argument summaries, SSE framing, owner-kind renaming, and the chat-context rule (`ChatContext.extra`).

Hosts (the console's ai-assistant plugin, Build Pilot's server, …) import it; the reusable host runtime (providers,
live-session hosts, safety helpers) is the sibling package `axf.assistant_host`.
"""
from __future__ import annotations

import json
import re
from typing import Any, Iterable

CONTRACT = "assistant@1"
CONVERSATION_CONTRACT = "ai-conversation@1"
LLM_CAPABILITY = "axf.llm"

SECRET = re.compile(r"\b(sk-(?:ant-|proj-)?[A-Za-z0-9_\-]{20,}|xai-[A-Za-z0-9]{20,}|gh[pousr]_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_\-]{30,}|fc-[a-f0-9]{24,})\b")
REDACTED = "[redacted secret]"
SETTING_KEYS = ["profileId", "model", "temperature", "max_tokens", "top_p", "systemPrompt", "agentId", "tools", "thinking"]
TURN_EVENT_KINDS = ["start", "text", "thinking", "status", "tool", "error", "batch", "done"]
USER_MAX_TOKENS = 4096
USER_MAX_TOKENS_WITH_MODELS = 16384
RECONNECT_ATTEMPTS = 8

# ---------------------------------------------------------------- chat context (ChatContext + the open `extra` bag)

#: Well-known `extra` keys (spec/ASSISTANT.md); hosts may add their own, unknown keys pass through.
CHAT_CONTEXT_KEYS = {"projectId": "projectId", "appId": "appId", "path": "path", "route": "route"}
CHAT_CONTEXT_LIMITS = {"view": 200, "title": 300, "selection": 4000, "note": 2000,
                       "extraKeys": 32, "extraKey": 64, "extraString": 2000, "extraJson": 16_000, "extraDepth": 4}
_EXTRA_KEY = re.compile(r"^[A-Za-z0-9_.-]{1,64}$")
_MISSING = object()


def _bounded(v: Any, depth: int) -> Any:
    if v is None or isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return v if v == v and v not in (float("inf"), float("-inf")) else _MISSING
    if isinstance(v, str):
        return v[: CHAT_CONTEXT_LIMITS["extraString"]]
    if depth >= CHAT_CONTEXT_LIMITS["extraDepth"]:
        return _MISSING
    if isinstance(v, list):
        out = []
        for x in v[: CHAT_CONTEXT_LIMITS["extraKeys"]]:
            b = _bounded(x, depth + 1)
            if b is not _MISSING:
                out.append(b)
        return out
    if isinstance(v, dict):
        o: dict[str, Any] = {}
        for k, x in v.items():
            if not isinstance(k, str) or not _EXTRA_KEY.match(k):
                continue
            b = _bounded(x, depth + 1)
            if b is _MISSING:
                continue
            o[k] = b
            if len(o) >= CHAT_CONTEXT_LIMITS["extraKeys"]:
                break
        return o
    return _MISSING


def normalize_chat_context(raw: Any) -> dict[str, Any] | None:
    """The context a host stores and uses (= normalizeChatContext in the reference): known fields cut to their
    limits; `extra` kept as an open bag — every key it came with, in order — but bounded (key pattern, ≤ 32 keys,
    strings ≤ 2000, depth ≤ 4, ≤ 16 000 JSON characters in all; an oversized `extra` is dropped whole). None when
    nothing is left or the input isn't an object."""
    if not isinstance(raw, dict):
        return None
    out: dict[str, Any] = {}
    for k in ("view", "title", "selection", "note"):
        v = raw.get(k)
        if isinstance(v, str) and v:
            out[k] = v[: CHAT_CONTEXT_LIMITS[k]]
    extra = raw.get("extra")
    if isinstance(extra, dict):
        b = _bounded(extra, 0)
        if b and len(json.dumps(b, separators=(",", ":"), ensure_ascii=False)) <= CHAT_CONTEXT_LIMITS["extraJson"]:
            out["extra"] = b
    return out or None


def context_extra(ctx: dict[str, Any] | None, key: str) -> str:
    """A well-known `extra` value as a string (empty when absent or not a string); how a host reads `projectId`."""
    v = ((ctx or {}).get("extra") or {}).get(key) if isinstance((ctx or {}).get("extra"), dict) else None
    return v if isinstance(v, str) else ""


def redact_secrets(text: str, on: bool = True) -> str:
    return SECRET.sub(REDACTED, text) if on and text else text


def wire_history(msgs: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    """Last `limit` user turns plus the assistant steps and tool results between them, in the canonical wire shape;
    never starts on an orphaned tool result; a final reply after tool results carries only its last round."""
    keep: list[dict[str, Any]] = []
    turns = 0
    for m in reversed(msgs):
        if m.get("role") == "user":
            turns += 1
        keep.append(m)
        if turns >= limit:
            break
    keep.reverse()
    while keep and keep[0].get("role") == "tool":
        keep.pop(0)
    out = []
    for i, m in enumerate(keep):
        content = m.get("content", "") or ""
        prev = keep[i - 1] if i else None
        if m.get("role") == "assistant" and not (m.get("meta") or {}).get("step") and prev and prev.get("role") == "tool":
            content = (m.get("meta") or {}).get("lastRound", content)
            if content is None:
                content = m.get("content", "") or ""
        w: dict[str, Any] = {"role": m["role"], "content": content}
        if m.get("images"):
            w["images"] = m["images"]
        if m.get("toolCalls"):
            w["tool_calls"] = m["toolCalls"]
        if m.get("thinkingBlocks"):
            w["thinking_blocks"] = m["thinkingBlocks"]
        if m.get("role") == "tool":
            w["tool_call_id"] = m.get("toolCallId", "") or ""
            w["is_error"] = bool(m.get("isError"))
        out.append(w)
    return out


def profile_chain(settings_profile: str | None, agent_profile: str | None, default_profile: str, fallback: Iterable[str]) -> list[str]:
    first = settings_profile or agent_profile or default_profile or ""
    chain = [p for p in [first, *fallback] if p]
    return list(dict.fromkeys(chain)) or [""]


def permission_allows(perms: Iterable[str], perm: str, admin: bool = False) -> bool:
    if admin:
        return True
    s = set(perms)
    if "*" in s or perm in s:
        return True
    parts = perm.split(".")
    return any(".".join(parts[:i]) + ".*" in s for i in range(1, len(parts)))


def settings_allowed_for(admin: bool, can) -> list[str]:
    if admin:
        return list(SETTING_KEYS)
    keys = ["temperature", "top_p", "systemPrompt", "tools"]
    if can("assistant.agents"):
        keys.append("agentId")
    if can("assistant.models"):
        keys += ["profileId", "model", "max_tokens", "thinking"]
    return keys


def clamp_user_params(params: dict[str, Any], admin: bool, can_models: bool) -> dict[str, Any]:
    if admin:
        return dict(params)
    out = dict(params)
    try:
        raw = float(out.get("max_tokens", USER_MAX_TOKENS))
        n = int(raw) if raw > 0 and raw == raw and raw != float("inf") else USER_MAX_TOKENS
    except (TypeError, ValueError):
        n = USER_MAX_TOKENS
    out["max_tokens"] = max(256, min(n, USER_MAX_TOKENS_WITH_MODELS if can_models else USER_MAX_TOKENS))
    if not can_models:
        out["thinking"] = False
    return out


def batch_title(user_text: str, n: int) -> str:
    t = re.sub(r"\s+", " ", user_text or "").strip()
    count = f"{n} change{'s' if n != 1 else ''}"
    return f"{count}: {t[:80]}{'…' if len(t) > 80 else ''}" if t else count


_SUMMARY_KEYS = ("path", "command", "pattern", "url", "query", "expression", "dir", "name", "id", "container")


def summarize_args(args: dict[str, Any]) -> str:
    for k in _SUMMARY_KEYS:
        v = args.get(k)
        if isinstance(v, str) and v:
            return v[:160]
    s = json.dumps(args, separators=(",", ":"), ensure_ascii=False)[:160]
    return "" if s == "{}" else s


def title_from_text(text: str, max_len: int = 60) -> str:
    return re.sub(r"\s+", " ", text or "").strip()[:max_len]


def owner_kind(kind: str, reserved: Iterable[str]) -> str:
    return f"owner.{kind}" if kind in set(reserved) else kind


def reconnect_delay_ms(attempt: int, cap_ms: int = 30_000) -> int:
    return min(cap_ms, 500 * 2 ** max(1, int(attempt)))


# ---------------------------------------------------------------- SSE

def sse_line(event: str, data: Any, seq: int | None = None) -> str:
    return f"{f'id: {seq}' + chr(10) if seq else ''}event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def parse_sse_block(block: str) -> dict[str, Any] | None:
    event, data, seq = "message", [], None
    for line in block.split("\n"):
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:][1:] if line[5:].startswith(" ") else line[5:])
        elif line.startswith("id:"):
            try:
                n = int(line[3:].strip())
                if n > 0:
                    seq = n
            except ValueError:
                pass
    if not data:
        return None
    out: dict[str, Any] = {"event": event, "data": "\n".join(data)}
    if seq is not None:
        out["id"] = seq
    return out


def parse_sse_text(text: str) -> tuple[list[dict[str, Any]], str]:
    frames = []
    buf = text.replace("\r\n", "\n")
    while True:
        i = buf.find("\n\n")
        if i < 0:
            break
        f = parse_sse_block(buf[:i])
        buf = buf[i + 2:]
        if f:
            frames.append(f)
    return frames, buf


def frame_to_event(f: dict[str, Any]) -> dict[str, Any]:
    try:
        data = json.loads(f["data"])
    except ValueError:
        data = f["data"]
    out = {"event": f["event"], "data": data}
    if "id" in f:
        out["seq"] = f["id"]
    return out


# ---------------------------------------------------------------- conformance

def check_fixture(fixture: dict[str, Any]) -> list[str]:
    """Replays spec/fixtures/assistant.json; returns the mismatches (empty = this port matches the reference)."""
    bad: list[str] = []
    for x in fixture["redact"]:
        if redact_secrets(x["text"], True) != x["on"] or redact_secrets(x["text"], False) != x["off"]:
            bad.append(f"redact {x['text'][:40]!r}")
    msgs = fixture["history"]["messages"]
    for w in fixture["history"]["windows"]:
        if wire_history(msgs, w["limit"]) != w["wire"]:
            bad.append(f"history limit={w['limit']}")
    if wire_history(msgs[4:], 5) != fixture["history"]["orphanStart"]:
        bad.append("history orphanStart")
    for x in fixture["chains"]:
        if profile_chain(x["settings"].get("profileId"), x.get("agent"), x["def"], x["fallback"]) != x["chain"]:
            bad.append(f"chain {x}")
    for x in fixture["permissions"]:
        if permission_allows(x["perms"], x["perm"], x.get("admin", False)) != x["allowed"]:
            bad.append(f"permission {x}")
    for x in fixture["settingsAllowed"]:
        if settings_allowed_for(x["admin"], lambda p, px=x["perms"]: permission_allows(px, p)) != x["keys"]:
            bad.append(f"settingsAllowed {x}")
    for x in fixture["clampParams"]:
        if clamp_user_params(x["params"], x["admin"], x["canModels"]) != x["out"]:
            bad.append(f"clamp {x}")
    for x in fixture["titles"]:
        if batch_title(x["text"], x["n"]) != x["title"] or title_from_text(x["text"]) != x["convTitle"]:
            bad.append(f"title {x['text'][:20]!r}")
    for x in fixture["summaries"]:
        if summarize_args(x["args"]) != x["summary"]:
            bad.append(f"summary {x['args']}")
    reserved = fixture.get("ownerKindsReserved") or ["session.open", "session.close", "turn.start", "turn.end", "wait", "resume", "interrupted"]
    for x in fixture["ownerKinds"]:
        if owner_kind(x["kind"], reserved) != x["owner"]:
            bad.append(f"ownerKind {x['kind']}")
    frames, rest = parse_sse_text(fixture["sse"]["text"])
    if frames != fixture["sse"]["frames"] or rest != fixture["sse"]["rest"] or [frame_to_event(f) for f in frames] != fixture["sse"]["events"]:
        bad.append("sse framing")
    for x in fixture["reconnect"]:
        if reconnect_delay_ms(x["attempt"]) != x["delayMs"]:
            bad.append(f"reconnect {x['attempt']}")
    for x in fixture.get("chatContext") or []:
        got = normalize_chat_context(x["raw"])
        if json.loads(json.dumps(got)) != x["context"]:
            bad.append(f"chatContext {x['case']}: {json.dumps(got)[:200]} != {json.dumps(x['context'])[:200]}")
        if "projectId" in x and context_extra(got, "projectId") != x["projectId"]:
            bad.append(f"chatContext {x['case']} projectId")
    return bad
