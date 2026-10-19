"""
AXF Dev Console API — the Python half of the console.

FastAPI service that fronts the framework's build engine (framework/cli, Node) for the React console:
  GET  /api/health | catalog | tracker | libraries | boilerplates | boilerplates/items | modules | templates | ported-kits | project | terminal
  POST /api/status | project | boilerplates/save | init | validate | new-asset | new-module | new-demo | install | import-ui
  GET  /api/events        server-sent events: every engine log line as it happens (the console's output terminal follows it)
  /                        the built console (apps/console-web/dist) when present

Run locally:  cd apps/console-web/server && pip install -r requirements.txt && uvicorn main:app --port 7090 --reload
Deploy:       the Dockerfile next to this file (Node 22 + Python 3.12) — Coolify builds it straight from the repo.
Config:       AXF_ROOT (repo root, default: ../../.. from here), AXF_TOKEN (optional bearer token for POST routes; the AXF_TOKEN line in AXF_TOKEN_FILE, default .axf-console/env, wins and is what POST /api/token/reset rewrites),
              AXF_STATE (where project/terminal state is kept, default: <root>/.axf-console/state.json)
"""
from __future__ import annotations

import asyncio
from starlette.concurrency import run_in_threadpool
import json
import os
import secrets
import string
import subprocess
import time
from pathlib import Path
from typing import Any

import fcntl
import pty
import select
import signal
import struct
import termios
import urllib.request
import zipfile
from io import BytesIO
from contextlib import asynccontextmanager
from typing import AsyncIterator

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect, WebSocketException
from starlette.requests import HTTPConnection
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

import hmac as _hmac  # noqa: E402

import wall  # noqa: E402  (server/wall.py: who is calling behind axHub's sign-in wall)

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("AXF_ROOT", HERE.parent.parent.parent)).resolve()
RPC = ROOT / "framework" / "cli" / "engine-rpc.mjs"
STATE = Path(os.environ.get("AXF_STATE", ROOT / ".axf-console" / "state.json"))
# The console token. The saved env file (AXF_TOKEN_FILE, default .axf-console/env, written by install-console.sh and by
# a reset) wins over the AXF_TOKEN environment variable, so a reset from the panel survives container restarts.
TOKEN_FILE = Path(os.environ.get("AXF_TOKEN_FILE", ROOT / ".axf-console" / "env"))
_token_cache: dict[str, Any] = {"mtime": None, "value": os.environ.get("AXF_TOKEN", "")}
_shells: set[WebSocket] = set()


def current_token() -> str:
    """The token every protected route checks; re-read whenever the env file changes."""
    try:
        m = TOKEN_FILE.stat().st_mtime_ns
    except OSError:
        return _token_cache["value"]
    if m != _token_cache["mtime"]:
        try:
            for line in TOKEN_FILE.read_text().splitlines():
                if line.startswith("AXF_TOKEN=") and line[10:].strip():
                    _token_cache["value"] = line[10:].strip()
        except OSError:
            pass
        _token_cache["mtime"] = m
    return _token_cache["value"]


def _write_token(new: str) -> None:
    """Replace AXF_TOKEN in the env file (other lines kept), owner-only, atomically."""
    lines = TOKEN_FILE.read_text().splitlines() if TOKEN_FILE.is_file() else []
    lines = [l for l in lines if not l.startswith("AXF_TOKEN=")]
    TOKEN_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = TOKEN_FILE.with_name(TOKEN_FILE.name + ".tmp")
    fd = os.open(tmp, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as fh:
        fh.write("\n".join([f"AXF_TOKEN={new}", *lines]) + "\n")
    os.replace(tmp, TOKEN_FILE)
    _token_cache.update(value=new, mtime=TOKEN_FILE.stat().st_mtime_ns)
# The built console. The image keeps a copy outside /axf because install-console.sh mounts the host clone
# over /axf (dist/ is git-ignored, so the mount would hide the build). Prefer the repo build when it exists.
DIST = HERE.parent / "dist"
if not DIST.exists() and os.environ.get("AXF_CONSOLE_DIST"):
    DIST = Path(os.environ["AXF_CONSOLE_DIST"])

@asynccontextmanager
async def lifespan(_app: FastAPI) -> AsyncIterator[None]:
    async with _mcp.session_manager.run():  # the MCP endpoint's session manager (defined below)
        hub = globals().get("ALERTS")  # developer alerts (defined below): sources + phone delivery threads
        if hub:
            hub.start()
        try:
            yield
        finally:
            if hub:
                hub.stop()


app = FastAPI(title="AXF Dev Console API", version="0.2.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


@app.middleware("http")
async def _wall_token_gate(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Behind axHub's sign-in wall, a request let through on a bearer header (X-Auth-Via: token, set by the hub; the
    proxy strips any client copy) must carry the real console token on every route, reads included."""
    if request.headers.get("x-auth-via") == "token":
        tok = current_token()
        got = request.headers.get("authorization", "")
        if not tok or not _hmac.compare_digest(got.encode(), f"Bearer {tok}".encode()):
            return JSONResponse({"detail": "console token required (Authorization: Bearer AXF_TOKEN)"}, status_code=401)
    return await call_next(request)


@app.middleware("http")
async def _wall_user_gate(request: Request, call_next):  # type: ignore[no-untyped-def]
    """Behind the wall, a signed-in hub *user* (not an admin) reaches only what wall.user_may allows: the page, a few
    read-only framework routes and the routes of plugins they were granted. Default-deny for everything else."""
    if wall.malformed_session(request.headers):
        return JSONResponse({"detail": "sign-in not understood; sign in again at the hub"}, status_code=403)
    c = wall.wall_caller(request.headers)
    if c and not c.admin:
        path = request.url.path
        if not wall.user_may(c, request.method, path, WALL_USER_PLUGINS, USER_GRANTABLE_PLUGINS):
            return JSONResponse({"detail": "admins only: ask an admin to grant you this on the hub's users page"}, status_code=403)
        if request.method.upper() not in wall.SAFE_METHODS and not wall.same_origin(request):
            return JSONResponse({"detail": "cross-site request refused"}, status_code=403)
    return await call_next(request)


# Plugins whose plugin.json says "wallUsers": true (open to every signed-in user) or "userGrantable": true (an admin
# may grant it to a user: console.plugin.<folder>); filled when plugins load.
WALL_USER_PLUGINS: frozenset[str] = frozenset()
USER_GRANTABLE_PLUGINS: frozenset[str] = frozenset()
PANEL = ROOT / "deploy" / "panel" / "index.html"
GITHUB_REPO = os.environ.get("AXF_GITHUB_REPO", "MossesX/AmberX-AXF")
def _gh_token() -> str:
    """Read live: the systems check can save a new token into this process's environment."""
    return os.environ.get("GITHUB_TOKEN", "")

# ---------------------------------------------------------------- state + terminal

_state: dict[str, Any] = {"project": "", "terminal": [], "plugins": {}}
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()


def _load_state() -> None:
    if STATE.exists():
        try:
            _state.update(json.loads(STATE.read_text()))
        except json.JSONDecodeError:
            pass


def _save_state() -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"project": _state["project"], "terminal": _state["terminal"][-500:], "plugins": _state.get("plugins", {})}, indent=2))


