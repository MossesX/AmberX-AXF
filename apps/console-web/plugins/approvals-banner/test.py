"""Approvals banner self-test. Run: python3 apps/console-web/plugins/approvals-banner/test.py

Web-only plugin (no server part): checks its manifest and lifecycle files, then runs the reminder / mandatory-review
planner tests (node test.mjs).
"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ok = 0


def check(cond: bool, what: str) -> None:
    global ok
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    ok += 1


m = json.loads((HERE / "plugin.json").read_text())
check(m["$axf"] == "plugin@1" and m["id"] == "ai.amberx.axf.console.approvals-banner", "manifest id")
check("banner:approvals-review" in m["provides"], "provides the review banner")
check(m["lifecycle"]["dataDir"] == ".axf-console/plugins/approvals-banner", "lifecycle data dir")
for f in ("install.mjs", "uninstall.mjs", "hooks.mjs", "web/index.tsx", "web/menu.ts", "web/reminders.mjs", "web/reminders.d.mts"):
    check((HERE / f).is_file(), f"has {f}")
src = (HERE / "web" / "index.tsx").read_text()
check(f"version: '{m['version']}'" in src, "web version = manifest version")
check("server" not in [p.name for p in HERE.iterdir()], "no server part (never sees the hub session)")
r = subprocess.run(["node", str(HERE / "test.mjs")], capture_output=True, text=True)
print(r.stdout.strip())
check(r.returncode == 0, f"node test.mjs\n{r.stderr}")
print(f"✓ approvals-banner: {ok} checks")
