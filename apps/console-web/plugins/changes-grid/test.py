#!/usr/bin/env python3
"""Self-test for the Changes & features grid plugin: manifest, server part against a fake axf.changes@1, the pure core.

    python3 apps/console-web/plugins/changes-grid/test.py
"""
from __future__ import annotations

import json
import shutil
import subprocess
import sys
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("changes-grid self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.changes-grid" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/changes-grid", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["opens"] == "main", "model recorded, opens in the main area")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check(f"id: ID" in web and "parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")
check("codebase-changes" not in web and "codebase-changes" not in (HERE / "server" / "__init__.py").read_text("utf-8"), "never names the changes plugin (capability service only)")

# Server part against a fake capability registry (no FastAPI app needed: the route functions are plain).
services: dict = {}
sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: services.get(name))
try:
    import fastapi  # noqa: F401
except ImportError:
    print("  - server checks skipped (no fastapi)")
else:
    sys.path.insert(0, str(HERE))
    import server as srv  # noqa: E402
    from fastapi import HTTPException

    check(srv.changes() == {"available": False, "items": []}, "no changes service: available false, empty")

    class Fake:
        def summaries(self):
            return [{"id": "chg-20261025-abcdef", "title": "t"}]

        def get(self, cid):
            return {"id": cid, "steps": []} if cid == "chg-20261025-abcdef" else None

    services["axf.changes@1"] = Fake()
    check(srv.changes()["items"][0]["id"] == "chg-20261025-abcdef", "summaries come through the capability")
    check(srv.change("chg-20261025-abcdef")["entry"]["id"] == "chg-20261025-abcdef", "one whole entry")
    for bad, code in (("../etc", 400), ("chg-20261025-ffffff", 404)):
        try:
            srv.change(bad)
            check(False, f"{bad} refused")
        except HTTPException as e:
            check(e.status_code == code, f"{bad!r} → {code}")

    class Broken:
        def summaries(self):
            raise RuntimeError("disk")

    services["axf.changes@1"] = Broken()
    check(srv.changes()["available"] is False, "a broken log never breaks the grid")

npx = shutil.which("npx")
if not npx:
    print("  - core checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "web" / "core-check.mts")], capture_output=True, text=True, timeout=300)
    last = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {"failed": ["crash"], "total": 0}
    check(out.returncode == 0 and not last["failed"] and last["total"] > 10, f"pure core: {last['total']} checks ({last['failed'] or 'all pass'})")
print(f"all {ok} checks passed")
