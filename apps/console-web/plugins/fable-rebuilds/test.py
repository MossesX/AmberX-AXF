"""Fable rebuilds self-test. Run: python3 apps/console-web/plugins/fable-rebuilds/test.py (scratch data dir, real engine)."""
from __future__ import annotations

import os
import shutil
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
scratch = Path(tempfile.mkdtemp(prefix="fable-test-"))
(scratch / "framework" / "plan").mkdir(parents=True)
shutil.copy(REPO / "framework" / "plan" / "pending.json", scratch / "framework" / "plan" / "pending.json")
os.environ["AXF_DATA_DIR"] = str(scratch)
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))
sys.path.insert(0, str(HERE.parent))

import console_context as cx  # noqa: E402
cx.set_context(ROOT=REPO)
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import importlib  # noqa: E402
mod = importlib.import_module("fable-rebuilds.server")
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


d = c.get("/p/items").json()
check(d["items"] and all(i["model"] == "Fable" for i in d["items"]), "only Fable items")
pm = next((i for i in d["items"] if i["id"] == "plugin-manager"), None)
check(pm is not None and pm["replaces"] and pm["replaces"]["folder"] == "plugin-manager" and "uninstall.mjs --all" in pm["replaces"]["uninstall"], "plugin-manager rebuild replaces the Opus plugin")
check(d["byPlugin"].get("plugin-manager") == "plugin-manager", "plugin → rebuild map for Plugin Manager rows")
check(any(k == "x.assets.designer" for k in d["byPlan"]), "plan feature → rebuild map for Plan hooks")
check(pm["branch"] == "fable/plugin-manager" and "fable/plugin-manager" in pm["brief"] and "uninstall.mjs --all" in pm["brief"] and "differences report" in pm["brief"], "brief carries the rules: uninstall first, branch, report")
check(c.get("/p/report/no-such-rebuild").status_code == 404 and c.get("/p/report/..%2Fx").status_code == 404, "no report yet / bad id → 404")
r = c.post("/p/park", json={"plugin": "theme-manager"})
check(r.status_code == 200 and r.json()["item"]["model"] == "Fable" and "uninstall.mjs --all" in r.json()["item"]["detail"], "park a plugin rebuild")
d2 = c.get("/p/items").json()
check(d2["byPlugin"].get("theme-manager") == "theme-manager-fable", "parked plugin now maps to its rebuild")
r = c.post("/p/park", json={"planId": "x.lib.media", "title": "Media library"})
check(r.status_code == 200 and r.json()["item"]["planId"] == "x.lib.media", "park a plan feature rebuild")
check(c.post("/p/park", json={"plugin": "nope-nope"}).status_code == 404, "unknown plugin refused")
check(c.post("/p/park", json={"planId": "../x"}).status_code == 400 and c.post("/p/park", json={}).status_code == 400, "bad plan id / nothing named refused")
check((REPO / "framework" / "plan" / "pending.json").read_text() == (REPO / "framework" / "plan" / "pending.json").read_text() and "theme-manager-fable" not in (REPO / "framework" / "plan" / "pending.json").read_text(), "the repo's pending list untouched (scratch data dir)")
print(f"all {ok} checks passed")
