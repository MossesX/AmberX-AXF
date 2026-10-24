#!/usr/bin/env python3
"""Self-test for the Voice notes plugin (web-only: settings interface + notes page on lib-hubstore).

    python3 apps/console-web/plugins/voice-notes/test.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ID = "ai.amberx.axf.console.voice-notes"
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("voice-notes self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == ID and "axf-console" in man["targets"] and man["lifecycle"]["dataDir"] == ".axf-console/plugins/voice-notes", "plugin@1 manifest: id, target, data folder")
check(man["provides"] == ["settings-tab:voice-notes", "view:voice-notes"], "provides its settings tab and the notes page")
check(man["tabable"] == {"view": "voice-notes", "label": "Voice notes", "icon": "mic"} and man["opens"] == "main", "tabable: the notes page can be added as a tab (Patches), opens in the main area")
check(not (HERE / "server").exists(), "web-only: no server part")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("'voice-notes': { title: 'Voice notes'" in web and "view: 'voice-notes'" in web and "dialogs:" not in web, "one view (the notes page) with a nav entry, no dialogs")
check("store.loadNotes()" in web and "NOTES_EVERY_MS = 30_000" in web and "visibilitychange" in web, "the page fetches notes on show, every 30 s while visible and on focus")
check("rt.embedded?.page" in web, "shown alone as a tab page it drops its page header")
check("parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")
st = (HERE / "web" / "store.ts").read_text("utf-8")
check("NOTES_TABLE" in st and "loadNotes" in st and "removeNote" in st, "store reads and deletes rows of the notes table")
check("libs/hubstore" in st and "localStorage" not in st and "localStorage" not in web, "settings and lists go through lib-hubstore, nothing in this browser")
css = (HERE / "web" / "voice-notes.css").read_text("utf-8")
check("#" not in css.replace("/*", "").split("*/")[-1] and "--fx-" in css and "--fx-space:" not in css, "CSS: layout with theme tokens only, no colours")

npx = shutil.which("npx")
if not npx:
    print("  - model checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "core-check.mts")], capture_output=True, text=True, timeout=300, cwd=str(REPO))
    if out.returncode != 0:
        raise SystemExit(f"FAIL: core check crashed\n{out.stderr[-2000:]}")
    e = json.loads(out.stdout.strip().splitlines()[-1])
    check(e["defaults"], "defaults: start + stop triggers, beep on")
    check(e["clamps"], "out-of-range beep, length and language fall back or clamp")
    check(e["dedupe"] == "Stop note|end", "phrases: duplicates and empties dropped")
    check(e["strip"] == {"text": "Buy milk and eggs", "cut": "stop note"}, "stop trigger cut from the note text")
    check(e["stripMid"] == "remember the stop note thing", "only the last stop trigger ends the note")
    check(e["stripNone"] is None, "no stop trigger: nothing cut")
    check(e["numbers"] == [3, 3, 12, 21, 2, 7, None], "spoken numbers: digits, words, twenty one, ordinals")
    check(e["pickNum"] == "w" and e["pickName"] == "g" and e["pickTwelve"] == "d" and e["pickNone"] is None, "a reply picks a list by number, name or alias")
    check(e["asks"] and e["cancel"], "list-of-lists and cancel triggers heard")
    check(e["sub"] == "veg" and e["subAlias"] == "dairy", "subcategory by number or alias")
    check(e["setPhrase"] == "b" and e["setNumber"] == "n" and e["setAlways"] == "a", "question sets opened by a recorded trigger, a number, else the always set")
    check(e["read"] == ["1: Groceries", "2: Work ideas", "12: Dentist"], "lists read with their numbers, in order")
    check(e["problemsOk"] == [], "a good setup has no problems")
    bad = " ".join(e["problemsBad"])
    check("start trigger" in bad and "both a stop and a cancel" in bad and "number 1" in bad and "has no name" in bad, "problems: missing start trigger, clashing triggers, duplicate numbers, unnamed list")
    check(e["newNumber"] == 3, "a new list takes the first free number")
    check(e["roundTrip"] and e["badRow"] is None, "a stored list reads back the same; junk rows are dropped")
    pv = " ".join(e["preview"])
    check("take a note" in pv and "beep" in pv and "1: Groceries" in pv and "Which store?" in pv and "Saved to Groceries" in pv, "preview walks the whole conversation")

    nt = e["notes"]
    check(nt["ids"] == ["n1", "n2", "n3"], "saved notes: rows without text and junk rows are dropped")
    check(nt["answers"] == {"store": "Aldi"}, "answers keep text values only")
    check(nt["order"] == ["n2", "n1", "n3"], "notes newest first")
    check(nt["byList"] == ["n1"] and nt["bySub"] == 0 and nt["none"] == ["n3"], "filter by list, subcategory, or list removed")
    check(nt["search"] == ["n1"] and nt["searchWhere"] == ["n2"], "search covers the text, answers and where it went")
    check(nt["where"] == ["Groceries › Vegetables", "Work ideas", "gone (list removed)"], "each note says where it went")
    check(nt["counts"] == {"g": 1, "w": 1, "none": 1}, "notes counted per list")
    check(nt["md"].startswith("- **Groceries › Vegetables**") and "  - store: Aldi" in nt["md"], "copy as Markdown")

    hs = subprocess.run([npx, "-y", "tsx", str(REPO / "framework/spec/check-hubstore.mts")], capture_output=True, text=True, timeout=300, cwd=str(REPO))
    check(hs.returncode == 0, "lib-hubstore checks pass")
print(f"all {ok} checks passed")
