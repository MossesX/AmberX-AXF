"""AI providers for any Python assistant host: one canonical chat format, three wire protocols (framework/python,
`axf.assistant_host.providers`; the console's ai-assistant plugin and Build Pilot's server run on it).

Provider kinds come from the framework registry framework/schemas/ai-providers.json (assistant@1, shared with the web
core and the Kotlin kernel) plus whatever the host's `extra_kinds()` hook returns (e.g. <dataDir>/providers.json).
Each kind names a protocol:
  anthropic   Anthropic Messages API (streaming SSE, tools, vision)
  openai      OpenAI Chat Completions and every compatible API (OpenAI, xAI Grok, Gemini, Mistral, Groq, DeepSeek,
              OpenRouter, Together, Fireworks, Perplexity, Cohere, Cerebras, Azure OpenAI v1, Ollama, LM Studio, vLLM …)
  claude-cli  Claude Code's CLI on a Claude subscription (ported from xGallery's subscription backend)
  <other>     registered by a module with `register_protocol(name, stream)` (open registry)

Canonical message: {"role": "user"|"assistant"|"tool", "content": str, "images": [{"media_type","data"}],
                    "tool_calls": [{"id","name","arguments": dict}], "tool_call_id": str}
Stream events:      {"type":"text","text"} · {"type":"tool_call","id","name","arguments"} · {"type":"usage","input","output"}
                    {"type":"stop","reason"} · {"type":"status","text"}

Only the standard library is used (urllib), so a host adds no dependencies to its image.

Host hooks (module attributes a host sets once at start; defaults are safe for any host):
  extra_kinds            () -> list of ai-providers@1 kinds merged over the registry (open registry)
  stored_secret_names    () -> names of environment variables the host loaded from its own credential store, removed
                         from the Claude Code CLI's environment along with every secret-looking variable
  PRIVATE_DIRS           folder names the CLI may never read (relative and absolute deny rules), e.g. ".axf-console"
  PRIVATE_ROOTS          () -> extra absolute roots whose private folders are denied (the host's repo root)
  ENV_PREFIXES_HIDDEN    env var prefixes dropped from the CLI's environment ("AXF_" + the host's own)
  USER_AGENT             the user-agent header sent to providers
  HOST_LABEL             how the host is named in error messages ("the console server", "the Build Pilot server")
"""
from __future__ import annotations

import json
import os
import re
import shutil
import ssl
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
from pathlib import Path
from typing import Any, Callable, Iterator

# ---------------------------------------------------------------- catalog (assistant@1: framework/schemas/ai-providers.json)

# framework/python/axf/assistant_host/providers.py → framework/schemas/ai-providers.json; AXF_PROVIDERS_FILE overrides
# (a host that bakes the schema elsewhere, e.g. Build Pilot's src/axf/schemas/, points here).
_SCHEMA = Path(os.environ.get("AXF_PROVIDERS_FILE") or Path(__file__).resolve().parents[3] / "schemas" / "ai-providers.json")

# ---------------------------------------------------------------- host hooks (see the module docstring)
extra_kinds: Callable[[], list[dict[str, Any]]] = lambda: []  # noqa: E731
stored_secret_names: Callable[[], set[str]] = lambda: set()  # noqa: E731
PRIVATE_DIRS: list[str] = [".axf-console"]
PRIVATE_ROOTS: Callable[[], set[str]] = lambda: set()  # noqa: E731
ENV_PREFIXES_HIDDEN: list[str] = ["AXF_"]
USER_AGENT = "AmberX-AXF-Assistant/1"
HOST_LABEL = "this server"


def _load_registry() -> list[dict[str, Any]]:
    try:
        reg = json.loads(_SCHEMA.read_text())
        base = [p for p in reg.get("providers", []) if isinstance(p, dict) and p.get("kind")]
    except (OSError, ValueError):
        base = []
    try:
        extra = [p for p in extra_kinds() if isinstance(p, dict) and isinstance(p.get("kind"), str) and p.get("kind")]
    except Exception:  # noqa: BLE001
        extra = []
    out: dict[str, dict[str, Any]] = {}
    for p in [*base, *extra]:  # later kinds with the same id replace earlier ones (open registry)
        out[str(p["kind"])] = p
    return list(out.values())


CATALOG: list[dict[str, Any]] = _load_registry()
BY_KIND: dict[str, dict[str, Any]] = {c["kind"]: c for c in CATALOG}


def reload_catalog() -> None:
    """Re-read the registry (after the host's extra kinds changed)."""
    CATALOG[:] = _load_registry()
    BY_KIND.clear()
    BY_KIND.update({c["kind"]: c for c in CATALOG})


def kind(k: str) -> dict[str, Any]:
    return BY_KIND.get(k or "", {})


TIMEOUT = float(os.environ.get("AXF_AI_TIMEOUT", "300"))
_SSL = ssl.create_default_context()

