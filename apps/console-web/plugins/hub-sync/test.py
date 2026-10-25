#!/usr/bin/env python3
"""Self-test for the axHub sync plugin (web-only, the framework's lib-hubsync).

    python3 apps/console-web/plugins/hub-sync/test.py
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("hub-sync self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.hub-sync" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/hub-sync", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["tabable"] is False and man["banner"] is False, "built with, not tabable, no banner")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("@console/axf/libs/hubsync" in web and "PluginLifecyclePanel" in web, "uses the framework library + lifecycle panel")
check(not (HERE / "server").exists(), "no server part")
lib = json.loads((REPO / "framework/libs/hubsync/library.json").read_text("utf-8"))
check(lib["id"] == "ai.amberx.axf.hubsync" and lib["manifestKey"] == "libraries.hubsync", "library@1 entry")
r = subprocess.run(["npx", "-y", "tsx", "framework/spec/check-hubsync.mts"], cwd=REPO, capture_output=True, text=True)
check(r.returncode == 0, f"library checks pass ({r.stdout.strip() or r.stderr.strip()[-200:]})")
print(f"hub-sync: {ok} checks ok")
