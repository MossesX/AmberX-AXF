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

# hidden-assets@1: list reads; hide / unhide / unhide all write and are not destructive (nothing is deleted). Every
# call goes to the hidden-assets runner as {op, app?, kind?, id?, by: api:mcp}; a refusal is a ToolError with its words.
hsent: list[dict] = []


def _hidden_stub(req: dict) -> dict:
    hsent.append(req)
    if req.get("kind") == "context-menu":
        return {"ok": False, "error": "kind must be one of tab-group, toolbar, banner, nav-menu, app-menu, widget"}
    return {"ok": True, "app": req.get("app") or "axf-console", "count": 1, "hidden": [{"kind": "toolbar", "id": "app", "by": req["by"]}]}


hserver = mcp_server.build_server(lambda op, **a: {}, hidden_assets=_hidden_stub)
htools = {t.name: t for t in asyncio.run(hserver.list_tools())}
ok(mcp_server.HIDDEN_ASSETS_TOOLS == ("hidden_assets_list", "hidden_assets_hide", "hidden_assets_unhide", "hidden_assets_unhide_all"), "the four hidden-assets tools are pinned")
for name in mcp_server.HIDDEN_ASSETS_TOOLS:
    ok(name in tools and name in htools, f"{name} exists (with or without a console)")
ok(tools["hidden_assets_list"].annotations.read_only_hint is True, "hidden_assets_list reads")
ok(all(tools[n].annotations.read_only_hint is not True and tools[n].annotations.destructive_hint is not True for n in mcp_server.HIDDEN_ASSETS_TOOLS[1:]), "hide / unhide / unhide all write, not destructive")
ok(all("kind" in htools[n].input_schema["required"] and "id" in htools[n].input_schema["required"] for n in ("hidden_assets_hide", "hidden_assets_unhide")), "hide and unhide need a kind and an id")


def _hidden_call(name: str, args: dict) -> dict:
    out = asyncio.run(hserver.call_tool(name, args))
    res = out[1] if isinstance(out, tuple) else out
    if isinstance(res, dict):
        return res
    if getattr(res, "isError", False) or getattr(res, "is_error", False):
        raise RuntimeError(" ".join(getattr(c, "text", "") for c in res.content))
    sc = getattr(res, "structured_content", None) or getattr(res, "structuredContent", None)
    return sc if isinstance(sc, dict) else json.loads(res.content[0].text)


r = _hidden_call("hidden_assets_list", {})
ok(hsent[-1] == {"op": "list", "by": "api:mcp"} and r["count"] == 1 and "ok" not in r, "list → {op: list}; the answer is the list, without ok")
_hidden_call("hidden_assets_hide", {"kind": "toolbar", "id": "app", "app": "axhub"})
ok(hsent[-1] == {"op": "hide", "app": "axhub", "kind": "toolbar", "id": "app", "by": "api:mcp"}, "hide → {op: hide, app, kind, id, by: api:mcp}")
_hidden_call("hidden_assets_unhide", {"kind": "widget", "id": "clock:main"})
ok(hsent[-1] == {"op": "unhide", "kind": "widget", "id": "clock:main", "by": "api:mcp"}, "unhide keeps a widget's <type>:<id> whole")
_hidden_call("hidden_assets_unhide_all", {"app": "console"})
ok(hsent[-1] == {"op": "unhide-all", "app": "console", "by": "api:mcp"}, "unhide all → {op: unhide-all, app}")
try:
    _hidden_call("hidden_assets_hide", {"kind": "context-menu", "id": "app"})
    refused = ""
except Exception as e:  # noqa: BLE001
    refused = str(e)
ok("kind must be one of" in refused, "a kind that can't be hidden is refused with the engine's words")

# the default runner: hidden_assets.py's functions in the console process (app, kind, id positional; `by` as default_by)
import types  # noqa: E402

hcalls: list[tuple] = []
_fake = types.ModuleType("hidden_assets")
_fake.list_hidden = lambda app=None: hcalls.append(("list", app)) or {"ok": True, "count": 0, "hidden": []}
_fake.hide = lambda app, kind, id_, by=None, default_by="api:rest": hcalls.append(("hide", app, kind, id_, by, default_by)) or {"ok": True, "changed": True}
_fake.unhide = lambda app, kind, id_, by=None, default_by="api:rest": (_ for _ in ()).throw(ValueError("id must be a piece id"))
_fake.unhide_all = lambda app=None, by=None, default_by="api:rest": hcalls.append(("unhide-all", app, by, default_by)) or {"ok": True, "shown": 2}
_had = sys.modules.get("hidden_assets")
sys.modules["hidden_assets"] = _fake
try:
    hrun = mcp_server.hidden_assets_runner()
    ok(hrun({"op": "list", "by": "api:mcp"})["count"] == 0 and hcalls[-1] == ("list", None), "runner: list → list_hidden(app)")
    ok(hrun({"op": "hide", "kind": "banner", "id": "app", "by": "api:mcp"})["changed"] is True and hcalls[-1] == ("hide", None, "banner", "app", None, "api:mcp"), "runner: hide → hide(app, kind, id, default_by=api:mcp)")
    ok(hrun({"op": "unhide-all", "app": "axhub", "by": "api:mcp"})["shown"] == 2 and hcalls[-1] == ("unhide-all", "axhub", None, "api:mcp"), "runner: unhide-all → unhide_all(app, default_by=api:mcp)")
    ok(hrun({"op": "unhide", "kind": "toolbar", "id": "Bad Id", "by": "api:mcp"}) == {"ok": False, "error": "id must be a piece id"}, "runner: a ValueError is a refusal, not a crash")
    ok(hrun({"op": "hide", "kind": "toolbar"})["ok"] is False and hrun({"op": "nope"})["ok"] is False, "runner: a missing id or an unknown op is refused before any call")
