"""Server part of the UI Directory plugin (ui-directory@1). Mounted at /api/plugins/ui-directory/.

The console adds the console-token check (every method) and the 404 while disabled. The data set is built by the
plugin's own Node collector (directory.mjs) from what the repo registers (the console-control inventory, plugin
manifests and web registrations, app manifests, UI registries) into the plugin's data folder, rebuilt whenever it is
missing or a build lands (build-hook@1 listener). No model, no tokens.

Routes: GET directory · GET stats · GET rows · GET search · GET row · GET tree · GET changes · GET check · POST rebuild ·
GET/POST page (the directory page's live state: query, filters, open groups, rows shown) · POST show (open the page with
filters in the open console) · POST open (open a row's UI or its settings in the open console).
Capability ui-directory@1: rows(filters), search(q), row(id), rebuild(reason, build) for other plugins.
"""
from __future__ import annotations

import json
import os
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import Response

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = HERE / "directory.mjs"
SELF = "ui-directory@1"
_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": 0.0, "value": None, "raw": b""}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_UI_DIRECTORY_DIR") or (ROOT / ".axf-console" / "plugins" / "ui-directory"))


def _run(*args: str, timeout: int = 120) -> tuple[int, str, str]:
    env = {**os.environ, "AXF_REPO_ROOT": str(ROOT), "AXF_UI_DIRECTORY_DIR": str(data_dir())}
    p = subprocess.run(["node", str(CLI), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _node_json(*args: str, timeout: int = 180) -> Any:
    try:
        code, out, err = _run(*args, "--json", timeout=timeout)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the UI directory tools didn't answer: {type(e).__name__}") from e
    if code not in (0, 1) or not out:
        raise HTTPException(500, (err or out or "ui-directory failed").splitlines()[-1][:300])
    try:
        return json.loads(out)
    except json.JSONDecodeError as e:
        raise HTTPException(500, "ui-directory answered something that is not JSON") from e


def rebuild(reason: str = "console", build: str = "") -> dict[str, Any]:
    with _lock:
        args = ["build", "--reason", reason[:120]]
        if build:
            args += ["--build", build[:120]]
        r = _node_json(*args)
        _cache["mtime"] = 0.0
        return r


def _load() -> tuple[dict[str, Any], bytes]:
    f = data_dir() / "directory.json"
    if not f.exists():
        rebuild("first read")
    try:
        st = f.stat()
    except OSError as e:
        raise HTTPException(503, "the UI directory could not be built") from e
    with _lock:
        if _cache["value"] is None or st.st_mtime != _cache["mtime"]:
            raw = f.read_bytes()
            _cache.update(mtime=st.st_mtime, value=json.loads(raw), raw=raw)
        return _cache["value"], _cache["raw"]


def _rows() -> list[dict[str, Any]]:
    d, _ = _load()
    return list(d.get("rows") or [])


def _filter(rows: list[dict[str, Any]], kind: str = "", app: str = "", plugin: str = "", status: str = "", family: str = "", q: str = "") -> list[dict[str, Any]]:
    kinds = {k for k in kind.split(",") if k}
    words = [w for w in q.lower().split() if w]
    out = []
    for r in rows:
        if kinds and r.get("kind") not in kinds:
            continue
        if app and r.get("app") != app:
            continue
        if plugin and r.get("plugin") != plugin:
            continue
        if status and r.get("status") != status:
            continue
        if family and family not in (r.get("tokens") or []):
            continue
        if words:
            hay = f"{r.get('name', '')} {r.get('id', '')} {' '.join(r.get('keywords') or [])} {r.get('detail', '')} {r.get('plugin', '')} {r.get('address', '')}".lower()
            if not all(w in hay for w in words):
                continue
        out.append(r)
    return out


def search(q: str, kind: str = "", app: str = "", limit: int = 30) -> list[dict[str, Any]]:
    """The same ranking as framework/core/ui-directory.mjs search(): name, then keywords, then the rest."""
    words = [w for w in q.lower().split() if w]
    if not words:
        return []
    hits = []
    for r in _filter(_rows(), kind=kind, app=app):
        name = str(r.get("name", "")).lower()
        kw = " ".join(r.get("keywords") or []).lower()
        rest = f"{r.get('id', '')} {r.get('detail', '')} {r.get('plugin', '')} {r.get('address', '')}".lower()
        score = 0
        for w in words:
            if name == w:
                score += 10
            elif name.startswith(w):
                score += 6
            elif w in name:
                score += 4
            elif w in kw:
                score += 2
            elif w in rest:
                score += 1
            else:
                score = 0
                break
        if score:
            hits.append((score, r))
    hits.sort(key=lambda h: (-h[0], str(h[1].get("name", "")).lower()))
    n = max(1, min(200, int(limit or 30)))
    return [{"id": r["id"], "name": r["name"], "kind": r["kind"], "app": r["app"], "address": r.get("address", ""), "score": s} for s, r in hits[:n]]


def _reach(r: dict[str, Any]) -> dict[str, Any] | None:
    """The same answer as framework/core/ui-directory.mjs reachOf(): the four doors to a row from one address."""
    if r.get("kind") == "app":
        return None
    link = r.get("deepLink") or {}
    tool = link.get("tool") or {"screen": "console_open", "tab": "console_open", "settings-tab": "console_settings", "settings-panel": "console_settings", "dialog": "console_dialog"}.get(str(r.get("kind")), "console_open")
    address = str(r.get("address") or "")
    target = link.get("target") or address
    if not target:
        return None
    voice = f"open {r.get('name', '')}"
    if address:
        return {"mcp": {"tool": tool, "target": target}, "rest": {"method": "POST", "path": "/api/console-control/do", "body": {"verb": "open", "address": address}}, "cli": f"axf console do open {address}", "voice": voice}
    route, field = ("dialog", "id") if tool == "console_dialog" else ("settings", "tab") if tool == "console_settings" else ("open", "screen")
    return {"mcp": {"tool": tool, "target": target}, "rest": {"method": "POST", "path": f"/api/plugins/console-commands/{route}", "body": {field: target}}, "cli": f"axf console-commands {route} --{field} {target}", "voice": voice}


def _settings_of(rows: list[dict[str, Any]], r: dict[str, Any]) -> dict[str, Any] | None:
    if r.get("settings"):
        return next((x for x in rows if x.get("id") == r["settings"]), None)
    if r.get("plugin"):
        return next((x for x in rows if x.get("kind") == "settings-tab" and x.get("app") == r.get("app") and x.get("plugin") == r.get("plugin")), None)
    return None


@router.get("/directory")
def get_directory() -> Response:
    _, raw = _load()
    return Response(content=raw, media_type="application/json")


@router.get("/stats")
def get_stats() -> dict[str, Any]:
    d, _ = _load()
    return {k: d.get(k) for k in ("generatedAt", "hash", "total", "counts", "dropped")}


@router.get("/rows")
def get_rows(kind: str = "", app: str = "", plugin: str = "", status: str = "", family: str = "", q: str = "") -> dict[str, Any]:
    rows = _filter(_rows(), kind, app, plugin, status, family, q)
    return {"total": len(rows), "rows": rows}


@router.get("/search")
def get_search(q: str = "", kind: str = "", app: str = "", limit: int = 30) -> dict[str, Any]:
    return {"q": q, "hits": search(q, kind, app, limit)}


@router.get("/row")
def get_row(id: str) -> dict[str, Any]:  # noqa: A002 - the query parameter is called id
    rows = _rows()
    r = next((x for x in rows if x.get("id") == id), None)
    if not r:
        raise HTTPException(404, f"no UI row {id}")
    s = _settings_of(rows, r)
    return {**r, "reach": _reach(r), "settingsRow": s}


@router.get("/tree")
def get_tree() -> list[dict[str, Any]]:
    return _node_json("tree") or []


@router.get("/changes")
def get_changes() -> list[dict[str, Any]]:
    f = data_dir() / "changes.json"
    try:
        return json.loads(f.read_text()) if f.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


@router.get("/check")
def get_check() -> dict[str, Any]:
    return _node_json("--check")


@router.post("/rebuild")
def post_rebuild(body: dict[str, Any] | None = None) -> dict[str, Any]:
    b = body or {}
    return rebuild(str(b.get("reason") or "console"), str(b.get("build") or ""))


# ---------------- the page, without the UI ----------------

PAGE_KEYS = ("q", "app", "kind", "status", "family")


def _page_file() -> Path:
    return data_dir() / "page.json"


@router.get("/page")
def get_page() -> dict[str, Any]:
    """The directory page's state as the open console last reported it (empty filters when it was never opened)."""
    try:
        return json.loads(_page_file().read_text())
    except (OSError, json.JSONDecodeError):
        return {"q": "", "app": "", "kind": "", "status": "", "family": "", "open": [], "all": False, "shown": None, "total": None, "at": None}


@router.post("/page")
def post_page(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """The page reports its state here as it changes (what GET page and the MCP / CLI / voice reads answer)."""
    b = body or {}
    from datetime import datetime, timezone

    page = {k: str(b.get(k) or "")[:200] for k in PAGE_KEYS}
    page["open"] = [str(x)[:400] for x in (b.get("open") or [])][:500] if isinstance(b.get("open"), list) else []
    page["all"] = bool(b.get("all"))
    page["shown"] = int(b["shown"]) if isinstance(b.get("shown"), int) else None
    page["total"] = int(b["total"]) if isinstance(b.get("total"), int) else None
    page["at"] = datetime.now(timezone.utc).isoformat(timespec="seconds")
    d = data_dir()
    d.mkdir(parents=True, exist_ok=True)
    tmp = d / "page.json.tmp"
    tmp.write_text(json.dumps(page, indent=1))
    tmp.replace(_page_file())
    return page


def _console_action(action: str, args: list[str], by: str = "", to: str = "") -> dict[str, Any]:
    cc = None
    try:
        import plugin_services  # type: ignore

        cc = plugin_services.get("console-commands@1")
    except Exception:  # noqa: BLE001 - absent in unit tests
        cc = None
    if not cc:
        return {"ok": False, "code": "not_found", "message": "Console commands is not installed, so nothing can open in the console"}
    from urllib.parse import quote

    cmd: dict[str, Any] = {"op": "act", "target": "console.actions", "path": action, "action": "run", "input": {"args": [quote(a, safe="=") for a in args]}}
    if to:
        cmd["input"]["to"] = to
    if by:
        cmd["by"] = by
    return cc.run(cmd, by=by)


@router.post("/show")
def post_show(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Open the directory page in the open console with these filters (any left out are cleared)."""
    b = body or {}
    args = [f"{k}={str(b.get(k) or '')}" for k in PAGE_KEYS]
    return _console_action("ui-directory.show", args, str(b.get("by") or ""), str(b.get("to") or ""))


@router.post("/open")
def post_open(body: dict[str, Any] | None = None) -> dict[str, Any]:
    """Open one row's UI (or, with settings true, its settings interface) in the open console."""
    b = body or {}
    rid = str(b.get("id") or "")
    rows = _rows()
    r = next((x for x in rows if x.get("id") == rid), None)
    if not r:
        raise HTTPException(404, f"no UI row {rid}")
    if b.get("settings"):
        s = _settings_of(rows, r)
        if not s:
            raise HTTPException(404, f"{r.get('name')} has no settings interface")
        r = s
    out = _console_action("ui-directory.open-row", [str(r["id"])], str(b.get("by") or ""), str(b.get("to") or ""))
    return {**out, "row": {"id": r["id"], "name": r.get("name"), "kind": r.get("kind"), "app": r.get("app")}, "reach": _reach(r)}


# ---------------- capability ui-directory@1 for other plugins ----------------

class Service:
    """What other plugins get from plugin_services.get('ui-directory@1')."""

    def rows(self, **f: Any) -> list[dict[str, Any]]:
        return _filter(_rows(), **{k: str(v) for k, v in f.items() if k in ("kind", "app", "plugin", "status", "family", "q")})

    def search(self, q: str, kind: str = "", app: str = "", limit: int = 30) -> list[dict[str, Any]]:
        return search(str(q), str(kind), str(app), int(limit))

    def row(self, id: str) -> dict[str, Any] | None:  # noqa: A002 - the parameter is called id
        return next((x for x in _rows() if x.get("id") == id), None)

    def rebuild(self, reason: str = "plugin", build: str = "") -> dict[str, Any]:
        return rebuild(str(reason), str(build))


try:  # the console's capability registry (absent in unit tests)
    import plugin_services  # type: ignore

    plugin_services.provide(SELF, Service(), HERE.name)
except Exception:  # noqa: BLE001 - optional at import time
    pass
