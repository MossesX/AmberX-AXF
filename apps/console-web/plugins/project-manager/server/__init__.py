"""Server part of the Project Manager plugin (project-manager@1). Mounted at /api/plugins/project-manager/.

Every read and write goes through the plugin's Node CLI (projects.mjs json <op> -> core.mjs), so the console, the MCP
tools (plugin-commands@1), the CLI and voice share one store and one set of rules.

  GET  projects            every project (type, console link, data counts) + the settings
  GET  projects/{id}       one project
  POST projects            create { name, type: app|framework, description?, root?, previewUrl?, scaffold? }
  POST rename              { id, name }
  POST update              { id, name?, type?, description?, previewUrl? }
  POST open                { id }: switch to it (the active project)
  POST close               { id }: close its tab in the multi-project view
  POST delete              { id, data? }: remove it (data = also its builds/notes/data folder)
  PUT  settings            { multiView?, layout?: tabs|split, active? }
  POST preview             { open?, mode?: float|dock, side?: right|bottom, project? }
"""
from __future__ import annotations

import json
import subprocess
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Request
from fastapi.concurrency import run_in_threadpool
from fastapi.responses import JSONResponse

router = APIRouter()
CLI = Path(__file__).resolve().parents[1] / "projects.mjs"
ROOT = Path(__file__).resolve().parents[5]  # the repo root
STATUS = {"invalid": 400, "not_found": 404, "unavailable": 503}


def cli(op: str, inp: dict[str, Any] | None = None, timeout: int = 20) -> dict[str, Any]:
    try:
        p = subprocess.run(["node", str(CLI), "json", op, "--json"], input=json.dumps(inp or {}), cwd=ROOT,
                           capture_output=True, text=True, timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        return {"ok": False, "code": "unavailable", "message": f"project manager could not run: {str(e)[:200]}"}
    lines = p.stdout.strip().splitlines()
    try:
        return json.loads(lines[-1]) if lines else {"ok": False, "code": "unexpected", "message": p.stderr.strip()[-400:] or "no output"}
    except json.JSONDecodeError:
        return {"ok": False, "code": "unexpected", "message": (p.stderr or p.stdout).strip()[-400:]}


def answer(r: dict[str, Any]) -> JSONResponse:
    return JSONResponse(r, status_code=200 if r.get("ok") else STATUS.get(str(r.get("code")), 500))


async def body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except (ValueError, json.JSONDecodeError):
        return {}
    return b if isinstance(b, dict) else {}


async def op(name: str, inp: dict[str, Any]) -> JSONResponse:
    return answer(await run_in_threadpool(cli, name, inp))


@router.get("/projects")
async def list_projects() -> JSONResponse:
    return await op("list", {})


@router.get("/projects/{pid}")
async def get_project(pid: str) -> JSONResponse:
    return await op("get", {"id": pid})


@router.post("/projects")
async def create_project(request: Request) -> JSONResponse:
    return await op("create", await body(request))


@router.post("/rename")
async def rename_project(request: Request) -> JSONResponse:
    return await op("rename", await body(request))


@router.post("/update")
async def update_project(request: Request) -> JSONResponse:
    return await op("update", await body(request))


@router.post("/open")
async def open_project(request: Request) -> JSONResponse:
    return await op("open", await body(request))


@router.post("/close")
async def close_project(request: Request) -> JSONResponse:
    return await op("close", await body(request))


@router.post("/delete")
async def delete_project(request: Request) -> JSONResponse:
    return await op("delete", await body(request))


@router.get("/settings")
async def get_settings() -> JSONResponse:
    return await op("settings", {})


@router.put("/settings")
async def put_settings(request: Request) -> JSONResponse:
    return await op("settings", await body(request))


@router.post("/preview")
async def set_preview(request: Request) -> JSONResponse:
    return await op("preview", await body(request))