def log(channel: str, text: str, level: str = "info") -> None:
    """Append a terminal line and push it to every SSE subscriber."""
    line = {"at": int(time.time() * 1000), "channel": channel, "level": level, "text": text}
    _state["terminal"] = (_state["terminal"] + [line])[-2000:]
    for q in list(_subscribers):
        q.put_nowait(line)


_load_state()

# ---------------------------------------------------------------- engine bridge


def engine(op: str, channel: str = "engine", **args: Any) -> dict[str, Any]:
    """Run one build-engine op through framework/cli/engine-rpc.mjs and mirror its log onto the terminal."""
    if not RPC.exists():
        raise HTTPException(500, f"build engine not found at {RPC} (set AXF_ROOT)")
    proc = subprocess.run(["node", str(RPC), op, json.dumps(args)], cwd=ROOT, capture_output=True, text=True, timeout=600)
    out = proc.stdout.strip().splitlines()
    try:
        result = json.loads(out[-1]) if out else {"ok": False, "error": proc.stderr.strip()[-800:] or "no output"}
    except json.JSONDecodeError:
        result = {"ok": False, "error": (proc.stderr or proc.stdout).strip()[-800:]}
    for l in result.get("log", []):
        log(channel, l.strip(), "note" if "note:" in l else "info")
    if not result.get("ok"):
        log(channel, result.get("error", "failed"), "error")
    return result


def _token_ok(request: HTTPConnection, tok: str) -> bool:
    got = request.headers.get("authorization") or ""
    return _hmac.compare_digest(got.encode(), f"Bearer {tok}".encode())


def _wall_admin(request: HTTPConnection) -> bool:
    """A browser signed in to axHub as an admin (only when the wall is on, see server/wall.py) counts as the token."""
    c = wall.wall_caller(request.headers)
    if not c or not c.admin:
        return False
    if not wall.same_origin(request):
        raise HTTPException(403, "cross-site request refused")
    request.state.axf_user = c
    return True


def auth(request: Request) -> None:
    tok = current_token()
    if not tok or _token_ok(request, tok):
        request.state.axf_user = wall.TOKEN_CALLER
        return
    if _wall_admin(request):
        return
    raise HTTPException(401, "unauthorized")


def ok_or_500(r: dict[str, Any]) -> dict[str, Any]:
    if not r.get("ok"):
        return JSONResponse(r, status_code=500)  # type: ignore[return-value]
    return r


# ---------------------------------------------------------------- reads


@app.get("/api/me")
def me(request: Request) -> dict[str, Any]:
    """Who this browser is: a signed-in hub user/admin (wall on), the console token, or an open console (no wall)."""
    hub = os.environ.get("AXF_WALL_HUB", "https://axhub.amberxai.com").rstrip("/")
    c = wall.wall_caller(request.headers)
    if c:
        return {"wall": True, "hub": hub, "user": c.public(), "admin": c.admin, "role": wall.ui_role(c),
                "themes": c.can(wall.THEMES_PERM), "grantable": sorted(USER_GRANTABLE_PLUGINS), "open": sorted(WALL_USER_PLUGINS),
                "plugins": sorted(f for f in PLUGINS if wall.plugin_granted(c, f, WALL_USER_PLUGINS, USER_GRANTABLE_PLUGINS))}
    tok = current_token()
    via_token = bool(tok) and _token_ok(request, tok)
    return {"wall": wall.trusted(), "hub": hub, "user": None, "admin": via_token or not tok, "role": "admin" if (via_token or not tok) else None,
            "themes": True, "grantable": sorted(USER_GRANTABLE_PLUGINS), "open": sorted(WALL_USER_PLUGINS), "plugins": sorted(PLUGINS)}


@app.get("/api/health")
def health(request: Request) -> dict[str, Any]:
    c = wall.wall_caller(request.headers)
    if c and not c.admin:  # no host paths for hub users
        return {"ok": True, "axf": "console-api@1", "engine": RPC.exists()}
    return {"ok": True, "axf": "console-api@1", "root": str(ROOT), "engine": RPC.exists(), "project": _state["project"]}


@app.get("/api/catalog")
def catalog() -> Any:
    return engine("catalog")


@app.get("/api/tracker")
def tracker() -> Any:
    return engine("tracker")


@app.get("/api/libraries")
def libraries() -> Any:
    return engine("libraries")


@app.get("/api/boilerplates")
def boilerplates() -> Any:
    return engine("boilerplates")


@app.get("/api/boilerplates/items")
def boilerplate_items() -> Any:
    return engine("boilerplate-items")


@app.get("/api/plugin-index")
def plugin_index() -> Any:
    """framework/catalog/plugins.json (plugin-index@1): planned framework plugins. Built ones come from their manifests."""
    f = ROOT / "framework" / "catalog" / "plugins.json"
    try:
        return json.loads(f.read_text())
    except (OSError, ValueError):
        return {"$axf": "plugin-index@1", "items": []}


@app.get("/api/modules")
def modules() -> Any:
    return engine("modules")


@app.get("/api/templates")
def templates() -> Any:
    return engine("templates")


@app.get("/api/ported-kits")
def ported_kits() -> Any:
    return engine("ported-kits")


@app.get("/api/library-templates")
def library_templates() -> Any:
    return engine("library-templates")


@app.get("/api/plan")
def plan() -> Any:
    return engine("plan")


@app.post("/api/plan/feature", dependencies=[Depends(auth)])
async def plan_feature(request: Request) -> Any:
    body = await request.json()
    return ok_or_500(engine("plan-upsert", "plan", feature=body.get("feature"), note=body.get("note")))


@app.post("/api/plan/delete", dependencies=[Depends(auth)])
async def plan_delete(request: Request) -> Any:
    body = await request.json()
    return ok_or_500(engine("plan-delete", "plan", id=body.get("id")))


