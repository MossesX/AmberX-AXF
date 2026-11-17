"""Widget icons REST (widget-icons@1): the inventory list, set / get / reset against a look document, refusals, the routes.

    python apps/console-web/server/test_widget_icons.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
tmp = tempfile.mkdtemp()
os.environ["AXF_LOOKS_DIR"] = tmp
import widget_icons as wi  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    assert v, what
    checks += 1


def eq(a: object, b: object, what: str) -> None:
    global checks
    assert a == b, f"{what}: {a!r} != {b!r}"
    checks += 1


def raises(fn, code: str, what: str) -> None:
    global checks
    try:
        fn()
    except wi.WidgetIconError as e:
        assert e.code == code, f"{what}: {e.code} != {code}"
        checks += 1
        return
    raise AssertionError(f"{what}: no error")


# the inventory and the glyphs are found
inv = wi.inventory()
ok(len(inv["widgets"]) >= 20, "inventory read")
g = wi.glyphs()
ok("rocket" in g and "bell" in g and len(g) > 50, "framework glyphs read")
for w in inv["widgets"]:
    ok(wi.parse_id(w["id"]), f"{w['id']} parses")
    ok(w["icon"] in g, f"{w['id']} default {w['icon']} is a glyph")

# refs and ids (= the engine's grammar)
eq(wi.parse_ref("rocket"), (None, "rocket"), "glyph ref")
eq(wi.parse_ref("pack:amberx-outline/home"), ("amberx-outline", "home"), "pack: ref")
eq(wi.parse_ref("Bad Ref"), None, "bad ref")
eq(wi.parse_id("nope:status:x"), None, "unknown host")

# no look document: list works (no picks), a write is refused with the fix
lst = wi.list_widgets("console")
eq(lst["app"], "axf-console", "alias")
eq(lst["look"], False, "no look yet")
eq(next(w for w in lst["widgets"] if w["id"] == "banner:status:project")["icon"], "folder", "default icon")
raises(lambda: wi.set_widget("banner:status:project", icon="rocket"), "no_look", "no look document")

# with a look document
look = Path(tmp) / "axf-console.json"
look.write_text(json.dumps({"$axf": "app-look@1", "app": "axf-console", "default": {}, "own": {"settings": {"axf.other": 1}}}))
w = wi.set_widget("banner:status:project", icon="rocket", mode="icon")["widget"]
eq((w["icon"], w["via"], w["mode"]), ("rocket", "pick", "icon"), "set icon + mode")
doc = json.loads(look.read_text())
eq(doc["own"]["settings"]["axf.widget.banner:status:project.icon"], "rocket", "written to own.settings")
eq(doc["own"]["settings"]["axf.other"], 1, "other settings kept")
eq(wi.set_widget("banner:status:project", icon="pack:amberx-outline/home")["widget"]["icon"], "amberx-outline/home", "pack ref normalized")
raises(lambda: wi.set_widget("banner:status:project", icon="nosuchglyph"), "unknown_icon", "unknown glyph")
raises(lambda: wi.set_widget("banner:status:project", icon="Bad Ref"), "bad_icon", "bad ref")
raises(lambda: wi.set_widget("banner:status:project", mode="huge"), "bad_mode", "bad mode")
raises(lambda: wi.set_widget("banner:status", icon="rocket"), "bad_widget", "bad id")
raises(lambda: wi.set_widget("banner:status:project"), "nothing_to_set", "nothing given")
# a widget not in the inventory still takes a pick and is listed
wi.set_widget("settings:setting:axf.display.fontScale", icon="type")
ok(any(x["id"] == "settings:setting:axf.display.fontScale" and x["icon"] == "type" for x in wi.list_widgets()["widgets"]), "picked row listed")
eq(wi.get_widget("settings:group:axf.appearance")["widget"]["icon"], "list", "group rule default")
# a hand-edited bad pick is reported, never drawn
s = json.loads(look.read_text()); s["own"]["settings"]["axf.widget.banner:status:shipped.icon"] = "zzz-nope"; look.write_text(json.dumps(s))
w = wi.get_widget("banner:status:shipped")["widget"]
eq((w["icon"], w["via"]), ("sparkles", "default"), "bad pick falls back")
ok(w["fell"], "bad pick reported")
# reset one, reset all
w = wi.reset_widget("banner:status:project")["widget"]
eq((w["icon"], w["mode"], w["pick"]), ("folder", "auto", None), "reset one")
wi.reset_widget()
eq(wi.picks_of("axf-console"), {}, "reset all")
eq(json.loads(look.read_text())["own"]["settings"], {"axf.other": 1}, "reset keeps the rest")
# filter
ok(all("project" in x["id"] or "project" in x["label"].lower() for x in wi.list_widgets(q="project")["widgets"]), "q filters")

# the routes
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(wi.router_for(lambda: None))
c = TestClient(app)
eq(c.get("/api/widget-icons").status_code, 200, "GET list")
eq(c.get("/api/widget-icons/glyphs?q=rock").json()["glyphs"], ["rocket"], "GET glyphs")
r = c.put("/api/widget-icons/banner:badge:claude", json={"icon": "star", "mode": "icon+text"})
eq((r.status_code, r.json()["widget"]["icon"]), (200, "star"), "PUT")
eq(c.get("/api/widget-icons/banner:badge:claude").json()["widget"]["mode"], "icon+text", "GET one")
eq(c.put("/api/widget-icons/banner:badge:claude", json={"icon": "nosuch"}).status_code, 400, "PUT refused")
eq(c.delete("/api/widget-icons/banner:badge:claude").json()["widget"]["via"], "default", "DELETE resets")
eq(c.post("/api/widget-icons/reset", json={}).status_code, 200, "POST reset")
eq(c.post("/api/widget-icons/banner:badge:claude/open", json={}).status_code, 503, "open without the relay: 503")

print(f"✓ widget-icons REST — {checks} checks")

# voice (= src/actions/widget-icon-voice.ts)
eq(wi.voice_intent("Use the rocket icon for the project widget."), {"op": "icon", "widget": "project", "value": "rocket"}, "voice: use … icon for …")
eq(wi.voice_intent("set the usage meter icon to star"), {"op": "icon", "widget": "usage meter", "value": "star"}, "voice: set … icon to …")
eq(wi.voice_intent("show the what's new ticker as text"), {"op": "mode", "widget": "what's new ticker", "value": "text"}, "voice: show … as text")
eq(wi.voice_intent("show the project widget as icon and text"), {"op": "mode", "widget": "project", "value": "icon+text"}, "voice: icon and text")
eq(wi.voice_intent("reset the project widget icon"), {"op": "reset", "widget": "project"}, "voice: reset one")
eq(wi.voice_intent("reset all widget icons"), {"op": "reset", "widget": "*"}, "voice: reset all")
eq(wi.voice_intent("scroll down"), None, "voice: not a widget phrase")
eq(wi.voice_intent("show the project widget as huge"), None, "voice: unknown mode is not ours")
r = wi.voice("use the rocket icon for the project widget")
eq((r["ok"], r["widget"]), (True, "banner:status:project"), "voice sets")
eq(wi.get_widget("banner:status:project")["widget"]["icon"], "rocket", "voice pick saved")
eq(wi.voice("show the appearance tab as icon")["widget"], "settings:tab:appearance", "voice finds a settings tab")
eq(wi.voice("use the nosuchglyph icon for the project widget")["ok"], False, "voice refuses an unknown glyph")
eq(wi.voice("use the rocket icon for the zzzz widget")["code"], "not_found", "voice: unknown widget")
eq(wi.voice("reset all widget icons")["ok"], True, "voice resets all")
eq(wi.picks_of("axf-console"), {}, "voice reset all saved")
print(f"✓ widget-icons voice — {checks} checks")
