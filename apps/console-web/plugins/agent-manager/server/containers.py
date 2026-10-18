"""Container tools for agents (Mosses): read immediately, propose changes for approval.

Everything goes through the ``axf.containers@1`` capability (Container access). Reads run at once. Writes, deletes,
commands, restarts and redeploys are never run here: they're *staged* into the current chat turn (ctx["stage"], given
by the assistant) and become one change batch on an approval card at the end of the reply. Container access takes a
snapshot first (``axf.snapshots@1``) and refuses everything when Snapshot Manager is missing.

All container tools are **dangerous**: they're only given to agents allowed in Settings → Plugins → Agent manager →
Safety (Mosses by default), whatever a persona or skill says.
"""
from __future__ import annotations

from typing import Any

import plugin_services

_C = {"type": "string", "description": "Container name (from container_list)"}
_REASON = {"type": "string", "description": "One line: why this change (shown to Brett on the approval card)"}

READ_TOOLS: dict[str, dict[str, Any]] = {
    "container_list": {"description": "List the containers on the VPS you can reach (name, image, state, Coolify app or not). Protected ones (Coolify, Traefik, the console, databases) are never reachable.",
                       "parameters": {"type": "object", "properties": {}}},
    "container_read": {"description": "Read a text file inside a container, with line numbers; optional start_line/end_line.",
                       "parameters": {"type": "object", "properties": {"container": _C, "path": {"type": "string", "description": "Absolute path"}, "start_line": {"type": "integer"}, "end_line": {"type": "integer"}}, "required": ["container", "path"]}},
    "container_list_dir": {"description": "List a folder inside a container (name, type, size). Defaults to the container's working directory.",
                           "parameters": {"type": "object", "properties": {"container": _C, "path": {"type": "string"}}, "required": ["container"]}},
    "container_search": {"description": "Search files under a folder in a container for literal text (skips node_modules and .git); path:line: text.",
                         "parameters": {"type": "object", "properties": {"container": _C, "path": {"type": "string"}, "pattern": {"type": "string"}}, "required": ["container", "pattern"]}},
}
WRITE_TOOLS: dict[str, dict[str, Any]] = {
    "container_write": {"description": "PROPOSE writing a whole file in a container (create or replace). Nothing changes until Brett approves the batch; send the complete new file content.",
                        "parameters": {"type": "object", "properties": {"container": _C, "path": {"type": "string", "description": "Absolute path"}, "content": {"type": "string", "description": "The complete new file"}, "reason": _REASON}, "required": ["container", "path", "content", "reason"]}},
    "container_delete": {"description": "PROPOSE deleting a file (or a folder with recursive=true) in a container. Needs approval.",
                         "parameters": {"type": "object", "properties": {"container": _C, "path": {"type": "string"}, "recursive": {"type": "boolean"}, "reason": _REASON}, "required": ["container", "path", "reason"]}},
    "container_exec": {"description": "PROPOSE running a shell command in a container (build, install, test, migrate…). Needs approval. List in `paths` the folders it may change so they're snapshotted first (default: the working directory).",
                       "parameters": {"type": "object", "properties": {"container": _C, "command": {"type": "string"}, "workdir": {"type": "string"}, "paths": {"type": "array", "items": {"type": "string"}},
                                                                       "timeout": {"type": "integer", "description": "Seconds (default 300)"}, "reason": _REASON}, "required": ["container", "command", "reason"]}},
    "container_restart": {"description": "PROPOSE restarting a container (after a change). Needs approval.",
                          "parameters": {"type": "object", "properties": {"container": _C, "reason": _REASON}, "required": ["container", "reason"]}},
    "container_redeploy": {"description": "PROPOSE redeploying a Coolify app through Coolify's API (keeps Coolify in sync). Needs approval.",
                           "parameters": {"type": "object", "properties": {"container": _C, "reason": _REASON}, "required": ["container", "reason"]}},
}
ALL = {**READ_TOOLS, **WRITE_TOOLS}