@app.post("/api/plan/media", dependencies=[Depends(auth)])
async def plan_media(request: Request) -> Any:
    body = await request.json()
    return ok_or_500(engine("plan-media", "plan", id=body.get("id"), dataUrl=body.get("dataUrl")))


@app.post("/api/plan/rebuild", dependencies=[Depends(auth)])
def plan_rebuild() -> Any:
    return ok_or_500(engine("plan-rebuild", "plan"))


@app.get("/api/pending")
def pending() -> Any:
    """The pending build list (framework/plan/pending.json, pending@1): builds parked until their model is available."""
    return engine("pending")


@app.post("/api/pending", dependencies=[Depends(auth)])
async def pending_act(request: Request) -> Any:
    """One change: {action: add|update|status|note|sub|remove, ...} — see framework/plan/pending-core.mjs."""
    body = await request.json()
    return ok_or_500(engine("pending-act", "pending", change=body))


# ---------------------------------------------------------------- Standards: project manifests + their rules


@app.get("/api/standards/projects")
def standards_projects() -> Any:
    """Every project in the repo (project.manifest.json, project-manifest@1) with its validation result."""
    return ok_or_500(engine("projects", "standards"))


@app.get("/api/standards/rules")
def standards_rules() -> Any:
    """The project-manifest rules in force (framework/schemas/project-rules.json, shared copy) and the framework's own."""
    return ok_or_500(engine("project-rules", "standards"))


@app.post("/api/standards/rules", dependencies=[Depends(auth)])
async def standards_rules_save(request: Request) -> Any:
    """Save the rules ({rules}). Refused when a locked rule is removed or changed, or a rule is malformed."""
    body = await _body(request)
    return ok_or_500(await run_in_threadpool(engine, "project-rules-save", "standards", rules=body.get("rules")))


@app.post("/api/standards/validate", dependencies=[Depends(auth)])
async def standards_validate(request: Request) -> Any:
    """Validate {dir} (a project in the repo) or {manifest} (an edited manifest, optionally against draft {rules})."""
    body = await _body(request)
    args = {k: body[k] for k in ("dir", "manifest", "rules") if k in body}
    return ok_or_500(await run_in_threadpool(engine, "project-validate", "standards", **args))


@app.get("/api/build-queue")
def build_queue() -> Any:
    return ok_or_500(engine("build-queue", "build"))


async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:  # noqa: BLE001 — empty body is fine
        return {}


@app.post("/api/build-queue/sync", dependencies=[Depends(auth)])
async def build_sync(request: Request) -> Any:
    return ok_or_500(engine("build-sync", "build", **await _body(request)))


@app.post("/api/build-queue/order", dependencies=[Depends(auth)])
async def build_order(request: Request) -> Any:
    return ok_or_500(engine("build-reorder", "build", **await _body(request)))


@app.post("/api/build-queue/reprocess", dependencies=[Depends(auth)])
async def build_reprocess(request: Request) -> Any:
    return ok_or_500(engine("build-reprocess", "build", **await _body(request)))


@app.post("/api/build-queue/step", dependencies=[Depends(auth)])
async def build_step(request: Request) -> Any:
    return ok_or_500(engine("build-step", "build", **await _body(request)))


def _project_name() -> str:
    """The repo's project name from project.manifest.json (its folder in the hub's /projects)."""
    try:
        name = json.loads((ROOT / "project.manifest.json").read_text()).get("name")
        return name if isinstance(name, str) and name else "amberx-axf"
    except Exception:
        return "amberx-axf"


def _persist_root() -> Path | None:
    """The folder holding this project's shared data (mirrors framework/cli/persist.mjs), or None = the repo."""
    exact = os.environ.get("AXF_DATA_DIR")
    if exact is not None:
        return Path(exact) if exact and exact != "off" else None
    legacy = os.environ.get("AXF_PERSIST_DIR")
    if legacy is not None:
        return Path(legacy) / os.environ.get("AXF_PERSIST_REPO", _project_name()) if legacy and legacy != "off" else None
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    if projects.is_dir():
        return projects / _project_name() / "_data"
    old = Path("/opt/axhub/persist") / _project_name()
    return old if old.is_dir() else None


def _plan_media_dir() -> Path:
    root = _persist_root()
    hub = root / "framework" / "plan" / "media" if root else None
    return (hub if hub and hub.is_dir() else ROOT / "framework" / "plan" / "media").resolve()


@app.get("/plan-media/{name}")
def plan_media_file(name: str) -> FileResponse:
    media = _plan_media_dir()
    f = (media / name).resolve()
    if not str(f).startswith(str(media)) or not f.is_file():
        raise HTTPException(404, "not found")
    return FileResponse(f)


@app.get("/api/project")
def project() -> dict[str, Any]:
    return {"dir": _state["project"]}


@app.get("/api/terminal")
def terminal(since: int = 0) -> dict[str, Any]:
    return {"lines": [l for l in _state["terminal"] if l["at"] > since]}


@app.get("/api/events")
async def events() -> StreamingResponse:
    """Server-sent events: one `data:` line per terminal line as the engine produces it."""
    q: asyncio.Queue[dict[str, Any]] = asyncio.Queue()
    _subscribers.add(q)

    async def gen():
        try:
            yield "retry: 3000\n\n"
            while True:
                try:
                    line = await asyncio.wait_for(q.get(), timeout=25)
                    yield f"data: {json.dumps(line)}\n\n"
                except asyncio.TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            _subscribers.discard(q)

    return StreamingResponse(gen(), media_type="text/event-stream", headers={"cache-control": "no-store"})


# ---------------------------------------------------------------- writes


@app.post("/api/project", dependencies=[Depends(auth)])
async def set_project(request: Request) -> dict[str, Any]:
    body = await request.json()
    _state["project"] = str(body.get("dir", "")).strip()
    _save_state()
    log("console", f"project: {_state['project'] or '(none)'}")
    return {"ok": True, "dir": _state["project"]}


@app.post("/api/status", dependencies=[Depends(auth)])
async def set_status(request: Request) -> Any:
    body = await request.json()
    return ok_or_500(engine("status", "tracker", **body))


@app.post("/api/boilerplates/save", dependencies=[Depends(auth)])
async def save_boilerplate(request: Request) -> Any:
    body = await request.json()
    return ok_or_500(engine("boilerplate-save", "boilerplates", boilerplate=body))


