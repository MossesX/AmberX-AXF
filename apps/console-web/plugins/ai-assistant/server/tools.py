"""Built-in assistant tools. All read-only; each can be switched off in Settings → Plugins → AI assistant → Tools.

repo_list / repo_read / repo_search  the framework repo (never .git, .axf-console, env/key/secret files, symlinks out)
current_time                         date, time and time zone of the console server
calculator                           arithmetic only (AST-checked, no names, no calls)
web_fetch                            public http(s) pages as text (private/loopback/link-local addresses refused)
console_open / console_settings /    drive the open Dev Console (console-commands@1): open a screen or a Settings tab,
console_action / console_where /     run a registered action, say where it is, list what it has. Admins only.
console_list
build_file / build_status            file a build into the pipeline and read one back (axf.build-dispatch@1). Admins only.

The console group reaches other plugins only through capability services (plugin_services), never by folder.
"""
from __future__ import annotations

import html
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from axf.assistant_host import safety  # framework/python (the plugin __init__ puts it on sys.path first)

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[5])).resolve()
_DENY_DIRS = {".git", ".axf-console", "node_modules", "dist", "dist-single", "__pycache__", ".gradle", "build"}
_DENY_FILE = re.compile(r"(^\.env|\.pem$|\.key$|id_rsa|id_ed25519|secrets?\.(env|json|ya?ml)$|credentials\.json$|\.p12$|\.keystore$|\.jks$)", re.I)
MAX_READ = 60_000

