"""Chain control API (chain-control@1), the console's own routes at /api/chain-control. Both the Claude plugin and MD Studio
mount the same controls (src/chainControl.tsx) over these routes, so the registry keeps working whichever of them is off.
Everything goes through framework/cli/chain-control.mjs, the one store the launcher, the CLI and MCP also use.

    GET  /state?build=&step=&model=     everything the controls show: config, chain rows, cost preview, presets, history
    GET  /events?since=<rev>            change events after a rev
    GET  /history                       every change, newest first
    GET  /file?path=                    one chain file with its version
    PUT  /file                          {path, content, if_version} conflict-safe; the replaced text can be restored
    POST /set                           {patch, build?, step?}
    POST /clear                         {build, step?}
    POST /file-mode                     {path, mode, build?, step?}
    POST /order                         {paths, build?, step?}
    POST /preset                        {action: apply|save|delete, id?, name?}
    POST /reset                         back to the Lean preset, overrides gone
    POST /restore                       {rev}
    GET  /compare?before=&after=        token log totals side by side
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, Query, Request
from fastapi.responses import JSONResponse

ROOT = Path(__file__).resolve().parents[3]
CLI = ROOT / "framework" / "cli" / "chain-control.mjs"
STATUS = {"invalid": 400, "usage": 400, "denied": 403, "not_found": 404, "conflict": 409, "busy": 503, "unavailable": 503}

router = APIRouter()


def cli(*args: str, stdin: dict[str, Any] | None = None) -> dict[str, Any]:
    """One chain-control.mjs command; the same call MCP makes."""
    try:
        p = subprocess.run(["node", str(CLI), *args, "--json"], input=json.dumps(stdin) if stdin is not None else "", cwd=ROOT, capture_output=True, text=True, timeout=30)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"chain control could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


def by(request: Request) -> list[str]:
    return ["--by", str(getattr(getattr(request.state, "axf_user", None), "name", "") or "console")]


def level(body: dict[str, Any]) -> list[str]:
    """The --build / --step of a request, when it names them."""
    return [x for k in ("build", "step") if isinstance(body.get(k), str) and body[k] for x in (f"--{k}", body[k])]


@router.get("/state")
def state(build: str = "", step: str = "", model: str = "opus") -> JSONResponse:
    return answer(cli("state", *level({"build": build, "step": step}), "--model", model[:40]))


@router.get("/events")
def events(since: int = 0) -> JSONResponse:
    return answer(cli("events", "--since", str(since)))


@router.get("/history")
def history(limit: int = 50) -> JSONResponse:
    return answer(cli("history", "--limit", str(limit)))


@router.get("/file")
def read_file(path: str = Query(...)) -> JSONResponse:
    return answer(cli("read", path))


@router.put("/file")
def write_file(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    return answer(cli("write", str(body.get("path") or ""), *by(request), stdin={"content": body.get("content"), "if_version": body.get("if_version")}))


@router.post("/set")
def set_config(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    return answer(cli("set", *level(body), *by(request), stdin={"patch": body.get("patch")}))


@router.post("/clear")
def clear(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    return answer(cli("clear", *level(body), *by(request)))


@router.post("/file-mode")
def file_mode(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    return answer(cli("file", str(body.get("path") or ""), str(body.get("mode") or ""), *level(body), *by(request)))


@router.post("/order")
def order(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    paths = body.get("paths") if isinstance(body.get("paths"), list) else []
    return answer(cli("order", ",".join(str(p) for p in paths), *level(body), *by(request)))


@router.post("/preset")
def preset(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    action = str(body.get("action") or "")
    if action not in ("apply", "save", "delete"):
        return answer({"ok": False, "code": "invalid", "message": "action: apply, save or delete"})
    return answer(cli("preset", action, str(body.get("name") or body.get("id") or ""), *by(request)))


@router.post("/reset")
def reset(request: Request) -> JSONResponse:
    return answer(cli("reset", *by(request)))


@router.post("/restore")
def restore(request: Request, body: dict[str, Any] = Body(...)) -> JSONResponse:
    return answer(cli("restore", str(body.get("rev") or ""), *by(request)))


@router.get("/compare")
def compare(before: str = "", after: str = "") -> JSONResponse:
    return answer(cli("compare", "--before", before, "--after", after))
