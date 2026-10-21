"""Agents at run time: compose an agent (persona + lingo + skills + instructions + tools), run it with a tool loop,
and orchestrate several agents in workflows. The prompt text comes from the contract (contract.compose_system_prompt),
so every port composes the same prompt from the same definition.

Workflow modes
  sequential  each step's output feeds the next ({{previous}}); every step's output is available as {{steps.<id>}}
  parallel    every step gets the input at once; optional synthAgentId merges the answers
  router      routerAgentId reads the input and picks the step(s) to run (by id)
  critic      step 1 drafts, step 2 reviews; repeats until the reviewer says APPROVED or maxLoops

Safety (never decided by a persona or skill): dangerous tools only for agents ticked in Settings → Safety; container
tools only when Container access is there; change proposals only when Snapshot Manager is there too.
"""
from __future__ import annotations

import re
import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Callable

from . import containers, contract, llm, memory, store, toolkit

MEMORY_TOOLS = contract.MEMORY_TOOL_NAMES
MAX_ROUNDS = 10


def resolve_tools(agent_id: str, a: dict[str, Any], skills: list[dict[str, Any]]) -> dict[str, Any]:
    """The tool records an agent really gets, after the safety rules, plus the prompt sections those rules add."""
    tools = store.items("tools")
    tool_ids = list(dict.fromkeys([*(a.get("toolIds") or []), *[t for s in skills for t in (s.get("toolIds") or [])]]))
    trecs = [tools[t] for t in tool_ids if t in tools and tools[t].get("enabled", True) is not False]
    allowed = agent_id in store.dangerous_agents()
    dropped = [t["name"] for t in trecs if toolkit.is_dangerous(t) and not allowed]
    trecs = [t for t in trecs if allowed or not toolkit.is_dangerous(t)]
    avail = containers.available()
    if not avail["containers"]:
        trecs = [t for t in trecs if not containers.is_container_tool(t)]
    elif not avail["snapshots"]:
        trecs = [t for t in trecs if (t.get("config") or {}).get("builtin") not in containers.WRITE_TOOLS]
    write_mode = any((t.get("config") or {}).get("builtin") in containers.WRITE_TOOLS for t in trecs if t.get("kind") == "builtin")
    extras: list[str] = []
    if any(containers.is_container_tool(t) for t in trecs):
        extras.append(containers.GUIDE if write_mode else "## Containers (read only)\nYou can read files in the VPS containers. Changes aren't possible right now"
                      + (" (Snapshot Manager isn't installed: nothing is written without a snapshot)." if not avail["snapshots"] else "."))
    if dropped:
        extras.append("## Safety\nSome tools are switched off for you (only allowed agents get tools that change things): " + ", ".join(dropped))
    return {"tools": trecs, "extras": extras, "writeMode": write_mode, "dropped": dropped}


def compose(agent_id: str) -> dict[str, Any]:
    """The resolved agent: system prompt, tool records, model and memory config — what a chat or run uses."""
    a = store.get("agents", agent_id)
    personas, lingo, skills = store.items("personas"), store.items("lingo"), store.items("skills")
    p = personas.get(a.get("personaId") or "")
    sk = [skills[s] for s in a.get("skillIds") or [] if s in skills]
    lg = [lingo[x] for x in a.get("lingoIds") or [] if x in lingo]
    r = resolve_tools(agent_id, a, sk)
    trecs = list(r["tools"])
    mcfg = memory.config(a)
    if mcfg["type"] != "none":
        have = {t["name"] for t in trecs}
        for b in MEMORY_TOOLS:
            if b not in have:
                trecs.append({"id": f"builtin.{b}", "name": b, "kind": "builtin", "config": {"builtin": b}, "description": toolkit.BUILTINS[b]["description"], "parameters": toolkit.BUILTINS[b]["parameters"]})
    agents = store.items("agents")
    for d in [agents.get(x) for x in a.get("delegates") or []]:
        if d:
            trecs.append({"id": f"delegate.{d['id']}", "name": f"ask_{re.sub(r'[^a-zA-Z0-9_]', '_', d['id'])}"[:64], "kind": "agent", "config": {"agentId": d["id"]},
                          "description": f"Delegate a task to {d.get('name')}: {d.get('description', '')[:200]}", "parameters": {"type": "object", "properties": {"task": {"type": "string"}}, "required": ["task"]}})
    system = contract.compose_system_prompt(a, p, sk, lg, r["extras"], mcfg["type"] != "none", [t["name"] for t in trecs])
    return {"agent": a, "system": system, "tools": trecs, "model": a.get("model") or {}, "memory": mcfg, "writeMode": r["writeMode"], "dropped": r["dropped"]}


