#!/usr/bin/env python3
"""Self-test for the Skin editor's server part (routes on a scratch data folder).

    python3 apps/console-web/plugins/skin-editor/test.py

Replays framework/spec/fixtures/token-registry.json against the Python snapshot twin (same ids, states, rows,
revert-by-time, export, voice intents as the JS engine), then drives the routes: registry search, pick → edit → revert →
undo → export, skins list / delete, voice end to end.
"""
from __future__ import annotations

import importlib.util
import json
import os
import shutil
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = tempfile.mkdtemp(prefix="axf-skin-editor-test-")
os.environ["AXF_SKIN_EDITOR_DIR"] = TMP
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.skin_editor_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)  # type: ignore[union-attr]

from fastapi import HTTPException  # noqa: E402

FIX = json.loads((REPO / "framework" / "spec" / "fixtures" / "token-registry.json").read_text("utf-8"))
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(("  ok  " if ok else "  FAIL") + " " + name + (f" — {detail}" if detail and not ok else ""))
    if not ok:
        failures.append(name)


def same(a, b) -> bool:
    return json.dumps(a, sort_keys=True) == json.dumps(b, sort_keys=True)


print("fixture replay (Python twin of the engine)")
chain_fx = FIX["chain"]
root = mod.root_snapshot({"kind": "view", "id": "home", "label": "Home"}, "test", chain_fx[0]["at"])
check("root snapshot", same(root, chain_fx[0]))
chain = [root]
s1 = mod.edit_snapshot(chain, root, {"token": "--fx-accent", "to": "#ff8800"}, "test", chain_fx[1]["at"])
chain.append(s1)
check("edit snapshot id + state", same(s1, chain_fx[1]), json.dumps(s1))
s2 = mod.edit_snapshot(chain, s1, [{"token": "--fx-radius-md", "to": "12px"}, {"token": "--fx-accent", "to": "#ff8800"}], "test", chain_fx[2]["at"])
chain.append(s2)
check("batch edit drops no-ops", same(s2, chain_fx[2]))
s3 = mod.edit_snapshot(chain, s2, {"token": "--fx-accent", "to": None}, "test", chain_fx[3]["at"])
chain.append(s3)
check("edit back to default", same(s3, chain_fx[3]))
check("no-op edit is None", mod.edit_snapshot(chain, s3, {"token": "--fx-accent", "to": None}, "test", chain_fx[3]["at"]) is None)
rev = mod.revert_snapshot(chain, s3, s1["id"], "test", chain_fx[4]["at"])
chain.append(rev)
check("revert snapshot", same(rev, chain_fx[4]))
check("rows", same(mod.snapshot_rows(chain, rev["id"]), FIX["rows"]))
check("chain to s3", [s["id"] for s in mod.chain_to(chain, s3["id"])] == FIX["pathToS3"])
check("snapshot before (10 minutes ago)", mod.snapshot_before(chain, rev["id"], chain_fx[3]["at"])["id"] == FIX["before"]["tenMinutesAgo"])
check("snapshot before all → root", mod.snapshot_before(chain, rev["id"], "2026-11-13T19:55:00.000Z")["id"] == FIX["before"]["beforeAll"])
check("diff", same(mod.diff_states(s2["state"], s1["state"]), FIX["diff"]))
check("apply", same(mod.apply_edits({"--fx-a": 1}, [{"token": "--fx-a", "to": None}, {"token": "--fx-b", "to": "x"}]), FIX["apply"]))
sets = {"--fx-accent": {"target": "tokens.theme", "path": "accent"}, "--fx-radius-md": {"target": "tokens.style", "path": "radius.md"}}
base = {"layoutTheme": "focus-top", "colorTheme": "hub-night", "styleTheme": "hub", "behaviorTheme": "standard", "assets": {"button": "rounded-solid"}}
exp = mod.export_skin({**s2["state"], "--fx-btn-bg-hover": "#333"}, "Midnight Sky", "Midnight", base, sets)
check("export skin", same(exp, FIX["exported"]), json.dumps(exp)[:400])
for case in FIX["voice"]:
    check(f"voice: {case['phrase']}", same(mod.voice_intent(case["phrase"]), case["intent"]), json.dumps(mod.voice_intent(case["phrase"])))

print("registry routes")
r = mod.get_registry()
check("registry lists tokens", r["total"] > 100 and r["hits"] == r["total"])
hits = mod.get_registry(q="accent", level="basic")
check("registry search + level", hits["hits"] >= 1 and all(t["level"] == "basic" for t in hits["tokens"]) and any(t["id"] == "--fx-accent" for t in hits["tokens"]))
check("registry summary", mod.get_registry_summary()["total"] == r["total"])
check("registry token", mod.get_registry_token("--fx-accent")["id"] == "--fx-accent")
try:
    mod.get_registry_token("--fx-nope")
    check("unknown token 404", False)
except HTTPException as e:
    check("unknown token 404", e.status_code == 404)
