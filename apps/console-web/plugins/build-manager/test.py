"""Build manager self-test. Run: python3 apps/console-web/plugins/build-manager/test.py

Server part (GET live): with and without the activity feed capability, filtering of old finished items, a failing
feed, and that it never writes anything. Then the merge/totals/live-link logic (node test.mjs) on fixtures + real data.
"""
from __future__ import annotations

import importlib
import json
import subprocess
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))
sys.path.insert(0, str(HERE.parent))

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

mod = importlib.import_module("build-manager.server")
app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond: bool, label: str) -> None:
    global ok
    if not cond:
        print(f"  ✗ {label}")
        sys.exit(1)
    ok += 1
    print(f"  ✓ {label}")


before = {p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")}

# no activity feed installed
plugin_services._services.pop("axf.activity@1", None)
r = c.get("/p/live").json()
check(r["available"] is False and r["items"] == [], "no axf.activity@1 → available false, empty list (build list still works)")

now = time.time() * 1000


class Feed:
    fail = False

    def items(self):
        if self.fail:
            raise RuntimeError("feed down")
        return [
            {"id": "gh:a:1", "title": "CI", "state": "running", "startedAt": now - 1000, "detail": "push on fable/x", "secret": "nope"},
            {"id": "gh:a:2", "title": "Old", "state": "done", "startedAt": now - 3_600_000, "finishedAt": now - 3_000_000},
            {"id": "gh:a:3", "title": "Just done", "state": "failed", "startedAt": now - 60_000, "finishedAt": now - 5_000},
            {"title": "no id"}, "junk",
        ]


feed = Feed()
plugin_services.provide("axf.activity@1", feed, "some-folder")
r = c.get("/p/live").json()
ids = [i["id"] for i in r["items"]]
check(r["available"] is True and ids == ["gh:a:1", "gh:a:3"], "running + recently finished items; old finished and malformed ones dropped")
check("secret" not in r["items"][0] and r["items"][0]["detail"] == "push on fable/x", "only activity@1 fields are passed on")

plugin_services.configure(lambda folder: folder != "some-folder")
check(c.get("/p/live").json()["available"] is False, "feed provider switched off → treated as absent")
plugin_services.configure(lambda folder: True)

feed.fail = True
r = c.get("/p/live")
check(r.status_code == 200 and r.json()["items"] == [] and "feed down" in r.json()["error"], "a failing feed doesn't break the route")

check(all(m.methods <= {"GET", "HEAD"} for m in mod.router.routes), "read-only: GET routes only")
check({p: p.stat().st_mtime for p in (REPO / "framework" / "plan").glob("*.json")} == before, "nothing in framework/plan written")

manifest = json.loads((HERE / "plugin.json").read_text())
check(manifest["lifecycle"]["dataDir"] == ".axf-console/plugins/build-manager" and (HERE / "install.mjs").is_file() and (HERE / "uninstall.mjs").is_file(), "plugin-lifecycle@1: dataDir, install.mjs, uninstall.mjs")
check("service:axf.activity@1" in manifest["optional"], "activity feed declared optional (capability, not a folder)")
web = "\n".join(p.read_text() for p in (HERE / "web").glob("*.ts*"))
check("parent: 'plugins'" in web and "settingsTabs" in web, "settings only as a sub-tab of Settings → Plugins")
other = "activ" + "ity"  # spelled out so this test isn't itself a stale reference to that plugin
check(f"plugins/{other}" not in web and f"'{other}'" not in web, "never names the Activity plugin's folder")

node = subprocess.run(["node", str(HERE / "test.mjs")], capture_output=True, text=True, timeout=120)
print("\n".join("    " + ln for ln in node.stdout.strip().splitlines()[-3:]))
check(node.returncode == 0, f"merge/totals/live-link logic (test.mjs){'' if node.returncode == 0 else ': ' + (node.stdout + node.stderr)[-600:]}")
print(f"all {ok} checks passed")
