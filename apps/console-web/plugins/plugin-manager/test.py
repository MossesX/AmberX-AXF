#!/usr/bin/env python3
"""Self-test for the Plugin Manager's server part (no console needed: fake plugins folder, table and services).

The Python engine (server/engine.py) must replay framework/spec/fixtures/plugin-inventory.json exactly, like the TS
reference (core/engines/plugins.ts) and the Kotlin port (PluginInventoryConformanceTest).

    python3 apps/console-web/plugins/plugin-manager/test.py

Checks the inventory (manifest fields, parts, data size, env set/unset without values, live services), dependency
details (required/optional services: ok / provider off / missing / not installed; env; scopes; framework API level;
console API), dependents, health, conflicts (duplicate id, two providers of one capability, shared data folder,
duplicate contribution, UI editors), logs filtering, file lists that skip symlinks, backup counting, and the routes
(through FastAPI's TestClient when it's installed).
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
SERVER = HERE / "server"
sys.path.insert(0, str(HERE.parent.parent / "server"))

# The server part is a package (relative imports of engine.py), loaded the way the console loads plugin parts.
pkg = sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins"))
pkg.__path__ = []  # type: ignore[attr-defined]
_sub = types.ModuleType("axf_console_plugins.plugin_manager")
_sub.__path__ = [str(SERVER)]  # type: ignore[attr-defined]
sys.modules["axf_console_plugins.plugin_manager"] = _sub
spec = importlib.util.spec_from_file_location("axf_console_plugins.plugin_manager.engine", SERVER / "engine.py")
eng = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = eng
spec.loader.exec_module(eng)
spec = importlib.util.spec_from_file_location("axf_console_plugins.plugin_manager.inventory", SERVER / "inventory.py")
inv = importlib.util.module_from_spec(spec)
assert spec and spec.loader
sys.modules[spec.name] = inv
spec.loader.exec_module(inv)
ROOT = HERE.parent.parent.parent.parent

passed = 0


def check(cond: bool, what: str) -> None:
    global passed
    if not cond:
        print(f"FAIL: {what}")
        sys.exit(1)
    passed += 1


def plugin(root: Path, folder: str, **m) -> Path:
    d = root / "apps" / "console-web" / "plugins" / folder
    (d / "web").mkdir(parents=True, exist_ok=True)
    (d / "web" / "index.tsx").write_text("export const plugin = {};\n")
    manifest = {"$axf": "plugin@1", "id": f"ai.test.{folder.replace('-', '')}", "name": folder.title(), "version": "1.0.0", "kind": "module",
                "apiLevel": 1, "targets": ["axf-console"], **m}
    (d / "plugin.json").write_text(json.dumps(manifest))
    return d


root = Path(tempfile.mkdtemp(prefix="axf-pm-test-"))
plugins = root / "apps" / "console-web" / "plugins"
llm = plugin(root, "llm", provides=["service:axf.llm@1", "view:llm"], lifecycle={"dataDir": ".axf-console/plugins/llm", "env": ["LLM_KEY", "LLM_OTHER"]},
             uiEditor=["theme"])
(llm / "server").mkdir()
(llm / "server" / "__init__.py").write_text("router = None\n")
(llm / "install.mjs").write_text("")
(llm / "uninstall.mjs").write_text("")
(llm / "test.py").write_text("")
agents = plugin(root, "agents", requires=["service:axf.llm@1"], optional=["service:axf.search@1"], provides=["service:axf.agents@1"], scopes=["ROUTES", "NETWORK"])
off = plugin(root, "needs-off", requires=["service:axf.off@1"])
offp = plugin(root, "off-provider", provides=["service:axf.off@1"], uiEditor=["theme"])
plugin(root, "missing", requires=["service:axf.nobody@1"], apiLevel=7)
plugin(root, "dup-a", provides=["view:same"], lifecycle={"dataDir": ".axf-console/plugins/dup-a"})
plugin(root, "dup-b", provides=["view:same"])
plugin(root, "twin", id="ai.test.agents")  # same id as agents
plugin(root, "bad-data", lifecycle={"dataDir": ".axf-console/plugins/llm"})  # outside its own folder
plugin(root, "wrong", targets=["android"])  # not for this console
plugin(root, "by-id", requires=["plugin:ai.test.llm"], optional=["plugin:ai.test.nobody"])
(plugins / "_template").mkdir()
(plugins / "_template" / "plugin.json").write_text("{}")
(plugins / "broken").mkdir()
(plugins / "broken" / "plugin.json").write_text("not json")

data = root / ".axf-console" / "plugins" / "llm"
data.mkdir(parents=True)
(data / "a.json").write_text("x" * 100)
(data / "sub").mkdir()
(data / "sub" / "b.json").write_text("y" * 50)
try:
    os.symlink("/etc/passwd", data / "link")
    os.symlink("/etc", llm / "etc-link")
except OSError:
    pass
backups = root / ".axf-console" / "plugin-backups"
backups.mkdir()
for n in ("llm-2026-10-18T10-00-00-000Z.tar.gz", "llm-2026-10-18T11-00-00-000Z.tar.gz", "llm-extra-2026.tar.gz"):
    (backups / n).write_text("")

table = {"llm": {"server": "loaded"}, "agents": {"server": "none"}, "broken": {"server": "error", "error": "ValueError: bad"}}
enabled = {"off-provider": False}
services = [{"name": "axf.llm@1", "folder": "llm", "enabled": True}, {"name": "axf.agents@1", "folder": "agents", "enabled": True}]
terminal = [
    {"at": 1, "channel": "plugins", "level": "info", "text": "llm loaded (router server)"},
    {"at": 2, "channel": "llm", "level": "error", "text": "provider timeout"},
    {"at": 3, "channel": "plugins", "level": "info", "text": "llm-extra loaded"},
    {"at": 4, "channel": "agents", "level": "info", "text": "agent ran"},
    {"at": 5, "channel": "llm:stream", "level": "warn", "text": "slow"},
]
env = {"LLM_KEY": "s3cret-value"}

out = inv.build_inventory(plugins, root, table, lambda f: enabled.get(f, True), services, terminal, env, backups)
items = {i["folder"]: i for i in out["items"]}

# inventory basics
check("_template" not in items, "templates are skipped")
check("broken" in items and items["broken"]["error"], "a broken manifest is listed with its error")
check(items["broken"]["health"] == "error", "broken plugin health is error")
L = items["llm"]
check(L["name"] == "Llm" and L["version"] == "1.0.0" and L["kind"] == "module", "manifest fields")
check(L["parts"]["web"] and L["parts"]["server"] and L["parts"]["install"] and L["parts"]["uninstall"] and L["parts"]["selfTest"], "parts detected")
check(not L["parts"]["hooks"], "missing hooks reported")
check(L["server"] == "loaded" and L["loaded"], "server status from the console table")
check(L["lifecycle"]["data"] == {"files": 2, "bytes": 150}, f"data size skips symlinks: {L['lifecycle']['data']}")
check(L["backups"] == 2, f"only this plugin's backups count: {L['backups']}")
check(L["env"] == [{"name": "LLM_KEY", "set": True}, {"name": "LLM_OTHER", "set": False}], "env reported as set/unset")
check("s3cret" not in json.dumps(out), "env values never leave the server")
check(L["services"] == ["axf.llm@1"], "live services per plugin")
check(L["logCount"] == 3 and L["lastLog"]["text"] == "slow", f"log lines from and about the plugin: {L['logCount']}")
check(L["uiEditor"] == ["theme"], "uiEditor field")
check(items["bad-data"]["lifecycle"]["dataDir"] is None and items["bad-data"]["lifecycle"]["dataDirProblem"], "dataDir outside its folder is refused")

# dependencies
A = items["agents"]
dep = {d["name"]: d for d in A["dependencies"]}
check(dep["axf.llm@1"]["status"] == "ok" and dep["axf.llm@1"]["required"], "required service satisfied")
check(dep["axf.llm@1"]["providers"][0]["folder"] == "llm", "provider named")
check(dep["axf.search@1"]["status"] == "optional-missing" and not dep["axf.search@1"]["required"], "optional service not installed")
check(dep["ROUTES"]["kind"] == "scope" and "routes" in dep["ROUTES"]["detail"], "scopes explained")
check(any(d["kind"] == "framework" and d["status"] == "ok" for d in A["dependencies"]), "API level ok")
check(A["health"] == "partial", f"optional missing → partial: {A['health']}")
O = items["needs-off"]
check({d["name"]: d for d in O["dependencies"]}["axf.off@1"]["status"] == "disabled", "provider switched off")
check(O["health"] == "blocked", "required provider off → blocked")
M = items["missing"]
mdep = {d["name"]: d for d in M["dependencies"]}
check(mdep["axf.nobody@1"]["status"] == "missing", "required service with no provider")
check(any(d["kind"] == "framework" and d["status"] == "unsupported" for d in M["dependencies"]), "unsupported API level")
check(M["health"] == "blocked", "missing required → blocked")
check(any(d["kind"] == "env" and d["name"] == "LLM_OTHER" and d["status"] == "unset" for d in L["dependencies"]), "env deps listed")
check(any(d["kind"] == "core" and d["status"] == "ok" for d in L["dependencies"]), "console API dep for server parts")
check(items["off-provider"]["health"] == "off", "switched-off plugin")
check(items["wrong"]["health"] == "blocked" and any(d["name"] == "target axf-console" and d["status"] == "unsupported" for d in items["wrong"]["dependencies"]), "a plugin not targeting the console is blocked")
bid = {d["name"]: d for d in items["by-id"]["dependencies"]}
check(bid["ai.test.llm"]["kind"] == "plugin" and bid["ai.test.llm"]["status"] == "ok" and bid["ai.test.nobody"]["status"] == "optional-missing", "plugin:<id> dependencies resolve by id")
check(any(d["folder"] == "by-id" and d["service"] == "plugin:ai.test.llm" for d in L["dependents"]), "a plugin:<id> dependency shows under Needed by")

# dependents
check([(d["folder"], d["required"]) for d in L["dependents"]] == [("agents", True), ("by-id", True)], f"llm is needed by agents and by-id: {L['dependents']}")
check(items["off-provider"]["dependents"][0]["folder"] == "needs-off", "dependents of a switched-off provider")
check(items["dup-b"]["dependents"] == [], "no dependents")

# conflicts
kinds = {(c["kind"], c["key"]): c for c in out["conflicts"]}
check(("plugin-id", "ai.test.agents") in kinds and kinds[("plugin-id", "ai.test.agents")]["severity"] == "error", "duplicate plugin id")
check(("contribution", "view:same") in kinds, "duplicate contribution")
check(("data-dir", ".axf-console/plugins/llm") not in kinds, "a refused dataDir isn't counted as shared")
check(("ui-editor", "theme") not in kinds, "only enabled editors clash (off-provider is off)")
enabled["off-provider"] = True
out2 = inv.build_inventory(plugins, root, table, lambda f: enabled.get(f, True), services, terminal, env, backups)
k2 = {(c["kind"], c["key"]): c for c in out2["conflicts"]}
check(("ui-editor", "theme") in k2 and k2[("ui-editor", "theme")]["severity"] == "info", "two enabled UI editors: info (last save wins)")
check("ui-editor:theme" in {i["folder"]: i for i in out2["items"]}["llm"]["conflicts"], "conflict ids on each plugin")
check(out["counts"]["total"] == len(out["items"]) and out["counts"]["errors"] >= 1, "counts")

# logs + files
lines = inv.logs_for(terminal, "llm", "Llm")
check([x["at"] for x in lines] == [1, 2, 5], f"logs: own channel, sub-channels and plugins-channel mentions only: {[x['at'] for x in lines]}")
check([x["at"] for x in inv.logs_for(terminal, "llm", "Llm", level="error")] == [2], "log level filter")
check(len(inv.logs_for(terminal * 400, "llm", limit=5)) == 5, "log limit")
files = [f["path"] for f in inv.file_list(llm)]
check("plugin.json" in files and "server/__init__.py" in files, "file list")
check(not any("etc-link" in f for f in files), "file list skips symlinks")
check(inv.FOLDER_RE.match("plugin-manager") and not inv.FOLDER_RE.match("../etc"), "folder pattern")

# the real plugins folder parses
real = HERE.parent
rout = inv.build_inventory(real, real.parent.parent.parent, {}, lambda f: True, [], [], {}, None)
check(any(i["folder"] == "plugin-manager" for i in rout["items"]), "real plugins folder parses (plugin-manager listed)")

# the shared engine replays the cross-port fixture exactly (plugin-inventory@1)
fixture = json.loads((ROOT / "framework" / "spec" / "fixtures" / "plugin-inventory.json").read_text())
check(fixture["frame"] == eng.FRAME and fixture["healths"] == eng.HEALTHS and fixture["dependencyLabels"] == eng.DEPENDENCY_LABEL, "fixture frame, healths, labels")
got = eng.build(fixture["records"], fixture["context"])
check(got == fixture["inventory"], "engine.build replays the fixture inventory (items, conflicts, counts)")
on = [{**r, "enabled": True} if r["folder"] == "off-provider" else r for r in fixture["records"]]
g2 = eng.build(on, fixture["context"])
check({"items": [{"folder": i["folder"], "health": i["health"], "conflicts": i["conflicts"]} for i in g2["items"]], "conflicts": g2["conflicts"], "counts": g2["counts"]} == fixture["enabledOffProvider"], "enabling the off provider matches the fixture")
check(eng.graph(fixture["inventory"]["items"], fixture["context"]["live"]) == fixture["graph"], "graph layout matches the fixture")
check(set(fixture["records"][0]) == set(eng.record()), "fixture records carry exactly the engine's record fields")
check(out.get("frame") == eng.FRAME and inv.context([])["target"] == "axf-console", "console inventory is plugin-inventory@1 for target axf-console")

# routes, when FastAPI is installed
try:
    from fastapi import FastAPI
    from fastapi.testclient import TestClient
except ImportError:
    print("(fastapi not installed: route checks skipped)")
else:
    import console_context as cx
    import plugin_services

    cx.set_context(ROOT=root, PLUGINS=table, plugin_enabled=lambda f: enabled.get(f, True), terminal_lines=lambda: terminal)
    plugin_services._services.clear()
    plugin_services.provide("axf.llm@1", object(), folder="llm")
    s2 = importlib.util.spec_from_file_location("axf_console_plugins.plugin_manager", SERVER / "__init__.py", submodule_search_locations=[str(SERVER)])
    mod = importlib.util.module_from_spec(s2)
    sys.modules["axf_console_plugins.plugin_manager"] = mod
    s2.loader.exec_module(mod)  # type: ignore[union-attr]
    app = FastAPI()
    app.include_router(mod.router, prefix="/api/plugins/plugin-manager")
    c = TestClient(app)
    r = c.get("/api/plugins/plugin-manager/inventory")
    check(r.status_code == 200 and any(i["folder"] == "llm" for i in r.json()["items"]), "GET /inventory")
    r = c.get("/api/plugins/plugin-manager/records")
    check(r.status_code == 200 and r.json()["frame"] == eng.FRAME and set(r.json()["records"][0]) == set(eng.record()), "GET /records: plain plugin-inventory@1 records + context for other ports")
    r = c.get("/api/plugins/plugin-manager/plugin/llm")
    check(r.status_code == 200 and r.json()["manifest"]["id"] == "ai.test.llm" and r.json()["files"], "GET /plugin/{folder}")
    check(c.get("/api/plugins/plugin-manager/plugin/nope").status_code == 404, "unknown plugin → 404")
    check(c.get("/api/plugins/plugin-manager/plugin/..%2Fetc").status_code in (400, 404), "bad folder refused")
    r = c.get("/api/plugins/plugin-manager/logs/llm?level=error")
    check(r.status_code == 200 and [x["at"] for x in r.json()["lines"]] == [2], "GET /logs/{folder}")
    check(c.get("/api/plugins/plugin-manager/logs/llm?level=bogus").status_code == 400, "bad level refused")

print(f"plugin-manager self-test: {passed} checks passed")