# Wire protocols by name (open registry): a module may register another with `register_protocol`.
PROTOCOLS: dict[str, Callable[..., Iterator[dict[str, Any]]]] = {}


def register_protocol(name: str, stream: Callable[..., Iterator[dict[str, Any]]]) -> None:
    """stream(profile, messages, system, model, tools, params, cancel, **extra) -> provider events."""
    PROTOCOLS[name] = stream


class ProviderError(Exception):
    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.status = status


# ---------------------------------------------------------------- profile helpers

def resolve_key(profile: dict[str, Any]) -> str:
    """Stored key first, then the profile's environment variable. Never logged, never returned to the browser."""
    if profile.get("key"):
        return str(profile["key"])
    env = profile.get("keyEnv") or BY_KIND.get(profile.get("kind", ""), {}).get("keyEnv") or ""
    return os.environ.get(env, "") if env else ""


def protocol_of(profile: dict[str, Any]) -> str:
    return BY_KIND.get(profile.get("kind", ""), {}).get("protocol", "openai")


def _headers(profile: dict[str, Any], key: str) -> dict[str, str]:
    h = {"content-type": "application/json", "user-agent": USER_AGENT}
    auth = profile.get("auth") or BY_KIND.get(profile.get("kind", ""), {}).get("auth", "bearer")
    if key:
        if auth == "x-api-key":
            h["x-api-key"] = key
        elif auth == "api-key":
            h["api-key"] = key
        elif auth != "none":
            h["authorization"] = f"Bearer {key}"
    if protocol_of(profile) == "anthropic":
        h["anthropic-version"] = "2023-06-01"
    for k, v in {**BY_KIND.get(profile.get("kind", ""), {}).get("headers", {}), **(profile.get("headers") or {})}.items():
        if isinstance(k, str) and isinstance(v, str) and k.lower() not in ("authorization", "x-api-key", "api-key"):
            h[k] = v
    return h


def _base(profile: dict[str, Any]) -> str:
    return (profile.get("baseUrl") or BY_KIND.get(profile.get("kind", ""), {}).get("baseUrl") or "").rstrip("/")


def _open(url: str, headers: dict[str, str], body: Any | None = None, timeout: float = TIMEOUT):
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method="POST" if data is not None else "GET")
    try:
        return urllib.request.urlopen(req, timeout=timeout, context=_SSL)  # noqa: S310 — URL comes from the owner's profile
    except urllib.error.HTTPError as e:
        detail = ""
        try:
            raw = e.read().decode("utf-8", "replace")
            j = json.loads(raw)
            err = j.get("error", j)
            detail = err.get("message") if isinstance(err, dict) else str(err)
        except Exception:  # noqa: BLE001
            detail = e.reason if isinstance(e.reason, str) else ""
        raise ProviderError(f"HTTP {e.code}: {str(detail)[:400]}", 401 if e.code in (401, 403) else 502) from None
    except urllib.error.URLError as e:
        raise ProviderError(f"cannot reach {url.split('?')[0]}: {e.reason}") from None
    except TimeoutError:
        raise ProviderError("the provider did not answer in time") from None


def _sse(resp) -> Iterator[tuple[str, str]]:
    """(event, data) pairs from a server-sent-event response."""
    event, data = "message", []
    for raw in resp:
        line = raw.decode("utf-8", "replace").rstrip("\r\n")
        if not line:
            if data:
                yield event, "\n".join(data)
            event, data = "message", []
            continue
        if line.startswith(":"):
            continue
        if line.startswith("event:"):
            event = line[6:].strip()
        elif line.startswith("data:"):
            data.append(line[5:].lstrip())
    if data:
        yield event, "\n".join(data)


# ---------------------------------------------------------------- model lists + test

def list_models(profile: dict[str, Any]) -> list[str]:
    cat = BY_KIND.get(profile.get("kind", ""), {})
    proto = protocol_of(profile)
    if proto == "claude-cli" or cat.get("noModelList"):
        return list(dict.fromkeys([*(profile.get("models") or []), *cat.get("models", [])]))
    key = resolve_key(profile)
    base = _base(profile)
    if proto == "anthropic":
        with _open(f"{base}/v1/models?limit=100", _headers(profile, key), timeout=30) as r:
            return [m["id"] for m in json.loads(r.read()).get("data", []) if m.get("id")]
    if profile.get("kind") == "ollama":
        try:
            with _open(base.removesuffix("/v1") + "/api/tags", _headers(profile, key), timeout=15) as r:
                return [m["name"] for m in json.loads(r.read()).get("models", []) if m.get("name")]
        except ProviderError:
            pass
    with _open(f"{base}/models", _headers(profile, key), timeout=30) as r:
        j = json.loads(r.read())
    items = j.get("data", j.get("models", [])) if isinstance(j, dict) else j
    out = [(m.get("id") or m.get("name") or "").removeprefix("models/") for m in items if isinstance(m, dict)]
    return sorted({m for m in out if m})


