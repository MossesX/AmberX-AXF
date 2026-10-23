"""Plugin Update self-test (CI runs every plugins/*/test.py): manifest + the pure part (web/core.ts, through Node).
Run: python apps/console-web/plugins/plugin-update/test.py"""
from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
ok = fail = 0


def check(name: str, cond: bool) -> None:
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("✗", name)


m = json.loads((HERE / "plugin.json").read_text())
check("plugin@1 manifest", m.get("$axf") == "plugin@1" and m.get("id") == "ai.amberx.axf.console.plugin-update")
check("records the model that built it", m.get("builtWith", {}).get("model") == "opus" and len(m["builtWith"].get("builtAt", "")) == 10)
check("its page opens in the main area by default", m.get("opens") == "main" and "view:plugin-update" in m.get("provides", []))
check("no server part (uses the console's own routes)", not (HERE / "server").exists())
web = (HERE / "web" / "index.tsx").read_text()
check("updates through the console's catalog routes", "plugin-catalog/install" in web and "plugin-catalog/swap" in web)
check("replace asks first and names both steps", "Remove the installed" in web and "Install the" in web and "confirm: `replace ${r.folder}`" in web)
r = subprocess.run(["node", "--experimental-strip-types", "--no-warnings", str(HERE / "test.mts")], capture_output=True, text=True, timeout=120)
print(r.stdout.strip())
check("web/core.ts (test.mts)", r.returncode == 0)

print(f"plugin-update: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
