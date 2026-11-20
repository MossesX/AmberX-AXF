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
ok(csent[-1] == {"op": "act", "target": "console.nav", "path": "here", "action": "screenshot", "input": {"address": "view:settings", "describe": True, "to": "all"}, "by": "mcp"}, "console_screenshot → console.nav act screenshot with address and to, described by default")
asyncio.run(shot_server.call_tool("console_screenshot", {"describe": False, "question": "which build failed?"}))
ok(csent[-1]["input"] == {"question": "which build failed?"}, "describe=false asks for no description")
ok(blocks[0].type == "image" and blocks[0].data == png and blocks[0].mime_type == "image/png", "without a description or a map the screenshot is the first content block, as an MCP image")
meta = json.loads(blocks[-1].text)
ok(meta["state"]["screen"] == "settings" and meta["state"]["dialog"] == "asset-json" and meta["status"] == "delivered", "the screen state and status come with it")
ok("data" not in meta["images"][0] and meta["images"][0]["width"] == 800 and "sent" not in meta, "the JSON beside the image carries no image data")
pend = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True, "queued": True, "status": "pending", "message": "queued"})
pres = asyncio.run(pend.call_tool("console_screenshot", {}))
pblocks = pres.content if hasattr(pres, "content") else pres
ok(len(pblocks) == 1 and json.loads(pblocks[0].text)["status"] == "pending", "no console answered yet: pending, no image block")

# Voice (build voice-console-control, Nov 20 2026): the image never reaches a voice session, so a screenshot answer leads
# with the description, then the numbered element map; the screen tools act on words / numbers and answer with the new screen.
fx = json.loads((Path(__file__).resolve().parents[3] / "framework" / "spec" / "fixtures" / "console-screen.json").read_text())
ok(mcp_server.map_text(fx["map"]) == fx["text"], "the element map reads the same as the reference engine's text (fixture)")
ok(mcp_server.map_text([]) == "No interactive element is on the screen." and mcp_server.map_text(fx["map"], 5).endswith("… and 12 more"), "an empty map and a capped one say so")
SHOT = {"ok": True, "status": "delivered", "sent": {"id": "cc-2"}, "images": [{"client": "cc-abcdef", "mime": "image/png", "data": png, "bytes": 12, "width": 800, "height": 600}],
        "state": {"screen": "build-orchestrator", "screenLabel": "Build orchestrator"}, "elements": fx["map"],
        "description": "The Build orchestrator screen. Two builds failed.", "describedBy": {"model": "claude-opus-5-5", "profile": "p", "usage": {"input": 2100, "output": 310}, "ms": 4200, "cached": False}}
vsent: list[dict] = []


def vconsole(c: dict) -> dict:
    vsent.append(c)
    if c["target"] == "console.nav":
        return dict(SHOT)
    if c["target"] == "console.screen":
        t = str(c["input"].get("target") or "")
        if t == "retry":
            return {"ok": False, "code": "ambiguous", "message": '"retry" matches 2 elements: say which by number', "candidates": [e for e in fx["map"] if e["label"] == "Retry"], "data": {"elements": fx["map"]}}
        if t == "stop all" and not c["input"].get("confirm"):
            return {"ok": False, "code": "confirmation_required", "message": '"Stop all" deletes, stops or merges something', "data": {"elements": fx["map"]}}
        if t == "approve":
            return {"ok": False, "code": "denied", "message": '"Approve" is a decision only Brett makes with his own tap', "data": {"personOnly": True}}
        return {"ok": True, "data": {"ok": True, "action": c["action"], "did": f'{c["action"]} "{t or c["input"].get("path") or c["input"].get("keys")}"', "elements": fx["map"], "state": {"screen": "build-orchestrator"}}}
    if c["target"] == "console.screens":
        return {"ok": True, "status": "delivered", "data": {"item": {"label": "Build orchestrator"}}, "delivered": [{"ok": True, "message": "opened Build orchestrator"}]} if "orchestrator" in c["path"] else {"ok": False, "code": "not_found", "message": "no screen"}
    return {"ok": False, "code": "not_found", "message": "no settings tab"}


