#!/usr/bin/env python3
"""Conformance of the Python contract ports (stdlib only):

    python3 framework/python/axf/contracts/test.py

Replays framework/spec/fixtures/assistant.json against axf.contracts.assistant and
framework/spec/fixtures/agents.json against axf.contracts.agents — the same files the TS references
(framework/core/assistant.ts, agents.ts) generate and the Kotlin kernel replays (AssistantConformanceTest,
AgentsConformanceTest). Hosts (console plugins, Build Pilot) don't need to replay them again.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PY = HERE.parents[1]
sys.path.insert(0, str(PY))
from axf.contracts import agents, assistant  # noqa: E402

FIX = PY.parent / "spec" / "fixtures"
n = 0


def check(cond: bool, what: str) -> None:
    global n
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    n += 1
    print(f"  ✓ {what}")


print("axf.contracts self-test")
afx = json.loads((FIX / "assistant.json").read_text())
check(afx["contract"] == assistant.CONTRACT, "assistant fixture is assistant@1")
bad = assistant.check_fixture(afx)
check(not bad, f"assistant@1: Python port replays spec/fixtures/assistant.json ({len(afx['redact'])} redactions, {len(afx['history']['windows'])} windows, "
               f"{len(afx['chatContext'])} chat contexts)" + (f" — {bad[:3]}" if bad else ""))
# the chat-context rule, spelled out (the fixture already pins these; this keeps the intent readable)
ctx = assistant.normalize_chat_context({"view": "designer", "extra": {"projectId": "apk-1", "custom": {"a": [1, 2]}}})
check(ctx == {"view": "designer", "extra": {"projectId": "apk-1", "custom": {"a": [1, 2]}}} and assistant.context_extra(ctx, "projectId") == "apk-1", "ChatContext.extra passes well-known and unknown keys through")
big = assistant.normalize_chat_context({"view": "v", "extra": {f"k{i}": "x" * 1500 for i in range(20)}})
check(big == {"view": "v"}, "an oversized extra is dropped whole (never a different meaning)")
check(assistant.normalize_chat_context({"extra": {"bad key": 1, "ok": 2}}) == {"extra": {"ok": 2}}, "extra keys follow the key pattern")
check(assistant.normalize_chat_context({"extra": {"nan": float("nan"), "inf": float("inf"), "n": 1}}) == {"extra": {"n": 1}}, "non-finite numbers never travel (JSON can't carry them; same rule in the reference)")
check(assistant.normalize_chat_context("x") is None and assistant.normalize_chat_context({"extra": "x"}) is None, "a context is an object or nothing")
check(all(k in assistant.CHAT_CONTEXT_KEYS for k in ("projectId", "appId", "path", "route")), "well-known extra keys are declared")

gfx = json.loads((FIX / "agents.json").read_text())
bad = agents.check_fixture(gfx)
check(not bad, f"agent-definition@1: Python port replays spec/fixtures/agents.json ({len(gfx['validation'])} validation cases, {len(gfx['compose'])} prompts, {len(gfx['addons'])} bundles)"
               + (f" — {bad[:3]}" if bad else ""))
print(f"all {n} checks passed")
