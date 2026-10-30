"""Design packs (server part). Mounted at /api/plugins/design-packs/ (console token on every route, 404 while off).

  GET  index                 packs/index.json: every round's packs and their screenshot files
  GET  shot?path=<r>/<file>  one screenshot (png/jpg/webp inside packs/, nothing else)
  GET  picks                 the packs picked so far
  PUT  picks  {picked: [ids]}  save the picks (at most 12 ids)
"""
from __future__ import annotations

import json
import os
import re
import time
from pathlib import Path

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import console_context as cx

router = APIRouter()
HERE = Path(__file__).resolve().parent.parent
PACKS = HERE / "packs"
_SHOT = re.compile(r"^r\d{1,3}/[a-z0-9][a-z0-9-]{0,120}\.(png|jpg|jpeg|webp)$")
_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_DESIGN_PACKS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "design-packs"))


@router.get("/index")
def index() -> dict:
    try:
        return json.loads((PACKS / "index.json").read_text())
    except FileNotFoundError:
        return {"packs": []}


@router.get("/shot")
def shot(path: str = ""):
    if not _SHOT.match(path):
        raise HTTPException(400, "bad screenshot path")
    f = (PACKS / path).resolve()
    if PACKS.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "no such screenshot")
    return FileResponse(f, media_type=TYPES[f.suffix[1:].lower()], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/picks")
def get_picks() -> dict:
    try:
        return json.loads((data_dir() / "picks.json").read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return {"picked": [], "at": ""}


@router.put("/picks")
async def put_picks(request: Request) -> dict:
    raw = await request.body()
    if len(raw) > 8192:
        raise HTTPException(413, "too big")
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError as e:
        raise HTTPException(400, "not JSON") from e
    picked = body.get("picked") if isinstance(body, dict) else None
    if not isinstance(picked, list) or len(picked) > 12 or not all(isinstance(x, str) and _ID.match(x) for x in picked):
        raise HTTPException(400, "picked must be a list of up to 12 pack ids")
    doc = {"picked": picked, "at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())}
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "picks.json.tmp"
    tmp.write_text(json.dumps(doc))
    tmp.replace(d / "picks.json")
    return {"ok": True, **doc}