def test_profile(profile: dict[str, Any], model: str | None = None) -> dict[str, Any]:
    started = time.monotonic()
    text, usage = "", {}
    for ev in stream_chat(profile, [{"role": "user", "content": "Reply with exactly: OK"}], system="You are a connection test.",
                          model=model, params={"max_tokens": 16, "temperature": 0}):
        if ev["type"] == "text":
            text += ev["text"]
        elif ev["type"] == "usage":
            usage = ev
    return {"ok": True, "reply": text.strip()[:80], "ms": int((time.monotonic() - started) * 1000), "usage": usage}


# ---------------------------------------------------------------- canonical → wire

def _to_anthropic(messages: list[dict[str, Any]]) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            block = {"type": "tool_result", "tool_use_id": m.get("tool_call_id", ""), "content": str(m.get("content", ""))}
            if m.get("is_error"):
                block["is_error"] = True
            if out and out[-1]["role"] == "user" and isinstance(out[-1]["content"], list) and all(b.get("type") == "tool_result" for b in out[-1]["content"]):
                out[-1]["content"].append(block)
            else:
                out.append({"role": "user", "content": [block]})
            continue
        blocks: list[dict[str, Any]] = [dict(b) for b in (m.get("thinking_blocks") or []) if role == "assistant"]
        for img in m.get("images") or []:
            blocks.append({"type": "image", "source": {"type": "base64", "media_type": img.get("media_type", "image/png"), "data": img.get("data", "")}})
        if m.get("content"):
            blocks.append({"type": "text", "text": str(m["content"])})
        for tc in m.get("tool_calls") or []:
            blocks.append({"type": "tool_use", "id": tc["id"], "name": tc["name"], "input": tc.get("arguments") or {}})
        if not blocks:
            blocks = [{"type": "text", "text": "(empty)"}]
        r = "assistant" if role == "assistant" else "user"
        if out and out[-1]["role"] == r and r == "user" and not any(b.get("type") == "tool_result" for b in out[-1]["content"]):
            out[-1]["content"].extend(blocks)
        else:
            out.append({"role": r, "content": blocks})
    return out


def _to_openai(messages: list[dict[str, Any]], system: str | None) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = [{"role": "system", "content": system}] if system else []
    for m in messages:
        role = m.get("role")
        if role == "tool":
            out.append({"role": "tool", "tool_call_id": m.get("tool_call_id", ""), "content": str(m.get("content", ""))})
            continue
        if role == "assistant":
            msg: dict[str, Any] = {"role": "assistant", "content": m.get("content") or ""}
            if m.get("tool_calls"):
                msg["tool_calls"] = [{"id": tc["id"], "type": "function", "function": {"name": tc["name"], "arguments": json.dumps(tc.get("arguments") or {})}} for tc in m["tool_calls"]]
            out.append(msg)
            continue
        if m.get("images"):
            parts: list[dict[str, Any]] = [{"type": "text", "text": str(m.get("content") or "")}]
            parts += [{"type": "image_url", "image_url": {"url": f"data:{i.get('media_type', 'image/png')};base64,{i.get('data', '')}"}} for i in m["images"]]
            out.append({"role": "user", "content": parts})
        else:
            out.append({"role": "user", "content": str(m.get("content") or "")})
    return out


# ---------------------------------------------------------------- streaming chat

def stream_chat(profile: dict[str, Any], messages: list[dict[str, Any]], *, system: str | None = None, model: str | None = None,
                tools: list[dict[str, Any]] | None = None, params: dict[str, Any] | None = None,
                cancel: threading.Event | None = None, cwd: str | None = None,
                tool_runner: Callable[[str, dict[str, Any]], tuple[bool, str]] | None = None,
                read_files: bool = True) -> Iterator[dict[str, Any]]:
    """Stream one model call. ``read_files=False`` (hub users without assistant.tools): the Claude Code CLI gets no
    file tools, an empty working folder and a throwaway config folder, so it can't read the server's files or
    earlier sessions' transcripts. Tools are [{name, description, parameters (JSON Schema)}]; tool execution is the caller's job.
    ``tool_runner(name, args) -> (ok, text)`` is for providers that run their own tool loop (the Claude Code CLI)."""
    proto = protocol_of(profile)
    model = model or profile.get("defaultModel") or (kind(profile.get("kind", "")).get("models") or [""])[0]
    if not model:
        raise ProviderError("no model selected for this provider", 400)
    params = params or {}
    if proto == "anthropic":
        yield from _stream_anthropic(profile, messages, system, model, tools, params, cancel)
    elif proto == "claude-cli":
        yield from _stream_cli(profile, messages, system, model, params, cancel, cwd, tools=tools, tool_runner=tool_runner, read_files=read_files)
    elif proto == "openai":
        yield from _stream_openai(profile, messages, system, model, tools, params, cancel)
    elif proto in PROTOCOLS:
        yield from PROTOCOLS[proto](profile, messages, system, model, tools, params, cancel, cwd=cwd, tool_runner=tool_runner, read_files=read_files)
    else:
        raise ProviderError(f"no driver for protocol {proto}", 400)


