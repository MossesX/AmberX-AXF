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
    GET  /search?q=           features (name, Brett's words, edits, PR #, build) and manifests matching the text
    GET  /manifests?q=&since= shipped manifests (shipped-manifest@1), one line each, newest landing first
    GET  /manifest/{build}    one build's full manifest (the ledger's copy, else the sidecar)
    POST /manifest            add or update an entry from a manifest: { build: { id }, …fields } wins over what the
                              orchestrator gathers; written through the builds store (build-hook@1 fires `shipped`)
    POST /ship/{build}        gather and send one build's manifest now
    POST /link                link a build to its branch / PR / merge time (builds store write, hooks fire)
    POST /backfill            { since, dry }: landed builds with no manifest since the date get one
    GET  /features/{id}/open-target   where the feature opens in the console (console-control@1 address) or why not
    GET  /features/find?q=    a feature named in words (or its id): best match + close alternatives when ambiguous
    GET  /features/open-target?feature=<id or words> · POST /features/open { feature, to?, by? }: the same, by name
    POST /features/{id}/open  { to?, by? }: open it in the live console (console-control open); 409 + reason when it can't

Manifest writes run framework/cli/shipped.mjs (Node), so the builds store stays the one writer and every listener
hears the change; the ledger takes the manifest on the next sync (started right after each write).
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

from . import open_target as ot

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = Path(__file__).resolve().parents[1] / "ledger" / "ledger.mjs"
SHIPPED_CLI = ROOT / "framework" / "cli" / "shipped.mjs"
LIVE_CLI = ROOT / "framework" / "cli" / "builds-live.mjs"
SIDECAR = ROOT / "_claude" / "builds" / "shipped"
BUILD_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,79}$")
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


def _node(cli: Path, *args: str, stdin: str | None = None, timeout: int = 300) -> tuple[int, str, str]:
    """A framework CLI (shipped.mjs, builds-live.mjs). Worktrees are mounted at /hostfs/axf-builds in the console."""
    env = {**os.environ, "AXF_SHIPPED_FEATURES_DIR": str(data_dir()), "AXF_ACTOR": os.environ.get("AXF_ACTOR", "console")}
    if Path("/hostfs/axf-builds").is_dir():
        env.setdefault("AXF_PIPELINE_WORKTREES", "/hostfs/axf-builds")
    p = subprocess.run(["node", str(cli), *args], cwd=str(ROOT), input=stdin, capture_output=True, text=True, timeout=timeout, env=env)
    return p.returncode, p.stdout, p.stderr


def _json_out(code: int, out: str, err: str, what: str) -> dict[str, Any]:
    try:
        body = json.loads(out.strip().splitlines()[-1]) if out.strip() else {}
    except ValueError:
        body = {}
    if code != 0 or body.get("ok") is False:
        raise HTTPException(400 if code == 2 else 500, body.get("error") or (err.strip().splitlines() or [f"{what} failed"])[-1][:400])
    return body


def _manifest_rows(c: sqlite3.Connection, sql: str, *args: Any) -> list[dict[str, Any]]:
    try:
        return _docs(c, sql, *args)
    except sqlite3.OperationalError:  # the ledger predates migration 003: no manifests yet
        return []


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
        builds = sorted({b.get("id") for b in f.get("builds", []) if b.get("id")} | {e.get("build") for e in edits if e.get("build")})
        manifests = [m for b in builds for m in _manifest_rows(c, "SELECT doc FROM manifests WHERE build = ? ORDER BY rev DESC LIMIT 1", b)]
        return {"feature": f, "edits": edits, "prompts": prompts, "history": history, "manifests": manifests}
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


# ------------------------------------------------------------------ shipped manifests (shipped-manifest@1) + API control


@router.get("/search")
def search(q: str = "") -> dict[str, Any]:
    """Features and manifests matching the text: names, Brett's words, edits, PR numbers, build ids, files."""
    q = q.strip()[:200]
    if not q:
        raise HTTPException(400, "q is the text to search for")
    code, out, err = _run("search", q, "--json", timeout=120)
    if code != 0:
        raise HTTPException(500, (err.strip().splitlines() or ["search failed"])[-1][:300])
    return json.loads(out)


@router.get("/manifests")
def manifests(q: str = "", since: str = "") -> dict[str, Any]:
    """Every shipped manifest, one line each (ledger's copy), newest landing first; q filters on the full text."""
    code, out, err = _run("manifests", "--json", *(["--q", q[:200]] if q.strip() else []), timeout=120)
    if code != 0:
        raise HTTPException(500, (err.strip().splitlines() or ["manifests failed"])[-1][:300])
    rows = json.loads(out)
    if since:
        rows = [m for m in rows if (m.get("landedAt") or m.get("shippedAt") or "") >= since]
    return {"manifests": rows, "count": len(rows)}