def _op(name: str, channel: str):
    async def handler(request: Request) -> Any:
        body = await request.json()
        log(channel, f"▶ {name} {json.dumps({k: v for k, v in body.items() if k != 'params'})[:200]}")
        r = engine(name, channel, **body)
        if r.get("ok"):
            log(channel, f"✓ {name} done", "ok")
        _save_state()
        return ok_or_500(r)

    return handler


for _name, _channel in [("new-library", "libraries"), ("compile-library", "libraries"), ("port-library", "libraries"), ("remove-library", "libraries"), ("init", "init"), ("validate", "validate"), ("new-asset", "assets"), ("options", "assets"), ("new-module", "build"), ("new-demo", "build"), ("install", "install"), ("import-ui", "import")]:
    app.add_api_route(f"/api/{_name}", _op(_name, _channel), methods=["POST"], dependencies=[Depends(auth)])


# ---------------------------------------------------------------- dev servers (control panel)

NODE = "node"
SERVER_DEFS: dict[str, dict[str, Any]] = {
    "console-api": {"label": "Console API (this service)", "port": int(os.environ.get("PORT", "7090")), "cmd": None, "cwd": ".", "url": "/", "note": "FastAPI + build engine; always on while you can read this"},
    "axf-dev": {"label": "axf dev — live-reload assets to devices", "port": 7070, "cmd": [NODE, "framework/cli/axf.mjs", "dev", "{project}", "--port", "7070"], "cwd": ".", "url": "http://{host}:7070/", "note": "watches the open project's assets; devices long-poll /events"},
    "axf-serve": {"label": "axf serve — Node HTTP build driver", "port": 7080, "cmd": [NODE, "framework/cli/axf.mjs", "serve", "--port", "7080"], "cwd": ".", "url": "http://{host}:7080/health", "note": "the Android console's build-engine endpoint"},
    "console-dev": {"label": "Web console — Vite dev server", "port": 5173, "cmd": ["npm", "run", "dev", "--", "--host", "--port", "5173"], "cwd": "apps/console-web", "url": "http://{host}:5173/", "note": "hot reload for the React console (proxies /api here)"},
    "demo-preview": {"label": "Web demo — vite preview", "port": 4173, "cmd": ["npx", "vite", "preview", "--host", "--port", "4173"], "cwd": "apps/demo", "url": "http://{host}:4173/", "note": "serves apps/demo/dist (run npm run build first)"},
    "next-dev": {"label": "Open project — next dev", "port": 3000, "cmd": ["npm", "run", "dev", "--", "--port", "3000"], "cwd": "{project}", "url": "http://{host}:3000/", "note": "only for next-ts projects"},
}
_procs: dict[str, subprocess.Popen[bytes]] = {}
_proc_logs: dict[str, list[str]] = {}


def _port_open(port: int) -> bool:
    import socket
    with socket.socket() as sck:
        sck.settimeout(0.2)
        return sck.connect_ex(("127.0.0.1", port)) == 0


def _server_row(sid: str, request: Request | None = None) -> dict[str, Any]:
    d = SERVER_DEFS[sid]
    proc = _procs.get(sid)
    running = proc is not None and proc.poll() is None
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost").split(":")[0] if request else "localhost"
    managed = d["cmd"] is not None
    return {"id": sid, "label": d["label"], "port": d["port"], "note": d["note"], "managed": managed, "running": running or (not managed), "listening": _port_open(d["port"]),
            "pid": proc.pid if running else None, "url": d["url"].replace("{host}", host), "cwd": d["cwd"].replace("{project}", _state["project"] or "apps/console-web"),
            "command": " ".join(d["cmd"]).replace("{project}", _state["project"] or "apps/console-web") if managed else "uvicorn main:app --port 7090", "log": _proc_logs.get(sid, [])[-40:]}


def _pump(sid: str, proc: subprocess.Popen[bytes]) -> None:
    import threading

    def run() -> None:
        assert proc.stdout
        for raw in iter(proc.stdout.readline, b""):
            line = raw.decode("utf-8", "replace").rstrip()
            _proc_logs.setdefault(sid, []).append(line)
            _proc_logs[sid] = _proc_logs[sid][-400:]
            log(f"server:{sid}", line)
        log(f"server:{sid}", f"exited with code {proc.wait()}", "warn" if proc.returncode else "info")

    threading.Thread(target=run, daemon=True).start()


@app.get("/api/servers")
def servers(request: Request) -> dict[str, Any]:
    return {"servers": [_server_row(sid, request) for sid in SERVER_DEFS], "project": _state["project"]}


@app.post("/api/servers/{sid}/start", dependencies=[Depends(auth)])
def server_start(sid: str, request: Request) -> dict[str, Any]:
    d = SERVER_DEFS.get(sid)
    if not d or d["cmd"] is None:
        raise HTTPException(400, "not a managed server")
    if (p := _procs.get(sid)) and p.poll() is None:
        return {"ok": True, "server": _server_row(sid, request), "note": "already running"}
    project = _state["project"] or "apps/console-web"
    cmd = [c.replace("{project}", project) for c in d["cmd"]]
    cwd = ROOT / d["cwd"].replace("{project}", project)
    if not cwd.exists():
        raise HTTPException(400, f"{cwd} does not exist (open a project first?)")
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True)
    _procs[sid] = proc
    _proc_logs[sid] = []
    _pump(sid, proc)
    log(f"server:{sid}", f"▶ started pid {proc.pid}: {' '.join(cmd)} (in {d['cwd']})", "ok")
    return {"ok": True, "server": _server_row(sid, request)}


@app.post("/api/servers/{sid}/stop", dependencies=[Depends(auth)])
def server_stop(sid: str, request: Request) -> dict[str, Any]:
    proc = _procs.get(sid)
    if not proc or proc.poll() is not None:
        return {"ok": True, "server": _server_row(sid, request), "note": "not running"}
    try:
        os.killpg(os.getpgid(proc.pid), signal.SIGTERM)
        proc.wait(timeout=5)
    except Exception:
        try:
            os.killpg(os.getpgid(proc.pid), signal.SIGKILL)
        except Exception:
            pass
    log(f"server:{sid}", "■ stopped", "warn")
    return {"ok": True, "server": _server_row(sid, request)}


# ---------------------------------------------------------------- console token reset


