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
import re
import os
import subprocess
import sys
from pathlib import Path
from typing import Any, Callable, Literal

import anyio
import contextvars
import time
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
Every Claude session calls `claude_session_start` first (when the Claude sessions plugin is on) and works as the crew agent
it answers; `claude_session_agent` says when Brett picks another, `claude_session_book` books the work on that agent's card.
At session start and before acting, read Claude settings (`claude_settings_get`) and follow them.
Start with `overview`, then `build_next` to see what to build next and which model should build it.
Before starting any build, check `pending_list`: builds parked until their model (usually Fable) is available.
Builds over 30 minutes are split into steps of 30 minutes or less: `pending_steps` / `build_queue` list them, and you tick
one off with `pending_change(action="step", …)` or `build_steps(index=…, done=True)` as you finish it.
Model policy (framework/core/model-policy.mjs): Opus or Fable only, never Sonnet or Haiku. Fable 5.1 for foundation
work (kernel internals, porting, cross-port contracts, schemas, heavy refactors); Opus 5.5 for everything else.
Model switches: a downgrade (Fable → Opus) is fine. An UPGRADE (Opus → Fable) waits for Brett only while his Claude
setting "Fable upgrades need my approval" is on (`node framework/cli/upgrade-policy.mjs`; off by default since Nov 4
2026: a step that needs Fable is set to Fable and runs). While it is on: stop at it and ask (orchestrator.mjs
request-upgrade); never approve one yourself.
When you finish building a step, call `build_step` with action "complete": the epic and its linked features are
marked built in the feature tracker, and steps that depended on it are re-checked for rework.
After reordering with `build_reorder`, call `build_reprocess` (apply=false to preview, then apply=true).
Chat and voice sessions (claude.ai, Amber): whenever you act, post one short line of what you are saying or doing with
`console_session_note` (same `session` name every time, your claude.ai link as `url` when you know it). Brett watches it
live in the Terminal's sessions nav and jumps in from there.

Follow Amber: check `console_follow`; while it is on, call `console_show` every time you mention something in Brett's
console (a screen, settings tab, dialog, build, plugin, UI Review item), and his approvals pop up in the console."""


def _compact(f: dict[str, Any]) -> dict[str, Any]:
    keys = ("id", "title", "kind", "status", "area", "priority", "wave", "effort", "model", "epic", "parent")
    return {k: f[k] for k in keys if f.get(k) not in (None, "")}


def _minutes(text: Any) -> int:
    """Minutes in an estimate string ("45 min", "2 h", "1.5 d"); 0 when it isn't one (mirrors pending-core estimateMinutes)."""
    m = re.match(r"^\s*~?\s*(\d+(?:[.,]\d+)?)\s*(min|mins|minute|minutes|m|h|hr|hrs|hour|hours|d|day|days)\b", str(text or ""), re.I)
    if not m:
        return 0
    n = float(m.group(1).replace(",", "."))
    u = m.group(2).lower()
    return round(n * (480 if u.startswith("d") else 60 if u.startswith("h") else 1))


_PRICING_FILE = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parent.parent.parent.parent)) / "framework" / "schemas" / "model-pricing.json"


def _minute_usd(model: Any) -> float | None:
    """USD of one working minute on a model: the per-minute heuristic in model-pricing.json priced with the model's
    token prices (mirrors pending-core minuteCostUsd). Estimates are shown in dollars, never tokens (Oct 23 2026)."""
    try:
        doc = json.loads(_PRICING_FILE.read_text())
    except (OSError, ValueError):
        return None
    key = next((k for k in ("fable", "opus", "sonnet", "haiku") if k in str(model or "").lower()), "")
    p = (doc.get("models") or {}).get(key)
    if not p or p.get("input") is None or p.get("output") is None:
        return None
    t = (doc.get("heuristic") or {}).get("tokensPerMinute") or {"input": 5000, "output": 3000, "cacheRead": 300000, "cacheWrite": 0}
    return (t.get("input", 0) * p["input"] + t.get("output", 0) * p["output"]
            + t.get("cacheRead", 0) * p.get("cacheRead", p["input"]) + t.get("cacheWrite", 0) * p.get("cacheWrite", p["input"])) / 1e6


def _usd(model: Any, minutes: Any) -> float | None:
    m = _minute_usd(model)
    return None if m is None or not isinstance(minutes, (int, float)) or minutes < 0 else round(m * minutes, 2)


def _step(s: dict[str, Any], features: bool = True, steps: bool = True) -> dict[str, Any]:
    out = {k: s.get(k) for k in ("position", "id", "title", "state", "status", "model", "modelLabel", "modelReason", "ready", "progress", "violations", "rework", "completedAt",
                                 "estimate", "stepsDone", "minutesLeft", "needsSplit")}
    out["costLeftUsd"] = _usd(s.get("model"), s.get("minutesLeft"))
    out["deps"] = [f"{d['id']} ({d['status']})" for d in s.get("deps", [])]
    if features:
        out["features"] = [f"{f['id']} [{f['status']}, {f.get('model', 'opus')}] {f['title']}" for f in s.get("features", [])]
    small = s.get("steps") or []
    if steps and small:
        # the small steps (≤ 30 min each) a big step is worked on in — tick them off with build_steps(index=…, done=True)
        out["steps"] = [{"index": i, "text": x.get("text"), "estimate": x.get("estimate"), "done": bool(x.get("done")), "doneAt": x.get("doneAt")} for i, x in enumerate(small)]
    elif steps:
        out["steps"] = len(small)
    if s.get("needsSplit") and s.get("splitReasons"):
        out["splitReasons"] = s["splitReasons"]
    return out


# Who is calling /mcp right now (the console's endpoint sets it from the request's X-Axhub-Session / client headers), so
# each tool call lands in that session's mirror feed in the Terminal's sessions nav.
CALLER: contextvars.ContextVar[str] = contextvars.ContextVar("axf_mcp_caller", default="")