def _stream_anthropic(profile, messages, system, model, tools, params, cancel):
    key = resolve_key(profile)
    if not key:
        raise ProviderError("no API key: add one in the profile or set its environment variable", 400)
    if key.startswith("sk-ant-oat"):
        raise ProviderError("this profile holds a Claude Code subscription token (sk-ant-oat…), which the Anthropic API rejects. Move it to the “Claude Code (subscription)” provider and give this one an API key (sk-ant-api…) from console.anthropic.com", 400)
    body: dict[str, Any] = {"model": model, "max_tokens": int(params.get("max_tokens") or 8192), "messages": _to_anthropic(messages), "stream": True}
    if system:
        body["system"] = [{"type": "text", "text": system, "cache_control": {"type": "ephemeral"}}]
    if params.get("temperature") is not None:
        body["temperature"] = float(params["temperature"])
    if params.get("top_p") is not None:
        body["top_p"] = float(params["top_p"])
    if params.get("stop"):
        body["stop_sequences"] = list(params["stop"])[:4]
    if tools:
        body["tools"] = [{"name": t["name"], "description": t.get("description", ""), "input_schema": t.get("parameters") or {"type": "object", "properties": {}}} for t in tools]
    if params.get("thinking"):
        budget = max(1024, int(params.get("thinking_budget") or 4096))
        body["thinking"] = {"type": "enabled", "budget_tokens": budget}
        body["max_tokens"] = max(body["max_tokens"], budget + 2048)  # the API requires budget < max_tokens
        body.pop("temperature", None)
        body.pop("top_p", None)
    blocks: dict[int, dict[str, Any]] = {}
    usage = {"input": 0, "output": 0}
    with _open(f"{_base(profile)}/v1/messages", _headers(profile, key), body) as resp:
        for event, data in _sse(resp):
            if cancel and cancel.is_set():
                yield {"type": "stop", "reason": "cancelled"}
                return
            try:
                j = json.loads(data)
            except ValueError:
                continue
            t = j.get("type", event)
            if t == "message_start":
                u = j.get("message", {}).get("usage", {})
                usage["input"] = int(u.get("input_tokens", 0)) + int(u.get("cache_read_input_tokens", 0) or 0) + int(u.get("cache_creation_input_tokens", 0) or 0)
            elif t == "content_block_start":
                b = j.get("content_block", {})
                blocks[j.get("index", 0)] = {"type": b.get("type"), "id": b.get("id"), "name": b.get("name"), "json": "", "thinking": "", "signature": "", "data": b.get("data")}
            elif t == "content_block_delta":
                d = j.get("delta", {})
                if d.get("type") == "text_delta":
                    yield {"type": "text", "text": d.get("text", "")}
                elif d.get("type") == "input_json_delta":
                    blocks.setdefault(j.get("index", 0), {"json": ""})["json"] += d.get("partial_json", "")
                elif d.get("type") == "thinking_delta":
                    blocks.setdefault(j.get("index", 0), {"json": "", "thinking": "", "signature": ""})["thinking"] += d.get("thinking", "")
                    yield {"type": "thinking", "text": d.get("thinking", "")}
                elif d.get("type") == "signature_delta":
                    blocks.setdefault(j.get("index", 0), {"json": "", "thinking": "", "signature": ""})["signature"] += d.get("signature", "")
            elif t == "content_block_stop":
                b = blocks.get(j.get("index", 0))
                if b and b.get("type") == "tool_use":
                    try:
                        args = json.loads(b["json"]) if b["json"] else {}
                    except ValueError:
                        args = {}
                    yield {"type": "tool_call", "id": b["id"], "name": b["name"], "arguments": args}
                elif b and b.get("type") == "thinking":
                    yield {"type": "thinking_block", "block": {"type": "thinking", "thinking": b["thinking"], "signature": b["signature"]}}
                elif b and b.get("type") == "redacted_thinking":
                    yield {"type": "thinking_block", "block": {"type": "redacted_thinking", "data": b.get("data") or ""}}
            elif t == "message_delta":
                usage["output"] = int(j.get("usage", {}).get("output_tokens", usage["output"]))
                if j.get("delta", {}).get("stop_reason"):
                    yield {"type": "usage", **usage}
                    yield {"type": "stop", "reason": j["delta"]["stop_reason"]}
            elif t == "error":
                raise ProviderError(str(j.get("error", {}).get("message", "stream error")))


