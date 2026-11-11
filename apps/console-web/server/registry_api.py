"""The registry and generic control over REST (control-registry@1; build full-api-cli-control-of-everything-plus-an-offli, s4).

Every controllable thing in the offline index (apps/console-web/lib/registry) is reachable here without the UI:

    GET  /api/registry                       list / search / filter (owner, type, tag, surface, plugin, q, needsAI, limit, offset)
    GET  /api/registry/export                the whole index (control-registry@1, with exportedAt)
    GET  /api/registry/stats | /owners | /gaps
    GET  /api/registry/{id}                  one entry: actions, parameters and allowed values, surfaces, gaps
    GET  /api/control/{id}/state             the entry's state, read through its state ref
    POST /api/control/{id}/{action}          run one action; parameters validated against the registry first
    POST /api/control/resolve                a phrase, a CLI argv or a command → entry + action + params; deterministic
                                             first, Claude only behind the "Make Claude available to the console" gate

The registry answers (lib/registry/rpc.mjs, one node run per call, reads cached on the index file) and the plan it
returns runs as a control@1 command through the console's control runner, so permissions, confirm tokens for deletes
and the write audit are control@1's own. Every call that changes something is also written to the console terminal
(channel "registry"). Registry ids contain slashes; the `regid` path convertor only matches real registry ids
(<owner>/<type>/<name>…), so control@1's own /api/control/<target>/… routes are untouched.

The functions below (rpc, state, invoke, resolve) are what the MCP tools (s5) call too: one path for every surface.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.convertors import Convertor, register_url_convertor

ROOT = Path(os.environ.get("AXF_ROOT", Path(__file__).resolve().parents[3])).resolve()
RPC = ROOT / "apps" / "console-web" / "lib" / "registry" / "rpc.mjs"
INDEX = Path(os.environ.get("AXF_REGISTRY_INDEX", ROOT / "_claude" / "builds" / "registry" / "index.json"))
TYPES = ("page", "app", "plugin", "tool", "behavior", "display", "setting")
ID_RE = re.compile(r"^[a-z0-9][a-z0-9-]*/(" + "|".join(TYPES) + r")/[A-Za-z0-9][A-Za-z0-9._:@-]*(/[A-Za-z0-9][A-Za-z0-9._:@-]*){0,2}$")
Runner = Callable[[dict[str, Any]], dict[str, Any]]
Logger = Callable[[str, str, str], None]
AI_SYSTEM = ("You map a request onto the AmberX console's control registry. Answer with one JSON object only: "
             '{"id": <entry id>, "action": <action id>, "params": {...}} using only the ids, actions and allowed values in the brief, '
             'or {"none": "<why nothing fits>"}. No prose.')


class RegIdConvertor(Convertor):
    """A registry id in a path: <owner>/<type>/<name>[/…] (never a control@1 target, which has a dot and no type segment)."""
    regex = r"[a-z0-9][a-z0-9-]*/(?:" + "|".join(TYPES) + r")/[A-Za-z0-9][A-Za-z0-9._:@/-]*?"

    def convert(self, value: str) -> str:
        return value

    def to_string(self, value: str) -> str:
        return value


register_url_convertor("regid", RegIdConvertor())


# ---------------------------------------------------------------- the registry, one call


def rpc(req: dict[str, Any], timeout: int = 60) -> dict[str, Any]:
    """One request to lib/registry/rpc.mjs → its answer (a failure envelope when node can't run)."""
    try:
        p = subprocess.run(["node", str(RPC)], input=json.dumps(req), cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unexpected", "message": f"registry did not answer: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-600:]}


def read(req: dict[str, Any]) -> dict[str, Any]:
    """A read-only registry request, shared by every caller until the index file changes (readcache when the console runs)."""
    try:
        import readcache  # the console's shared cache (absent in stdio mode / tests)
    except ImportError:
        return rpc(req)
    return readcache.cached(f"registry:{json.dumps(req, sort_keys=True)}", lambda: rpc(req), ttl=30, watch=(INDEX,))


# ---------------------------------------------------------------- running a plan


def run_plan(plan: dict[str, Any], control: Runner | None) -> dict[str, Any]:
    """Run what the registry planned. control@1 / console plans go through the control runner (its permissions, confirm
    tokens and audit); a provider plan goes to the provider bridge; an app channel, intent, URL or another surface is
    handed back for the caller to follow (`handoff`)."""
    via = plan.get("via")
    if via in ("control", "console"):
        if control is None:
            return {"ok": False, "code": "not_implemented", "message": "no control@1 runner here"}
        return control(dict(plan["command"]))
    if via == "provider":
        import registry_providers  # noqa: PLC0415 - the axHub bridge (server/registry_providers.py)
        return registry_providers.call(str(plan.get("provider") or ""), str(plan.get("op") or ""), dict(plan.get("params") or {}),
                                       effect=str(plan.get("effect") or "write"), reason=plan.get("reason"), title=str(plan.get("title") or ""))
    if via in ("channel", "intent", "url", "rest", "mcp", "cli", "value"):
        return {"ok": True, "handoff": plan, "message": f"this runs on the caller's side ({via}); follow the handoff"}
    return {"ok": False, "code": "not_implemented", "message": plan.get("why") or "nothing to run"}


