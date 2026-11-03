"""Plugin commands (plugin-commands@1, the `plugins` domain of control@1; framework/spec/CONTROL.md).

Every plugin's commands and reads, made automatically from what it already has (its server routes, its registered
actions, its data folder, plugin.json `commands`), on every transport:

  REST   GET  /api/control/<plugin>/<read>        input as query parameters
         POST /api/control/<plugin>/<command>     input as the JSON body ({input?, by?, reason?, confirm?} or the fields)
         DELETE /api/control/<plugin>/<command>   a command that deletes (first call → confirmation_required + token)
         and every control@1 form: POST /api/control {op: act, target: plugins.commands|plugins.reads, path: <plugin>/<id>, …}
  MCP    <plugin>_<command> on the console's /mcp (and through axHub), annotations from the effect, plus plugin_commands,
         plugin_read and plugin_run; added and removed as plugins are installed, turned on or off, or removed
  CLI    axf <plugin> <command> [--field value]…, axf plugins [plugin]

The registry and the gate are the Node runner's (commands.mjs → framework/core/engines/plugin-commands.mjs); this
part runs what the runner plans: a route command as a real request to the console itself (the plugin's own auth and
checks apply, the console token is the caller after the gate), an action in the open console through the Console
commands plugin (console-commands@1). /api/plugins/plugin-commands/… serves the docs page.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import console_context as cx
import plugin_services

FOLDER = "plugin-commands"
RUNNER = Path(__file__).resolve().parents[1] / "commands.mjs"
ROOT = RUNNER.parents[4]
SCAN_ROOT = Path(os.environ.get("AXF_PLUGIN_COMMANDS_ROOT") or ROOT)  # where the plugins are read from (tests: fixtures)
HOMES = ("apps/console-web/plugins", "apps/amberx-droid/src/plugins", "apps/axhub-web/src/plugins")
PROXY_KEYS = ("by", "reason", "confirm", "input")
GENERIC_TOOLS = ("plugin_commands", "plugin_read", "plugin_run")
SYNC_SECONDS = 30
RESULT_MAX = 400_000

router = APIRouter()
_lock = threading.Lock()
_cache: dict[str, Any] = {"sig": None, "at": 0.0, "bundle": None}
_tools: dict[str, str] = {}  # MCP tool name -> registry signature it came from
_sync_lock = threading.Lock()


# ---------------------------------------------------------------------- the registry (Node runner, cached)

def _node(args: list[str], stdin: Any = None, timeout: int = 60) -> Any:
    p = subprocess.run(["node", str(RUNNER), *args], input=None if stdin is None else json.dumps(stdin), cwd=ROOT,
                       capture_output=True, text=True, timeout=timeout, env={**os.environ, "AXF_ROOT": str(SCAN_ROOT)})
    lines = p.stdout.strip().splitlines()
    if not lines:
        raise RuntimeError((p.stderr or "no output").strip()[-600:])
    try:
        return json.loads(p.stdout)
    except json.JSONDecodeError:
        return json.loads(lines[-1])


def _enabled() -> dict[str, bool]:
    return {f: bool(cx.plugin_enabled(f)) for f in (cx.PLUGINS or {})}


def _signature() -> str:
    """What the registry depends on: every plugin file's mtime and which plugins are on."""
    parts: list[str] = []
    for home in HOMES:
        d = SCAN_ROOT / home
        if not d.is_dir():
            continue
        for f in sorted(d.iterdir()):
            if not f.is_dir() or f.name.startswith(("_", ".")):
                continue
            for sub in ("plugin.json", "server", "web"):
                p = f / sub
                if p.is_file():
                    parts.append(f"{p}:{p.stat().st_mtime_ns}")
                elif p.is_dir():
                    for x in p.rglob("*"):
                        if x.is_file() and x.suffix in (".py", ".ts", ".tsx", ".mjs", ".js") and "__pycache__" not in x.parts:
                            parts.append(f"{x}:{x.stat().st_mtime_ns}")
    parts.append(json.dumps(_enabled(), sort_keys=True))
    return str(hash("\n".join(parts)))


def bundle(force: bool = False) -> dict[str, Any]:
    """{registry, tools} for the plugins as they are now (rebuilt when a plugin file or an on/off switch changed)."""
    with _lock:
        now = time.time()
        if not force and _cache["bundle"] is not None and now - _cache["at"] < 3:
            return _cache["bundle"]
        sig = _signature()
        if force or sig != _cache["sig"] or _cache["bundle"] is None:
            _cache["bundle"] = _node(["bundle"], {"enabled": _enabled()})
            _cache["sig"] = sig
        _cache["at"] = now
        return _cache["bundle"]


