"""Screen descriptions and click-by-words (screen_describe.py + the console_screenshot / console_click_text MCP tools).

    python apps/console-web/server/tests/test_screen_describe.py

The model is a fake (no network, no key): the numbered clickable list, the description (prompt, provider pick, cost,
cache by image hash, the 30 s give-up, a model that fails), finding by words (exact, words in order, a transcription
slip, a number from the last list, several matches, none), the command a click becomes, and the two MCP tools against
a fake open console.
"""
from __future__ import annotations

import asyncio
import base64
import json
import os
import sys
import time
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
os.environ.pop("AXF_SCREEN_DESCRIBE_MODEL", None)
os.environ.pop("AXF_SCREEN_DESCRIBE_PROFILE", None)

import mcp_server  # noqa: E402
import screen_describe as sd  # noqa: E402

passed = 0


def ok(v: object, what: str) -> None:
    global passed
    assert v, what
    passed += 1


V = "view:build-orchestrator"
MAP = {"view": "build-orchestrator", "width": 1280, "height": 800, "items": [
    {"address": f"{V}/tab:bo.tabs=pending", "kind": "tab", "role": "tab", "text": "Pending 3", "label": "Pending", "x": 20, "y": 60, "w": 90, "h": 30, "on": "screen", "value": True},
    {"address": f"{V}/tab:bo.tabs=shipped", "kind": "tab", "role": "tab", "text": "Shipped", "x": 120, "y": 60, "w": 90, "h": 30, "on": "screen"},
    {"address": f"{V}/button:seen.new-build", "kind": "button", "role": "button", "text": "New build", "x": 1100, "y": 60, "w": 90, "h": 30, "on": "screen"},
    {"address": f"{V}/grid:queue/row:nightly", "kind": "row", "role": "row", "text": "nightly build Failed 2 of 9", "x": 20, "y": 120, "w": 1200, "h": 40, "on": "screen"},
    {"address": f"{V}/button:seen.retry", "kind": "button", "role": "button", "text": "Retry", "x": 1000, "y": 125, "w": 60, "h": 30, "on": "screen"},
    {"address": f"{V}/button:seen.retry.2", "kind": "button", "role": "button", "text": "Retry", "x": 1000, "y": 175, "w": 60, "h": 30, "on": "screen"},
    {"address": f"{V}/button:seen.open-report", "kind": "button", "role": "link", "text": "Open report", "x": 20, "y": 220, "w": 90, "h": 20, "on": "screen"},
    {"address": f"{V}/button:seen.delete-build", "kind": "button", "role": "button", "text": "Delete build", "x": 20, "y": 260, "w": 90, "h": 30, "on": "screen", "destructive": True},
    {"address": f"{V}/button:seen.paused", "kind": "button", "role": "switch", "text": "Paused", "x": 20, "y": 300, "w": 40, "h": 20, "on": "screen", "value": False, "disabled": True},
    {"address": f"{V}/button:seen.retry.3", "kind": "button", "role": "button", "text": "Retry", "x": 1000, "y": 1400, "w": 60, "h": 30, "on": "scroll"},
    {"address": f"{V}/button:seen.load-more", "kind": "button", "role": "button", "text": "Load more", "x": 20, "y": 1500, "w": 90, "h": 30, "on": "scroll"},
    {"address": "", "kind": "button", "text": "no address"}, {"address": f"{V}/button:x", "kind": "button", "text": "  "}, "junk",
]}

