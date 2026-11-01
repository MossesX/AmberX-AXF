"""UI Review (server part). Mounted at /api/plugins/ui-review/ (console token on every route, 404 while off).

Every UI a build makes is submitted here for Brett's approval (review-item@1), one section per kind (open registry).

  GET  kinds                  the kinds registry: kinds.json here + kinds.json in the data folder
  GET  items                  submitted items, saved decisions on design packs, the packs index and the picks
  POST submit  {kind, title, app?, build?, branch?, pr?, notes?, shots: [{name, device?, data: base64 | data URL}]}
  POST decide  {ids: [..], decision: approve|changes|reject|reopen, comment?}   one or many (bulk)
  POST remove  {ids: [..]}    take submitted items (and their screenshots) out
  GET  shot?path=r<n>/<file> | items/<id>/<file>    one screenshot (png/jpg/webp)
  GET  picks / PUT picks {picked: [ids]}             design-pack picks (the page allows 3)
  GET  state?branch=&pr=      ui-review@1: the strictest status of that branch's / PR's items, holds = don't merge yet
  …    shots/*                Screenshots tab (ui-screenshot@1, screenshots.py): ad-hoc pictures that never enter this
                              queue; shots/promote sends one in ("Send to review"), shots/migrate moves "Breakroom check:" items out

Capability ui-review@1 (plugin_services): state(branch, pr), holds(branch, pr), items(branch, pr), submit(fields, shots).
Data folder (AXF_UI_REVIEW_DIR): items.json, shots/<id>/, picks.json, kinds.json, screenshots/ (index.json + files/). On first start the old Design
packs data folder (its picks) moves in here.
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
import shutil
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import console_context as cx
import plugin_services

from .screenshots import Store as ShotStore, router_for as shots_router
from . import screenshots as shots_mod

router = APIRouter()
FOLDER = "ui-review"
HERE = Path(__file__).resolve().parent.parent
PACKS = HERE / "packs"
SCHEMA = "review-item@1"
STATUSES = ["waiting", "changes", "rejected", "approved"]
DECISIONS = {"approve": "approved", "changes": "changes", "reject": "rejected", "reopen": "waiting"}
_PACK_SHOT = re.compile(r"^r\d{1,3}/[a-z0-9][a-z0-9-]{0,120}\.(png|jpg|jpeg|webp)$")
_ITEM_SHOT = re.compile(r"^items/([a-z0-9][a-z0-9:._-]{0,80})/([a-z0-9][a-z0-9._-]{0,120}\.(png|jpg|jpeg|webp))$")
_ID = re.compile(r"^[a-z0-9][a-z0-9:._-]{0,80}$")
_KIND = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_PACK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
MAX_SHOT = 8 * 1024 * 1024
MAX_BODY = 48 * 1024 * 1024
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_UI_REVIEW_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _old_dir() -> Path:
    """Where the Design packs plugin kept its picks before it became UI Review."""
    return Path(os.environ.get("AXF_UI_REVIEW_OLD_DIR") or (data_dir().parent / "design-packs"))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, indent=1))
    tmp.replace(path)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def migrate() -> dict:
    """Move the old Design packs data folder (picks.json) into this one, once. Safe to call any time."""
    old, new = _old_dir(), data_dir()
    if not old.is_dir() or old.resolve() == new.resolve():
        return {"migrated": False}
    new.mkdir(parents=True, exist_ok=True)
    moved = []
    for f in old.iterdir():
        dest = new / f.name
        if f.is_file() and not dest.exists():
            shutil.copy2(f, dest)
            moved.append(f.name)
    _write(new / "migrated.json", {"from": str(old), "files": moved, "at": _now()})
    shutil.rmtree(old, ignore_errors=True)
    return {"migrated": True, "files": moved}


def _items_doc() -> dict:
    d = _read(data_dir() / "items.json", None)
    if not isinstance(d, dict) or not isinstance(d.get("items"), list):
        d = {"$axf": "ui-review-items@1", "items": []}
    return d


def _s(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _device(name: str) -> str:
    return "phone" if re.search(r"(^|[-_.])phone([-_.]|$)", name, re.I) else "desktop"


def _shot_name(file: str) -> str:
    stem = re.sub(r"\.[a-z0-9]+$", "", file.split("/")[-1], flags=re.I)
    stem = re.sub(r"(^|[-_.])(phone|desktop)$", "", stem, flags=re.I)
    s = re.sub(r"[-_]+", " ", stem).strip()
    return s[:1].upper() + s[1:] if s else "Screen"


def _safe_file(name: str, i: int) -> str:
    stem = re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-.") or f"shot-{i + 1}"
    ext = stem.rsplit(".", 1)[-1] if "." in stem else ""
    if ext not in TYPES:
        stem = f"{stem}.png"
    return stem[:120] if stem[0].isalnum() else f"s{stem}"[:120]


def norm_item(raw: dict, now: str | None = None) -> tuple[dict, list[str]]:
    """Mirror of review-core.mjs normItem (unknown fields kept)."""
    now = now or _now()
    o = raw if isinstance(raw, dict) else {}
    problems: list[str] = []
    kind = _s(o.get("kind"), 41) or "other"
    if not _KIND.match(kind):
        problems.append(f'kind "{kind}" must be lowercase letters, digits and dashes')
    title = _s(o.get("title"), 200)
    if not title:
        problems.append("a title is needed")
    pr_raw = o.get("pr")
    pr = None
    if pr_raw not in (None, ""):
        try:
            pr = int(str(pr_raw).lstrip("#"))
            if pr <= 0:
                raise ValueError
        except ValueError:
            problems.append("pr must be a PR number")
            pr = None
    status = o.get("status") if o.get("status") in STATUSES else "waiting"
    item = {**o, "$axf": SCHEMA, "id": o["id"] if isinstance(o.get("id"), str) and _ID.match(o["id"]) else f"r-{now[:10].replace('-', '')}-{secrets.token_hex(4)}",
            "kind": kind, "title": title, "app": _s(o.get("app"), 80), "build": _s(o.get("build"), 120), "branch": _s(o.get("branch"), 200),
            "pr": pr, "notes": _s(o.get("notes"), 4000), "status": status, "comment": _s(o.get("comment"), 2000),
            "source": _s(o.get("source"), 40) or "api", "submittedAt": _s(o.get("submittedAt"), 40) or now, "updatedAt": now}
    shots = []
    for s in (o.get("shots") or [])[:60]:
        s = {"src": s} if isinstance(s, str) else s
        if isinstance(s, dict) and isinstance(s.get("src"), str) and s["src"]:
            shots.append({**s, "src": s["src"][:300], "device": s.get("device") if s.get("device") in ("phone", "desktop") else _device(s["src"]), "name": _s(s.get("name"), 120) or _shot_name(s["src"])})
    item["shots"] = shots
    hist = o.get("history") if isinstance(o.get("history"), list) else []
    item["history"] = hist[-200:] or [{"at": item["submittedAt"], "by": _s(o.get("by"), 60) or "build", "action": "submitted", "status": status}]
    item.pop("by", None)
    return item, problems


def decide(item: dict, decision: str, comment: str = "", by: str = "brett", at: str | None = None) -> dict:
    status = DECISIONS.get(decision) or (decision if decision in STATUSES else None)
    if not status:
        raise ValueError(f'unknown decision "{decision}"')
    at = at or _now()
    c = _s(comment, 2000)
    line = {"at": at, "by": by, "action": decision if decision in DECISIONS else status, "status": status}
    if c:
        line["comment"] = c
    return {**item, "status": status, "comment": c or (item.get("comment", "") if status == item.get("status") else ""), "updatedAt": at,
            "history": [*(item.get("history") or []), line][-200:]}


def review_state(items: list[dict], branch: str = "", pr: int | None = None) -> dict:
    mine = [it for it in items if (branch and it.get("branch") == branch) or (pr and it.get("pr") == pr)]
    c = {k: 0 for k in STATUSES}
    for it in mine:
        if it.get("status") in c:
            c[it["status"]] += 1
    state = "none" if not mine else "rejected" if c["rejected"] else "changes" if c["changes"] else "waiting" if c["waiting"] else "approved"
    return {"$axf": "ui-review@1", "branch": branch, "pr": pr, "state": state, "holds": state not in ("none", "approved"), "counts": c,
            "items": [{"id": it["id"], "title": it.get("title", ""), "kind": it.get("kind", ""), "status": it.get("status", "waiting")} for it in mine]}


def _submitted(doc: dict) -> list[dict]:
    return [it for it in doc["items"] if isinstance(it, dict) and not str(it.get("id", "")).startswith("pack:")]


def _decode(data: str) -> bytes:
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    raw = base64.b64decode(data, validate=False)
    if len(raw) > MAX_SHOT:
        raise HTTPException(413, "a screenshot is over 8 MB")
    if not (raw.startswith(b"\x89PNG") or raw.startswith(b"\xff\xd8") or raw[8:12] == b"WEBP"):
        raise HTTPException(400, "screenshots must be PNG, JPEG or WebP")
    return raw


def submit(fields: dict, shots: list[tuple[str, str, bytes]] | None = None) -> dict:
    """Add one item. shots: (file name, device or '', bytes). Fields may also list shots already in place (src)."""
    item, problems = norm_item({**fields, "status": "waiting", "history": None, "id": None})
    if problems:
        raise ValueError("; ".join(problems))
    folder = data_dir() / "shots" / item["id"]
    saved = []
    for i, (name, device, raw) in enumerate(shots or []):
        fn = _safe_file(name, i)
        while (folder / fn).exists():
            fn = f"{i + 1}-{fn}"[:120]
        folder.mkdir(parents=True, exist_ok=True)
        (folder / fn).write_bytes(raw)
        saved.append({"src": f"items/{item['id']}/{fn}", "device": device if device in ("phone", "desktop") else _device(name), "name": _shot_name(name)})
    item["shots"] = saved + [s for s in item["shots"] if _ITEM_SHOT.match(s["src"]) or _PACK_SHOT.match(s["src"])]
    with _lock:
        doc = _items_doc()
        doc["items"].append(item)
        _write(data_dir() / "items.json", doc)
    return item


def decide_many(ids: list[str], decision: str, comment: str = "", by: str = "brett") -> dict:
    if decision not in DECISIONS:
        raise ValueError(f'unknown decision "{decision}"')
    at = _now()
    changed: list[str] = []
    with _lock:
        doc = _items_doc()
        by_id = {it.get("id"): i for i, it in enumerate(doc["items"]) if isinstance(it, dict)}
        for x in ids:
            if x in by_id:
                doc["items"][by_id[x]] = decide(doc["items"][by_id[x]], decision, comment, by, at)
                changed.append(x)
            elif x.startswith("pack:") and _PACK_ID.match(x[5:]):
                # a design pack's first decision: its overlay record (status, comment, history)
                doc["items"].append(decide({"id": x, "kind": "design-pack", "status": "waiting", "comment": "", "history": []}, decision, comment, by, at))
                changed.append(x)
        _write(data_dir() / "items.json", doc)
    return {"changed": changed, "missing": [x for x in ids if x not in changed], "at": at}


class UiReviewService:
    """ui-review@1 for other plugins (the push banner's batch merge reads holds())."""

    name = "ui-review@1"

    def items(self, branch: str = "", pr: int | None = None) -> list[dict]:
        its = _submitted(_items_doc())
        return [it for it in its if (not branch or it.get("branch") == branch) and (not pr or it.get("pr") == pr)]

    def state(self, branch: str = "", pr: int | None = None) -> dict:
        return review_state(_submitted(_items_doc()), branch, pr)

    def holds(self, branch: str = "", pr: int | None = None) -> bool:
        return self.state(branch, pr)["holds"]

    def submit(self, fields: dict, shots: list[tuple[str, str, bytes]] | None = None) -> dict:
        return submit(fields, shots)


shots = ShotStore(data_dir)


def promote_shot(shot: dict, raw: bytes, opts: dict) -> dict:
    """Send to review: a screenshot becomes a normal review item (its picture copied; the screenshot stays)."""
    ext = (shot.get("file") or "x.png").rsplit(".", 1)[-1]
    name = f"{re.sub(r'[^a-z0-9]+', '-', (shot.get('screen') or shot.get('title') or 'screen').lower()).strip('-')[:80] or 'screen'}-{shot.get('viewport') or 'desktop'}.{ext}"
    notes = "\n".join(x for x in [shot.get("note") or "", f"Sent from Screenshots ({shot['id']})."] if x)
    fields = {"kind": opts.get("kind") or "screen", "title": opts.get("title") or shot.get("title"), "app": shot.get("app", ""), "build": shot.get("build", ""),
              "branch": shot.get("branch", ""), "pr": shot.get("pr"), "notes": notes, "source": "screenshots", "by": opts.get("by") or "brett", "fromShot": shot["id"]}
    return submit(fields, [(name, shot.get("viewport") or "", raw)])


def migrate_shots() -> dict:
    """Review items titled "Breakroom check: …" (a check session's pictures) move into Screenshots."""
    return shots.migrate(_items_doc, lambda d: _write(data_dir() / "items.json", d), data_dir() / "shots", _lock)


try:
    migrate()
except OSError:
    pass  # a read-only checkout: the page still works, the picks stay where they were
try:
    migrate_shots()
except OSError:
    pass
plugin_services.provide("ui-review@1", UiReviewService(), FOLDER)
router.include_router(shots_router(shots, promote_shot, migrate_shots))


async def _json(request: Request, limit: int = 65536) -> dict:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "too big")
    try:
        body = json.loads(raw or b"{}")
    except json.JSONDecodeError as e:
        raise HTTPException(400, "not JSON") from e
    if not isinstance(body, dict):
        raise HTTPException(400, "send a JSON object")
    return body