def registry() -> dict[str, Any]:
    return bundle()["registry"]


def is_plugin(folder: str) -> bool:
    return any(p["folder"] == folder and p["app"] == "console-web" for p in registry().get("plugins", []))


# ---------------------------------------------------------------------- running a command

def _http(method: str, path: str, query: dict[str, str], body: Any) -> dict[str, Any]:
    """The route, called on the console itself (loopback, the console token), or in-process when no server listens."""
    headers = {"content-type": "application/json"}
    tok = cx.current_token()
    if tok:
        headers["authorization"] = f"Bearer {tok}"
    data = None if body is None else json.dumps(body)
    try:
        import httpx
        base = os.environ.get("AXF_CONSOLE_INTERNAL_URL") or f"http://127.0.0.1:{os.environ.get('PORT', '7090')}"
        r = httpx.request(method, base + path, params=query, content=data, headers=headers, timeout=120)
    except Exception:  # noqa: BLE001 — no server listening (tests, a bare import): run it in-process
        app = getattr(cx, "asgi_app", None)
        if app is None:
            return {"status": 503, "message": "the console server is not reachable for plugin routes"}
        from starlette.testclient import TestClient
        r = TestClient(app, raise_server_exceptions=False).request(method, path, params=query, content=data, headers=headers)
    ctype = r.headers.get("content-type", "")
    if "json" in ctype:
        try:
            result: Any = r.json()
        except ValueError:
            result = r.text[:RESULT_MAX]
    elif ctype.startswith("text/") or not ctype:
        result = r.text[:RESULT_MAX]
    else:
        result = {"contentType": ctype, "bytes": len(r.content), "note": "binary answer: fetch the route itself to download it"}
    message = ""
    if r.status_code >= 400:
        message = (result.get("detail") if isinstance(result, dict) else str(result)[:300]) or f"{r.status_code}"
    return {"status": r.status_code, "result": result, "message": str(message)[:600]}


def _action(plan: dict[str, Any], grants: list[str], by: str, request: Request | None) -> dict[str, Any]:
    svc = plugin_services.get("console-commands@1")
    if svc is None:
        return {"ok": False, "code": "not_implemented", "message": "actions run in the open console through the Console commands plugin, which is off or missing"}
    d = plan["dispatch"]
    command = {"op": "act", "target": "console.actions", "path": d["action"], "action": "run", "by": by,
               "input": {k: v for k, v in (("args", d.get("args")), ("to", d.get("to"))) if v not in (None, "")}}
    if plan["command"].get("confirm"):
        command["confirm"] = plan["command"]["confirm"]
    # the plugin gate passed; the console then runs it under its own action policy as the signed-in user
    console_grants = ["*"] if "*" in grants else [*grants, "control.console.read", "control.console.navigate", "control.console.write"] + (["control.console.delete"] if plan.get("effect") == "destructive" else [])
    r = svc.run_for(request, command) if request is not None else svc.run(command, console_grants, by)
    if r.get("code") == "confirmation_required":
        # the plugin's own confirm already passed: send the console's token straight back
        command["confirm"] = r.get("confirm")
        r = svc.run_for(request, command) if request is not None else svc.run(command, console_grants, by)
    return {"ok": bool(r.get("ok")), "code": r.get("code"), "message": r.get("message", ""), "result": {k: v for k, v in r.items() if k not in ("$axf", "ok", "op", "target", "path", "action", "audit")}, "delivered": r.get("delivered")}


def run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", request: Request | None = None) -> dict[str, Any]:
    """One plugins.* control@1 command for a caller → the control@1 answer."""
    grants = grants if grants is not None else ["*"]
    command = {k: v for k, v in (command or {}).items() if v not in (None, "")}
    try:
        reg = registry()
    except Exception as e:  # noqa: BLE001
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": f"plugin registry: {e}"[:600]}
    try:
        plan = _node(["plan"], {"command": command, "grants": grants, "by": by, "enabled": _enabled(), "registry": reg})
    except Exception as e:  # noqa: BLE001
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": str(e)[:600]}
    if "dispatch" not in plan:
        return plan
    d = plan["dispatch"]
    who = plan["command"].get("by") or by or "unknown"
    if d["kind"] == "route":
        outcome = _http(d["method"], d["path"], d.get("query") or {}, d.get("body"))
    else:
        outcome = _action(plan, grants, who, request)
    if plan.get("effect") != "read":
        cx.log("plugins", f"{who}: {plan.get('name')} — {plan.get('title')} ({plan['command'].get('path')}) {'ok' if outcome.get('ok', 200 <= outcome.get('status', 200) < 300) else 'failed'}")
    return _node(["finish"], {"command": plan["command"], "outcome": outcome})