check("uis include elements and plugins", any(u["kind"] == "element" for u in mod.get_uis()["uis"]) and any(u["kind"] == "plugin" for u in mod.get_uis()["uis"]))

print("session routes")
check("state empty", mod.get_state() == {"current": None, "sessions": 0})
try:
    mod.get_session("view:home")
    check("unknown session 404", False)
except HTTPException as e:
    check("unknown session 404", e.status_code == 404)
v = mod.pick_session("view:home", {"label": "Home"})
check("pick starts at the default skin", v["head"] == "default" and v["chain"][0]["kind"] == "default" and v["ui"]["label"] == "Home")
e1 = mod.edit_session("view:home", {"edits": [{"token": "--fx-accent", "to": "#ff8800"}]})
check("edit makes a snapshot", e1["snapshot"] is not None and e1["head"] == e1["snapshot"]["id"] and e1["state"] == {"--fx-accent": "#ff8800"})
e2 = mod.edit_session("view:home", {"edits": [{"token": "--fx-radius-md", "to": "12px"}]})
check("second edit chains", e2["snapshot"]["parent"] == e1["head"] and len(e2["chain"]) == 3)
check("state reports current", mod.get_state()["current"]["key"] == "view:home" and mod.get_state()["sessions"] == 1)
rv = mod.revert_session("view:home", {"snapshot": "default"})
check("revert to default", rv["snapshot"]["kind"] == "revert" and rv["state"] == {} and len(rv["chain"]) == 4)
rv2 = mod.revert_session("view:home", {"snapshot": e2["head"]})
check("revert forward again", rv2["state"] == {"--fx-accent": "#ff8800", "--fx-radius-md": "12px"})
rv3 = mod.revert_session("view:home", {"minutesAgo": 0})
check("revert to now is a no-op", rv3["snapshot"] is None and rv3["head"] == rv2["head"])
rv4 = mod.revert_session("view:home", {"minutesAgo": 10})
check("revert to 10 minutes ago → the default", rv4["state"] == {} and rv4["target"] == "default")
un = mod.undo_session("view:home")
check("undo goes back one", un["state"] == rv2["state"])
try:
    mod.revert_session("view:home", {})
    check("revert needs a target", False)
except HTTPException as e:
    check("revert needs a target", e.status_code == 400)
try:
    mod.edit_session("view:home", {"edits": [{"token": "color", "to": "#000"}]})
    check("bad token ignored → no snapshot", True)
except HTTPException:
    check("bad token ignored → no snapshot", False)
ex = mod.export_session("view:home", {"name": "Midnight", "description": "Dark and warm"})
check("export writes a skin", ex["asset"]["id"] == "midnight" and ex["asset"]["type"] == "skin" and (Path(TMP) / "skins" / "midnight.json").is_file())
check("export maps control tokens", "--fx-accent" in ex["mapped"] and "--fx-radius-md" in ex["mapped"] and ex["unmapped"] == [])
check("exported skin carries overrides", ex["asset"]["data"]["extras"]["settings"]["axf.tokens.theme"]["*"]["accent"] == "#ff8800")
check("skins list", mod.get_skins()["skins"][0]["id"] == "midnight" and mod.get_skins()["skins"][0]["tokens"] == 2)
check("skin get", mod.get_skin("midnight")["name"] == "Midnight")
check("skin delete", mod.delete_skin("midnight") == {"ok": True} and mod.get_skins()["skins"] == [])
check("sessions list", mod.get_sessions()["sessions"][0]["key"] == "view:home")

print("voice end to end")
vv = mod.voice({"phrase": "set the accent to #00ff88 in the skin"})
check("voice set", vv["ran"] and vv["result"]["token"] == "--fx-accent" and mod.get_session("view:home")["state"]["--fx-accent"] == "#00ff88", json.dumps(vv))
vv = mod.voice({"phrase": "export this as a new skin called Deep Ocean"})
check("voice export", vv["ran"] and vv["result"]["id"] == "deep-ocean", json.dumps(vv))
vv = mod.voice({"phrase": "revert the skin to 10 minutes ago"})
check("voice revert by time", vv["ran"] and vv["result"]["target"] == "default", json.dumps(vv))
vv = mod.voice({"phrase": "undo the last skin edit"})
check("voice undo", vv["ran"], json.dumps(vv))
vv = mod.voice({"phrase": "search the token registry for hover"})
check("voice registry", vv["ran"] and vv["open"]["view"] == "token-registry", json.dumps(vv))
vv = mod.voice({"phrase": "turn the lights off"})
check("voice unknown", vv["intent"] is None and not vv["ran"])
vv = mod.voice({"phrase": "revert the skin to the default", "dry": True})
check("voice dry run", not vv["ran"] and vv["intent"]["verb"] == "revert")

shutil.rmtree(TMP, ignore_errors=True)
if failures:
    print(f"\n{len(failures)} failure(s): {', '.join(failures)}")
    sys.exit(1)
print("\nall good")