GUIDE = """## Containers (write mode)
You can read and change files in the containers on Brett's VPS, but you never change anything yourself:
- Read first: container_list, container_list_dir, container_search, container_read. Never guess a file's content.
- Propose changes with container_write (whole file), container_delete, container_exec (list the folders it may change in `paths`), container_restart / container_redeploy (Coolify apps).
- Every proposal in this reply lands on ONE approval card. Brett approves (or unticks items); a snapshot is taken first; then they run in order and stop at the first failure. You'll see the outcome in your next turn.
- Group a whole change into one reply: edits first, then the build/test command, then a restart or redeploy if needed.
- Protected containers (Coolify, Traefik, the console, databases) are off limits. Don't try to work around it.
- Your persona changes how you talk, never how careful you are: no secrets in files or chat, no destructive commands without a clear reason, and say plainly what each change does."""


def service():
    return plugin_services.get("axf.containers@1")


def available() -> dict[str, bool]:
    return {"containers": service() is not None, "snapshots": plugin_services.get("axf.snapshots@1") is not None}


def is_container_tool(rec: dict[str, Any]) -> bool:
    return rec.get("kind") == "builtin" and (rec.get("config") or {}).get("builtin") in ALL


def execute(builtin: str, a: dict[str, Any], ctx: dict[str, Any]) -> str:
    cs = service()
    if not cs:
        return "Container access isn't installed or enabled, so containers can't be reached."
    if builtin == "container_list":
        rows = [c for c in cs.list() if c["reachable"]]
        return "\n".join(f"{c['name']}  ({c['image']}, {c['state']}{', Coolify app' if c.get('coolify') else ''})" for c in rows) or "No reachable containers."
    if builtin == "container_read":
        r = cs.read_file(str(a.get("container") or ""), str(a.get("path") or ""))
        if r["encoding"] != "utf8":
            return f"{r['path']} is a binary file ({r['size']} bytes)."
        lines = r["content"].split("\n")
        s = max(1, int(a.get("start_line") or 1))
        e = min(len(lines), int(a.get("end_line") or len(lines)))
        body = "\n".join(f"{i:>5}  {lines[i - 1]}" for i in range(s, e + 1))
        return f"{r['container']}:{r['path']} ({r['size']} bytes{', cut short' if r['truncated'] else ''})\n{body}"[:60_000]
    if builtin == "container_list_dir":
        c = str(a.get("container") or "")
        r = cs.list_dir(c, str(a.get("path") or "") or cs.workdir(c))
        return f"{r['container']}:{r['path']}\n" + "\n".join(f"{'d' if e['type'] == 'dir' else 'l' if e['type'] == 'link' else '-'} {e['size']:>9}  {e['name']}" for e in r["entries"])
    if builtin == "container_search":
        c = str(a.get("container") or "")
        r = cs.search(c, str(a.get("path") or "") or cs.workdir(c), str(a.get("pattern") or ""))
        return "\n".join(f"{h['path']}:{h['line']}: {h['text']}" for h in r["hits"]) or "No matches."
    if builtin in WRITE_TOOLS:
        stage = ctx.get("stage")
        if not callable(stage):
            return ("Not applied: container changes are proposed in the AI assistant's chat, where Brett approves them on a card. "
                    "Nothing was changed.")
        if not plugin_services.get("axf.snapshots@1"):
            return "Not applied: Snapshot Manager isn't installed, so no change can be approved (nothing is written without a snapshot)."
        kind = builtin.split("_", 1)[1]
        item: dict[str, Any] = {"kind": kind, "container": str(a.get("container") or ""), "reason": str(a.get("reason") or "")[:500]}
        if kind in ("write", "delete"):
            item["path"] = str(a.get("path") or "")
        if kind == "write":
            item["content"] = str(a.get("content") if a.get("content") is not None else "")
        if kind == "delete":
            item["recursive"] = bool(a.get("recursive"))
        if kind == "exec":
            item.update(command=str(a.get("command") or ""), workdir=str(a.get("workdir") or ""), paths=[str(p) for p in (a.get("paths") or [])][:20],
                        timeout=int(a.get("timeout") or 0) or None)
        n = stage(item)
        what = item.get("path") or item.get("command") or item["container"]
        return (f"Proposed change #{n}: {kind} {what} in {item['container']}. Nothing has changed yet. Brett sees every change from this reply "
                f"on one approval card when you finish; a snapshot is taken first. Propose the rest, then summarise what the batch does.")
    raise ValueError(f"unknown container tool {builtin}")