SPECS: list[dict[str, Any]] = [
    {"name": "repo_list", "group": "repo", "description": "List files in the AmberX AXF repository (path and size). Use dir to narrow, e.g. 'framework/core'.",
     "parameters": {"type": "object", "properties": {"dir": {"type": "string"}}, "additionalProperties": False}},
    {"name": "repo_read", "group": "repo", "description": "Read a text file from the repository with line numbers; optional start_line/end_line for a slice.",
     "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "start_line": {"type": "integer"}, "end_line": {"type": "integer"}}, "required": ["path"], "additionalProperties": False}},
    {"name": "repo_search", "group": "repo", "description": "Search the repository for literal text (case-insensitive). Returns file:line: text, at most 200 matches.",
     "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}, "dir": {"type": "string"}}, "required": ["pattern"], "additionalProperties": False}},
    {"name": "current_time", "group": "utility", "description": "The current date, time and time zone.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "calculator", "group": "utility", "description": "Evaluate an arithmetic expression (+ - * / // % **, parentheses, decimals).",
     "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"], "additionalProperties": False}},
    {"name": "web_fetch", "group": "web", "description": "Fetch a public web page (http/https) and return its readable text, up to 40k characters.",
     "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"], "additionalProperties": False}},
    {"name": "console_open", "group": "console", "description": "Open a screen in Brett's open Dev Console: its view id ('plan-studio'), title or a few words ('builds'). Not sure of the name? console_list first.",
     "parameters": {"type": "object", "properties": {"screen": {"type": "string"}}, "required": ["screen"], "additionalProperties": False}},
    {"name": "console_settings", "group": "console", "description": "Open a Settings tab in the open console: its id ('appearance'), 'plugins/<plugin>' for a plugin's sub-tab, or its title. anchor='setting:<key>' scrolls to one setting.",
     "parameters": {"type": "object", "properties": {"tab": {"type": "string"}, "anchor": {"type": "string"}}, "required": ["tab"], "additionalProperties": False}},
    {"name": "console_action", "group": "console", "description": "Run a registered console action by id ('terminal.open'), spec with arguments ('swap:color-theme:dark') or label. One that deletes or resets answers confirmation_required with a token: tell Brett, then call again with confirm=<token>.",
     "parameters": {"type": "object", "properties": {"action": {"type": "string"}, "args": {"type": "array", "items": {"type": "string"}}, "confirm": {"type": "string"}}, "required": ["action"], "additionalProperties": False}},
    {"name": "console_where", "group": "console", "description": "Where Brett's open console is now: screen, open dialog, settings tab.", "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "console_list", "group": "console", "description": "What the open console has: kind = screens | dialogs | settings | actions, best matches for q first.",
     "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["screens", "dialogs", "settings", "actions"]}, "q": {"type": "string"}}, "additionalProperties": False}},
    {"name": "build_file", "group": "console", "description": "File a build into the build pipeline (Brett asked for something to be built). title = short name; detail = what to build; said = Brett's own words, verbatim; priority = '' or 'urgent'; queue=false only files it as pending.",
     "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "detail": {"type": "string"}, "said": {"type": "string"}, "priority": {"type": "string"}, "queue": {"type": "boolean"}}, "required": ["title"], "additionalProperties": False}},
    {"name": "build_status", "group": "console", "description": "One build's state: status, steps, pipeline (by build id).",
     "parameters": {"type": "object", "properties": {"id": {"type": "string"}}, "required": ["id"], "additionalProperties": False}},
]
GROUPS = {"repo": "Read the AXF repository", "utility": "Time and calculator", "web": "Fetch public web pages", "console": "Drive the open Dev Console and file builds"}
#: tool groups only admins get (they act on the console and the build pipeline)
ADMIN_GROUPS = {"console"}


# What says a message needs a built-in group (chat mode): a plain assistant has no skills to take these from.
_GROUP_TRIGGERS = {"repo": ["code", "file", "files", "repo", "repository", "codebase", "framework", "readme", "function", "class"],
                   "utility": ["time", "date", "calculate", "add up", "sum"], "web": ["http", "https", "website", "web page", "url", "link", "fetch"],
                   "console": ["open", "show me", "go to", "jump", "screen", "settings", "console", "build", "file a build", "where am i", "take me"]}


def groups_for(offered: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The built-in tool groups among the tools a chat is offered."""
    names = {t["name"] for t in offered}
    return [{"id": g, "name": g, "triggers": _GROUP_TRIGGERS.get(g, []), "tools": [s["name"] for s in SPECS if s["group"] == g and s["name"] in names]} for g in GROUPS]


def specs(enabled: dict[str, bool]) -> list[dict[str, Any]]:
    return [{k: v for k, v in s.items() if k != "group"} for s in SPECS if enabled.get(s["group"], s["group"] != "web")]


def _safe_path(rel: str) -> Path:
    p = (ROOT / (rel or ".").lstrip("/")).resolve()
    if p != ROOT and not str(p).startswith(str(ROOT) + os.sep):
        raise ValueError("path is outside the repository")
    parts = set(p.relative_to(ROOT).parts) if p != ROOT else set()
    if parts & _DENY_DIRS or _DENY_FILE.search(p.name):
        raise ValueError("that path is not readable by the assistant")
    return p


def _walk(base: Path):
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in _DENY_DIRS and not d.startswith(".git"))
        for f in sorted(filenames):
            fp = Path(dirpath) / f
            if not _DENY_FILE.search(f) and not fp.is_symlink():
                yield fp


def repo_list(dir: str = ".") -> str:  # noqa: A002
    base = _safe_path(dir)
    if base.is_file():
        return f"{base.relative_to(ROOT)} ({base.stat().st_size} bytes)"
    lines = []
    for fp in _walk(base):
        lines.append(f"{fp.relative_to(ROOT)} ({fp.stat().st_size})")
        if len(lines) >= 600:
            lines.append("… (truncated: narrow with dir)")
            break
    return "\n".join(lines) or "Empty."


def repo_read(path: str, start_line: int | None = None, end_line: int | None = None) -> str:
    p = _safe_path(path)
    if not p.is_file():
        raise ValueError("not a file")
    text = p.read_text(errors="replace").split("\n")
    s = max(1, int(start_line or 1))
    e = min(len(text), int(end_line or len(text)))
    out = "\n".join(f"{i:>5}  {text[i - 1]}" for i in range(s, e + 1))
    return out[:MAX_READ] + ("\n… (truncated: read a smaller slice)" if len(out) > MAX_READ else "")


def repo_search(pattern: str, dir: str = ".") -> str:  # noqa: A002
    if not pattern or len(pattern) > 200:
        raise ValueError("pattern must be 1-200 characters")
    rx = re.compile(re.escape(pattern), re.I)  # literal: a model-supplied regex could hang the server (ReDoS)
    hits = []
    for fp in _walk(_safe_path(dir)):
        if fp.stat().st_size > 1_000_000:
            continue
        try:
            for i, line in enumerate(fp.read_text(errors="ignore").split("\n"), 1):
                if rx.search(line):
                    hits.append(f"{fp.relative_to(ROOT)}:{i}: {line.strip()[:200]}")
                    if len(hits) >= 200:
                        return "\n".join(hits) + "\n… (200 matches; narrow the search)"
        except OSError:
            continue
    return "\n".join(hits) or "No matches."


def calculator(expression: str) -> str:
    return safety.calc(expression)


def web_fetch(url: str) -> str:
    code, ctype, raw = safety.fetch(url.strip(), headers={"user-agent": "AmberX-AXF-Assistant/1 (+https://console.amberxai.com)"})
    if "html" in ctype:
        raw = re.sub(r"(?is)<(script|style|noscript|svg).*?</\1>", " ", raw)
        raw = re.sub(r"(?s)<[^>]+>", " ", raw)
        raw = html.unescape(raw)
    text = re.sub(r"[ \t]+", " ", raw)
    text = re.sub(r"\n\s*\n+", "\n\n", text).strip()
    return (f"HTTP {code}\n\n" if code >= 400 else "") + text[:40_000]


def _service(name: str) -> Any:
    try:
        import plugin_services  # the console's capability registry (absent in unit tests run outside the console)
    except ImportError as e:
        raise ValueError(f"{name} is not available outside the console") from e
    svc = plugin_services.get(name)
    if svc is None:
        raise ValueError(f"no enabled plugin provides {name}")
    return svc


def console_command(command: dict[str, Any]) -> str:
    """One console-commands@1 command (the same wire the console MCP tools use), answered as JSON text."""
    command = {k: v for k, v in command.items() if v not in (None, "", {}, [])}
    command.setdefault("by", "ai-assistant")
    r = _service("console-commands@1").run(command, ["*"], "ai-assistant")
    return json.dumps(r, default=str)[:20_000]


def console_tool(name: str, a: dict[str, Any]) -> str:
    if name == "console_open":
        return console_command({"op": "act", "target": "console.screens", "path": str(a.get("screen") or ""), "action": "open"})
    if name == "console_settings":
        return console_command({"op": "act", "target": "console.settings", "path": str(a.get("tab") or ""), "action": "open", "input": {"anchor": str(a.get("anchor") or "")} if a.get("anchor") else {}})
    if name == "console_action":
        args = [str(x) for x in (a.get("args") or [])][:20]
        return console_command({"op": "act", "target": "console.actions", "path": str(a.get("action") or ""), "action": "run", "input": {"args": args} if args else {}, "confirm": str(a.get("confirm") or "")})
    if name == "console_where":
        return console_command({"op": "get", "target": "console.nav", "path": "here"})
    if name == "console_list":
        kind = str(a.get("kind") or "screens")
        if kind not in ("screens", "dialogs", "settings", "actions"):
            raise ValueError("kind is screens, dialogs, settings or actions")
        return console_command({"op": "list", "target": f"console.{kind}", "select": {"q": str(a.get("q") or ""), "limit": 50} if a.get("q") else {"limit": 50}})
    if name == "build_file":
        title = str(a.get("title") or "").strip()[:200]
        if not title:
            raise ValueError("a build needs a title")
        r = _service("axf.build-dispatch@1").request(title, str(a.get("detail") or "")[:8000], by="ai-assistant", source="ai-assistant",
                                                      said=str(a.get("said") or "")[:8000], priority=str(a.get("priority") or ""), queue=a.get("queue") is not False)
        return json.dumps(r, default=str)[:20_000]
    if name == "build_status":
        return json.dumps(_service("axf.build-dispatch@1").build(str(a.get("id") or "")), default=str)[:20_000]
    raise ValueError(f"unknown tool {name}")


CONSOLE_NAMES = {"console_open", "console_settings", "console_action", "console_where", "console_list", "build_file", "build_status"}


def run(name: str, args: dict[str, Any]) -> str:
    a = args or {}
    if name in CONSOLE_NAMES:
        return console_tool(name, a)
    if name == "repo_list":
        return repo_list(str(a.get("dir") or "."))
    if name == "repo_read":
        return repo_read(str(a.get("path") or ""), a.get("start_line"), a.get("end_line"))
    if name == "repo_search":
        return repo_search(str(a.get("pattern") or ""), str(a.get("dir") or "."))
    if name == "current_time":
        return json.dumps({"iso": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "zone": time.strftime("%Z"), "unix": int(time.time())})
    if name == "calculator":
        return calculator(str(a.get("expression") or ""))
    if name == "web_fetch":
        return web_fetch(str(a.get("url") or ""))
    raise ValueError(f"unknown tool {name}")


BUILTIN_NAMES = {s["name"] for s in SPECS}
