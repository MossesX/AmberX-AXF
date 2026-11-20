"""Built-in assistant tools. All read-only; each can be switched off in Settings → Plugins → AI assistant → Tools.

repo_list / repo_read / repo_search  the framework repo (never .git, .axf-console, env/key/secret files, symlinks out)
current_time                         date, time and time zone of the console server
calculator                           arithmetic only (AST-checked, no names, no calls)
web_fetch                            public http(s) pages as text (private/loopback/link-local addresses refused)
console_open / console_settings /    drive Brett's open console: open screens, settings tabs and dialogs, go back or home,
console_dialog / console_back /      run actions that only navigate, see where it is and what it has (capability
console_action / console_where /     console-commands@1, when the Console commands plugin is on; admins only). Navigation
console_list                         and reads only: the grants never include control.console.write, so an action that
                                     changes data is refused by the control@1 gate, whatever the model asks.
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

try:
    import plugin_services  # the console's capability registry (absent when this module runs outside the console)
except ImportError:  # pragma: no cover
    plugin_services = None  # type: ignore[assignment]

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
]
_TO = {"type": "string", "description": "Which console: omit for the one Brett used last, \"all\", or a client id."}
SPECS += [
    {"name": "console_open", "group": "console", "description": "Open a screen in Brett's open Dev Console (the one he used last). `screen` = the view id (\"plan-studio\"), its title or a few words (\"orchestrator\"); optional `focus` = a tab or item on it (\"pending\", a build id). Not sure of the name: console_list first. If this chat is the full chat page, the console leaves it (the reply keeps running).",
     "parameters": {"type": "object", "properties": {"screen": {"type": "string"}, "focus": {"type": "string"}, "to": _TO}, "required": ["screen"], "additionalProperties": False}},
    {"name": "console_settings", "group": "console", "description": "Open a Settings tab or sub-tab in the open console: its id (\"appearance\"), \"plugins/<plugin>\" for a plugin's settings, its title, or a single setting's key or name (opens its tab scrolled to it).",
     "parameters": {"type": "object", "properties": {"tab": {"type": "string"}, "anchor": {"type": "string"}, "to": _TO}, "required": ["tab"], "additionalProperties": False}},
    {"name": "console_dialog", "group": "console", "description": "Open a dialog in the open console by id, title or words (`arg` = its optional argument), or action=\"close\" to shut the one that is open. Opening another dialog replaces the chat window when the chat is a dialog (the reply keeps running; it reopens from the assistant).",
     "parameters": {"type": "object", "properties": {"dialog": {"type": "string"}, "arg": {"type": "string"}, "action": {"type": "string", "enum": ["open", "close"]}, "to": _TO}, "additionalProperties": False}},
    {"name": "console_back", "group": "console", "description": "Move the open console: back (closes an open dialog first, else the screen before), home, or close (the open dialog).",
     "parameters": {"type": "object", "properties": {"move": {"type": "string", "enum": ["back", "home", "close"]}, "to": _TO}, "additionalProperties": False}},
    {"name": "console_action", "group": "console", "description": "Run a registered console action that only navigates (menus, toolbar and search use them): its id (\"terminal.open\"), id with arguments, or label. Actions that change data are refused here: tell Brett where to tap instead.",
     "parameters": {"type": "object", "properties": {"action": {"type": "string"}, "args": {"type": "array", "items": {"type": "string"}}, "to": _TO}, "required": ["action"], "additionalProperties": False}},
    {"name": "console_where", "group": "console", "description": "Where Brett's open console is now: screen, open dialog, settings tab, open tabs, selection (as of its last beat, at most 15 s old).",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "console_list", "group": "console", "description": "What the open console has, best matches for `q` first: its screens, dialogs, settings tabs (and single settings) or actions. Use it to find the right name before opening.",
     "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["screens", "dialogs", "settings", "actions"]}, "q": {"type": "string"}, "limit": {"type": "integer"}}, "additionalProperties": False}},
]
GROUPS = {"repo": "Read the AXF repository", "utility": "Time and calculator", "web": "Fetch public web pages", "console": "Drive the open console (open screens, settings, dialogs)"}
CONSOLE_CAPABILITY = "console-commands@1"
# Navigation and reads only (control@1 permissions): an action that changes data needs control.console.write, never granted here.
CONSOLE_GRANTS = ["control.console.read", "control.console.navigate"]


# What says a message needs a built-in group (chat mode): a plain assistant has no skills to take these from.
_GROUP_TRIGGERS = {"repo": ["code", "file", "files", "repo", "repository", "codebase", "framework", "readme", "function", "class"],
                   "utility": ["time", "date", "calculate", "add up", "sum"], "web": ["http", "https", "website", "web page", "url", "link", "fetch"],
                   "console": ["open", "go to", "go back", "take me", "show me", "pull up", "navigate", "screen", "page", "tab", "settings", "dialog", "console",
                               "where am i", "home", "back"]}


def groups_for(offered: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The built-in tool groups among the tools a chat is offered."""
    names = {t["name"] for t in offered}
    return [{"id": g, "name": g, "triggers": _GROUP_TRIGGERS.get(g, []), "tools": [s["name"] for s in SPECS if s["group"] == g and s["name"] in names]} for g in GROUPS]


