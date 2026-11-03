"""Token control (server part): the control@1 REST routes (framework/spec/CONTROL.md) and the `control@1` capability.

Every command runs in the plugin's Node runner (`control.mjs run`), the same code the CLI and the MCP tools use, so
the gate, the validation, the confirm tokens and the answers never differ between transports.

Mounted twice:
  /api/control/…                 the contract's paths (main.py looks the capability up; 404 while the plugin is off)
  /api/plugins/token-control/…   the plugin mount (console token on every route, like every plugin)

  GET    {target}                         list   (query parameters = select filters; JSON values parsed)
  GET    {target}/{path}                  get
  PUT    {target}/{path}                  set    body { value, by?, reason? }
  POST   {target}/reset                   reset  body { path?, by?, reason? }
  POST   {target}                         add    body { value, by?, reason? }
  DELETE {target}/{path}                  remove body { confirm?, by?, reason? }  first call → 409 confirmation_required
  POST   {target}/{path}/act/{action}     act    body { input?, by?, reason? }
  POST   ""                               any whole control@1 command (what the MCP tools and the CLI send)
  GET    meta/registry | meta/audit       the registry (targets, tools, routes, CLI, schema) · the latest writes

Veto passes (control-pass@1, framework/core/engines/control-pass.mjs; CONTROL.md → Veto passes), plugin mount only:
  GET    pass                     the signed publication axHub reads (X-AXF-Pass-Signature: t=<ms>,v1=<hmac>)
  GET    pass/status              every scope and its pass now, in plain words
  GET    pass/check?target=&op=   the scope a call falls in and whether an active pass covers it now
  POST   pass/grant               { scope, minutes?, reason?, by? } → a request Brett approves (his session: on at once)
  POST   pass/approve | pass/deny { scope, request }  Brett's session, or axHub with X-AXF-Pass-Approval / -Approver
  POST   pass/revoke | pass/undo  { scope, by? }
  GET|PUT pass/settings           { maxMinutes, timeZone }

Capability control@1: plugin_services.get("control@1").run(command, grants=[…], by="…") → the answer dict.
Who may: the console token and hub admins = the admin role (`*`); a role's grants come from the console's uac-policy
(`control.<domain>.<read|write|delete>`), never more than the caller's own role.
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.responses import JSONResponse

import plugin_services

router = APIRouter()
FOLDER = "token-control"
CLI = Path(__file__).resolve().parent.parent / "control.mjs"
ROOT = CLI.parents[4]
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "confirmation_required": 409, "not_implemented": 501, "unexpected": 500}
POLICY = ROOT / "apps" / "console-web" / "src" / "assets" / "uac-policy" / "console-access.json"


def run(command: dict[str, Any], grants: list[str] | None = None, by: str = "", timeout: int = 60,
        approver: dict[str, str] | None = None, proof: dict[str, str] | None = None) -> dict[str, Any]:
    """One control@1 command through the Node runner → its answer (a failure envelope when the runner can't run).
    `approver` / `proof`: how this request reached Brett (veto passes only); set from the request, never the body."""
    env: dict[str, Any] = {"command": command, "grants": grants if grants is not None else ["*"], "by": by}
    if approver:
        env["approver"] = approver
    if proof:
        env["proof"] = proof
    body = json.dumps(env)
    try:
        proc = subprocess.run(["node", str(CLI), "run"], input=body, cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": f"the control runner could not run: {str(e)[:200]}"}
    lines = proc.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"$axf": "control@1", "ok": False, "code": "unexpected", "message": proc.stderr.strip()[-600:] or "no output"}
    except json.JSONDecodeError:
        return {"$axf": "control@1", "ok": False, "code": "unexpected", "message": (proc.stderr or proc.stdout).strip()[-600:]}


def meta(what: str) -> Any:
    try:
        proc = subprocess.run(["node", str(CLI), what, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        return json.loads(proc.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)[:200]}


def _role_grants(role: str) -> list[str]:
    try:
        roles = json.loads(POLICY.read_text()).get("data", {}).get("roles", [])
    except (OSError, ValueError):
        return []
    r = next((x for x in roles if x.get("id") == role), None)
    return list(r.get("permissions") or []) if r else []


def caller(request: Request) -> tuple[list[str], str]:
    """The caller's grants and name: the console token / a hub admin = `*`; anyone else = their own perms plus their
    role's grants in the console's uac-policy (never more than that)."""
    user = getattr(request.state, "axf_user", None)
    if user is None:
        return ["*"], "console"  # no token configured: local development (the console's auth let it through)
    name = str(getattr(user, "name", "") or "console")
    if getattr(user, "admin", False):
        return ["*"], name
    return sorted(set(getattr(user, "perms", ()) or ()) | set(_role_grants(str(getattr(user, "role", "") or "")))), name


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — an empty or non-JSON body = no fields
        return {}


def _audit_fields(body: dict[str, Any]) -> dict[str, Any]:
    return {k: body[k] for k in ("by", "reason") if isinstance(body.get(k), str) and body[k]}


def _parse(v: str) -> Any:
    try:
        return json.loads(v)
    except ValueError:
        return v


def _go(request: Request, command: dict[str, Any]) -> JSONResponse:
    grants, name = caller(request)
    approver, proof = owner_approval(request) if command.get("target") == "pass.scopes" else (None, None)
    return answer(run(command, grants, by=command.get("by") or name, approver=approver, proof=proof))


# ---------------------------------------------------------------------- veto passes (before the {target} routes)

PASS = "pass.scopes"


def _console_token() -> str:
    m = sys.modules.get("main")
    try:
        return str(m.current_token()) if m is not None and hasattr(m, "current_token") else os.environ.get("AXF_TOKEN", "")
    except Exception:  # noqa: BLE001 — no token readable = treat as configured (never widen)
        return "?"


def owner_approval(request: Request) -> tuple[dict[str, str] | None, dict[str, str] | None]:
    """How this request reached Brett: his signed-in axHub session in the console (a browser, never a bearer token),
    a console with no token at all (local development), or axHub's signed approval headers (checked by the runner)."""
    user = getattr(request.state, "axf_user", None)
    approver = None
    if user is not None and getattr(user, "via", "") == "session" and getattr(user, "admin", False):
        approver = {"via": "console", "name": str(getattr(user, "name", "") or "brett")}
    elif not _console_token():
        approver = {"via": "local", "name": "console"}
    sig = request.headers.get("x-axf-pass-approval", "")
    who = request.headers.get("x-axf-pass-approver", "")
    return approver, ({"signature": sig, "approver": who} if sig and who else None)


def _scope(b: dict[str, Any]) -> str:
    return str(b.get("scope") or b.get("path") or "")


def _pass(request: Request, action: str, b: dict[str, Any], input_: dict[str, Any] | None = None) -> JSONResponse:
    grants, name = caller(request)
    approver, proof = owner_approval(request)
    cmd = {"op": "act", "target": PASS, "path": _scope(b), "action": action, "input": input_ or {}, **_audit_fields(b)}
    r = run(cmd, grants, by=cmd.get("by") or name, approver=approver, proof=proof)
    if r.get("ok") and (r.get("approval") or {}).get("required"):
        return JSONResponse(r, status_code=202)
    return answer(r)


@router.get("/pass")
def pass_publication() -> JSONResponse:
    """What axHub reads before running a held call: active + waiting passes and the scope table, signed."""
    out = meta("pass-publication")
    if not isinstance(out, dict) or "payload" not in out:
        return JSONResponse({"ok": False, "error": str(out.get("error") if isinstance(out, dict) else "no output")}, status_code=500)
    headers = {"X-AXF-Pass-Signature": out["signature"]} if out.get("signature") else {}
    return JSONResponse(content=json.loads(out["payload"]), headers=headers)


@router.get("/pass/status")
def pass_status(request: Request) -> JSONResponse:
    grants, name = caller(request)
    return answer(run({"op": "list", "target": PASS}, grants, by=name))


@router.get("/pass/check")
def pass_check(target: str, op: str = "set") -> Any:
    """{ scope, covered, pass? }: the scope a call on target + op falls in, and the active pass covering it now."""
    try:
        proc = subprocess.run(["node", str(CLI), "pass-check", target, op, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        return json.loads(proc.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)[:200]}


@router.post("/pass/grant")
async def pass_grant(request: Request) -> JSONResponse:
    b = await _body(request)
    inp: dict[str, Any] = {}
    if b.get("minutes") is not None:
        inp["minutes"] = b["minutes"]
    if isinstance(b.get("reason"), str) and b["reason"]:
        inp["reason"] = b["reason"]
    return _pass(request, "grant", b, inp)


@router.post("/pass/approve")
async def pass_approve(request: Request) -> JSONResponse:
    b = await _body(request)
    return _pass(request, "approve", b, {"request": str(b.get("request") or "")})


@router.post("/pass/deny")
async def pass_deny(request: Request) -> JSONResponse:
    b = await _body(request)
    return _pass(request, "deny", b, {"request": str(b.get("request") or "")})


@router.post("/pass/revoke")
async def pass_revoke(request: Request) -> JSONResponse:
    return _pass(request, "revoke", await _body(request))


@router.post("/pass/undo")
async def pass_undo(request: Request) -> JSONResponse:
    return _pass(request, "undo", await _body(request))


@router.get("/pass/settings")
def pass_settings_get() -> Any:
    return meta("pass-settings")


@router.put("/pass/settings")
async def pass_settings_put(request: Request) -> Any:
    b = await _body(request)
    patch = {k: b[k] for k in ("maxMinutes", "timeZone") if k in b}
    try:
        proc = subprocess.run(["node", str(CLI), "pass-settings", json.dumps(patch), "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        return json.loads(proc.stdout)
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)[:200]}


@router.get("/meta/registry")
def registry() -> Any:
    return meta("registry")


@router.get("/meta/audit")
def audit_log(n: int = 50) -> Any:
    try:
        proc = subprocess.run(["node", str(CLI), "audit", str(max(1, min(n, 500))), "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        return {"ok": True, "items": json.loads(proc.stdout)}
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return {"ok": False, "error": str(e)[:200]}


@router.post("")
@router.post("/")
async def any_command(request: Request) -> JSONResponse:
    return _go(request, await _body(request))


@router.get("/{target}")
def list_(target: str, request: Request) -> JSONResponse:
    select = {k: _parse(v) for k, v in request.query_params.items()}
    return _go(request, {"op": "list", "target": target, **({"select": select} if select else {})})


@router.post("/{target}/reset")
async def reset(target: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return _go(request, {"op": "reset", "target": target, **({"path": b["path"]} if b.get("path") else {}), **_audit_fields(b)})


@router.post("/{target}/{path:path}/act/{action}")
async def act(target: str, path: str, action: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return _go(request, {"op": "act", "target": target, "path": path, "action": action, "input": b.get("input") or {}, **_audit_fields(b)})


@router.get("/{target}/{path:path}")
def get(target: str, path: str, request: Request) -> JSONResponse:
    return _go(request, {"op": "get", "target": target, "path": path})


@router.put("/{target}/{path:path}")
async def set_(target: str, path: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return _go(request, {"op": "set", "target": target, "path": path, "value": b.get("value"), **_audit_fields(b)})


@router.post("/{target}")
async def add(target: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return _go(request, {"op": "add", "target": target, "value": b.get("value"), **_audit_fields(b)})


@router.delete("/{target}/{path:path}")
async def remove(target: str, path: str, request: Request) -> JSONResponse:
    b = await _body(request)
    confirm = b.get("confirm") or request.query_params.get("confirm")
    return _go(request, {"op": "remove", "target": target, "path": path, **({"confirm": confirm} if confirm else {}), **_audit_fields(b)})


class Control:
    """control@1 for other plugins, the console's /api/control mount and its MCP tools."""

    router = router

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        # never an owner approval: a pass grant through the capability (MCP tools, other plugins) is only a request
        return run(command, grants, by)

    def pass_publication(self) -> Any:
        """The veto pass publication (what GET pass answers, unsigned) for in-process readers."""
        out = meta("pass-publication")
        return out.get("body") if isinstance(out, dict) else None

    def registry(self) -> Any:
        return meta("registry")


plugin_services.provide("control@1", Control(), folder=FOLDER)
