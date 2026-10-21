"""Auto fix plans: every issue a terminal can fix gets a fix (Brett, Oct 21 2026).

"Auto fix is supposed to fix everything": any check whose fix is a command — on the VPS host, inside a container,
or a Coolify API change — is fixed through axHub's ``vps.run``. Brett approves **every** command on the hub (the
approval page shows the exact text), then the job runs it and re-checks. Only things that need him in person stay
manual (sign-ins, the Moshi key's fingerprint, keeping a new console token).

A plan is always built here, on the server, from the check report: never from text a browser sent. Fix kinds are an
open registry (``KINDS``): add a kind = one builder. Built in:

  host       {"type": "host", "command": "<shell>"}                       runs on the VPS as root
  container  {"type": "container", "container": "<name>", "command": "<shell>"} | {..., "restart": true}
             → docker exec <name> sh -lc '<shell>'  /  docker restart <name>
  coolify    {"type": "coolify", "app": "<uuid or name>", "appKind"?: "service", "ops": [<op>…], "then": "deploy|restart|none"}
             → python3 /opt/axf/deploy/coolify-fix.py --app <uuid> [--service] <op>… [deploy|restart]
             ops: {"action": "env-set", "key", "value"}   value is plain text shown in the approval (never a secret)
                  {"action": "env-from", "key", "source"} value read on the VPS from a fixed source (SECRET_SOURCES)
                  {"action": "env-unset", "key"}

Checks get a plan from, in order: the host table (``hostfix.FIX_COMMANDS``, non-interactive commands for the doctor's
checks), else the check's own ``fix`` when it is one of the kinds above. Interactive commands (the doctor's ``--fix``
mode asks on a terminal) are never planned; they keep "Copy fix". Checks Mosses wrote (``routine:*``) may carry a
command too: it's marked ``source: ai`` and approved like every other one.
"""
from __future__ import annotations

import re
import shlex
from typing import Any, Callable

from . import hostfix