@app.post("/api/token/reset")
async def token_reset(request: Request) -> Response:
    """Issue a new console token. Needs the current one; the old one stops working at once (API, /mcp, plugin
    routes, terminal) and open terminal sessions are closed. The new token is returned once and saved in the env file."""
    if not current_token():
        raise HTTPException(409, "no token is set on this server; run deploy/install-console.sh to set one")
    auth(request)
    body = await _body(request)
    if body.get("confirm") != "reset":
        raise HTTPException(400, 'send {"confirm": "reset"} to reset the token')
    alphabet = string.ascii_letters + string.digits
    new = "".join(secrets.choice(alphabet) for _ in range(32))
    try:
        _write_token(new)
    except OSError as e:
        raise HTTPException(500, f"could not save the new token in {TOKEN_FILE}: {e.strerror}")
    for ws in list(_shells):
        try:
            await ws.close(code=4401)
        except Exception:
            pass
    log("auth", "console token reset; the old token no longer works", "warn")
    return JSONResponse({"ok": True, "token": new, "savedIn": ".axf-console/env"}, headers={"cache-control": "no-store"})


# ---------------------------------------------------------------- embedded terminal (WebSocket ↔ pty)


@app.websocket("/api/shell")
async def shell(ws: WebSocket) -> None:
    """A real shell on this host for the control panel's terminal. Protected by AXF_TOKEN (?token=…) when set."""
    tok = current_token()
    c = wall.wall_caller(ws.headers)
    # host shell: never for hub users, and never open (no token) once the console trusts the wall
    if (c and not c.admin) or wall.malformed_session(ws.headers) or (not tok and wall.trusted()) or (tok and ws.query_params.get("token") != tok):
        await ws.close(code=4401)
        return
    await ws.accept()
    _shells.add(ws)
    pid, fd = pty.fork()
    if pid == 0:  # child
        os.chdir(ROOT)
        os.environ["TERM"] = "xterm-256color"
        os.execvp(os.environ.get("AXF_SHELL", "bash"), [os.environ.get("AXF_SHELL", "bash"), "-l"])
    log("shell", f"terminal session opened (pid {pid})")
    loop = asyncio.get_event_loop()

    async def pump() -> None:
        try:
            while True:
                r, _, _ = await loop.run_in_executor(None, select.select, [fd], [], [], 0.5)
                if r:
                    try:
                        data = os.read(fd, 65536)
                    except OSError:
                        break
                    if not data:
                        break
                    await ws.send_bytes(data)
        except Exception:
            pass

    task = asyncio.create_task(pump())
    try:
        while True:
            msg = await ws.receive()
            if msg.get("type") == "websocket.disconnect":
                break
            if (txt := msg.get("text")) is not None:
                if txt.startswith("\x00resize:"):
                    try:
                        cols, rows = (int(x) for x in txt[8:].split(","))
                        fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
                    except Exception:
                        pass
                else:
                    os.write(fd, txt.encode())
            elif (data := msg.get("bytes")) is not None:
                os.write(fd, data)
    except (WebSocketDisconnect, RuntimeError):
        pass
    finally:
        _shells.discard(ws)
        task.cancel()
        try:
            os.kill(pid, signal.SIGHUP)
        except Exception:
            pass
        os.close(fd)
        log("shell", "terminal session closed")


# ---------------------------------------------------------------- releases (CI artifacts: APK, maven repo, console dist)

_releases_cache: dict[str, Any] = {"at": 0.0, "data": None}


def _gh(url: str) -> Any:
    req = urllib.request.Request(url, headers={"accept": "application/vnd.github+json", "user-agent": "axf-console", **({"authorization": f"Bearer {_gh_token()}"} if _gh_token() else {})})
    with urllib.request.urlopen(req, timeout=20) as r:
        return json.loads(r.read().decode())


@app.get("/api/releases")
def releases() -> dict[str, Any]:
    """Latest successful CI run of the Android workflow + its artifacts, with direct download routes (needs GITHUB_TOKEN to proxy the zips)."""
    if time.time() - _releases_cache["at"] < 60 and _releases_cache["data"]:
        return _releases_cache["data"]
    try:
        runs = _gh(f"https://api.github.com/repos/{GITHUB_REPO}/actions/workflows/android.yml/runs?status=success&per_page=1")["workflow_runs"]
        if not runs:
            return {"ok": False, "error": "no successful run yet"}
        run = runs[0]
        arts = _gh(run["artifacts_url"])["artifacts"]
        data = {"ok": True, "repo": GITHUB_REPO, "run": {"id": run["id"], "sha": run["head_sha"][:7], "message": run["head_commit"]["message"].split("\n")[0], "at": run["updated_at"], "url": run["html_url"]},
                "artifacts": [{"id": a["id"], "name": a["name"], "size": a["size_in_bytes"], "expires": a["expires_at"], "download": f"/api/releases/download/{a['id']}/{a['name']}", "proxied": bool(_gh_token())} for a in arts],
                "packages": f"https://github.com/{GITHUB_REPO}/packages", "actions": f"https://github.com/{GITHUB_REPO}/actions/workflows/android.yml"}
        _releases_cache.update(at=time.time(), data=data)
        return data
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "actions": f"https://github.com/{GITHUB_REPO}/actions/workflows/android.yml"}


@app.get("/api/releases/download/{artifact_id}/{name}")
def release_download(artifact_id: int, name: str) -> Response:
    """Proxies a CI artifact (GitHub requires a token for artifact zips); single-file artifacts like the APK are unzipped."""
    if not _gh_token():
        raise HTTPException(403, "set GITHUB_TOKEN on the API to download CI artifacts directly; otherwise use the run page")
    req = urllib.request.Request(f"https://api.github.com/repos/{GITHUB_REPO}/actions/artifacts/{artifact_id}/zip", headers={"authorization": f"Bearer {_gh_token()}", "user-agent": "axf-console"})
    with urllib.request.urlopen(req, timeout=120) as r:
        blob = r.read()
    z = zipfile.ZipFile(BytesIO(blob))
    files = [n for n in z.namelist() if not n.endswith("/")]
    if len(files) == 1:
        fname = files[0].split("/")[-1]
        return Response(z.read(files[0]), media_type="application/vnd.android.package-archive" if fname.endswith(".apk") else "application/octet-stream", headers={"content-disposition": f'attachment; filename="{fname}"'})
    return Response(blob, media_type="application/zip", headers={"content-disposition": f'attachment; filename="{name}.zip"'})


@app.get("/panel")
def panel() -> HTMLResponse:
    """The server control panel (deploy/panel/index.html) — same origin, so its terminal and server controls are live."""
    if not PANEL.exists():
        raise HTTPException(404, "deploy/panel/index.html missing")
    return HTMLResponse(PANEL.read_text())


# ---------------------------------------------------------------- MCP (Model Context Protocol) at /mcp