def build_server(call: Call, *, terminal: Callable[[int], list[dict[str, Any]]] | None = None, control: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
                 console: Callable[[dict[str, Any]], dict[str, Any]] | None = None, notes: Callable[[dict[str, Any]], dict[str, Any]] | None = None,
                 on_call: Callable[[str, str, dict[str, Any], bool, str, int], None] | None = None) -> MCPServer:
    """Create the MCP server. `call(op, **args)` runs one engine op and returns its result dict; `control(command)` runs
    one control@1 command (framework/spec/CONTROL.md) and returns its answer (None = no control tools); `console(command)`
    runs one command of the console domain in the caller's open console (None = no console_* tools); `notes(line)` posts
    a line into a session's mirror feed (None = no console_session_note); `on_call(caller, tool, args, ok, error, ms)`
    is told about every tool call (the sessions nav's feed; never fails a call)."""
    mcp = MCPServer(name="amberx-axf", title="GizmoX AI Studio", version="0.2.0", instructions=INSTRUCTIONS,
                    website_url="https://console.amberxai.com")
    if on_call is not None:
        _watch_calls(mcp, on_call)

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
        """Framework status at a glance: plan counts by status, build queue progress, next step, rework, models, and every
        build in the builds store (all profiles: counts by status and profile, the running ones)."""
        fs = await features()
        qr = await run("build-queue")
        q = qr["view"]
        b = qr.get("builds") or {}
        by = lambda key, items: {k: sum(1 for x in items if x.get(key) == k) for k in sorted({str(x.get(key)) for x in items})}  # noqa: E731
        nxt = next((s for s in q["steps"] if s["id"] == q["next"]), None)
        return {
            "plan": {"features": len(fs), "byStatus": by("status", fs), "byModel": by("model", fs), "epics": by("status", [f for f in fs if f["kind"] == "epic"])},
            "buildQueue": {"steps": len(q["steps"]), "byState": q["counts"], "remainingByModel": q["byModel"], "violations": q["violations"], "rework": q["rework"], "needsReprocess": q["dirty"] or q["violations"] > 0},
            "next": _step(nxt) if nxt else None,
            "models": MODELS,
            "builds": {"profile": b.get("profile"), "total": b.get("total", 0), "byStatus": b.get("byStatus", {}), "activeInProfile": b.get("activeCount", 0),
                       "byProfile": b.get("byProfile", {}), "running": b.get("running", [])},
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
        qr = await run("build-queue")
        v, b = qr["view"], qr.get("builds") or {}
        steps = [s for s in v["steps"] if include_done or s["state"] not in ("done",)]
        return {"next": v["next"], "counts": v["counts"], "remainingByModel": v["byModel"], "minutesLeftByModel": v.get("minutesLeftByModel", {}),
                "costLeftByModelUsd": {m: _usd(m, n) for m, n in v.get("minutesLeftByModel", {}).items()},
                "unsplit": v.get("unsplit", []), "needsReprocess": v["dirty"] or v["violations"] > 0,
                "steps": [_step(s, features=False, steps=False) | {"features": len(s["features"]), "steps": len(s.get("steps") or [])} for s in steps],
                # the active profile's orchestrator builds with work left (a profile without plan epics has no queue steps)
                "builds": {"profile": b.get("profile"), "total": b.get("total", 0), "active": b.get("active", []), "running": b.get("running", [])}}

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
    async def build_steps(id: str, estimate: str | None = None, steps: list[dict[str, Any]] | None = None, add_text: str = "", add_estimate: str = "",
                          index: int | None = None, done: bool | None = None, text: str = "", step_estimate: str | None = None,
                          remove_index: int | None = None) -> dict[str, Any]:
        """Build-time estimate and small steps of one build-queue step (rule: a build over 30 minutes is split into steps of
        30 minutes or less, each with its own estimate). estimate sets the step's build time ("45 min", "2 h", "1.5 d"; "" clears).
        steps replaces the small-step list ([{text, estimate?, done?}]); add_text (+ add_estimate) appends one; index with
        done=true/false ticks one off (text / step_estimate reword or re-estimate it); remove_index drops one. Indexes are 0-based."""
        edit: dict[str, Any] = {"id": id, "by": "mcp"}
        if estimate is not None:
            edit["estimate"] = estimate
        if steps is not None:
            edit["steps"] = steps
        if add_text:
            edit["add"] = {"text": add_text, "estimate": add_estimate}
        if index is not None:
            edit["index"] = index
            if done is not None:
                edit["done"] = done
            if text:
                edit["text"] = text
            if step_estimate is not None:
                edit["stepEstimate"] = step_estimate
        if remove_index is not None:
            edit["removeIndex"] = remove_index
        v = (await run("build-steps", **edit))["view"]
        s = next((x for x in v["steps"] if x["id"] == id), None)
        return {"step": _step(s) if s else None, "unsplit": v.get("unsplit", [])}

    @mcp.tool(annotations=WRITE)
    async def build_sync() -> dict[str, Any]:
        """Sync the feature tracker and the build queue both ways (the console does this when it starts)."""
        r = await run("build-sync", by="mcp")
        return {"log": r.get("log", []), "counts": r["view"]["counts"], "next": r["view"]["next"]}

    # ------------------------------------------------------------------ catalog, libraries, templates, projects

    @mcp.tool(annotations=READ)
    async def pending_list(sort: Literal["status", "added", "built"] = "status", status: str = "") -> dict[str, Any]:
        """The pending build list: builds parked until their model (usually Fable) is available. Check it before
        starting any build. Each item shows when it was added and, once complete, when it was built."""
        r = await run("pending")
        order = {"pending": 0, "unsafe": 1, "broken": 2, "failed": 3, "complete": 4}
        items = [i for i in r.get("items", []) if not status or i.get("status") == status]
        items.sort(key=lambda i: i.get("createdAt", ""), reverse=True)  # newest first breaks every tie (stable sorts)
        if sort == "status":
            items.sort(key=lambda i: order.get(i.get("status"), 9))
        elif sort == "built":
            items.sort(key=lambda i: i.get("builtAt", ""), reverse=True)  # ISO dates sort as text; unbuilt ("") land last
        for i in items:  # time left and its estimated cost in dollars (steps added up when every step has an estimate)
            steps = i.get("subPrompts") or []
            mins = [_minutes(x.get("estimate")) for x in steps]
            total = sum(mins) if steps and all(mins) else _minutes(i.get("estimate"))
            left = sum(n for n, x in zip(mins, steps) if not x.get("done")) if steps and all(mins) else (0 if i.get("status") == "complete" else total)
            i["minutesTotal"], i["minutesLeft"] = total, left
            i["costUsd"], i["costLeftUsd"] = _usd(i.get("model"), total), _usd(i.get("model"), left)
        return {"artifact": r.get("artifact"), "count": len(items), "items": items}

    @mcp.tool(annotations=WRITE)
    async def pending_change(action: Literal["add", "update", "status", "note", "sub", "step", "remove"], id: str = "", title: str = "",
                             detail: str | None = None, model: Literal["", "Fable", "Opus", "Sonnet"] = "",
                             status: Literal["", "pending", "unsafe", "complete", "failed", "broken"] = "", text: str = "", plan_id: str = "",
                             estimate: str | None = None, sub_estimates: list[str] | None = None, index: int | None = None, done: bool | None = None,
                             said: str = "") -> dict[str, Any]:
        """Change the pending build list. add needs title (model defaults to Fable); status marks unsafe/complete/failed/broken (unsafe = parked, needs design or review before anyone builds it)
        (complete stamps the built date); note and sub (sub prompt) need text; remove deletes the item. estimate = build time ("45 min", "2 h", "1.5 d") on the item
        (add/update) or on a sub prompt (sub); sub_estimates (update) sets one per existing sub prompt in order ("" clears).
        Sub prompts are the item's steps (rule: a build over 30 minutes is split into steps of 30 minutes or less, each with its own estimate):
        step with index (0-based) ticks one off (done=true/false) and may reword it (text) or re-estimate it (estimate, "" clears).
        said (add): Brett's exact words that asked for this build, verbatim and unedited (build-origin@1); a paraphrase goes in detail, never here."""
        change: dict[str, Any] = {"action": action, "source": "mcp"}
        if sub_estimates is not None:
            change["subEstimates"] = [str(x) for x in sub_estimates]
        for k, v in (("id", id), ("title", title), ("model", model), ("status", status), ("text", text), ("planId", plan_id)):
            if v:
                change[k] = v
        if estimate is not None and (estimate or action == "step"):
            change["estimate"] = estimate
        if detail is not None:
            change["detail"] = detail
        if said.strip() and action == "add":
            change["said"] = said
        if index is not None:
            change["index"] = index
        if done is not None:
            change["done"] = done
        r = await run("pending-act", change=change)
        return {"item": r.get("item"), "log": r.get("log", [])}

    @mcp.tool(annotations=READ)
    async def pending_steps(id: str) -> dict[str, Any]:
        """One pending build with its steps (sub prompts) numbered for pending_change(action="step", index=…): each step's text,
        estimate and whether it's done, plus the time left. Use it to pick the next small step of a parked build."""
        r = await run("pending")
        it = next((i for i in r.get("items", []) if i.get("id") == id), None)
        if not it:
            raise ToolError(f'No pending build "{id}". Use pending_list to find ids.')
        steps = it.get("subPrompts") or []
        total = sum(_minutes(s.get("estimate")) for s in steps)
        left = sum(_minutes(s.get("estimate")) for s in steps if not s.get("done"))
        return {"id": it["id"], "title": it["title"], "model": it.get("model"), "status": it.get("status"), "estimate": it.get("estimate"),
                "stepsDone": sum(1 for s in steps if s.get("done")), "minutesTotal": total, "minutesLeft": left,
                "costUsd": _usd(it.get("model"), total), "costLeftUsd": _usd(it.get("model"), left),
                "next": next((i for i, s in enumerate(steps) if not s.get("done")), None),
                "steps": [{"index": i, "text": s.get("text"), "estimate": s.get("estimate"), "done": bool(s.get("done")), "doneAt": s.get("doneAt")} for i, s in enumerate(steps)]}

    # ------------------------------------------------------------------ Standards: project manifests

    @mcp.tool(annotations=WRITE)
    async def orchestrator_upgrade_approve(build: str, phase: int, request: str = "") -> dict[str, Any]:
        """Brett approves a model UPGRADE (e.g. Opus → Fable) on one phase of a Build orchestrator build. axHub runs this
        only after Brett approves it there (policy confirm, never veto); a session asks with
        `orchestrator.mjs request-upgrade <build> <phase>`, sends this call once through axHub with its reason, and stops.
        Never call it directly: a Claude session, headless build or agent calling it is refused and changes nothing.
        Downgrades need no approval."""
        if not re.fullmatch(r"[a-z0-9][a-z0-9._-]{0,79}", build or "") or not (0 <= int(phase) < 200):
            raise ToolError("build is an orchestrator build id and phase its 0-based index")
        r = await anyio.to_thread.run_sync(lambda: upgrade_via_axhub(build, int(phase), request))
        if not r.get("ok"):
            raise ToolError(r.get("error") or "upgrade approval failed")
        return {"build": build, "phase": phase, "log": r.get("log", [])}

    @mcp.tool(annotations=READ)
    async def project_list() -> dict[str, Any]:
        """Every project in the repo with a manifest (project.manifest.json, project-manifest@1): its name (= its folder
        in the hub's /projects), repo, and whether it passes the Standards rules. No project is loaded or compiled
        without a valid manifest."""
        r = await run("projects")
        items = [{"dir": i["dir"], "name": (i.get("manifest") or {}).get("name"), "displayName": (i.get("manifest") or {}).get("displayName"),
                  "kind": (i.get("manifest") or {}).get("kind"), "repo": (i.get("manifest") or {}).get("repo"),
                  "ok": i["validation"]["ok"], "errors": i["validation"]["errors"], "warnings": i["validation"]["warnings"]} for i in r.get("items", [])]
        return {"rulesFile": r.get("rulesFile"), "count": len(items), "items": items}

    @mcp.tool(annotations=READ)
    async def project_rules() -> dict[str, Any]:
        """The project-manifest rules in force (managed in the Dev Console under Standards): id, title, severity,
        whether it is locked (always an error), and the check it runs. Read-only here."""
        r = await run("project-rules")
        rules = r.get("rules", {})
        return {"file": r.get("file"), "vocab": rules.get("vocab"), "knownKeys": rules.get("knownKeys"), "rules": rules.get("rules", [])}

    @mcp.tool(annotations=READ)
    async def project_validate(dir: str = ".", manifest: dict[str, Any] | None = None) -> dict[str, Any]:
        """Validate one project's manifest: `dir` = a folder in the repo, or pass `manifest` (an object) to check a
        draft before writing it."""
        r = await run("project-validate", **({"manifest": manifest} if manifest is not None else {"dir": dir}))
        return {"dir": r.get("dir"), "validation": r.get("validation")}

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
                       boilerplate: str = "", wrap_groups: bool = False, options: dict[str, Any] | None = None) -> dict[str, Any]:
        """Create a new AXF app from a template (optionally from a boilerplate, with libraries installed).
        Build options are the same --switches as the CLI (see build_options): wrap_groups=True is --wrap-groups
        (every section / group collapsible with a top-right toggle); `options` takes any option by flag name,
        e.g. {"wrap-groups": true}. Every option not given starts at its default (off)."""
        args: dict[str, Any] = {"name": name, "template": template, "libraries": libraries or []}
        if dir:
            args["dir"] = dir
        if boilerplate:
            args["boilerplate"] = boilerplate
        opts = dict(options or {})
        if wrap_groups:
            opts.setdefault("wrap-groups", True)
        if opts:
            args["options"] = opts
        return await run("init", **args)

    @mcp.tool(annotations=READ)
    async def build_options() -> dict[str, Any]:
        """The build option registry: every --switch a UI build accepts (flag, default, which asset token it sets)."""
        return await run("build-options")

    @mcp.tool(annotations=WRITE)
    async def app_options(dir: str, options: dict[str, Any] | None = None) -> dict[str, Any]:
        """Show (no options) or change build options on an existing AXF app, e.g. {"wrap-groups": "on"}; writes the asset tokens."""
        return await run("options", dir=dir, options=options or {})

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

    # ------------------------------------------------------------------ control@1 (Token control plugin): tokens, AmberX, planner

    if control is not None:
        _register_control_tools(mcp, control)

    # ------------------------------------------------------------------ console commands (Console commands plugin): load screens in the open console

    if console is not None:
        _register_console_tools(mcp, console)

    # ------------------------------------------------------------------ Claude settings (Claude plugin, claude-settings@1)

    _register_claude_settings_tools(mcp)
    _register_expenses_tools(mcp)

    # ------------------------------------------------------------------ session mirror (Terminal → sessions nav)

    if notes is not None:
        _register_session_tools(mcp, notes)

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