# ---- the numbered clickable list
cm = sd.clickables(MAP)
ok(cm["source"] == "screen" and [i["n"] for i in cm["items"]] == list(range(1, 12)), "items are numbered from 1 in the order the console sent (reading order); junk is dropped")
ok(len(cm["visible"]) == 9 and [i["text"] for i in cm["scroll"]] == ["Retry", "Load more"], "visible ones first, then the ones scrolled out of sight")
ok(cm["items"][0] == {"text": "Pending 3", "kind": "tab", "address": f"{V}/tab:bo.tabs=pending", "controlKind": "tab", "on": "screen", "label": "Pending", "value": True, "n": 1}, "an item: words, kind, address, label, value, number")
ok(cm["items"][6]["kind"] == "link" and cm["items"][6]["controlKind"] == "button", "a link is told as a link and clicked as a button")
text = sd.map_text(cm)
ok('1. "Pending 3" | tab (open) | view:build-orchestrator/tab:bo.tabs=pending' in text and '3. "New build" | button | ' in text, "each line: number, exact words, kind, address")
ok("Scroll to see" in text and text.index("Scroll to see") < text.index('11. "Load more"') and text.index('9. "Paused"') < text.index("Scroll to see"), "off-screen items are listed apart, after the visible ones")
ok('| switch (off, disabled) |' in text and "deletes or resets: needs confirm" in text, "a switch says on / off, a disabled or deleting control says so")
ok("console_click_text" in text, "the list says how to click")
ok(sd.map_text(sd.clickables(None)).startswith("Clickable: nothing"), "no map and no targets: said plainly")
long = sd.clickables({"items": [{"address": f"{V}/button:seen.b{i}", "kind": "button", "role": "button", "text": f"B {i}", "on": "screen"} for i in range(260)], "truncated": True})
ok(len(long["items"]) == 260 and long["truncated"] and f"(and {260 - sd.MAX_LISTED} more not listed)" in sd.map_text(long), "a very long list is cut in the text, whole in the data")
# an older console page (no map): the live control targets, unplaced
TARGETS = [{"address": V, "kind": "view", "label": "Build orchestrator"}, {"address": f"{V}/tab:bo.tabs", "kind": "tab", "label": "Tabs"},
           {"address": f"{V}/tab:bo.tabs=pending", "kind": "tab", "label": "Pending", "value": True}, {"address": f"{V}/button:run", "kind": "button", "label": "Run", "disabled": True},
           {"address": "view:settings/button:save", "kind": "button", "label": "Save"}, {"address": "setting:axf.x", "kind": "setting", "label": "X", "virtual": True},
           {"address": "button:global", "kind": "button", "label": "Global"}]
old = sd.clickables(None, TARGETS, view="build-orchestrator")
ok(old["source"] == "targets" and [i["text"] for i in old["items"]] == ["Pending", "Run", "Global"], "no map: this screen's clickable targets (no containers, no other screen, no unrendered ones)")
ok("older than the screen map" in sd.map_text(old), "and the text says the order is not reading order")

# ---- find by words
pick = lambda *a, **k: sd.find(cm, *a, **k)  # noqa: E731
ok(pick("shipped")["pick"]["n"] == 2 and pick("SHIPPED")["how"] == "exact", "exact words, any case")
ok(pick("pending")["pick"]["n"] == 1, "the registered label matches too (the tab shows a count beside it)")
ok(pick("new build")["pick"]["n"] == 3 and pick("New  Build!")["pick"]["n"] == 3, "punctuation and spacing do not matter")
ok(pick("nightly")["pick"]["kind"] == "row" and pick("nightly build")["how"] == "words in order", "some of the words, in order")
ok(pick("report open")["pick"]["n"] == 7 and pick("report open")["how"] == "every word", "every word, any order")
ok(pick("shiped")["pick"]["n"] == 2 and pick("pendding")["pick"]["n"] == 1 and pick("lode more")["pick"]["text"] == "Load more", "a small transcription slip still matches")
ok(pick("shiped")["how"] == "close spelling", "and says it was a close spelling")
near = sd.clickables({"items": [{"address": "view:x/button:seen.more", "kind": "button", "role": "button", "text": "More: new skill, tool, training", "on": "screen"},
                                {"address": "view:x/tab:t=skills", "kind": "tab", "role": "tab", "text": "Skills", "on": "screen", "value": True},
                                {"address": "view:x/button:banner.claude", "kind": "button", "role": "button", "text": "Claude", "on": "screen", "value": "Claude"}]})
