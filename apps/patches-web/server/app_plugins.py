"""Plugins per app (patches-app-plugins@1): which plugin is installed in which app in Patches' tabs, and Apply.

Gizmo, Oct 24 2026: "a plugin for Patches that lists all plugins installed in it and all apps open in the tabs, with a
column for each app and check boxes representing installed or not. An Apply button installs or uninstalls plugins to the
correct app depending on the check boxes." Apply really installs or uninstalls the plugin **in the app itself** (apps in
Patches' tabs run whole, with no embed marker, so Patches' own switches no longer reach them).

Each app is an adapter in an open registry (`ADAPTERS`): it lists what the app has, says which plugins it could take,
and installs / uninstalls one. Built: `console` (the Dev Console's plugin catalog + lifecycle routes, server to server
with its console token), `pilot` (Build Pilot's own plugin-catalog install / uninstall routes with its BP_TOKEN; plugins
bundled with Build Pilot can't be uninstalled, so their box switches them on / off in Pilot instead) and `axhub` (axHub web plugins, catalog kind
`axhub`: the Dev Console installs them into `apps/axhub-web/src/plugins/` and commits them, and axhub-web's 5-minute
update rebuilds with them; the hub's server never runs plugin code). No plugin code passes through Patches: each app
installs from the plugin catalog itself. Gizmo, Oct 25 2026: both columns editable.

Env: APP_CONSOLE_URL (default https://console.amberxai.com; https only, http only on loopback), APP_CONSOLE_TOKEN (the
console token; without it the Console and axHub columns are read-only and say why), APP_CONSOLE_TIMEOUT (seconds,
default 20 for reads; installs get 660), APP_PILOT_URL (default https://pilot.amberxai.com), APP_PILOT_TOKEN (Build
Pilot's BP_TOKEN; without it the Pilot column is read-only), APP_GITHUB_TOKEN (Contents: write on Build-Pilot; only for
deleting a bundled Pilot plugin's code), APP_PILOT_REPO (default MossesX/Build-Pilot), APP_PILOT_BRANCH (default main).
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
    """One app Patches can host. `snapshot()` → {reachable, canInstall, reason, installed: {id: plugin}, available: {id: plugin},
    locked?: {id: why}, switches?: {id: note}} (a locked plugin's box can't be changed; a switch plugin's box means on / off
    in the app rather than installed, e.g. one bundled with the app: Apply switches it instead of uninstalling it)."""

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


def _conn(env: Callable[[str, str], str], prefix: str, default_url: str) -> tuple[str, str, float]:
    base = safe_base(env(f"{prefix}_URL", default_url))
    tok = env(f"{prefix}_TOKEN", "").strip()
    try:
        t = max(2.0, min(120.0, float(env(f"{prefix}_TIMEOUT", "20"))))
    except ValueError:
        t = 20.0
    return base, tok, t


def _env(k: str, d: str) -> str:
    return os.environ.get(k, d)


class ConsoleAdapter(Adapter):
    """The Dev Console: lists `/api/plugins` + its plugin catalog (console kind), installs from the catalog
    (`/api/plugin-catalog/install`, committed to GitHub so the 5-minute update keeps it) and uninstalls the code
    (`/api/plugin-lifecycle/<folder>/uninstall` with `code` + `publish`; its data is backed up and kept)."""

    app = "console"
    label = "Console"

    def __init__(self, env: Callable[[str, str], str] = _env) -> None:
        self.env = env

    def _conn(self) -> tuple[str, str, float]:
        return _conn(self.env, "APP_CONSOLE", "https://console.amberxai.com")

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


class PilotAdapter(Adapter):
    """Build Pilot: `GET /api/plugin-catalog` lists its installed catalog plugins, its bundled ones and the pilot-kind
    catalog; `POST /api/plugin-catalog/install|uninstall {folder, confirm}` change it, and its host rebuilds within a
    minute. Bundled plugins are part of Build Pilot's image and can't be uninstalled: their box is Pilot's own on / off
    switch (`GET /api/plugin-state`, `POST /api/plugin-state/<id> {enabled}`; no entry = on, Pilot's default)."""

    app = "pilot"
    label = "Pilot"

    def __init__(self, env: Callable[[str, str], str] = _env) -> None:
        self.env = env

    def _conn(self) -> tuple[str, str, float]:
        return _conn(self.env, "APP_PILOT", "https://pilot.amberxai.com")

    def snapshot(self) -> dict[str, Any]:
        base, tok, t = self._conn()
        out: dict[str, Any] = {"reachable": False, "canInstall": False, "reason": "", "installed": {}, "available": {}, "switches": {}, "off": set()}
        if not base:
            out["reason"] = "APP_PILOT_URL isn't an https address"
            return out
        if not tok:
            out["reason"] = "Patches has no Build Pilot token (APP_PILOT_TOKEN), so it can't read or change Pilot's plugins"
            return out
        try:
            got = call(base, tok, "GET", "/api/plugin-catalog", timeout=t)
        except AppError as e:
            out["reason"] = str(e)
            return out
        if not isinstance(got, dict):
            out["reason"] = "Build Pilot's answer isn't a plugin list"
            return out
        out["reachable"] = True
        for folder, p in (got.get("installed") or {}).items() if isinstance(got.get("installed"), dict) else []:
            c = _plugin({**p, "folder": folder}) if isinstance(p, dict) else None
            if c:
                out["installed"][c["id"]] = c
        try:
            st = call(base, tok, "GET", "/api/plugin-state", timeout=t)
            on = st.get("enabled") if isinstance(st, dict) and isinstance(st.get("enabled"), dict) else {}
        except AppError:
            on = None
        for folder, pid in (got.get("bundled") or {}).items() if isinstance(got.get("bundled"), dict) else []:
            c = _plugin({"id": pid, "folder": folder})
            if c and c["id"] not in out["installed"]:
                if on is None:
                    out["installed"][c["id"]] = c
                    out.setdefault("locked", {})[c["id"]] = "bundled with Build Pilot; its on / off state can't be read right now"
                    continue
                out["switches"][c["id"]] = "bundled with Build Pilot: this box switches it on or off there (it can't be uninstalled)"
                if on.get(c["id"]) is False:
                    out["off"].add(c["id"])
                    out["available"][c["id"]] = c
                else:
                    out["installed"][c["id"]] = c
        for it in got.get("items") or [] if isinstance(got.get("items"), list) else []:
            if isinstance(it, dict):
                c = _plugin(it)
                if c:
                    out["available"][c["id"]] = c
        err = _clip(got.get("error"), 200)
        if err or not got.get("reachable"):
            out["reason"] = f"Build Pilot can't read the plugin catalog ({err or 'not reachable'}): installing is off, uninstalling still works"
            return out
        out["canInstall"] = True
        return out

    def _switch(self, plugin: dict[str, Any], on: bool) -> str:
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no Build Pilot address or token")
        call(base, tok, "POST", f"/api/plugin-state/{urllib.parse.quote(plugin['id'], safe='')}", {"enabled": on}, timeout=30)
        return "switched on in Build Pilot" if on else "switched off in Build Pilot (bundled, so it stays installed)"

    def install(self, plugin: dict[str, Any]) -> str:
        if plugin.get("switch"):
            return self._switch(plugin, True)
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no Build Pilot address or token")
        call(base, tok, "POST", "/api/plugin-catalog/install", {"folder": plugin["folder"], "confirm": plugin["folder"]}, timeout=120)
        return "installed; Build Pilot rebuilds with it within about a minute"

    def uninstall(self, plugin: dict[str, Any]) -> str:
        if plugin.get("switch"):
            return self._switch(plugin, False)
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no Build Pilot address or token")
        call(base, tok, "POST", "/api/plugin-catalog/uninstall", {"folder": plugin["folder"], "confirm": plugin["folder"]}, timeout=120)
        return "removed; Build Pilot rebuilds without it within about a minute"


    def delete(self, plugin: dict[str, Any]) -> str:
        """Full uninstall of a bundled plugin (Gizmo, Oct 25 2026): its folder is deleted from the Build-Pilot repo in one
        commit; Pilot's 5-minute update rebuilds without it. Only a bundled folder Pilot itself listed."""
        tok = self.env("APP_GITHUB_TOKEN", "").strip()
        if not tok:
            raise AppError("Patches has no GitHub token (APP_GITHUB_TOKEN with Contents: write on Build-Pilot)")
        folder = plugin["folder"]
        if not FOLDER.match(folder) or folder.startswith("_"):
            raise AppError("bad plugin folder")
        repo = self.env("APP_PILOT_REPO", "MossesX/Build-Pilot")
        sha = delete_repo_folder(tok, repo, self.env("APP_PILOT_BRANCH", "main"), f"plugins/{folder}",
                                 f"Uninstall bundled plugin {plugin['name']} ({folder}) from Patches → Plugins per app")
        return f"deleted from {repo} ({sha[:7]}); Build Pilot rebuilds without it within about 5 minutes"


# ---------------------------------------------------------------- deleting a bundled Pilot plugin's code (GitHub)

GITHUB_API = "https://api.github.com"
_REPO = re.compile(r"^[A-Za-z0-9-]{1,39}/[A-Za-z0-9._-]{1,100}$")
_BRANCH = re.compile(r"^[A-Za-z0-9._/-]{1,100}$")


def _gh(token: str, method: str, path: str, body: Any = None) -> Any:
    """One GitHub REST call: the token only ever goes to api.github.com, never follows a redirect."""
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(GITHUB_API + path, data=data, method=method)
    req.add_header("authorization", f"Bearer {token}")
    req.add_header("accept", "application/vnd.github+json")
    req.add_header("x-github-api-version", "2022-11-28")
    req.add_header("user-agent", "patches-web")
    if data is not None:
        req.add_header("content-type", "application/json")
    try:
        with _OPENER.open(req, timeout=30) as r:
            raw = r.read(MAX_BODY + 1)
    except urllib.error.HTTPError as e:
        try:
            msg = json.loads(e.read(65536) or b"{}").get("message")
        except (ValueError, AttributeError):
            msg = None
        raise AppError(f"GitHub refused ({e.code}{': ' + _clip(msg, 200) if isinstance(msg, str) else ''})") from None
    except (urllib.error.URLError, OSError, TimeoutError) as e:
        raise AppError(f"can't reach GitHub ({_clip(str(getattr(e, 'reason', e)), 160)})") from None
    if len(raw) > MAX_BODY:
        raise AppError("GitHub's answer is too big")
    return json.loads(raw or b"null")


def delete_repo_folder(token: str, repo: str, branch: str, folder_path: str, message: str) -> str:
    """Delete every file under `folder_path/` on `branch` in one commit (git data API, no force push). Returns the sha."""
    if not _REPO.match(repo) or not _BRANCH.match(branch) or ".." in branch:
        raise AppError("bad repo or branch")
    ref = _gh(token, "GET", f"/repos/{repo}/git/ref/heads/{branch}")
    head = ref["object"]["sha"]
    commit = _gh(token, "GET", f"/repos/{repo}/git/commits/{head}")
    tree = _gh(token, "GET", f"/repos/{repo}/git/trees/{commit['tree']['sha']}?recursive=1")
    if tree.get("truncated"):
        raise AppError("the repo's file list is too big to read in one go; delete the folder by hand")
    pre = folder_path.rstrip("/") + "/"
    gone = [e["path"] for e in tree.get("tree", []) if e.get("type") == "blob" and str(e.get("path", "")).startswith(pre)]
    if not gone:
        raise AppError(f"{folder_path} isn't in {repo} {branch}")
    new_tree = _gh(token, "POST", f"/repos/{repo}/git/trees", {"base_tree": commit["tree"]["sha"], "tree": [{"path": p, "mode": "100644", "type": "blob", "sha": None} for p in gone]})
    c = _gh(token, "POST", f"/repos/{repo}/git/commits", {"message": message, "tree": new_tree["sha"], "parents": [head]})
    _gh(token, "PATCH", f"/repos/{repo}/git/refs/heads/{branch}", {"sha": c["sha"], "force": False})
    return c["sha"]


class AxhubAdapter(Adapter):
    """axHub's web app (apps/axhub-web): its plugins are catalog kind `axhub`. The Dev Console holds the repo, so it does
    the work: `GET /api/app-plugins/axhub` (what is in apps/axhub-web/src/plugins), `POST /api/app-plugins/axhub/install|
    uninstall {folder, confirm}` (committed to GitHub; axhub-web's 5-minute update rebuilds). Same console token."""

    app = "axhub"
    label = "axHub"

    def __init__(self, env: Callable[[str, str], str] = _env) -> None:
        self.env = env

    def _conn(self) -> tuple[str, str, float]:
        return _conn(self.env, "APP_CONSOLE", "https://console.amberxai.com")

    def snapshot(self) -> dict[str, Any]:
        base, tok, t = self._conn()
        out: dict[str, Any] = {"reachable": False, "canInstall": False, "reason": "", "installed": {}, "available": {}}
        if not base:
            out["reason"] = "APP_CONSOLE_URL isn't an https address (axHub's plugins are installed through the Dev Console)"
            return out
        if not tok:
            out["reason"] = "Patches has no console token (APP_CONSOLE_TOKEN): axHub's plugins are installed through the Dev Console"
            return out
        try:
            got = call(base, tok, "GET", "/api/app-plugins/axhub", timeout=t)
        except AppError as e:
            out["reason"] = f"the Dev Console can't list axHub's plugins ({e})"
            return out
        for p in (got or {}).get("items", []) if isinstance(got, dict) else []:
            c = _plugin(p) if isinstance(p, dict) else None
            if c:
                out["installed"][c["id"]] = c
        out["reachable"] = True
        try:
            cat = call(base, tok, "GET", "/api/plugin-catalog?kind=axhub", timeout=t)
        except AppError as e:
            out["reason"] = f"the plugin catalog can't be read ({e}): installing is off, uninstalling still works"
            return out
        for it in (cat or {}).get("items", []) if isinstance(cat, dict) else []:
            if isinstance(it, dict) and it.get("kind") == "axhub":
                c = _plugin(it)
                if c:
                    out["available"][c["id"]] = c
        out["canInstall"] = True
        return out

    def install(self, plugin: dict[str, Any]) -> str:
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no console address or token")
        r = call(base, tok, "POST", "/api/app-plugins/axhub/install", {"folder": plugin["folder"], "confirm": plugin["folder"]}, timeout=660)
        return _clip((r or {}).get("note") if isinstance(r, dict) else "", 300) or "installed"

    def uninstall(self, plugin: dict[str, Any]) -> str:
        base, tok, _t = self._conn()
        if not base or not tok:
            raise AppError("Patches has no console address or token")
        r = call(base, tok, "POST", "/api/app-plugins/axhub/uninstall", {"folder": plugin["folder"], "confirm": plugin["folder"]}, timeout=660)
        return _clip((r or {}).get("note") if isinstance(r, dict) else "", 300) or "removed"


class PlaceholderAdapter(Adapter):
    """An app Patches can't install into (yet). It says so; it never pretends to work."""

    def __init__(self, app: str, label: str, reason: str) -> None:
        self.app, self.label, self.reason = app, label, reason

    def snapshot(self) -> dict[str, Any]:
        return {"reachable": False, "canInstall": False, "reason": self.reason, "installed": {}, "available": {}}


ADAPTERS: dict[str, Adapter] = {
    "console": ConsoleAdapter(),
    "pilot": PilotAdapter(),
    "axhub": AxhubAdapter(),
}


def register(adapter: Adapter) -> None:
    """Add or replace an app's adapter (PlaceholderAdapter for an app Patches can't install into yet)."""
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
            elif r["id"] in (s.get("switches") or {}):
                cells[a] = {"installed": have, "canChange": True, "why": s["switches"][r["id"]], "switch": True}
            elif have and r["id"] in (s.get("locked") or {}):
                cells[a] = {"installed": True, "canChange": False, "why": s["locked"][r["id"]]}
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
        delete = c.get("delete") is True
        if not isinstance(inst, bool) or not isinstance(pid, str) or pid not in rows or a not in rows[pid]["cells"]:
            raise ValueError(f"{pid!r} in {a!r} isn't a cell of the grid")
        if (a, pid) in seen:
            raise ValueError(f"{pid} in {a} is listed twice")
        seen.add((a, pid))
        cell = rows[pid]["cells"][a]
        if delete and (inst is not False or not cell.get("switch")):
            raise ValueError(f"only a plugin bundled with an app can be deleted from its code ({rows[pid]['name']} in {a})")
        if not cell["canChange"]:
            raise ValueError(f"{rows[pid]['name']} in {a} can't be changed: {cell['why']}")
        if cell["installed"] is inst and not delete:
            continue  # already that way
        snap = g["_snaps"][a]
        p = snap["installed"].get(pid) or snap["available"].get(pid)
        if not p:
            raise ValueError(f"{pid} isn't known to {a}")
        out.append({"app": a, "id": pid, "folder": p["folder"], "name": p["name"], "install": inst, "switch": bool(cell.get("switch")) and not delete, "delete": delete, "state": "queued", "note": ""})
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
                if it.get("delete"):
                    fn = getattr(ad, "delete", None)
                    if not fn:
                        raise AppError(f"{ad.label if ad else it['app']} can't delete a plugin's code")
                    note = fn(it)
                else:
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