def _stream_openai(profile, messages, system, model, tools, params, cancel):
    key = resolve_key(profile)
    auth = profile.get("auth") or BY_KIND.get(profile.get("kind", ""), {}).get("auth", "bearer")
    if not key and auth not in ("none",) and not BY_KIND.get(profile.get("kind", ""), {}).get("local"):
        raise ProviderError("no API key: add one in the profile or set its environment variable", 400)
    body: dict[str, Any] = {"model": model, "messages": _to_openai(messages, system), "stream": True}
    if not kind(profile.get("kind", "")).get("noStreamUsage"):
        body["stream_options"] = {"include_usage": True}
    if params.get("max_tokens"):
        body[kind(profile.get("kind", "")).get("maxTokensField") or "max_tokens"] = int(params["max_tokens"])
    for k in ("temperature", "top_p", "presence_penalty", "frequency_penalty"):
        if params.get(k) is not None:
            body[k] = float(params[k])
    if params.get("stop"):
        body["stop"] = list(params["stop"])[:4]
    if params.get("seed") is not None:
        body["seed"] = int(params["seed"])
    if params.get("reasoning_effort"):
        body["reasoning_effort"] = params["reasoning_effort"]
    if tools and BY_KIND.get(profile.get("kind", ""), {}).get("tools", True):
        body["tools"] = [{"type": "function", "function": {"name": t["name"], "description": t.get("description", ""), "parameters": t.get("parameters") or {"type": "object", "properties": {}}}} for t in tools]
    calls: dict[int, dict[str, Any]] = {}
    finish = None
    usage_sent = False
    with _open(f"{_base(profile)}/chat/completions", _headers(profile, key), body) as resp:
        for _event, data in _sse(resp):
            if cancel and cancel.is_set():
                yield {"type": "stop", "reason": "cancelled"}
                return
            if data.strip() == "[DONE]":
                break
            try:
                j = json.loads(data)
            except ValueError:
                continue
            if j.get("error"):
                raise ProviderError(str(j["error"].get("message") if isinstance(j["error"], dict) else j["error"]))
            if j.get("usage"):
                u = j["usage"]
                yield {"type": "usage", "input": int(u.get("prompt_tokens", 0) or 0), "output": int(u.get("completion_tokens", 0) or 0)}
                usage_sent = True
            for ch in j.get("choices") or []:
                d = ch.get("delta") or {}
                if d.get("reasoning_content"):
                    yield {"type": "thinking", "text": d["reasoning_content"]}
                if d.get("content"):
                    yield {"type": "text", "text": d["content"]}
                for tc in d.get("tool_calls") or []:
                    slot = calls.setdefault(int(tc.get("index", 0)), {"id": "", "name": "", "args": ""})
                    slot["id"] = tc.get("id") or slot["id"]
                    fn = tc.get("function") or {}
                    slot["name"] = fn.get("name") or slot["name"]
                    slot["args"] += fn.get("arguments") or ""
                if ch.get("finish_reason"):
                    finish = ch["finish_reason"]
    for i in sorted(calls):
        c = calls[i]
        try:
            args = json.loads(c["args"]) if c["args"] else {}
        except ValueError:
            args = {"_raw": c["args"]}
        yield {"type": "tool_call", "id": c["id"] or f"call_{i}", "name": c["name"], "arguments": args}
    if not usage_sent:
        yield {"type": "usage", "input": 0, "output": 0}
    yield {"type": "stop", "reason": "tool_use" if calls else (finish or "stop")}


# ---------------------------------------------------------------- Claude Code CLI (subscription)

def cli_available() -> bool:
    return shutil.which(os.environ.get("CLAUDE_BIN", "claude")) is not None


_DENY_PATTERNS = ("**/.env", "**/.env.*", "**/*.pem", "**/*.key", "**/secrets.env", "**/credentials.json", "**/id_rsa*", "**/id_ed25519*", ".git/**")


def _cli_deny() -> list[str]:
    """Relative deny rules: the host's private folders anywhere under the working tree, env files, keys, git internals."""
    pats = [p for d in PRIVATE_DIRS for p in (f"{d}/**", f"**/{d}/**")] + list(_DENY_PATTERNS)
    return [f"{tool}({pat})" for tool in ("Read", "Grep", "Glob", "LS") for pat in pats]


_SECRETISH = re.compile(r"(TOKEN|SECRET|PASSWORD|PASSWD|CREDENTIAL|PRIVATE|(^|_)KEY$|_KEY_|API_KEY|AUTH)", re.I)
_ENV_KEEP = {"PATH", "HOME", "LANG", "LC_ALL", "LC_CTYPE", "TZ", "SHELL", "USER", "LOGNAME", "HOSTNAME", "PWD", "NODE_VERSION", "PYTHON_VERSION", "CLAUDE_BIN", "XDG_CONFIG_HOME"}


def _cli_env() -> dict[str, str]:
    """The host's environment minus every secret-looking variable, every credential the host says it loaded
    (`stored_secret_names`) and every hidden prefix, so nothing the CLI reads (e.g. /proc/self/environ) holds a key."""
    try:
        stored = set(stored_secret_names())
    except Exception:  # noqa: BLE001
        stored = set()
    hidden = tuple(ENV_PREFIXES_HIDDEN)
    return {k: v for k, v in os.environ.items() if k in _ENV_KEEP or (not _SECRETISH.search(k) and k not in stored and not k.startswith(hidden))}


