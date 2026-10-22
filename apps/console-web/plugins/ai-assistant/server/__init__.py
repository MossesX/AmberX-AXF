"""AI assistant — server part (Fable rebuild, Oct 20 2026). Mounted at /api/plugins/ai-assistant/ (console token on
every method, 404 when disabled, never on the console MCP).

The console's host of the framework's assistant contract (assistant@1: framework/core/assistant.ts = Kotlin
ai.amberx.axf.kernel.assistant = Python `axf.contracts.assistant`) on the framework's Python host runtime
(`axf.assistant_host`: providers, live-session hosts, safety; framework/python, harvested Oct 21 2026 — this folder
keeps only what is console-specific). Ported from xGallery's assistant and extended: providers from the
shared registry with a fallback chain, a setup wizard, per-conversation settings, regenerate / edit / fork, prompt
library, image attachments, model comparison, usage and budgets, export / import, secret redaction, agent
integration, write-mode change batches, the Claude Code MCP bridge, live sessions and hub users.

Integration (plugin_services, capability names only — never another plugin's folder):
  provides  axf.llm@1            complete(), embed(), profiles() for any plugin that needs a model (the agent manager uses it)
  provides  axf.live-sessions@1  read-only session views + register_host() for new session hosts
  consumes  axf.agents@1         when an agent manager is installed: chat *as* one of its agents (its prompt, tools, memory)
  consumes  axf.containers@1     change batches (approval cards) for write-mode agents
  consumes  axf.live-host@1      a module's session host (e.g. axHub's workers) replaces the axHub placeholder
"""
from __future__ import annotations

import json
import re
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Iterator

from contextvars import ContextVar

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import HTMLResponse, PlainTextResponse, StreamingResponse

import plugin_services
import wall

_PY = Path(__file__).resolve().parents[5] / "framework" / "python"
if str(_PY) not in sys.path:
    sys.path.insert(0, str(_PY))

from axf.assistant_host import providers, sessions  # noqa: E402
from axf.contracts import assistant as contract  # noqa: E402

from . import store, tools  # noqa: E402

# Host hooks of the shared runtime: what makes this host the console (never a copy of the runtime).
providers.extra_kinds = store.extra_provider_kinds
providers.HOST_LABEL = "the console server"
providers.PRIVATE_DIRS = [".axf-console"]


def _stored_secret_names() -> set[str]:
    """Names of credentials the console's core credential store loaded into os.environ (never given to the CLI)."""
    try:
        import credentials
        return set((credentials.STORE.read() if credentials.STORE else {}).keys())
    except Exception:  # noqa: BLE001
        return set()


def _private_roots() -> set[str]:
    try:
        import console_context as cx
        return {str(cx.ROOT)}
    except Exception:  # noqa: BLE001
        return set()


providers.stored_secret_names = _stored_secret_names
providers.PRIVATE_ROOTS = _private_roots
providers.reload_catalog()  # the registry is read once at import with the default hooks; read again with ours

# ---------------------------------------------------------------- who may do what (hub users behind the wall)
# The console lets hub *users* into this plugin ("wallUsers": true). Admins (and the console token) can do
# everything. Users get plain chat in their own conversations; their extra permissions are switches on the hub's
# users page: assistant.tools (repo + utility tools), assistant.web (web fetch), assistant.agents (chat as an
# agent), assistant.write (agents in write mode / approval cards), assistant.models (pick provider and model),
# assistant.settings (everything else: config, providers, usage, compare).
_CALLER: ContextVar["wall.Caller | None"] = ContextVar("ai_assistant_caller", default=None)
_PREFIX = "/api/plugins/ai-assistant"
_USER_ROUTES = {
    ("GET", "/app"), ("GET", "/me"), ("GET", "/status"), ("GET", "/catalog"), ("GET", "/contract"), ("GET", "/tags"),
    ("GET", "/conversations"), ("POST", "/conversations"), ("POST", "/conversations/import"),
    ("GET", "/conversations/{cid}"), ("PATCH", "/conversations/{cid}"), ("DELETE", "/conversations/{cid}"),
    ("POST", "/conversations/{cid}/fork"), ("DELETE", "/conversations/{cid}/messages/{mid}"), ("GET", "/conversations/{cid}/export"),
    ("POST", "/conversations/{cid}/messages"), ("POST", "/turns/{tid}/stop"),
    ("GET", "/sessions"), ("GET", "/sessions/{cid}"), ("GET", "/sessions/{cid}/events"),
    ("POST", "/sessions/{cid}/stop"), ("POST", "/sessions/{cid}/close"),
}


_SETTINGS_ALLOWED = set(contract.SETTING_KEYS)


def _settings_for(c: "wall.Caller") -> set[str]:
    """Conversation settings this caller may set (admins: all) — assistant@1 rule."""
    return set(contract.settings_allowed_for(c.admin, c.can))


def _me() -> "wall.Caller":
    """The caller of the current request (the console token when nothing says otherwise)."""
    return _CALLER.get() or wall.TOKEN_CALLER


async def _access(request: Request) -> None:
    c = wall.caller_of(request) or wall.TOKEN_CALLER
    _CALLER.set(c)
    if c.admin:
        return
    route = request.scope.get("route")
    tpl = (getattr(route, "path", "") or "").split(_PREFIX, 1)[-1] or "/"
    key = (request.method.upper(), tpl)
    if key not in _USER_ROUTES:
        if tpl.startswith("/batches"):
            # Approving, rejecting or undoing a change batch applies changes to containers: admins only, always.
            raise HTTPException(403, "only an admin can approve or undo changes")
        need = "assistant.agents" if tpl.startswith("/agents") else "assistant.settings"
        if not c.can(need):
            raise HTTPException(403, f"your account can't do that here (needs {need}; an admin can allow it on the hub's users page)")
    # A user only ever sees their own conversations (and their sessions).
    cid = request.path_params.get("cid")
    if cid:
        try:
            owner = store.get_conversation(cid).get("owner")
        except KeyError:
            owner = None
        if owner != c.name:
            raise HTTPException(404, "conversation not found")
    tid = request.path_params.get("tid")
    if tid and _turn_owner.get(tid) != c.name:
        raise HTTPException(404, "no such reply")


router = APIRouter(dependencies=[Depends(_access)])
_turn_owner: dict[str, str] = {}
_busy_users: set[str] = set()
_busy_lock = threading.Lock()
FOLDER = Path(__file__).resolve().parents[1].name
_turns: dict[str, threading.Event] = {}


def _agents():
    return plugin_services.get("axf.agents@1")


