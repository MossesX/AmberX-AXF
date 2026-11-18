#!/usr/bin/env python3
"""Self-test for the Alerts bell plugin (web-only: its pure part replayed against the framework runtime with the
console's own assets, plus the toolbar no longer carrying the bell).

    python3 apps/console-web/plugins/alerts-bell/test.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ID = "ai.amberx.axf.console.alerts-bell"
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("alerts-bell self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == ID and "axf-console" in man["targets"] and man["lifecycle"]["dataDir"] == ".axf-console/plugins/alerts-bell", "plugin@1 manifest: id, target, data folder")
check(not (HERE / "server").exists(), "web-only: no server part, nothing stored on the server")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check(f"id: ID" in web and "parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")

# the console's toolbars as it registers them: baked shared set, its own, its overrides (later wins; shared-assets.mjs)
console_toolbars = {}
for d in ("src/axf/assets", "src/assets", "src/assets-overrides"):
    for p in sorted((REPO / "apps/console-web" / d / "toolbar").glob("*.json")):
        console_toolbars[p.stem] = p
for stem, p in sorted(console_toolbars.items()):
    t = p.read_text("utf-8")
    check("alerts.open" not in t and "alerts.unread" not in t, f"toolbar {stem}: no bell (banner only)")

npx = shutil.which("npx")
if not npx:
    print("  - runtime checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "widget-check.mjs"), str(REPO)], capture_output=True, text=True, timeout=300)
    if out.returncode != 0:
        raise SystemExit(f"FAIL: widget check crashed\n{out.stderr[-2000:]}")
    e = json.loads(out.stdout.strip().splitlines()[-1])
    check(all(v["ok"] for v in e["valid"]), "both assets are valid framework widgets (action-button + counter)")
    check(e["banner"] == "amberx-thin", "console banner present (amberx-thin)")
    check(e["supplied"] == ["alerts-bell", "alerts-count"] and e["registered"] == [True, True], "supplies the bell and its count as banner data (the banner widgets plugin draws them)")
    check(e["attachedByItself"] == 0, "attaches nothing itself: show, side and placement belong to the banner widgets plugin")
    check(e["counter"] == ["", "5", "99+"], "count hidden at zero, 99+ past 99")
    check(e["badge"] == 7, "bound to the alerts library's counter alerts.unread")
    check(not e["toolbarBell"], "console-search toolbar no longer opens alerts")
    check(e["warnings"] == [], "no widget warnings from the runtime")
print(f"all {ok} checks passed")