ok(sd.find(near, "skillss")["pick"]["text"] == "Skills", "of two close spellings the much closer one is taken")
ok("value" not in near["items"][2] and near["items"][1]["value"] is True, "a value that only repeats the words is left out of the list")
many = pick("retry")
ok("pick" not in many and [i["n"] for i in many["matches"]] == [5, 6] and "say which" in many["message"], "several visible matches: the list, never a guess (the off-screen one is left out)")
ok(pick("retry", nth=2)["pick"]["n"] == 6 and "matches" in pick("retry", nth=5), "nth picks among them; out of range asks again")
ok(pick("retry", kind="row").get("none") and pick("nightly", kind="button").get("none"), "kind narrows the search")
ok(pick("paused", kind="toggle")["pick"]["n"] == 9 and pick("open report", kind="link")["pick"]["n"] == 7, "kind takes spoken words: toggle, link")
ok(pick("load more")["pick"]["on"] == "scroll", "something only off screen is still found")
none = pick("deploy to production")
ok(none.get("none") and "nothing on the screen says" in none["message"], "no match says so")
ok("New build" in [i["text"] for i in pick("new bild xyz")["nearest"]], "no match offers the nearest words on the screen")
ok(pick("the shipped tab")["pick"]["n"] == 2 and pick("click the new build button")["pick"]["n"] == 3 and pick("that open report link please")["pick"]["n"] == 7, "said as a sentence: filler and the kind it names are understood")
ok(pick("re try", nth=1)["pick"]["text"] == "Retry" and pick("ship")["pick"]["n"] == 2 and pick("load")["pick"]["text"] == "Load more", "split words and the start of a word still match")
for said, n in (("4", 4), ("click 4", 4), ("number 4", 4), ("#4", 4), ("item four", 4), ("four", 4), ("press 11", 11), ("4.", 4)):
    ok(pick(said)["pick"]["n"] == n and pick(said)["how"] == "number", f'"{said}" is number {n} of the list')
ok(pick("99").get("none") and "no number 99" in pick("99")["message"], "a number past the end of the list says so")
ok(sd.number_of("retry") is None and sd.number_of("click the 4 things") is None and sd.number_of("") is None, "words are not a number")
earlier = sd.clickables({"items": [{"address": "view:x/button:seen.old", "kind": "button", "role": "button", "text": "Old", "on": "screen"}]})
ok(sd.find(cm, "1", by_number=earlier)["pick"]["text"] == "Old", "a number refers to the last list that was read out")
numbered = sd.clickables({"items": [{"address": "view:x/button:seen.2", "kind": "button", "role": "button", "text": "2", "on": "screen"}, {"address": "view:x/button:seen.next", "kind": "button", "role": "button", "text": "Next", "on": "screen"}]})
ok(sd.find(numbered, "2")["pick"]["text"] == "2", "a control whose words are that number wins over the list number")

# ---- the command a click becomes
ok(sd.click_command(cm["items"][0]) == {"verb": "open", "address": f"{V}/tab:bo.tabs=pending", "to": "recent"}, "a tab is opened")
ok(sd.click_command(cm["items"][2], reason="voice", to="cc-1") == {"verb": "press", "address": f"{V}/button:seen.new-build", "to": "cc-1", "reason": "voice"}, "a button is pressed")
ok(sd.click_command(cm["items"][3]) == {"verb": "focus", "address": f"{V}/grid:queue/row:nightly", "to": "recent", "options": {"select": True, "expand": True}}, "a row is focused, selected and expanded")
ok(sd.click_command(cm["items"][7], confirm=True)["confirm"] is True, "confirm travels with a delete")

# ---- the description (a fake model service)
PNG = base64.b64encode(b"\x89PNG\r\n\x1a\nfake").decode()
PNG2 = base64.b64encode(b"\x89PNG\r\n\x1a\nother").decode()


