"""Prompt engine console plugin — server part. Mounted at /api/plugins/prompt-engine/ (console token on every method,
404 while the plugin is off). Its routes are its plugin commands (plugin.json → commands): the same calls reach it as
REST, MCP tools (prompt-engine_<command>), the plugin-commands CLI (`axf prompt-engine <command>`) and voice in AmberX.

The decisions are the framework's (framework/core/engines/prompt-engine.mjs, prompt-engine@1); storing and running is
engine.mjs beside this folder. This file runs that CLI, delivers what it hands back (`dispatch`): a waiting prompt goes
to the decision dialog when a plugin provides axf.decisions@1 and always to the alert hub (push, governed by the
Notifications panel through axf.notify@1); a keys-needed item (a connector such as email / SMS / voice call missing on
axHub) becomes an alert the systems check shows; and runs the tick (expiries + schedules) once a minute.

Capability provided: axf.prompt-engine@1 — fire(event, by), waiting(), answer(instance, answer, by): other plugins
fire their events through it without naming this folder.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request

import console_context as cx
import plugin_services

from . import feeds

router = APIRouter()
HERE = Path(__file__).resolve().parent
CLI = HERE.parent / "engine.mjs"
FOLDER = "prompt-engine"
CAP = "axf.prompt-engine@1"
DECISIONS_CAP = "axf.decisions@1"
NOTIFY_CAP = "axf.notify@1"
HEALTH_CAP = "axf.health@1"
AGENT_HEADERS = ("x-axhub-session", "x-axhub-source")
TEXT_MAX = 4000


def data_dir() -> Path:
    d = os.environ.get("AXF_PROMPT_ENGINE_DIR")
    return Path(d) if d else cx.ROOT / ".axf-console" / "plugins" / FOLDER


def _console_url() -> str:
    return os.environ.get("AXF_CONSOLE_INTERNAL_URL") or f"http://127.0.0.1:{os.environ.get('PORT', '7090')}"


def _run(*args: str, stdin: str | None = None, by: str = "console", brett: str = "", timeout: int = 180) -> dict[str, Any]:
    """One engine.mjs command as JSON. The runner reaches the console's own API for tools (control@1) with the console token."""
    env = {**os.environ, "AXF_PROMPT_ENGINE_DIR": str(data_dir()), "AXF_ACTOR": by, "AXF_CONSOLE_URL": _console_url()}
    token = cx.current_token()
    if token:
        env["AXF_TOKEN"] = token
    if brett:
        env["AXF_APPROVER"] = brett
        env["AXF_APPROVER_VIA"] = "console"
    else:
        env.pop("AXF_APPROVER", None)
        env.pop("AXF_APPROVER_VIA", None)
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=str(cx.ROOT), input=stdin, capture_output=True, text=True, timeout=timeout, env=env)
    except subprocess.TimeoutExpired:
        return {"ok": False, "error": f"the prompt engine took longer than {timeout}s", "code": "unavailable"}
    out = proc.stdout.strip().split("\n")  # not splitlines(): a plugin description may hold a Unicode line separator inside one JSON line
    res: Any = None
    for line in reversed(out):
        try:
            res = json.loads(line)
            break
        except json.JSONDecodeError:
            continue
    if not isinstance(res, dict):
        return {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-600:] or "no answer from the engine", "code": "unexpected"}
    return res


def _text(v: Any, n: int = 600) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _body(body: Any) -> dict[str, Any]:
    if body is None:
        return {}
    if not isinstance(body, dict):
        raise HTTPException(400, "Body must be a JSON object")
    return body


def _who(request: Request) -> str:
    user = getattr(request.state, "axf_user", None)
    name = str(getattr(user, "name", "") or "") if user is not None else ""
    return (name or "console")[:120]


def brett_click(request: Request) -> str:
    """The signed-in hub admin's name when this request is Brett's own click in the console, else ''. A session, MCP or
    the console token never counts (the orchestrator refuses model upgrades from anyone but Brett)."""
    c = getattr(request.state, "axf_user", None)
    if c is None or getattr(c, "via", "token") != "session" or not getattr(c, "admin", False):
        return ""
    for h in AGENT_HEADERS:
        v = (request.headers.get(h) or "").strip()
        if v and v != "console":
            return ""
    return str(getattr(c, "name", "") or "")[:120]


