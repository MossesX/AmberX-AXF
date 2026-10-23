"""Session check-in — server part. Mounted at /api/plugins/session-checkin/.

The console adds two checks to every route: the console token (every method, reads included) and 404 while the
plugin is disabled. Plugin routes are never exposed through the console's MCP server.

Everything goes through the plugin's own Node scripts so the console, the terminal installer and the hook share one
implementation: install.mjs --json (status / preview / install / uninstall) and checkin.mjs (list / get / baseline /
detect). The installer only edits this clone's .claude/settings.local.json or .claude/settings.json (the "user"
target is installed on the device itself, from a terminal). Only our own hook entries are ever added or removed.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
from pathlib import Path
from typing import Any, Literal

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

router = APIRouter()

_PLUGIN = Path(__file__).resolve().parents[1]
_ROOT = _PLUGIN.parents[3]
_INSTALL = _PLUGIN / "install.mjs"
_CHECKIN = _PLUGIN / "checkin.mjs"
_PRICING = _PLUGIN / "baseline" / "pricing.json"  # fallback copy (older checkouts)
_SHARED_PRICING = _ROOT / "framework" / "schemas" / "model-pricing.json"  # model-pricing@1, shared with the changes hooks + Build manager
_ID = re.compile(r"^[\w.-]{1,80}$")
_MODELS = ("fable", "opus", "sonnet")


def _node(args: list[str], timeout: int = 60) -> dict[str, Any]:
    env = {**os.environ, "CLAUDE_PROJECT_DIR": str(_ROOT)}
    p = subprocess.run(["node", *args], cwd=_ROOT, stdin=subprocess.DEVNULL, capture_output=True, text=True, timeout=timeout, env=env)
    out = p.stdout.strip().splitlines()
    try:
        return json.loads(out[-1]) if out else {"ok": False, "error": (p.stderr or "no output").strip()[-600:]}
    except json.JSONDecodeError:
        return {"ok": False, "error": (p.stderr or p.stdout).strip()[-600:]}


def _installer(req: dict[str, Any]) -> dict[str, Any]:
    r = _node([str(_INSTALL), "--json", json.dumps({**req, "dir": str(_ROOT)})], timeout=300)
    if not r.get("ok"):
        raise HTTPException(400, r.get("error", "installer failed"))
    return r


class Config(BaseModel):
    questions: dict[str, bool] = Field(default_factory=dict)
    sources: list[Literal["startup", "resume", "clear", "compact", "fork"]] = Field(default_factory=lambda: ["startup"])
    allowSkip: bool = True
    allowSameAsLast: bool = True
    unattended: Literal["log", "off"] = "log"
    expected: dict[str, str] = Field(default_factory=dict)
    archive: str = "auto"
    memoryDirs: list[str] = Field(default_factory=lambda: ["_claude"])
    defaultEffort: Literal["low", "medium", "high", "xhigh", "max"] = "high"


class InstallReq(BaseModel):
    target: Literal["local", "shared"]
    config: Config = Field(default_factory=Config)


class UninstallReq(BaseModel):
    target: Literal["local", "shared"]


class Price(BaseModel):
    input: float = Field(ge=0, le=1000)
    output: float = Field(ge=0, le=1000)
    cacheRead: float | None = Field(default=None, ge=0, le=1000)


class PricingReq(BaseModel):
    asOf: str = Field(pattern=r"^\d{4}-\d{2}-\d{2}$")
    source: str = Field(default="", max_length=200)
    models: dict[Literal["fable", "opus", "sonnet"], Price]


@router.get("/status")
def status() -> dict[str, Any]:
    st = _installer({"action": "status"})
    lst = _node([str(_CHECKIN), "list", "--json", "--limit", "1"])
    return {**st, "archive": {"roots": lst.get("roots", [])}, "repo": str(_ROOT),
            "terminal": f"node {_INSTALL.relative_to(_ROOT)}"}


@router.post("/preview")
def preview(req: InstallReq) -> dict[str, Any]:
    return _installer({"action": "preview", "target": req.target, "config": req.config.model_dump()})


@router.post("/install")
def install(req: InstallReq) -> dict[str, Any]:
    # "shared" is committed and pushed to GitHub (the VPS clone resets to origin every 5 minutes)
    return _installer({"action": "install", "target": req.target, "config": req.config.model_dump(), "publish": req.target == "shared"})


@router.post("/uninstall")
def uninstall(req: UninstallReq) -> dict[str, Any]:
    return _installer({"action": "uninstall", "target": req.target, "publish": req.target == "shared"})


@router.get("/sessions")
def sessions(location: str = "", model: str = "", mismatch: bool = False, limit: int = 300) -> dict[str, Any]:
    args = [str(_CHECKIN), "list", "--json", "--limit", str(max(1, min(limit, 2000)))]
    if location:
        args += ["--location", location[:20]]
    if model in _MODELS:
        args += ["--model", model]
    if mismatch:
        args.append("--mismatch")
    r = _node(args)
    if "sessions" not in r:
        raise HTTPException(500, r.get("error", "could not read the archive"))
    return r


@router.get("/sessions/{sid}")
def session(sid: str) -> dict[str, Any]:
    if not _ID.match(sid):
        raise HTTPException(400, "bad session id")
    r = _node([str(_CHECKIN), "get", sid, "--json"])
    if not r.get("id"):
        raise HTTPException(404, "no such session")
    return r


@router.get("/baseline")
def baseline() -> dict[str, Any]:
    return _node([str(_CHECKIN), "baseline", "--json"])


@router.post("/pricing")
def pricing(req: PricingReq) -> dict[str, Any]:
    """Set the per-million-token prices used for the baseline estimate (copied from docs.claude.com)."""
    data = {"asOf": req.asOf, "source": req.source, "unit": "USD per million tokens",
            "models": {k: v.model_dump(exclude_none=True) for k, v in req.models.items()}}
    target = _SHARED_PRICING if _SHARED_PRICING.is_file() else _PRICING
    if target == _SHARED_PRICING:  # keep the shared file's other parts (format tag, cache-write prices, heuristic)
        try:
            cur = json.loads(_SHARED_PRICING.read_text())
        except (OSError, ValueError):
            cur = {}
        models = {k: {**(cur.get("models") or {}).get(k, {}), **v} for k, v in data["models"].items()}
        data = {**cur, **data, "models": {**(cur.get("models") or {}), **models}}
    tmp = target.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, indent=2) + "\n")
    tmp.replace(target)
    return {"ok": True, "pricing": data}


@router.get("/detect")
def detect() -> dict[str, Any]:
    """What a session started in this clone would see (from the console server, so location reads 'console')."""
    return _node([str(_CHECKIN), "detect", "--json", "--no-fetch", "--force"], timeout=30)