from mcp.server.transport_security import TransportSecuritySettings  # noqa: E402
from starlette.routing import Route  # noqa: E402
from starlette.types import Receive, Scope, Send  # noqa: E402

from mcp_server import build_server  # noqa: E402

_mcp = build_server(lambda op, **a: engine(op, "mcp", **a), terminal=lambda since: [l for l in _state["terminal"] if l["at"] > since])
# Stateless JSON responses: works behind Traefik/Coolify and across container restarts. Host checks are off because
# the endpoint is reached through a proxy under the console's own domain; the bearer token is the gate.
_mcp_http = _mcp.streamable_http_app(streamable_http_path="/mcp", stateless_http=True, json_response=True,
                                     transport_security=TransportSecuritySettings(enable_dns_rebinding_protection=False))


class _McpEndpoint:
    """/mcp — same Bearer AXF_TOKEN as the API's write routes. A class (not a function) so Starlette passes every
    HTTP method through as raw ASGI."""

    async def __call__(self, scope: Scope, receive: Receive, send: Send) -> None:
        tok = current_token()
        if scope["type"] == "http" and tok:
            sent = dict(scope.get("headers") or []).get(b"authorization", b"").decode()
            if sent != f"Bearer {tok}":
                await JSONResponse({"error": "unauthorized — send Authorization: Bearer <AXF_TOKEN>"}, status_code=401, headers={"www-authenticate": "Bearer"})(scope, receive, send)
                return
        await _mcp_http(scope, receive, send)


app.router.routes.insert(0, Route("/mcp", endpoint=_McpEndpoint()))
if not current_token():
    log("mcp", "AXF_TOKEN is not set — /mcp and the write routes are open; set it before exposing this server", "warn")


@app.get("/api/mcp")
def mcp_info(request: Request) -> dict[str, Any]:
    """How to connect Claude to this console's MCP endpoint."""
    # Behind Traefik/Coolify the container only sees plain http; the proxy's X-Forwarded-* headers carry what the
    # client actually used, so the advertised URL is https://console.amberxai.com/mcp rather than http://.
    proto = (request.headers.get("x-forwarded-proto") or request.url.scheme).split(",")[0].strip()
    host = (request.headers.get("x-forwarded-host") or request.headers.get("host") or "localhost").split(",")[0].strip()
    base = f"{proto if proto in ('http', 'https') else request.url.scheme}://{host}"
    url = f"{base}/mcp"
    tools = [t.name for t in _mcp._tool_manager.list_tools()]  # noqa: SLF001
    return {"url": url, "auth": "Bearer AXF_TOKEN" if current_token() else "none (AXF_TOKEN not set)", "tools": tools,
            "claudeCode": f'claude mcp add --transport http axf {url} --header "Authorization: Bearer $AXF_TOKEN"',
            "local": "python3 apps/console-web/server/mcp_server.py   (stdio, from a local clone; registered in .mcp.json)"}


# ---------------------------------------------------------------- plugins
#
# Console plugins live in apps/console-web/plugins/<folder>/ (see plugins/README.md):
#   plugin.json          plugin@1 manifest (targets must include "axf-console")
#   web/index.tsx        exports `plugin: AxfWebLibrary` (views, nav, actions) — bundled by Vite
#   server/__init__.py   optional; exports `router: fastapi.APIRouter`, mounted at /api/plugins/<folder>/
# Every plugin route requires the console token for EVERY method (not only writes), and answers 404
# while the plugin is disabled. Plugin routes are never exposed through the console's MCP server.
# Folders starting with "_" (templates) are ignored.

import importlib.util
import re as _re
import sys as _sys

PLUGINS_DIR = HERE.parent / "plugins"
_PLUGIN_FOLDER = _re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
_PLUGIN_ID = _re.compile(r"^[a-z][a-z0-9]*(\.[a-z][a-z0-9-]*)+$")
PLUGINS: dict[str, dict[str, Any]] = {}


_ws_tickets: dict[str, tuple[float, str]] = {}
_ws_lock = __import__("threading").Lock()


def auth_always(request: HTTPConnection) -> None:
    """Console token for every method. Plugin data (services, logs, settings) is private even to read.
    WebSockets can't send an Authorization header, so they present a one-time ticket from POST /api/ws-ticket
    (single use, 30 s, bound to the path it was issued for); the token itself never goes in a URL."""
    tok = current_token()
    if request.scope.get("type") == "websocket":
        c = wall.wall_caller(request.headers)
        if (c and not c.admin) or wall.malformed_session(request.headers):
            raise WebSocketException(code=4403, reason="admins only")
        if not tok:
            if wall.trusted():
                raise WebSocketException(code=4401, reason="console token required")
            return
        t = request.query_params.get("ticket", "")
        with _ws_lock:
            v = _ws_tickets.pop(t, None) if t else None
        if not v or v[0] < time.time() or not request.url.path.startswith(v[1]):
            raise WebSocketException(code=4401, reason="ticket required (POST /api/ws-ticket)")
        return
    if not tok or _token_ok(request, tok):
        request.state.axf_user = wall.TOKEN_CALLER
        return
    if _wall_admin(request):
        return
    raise HTTPException(401, "console token required (Authorization: Bearer AXF_TOKEN)")


def _plugin_auth(wall_users: bool, folder: str = ""):
    """Plugin routes: the console token or a wall admin, plus wall *users* for plugins that opt in ("wallUsers": true)
    or that an admin granted them (hub permission console.plugin.<folder>). The plugin then limits what a user may do
    from request.state.axf_user."""
    def dep(request: HTTPConnection) -> None:
        if request.scope.get("type") == "http":
            c = wall.wall_caller(request.headers)
            if c and not c.admin and wall.plugin_granted(c, folder, frozenset({folder}) if wall_users else frozenset(), USER_GRANTABLE_PLUGINS):
                if not wall.same_origin(request):
                    raise HTTPException(403, "cross-site request refused")
                request.state.axf_user = c
                return
        auth_always(request)
    return dep


@app.post("/api/ws-ticket", dependencies=[Depends(auth_always)])
def ws_ticket(body: dict[str, Any]) -> dict[str, Any]:
    """A one-time ticket for a plugin WebSocket (``{"path": "/api/plugins/<folder>/…"}``), valid 30 s."""
    path = str(body.get("path") or "")
    if not _re.match(r"^/api/plugins/[a-z0-9-]+/[A-Za-z0-9/_.-]*$", path) or ".." in path:
        raise HTTPException(400, "path must be a plugin route (/api/plugins/<folder>/…)")
    now = time.time()
    t = secrets.token_urlsafe(24)
    with _ws_lock:
        for k in [k for k, v in _ws_tickets.items() if v[0] < now]:
            _ws_tickets.pop(k, None)
        if len(_ws_tickets) > 500:
            raise HTTPException(429, "too many open tickets")
        _ws_tickets[t] = (now + 30, path)
    return {"ticket": t, "expiresIn": 30}