def _cli_abs_deny(cwd: str | None) -> list[str]:
    """Absolute-path deny rules (Claude Code's `//abs/path` form): process info, the host's private folders, keys."""
    roots = {os.path.abspath(cwd or os.getcwd())}
    try:
        roots |= {os.path.abspath(str(r)) for r in PRIVATE_ROOTS()}
    except Exception:  # noqa: BLE001
        pass
    pats = ["//proc/**", "//sys/**", "//etc/shadow", "~/.ssh/**", "~/.anthropic-key", "~/.claude/.credentials.json", "~/.config/gh/**"]
    pats += [f"/{r}/{d}/**" for r in sorted(roots) for d in PRIVATE_DIRS]
    return [f"{tool}({pat})" for tool in ("Read", "Grep", "Glob", "LS") for pat in pats]


CLI_DEADLINE = float(os.environ.get("AXF_AI_CLI_TIMEOUT", "600"))


class _Bridge:
    """Per-turn unix socket the CLI's MCP bridge (cli_bridge.py) calls back on. Results go to the turn engine's runner;
    each finished call is queued so the stream can report it as a ``tool_done`` event."""

    def __init__(self, tools: list[dict[str, Any]], runner: Callable[[str, dict[str, Any]], tuple[bool, str]]):
        import queue
        import socket
        import tempfile
        self.dir = tempfile.mkdtemp(prefix="axf-bridge-")
        os.chmod(self.dir, 0o700)
        self.sock_path = os.path.join(self.dir, "b.sock")
        self.tools_path = os.path.join(self.dir, "tools.json")
        self.config_path = os.path.join(self.dir, "mcp.json")
        with open(self.tools_path, "w", encoding="utf-8") as f:
            json.dump([{"name": t["name"], "description": t.get("description", ""), "parameters": t.get("parameters")} for t in tools], f)
        with open(self.config_path, "w", encoding="utf-8") as f:
            json.dump({"mcpServers": {"axf": {"type": "stdio", "command": sys.executable, "args": [str(Path(__file__).with_name("cli_bridge.py"))],
                                              "env": {"AXF_BRIDGE_SOCKET": self.sock_path, "AXF_BRIDGE_TOOLS": self.tools_path}}}}, f)
        self.events: "queue.Queue[dict[str, Any]]" = queue.Queue()
        self.runner = runner
        self.srv = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.srv.bind(self.sock_path)
        os.chmod(self.sock_path, 0o600)
        self.srv.listen(4)
        self.n = 0
        self.closed = False
        threading.Thread(target=self._serve, daemon=True).start()

    def _serve(self) -> None:
        while not self.closed:
            try:
                conn, _ = self.srv.accept()
            except OSError:
                return
            threading.Thread(target=self._one, args=(conn,), daemon=True).start()

    def _one(self, conn) -> None:
        try:
            buf = b""
            while not buf.endswith(b"\n") and len(buf) < 20_000_000:
                chunk = conn.recv(65536)
                if not chunk:
                    break
                buf += chunk
            req = json.loads(buf or b"{}")
            name, args = str(req.get("name") or ""), req.get("arguments") or {}
            ok, text = self.runner(name, args if isinstance(args, dict) else {})
            self.n += 1
            self.events.put({"type": "tool_done", "id": f"cli_{self.n}", "name": name, "arguments": args, "ok": ok, "result": text})
            conn.sendall((json.dumps({"ok": ok, "text": text}) + "\n").encode())
        except (OSError, ValueError):
            pass
        finally:
            conn.close()

    def drain(self) -> Iterator[dict[str, Any]]:
        while not self.events.empty():
            yield self.events.get_nowait()

    def close(self) -> None:
        self.closed = True
        try:
            self.srv.close()
        except OSError:
            pass
        shutil.rmtree(self.dir, ignore_errors=True)


_SECRET_TEXT = re.compile(r"(sk-ant-[A-Za-z0-9_-]{8,}|gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,}|(?i:bearer)\s+[A-Za-z0-9._~+/=-]{16,})")


def _redact(text: str) -> str:
    return _SECRET_TEXT.sub("[redacted]", text)