FIXCLI = "python3 /opt/axf/deploy/coolify-fix.py"
NAME_RE = re.compile(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$")
ENV_RE = re.compile(r"^[A-Z_][A-Z0-9_]{0,127}$")
# Plain values travel in the approval text and the hub log: no quotes, no shell metacharacters, nothing secret-sized.
VALUE_RE = re.compile(r"^[A-Za-z0-9 ._,:/@+=-]{0,300}$")
# Values read on the VPS itself, so they never appear in a command, an approval or a log (coolify-fix.py has the paths).
SECRET_SOURCES = ("console-wall-secret",)
# Containers Auto fix never runs commands inside (restart is still allowed, approved like everything else).
NO_EXEC = re.compile(r"^(coolify(-db|-redis|-realtime)?|postgres.*|mysql.*|mariadb.*|redis.*|mongo.*)$")
MAX_CMD = 2000

# Checks that need Brett in person, with the reason shown instead of Auto fix.
MANUAL: dict[str, str] = {
    "host-claude-login": "Signing in to Claude needs you: run claude, then /login.",
    "host-git-auth": "GitHub sign-in on the VPS needs you (gh auth login, or a token in git's credential helper).",
    "moshi-key": "Adding Moshi's key needs you to confirm its fingerprint on the VPS.",
    "host-moshi-key": "Adding Moshi's key needs you to confirm its fingerprint on the VPS.",
    "console-token": "A new console token has to be kept by you: reset it in Settings → Account & security.",
    "host-axhub-volume": "Coolify's API can't add a volume: add axhub-projects at /projects in Coolify → axHub → Persistent Storage.",
}
INTERACTIVE = re.compile(r"console-doctor\.sh\s+--fix\b|\bread\s+-r?p?\b|/dev/tty")


class PlanError(ValueError):
    pass


def _host(f: dict[str, Any]) -> str:
    cmd = str(f.get("command") or "").strip()
    if not cmd or INTERACTIVE.search(cmd):
        raise PlanError("interactive")
    return cmd


def _container(f: dict[str, Any]) -> str:
    name = str(f.get("container") or "")
    if not NAME_RE.match(name):
        raise PlanError("container name")
    if f.get("restart"):
        return f"docker restart {name}"
    if NO_EXEC.match(name):
        raise PlanError("protected container")
    cmd = str(f.get("command") or "").strip()
    if not cmd:
        raise PlanError("no command")
    return f"docker exec {name} sh -lc {shlex.quote(cmd)}"


def _coolify(f: dict[str, Any]) -> str:
    app = str(f.get("app") or "")
    if not NAME_RE.match(app):
        raise PlanError("app name")
    parts = [FIXCLI, "--app", shlex.quote(app)]
    if f.get("appKind") == "service":
        parts.append("--service")
    ops = f.get("ops") if isinstance(f.get("ops"), list) else []
    if not ops or len(ops) > 20:
        raise PlanError("ops")
    for op in ops:
        a, key = op.get("action"), str(op.get("key") or "")
        if not ENV_RE.match(key):
            raise PlanError("env key")
        if a == "env-set":
            val = str(op.get("value") if op.get("value") is not None else "")
            if not VALUE_RE.match(val):
                raise PlanError("value must be plain text (use env-from for secrets)")
            parts += ["env-set", shlex.quote(f"{key}={val}")]
        elif a == "env-from":
            src = str(op.get("source") or "")
            if src not in SECRET_SOURCES:
                raise PlanError("unknown secret source")
            parts += ["env-from", f"{key}={src}"]
        elif a == "env-unset":
            parts += ["env-unset", key]
        else:
            raise PlanError(f"unknown op {a!r}")
    then = f.get("then", "deploy")
    if then not in ("deploy", "restart", "none"):
        raise PlanError("then")
    if then != "none":
        parts.append(then)
    return " ".join(parts)


KINDS: dict[str, Callable[[dict[str, Any]], str]] = {"host": _host, "container": _container, "coolify": _coolify}


def register_kind(kind: str, build: Callable[[dict[str, Any]], str]) -> None:
    """Add a fix kind (e.g. a remote machine, a Kubernetes cluster): ``build(fix) -> command`` or raise PlanError."""
    KINDS[kind] = build


def plan(check: dict[str, Any]) -> dict[str, Any] | None:
    """{kind, command, source} for a check Auto fix can run, else None."""
    cid = str(check.get("id") or "")
    if cid in MANUAL:
        return None
    if cid in hostfix.FIX_COMMANDS:
        return {"kind": "host", "command": hostfix.command(cid), "source": "table"}
    f = check.get("fix") if isinstance(check.get("fix"), dict) else None
    kind = (f or {}).get("kind") or (f or {}).get("type")
    if not f or kind not in KINDS:
        return None
    try:
        cmd = KINDS[kind](f)
    except PlanError:
        return None
    if len(cmd) > MAX_CMD:
        return None
    return {"kind": kind, "command": hostfix.with_report(cmd), "source": "ai" if cid.startswith("routine:") else "check"}


def annotate(items: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    """Add the plan to every check that has one, as a ``host``-type fix the banner already knows (``kind`` says which
    terminal; ``command`` is exactly what the approval will show). Credential/settings/server fixes are left alone.
    Returns {check id: plan}."""
    plans: dict[str, dict[str, Any]] = {}
    for c in items:
        f = c.get("fix") if isinstance(c.get("fix"), dict) else None
        if f and f.get("type") in ("secrets", "settings", "action"):
            continue
        p = plan(c)
        if p:
            plans[c["id"]] = {**p, "status": c.get("status")}
            c["fix"] = {**(f or {}), "type": "host", "kind": p["kind"], "command": p["command"], "auto": True, "source": p["source"]}
        elif c.get("id") in MANUAL and c.get("status") in ("error", "warn"):
            c["manual"] = MANUAL[c["id"]]
    return plans
