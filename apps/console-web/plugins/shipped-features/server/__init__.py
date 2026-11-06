"""Shipped features: server part. Mounted at /api/plugins/shipped-features/ (console token on every method, 404 while
the plugin is off).

The ledger is one SQLite file (feature-ledger@1, written by ledger/db.mjs). Reads go straight to it (sqlite3, read
only); every write goes through the Node side (ledger/ledger.mjs), so the reference normalisers stay the only writer.

    GET  /ledger              every feature, edit, PR, build, prompt and deploy (the grid filters / sorts / groups on
                              the client with framework/core/feature-ledger.mjs) + meta (schema, counts, last sync)
    GET  /summary             counts per status, being edited, live in the last day (menu badge, Home cards)
    GET  /feature/{id}        one feature: its edits (newest first), prompts, earlier versions
    POST /sync                new build events + recent PRs + the deploy log (also runs by itself every SYNC_S while
                              the grid is open, and on the first read after a restart)
    POST /import              the full backfill (builds journal, PRs, early commits, seed), in the background
    GET  /export?kind=csv|md&view=<json>   the grid's rows as a file
"""
from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = Path(__file__).resolve().parents[1] / "ledger" / "ledger.mjs"
SYNC_S = 120
ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,159}$")
TABLES = ("features", "edits", "prs", "builds", "prompts", "deploys")
_state: dict[str, Any] = {"syncAt": 0.0, "syncing": False, "importing": False, "last": None, "error": ""}
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SHIPPED_FEATURES_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def db_file() -> Path:
    return data_dir() / "ledger.sqlite"


def _run(*args: str, timeout: int = 600) -> tuple[int, str, str]:
    env = {**os.environ, "AXF_SHIPPED_FEATURES_DIR": str(data_dir())}
    p = subprocess.run(["node", str(CLI), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env)
    return p.returncode, p.stdout, p.stderr


def _connect() -> sqlite3.Connection | None:
    f = db_file()
    if not f.exists():
        return None
    c = sqlite3.connect(f"file:{f}?mode=ro", uri=True, timeout=5)
    c.row_factory = sqlite3.Row
    return c


def _docs(c: sqlite3.Connection, sql: str, *args: Any) -> list[dict[str, Any]]:
    return [json.loads(r["doc"]) for r in c.execute(sql, args)]


def _background(kind: str, args: list[str]) -> bool:
    flag = "syncing" if kind == "sync" else "importing"
    with _lock:
        if _state[flag]:
            return False
        _state[flag] = True

    def work() -> None:
        try:
            code, out, err = _run(*args)
            _state["last"] = {"kind": kind, "at": time.time(), "ok": code == 0, "out": out.strip()[-2000:]}
            _state["error"] = "" if code == 0 else (err.strip().splitlines() or ["failed"])[-1][:300]
        except Exception as e:  # noqa: BLE001 — reported on /ledger meta, never raised into a request
            _state["error"] = str(e)[:300]
        finally:
            _state[flag] = False
            if kind == "sync":
                _state["syncAt"] = time.time()

    threading.Thread(target=work, daemon=True, name=f"shipped-features-{kind}").start()
    return True


def _maybe_sync() -> None:
    if time.time() - _state["syncAt"] > SYNC_S and not _state["importing"]:
        _background("sync", ["sync"])


@router.get("/ledger")
def ledger() -> dict[str, Any]:
    _maybe_sync()
    c = _connect()
    meta = {"syncing": _state["syncing"], "importing": _state["importing"], "syncAt": _state["syncAt"], "error": _state["error"], "file": str(db_file())}
    if c is None:
        if not _state["importing"]:
            _background("import", ["import"])
        return {"$axf": "feature-ledger@1", "version": 1, "features": [], "edits": [], "prs": [], "builds": [], "prompts": [], "deploys": [], "meta": {**meta, "empty": True, "importing": True}}
    try:
        out: dict[str, Any] = {"$axf": "feature-ledger@1", "version": 1}
        for t in TABLES:
            out[t] = _docs(c, f"SELECT doc FROM {t}")  # noqa: S608 — table names are the fixed TABLES tuple
        m = {r["key"]: r["value"] for r in c.execute("SELECT key, value FROM meta")}
        out["since"] = m.get("since", "")
        out["updatedAt"] = m.get("updated_at", "")
        out["meta"] = {**meta, "schema": int(m.get("schema_version", "0") or 0), "importedAt": m.get("imported_at", ""), "counts": {t: len(out[t]) for t in TABLES}}
        return out
    finally:
        c.close()


@router.get("/summary")
def summary() -> dict[str, Any]:
    """Counts for the menu badge and Home cards: per status, being edited, gone live in the last day."""
    _maybe_sync()
    c = _connect()
    if c is None:
        return {"ready": False, "statuses": {}, "beingEdited": 0, "active": 0, "liveToday": 0, "editsPending": 0}
    try:
        st = {r["status"]: r["n"] for r in c.execute("SELECT status, COUNT(*) AS n FROM features GROUP BY status")}
        editing = c.execute("SELECT COUNT(*) AS n FROM features WHERE being_edited = 1").fetchone()["n"]
        day = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 86400))
        live = c.execute("SELECT COUNT(*) AS n FROM features WHERE first_live_at >= ?", (day,)).fetchone()["n"]
        ep = c.execute("SELECT COUNT(*) AS n FROM edits WHERE status IN ('planned', 'queued', 'building', 'in-pr')").fetchone()["n"]
        return {"ready": True, "statuses": st, "beingEdited": editing, "active": st.get("building", 0) + st.get("in-pr", 0) + editing, "liveToday": live, "editsPending": ep}
    finally:
        c.close()


