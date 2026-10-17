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

from fastapi import Depends, FastAPI, HTTPException, Request
from fastapi.responses import FileResponse, JSONResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

HERE = Path(__file__).resolve().parent
ROOT = Path(os.environ.get("AXF_ROOT", HERE.parent.parent.parent)).resolve()
RPC = ROOT / "framework" / "cli" / "engine-rpc.mjs"
STATE = Path(os.environ.get("AXF_STATE", ROOT / ".axf-console" / "state.json"))
TOKEN = os.environ.get("AXF_TOKEN", "")
DIST = HERE.parent / "dist"

app = FastAPI(title="AXF Dev Console API", version="0.2.0")

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


# ---------------------------------------------------------------- the console itself

if DIST.exists():
    app.mount("/assets", StaticFiles(directory=DIST / "assets"), name="assets")
    if (DIST / "data").exists():
        app.mount("/data", StaticFiles(directory=DIST / "data"), name="data")

    @app.get("/{path:path}")
    def spa(path: str) -> FileResponse:
        f = DIST / path
        return FileResponse(f if path and f.is_file() else DIST / "index.html")
