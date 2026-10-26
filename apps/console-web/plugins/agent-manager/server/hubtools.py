"""Mosses's axHub tool (Oct 22 2026): `axhub_call` — run a tool on Brett's connector hub (vps.run, vps.check, github.*, …).

Every Auto fix in the console (systems check VPS fixes, "Claude on failure", the push banner's Fix with Claude) goes
through this tool on Mosses (`axf.agents@1` → run_tool), because Mosses is the agent with root and build permission:
the console never calls axHub's `vps.run` itself. The hub still decides: `vps.run` always needs Brett's approval on the
hub (the approval page shows the whole call), and the hub's policy refuses what it refuses. This tool never approves.

A **dangerous** builtin (Settings → Plugins → Agent manager → Safety decides who gets it; Mosses by default).

Arguments: {tool: "service.tool", arguments: {...}, confirmation_id?, wait?: true, reason?}
  wait=true  (default, for a model): when the hub asks for approval, keep retrying with its id (15 s × 10, then every
             minute, up to 30 min) until it runs, is rejected or expires.
  wait=false (for Auto fix, which shows its own approval state): answer at once with {"status":"confirm", id, link}.
Answers JSON: {"status":"ok","output":…} | {"status":"confirm","confirmationId":…,"link":…} | {"status":"error","message":…}.
A call that runs longer than the hub's 25 s sync wait comes back as a job: followed with get_job until it finishes.
Needs AXHUB_URL (default https://axhub.amberxai.com) + AXHUB_TOKEN in the console's environment; the token never goes
to the model, to the browser, or anywhere but the hub (https only, no redirects).
"""
from __future__ import annotations

import json
import os
import re
import time
import uuid
from typing import Any, Callable

import threading
from pathlib import Path

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http

import plugin_services

from . import store, toolkit

TOOL = "axhub_call"
TOOL_RE = re.compile(r"[a-z][a-z0-9_-]{0,40}\.[A-Za-z0-9_./-]{1,120}\Z")
CONF_RE = re.compile(r"[0-9a-f-]{36}\Z")
WAIT_S = 30 * 60
MAX_ARGS = 3800  # the hub refuses approvals whose arguments are over 4000 characters


class HubError(Exception):
    pass


def _hub() -> tuple[str, str]:
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        raise HubError("axHub isn't connected: add the axHub token (Keys needed → axHub connection).")
    if not url.startswith("https://"):
        raise HubError("The axHub address must be https.")
    return url, tok


def _rpc(url: str, tok: str, session: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
    if session:
        headers["mcp-session-id"] = session
    try:  # https only, never follows a redirect: the token goes nowhere else
        r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=timeout, max_bytes=2_000_000, truncate=True)
    except axf_http.HttpError as e:
        raise HubError(f"Couldn't reach axHub ({type(e).__name__})") from None
    if not r.ok:
        raise HubError(f"axHub answered {r.status}" + (" (check the axHub token)" if r.status in (401, 403) else ""))
    raw = r.text()
    if "text/event-stream" in r.headers.get("content-type", ""):
        msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
    else:
        msg = json.loads(raw or "{}")
    if "error" in msg:
        raise HubError(str(msg["error"].get("message", "axHub error"))[:300])
    return msg.get("result") or {}, r.headers.get("mcp-session-id") or session


def _texts(res: dict[str, Any]) -> list[str]:
    return [c.get("text", "") for c in res.get("content", []) if isinstance(c, dict)]


def started_job(res: dict[str, Any], text: str) -> str | None:
    """A call longer than the hub's sync wait (25 s) answers {"status": "started", "job_id": …}."""
    if res.get("isError"):
        return None
    jid = str((res.get("_meta") or {}).get("axhub/jobId") or "")
    if not jid:
        try:
            b = json.loads(text)
        except Exception:  # noqa: BLE001
            return None
        if isinstance(b, dict) and b.get("status") == "started":
            jid = str(b.get("job_id") or "")
    if jid and not CONF_RE.match(jid):
        raise HubError("axHub started a job without a valid id")
    return jid or None


def follow_job(rpc: Callable[..., tuple[dict[str, Any], str | None]], sid: str | None, job_id: str, timeout: float,
               reinit: Callable[[], str | None] | None = None, poll_s: float = 5) -> str:
    """Poll get_job until it finishes: the output when it succeeded, HubError otherwise (new session on a 404)."""
    deadline, reinits = time.time() + timeout + 120, 0
    while True:
        try:
            res, sid = rpc(sid, "tools/call", {"name": "get_job", "arguments": {"job_id": job_id}}, 60)
        except HubError as e:
            if "404" not in str(e) or not reinit or reinits >= 3:
                raise
            reinits += 1
            sid = reinit()
            continue
        parts = _texts(res)
        if res.get("isError"):
            raise HubError(("\n".join(parts) or "axHub couldn't read the job")[:400])
        try:
            head = json.loads(parts[0]) if parts else {}
        except Exception:  # noqa: BLE001
            head = {}
        state = head.get("state") or (res.get("_meta") or {}).get("axhub/jobState")
        if state == "succeeded":
            return "\n".join(parts[1:])
        if state in ("failed", "cancelled"):
            raise HubError(str((head.get("error") or {}).get("message") or f"The job {state} on axHub.")[:400])
        if time.time() > deadline:
            raise HubError("Still running on axHub after its time limit.")
        time.sleep(poll_s)


