"""VPS Configuration REST routes (gate-rules@1, framework/spec/GATE.md). Mounted at /api/plugins/gate/.

Every route runs the plugin's one Node implementation (gate.mjs api <op>), so the console page, the MCP tools
(plugin-commands@1: gate_*), the CLI (`axf gate …`) and voice give the same record for the same input.

  GET  rules [?kind&enabled&owner]      gate-rule-set@1
  GET  rules/<id>                       the rule + what Reset would give it
  PUT  rules/<id> {enabled?, severity?, settings?, owner?, title?, description?, reason?}
  POST rules/<id>/toggle {enabled}      switch one rule on or off
  POST rules/reset {id?, confirm?}      two-step: the first call answers confirmation_required with a token
  GET  check ?pr= | ?branch=            gate-verdict@1 for one PR (changes nothing)
  GET  history [?kind&since&pr&rule&action&limit]
  GET  lander                           lander-state@1 without the bodies (status, mode, counts, last run)
  GET  lander/waiting [?rule&state]     waiting PRs with the rule that holds each and why
  GET  lander/runs [?limit&result]      the last runs, newest first
  GET  lander/mode · POST lander/mode {mergeQueue}   the one Merge queue on/off switch (takes effect at once)
  POST lander/land-now {pr, confirm?}   two-step: puts the PR at the head of the line in the current mode
  POST lander/pause {why?} · POST lander/resume
  GET  settings · PUT settings {refreshSec?, historySize?, defaultTab?}
  GET  build-cap                        build-cap@1: hard cap, emergency slots, stepsInParallel, what runs now, the note
  POST build-cap {stepsInParallel?, maxBuilds?, emergencySlots?}   maxBuilds / emergencySlots: Brett's signed-in console only
  GET  model-triage                     model-triage@1: the VPS gate that assigns each step's model: rules, defaults, last decisions
  POST model-triage {op: rule|move|defaults|enabled|reset, …}   one edit, checked on the VPS (framework/cli/model-triage.mjs)
  GET  model-triage/decisions [?build&lane&limit]   the decision log, newest first (model, rule, why)
  GET  model-triage/history [?limit]    every rule change
  POST model-triage/decide {text, title?, files?, minutes?, lines?, lane?, kind?, requested?}   what the gate would answer (nothing is logged)
  GET  approval-rules                   approval-rules@1: axHub's match-pattern policy rules, live, with the draft over them
  POST approval-rules/draft {op, service?, index?, to?, rule?, rules?, clearOwn?, on?}   stage one edit (add, edit, remove,
                                        move, set, clear-own, default, discard). Never changes axHub: Brett saves from his console.
  The lander (lander@1, deploy/lander/run.mjs; the same routes the auto-lander@1 runner answered before Nov 19 2026):
  GET  auto-lander                      service up, current build, queue, per-build state and attempts, escalations
  GET  auto-lander/builds/<build>       one build's record and attempt log
  POST auto-lander/run                  ask the service for a tick now
  POST auto-lander/retry/<build> · POST auto-lander/fix/<build>   reset (fix = and start a fix session)
  POST auto-lander/pause · POST auto-lander/resume
  GET  auto-lander/settings · POST auto-lander/settings {key: value…}
  Build rules (build-rules@1, framework/spec/BUILD-RULES.md; build-rules-api.mjs):
  GET  build-rules [?doer&kind&phase&enabled&q]   the store with each rule's last run
  POST build-rules {rule | id, title, text, doer, kind, phase, …}   add a rule
  GET  build-rules/brief ?build&title&text&ui     what a session's brief would get (brief-blocks@1)
  GET  build-rules/history [?id&action&since&limit]   every change (build-rule-history@1)
  GET  build-rules/runs [?id&build&result&since&limit]   every check / fix run (build-rule-run@1)
  POST build-rules/run {build, phase, rules?, dryRun?}   run a phase now (dry run changes nothing)
  GET  build-rules/<id> · PUT build-rules/<id> {patch | fields}
  POST build-rules/<id>/toggle {enabled?}         on / off (no enabled = flip)
  POST build-rules/<id>/delete {confirm?}         two-step: the first call answers confirmation_required with a token

Writes take `by` and `reason` ({title, description} or text) from the body; `by` defaults to the signed-in user.
"""
from __future__ import annotations

