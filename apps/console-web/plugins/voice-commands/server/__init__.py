"""Voice commands server part (voice-command@1; framework/core/engines/voice-command-rules.mjs is the one rules file).

Matches what was said against every app's voice commands (framework/cli/voice-commands.mjs registry / say), asks when
a required slot was not heard or the command deletes something, runs the command and answers:

  GET  /registry                every app's voice commands (voice-registry@1, cached a few seconds)
  GET  /help?app=               "what can I say" lines (one app or every app)
  POST /match   {text, app?}    what would run (nothing runs)
  POST /run     {text, app?, by?, reason?} | {pending, answer} | {text, confirm: true}
                → {ok, app, command, slots, result, say}                      ran
                → {ok: false, code: confirmation_required, pending, question}  ask the person, send the answer back
                → {ok: false, code: not_found, message}                       nothing matched
  GET  /recent                  the last runs (audited: who, what, result)

How a command runs, by its `run` targets: a plugin command or read → plugin-commands@1 (`/api/control/<plugin>/<id>`);
a control@1 tool → control@1; a console action → console-commands@1 in the open console; any other MCP tool of this
console (e.g. expenses_add) → the console's own /mcp (loopback, the console token); a console route → loopback.
The caller already holds the console token (the route requires it), so the runner acts with the full control grant.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request

import console_context as cx
import plugin_services

FOLDER = "voice-commands"
ROOT = Path(__file__).resolve().parents[5]
CLI = ROOT / "framework" / "cli" / "voice-commands.mjs"
DATA = Path(os.environ.get("AXF_VOICE_COMMANDS_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
CACHE_SECONDS = float(os.environ.get("AXF_VOICE_COMMANDS_CACHE") or 20)
PENDING_SECONDS = 180
RECENT_MAX = 200
GRANTS = ["control.*"]

router = APIRouter()
_lock = threading.Lock()
_cache: dict[str, Any] = {"at": 0.0, "data": None}
_pending: dict[str, dict[str, Any]] = {}
_yes = ["yes", "yeah", "yep", "yup", "confirm", "confirmed", "do it", "go ahead", "ok", "okay", "sure", "bet", "say less"]
_no = ["no", "nope", "cancel", "stop", "never mind", "nevermind", "forget it", "abort"]


# ---------------------------------------------------------------------- the rules file, through its CLI

def _node(args: list[str], timeout: int = 60) -> Any:
    p = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                       env={**os.environ, "AXF_ROOT": str(os.environ.get("AXF_VOICE_COMMANDS_ROOT") or ROOT)})
    out = p.stdout.strip()
    if not out:
        raise RuntimeError((p.stderr or "voice-commands.mjs gave no output").strip()[-600:])
    return json.loads(out)


def registry(force: bool = False) -> dict[str, Any]:
    with _lock:
        if force or _cache["data"] is None or time.time() - _cache["at"] > CACHE_SECONDS:
            _cache["data"] = _node(["registry"])
            _cache["at"] = time.time()
        return _cache["data"]


def match(text: str, app: str = "") -> dict[str, Any] | None:
    args = ["say", text]
    if app:
        args += ["--app", app]
    return _node(args)


def help_lines(app: str = "") -> list[dict[str, Any]]:
    return _node(["help", app] if app else ["help"])


def yes_or_no(text: str) -> bool | None:
    s = re.sub(r"[^a-z ]", " ", (text or "").lower()).strip()
    s = re.sub(r"\s+", " ", s)
    if not s:
        return None
    if any(s == y or s.startswith(y + " ") for y in _yes):
        return True
    if any(s == n or s.startswith(n + " ") for n in _no):
        return False
    return None


# ---------------------------------------------------------------------- running

def _say(command: dict[str, Any], slots: dict[str, Any], result: Any) -> str:
    tpl = command.get("say") or ("{title}: {result}" if command.get("effect") == "read" else "{title}: done.")
    short = _short(result)

    def fill(m: re.Match[str]) -> str:
        n = m.group(1)
        if n == "result":
            return short
        if n == "title":
            return str(command.get("title") or "")
        return str(slots.get(n, m.group(0)))
    return re.sub(r"\s+", " ", re.sub(r"\{([a-zA-Z][a-zA-Z0-9]*)\}", fill, tpl)).strip()


def _short(result: Any) -> str:
    """A spoken-size summary of a result."""
    if result is None:
        return "done"
    if isinstance(result, dict):
        if "message" in result and isinstance(result["message"], str):
            return result["message"][:200]
        for k in ("count", "total", "totals", "entries", "items", "value", "entry", "result", *result.keys()):
            if k in result and k != "ok":
                v = result[k]
                if isinstance(v, list):
                    return f"{len(v)} {k}"
                if isinstance(v, (int, float, str)):
                    return f"{k} {v}"[:200]
                if isinstance(v, dict):
                    return ", ".join(f"{a} {b}" for a, b in list(v.items())[:4])[:200]
        return "done"
    if isinstance(result, list):
        return f"{len(result)} items"
    return str(result)[:200]


def _loopback(method: str, path: str, body: Any = None, params: dict[str, Any] | None = None) -> dict[str, Any]:
    headers = {"content-type": "application/json"}
    tok = cx.current_token() if hasattr(cx, "current_token") else ""
    if tok:
        headers["authorization"] = f"Bearer {tok}"
    data = None if body is None else json.dumps(body)
    try:
        import httpx
        base = os.environ.get("AXF_CONSOLE_INTERNAL_URL") or f"http://127.0.0.1:{os.environ.get('PORT', '7090')}"
        r = httpx.request(method, base + path, params=params, content=data, headers=headers, timeout=120)
    except Exception:  # noqa: BLE001 — no server listening (tests, a bare import)
        app = getattr(cx, "asgi_app", None)
        if app is None:
            return {"ok": False, "code": "not_implemented", "message": "the console server is not reachable for this command"}
        from starlette.testclient import TestClient
        r = TestClient(app, raise_server_exceptions=False).request(method, path, params=params, content=data, headers=headers)
    try:
        out = r.json()
    except Exception:  # noqa: BLE001
        out = {"text": r.text[:2000]}
    if isinstance(out, dict):
        out.setdefault("ok", r.status_code < 400)
        return out
    return {"ok": r.status_code < 400, "result": out}


def _mcp_call(name: str, arguments: dict[str, Any]) -> dict[str, Any]:
    """Any MCP tool of this console (plugin tools, control, expenses_*, …) through its own /mcp (JSON answers)."""
    r = _loopback("POST", "/mcp", {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": name, "arguments": arguments}})
    res = r.get("result") if isinstance(r, dict) else None
    if isinstance(res, dict):
        if res.get("structuredContent") is not None:
            return {"ok": not res.get("isError"), "result": res["structuredContent"]}
        texts = [c.get("text") for c in res.get("content", []) if isinstance(c, dict) and c.get("type") == "text"]
        parsed: Any = None
        for t in texts:
            try:
                parsed = json.loads(t)
                break
            except Exception:  # noqa: BLE001
                parsed = t
        return {"ok": not res.get("isError"), "result": parsed}
    if isinstance(r, dict) and r.get("error"):
        return {"ok": False, "code": "unexpected", "message": str(r["error"].get("message") if isinstance(r["error"], dict) else r["error"])}
    return r


def execute(m: dict[str, Any], by: str, reason: str) -> dict[str, Any]:
    """Run a matched command: {ok, result, via}."""
    c = m["command"]
    run = c.get("run") or {}
    slots = {k: v for k, v in (m.get("slots") or {}).items()}
    api = str(run.get("api") or "")
    pm = re.match(r"^(?:[A-Z]+\s+)?/api/control/([a-z0-9-]+)/([a-z0-9_.-]+)$", api)
    ctl = re.match(r"^(?:[A-Z]+\s+)?/api/control/([a-z]+)$", api)
    if pm:
        svc = plugin_services.get("plugin-commands@1")
        if svc is None:
            return {"ok": False, "code": "not_implemented", "message": "plugin-commands@1 is not installed"}
        read = c.get("effect") == "read"
        cmd = {"$axf": "control@1", "op": "act", "target": "plugins.reads" if read else "plugins.commands", "path": f"{pm.group(1)}/{pm.group(2)}", "action": "read" if read else "run", "input": slots, "by": by, "reason": reason}
        r = svc.run(cmd, GRANTS, by)
        if isinstance(r, dict) and r.get("code") == "confirmation_required" and r.get("confirm"):
            r = svc.run({**cmd, "confirm": r["confirm"]}, GRANTS, by)  # the person already said yes
        return {**(r if isinstance(r, dict) else {"result": r}), "via": "plugin-commands@1"}
    if ctl and run.get("mcp", "").startswith("control_"):
        svc = plugin_services.get("control@1")
        if svc is None:
            return {"ok": False, "code": "not_implemented", "message": "control@1 is not installed"}
        cmd = {"$axf": "control@1", "op": ctl.group(1), **{k: v for k, v in slots.items() if k in ("target", "path", "value", "action", "select", "input")}, "by": by, "reason": reason}
        r = svc.run(cmd, GRANTS, by)
        if isinstance(r, dict) and r.get("code") == "confirmation_required" and r.get("confirm"):
            r = svc.run({**cmd, "confirm": r["confirm"]}, GRANTS, by)
        return {**(r if isinstance(r, dict) else {"result": r}), "via": "control@1"}
    if run.get("action"):
        svc = plugin_services.get("console-commands@1")
        if svc is None:
            return {"ok": False, "code": "not_implemented", "message": "console-commands@1 is not installed (no open console to run the action in)"}
        args = [str(v) for v in slots.values()]
        r = svc.run({"$axf": "control@1", "op": "act", "target": "console.actions", "path": run["action"], "action": "run", "input": {"args": args}, "by": by, "reason": reason}, GRANTS, by)
        return {**(r if isinstance(r, dict) else {"result": r}), "via": "console-commands@1"}
    if run.get("mcp"):
        return {**_mcp_call(str(run["mcp"]), slots), "via": "mcp"}
    if api.startswith(("GET /api/", "POST /api/", "PUT /api/", "PATCH /api/", "DELETE /api/", "/api/")):
        parts = api.split(" ", 1)
        method, path = (parts[0], parts[1]) if len(parts) == 2 else ("GET", parts[0])
        path = re.sub(r"\{(\w+)\}", lambda mm: str(slots.pop(mm.group(1), mm.group(0))), path)
        r = _loopback(method, path, None if method == "GET" else slots, slots if method == "GET" else None)
        return {**r, "via": "api"}
    return {"ok": False, "code": "not_implemented", "message": f"no way to run {m.get('app')}/{c.get('id')} from the console: its run names only {', '.join(run.keys()) or 'nothing'} (declare an mcp tool, a console route or an action in axf.commands.json)"}


def _record(entry: dict[str, Any]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    f = DATA / "runs.jsonl"
    with _lock:
        lines = f.read_text(encoding="utf-8").splitlines() if f.exists() else []
        lines.append(json.dumps(entry, ensure_ascii=False))
        f.write_text("\n".join(lines[-RECENT_MAX:]) + "\n", encoding="utf-8")


def recent(limit: int = 50) -> list[dict[str, Any]]:
    f = DATA / "runs.jsonl"
    if not f.exists():
        return []
    out = []
    for line in f.read_text(encoding="utf-8").splitlines()[-limit:]:
        try:
            out.append(json.loads(line))
        except Exception:  # noqa: BLE001
            continue
    return list(reversed(out))


def _sweep() -> None:
    now = time.time()
    for k in [k for k, v in _pending.items() if now - v["at"] > PENDING_SECONDS]:
        _pending.pop(k, None)


def say(text: str = "", app: str = "", by: str = "", reason: str = "", pending: str = "", answer: str = "", confirm: bool = False) -> dict[str, Any]:
    """The whole flow: match → ask → run → answer. Pure of HTTP, so MCP, the CLI and the Molly bridge share it."""
    _sweep()
    by = by or "voice"
    confirmed = confirm
    if pending:
        p = _pending.pop(pending, None)
        if p is None:
            return {"ok": False, "code": "not_found", "message": "that question is gone (answer within three minutes)"}
        yn = yes_or_no(answer)
        if p["match"].get("missing"):
            if yn is False:
                return {"ok": False, "code": "cancelled", "message": "Cancelled."}
            m = p["match"]
            f = _node(["fill", json.dumps({"command": m["command"], "slots": m.get("slots") or {}, "name": m["missing"][0], "text": answer})])
            m = {**m, "slots": f["slots"], "missing": f["missing"], "confirm": f["confirm"], "question": f["question"]}
            if f["missing"] or not f["ok"]:
                pid = uuid.uuid4().hex[:10]
                _pending[pid] = {"match": m, "text": p["text"], "app": p.get("app", ""), "at": time.time()}
                return {"ok": False, "code": "confirmation_required", "pending": pid, "question": m["question"], "app": m.get("app"), "command": m["command"]["id"], "title": m["command"].get("title"), "slots": m["slots"], "missing": m["missing"]}
            if confirm_rule(m["command"]) == "always":
                pid = uuid.uuid4().hex[:10]
                _pending[pid] = {"match": m, "text": p["text"], "app": p.get("app", ""), "at": time.time()}
                return {"ok": False, "code": "confirmation_required", "pending": pid, "question": m["question"], "app": m.get("app"), "command": m["command"]["id"], "title": m["command"].get("title"), "slots": m["slots"], "missing": []}
            return _finish(m, p["text"], by, reason)
        else:
            if yn is not True:
                return {"ok": False, "code": "cancelled", "message": "Cancelled." if yn is False else f"I did not get a yes or a no, so {p['match']['command']['title']} was not run."}
            text = p["text"]
            app = p.get("app", "")
            confirmed = True
    text = (text or "").strip()
    if not text:
        return {"ok": False, "code": "invalid", "message": "say something"}
    m = match(text, app)
    if not m:
        apps = [a.get("displayName") or a.get("app") for a in registry().get("apps", [])]
        return {"ok": False, "code": "not_found", "message": f"Nothing in {', '.join(apps) or 'the apps'} matches \"{text}\". Ask: what can I say?"}
    if (m.get("confirm") or m.get("missing")) and not (confirmed and not m.get("missing")):
        pid = uuid.uuid4().hex[:10]
        _pending[pid] = {"match": m, "text": text, "app": app, "at": time.time()}
        return {"ok": False, "code": "confirmation_required", "pending": pid, "question": m.get("question"), "app": m.get("app"), "command": m["command"]["id"], "title": m["command"].get("title"), "slots": m.get("slots"), "missing": m.get("missing")}
    return _finish(m, text, by, reason)


def confirm_rule(command: dict[str, Any]) -> str:
    floor = {"read": "never", "navigate": "never", "write": "missing", "destructive": "always"}.get(str(command.get("effect")), "missing")
    own = command.get("confirm") if command.get("confirm") in ("never", "missing", "always") else floor
    order = ["never", "missing", "always"]
    return own if order.index(own) >= order.index(floor) else floor


def _finish(m: dict[str, Any], text: str, by: str, reason: str) -> dict[str, Any]:
    r = execute(m, by, reason)
    ok = bool(r.get("ok", True)) and not r.get("code") in ("denied", "not_found", "validation", "invalid", "not_implemented", "unexpected")
    result = r.get("result", r)
    out = {"ok": ok, "app": m.get("app"), "command": m["command"]["id"], "title": m["command"].get("title"), "effect": m["command"].get("effect"), "slots": m.get("slots"), "via": r.get("via"), "result": result if ok else None,
           "say": _say(m["command"], m.get("slots") or {}, result) if ok else f"{m['command'].get('title')} did not run: {r.get('message') or r.get('code') or 'error'}"}
    if not ok:
        out["code"] = r.get("code") or "unexpected"
        out["message"] = r.get("message") or ""
    _record({"at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "by": by, "text": text, "app": out["app"], "command": out["command"], "slots": out["slots"], "ok": ok, "via": out.get("via"), "say": out["say"]})
    return out


# ---------------------------------------------------------------------- routes

@router.get("/registry")
def get_registry(force: bool = False) -> dict[str, Any]:
    return registry(force)


@router.get("/help")
def get_help(app: str = "") -> dict[str, Any]:
    return {"ok": True, "app": app, "apps": help_lines(app)}


@router.post("/match")
async def post_match(request: Request) -> dict[str, Any]:
    body = await request.json()
    m = match(str(body.get("text") or ""), str(body.get("app") or ""))
    return {"ok": True, "match": m}


@router.post("/run")
async def post_run(request: Request) -> dict[str, Any]:
    body = await request.json()
    if not isinstance(body, dict):
        return {"ok": False, "code": "invalid", "message": "body must be an object"}
    return say(text=str(body.get("text") or ""), app=str(body.get("app") or ""), by=str(body.get("by") or "voice"), reason=str(body.get("reason") or "voice command"),
               pending=str(body.get("pending") or ""), answer=str(body.get("answer") or ""), confirm=body.get("confirm") is True)


@router.get("/recent")
def get_recent(limit: int = 50) -> dict[str, Any]:
    return {"ok": True, "runs": recent(max(1, min(limit, RECENT_MAX)))}


class VoiceCommands:
    """voice-commands@1: other plugins (a listener, a banner) say things through the same flow."""

    def say(self, text: str, app: str = "", by: str = "plugin", reason: str = "") -> dict[str, Any]:
        return say(text=text, app=app, by=by, reason=reason)

    def answer(self, pending: str, answer: str, by: str = "plugin") -> dict[str, Any]:
        return say(pending=pending, answer=answer, by=by)

    def registry(self) -> dict[str, Any]:
        return registry()

    def help(self, app: str = "") -> list[dict[str, Any]]:
        return help_lines(app)


plugin_services.provide("voice-commands@1", VoiceCommands(), folder=FOLDER)
