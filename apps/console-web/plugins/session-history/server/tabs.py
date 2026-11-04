"""The three event tabs of an expanded run, shaped from its numbered events (pure).

  context        one item per turn (= one model response): everything that flowed into its context since the turn
                 before (prompts, tool results, attachments / reminders) and what it said back (text, thinking, tool
                 calls), with the turn's tokens
  tools          every tool call with its input, a one-line summary and its result
  conversation   the prompts and the replies only (regular sessions)
"""
from __future__ import annotations

from typing import Any

TABS = ("context", "tools", "conversation")
RESULT_MAX = 6000


def tool_summary(name: str, i: Any) -> str:
    """What a call is about, in a few words (same idea as deploy/claude-stream.mjs)."""
    i = i if isinstance(i, dict) else {}
    for k in ("command", "file_path", "notebook_path", "path", "pattern", "url", "query", "description", "prompt", "skill"):
        v = i.get(k)
        if isinstance(v, str) and v.strip():
            t = " ".join(v.split())
            return t if len(t) <= 160 else f"{t[:159]}…"
    return ""


def _slim(e: dict[str, Any]) -> dict[str, Any]:
    keep = ("n", "at", "role", "kind", "label", "text", "tool", "toolId", "input", "isError", "sidechain", "subtype")
    return {k: e[k] for k in keep if e.get(k) not in (None, "", False)}


def context(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    turns: dict[int, dict[str, Any]] = {}
    order: list[int] = []
    for e in events:
        t = int(e.get("turn") or 0)
        if t not in turns:
            turns[t] = {"turn": t, "at": None, "model": None, "inputs": [], "outputs": [], "usage": None, "usd": None}
            order.append(t)
        slot = turns[t]
        if e.get("role") == "assistant":
            slot["outputs"].append(_slim(e))
            slot["at"] = slot["at"] or e.get("at")
            slot["model"] = slot["model"] or e.get("model")
            if e.get("usage"):
                slot["usage"], slot["usd"] = e["usage"], e.get("usd")
        else:
            slot["inputs"].append(_slim(e))
    return [turns[t] for t in order]


def tools(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Every tool call; ``usd`` = its even share of the turn that issued it (estimated)."""
    results = {e.get("toolId"): e for e in events if e.get("kind") == "tool_result" and e.get("toolId")}
    turn_usd: dict[int, float] = {}
    calls: dict[int, int] = {}
    for e in events:
        if e.get("role") == "assistant":
            t = int(e.get("turn") or 0)
            if isinstance(e.get("usd"), (int, float)):
                turn_usd[t] = turn_usd.get(t, 0.0) + float(e["usd"])
            if e.get("kind") == "tool_use":
                calls[t] = calls.get(t, 0) + 1
    out = []
    for e in events:
        if e.get("kind") != "tool_use":
            continue
        r = results.get(e.get("toolId")) or {}
        text = r.get("text") or ""
        out.append({
            "n": e["n"], "turn": e.get("turn"), "at": e.get("at"), "tool": e.get("tool"), "summary": tool_summary(e.get("tool") or "", e.get("input")),
            "input": e.get("input"), "result": text if len(text) <= RESULT_MAX else f"{text[:RESULT_MAX]}\n… [{len(text) - RESULT_MAX} more characters]",
            "isError": bool(r.get("isError")), "done": bool(r), "sidechain": bool(e.get("sidechain")),
            "usd": round(turn_usd[t] / calls[t], 6) if (t := int(e.get("turn") or 0)) in turn_usd and calls.get(t) else None,
        })
    return out


def conversation(events: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [{"n": e["n"], "at": e.get("at"), "who": "you" if e["role"] == "user" else "claude", "text": e.get("text") or "", "turn": e.get("turn")}
            for e in events if not e.get("sidechain") and ((e.get("kind") == "prompt") or (e.get("role") == "assistant" and e.get("kind") == "text" and (e.get("text") or "").strip()))]


def page(events: list[dict[str, Any]], tab: str, offset: int = 0, limit: int = 100) -> dict[str, Any]:
    items = {"context": context, "tools": tools, "conversation": conversation}[tab](events)
    offset = max(0, offset)
    limit = max(1, min(limit, 500))
    return {"tab": tab, "total": len(items), "offset": offset, "items": items[offset: offset + limit]}
