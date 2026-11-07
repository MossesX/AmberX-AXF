#!/usr/bin/env python3
"""Self-test for the API Browser's server part: the registry is made from the real code (framework/cli/api-registry.mjs),
cached until a source changes, one entry by id, coverage filters, settings validation.

    python3 apps/console-web/plugins/api-browser/test.py
"""
from __future__ import annotations

import importlib.util
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_API_BROWSER_DIR"] = tempfile.mkdtemp(prefix="axf-api-browser-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO, current_token=lambda: "t" * 32)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.api_browser_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


r = c.get("/p/registry").json()
s = r["summary"]
check(r["$axf"] == "api-registry@1" and s["entries"] > 500, f"the registry is made from the code ({s['entries']} paths)")
check(set(s["byGroup"]) >= {"control", "plugins", "mcp", "rest", "cli"}, "control@1, plugin commands, MCP tools, REST routes and the CLI are all in it")
ids = {e["id"] for e in r["entries"]}
check({"control/console.values/set", "control/console.elements/act/press", "plugins/console-terminal/type", "plugins/ui-review/decide"} <= ids, "the paths this build added are listed")
typ = next(e for e in r["entries"] if e["id"] == "plugins/console-terminal/type")
check(typ["policy"] == "veto" and typ["rest"]["path"] == "/api/control/console-terminal/type" and typ["mcp"] and typ["cli"] == "axf console-terminal type", "an entry carries policy and its REST, MCP and CLI names")
check(all(e["policy"] in ("instant", "veto", "confirm", "approve", "person") for e in r["entries"]), "every entry has a policy")
check(any(e["policy"] == "person" for e in r["entries"]), "Brett-only paths are marked as his tap")
check("coverage" not in r, "the registry answer leaves the coverage rows to their own route")
first = mod._cache["at"]
c.get("/p/registry")
check(mod._cache["at"] == first, "a second read comes from the cache")
c.get("/p/registry?refresh=1")
check(mod._cache["at"] > first, "refresh=1 makes it again")
e = c.get("/p/entry?id=control/console.values/set").json()
check(e["mcp"][:2] == ["control_set", "console_value"] and e["input"]["required"][:2] == ["op", "target"], "one entry by id, with its MCP shortcut and schema")
check(c.get("/p/entry?id=nope").status_code == 404, "an unknown id is 404")
cov = c.get("/p/coverage").json()
check(cov["summary"]["gap"] == 0 and cov["total"] == cov["summary"]["elements"], "coverage: every UI element, none without an API path")
check(all(x["status"] == "person-only" for x in c.get("/p/coverage?status=person-only").json()["items"]), "coverage filters by status")
check(c.get("/p/coverage?q=terminal%20screen").json()["total"] >= 1, "coverage filters by words")
st = c.get("/p/settings").json()
check(st["defaultView"] == "grid" and st["look"] == "api-browser-tabs" and st["tryWrites"] is True, "settings default to Grid, top tabs, Try it may run changes")
check(c.put("/p/settings", json={"defaultView": "coverage", "look": "api-browser-chips", "tryWrites": False}).json()["look"] == "api-browser-chips", "settings are saved")
check(c.get("/p/settings").json()["defaultView"] == "coverage", "…and read back")
check(c.put("/p/settings", json={"look": "neon"}).status_code == 400 and c.put("/p/settings", json={"defaultView": "map"}).status_code == 400, "unknown views and looks are refused")
for look in st["looks"]:
    check((HERE / "assets" / "tab-group" / f"{look}.json").exists(), f"look {look} ships as a tab-group asset")
print(f"all {ok} checks passed")