class Llm:
    def __init__(self, profiles: list[dict[str, Any]], text: str = "Screen: Build orchestrator.", wait: float = 0, fail: str = "") -> None:
        self._profiles, self.text, self.wait, self.fail, self.calls = profiles, text, wait, fail, []

    def profiles(self) -> list[dict[str, Any]]:
        return self._profiles

    def complete(self, messages: list[dict[str, Any]], system: str | None = None, profile: str | None = None, model: str | None = None, tools: Any = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
        self.calls.append({"messages": messages, "system": system, "profile": profile, "model": model, "params": params})
        if self.wait:
            time.sleep(self.wait)
        if self.fail:
            raise RuntimeError(self.fail)
        return {"text": self.text, "usage": {"input": 2000, "output": 400}, "profile": profile, "model": model}


PROFILES = [{"id": "sub", "kind": "claude-code", "defaultModel": "claude-opus-5-5", "keyReady": True},
            {"id": "off", "kind": "anthropic", "defaultModel": "claude-opus-5-5", "keyReady": True, "enabled": False},
            {"id": "nokey", "kind": "anthropic", "defaultModel": "claude-opus-5-5", "keyReady": False},
            {"id": "api", "kind": "anthropic", "defaultModel": "claude-opus-5-5", "keyReady": True},
            {"id": "small", "kind": "anthropic", "defaultModel": "claude-haiku-5-5", "keyReady": True}]
STATE = {"screen": "build-orchestrator", "screenLabel": "Build orchestrator", "tabs": {f"{V}/tab:bo.tabs": "pending"}, "dialog": "confirm"}
llm = Llm(PROFILES)
ok(sd.pick_profile(llm) == ("api", "claude-opus-5-5"), "the describing provider: the first ready Claude API provider (the subscription one takes no images)")
ok(sd.pick_profile(Llm([PROFILES[4]])) == ("small", sd.DEFAULT_MODEL), "a provider set to a smaller model still describes on Opus")
ok(sd.pick_profile(Llm([PROFILES[0]])) is None and sd.pick_profile(Llm([])) is None, "no Claude API provider: none")
os.environ["AXF_SCREEN_DESCRIBE_MODEL"], os.environ["AXF_SCREEN_DESCRIBE_PROFILE"] = "claude-fable-5-2", "small"
ok(sd.pick_profile(llm) == ("small", "claude-fable-5-2"), "AXF_SCREEN_DESCRIBE_PROFILE / _MODEL override the pick")
del os.environ["AXF_SCREEN_DESCRIBE_MODEL"], os.environ["AXF_SCREEN_DESCRIBE_PROFILE"]

d = sd.describe(PNG, "image/png", STATE, cm, llm=llm)
call = llm.calls[-1]
ok(d["text"] == "Screen: Build orchestrator." and d["by"]["profile"] == "api" and d["by"]["model"] == "claude-opus-5-5" and d["by"]["cached"] is False, "the description comes back with who wrote it")
ok(call["messages"][0]["images"] == [{"media_type": "image/png", "data": PNG}] and call["params"] == {"max_tokens": sd.MAX_TOKENS}, "the PNG goes to the model as an image")
p = call["messages"][0]["content"]
ok("Build orchestrator" in p and "Open dialog: confirm" in p and '1. "Pending 3" | tab (open)' in p and "Load more" not in p, "the prompt carries the screen, the dialog and the visible controls with their numbers")
ok("unreadable" in call["system"] and "Never guess" in call["system"] and "No guessing" in p, "the model is told to be literal and to say when text is unreadable")
price = json.loads((HERE.parents[3] / "framework" / "schemas" / "model-pricing.json").read_text())["models"]["opus"]
ok(d["by"]["usd"] == round((2000 * price["input"] + 400 * price["output"]) / 1e6, 4) and d["by"]["tokens"] == {"input": 2000, "output": 400}, "the cost of the call is worked out from its tokens and the price file")
again = sd.describe(PNG, "image/png", STATE, cm, llm=llm)
ok(len(llm.calls) == 1 and again["text"] == d["text"] and again["by"]["cached"] is True and again["by"]["usd"] == 0.0, "the same image again within two minutes: from the cache, no call, no cost")
sd.describe(PNG2, llm=llm)
ok(len(llm.calls) == 2, "another image is another call")
q = sd.describe(PNG, "image/png", STATE, cm, question="Is anything failing?", llm=llm)
ok(len(llm.calls) == 3 and 'starting with "Answer:": Is anything failing?' in llm.calls[-1]["messages"][0]["content"] and q["by"]["cached"] is False, "a question is asked of the model (and cached apart)")
real_now = sd._now
sd._now = lambda: real_now() + sd.CACHE_TTL_S + 1
sd.describe(PNG, "image/png", STATE, cm, llm=llm)
sd._now = real_now
ok(len(llm.calls) == 4, "after two minutes the image is described again")
# gives up after the timeout, the call still finishes and fills the cache
sd._cache.clear()
slow = Llm(PROFILES, text="late", wait=0.4)
t0 = time.time()
late = sd.describe(PNG, llm=slow, timeout=0.1)
ok(late["text"] == "" and "took longer than" in late["note"] and "clickable list" in late["note"] and time.time() - t0 < 0.35, "a slow model: gives up at the timeout with a note")
time.sleep(0.5)
ok(sd.describe(PNG, llm=slow, timeout=0.1)["text"] == "late" and len(slow.calls) == 1, "the late description is kept: asking again answers from the cache")
sd._cache.clear()
bad = sd.describe(PNG, llm=Llm(PROFILES, fail="credit balance is too low"))
ok(bad["text"] == "" and "the model call failed" in bad["note"] and "credit balance" in bad["note"], "a model error is a note, not a failure")
ok("no Claude API provider" in sd.describe(PNG, llm=Llm([PROFILES[0]]))["note"], "no image-capable provider: a note that says where to set one up")
ok("no model service" in sd.describe(PNG)["note"], "no model service at all (a local clone): a note")
ok(sd.describe(PNG, llm=Llm(PROFILES, text="  "))["text"] == "", "an empty answer is not a description")
ok(sd.DESCRIBE_TIMEOUT_S == 30 and sd.CACHE_TTL_S == 120, "30 s to describe, 2 minutes in the cache")

full = sd.screen_text(STATE, cm, {"text": "Screen: Build orchestrator."}, lead="Clicked \"Shipped\" (tab). The screen now:")
ok(full.startswith('Clicked "Shipped"') and full.index("Screen: Build orchestrator.") < full.index("Clickable now"), "the text a voice caller reads: what was clicked, the description, then the list")
ok("Screen: Build orchestrator (dialog open: confirm)" in sd.screen_text(STATE, cm, None) and "took too long" in sd.screen_text(STATE, cm, {"text": "", "note": "took too long"}), "no description: the screen name (and why) stand in for it")

# ---- the last list per console
sd.remember("recent", cm)
ok(sd.last("recent") is cm and sd.last("") is cm and sd.last("cc-other") is None, "the last list is kept per console")
sd._now = lambda: real_now() + sd.LAST_TTL_S + 1
ok(sd.last("recent") is None, "and forgotten after ten minutes")
sd._now = real_now

# ---- the MCP tools against a fake open console
sd._cache.clear()
mcp_server.CLICK_SETTLE_S = 0
fake = Llm(PROFILES, text="Screen: Build orchestrator. Tabs: Pending [1] (open), Shipped [2].")
sd._llm = lambda: fake
shots: list[dict[str, Any]] = []
controls: list[dict[str, Any]] = []
screen = {"png": PNG, "map": MAP}


def console(c: dict[str, Any]) -> dict[str, Any]:
    shots.append(c)
    return {"ok": True, "status": "delivered", "sent": {"id": "cc-1"}, "images": [{"client": "cc-abcdef", "mime": "image/png", "data": screen["png"], "bytes": 12, "width": 1280, "height": 800}],
            "state": STATE, **({"map": screen["map"]} if screen["map"] else {})}


def control(body: dict[str, Any]) -> dict[str, Any]:
    controls.append(body)
    if body.get("verb") == "targets":
        return {"ok": True, "source": "console", "targets": TARGETS}
    if "delete" in body.get("address", "") and not body.get("confirm"):
        return {"ok": False, "code": "confirmation_required", "message": "delete-build deletes or resets something: send it again with confirm"}
    if "approve" in body.get("address", ""):
        return {"ok": False, "code": "denied", "message": "approve is a decision only Brett makes with his own tap"}
    screen["png"] = PNG2  # the click changed the screen
    return {"ok": True, "verb": body["verb"], "address": body.get("address")}


server = mcp_server.build_server(lambda op, **a: {}, console=console, console_control=control)
tools = {t.name: t for t in asyncio.run(server.list_tools())}
ok("console_click_text" in tools and tools["console_click_text"].annotations.read_only_hint is not True, "console_click_text exists and is a write (a click can press a button)")
ok(tools["console_screenshot"].annotations.read_only_hint is True, "console_screenshot stays read-only")
for name in ("console_screenshot", "console_click_text"):
    ok("voice" in (tools[name].description or "").lower(), f"{name} says it is for voice")
props = tools["console_screenshot"].input_schema["properties"] if hasattr(tools["console_screenshot"], "input_schema") else tools["console_screenshot"].inputSchema["properties"]
ok(props["describe"]["default"] is True and "question" in props, "console_screenshot takes describe (default true) and question")


def call(name: str, args: dict[str, Any]) -> tuple[list[Any], dict[str, Any]]:
    res = asyncio.run(server.call_tool(name, args))
    blocks = res.content if hasattr(res, "content") else res[0] if isinstance(res, tuple) else res
    return blocks, json.loads(blocks[-1].text) if blocks[-1].text.startswith("{") else getattr(res, "structured_content", None) or {}


blocks, meta = call("console_screenshot", {})
ok([b.type for b in blocks] == ["text", "image", "text"], "text first (for a client that drops images), then the image, then the JSON")
ok(blocks[0].text.startswith("Screen: Build orchestrator. Tabs:") and '2. "Shipped" | tab | ' in blocks[0].text and "Scroll to see" in blocks[0].text, "the first text part is the description and the numbered clickable list")
ok(blocks[1].data == PNG and blocks[1].mime_type == "image/png", "the image part is kept")
ok(meta["description"] == blocks[0].text and meta["describedBy"]["model"] == "claude-opus-5-5" and meta["describedBy"]["usd"] > 0, "the JSON has the same text as `description`, and who described it at what cost")
ok(len(meta["clickable"]["visible"]) == 9 and len(meta["clickable"]["scroll"]) == 2 and meta["clickable"]["visible"][1]["address"] == f"{V}/tab:bo.tabs=shipped", "and the clickable list as data")
ok("map" not in meta and "data" not in meta["images"][0] and meta["state"]["screen"] == "build-orchestrator", "the raw map and the image data are not repeated in the JSON")
n = len(fake.calls)
blocks, meta = call("console_screenshot", {"describe": False})
ok(len(fake.calls) == n and blocks[0].text.startswith("Screen: Build orchestrator (dialog open: confirm)") and "Clickable now" in blocks[0].text and "describedBy" not in meta, "describe=false: no model call, the clickable list still comes")
call("console_screenshot", {"question": "what failed?"})
ok(len(fake.calls) == n + 1 and "what failed?" in fake.calls[-1]["messages"][0]["content"], "question reaches the model")
pending = mcp_server.build_server(lambda op, **a: {}, console=lambda c: {"ok": True, "queued": True, "status": "pending", "message": "queued"}, console_control=control)
pres = asyncio.run(pending.call_tool("console_screenshot", {}))
pblocks = pres.content if hasattr(pres, "content") else pres
ok(len(pblocks) == 1 and json.loads(pblocks[0].text)["status"] == "pending" and "description" not in json.loads(pblocks[0].text), "no console answered: pending, nothing to describe")
# a model that takes too long: the image and the list still come, with the note
sd._cache.clear()
real_describe = sd.describe
sd.describe = lambda *a, **k: real_describe(*a, **{**k, "llm": Llm(PROFILES, wait=0.3), "timeout": 0.05})
blocks, meta = call("console_screenshot", {})
sd.describe = real_describe
ok([b.type for b in blocks] == ["text", "image", "text"] and "took longer than" in blocks[0].text and "Clickable now" in blocks[0].text and "note" in meta["describedBy"], "a timed-out description: image, clickable list and a note")
time.sleep(0.4)
sd._cache.clear()
# an older console page: the list comes from the live targets
screen["map"] = None
blocks, meta = call("console_screenshot", {"describe": False})
ok(meta["clickable"]["source"] == "targets" and controls[-1]["verb"] == "targets" and '"Pending" | tab (open)' in blocks[0].text, "no map from the console: the live control targets are merged in instead")
screen["map"] = MAP

# click by words
controls.clear()
shots.clear()
screen["png"] = PNG
blocks, meta = call("console_click_text", {"text": "shiped"})
ok(controls == [{"verb": "open", "address": f"{V}/tab:bo.tabs=shipped", "to": "recent", "reason": 'voice: click "shiped"', "by": "mcp"}], "one match: clicked through console-control (a tab is opened), with a reason")
ok(len(shots) == 2 and all(s["action"] == "screenshot" for s in shots), "the screen is read before the click and captured after it")
ok(blocks[0].text.startswith('Clicked "Shipped" (tab). The screen now:') and "Clickable now" in blocks[0].text and blocks[1].type == "image" and blocks[1].data == PNG2, "the answer is the new screen: description, list and image")
ok(meta["clicked"] == {"text": "Shipped", "kind": "tab", "address": f"{V}/tab:bo.tabs=shipped", "verb": "open", "matched": "close spelling"} and "description" in meta, "and says what was clicked and how it matched")
controls.clear()
blocks, meta = call("console_click_text", {"text": "Retry"})
ok(controls == [] and meta["status"] == "ambiguous" and meta["clicked"] is None and [m["nth"] for m in meta["matches"]] == [1, 2], "several matches: nothing is clicked")
ok(blocks[0].text.startswith('2 things match "Retry"') and '1. "Retry" | button | list number 5' in blocks[0].text and '2. "Retry" | button | list number 6' in blocks[0].text, "the matches come back numbered")
call("console_click_text", {"text": "Retry", "nth": 2})
ok(controls[-1]["verb"] == "press" and controls[-1]["address"] == f"{V}/button:seen.retry.2", "nth clicks that one")
call("console_click_text", {"text": "click 3"})
ok(controls[-1]["address"] == f"{V}/button:seen.new-build", "a number from the last list is clicked")
call("console_click_text", {"text": "nightly", "kind": "row"})
ok(controls[-1]["verb"] == "focus" and controls[-1]["options"] == {"select": True, "expand": True}, "a row is focused and expanded")
controls.clear()
blocks, meta = call("console_click_text", {"text": "deploy everything"})
ok(controls == [] and meta["status"] == "not_found" and "nothing on the screen says" in blocks[0].text, "no match: nothing is clicked, and it says so")
blocks, meta = call("console_click_text", {"text": "delete build"})
ok(meta["code"] == "confirmation_required" and meta["clicked"] is None and "confirm=true" in blocks[0].text and len(shots) and controls[-1].get("confirm") is None, "a delete is not clicked without confirm")
call("console_click_text", {"text": "delete build", "confirm": True})
ok(controls[-1]["confirm"] is True and controls[-1]["verb"] == "press", "with confirm it is pressed")
for args, why in (({"text": "paused"}, "disabled"), ({"text": "  "}, "validation")):
    try:
        asyncio.run(server.call_tool("console_click_text", args))
        ok(False, f"{args} must fail")
    except Exception as e:  # noqa: BLE001
        ok(why in str(e), f"{args}: refused ({why})")
screen["map"] = {"items": [{"address": f"{V}/button:seen.approve", "kind": "button", "role": "button", "text": "Approve", "on": "screen"}]}
try:
    asyncio.run(server.call_tool("console_click_text", {"text": "approve"}))
    ok(False, "approve must be refused")
except Exception as e:  # noqa: BLE001
    ok("only Brett" in str(e), "an approve button is never pressed for Brett (the console-control guard answers)")

print(f"screen describe: {passed} checks passed")