def _raise(res: dict[str, Any]) -> dict[str, Any]:
    if res.get("ok"):
        return res
    code = res.get("code", "")
    status = {"not_found": 404, "validation": 400, "usage": 400, "confirmation_required": 409, "denied": 403, "unavailable": 503, "unexpected": 500}.get(code, 400 if code or res.get("errors") else 500)
    detail: Any = res.get("error", "failed")
    if res.get("errors"):
        detail = {"error": detail, "errors": res["errors"]}
    raise HTTPException(status, detail)


# ---------------------------------------------------------------------- delivery of what the engine hands back

def _link(instance: str = "") -> str:
    return f"/?axf-view={FOLDER}" + (f"&prompt={instance}" if instance else "")


def deliver(dispatch: list[dict[str, Any]] | None, by: str = "engine") -> list[dict[str, Any]]:
    """Each dispatch entry to where it goes. Returns what was done, for the caller's answer."""
    done: list[dict[str, Any]] = []
    for d in dispatch or []:
        if not isinstance(d, dict):
            continue
        kind = d.get("kind")
        try:
            if kind == "ask":
                inst = d.get("instance") or {}
                shown = False
                dec = plugin_services.get(DECISIONS_CAP)
                if dec is not None and hasattr(dec, "ask"):
                    try:
                        shown = bool(dec.ask({"source": FOLDER, "id": inst.get("id"), "title": inst.get("title"), "text": inst.get("text"), "kind": inst.get("kind"),
                                             "options": inst.get("options") or [], "answers": inst.get("answers") or [], "countdownSec": inst.get("countdownSec") or 0,
                                             "expiresAt": inst.get("expiresAt") or "", "link": _link(str(inst.get("id") or "")),
                                             "answer": lambda a, _id=inst.get("id"): answer(str(_id), a, by="decision-dialog")}))
                    except Exception as e:  # noqa: BLE001
                        cx.log(FOLDER, f"decision dialog refused {inst.get('id')}: {e}", "warn")
                outputs = inst.get("outputs") or ["dialog"]
                if "push" in outputs or "dialog" in outputs:
                    opts = inst.get("options") or []
                    body = _text(inst.get("text"), 600)
                    if opts:
                        body = (body + "\n" if body else "") + "Options: " + ", ".join(f"{i + 1}. {o.get('label', o.get('id'))}" for i, o in enumerate(opts))
                    cx.raise_alert({"source": FOLDER, "severity": "warning" if inst.get("kind") == "veto" else "info", "title": _text(inst.get("title"), 200) or "A prompt is waiting",
                                    "body": body, "key": f"{FOLDER}:ask:{inst.get('id')}", "link": _link(str(inst.get("id") or "")),
                                    "meta": {"instance": inst.get("id"), "rule": inst.get("rule"), "kind": inst.get("kind"), "answers": inst.get("answers") or []}})
                done.append({"kind": "ask", "instance": inst.get("id"), "dialog": shown, "alert": True})
            elif kind == "notify":
                channel = d.get("channel", "push")
                if channel == "push":
                    cx.raise_alert({"source": FOLDER, "severity": {"high": "warning", "low": "info"}.get(str(d.get("priority", "normal")), "info"),
                                    "title": _text(d.get("title"), 200) or "Prompt engine", "body": _text(d.get("text"), 600), "key": f"{FOLDER}:push:{_text(d.get('title'), 80)}", "link": _link()})
                    done.append({"kind": "notify", "channel": "push", "ok": True})
                else:
                    # email / SMS / call go through an axHub connector; none is wired yet: the engine already listed it as keys needed
                    done.append({"kind": "notify", "channel": channel, "ok": False, "why": f"no {channel} connector on axHub yet"})
            elif kind == "keys-needed":
                connector = _text(d.get("connector"), 60)
                cx.raise_alert({"source": FOLDER, "severity": "warning", "title": f"Keys needed: {connector} connector", "body": _text(d.get("message"), 600) or f"{d.get('for', 'A rule')} needs the {connector} connector on axHub.",
                                "key": f"{FOLDER}:keys:{connector}", "link": _link(), "meta": {"connector": connector, "for": d.get("for")}})
                done.append({"kind": "keys-needed", "connector": connector})
            elif kind == "say":
                speech = plugin_services.get("axf.speech@1")
                ok = False
                if speech is not None and hasattr(speech, "say"):
                    try:
                        speech.say(_text(d.get("text"), TEXT_MAX))
                        ok = True
                    except Exception:  # noqa: BLE001
                        ok = False
                done.append({"kind": "say", "ok": ok})
            else:
                done.append({"kind": str(kind), "ok": False, "why": "nothing delivers this yet"})
        except Exception as e:  # noqa: BLE001
            cx.log(FOLDER, f"delivery of {kind} failed: {e}", "warn")
            done.append({"kind": str(kind), "ok": False, "why": str(e)[:200]})
    return done