import importlib.util
import json
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
PLUGIN_DIR = Path(__file__).resolve().parents[1]
CLI = PLUGIN_DIR / "gate.mjs"
ROOT = Path(__file__).resolve().parents[5]
_spec = importlib.util.spec_from_file_location("axf_gate_health", PLUGIN_DIR / "health.py")
health = importlib.util.module_from_spec(_spec)  # the plugin's health.py (pure checks and alert builders)
_spec.loader.exec_module(health)  # type: ignore[union-attr]
_spec_al = importlib.util.spec_from_file_location("axf_gate_auto_lander_health", Path(__file__).resolve().parent / "auto_lander_health.py")
al_health = importlib.util.module_from_spec(_spec_al)  # the server auto-lander's systems-check item (pure)
_spec_al.loader.exec_module(al_health)  # type: ignore[union-attr]
AL_CLI = ROOT / "deploy" / "lander" / "run.mjs"  # the Pipeline 2.0 lander (replaced deploy/auto-lander, Nov 19 2026)
_spec_mp = importlib.util.spec_from_file_location("axf_gate_main_protection_health", Path(__file__).resolve().parent / "main_protection_health.py")
mp_health = importlib.util.module_from_spec(_spec_mp)  # "is main protected on GitHub": a read-only systems-check item (pure)
_spec_mp.loader.exec_module(mp_health)  # type: ignore[union-attr]
_spec_ad = importlib.util.spec_from_file_location("axf_gate_approval_default_health", Path(__file__).resolve().parent / "approval_default_health.py")
ad_health = importlib.util.module_from_spec(_spec_ad)  # "is Brett's approval default applied": a read-only systems-check item (pure)
_spec_ad.loader.exec_module(ad_health)  # type: ignore[union-attr]
BP_CLI = ROOT / "deploy" / "branch-protection.mjs"
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503, "failed": 502}
MAX_BODY = 64 * 1024


def run(op: str, data: dict[str, Any] | None = None, timeout: int = 90) -> dict[str, Any]:
    """One gate op through the Node implementation: { ok, … } or { ok: false, code, message }."""
    try:
        p = subprocess.run(["node", str(CLI), "api", op], cwd=ROOT, capture_output=True, text=True, timeout=timeout, input=json.dumps(data or {}))
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the gate could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "failed", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "failed", "message": (p.stderr or p.stdout).strip()[-400:]}


