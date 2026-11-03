"""Console MCP tools: every read tool is annotated read-only (so axHub can run it without a veto), every delete is
destructive, and the veto pass tools are there (builds theme-veto-pass, pass-all; CONTROL.md → Veto passes → axHub policy).

    python apps/console-web/server/test_mcp_tools.py
"""
from __future__ import annotations

import asyncio
import json
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import mcp_server  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


sent: list[dict] = []
server = mcp_server.build_server(lambda op, **a: {}, terminal=lambda since: [], control=lambda c: sent.append(c) or {"ok": True, "text": "x"})
tools = {t.name: t for t in asyncio.run(server.list_tools())}

# Tools that only read: names that look up, list, show or check something. Each must say so (readOnlyHint), so the
# recommended axHub policy (reads run, writes veto, deletes confirm) can run them with no countdown.
READ_NAME = re.compile(r"(^|_)(list|get|status|find|search|overview|queue|next|summary|libraries|templates|validate|tail|feature|rules)$")
READ_TOOLS = {n for n in tools if READ_NAME.search(n) and "_set_" not in n} | {"build_options", "pending_steps"}
for name in sorted(READ_TOOLS):
    a = tools[name].annotations
    ok(a is not None and a.read_only_hint is True, f"{name} is annotated read-only")
    ok(a.destructive_hint is not True, f"{name} is not destructive")
for name, t in tools.items():
    a = t.annotations
    ok(a is not None, f"{name} has annotations")
    if name.endswith("_remove"):
        ok(a.destructive_hint is True and a.read_only_hint is not True, f"{name} is destructive")
    if a.read_only_hint:
        ok(name in READ_TOOLS, f"{name} is read-only, so its name says it reads (list/get/status/find/…)")

# veto pass tools (pass_* since build pass-all; token_pass_* are the same tools under the old names)
for name in ("pass_grant", "pass_status", "pass_revoke", "pass_undo", "token_pass_grant", "token_pass_status", "token_pass_revoke", "token_pass_undo"):
    ok(name in tools, f"{name} exists")
ok(tools["pass_status"].annotations.read_only_hint is True and tools["token_pass_status"].annotations.read_only_hint is True, "pass status reads")
ok(tools["pass_grant"].annotations.read_only_hint is not True, "pass grant writes")
asyncio.run(server.call_tool("pass_grant", {"minutes": 30}))
ok(sent[-1]["target"] == "pass.scopes" and sent[-1]["path"] == "all" and sent[-1]["action"] == "grant" and "include_irreversible" not in sent[-1]["input"], "no scope = everything; irreversible stays off")
ok("approver" not in sent[-1] and "proof" not in sent[-1], "an MCP grant never carries an approval")
asyncio.run(server.call_tool("pass_grant", {"include_irreversible": True}))
ok(sent[-1]["input"].get("include_irreversible") is True, "include_irreversible goes through when asked for")
asyncio.run(server.call_tool("token_pass_grant", {"scope": "tokens", "minutes": 45, "reason": "colours"}))
ok(sent[-1]["path"] == "tokens.*" and sent[-1]["input"]["minutes"] == 45, "old name, tokens scope → tokens.*")
asyncio.run(server.call_tool("pass_status", {}))
ok(sent[-1]["op"] == "list" and sent[-1]["target"] == "pass.scopes", "status → list pass.scopes")
asyncio.run(server.call_tool("pass_revoke", {"scope": "layout"}))
ok(sent[-1]["path"] == "tokens.layout" and sent[-1]["action"] == "revoke", "revoke → act revoke")
asyncio.run(server.call_tool("pass_undo", {}))
ok(sent[-1]["path"] == "all" and sent[-1]["action"] == "undo", "undo defaults to everything")
ok("pass.scopes" in mcp_server.CONTROL_TARGETS, "control_* tools take pass.scopes")

# Claude settings (build claude-settings): the read tool runs without a veto; the set tool never changes an owner-only setting
import os  # noqa: E402
import tempfile  # noqa: E402

ok(tools["claude_settings_get"].annotations.read_only_hint is True, "claude_settings_get reads")
ok(tools["claude_settings_set"].annotations.read_only_hint is not True, "claude_settings_set writes")
with tempfile.TemporaryDirectory() as tmp:
    os.environ["AXF_CLAUDE_SETTINGS_FILE"] = f"{tmp}/settings.json"
    os.environ["AXF_CLAUDE_SETTINGS_DATA"] = tmp
    got = asyncio.run(server.call_tool("claude_settings_get", {}))
    text = json.dumps(got, default=str)
    ok("noWait.enabled" in text and "talking.length" in text, "claude_settings_get answers every setting")
    asyncio.run(server.call_tool("claude_settings_set", {"values": {"talking.length": "detailed"}}))
    ok("detailed" in json.dumps(asyncio.run(server.call_tool("claude_settings_get", {"key": "talking.length"})), default=str), "a non-owner setting changes over MCP")
    try:
        asyncio.run(server.call_tool("claude_settings_set", {"values": {"noWait.enabled": True}}))
        refused = False
    except Exception as e:  # noqa: BLE001 — ToolError
        refused = "denied" in str(e)
    ok(refused, "No wait can't be switched on over MCP")
    ok("false" in json.dumps(asyncio.run(server.call_tool("claude_settings_get", {"key": "noWait.enabled"})), default=str).lower(), "No wait stays off")
    del os.environ["AXF_CLAUDE_SETTINGS_FILE"], os.environ["AXF_CLAUDE_SETTINGS_DATA"]

print(f"✓ console MCP tools — {checks} checks, {len(tools)} tools, {len(READ_TOOLS)} read-only")