@router.get("/manifest/{build}")
def manifest(build: str) -> dict[str, Any]:
    if not BUILD_ID.match(build):
        raise HTTPException(400, "bad build id")
    c = _connect()
    if c is not None:
        try:
            rows = _manifest_rows(c, "SELECT doc FROM manifests WHERE build = ? ORDER BY rev DESC LIMIT 1", build)
        finally:
            c.close()
        if rows:
            return {"manifest": rows[0], "from": "ledger"}
    f = SIDECAR / f"{build}.json"
    if f.is_file():
        return {"manifest": json.loads(f.read_text()), "from": "sidecar"}
    raise HTTPException(404, "no manifest for that build yet")


def _after_write() -> None:
    _state["syncAt"] = 0.0
    _background("sync", ["sync"])


@router.post("/manifest")
def put_manifest(body: dict[str, Any]) -> dict[str, Any]:
    """Add or update an entry from a manifest (shipped-manifest@1, partial is fine: given fields win over gathered ones)."""
    m = body.get("manifest") if isinstance(body.get("manifest"), dict) else body
    bid = str((m.get("build") or {}).get("id") or body.get("build_id") or "").strip()
    if not BUILD_ID.match(bid):
        raise HTTPException(400, "build.id (or build_id) is required")
    m = {**m, "build": {**(m.get("build") or {}), "id": bid}}
    by = str(body.get("by") or "console")[:80]
    code, out, err = _node(SHIPPED_CLI, "ship", bid, "--manifest-file", "-", "--source", "api", "--by", by, "--json", stdin=json.dumps(m))
    r = _json_out(code, out, err, "ship")
    _after_write()
    return r


@router.post("/ship/{build}")
def ship(build: str) -> dict[str, Any]:
    """Gather and send one build's manifest now (what the orchestrator does when a build lands)."""
    if not BUILD_ID.match(build):
        raise HTTPException(400, "bad build id")
    code, out, err = _node(SHIPPED_CLI, "ship", build, "--source", "manual", "--json")
    r = _json_out(code, out, err, "ship")
    _after_write()
    return r


@router.post("/link")
def link(body: dict[str, Any]) -> dict[str, Any]:
    """Link a build to its branch, PR and merge time (a builds store write: the ledger follows through build-hook@1)."""
    bid = str(body.get("build") or body.get("build_id") or "").strip()
    if not BUILD_ID.match(bid):
        raise HTTPException(400, "build is required")
    args = ["link", bid, "--json"]
    if body.get("branch"):
        args += ["--branch", str(body["branch"])[:200]]
    if body.get("pr") not in (None, ""):
        args += ["--pr", str(body["pr"])[:200]]
    if body.get("mergedAt"):
        args += ["--merged", str(body["mergedAt"])[:40]]
    if len(args) == 3:
        raise HTTPException(400, "give branch, pr or mergedAt")
    code, out, err = _node(LIVE_CLI, *args, timeout=120)
    r = _json_out(code, out, err, "link")
    _after_write()
    return r


# ------------------------------------------------------------------ open a feature in the live console (console-control@1)


def _feature_doc(fid: str) -> dict[str, Any] | None:
    c = _connect()
    if c is None:
        raise HTTPException(404, "the ledger isn't built yet")
    try:
        rows = _docs(c, "SELECT doc FROM features WHERE id = ?", fid)
        return rows[0] if rows else None
    finally:
        c.close()


def _control(body: dict[str, Any]) -> dict[str, Any]:
    """One console-control@1 command through the console's own runner (same guards, policy and audit as /do)."""
    try:
        import console_control_api  # the console server's module (absent outside the console)
    except ImportError:
        return {"ok": False, "code": "unavailable", "message": "no console server here to send it through"}
    return console_control_api.command(body, str(body.get("by") or "api"))


def resolve(fid: str) -> dict[str, Any]:
    """The open target of one feature by id (404 when there is no such feature)."""
    if not ID.match(fid):
        raise HTTPException(400, "bad feature id")
    f = _feature_doc(fid)
    if f is None:
        raise HTTPException(404, "no such feature")
    return ot.open_target(f, ot.load_registry())


def open_feature(t: dict[str, Any], body: dict[str, Any]) -> dict[str, Any]:
    """Open a resolved target in the console the person used last (or `to`); no target → 409 with the reason."""
    if not t.get("target"):
        raise HTTPException(409, {"ok": False, "code": t.get("code"), "message": f"{t.get('name') or t.get('feature')} can't be opened: {t.get('reason')}", **t})
    cmd = {"verb": "open", "address": t["target"], "by": str(body.get("by") or "shipped-features")[:80], "to": str(body.get("to") or "recent")[:80],
           "reason": f"Open {t.get('name') or t.get('feature')} from Shipped features"}
    r = _control(cmd)
    return {**r, "ok": bool(r.get("ok")), "openTarget": t, "status": "delivered" if r.get("ok") else ("pending" if r.get("code") == "unavailable" else "failed")}


