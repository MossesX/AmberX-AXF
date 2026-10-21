"""Coolify app checks (Oct 21 2026): each app's environment variables, read through the Coolify API.

What each app needs is data (``coolify-expect.json``, coolify-expect@1; an override in the plugin's data folder wins),
so a new app or variable is one entry, no code. A wrong or missing variable makes the app's check a warning whose fix
is a ``coolify`` fix plan (fixplan.py): Auto fix runs ``deploy/coolify-fix.py`` on the VPS through axHub, approved
by Brett, then redeploys the app. Secret values are never read into a report, compared in the clear, or put in a
command: ``sameAs`` rules compare digests, and their fix reads the value on the VPS (``env-from``).
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import re
import time
from pathlib import Path
from typing import Any, Callable

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http

from . import store
from .checks import COOLIFY_INTERNAL_HOSTS

HERE = Path(__file__).resolve().parent
Check = dict[str, Any]
# Where the console finds each secret a sameAs rule compares against (the console's own copy).
SECRET_ENV = {"console-wall-secret": "AXF_WALL_SECRET"}
_cache: tuple[float, list[dict[str, Any]]] | None = None


def expectations() -> list[dict[str, Any]]:
    for p in (store.data_dir() / "coolify-expect.json", HERE / "coolify-expect.json"):
        try:
            raw = json.loads(p.read_text("utf-8"))
        except (OSError, ValueError):
            continue
        apps = raw.get("apps") if isinstance(raw, dict) else None
        if isinstance(apps, list):
            return [a for a in apps if isinstance(a, dict) and re.match(r"^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$", str(a.get("name", "")))]
    return []


def _api(path: str) -> Any:
    url = os.environ.get("COOLIFY_URL", "").rstrip("/")
    tok = os.environ.get("COOLIFY_TOKEN", "")
    if not url or not tok or not axf_http.target_ok(url, COOLIFY_INTERNAL_HOSTS):
        raise LookupError("no usable Coolify connection (see the Coolify API check)")
    r = axf_http.request("GET", f"{url}/api/v1{path}", headers={"authorization": f"Bearer {tok}", "accept": "application/json", "user-agent": "axf-console-syscheck"},
                         timeout=10, max_bytes=2_000_000)
    if not r.ok:
        raise LookupError(f"Coolify answered {r.status} for {path.split('?')[0]}")
    return json.loads(r.text() or "null")


def _resources() -> list[dict[str, Any]]:
    """Applications and services, cached 60 s: [{uuid, name, kind}]."""
    global _cache
    if _cache and time.time() - _cache[0] < 60:
        return _cache[1]
    out: list[dict[str, Any]] = []
    for kind, path in (("application", "/applications"), ("service", "/services")):
        try:
            rows = _api(path)
        except LookupError:
            if kind == "application":
                raise
            continue
        for r in rows if isinstance(rows, list) else []:
            if isinstance(r, dict) and r.get("uuid"):
                out.append({"uuid": str(r["uuid"]), "name": str(r.get("name") or ""), "kind": kind})
    _cache = (time.time(), out)
    return out


def find(app: dict[str, Any], resources: list[dict[str, Any]]) -> dict[str, Any] | None:
    name = str(app["name"]).lower()
    exact = [r for r in resources if r["name"].lower() == name]
    if exact:
        return exact[0]
    keys = [str(m).lower() for m in app.get("match", [])] or [name]
    hits = [r for r in resources if any(k in r["name"].lower() for k in keys)]
    return hits[0] if len(hits) == 1 else None


def _items(v: str) -> tuple[list[str], str]:
    sep = "," if "," in v or " " not in v.strip() else " "
    return [x.strip() for x in re.split(r"[,\s]+", v) if x.strip()], sep


def _digest(v: str) -> bytes:
    return hashlib.sha256(v.encode()).digest()


def evaluate(app: dict[str, Any], env: dict[str, str]) -> tuple[list[str], list[dict[str, Any]], list[str]]:
    """(problems, fix ops, notes) for one app's variables. Pure: tests call it with plain dicts."""
    problems: list[str] = []
    ops: list[dict[str, Any]] = []
    notes: list[str] = []
    for rule in app.get("env", []):
        key = str(rule.get("key", ""))
        if not re.match(r"^[A-Z_][A-Z0-9_]{0,127}$", key):
            continue
        cur = env.get(key)
        if "equals" in rule:
            want = str(rule["equals"])
            if cur != want:
                problems.append(f"{key} is {'missing' if cur is None else 'wrong'} (should be {want})")
                ops.append({"action": "env-set", "key": key, "value": want})
        elif "includes" in rule:
            want = [str(x) for x in rule["includes"]]
            have, sep = _items(cur or "")
            miss = [w for w in want if w not in have]
            if miss:
                problems.append(f"{key} {'is missing' if cur is None else 'lacks ' + ', '.join(miss)}")
                ops.append({"action": "env-set", "key": key, "value": (sep if sep == "," else " ").join([*have, *miss])})
        elif "sameAs" in rule:
            src = str(rule["sameAs"])
            mine = os.environ.get(SECRET_ENV.get(src, ""), "")
            if not mine:
                notes.append(f"{key}: skipped (the console has no {src})")
                continue
            if cur is None or not hmac.compare_digest(_digest(cur), _digest(mine)):
                problems.append(f"{key} is {'missing' if cur is None else 'different from the console'} (value not shown)")
                ops.append({"action": "env-from", "key": key, "source": src})
    return problems, ops, notes