def console_service() -> Any:
    """The Console commands capability when it is installed and on, else None."""
    if plugin_services is None:
        return None
    try:
        return plugin_services.get(CONSOLE_CAPABILITY)
    except Exception:  # noqa: BLE001
        return None


def specs(enabled: dict[str, bool]) -> list[dict[str, Any]]:
    """The built-in tools of the switched-on groups (web is off unless switched on; console needs its capability)."""
    on = {g for g in GROUPS if enabled.get(g, g != "web")}
    if "console" in on and console_service() is None:
        on.discard("console")
    return [{k: v for k, v in s.items() if k != "group"} for s in SPECS if s["group"] in on]


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


def _console_command(name: str, a: dict[str, Any]) -> dict[str, Any]:
    """The control@1 command of a console tool (the same shapes as the console's MCP tools)."""
    to = str(a.get("to") or "").strip()

    def inp(**more: Any) -> dict[str, Any]:
        d = {k: v for k, v in more.items() if v not in (None, "", [])}
        if to and to != "recent":
            d["to"] = to
        return d

    s = lambda k: str(a.get(k) or "").strip()  # noqa: E731
    if name == "console_open":
        if not s("screen"):
            raise ValueError("screen is required (its id, title or a few words; console_list names them)")
        return {"op": "act", "target": "console.screens", "path": s("screen"), "action": "open", "input": inp(focus=s("focus"))}
    if name == "console_settings":
        if not s("tab"):
            raise ValueError("tab is required")
        return {"op": "act", "target": "console.settings", "path": s("tab"), "action": "open", "input": inp(anchor=s("anchor"))}
    if name == "console_dialog":
        if s("action") == "close":
            return {"op": "act", "target": "console.dialogs", "path": s("dialog") or "current", "action": "close", "input": inp()}
        if not s("dialog"):
            raise ValueError("dialog is required to open one")
        return {"op": "act", "target": "console.dialogs", "path": s("dialog"), "action": "open", "input": inp(arg=s("arg"))}
    if name == "console_back":
        move = s("move") or "back"
        if move not in ("back", "home", "close"):
            raise ValueError("move is back, home or close")
        return {"op": "act", "target": "console.nav", "path": "here", "action": move, "input": inp()}
    if name == "console_action":
        if not s("action"):
            raise ValueError("action is required")
        args = [str(x) for x in a.get("args") or [] if str(x)] if isinstance(a.get("args"), list) else []
        return {"op": "act", "target": "console.actions", "path": s("action"), "action": "run", "input": inp(args=args or None)}
    if name == "console_where":
        return {"op": "get", "target": "console.nav", "path": "here"}
    if name == "console_list":
        kind = s("kind") or "screens"
        if kind not in ("screens", "dialogs", "settings", "actions"):
            raise ValueError("kind is screens, dialogs, settings or actions")
        try:
            limit = max(1, min(int(a.get("limit") or 50), 200))
        except (TypeError, ValueError):
            limit = 50
        return {"op": "list", "target": f"console.{kind}", "select": {k: v for k, v in {"q": s("q"), "limit": limit}.items() if v}}
    raise ValueError(f"unknown tool {name}")


def console_run(name: str, args: dict[str, Any], by: str = "assistant") -> str:
    """Run a console tool through console-commands@1 → its answer as JSON text (a failure raises, so the chip shows it)."""
    svc = console_service()
    if svc is None:
        raise ValueError("the Console commands plugin is off or not installed, so the console can't be driven from here")
    command = {k: v for k, v in _console_command(name, args or {}).items() if v not in (None, "", {})}
    r = svc.run({**command, "by": by}, list(CONSOLE_GRANTS), by)
    if not isinstance(r, dict):
        raise ValueError("the Console commands plugin gave no answer")
    if not r.get("ok"):
        raise ValueError(f"{r.get('code', 'failed')}: {r.get('message', 'the console did not do it')}")
    return json.dumps({k: v for k, v in r.items() if k not in ("$axf", "images")}, ensure_ascii=False, default=str)[:20_000]


CONSOLE_NAMES = {s["name"] for s in SPECS if s["group"] == "console"}


def run(name: str, args: dict[str, Any], by: str = "assistant") -> str:
    a = args or {}
    if name in CONSOLE_NAMES:
        return console_run(name, a, by)
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