def bp_show(timeout: int = 60) -> dict[str, Any]:
    """What GitHub has for main's ruleset (deploy/branch-protection.mjs show --json: read-only): { ok, ruleset, current, error }."""
    if not BP_CLI.exists():
        return {"ok": False, "message": "deploy/branch-protection.mjs is not in this checkout"}
    try:
        p = subprocess.run(["node", str(BP_CLI), "show", "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
        r = json.loads(p.stdout) if p.returncode == 0 else None
    except (OSError, subprocess.TimeoutExpired, json.JSONDecodeError) as e:
        return {"ok": False, "message": str(e)[:200]}
    return r if isinstance(r, dict) else {"ok": False, "message": (p.stderr or p.stdout).strip()[-300:] or f"exit {p.returncode}"}


def al_run(args: list[str], timeout: int = 60) -> dict[str, Any]:
    """One lander command (deploy/lander/run.mjs <args> --json): { ok, … } or { ok: false, code, message }."""
    if not AL_CLI.exists():
        return {"ok": False, "code": "unavailable", "message": "the lander is not in this checkout (deploy/lander/run.mjs)"}
    try:
        p = subprocess.run(["node", str(AL_CLI), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the auto-lander could not run: {str(e)[:200]}"}
    if p.returncode != 0:
        return {"ok": False, "code": "invalid" if p.returncode == 2 else "failed", "message": (p.stderr or p.stdout).strip()[-400:] or f"exit {p.returncode}"}
    try:
        r = json.loads(p.stdout)
    except json.JSONDecodeError:
        return {"ok": False, "code": "failed", "message": p.stdout.strip()[-400:]}
    return {"ok": True, **r} if isinstance(r, dict) else {"ok": True, "result": r}


def answer(r: dict[str, Any]) -> JSONResponse:
    # a two-step press's first call is an answer, not an error: the token is in it
    ok = r.get("ok") or r.get("code") == "confirmation_required"
    return JSONResponse(r, status_code=200 if ok else STATUS.get(str(r.get("code")), 500))


def _who(request: Request) -> str:
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return f"console:{str(name)[:40]}" if name and name != "console-token" else "console"


async def _body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        return {}
    try:
        body = json.loads(raw or b"{}")
    except ValueError:
        return {}
    body = body if isinstance(body, dict) else {}
    # plugin-commands sends {input: {...}, by, reason}; a page sends the fields themselves
    if isinstance(body.get("input"), dict):
        body = {**body["input"], **{k: body[k] for k in ("by", "reason", "confirm") if body.get(k)}}
    return body


async def _write(op: str, request: Request, extra: dict[str, Any] | None = None) -> JSONResponse:
    body = await _body(request)
    data = {**body, **(extra or {})}
    if not data.get("by"):
        data["by"] = _who(request)
    r = await run_in_threadpool(run, op, data)
    if op in ("lander_pause", "lander_resume", "lander_mode") and r.get("ok"):
        _paused_alert(r)
    return answer(r)


# ---------------------------------------------------------------------- systems check + alerts

_health_lock = threading.Lock()
_health_on = {"done": False}
_alerted: set[str] = set()


def _cx() -> Any:
    try:
        import console_context as cx  # the console's context (absent in a bare test import)
        return cx
    except ImportError:
        return None


def _paused_alert(st: dict[str, Any]) -> None:
    cx = _cx()
    if cx is None:
        return
    a = health.paused_alert(st)
    try:
        if a:
            cx.raise_alert(a)
        else:
            cx.resolve_alerts([health.PAUSED_KEY])
    except Exception:  # noqa: BLE001 — alerts are a convenience
        pass


def _held_alerts() -> None:
    """Raise one alert per PR a gate rule holds for a fix; resolve the ones that cleared."""
    cx = _cx()
    if cx is None:
        return
    w = run("lander_waiting")
    if not w.get("ok"):
        return
    want = {a["key"]: a for a in health.held_alerts(w.get("items") or [])}
    try:
        for k, a in want.items():
            if k not in _alerted:
                cx.raise_alert(a)
        gone = [k for k in _alerted if k not in want]
        if gone:
            cx.resolve_alerts(gone)
    except Exception:  # noqa: BLE001
        return
    _alerted.clear()
    _alerted.update(want)


def _status_for_health() -> dict[str, Any]:
    st = run("lander_status")
    if st.get("ok"):
        _paused_alert(st)
    _held_alerts()
    return st


def ensure_health() -> None:
    with _health_lock:
        if _health_on["done"]:
            return
        try:
            import plugin_services
        except ImportError:
            return
        lander = health.ensure(plugin_services, _status_for_health)
        server = al_health.ensure(plugin_services, lambda: al_run(["status"]), lambda b: al_run(["fix", b, "--by", "systems-check"]))  # axf-not-plugin:systems-check (actor name)
        main = mp_health.ensure(plugin_services, bp_show)
        approvals = ad_health.ensure(plugin_services, lambda: _node(PLUGIN_DIR / "approval-rules.mjs", ["status"]))
        _health_on["done"] = lander and server and main and approvals


async def _read(op: str, data: dict[str, Any]) -> JSONResponse:
    return answer(await run_in_threadpool(run, op, {k: v for k, v in data.items() if v not in (None, "")}))


# ---------------------------------------------------------------------- rules

@router.get("/rules")
async def rules_list(kind: str = "", enabled: str = "", owner: str = "") -> JSONResponse:
    """The gate rule set (gate-rule-set@1), optionally filtered by kind, enabled (true/false) and owner."""
    return await _read("rules_list", {"kind": kind, "enabled": enabled, "owner": owner})


@router.post("/rules/reset")
async def rules_reset(request: Request) -> JSONResponse:
    """Reset one rule ({id}) or the whole set to the defaults; the first call answers confirmation_required with a token."""
    return await _write("rules_reset", request)


@router.get("/rules/{rule_id}")
async def rules_get(rule_id: str) -> JSONResponse:
    """One gate rule and the default it would get on Reset."""
    return await _read("rules_get", {"id": rule_id})


@router.put("/rules/{rule_id}")
async def rules_set(rule_id: str, request: Request) -> JSONResponse:
    """Change one rule: enabled, severity (block, warn, info), owner, settings (merged), title, description."""
    return await _write("rules_set", request, {"id": rule_id})


@router.post("/rules/{rule_id}/toggle")
async def rules_toggle(rule_id: str, request: Request) -> JSONResponse:
    """Switch one gate rule on or off ({enabled: true|false})."""
    return await _write("rules_toggle", request, {"id": rule_id})


@router.get("/check")
async def check_pr(pr: str = "", branch: str = "") -> JSONResponse:
    """Can this PR land? The gate verdict for one PR (gate-verdict@1) from what the lander knows; changes nothing."""
    return await _read("check_pr", {"pr": pr, "branch": branch})


@router.get("/history")
async def history(kind: str = "", since: str = "", pr: str = "", rule: str = "", action: str = "", limit: int = 100) -> JSONResponse:
    """Rule changes and lander actions, newest first, filtered by kind (rule, lander), since, pr, rule, action."""
    return await _read("history", {"kind": kind, "since": since, "pr": pr, "rule": rule, "action": action, "limit": limit})


# ---------------------------------------------------------------------- the auto-lander

@router.get("/lander")
async def lander_status() -> JSONResponse:
    """The auto-lander: status (running, paused, idle, off, error), the Merge queue switch, the PR landing, counts, last run."""
    ensure_health()  # the systems check may load after this plugin
    return await _read("lander_status", {})


@router.get("/lander/waiting")
async def lander_waiting(rule: str = "", state: str = "") -> JSONResponse:
    """PRs waiting to land, each with the gate rule that holds it and why."""
    return await _read("lander_waiting", {"rule": rule, "state": state})


@router.get("/lander/runs")
async def lander_runs(limit: int = 20, result: str = "") -> JSONResponse:
    """The lander's last runs, newest first (auto-lander-run@1)."""
    return await _read("lander_runs", {"limit": limit, "result": result})


@router.get("/lander/mode")
async def lander_mode() -> JSONResponse:
    """The Merge queue switch: on = the stacked merge queue, off (default) = one at a time."""
    return await _read("lander_mode", {})


@router.post("/lander/mode")
async def lander_mode_set(request: Request) -> JSONResponse:
    """Flip the Merge queue switch ({mergeQueue: true|false}); takes effect at once and is logged in History."""
    return await _write("lander_mode", request)


@router.post("/lander/land-now")
async def lander_land_now(request: Request) -> JSONResponse:
    """Land a PR next ({pr}); two-step: the first call answers confirmation_required with a token. Never a direct merge."""
    return await _write("lander_land_now", request)


@router.post("/lander/pause")
async def lander_pause(request: Request) -> JSONResponse:
    """Pause the auto-lander ({why}): the entry in flight finishes, nothing new starts."""
    return await _write("lander_pause", request)


@router.post("/lander/resume")
async def lander_resume(request: Request) -> JSONResponse:
    """Resume the auto-lander in its current mode."""
    return await _write("lander_resume", request)


# ---------------------------------------------------------------------- the plugin's settings

# ---------------------------------------------------------------------- build rules (build-rules@1)

@router.get("/build-rules")
async def build_rules_list(doer: str = "", kind: str = "", phase: str = "", enabled: str = "", q: str = "") -> JSONResponse:
    """Every build rule with its doer, kind, phase, on/off and last run; filters doer, kind, phase, enabled, q."""
    return await _read("build_rules_list", {"doer": doer, "kind": kind, "phase": phase, "enabled": enabled, "q": q})


@router.post("/build-rules")
async def build_rules_add(request: Request) -> JSONResponse:
    """Add a build rule ({rule} or its fields). Logged in the rule history."""
    return await _write("build_rules_add", request)


@router.get("/build-rules/brief")
async def build_rules_brief(build: str = "", title: str = "", text: str = "", ui: str = "") -> JSONResponse:
    """The session's share of the rules for a build (brief-blocks@1): what the dispatcher puts in its brief."""
    return await _read("build_rules_brief", {"build": build, "title": title, "text": text, "ui": ui})


@router.get("/build-rules/history")
async def build_rules_history(id: str = "", action: str = "", since: str = "", limit: int = 100) -> JSONResponse:
    """Every change to the build rules, newest first (build-rule-history@1)."""
    return await _read("build_rules_history", {"id": id, "action": action, "since": since, "limit": limit})


@router.get("/build-rules/runs")
async def build_rules_runs(id: str = "", build: str = "", result: str = "", since: str = "", limit: int = 100) -> JSONResponse:
    """Every check and fix the VPS ran, newest first (build-rule-run@1)."""
    return await _read("build_rules_runs", {"id": id, "build": build, "result": result, "since": since, "limit": limit})


@router.post("/build-rules/run")
async def build_rules_run(request: Request) -> JSONResponse:
    """Run one phase (before, after, gate) of the build rules for a build now; dryRun changes nothing."""
    body = await _body(request)
    data = {**body, "by": body.get("by") or _who(request)}
    return answer(await run_in_threadpool(run, "build_rules_run", data, 1500))


@router.get("/build-rules/{rule_id}")
async def build_rules_get(rule_id: str) -> JSONResponse:
    """One build rule with its last runs and its change history."""
    return await _read("build_rules_get", {"id": rule_id})


@router.put("/build-rules/{rule_id}")
async def build_rules_edit(rule_id: str, request: Request) -> JSONResponse:
    """Change a build rule: title, text, doer, kind, phase, check, autofix, briefBlock, applies, when, note."""
    return await _write("build_rules_edit", request, {"id": rule_id})


@router.post("/build-rules/{rule_id}/toggle")
async def build_rules_toggle(rule_id: str, request: Request) -> JSONResponse:
    """Switch a build rule on or off ({enabled}; none = flip)."""
    return await _write("build_rules_toggle", request, {"id": rule_id})


@router.post("/build-rules/{rule_id}/delete")
async def build_rules_delete(rule_id: str, request: Request) -> JSONResponse:
    """Delete a build rule; the first call answers confirmation_required with a token, the second sends confirm."""
    return await _write("build_rules_delete", request, {"id": rule_id})


# ---------------------------------------------------------------------- the server auto-lander (auto-lander@1)
# deploy/lander/run.mjs runs on the VPS (systemd timer axf-lander, every minute); these routes read its state and
# send it commands through the same CLI the MCP tools (gate-auto-lander_*), `axf gate auto-lander …` and voice use.

# the lander's settings (deploy/lander/lander-core.mjs DEFAULTS; the size cap is sizeCapLines)
AL_SETTINGS = ("enabled", "sizeCapLines", "flakyReruns", "backoffBaseMin", "backoffFactor", "backoffMaxMin", "ciNoneKickMin", "ciTimeoutMin", "fixTimeoutMin", "notifyAfterAttempts", "workflow", "mergeMethod")


def _al_answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def _al_body(request: Request) -> tuple[dict[str, Any], str]:
    body = await _body(request)
    return body, str(body.get("by") or _who(request))[:80]


@router.get("/auto-lander")
async def auto_lander_status() -> JSONResponse:
    """The server auto-lander: service up, current build, queue, per-build state and attempt counts, escalations, settings."""
    ensure_health()
    return _al_answer(await run_in_threadpool(al_run, ["status"]))


@router.get("/auto-lander/builds/{build}")
async def auto_lander_build(build: str) -> JSONResponse:
    """One build in the auto-lander: its record and every attempt (the attempt log)."""
    return _al_answer(await run_in_threadpool(al_run, ["show", build]))


@router.post("/auto-lander/run")
async def auto_lander_run(request: Request) -> JSONResponse:
    """Ask the service for a tick now (it runs within a minute)."""
    _, by = await _al_body(request)
    return _al_answer(await run_in_threadpool(al_run, ["run", "--request", "--by", by]))


@router.post("/auto-lander/retry/{build}")
async def auto_lander_retry(build: str, request: Request) -> JSONResponse:
    """Reset a build's attempts and escalation; the next tick tries again."""
    _, by = await _al_body(request)
    return _al_answer(await run_in_threadpool(al_run, ["retry", build, "--by", by]))


@router.post("/auto-lander/fix/{build}")
async def auto_lander_fix(build: str, request: Request) -> JSONResponse:
    """Reset a build and start a fix session for it on the next tick (the escalation item's Fix)."""
    _, by = await _al_body(request)
    return _al_answer(await run_in_threadpool(al_run, ["fix", build, "--by", by]))


@router.post("/auto-lander/pause")
async def auto_lander_pause(request: Request) -> JSONResponse:
    """Pause the server auto-lander: nothing new is merged, fixed or landed until resumed."""
    _, by = await _al_body(request)
    return _al_answer(await run_in_threadpool(al_run, ["pause", "--by", by]))


@router.post("/auto-lander/resume")
async def auto_lander_resume(request: Request) -> JSONResponse:
    """Resume the server auto-lander."""
    _, by = await _al_body(request)
    return _al_answer(await run_in_threadpool(al_run, ["resume", "--by", by]))


@router.get("/auto-lander/settings")
async def auto_lander_settings_get() -> JSONResponse:
    """The lander's settings: enabled, sizeCapLines (the one-PR size cap), flakyReruns, backoff, CI and fix timeouts, notifyAfterAttempts."""
    return _al_answer(await run_in_threadpool(al_run, ["settings"]))


@router.post("/auto-lander/settings")
async def auto_lander_settings_set(request: Request) -> JSONResponse:
    """Change auto-lander settings: {key: value, …} (or {key, value}); every key is checked before anything is saved."""
    body, by = await _al_body(request)
    pairs = {body["key"]: body.get("value")} if isinstance(body.get("key"), str) else {k: v for k, v in body.items() if k in AL_SETTINGS}
    if not pairs:
        return _al_answer({"ok": False, "code": "invalid", "message": f"send one or more of {', '.join(AL_SETTINGS)}"})
    bad = [k for k in pairs if k not in AL_SETTINGS]
    if bad:
        return _al_answer({"ok": False, "code": "invalid", "message": f"unknown setting {bad[0]} ({', '.join(AL_SETTINGS)})"})
    r: dict[str, Any] = {"ok": True}
    for k, v in pairs.items():
        val = ("on" if v else "off") if isinstance(v, bool) else str(v)
        r = await run_in_threadpool(al_run, ["set", k, val, "--by", by])
        if not r.get("ok"):
            return _al_answer(r)
    return _al_answer(r)


# ---------------------------------------------------------------------- the build cap (build-cap@1, build-cap.mjs)
# Three numbers side by side: the host's hard cap and emergency slots (framework/cli/build-limit.mjs, Brett only) and the
# orchestrator's stepsInParallel (its pipeline settings). The same file answers `axf gate build-cap` and the MCP tools.
CAP_CLI = PLUGIN_DIR / "build-cap.mjs"
LIMIT_CLI = ROOT / "framework" / "cli" / "build-limit.mjs"
CAP_OWNER_KEYS = ("maxBuilds", "emergencySlots")
CAP_KEYS = (*CAP_OWNER_KEYS, "stepsInParallel")
CAP_STATUS = {**STATUS, "forbidden": 403}


def _node(cli: Path, args: list[str], timeout: int = 90) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(cli), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"the build cap could not be read: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        r = json.loads(lines[-1]) if lines else None
    except json.JSONDecodeError:
        r = None
    if not isinstance(r, dict):
        return {"ok": False, "code": "invalid" if p.returncode == 2 else "failed", "message": (p.stderr or p.stdout).strip()[-400:].removeprefix("build-limit: ") or "no answer"}
    return r


def _owner(request: Request) -> bool:
    """Brett's own signed-in session (not the console token, which sessions, MCP and voice use)."""
    user = getattr(request.state, "axf_user", None)
    return bool(user is not None and getattr(user, "admin", False))


def _cap_answer(r: dict[str, Any], request: Request) -> JSONResponse:
    if r.get("ok"):
        r["canEdit"] = _owner(request)
    return JSONResponse(r, status_code=200 if r.get("ok") else CAP_STATUS.get(str(r.get("code")), 500))


# ---------------------------------------------------------------------- model triage (model-triage@1)
# The VPS gate that decides which model every step of every lane runs on. All of it (the rules, the checks on an edit,
# the decisions) is framework/cli/model-triage.mjs; these routes pass the call through and add who asked.
TRIAGE_CLI = ROOT / "framework" / "cli" / "model-triage.mjs"
TRIAGE_OPS = ("rule", "move", "defaults", "enabled", "reset")


def _triage(args: list[str]) -> JSONResponse:
    r = _node(TRIAGE_CLI, args)
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


@router.get("/model-triage")
async def model_triage_get() -> JSONResponse:
    """The model triage gate: its rules in order, the defaults, Brett's approval and build-wide model settings, and the last decisions."""
    return await run_in_threadpool(_triage, ["status"])


@router.post("/model-triage")
async def model_triage_edit(request: Request) -> JSONResponse:
    """One edit to the gate's rules: {op: rule, id, enabled?, model?, lanes?, settings?} | {op: move, id, to} |
    {op: defaults, model?, handRequest?, briefWords?} | {op: enabled, enabled} | {op: reset}. Checked on the VPS; a bad
    value changes nothing. Every change is in the history with who and why."""
    body = await _body(request)
    if body.get("op") not in TRIAGE_OPS:
        return JSONResponse({"ok": False, "code": "invalid", "message": f"op is one of {', '.join(TRIAGE_OPS)}"}, status_code=400)
    by = str(body.pop("by", "") or _who(request))[:80]
    body.pop("confirm", None)
    return await run_in_threadpool(_triage, ["edit", json.dumps(body), "--by", by])


@router.get("/model-triage/decisions")
async def model_triage_decisions(build: str = "", lane: str = "", limit: int = 100) -> JSONResponse:
    """The gate's decisions, newest first: the build and step (or the session), the lane, the model, the rule that fired and why."""
    args = ["decisions", "--limit", str(max(1, min(2000, limit)))]
    if build:
        args += ["--build", build[:120]]
    if lane:
        args += ["--lane", lane[:40]]
    return await run_in_threadpool(_triage, args)


@router.get("/model-triage/history")
async def model_triage_history(limit: int = 100) -> JSONResponse:
    """Every change to the gate's rules, newest first: who, when, what, why."""
    return await run_in_threadpool(_triage, ["history", "--limit", str(max(1, min(2000, limit)))])


@router.post("/model-triage/decide")
async def model_triage_decide(request: Request) -> JSONResponse:
    """What the gate would answer for a piece of work: {text, title?, files?, minutes?, lines?, lane?, kind?, requested?}. Nothing is logged."""
    body = await _body(request)
    args = ["decide"]
    for k in ("text", "title", "lane", "kind", "requested", "current", "suggested", "pin"):
        if isinstance(body.get(k), str) and body[k]:
            args += [f"--{k}", body[k][:20000]]
    for k in ("minutes", "lines", "failures", "dependents"):
        if isinstance(body.get(k), (int, float)) and not isinstance(body.get(k), bool):
            args += [f"--{k}", str(int(body[k]))]
    files = body.get("files")
    if isinstance(files, list) and files:
        args += ["--files", ",".join(str(f)[:300] for f in files[:60])]
    return await run_in_threadpool(_triage, args)


@router.get("/build-cap")
async def build_cap_get(request: Request) -> JSONResponse:
    """The build cap: hard cap, emergency slots and stepsInParallel side by side, what runs now, and the note when they disagree."""
    return _cap_answer(await run_in_threadpool(_node, CAP_CLI, ["status"]), request)


@router.post("/build-cap")
async def build_cap_set(request: Request) -> JSONResponse:
    """Change the build cap: {stepsInParallel?, maxBuilds?, emergencySlots?} (or {key, value}). maxBuilds and
    emergencySlots are Brett's own signed-in console only; every value is checked before anything is saved."""
    body = await _body(request)
    pairs = {body["key"]: body.get("value")} if isinstance(body.get("key"), str) else {k: v for k, v in body.items() if k in CAP_KEYS}
    bad = [k for k in pairs if k not in CAP_KEYS]
    if bad or not pairs:
        return _cap_answer({"ok": False, "code": "invalid", "message": f"unknown setting {bad[0]} ({', '.join(CAP_KEYS)})" if bad else f"send one or more of {', '.join(CAP_KEYS)}"}, request)
    ranges = {"maxBuilds": (1, 64), "emergencySlots": (0, 8), "stepsInParallel": (1, 12)}
    clean: dict[str, int] = {}
    for k, v in pairs.items():
        lo, hi = ranges[k]
        try:
            n = int(str(v).strip())
        except ValueError:
            n = lo - 1
        if isinstance(v, bool) or not lo <= n <= hi:
            return _cap_answer({"ok": False, "code": "invalid", "message": f"{k} is a whole number from {lo} to {hi}"}, request)
        clean[k] = n
    owner_patch = {k: v for k, v in clean.items() if k in CAP_OWNER_KEYS}
    if owner_patch and not _owner(request):
        return _cap_answer({"ok": False, "code": "forbidden", "message": "Only Brett sets Builds at once and the emergency slots, from his own signed-in console (Builds → VPS Configuration → Build cap). Sessions, MCP and voice can read them and set stepsInParallel."}, request)
    if owner_patch:
        user = getattr(request.state, "axf_user", None)
        who = str(getattr(user, "name", "") or getattr(user, "email", "") or "brett")[:60]
        r = await run_in_threadpool(_node, LIMIT_CLI, ["set", "--json", json.dumps(owner_patch), "--from-console", "--by", who])
        if r.get("ok") is False:
            return _cap_answer({"ok": False, "code": r.get("code") or "invalid", "message": str(r.get("message") or r.get("error") or "refused")}, request)
    if "stepsInParallel" in clean:
        r = await run_in_threadpool(_node, CAP_CLI, ["set", "stepsInParallel", str(clean["stepsInParallel"])])
        if not r.get("ok"):
            return _cap_answer(r, request)
    return _cap_answer(await run_in_threadpool(_node, CAP_CLI, ["status"]), request)


# ---------------------------------------------------------------------- approval rules (approval-rules@1, approval-rules.mjs)
# axHub's match-pattern policy rules, read with the hub token. A write here only stages a draft: the console server
# holds a bearer token, and axHub never lets a bearer change policy. Brett's Save goes from his browser to axHub.
APPROVALS_CLI = PLUGIN_DIR / "approval-rules.mjs"
APPROVAL_OPS = ("add", "edit", "remove", "move", "set", "clear-own", "default", "discard")


def _approvals_answer(r: dict[str, Any], request: Request) -> JSONResponse:
    if r.get("ok"):
        r["canSave"] = _owner(request)
    return JSONResponse(r, status_code=200 if r.get("ok") else CAP_STATUS.get(str(r.get("code")), 500))


@router.get("/approval-rules")
async def approval_rules_get(request: Request) -> JSONResponse:
    """Approval rules (approval-rules@1): each axHub service's ordered match-pattern rules (match, decision, hold), what
    each rule decides now, the staged draft, and whether Brett's default (veto only on VPS shell commands) is applied."""
    return _approvals_answer(await run_in_threadpool(_node, APPROVALS_CLI, ["status"]), request)


@router.post("/approval-rules/draft")
async def approval_rules_stage(request: Request) -> JSONResponse:
    """Stage one edit to the approval rules: {op: add|edit|remove|move|set|clear-own|default|discard, service, index (0-based),
    to, rule {match, policy, vetoSeconds}, rules, clearOwn, on}. It lands in a draft and changes nothing on axHub: only
    Brett saves it, from his own signed-in console."""
    body = await _body(request)
    if body.get("op") not in APPROVAL_OPS:
        return _approvals_answer({"ok": False, "code": "invalid", "message": f"say what to do: op is one of {', '.join(APPROVAL_OPS)}"}, request)
    op = {k: body[k] for k in ("op", "service", "index", "to", "rule", "rules", "clearOwn", "on") if k in body}
    user = getattr(request.state, "axf_user", None)
    who = str(body.get("by") or getattr(user, "name", "") or getattr(user, "email", "") or "console")[:60]
    return _approvals_answer(await run_in_threadpool(_node, APPROVALS_CLI, ["stage", "--op", json.dumps(op), "--by", who]), request)


@router.get("/settings")
async def settings_get() -> JSONResponse:
    """The plugin's settings: refreshSec, historySize, defaultTab."""
    return await _read("settings_get", {})


@router.put("/settings")
async def settings_set(request: Request) -> JSONResponse:
    """Change the plugin's settings (refreshSec 5-600, historySize 50-20000, defaultTab rules|build-rules|auto-lander|build-cap|model-triage|approvals|passes|history)."""
    return await _write("settings_set", request)


ensure_health()
