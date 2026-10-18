"""Built-in assistant tools. All read-only; each can be switched off in Settings → AI assistant → Tools.

repo_list / repo_read / repo_search  the framework repo (never .git, .axf-console, env/key/secret files, symlinks out)
current_time                         date, time and time zone of the console server
calculator                           arithmetic only (AST-checked, no names, no calls)
web_fetch                            public http(s) pages as text (private/loopback/link-local addresses refused)
"""
from __future__ import annotations

import html
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from . import safety

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
GROUPS = {"repo": "Read the AXF repository", "utility": "Time and calculator", "web": "Fetch public web pages"}


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


def run(name: str, args: dict[str, Any]) -> str:
    a = args or {}
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