@router.get("/kinds")
def kinds() -> dict:
    base = _read(HERE / "kinds.json", {}).get("kinds", [])
    extra = _read(data_dir() / "kinds.json", {}).get("kinds", [])
    return {"base": base, "extra": extra if isinstance(extra, list) else []}


@router.get("/items")
def items() -> dict:
    doc = _items_doc()
    overlay = {it["id"]: it for it in doc["items"] if isinstance(it, dict) and str(it.get("id", "")).startswith("pack:")}
    return {"items": _submitted(doc), "overlay": overlay, "packs": index(), "picks": get_picks(), "kinds": kinds()}


@router.post("/submit")
async def post_submit(request: Request) -> dict:
    body = await _json(request, MAX_BODY)
    shots = []
    files = body.get("files") if isinstance(body.get("files"), list) else []
    for i, f in enumerate(files[:60]):
        if not isinstance(f, dict) or not isinstance(f.get("data"), str):
            raise HTTPException(400, "files: [{name, device?, data}]")
        shots.append((_s(f.get("name"), 120) or f"shot-{i + 1}.png", _s(f.get("device"), 10), _decode(f["data"])))
    fields = {k: v for k, v in body.items() if k != "files"}
    fields.setdefault("source", "api")
    try:
        return {"ok": True, "item": submit(fields, shots)}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/decide")