def _ask_model(brief: dict[str, Any]) -> dict[str, Any] | None:
    """The console's model (axf.llm@1, found by capability) answers the fallback brief, or None when there is none."""
    try:
        import plugin_services
    except ImportError:
        return None
    llm = plugin_services.get("axf.llm@1")
    if llm is None:
        return None
    try:
        out = llm.complete([{"role": "user", "content": json.dumps(brief)}], system=AI_SYSTEM, params={"max_tokens": 400})
    except Exception as e:  # noqa: BLE001 - a model failure is an answer, not a crash
        return {"none": f"the model failed: {str(e)[:200]}"}
    text = str(out.get("text") or "")
    m = re.search(r"\{.*\}", text, re.S)
    try:
        ans = json.loads(m.group(0)) if m else None
    except json.JSONDecodeError:
        ans = None
    return ans if isinstance(ans, dict) else {"none": "the model did not answer JSON"}


def _with_ai(req: dict[str, Any], ask: Callable[[dict[str, Any]], dict[str, Any] | None]) -> dict[str, Any]:
    r = rpc(req)
    if r.get("brief") and not (r.get("ai") or {}).get("asked"):
        answer = ask(r["brief"])
        if answer is not None:
            r = rpc({**req, "answer": answer})
    r.pop("brief", None)
    return r


def state(entry_id: str, params: dict[str, Any] | None, control: Runner | None, by: str = "rest") -> dict[str, Any]:
    """An entry's state: its read ref run through the plan (read-only)."""
    s = read({"op": "state", "id": entry_id, "params": params or {}, "by": by})
    if not s.get("ok"):
        return s
    result = run_plan(s["plan"], control)
    return {"ok": bool(result.get("ok")), "entry": s["entry"], "read": s.get("read", ""), "fields": s.get("fields", []),
            **({"note": s["note"]} if s.get("note") else {}), "state": result}


def invoke(entry_id: str, action: str, params: dict[str, Any] | None, control: Runner | None, *, confirm: str = "", reason: str = "",
           by: str = "rest", dry: bool = False, ask: Callable[[dict[str, Any]], dict[str, Any] | None] = _ask_model) -> dict[str, Any]:
    """Run one action of one entry: resolved and validated by the registry, then run through its plan (dry = plan only)."""
    r = _with_ai({"op": "invoke", "id": entry_id, "action": action, "params": params or {}, "confirm": confirm, "reason": reason, "by": by}, ask)
    if not r.get("ok") or dry:
        return r
    return {**r, "result": run_plan(r["plan"], control)}


def resolve(inp: Any, control: Runner | None, *, run: bool = False, confirm: str = "", reason: str = "", by: str = "rest",
            ask: Callable[[dict[str, Any]], dict[str, Any] | None] = _ask_model) -> dict[str, Any]:
    """A phrase / CLI argv / command → the resolution (and, with run, the result). Deterministic first; the model only
    when the gate is open and nothing matched, and its answer is resolved again."""
    r = _with_ai({"op": "resolve", "input": inp, "confirm": confirm, "reason": reason, "by": by}, ask)
    if not r.get("ok") or not run:
        return r
    return {**r, "result": run_plan(r["plan"], control)}


def providers_check() -> dict[str, Any]:
    """Every provider op the registry declares, checked against the live hub's tool list: `missing` = declared here but
    not on axHub (a renamed or absent tool), `undeclared` = on axHub but not in the registry yet."""
    import registry_providers  # noqa: PLC0415
    declared = read({"op": "providerOps"}).get("providers") or {}
    if not registry_providers.connected():
        return {"ok": False, "code": "not_implemented", "message": "axHub isn't connected on this console (no AXHUB_TOKEN)", "declared": declared}
    out: dict[str, Any] = {}
    for prov, ops in declared.items():
        cat = registry_providers.catalog(prov)
        live = {t.split(".", 1)[1] for t in cat.get("tools", []) if "." in t}
        out[prov] = {"declared": len(ops), "live": len(live), "missing": sorted(set(ops) - live), "undeclared": sorted(live - set(ops))}
    return {"ok": all(not v["missing"] for v in out.values()), "providers": out}


# ---------------------------------------------------------------- REST


def _status(r: dict[str, Any]) -> Any:
    if r.get("ok"):
        return r
    code = r.get("code")
    status = {"not_found": 404, "validation": 422, "ambiguous": 409, "needs_ai": 409, "forbidden": 403, "confirmation_required": 202, "held": 202, "not_implemented": 501}.get(str(code), 500)
    return JSONResponse(r, status_code=status)