finally:
    if _had is None:
        del sys.modules["hidden_assets"]
    else:
        sys.modules["hidden_assets"] = _had

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
ok(tools["claude_policy_get"].annotations.read_only_hint is True and tools["claude_policy_plan_get"].annotations.read_only_hint is True, "the policy tools only read")
ok("claude_policy_set" not in tools, "no MCP tool writes axHub policy")
ok(tools["claude_view_set"].annotations.read_only_hint is not True, "claude_view_set writes")
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
for name in ("console_open", "console_dialog", "console_settings", "console_back", "console_where", "console_list", "console_clients", "console_show", "console_follow", "console_screenshot"):
    a = ctools[name].annotations
    ok(a.read_only_hint is True and a.destructive_hint is not True, f"{name} only navigates or reads: read-only, so it never waits on a veto")
ok(ctools["console_action"].annotations.read_only_hint is not True, "console_action can change data: it stays a write")
# console_screenshot (Nov 19 2026): the image comes back as MCP image content, the screen state as JSON beside it
import base64 as _b64  # noqa: E402
png = _b64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()
shot_server = mcp_server.build_server(lambda op, **a: {}, console=lambda c: csent.append(c) or {"ok": True, "status": "delivered", "sent": {"id": "cc-1"},
    "images": [{"client": "cc-abcdef", "mime": "image/png", "data": png, "bytes": 12, "width": 800, "height": 600}], "state": {"screen": "settings", "screenLabel": "Settings", "dialog": "asset-json"}})
res = asyncio.run(shot_server.call_tool("console_screenshot", {"address": "view:settings", "to": "all"}))
blocks = res.content if hasattr(res, "content") else res[0] if isinstance(res, tuple) else res
ok(csent[-1] == {"op": "act", "target": "console.nav", "path": "here", "action": "screenshot", "input": {"address": "view:settings", "to": "all"}, "by": "mcp"}, "console_screenshot → console.nav act screenshot with address and to")
ok(blocks[0].type == "image" and blocks[0].data == png and blocks[0].mime_type == "image/png", "the screenshot is the first content block, as an MCP image")
meta = json.loads(blocks[-1].text)
ok(meta["state"]["screen"] == "settings" and meta["state"]["dialog"] == "asset-json" and meta["status"] == "delivered", "the screen state and status come with it")
ok("data" not in meta["images"][0] and meta["images"][0]["width"] == 800 and "sent" not in meta, "the JSON beside the image carries no image data")
pend = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True, "queued": True, "status": "pending", "message": "queued"})
pres = asyncio.run(pend.call_tool("console_screenshot", {}))
pblocks = pres.content if hasattr(pres, "content") else pres
ok(len(pblocks) == 1 and json.loads(pblocks[0].text)["status"] == "pending", "no console answered yet: pending, no image block")
calls: list[tuple[str, dict]] = []
real_follow = mcp_server.follow_call
mcp_server.follow_call = lambda op, args: calls.append((op, args)) or ({"ok": True, "on": True, "by": "Brett", "at": "", "clients": 1} if op == "state" else {"ok": True, "shown": True, "message": "opened Plan Studio"})
r = asyncio.run(cserver.call_tool("console_show", {"target": "plan studio", "highlight": "h1", "say": "here's the plan"}))
ok(calls[-1] == ("show", {"target": "plan studio", "highlight": "h1", "say": "here's the plan", "focus": "", "to": "recent"}), "console_show → follow-amber show with target, highlight, say")
asyncio.run(cserver.call_tool("console_show", {"target": "build-orchestrator", "focus": "pending"}))
ok(calls[-1][1]["focus"] == "pending", "console_show passes focus (a tab or a build on the screen)")
asyncio.run(cserver.call_tool("console_open", {"screen": "build:console-commands-reliable"}))
ok(csent[-1]["path"] == "build:console-commands-reliable" and csent[-1]["target"] == "console.screens", "console_open takes build:<id> (Console commands opens the orchestrator on it)")
asyncio.run(cserver.call_tool("console_open", {"screen": "build-orchestrator", "focus": "pending"}))
ok(csent[-1]["input"] == {"focus": "pending"}, "console_open passes focus")
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
