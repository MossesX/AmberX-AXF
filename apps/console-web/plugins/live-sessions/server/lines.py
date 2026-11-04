"""Claude Code transcript lines and `claude -p --output-format stream-json` lines → recording events (one converter for
both: an interactive session's transcript and a headless build's stream log have the same message shapes)."""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any, Iterable

try:
    from .sessions import to_ms
except ImportError:  # the self-test imports the modules flat
    from sessions import to_ms


def _text(content: Any) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(str(c.get("text") or "") for c in content if isinstance(c, dict) and c.get("type") == "text")
    return ""


def events_from_line(o: Any) -> list[dict[str, Any]]:
    """One JSON line → 0..n events {kind, role?, text?, tool?, args?, result?, tokens?, contextTokens?, atMs?, id?}."""
    if not isinstance(o, dict):
        return []
    at = to_ms(o.get("timestamp")) or None
    base = {"atMs": at} if at else {}
    t = o.get("type")
    msg = o.get("message") if isinstance(o.get("message"), dict) else {}
    out: list[dict[str, Any]] = []
    if t == "system":
        sub = o.get("subtype") or ""
        if sub == "init":
            out.append({**base, "kind": "context", "text": f"Session start: model {o.get('model', '?')}, {len(o.get('tools') or [])} tools, cwd {o.get('cwd', '')}", "model": o.get("model")})
        elif sub == "compact_boundary" or o.get("compactMetadata"):
            out.append({**base, "kind": "compact", "text": str(o.get("content") or "Context compacted"), "contextTokens": (o.get("compactMetadata") or {}).get("preTokens")})
        elif o.get("content"):
            out.append({**base, "kind": "note", "text": str(o.get("content"))})
        return out
    if t == "summary":
        return [{**base, "kind": "compact", "text": str(o.get("summary") or "")}]
    if o.get("isCompactSummary"):
        return [{**base, "kind": "compact", "text": _text(msg.get("content"))}]
    if t == "assistant":
        usage = msg.get("usage") or {}
        ctx = sum(int(usage.get(k) or 0) for k in ("input_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")) or None
        for c in msg.get("content") or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "text" and c.get("text"):
                out.append({**base, "kind": "assistant", "role": "assistant", "text": c["text"], "model": msg.get("model"), **({"contextTokens": ctx} if ctx else {})})
            elif c.get("type") == "tool_use":
                out.append({**base, "kind": "tool", "tool": c.get("name"), "args": c.get("input"), "id": c.get("id")})
        return out
    if t == "user":
        content = msg.get("content")
        if isinstance(content, str):
            return [{**base, "kind": "user", "role": "user", "text": content}] if content.strip() else []
        for c in content or []:
            if not isinstance(c, dict):
                continue
            if c.get("type") == "tool_result":
                r = c.get("content")
                out.append({**base, "kind": "result", "id": c.get("tool_use_id"), "result": _text(r) if isinstance(r, list) else str(r or ""), "error": c.get("is_error") is True})
            elif c.get("type") == "text" and c.get("text"):
                out.append({**base, "kind": "user", "role": "user", "text": c["text"]})
        return out
    if t == "result":
        return [{**base, "kind": "build" if not o.get("is_error") else "error", "text": f"Run finished: {o.get('subtype', '')}, ${float(o.get('total_cost_usd') or 0):.2f}",
                 "error": bool(o.get("is_error"))}]
    return []


def events_from_lines(lines: Iterable[Any]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for line in lines:
        o = line
        if isinstance(line, str):
            try:
                o = json.loads(line)
            except ValueError:
                continue
        out.extend(events_from_line(o))
    return out


def tail(path: Path, offset: int, limit: int = 512 * 1024) -> tuple[list[dict[str, Any]], int]:
    """New events in a growing JSONL file from a byte offset: (events, next offset). Only whole lines are read."""
    try:
        with open(path, "rb") as f:
            f.seek(offset)
            data = f.read(limit)
    except OSError:
        return [], offset
    cut = data.rfind(b"\n")
    if cut < 0:
        return [], offset
    chunk = data[: cut + 1]
    return events_from_lines(chunk.decode("utf-8", "replace").splitlines()), offset + len(chunk)


def stream_log(cwd: str, name: str) -> Path | None:
    """A headless run's stream log: <worktree>/<worktree name>.jsonl (deploy/claude-headless.sh writes it)."""
    if not cwd:
        return None
    d = Path(cwd)
    for f in (d / f"{d.name}.jsonl", d / f"{name.removeprefix('axf-')}.jsonl"):
        if f.exists():
            return f
    return None
