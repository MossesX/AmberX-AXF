"""Agent tools: definitions (stored in tools.json) and the executor.

Tool kinds (contract.TOOL_KINDS)
  builtin   repo_list · repo_read · repo_search · current_time · calculator · web_fetch · memory_search · memory_save ·
            firecrawl_scrape · firecrawl_search · container_* (containers.py)      (config.builtin names which one)
  http      call an HTTP API: method, url template ({{arg}}), headers (values may be "env:VAR"), JSON body template.
            Public hosts only unless config.allowPrivate (for services on the VPS you trust).
  mcp       call a tool on a Streamable-HTTP MCP server: config.url, config.tokenEnv, config.tool
  prompt    a sub-prompt run on a model: config.template ({{arg}}), config.system, config.model
  agent     delegate a task to another agent: config.agentId
  workflow  run a workflow: config.workflowId (input = the "input" argument)
Every tool has a function `name`, a `description` and JSON-Schema `parameters` — what the model sees.
Nothing here runs shell commands or arbitrary code. Container tools only read, or *propose* changes that Brett
approves on a card; they're dangerous tools, given only to agents allowed in Settings → Safety.
Builtins are an open registry: `register_builtin(name, spec, runner)` lets another module add one.
"""
from __future__ import annotations

import asyncio
import html
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlparse

from . import containers, contract, safety, store

ROOT = store.ROOT
_DENY_DIRS = {".git", ".axf-console", "node_modules", "dist", "dist-single", "__pycache__", ".gradle", "build"}
_DENY_FILE = re.compile(r"(^\.env|\.pem$|\.key$|id_rsa|id_ed25519|secrets?\.(env|json|ya?ml)$|credentials\.json$|\.p12$|\.keystore$|\.jks$)", re.I)
NAME_RE = contract.TOOL_NAME_RE
KINDS = contract.TOOL_KINDS