# ---------------------------------------------------------------------- REST: /api/control/<plugin>/<command>

def from_rest(method: str, command: dict[str, Any], query: dict[str, str], body: dict[str, Any] | None) -> dict[str, Any]:
    """A control@1 command the /api/control routes made from /api/control/<plugin>[/<command>] → the plugins.* command."""
    folder = str(command.get("target") or "")
    cid = str(command.get("path") or "")
    if command.get("op") == "reset":
        cid = "reset" if not cid else cid
    b = body if isinstance(body, dict) else {}
    extra = {k: b[k] for k in ("by", "reason", "confirm") if isinstance(b.get(k), str) and b[k]}
    if query.get("confirm"):
        extra["confirm"] = query["confirm"]
    if not cid:
        return {"op": "act", "target": "plugins.reads", "path": f"{folder}/info", "action": "read"}
    entry = next((p for p in registry().get("plugins", []) if p["folder"] == folder and p["app"] == "console-web"), None)
    cmd = next((c for c in (entry or {}).get("commands", []) if c["id"] == cid), None)
    q = {k: v for k, v in query.items() if k != "confirm"}
    if method == "GET":
        if cmd is not None and cmd["kind"] == "command":
            return {"op": "get", "target": "plugins.commands", "path": f"{folder}/{cid}"}
        for k, v in list(q.items()):
            try:
                q[k] = json.loads(v) if v[:1] in "[{" or v in ("true", "false") else v
            except ValueError:
                pass
        return {"op": "act", "target": "plugins.reads", "path": f"{folder}/{cid}", "action": "read", "input": q}
    if isinstance(b.get("input"), dict):
        inp = {**q, **b["input"]}
    elif method == "PUT" and "value" in b and len([k for k in b if k not in PROXY_KEYS]) == 1:
        inp = {**q, **(b["value"] if isinstance(b["value"], dict) else {"value": b["value"]})}
    else:
        inp = {**q, **{k: v for k, v in b.items() if k not in PROXY_KEYS}}
    return {"op": "act", "target": "plugins.reads" if cmd is not None and cmd["kind"] == "read" else "plugins.commands",
            "path": f"{folder}/{cid}", "action": "read" if cmd is not None and cmd["kind"] == "read" else "run", "input": inp, **extra}


# ---------------------------------------------------------------------- MCP tools, kept in step with the plugins

def _tool_fn(path: str, kind: str, run_cmd: Callable[[dict[str, Any]], dict[str, Any]]):
    import anyio
    from mcp.server.mcpserver.exceptions import ToolError

    async def tool(input: dict[str, Any] | None = None, by: str = "", reason: str = "", confirm: str = "") -> dict[str, Any]:
        command = {"op": "act", "target": "plugins.reads" if kind == "read" else "plugins.commands", "path": path,
                   "action": "read" if kind == "read" else "run", "input": input or {}, "by": by or "mcp", "reason": reason, "confirm": confirm}
        r = await anyio.to_thread.run_sync(lambda: run_cmd(command))
        if not r.get("ok") and r.get("code") != "confirmation_required":
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        return r
    return tool