def plugin_enabled(folder: str) -> bool:
    info = PLUGINS.get(folder)
    if not info or info.get("removed"):
        return False
    return bool(_state.get("plugins", {}).get(folder, info.get("enabledByDefault", True)))


def _plugin_guard(folder: str):
    def guard() -> None:
        if not plugin_enabled(folder):
            raise HTTPException(404, f"plugin {folder} is disabled")
    return guard


def _read_plugin_manifest(folder: Path) -> dict[str, Any]:
    raw = json.loads((folder / "plugin.json").read_text())
    if not isinstance(raw, dict) or raw.get("$axf") != "plugin@1":
        raise ValueError('plugin.json must be a plugin@1 manifest ("$axf": "plugin@1")')
    for key in ("id", "name", "version", "kind", "apiLevel"):
        if key not in raw:
            raise ValueError(f"plugin.json is missing {key!r}")
    if not isinstance(raw["id"], str) or not _PLUGIN_ID.match(raw["id"]):
        raise ValueError("plugin id must be namespaced, e.g. ai.amberx.axf.console.hub")
    if "axf-console" not in (raw.get("targets") or []):
        raise ValueError('plugin.json targets must include "axf-console"')
    return raw


def load_plugins() -> None:
    """Discover plugins and mount their server routers. A broken plugin is reported, never fatal."""
    if not PLUGINS_DIR.is_dir():
        return
    # Parent package for plugin server parts, so a plugin can split its server into modules (`from . import x`).
    if "axf_console_plugins" not in _sys.modules:
        import types as _types
        pkg = _types.ModuleType("axf_console_plugins")
        pkg.__path__ = []  # type: ignore[attr-defined]
        _sys.modules["axf_console_plugins"] = pkg
    for folder in sorted(PLUGINS_DIR.iterdir()):
        if not folder.is_dir() or folder.name.startswith("_") or not (folder / "plugin.json").exists():
            continue
        info: dict[str, Any] = {"folder": folder.name, "server": "none", "error": None}
        PLUGINS[folder.name] = info
        try:
            if not _PLUGIN_FOLDER.match(folder.name):
                raise ValueError("plugin folder names are lowercase letters, digits and dashes")
            m = _read_plugin_manifest(folder)
            info.update({
                "id": m["id"], "name": m["name"], "version": m["version"], "description": m.get("description", ""),
                "author": m.get("author", ""), "provides": m.get("provides", []), "scopes": m.get("scopes", []),
                "enabledByDefault": m.get("enabledByDefault", True) is not False,
                "wallUsers": m.get("wallUsers") is True, "userGrantable": m.get("userGrantable") is True,
            })
            entry = folder / "server" / "__init__.py"
            if entry.exists():
                name = f"axf_console_plugins.{folder.name.replace('-', '_')}"
                spec = importlib.util.spec_from_file_location(name, entry, submodule_search_locations=[str(entry.parent)])
                if not spec or not spec.loader:
                    raise ImportError("cannot load server/__init__.py")
                module = importlib.util.module_from_spec(spec)
                _sys.modules[name] = module
                spec.loader.exec_module(module)
                router = getattr(module, "router", None)
                if router is None:
                    raise ImportError("server/__init__.py must export `router` (fastapi.APIRouter)")
                app.include_router(router, prefix=f"/api/plugins/{folder.name}",
                                   dependencies=[Depends(_plugin_auth(m.get("wallUsers") is True, folder.name)), Depends(_plugin_guard(folder.name))])
                info["server"] = "loaded"
            log("plugins", f"{info.get('name', folder.name)} {info.get('version', '')} loaded ({info['server']} server)")
        except Exception as e:  # noqa: BLE001 — one bad plugin must not stop the console
            info["error"] = f"{type(e).__name__}: {str(e)[:300]}"
            info["server"] = "error" if (folder / "server").exists() else info["server"]
            log("plugins", f"{folder.name}: {info['error']}", "error")


def _prune_plugin_state() -> None:
    """A plugin whose folder is gone leaves no enabled flag behind (plugin-lifecycle@1)."""
    known = _state.get("plugins", {})
    gone = [f for f in known if f not in PLUGINS]
    for f in gone:
        known.pop(f, None)
    if gone:
        _save_state()


@app.get("/api/plugins")
def list_plugins(request: Request) -> dict[str, Any]:
    # A signed-in hub user sees a plugin as on only when it's on and granted to them (or open to every user).
    c = wall.wall_caller(request.headers)
    def on(f: str) -> bool:
        if not plugin_enabled(f):
            return False
        return not c or wall.plugin_granted(c, f, WALL_USER_PLUGINS, USER_GRANTABLE_PLUGINS)
    return {"items": [{**info, "enabled": on(f)} for f, info in PLUGINS.items()]}


@app.post("/api/plugins/{folder}/enabled", dependencies=[Depends(auth)])
def set_plugin_enabled(folder: str, body: dict[str, Any]) -> dict[str, Any]:
    if folder not in PLUGINS:
        raise HTTPException(404, f"no plugin {folder}")
    on = bool(body.get("enabled"))
    _state.setdefault("plugins", {})[folder] = on
    _save_state()
    log("plugins", f"{PLUGINS[folder].get('name', folder)} {'enabled' if on else 'disabled'}")
    return {"ok": True, "folder": folder, "enabled": on}


import plugin_services  # noqa: E402 — generic cross-plugin services (capability names, never plugin folders)

plugin_services.configure(plugin_enabled)

# Core context + credentials for plugins (the systems-check plugin, alerts and every feature read the same env).
import console_context  # noqa: E402
import credentials  # noqa: E402

credentials.init(ROOT)
console_context.set_context(ROOT=ROOT, GITHUB_REPO=GITHUB_REPO, PLUGINS=PLUGINS, current_token=current_token, persist_root=_persist_root,
                            log=log, plugin_enabled=plugin_enabled, terminal_lines=lambda: list(_state.get("terminal", [])))

load_plugins()
_prune_plugin_state()
WALL_USER_PLUGINS = frozenset(f for f, i in PLUGINS.items() if i.get("wallUsers") is True)
USER_GRANTABLE_PLUGINS = frozenset(f for f, i in PLUGINS.items() if i.get("userGrantable") is True)


