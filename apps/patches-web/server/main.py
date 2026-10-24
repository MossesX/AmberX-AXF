"""Patches — API + web app in one process (AmberX AXF template `web-fastapi-wall`).

Every /api route needs the caller to be allowed: the app token (`Authorization: Bearer $APP_TOKEN`, machines and
local dev) or a browser signed in to axHub as an **admin** (only when the installer turned the wall on; see wall.py).
Signed-in hub *users* (not admins) reach only `/api/health` and `/api/me` until you decide otherwise in `user_may`
(default-deny). Browser-session writes must come from this app's own origin.

Env: APP_TOKEN (required in production; empty = open, local dev only), APP_TRUST_WALL=1 + APP_WALL_SECRET (the
installer sets both), APP_WALL_HUB (hub address for sign-out links), APP_THEMES_PERM (hub permission that lets a
user change themes; default "patches-web.themes"), APP_DATA_DIR (default ./data), PORT; APP_CONSOLE_URL + APP_CONSOLE_TOKEN (the Dev Console, for the
Claude connection badge: GET /api/claude).

Run: APP_TOKEN=dev uvicorn main:app --app-dir server --port 7290   (npm run dev proxies /api here)
"""
from __future__ import annotations

import hmac
import json
import os
import re
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse

import wall

APP_ID = "patches-web"
ROOT = Path(__file__).resolve().parent.parent
DIST = Path(os.environ.get("APP_DIST", ROOT / "dist"))
DATA = Path(os.environ.get("APP_DATA_DIR", ROOT / "data"))
HUB = os.environ.get("APP_WALL_HUB", "https://axhub.amberxai.com").rstrip("/")
THEMES_PERM = os.environ.get("APP_THEMES_PERM", f"{APP_ID}.themes")

# Routes a signed-in hub *user* (not admin) may call. Everything else is admin / token only.
USER_PATHS = frozenset({"/api/health", "/api/me"})

app = FastAPI(title="Patches API", version="0.1.0")


def _token() -> str:
    return os.environ.get("APP_TOKEN", "").strip()


def _token_ok(request: Request) -> bool:
    tok = _token()
    got = request.headers.get("authorization") or ""
    return bool(tok) and hmac.compare_digest(got.encode(), f"Bearer {tok}".encode())


def user_may(caller: wall.Caller, method: str, path: str) -> bool:
    """May this signed-in hub user (not admin) make this request? Default-deny: extend for your app's user features."""
    return caller.admin or (method.upper() in wall.SAFE_METHODS and path.rstrip("/") in USER_PATHS)