def _all_features() -> list[dict[str, Any]]:
    c = _connect()
    if c is None:
        raise HTTPException(404, "the ledger isn't built yet")
    try:
        return _docs(c, "SELECT doc FROM features")
    finally:
        c.close()


def lookup(ref: str) -> tuple[str, dict[str, Any]]:
    """A feature named by id or in words → (its id, the find answer). 404 when nothing fits."""
    ref = ref.strip()[:200]
    if not ref:
        raise HTTPException(400, "say which feature: an id or a few words of its name")
    if ID.match(ref) and _feature_doc(ref) is not None:
        return ref, {"q": ref, "match": {"id": ref}, "alternatives": [], "ambiguous": False}
    r = ot.find(_all_features(), ref)
    if not r["match"]:
        raise HTTPException(404, f"no feature matches '{ref}'")
    return r["match"]["id"], r


@router.get("/features/find")
def feature_find(q: str = "", limit: int = 5) -> dict[str, Any]:
    """A feature named in words (or its id): the best match, and close alternatives when it's ambiguous."""
    if not q.strip():
        raise HTTPException(400, "q is the feature's id or a few words of its name")
    return ot.find(_all_features(), q, max(2, min(limit, 20)))


@router.get("/features/open-target")
def feature_open_target_by(feature: str = "") -> dict[str, Any]:
    """open-target for a feature named by id or in words; carries the lookup (alternatives when ambiguous)."""
    fid, found = lookup(feature)
    return {**resolve(fid), "lookup": found}


@router.post("/features/open")
def feature_open_by(body: dict[str, Any]) -> dict[str, Any]:
    """Open a feature named by id or in words: { feature, to?, by? }. The best match opens; alternatives come back."""
    fid, found = lookup(str(body.get("feature") or body.get("id") or body.get("q") or ""))
    return {**open_feature(resolve(fid), body), "lookup": found}


@router.get("/features/{fid}/open-target")
def feature_open_target(fid: str) -> dict[str, Any]:
    """Where this feature opens in the console: {target, label, via} or {target: null, code, reason}."""
    return resolve(fid)


@router.post("/features/{fid}/open")
def feature_open(fid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Open the feature's screen in the live console (console-control open); 409 with the reason when it has none."""
    return open_feature(resolve(fid), body or {})


@router.post("/backfill")
def backfill(body: dict[str, Any]) -> dict[str, Any]:
    """Landed builds since a date with no manifest (store builds and build_land merges on main) get one."""
    since = str(body.get("since") or "").strip()
    if not re.match(r"^\d{4}-\d{2}-\d{2}", since):
        raise HTTPException(400, "since is a date (YYYY-MM-DD)")
    args = ["backfill", "--since", since[:25], "--json"] + (["--dry"] if body.get("dry") else [])
    code, out, err = _node(SHIPPED_CLI, *args, timeout=900)
    r = _json_out(code, out, err, "backfill")
    if not body.get("dry"):
        _after_write()
    return r


# ------------------------------------------------------------------ capability service (axf.shipped-features@1)


class ShippedFeaturesService:
    """What other plugins (the Gate's Pending features rows) use instead of this plugin's folder name."""

    def open_target(self, feature_id: str) -> dict[str, Any]:
        """Where one feature opens, or why it can't (same answer as GET features/{id}/open-target)."""
        try:
            return resolve(feature_id)
        except HTTPException as e:
            return {"feature": feature_id, "target": None, "code": "not-found", "reason": str(e.detail)}

    def open_targets_for_build(self, build_id: str) -> list[dict[str, Any]]:
        """Every feature a build added or changed, each with where it opens (a build that hasn't landed: not-live)."""
        if not BUILD_ID.match(build_id or ""):
            return []
        c = _connect()
        if c is None:
            return []
        try:
            feats = [f for f in _docs(c, "SELECT doc FROM features") if any(b.get("id") == build_id for b in f.get("builds") or [])]
        finally:
            c.close()
        reg = ot.load_registry()
        return [ot.open_target(f, reg) for f in feats]

    def open(self, feature_id: str, to: str = "recent", by: str = "plugin") -> dict[str, Any]:
        """Open one feature in the live console (as POST features/{id}/open); no target → {ok: false, code, reason}."""
        try:
            return open_feature(resolve(feature_id), {"to": to, "by": by})
        except HTTPException as e:
            d = e.detail if isinstance(e.detail, dict) else {"message": str(e.detail)}
            return {"ok": False, **d}


try:
    import plugin_services  # the console's capability registry (absent when the server part runs outside the console)
    plugin_services.provide("axf.shipped-features@1", ShippedFeaturesService(), FOLDER)
except ImportError:
    pass
