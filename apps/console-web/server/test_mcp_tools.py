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

# sessions nav (terminal-sessions-nav): console_session_note posts into the caller's mirror feed; every call is recorded
notes: list[dict] = []
calls: list[tuple] = []
s2 = mcp_server.build_server(lambda op, **a: {}, notes=lambda line: notes.append(line) or {"ok": True, "feed": "chat:x"},
                             on_call=lambda *a: calls.append(a))
t2 = {t.name: t for t in asyncio.run(s2.list_tools())}
ok("console_session_note" in t2 and "console_session_note" not in tools, "console_session_note only when the server gets a notes runner")
ok(t2["console_session_note"].annotations.read_only_hint is False and t2["console_session_note"].annotations.destructive_hint is False, "console_session_note is a plain write (allow)")
tok = mcp_server.CALLER.set("Amber - chat")
asyncio.run(s2.call_tool("console_session_note", {"text": "looking at builds", "session": "Amber - chat", "url": "https://claude.ai/chat/1"}))
mcp_server.CALLER.reset(tok)
ok(notes[-1] == {"text": "looking at builds", "session": "Amber - chat", "source": "claude-ai-text", "url": "https://claude.ai/chat/1"}, "the note reaches the feed with its session and link")
ok(calls[-1][0] == "Amber - chat" and calls[-1][1] == "console_session_note" and calls[-1][3] is True, "each tool call is told to on_call with its caller")
try:
    asyncio.run(s2.call_tool("plan_feature", {"id": "nope"}))
except Exception:  # noqa: BLE001
    pass
ok(calls[-1][1] == "plan_feature" and calls[-1][3] is False and calls[-1][4], "a failing call is recorded as failed, with the error")
s3 = mcp_server.build_server(lambda op, **a: {}, on_call=lambda *a: (_ for _ in ()).throw(RuntimeError("listener broke")))
ok(asyncio.run(s3.call_tool("app_validate", {"dir": "x"})) is not None, "a broken listener never fails the call")

# Follow Amber (Nov 3 2026): opening and moving only navigate, so they are read-only (axHub runs them at once, no
# veto); console_action can change data and stays a write; console_show / console_follow call follow-amber@1.
csent: list[dict] = []
cserver = mcp_server.build_server(lambda op, **a: {}, console=lambda c: csent.append(c) or {"ok": True})
ctools = {t.name: t for t in asyncio.run(cserver.list_tools())}
for name in (*mcp_server.CONSOLE_TOOLS, *mcp_server.FOLLOW_TOOLS):
    ok(name in ctools, f"{name} exists")
for name in ("console_open", "console_dialog", "console_settings", "console_back", "console_where", "console_list", "console_clients", "console_show", "console_follow"):
    a = ctools[name].annotations
    ok(a.read_only_hint is True and a.destructive_hint is not True, f"{name} only navigates or reads: read-only, so it never waits on a veto")
ok(ctools["console_action"].annotations.read_only_hint is not True, "console_action can change data: it stays a write")
calls: list[tuple[str, dict]] = []
real_follow = mcp_server.follow_call
mcp_server.follow_call = lambda op, args: calls.append((op, args)) or ({"ok": True, "on": True, "by": "Brett", "at": "", "clients": 1} if op == "state" else {"ok": True, "shown": True, "message": "opened Plan Studio"})
r = asyncio.run(cserver.call_tool("console_show", {"target": "plan studio", "highlight": "h1", "say": "here's the plan"}))
ok(calls[-1] == ("show", {"target": "plan studio", "highlight": "h1", "say": "here's the plan", "to": "recent"}), "console_show → follow-amber show with target, highlight, say")
asyncio.run(cserver.call_tool("console_follow", {}))
ok(calls[-1][0] == "state", "console_follow → follow-amber state")
mcp_server.follow_call = lambda op, args: {"ok": False, "code": "not_implemented", "message": "off"}
try:
    asyncio.run(cserver.call_tool("console_show", {"target": "x"}))
    ok(False, "a failed show raises")
except Exception as e:  # noqa: BLE001
    ok("not_implemented" in str(e), "a failed show raises with its wire code")
mcp_server.follow_call = real_follow
ok("console_show" in mcp_server.INSTRUCTIONS and "console_follow" in mcp_server.INSTRUCTIONS, "the server instructions tell Amber to call console_show")

print(f"✓ console MCP tools — {checks} checks, {len(tools)} tools, {len(READ_TOOLS)} read-only")