def _err(e: Exception) -> HTTPException:
    if isinstance(e, providers.ProviderError):
        # Never 401: the browser reads 401 as "console token missing". A provider rejecting its key is a 400.
        msg = str(e)
        if e.status == 401:
            msg = f"the provider rejected the key — {msg}. Check the key in Settings → Plugins → AI assistant → Providers → Edit."
        return HTTPException(400 if e.status in (400, 401) else 502, msg)
    if isinstance(e, KeyError):
        return HTTPException(404, str(e).strip("'\""))
    if isinstance(e, ValueError):
        return HTTPException(400, str(e))
    if isinstance(e, PermissionError):
        return HTTPException(403, str(e))
    return HTTPException(500, f"{type(e).__name__}: {e}")


# ---------------------------------------------------------------- service: axf.llm@1

class LlmService:
    """Model access for other plugins. Same profiles, same fallback chain, usage counted here."""
    version = 1

    def profiles(self) -> list[dict[str, Any]]:
        return store.public_config()["profiles"]

    def complete(self, messages: list[dict[str, Any]], system: str | None = None, profile: str | None = None, model: str | None = None,
                 tools: list[dict[str, Any]] | None = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
        pid, prof = store.get_profile(profile)
        m = model or prof.get("defaultModel")
        out = providers.collect(providers.stream_chat(prof, messages, system=system, model=m, tools=tools, params=params or {}, cwd=str(tools_root())))
        store.add_usage(pid, m or "", out["usage"])
        return {**out, "profile": pid, "model": m}

    def embed(self, texts: list[str], profile: str | None = None, model: str | None = None) -> list[list[float]]:
        _pid, prof = store.get_profile(profile)
        return providers.embed(prof, texts, model)


def tools_root() -> Path:
    return tools.ROOT


plugin_services.provide("axf.llm@1", LlmService(), FOLDER)

# Live sessions (live-session@1): every conversation is a session owned by its host; replies run detached from the
# browser and viewers reattach + replay. Hosts are an open registry: `local` is built, `axhub` is a placeholder until a
# module provides `axf.live-host@1`. See axf.assistant_host.sessions and framework/spec/LIVE-SESSIONS.md.
_host = sessions.LocalHost(store.DATA / "sessions", label="This console", note="Replies run on the console server and keep going when the browser closes.",
                           restart_reason="The console restarted while this reply was running.")
HOSTS = sessions.SessionHosts()
HOSTS.register(_host)
HOSTS.register(sessions.axhub_placeholder("this console"))
plugin_services.provide("axf.live-sessions@1", sessions.LiveSessionsService(HOSTS, _host), FOLDER)


def _hosts() -> sessions.SessionHosts:
    """The registry with any module-provided host (axf.live-host@1) merged in at request time."""
    ext = plugin_services.get(sessions.HOST_CAPABILITY)
    if ext is not None and isinstance(getattr(ext, "id", None), str) and HOSTS.get(ext.id) is not ext:
        HOSTS.register(ext)
    return HOSTS


def _keep_interrupted(s: "sessions.Session") -> None:
    """A console restart mid-reply: keep the text that had streamed as an assistant message marked `interrupted`,
    so nothing the model said is lost and the next turn can continue from it."""
    if not store.load_config().get("keepInterrupted", True):
        return
    with s.log.cond:
        items = list(s.log.items)
    start = next((i for i in range(len(items) - 1, -1, -1) if items[i]["kind"] == sessions.KINDS["turnStart"]), -1)
    if start < 0:
        return
    text = "".join(str((e.get("data") or {}).get("text", "")) for e in items[start:] if e["kind"] == "text" and isinstance(e.get("data"), dict))
    if any(e["kind"] == "done" for e in items[start:]) or not text.strip():
        return
    try:
        conv = store.get_conversation(s.id)
    except KeyError:
        return
    msgs = conv.setdefault("messages", [])
    if msgs and msgs[-1].get("role") == "assistant" and (msgs[-1].get("meta") or {}).get("interrupted"):
        return
    msgs.append({"id": store.new_id("m"), "role": "assistant", "content": text.strip() + "\n\n_(The console restarted while this reply was running; say “continue” to carry on.)_",
                 "createdAt": store.now_ms(), "meta": {"interrupted": True, "lastRound": text.strip()}})
    conv["updatedAt"] = store.now_ms()
    store.save_conversation(conv)


_host.on_interrupted = _keep_interrupted


# ---------------------------------------------------------------- prompts

def _system_prompt(cfg: dict[str, Any], conv: dict[str, Any], agent: dict[str, Any] | None, context: dict[str, Any] | None, tool_specs: list[dict[str, Any]], memory: str) -> str:
    st = conv.get("settings") or {}
    name = cfg.get("assistantName") or "Amber"
    parts: list[str] = []
    if agent:
        parts.append(agent.get("system_prompt") or f"You are {agent.get('name')}.")
        parts.append(f"You are running inside the AmberX AXF Dev Console's assistant dialog, chatting with its owner (Brett) as the agent \"{agent.get('name')}\".")
    else:
        parts.append(f"You are {name}, the AI assistant built into the AmberX AXF Dev Console — the control room of AmberX AXF, a cross-platform app framework where every UI piece (themes, layouts, menus, toolbars, dialogs, buttons, access policies) is a hot-swappable JSON asset (asset@1), with a TypeScript/React web port and a Kotlin/Compose Android port. You are talking to the console's owner, Brett.")
        persona = store.PERSONAS.get(cfg.get("persona", "professional"), "")
        if persona:
            parts.append(persona)
    if any(t["name"].startswith("repo_") for t in tool_specs):
        parts.append("You can read the AXF repository with repo_list, repo_read and repo_search. Read files before making claims about the code, and cite paths.")
    if cfg.get("instructions", "").strip() and not agent:
        parts.append(f"Owner instructions:\n{cfg['instructions'].strip()}")
    if st.get("systemPrompt", "").strip():
        parts.append(f"Instructions for this conversation:\n{st['systemPrompt'].strip()}")
    if memory:
        parts.append(f"Relevant memory (from the agent's persistent memory; use it when it helps, never invent beyond it):\n{memory}")
    if context and any(context.get(k) for k in ("view", "title", "selection", "note", "extra")):
        bits = [f"view: {context['view']}" if context.get("view") else "", f"title: {context['title']}" if context.get("title") else ""]
        # Well-known `extra` keys (assistant@1 ChatContext.extra) are named for the model; other keys are the host's own.
        bits += [f"{k}: {v}" for k in contract.CHAT_CONTEXT_KEYS for v in [contract.context_extra(context, k)] if v]
        text = "Console context: " + " · ".join(b for b in bits if b)
        if context.get("selection"):
            text += f"\nSelected text:\n\"\"\"\n{str(context['selection'])[:4000]}\n\"\"\""
        if context.get("note"):
            text += f"\n{str(context['note'])[:2000]}"
        parts.append(text)
    if agent and agent.get("writeMode"):
        parts.append(_batch_history(conv.get("id", "")))
    parts.append(f"Today is {time.strftime('%A %B %d, %Y')}.")
    return "\n\n".join(p for p in parts if p)


def _containers():
    return plugin_services.get("axf.containers@1")


def _batch_history(cid: str) -> str:
    """What happened to the change batches proposed in this conversation, so the agent knows next turn."""
    cs = _containers()
    if not cs or not cid:
        return ""
    try:
        bs = cs.list_batches(conversation=cid, limit=5)
    except Exception:  # noqa: BLE001
        return ""
    if not bs:
        return ""
    out = ["Change batches in this conversation (newest first):"]
    for b in bs:
        out.append(f"- {b['id']}: {b['status']}" + (f" — {b['error']}" if b.get("error") else ""))
        for it in b.get("items", []):
            what = it.get("path") or it.get("command") or ""
            line = f"    {it['id']} {it['kind']} {it.get('container', '')} {what[:120]}: {it['status']}"
            if it.get("error"):
                line += f" ({it['error'][:200]})"
            if it.get("exitCode") is not None:
                line += f", exit {it['exitCode']}"
            out.append(line)
            if it.get("output") and it["kind"] == "exec":
                out.append("      output (tail): " + it["output"][-1200:].replace("\n", "\n      "))
    return "\n".join(out)


def _redact(text: str, on: bool) -> str:
    return contract.redact_secrets(text, on)


# ---------------------------------------------------------------- the turn engine

def _sse(event: str, data: Any) -> str:
    return f"event: {event}\ndata: {json.dumps(data, ensure_ascii=False)}\n\n"


def _wire_history(msgs: list[dict[str, Any]], limit: int) -> list[dict[str, Any]]:
    return contract.wire_history(msgs, limit)


def _batch_title(user_text: str, n: int) -> str:
    return contract.batch_title(user_text, n)


def _summ(args: dict[str, Any]) -> str:
    return contract.summarize_args(args)


def run_turn(cid: str, body: dict[str, Any], caller: "wall.Caller | None" = None) -> Iterator[str]:
    me = caller or wall.TOKEN_CALLER
    caller_name = me.name
    cfg = store.load_config()
    turn_id = store.new_id("t")
    cancel = threading.Event()
    _turns[turn_id] = cancel
    _turn_owner[turn_id] = me.name
    started = time.monotonic()
    try:
        conv = store.get_conversation(cid)
        owner = conv.get("owner")
        if owner and owner != me.name:
            # Someone (an admin) replying in a hub user's chat runs with that user's rights, never their own:
            # the chat's settings and history came from the user.
            me = wall.Caller(owner, "user", frozenset(), "session")
            yield _sse("status", {"text": f"This is {owner}'s chat, so the reply runs with {owner}'s permissions (plain chat)."})
        st = conv.setdefault("settings", {})
        if not me.admin:
            st = {k: v for k, v in st.items() if k in _settings_for(me)}
        msgs: list[dict[str, Any]] = conv.setdefault("messages", [])
        budget = int(cfg.get("dailyTokenBudget") or 0)
        if budget and store.tokens_today() >= budget:
            yield _sse("error", {"message": f"Daily token budget reached ({budget:,} tokens). Raise it in Settings → Plugins → AI assistant."})
            return
        if not me.admin:
            cap = int(cfg.get("userDailyTokens") or 0)
            if cap and store.user_tokens_today(me.name) >= cap:
                yield _sse("error", {"message": f"You've used today's {cap:,} tokens. Ask an admin to raise your limit, or come back tomorrow."})
                return

        # 1. the user message (new, regenerate, or edit-and-resend)
        if body.get("editMessageId"):
            idx = next((i for i, m in enumerate(msgs) if m.get("id") == body["editMessageId"] and m.get("role") == "user"), -1)
            if idx < 0:
                raise KeyError("message to edit not found")
            del msgs[idx:]
        if body.get("regenerate"):
            while msgs and msgs[-1].get("role") != "user":
                msgs.pop()
            if not msgs:
                raise ValueError("nothing to regenerate")
            user_text = msgs[-1].get("content", "")
        else:
            user_text = _redact(str(body.get("content") or "").strip(), cfg.get("redactSecrets", True))
            images = [i for i in (body.get("images") or [])[:6] if isinstance(i, dict) and re.match(r"^image/(png|jpe?g|gif|webp)$", str(i.get("media_type", "")))]
            if not user_text and not images:
                raise ValueError("empty message")
            umsg = {"id": store.new_id("m"), "role": "user", "content": user_text, "createdAt": store.now_ms(), "meta": {"context": contract.normalize_chat_context(body.get("context"))}}
            if images:
                umsg["images"] = [{"media_type": i["media_type"], "data": str(i.get("data", ""))[:8_000_000], "name": str(i.get("name", ""))[:120]} for i in images]
            msgs.append(umsg)
        store.save_conversation(conv)

        # 2. agent, tools, profile
        agent = None
        svc = _agents() if cfg.get("agentIntegration", True) else None
        agent_id = st.get("agentId") or ""
        if agent_id and not me.can("assistant.agents"):
            yield _sse("status", {"text": "Your account can't chat as an agent; answering as the assistant."})
            agent_id = ""
        if agent_id and svc:
            try:
                agent = svc.get_agent(agent_id)
            except Exception:  # noqa: BLE001
                agent = None
            if not agent:
                yield _sse("status", {"text": f"Agent {agent_id} is not available; answering as {cfg.get('assistantName')}."})
        elif agent_id and not svc:
            yield _sse("status", {"text": "The agent manager isn't installed or enabled; answering without the agent."})
        if agent and not me.admin:
            if agent.get("writeMode"):
                yield _sse("status", {"text": f"{agent.get('name', 'That agent')} works in write mode, which only admins can use; answering as the assistant."})
                agent, agent_id = None, ""
            else:
                # Users get the agent's persona and model only: no agent tools (HTTP/MCP/container), no agent memory.
                agent = {**agent, "tools": []}
        groups = dict(cfg.get("tools", {}))
        if not me.admin:
            groups = {g: bool(v) and me.can("assistant.web" if g == "web" else "assistant.tools") for g, v in groups.items()}
        tool_on = st.get("tools", True) is not False
        tool_specs = tools.specs(groups) if tool_on else []
        agent_tools = {t["name"]: t for t in (agent or {}).get("tools", [])} if tool_on else {}
        tool_specs = [t for t in tool_specs if t["name"] not in agent_tools] + list(agent_tools.values())
        memory = ""
        if agent and svc and me.admin:
            try:
                memory = svc.memory_context(agent_id, user_text) or ""
                if memory:
                    yield _sse("status", {"text": "Recalled from agent memory"})
            except Exception:  # noqa: BLE001
                memory = ""
        system = _system_prompt(cfg, conv, agent, contract.normalize_chat_context(body.get("context")), tool_specs, memory)
        amodel = (agent or {}).get("model") or {}
        if not me.can("assistant.models"):
            st = {k: v for k, v in st.items() if k not in ("profileId", "model")}  # the default model for this account
        chain = contract.profile_chain(st.get("profileId"), amodel.get("profile"), cfg.get("defaultProfile") or "", cfg.get("fallback", []))
        params = {**cfg.get("params", {})}
        for k in ("temperature", "max_tokens", "top_p"):
            if st.get(k) is not None and st.get(k) != "":
                params[k] = st[k]
            elif amodel.get(k) is not None:
                params[k] = amodel[k]
        if st.get("thinking") is not None:
            params["thinking"] = bool(st["thinking"])
        params = contract.clamp_user_params(params, me.admin, me.can("assistant.models"))

        yield _sse("start", {"turnId": turn_id, "agent": {"id": agent["id"], "name": agent.get("name"), "icon": agent.get("icon"), "writeMode": agent.get("writeMode")} if agent else None})

        staged: list[dict[str, Any]] = []

        def stage(item: dict[str, Any]) -> int:
            if len(staged) >= 50:
                raise ValueError("at most 50 changes per reply; send the rest after this batch")
            staged.append(item)
            return len(staged)

        def exec_tool(name: str, args: dict[str, Any]) -> tuple[bool, str]:
            try:
                if name in agent_tools and svc:
                    res = str(svc.run_tool(agent_id, name, args, {"conversationId": cid, "turnId": turn_id, "stage": stage}))
                elif name in tools.BUILTIN_NAMES and any(sp["name"] == name for sp in tool_specs):
                    res = tools.run(name, args)
                else:
                    raise ValueError(f"tool {name} is not available")
                return True, res[:50_000]
            except Exception as e:  # noqa: BLE001
                return False, f"Error: {e}"[:50_000]

        # 3. model rounds with tools, falling back to the next profile if one fails before producing anything
        wire = _wire_history(msgs, int(cfg.get("contextMessages") or 40))
        new_msgs: list[dict[str, Any]] = []
        total = {"input": 0, "output": 0}
        tool_log: list[dict[str, Any]] = []
        used_pid, used_model = "", ""
        final_text, thinking, last_round = "", "", ""
        last_error: Exception | None = None
        for pid_try in chain:
            try:
                pid, prof = store.get_profile(pid_try or None)
            except KeyError as e:
                last_error = e
                continue
            if prof.get("enabled") is False:
                continue
            first = pid_try == chain[0]
            if st.get("model") and (st.get("profileId") == pid or (not st.get("profileId") and first)):
                model = st["model"]
            elif amodel.get("model") and amodel.get("profile") in (None, "", pid):
                model = amodel["model"]
            else:
                model = prof.get("defaultModel")
            produced = False
            try:
                rounds = int(cfg.get("maxToolRounds") or 12)
                for rnd in range(rounds):
                    if cancel.is_set():
                        break
                    if rnd == 0:
                        yield _sse("status", {"text": f"Thinking on {prof.get('label') or pid} · {model}"})
                    round_text = ""
                    round_thinking: list[dict[str, Any]] = []
                    calls: list[dict[str, Any]] = []
                    for ev in providers.stream_chat(prof, wire + new_msgs, system=system, model=model, tools=tool_specs or None, params=params, cancel=cancel, cwd=str(tools_root()),
                                                    tool_runner=exec_tool, read_files=me.can("assistant.tools")):
                        t = ev["type"]
                        if t == "tool_done":  # a tool the CLI ran through the console's bridge
                            produced = True
                            tool_log.append({"id": ev["id"], "name": ev["name"], "input": _summ(ev.get("arguments") or {}), "ok": ev["ok"], "preview": ev["result"][:300]})
                            yield _sse("tool", {"phase": "call", "id": ev["id"], "name": ev["name"], "input": _summ(ev.get("arguments") or {})})
                            yield _sse("tool", {"phase": "result", "id": ev["id"], "name": ev["name"], "ok": ev["ok"], "preview": ev["result"][:300]})
                            continue
                        if t == "text":
                            produced = True
                            round_text += ev["text"]
                            yield _sse("text", {"text": ev["text"]})
                        elif t == "thinking":
                            thinking += ev["text"]
                            if cfg.get("showThinking"):
                                yield _sse("thinking", {"text": ev["text"]})
                        elif t == "thinking_block":
                            round_thinking.append(ev["block"])
                        elif t == "status":
                            yield _sse("status", {"text": ev["text"]})
                        elif t == "tool_call":
                            produced = True
                            calls.append(ev)
                        elif t == "usage":
                            total["input"] += ev.get("input", 0)
                            total["output"] += ev.get("output", 0)
                    final_text += round_text
                    last_round = round_text
                    if not calls or cancel.is_set():
                        break
                    tc_list = [{"id": c["id"], "name": c["name"], "arguments": c.get("arguments") or {}} for c in calls]
                    new_msgs.append({"role": "assistant", "content": round_text, "tool_calls": tc_list, **({"thinking_blocks": round_thinking} if round_thinking else {})})
                    for c in tc_list:
                        yield _sse("tool", {"phase": "call", "id": c["id"], "name": c["name"], "input": _summ(c["arguments"])})
                        ok, result = exec_tool(c["name"], c["arguments"])
                        tool_log.append({"id": c["id"], "name": c["name"], "input": _summ(c["arguments"]), "ok": ok, "preview": result[:300]})
                        new_msgs.append({"role": "tool", "content": result, "tool_call_id": c["id"], "is_error": not ok})
                        yield _sse("tool", {"phase": "result", "id": c["id"], "name": c["name"], "ok": ok, "preview": result[:300]})
                    if final_text:
                        final_text += "\n\n"
                used_pid, used_model = pid, model or ""
                last_error = None
                break
            except Exception as e:  # noqa: BLE001
                last_error = e
                if produced:
                    break
                nxt = chain.index(pid_try) + 1 < len(chain)
                yield _sse("status", {"text": f"{prof.get('label') or pid} failed ({str(e)[:120]}){'; trying the next provider…' if nxt else ''}"})
                continue
        if last_error and not final_text and not tool_log:
            raise last_error
        if last_error:  # failed after producing something: keep what we have and say so
            note = f"\n\n_(The provider stopped with an error: {str(last_error)[:200]})_"
            final_text += note
            last_round += note
            yield _sse("text", {"text": note})

        # 4. proposed container changes → one change batch on an approval card (nothing is changed yet)
        batch_id = ""
        if staged and not cancel.is_set():
            cs = _containers()
            if cs:
                try:
                    b = cs.create_batch(staged, actor={"kind": "agent", "id": agent_id, "name": (agent or {}).get("name") or agent_id},
                                        conversation=cid, turn=turn_id, title=_batch_title(user_text, len(staged)))
                    batch_id = b["id"]
                    yield _sse("batch", {"batch": cs.public_batch(b)})
                except Exception as e:  # noqa: BLE001
                    note = f"\n\n_(Couldn't put the proposed changes on an approval card: {str(e)[:200]})_"
                    final_text += note
                    yield _sse("text", {"text": note})
            else:
                note = "\n\n_(Container access isn't installed any more, so the proposed changes were dropped.)_"
                final_text += note
                yield _sse("text", {"text": note})

        # 5. store the turn
        for nm in new_msgs:
            if nm["role"] == "assistant":
                msgs.append({"id": store.new_id("m"), "role": "assistant", "content": nm["content"], "toolCalls": nm["tool_calls"], "createdAt": store.now_ms(), "meta": {"step": True},
                             **({"thinkingBlocks": nm["thinking_blocks"]} if nm.get("thinking_blocks") else {})})
            else:
                msgs.append({"id": store.new_id("m"), "role": "tool", "content": nm["content"], "toolCallId": nm["tool_call_id"], "isError": nm["is_error"], "createdAt": store.now_ms()})
        amsg = {"id": store.new_id("m"), "role": "assistant", "content": final_text.strip() or ("(stopped)" if cancel.is_set() else ""), "createdAt": store.now_ms(),
                "meta": {"profile": used_pid, "model": used_model, "latencyMs": int((time.monotonic() - started) * 1000), "usage": total, "tools": tool_log,
                         "agentId": agent["id"] if agent else "", "agentName": agent.get("name") if agent else "", "stopped": cancel.is_set(),
                         "thinking": thinking[:20_000] if thinking else "", "lastRound": last_round.strip(), **({"batch": batch_id} if batch_id else {})}}
        # A trailing assistant "step" with tool calls and no final text would leave the next turn without a reply: keep the final one always.
        msgs.append(amsg)
        if conv.get("title", "New conversation") == "New conversation" and user_text:
            conv["title"] = contract.title_from_text(user_text)
            if cfg.get("autoTitle", True) and used_pid:
                threading.Thread(target=_auto_title, args=(cid, used_pid, user_text, amsg["content"]), daemon=True).start()
        conv["updatedAt"] = store.now_ms()
        store.save_conversation(conv)
        if used_pid:
            store.add_usage(used_pid, used_model, total)
        if not me.admin:
            store.add_user_usage(me.name, total)
        if agent and svc and me.admin:
            try:
                svc.record_turn(agent_id, user_text, amsg["content"], {"conversationId": cid, "profile": used_pid, "model": used_model})
            except Exception:  # noqa: BLE001
                pass
        yield _sse("done", {"message": amsg, "title": conv["title"]})
    except Exception as e:  # noqa: BLE001
        yield _sse("error", {"message": str(e).strip("'\"") or type(e).__name__})
    finally:
        _turns.pop(turn_id, None)
        _turn_owner.pop(turn_id, None)
        with _busy_lock:
            _busy_users.discard(caller_name)


def _auto_title(cid: str, pid: str, user_text: str, reply: str) -> None:
    try:
        _p, prof = store.get_profile(pid)
        out = providers.collect(providers.stream_chat(prof, [{"role": "user", "content": f"Write a 3-6 word title for this conversation. Reply with the title only, no quotes.\n\nUser: {user_text[:800]}\n\nAssistant: {reply[:800]}"}],
                                                      model=prof.get("defaultModel"), params={"max_tokens": 24, "temperature": 0.2}))
        title = re.sub(r"[\"'`*#]", "", out["text"]).strip().split("\n")[0][:60]
        if title:
            c = store.get_conversation(cid)
            c["title"] = title
            store.save_conversation(c)
    except Exception:  # noqa: BLE001 — a title is a nicety
        pass


# ---------------------------------------------------------------- routes: status + config

@router.get("/me")
def me_route() -> dict[str, Any]:
    """Who is chatting and what their account allows (for the chat page)."""
    me = _me()
    cfg = store.load_config()
    can = {p: me.can(p) for p in ("assistant.tools", "assistant.web", "assistant.agents", "assistant.write", "assistant.models", "assistant.settings")}
    cap = 0 if me.admin else int(cfg.get("userDailyTokens") or 0)
    return {"user": me.public(), "admin": me.admin, "can": can, "dailyTokens": cap, "usedToday": 0 if me.admin else store.user_tokens_today(me.name),
            "assistantName": cfg.get("assistantName") or "Amber"}


@router.get("/app", response_class=HTMLResponse)
def chat_app() -> HTMLResponse:
    """A plain chat page for hub users (and anyone signed in): https://<console>/api/plugins/ai-assistant/app"""
    return HTMLResponse((Path(__file__).resolve().parent / "app.html").read_text(), headers={"cache-control": "no-store", "x-frame-options": "DENY",
        "content-security-policy": "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"})


@router.get("/status")
def status() -> dict[str, Any]:
    cfg = store.load_config()
    me = _me()
    if not me.admin:
        # Hub users see only what their chat needs (no providers, keys' env names, test errors or other agents' details).
        agents_u: list[dict[str, Any]] = []
        svc_u = _agents() if me.can("assistant.agents") and cfg.get("agentIntegration", True) else None
        if svc_u:
            try:
                agents_u = [{"id": a.get("id"), "name": a.get("name"), "icon": a.get("icon"), "description": a.get("description", "")}
                            for a in svc_u.list_agents() if not a.get("writeMode") and not a.get("dangerous")]
            except Exception:  # noqa: BLE001
                agents_u = []
        return {"assistantName": cfg.get("assistantName"), "setupComplete": True, "needsSetup": False, "defaultProfile": None, "profiles": 0, "ready": 0,
                "cliInstalled": False, "integrations": {"agents": bool(agents_u), "agentCount": len(agents_u)}, "agents": agents_u, "defaultAgent": "",
                "tokensToday": store.user_tokens_today(me.name), "budget": int(cfg.get("userDailyTokens") or 0),
                "suggestions": cfg.get("suggestions", []), "prompts": [], "showUsage": True, "me": me.public()}
    svc = _agents()
    profs = store.public_config(cfg)["profiles"]
    ready = [p for p in profs if p["enabled"] and p["keyReady"]]
    default = next((p for p in profs if p["id"] == cfg.get("defaultProfile")), None)
    agents: list[dict[str, Any]] = []
    if svc and cfg.get("agentIntegration", True):
        try:
            agents = svc.list_agents()
        except Exception:  # noqa: BLE001
            agents = []
    return {"assistantName": cfg.get("assistantName"), "setupComplete": cfg.get("setupComplete", False), "needsSetup": not ready,
            "defaultProfile": default, "profiles": len(profs), "ready": len(ready), "cliInstalled": providers.cli_available(),
            "integrations": {"agents": bool(svc) and cfg.get("agentIntegration", True), "agentCount": len(agents)},
            "agents": agents, "defaultAgent": cfg.get("defaultAgent", ""), "tokensToday": store.tokens_today(), "budget": cfg.get("dailyTokenBudget", 0),
            "suggestions": cfg.get("suggestions", []), "prompts": cfg.get("prompts", []), "showUsage": cfg.get("showUsage", True)}


@router.get("/catalog")
def catalog() -> dict[str, Any]:
    return {"providers": providers.CATALOG, "protocols": sorted({*providers.PROTOCOLS, "openai", "anthropic", "claude-cli"}), "personas": list(store.PERSONAS),
            "toolGroups": tools.GROUPS, "cliInstalled": providers.cli_available()}


@router.get("/contract")
def contract_info() -> dict[str, Any]:
    """What this assistant speaks (for other apps and ports): contracts, event kinds, hosts, capabilities."""
    return {"assistant": contract.CONTRACT, "conversation": contract.CONVERSATION_CONTRACT, "liveSession": sessions.CONTRACT,
            "turnEvents": contract.TURN_EVENT_KINDS, "settingKeys": contract.SETTING_KEYS, "hosts": _hosts().describe(),
            "provides": ["axf.llm@1", "axf.live-sessions@1"], "actions": ["ai-assistant.open", "ai.chat.start"]}


@router.get("/tags")
def tags() -> dict[str, Any]:
    me = _me()
    return {"items": store.all_tags(None if me.admin else me.name)}


@router.post("/providers/reload")
def providers_reload() -> dict[str, Any]:
    """Re-read the provider registry (framework schema + <dataDir>/providers.json)."""
    providers.reload_catalog()
    return {"providers": len(providers.CATALOG)}


@router.get("/config")
def get_config() -> dict[str, Any]:
    return store.public_config()


_CONFIG_KEYS = {"userDailyTokens": int, "setupComplete": bool, "assistantName": str, "persona": str, "instructions": str, "defaultProfile": str, "fallback": list,
                "params": dict, "contextMessages": int, "tools": dict, "maxToolRounds": int, "autoTitle": bool, "showUsage": bool, "keepInterrupted": bool,
                "showThinking": bool, "redactSecrets": bool, "dailyTokenBudget": int, "agentIntegration": bool, "defaultAgent": str,
                "suggestions": list, "prompts": list, "sessionHost": str}


@router.put("/config")
def put_config(body: dict[str, Any]) -> dict[str, Any]:
    cfg = store.load_config()
    for k, typ in _CONFIG_KEYS.items():
        if k not in body:
            continue
        v = body[k]
        if typ is int:
            v = max(0, min(int(v or 0), 10_000_000))
        elif typ is str:
            v = str(v or "")[:20_000]
        elif typ is bool:
            v = bool(v)
        elif not isinstance(v, typ):
            raise HTTPException(400, f"{k} must be a {typ.__name__}")
        if k == "persona" and v not in store.PERSONAS:
            raise HTTPException(400, "unknown persona")
        if k == "params":
            v = {**cfg["params"], **{pk: pv for pk, pv in v.items() if pk in store.DEFAULT_CONFIG["params"]}}
        if k == "tools":
            v = {g: bool(v.get(g, cfg["tools"].get(g))) for g in tools.GROUPS}
        if k == "prompts":
            v = [{"id": str(p.get("id") or store.new_id("p"))[:40], "title": str(p.get("title", ""))[:80], "shortcut": str(p.get("shortcut", ""))[:24], "text": str(p.get("text", ""))[:8000]} for p in v if isinstance(p, dict)][:100]
        if k == "suggestions":
            v = [str(s)[:200] for s in v][:12]
        if k == "sessionHost" and _hosts().get(v) is None:
            raise HTTPException(400, "unknown session host")
        if k == "fallback":
            v = [str(s) for s in v if str(s) in cfg.get("profiles", {})][:10]
        cfg[k] = v
    cfg["contextMessages"] = max(2, min(int(cfg.get("contextMessages") or 40), 400))
    cfg["maxToolRounds"] = max(1, min(int(cfg.get("maxToolRounds") or 12), 50))
    store.save_config(cfg)
    return store.public_config(cfg)


# ---------------------------------------------------------------- routes: provider profiles

@router.post("/profiles")
def save_profile(body: dict[str, Any]) -> dict[str, Any]:
    try:
        return {"profile": store.upsert_profile(body)}
    except ValueError as e:
        raise HTTPException(400, str(e)) from None


@router.delete("/profiles/{pid}")
def remove_profile(pid: str) -> dict[str, Any]:
    try:
        store.delete_profile(pid)
    except KeyError:
        raise HTTPException(404, f"no profile {pid}") from None
    return {"deleted": pid}


@router.get("/profiles/{pid}/models")
def profile_models(pid: str) -> dict[str, Any]:
    try:
        _p, prof = store.get_profile(pid)
        return {"models": providers.list_models(prof)}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/profiles/{pid}/test")
def profile_test(pid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    try:
        _p, prof = store.get_profile(pid)
        model = (body or {}).get("model") or prof.get("defaultModel")
        r = providers.test_profile(prof, model)
        r["model"] = model
        store.record_test(pid, r)
        return r
    except Exception as e:  # noqa: BLE001
        store.record_test(pid, {"ok": False, "error": str(e)[:300]})
        raise _err(e) from None


@router.post("/profiles/draft/models")
def draft_models(body: dict[str, Any]) -> dict[str, Any]:
    """Model list for a profile that isn't saved yet (the wizard's 'Fetch models' before Save)."""
    try:
        return {"models": providers.list_models({"kind": body.get("kind", "custom"), "baseUrl": body.get("baseUrl", ""), "keyEnv": body.get("keyEnv", ""),
                                                 "key": body.get("key", ""), "auth": body.get("auth")})}
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


# ---------------------------------------------------------------- routes: conversations

@router.get("/conversations")
def conversations(q: str = "", archived: bool = False, tag: str = "") -> dict[str, Any]:
    me = _me()
    return {"items": store.list_conversations(q, archived, owner=None if me.admin else me.name, tag=tag[:30])}


@router.post("/conversations")
def new_conversation(body: dict[str, Any] | None = None) -> dict[str, Any]:
    cfg = store.load_config()
    settings = dict((body or {}).get("settings") or {})
    me = _me()
    if "agentId" not in settings and cfg.get("defaultAgent") and _agents() and me.can("assistant.agents"):
        settings["agentId"] = cfg["defaultAgent"]
    c = store.create_conversation(settings, owner=None if me.admin else me.name)
    title = str((body or {}).get("title") or "").strip()
    if title:
        c["title"] = re.sub(r"\s+", " ", title)[:120]
        store.save_conversation(c)
    return {"conversation": c}


@router.get("/conversations/{cid}")
def conversation(cid: str) -> dict[str, Any]:
    try:
        return {"conversation": store.get_conversation(cid)}
    except KeyError:
        raise HTTPException(404, "conversation not found") from None


@router.patch("/conversations/{cid}")
def patch_conversation(cid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        c = store.get_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    if "title" in body:
        c["title"] = str(body["title"] or "Untitled")[:120]
    for k in ("pinned", "archived"):
        if k in body:
            c[k] = bool(body[k])
    if "tags" in body and isinstance(body["tags"], list):
        c["tags"] = [str(t)[:30] for t in body["tags"]][:12]
    if "settings" in body and isinstance(body["settings"], dict):
        allowed = _settings_for(_me())
        s = c.setdefault("settings", {})
        for k, v in body["settings"].items():
            if k in allowed:
                if v is None or v == "":
                    s.pop(k, None)
                else:
                    s[k] = v
    c["updatedAt"] = store.now_ms()
    store.save_conversation(c)
    return {"conversation": c}


@router.delete("/conversations/{cid}")
def remove_conversation(cid: str) -> dict[str, Any]:
    try:
        store.delete_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    _host.close(cid, stop=lambda: _stop_session_turn(cid))
    return {"deleted": cid}


@router.post("/conversations/{cid}/fork")
def fork_conversation(cid: str, body: dict[str, Any]) -> dict[str, Any]:
    try:
        c = store.get_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    mid = body.get("messageId")
    msgs = c.get("messages", [])
    idx = next((i for i, m in enumerate(msgs) if m.get("id") == mid), len(msgs) - 1)
    f = store.create_conversation(dict(c.get("settings") or {}), title=f"{c.get('title', 'Conversation')} (fork)", owner=c.get("owner"))
    f["messages"] = msgs[: idx + 1]
    store.save_conversation(f)
    return {"conversation": f}


@router.delete("/conversations/{cid}/messages/{mid}")
def delete_message(cid: str, mid: str) -> dict[str, Any]:
    """Delete one message and, for an assistant reply, the tool steps that led to it."""
    try:
        c = store.get_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    msgs = c.get("messages", [])
    idx = next((i for i, m in enumerate(msgs) if m.get("id") == mid), -1)
    if idx < 0:
        raise HTTPException(404, "message not found")
    start = idx
    if msgs[idx].get("role") == "assistant":
        while start > 0 and msgs[start - 1].get("role") in ("tool",) or (start > 0 and msgs[start - 1].get("meta", {}).get("step")):
            start -= 1
    del msgs[start: idx + 1]
    store.save_conversation(c)
    return {"conversation": c}


@router.get("/conversations/{cid}/export")
def export_conversation(cid: str, format: str = "md"):  # noqa: A002
    try:
        c = store.get_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    if format == "json":
        return c
    if format == "txt":
        lines = []
        for m in c.get("messages", []):
            if m.get("role") == "user":
                lines += ["You:", m.get("content", ""), ""]
            elif m.get("role") == "assistant" and not m.get("meta", {}).get("step"):
                lines += [f"{m.get('meta', {}).get('agentName') or 'Assistant'}:", m.get("content", ""), ""]
        return PlainTextResponse("\n".join(lines), media_type="text/plain")
    lines = [f"# {c.get('title', 'Conversation')}", "", f"_Exported from the AXF Dev Console assistant · {time.strftime('%Y-%m-%d %H:%M')}_", ""]
    for m in c.get("messages", []):
        if m.get("role") == "user":
            lines += ["## You", "", m.get("content", ""), ""]
        elif m.get("role") == "assistant" and not m.get("meta", {}).get("step"):
            meta = m.get("meta", {})
            who = meta.get("agentName") or "Assistant"
            lines += [f"## {who}" + (f" · {meta.get('model')}" if meta.get("model") else ""), "", m.get("content", ""), ""]
    return PlainTextResponse("\n".join(lines), media_type="text/markdown")


@router.post("/conversations/import")
def import_conversation(body: dict[str, Any]) -> dict[str, Any]:
    msgs = body.get("messages")
    if not isinstance(msgs, list):
        raise HTTPException(400, "expected an exported conversation (JSON with messages)")
    me = _me()
    keys = _settings_for(me)
    settings = {k: v for k, v in dict(body.get("settings") or {}).items() if k in keys}
    c = store.create_conversation(settings, title=str(body.get("title") or "Imported")[:120], owner=None if me.admin else me.name)
    if me.admin:
        c["messages"] = [{"id": store.new_id("m"), "role": m.get("role"), "content": str(m.get("content", ""))[:200_000], "createdAt": m.get("createdAt") or store.now_ms(),
                          "meta": m.get("meta") or {}, **({"toolCalls": m["toolCalls"]} if m.get("toolCalls") else {}), **({"toolCallId": m["toolCallId"]} if m.get("toolCallId") else {})}
                         for m in msgs if isinstance(m, dict) and m.get("role") in ("user", "assistant", "tool")][:5000]
    else:  # users import plain text only (no tool calls or steps that could pass for real tool output)
        c["messages"] = [{"id": store.new_id("m"), "role": m.get("role"), "content": str(m.get("content", ""))[:200_000], "createdAt": store.now_ms(), "meta": {}}
                         for m in msgs if isinstance(m, dict) and m.get("role") in ("user", "assistant")][:2000]
    store.save_conversation(c)
    return {"conversation": c}


@router.post("/conversations/{cid}/messages")
def send_message(cid: str, body: dict[str, Any]):
    try:
        conv = store.get_conversation(cid)
    except KeyError:
        raise HTTPException(404, "conversation not found") from None
    try:
        host, notice = _hosts().resolve(store.load_config().get("sessionHost") or "local")
    except sessions.NotImplementedHost as e:
        raise HTTPException(503, str(e)) from None
    # `host` may be an external one (axHub workers, via axf.live-host@1): it runs the same turn engine and streams the same log.
    try:
        me = _me()
        if not me.admin:
            with _busy_lock:  # one running reply per hub user (keeps the daily cap honest)
                if me.name in _busy_users:
                    raise HTTPException(409, "you already have a reply running; wait for it or stop it first")
                _busy_users.add(me.name)
        try:
            seq = host.start_turn(cid, str(conv.get("title") or ""), lambda: run_turn(cid, body, me), notice, owner=conv.get("owner") or "")
        except Exception:
            with _busy_lock:
                _busy_users.discard(me.name)
            raise
    except sessions.Busy as e:
        raise HTTPException(409, str(e)) from None
    # The reply runs in its own thread; this response only watches the session log. Leaving doesn't stop it.
    return StreamingResponse(host.tail(cid, seq - 1), media_type="text/event-stream", headers=_SSE_HEADERS)


_SSE_HEADERS = {"cache-control": "no-store", "x-accel-buffering": "no"}


def _stop_session_turn(cid: str) -> bool:
    """Stop the reply running in a session (the turn id is in its latest `start` event)."""
    s = _host.get(cid)
    if not s:
        return False
    with s.log.cond:
        tid = next((e.get("data", {}).get("turnId") for e in reversed(s.log.items) if e.get("kind") == "start" and isinstance(e.get("data"), dict)), None)
    ev = _turns.get(tid) if tid else None
    if ev:
        ev.set()
    return bool(ev)


# ---------------------------------------------------------------- routes: live sessions

@router.get("/sessions")
def list_sessions(closed: bool = False) -> dict[str, Any]:
    cfg = store.load_config()
    me = _me()
    items = _host.list(closed)
    if not me.admin:
        mine = {c["id"] for c in store.list_conversations("", False, owner=me.name)} | {c["id"] for c in store.list_conversations("", True, owner=me.name)}
        items = [i for i in items if i["id"] in mine]
    try:
        active = _hosts().resolve(cfg.get("sessionHost") or "local")[0].id
    except sessions.NotImplementedHost:
        active = ""
    return {"contract": sessions.CONTRACT, "host": cfg.get("sessionHost") or "local", "active": active, "hosts": _hosts().describe(),
            "items": items}


@router.get("/sessions/{cid}")
def session_info(cid: str) -> dict[str, Any]:
    return {"session": _host.info(cid)}


@router.get("/sessions/{cid}/events")
def session_events(cid: str, since: int = 0, follow: bool = True, limit: int = 500):
    """follow=1: SSE replay of everything after `since`, then live events until the reply ends.
    follow=0: one JSON page (`events`, `next`, `gap`, `reset`, `more`)."""
    if follow:
        return StreamingResponse(_host.tail(cid, since), media_type="text/event-stream", headers=_SSE_HEADERS)
    s = _host.get(cid)
    if not s:
        return {"events": [], "next": 0, "gap": False, "reset": since > 0, "more": False, "state": "none"}
    return {**s.log.since(since, max(1, min(limit, 2000))), "state": s.state}


@router.post("/sessions/{cid}/stop")
def session_stop(cid: str) -> dict[str, Any]:
    return {"stopped": _stop_session_turn(cid)}


@router.post("/sessions/{cid}/close")
def session_close(cid: str) -> dict[str, Any]:
    """End the live session on purpose (the conversation stays; the next message opens a new session)."""
    return {"closed": _host.close(cid, stop=lambda: _stop_session_turn(cid))}


@router.post("/turns/{tid}/stop")
def stop_turn(tid: str) -> dict[str, Any]:
    ev = _turns.get(tid)
    if ev:
        ev.set()
    return {"stopped": bool(ev)}


# ---------------------------------------------------------------- routes: compare, usage, agents

@router.post("/compare")
def compare(body: dict[str, Any]) -> dict[str, Any]:
    prompt = str(body.get("prompt") or "").strip()
    targets = [t for t in (body.get("targets") or []) if isinstance(t, dict)][:4]
    if not prompt or len(targets) < 2:
        raise HTTPException(400, "give a prompt and 2–4 targets ({profileId, model})")
    cfg = store.load_config()
    system = str(body.get("system") or store.PERSONAS.get(cfg.get("persona", "professional"), ""))

    def one(t: dict[str, Any]) -> dict[str, Any]:
        t0 = time.monotonic()
        try:
            pid, prof = store.get_profile(t.get("profileId"))
            model = t.get("model") or prof.get("defaultModel")
            out = providers.collect(providers.stream_chat(prof, [{"role": "user", "content": prompt}], system=system, model=model, params={**cfg["params"], "thinking": False}))
            store.add_usage(pid, model or "", out["usage"])
            return {"profileId": pid, "label": prof.get("label"), "model": model, "ok": True, "text": out["text"], "usage": out["usage"], "ms": int((time.monotonic() - t0) * 1000)}
        except Exception as e:  # noqa: BLE001
            return {"profileId": t.get("profileId"), "model": t.get("model"), "ok": False, "error": str(e)[:400], "ms": int((time.monotonic() - t0) * 1000)}

    with ThreadPoolExecutor(max_workers=len(targets)) as ex:
        return {"results": list(ex.map(one, targets))}


@router.get("/usage")
def usage() -> dict[str, Any]:
    return {**store.usage_summary(), "users": store.user_usage_summary()}


@router.get("/agents")
def agents() -> dict[str, Any]:
    svc = _agents()
    if not svc:
        return {"available": False, "items": []}
    try:
        return {"available": True, "items": svc.list_agents()}
    except Exception as e:  # noqa: BLE001
        return {"available": True, "items": [], "error": str(e)[:200]}


@router.get("/agents/{aid}/write-mode")
def agent_write_mode(aid: str) -> dict[str, Any]:
    """For the chat's write-mode badge: which containers the selected agent may change (None when read-only)."""
    svc = _agents()
    if not svc:
        return {"writeMode": None}
    try:
        a = svc.get_agent(aid)
    except Exception:  # noqa: BLE001
        a = None
    return {"writeMode": (a or {}).get("writeMode")}


# ---------------------------------------------------------------- change batches (approval cards in the chat)
# Proxied to axf.containers@1 by capability; the batch format is change-batch@1 (src/changeBatch.tsx renders it).
_CHAT_USER = {"kind": "user", "id": "console", "name": "Brett (assistant chat)"}


def _cs_or_404():
    cs = _containers()
    if not cs:
        raise HTTPException(404, "Container access isn't installed or enabled")
    return cs


@router.get("/batches/{bid}")
def batch_get(bid: str) -> dict[str, Any]:
    cs = _cs_or_404()
    try:
        return cs.public_batch(cs.get_batch(bid))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/batches/{bid}/approve")
def batch_approve(bid: str, body: dict[str, Any]) -> StreamingResponse:
    cs = _cs_or_404()
    items = body.get("items")
    return StreamingResponse(cs.approve_stream(bid, items if isinstance(items, list) else None, _CHAT_USER, accept_unseen=body.get("acceptUnseen") is True), media_type="text/event-stream",
                             headers={"Cache-Control": "no-store", "X-Accel-Buffering": "no"})


@router.post("/batches/{bid}/reject")
def batch_reject(bid: str) -> dict[str, Any]:
    cs = _cs_or_404()
    try:
        return cs.public_batch(cs.reject_batch(bid, _CHAT_USER))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.post("/batches/{bid}/undo")
def batch_undo(bid: str, body: dict[str, Any]) -> dict[str, Any]:
    if body.get("confirm") != "undo":
        raise HTTPException(400, 'send {"confirm": "undo"}')
    cs = _cs_or_404()
    try:
        return cs.public_batch(cs.undo_batch(bid, _CHAT_USER))
    except Exception as e:  # noqa: BLE001
        raise _err(e) from None


@router.get("/tools")
def tool_list() -> dict[str, Any]:
    cfg = store.load_config()
    return {"builtin": [{"name": s["name"], "group": s["group"], "description": s["description"], "on": bool(cfg["tools"].get(s["group"]))} for s in tools.SPECS], "groups": tools.GROUPS}