def run_agent(agent_id: str, task: str, history: list[dict[str, Any]] | None = None, depth: int = 0, max_rounds: int = MAX_ROUNDS, use_memory: bool = True,
              on_event: Callable[[str, dict[str, Any]], None] | None = None, stage: Callable[[dict[str, Any]], int] | None = None) -> dict[str, Any]:
    c = compose(agent_id)
    system = c["system"]
    if use_memory:
        ctx_mem = memory.context_for(c["agent"], task)
        if ctx_mem:
            system += f"\n\n## Relevant memory\n{ctx_mem}"
    msgs = [*(history or []), {"role": "user", "content": task}]
    by_name = {t["name"]: t for t in c["tools"]}
    specs = [toolkit.spec(t) for t in c["tools"]]
    log: list[dict[str, Any]] = []
    text_all = ""
    usage = {"input": 0, "output": 0}
    ctx = {"agent": c["agent"], "scope": c["memory"]["scope"], "depth": depth, "run_agent": run_agent, "run_workflow": run_workflow, "stage": stage}
    emit = on_event or (lambda _k, _d: None)
    out: dict[str, Any] = {}
    started = time.time()
    for _ in range(max_rounds):
        out = llm.complete(msgs, system=system, tools=specs or None, model_cfg=c["model"])
        usage["input"] += int((out.get("usage") or {}).get("input", 0))
        usage["output"] += int((out.get("usage") or {}).get("output", 0))
        if out.get("text"):
            emit("text", {"text": out["text"]})
        text_all += out.get("text", "")
        if not out.get("tool_calls"):
            break
        msgs.append({"role": "assistant", "content": out.get("text", ""), "tool_calls": out["tool_calls"]})
        for tc in out["tool_calls"]:
            t = by_name.get(tc["name"])
            emit("tool", {"name": tc["name"], "args": tc.get("arguments")})
            t0 = time.time()
            try:
                res = toolkit.execute(t, tc.get("arguments") or {}, ctx) if t else f"Error: no tool {tc['name']}"
                ok = bool(t)
            except Exception as e:  # noqa: BLE001
                res, ok = f"Error: {e}", False
            log.append({"tool": tc["name"], "args": tc.get("arguments"), "ok": ok, "preview": str(res)[:300], "ms": int((time.time() - t0) * 1000)})
            emit("tool_result", {"name": tc["name"], "ok": ok, "preview": str(res)[:300]})
            msgs.append({"role": "tool", "content": str(res)[:40_000], "tool_call_id": tc["id"]})
        text_all += "\n\n" if out.get("text") else ""
    if use_memory and depth == 0:
        memory.record(c["agent"], task, text_all)
    return {"text": text_all.strip(), "tools": log, "usage": usage, "model": out.get("model"), "ms": int((time.time() - started) * 1000)}


_fill = contract.fill_workflow_template