def _generic(run_cmd: Callable[[dict[str, Any]], dict[str, Any]]) -> list[tuple[str, Any, str, dict[str, Any], dict[str, bool]]]:
    import anyio
    from mcp.server.mcpserver.exceptions import ToolError

    async def go(command: dict[str, Any]) -> dict[str, Any]:
        r = await anyio.to_thread.run_sync(lambda: run_cmd({k: v for k, v in command.items() if v not in (None, "")}))
        if not r.get("ok") and r.get("code") != "confirmation_required":
            raise ToolError(f"{r.get('code', 'unexpected')}: {r.get('message', 'failed')}")
        return r

    async def plugin_commands(plugin: str = "", q: str = "", kind: str = "", limit: int = 200) -> dict[str, Any]:
        sel = {k: v for k, v in (("plugin", plugin), ("q", q), ("limit", limit)) if v}
        if kind == "read":
            return await go({"op": "list", "target": "plugins.reads", "select": sel})
        if kind == "command":
            return await go({"op": "list", "target": "plugins.commands", "select": sel})
        reads = await go({"op": "list", "target": "plugins.reads", "select": sel})
        cmds = await go({"op": "list", "target": "plugins.commands", "select": sel})
        return {"ok": True, "reads": reads.get("items", []), "commands": cmds.get("items", []), "total": reads.get("total", 0) + cmds.get("total", 0)}

    async def plugin_read(path: str, input: dict[str, Any] | None = None) -> dict[str, Any]:
        return await go({"op": "act", "target": "plugins.reads", "path": path, "action": "read", "input": input or {}, "by": "mcp"})

    async def plugin_run(path: str, input: dict[str, Any] | None = None, confirm: str = "", by: str = "", reason: str = "") -> dict[str, Any]:
        return await go({"op": "act", "target": "plugins.commands", "path": path, "action": "run", "input": input or {}, "confirm": confirm, "by": by or "mcp", "reason": reason})

    read = {"readOnlyHint": True, "destructiveHint": False, "idempotentHint": True, "openWorldHint": False}
    return [
        ("plugin_commands", plugin_commands, "Every plugin's commands and reads (or one plugin's: plugin=<folder>; q filters; kind read|command). Each has a path <plugin>/<id> for plugin_read / plugin_run and its own <plugin>_<id> tool.", {}, read),
        ("plugin_read", plugin_read, "Read anything a plugin has: path <plugin>/<read> (plugin_commands lists them), input = its query.", {}, read),
        ("plugin_run", plugin_run, "Run any plugin command: path <plugin>/<command>, input = what it takes. One that deletes answers confirmation_required with a token: call again with confirm set to it.", {},
         {"readOnlyHint": False, "destructiveHint": True, "idempotentHint": False, "openWorldHint": False}),
    ]


def sync_mcp(force: bool = False) -> dict[str, int]:
    """Add the tools of plugins that are installed and on, remove the rest (and every tool while this plugin is off)."""
    mcp = getattr(cx, "mcp_server", None)
    if mcp is None:
        return {"added": 0, "removed": 0, "total": 0}
    from mcp.types import ToolAnnotations
    with _sync_lock:
        on = bool(cx.plugin_enabled(FOLDER)) and _settings().get("mcpTools", True) is not False
        want: dict[str, dict[str, Any]] = {}
        if on:
            b = bundle(force)
            if _settings().get("perPluginTools", True) is not False:
                want = {t["name"]: t for t in b["tools"]}
        added = removed = 0
        for name in [n for n in _tools if n not in want and n not in GENERIC_TOOLS]:
            try:
                mcp.remove_tool(name)
            except Exception:  # noqa: BLE001
                pass
            _tools.pop(name, None)
            removed += 1
        run_cmd = lambda c: run(c, ["*"], str(c.get("by") or "mcp"))  # noqa: E731 — the console's /mcp = the console token
        if on and not all(g in _tools for g in GENERIC_TOOLS):
            for name, fn, desc, _schema, ann in _generic(run_cmd):
                if name not in _tools:
                    mcp.add_tool(fn, name=name, title=name.replace("_", " ").capitalize(), description=desc, annotations=ToolAnnotations(**ann))
                    _tools[name] = "generic"
                    added += 1
        if not on:
            for name in [n for n in _tools if n in GENERIC_TOOLS]:
                try:
                    mcp.remove_tool(name)
                except Exception:  # noqa: BLE001
                    pass
                _tools.pop(name, None)
                removed += 1
        for name, t in want.items():
            stamp = json.dumps([t["description"], t["inputSchema"], t["annotations"]], sort_keys=True)
            if _tools.get(name) == stamp:
                continue
            if name in _tools:
                try:
                    mcp.remove_tool(name)
                except Exception:  # noqa: BLE001
                    pass
            mcp.add_tool(_tool_fn(f"{t['plugin']}/{t['command']}", t["kind"], run_cmd), name=name, title=t["title"], description=t["description"],
                         annotations=ToolAnnotations(**t["annotations"]))
            tool = mcp._tool_manager.get_tool(name)  # the schema the registry made (input = what the command takes)
            if tool is not None:
                tool.parameters = t["inputSchema"]
            _tools[name] = stamp
            added += 1
        return {"added": added, "removed": removed, "total": len(_tools)}


