"""Creating projects from the console MCP: project_create / project_switch / project_delete call the engine ops with
the right arguments, carry the axHub policy (create and switch run for the owner, delete keeps the veto), and a
seeded project's to-dos are read back by the Todo manager's own store; the server's registry mirror keeps repo,
skin and seed.

    python3 apps/console-web/server/test_mcp_projects.py
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(ROOT / "framework" / "python"))
import mcp_server  # noqa: E402
import projects as pj  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    if not v:
        raise SystemExit(f"FAIL {what}")
    checks += 1


# ---- the tools, their annotations and policy
calls: list[tuple[str, dict]] = []


def fake(op: str, **a: object) -> dict:
    calls.append((op, a))
    return {"ok": True, "project": {"id": "garden"}, "active": "garden", "projects": [], "log": ["x"]}


server = mcp_server.build_server(fake)
tools = {t.name: t for t in asyncio.run(server.list_tools())}
for name in ("project_create", "project_switch", "project_delete"):
    ok(name in tools, f"{name} exists")
policy = lambda n: (tools[n].meta or {}).get(mcp_server.POLICY_META_KEY)  # noqa: E731
ok(policy("project_create") == "allow" and policy("project_switch") == "allow", "create and switch run without approval for the owner")
ok(policy("project_delete") == "confirm" and tools["project_delete"].annotations.destructive_hint is True, "delete keeps the owner's veto (destructive)")
ok(tools["project_create"].annotations.read_only_hint is False and tools["project_switch"].annotations.read_only_hint is False, "create and switch are writes")
schema = tools["project_create"].input_schema
ok(set(schema["properties"]) >= {"name", "repo", "skin", "seed", "description", "id", "select"}, "project_create takes name, repo, skin, seed")
ok(json.dumps(schema["properties"]["seed"]).count("demo") >= 1, "seed offers demo")

asyncio.run(server.call_tool("project_create", {"name": "Garden", "seed": "demo", "repo": "MossesX/garden", "skin": "atelier"}))
ok(calls[-1] == ("project-create", {"name": "Garden", "seed": "demo", "select": True, "by": "mcp", "repo": "MossesX/garden", "skin": "atelier"}), f"create → project-create ({calls[-1]})")
asyncio.run(server.call_tool("project_create", {"name": "Plain"}))
ok(calls[-1] == ("project-create", {"name": "Plain", "seed": "none", "select": True, "by": "mcp"}), "empty fields are left out; the caller is recorded")
asyncio.run(server.call_tool("project_switch", {"project": "garden"}))
ok(calls[-1] == ("project-switch", {"project": "garden"}), "switch → project-switch")
asyncio.run(server.call_tool("project_delete", {"project": "garden", "confirm": "garden"}))
ok(calls[-1] == ("project-delete", {"project": "garden", "confirm": "garden"}), "delete → project-delete with the typed id")
ok(set(mcp_server.PROJECT_OPS) == {"project-create", "project-switch", "project-delete"}, "the ops the console logs on the projects channel")


def failing(op: str, **a: object) -> dict:
    return {"ok": False, "error": 'type the project id (garden) to confirm deleting "Garden"'}


try:
    asyncio.run(mcp_server.build_server(failing).call_tool("project_delete", {"project": "garden"}))
    refused = ""
except mcp_server.ToolError as e:
    refused = str(e)
ok("confirm" in refused, "a refused delete fails with the reason")

# ---- the registry mirror keeps the new fields
reg = pj.normalize_registry({"projects": [{"id": "garden", "name": "Garden", "repo": "MossesX/garden", "skin": "atelier", "seed": "demo"},
                                          {"id": "bad", "name": "Bad", "repo": "no repo", "skin": "No Skin", "seed": "lots"}]})
g, bad = reg["projects"][1], reg["projects"][2]
ok(g["repo"] == "MossesX/garden" and g["skin"] == "atelier" and g["seed"] == "demo", "repo, skin and seed kept")
ok("repo" not in bad and "skin" not in bad and "seed" not in bad, "malformed ones dropped")

# ---- a seeded project's to-dos, read by the Todo manager's own store (scratch data; never the live hub)
tmp = Path(tempfile.mkdtemp(prefix="axf-mcp-projects-"))
pid = f"t-mcp-{os.getpid()}"
leak = ROOT / "_claude" / "builds" / "profiles" / pid
env = {**os.environ, "AXF_DATA_DIR": str(tmp / "data"), "AXHUB_PROJECTS_DIR": str(tmp / "hub"), "AXF_TODO_DIR": str(tmp / "todo"),
       "AXF_BUILDS_LIVE": "0", "AXF_BUILDS_EXPORT": "0", "AXF_ACTOR": "test_mcp_projects"}
env.pop("AXF_BUILD_PROFILE", None)
try:
    out = subprocess.run(["node", str(ROOT / "framework" / "cli" / "engine-rpc.mjs"), "project-create", json.dumps({"name": f"Seed {pid}", "id": pid, "seed": "demo"})],
                         cwd=ROOT, env=env, capture_output=True, text=True, timeout=240)
    r = json.loads(out.stdout.strip().splitlines()[-1])
    ok(r.get("ok") and r["seed"]["counts"]["todos"] == 10, f"engine create with seed ({r.get('error')})")
    spec = importlib.util.spec_from_file_location("todo_model_check", ROOT / "apps" / "console-web" / "plugins" / "todo-manager" / "server" / "model.py")
    model = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(model)
    store = model.Store(tmp / "todo" / "projects" / pid / "store.json")
    lists = store.lists()
    ok(len(lists) == 10, "Todo manager reads the seeded lists")
    by = {x["id"]: x for x in lists}

    def depth_of(x: dict) -> int:
        return 1 + (depth_of(by[x["parentId"]]) if x.get("parentId") in by else 0)

    depth = max(depth_of(x) for x in lists)
    ok(depth >= 3, f"lists nest 3+ levels ({depth})")
    ok(len(store.search(kind="todo")) == 10, "10 to-dos")
    ok(store.search(status="in_progress") and store.search(status="done") and store.search(status="open"), "open, doing and done to-dos")
    ok(all("demo-data" in e["tags"] for e in store.search()), "every to-do tagged demo-data")
    for e in store.search():
        good, errors, _ = model.validate_entry(e["kind"], e, store.types())
        ok(good, f"seeded to-do passes the Todo manager's rules: {e['title']} {errors}")
    made = store.create_entry({"listId": lists[0]["id"], "kind": "todo", "title": "added after", "checklist": [{"text": "x"}]})[0]
    ok(made["id"] > max(e["id"] for e in store.search() if e["id"] != made["id"]), "new entries get fresh ids after the seed")
finally:
    shutil.rmtree(tmp, ignore_errors=True)
    shutil.rmtree(leak, ignore_errors=True)

# ---- the Projects plugin: systems check item for axHub's policy, and its mark-done command (scratch ROOT)
import types  # noqa: E402

import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

scratch = Path(tempfile.mkdtemp(prefix="axf-projects-plugin-"))
try:
    cx.set_context(ROOT=scratch)
    plugin_dir = ROOT / "apps" / "console-web" / "plugins" / "project-switcher" / "server"
    sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
    spec = importlib.util.spec_from_file_location("axf_console_plugins.project_switcher_test", plugin_dir / "__init__.py", submodule_search_locations=[str(plugin_dir)])
    plug = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = plug
    spec.loader.exec_module(plug)

    class Reg:
        def __init__(self) -> None:
            self.got: dict = {}

        def register(self, spec: dict, owner: str = "") -> str:
            self.got = {**spec, "owner": owner}
            return spec["id"]

    reg = Reg()
    plugin_services.provide("axf.health@1", reg, "systems-check")
    ok(plug.ensure_health() and reg.got.get("id") == "projects-axhub-policy" and reg.got["owner"] == "project-switcher", "registers its systems check item")
    ok(any("project_create" in i and "Allow" in i for i in reg.got["instructions"]), "the item gives Brett the exact steps")
    ok(reg.got["run"]()["status"] == "warn", "amber until the policy is set")
    ok(plug.axhub_policy({"done": True})["check"]["status"] == "ok", "marked done → green")
    ok(reg.got["run"]()["status"] == "ok", "stays green")
    ok(plug.axhub_policy({"done": False})["check"]["status"] == "warn", "done false shows it again")
finally:
    shutil.rmtree(scratch, ignore_errors=True)

print(f"mcp projects: {checks} checks passed")