@app.get("/api/plugin-services", dependencies=[Depends(auth_always)])
def list_plugin_services() -> dict[str, Any]:
    return {"items": plugin_services.available()}


# ---------------------------------------------------------------- plugin lifecycle (framework/cli/plugin-lifecycle.mjs)
#
# Generic install / uninstall / stale-check for every plugin (plugin-lifecycle@1). These routes are the console's,
# not a plugin's, so they keep working while a plugin is disabled or after its code is gone. One action at a time.

import threading as _threading  # noqa: E402

LIFECYCLE = ROOT / "framework" / "cli" / "plugin-lifecycle.mjs"
_lifecycle_lock = _threading.Lock()


def _lifecycle(args: list[str], timeout: int = 300) -> dict[str, Any]:
    proc = subprocess.run(["node", str(LIFECYCLE), *args, "--json"], cwd=ROOT, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "AXF_ROOT": str(ROOT), "AXF_STATE": str(STATE)})
    try:
        out = json.loads((proc.stdout or "").strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise HTTPException(500, f"plugin-lifecycle failed: {(proc.stderr or proc.stdout)[-400:]}") from None
    if not out.get("ok"):
        raise HTTPException(400, out.get("error", "plugin-lifecycle failed"))
    return out


@app.get("/api/plugin-lifecycle", dependencies=[Depends(auth_always)])
def lifecycle_list() -> dict[str, Any]:
    return _lifecycle(["list"])


@app.get("/api/plugin-lifecycle/{folder}", dependencies=[Depends(auth_always)])
def lifecycle_status(folder: str) -> dict[str, Any]:
    if not _PLUGIN_FOLDER.match(folder):
        raise HTTPException(400, "bad plugin folder")
    out = _lifecycle(["status", folder])
    out["loaded"] = folder in PLUGINS and not PLUGINS[folder].get("removed")
    out["enabled"] = plugin_enabled(folder)
    return out


@app.post("/api/plugin-lifecycle/{folder}/{action}", dependencies=[Depends(auth)])
def lifecycle_action(folder: str, action: str, body: dict[str, Any]) -> dict[str, Any]:
    if not _PLUGIN_FOLDER.match(folder):
        raise HTTPException(400, "bad plugin folder")
    if not _lifecycle_lock.acquire(blocking=False):
        raise HTTPException(409, "another plugin install/uninstall is running")
    try:
        if action == "install":
            out = _lifecycle(["install", folder, "--no-state"])
            _state.setdefault("plugins", {})[folder] = True
            _save_state()
            log("plugins", f"{folder} installed (data folder + hooks)")
            return out
        if action == "check":
            return _lifecycle(["check", folder] + (["--after-uninstall"] if body.get("afterUninstall") else []))
        if action == "restore":
            return _lifecycle(["restore", folder, str(body.get("backup", ""))])
        if action != "uninstall":
            raise HTTPException(404, f"unknown lifecycle action {action}")
        dry = bool(body.get("dryRun"))
        if not dry and body.get("confirm") != folder:
            raise HTTPException(400, f'type the plugin folder name ("{folder}") to confirm')
        args = ["uninstall", folder, "--no-state"]
        for flag in ("data", "code", "all", "publish"):
            if body.get(flag):
                args.append(f"--{flag}")
        if body.get("backup") is False:
            args.append("--no-backup")
        if dry:
            args.append("--dry-run")
        out = _lifecycle(args, timeout=600)
        if not dry:
            if not out.get("code"):
                # data only: the code stays, so keep it OFF (it would otherwise come back enabled by default and recreate its data)
                _state.setdefault("plugins", {})[folder] = False
                _save_state()
            if out.get("code"):
                plugin_services.withdraw(folder)
                if folder in PLUGINS:
                    PLUGINS[folder]["removed"] = True
                    PLUGINS[folder]["enabledByDefault"] = False  # its routes 404 until the console restarts without it
                _state.get("plugins", {}).pop(folder, None)
                _save_state()
                out["restartNeeded"] = True
            log("plugins", f"{folder} uninstalled ({'code + ' if out.get('code') else ''}{'data' if out.get('data') else 'no data'})")
        return out
    finally:
        _lifecycle_lock.release()

# The systems check lives in a plugin that provides axf.syscheck@1; alerts use it when it's installed.


def _systems_checks() -> list[dict[str, Any]]:
    sc = plugin_services.get("axf.syscheck@1")
    return sc.run_all() if sc else []

# ---------------------------------------------------------------- developer alerts (server/alerts.py)

import alerts as alerts_hub  # noqa: E402


def _pending_file() -> Path:
    root = _persist_root()
    hub_copy = root / "framework" / "plan" / "pending.json" if root else None
    return hub_copy if hub_copy and hub_copy.is_file() else ROOT / "framework" / "plan" / "pending.json"


ALERTS = alerts_hub.AlertHub(STATE.parent, log=log, github_token=_gh_token, default_repos=[GITHUB_REPO],
                             systems=_systems_checks, pending_file=_pending_file, plugins=PLUGINS)
app.include_router(alerts_hub.router_for(ALERTS, auth_always))


async def _alert_on_crash(request: Request, exc: Exception) -> JSONResponse:
    """An unhandled API error becomes a crash alert, keyed by the route template (never the raw path, so random URLs
    can't make new alerts) and rate-limited in the hub; the client gets the usual 500. Runs inside Starlette's
    ServerErrorMiddleware, so no route's streaming behaviour changes."""
    from starlette.concurrency import run_in_threadpool

    route = getattr(request.scope.get("route"), "path", None) or "unrouted"
    await run_in_threadpool(ALERTS.crash, f"api {request.method} {route}", exc)
    return JSONResponse({"detail": "Internal Server Error"}, status_code=500)


app.add_exception_handler(Exception, _alert_on_crash)


# ---------------------------------------------------------------- the console itself

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "data").exists():
        app.mount("/data", StaticFiles(directory=DIST / "data"), name="data")

    _DIST_ROOT = DIST.resolve()

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        # Never serve anything outside dist/: the path arrives decoded, so ../ (also as %2e%2e or %2f) must be refused here.
        try:
            f = (_DIST_ROOT / path).resolve()
            is_file = bool(path) and f.is_relative_to(_DIST_ROOT) and f.is_file()
        except (OSError, ValueError, RuntimeError):  # a path too long, with a NUL byte or a symlink loop is simply not a file
            is_file = False
        return FileResponse(f if is_file else _DIST_ROOT / "index.html")
