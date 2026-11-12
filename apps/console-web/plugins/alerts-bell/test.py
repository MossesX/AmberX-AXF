#!/usr/bin/env python3
"""Self-test for the Alerts bell plugin (its pure part replayed against the framework runtime with the
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
check((HERE / "server" / "__init__.py").exists() and not (HERE / "server" / "store.py").exists(), "server part: the alert hub as commands, nothing of its own stored")
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
    check(e["right"][-2:] == [f"action-button:alerts-bell@{ID}", f"counter:alerts-bell@{ID}"] and "clock:digital-12h@asset" in e["right"], "attached on the right, after the clock: bell, then the count")
    check(e["left0"] == [], "nothing on the left by default")
    check(len(e["left"]) == 2 and not any(k.endswith(ID) for k in e["rightAfterMove"]), "side setting moves both to the left")
    check(e["hidden"] == 0, "hidden: taken off the banner")
    check(e["fallbackSide"] == 2, "an unknown side falls back to the right")
    check(e["counter"] == ["", "5", "99+"], "count hidden at zero, 99+ past 99")
    check(e["badge"] == 7, "bound to the alerts library's counter alerts.unread")
    check(e["afterDetachAll"] == 0, "switching the plugin off (detachAll by plugin id) removes both")
    check(not e["toolbarBell"], "console-search toolbar no longer opens alerts")
    check(e["warnings"] == [], "no widget warnings from the runtime")

# ---- the server part (s9): the alerts hub as commands (feed, history, raise, read, dismiss, resolve, tapped)
import importlib.util  # noqa: E402
import sys  # noqa: E402
import tempfile  # noqa: E402

sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))
sys.path.insert(0, str(REPO / "framework" / "python"))
import alerts as A  # noqa: E402
import console_context as cx  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

spec = importlib.util.spec_from_file_location("alerts_bell_server", HERE / "server" / "__init__.py")
srv = importlib.util.module_from_spec(spec)
spec.loader.exec_module(srv)
app = FastAPI()
app.include_router(srv.router)
c = TestClient(app)
check(c.get("/feed").status_code == 503, "no hub: 503")
cx.set_context(alerts_hub=A.AlertHub(Path(tempfile.mkdtemp()), plugins={}))
r = c.post("/raise", json={"source": "fyi", "severity": "warning", "title": "Deploy done", "key": "fyi:deploy"}).json()
check(r["ok"] and r["alert"]["title"] == "Deploy done", "raise")
check(c.post("/raise", json={"title": "x", "link": "javascript:1"}).status_code == 400, "a bad link is refused")
check(c.post("/raise", json={"title": "x", "severity": "loud"}).status_code == 400, "a bad severity is refused")
aid = r["alert"]["id"]
f = c.get("/feed?device=pixel-9").json()
check(any(a["id"] == aid for a in f["alerts"]), "feed lists it")
check(c.get(f"/feed?since={f['version']}").json().get("unchanged") is True, "feed since: unchanged")
h = c.get("/history?device=pixel-9").json()
check(h["total"] == 1 and h["items"][0]["readAt"] is None, "history: delivered, unread")
check(c.post("/read", json={"ids": [aid], "device": "pixel-9"}).json()["historyMarked"] == 1, "read marks the history")
check(c.post("/tapped", json={"id": aid, "device": "pixel-9"}).json()["marked"] == 1, "tapped")
check(c.post("/dismiss", json={"ids": "x"}).status_code == 400, "dismiss needs a list")
check(c.post("/dismiss", json={"ids": [aid]}).json()["ok"], "dismiss")
check(c.post("/resolve", json={"keys": ["fyi:deploy"]}).json()["ok"], "resolve")
print(f"all {ok} checks passed")
