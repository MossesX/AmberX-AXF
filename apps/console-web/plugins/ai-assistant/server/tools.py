"""Built-in assistant tools. Each group can be switched off in Settings → Plugins → AI assistant → Tools.

repo_list / repo_read / repo_search  the framework repo (never .git, .axf-console, env/key/secret files, symlinks out)
current_time                         date, time and time zone of the console server
calculator                           arithmetic only (AST-checked, no names, no calls)
web_fetch                            public http(s) pages as text (private/loopback/link-local addresses refused)
console_*  / control / build_file    drive the console through control@1 (build ai-assistant-console-api, Nov 10 2026;
                                     Brett: "access to the API so she can drive the console, open screens and configure
                                     settings"): open any screen, dialog or settings tab in the owner's open console,
                                     read or change any setting, run console actions and plugin commands, file builds, and
                                     every other control@1 target (tokens, AmberX notes, planner). The group is offered to
                                     the owner only (console token / hub admin); the commands run through the console's
                                     control@1 capability (the Token control plugin) and keep its gate: a delete or a
                                     destructive action answers confirmation_required with a token the assistant must
                                     show the owner and only resend after an explicit yes.
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
    # ---- the console (control@1, console domain): what the owner's open console shows and does
    {"name": "console_where", "group": "console", "description": "Where the owner's open console is right now: its screen, open dialog and settings tab, and which console (phone or desktop) is in front.",
     "parameters": {"type": "object", "properties": {}, "additionalProperties": False}},
    {"name": "console_list", "group": "console", "description": "List what the open console has: kind = screens, dialogs, settings (tabs and sub-tabs, plugins/<id>) or actions. q = words to search for. Use it when a name is unsure before console_open.",
     "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["screens", "dialogs", "settings", "actions"]}, "q": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["kind"], "additionalProperties": False}},
    {"name": "console_open", "group": "console", "description": "Open something in the owner's console: kind = screen, dialog or settings; target = its id, title or words to search for (\"plan studio\", \"builds\", \"plugins/ai-assistant\"). anchor scrolls a settings tab to one setting; arg is a dialog's optional argument. to = recent (default: the console the owner is looking at), all, or a client id.",
     "parameters": {"type": "object", "properties": {"kind": {"type": "string", "enum": ["screen", "dialog", "settings"]}, "target": {"type": "string"}, "anchor": {"type": "string"}, "arg": {"type": "string"}, "to": {"type": "string"}}, "required": ["kind", "target"], "additionalProperties": False}},
    {"name": "console_nav", "group": "console", "description": "Move the open console: back (closes an open dialog first, else the screen before), home (the first screen), close (the open dialog) or refresh (reload the page).",
     "parameters": {"type": "object", "properties": {"action": {"type": "string", "enum": ["back", "home", "close", "refresh"]}, "to": {"type": "string"}}, "required": ["action"], "additionalProperties": False}},
    {"name": "console_setting_get", "group": "console", "description": "Read one setting's current value in the open console (the console's settings registry: every plugin's keys too, e.g. ai-assistant.approvalsBadge). console_list settings names the tabs; a setting's key is on its control (title) in the console.",
     "parameters": {"type": "object", "properties": {"key": {"type": "string"}, "to": {"type": "string"}}, "required": ["key"], "additionalProperties": False}},
    {"name": "console_setting_set", "group": "console", "description": "Change one setting in the open console: key = the setting key, value = the new value (string, number, true/false, null or a list of strings). Say what you changed afterwards.",
     "parameters": {"type": "object", "properties": {"key": {"type": "string"}, "value": {}, "to": {"type": "string"}}, "required": ["key", "value"], "additionalProperties": False}},
    {"name": "console_action", "group": "console", "description": "Run a registered console action in the open console (menus, toolbars, search: console_list actions names them), e.g. swap:color-theme:dark. args = its arguments (a list, or a colon-joined string). A destructive action answers confirmation_required with a confirm token: show the owner what it does and resend with confirm only after an explicit yes.",
     "parameters": {"type": "object", "properties": {"action": {"type": "string"}, "args": {"type": "array", "items": {"type": "string"}}, "confirm": {"type": "string"}, "to": {"type": "string"}}, "required": ["action"], "additionalProperties": False}},
    {"name": "build_file", "group": "console", "description": "File a build for the Build orchestrator (planner.builds add): title = short name, request = what the owner asked for in their own words (kept verbatim as the build's detail). Answers the build record; the orchestrator plans its steps.",
     "parameters": {"type": "object", "properties": {"title": {"type": "string"}, "request": {"type": "string"}}, "required": ["title", "request"], "additionalProperties": False}},
    {"name": "control", "group": "console", "description": "Any control@1 command (framework/spec/CONTROL.md): op = list, get, set, reset, add, remove or act; target = tokens.theme, tokens.layout, tokens.nav, amberx.items, amberx.lists, planner.plans, planner.builds, console.screens, console.dialogs, console.settings, console.actions, console.nav, console.clients, plugins.commands, plugins.reads, pass.scopes …; path, value, action, input, select as the target takes them. Plugin commands: act run on plugins.commands with path <plugin>/<command>. remove and destructive acts answer confirmation_required first; resend with confirm only after the owner says yes.",
     "parameters": {"type": "object", "properties": {"op": {"type": "string", "enum": ["list", "get", "set", "reset", "add", "remove", "act"]}, "target": {"type": "string"}, "path": {"type": "string"}, "value": {}, "action": {"type": "string"}, "input": {"type": "object"}, "select": {"type": "object"}, "confirm": {"type": "string"}}, "required": ["op", "target"], "additionalProperties": False}},
]
GROUPS = {"repo": "Read the AXF repository", "utility": "Time and calculator", "web": "Fetch public web pages", "console": "Drive the console (open screens, change settings, run commands, file builds: control@1)"}
CONSOLE_GROUP = "console"


# What says a message needs a built-in group (chat mode): a plain assistant has no skills to take these from.
_GROUP_TRIGGERS = {"repo": ["code", "file", "files", "repo", "repository", "codebase", "framework", "readme", "function", "class"],
                   "utility": ["time", "date", "calculate", "add up", "sum"], "web": ["http", "https", "website", "web page", "url", "link", "fetch"],
                   "console": ["open", "show", "go to", "take me", "screen", "page", "dialog", "settings", "setting", "switch", "turn on", "turn off", "enable", "disable",
                               "console", "plan studio", "builds", "build", "queue", "file a build", "theme", "token", "layout", "nav", "menu", "toolbar", "plugin", "command", "run", "refresh", "back", "home", "close"]}

# control@1 runner, set by the plugin's server part (plugin_services → the Token control plugin). (command, by) → answer.
_control: Any = None


def set_control_runner(fn: Any) -> None:
    global _control
    _control = fn


def groups_for(offered: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """The built-in tool groups among the tools a chat is offered."""
    names = {t["name"] for t in offered}
    return [{"id": g, "name": g, "triggers": _GROUP_TRIGGERS.get(g, []), "tools": [s["name"] for s in SPECS if s["group"] == g and s["name"] in names]} for g in GROUPS]


def specs(enabled: dict[str, bool]) -> list[dict[str, Any]]:
    return [{k: v for k, v in s.items() if k != "group"} for s in SPECS if enabled.get(s["group"], s["group"] != "web")]


# ---------------------------------------------------------------- the console (control@1)

_CONSOLE_KIND = {"screen": "console.screens", "dialog": "console.dialogs", "settings": "console.settings",
                 "screens": "console.screens", "dialogs": "console.dialogs", "actions": "console.actions"}
_CONTROL_OPS = ("list", "get", "set", "reset", "add", "remove", "act")


def _run_control(command: dict[str, Any], by: str, reason: str) -> str:
    if _control is None:
        raise ValueError("the console control API isn't available: the Token control plugin (control@1) is off or not installed")
    cmd = {k: v for k, v in command.items() if v is not None}
    cmd.setdefault("by", by or "ai-assistant")
    if reason and cmd.get("op") in ("set", "reset", "add", "remove", "act"):
        cmd.setdefault("reason", reason[:200])
    r = _control(cmd, cmd["by"])
    if not isinstance(r, dict):
        r = {"ok": False, "code": "unexpected", "message": "no answer from the control runner"}
    text = json.dumps(r, ensure_ascii=False, default=str)
    if not r.get("ok") and r.get("code") == "confirmation_required":
        text += "\n\nThis needs the owner's explicit yes. Tell them exactly what it does; only after they agree, send the same command again with confirm set to the token above."
    return text[:50_000]


def _to(a: dict[str, Any]) -> dict[str, Any]:
    return {"to": str(a["to"])} if a.get("to") else {}


def console_tool(name: str, a: dict[str, Any], by: str = "", reason: str = "") -> str:
    """One of the console group's tools → the control@1 answer as JSON text."""
    if name == "console_where":
        return _run_control({"op": "get", "target": "console.nav", "path": "here"}, by, reason)
    if name == "console_list":
        target = _CONSOLE_KIND.get(str(a.get("kind") or ""))
        if not target:
            raise ValueError("kind must be screens, dialogs, settings or actions")
        select: dict[str, Any] = {}
        if a.get("q"):
            select["q"] = str(a["q"])[:200]
        if a.get("limit"):
            select["limit"] = max(1, min(int(a["limit"]), 200))
        return _run_control({"op": "list", "target": target, **({"select": select} if select else {})}, by, reason)
    if name == "console_open":
        target = _CONSOLE_KIND.get(str(a.get("kind") or ""))
        if not target or target == "console.actions":
            raise ValueError("kind must be screen, dialog or settings")
        inp = {**_to(a), **({"anchor": str(a["anchor"])[:160]} if a.get("anchor") else {}), **({"arg": str(a["arg"])[:400]} if a.get("arg") else {})}
        return _run_control({"op": "act", "target": target, "path": str(a.get("target") or ""), "action": "open", "input": inp}, by, reason)
    if name == "console_nav":
        action = str(a.get("action") or "")
        if action not in ("back", "home", "close", "refresh"):
            raise ValueError("action must be back, home, close or refresh")
        return _run_control({"op": "act", "target": "console.nav", "path": "here", "action": action, "input": _to(a)}, by, reason)
    if name == "console_setting_get":
        return _run_control({"op": "act", "target": "console.settings", "path": str(a.get("key") or ""), "action": "read", "input": _to(a)}, by, reason)
    if name == "console_setting_set":
        if "value" not in a:
            raise ValueError("value is required")
        return _run_control({"op": "act", "target": "console.settings", "path": str(a.get("key") or ""), "action": "change", "input": {"value": a["value"], **_to(a)}}, by, reason)
    if name == "console_action":
        args = a.get("args")
        inp: dict[str, Any] = {**_to(a)}
        if isinstance(args, list) and args:
            inp["args"] = [str(x) for x in args][:12]
        elif isinstance(args, str) and args:
            inp["args"] = args
        return _run_control({"op": "act", "target": "console.actions", "path": str(a.get("action") or ""), "action": "run", "input": inp, **({"confirm": str(a["confirm"])} if a.get("confirm") else {})}, by, reason)
    if name == "build_file":
        title, request = str(a.get("title") or "").strip()[:120], str(a.get("request") or "").strip()[:4000]
        if not title or not request:
            raise ValueError("title and request are required")
        return _run_control({"op": "add", "target": "planner.builds", "value": {"title": title, "detail": request}}, by, reason or request[:200])
    if name == "control":
        op = str(a.get("op") or "")
        if op not in _CONTROL_OPS:
            raise ValueError(f"op must be one of {', '.join(_CONTROL_OPS)}")
        cmd: dict[str, Any] = {"op": op, "target": str(a.get("target") or "")}
        for k in ("path", "value", "action", "input", "select", "confirm"):
            if k in a and a[k] is not None and a[k] != "":
                cmd[k] = a[k]
        return _run_control(cmd, by, reason)
    raise ValueError(f"unknown console tool {name}")


CONSOLE_NAMES = {s["name"] for s in SPECS if s["group"] == CONSOLE_GROUP}


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


def run(name: str, args: dict[str, Any], by: str = "", reason: str = "") -> str:
    a = args or {}
    if name in CONSOLE_NAMES:
        return console_tool(name, a, by, reason)
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
