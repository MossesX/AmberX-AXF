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
  GET    pass/check?target=&op=   the scope a control@1 command falls in and whether an active pass covers it now
  GET    pass/check?call=&irreversible=   the same for any call axHub holds (service.tool): only an all pass covers it
  POST   pass/grant               { scope = all, minutes?, reason?, include_irreversible?, by? } → a request Brett
                                  approves (his session: on at once). No scope = all: every command, every plugin
  POST   pass/approve | pass/deny { scope, request }  Brett's session, or axHub with X-AXF-Pass-Approval / -Approver
  POST   pass/revoke | pass/undo  { scope, by? }
  GET|PUT pass/settings           { maxMinutes, timeZone }

pass-approval@1 (docs/contracts/pass-approval.md), plugin mount + /api/passes/* aliases:
  GET    pass/pending             every waiting request with deep_link / approve_url / deny_url (never a token)
  GET    pass/{id}                one pass: state, links, text
  POST   pass/{id}/approve|deny   Brett's session (or axHub's signed headers): the same proof as pass/approve
  POST   pass/action { token }    a signed pass action token from a notification (/api/passes/action: no session)

Capability control@1: plugin_services.get("control@1").run(command, grants=[…], by="…") → the answer dict.
Who may: the console token and hub admins = the admin role (`*`); a role's grants come from the console's uac-policy
(`control.<domain>.<read|write|delete>`), never more than the caller's own role.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import sys
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

import plugin_services
import wall

router = APIRouter()
FOLDER = "token-control"
CLI = Path(__file__).resolve().parent.parent / "control.mjs"
ROOT = CLI.parents[4]
STATUS = {"invalid": 400, "validation": 422, "denied": 403, "not_found": 404, "confirmation_required": 409, "not_implemented": 501, "unexpected": 500}
POLICY = ROOT / "apps" / "console-web" / "src" / "assets" / "uac-policy" / "console-access.json"
try:  # the control@1 target ids (framework/schemas/control.json): anything else under /api/control is a plugin's
    TARGETS = frozenset(json.loads((ROOT / "framework" / "schemas" / "control.json").read_text())["targets"])
except (OSError, ValueError, KeyError):
    TARGETS = frozenset()


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


def _console(command: dict[str, Any]) -> Any:
    """The provider of console.* targets (the Console commands plugin, where the open consoles are), or None."""
    return plugin_services.get("console-commands@1") if str(command.get("target") or "").startswith("console.") else None


def _plugins(command: dict[str, Any]) -> Any:
    """The provider of plugins.* targets and of /api/control/<plugin>/<command> (the Plugin commands plugin), or None."""
    target = str(command.get("target") or "")
    svc = plugin_services.get("plugin-commands@1")
    if svc is None or (target in TARGETS and not target.startswith("plugins.")):
        return None
    return svc if svc.handles(target) else None


async def _go(request: Request, command: dict[str, Any]) -> JSONResponse:
    """Off the event loop: the runner is a subprocess, and a console command waits for the consoles' acks on this loop."""
    pc = _plugins(command)
    if pc is not None:
        if not str(command.get("target") or "").startswith("plugins."):
            command = pc.from_rest(request.method, command, dict(request.query_params), await _body(request))
        grants, name = caller(request)
        return answer(await run_in_threadpool(lambda: pc.run(command, grants, command.get("by") or name, request)))
    svc = _console(command)
    if svc is not None:
        return answer(await run_in_threadpool(svc.run_for, request, command))
    grants, name = caller(request)
    approver, proof = owner_approval(request) if command.get("target") == "pass.scopes" else (None, None)
    return answer(await run_in_threadpool(lambda: run(command, grants, by=command.get("by") or name, approver=approver, proof=proof)))


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
    if not (user is not None and getattr(user, "via", "") == "session" and getattr(user, "admin", False)):
        # The console's browser also sends the stored console token, so auth resolves it to the token caller first.
        # Brett's signed-in admin session (axHub's signed wall headers, same origin) still makes it his click; a
        # Claude session, CLI or MCP call holds only the token and never carries those headers.
        session = wall.wall_caller(request.headers)
        if session is not None and session.admin and session.via == "session" and wall.same_origin(request):
            user = session
    approver = None
    if user is not None and getattr(user, "via", "") == "session" and getattr(user, "admin", False):
        approver = {"via": "console", "name": str(getattr(user, "name", "") or "brett")}
    elif not _console_token():
        approver = {"via": "local", "name": "console"}
    sig = request.headers.get("x-axf-pass-approval", "")
    who = request.headers.get("x-axf-pass-approver", "")
    return approver, ({"signature": sig, "approver": who} if sig and who else None)


def _scope(b: dict[str, Any]) -> str:
    """The scope a pass route names; none = all (everything, the default since build pass-all). Short words too."""
    s = str(b.get("scope") or b.get("path") or "all").strip()
    return {"everything": "all", "theme": "tokens.theme", "style": "tokens.style", "layout": "tokens.layout", "tokens": "tokens.*"}.get(s.lower(), s)


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
def pass_check(target: str = "", op: str = "set", call: str = "", irreversible: bool = False) -> Any:
    """{ scope, covered, pass? }: the scope a control@1 command (target + op) or an axHub call (call = service.tool)
    falls in, and the active pass covering it now."""
    args = ["pass-check", "--call", call] if call else ["pass-check", target, op]
    if irreversible:
        args.append("--irreversible")
    try:
        proc = subprocess.run(["node", str(CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
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
    if b.get("include_irreversible") is True:
        inp["include_irreversible"] = True
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


# ---------------------------------------------------------------------- pass-approval@1 (docs/contracts/pass-approval.md)
# One pass by id: read it with its links, list the waiting ones, approve or deny it. The owner routes take the same
# proof as pass/approve | pass/deny (Brett's session, a local console, axHub's signed headers); pass/action takes a
# signed pass action token instead (a device notification's Approve / Deny, in the background). Both run
# lib/pass-approval.mjs → the existing pass.scopes approve / deny. Aliases: /api/passes/* (capability pass-approval@1).

PROBLEM_STATUS = {"malformed": 400, "unknown_pass": 404, "wrong_pass": 409, "expired": 410, "not_pending": 409, "decided": 409,
                  "bad_signature": 401, "no_secret": 503, "owner_required": 403}


def _node_json(args: list[str], stdin: str | None = None) -> dict[str, Any]:
    try:
        proc = subprocess.run(["node", str(CLI), *args], input=stdin, cwd=ROOT, capture_output=True, text=True, timeout=60)
        lines = proc.stdout.strip().splitlines()
        return json.loads("\n".join(lines) if args[-1:] == ["--json"] else lines[-1])
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError, IndexError) as e:
        return {"ok": False, "code": "unexpected", "message": f"the pass runner could not answer: {str(e)[:200]}"}


def _pass_answer(r: dict[str, Any]) -> JSONResponse:
    if r.get("ok"):
        return JSONResponse(r)
    return JSONResponse(r, status_code=int(r.get("status") or PROBLEM_STATUS.get(str(r.get("code")), 500)))


def pending_passes() -> dict[str, Any]:
    return _node_json(["pass-pending", "--json"])


def get_pass(pass_id: str) -> dict[str, Any]:
    return _node_json(["pass-get", pass_id, "--json"])


def decide_pass(pass_id: str, decision: str, request: Request | None = None, token: str = "", by: str = "") -> dict[str, Any]:
    """Approve or deny one pass. With `token`: the signed action token decides (no session needed). Without: the owner
    approval this request carries (never anything from a body)."""
    env: dict[str, Any] = {"id": pass_id, "decision": decision, "by": by[:80]}
    if token:
        env["token"] = token[:400]
    elif request is not None:
        approver, proof = owner_approval(request)
        if approver:
            env["approver"] = approver
        if proof:
            env["proof"] = proof
    return _node_json(["pass-decide"], json.dumps(env))


def pass_action(token: str) -> dict[str, Any]:
    """POST pass/action: the token alone names the pass and the decision."""
    return decide_pass("", "", token=str(token or ""))


def push_tokens(pass_id: str) -> dict[str, Any] | None:
    """Approve / deny tokens for one device delivery of a pending pass (never put into an API answer)."""
    r = _node_json(["pass-tokens", pass_id])
    return r if r.get("approve") and r.get("deny") else None


@router.get("/pass/pending")
def pass_pending_route() -> JSONResponse:
    return _pass_answer(pending_passes())


@router.post("/pass/action")
async def pass_action_route(request: Request) -> JSONResponse:
    b = await _body(request)
    return _pass_answer(await run_in_threadpool(pass_action, str(b.get("token") or "")))


@router.get("/pass/{pass_id}")
def pass_get_route(pass_id: str) -> JSONResponse:
    return _pass_answer(get_pass(pass_id))


@router.post("/pass/{pass_id}/{decision}")
async def pass_decide_route(pass_id: str, decision: str, request: Request) -> JSONResponse:
    if decision not in ("approve", "deny"):
        return _pass_answer({"ok": False, "code": "malformed", "message": "approve or deny"})
    _, name = caller(request)
    return _pass_answer(await run_in_threadpool(lambda: decide_pass(pass_id, decision, request, by=name)))


# /api/passes/* (main.py mounts pass-approval@1's routers): `router` behind the console's auth, `public_router` with
# no session at all (the signed token is the proof: one pass, one decision, 15 min, single use).
passes_router = APIRouter()
passes_public_router = APIRouter()
passes_router.add_api_route("/pending", pass_pending_route, methods=["GET"])
passes_router.add_api_route("/{pass_id}", pass_get_route, methods=["GET"])
passes_router.add_api_route("/{pass_id}/{decision}", pass_decide_route, methods=["POST"])
passes_public_router.add_api_route("/action", pass_action_route, methods=["POST"])


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
    return await _go(request, await _body(request))


@router.get("/{target}")
async def list_(target: str, request: Request) -> JSONResponse:
    select = {k: _parse(v) for k, v in request.query_params.items()}
    return await _go(request, {"op": "list", "target": target, **({"select": select} if select else {})})


@router.post("/{target}/reset")
async def reset(target: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return await _go(request, {"op": "reset", "target": target, **({"path": b["path"]} if b.get("path") else {}), **_audit_fields(b)})


@router.post("/{target}/{path:path}/act/{action}")
async def act(target: str, path: str, action: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return await _go(request, {"op": "act", "target": target, "path": path, "action": action, "input": b.get("input") or {}, **_audit_fields(b)})


@router.get("/{target}/{path:path}")
async def get(target: str, path: str, request: Request) -> JSONResponse:
    return await _go(request, {"op": "get", "target": target, "path": path})


@router.put("/{target}/{path:path}")
async def set_(target: str, path: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return await _go(request, {"op": "set", "target": target, "path": path, "value": b.get("value"), **_audit_fields(b)})


@router.post("/{target}")
async def add(target: str, request: Request) -> JSONResponse:
    b = await _body(request)
    return await _go(request, {"op": "add", "target": target, "value": b.get("value"), **_audit_fields(b)})


@router.post("/{target}/{path:path}")
async def plugin_command(target: str, path: str, request: Request) -> JSONResponse:
    """POST /api/control/<plugin>/<command>: a plugin command (plugin-commands@1); control@1 targets take no POST here."""
    if _plugins({"target": target}) is None:
        return answer({"$axf": "control@1", "ok": False, "code": "not_found", "message": f"no plugin or control@1 route {target}/{path}"})
    return await _go(request, {"op": "act", "target": target, "path": path})


@router.delete("/{target}/{path:path}")
async def remove(target: str, path: str, request: Request) -> JSONResponse:
    b = await _body(request)
    confirm = b.get("confirm") or request.query_params.get("confirm")
    return await _go(request, {"op": "remove", "target": target, "path": path, **({"confirm": confirm} if confirm else {}), **_audit_fields(b)})


class Control:
    """control@1 for other plugins, the console's /api/control mount and its MCP tools."""

    router = router

    def run(self, command: dict[str, Any], grants: list[str] | None = None, by: str = "") -> dict[str, Any]:
        pc = _plugins(command) if str(command.get("target") or "").startswith("plugins.") else None
        if pc is not None:
            return pc.run(command, grants, by)
        # never an owner approval: a pass grant through the capability (MCP tools, other plugins) is only a request
        svc = _console(command)
        return svc.run(command, grants, by) if svc is not None else run(command, grants, by)

    def owner(self, request: Request) -> dict[str, str] | None:
        """Brett's approval as this request carries it (his signed-in console session, or a console with no token),
        else None. Other plugins use it for their owner-only switches (Claude settings)."""
        return owner_approval(request)[0]

    def owner_pass(self, request: Request, action: str, scope: str = "all", input_: dict[str, Any] | None = None, reason: str = "") -> dict[str, Any]:
        """Grant or revoke a veto pass for an owner-only switch in another plugin (Claude settings → No wait). The
        approval comes from this request only, never from the caller's arguments: without Brett's signed-in session a
        grant stays a request waiting for him, like any other."""
        if action not in ("grant", "revoke"):
            return {"ok": False, "code": "invalid", "message": f"owner_pass does not {action}"}
        grants, name = caller(request)
        approver, _ = owner_approval(request)
        cmd = {"op": "act", "target": PASS, "path": _scope({"scope": scope}), "action": action, "input": input_ or {}, "by": name, "reason": reason}
        return run(cmd, grants, by=name, approver=approver)

    def pass_settings(self, patch: dict[str, Any] | None = None) -> dict[str, Any]:
        """{ maxMinutes, timeZone }. A caller that changes them checks owner() first (Claude settings, Approvals & veto)."""
        if patch is None:
            return meta("pass-settings")
        proc = subprocess.run(["node", str(CLI), "pass-settings", json.dumps(patch), "--json"], cwd=ROOT, capture_output=True, text=True, timeout=30)
        return json.loads(proc.stdout)

    def renew_pass(self, scope: str, input_: dict[str, Any], reason: str) -> dict[str, Any]:
        """Re-grant a pass that Brett's own approval is keeping on ("until I turn it off"): only while an active pass
        for the scope exists that he approved himself (console or local), named after him as a standing renewal."""
        status = run({"op": "get", "target": PASS, "path": _scope({"scope": scope})}, ["*"], by="renew")
        item = ((status.get("data") or status).get("item") or {}) if isinstance(status, dict) else {}
        active = item.get("active") or {}
        via = str(active.get("approvedVia") or active.get("approved_via") or "")
        who = str(active.get("approvedBy") or active.get("approved_by") or "")
        if not active or via not in ("console", "local") or not who:
            return {"ok": False, "code": "denied", "message": "no pass of Brett's own to renew"}
        approver = {"via": via, "name": who if who.endswith("(standing)") else f"{who} (standing)"}
        cmd = {"op": "act", "target": PASS, "path": _scope({"scope": scope}), "action": "grant", "input": input_, "by": "no-wait-standing", "reason": reason}
        return run(cmd, ["*"], by="no-wait-standing", approver=approver)

    def pass_publication(self) -> Any:
        """The veto pass publication (what GET pass answers, unsigned) for in-process readers."""
        out = meta("pass-publication")
        return out.get("body") if isinstance(out, dict) else None

    def registry(self) -> Any:
        return meta("registry")


plugin_services.provide("control@1", Control(), folder=FOLDER)


class PassApproval:
    """pass-approval@1: one veto pass by id (read, list waiting, approve / deny with an owner request or a signed
    token), its /api/passes routers, and the device-delivery tokens a push carries."""

    router = passes_router
    public_router = passes_public_router

    def pending(self) -> dict[str, Any]:
        return pending_passes()

    def get(self, pass_id: str) -> dict[str, Any]:
        return get_pass(pass_id)

    def decide(self, pass_id: str, decision: str, request: Request | None = None, token: str = "", by: str = "") -> dict[str, Any]:
        return decide_pass(pass_id, decision, request, token=token, by=by)

    def action(self, token: str) -> dict[str, Any]:
        return pass_action(token)

    def push_tokens(self, pass_id: str) -> dict[str, Any] | None:
        return push_tokens(pass_id)


class PassFocus:
    """console-focus@1/pass: `pass:<id>` (or a bare pass id) on console_show / console_open → the Token control screen,
    focused on that pass (its pass-approval view opens on it, Approve and Deny ready)."""

    SCREEN = "token-control"
    ID_RE = re.compile(r"^pass-[0-9a-z]{1,16}-[0-9a-f]{6}$")

    def resolve(self, path: str) -> dict[str, Any] | None:
        p = str(path or "").strip()
        explicit = p.lower().startswith("pass:")
        pid = p[5:].strip() if explicit else p
        if not self.ID_RE.match(pid):
            return None
        return {"screen": self.SCREEN, "focus": f"pass:{pid}", "explicit": True}


class PassAlertActions:
    """alert-actions@1: a pass request's push gets Approve / Deny (a background POST to /api/passes/action with a token
    minted for that one delivery) and Open (the deep link). Nothing once the pass stopped waiting."""

    def actions(self, alert: dict[str, Any]) -> list[dict[str, Any]] | None:
        key = str(alert.get("key") or "")
        if alert.get("source") != "pass" or not key.startswith("pass:"):
            return None
        pid = key[5:]
        toks = push_tokens(pid)
        if not toks:
            return None
        link = str(alert.get("link") or "")
        return [
            {"id": "pass.approve", "label": "Approve", "post": "/api/passes/action", "body": {"token": toks["approve"]}},
            {"id": "pass.deny", "label": "Deny", "post": "/api/passes/action", "body": {"token": toks["deny"]}},
            *([{"id": "pass.open", "label": "Open", "url": link}] if link.startswith("https://") else []),
        ]


class PassVoice:
    """voice-intents@1 (AmberX through console-control voice): "approve the pass" / "deny the pass" decide with the
    token the notification holds (`extra.token`); without one the pass opens with that button ready (a voice request is
    no proof it is Brett). "open the pending pass" opens it (console + `openUrl` for the phone); "what's waiting" lists."""

    DECIDE = re.compile(r"^(?:please )?(approve|allow|accept|deny|reject|decline)(?: the)?(?: veto)? pass(?: (pass-[0-9a-z]+-[0-9a-f]{6}))?$")
    OPEN = re.compile(r"^(?:open|show(?: me)?|bring up)(?: the)?(?: (?:pending|waiting))?(?: veto)? pass(?: request)?$")
    LIST = re.compile(r"^(?:what'?s waiting|what is waiting|any passes(?: waiting)?|(?:list|show)(?: the)?(?: pending| waiting)? passes)$")

    @staticmethod
    def _clean(text: str) -> str:
        t = re.sub(r"[^\w\s'-]", " ", str(text or "").lower())
        t = re.sub(r"\s+", " ", t).strip()
        return re.sub(r"^(?:hey )?amber ", "", t)

    @staticmethod
    def _show(pid: str) -> None:
        svc = plugin_services.get("console-commands@1")
        if svc is None:
            return
        try:
            svc.run({"op": "act", "target": "console.screens", "path": f"pass:{pid}", "action": "open"}, ["*"], "voice", wait=1.0)
        except Exception:  # noqa: BLE001 — the phone still gets openUrl
            pass

    def handle(self, text: str, extra: dict[str, Any]) -> dict[str, Any] | None:
        t = self._clean(text)
        m = self.DECIDE.match(t)
        if m:
            decision = "approve" if m.group(1) in ("approve", "allow", "accept") else "deny"
            token = str(extra.get("token") or "")
            if token:
                r = decide_pass(m.group(2) or "", decision, token=token, by="voice")
                return {**r, "intent": {"verb": f"pass.{decision}"}, "say": r.get("text") if r.get("ok") else f"That didn't go through: {r.get('message', 'refused')}."}
            items = (pending_passes().get("items") or [])
            p = next((x for x in items if x.get("id") == m.group(2)), None) if m.group(2) else (items[0] if len(items) == 1 else None)
            if p is None:
                return {"ok": False, "code": "not_found" if not items else "ambiguous", "intent": {"verb": f"pass.{decision}"}, "items": items,
                        "say": "No pass is waiting." if not items else f"{len(items)} passes are waiting: say which, or open them."}
            self._show(str(p["id"]))
            url = p.get("approve_url" if decision == "approve" else "deny_url") or p.get("deep_link")
            return {"ok": False, "code": "approval_required", "intent": {"verb": f"pass.{decision}"}, "pass": p, "openUrl": url,
                    "say": f"{p.get('requestedBy') or 'An agent'} asks for {p.get('label', 'a pass')} for {p.get('minutes')} minutes. It's open: tap {decision.title()}."}
        if self.OPEN.match(t):
            items = (pending_passes().get("items") or [])
            if not items:
                return {"ok": True, "intent": {"verb": "pass.open"}, "items": [], "say": "No pass is waiting."}
            p = items[0]
            self._show(str(p["id"]))
            return {"ok": True, "intent": {"verb": "pass.open"}, "pass": p, "openUrl": p.get("deep_link"), "say": f"Opened the pass {p.get('requestedBy') or 'an agent'} asked for."}
        if self.LIST.match(t):
            items = (pending_passes().get("items") or [])
            say = "No pass is waiting." if not items else " ".join(f"{x.get('requestedBy')} asks for {x.get('label')} for {x.get('minutes')} minutes." for x in items[:3])
            return {"ok": True, "intent": {"verb": "pass.list"}, "items": items, "say": say}
        return None


# ---------------------------------------------------------------------- pass request → push (pass-approval@1 pass-push@1)
# A watcher reads the pass store (whoever filed the request: REST, MCP, CLI, axHub) and raises one alert per request
# (key pass:<id>, push: an approval reaches the phone channels that are set up; the notify gate has the last word). When
# the pass stops waiting the same key is raised again with the outcome and resolved: the phone's notice is replaced.

DATA_DIR = Path(os.environ.get("AXF_CONTROL_DATA_DIR") or ROOT / ".axf-console" / "plugins" / FOLDER)
WATCH_S = 2.0


def _pending_ids(now_ms: int) -> set[str]:
    try:
        d = json.loads((DATA_DIR / "passes.json").read_text())
    except (OSError, ValueError):
        return set()
    out = set()
    for p in d.get("passes") or []:
        if not isinstance(p, dict) or p.get("state") != "pending":
            continue
        try:
            from datetime import datetime
            at = int(datetime.fromisoformat(str(p.get("requestedAt")).replace("Z", "+00:00")).timestamp() * 1000)
        except ValueError:
            continue
        if now_ms < at + 15 * 60 * 1000:
            out.add(str(p.get("id")))
    return out


def pass_alert(pass_id: str) -> dict[str, Any] | None:
    r = _node_json(["pass-alert", pass_id])
    return r if r.get("key") else None


def notify_pending(pass_id: str) -> None:
    import console_context as cx
    a = pass_alert(pass_id)
    if not a or a.get("phase") != "pending":
        return
    cx.raise_alert({k: a[k] for k in ("source", "severity", "title", "body", "key", "link", "meta") if k in a} | {"push": True})


def notify_cleared(pass_id: str) -> None:
    import console_context as cx
    a = pass_alert(pass_id)
    key = f"pass:{pass_id}"
    if a and a.get("phase") == "cleared":
        cx.resolve_alerts([key])  # resolved first, so the outcome reopens it and reaches the phone (replacing the ask)
        cx.raise_alert({k: a[k] for k in ("source", "severity", "title", "body", "key", "link", "meta") if k in a} | {"push": True})
    cx.resolve_alerts([key])


class PassWatcher:
    def __init__(self) -> None:
        self.seen: set[str] | None = None
        self.mtime = -1.0
        self.stop = threading.Event()

    def tick(self) -> None:
        import time as _t
        f = DATA_DIR / "passes.json"
        try:
            mt = f.stat().st_mtime
        except OSError:
            mt = 0.0
        now_ms = int(_t.time() * 1000)
        if mt == self.mtime and self.seen is not None and not self.seen:
            return  # nothing waiting and nothing written: no work
        self.mtime = mt
        now = _pending_ids(now_ms)
        before, self.seen = self.seen, now
        if before is None:
            return  # first look: what already waits was announced before a restart
        for pid in sorted(now - before):
            notify_pending(pid)
        for pid in sorted(before - now):
            notify_cleared(pid)

    def run(self) -> None:
        while not self.stop.wait(WATCH_S):
            try:
                self.tick()
            except Exception:  # noqa: BLE001 — the watcher never dies on one bad read
                pass


WATCHER = PassWatcher()
if os.environ.get("AXF_PASS_WATCH", "1") != "0":
    threading.Thread(target=WATCHER.run, name="pass-watch", daemon=True).start()

plugin_services.provide("pass-approval@1", PassApproval(), folder=FOLDER)
plugin_services.provide("alert-actions@1/pass", PassAlertActions(), folder=FOLDER)
plugin_services.provide("voice-intents@1/pass", PassVoice(), folder=FOLDER)
plugin_services.provide("console-focus@1/pass", PassFocus(), folder=FOLDER)