vserver = mcp_server.build_server(lambda op, **a: {}, console=vconsole)
vtools = {t.name: t for t in asyncio.run(vserver.list_tools())}
res = asyncio.run(vserver.call_tool("console_screenshot", {}))
vb = res.content if hasattr(res, "content") else res
ok(vb[0].type == "text" and vb[0].text == SHOT["description"], "the description is the first content part (what a voice session hears)")
ok(vb[1].type == "text" and "1. [menu] File" in vb[1].text and "scroll to see" in vb[1].text, "then the numbered element map as text")
ok(vb[2].type == "image" and vb[2].data == png, "the image is kept")
vmeta = json.loads(vb[-1].text)
ok(vmeta["description"] == SHOT["description"] and vmeta["describedBy"]["model"] == "claude-opus-5-5" and "elements" not in vmeta, "the JSON carries the description field and who described it, not the map twice")
ok(len(res.structured_content["elements"]) == len(fx["map"]), "the structured answer carries the whole map")
SHOT_NOTE = {**SHOT, "description": "", "describeNote": "the description took longer than 30 s and was skipped"}
tserver = mcp_server.build_server(lambda op, **a: {}, console=lambda c: dict(SHOT_NOTE))
tb = asyncio.run(tserver.call_tool("console_screenshot", {})).content
ok("took longer than 30 s" in tb[0].text and tb[1].text.startswith("What can be pressed") and tb[2].type == "image", "a description that timed out: a note first, the map and the image still come")
for name in mcp_server.CONSOLE_TOOLS[10:]:
    ok("voice" in (vtools[name].description or "").lower(), f"{name} says it is for voice")
ok("voice" in vtools["console_screenshot"].description.lower(), "console_screenshot says it is for voice")
for name in ("console_right_click", "console_expand", "console_collapse", "console_scroll", "console_jump"):
    ok(vtools[name].annotations.read_only_hint is True, f"{name} only opens a menu, folds or moves: it never waits on a veto")
for name in ("console_click", "console_double_click", "console_context_menu", "console_menu", "console_type", "console_key"):
    a = vtools[name].annotations
    ok(a.read_only_hint is not True and a.destructive_hint is not True, f"{name} can change data: a write (veto), never an allow")
res = asyncio.run(vserver.call_tool("console_click", {"target": "Refresh"}))
ok(vsent[-2] == {"op": "act", "target": "console.screen", "action": "click", "input": {"target": "Refresh"}, "by": "mcp"}, "console_click → console.screen act click")
ok(vsent[-1]["target"] == "console.nav" and vsent[-1]["input"] == {"describe": True}, "then the new screen is captured and described")
ok(res.content[0].text.startswith('click "Refresh"') and SHOT["description"] in res.content[0].text and res.structured_content["did"] == 'click "Refresh"', "the answer leads with what happened, then the new screen")
res = asyncio.run(vserver.call_tool("console_click", {"target": "retry"}))
ok(res.is_error is not True and res.structured_content["code"] == "ambiguous" and len(res.structured_content["candidates"]) == 2 and "Which one?" in res.content[0].text and vsent[-1]["target"] == "console.screen",
   "several matches: the numbered choices come back, nothing is clicked, no screenshot is taken")
res = asyncio.run(vserver.call_tool("console_click", {"target": "stop all"}))
ok(res.structured_content["code"] == "confirmation_required" and res.is_error is not True, "a destructive control answers confirmation_required")
asyncio.run(vserver.call_tool("console_click", {"target": "stop all", "confirm": True}))
ok(vsent[-2]["input"] == {"target": "stop all", "confirm": True}, "confirm=true is passed on")
res = asyncio.run(vserver.call_tool("console_click", {"target": "approve"}))
ok(res.structured_content["code"] == "denied", "approve is never clicked by a command")
asyncio.run(vserver.call_tool("console_context_menu", {"target": "row 2", "item": "Retry build", "describe": False}))
ok(vsent[-2]["action"] == "context_menu" and vsent[-2]["input"] == {"target": "row 2", "item": "Retry build"} and vsent[-1]["input"] == {}, "console_context_menu right-clicks and picks; describe=false skips the description")
asyncio.run(vserver.call_tool("console_right_click", {"target": "640,300", "to": "cc-abcdef"}))
ok(vsent[-2]["input"] == {"target": "640,300", "client": "cc-abcdef"} and vsent[-1]["input"]["to"] == "cc-abcdef", "coordinates and one named console")
asyncio.run(vserver.call_tool("console_menu", {"path": "Settings > Plugins > Agent cap"}))
ok(vsent[-2]["action"] == "menu" and vsent[-2]["input"] == {"path": "Settings > Plugins > Agent cap"}, "console_menu sends the path")
asyncio.run(vserver.call_tool("console_expand", {"row": "row 3"}))
asyncio.run(vserver.call_tool("console_collapse", {"row": "9"}))
ok(vsent[-4]["action"] == "expand" and vsent[-4]["input"] == {"target": "row 3"} and vsent[-2]["action"] == "collapse" and vsent[-2]["input"] == {"target": "9"}, "expand / collapse take a row")
asyncio.run(vserver.call_tool("console_scroll", {"direction": "page-down"}))
ok(vsent[-2]["input"] == {"dir": "page-down"}, "console_scroll by direction")
asyncio.run(vserver.call_tool("console_scroll", {"to_target": "shipped features"}))
ok(vsent[-2]["input"] == {"to": "shipped features"}, "console_scroll to a target")
try:
    asyncio.run(vserver.call_tool("console_scroll", {}))
    ok(False, "a scroll with nothing raises")