# ---------------------------------------------------------------------- model upgrades (Nov 3 2026)

ORCH_CLI = Path(__file__).resolve().parents[1] / "plugins" / "build-orchestrator" / "orchestrator.mjs"


def upgrade_via_axhub(build: str, phase: int, request: str = "") -> dict[str, Any]:
    """Record Brett's axHub approval of an upgrade in the orchestrator (framework/core/model-switch.mjs). The CLI still
    refuses when this process runs inside a Claude session, headless build or agent (the local stdio server under Claude
    Code), so only the console server, called by axHub after Brett's approval, records it."""
    env = {k: v for k, v in os.environ.items() if k not in ("AXF_APPROVER", "AXF_APPROVER_VIA")}
    env.update(AXF_APPROVER=f"brett (axHub approval{' ' + request[:60] if request else ''})", AXF_APPROVER_VIA="axhub", AXF_ACTOR="axhub-approval")
    change = {"action": "approve", "id": build, "phase": phase}
    p = subprocess.run(["node", str(ORCH_CLI), "act", json.dumps(change), "--json"], cwd=ORCH_CLI.parents[4], capture_output=True, text=True, timeout=60, env=env)
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "error": p.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "error": (p.stderr or p.stdout).strip()[-600:]}


# ---------------------------------------------------------------------- Claude settings (claude-settings@1)

CLAUDE_SETTINGS_CLI = Path(__file__).resolve().parents[1] / "plugins" / "claude-settings" / "claude-settings.mjs"


