"""assistant@1 — the pure rules of the framework's assistant contract, Python port.

Reference: framework/core/assistant.ts (web) = Kotlin ai.amberx.axf.kernel.assistant; this module must give the same
answers, checked by test.py against framework/spec/fixtures/assistant.json. Everything here is pure (no I/O): secret
redaction, the history window sent to a model, the profile fallback chain, what a non-admin may set and how their
params are clamped, permission wildcards, batch titles, tool-argument summaries, SSE framing, owner-kind renaming.
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