@app.middleware("http")
async def _gate(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Runs before every route: bearer-via-hub needs the real token, bad sessions are refused, users are limited."""
    path = request.url.path
    if path == "/api" or path.startswith("/api/"):
        if request.headers.get("x-auth-via") == "token" and not _token_ok(request):
            return JSONResponse({"detail": "app token required (Authorization: Bearer APP_TOKEN)"}, status_code=401)
        if wall.malformed_session(request.headers) and not _token_ok(request):
            return JSONResponse({"detail": "sign-in not understood: sign in again at the hub, or use the app token"}, status_code=403)
        c = wall.wall_caller(request.headers)
        if c and not c.admin:
            if not user_may(c, request.method, path):
                return JSONResponse({"detail": "admins only: ask an admin to grant you this on the hub"}, status_code=403)
        if c and request.method.upper() not in wall.SAFE_METHODS and not wall.same_origin(request):
            return JSONResponse({"detail": "cross-site request refused"}, status_code=403)
    return await call_next(request)


def caller(request: Request) -> wall.Caller | None:
    """Who is calling: the token (admin), a signed-in hub account, or nobody."""
    if not _token() or _token_ok(request):
        return wall.TOKEN_CALLER
    return wall.wall_caller(request.headers)


def auth(request: Request) -> wall.Caller:
    """Dependency for every /api route: someone allowed must be calling (the middleware already limited users)."""
    c = caller(request)
    if c is None:
        raise HTTPException(401, "unauthorized")
    request.state.caller = c
    return c


@app.get("/api/health")
def health() -> dict[str, Any]:
    return {"ok": True, "app": APP_ID}


@app.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    """Who this browser is: with the wall on, the signed-in hub account and its hub-accounts policy role."""
    c = wall.wall_caller(request.headers)
    return {"wall": wall.trusted(), "hub": HUB, "user": c.public() if c else None, "role": wall.ui_role(c, THEMES_PERM) if c else None}


@app.get("/api/hello")
def hello(c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    return {"message": f"Hello {c.name} from {APP_ID}"}


# ---------------------------------------------------------------- Claude connection (banner badge)
#
# Brett, Oct 24 2026: on every load Patches shows whether Claude Code connects (subscription or API key) and the active
# account's email. The Dev Console's claude-connection plugin does the check; this server asks it with the console token
# (server to server: the token never reaches a browser) and passes on only the plain fields.

CONSOLE_URL = os.environ.get("APP_CONSOLE_URL", "https://console.amberxai.com").rstrip("/")
CLAUDE_PLUGIN = "claude-connection"  # the console plugin folder (route /api/plugins/<folder>/status); off = 404
CLAUDE_FIELDS = ("at", "ok", "mode", "email", "account", "model", "ms", "error")


class _NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, *a: Any, **k: Any) -> None:  # a token never follows a redirect
        return None


def _console_token() -> str:
    f = os.environ.get("APP_CONSOLE_TOKEN_FILE", "")
    if f:
        try:
            for line in Path(f).read_text("utf-8").splitlines():
                if line.startswith("AXF_TOKEN="):
                    return line.split("=", 1)[1].strip()
        except OSError:
            pass
    return os.environ.get("APP_CONSOLE_TOKEN", "").strip()


def claude_status(refresh: bool = False) -> dict[str, Any]:
    """The console's claude-connection check, or ok: False with why (never raises, never returns the token)."""
    down = {"at": int(time.time() * 1000), "ok": False, "mode": "", "email": "", "account": "", "model": "", "ms": 0}
    u = urllib.parse.urlsplit(CONSOLE_URL)
    if u.scheme != "https" and u.hostname not in ("localhost", "127.0.0.1"):
        return {**down, "error": "APP_CONSOLE_URL must be https"}
    tok = _console_token()
    if not tok:
        return {**down, "error": "Patches has no console token (APP_CONSOLE_TOKEN)"}
    req = urllib.request.Request(f"{CONSOLE_URL}/api/plugins/{CLAUDE_PLUGIN}/status{'?refresh=true' if refresh else ''}",
                                 headers={"Authorization": f"Bearer {tok}", "Accept": "application/json"})
    try:
        with urllib.request.build_opener(_NoRedirect).open(req, timeout=60) as r:
            body = json.loads(r.read(65536).decode("utf-8"))
    except urllib.error.HTTPError as e:
        why = "the Claude connection plugin is off in the console" if e.code == 404 else "the console refused the token" if e.code in (401, 403) else f"the console answered {e.code}"
        return {**down, "error": why}
    except (urllib.error.URLError, OSError, ValueError) as e:
        return {**down, "error": f"the console can't be reached ({str(getattr(e, 'reason', e))[:120]})"}
    if not isinstance(body, dict):
        return {**down, "error": "the console answered something unexpected"}
    out = {k: body.get(k) for k in CLAUDE_FIELDS}
    out["ok"] = out["ok"] is True
    for k in ("mode", "email", "account", "model", "error"):
        out[k] = _clip(out[k] or "", 300)
    return out


@app.get("/api/claude")
def claude(refresh: bool = False, _c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    return claude_status(refresh)


# ---------------------------------------------------------------- plugins Patches manages for the apps in its tabs
#
# Brett, Oct 22 2026: "when Patches loads developer apps in tabs … install the missing plugins in Patches … disable all
# plugins from the apps and only enable them in Patches". Each app in a tab reports the plugins it has (embed@1
# `plugins` message, in the browser); Patches keeps, per app, which of them are installed here and switched on. The
# apps then run only the ones switched on here (`plugins-enabled`). Ids and names only: no plugin code is stored.

PLUGINS_FILE = DATA / "plugins.json"
PLUGIN_APPS = ("console", "pilot", "axhub")
PLUGIN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,119}$")
MAX_PLUGINS = 200
_plugins_lock = threading.Lock()


def _clip(v: Any, n: int) -> str:
    return re.sub(r"[\x00-\x1f\x7f]+", " ", v).strip()[:n] if isinstance(v, str) else ""


def _model(v: Any) -> str:
    """The model that built a plugin (plugin@1 builtWith.model, as the app reports it): a short lowercase name, else ""."""
    return v if isinstance(v, str) and re.fullmatch(r"[a-z][a-z0-9.-]{0,31}", v) else ""


def _read_plugins() -> dict[str, Any]:
    try:
        raw = json.loads(PLUGINS_FILE.read_text())
    except (OSError, ValueError):
        raw = {}
    apps: dict[str, Any] = {}
    for app_id in PLUGIN_APPS:
        got = (raw.get("apps") or {}).get(app_id) if isinstance(raw, dict) else None
        items = (got or {}).get("plugins") if isinstance(got, dict) else None
        clean: dict[str, Any] = {}
        for pid, p in (items.items() if isinstance(items, dict) else []):
            if PLUGIN_ID.match(str(pid)) and isinstance(p, dict) and len(clean) < MAX_PLUGINS:
                clean[pid] = {"name": _clip(p.get("name"), 80) or pid, "version": _clip(p.get("version"), 40), "model": _model(p.get("model")), "enabled": p.get("enabled") is True, "installedAt": _clip(p.get("installedAt"), 40)}
        apps[app_id] = {"plugins": clean}
    return {"$axf": "patches-plugins@1", "apps": apps}


def _write_plugins(state: dict[str, Any]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, prefix=".plugins-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, PLUGINS_FILE)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


def _app_of(body: dict[str, Any]) -> str:
    app_id = body.get("app")
    if app_id not in PLUGIN_APPS:
        raise HTTPException(400, f"app must be one of: {', '.join(PLUGIN_APPS)}")
    return str(app_id)


@app.get("/api/plugins")
def plugins_list(_c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    with _plugins_lock:
        return _read_plugins()


@app.post("/api/plugins/install")
def plugins_install(body: dict[str, Any], _c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    """Install plugins an app reported into Patches: new ones only (a plugin already here keeps its switch). Each new
    one starts the way the app itself had it (`on`), so installing never turns on what the app had off."""
    app_id = _app_of(body)
    wanted = body.get("plugins")
    if not isinstance(wanted, list) or len(wanted) > MAX_PLUGINS:
        raise HTTPException(400, f"plugins must be a list of at most {MAX_PLUGINS}")
    now = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    with _plugins_lock:
        state = _read_plugins()
        mine = state["apps"][app_id]["plugins"]
        added: list[str] = []
        for p in wanted:
            pid = p.get("id") if isinstance(p, dict) else None
            if not isinstance(pid, str) or not PLUGIN_ID.match(pid) or pid in mine:
                continue
            if len(mine) >= MAX_PLUGINS:
                raise HTTPException(400, f"at most {MAX_PLUGINS} plugins per app")
            mine[pid] = {"name": _clip(p.get("name"), 80) or pid, "version": _clip(p.get("version"), 40), "model": _model(p.get("model")), "enabled": p.get("on") is not False, "installedAt": now}
            added.append(pid)
        if added:
            _write_plugins(state)
    return {**state, "added": added}


@app.post("/api/plugins/enabled")
def plugins_enabled(body: dict[str, Any], _c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    """Switch one installed plugin on or off for an app (in Patches; the app runs only what is on here)."""
    app_id = _app_of(body)
    pid = body.get("id")
    with _plugins_lock:
        state = _read_plugins()
        mine = state["apps"][app_id]["plugins"]
        if not isinstance(pid, str) or pid not in mine:
            raise HTTPException(404, "that plugin isn't installed in Patches")
        mine[pid]["enabled"] = body.get("enabled") is True
        _write_plugins(state)
    return state


@app.post("/api/plugins/remove")
def plugins_remove(body: dict[str, Any], _c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    """Take a plugin out of Patches for an app (the app reports it again as missing while it still has it)."""
    app_id = _app_of(body)
    pid = body.get("id")
    with _plugins_lock:
        state = _read_plugins()
        if isinstance(pid, str) and state["apps"][app_id]["plugins"].pop(pid, None) is not None:
            _write_plugins(state)
    return state


# ---------------------------------------------------------------- Patches' tab group (patches-tabs@1)
#
# Brett, Oct 22 2026: "every plugin that can be tabable appears in Patches settings where you select from a list of apps
# or plugins to have a tab; the available tab things are selected from a dialog". The tab group is kept here so every
# device shows the same tabs: app tabs (the Console, Pilot, axHub) and plugin tabs (a tabable plugin of one of those apps,
# shown as that app's view page `view:<id>`). Ids, labels and icons only.

TABS_FILE = DATA / "tabs.json"
VIEW_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,63}$")
ICON_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,39}$")
MAX_TABS = 20
DEFAULT_TABS = [{"kind": "app", "app": a} for a in PLUGIN_APPS]
_tabs_lock = threading.Lock()


def _clean_tab(t: Any) -> dict[str, Any] | None:
    """One tab, checked; None when it isn't one."""
    if not isinstance(t, dict) or t.get("app") not in PLUGIN_APPS:
        return None
    if t.get("kind") == "app":
        return {"kind": "app", "app": t["app"]}
    if t.get("kind") != "plugin" or not isinstance(t.get("plugin"), str) or not PLUGIN_ID.match(t["plugin"]):
        return None
    if not isinstance(t.get("view"), str) or not VIEW_ID.match(t["view"]):
        return None
    out = {"kind": "plugin", "app": t["app"], "plugin": t["plugin"], "view": t["view"], "label": _clip(t.get("label"), 80) or t["view"]}
    if isinstance(t.get("icon"), str) and ICON_ID.match(t["icon"]):
        out["icon"] = t["icon"]
    return out


def _tab_key(t: dict[str, Any]) -> str:
    return t["app"] if t["kind"] == "app" else f"{t['app']}:{t['view']}"


def _clean_tabs(raw: Any) -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for t in raw if isinstance(raw, list) else []:
        c = _clean_tab(t)
        if c and _tab_key(c) not in seen and len(out) < MAX_TABS:
            seen.add(_tab_key(c))
            out.append(c)
    return out


def _read_tabs() -> dict[str, Any]:
    try:
        raw = json.loads(TABS_FILE.read_text())
    except (OSError, ValueError):
        return {"$axf": "patches-tabs@1", "tabs": [dict(t) for t in DEFAULT_TABS]}
    return {"$axf": "patches-tabs@1", "tabs": _clean_tabs(raw.get("tabs") if isinstance(raw, dict) else None)}


def _write_json(path: Path, state: dict[str, Any]) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=DATA, prefix=f".{path.stem}-", suffix=".json")
    try:
        with os.fdopen(fd, "w") as f:
            json.dump(state, f, indent=1)
            f.flush()
            os.fsync(f.fileno())
        os.chmod(tmp, 0o600)
        os.replace(tmp, path)
    except BaseException:
        try:
            os.unlink(tmp)
        except OSError:
            pass
        raise


@app.get("/api/tabs")
def tabs_list(_c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    with _tabs_lock:
        return _read_tabs()


@app.put("/api/tabs")
def tabs_save(body: dict[str, Any], _c: wall.Caller = Depends(auth)) -> dict[str, Any]:
    """Save the whole tab group, in order. Anything that isn't a tab is refused (not dropped), so a typo never loses tabs."""
    raw = body.get("tabs")
    if not isinstance(raw, list) or len(raw) > MAX_TABS:
        raise HTTPException(400, f"tabs must be a list of at most {MAX_TABS}")
    tabs = _clean_tabs(raw)
    if len(tabs) != len(raw):
        raise HTTPException(400, "every tab is {kind: app, app} or {kind: plugin, app, plugin, view, label, icon?}, each once")
    state = {"$axf": "patches-tabs@1", "tabs": tabs}
    with _tabs_lock:
        _write_json(TABS_FILE, state)
    return state


# ---------------------------------------------------------------- the built web app (dist/), single-page fallback

@app.get("/{path:path}", include_in_schema=False)
def web(path: str) -> Any:
    if path == "api" or path.startswith("api/"):
        raise HTTPException(404, "no such API route")
    if not DIST.is_dir():
        return JSONResponse({"detail": "web app not built (npm run build)"}, status_code=404)
    root = DIST.resolve()
    f = (DIST / path).resolve()
    if path and f.is_file() and f.is_relative_to(root):
        return FileResponse(f)
    return FileResponse(root / "index.html")