def _claude_settings(*args: str) -> dict[str, Any]:
    """One claude-settings.mjs command (the same core the console and the CLI use). Never an owner: no MCP call can
    change an owner-only setting, whoever makes it."""
    if not CLAUDE_SETTINGS_CLI.exists():
        return {"ok": False, "code": "unavailable", "message": "the Claude plugin (claude-settings) is not installed"}
    try:
        p = subprocess.run(["node", str(CLAUDE_SETTINGS_CLI), *args, "--json"], cwd=CLAUDE_SETTINGS_CLI.parents[4], capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": str(e)[:200]}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def _register_claude_settings_tools(mcp: MCPServer) -> None:
    async def go(*args: str) -> dict[str, Any]:
        r = await anyio.to_thread.run_sync(lambda: _claude_settings(*args))
        if not r.get("ok"):
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        r.pop("ok", None)
        return r

    @mcp.tool(annotations=READ)
    async def claude_settings_get(key: str = "") -> dict[str, Any]:
        """Claude settings (kept on axHub, shared by every Claude session): read them at session start and before
        acting, and follow them. Every setting comes with its value, default, who may change it and a plain
        description: No wait (held calls run at once), Follow Amber, builds (default model, launch without asking,
        max parallel, budget caps), verification, talking (persona, tone, swearing, length, costs), notifications,
        memory. `key` = one setting only."""
        return await go("get", key) if key else await go("get")

    @mcp.tool(annotations=IDEMPOTENT)
    async def claude_settings_set(values: dict[str, Any], by: str = "") -> dict[str, Any]:
        """Change Claude settings that are not owner-only ({key: value}). Owner-only settings (No wait, Include
        irreversible, launch without asking, default model, UI Review gate, raising a budget cap or max parallel) are
        refused here: only Brett changes them, with his own click in the console (Settings → Plugins → Claude)."""
        pairs = [f"{k}={v if isinstance(v, str) else json.dumps(v)}" for k, v in (values or {}).items()]
        if not pairs:
            raise ToolError("invalid: send values as {key: value}")
        return await go("set", *pairs, "--by", by or "mcp")

    @mcp.tool(annotations=READ)
    async def claude_view_get(device: str = "") -> dict[str, Any]:
        """How the Claude settings page looks on one device: mode (classic | tabbed), tab position (top, bottom, left,
        right), labels (both, words, icons). Saved per device. Empty `device` lists every device."""
        return await go("view", "get", "--device", device) if device else await go("view", "devices")

    @mcp.tool(annotations=IDEMPOTENT)
    async def claude_view_set(device: str, values: dict[str, Any], by: str = "") -> dict[str, Any]:
        """Change the Claude settings view on one device. `values`: mode (classic | tabbed), position (top, bottom,
        left, right), labels (both, words, icons), tab. `claude_view_get` lists the devices."""
        pairs = [f"{k}={v}" for k, v in (values or {}).items()]
        if not pairs:
            raise ToolError("invalid: send values as {mode, position, labels, tab}")
        return await go("view", "set", *pairs, "--device", device, "--by", by or "mcp")

    @mcp.tool(annotations=READ)
    async def claude_policy_get() -> dict[str, Any]:
        """axHub's live tool policy: per service and tool, allow / veto / confirm / deny and the hold length. Read only:
        no session, token or tool can change it. Only Brett does, from his own hub session (Settings, Plugins, Claude,
        Approvals & veto)."""
        return await go("policy", "get")

    @mcp.tool(annotations=READ)
    async def claude_policy_plan_get() -> dict[str, Any]:
        """What Brett's default (hold only VPS writes and account switches, reads run at once) would change in axHub's
        live policy. Read only: only his click in the console applies it."""
        return await go("policy", "plan")


# ---------------------------------------------------------------------- Expenses (apps/expenses, /api/expenses/v1)

EXPENSES_URL = os.environ.get("EXPENSES_URL", "https://expenses.amberxai.com").rstrip("/") + "/api/expenses/v1"


def _expenses_token() -> str:
    """EXPENSES_API_TOKEN, else the file apps/expenses/deploy/install.sh writes next to the console's env
    (<AXF_ROOT>/.axf-console/expenses-api-token). Never logged or returned."""
    if os.environ.get("EXPENSES_API_TOKEN"):
        return os.environ["EXPENSES_API_TOKEN"].strip()
    root = Path(os.environ.get("AXF_ROOT") or Path(__file__).resolve().parents[3])
    f = root / ".axf-console" / "expenses-api-token"
    try:
        return f.read_text().strip()
    except OSError:
        return ""


def _expenses(method: str, path: str, query: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> Any:
    import urllib.error
    import urllib.parse
    import urllib.request
    token = _expenses_token()
    if not token:
        raise ToolError("unavailable: no Expenses API token (apps/expenses/deploy/install.sh writes it)")
    q = {k: str(v) for k, v in (query or {}).items() if v not in (None, "", 0)}
    url = EXPENSES_URL + path + ("?" + urllib.parse.urlencode(q) if q else "")
    req = urllib.request.Request(url, method=method, data=json.dumps(body).encode() if body is not None else None,
                                 headers={"authorization": f"Bearer {token}", "content-type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            text = r.read().decode()
            return json.loads(text) if "json" in (r.headers.get("content-type") or "") else {"text": text}
    except urllib.error.HTTPError as e:
        raise ToolError(f"expenses {e.code}: {e.read().decode()[:300]}") from None
    except (urllib.error.URLError, TimeoutError) as e:
        raise ToolError(f"unavailable: {str(e)[:200]}") from None


def _register_expenses_tools(mcp: MCPServer) -> None:
    async def go(method: str, path: str, query: dict[str, Any] | None = None, body: dict[str, Any] | None = None) -> Any:
        return await anyio.to_thread.run_sync(lambda: _expenses(method, path, query, body))

    def entry(**kw: Any) -> dict[str, Any]:
        return {k: v for k, v in kw.items() if v is not None}

    @mcp.tool(annotations=READ)
    async def expenses_list(date_from: str = "", date_to: str = "", category: str = "", account: str = "", kind: str = "", q: str = "", limit: int = 50) -> dict[str, Any]:
        """Expense Tracker entries (expenses.amberxai.com, Brett's ledger), newest first. Filters: dates YYYY-MM-DD,
        category, account (payment method, e.g. Discover), kind (expense|income), q (text in merchant / note / lines).
        Amounts are integer cents (totalCents) plus dollars (total)."""
        return await go("GET", "/entries", {"from": date_from, "to": date_to, "category": category, "account": account, "kind": kind, "q": q, "limit": limit})

    @mcp.tool(annotations=READ)
    async def expenses_get(entry_id: str) -> dict[str, Any]:
        """One Expense Tracker entry by id."""
        return await go("GET", f"/entries/{entry_id}")

    @mcp.tool(annotations=READ)
    async def expenses_accounts_list(date_from: str = "", date_to: str = "") -> dict[str, Any]:
        """Expense Tracker accounts (payment methods) with entry counts, spent and income in cents, and the last date."""
        return await go("GET", "/accounts", {"from": date_from, "to": date_to})

    @mcp.tool(annotations=READ)
    async def expenses_totals_get(date_from: str = "", date_to: str = "", category: str = "", account: str = "", by: str = "") -> dict[str, Any]:
        """Expense Tracker totals in cents: count, spent, income, net; by = category|account|month|merchant breaks it down."""
        return await go("GET", "/totals", {"from": date_from, "to": date_to, "category": category, "account": account, "by": by})

    @mcp.tool(annotations=READ)
    async def expenses_export_get(fmt: Literal["csv", "json"] = "csv", date_from: str = "", date_to: str = "") -> dict[str, Any]:
        """Export Expense Tracker entries as CSV text ({text}) or JSON ({entries})."""
        return await go("GET", "/export", {"format": fmt, "from": date_from, "to": date_to})

    @mcp.tool(annotations=WRITE)
    async def expenses_add(merchant: str, amount: float, date: str = "", category: str = "", account: str = "", note: str = "", income: bool = False) -> dict[str, Any]:
        """Add an Expense Tracker entry: merchant and amount in dollars; date YYYY-MM-DD (today when empty), category,
        account (payment method), note; income=true for money in. The ledger is backed up once a day before API writes."""
        return await go("POST", "/entries", body=entry(merchant=merchant, amount=amount, date=date or None, category=category or None,
                                                         account=account or None, note=note or None, kind="income" if income else None))

    @mcp.tool(annotations=WRITE)
    async def expenses_edit(entry_id: str, amount: float | None = None, merchant: str | None = None, date: str | None = None, category: str | None = None,
                            account: str | None = None, note: str | None = None, disputed: bool | None = None) -> dict[str, Any]:
        """Change fields of an Expense Tracker entry (only the ones given). amount in dollars. The API never deletes;
        deleting stays in the app."""
        return await go("PATCH", f"/entries/{entry_id}", body=entry(amount=amount, merchant=merchant, date=date, category=category, account=account,
                                                                      note=note, disputed=disputed))


# ---------------------------------------------------------------------- control@1 tools (framework/spec/CONTROL.md)

CONTROL_TARGETS = ("tokens.theme", "tokens.style", "tokens.layout", "tokens.typography", "tokens.density", "tokens.sizing", "tokens.look",
                   "tokens.custom", "tokens.slots", "amberx.items", "amberx.lists", "planner.plans", "planner.builds",
                   "console.screens", "console.dialogs", "console.settings", "console.actions", "console.nav", "console.clients", "pass.scopes",
                   "plugins.commands", "plugins.reads", "tokens.nav")
ControlTarget = Literal["tokens.theme", "tokens.style", "tokens.layout", "tokens.typography", "tokens.density", "tokens.sizing", "tokens.look",
                        "tokens.custom", "tokens.slots", "amberx.items", "amberx.lists", "planner.plans", "planner.builds",
                        "console.screens", "console.dialogs", "console.settings", "console.actions", "console.nav", "console.clients", "pass.scopes",
                        "plugins.commands", "plugins.reads", "tokens.nav"]
PassScope = Literal["all", "theme", "style", "layout", "tokens"]
# all = everything (the default since build pass-all); tokens = theme, style and layout together
PASS_SCOPE_IDS = {"all": "all", "theme": "tokens.theme", "style": "tokens.style", "layout": "tokens.layout", "tokens": "tokens.*"}
DESTRUCTIVE = ToolAnnotations(readOnlyHint=False, destructiveHint=True, idempotentHint=True, openWorldHint=False)
IDEMPOTENT = ToolAnnotations(readOnlyHint=False, destructiveHint=False, idempotentHint=True, openWorldHint=False)


def _register_control_tools(mcp: MCPServer, control: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    """The seven control_* tools (one per op, as controlTools() in control-rules.mjs projects them) plus amberx_* and
    plan_park shortcuts. A failure raises a ToolError with its wire code, except confirmation_required: that answer is
    returned as data so the caller sees the confirm token to send back."""

    async def go(command: dict[str, Any]) -> dict[str, Any]:
        command = {k: v for k, v in command.items() if v not in (None, "")}
        command.setdefault("by", "mcp")
        r = await anyio.to_thread.run_sync(lambda: control(command))
        if not r.get("ok") and r.get("code") != "confirmation_required":
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        return r

    @mcp.tool(annotations=READ)
    async def control_list(target: ControlTarget, select: dict[str, Any] | None = None) -> dict[str, Any]:
        """List the tokens of a token set (tokens.*: every id with its value now, the theme's own value and whether it is
        overridden) or the records of an AmberX / planner target. `select` filters: amberx.items kind, list, deep,
        status (open|doing|done|not-done), tag, q, pinned, starred, due (overdue|today|upcoming|later|none), limit;
        amberx.lists parent, q; planner.plans status, priority, category, tag, project, q, limit; planner.builds profile,
        status, category, q, includeHidden, limit."""
        return await go({"op": "list", "target": target, "select": select or None})

    @mcp.tool(annotations=READ)
    async def control_get(target: ControlTarget, path: str) -> dict[str, Any]:
        """One token (its value, the theme's value, unit, range) or one record by id."""
        return await go({"op": "get", "target": target, "path": path})

    @mcp.tool(annotations=IDEMPOTENT)
    async def control_set(target: ControlTarget, path: str, value: Any, by: str = "", reason: str = "") -> dict[str, Any]:
        """Set a token (an override in the axHub look: every app follows; tokens.slots = swap the active asset of a slot)
        or change a record's fields (value = an object of fields)."""
        return await go({"op": "set", "target": target, "path": path, "value": value, "by": by, "reason": reason})

    @mcp.tool(annotations=IDEMPOTENT)
    async def control_reset(target: ControlTarget, path: str = "", by: str = "", reason: str = "") -> dict[str, Any]:
        """Drop a token override (every override of the set when path is left out; tokens.slots needs a slot)."""
        return await go({"op": "reset", "target": target, "path": path, "by": by, "reason": reason})

    @mcp.tool(annotations=WRITE)
    async def control_add(target: ControlTarget, value: dict[str, Any], by: str = "", reason: str = "") -> dict[str, Any]:
        """Add a record: an AmberX note / to-do / task (value.kind, text, title, list, due, tags, priority, checklist,
        parent), a list (name, parent), a plan (title, summary, category…; parked unless status is given) or an
        orchestrator build (title, detail, category, steps [{text, model Fable|Opus, estimate}])."""
        return await go({"op": "add", "target": target, "value": value, "by": by, "reason": reason})

    @mcp.tool(annotations=DESTRUCTIVE)
    async def control_remove(target: ControlTarget, path: str, confirm: str = "", by: str = "", reason: str = "") -> dict[str, Any]:
        """Delete a record. Needs a confirm token: the first call answers confirmation_required with `confirm`; tell the
        user what will be deleted and call again with the same target and path plus that token within 10 minutes."""
        return await go({"op": "remove", "target": target, "path": path, "confirm": confirm, "by": by, "reason": reason})

    @mcp.tool(annotations=WRITE)
    async def control_act(target: ControlTarget, path: str, action: str, input: dict[str, Any] | None = None, by: str = "", reason: str = "") -> dict[str, Any]:
        """Run a verb on a record. amberx.items: done, undone, move {list}, merge {ids}, pin {on}, star {on},
        check {item, done}. amberx.lists: move {parent}, reorder {ids}, rename {name}. planner.plans: park,
        build {profile, buildId}, restore {version}, export {format json|md}, step {step, done}, comment {text}.
        planner.builds: step {step, done}, approve {phase}, status {status}, note {text}, rename {title},
        rename-step {step, title}, add-step {text, model, estimate, after}, edit-step {step, patch},
        skip-step {step, why}, remove-step {step, why}, move-step {step, to}, archive, hide, unhide
        (input.profile picks the build profile). pass.scopes (path all|tokens.theme|style|layout|*): grant {minutes,
        reason, include_irreversible} (a request Brett approves), revoke, undo; approve / deny only work from Brett's
        own session."""
        return await go({"op": "act", "target": target, "path": path, "action": action, "input": input or {}, "by": by, "reason": reason})

    # AmberX shortcuts (the same commands, named for what people ask)

    @mcp.tool(annotations=READ)
    async def amberx_find(q: str = "", kind: Literal["", "note", "todo", "task"] = "", list: str = "", status: Literal["", "open", "doing", "done", "not-done"] = "",
                          due: Literal["", "overdue", "today", "upcoming", "later", "none"] = "", limit: int = 50) -> dict[str, Any]:
        """Find AmberX notes, to-dos and tasks (every device's) by words, kind, list id, status or due bucket."""
        select = {k: v for k, v in {"q": q, "kind": kind, "list": list, "status": status, "due": due}.items() if v}
        select["limit"] = max(1, min(limit, 500))
        return await go({"op": "list", "target": "amberx.items", "select": select})

    @mcp.tool(annotations=WRITE)
    async def amberx_add(text: str, kind: Literal["note", "todo", "task"] = "note", title: str = "", list: str = "", due: str = "",
                         tags: list[str] | None = None, priority: Literal[0, 1, 2, 3] = 0) -> dict[str, Any]:
        """Add an AmberX note, to-do or task (it shows on every device). `list` = a list id (amberx.lists; Inbox when
        left out), `due` = YYYY-MM-DD, priority 0 none … 3 high."""
        value: dict[str, Any] = {"kind": kind, "text": text, "priority": priority}
        for k, v in (("title", title), ("list", list), ("due", due)):
            if v:
                value[k] = v
        if tags:
            value["tags"] = tags
        return await go({"op": "add", "target": "amberx.items", "value": value})

    @mcp.tool(annotations=IDEMPOTENT)
    async def amberx_update(id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Change an AmberX item's fields (title, text, summary, tags, pinned, starred, status, priority, due, checklist,
        list, parent, url)."""
        return await go({"op": "set", "target": "amberx.items", "path": id, "value": fields})

    @mcp.tool(annotations=IDEMPOTENT)
    async def amberx_done(id: str, done: bool = True) -> dict[str, Any]:
        """Tick an AmberX to-do or task done (or back to open with done=false)."""
        return await go({"op": "act", "target": "amberx.items", "path": id, "action": "done" if done else "undone", "input": {}})

    @mcp.tool(annotations=WRITE)
    async def amberx_move(id: str, list: str) -> dict[str, Any]:
        """Move an AmberX item (and its subtasks) to another list (id, or a list name: "groceries")."""
        return await go({"op": "act", "target": "amberx.items", "path": id, "action": "move", "input": {"list": list}})

    @mcp.tool(annotations=DESTRUCTIVE)
    async def amberx_remove(id: str, confirm: str = "") -> dict[str, Any]:
        """Delete an AmberX item (and its subtasks). First call answers confirmation_required with a token; confirm with
        the user, then call again with it."""
        return await go({"op": "remove", "target": "amberx.items", "path": id, "confirm": confirm})

    # Veto passes (control-pass@1, CONTROL.md → Veto passes): "allow everything for the next 30 minutes". pass_* are the
    # names; token_pass_* (build theme-veto-pass) stay as the same tools under their old names.

    async def pass_grant(scope: PassScope = "all", minutes: int = 30, reason: str = "", include_irreversible: bool = False, by: str = "") -> dict[str, Any]:
        """Ask for a timed veto pass. scope all (the default) = every command through the API, MCP or CLI on every
        plugin and every call axHub holds runs without the veto countdown, ordinary deletes without the confirm token;
        theme / style / layout / tokens = only token set / reset there. Irreversible deletes (AmberX hard deletes, tools
        axHub marks irreversible) still confirm unless include_irreversible (all only). This only files a request:
        Brett approves it once (console banner → Pass, or axHub's approval), never this tool. Minutes 1-240 (default
        30). Asking again for a scope with an active pass replaces it from the approval on. Tell Brett in one line that
        it is waiting."""
        inp: dict[str, Any] = {"minutes": minutes, **({"reason": reason} if reason else {}), **({"include_irreversible": True} if include_irreversible else {})}
        return await go({"op": "act", "target": "pass.scopes", "path": PASS_SCOPE_IDS[scope], "action": "grant", "input": inp, "by": by, "reason": reason})

    async def pass_status(scope: Literal["", "all", "theme", "style", "layout", "tokens"] = "") -> dict[str, Any]:
        """Which veto passes are on, until when, and any request waiting for Brett, in plain words ("Every command runs
        without veto until 10:42 AM"). No scope = every scope."""
        if scope:
            return await go({"op": "get", "target": "pass.scopes", "path": PASS_SCOPE_IDS[scope]})
        return await go({"op": "list", "target": "pass.scopes"})

    async def pass_revoke(scope: PassScope = "all", by: str = "", reason: str = "") -> dict[str, Any]:
        """End a veto pass now (and withdraw a waiting request for it): commands in the scope need the veto again."""
        return await go({"op": "act", "target": "pass.scopes", "path": PASS_SCOPE_IDS[scope], "action": "revoke", "input": {}, "by": by, "reason": reason})

    async def pass_undo(scope: PassScope = "all", by: str = "", reason: str = "") -> dict[str, Any]:
        """Roll back what the scope's latest pass changed that can be rolled back (every token goes back to what it was
        before the pass first touched it) and list what can't (`notUndoable`: AmberX, planner and other commands, each
        named). The pass itself stays as it is."""
        return await go({"op": "act", "target": "pass.scopes", "path": PASS_SCOPE_IDS[scope], "action": "undo", "input": {}, "by": by, "reason": reason})

    for fn, ann in ((pass_grant, WRITE), (pass_status, READ), (pass_revoke, IDEMPOTENT), (pass_undo, WRITE)):
        mcp.tool(annotations=ann)(fn)
        mcp.tool(name=f"token_{fn.__name__}", annotations=ann, description=f"Same as {fn.__name__} (old name). {fn.__doc__}")(fn)

    @mcp.tool(annotations=WRITE)
    async def plan_park(title: str, summary: str = "", category: str = "", body: str = "") -> dict[str, Any]:
        """"Put it in a plan for later": a parked Plan Studio plan (never a build; it becomes one only when Brett says)."""
        return await go({"op": "add", "target": "planner.plans", "value": {k: v for k, v in {"title": title, "summary": summary, "category": category, "body": body, "status": "parked"}.items() if v}})


# ---------------------------------------------------------------------- console commands (control@1 console domain)

CONSOLE_TOOLS = ("console_open", "console_dialog", "console_settings", "console_action", "console_back", "console_where", "console_list", "console_clients")
FOLLOW_TOOLS = ("console_show", "console_follow")  # Follow Amber plugin (follow-amber@1)
# Opening and moving only navigate, so they are annotated read-only: axHub's recommended preset (decision #112) runs
# read-only tools at once, and navigation never waits on a veto countdown (Brett, Nov 3 2026: Follow Amber).
NAVIGATE = ToolAnnotations(readOnlyHint=True, destructiveHint=False, idempotentHint=True, openWorldHint=False)
Delivery = str  # "recent" (the console used last), "all", or a client id from console_clients


def _register_console_tools(mcp: MCPServer, console: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    """The console_* tools (= CONSOLE_TOOLS in core/engines/console-commands.mjs): what a Claude session calls when Brett
    says "open Plan Studio". Each answer says what the open console did (`delivered`: per console ok + message) and how
    it got there (`delivery.how`: live, after reconnect, woke via AmberX, or queued). No console open: the command waits
    on the console server (up to a minute here, 2 minutes there by default) and AmberX opens the console on Brett's
    phone; `queued: true` = still waiting when this returned (it runs when a console opens). A failure raises a
    ToolError with its wire code, except confirmation_required (returned, so the token is seen)."""

    async def go(command: dict[str, Any]) -> dict[str, Any]:
        command = {k: v for k, v in command.items() if v not in (None, "", {})}
        command.setdefault("by", "mcp")
        r = await anyio.to_thread.run_sync(lambda: console(command))
        if not r.get("ok") and r.get("code") != "confirmation_required":
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        return r

    def inp(to: str, **more: Any) -> dict[str, Any]:
        d = {k: v for k, v in more.items() if v not in (None, "", [])}
        if to and to != "recent":
            d["to"] = to
        return d

    @mcp.tool(annotations=NAVIGATE)
    async def console_open(screen: str, to: Delivery = "recent") -> dict[str, Any]:
        """Open a screen in Brett's open Dev Console (the one he used last; to="all" for every open one, or a client id).
        `screen` = the view id ("plan-studio"), its title ("Plan Studio") or a few words ("plan studio", "builds",
        "orchestrator"); plugins' screens count. Not sure of the name? console_list(kind="screens", q="…") first."""
        return await go({"op": "act", "target": "console.screens", "path": screen, "action": "open", "input": inp(to)})

    @mcp.tool(annotations=NAVIGATE)
    async def console_dialog(dialog: str = "", arg: str = "", action: Literal["open", "close"] = "open", to: Delivery = "recent") -> dict[str, Any]:
        """Open a dialog in the open console by id, title or words (`arg` = the dialog's optional argument), or close
        one: action="close" shuts the dialog that is open (dialog="" or "current"), or only that dialog when it is the one open.
        Close what you opened once Brett has seen it."""
        if action == "close":
            return await go({"op": "act", "target": "console.dialogs", "path": dialog or "current", "action": "close", "input": inp(to)})
        return await go({"op": "act", "target": "console.dialogs", "path": dialog, "action": "open", "input": inp(to, arg=arg)})

    @mcp.tool(annotations=NAVIGATE)
    async def console_settings(tab: str, anchor: str = "", to: Delivery = "recent") -> dict[str, Any]:
        """Open a Settings tab or sub-tab in the open console: its id ("appearance"), "plugins/<plugin>" for a plugin's
        sub-tab under Settings → Plugins, or its title. `anchor` scrolls to one setting ("setting:<key>") or group."""
        return await go({"op": "act", "target": "console.settings", "path": tab, "action": "open", "input": inp(to, anchor=anchor)})

    @mcp.tool(annotations=WRITE)
    async def console_action(action: str, args: list[str] | None = None, confirm: str = "", to: Delivery = "recent") -> dict[str, Any]:
        """Run a registered action in the open console (menus, toolbar, search all use them): its id ("terminal.open"),
        a spec with arguments ("swap:color-theme:dark") or its label. Actions that only navigate run straight away; one
        that changes data needs the permission the action itself requires; one that deletes or resets answers
        confirmation_required with `confirm`: tell Brett what it will do, then call again with that token."""
        return await go({"op": "act", "target": "console.actions", "path": action, "action": "run", "input": inp(to, args=args or None), "confirm": confirm})

    @mcp.tool(annotations=NAVIGATE)
    async def console_back(move: Literal["back", "home", "close"] = "back", to: Delivery = "recent") -> dict[str, Any]:
        """Move the open console: back (closes an open dialog first, else the screen before), home, or close (the dialog)."""
        return await go({"op": "act", "target": "console.nav", "path": "here", "action": move, "input": inp(to)})

    @mcp.tool(annotations=READ)
    async def console_where() -> dict[str, Any]:
        """Where Brett's open console is now: screen, open dialog, settings tab, and which console that is."""
        return await go({"op": "get", "target": "console.nav", "path": "here"})

    @mcp.tool(annotations=READ)
    async def console_list(kind: Literal["screens", "dialogs", "settings", "actions"] = "screens", q: str = "", limit: int = 50) -> dict[str, Any]:
        """What the open console has, so you can pick the right name: its screens, dialogs, settings tabs or actions,
        best matches for `q` first (all of them when q is empty)."""
        return await go({"op": "list", "target": f"console.{kind}", "select": {k: v for k, v in {"q": q, "limit": max(1, min(limit, 500))}.items() if v}})

    @mcp.tool(annotations=READ)
    async def console_clients() -> dict[str, Any]:
        """The consoles open right now (one per browser tab: id, device, screen, last used). Commands go to the one
        used last unless `to` names another (or "all")."""
        return await go({"op": "list", "target": "console.clients"})

    async def follow(op: str, **args: Any) -> dict[str, Any]:
        r = await anyio.to_thread.run_sync(lambda: follow_call(op, args))
        if not r.get("ok"):
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        return r

    @mcp.tool(annotations=NAVIGATE)
    async def console_show(target: str, highlight: str = "", say: str = "", to: Delivery = "recent") -> dict[str, Any]:
        """Follow Amber: call this EVERY time you mention something in Brett's Dev Console (a screen, a settings tab, a
        dialog, a build, a plugin, a UI Review item, anything that needs him). When Follow Amber is on, his console opens
        it right away, focused and highlighted, with `say` as a note; when it's off this does nothing (shown: false).
        `target` = a screen, settings tab, dialog or navigation-only action by id, title or words ("plan studio",
        "plugins/<plugin>"), or kind:name (screen:, settings:, dialog:, action:, approval:<id> pops up a waiting
        axHub approval). `highlight` = a CSS selector or exact visible text to flash once it's open. Only navigates."""
        return await follow("show", target=target, highlight=highlight, say=say, to=to)

    @mcp.tool(annotations=READ)
    async def console_follow() -> dict[str, Any]:
        """Is Follow Amber on? {on, by, at, clients}. On: call console_show whenever you mention something in the
        console, and Brett's approvals pop up there. Only Brett switches it (in the console)."""
        return await follow("state")


def follow_call(op: str, args: dict[str, Any]) -> dict[str, Any]:
    """Follow Amber through its capability when the console runs; in stdio mode (a local clone) through the console's
    REST API (AXF_CONSOLE_URL + AXF_TOKEN), since only the console knows Brett's open browser tabs."""
    try:
        import plugin_services  # the console's registry (absent in stdio mode)
    except ImportError:
        plugin_services = None  # type: ignore[assignment]
    if plugin_services is not None:
        if not any(s["name"] == "follow-amber@1" for s in plugin_services.available()):
            return {"ok": False, "code": "not_implemented", "message": "no plugin provides follow-amber@1 (the Follow Amber plugin)"}
        svc = plugin_services.get("follow-amber@1")
        if svc is None:
            return {"ok": False, "code": "not_implemented", "message": "the Follow Amber plugin is turned off (Settings → Plugins)"}
        if op == "state":
            return {"ok": True, **svc.state()}
        return svc.show(str(args.get("target") or ""), "", str(args.get("highlight") or ""), str(args.get("say") or ""), str(args.get("to") or "recent"), "amber (mcp)")
    import urllib.error
    import urllib.request
    base = os.environ.get("AXF_CONSOLE_URL", "https://console.amberxai.com").rstrip("/") + "/api/plugins/follow-amber/"  # axf-plugin:follow-amber
    auth = {"authorization": f"Bearer {os.environ['AXF_TOKEN']}"} if os.environ.get("AXF_TOKEN") else {}
    req = (urllib.request.Request(base + "state", headers=auth) if op == "state" else
           urllib.request.Request(base + "show", data=json.dumps({**args, "by": "amber (mcp)"}).encode(), method="POST", headers={"content-type": "application/json", **auth}))
    try:
        with urllib.request.urlopen(req, timeout=30) as res:
            return json.loads(res.read().decode() or "{}")
    except urllib.error.HTTPError as e:
        return {"ok": False, "code": "unexpected", "message": f"{e.code} from {base}"}
    except (OSError, ValueError) as e:
        return {"ok": False, "code": "unexpected", "message": f"could not reach {base}: {str(e)[:200]}"}


def _watch_calls(mcp: MCPServer, on_call: Callable[[str, str, dict[str, Any], bool, str, int], None]) -> None:
    """Tell `on_call` about every tool call (who, which tool, its arguments, ok or the error, how long). Wraps the tool
    manager, so it sees exactly what MCPServer.call_tool runs; a failing listener never fails the call."""
    tm = mcp._tool_manager  # noqa: SLF001
    inner = tm.call_tool

    async def call_tool(name: str, arguments: dict[str, Any], *a: Any, **kw: Any) -> Any:
        t0, ok, err = time.monotonic(), True, ""
        try:
            return await inner(name, arguments, *a, **kw)
        except Exception as e:
            ok, err = False, str(e)[:200]
            raise
        finally:
            try:
                on_call(CALLER.get(), name, dict(arguments or {}), ok, err, int((time.monotonic() - t0) * 1000))
            except Exception:  # noqa: BLE001
                pass

    tm.call_tool = call_tool  # type: ignore[method-assign]


def _register_session_tools(mcp: MCPServer, notes: Callable[[dict[str, Any]], dict[str, Any]]) -> None:
    """console_session_note: a Claude session (claude.ai chat or voice, Claude Code) posts what it is saying or doing as
    one short line into its own mirror feed, which Brett watches in the Terminal's sessions nav (My sessions)."""

    @mcp.tool(annotations=WRITE)
    async def console_session_note(text: str, session: str, source: Literal["claude-ai-text", "claude-ai-voice", "claude-code", "agent", "other"] = "claude-ai-text",
                                   agent: str = "", url: str = "", title: str = "", model: str = "") -> dict[str, Any]:
        """Post one short line (what you are saying or doing right now) into your own session's live mirror in Brett's
        Dev Console (Terminal → sessions nav → My sessions). `session` = your chat's name, the same every time (e.g. the
        thread name); `url` = this chat's https://claude.ai/chat/… link when you know it (Jump in opens it); `agent` = the
        agent you speak as (agent-pick). Call it when you act: before an axHub call, a build, or a long answer. Free: no
        tokens are spent on the console's side."""
        line = {k: v for k, v in {"text": text, "session": session, "source": source, "agent": agent, "url": url, "title": title, "model": model}.items() if v}
        r = await anyio.to_thread.run_sync(lambda: notes(line))
        if not r.get("ok"):
            raise ToolError(str(r.get("error") or "could not post the note"))
        return r


def session_note_runner() -> Callable[[dict[str, Any]], dict[str, Any]]:
    """console_session_note through capability axf.session-feed@1 (the Terminal plugin) when the console runs. A local
    stdio clone has no session feed: the tool says so (chat sessions reach the console's /mcp through axHub)."""

    def run(line: dict[str, Any]) -> dict[str, Any]:
        try:
            import plugin_services  # the console's registry (absent in stdio mode)
        except ImportError:
            return {"ok": False, "error": "no session feed here: console_session_note works on the console's /mcp (through axHub), not a local stdio clone"}
        svc = plugin_services.get("axf.session-feed@1")
        if svc is None:
            return {"ok": False, "error": "no plugin provides axf.session-feed@1 (the Terminal plugin is off or not installed)"}
        try:
            text, session = line.pop("text"), line.pop("session")
            return svc.note(session, text, **line)
        except (KeyError, ValueError) as e:
            return {"ok": False, "error": str(e)}

    return run


def feed_recorder() -> Callable[[str, str, dict[str, Any], bool, str, int], None]:
    """Every console MCP tool call into its caller's mirror feed (axf.session-feed@1), when the Terminal plugin is on."""

    def rec(caller: str, tool: str, args: dict[str, Any], ok: bool, err: str, ms: int) -> None:
        import plugin_services
        svc = plugin_services.get("axf.session-feed@1")
        if svc is not None:
            svc.record_call(caller, tool, args, ok, err, ms)

    return rec


def console_runner(root: Path) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """Console commands through the capability when the console runs (its open consoles are there); in stdio mode
    (a local clone) they are sent to the console itself: AXF_CONSOLE_URL (default https://console.amberxai.com) with
    AXF_TOKEN, since only the console knows Brett's open browser tabs."""

    def remote(command: dict[str, Any]) -> dict[str, Any]:
        import urllib.error
        import urllib.request
        url = os.environ.get("AXF_CONSOLE_URL", "https://console.amberxai.com").rstrip("/") + "/api/console"
        req = urllib.request.Request(url, data=json.dumps({"$axf": "control@1", **command}).encode(), method="POST",
                                     headers={"content-type": "application/json", **({"authorization": f"Bearer {os.environ['AXF_TOKEN']}"} if os.environ.get("AXF_TOKEN") else {})})
        try:
            with urllib.request.urlopen(req, timeout=90) as res:  # a queued command waits up to a minute for a console
                return json.loads(res.read().decode() or "{}")
        except urllib.error.HTTPError as e:
            try:
                return json.loads(e.read().decode() or "{}")
            except ValueError:
                return {"ok": False, "code": "unexpected", "message": f"{e.code} from {url}"}
        except (OSError, ValueError) as e:
            return {"ok": False, "code": "unexpected", "message": f"could not reach {url}: {str(e)[:200]}"}

    def run(command: dict[str, Any]) -> dict[str, Any]:
        try:
            import plugin_services  # the console's registry (absent in stdio mode)
        except ImportError:
            return remote(command)
        if any(s["name"] == "console-commands@1" for s in plugin_services.available()):
            svc = plugin_services.get("console-commands@1")
            if svc is None:
                return {"ok": False, "code": "not_implemented", "message": "the Console commands plugin is turned off (Settings → Plugins)"}
            return svc.run(command, ["*"], str(command.get("by") or "mcp"))
        return {"ok": False, "code": "not_implemented", "message": "no plugin provides console-commands@1 (the Console commands plugin)"}

    return run


def control_runner(root: Path) -> Callable[[dict[str, Any]], dict[str, Any]]:
    """control@1 through the capability: the console's enabled provider (plugin_services) when the console runs, else
    (stdio against a clone) the runner of the plugin whose plugin.json provides service:control@1."""

    def local(command: dict[str, Any]) -> dict[str, Any]:
        for pj in sorted((root / "apps" / "console-web" / "plugins").glob("*/plugin.json")):
            try:
                m = json.loads(pj.read_text())
            except (OSError, ValueError):
                continue
            runner = pj.parent / "control.mjs"
            if "service:control@1" in (m.get("provides") or []) and runner.exists():
                p = subprocess.run(["node", str(runner), "run"], input=json.dumps({"command": command, "grants": ["*"], "by": command.get("by", "mcp")}),
                                   cwd=root, capture_output=True, text=True, timeout=120)
                lines = p.stdout.strip().splitlines()
                try:
                    return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-600:] or "no output"}
                except json.JSONDecodeError:
                    return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-600:]}
        return {"ok": False, "code": "not_implemented", "message": "no plugin provides control@1 (the Token control plugin)"}

    def run(command: dict[str, Any]) -> dict[str, Any]:
        try:
            import plugin_services  # the console's registry (absent in stdio mode)
        except ImportError:
            return local(command)
        if any(s["name"] == "control@1" for s in plugin_services.available()):
            svc = plugin_services.get("control@1")
            if svc is None:
                return {"ok": False, "code": "not_implemented", "message": "the Token control plugin is turned off (Settings → Plugins)"}
            return svc.run(command, ["*"], str(command.get("by") or "mcp"))
        return local(command)

    return run


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
    build_server(_local_call(root), control=control_runner(root), console=console_runner(root), notes=session_note_runner()).run()