BUILTINS: dict[str, dict[str, Any]] = {
    "repo_list": {"description": "List files in the AmberX AXF repository (path and size). Use dir to narrow.", "parameters": {"type": "object", "properties": {"dir": {"type": "string"}}}},
    "repo_read": {"description": "Read a repository text file with line numbers; optional start_line/end_line.", "parameters": {"type": "object", "properties": {"path": {"type": "string"}, "start_line": {"type": "integer"}, "end_line": {"type": "integer"}}, "required": ["path"]}},
    "repo_search": {"description": "Search the repository for literal text (case-insensitive); file:line: text.", "parameters": {"type": "object", "properties": {"pattern": {"type": "string"}, "dir": {"type": "string"}}, "required": ["pattern"]}},
    "current_time": {"description": "Current date, time and time zone.", "parameters": {"type": "object", "properties": {}}},
    "calculator": {"description": "Evaluate arithmetic (+ - * / // % **, parentheses).", "parameters": {"type": "object", "properties": {"expression": {"type": "string"}}, "required": ["expression"]}},
    "web_fetch": {"description": "Fetch a public web page and return its readable text (up to 40k characters).", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    "memory_search": {"description": "Search your own long-term memory (facts, knowledge, past exchanges).", "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}},
    "memory_save": {"description": "Save a durable fact or note to your long-term memory for future conversations.", "parameters": {"type": "object", "properties": {"text": {"type": "string"}, "kind": {"type": "string", "enum": ["fact", "note"]}, "tags": {"type": "array", "items": {"type": "string"}}}, "required": ["text"]}},
    "firecrawl_scrape": {"description": "Scrape one web page to clean Markdown with Firecrawl (handles JavaScript sites).", "parameters": {"type": "object", "properties": {"url": {"type": "string"}}, "required": ["url"]}},
    "firecrawl_search": {"description": "Search the web with Firecrawl and return the top results as Markdown.", "parameters": {"type": "object", "properties": {"query": {"type": "string"}, "limit": {"type": "integer"}}, "required": ["query"]}},
}
BUILTINS.update(containers.ALL)
_RUNNERS: dict[str, Callable[[dict[str, Any], dict[str, Any]], str]] = {}


def register_builtin(name: str, spec: dict[str, Any], runner: Callable[[dict[str, Any], dict[str, Any]], str], dangerous: bool = False) -> None:
    """Open registry: another module adds a builtin tool (spec = {description, parameters}); dangerous ones need Settings → Safety."""
    if not NAME_RE.match(name):
        raise ValueError("builtin names are function names")
    BUILTINS[name] = {"description": str(spec.get("description", ""))[:1000], "parameters": spec.get("parameters") or {"type": "object", "properties": {}}, "dangerous": dangerous}
    _RUNNERS[name] = runner


def is_dangerous(rec: dict[str, Any]) -> bool:
    """Tools that touch containers, write or run commands. Only agents allowed in Settings → Safety get them."""
    b = (rec.get("config") or {}).get("builtin") if rec.get("kind") == "builtin" else None
    return containers.is_container_tool(rec) or bool(rec.get("dangerous")) or bool(b and BUILTINS.get(b, {}).get("dangerous"))


def context() -> contract.Context:
    return contract.Context(known=store.known(), builtins=BUILTINS)


# ---------------------------------------------------------------- safe primitives

def _safe_path(rel: str) -> Path:
    p = (ROOT / (rel or ".").lstrip("/")).resolve()
    if p != ROOT and not str(p).startswith(str(ROOT) + os.sep):
        raise ValueError("path is outside the repository")
    parts = set(p.relative_to(ROOT).parts) if p != ROOT else set()
    if parts & _DENY_DIRS or _DENY_FILE.search(p.name):
        raise ValueError("that path is not readable")
    return p


def walk_repo(base: Path):
    for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
        dirnames[:] = sorted(d for d in dirnames if d not in _DENY_DIRS and not d.startswith(".git"))
        for f in sorted(filenames):
            fp = Path(dirpath) / f
            if not _DENY_FILE.search(f) and not fp.is_symlink():
                yield fp


def repo_read(path: str, start: int | None = None, end: int | None = None, numbered: bool = True) -> str:
    p = _safe_path(path)
    if not p.is_file():
        raise ValueError(f"not a file: {path}")
    lines = p.read_text(errors="replace").split("\n")
    s, e = max(1, int(start or 1)), min(len(lines), int(end or len(lines)))
    out = "\n".join((f"{i:>5}  " if numbered else "") + lines[i - 1] for i in range(s, e + 1))
    return out[:60_000]


def http(method: str, url: str, headers: dict[str, str] | None = None, body: Any = None, timeout: float = 30, allow_private: bool = False, limit: int = 2_000_000) -> tuple[int, str, str]:
    """SSRF-safe request (address resolved once, checked, pinned; redirects re-checked; total deadline)."""
    data = None if body is None else (body if isinstance(body, bytes) else json.dumps(body).encode())
    h = {"user-agent": "AmberX-AXF-AgentManager/1", **({"content-type": "application/json"} if data is not None else {}), **(headers or {})}
    return safety.fetch(url, method, h, data, allow_private=allow_private, timeout=timeout, deadline=max(timeout * 3, 60), max_bytes=limit)


def page_text(raw: str, ctype: str) -> str:
    if "html" in ctype:
        raw = re.sub(r"(?is)<(script|style|noscript|svg).*?</\1>", " ", raw)
        raw = html.unescape(re.sub(r"(?s)<[^>]+>", " ", raw))
    return re.sub(r"\n\s*\n+", "\n\n", re.sub(r"[ \t]+", " ", raw)).strip()


def calc(expr: str) -> str:
    return safety.calc(expr)


_fill = contract.fill_tool_template


# ---------------------------------------------------------------- Firecrawl

def firecrawl(path: str, body: dict[str, Any] | None = None, method: str = "POST", timeout: float = 90) -> dict[str, Any]:
    s = store.load_settings()["firecrawl"]
    key = store.secret("firecrawl")
    if not key:
        raise ValueError("Firecrawl isn't configured: set FIRECRAWL_API_KEY or add a key in Settings → Plugins → Agent manager → Training")
    base = (s.get("baseUrl") or "https://api.firecrawl.dev").rstrip("/")
    ver = s.get("version") or "v2"
    allow_private = not base.startswith("https://api.firecrawl.dev")  # a self-hosted Firecrawl may live on the VPS
    code, _ct, text = http(method, f"{base}/{ver}/{path.lstrip('/')}", {"authorization": f"Bearer {key}"}, body, timeout=timeout, allow_private=allow_private, limit=20_000_000)
    try:
        j = json.loads(text)
    except ValueError:
        raise ValueError(f"Firecrawl answered HTTP {code} with non-JSON") from None
    if code >= 400 or j.get("success") is False:
        raise ValueError(f"Firecrawl HTTP {code}: {str(j.get('error') or j.get('message') or text)[:300]}")
    return j


def fc_scrape(url: str) -> dict[str, Any]:
    j = firecrawl("scrape", {"url": url, "formats": ["markdown"], "onlyMainContent": True})
    d = j.get("data") or {}
    return {"url": url, "title": (d.get("metadata") or {}).get("title", ""), "markdown": d.get("markdown") or ""}


def fc_search(query: str, limit: int = 5) -> list[dict[str, Any]]:
    j = firecrawl("search", {"query": query, "limit": max(1, min(int(limit or 5), 20)), "scrapeOptions": {"formats": ["markdown"], "onlyMainContent": True}})
    data = j.get("data") or []
    rows = data.get("web", []) if isinstance(data, dict) else data  # v2: {web: [...]}, v1: [...]
    return [{"url": r.get("url") or (r.get("metadata") or {}).get("sourceURL", ""), "title": r.get("title") or (r.get("metadata") or {}).get("title", ""),
             "markdown": r.get("markdown") or r.get("description") or ""} for r in rows if isinstance(r, dict)]


def fc_crawl(url: str, limit: int = 20, include: list[str] | None = None, max_wait: float = 600) -> list[dict[str, Any]]:
    body: dict[str, Any] = {"url": url, "limit": max(1, min(int(limit or 20), 500)), "scrapeOptions": {"formats": ["markdown"], "onlyMainContent": True}}
    if include:
        body["includePaths"] = include
    start = firecrawl("crawl", body)
    cid = start.get("id")
    if not cid:
        raise ValueError("Firecrawl did not return a crawl id")
    deadline = time.time() + max_wait
    pages: list[dict[str, Any]] = []
    while time.time() < deadline:
        st = firecrawl(f"crawl/{cid}", method="GET")
        if st.get("status") in ("completed", "failed", "cancelled"):
            pages = list(st.get("data") or [])
            nxt = st.get("next")
            while nxt and len(pages) < body["limit"]:
                p = urlparse(nxt)
                more = firecrawl(p.path.split("/", 2)[-1] + (f"?{p.query}" if p.query else ""), method="GET")
                pages += more.get("data") or []
                nxt = more.get("next")
            if st.get("status") != "completed" and not pages:
                raise ValueError(f"crawl {st.get('status')}")
            break
        time.sleep(4)
    return [{"url": (d.get("metadata") or {}).get("sourceURL", ""), "title": (d.get("metadata") or {}).get("title", ""), "markdown": d.get("markdown") or ""} for d in pages]


# ---------------------------------------------------------------- MCP

def mcp_call(url: str, token_env: str, tool: str | None = None, args: dict[str, Any] | None = None, resource: str | None = None, timeout: float = 60) -> str:
    async def go() -> str:
        from mcp import Client
        from mcp.client.streamable_http import create_mcp_http_client, streamable_http_client
        token = os.environ.get(token_env, "") if token_env else ""
        if token_env and not token:
            raise ValueError(f"environment variable {token_env} is not set on the console server")
        http_client = create_mcp_http_client(headers={"Authorization": f"Bearer {token}"} if token else {})
        async with http_client:
            async with Client(streamable_http_client(url, http_client=http_client), read_timeout_seconds=timeout) as c:
                if resource:
                    r = await c.read_resource(resource)
                    return "\n\n".join(getattr(x, "text", "") or "" for x in r.contents)
                r = await c.call_tool(tool or "", args or {})
                return "\n\n".join(getattr(x, "text", "") or json.dumps(getattr(x, "model_dump", lambda: {})()) for x in r.content)
    u = urlparse(url)
    if u.scheme not in ("http", "https"):
        raise ValueError("MCP tools use Streamable HTTP URLs only")
    return asyncio.run(go())


# ---------------------------------------------------------------- definitions → model-facing specs

def validate(rec: dict[str, Any]) -> dict[str, Any]:
    v = contract.validate_item("tools", rec, context())
    if not v.ok:
        raise ValueError(v.errors[0])
    return v.item


def spec(tool: dict[str, Any]) -> dict[str, Any]:
    return {"name": tool["name"], "description": tool.get("description", ""), "parameters": tool.get("parameters") or {"type": "object", "properties": {}}}


# ---------------------------------------------------------------- execution

def execute(tool: dict[str, Any], args: dict[str, Any], ctx: dict[str, Any]) -> str:  # noqa: C901
    """Run one tool. ctx: {agent, scope, depth, run_agent, run_workflow, stage?}."""
    kind, cfg, a = tool.get("kind"), tool.get("config") or {}, args or {}
    if kind == "builtin":
        b = cfg.get("builtin")
        if b in _RUNNERS:
            return str(_RUNNERS[b](a, ctx))
        if b == "repo_list":
            base = _safe_path(str(a.get("dir") or "."))
            out = []
            for fp in walk_repo(base if base.is_dir() else base.parent):
                out.append(f"{fp.relative_to(ROOT)} ({fp.stat().st_size})")
                if len(out) >= 500:
                    out.append("… truncated")
                    break
            return "\n".join(out) or "Empty."
        if b == "repo_read":
            return repo_read(str(a.get("path") or ""), a.get("start_line"), a.get("end_line"))
        if b == "repo_search":
            pat = str(a.get("pattern") or "")[:200]
            if not pat:
                raise ValueError("pattern is required")
            rx = re.compile(re.escape(pat), re.I)  # literal: a model-supplied regex could hang the server (ReDoS)
            hits = []
            for fp in walk_repo(_safe_path(str(a.get("dir") or "."))):
                if fp.stat().st_size > 1_000_000:
                    continue
                for i, line in enumerate(fp.read_text(errors="ignore").split("\n"), 1):
                    if rx.search(line):
                        hits.append(f"{fp.relative_to(ROOT)}:{i}: {line.strip()[:200]}")
                        if len(hits) >= 200:
                            return "\n".join(hits) + "\n… 200 matches"
            return "\n".join(hits) or "No matches."
        if b == "current_time":
            return json.dumps({"iso": time.strftime("%Y-%m-%dT%H:%M:%S%z"), "zone": time.strftime("%Z")})
        if b == "calculator":
            return calc(str(a.get("expression") or ""))
        if b == "web_fetch":
            code, ctype, text = http("GET", str(a.get("url") or ""))
            return f"HTTP {code}\n\n" + page_text(text, ctype)[:40_000]
        if b in ("memory_search", "memory_save"):
            from . import memory
            scope = ctx.get("scope") or (ctx.get("agent") or {}).get("id")
            if not scope:
                raise ValueError("no memory scope")
            if b == "memory_search":
                hits = memory.search(scope, str(a.get("query") or ""), max(1, min(int(a.get("limit") or 6), 30)), "hybrid")
                return "\n".join(f"- [{h['kind']}] {h['text'][:800]}" for h in hits) or "Nothing relevant in memory."
            agent = ctx.get("agent") or {}
            mc = memory.config(agent) if agent else {"type": "keyword", "embedProfile": "", "maxItems": 2000}
            kind2 = a.get("kind") if a.get("kind") in ("fact", "note") else "fact"
            memory.add(scope, str(a.get("text") or ""), kind2, a.get("tags") or [], source="agent", embed=mc["type"] in ("vector", "hybrid"), embed_profile=mc["embedProfile"], max_items=mc["maxItems"])
            return "Saved to memory."
        if b in containers.ALL:
            return containers.execute(b, a, ctx)
        if b == "firecrawl_scrape":
            r = fc_scrape(str(a.get("url") or ""))
            return f"# {r['title']}\n{r['url']}\n\n{r['markdown'][:40_000]}"
        if b == "firecrawl_search":
            rows = fc_search(str(a.get("query") or ""), int(a.get("limit") or 5))
            return "\n\n---\n\n".join(f"## {r['title']}\n{r['url']}\n\n{r['markdown'][:6000]}" for r in rows) or "No results."
        raise ValueError(f"unknown builtin {b}")
    if kind == "http":
        headers = {}
        for k, v in (cfg.get("headers") or {}).items():
            if v.startswith("env:"):
                val = os.environ.get(v[4:], "")
                if not val:
                    raise ValueError(f"environment variable {v[4:]} is not set")
                headers[k] = val
            else:
                headers[k] = _fill(v, a)
        url = _fill(str(cfg["url"]), a, url=True)
        body = None
        if cfg.get("body"):
            filled = _fill(cfg["body"] if isinstance(cfg["body"], str) else json.dumps(cfg["body"]), a)
            try:
                body = json.loads(filled)
            except ValueError:
                body = filled.encode()
        elif str(cfg.get("method", "GET")).upper() in ("POST", "PUT", "PATCH"):
            body = a
        code, ctype, text = http(str(cfg.get("method", "GET")), url, headers, body, timeout=float(cfg.get("timeout") or 30), allow_private=bool(cfg.get("allowPrivate")))
        return f"HTTP {code}\n\n" + (text if "json" in ctype else page_text(text, ctype))[:40_000]
    if kind == "mcp":
        return mcp_call(str(cfg["url"]), str(cfg.get("tokenEnv") or ""), tool=str(cfg["tool"]), args=a)[:40_000]
    if kind == "prompt":
        from . import llm
        out = llm.complete([{"role": "user", "content": _fill(str(cfg["template"]), a)}], system=cfg.get("system") or None, model_cfg={"model": cfg.get("model") or "", "profile": cfg.get("profile") or "", "temperature": cfg.get("temperature")})
        return out["text"]
    depth = int(ctx.get("depth") or 0)
    if kind == "agent":
        if depth >= contract.LIMITS["delegationDepth"]:
            raise ValueError(f"delegation depth limit reached ({contract.LIMITS['delegationDepth']})")
        return ctx["run_agent"](cfg["agentId"], str(a.get("task") or a.get("input") or json.dumps(a)), depth=depth + 1)["text"]
    if kind == "workflow":
        if depth >= contract.LIMITS["delegationDepth"]:
            raise ValueError(f"delegation depth limit reached ({contract.LIMITS['delegationDepth']})")
        return ctx["run_workflow"](cfg["workflowId"], str(a.get("input") or json.dumps(a)), depth=depth + 1)["output"]
    raise ValueError(f"unknown tool kind {kind}")