def run_workflow(wf_id: str, input_text: str, depth: int = 0, on_event: Callable[[str, dict[str, Any]], None] | None = None) -> dict[str, Any]:  # noqa: C901
    wf = store.get("workflows", wf_id)
    mode = wf.get("mode") or "sequential"
    steps = [s for s in wf.get("steps") or [] if s.get("agentId")]
    if not steps:
        raise ValueError("this workflow has no steps")
    emit = on_event or (lambda _k, _d: None)
    outputs: dict[str, str] = {}
    trace: list[dict[str, Any]] = []
    started = time.time()

    def step(s: dict[str, Any], prev: str) -> str:
        prompt = _fill(s.get("prompt") or "{{previous}}", input_text, outputs, prev or input_text)
        emit("step", {"step": s.get("id"), "agent": s["agentId"]})
        t0 = time.time()
        r = run_agent(s["agentId"], prompt, depth=depth + 1, use_memory=s.get("memory", True) is not False)
        trace.append({"step": s.get("id"), "agent": s["agentId"], "prompt": prompt[:2000], "output": r["text"][:6000], "tools": r["tools"], "ms": int((time.time() - t0) * 1000)})
        emit("step_done", {"step": s.get("id"), "agent": s["agentId"], "output": r["text"][:1000]})
        return r["text"]

    final = ""
    if mode == "parallel":
        with ThreadPoolExecutor(max_workers=min(6, len(steps))) as ex:
            res = list(ex.map(lambda s: (s.get("id") or s["agentId"], step(s, input_text)), steps))
        outputs.update(dict(res))
        if wf.get("synthAgentId"):
            joined = "\n\n".join(f"### {k}\n{v}" for k, v in res)
            final = run_agent(wf["synthAgentId"], f"Combine these answers to the task into one best answer.\n\nTask:\n{input_text}\n\n{joined}", depth=depth + 1)["text"]
        else:
            final = "\n\n".join(f"### {k}\n{v}" for k, v in res)
    elif mode == "router":
        if not wf.get("routerAgentId"):
            raise ValueError("router workflows need a router agent")
        menu = "\n".join(f"- {s.get('id')}: {s.get('label') or s['agentId']} — {s.get('when', '')}" for s in steps)
        pick = run_agent(wf["routerAgentId"], f"Pick the best step id(s) for this task. Reply with JSON only: {{\"steps\": [\"id\", ...]}}.\n\nSteps:\n{menu}\n\nTask:\n{input_text}", depth=depth + 1, use_memory=False)["text"]
        chosen = contract.parse_router_pick(pick, [s.get("id") for s in steps])
        run = [s for s in steps if s.get("id") in chosen] or steps[:1]
        trace.append({"step": "router", "agent": wf["routerAgentId"], "output": pick[:1000], "chosen": [s.get("id") for s in run]})
        prev = input_text
        for s in run:
            prev = outputs[s.get("id") or s["agentId"]] = step(s, prev)
        final = prev
    elif mode == "critic":
        if len(steps) < 2:
            raise ValueError("critic workflows need a writer step and a reviewer step")
        writer, critic = steps[0], steps[1]
        draft = step(writer, input_text)
        for _ in range(max(1, min(int(wf.get("maxLoops") or 3), contract.LIMITS["workflowLoops"]))):
            ask = _fill(critic.get("prompt") or "Review this answer to the task.\n\nTask:\n{{input}}\n\nAnswer:\n{{previous}}", input_text, outputs, draft)
            if "APPROVED" not in ask:
                ask += "\n\nReply APPROVED if it is correct and complete; otherwise list concrete fixes."
            review = run_agent(critic["agentId"], ask, depth=depth + 1)["text"]
            trace.append({"step": critic.get("id"), "agent": critic["agentId"], "output": review[:4000]})
            if re.search(r"\bAPPROVED\b", review):
                break
            draft = run_agent(writer["agentId"], f"Revise your answer using this review.\n\nTask:\n{input_text}\n\nYour answer:\n{draft}\n\nReview:\n{review}", depth=depth + 1)["text"]
            trace.append({"step": writer.get("id"), "agent": writer["agentId"], "output": draft[:6000], "revision": True})
        final = draft
    else:
        prev = input_text
        for s in steps:
            prev = outputs[s.get("id") or s["agentId"]] = step(s, prev)
        final = prev
    run = store.add_run({"kind": "workflow", "workflowId": wf_id, "name": wf.get("name"), "input": input_text[:2000], "output": final[:20_000], "trace": trace, "ms": int((time.time() - started) * 1000)})
    return {"output": final, "trace": trace, "runId": run["id"], "ms": run["ms"]}