def cli_error_message(text: str | None, status: int | None, model: str, code: int | None = None, stderr: str = "", stdout: list[str] | None = None) -> tuple[str, int]:
    """Turn what Claude Code said (its error result, the API status it retried on, stderr, stray stdout) into one
    message a person can act on, with the HTTP-ish status the turn engine uses for the fallback chain."""
    said = " ".join(x for x in [_redact((text or "").strip()), _redact(stderr.strip()) if stderr else "", *(_redact(x) for x in stdout or [])] if x).strip()
    said = re.sub(r"\s+", " ", said)[:400]
    low = said.lower()
    if status == 401 or re.search(r"invalid api key|please run /login|oauth|unauthori[sz]ed|failed to authenticate|\b401\b", low):
        return ("Claude Code rejected the token. Run `claude setup-token` on the VPS (sign in when asked), copy the long-lived sk-ant-oat01-… token it prints, and paste it into this provider (Edit → Save & test). A token copied from ~/.claude after /login expires and won't work here", 400)
    if status == 404 or re.search(r"model.{0,60}(not found|not available|does not exist|may not exist|not have access|invalid|isn't available|not supported)|unknown model|\b404\b", low):
        return (f"Claude Code can't use the model `{model}` with this account. Pick another model for this profile (Edit → Model) or set the profile's default to one your plan includes" + (f". Claude Code said: {said}" if said else ""), 400)
    if status in (429, 529) or re.search(r"usage limit|rate limit|limit reached|overloaded|too many requests|\b429\b|\b529\b", low):
        return ("Claude Code hit a usage or rate limit" + (f": {said}" if said else "") + ". Try again later, or let the fallback chain move to another provider", 429)
    if status == 403 or re.search(r"forbidden|permission denied|not allowed|\b403\b", low):
        return ("Claude Code was refused (403)" + (f": {said}" if said else "") + ". Check that the token belongs to an account with Claude Code access", 403)
    if said:
        return (f"Claude Code failed" + (f" (exit code {code})" if code else "") + f": {said}", 502)
    return (f"Claude Code exited with code {code} without saying why. On {HOST_LABEL}, run `claude -p hi` as the console's user to see the error (a missing sign-in, an outdated CLI or a full disk are the usual causes)", 502)


def _stream_cli(profile, messages, system, model, params, cancel, cwd, tools=None, tool_runner=None, read_files=True):
    import tempfile
    token = resolve_key(profile)
    if not token:
        raise ProviderError("no Claude Code token: run `claude setup-token` and paste it, or set CLAUDE_CODE_OAUTH_TOKEN", 400)
    if token.startswith("sk-ant-api"):
        raise ProviderError("this profile holds an Anthropic API key (sk-ant-api…). The subscription provider needs a Claude Code token: run `claude setup-token` on the VPS and paste the sk-ant-oat01-… token it prints. Put the API key in the “Anthropic (Claude)” provider instead", 400)
    if not cli_available():
        raise ProviderError(f"the `claude` CLI is not installed on {HOST_LABEL}", 400)
    # The CLI keeps no session for us here: earlier turns go in as a transcript, on stdin (no argv size limit).
    history = "\n\n".join(f"{m['role'].upper()}: {m.get('content', '')}" for m in messages[:-1] if m.get("role") in ("user", "assistant"))
    prompt = (f"Conversation so far:\n{history}\n\nUSER: " if history else "") + str(messages[-1].get("content", ""))
    args = [os.environ.get("CLAUDE_BIN", "claude"), "-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages",
            "--model", model, "--permission-mode", "default", "--allowedTools", "Read", "Grep", "Glob", "LS",
            "--disallowedTools", "Edit", "Write", "MultiEdit", "NotebookEdit", "Bash", "WebFetch", *_cli_deny()]
    bridge = _Bridge(tools, tool_runner) if tools and tool_runner else None
    if bridge:
        # The host's tools as an MCP server (same rules and approval cards as API providers); the CLI's own
        # Edit/Write/Bash stay off.
        i = args.index("--disallowedTools")
        args[i:i] = ["mcp__axf"]
        args += ["--mcp-config", bridge.config_path, "--strict-mcp-config"]
    if system:
        args += ["--append-system-prompt", system[:100_000]]
    env = {**_cli_env(), "CLAUDE_CODE_OAUTH_TOKEN": token, "CI": "1", "TERM": "dumb", "MCP_TOOL_TIMEOUT": "900000"}
    args[args.index("--disallowedTools") + 1:args.index("--disallowedTools") + 1] = _cli_abs_deny(cwd)
    jail = None
    if not read_files:
        # No file tools at all, an empty folder to run in, and a config folder that is thrown away afterwards.
        i = args.index("--allowedTools")
        j = args.index("--disallowedTools")
        kept = [a for a in args[i + 1:j] if a.startswith("mcp__")]
        args[i:j] = (["--allowedTools", *kept] if kept else [])
        k = args.index("--disallowedTools")
        args[k + 1:k + 1] = ["Read", "Grep", "Glob", "LS", "Task", "WebSearch"]
        jail = tempfile.mkdtemp(prefix="axf-cli-jail-")
        os.chmod(jail, 0o700)
        cwd = jail
        env.update({"HOME": jail, "CLAUDE_CONFIG_DIR": os.path.join(jail, ".claude")})
    err = tempfile.TemporaryFile(mode="w+")
    try:
        proc = subprocess.Popen(args, cwd=cwd or os.getcwd(), env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=err, text=True, start_new_session=True)
    except OSError:
        err.close()
        if bridge:
            bridge.close()
        if jail:
            shutil.rmtree(jail, ignore_errors=True)
        raise
    killer = threading.Timer(CLI_DEADLINE, proc.kill)
    killer.start()
    streamed = 0
    cli_error: str | None = None  # what Claude Code itself said went wrong (result / synthetic message)
    status_code: int | None = None
    loose: list[str] = []  # stdout lines that aren't JSON (older CLIs print argument errors there)
    try:
        try:
            proc.stdin.write(prompt)  # type: ignore[union-attr]
            proc.stdin.close()  # type: ignore[union-attr]
        except BrokenPipeError:
            pass
        for line in proc.stdout:  # type: ignore[union-attr]
            if bridge:
                yield from bridge.drain()
            if cancel and cancel.is_set():
                proc.terminate()
                yield {"type": "stop", "reason": "cancelled"}
                return
            try:
                ev = json.loads(line)
            except ValueError:
                if line.strip():
                    loose = (loose + [line.strip()[:300]])[-5:]
                continue
            if not isinstance(ev, dict):
                continue
            t = ev.get("type")
            if t == "stream_event":
                e = ev.get("event") or {}
                d = e.get("delta") or {}
                if e.get("type") == "content_block_delta" and d.get("type") == "text_delta" and d.get("text"):
                    streamed += len(d["text"])
                    yield {"type": "text", "text": d["text"]}
            elif t == "system" and ev.get("subtype") == "api_retry" and isinstance(ev.get("error_status"), int):
                status_code = ev["error_status"]
            elif t == "assistant":
                msg = ev.get("message") or {}
                if msg.get("model") == "<synthetic>" and streamed == 0:
                    # an error Claude Code made up a reply for (failed sign-in, API error): keep it as the reason
                    cli_error = " ".join(str(b.get("text") or "") for b in msg.get("content") or [] if b.get("type") == "text").strip() or cli_error
                    continue
                for b in msg.get("content") or []:
                    if b.get("type") == "tool_use":
                        inp = b.get("input") or {}
                        hint = next((str(inp[k]) for k in ("file_path", "path", "pattern", "query") if isinstance(inp.get(k), str)), "")
                        yield {"type": "status", "text": f"{b.get('name')} {hint}".strip()}
                    elif b.get("type") == "text" and b.get("text") and streamed == 0:
                        yield {"type": "text", "text": b["text"]}
            elif t == "result":
                u = ev.get("usage") or {}
                yield {"type": "usage", "input": int(u.get("input_tokens", 0) or 0), "output": int(u.get("output_tokens", 0) or 0)}
                if ev.get("is_error") and streamed == 0:
                    if isinstance(ev.get("api_error_status"), int):
                        status_code = ev["api_error_status"]
                    raise ProviderError(*cli_error_message(ev.get("result") if isinstance(ev.get("result"), str) else cli_error, status_code, model))
        proc.wait(timeout=10)
        if bridge:
            yield from bridge.drain()
        if proc.returncode and streamed == 0:
            err.seek(0)
            raise ProviderError(*cli_error_message(cli_error, status_code, model, code=proc.returncode, stderr=err.read()[-600:], stdout=loose))
        yield {"type": "stop", "reason": "end_turn"}
    finally:
        killer.cancel()
        if proc.poll() is None:
            proc.kill()
        err.close()
        if bridge:
            bridge.close()
        if jail:
            shutil.rmtree(jail, ignore_errors=True)