async def post_decide(request: Request) -> dict:
    body = await _json(request)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")] if body.get("id") else []
    if not ids or not all(isinstance(x, str) and _ID.match(x) for x in ids) or len(ids) > 500:
        raise HTTPException(400, "ids: a list of item ids")
    try:
        return {"ok": True, **decide_many(ids, str(body.get("decision", "")), _s(body.get("comment"), 2000), _s(body.get("by"), 60) or "brett")}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/remove")
async def post_remove(request: Request) -> dict:
    body = await _json(request)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    if not ids or not all(isinstance(x, str) and _ID.match(x) and not x.startswith("pack:") for x in ids):
        raise HTTPException(400, "ids: submitted item ids (design packs can't be removed here)")
    with _lock:
        doc = _items_doc()
        doc["items"] = [it for it in doc["items"] if it.get("id") not in ids]
        _write(data_dir() / "items.json", doc)
    for x in ids:
        shutil.rmtree(data_dir() / "shots" / x, ignore_errors=True)
    return {"ok": True, "removed": ids}


@router.get("/state")
def state(branch: str = "", pr: str = "") -> dict:
    p = int(pr.lstrip("#")) if pr.lstrip("#").isdigit() else None
    if not branch and not p:
        raise HTTPException(400, "give a branch or a pr")
    return review_state(_submitted(_items_doc()), branch[:200], p)


