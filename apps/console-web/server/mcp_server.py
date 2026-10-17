"""AXF MCP server — the Dev Console's API as Model Context Protocol tools, so Claude (Claude Code, Claude Desktop,
claude.ai connectors) can read and drive the framework's plan, build queue, libraries and projects.

Two ways to run it:

  remote   mounted by the console API at  https://console.amberxai.com/mcp  (streamable HTTP, Bearer AXF_TOKEN)
           claude mcp add --transport http axf https://console.amberxai.com/mcp --header "Authorization: Bearer $AXF_TOKEN"
  local    stdio against a local clone (no server needed); the repo's .mcp.json registers it for Claude Code
           python3 apps/console-web/server/mcp_server.py

Both call the same build engine (framework/cli/engine-rpc.mjs) the console uses, so a change made through MCP shows
up in the console (and in its output terminal) and the other way round.

Deliberately not exposed: shell or command execution, file reads/writes outside the engine's own operations, server
start/stop, secrets. Every write goes through an engine op that validates its input and stays inside the repo.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Literal

import anyio
from mcp.server.mcpserver import MCPServer
from mcp.server.mcpserver.exceptions import ToolError
from mcp.types import ToolAnnotations

Call = Callable[..., dict[str, Any]]

STATUSES = ("built", "partial", "in-progress", "placeholder", "planned", "blocked", "dropped")
MODELS = {"fable": "Fable 5.1 (claude-fable-5-1)", "opus": "Opus 5.5 (claude-opus-5-5)", "sonnet": "Sonnet 5.5 (claude-sonnet-5-5)"}
EDITABLE = {"title", "summary", "area", "group", "priority", "wave", "effort", "dependsOn", "capabilities", "acceptance", "warnings",
            "recommendations", "notes", "tags", "links", "modules", "files", "model", "modelReason", "status"}
READ = ToolAnnotations(readOnlyHint=True, destructiveHint=False, openWorldHint=False)
WRITE = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=False, openWorldHint=False)

INSTRUCTIONS = """AmberX AXF framework — plan, build queue, libraries and projects.
Start with `overview`, then `build_next` to see what to build next and which model should build it.
Model policy (top three models only): Fable 5.1 where the work needs the strongest reasoning (kernel internals,
porting, cross-port contracts, heavy refactors); Opus 5.5 for everything else; Sonnet 5.5 only where it is clearly
enough. Security-adjacent work (servers, shells, auth, deploy) stays on Opus.
When you finish building a step, call `build_step` with action "complete": the epic and its linked features are
marked built in the feature tracker, and steps that depended on it are re-checked for rework.
After reordering with `build_reorder`, call `build_reprocess` (apply=false to preview, then apply=true)."""


def _compact(f: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "title", "kind", "status", "area", "priority", "wave", "effort", "model", "epic", "parent")
    return {k: f[k] for k in keys if f.get(k) not in (None, "")}


def _step(s: dict[str, Any], features: bool = True) -> dict[str, Any]:
    out = {k: s.get(k) for k in ("position", "id", "title", "state", "status", "model", "modelLabel", "modelReason", "ready", "progress", "violations", "rework", "completedAt")}
    out["deps"] = [f"{d['id']} ({d['status']})" for d in s.get("deps", [])]
    if features:
        out["features"] = [f"{f['id']} [{f['status']}, {f.get('model', 'opus')}] {f['title']}" for f in s.get("features", [])]
    return out


def build_server(call: Call, *, terminal: Callable[[int], list[dict[str, Any]]] | None = None) -> MCPServer:
    """Create the MCP server. `call(op, **args)` runs one engine op and returns its result dict."""
    mcp = MCPServer(name="amberx-axf", title="AmberX AXF Dev Console", version="0.2.0", instructions=INSTRUCTIONS,
                    website_url="https://console.amberxai.com")

    async def run(op: str, **args: Any) -> dict[str, Any]:
        r = await anyio.to_thread.run_sync(lambda: call(op, **args))
        if not r.get("ok", True):
            raise ToolError(r.get("error") or f"{op} failed")
        r.pop("ok", None)
        return r

    async def features() -> list[dict[str, Any]]:
        return (await run("plan")).get("features", [])

    async def feature(fid: str) -> dict[str, Any]:
        f = next((x for x in await features() if x["id"] == fid), None)
        if not f:
            raise ToolError(f'No feature "{fid}" in the plan. Use plan_search to find ids.')
        return f

    # ------------------------------------------------------------------ overview + plan (feature tracker)

    @mcp.tool(annotations=READ)
    async def overview() -> dict[str, Any]:
        """Framework status at a glance: plan counts by status, build queue progress, next step, rework, models."""
        fs = await features()
        q = (await run("build-queue"))["view"]
        by = lambda key, items: {k: sum(1 for x in items if x.get(key) == k) for k in sorted({str(x.get(key)) for x in items})}  # noqa: E731
        nxt = next((s for s in q["steps"] if s["id"] == q["next"]), None)
        return {
            "plan": {"features": len(fs), "byStatus": by("status", fs), "byModel": by("model", fs), "epics": by("status", [f for f in fs if f["kind"] == "epic"])},
            "buildQueue": {"steps": len(q["steps"]), "byState": q["counts"], "remainingByModel": q["byModel"], "violations": q["violations"], "rework": q["rework"], "needsReprocess": q["dirty"] or q["violations"] > 0},
            "next": _step(nxt) if nxt else None,
            "models": MODELS,
        }

    @mcp.tool(annotations=READ)
    async def plan_search(query: str = "", status: str = "", area: str = "", kind: Literal["", "epic", "feature", "task"] = "",
                          model: Literal["", "fable", "opus", "sonnet"] = "", limit: int = 50) -> dict[str, Any]:
        """Search the feature tracker (448+ features). Filters combine; query matches id, title and summary."""
        q = query.lower().strip()
        hits = [f for f in await features()
                if (not q or q in f["id"].lower() or q in f["title"].lower() or q in (f.get("summary") or "").lower())
                and (not status or f["status"] == status) and (not area or area.lower() in (f.get("area") or "").lower())
                and (not kind or f["kind"] == kind) and (not model or f.get("model") == model)]
        return {"total": len(hits), "features": [_compact(f) for f in hits[: max(1, min(limit, 300))]]}

    @mcp.tool(annotations=READ)
    async def plan_feature(id: str) -> dict[str, Any]:
        """Everything about one feature: summary, ports, capabilities, dependencies, acceptance, warnings, model, history."""
        f = await feature(id)
        fs = await features()
        f = {k: v for k, v in f.items() if k not in ("screenshots",)} | {"screenshots": len(f.get("screenshots", []))}
        f["neededBy"] = [x["id"] for x in fs if id in x.get("dependsOn", [])]
        f["children"] = [x["id"] for x in fs if x.get("epic") == id or x.get("parent") == id]
        f["history"] = f.get("history", [])[-10:]
        return f

    @mcp.tool(annotations=WRITE)
    async def plan_set_status(id: str, status: Literal["built", "partial", "in-progress", "placeholder", "planned", "blocked", "dropped"], note: str = "") -> dict[str, Any]:
        """Set a feature's status in the feature tracker. The build queue syncs automatically
        (all features of a step built → step complete)."""
        f = await feature(id)
        r = await run("plan-upsert", feature={**f, "status": status}, note=note or f"Status → {status} (MCP)")
        return {"feature": _compact(r["feature"]), "log": r.get("log", [])}

    @mcp.tool(annotations=WRITE)
    async def plan_update(id: str, changes: dict[str, Any], note: str = "") -> dict[str, Any]:
        """Edit fields of a feature. Allowed keys: title, summary, area, group, priority (P0–P3), wave (1–3), effort (S/M/L/XL),
        dependsOn (ids), capabilities, acceptance ([{text, done}]), warnings ([{level, text}]), recommendations, notes, tags,
        links ([{label, url}]), modules, files, model (fable|opus|sonnet), modelReason, status."""
        bad = sorted(set(changes) - EDITABLE)
        if bad:
            raise ToolError(f"Not editable here: {', '.join(bad)}. Allowed: {', '.join(sorted(EDITABLE))}")
        if "status" in changes and changes["status"] not in STATUSES:
            raise ToolError(f"status must be one of {', '.join(STATUSES)}")
        if "model" in changes and changes["model"] not in MODELS:
            raise ToolError("model must be fable, opus or sonnet (only the top three models are used)")
        f = await feature(id)
        r = await run("plan-upsert", feature={**f, **changes}, note=note or f"Edited via MCP ({', '.join(changes)})")
        return {"feature": _compact(r["feature"]), "log": r.get("log", [])}

    @mcp.tool(annotations=WRITE)
    async def plan_add(id: str, title: str, area: str, summary: str = "", kind: Literal["epic", "feature", "task"] = "feature",
                       priority: Literal["P0", "P1", "P2", "P3"] = "P2", wave: int = 2, effort: str = "", depends_on: list[str] | None = None,
                       epic: str = "", model: Literal["", "fable", "opus", "sonnet"] = "") -> dict[str, Any]:
        """Add a new feature (or epic) to the plan. Leave model empty to get the suggested one. A new epic joins the build
        queue after its dependencies; call build_reprocess afterwards."""
        if any(f["id"] == id for f in await features()):
            raise ToolError(f'"{id}" already exists; use plan_update')
        f: dict[str, Any] = {"id": id, "title": title, "area": area, "kind": kind, "status": "planned", "priority": priority, "wave": wave, "effort": effort,
                             "summary": summary, "ports": {}, "capabilities": [], "dependsOn": depends_on or [], "catalog": [], "modules": [], "files": [],
                             "acceptance": [], "warnings": [], "recommendations": [], "previews": [], "screenshots": [], "links": [], "tags": [], "notes": "",
                             "source": "user", "history": []}
        if epic:
            f["epic"] = epic
        if model:
            f |= {"model": model, "modelReason": "Picked when added via MCP"}
        r = await run("plan-upsert", feature=f, note="Added via MCP")
        return {"feature": _compact(r["feature"])}

    # ------------------------------------------------------------------ build queue (build manager)

    @mcp.tool(annotations=READ)
    async def build_queue(include_done: bool = False) -> dict[str, Any]:
        """The build queue in build order: each step's state, suggested model (and why), dependencies, linked features,
        violations (runs before an unfinished dependency) and rework flags."""
        v = (await run("build-queue"))["view"]
        steps = [s for s in v["steps"] if include_done or s["state"] not in ("done",)]
        return {"next": v["next"], "counts": v["counts"], "remainingByModel": v["byModel"], "needsReprocess": v["dirty"] or v["violations"] > 0,
                "steps": [_step(s, features=False) | {"features": len(s["features"])} for s in steps]}

    @mcp.tool(annotations=READ)
    async def build_next() -> dict[str, Any]:
        """The next step to build: the first queued step whose dependencies are all built, with the model to use,
        its linked features, acceptance criteria and dependencies. Also lists steps flagged for rework."""
        v = (await run("build-queue"))["view"]
        s = next((x for x in v["steps"] if x["id"] == v["next"]), None)
        fs = {f["id"]: f for f in await features()}
        out: dict[str, Any] = {"next": None}
        if s:
            e = fs.get(s["id"], {})
            out["next"] = _step(s) | {"summary": e.get("summary"), "acceptance": e.get("acceptance", []), "files": e.get("files", []), "modules": e.get("modules", []),
                                      "recommendations": e.get("recommendations", []), "warnings": e.get("warnings", []), "useModel": MODELS.get(s["model"], s["model"])}
        out["rework"] = [_step(x, features=False) for x in v["steps"] if x.get("rework")]
        if v["dirty"] or v["violations"]:
            out["warning"] = "The queue order changed or breaks a dependency — run build_reprocess before building."
        return out

    @mcp.tool(annotations=WRITE)
    async def build_reorder(order: list[str]) -> dict[str, Any]:
        """Set the order of the remaining steps (ids from build_queue). Built steps keep their place. Marks the queue for
        reprocessing; steps placed before an unfinished dependency are reported as violations."""
        v = (await run("build-reorder", order=order, by="mcp"))["view"]
        return {"violations": [{"id": s["id"], "violations": s["violations"]} for s in v["steps"] if s["violations"]], "needsReprocess": True}

    @mcp.tool(annotations=WRITE)
    async def build_move(id: str, position: int) -> dict[str, Any]:
        """Move one step to a 1-based position in the queue (like drag and drop in the console)."""
        order = (await run("build-queue"))["view"]["order"]
        if id not in order:
            raise ToolError(f'No build step "{id}"')
        order.remove(id)
        order.insert(max(0, min(position - 1, len(order))), id)
        return await build_reorder(order)

    @mcp.tool(annotations=WRITE)
    async def build_reprocess(apply: bool = False) -> dict[str, Any]:
        """Re-sort the remaining steps so every step comes after its dependencies (your order wins where it can) and flag
        built steps that need rework. apply=false previews the moves; apply=true saves them."""
        r = await run("build-reprocess", apply=apply, by="mcp")
        p = r["proposal"]
        return {"applied": apply, "moves": p["moves"], "rework": p["rework"], "cycles": p["cycles"], "changed": p["changed"]}

    @mcp.tool(annotations=WRITE)
    async def build_step(id: str, action: Literal["start", "complete", "resolve-rework", "reopen", "status"],
                         status: Literal["", "built", "partial", "in-progress", "placeholder", "planned", "blocked", "dropped"] = "", note: str = "") -> dict[str, Any]:
        """Act on a build step. start → in-progress. complete → the epic and all its linked features are marked built in the
        feature tracker, and built steps that depend on it are flagged for rework. resolve-rework → clears the flag after
        refactoring (dependents get re-checked). reopen → back to planned (dependents flagged). status → set any status."""
        v = (await run("build-step", id=id, action=action, status=status or None, note=note or None, by="mcp"))["view"]
        s = next((x for x in v["steps"] if x["id"] == id), None)
        return {"step": _step(s) if s else None, "next": v["next"], "rework": [x["id"] for x in v["steps"] if x.get("rework")]}

    @mcp.tool(annotations=WRITE)
    async def build_sync() -> dict[str, Any]:
        """Sync the feature tracker and the build queue both ways (the console does this when it starts)."""
        r = await run("build-sync", by="mcp")
        return {"log": r.get("log", []), "counts": r["view"]["counts"], "next": r["view"]["next"]}

    # ------------------------------------------------------------------ catalog, libraries, templates, projects

    @mcp.tool(annotations=READ)
    async def tracker_summary() -> dict[str, Any]:
        """The catalog tracker (tracker.json) summary: built / partial / placeholder / planned per catalog tab."""
        t = await run("tracker")
        return {"generatedAt": t.get("generatedAt"), "summary": t.get("summary")}

    @mcp.tool(annotations=WRITE)
    async def catalog_set_status(id: str, status: Literal["built", "partial", "placeholder", "planned"], module: str = "", notes: str = "") -> dict[str, Any]:
        """Set a catalog feature's status (catalog/status.json); regenerates tracker.json and the plan, then syncs the build queue."""
        args: dict[str, Any] = {"id": id, "status": status}
        if module:
            args["module"] = module
        if notes:
            args["notes"] = notes
        return await run("status", **args)

    @mcp.tool(annotations=READ)
    async def libraries() -> dict[str, Any]:
        """Installable libraries (Android, web and Python ports) with their wizard parameters."""
        items = (await run("libraries")).get("items", [])
        return {"libraries": [{k: x.get(k) for k in ("id", "label", "port", "status", "description", "params")} for x in items]}

    @mcp.tool(annotations=READ)
    async def library_templates() -> dict[str, Any]:
        """Templates for new libraries (feature-screens, service-provider, data-feature, device-capability, integration,
        ui-kit, background-worker, blank) with their parameters and ports."""
        items = (await run("library-templates")).get("items", [])
        return {"templates": [{k: x.get(k) for k in ("id", "name", "category", "description", "params", "ports", "produces")} for x in items]}

    @mcp.tool(annotations=WRITE)
    async def library_new(name: str, template: str, ports: list[Literal["android", "web", "python"]], label: str = "", description: str = "",
                          params: dict[str, Any] | None = None, features: list[str] | None = None) -> dict[str, Any]:
        """Generate a new library from a template for the chosen ports (android → lib-<slug>, web → framework/libs/<slug>,
        python → framework/python/axf_libs/<slug>)."""
        return await run("new-library", name=name, template=template, ports=ports, label=label or None, description=description or None, params=params or {}, features=features or [])

    @mcp.tool(annotations=WRITE)
    async def library_compile(slug: str, ports: list[Literal["android", "web", "python"]] | None = None) -> dict[str, Any]:
        """Compile a generated library: tsc for web, compileall + import smoke test for Python; Android compiles in CI."""
        return await run("compile-library", slug=slug, ports=ports)

    @mcp.tool(annotations=WRITE)
    async def library_port(slug: str, to: Literal["android", "web", "python"]) -> dict[str, Any]:
        """Add another port to an existing generated library."""
        return await run("port-library", slug=slug, to=to)

    @mcp.tool(annotations=WRITE)
    async def library_install(dir: str, library: str, params: dict[str, Any] | None = None) -> dict[str, Any]:
        """Install a library into an AXF app (dir is relative to the repo) with its wizard parameters."""
        return await run("install", dir=dir, library=library, params=params or {})

    @mcp.tool(annotations=WRITE)
    async def app_init(name: str, template: Literal["react-ts", "next-ts", "android-compose"] = "react-ts", dir: str = "", libraries: list[str] | None = None,
                       boilerplate: str = "") -> dict[str, Any]:
        """Create a new AXF app from a template (optionally from a boilerplate, with libraries installed)."""
        args: dict[str, Any] = {"name": name, "template": template, "libraries": libraries or []}
        if dir:
            args["dir"] = dir
        if boilerplate:
            args["boilerplate"] = boilerplate
        return await run("init", **args)

    @mcp.tool(annotations=READ)
    async def app_validate(dir: str) -> dict[str, Any]:
        """Validate an AXF app's manifest, lock and assets."""
        return await run("validate", dir=dir)

    if terminal:
        @mcp.tool(annotations=READ)
        async def terminal_tail(since: int = 0, limit: int = 100) -> dict[str, Any]:
            """The console's output terminal (install, import, compile and build logs). `since` is a millisecond timestamp."""
            lines = [l for l in terminal(since)][-max(1, min(limit, 500)):]
            return {"lines": [f"[{l['channel']}] {l['level']}: {l['text']}" for l in lines], "last": lines[-1]["at"] if lines else since}

    # ------------------------------------------------------------------ resources + prompt

    @mcp.resource("axf://build-queue", name="build-queue", title="Build queue", mime_type="application/json",
                  description="The build queue (build order, states, models, rework).")
    async def build_queue_resource() -> str:
        return json.dumps((await run("build-queue"))["view"], indent=1)

    @mcp.resource("axf://plan", name="plan", title="Feature plan", mime_type="application/json", description="Every feature in the plan (compact).")
    async def plan_resource() -> str:
        return json.dumps([_compact(f) for f in await features()], indent=1)

    @mcp.prompt(name="build-next-step", title="Build the next step", description="Brief for building the next step in the queue with the right model.")
    async def build_next_prompt() -> str:
        n = (await build_next())["next"]
        if not n:
            return "The build queue has no ready step. Call build_queue to see what is blocked."
        return (f"Build step {n['position']}: {n['title']} ({n['id']}).\nSuggested model: {n['useModel']} — {n['modelReason']}.\n"
                f"If you are not running on that model, say so and ask the user to pick one of the top three models before starting.\n\n"
                f"Summary: {n.get('summary')}\nDependencies: {', '.join(n['deps']) or 'none'}\nFeatures in this step:\n"
                + "\n".join(f"- {x}" for x in n["features"])
                + "\nAcceptance:\n" + "\n".join(f"- [{'x' if a.get('done') else ' '}] {a.get('text')}" for a in n.get("acceptance", []))
                + f"\n\nWhen done: build_step(id='{n['id']}', action='start') before you begin and build_step(id='{n['id']}', action='complete') when it passes.")

    return mcp


# ---------------------------------------------------------------------- stdio (local clone)

def _local_call(root: Path) -> Call:
    rpc = root / "framework" / "cli" / "engine-rpc.mjs"

    def call(op: str, **args: Any) -> dict[str, Any]:
        p = subprocess.run(["node", str(rpc), op, json.dumps(args)], cwd=root, capture_output=True, text=True, timeout=600)
        lines = p.stdout.strip().splitlines()
        try:
            return json.loads(lines[-1]) if lines else {"ok": False, "error": p.stderr.strip()[-800:] or "no output"}
        except json.JSONDecodeError:
            return {"ok": False, "error": (p.stderr or p.stdout).strip()[-800:]}

    return call


if __name__ == "__main__":
    root = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[3])).resolve()
    if not (root / "framework" / "cli" / "engine-rpc.mjs").exists():
        sys.exit(f"AXF_ROOT {root} is not an AmberX AXF checkout")
    build_server(_local_call(root)).run()