# ---------------------------------------------------------------- embeddings (for agent memory)

def embed(profile: dict[str, Any], texts: list[str], model: str | None = None) -> list[list[float]]:
    proto = protocol_of(profile)
    if proto != "openai":
        raise ProviderError("embeddings need an OpenAI-compatible provider (OpenAI, Ollama, Mistral, Together …)", 400)
    model = model or profile.get("embedModel") or kind(profile.get("kind", "")).get("embedModel") or "text-embedding-3-small"
    with _open(f"{_base(profile)}/embeddings", _headers(profile, resolve_key(profile)), {"model": model, "input": texts[:64]}, timeout=60) as r:
        data = json.loads(r.read()).get("data", [])
    return [d.get("embedding", []) for d in sorted(data, key=lambda d: d.get("index", 0))]


def collect(events: Iterator[dict[str, Any]], on_event: Callable[[dict[str, Any]], None] | None = None) -> dict[str, Any]:
    """Drain a stream into {text, tool_calls, usage, stop}."""
    out: dict[str, Any] = {"text": "", "tool_calls": [], "usage": {"input": 0, "output": 0}, "stop": None}
    for ev in events:
        if on_event:
            on_event(ev)
        if ev["type"] == "text":
            out["text"] += ev["text"]
        elif ev["type"] == "tool_call":
            out["tool_calls"].append({"id": ev["id"], "name": ev["name"], "arguments": ev.get("arguments") or {}})
        elif ev["type"] == "usage":
            out["usage"] = {"input": ev.get("input", 0), "output": ev.get("output", 0)}
        elif ev["type"] == "thinking_block":
            out.setdefault("thinking_blocks", []).append(ev["block"])
        elif ev["type"] == "stop":
            out["stop"] = ev.get("reason")
    return out