def _with_delivery(res: dict[str, Any], by: str) -> dict[str, Any]:
    if res.get("ok"):
        disp = list(res.get("dispatch") or [])
        run = res.get("run")
        if isinstance(run, dict):
            disp.extend(run.get("dispatch") or [])
        if disp:
            res["delivered"] = deliver(disp, by)
    return _raise(res)


# ---------------------------------------------------------------------- the capability other plugins use

def fire(event: dict[str, Any], by: str = "plugin", dry: bool = False) -> dict[str, Any]:
    res = _run("fire", json.dumps(event), *(["--dry"] if dry else []), by=by)
    if res.get("ok"):
        disp = list(res.get("dispatch") or [])
        if disp and not dry:
            res["delivered"] = deliver(disp, by)
    return res


def waiting() -> dict[str, Any]:
    return _run("waiting")


def answer(instance: str, ans: Any, by: str = "plugin", brett: str = "") -> dict[str, Any]:
    a = ans if isinstance(ans, dict) else {"kind": str(ans)}
    kind = str(a.get("kind") or a.get("answer") or "")
    args = ["answer", instance, kind]
    if a.get("option") is not None:
        args += ["--option", str(a["option"])]
    if a.get("text") is not None:
        args += ["--text", str(a["text"])]
    res = _run(*args, by=by, brett=brett)
    if res.get("ok"):
        run = res.get("run") or {}
        if run.get("dispatch"):
            res["delivered"] = deliver(run["dispatch"], by)
        cx.resolve_alerts([f"{FOLDER}:ask:{instance}", f"{FOLDER}:ask:{(res.get('instance') or {}).get('id', '')}"])
    return res


class PromptEngineService:
    """axf.prompt-engine@1."""

    def fire(self, event: dict[str, Any], by: str = "plugin", dry: bool = False) -> dict[str, Any]:
        return fire(event, by, dry)

    def waiting(self) -> dict[str, Any]:
        return waiting()

    def answer(self, instance: str, ans: Any, by: str = "plugin") -> dict[str, Any]:
        return answer(instance, ans, by)

    def register(self, manifest: dict[str, Any], by: str = "plugin") -> dict[str, Any]:
        return _run("register-manifest", json.dumps(manifest), by=by)

    def emit(self, source: str, event: str, payload: dict[str, Any] | None = None, by: str = "plugin", id: str = "") -> None:
        """Fire and don't wait (feeds.py): the producer never waits on the engine and never fails because of it."""
        if not cx.plugin_enabled(FOLDER):
            return
        ev: dict[str, Any] = {"source": str(source)[:80], "event": str(event)[:80], "payload": payload if isinstance(payload, dict) else {}, "by": str(by)[:120]}
        if id:
            ev["id"] = str(id)[:200]
        feeds.emit_async(lambda e, b: fire(e, b), ev, str(by)[:120])


plugin_services.provide(CAP, PromptEngineService(), folder=FOLDER)


# ---------------------------------------------------------------------- the tick (expiries + schedules), once a minute

_tick_thread: threading.Thread | None = None
_tick_lock = threading.Lock()


def tick_once() -> dict[str, Any]:
    res = _run("tick", by="tick")
    if res.get("ok"):
        res["delivered"] = deliver(res.get("dispatch") or [], "tick")
        try:  # held veto calls and approvals on axHub → approval.held / approval.waiting (each once)
            res["approvals"] = feeds.approvals(plugin_services.get, data_dir(), lambda e, b: fire(e, b))
        except Exception as e:  # noqa: BLE001
            res["approvals"] = {"ok": False, "why": str(e)[:200]}
    return res


