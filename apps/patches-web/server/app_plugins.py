"""Plugins per app (patches-app-plugins@1): which plugin is installed in which app in Patches' tabs, and Apply.

Gizmo, Oct 24 2026: "a plugin for Patches that lists all plugins installed in it and all apps open in the tabs, with a
column for each app and check boxes representing installed or not. An Apply button installs or uninstalls plugins to the
correct app depending on the check boxes." Apply really installs or uninstalls the plugin **in the app itself** (apps in
Patches' tabs run whole, with no embed marker, so Patches' own switches no longer reach them).

Each app is an adapter in an open registry (`ADAPTERS`): it lists what the app has, says which plugins it could take,
and installs / uninstalls one. Built: `console` (the Dev Console's plugin catalog + lifecycle routes, server to server
with its console token). Placeholders that never pretend to work: `pilot` (Build Pilot has no install route Patches can
call yet), `axhub` (axHub has no AXF plugins). No plugin code passes through Patches: the app installs from its catalog.

Env: APP_CONSOLE_URL (default https://console.amberxai.com; https only, http only on loopback), APP_CONSOLE_TOKEN (the
console token; without it the Console column is read-only and says why), APP_CONSOLE_TIMEOUT (seconds, default 20 for
reads; installs get 660).
"""
from __future__ import annotations

import ipaddress
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from typing import Any, Callable

FOLDER = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
PLUGIN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
MAX_BODY = 4 * 1024 * 1024
MAX_CHANGES = 60