def hub_reason(title: Any, description: Any = None, tool: str = "") -> dict[str, str] | None:
    """What axHub shows first on the approval page (axHub decision #99): {title, description}, or None when no title.

    A call that needs approval without one is refused by the hub, so every caller says what it is for."""
    if isinstance(title, dict):
        description = title.get("description") if description is None else description
        title = title.get("title")
    t = " ".join(str(title or "").split())[:120]
    if not t:
        return None
    d = str(description or "").strip()[:1000] or f"{t}. Runs {tool or 'the hub tool'} with the arguments shown in the code section."
    return {"title": t, "description": d}


def call_once(tool: str, arguments: dict[str, Any], confirmation_id: str | None = None, timeout: float = 600,
              reason: dict[str, str] | None = None) -> dict[str, Any]:
    """One `call` through the hub: {"ok": text} | {"confirm": id}; HubError otherwise."""
    url, tok = _hub()

    def rpc(sid: str | None, method: str, params: dict[str, Any], t: float) -> tuple[dict[str, Any], str | None]:
        return _rpc(url, tok, sid, method, params, t)

    def init() -> str | None:
        return rpc(None, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-mosses", "version": "1"}}, 30)[1]

    sid = init()
    args: dict[str, Any] = {"tool": tool, "arguments": arguments, "timeout_seconds": int(timeout)}
    if confirmation_id:
        args["confirmation_id"] = confirmation_id
    if reason:
        args["reason"] = reason
    res, _ = rpc(sid, "tools/call", {"name": "call", "arguments": args}, timeout + 30)
    text = "\n".join(_texts(res))
    jid = started_job(res, text)
    if jid:
        return {"ok": follow_job(rpc, sid, jid, timeout, reinit=init)}
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except Exception:  # noqa: BLE001
            err = {"message": text}
        if err.get("code") == "confirmation_required":
            cid = str((err.get("details") or {}).get("confirmationId", ""))
            if not CONF_RE.match(cid):
                raise HubError("axHub asked for an approval without an id")
            return {"confirm": cid}
        raise HubError(str(err.get("message") or text)[:400])
    return {"ok": text}


def approval_link(cid: str) -> str:
    base = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    return f"{base}/auth/admin/approvals/{cid}"


def retry_delays() -> list[float]:
    """Approval retries: the first 10 every 15 seconds, then every minute (shared rule, Oct 21 2026)."""
    return [15.0] * 10 + [60.0] * 40


# ---------------------------------------------------------------- approved shell runs (Oct 23 2026)
# Brett: once an approved VPS or shell command has run, open the terminal with the command and its output. Every run of
# a shell tool (vps.run, vps.logs, any <service>.run/.exec/.shell) that went through an approval on the hub is kept here
# (last RUNS_KEEP, in the plugin's data folder, 0600) and served as capability `axf.hub-runs@1`; the terminal plugin
# shows each new one in an output tab. The hub has already hidden secret-looking values in the output.
RUNS_KEEP = 50
RUNS_FILE = "hub-runs.json"
_runs_lock = threading.Lock()


def shell_tool(tool: str) -> bool:
    svc, _, name = tool.partition(".")
    return svc == "vps" and name != "check" or name.split("/")[-1] in ("run", "exec", "shell")


def record_run(tool: str, arguments: dict[str, Any], output: str, reason: str, agent: str, confirmation_id: str) -> dict[str, Any]:
    cmd = arguments.get("command") if isinstance(arguments.get("command"), str) else json.dumps(arguments, ensure_ascii=False)
    m = re.search(r"^exit (-?\d+)\b", output, re.M)
    run = {"id": uuid.uuid4().hex[:16], "at": int(time.time() * 1000), "tool": tool, "command": str(cmd)[:4000], "output": output[-200_000:],
           "exit": int(m.group(1)) if m else None, "reason": reason[:300], "agent": agent[:80], "confirmationId": confirmation_id}
    with _runs_lock:
        runs = store._read(store.DATA / RUNS_FILE, [])  # noqa: SLF001 — the plugin's own data folder
        runs = [r for r in runs if isinstance(r, dict)][-(RUNS_KEEP - 1):] + [run]
        store._write(store.DATA / RUNS_FILE, runs)  # noqa: SLF001
    return run


class HubRuns:
    """axf.hub-runs@1 — approved shell runs through Mosses's axhub_call, newest last."""
    version = 1

    def runs(self, since: int = 0) -> list[dict[str, Any]]:
        with _runs_lock:
            runs = store._read(store.DATA / RUNS_FILE, [])  # noqa: SLF001
        return [r for r in runs if isinstance(r, dict) and int(r.get("at") or 0) > int(since or 0)]

    def get(self, run_id: str) -> dict[str, Any] | None:
        return next((r for r in self.runs() if r.get("id") == run_id), None)


plugin_services.provide("axf.hub-runs@1", HubRuns(), Path(__file__).resolve().parents[1].name)


def run(args: dict[str, Any], ctx: dict[str, Any], call: Callable[..., dict[str, Any]] = call_once,
        delays: Callable[[], list[float]] = retry_delays, sleep: Callable[[float], None] = time.sleep) -> str:
    """The tool. Never raises for hub answers: errors come back as {"status": "error"} so a model can read them."""
    tool = str(args.get("tool") or "")
    arguments = args.get("arguments") if isinstance(args.get("arguments"), dict) else {}
    conf = args.get("confirmation_id")
    if not TOOL_RE.match(tool):
        return json.dumps({"status": "error", "message": "tool is service.tool, e.g. vps.run"})
    if conf is not None and not (isinstance(conf, str) and CONF_RE.match(conf)):
        return json.dumps({"status": "error", "message": "confirmation_id is the id axHub gave"})
    if len(json.dumps(arguments)) > MAX_ARGS:
        return json.dumps({"status": "error", "message": f"arguments are over {MAX_ARGS} characters: axHub can't show them for approval"})
    timeout = float(arguments.get("timeout_seconds") or 600) if isinstance(arguments.get("timeout_seconds"), (int, float)) else 600.0
    wait = args.get("wait") is not False
    approved = conf if isinstance(conf, str) else ""
    why = hub_reason(args.get("reason"), args.get("description"), tool)
    extra: dict[str, Any] = {"reason": why} if why else {}
    try:
        r = call(tool, arguments, conf, timeout, **extra)
        if "confirm" in r and wait:
            cid = r["confirm"]
            approved = cid
            deadline = time.time() + WAIT_S
            waits = iter(delays())
            while "confirm" in r:
                if time.time() > deadline:
                    return json.dumps({"status": "error", "message": "The approval expired."})
                sleep(next(waits, 60.0))
                try:
                    r = call(tool, arguments, cid, timeout, **extra)
                except HubError as e:
                    m = str(e).lower()
                    return json.dumps({"status": "error", "message": "Rejected on the hub." if "reject" in m else "The approval expired." if "expired" in m else str(e)})
        if "confirm" in r:
            return json.dumps({"status": "confirm", "confirmationId": r["confirm"], "link": approval_link(r["confirm"])})
        out = str(r.get("ok", ""))
        if approved and shell_tool(tool):  # an approved shell command ran: the terminal shows it (axf.hub-runs@1)
            try:
                record_run(tool, arguments, out, (why or {}).get("title", ""), str((ctx.get("agent") or {}).get("name") or ""), approved)
            except Exception:  # noqa: BLE001 — the log never breaks the call
                pass
        return json.dumps({"status": "ok", "output": out[-40_000:]})
    except HubError as e:
        return json.dumps({"status": "error", "message": str(e)[:400]})


SPEC = {
    "description": ("Run a tool on Brett's connector hub axHub (e.g. vps.run = a shell command on the VPS as root, vps.check, "
                    "vps.logs, github.*). axHub asks Brett to approve anything risky (every vps.run): this call waits for his "
                    "decision (up to 30 min) and returns the result. Always give `reason` (what Brett is approving, one plain "
                    "line) and `description` (what it does and why): the approval page shows them first, then the code. "
                    "Never put secrets in commands."),
    "parameters": {"type": "object", "properties": {
        "tool": {"type": "string", "description": "service.tool, e.g. vps.run"},
        "arguments": {"type": "object", "description": "The hub tool's arguments, e.g. {command, timeout_seconds} for vps.run"},
        "reason": {"type": "string", "description": "What Brett is approving, one plain line, e.g. \"Restart the console container\""},
        "description": {"type": "string", "description": "What it does and why, in plain words (shown when he opens the request)"},
        "confirmation_id": {"type": "string", "description": "Only when retrying a call Brett approved"},
        "wait": {"type": "boolean", "description": "Default true: wait for Brett's approval"}},
        "required": ["tool", "arguments", "reason"]},
}

toolkit.register_builtin(TOOL, SPEC, lambda a, ctx: run(a, ctx), dangerous=True)