except Exception as e:  # noqa: BLE001
    ok("invalid" in str(e), "console_scroll needs a direction or a target")
asyncio.run(vserver.call_tool("console_type", {"text": "", "target": "search builds", "submit": True}))
ok(vsent[-2]["input"] == {"text": "", "target": "search builds", "submit": True}, "console_type: empty text clears the field, submit presses Enter")
asyncio.run(vserver.call_tool("console_key", {"keys": "Escape"}))
ok(vsent[-2]["action"] == "key" and vsent[-2]["input"] == {"keys": "Escape"}, "console_key")
res = asyncio.run(vserver.call_tool("console_jump", {"to_name": "build orchestrator"}))
ok(vsent[-2] == {"op": "act", "target": "console.screens", "path": "build orchestrator", "action": "open", "by": "mcp", "input": {}} and res.structured_content["did"] == "jumped: opened Build orchestrator",
   "console_jump opens a screen by name, then shows it")
real_runner = mcp_server._control_run
jumps: list[dict] = []
mcp_server._control_run = lambda b: jumps.append(b) or ({"ok": True, "hits": [{"address": "grid:queue/row:b1", "label": "Build one"}, {"address": "view:gate", "label": "Gate"}]} if b["verb"] == "search" else {"ok": True, "focused": b["address"]})
res = asyncio.run(vserver.call_tool("console_jump", {"to_name": "view:gate"}))
ok(jumps[-1]["verb"] == "focus" and jumps[-1]["address"] == "view:gate" and "jumped to view:gate" in res.content[0].text, "console_jump takes a console-control address")
res = asyncio.run(vserver.call_tool("console_jump", {"to_name": "build one"}))
ok([j["verb"] for j in jumps[-2:]] == ["search", "focus"] and jumps[-1]["address"] == "grid:queue/row:b1" and res.structured_content["alsoFound"][0]["address"] == "view:gate",
   "words that are no screen or settings tab: the best search hit is focused, the others are named")
mcp_server._control_run = lambda b: {"ok": True, "hits": []}
res = asyncio.run(vserver.call_tool("console_jump", {"to_name": "nowhere at all"}))
ok(res.structured_content["code"] == "not_found", "nothing by that name: not_found, no screenshot")
mcp_server._control_run = real_runner
noshot = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True, "data": {"did": "clicked \"Queue\"", "elements": fx["map"][:3]}} if c["target"] == "console.screen" else {"ok": False, "code": "not_found", "message": "no console answered"})
res = asyncio.run(noshot.call_tool("console_click", {"target": "Queue"}))
ok(res.content[0].text.startswith('clicked "Queue"') and "no screenshot came back" in res.content[0].text and len(res.structured_content["elements"]) == 3, "the click ran but no picture came back: the console's own map still answers")

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
ok(all(t in mcp_server.INSTRUCTIONS for t in ("console_click", "console_right_click", "console_context_menu", "console_menu", "console_expand", "console_jump")) and "never guess" in mcp_server.INSTRUCTIONS,
   "the server instructions tell a voice session how to see and drive the console")

print(f"✓ console MCP tools — {checks} checks, {len(tools)} tools, {len(READ_TOOLS)} read-only")