def index() -> dict:
    return _read(PACKS / "index.json", {"packs": []})


@router.get("/index")
def get_index() -> dict:
    return index()


@router.get("/shot")
def shot(path: str = ""):
    if _PACK_SHOT.match(path):
        base, f = PACKS, PACKS / path
    else:
        m = _ITEM_SHOT.match(path)
        if not m:
            raise HTTPException(400, "bad screenshot path")
        base = data_dir() / "shots"
        f = base / m.group(1) / m.group(2)
    f = f.resolve()
    if base.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "no such screenshot")
    return FileResponse(f, media_type=TYPES[f.suffix[1:].lower()], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/picks")
def get_picks() -> dict:
    d = _read(data_dir() / "picks.json", None)
    return d if isinstance(d, dict) and isinstance(d.get("picked"), list) else {"picked": [], "at": ""}


@router.put("/picks")
async def put_picks(request: Request) -> dict:
    body = await _json(request, 8192)
    picked = body.get("picked")
    if not isinstance(picked, list) or len(picked) > 12 or not all(isinstance(x, str) and _PACK_ID.match(x) for x in picked):
        raise HTTPException(400, "picked must be a list of up to 12 pack ids")
    doc = {"picked": picked, "at": _now()}
    with _lock:
        _write(data_dir() / "picks.json", doc)
    return {"ok": True, **doc}