@router.get("/feature/{fid}")
def feature(fid: str) -> dict[str, Any]:
    if not ID.match(fid):
        raise HTTPException(400, "bad feature id")
    c = _connect()
    if c is None:
        raise HTTPException(404, "the ledger isn't built yet")
    try:
        rows = _docs(c, "SELECT doc FROM features WHERE id = ?", fid)
        if not rows:
            raise HTTPException(404, "no such feature")
        f = rows[0]
        edits = _docs(c, "SELECT doc FROM edits WHERE feature_id = ? ORDER BY at DESC, id", fid)
        pids = {p.get("id") for p in f.get("prompts", [])} | {e.get("prompt") for e in edits if e.get("prompt")}
        prompts = [p for p in _docs(c, "SELECT doc FROM prompts") if p.get("id") in pids]
        history = [{"rev": r["rev"], "at": r["at"], "why": r["why"], "doc": json.loads(r["doc"])} for r in c.execute("SELECT rev, at, why, doc FROM feature_history WHERE feature_id = ? ORDER BY rev", (fid,))]
        return {"feature": f, "edits": edits, "prompts": prompts, "history": history}
    finally:
        c.close()


@router.post("/sync")
def sync() -> dict[str, Any]:
    return {"started": _background("sync", ["sync"]), "syncing": True}


@router.post("/import")
def import_all() -> dict[str, Any]:
    return {"started": _background("import", ["import"]), "importing": True}


@router.get("/export")
def export(kind: str = "csv", view: str = "{}") -> PlainTextResponse:
    if kind not in ("csv", "md"):
        raise HTTPException(400, "kind is csv or md")
    try:
        json.loads(view)
    except ValueError as e:
        raise HTTPException(400, "view must be JSON") from e
    code, out, err = _run("export", kind, "--view", view, timeout=120)
    if code != 0:
        raise HTTPException(500, (err.strip().splitlines() or ["export failed"])[-1][:300])
    media = "text/csv" if kind == "csv" else "text/markdown"
    return PlainTextResponse(out, media_type=media, headers={"content-disposition": f'attachment; filename="shipped-features.{kind}"'})
