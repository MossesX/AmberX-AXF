"""
AXF Dev Console API — the Python half of the console.

FastAPI service that fronts the framework's build engine (framework/cli, Node) for the React console:
  GET  /api/health | catalog | tracker | libraries | boilerplates | boilerplates/items | modules | templates | ported-kits | project | terminal
  POST /api/status | project | boilerplates/save | init | validate | new-asset | new-module | new-demo | install | import-ui
  GET  /api/events        server-sent events: every engine log line as it happens (the console's output terminal follows it)
  /                        the built console (apps/console-web/dist) when present

Run locally:  cd apps/console-web/server && pip install -r requirements.txt && uvicorn main:app --port 7090 --reload
Deploy:       the Dockerfile next to this file (Node 22 + Python 3.12) — Coolify builds it straight from the repo.
Config:       AXF_ROOT (repo root, default: ../../.. from here), AXF_TOKEN (optional bearer token for POST routes),
              AXF_STATE (where project/terminal state is kept, default: <root>/.axf-console/state.json)
"""
from __future__ import annotations

import asyncio
import json
import os
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

from fastapi import Depends, FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, HTMLResponse, JSONResponse, Response, StreamingResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("AXF_ROOT", HERE.parent.parent.parent)).resolve()
RPC = ROOT / "framework" / "cli" / "engine-rpc.mjs"
STATE = Path(os.environ.get("AXF_STATE", ROOT / ".axf-console" / "state.json"))
TOKEN = os.environ.get("AXF_TOKEN", "")
DIST = HERE.parent / "dist"

app = FastAPI(title="AXF Dev Console API", version="0.2.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])
PANEL = ROOT / "deploy" / "panel" / "index.html"
GITHUB_REPO = os.environ.get("AXF_GITHUB_REPO", "MossesX/AmberX-AXF")
GITHUB_TOKEN = os.environ.get("GITHUB_TOKEN", "")

# ---------------------------------------------------------------- state + terminal

_state: dict[str, Any] = {"project": "", "terminal": []}
_subscribers: set[asyncio.Queue[dict[str, Any]]] = set()


def _load_state() -> None:
    if STATE.exists():
        try:
            _state.update(json.loads(STATE.read_text()))
        except json.JSONDecodeError:
            pass


def _save_state() -> None:
    STATE.parent.mkdir(parents=True, exist_ok=True)
    STATE.write_text(json.dumps({"project": _state["project"], "terminal": _state["terminal"][-500:]}, indent=2))


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


def auth(request: Request) -> None:
    if TOKEN and request.headers.get("authorization") != f"Bearer {TOKEN}":
        raise HTTPException(401, "unauthorized")


def ok_or_500(r: dict[str, Any]) -> dict[str, Any]:
    if not r.get("ok"):
        return JSONResponse(r, status_code=500)  # type: ignore[return-value]
    return r


# ---------------------------------------------------------------- reads


@app.get("/api/health")
def health() -> dict[str, Any]:
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


@app.get("/api/modules")
def modules() -> Any:
    return engine("modules")


@app.get("/api/templates")
def templates() -> Any:
    return engine("templates")


@app.get("/api/ported-kits")
def ported_kits() -> Any:
    return engine("ported-kits")


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


for _name, _channel in [("init", "init"), ("validate", "validate"), ("new-asset", "assets"), ("new-module", "build"), ("new-demo", "build"), ("install", "install"), ("import-ui", "import")]:
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


# ---------------------------------------------------------------- embedded terminal (WebSocket ↔ pty)


@app.websocket("/api/shell")
async def shell(ws: WebSocket) -> None:
    """A real shell on this host for the control panel's terminal. Protected by AXF_TOKEN (?token=…) when set."""
    if TOKEN and ws.query_params.get("token") != TOKEN:
        await ws.close(code=4401)
        return
    await ws.accept()
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
    except WebSocketDisconnect:
        pass
    finally:
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
    req = urllib.request.Request(url, headers={"accept": "application/vnd.github+json", "user-agent": "axf-console", **({"authorization": f"Bearer {GITHUB_TOKEN}"} if GITHUB_TOKEN else {})})
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
                "artifacts": [{"id": a["id"], "name": a["name"], "size": a["size_in_bytes"], "expires": a["expires_at"], "download": f"/api/releases/download/{a['id']}/{a['name']}", "proxied": bool(GITHUB_TOKEN)} for a in arts],
                "packages": f"https://github.com/{GITHUB_REPO}/packages", "actions": f"https://github.com/{GITHUB_REPO}/actions/workflows/android.yml"}
        _releases_cache.update(at=time.time(), data=data)
        return data
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "error": str(e), "actions": f"https://github.com/{GITHUB_REPO}/actions/workflows/android.yml"}


@app.get("/api/releases/download/{artifact_id}/{name}")
def release_download(artifact_id: int, name: str) -> Response:
    """Proxies a CI artifact (GitHub requires a token for artifact zips); single-file artifacts like the APK are unzipped."""
    if not GITHUB_TOKEN:
        raise HTTPException(403, "set GITHUB_TOKEN on the API to download CI artifacts directly; otherwise use the run page")
    req = urllib.request.Request(f"https://api.github.com/repos/{GITHUB_REPO}/actions/artifacts/{artifact_id}/zip", headers={"authorization": f"Bearer {GITHUB_TOKEN}", "user-agent": "axf-console"})
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


# ---------------------------------------------------------------- the console itself

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "data").exists():
        app.mount("/data", StaticFiles(directory=DIST / "data"), name="data")

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