def _by(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", "") or getattr(u, "id", "") if u is not None else ""
    return f"rest:{name}" if name and isinstance(name, str) else "rest"


def router(auth: Callable[..., None], auth_read: Callable[..., None], control: Runner, log: Logger) -> APIRouter:
    """The routes; mount before control@1's capability router so registry ids win over /api/control/<target>/…"""
    rt = APIRouter()

    @rt.get("/api/registry", dependencies=[Depends(auth_read)])
    def registry_list(owner: str = "", type: str = "", tag: str = "", surface: str = "", plugin: str = "", q: str = "",
                      needsAI: str = "", limit: int = 50, offset: int = 0, full: bool = False) -> Any:
        if type and type not in TYPES:
            raise HTTPException(422, f"type must be one of {', '.join(TYPES)}")
        f = {"owner": owner, "type": type, "tag": tag, "surface": surface, "plugin": plugin, "q": q, "needsAI": needsAI,
             "limit": max(1, min(limit, 2000)), "offset": max(0, offset), "full": full}
        return _status(read({"op": "list", "filter": f}))

    @rt.get("/api/registry/export", dependencies=[Depends(auth_read)])
    def registry_export() -> Any:
        r = read({"op": "export"})
        return r["index"] if r.get("ok") else _status(r)

    @rt.get("/api/registry/stats", dependencies=[Depends(auth_read)])
    def registry_stats() -> Any:
        return _status(read({"op": "stats"}))

    @rt.get("/api/registry/owners", dependencies=[Depends(auth_read)])
    def registry_owners() -> Any:
        return _status(read({"op": "owners"}))

    @rt.get("/api/registry/gaps", dependencies=[Depends(auth_read)])
    def registry_gaps(what: str = "", owner: str = "") -> Any:
        return _status(read({"op": "gaps", "what": what, "owner": owner}))

    @rt.get("/api/registry/search", dependencies=[Depends(auth_read)])
    def registry_search(q: str, limit: int = 20, type: str = "", owner: str = "") -> Any:
        return _status(read({"op": "search", "q": q, "limit": max(1, min(limit, 200)), "type": type, "owner": owner}))

    @rt.get("/api/registry/providers/check", dependencies=[Depends(auth)])
    def registry_providers_check() -> Any:
        return _status(providers_check())

    @rt.get("/api/registry/{entry_id:regid}", dependencies=[Depends(auth_read)])
    def registry_get(entry_id: str) -> Any:
        return _status(read({"op": "get", "id": entry_id}))

    @rt.get("/api/control/{entry_id:regid}/state", dependencies=[Depends(auth)])
    def control_state(entry_id: str, request: Request) -> Any:
        params = {k: v for k, v in request.query_params.items()}
        return _status(state(entry_id, params, control, by=_by(request)))

    @rt.post("/api/control/resolve", dependencies=[Depends(auth)])
    async def control_resolve(request: Request) -> Any:
        body = await _json(request)
        inp = body.get("input", body.get("phrase", body.get("argv")))
        if inp in (None, "", []):
            raise HTTPException(422, "send input: a phrase, a CLI argv array or {id, action, params}")
        from starlette.concurrency import run_in_threadpool
        r = await run_in_threadpool(lambda: resolve(inp, control, run=bool(body.get("run")), confirm=str(body.get("confirm") or ""),
                                                    reason=str(body.get("reason") or ""), by=_by(request)))
        if body.get("run") and r.get("ok"):
            log("registry", f"{_by(request)} resolve → {r.get('entry')} · {r.get('action')} ({r.get('how', {}).get('kind', '')}): {'ok' if (r.get('result') or {}).get('ok') else (r.get('result') or {}).get('code', 'failed')}", "info")
        return _status(r)

    @rt.post("/api/control/{entry_id:regid}/{action}", dependencies=[Depends(auth)])
    async def control_invoke(entry_id: str, action: str, request: Request) -> Any:
        body = await _json(request)
        params = body.get("params") if isinstance(body.get("params"), dict) else {k: v for k, v in body.items() if k not in ("confirm", "reason", "dry")}
        from starlette.concurrency import run_in_threadpool
        r = await run_in_threadpool(lambda: invoke(entry_id, action, params, control, confirm=str(body.get("confirm") or ""),
                                                   reason=str(body.get("reason") or ""), by=_by(request), dry=bool(body.get("dry"))))
        if r.get("ok") and not body.get("dry") and r.get("effect") != "read":
            res = r.get("result") or {}
            log("registry", f"{_by(request)} {entry_id} · {action}: {'ok' if res.get('ok') else res.get('code', 'failed')}", "info" if res.get("ok") else "error")
        if r.get("ok") and (r.get("result") or {}).get("ok") is False:
            res = r["result"]
            return _status({**r, "ok": False, "code": res.get("code", "unexpected"), "message": res.get("message", "failed")})
        return _status(r)

    return rt


async def _json(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (ValueError, json.JSONDecodeError):
        return {}
    return b if isinstance(b, dict) else {}