def ensure_tick() -> bool:
    """Start the once-a-minute tick (AXF_PROMPT_ENGINE_TICK seconds; 0 = off, tests)."""
    global _tick_thread
    every = int(os.environ.get("AXF_PROMPT_ENGINE_TICK", "60") or 0)
    if every <= 0:
        return False
    with _tick_lock:
        if _tick_thread is not None and _tick_thread.is_alive():
            return True

        def loop() -> None:
            while True:
                time.sleep(every)
                try:
                    if cx.plugin_enabled(FOLDER):
                        tick_once()
                except Exception as e:  # noqa: BLE001
                    cx.log(FOLDER, f"tick failed: {e}", "warn")

        _tick_thread = threading.Thread(target=loop, name="prompt-engine-tick", daemon=True)
        _tick_thread.start()
    return True


_health_done = False


def ensure_health() -> bool:
    """The systems check item: how many rules, how many prompts wait, which connectors are missing."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get(HEALTH_CAP)
    if reg is None or not hasattr(reg, "register"):
        return False

    def probe() -> dict[str, Any]:
        st = _run("state")
        if not st.get("ok"):
            return {"status": "error", "summary": f"The prompt engine does not answer: {st.get('error', '')}", "details": []}
        c = st.get("counts", {})
        waiting_n = c.get("waiting", 0)
        return {"status": "warn" if waiting_n else "ok", "summary": f"{c.get('enabled', 0)} of {c.get('rules', 0)} rules on, {c.get('macros', 0)} macros, {c.get('pipelines', 0)} pipelines; {waiting_n} prompt(s) waiting for Brett.",
                "details": [f"Answer waiting prompts under Builds → Prompt engine → Waiting, or say 'what is waiting for me'."] if waiting_n else []}

    try:
        reg.register(FOLDER, "Prompt engine", probe)
        _health_done = True
    except Exception:  # noqa: BLE001
        return False
    return True


ensure_tick()


# ---------------------------------------------------------------------- routes

@router.get("/")
def state(request: Request) -> dict[str, Any]:
    ensure_health()
    return _raise(_run("state"))


@router.get("/rules")
def rules() -> dict[str, Any]:
    return _raise(_run("rules"))


@router.get("/rules/{rule}")
def rule(rule: str) -> dict[str, Any]:
    return _raise(_run("rule", rule))


@router.post("/rules")
def add_rule(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("add-rule", json.dumps(_body(body)), by=_who(request)))


@router.post("/rules/{rule}/update")
def update_rule(rule: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("update-rule", rule, json.dumps(_body(body)), by=_who(request)))


@router.post("/rules/{rule}/enable")
def enable_rule(rule: str, request: Request) -> dict[str, Any]:
    return _raise(_run("enable", rule, by=_who(request)))


@router.post("/rules/{rule}/disable")
def disable_rule(rule: str, request: Request) -> dict[str, Any]:
    return _raise(_run("disable", rule, by=_who(request)))


@router.post("/rules/{rule}/delete")
def delete_rule(rule: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("remove-rule", rule, "--confirm", _text(_body(body).get("confirm"), 80), by=_who(request)))


@router.post("/rules/from-words")
def rule_from_words(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """'when a build fails, ask me to retry or archive' → a rule (a template when one fits). save = true stores it."""
    b = _body(body)
    text = _text(b.get("text") or b.get("words"), 600)
    if not text:
        raise HTTPException(400, 'from-words needs text, e.g. "when a build fails, ask me to retry or archive"')
    args = ["from-words", text]
    if b.get("save") is True:
        args.append("--save")
    for k in ("id", "title"):
        if _text(b.get(k), 200):
            args += [f"--{k}", _text(b[k], 200)]
    return _raise(_run(*args, by=_who(request)))


@router.post("/rules/{rule}/test")
def test_rule(rule: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    args = ["test", rule]
    if isinstance(b.get("event"), dict):
        args += ["--event", json.dumps(b["event"])]
    if b.get("live") is True:
        args.append("--live")
    res = _run(*args, by=_who(request), brett=brett_click(request))
    if res.get("ok") and b.get("live") is True:
        disp = []
        if res.get("instance"):
            disp.append({"kind": "ask", "instance": res["instance"]})
        disp.extend((res.get("run") or {}).get("dispatch") or [])
        if disp:
            res["delivered"] = deliver(disp, _who(request))
    return _raise(res)


@router.get("/macros")
def macros() -> dict[str, Any]:
    return _raise(_run("macros"))


@router.post("/macros")
def add_macro(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("add-macro", json.dumps(_body(body)), by=_who(request)))


@router.post("/macros/{macro}/update")
def update_macro(macro: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("update-macro", macro, json.dumps(_body(body)), by=_who(request)))


@router.post("/macros/{macro}/delete")
def delete_macro(macro: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("remove-macro", macro, "--confirm", _text(_body(body).get("confirm"), 80), by=_who(request)))


@router.get("/pipelines")
def pipelines() -> dict[str, Any]:
    return _raise(_run("pipelines"))


@router.post("/pipelines")
def add_pipeline(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("add-pipeline", json.dumps(_body(body)), by=_who(request)))


@router.post("/pipelines/{pipeline}/update")
def update_pipeline(pipeline: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("update-pipeline", pipeline, json.dumps(_body(body)), by=_who(request)))


@router.post("/pipelines/{pipeline}/delete")
def delete_pipeline(pipeline: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("remove-pipeline", pipeline, "--confirm", _text(_body(body).get("confirm"), 80), by=_who(request)))


# ---------------------------------------------------------------------- direct runs (a macro, a pipeline, a tool, now) + run records

def _params(b: dict[str, Any]) -> str:
    p = b.get("params")
    return json.dumps(p if isinstance(p, dict) else {})


@router.post("/macros/{macro}/run")
def run_macro(macro: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    res = _run("run-macro", macro, _params(b), *(["--dry"] if b.get("dry") is True else []), by=_who(request), brett=brett_click(request))
    return _with_delivery(res, _who(request)) if b.get("dry") is not True else _raise(res)


@router.post("/pipelines/{pipeline}/run")
def run_pipeline(pipeline: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    res = _run("run-pipeline", pipeline, _params(b), *(["--dry"] if b.get("dry") is True else []), by=_who(request), brett=brett_click(request))
    return _with_delivery(res, _who(request)) if b.get("dry") is not True else _raise(res)


@router.get("/toolsets")
def toolsets() -> dict[str, Any]:
    return _raise(_run("toolsets"))


@router.get("/toolsets/{toolset}")
def toolset(toolset: str) -> dict[str, Any]:
    return _raise(_run("toolset", toolset))


@router.post("/toolsets")
def add_toolset(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("add-toolset", json.dumps(_body(body)), by=_who(request)))


@router.post("/toolsets/{toolset}/update")
def update_toolset(toolset: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("update-toolset", toolset, json.dumps(_body(body)), by=_who(request)))


@router.post("/toolsets/{toolset}/enable")
def enable_toolset(toolset: str, request: Request) -> dict[str, Any]:
    return _raise(_run("enable-toolset", toolset, by=_who(request)))


@router.post("/toolsets/{toolset}/disable")
def disable_toolset(toolset: str, request: Request) -> dict[str, Any]:
    return _raise(_run("disable-toolset", toolset, by=_who(request)))


@router.post("/toolsets/{toolset}/delete")
def delete_toolset(toolset: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("remove-toolset", toolset, "--confirm", _text(_body(body).get("confirm"), 80), by=_who(request)))


@router.get("/tools")
def tools(set: str = "", allowed: bool = False) -> dict[str, Any]:
    args = ["tools"]
    if set:
        args += ["--set", set]
    if allowed:
        args.append("--allowed")
    return _raise(_run(*args))


@router.post("/tools/run")
def run_tool(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    plugin = _text(b.get("plugin"), 80)
    command = _text(b.get("command"), 80)
    if not plugin or not command:
        raise HTTPException(400, "run-tool needs plugin and command (plugin 'console' + a verb for a console command)")
    args = ["run-tool", plugin, command, "--input", json.dumps(b.get("input") if isinstance(b.get("input"), dict) else {})]
    if b.get("dry") is True:
        args.append("--dry")
    res = _run(*args, by=_who(request), brett=brett_click(request))
    return _with_delivery(res, _who(request)) if b.get("dry") is not True else _raise(res)


@router.get("/runs")
def runs(kind: str = "", target: str = "", status: str = "", rule: str = "", limit: int = 50) -> dict[str, Any]:
    args = ["runs", "--limit", str(max(1, min(300, limit)))]
    for k, v in (("kind", kind), ("target", target), ("status", status), ("rule", rule)):
        if v:
            args += [f"--{k}", v]
    return _raise(_run(*args))


@router.get("/runs/{run}")
def run_record(run: str) -> dict[str, Any]:
    return _raise(_run("run-record", run))


@router.get("/manifest")
def manifest(source: str = "") -> dict[str, Any]:
    return _raise(_run("manifest", *([source] if source else [])))


@router.post("/manifest")
def register_manifest(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("register-manifest", json.dumps(_body(body)), by=_who(request)))


@router.post("/options")
def options(body: Any = Body(None)) -> dict[str, Any]:
    return _raise(_run("options", json.dumps(_body(body)), "--live"))


@router.get("/templates")
def templates() -> dict[str, Any]:
    return _raise(_run("templates"))


@router.post("/templates/{template}/use")
def use_template(template: str, request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    args = ["use-template", template]
    if _text(b.get("id"), 80):
        args += ["--id", _text(b["id"], 80)]
    if _text(b.get("title"), 200):
        args += ["--title", _text(b["title"], 200)]
    return _raise(_run(*args, by=_who(request)))


@router.get("/waiting")
def get_waiting() -> dict[str, Any]:
    return _raise(_run("waiting"))


@router.post("/answer")
def post_answer(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    instance = _text(b.get("instance") or b.get("id"), 80)
    kind = _text(b.get("answer") or b.get("kind"), 20)
    if not instance or not kind:
        raise HTTPException(400, "answer needs instance (id or number) and answer (approve, deny, later, pick, text)")
    return _raise(answer(instance, {"kind": kind, "option": b.get("option"), "text": b.get("text")}, by=_who(request), brett=brett_click(request)))


@router.post("/fire")
def post_fire(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    b = _body(body)
    if not _text(b.get("event"), 80):
        raise HTTPException(400, "fire needs an event (e.g. custom.event) and may carry source and payload")
    ev = {"source": _text(b.get("source"), 80), "event": _text(b.get("event"), 80), "payload": b.get("payload") if isinstance(b.get("payload"), dict) else {}, "by": _who(request)}
    res = _run("fire", json.dumps(ev), *(["--dry"] if b.get("dry") is True else []), by=_who(request), brett=brett_click(request))
    return _with_delivery(res, _who(request)) if b.get("dry") is not True else _raise(res)


@router.post("/webhook/{hook}")
async def webhook(hook: str, request: Request) -> dict[str, Any]:
    try:
        payload = await request.json()
    except Exception:  # noqa: BLE001
        payload = {}
    headers = {k: v for k, v in request.headers.items() if k.lower() in ("content-type", "user-agent", "x-github-event", "x-hub-signature-256", "x-event")}
    ev = {"source": "webhook", "event": "webhook.received", "payload": {"hook": _text(hook, 80), "headers": headers, "body": payload}, "by": "webhook"}
    return _with_delivery(_run("fire", json.dumps(ev), by="webhook"), "webhook")


@router.post("/voice")
def post_voice(request: Request, body: Any = Body(None)) -> dict[str, Any]:
    """A phrase AmberX heard: fires voice.phrase { phrase, speaker, device } for rules with a voice trigger."""
    b = _body(body)
    phrase = _text(b.get("phrase") or b.get("text"), 400)
    if not phrase:
        raise HTTPException(400, "voice needs a phrase")
    ev = {"source": "voice", "event": "voice.phrase", "payload": {"phrase": phrase, "speaker": _text(b.get("speaker"), 80), "device": _text(b.get("device"), 80)}, "by": _who(request)}
    res = _run("fire", json.dumps(ev), *(["--dry"] if b.get("dry") is True else []), by=_who(request))
    return _with_delivery(res, _who(request)) if b.get("dry") is not True else _raise(res)


@router.post("/tick")
def post_tick() -> dict[str, Any]:
    return _raise(tick_once())


@router.get("/history")
def history(rule: str = "", instance: str = "", kind: str = "", limit: int = 100) -> dict[str, Any]:
    args = ["history", "--limit", str(max(1, min(1000, limit)))]
    if rule:
        args += ["--rule", rule]
    if instance:
        args += ["--instance", instance]
    if kind:
        args += ["--kind", kind]
    return _raise(_run(*args))