def _clip(v: Any, n: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", v).strip()[:n] if isinstance(v, str) else ""


def _model(v: Any) -> str:
    return v if isinstance(v, str) and re.fullmatch(r"[a-z][a-z0-9.-]{0,31}", v) else ""


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    """A token never follows a redirect."""

    def redirect_request(self, *_a: Any, **_k: Any) -> None:  # type: ignore[override]
        return None


_OPENER = urllib.request.build_opener(_NoRedirect)


def safe_base(url: str) -> str:
    """The app's origin, checked: https host only (http only for loopback, local dev and tests); "" when it isn't one."""
    try:
        u = urllib.parse.urlsplit((url or "").strip())
    except ValueError:
        return ""
    host = u.hostname or ""
    if not host or u.username or u.password or (u.path not in ("", "/")) or u.query or u.fragment:
        return ""
    loop = host == "localhost"
    try:
        loop = loop or ipaddress.ip_address(host).is_loopback
    except ValueError:
        pass
    if u.scheme != "https" and not (u.scheme == "http" and loop):
        return ""
    return f"{u.scheme}://{u.netloc}"


class AppError(Exception):
    pass


def call(base: str, token: str, method: str, path: str, body: Any = None, timeout: float = 20) -> Any:
    """One JSON call to an app's API with its token; no redirects, size cap, the app's own error text when it refuses."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(base + path, data=data, method=method)
    req.add_header("authorization", f"Bearer {token}")
    req.add_header("accept", "application/json")
    if data is not None:
        req.add_header("content-type", "application/json")
    try:
        with _OPENER.open(req, timeout=timeout) as r:
            raw = r.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        try:
            detail = json.loads(e.read(65536) or b"{}").get("detail")
        except (ValueError, AttributeError):
            detail = None
        if 300 <= e.code < 400:
            raise AppError("the app answered with a redirect (refused: the token never follows one)") from None
        raise AppError(_clip(detail if isinstance(detail, str) else f"HTTP {e.code}", 300) or f"HTTP {e.code}") from None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise AppError(f"can't reach the app ({_clip(str(getattr(e, 'reason', e)), 160)})") from None
    if len(raw) > MAX_BODY:
        raise AppError("the app's answer is too big")
    try:
        return json.loads(raw or b"null")
    except ValueError:
        raise AppError("the app didn't answer JSON") from None


# ---------------------------------------------------------------- adapters (open registry)

class Adapter:
    """One app Patches can host. `snapshot()` → {reachable, canInstall, reason, installed: {id: plugin}, available: {id: plugin}}."""

    app = ""
    label = ""

    def snapshot(self) -> dict[str, Any]:
        return {"reachable": False, "canInstall": False, "reason": "not built", "installed": {}, "available": {}}

    def install(self, plugin: dict[str, Any]) -> str:
        raise AppError(f"{self.label} can't install plugins from Patches")

    def uninstall(self, plugin: dict[str, Any]) -> str:
        raise AppError(f"{self.label} can't uninstall plugins from Patches")


def _plugin(p: dict[str, Any], *, model: Any = None) -> dict[str, Any] | None:
    pid, folder = p.get("id"), p.get("folder")
    if not isinstance(pid, str) or not PLUGIN_ID.match(pid) or not isinstance(folder, str) or not FOLDER.match(folder):
        return None
    bw = p.get("builtWith") if isinstance(p.get("builtWith"), dict) else {}
    return {"id": pid, "folder": folder, "name": _clip(p.get("name"), 80) or pid, "version": _clip(p.get("version"), 40), "model": _model(model if model is not None else bw.get("model"))}


class ConsoleAdapter(Adapter):
    """The Dev Console: lists `/api/plugins` + its plugin catalog (console kind), installs from the catalog
    (`/api/plugin-catalog/install`, committed to GitHub so the 5-minute update keeps it) and uninstalls the code
    (`/api/plugin-lifecycle/<folder>/uninstall` with `code` + `publish`; its data is backed up and kept)."""

    app = "console"
    label = "Console"

    def __init__(self, env: Callable[[str, str], str] = lambda k, d: os.environ.get(k, d)) -> None:
        self.env = env

    def _conn(self) -> tuple[str, str, float]:
        base = safe_base(self.env("APP_CONSOLE_URL", "https://console.amberxai.com"))
        tok = self.env("APP_CONSOLE_TOKEN", "").strip()
        try:
            t = max(2.0, min(120.0, float(self.env("APP_CONSOLE_TIMEOUT", "20"))))
        except ValueError:
            t = 20.0
        return base, tok, t

    def snapshot(self) -> dict[str, Any]:
        base, tok, t = self._conn()
        out: dict[str, Any] = {"reachable": False, "canInstall": False, "reason": "", "installed": {}, "available": {}}
        if not base:
            out["reason"] = "APP_CONSOLE_URL isn't an https address"
            return out
        if not tok:
            out["reason"] = "Patches has no console token (APP_CONSOLE_TOKEN), so it can't read or change the Console's plugins"
            return out
        try:
            got = call(base, tok, "GET", "/api/plugins", timeout=t)
        except AppError as e:
            out["reason"] = str(e)
            return out
        for p in (got or {}).get("items", []) if isinstance(got, dict) else []:
            if isinstance(p, dict) and not p.get("removed"):
                c = _plugin(p)
                if c:
                    out["installed"][c["id"]] = {**c, "enabled": p.get("enabled") is True}
        out["reachable"] = True
        try:
            cat = call(base, tok, "GET", "/api/plugin-catalog?kind=console", timeout=t)
        except AppError as e:
            out["reason"] = f"the plugin catalog can't be read ({e}): installing is off, uninstalling still works"
            return out
        for it in (cat or {}).get("items", []) if isinstance(cat, dict) else []:
            if isinstance(it, dict) and it.get("kind") == "console" and not it.get("clash"):
                ms = it.get("models") if isinstance(it.get("models"), list) else []
                c = _plugin(it, model=(it.get("builtWith") or {}).get("model") if isinstance(it.get("builtWith"), dict) else (ms[0] if ms else ""))
                if c:
                    out["available"][c["id"]] = c
        out["canInstall"] = True
        return out

    def install(self, plugin: dict[str, Any]) -> str:
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no console address or token")
        r = call(base, tok, "POST", "/api/plugin-catalog/install", {"folder": plugin["folder"], "confirm": plugin["folder"]}, timeout=660)
        return _clip((r or {}).get("note") if isinstance(r, dict) else "", 300) or "installed"

    def uninstall(self, plugin: dict[str, Any]) -> str:
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no console address or token")
        f = plugin["folder"]
        r = call(base, tok, "POST", f"/api/plugin-lifecycle/{f}/uninstall", {"confirm": f, "code": True, "publish": True}, timeout=660)
        pushed = bool(((r or {}).get("published") or {}).get("pushed")) if isinstance(r, dict) else False
        return "removed; committed to GitHub, so the Console rebuilds without it within about 5 minutes" if pushed else "removed from the Console (its data is backed up)"


class PlaceholderAdapter(Adapter):
    """An app Patches can't install into (yet). It says so; it never pretends to work."""

    def __init__(self, app: str, label: str, reason: str) -> None:
        self.app, self.label, self.reason = app, label, reason

    def snapshot(self) -> dict[str, Any]:
        return {"reachable": False, "canInstall": False, "reason": self.reason, "installed": {}, "available": {}}


ADAPTERS: dict[str, Adapter] = {
    "console": ConsoleAdapter(),
    "pilot": PlaceholderAdapter("pilot", "Pilot", "Build Pilot has no install route Patches can call yet (placeholder patches.app-plugins.pilot)"),
    "axhub": PlaceholderAdapter("axhub", "axHub", "axHub has no AXF plugins"),
}


def register(adapter: Adapter) -> None:
    """Add or replace an app's adapter (a later build gives Pilot a real one)."""
    ADAPTERS[adapter.app] = adapter


# ---------------------------------------------------------------- the grid

def grid(apps: list[str], patches_list: dict[str, Any]) -> dict[str, Any]:
    """Columns = the apps in the tabs (in tab order); rows = every plugin Patches knows (its own list per app, each app's
    installed plugins, each app's catalog); a cell = installed or not, and whether Apply may change it."""
    cols: list[dict[str, Any]] = []
    snaps: dict[str, dict[str, Any]] = {}
    for a in apps:
        ad = ADAPTERS.get(a)
        if not ad or a in snaps:
            continue
        s = ad.snapshot()
        snaps[a] = s
        cols.append({"app": a, "label": ad.label, "reachable": s["reachable"], "canInstall": s["canInstall"], "reason": s["reason"]})
    rows: dict[str, dict[str, Any]] = {}

    def add(p: dict[str, Any], source: str) -> None:
        r = rows.setdefault(p["id"], {"id": p["id"], "folder": p.get("folder", ""), "name": p.get("name") or p["id"], "version": p.get("version", ""), "model": p.get("model", ""), "sources": []})
        for k in ("folder", "version", "model"):
            if not r[k] and p.get(k):
                r[k] = p[k]
        if source not in r["sources"]:
            r["sources"].append(source)

    for a, got in ((patches_list or {}).get("apps") or {}).items():
        for pid, p in ((got or {}).get("plugins") or {}).items():
            if PLUGIN_ID.match(str(pid)) and isinstance(p, dict):
                add({"id": pid, "name": p.get("name"), "version": p.get("version"), "model": p.get("model")}, "patches")
    for a, s in snaps.items():
        for p in s["installed"].values():
            add(p, f"installed:{a}")
        for p in s["available"].values():
            add(p, "catalog")
    out_rows = []
    for r in sorted(rows.values(), key=lambda x: (x["name"].lower(), x["id"])):
        cells = {}
        for col in cols:
            a, s = col["app"], snaps[col["app"]]
            have = r["id"] in s["installed"]
            if not s["reachable"]:
                cells[a] = {"installed": None, "canChange": False, "why": s["reason"]}
            elif have:
                cells[a] = {"installed": True, "canChange": True, "why": ""}
            elif r["id"] in s["available"]:
                cells[a] = {"installed": False, "canChange": s["canInstall"], "why": "" if s["canInstall"] else s["reason"]}
            else:
                cells[a] = {"installed": False, "canChange": False, "why": f"not in {col['label']}'s plugin catalog"}
        out_rows.append({**r, "cells": cells})
    return {"$axf": "patches-app-plugins@1", "apps": cols, "plugins": out_rows, "at": _now(), "_snaps": snaps}


# ---------------------------------------------------------------- Apply (one job at a time, in the background)

_job_lock = threading.Lock()
_job: dict[str, Any] | None = None


def job() -> dict[str, Any] | None:
    with _job_lock:
        return json.loads(json.dumps(_job)) if _job else None


def plan(changes: Any, g: dict[str, Any]) -> list[dict[str, Any]]:
    """The checked list of changes Apply runs: each one a real difference the grid allows, else refused (not dropped)."""
    if not isinstance(changes, list) or not changes or len(changes) > MAX_CHANGES:
        raise ValueError(f"changes must be a list of 1 to {MAX_CHANGES}")
    rows = {r["id"]: r for r in g["plugins"]}
    out, seen = [], set()
    for c in changes:
        if not isinstance(c, dict):
            raise ValueError("each change is {app, id, install}")
        a, pid, inst = c.get("app"), c.get("id"), c.get("install")
        if not isinstance(inst, bool) or not isinstance(pid, str) or pid not in rows or a not in rows[pid]["cells"]:
            raise ValueError(f"{pid!r} in {a!r} isn't a cell of the grid")
        if (a, pid) in seen:
            raise ValueError(f"{pid} in {a} is listed twice")
        seen.add((a, pid))
        cell = rows[pid]["cells"][a]
        if not cell["canChange"]:
            raise ValueError(f"{rows[pid]['name']} in {a} can't be changed: {cell['why']}")
        if cell["installed"] is inst:
            continue  # already that way
        snap = g["_snaps"][a]
        p = snap["installed"].get(pid) or snap["available"].get(pid)
        if not p:
            raise ValueError(f"{pid} isn't known to {a}")
        out.append({"app": a, "id": pid, "folder": p["folder"], "name": p["name"], "install": inst, "state": "queued", "note": ""})
    return out


def start(items: list[str] | list[dict[str, Any]], by: str, on_done: Callable[[dict[str, Any]], None]) -> dict[str, Any]:
    """Run the changes one by one in a thread; a failed one is noted and the rest still run."""
    global _job
    with _job_lock:
        if _job and _job["state"] == "running":
            raise RuntimeError("an Apply is already running")
        _job = {"id": f"apply-{int(time.time() * 1000)}", "state": "running", "by": _clip(by, 80), "startedAt": _now(), "finishedAt": "", "items": items}
        snapshot = json.loads(json.dumps(_job))

    def run() -> None:
        global _job
        for i, it in enumerate(items):
            with _job_lock:
                _job["items"][i]["state"] = "running"  # type: ignore[index]
            ad = ADAPTERS.get(it["app"])
            try:
                note = (ad.install if it["install"] else ad.uninstall)(it) if ad else "no adapter"
                state = "done"
            except AppError as e:
                note, state = str(e), "failed"
            except Exception as e:  # noqa: BLE001 — one change failing never stops the rest
                note, state = f"{type(e).__name__}: {_clip(str(e), 200)}", "failed"
            with _job_lock:
                _job["items"][i].update(state=state, note=note)  # type: ignore[index]
            if state == "done":
                try:
                    on_done(it)
                except Exception:  # noqa: BLE001
                    pass
        with _job_lock:
            _job["state"] = "done" if all(x["state"] == "done" for x in _job["items"]) else "partial"  # type: ignore[index]
            _job["finishedAt"] = _now()  # type: ignore[index]

    threading.Thread(target=run, name="patches-apply", daemon=True).start()
    return snapshot


def wait(timeout: float = 10) -> dict[str, Any] | None:
    """Tests: wait for the running Apply to finish."""
    end = time.time() + timeout
    while time.time() < end:
        j = job()
        if not j or j["state"] != "running":
            return j
        time.sleep(0.02)
    return job()