def _env(res: dict[str, Any]) -> dict[str, str]:
    rows = _api(f"/{'applications' if res['kind'] == 'application' else 'services'}/{res['uuid']}/envs")
    out: dict[str, str] = {}
    for r in rows if isinstance(rows, list) else []:
        if isinstance(r, dict) and r.get("key") and not r.get("is_preview"):
            out[str(r["key"])] = "" if r.get("value") is None else str(r["value"])
    return out


def checks(item: Callable[..., Check]) -> list[Check]:
    apps = expectations()
    if not apps or not (os.environ.get("COOLIFY_URL") and os.environ.get("COOLIFY_TOKEN")):
        return []  # the Coolify API check already says what's missing
    try:
        res = _resources()
    except (LookupError, axf_http.HttpError, ValueError) as e:
        return [item("coolify-apps", "coolify", "Coolify apps", "unknown", f"couldn't list the apps: {str(e)[:160]}", depends=["coolify"], order=51)]
    out: list[Check] = []
    for app in apps:
        cid = f"coolify-app:{app['name'].lower()}"
        title = f"Coolify: {app['name']} settings"
        svc = app.get("service") if app.get("service") in store.SERVICE_IDS else "coolify"
        hit = find(app, res)
        if not hit:
            out.append(item(cid, svc, title, "warn", f"No Coolify app named {app['name']} (or more than one match).",
                            instructions=[f"Name the app {app['name']} in Coolify, or edit coolify-expect.json."], depends=["coolify"], order=52))
            continue
        try:
            env = _env(hit)
        except (LookupError, axf_http.HttpError, ValueError) as e:
            out.append(item(cid, svc, title, "unknown", f"couldn't read its variables: {str(e)[:160]}", depends=["coolify"], order=52))
            continue
        problems, ops, notes = evaluate(app, env)
        why = [f"{r['key']}: {r['why']}" for r in app.get("env", []) if r.get("why") and any(r["key"] in p for p in problems)]
        if not problems:
            out.append(item(cid, svc, title, "ok", f"All {len(app.get('env', []))} required variables are set.", details=notes, depends=["coolify"], order=52))
            continue
        then = app.get("then") if app.get("then") in ("deploy", "restart", "none") else "deploy"
        out.append(item(cid, svc, title, "warn", f"{len(problems)} variable(s) to fix on {hit['name']}.", details=[*problems, *why, *notes],
                        fix={"type": "coolify", "app": hit["uuid"], "appKind": hit["kind"], "appName": hit["name"], "ops": ops, "then": then},
                        instructions=[f"Coolify → {hit['name']} → Environment Variables: fix the ones listed, then Redeploy.",
                                      "Or Auto fix: it sets them through the Coolify API on the VPS (you approve the command) and redeploys."],
                        depends=["coolify"], order=52))
    return out