DATA_DIR = Path(os.environ.get("AXF_PLUGIN_COMMANDS_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
SETTINGS = {"mcpTools": True, "perPluginTools": True}


def _settings() -> dict[str, Any]:
    """The plugin's two switches (Settings → Plugins → Plugin commands): MCP tools at all, and one tool per command."""
    try:
        saved = json.loads((DATA_DIR / "settings.json").read_text())
    except (OSError, ValueError):
        saved = {}
    return {k: saved.get(k, v) if isinstance(saved.get(k, v), bool) else v for k, v in SETTINGS.items()}


def _loop() -> None:
    time.sleep(5)  # every plugin has loaded by now
    while True:
        try:
            r = sync_mcp()
            if r["added"] or r["removed"]:
                cx.log("plugins", f"plugin commands: {r['total']} MCP tools ({r['added']} added, {r['removed']} removed)")
        except Exception as e:  # noqa: BLE001 — never stops the console
            cx.log("plugins", f"plugin commands: MCP sync failed: {str(e)[:200]}", "error")
        time.sleep(SYNC_SECONDS)


if os.environ.get("AXF_PLUGIN_COMMANDS_SYNC", "1") != "0":
    threading.Thread(target=_loop, name="plugin-commands-sync", daemon=True).start()


# ---------------------------------------------------------------------- the plugin's own routes (docs page)

@router.get("/registry")
def get_registry() -> dict[str, Any]:
    """Every plugin with its commands and reads (the docs page)."""
    return registry()


@router.get("/tools")
def get_tools() -> dict[str, Any]:
    """The MCP tools the console publishes for plugins, and which are live right now."""
    return {"tools": bundle()["tools"], "live": sorted(_tools)}


@router.get("/audit")
def get_audit(n: int = 50) -> dict[str, Any]:
    """The last plugin commands run (who, which, when, how it went)."""
    try:
        return {"items": _node(["audit", str(max(1, min(n, 500))), "--json"])}
    except Exception as e:  # noqa: BLE001
        return {"items": [], "error": str(e)[:200]}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    """The MCP switches: mcpTools (every plugin tool on the console's /mcp) and perPluginTools (one tool per command)."""
    return _settings()


@router.put("/settings")
async def put_settings(request: Request) -> dict[str, Any]:
    """Change the MCP switches; the tools follow at once."""
    body = await request.json()
    cur = _settings()
    for k in SETTINGS:
        if isinstance((body or {}).get(k), bool):
            cur[k] = body[k]
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    (DATA_DIR / "settings.json").write_text(json.dumps(cur, indent=1) + "\n")
    from fastapi.concurrency import run_in_threadpool
    return {**cur, "tools": await run_in_threadpool(sync_mcp, True)}


@router.post("/sync")
def post_sync() -> dict[str, Any]:
    """Rebuild the registry now and bring the MCP tools in step (they also follow by themselves every 30 s)."""
    return {"ok": True, **sync_mcp(force=True)}


@router.post("/try")
async def post_try(request: Request) -> JSONResponse:
    """Run one command from the docs page (a control@1 command; the console token's caller)."""
    from fastapi.concurrency import run_in_threadpool
    body = await request.json()
    r = await run_in_threadpool(run_for, request, body if isinstance(body, dict) else {})
    return JSONResponse(r, status_code=200)


def _caller(request: Request) -> tuple[list[str], str]:
    """The caller's grants: the console token / an admin = everything; through control@1's provider otherwise."""
    user = getattr(request.state, "axf_user", None)
    if user is None or getattr(user, "admin", True):
        return ["*"], str(getattr(user, "name", "") or "console")
    ctl = plugin_services.get("control@1")
    grants_of = getattr(ctl, "grants_for", None)
    return (grants_of(request) if callable(grants_of) else []), str(getattr(user, "name", "") or "user")


def run_for(request: Request, command: dict[str, Any]) -> dict[str, Any]:
    grants, name = _caller(request)
    return run(command, grants, command.get("by") or name, request)


class PluginCommands:
    """plugin-commands@1: the plugins domain of control@1 for the /api/control routes, the console MCP and other plugins."""

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "", request: Request | None = None) -> dict[str, Any]:
        return run(command, grants, by, request)

    def run_for(self, request: Request, command: dict[str, Any]) -> dict[str, Any]:
        return run_for(request, command)

    def handles(self, target: str) -> bool:
        return target.startswith("plugins.") or is_plugin(target)

    def from_rest(self, method: str, command: dict[str, Any], query: dict[str, str], body: dict[str, Any] | None) -> dict[str, Any]:
        return from_rest(method, command, query, body)

    def registry(self) -> dict[str, Any]:
        return registry()

    def sync(self) -> dict[str, int]:
        return sync_mcp(force=True)


plugin_services.provide("plugin-commands@1", PluginCommands(), folder=FOLDER)
