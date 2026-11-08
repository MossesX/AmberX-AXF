"""Server part of the Glossary & Index plugin (glossary-catalog@1). Mounted at /api/plugins/glossary-index/.

The console adds the console-token check (every method) and the 404 while disabled. The catalog is built by the
plugin's own Node builder (catalog.mjs) from what the repo registers (plugins, help, assets, asset types, CLI tools,
build options, features, the UI registry) into the plugin's data folder, and rebuilt whenever it is missing or a build
lands (the orchestrator's post-build hook). No model, no tokens.

Routes: GET catalog · GET stats · GET search · GET entry · GET changes · POST rebuild.
Demonstrations, books, clips and docs (demonstration@1, book@1, clip@1, docs@1; demos.mjs + docs.mjs, assets in the
same data folder): GET demos · GET demo · POST demo · DELETE demo · POST demo/generate · GET demo/walkthrough ·
POST book/new · POST book/change · GET book/outline · POST book/record · POST clip/register · POST clip/from-demo ·
POST docs/generate · GET docs/file.
Capability glossary@1: lookup(id), search(q), rebuild(reason, build), demos(type), demo(type, id), generate(entry)
for other plugins (a plugin that wants a demonstration of itself asks here).
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import threading
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, Response

import plugin_services

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
ROOT = Path(__file__).resolve().parents[5]  # the repo root (/axf in the console image)
CLI = HERE / "catalog.mjs"
DEMOS = HERE / "demos.mjs"
DOCS = HERE / "docs.mjs"
SELF = "glossary@1"
DEMO_TYPES = ("demonstration", "book", "clip", "docs")
_SAFE_ID = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
_lock = threading.Lock()
_cache: dict[str, Any] = {"mtime": 0.0, "value": None, "raw": b""}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_GLOSSARY_DIR") or (ROOT / ".axf-console" / "plugins" / "glossary-index"))


def _run(*args: str, timeout: int = 120, cli: Path = CLI, stdin: str | None = None) -> tuple[int, str, str]:
    env = {**os.environ, "AXF_REPO_ROOT": str(ROOT), "AXF_GLOSSARY_DIR": str(data_dir())}
    p = subprocess.run(["node", str(cli), *args], cwd=str(ROOT), capture_output=True, text=True, timeout=timeout, env=env, input=stdin)
    return p.returncode, p.stdout.strip(), p.stderr.strip()


def _node_json(cli: Path, *args: str, stdin: str | None = None, timeout: int = 180) -> Any:
    """Run one of the plugin's Node tools with --json and answer its JSON; its error line becomes the HTTP error."""
    try:
        code, out, err = _run(*args, "--json", timeout=timeout, cli=cli, stdin=stdin)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the glossary tools didn't answer: {type(e).__name__}") from e
    if code != 0:
        msg = (err or out or "the glossary tool failed").splitlines()[-1][-400:]
        raise HTTPException(400 if code == 1 else 404 if code == 2 else 500, msg.replace("demos: ", "").replace("docs: ", ""))
    try:
        return json.loads(out.splitlines()[-1]) if out else None
    except json.JSONDecodeError:
        raise HTTPException(500, f"the glossary tool answered no JSON: {out[-200:]}")


def _check_type(t: str) -> str:
    if t not in DEMO_TYPES:
        raise HTTPException(400, f"type must be one of {', '.join(DEMO_TYPES)}")
    return t


def _check_id(i: str) -> str:
    if not _SAFE_ID.match(i or ""):
        raise HTTPException(400, "id must be lowercase letters, digits and dashes (2 to 48)")
    return i


def _tmp_json(value: Any) -> Path:
    """The Node tools take an asset from a file: write it beside the store (never in git)."""
    d = data_dir() / "tmp"
    d.mkdir(parents=True, exist_ok=True)
    f = d / f"in-{os.getpid()}-{threading.get_ident()}.json"
    f.write_text(json.dumps(value))
    return f


def rebuild(reason: str = "console", build: str = "") -> dict[str, Any]:
    """Rebuild the catalog from the registries (writes only when something moved)."""
    args = ["build", "--json", "--reason", reason[:80] or "console"]
    if build:
        args += ["--build", build[:120]]
    try:
        code, out, err = _run(*args)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"the glossary builder didn't answer: {type(e).__name__}") from e
    if code != 0:
        raise HTTPException(500, (err or out or "the glossary builder failed")[-400:])
    try:
        return json.loads(out)
    except json.JSONDecodeError:
        return {"wrote": False, "output": out[-400:]}


def _load() -> tuple[dict[str, Any], bytes]:
    """The saved catalog (cached by modification time), built first when it doesn't exist yet."""
    f = data_dir() / "catalog.json"
    with _lock:
        if not f.exists():
            rebuild("first read")
        if not f.exists():
            raise HTTPException(503, "the glossary hasn't been built yet")
        m = f.stat().st_mtime
        if _cache["value"] is None or m != _cache["mtime"]:
            raw = f.read_bytes()
            _cache.update(mtime=m, raw=raw, value=json.loads(raw))
        return _cache["value"], _cache["raw"]


def lookup(entry_id: str) -> dict[str, Any] | None:
    cat, _ = _load()
    for e in cat.get("entries", []):
        if e.get("id") == entry_id:
            return e
    return None


def search(q: str, kind: str = "", limit: int = 30) -> list[dict[str, Any]]:
    """Same ranking as the CLI and the page: every word must match; exact and leading term matches first."""
    cat, _ = _load()
    words = [w for w in q.lower().split() if w]
    kinds = {k for k in kind.split(",") if k}
    scored: list[tuple[int, str, dict[str, Any]]] = []
    for e in cat.get("entries", []):
        if kinds and e.get("kind") not in kinds:
            continue
        term = str(e.get("term", "")).lower()
        kw = e.get("keywords", [])
        hay = f"{term} {str(e.get('summary', '')).lower()} {' '.join(kw)} {str(e.get('category', '')).lower()} {e.get('id', '')}"
        if words and not all(w in hay for w in words):
            continue
        s = 0
        for w in words:
            s += 50 if term == w else 20 if term.startswith(w) else 10 if w in term else 4 if w in kw else 1
        s += 5 if e.get("kind") == "concept" else 3 if e.get("kind") == "plugin" else 0
        scored.append((s, term, e))
    scored.sort(key=lambda x: (-x[0], x[1]))
    return [e for _, _, e in scored[: max(1, min(limit, 200))]]


@router.get("/catalog")
def get_catalog() -> Response:
    _, raw = _load()
    return Response(content=raw, media_type="application/json")


@router.get("/stats")
def get_stats() -> dict[str, Any]:
    cat, _ = _load()
    return {k: cat.get(k) for k in ("generatedAt", "total", "counts", "generic", "kinds")}


@router.get("/search")
def get_search(q: str = "", kind: str = "", limit: int = 30) -> dict[str, Any]:
    return {"q": q, "results": search(q, kind, limit)}


@router.get("/entry")
def get_entry(id: str) -> dict[str, Any]:  # noqa: A002 - the query parameter is called id
    e = lookup(id)
    if e is None:
        raise HTTPException(404, f"no glossary entry {id}")
    cat, _ = _load()
    linked = [x["id"] for x in cat.get("entries", []) if id in (x.get("related") or []) or id in (x.get("children") or [])]
    return {**e, "linkedFrom": linked[:60]}


@router.get("/changes")
def get_changes() -> list[dict[str, Any]]:
    f = data_dir() / "changes.json"
    try:
        return json.loads(f.read_text()) if f.exists() else []
    except (OSError, json.JSONDecodeError):
        return []


@router.post("/rebuild")
def post_rebuild(body: dict[str, Any] | None = None) -> dict[str, Any]:
    b = body or {}
    return rebuild(str(b.get("reason") or "console"), str(b.get("build") or ""))


# ---------------- demonstrations, books, clips, docs (demos.mjs) ----------------


@router.get("/demos")
def get_demos(type: str = "", q: str = "", generated: bool = False) -> dict[str, Any]:  # noqa: A002 - the query parameter is called type
    if q or generated:  # the designer's search and "Only generated" switch, over the API
        args = ["find"] + ([_check_type(type)] if type else []) + (["--q", q[:200]] if q else []) + (["--generated"] if generated else [])
        return {"items": _node_json(DEMOS, *args) or []}
    args = ["list"] + ([_check_type(type)] if type else [])
    return {"items": _node_json(DEMOS, *args) or []}


@router.post("/demo/new")
def post_demo_new(body: dict[str, Any] | None = None) -> dict[str, Any]:
    f = _tmp_json(body or {})
    try:
        return _node_json(DEMOS, "demo", "new-from", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.post("/demo/change")
def post_demo_change(body: dict[str, Any]) -> dict[str, Any]:
    demo_id = _check_id(str(body.get("id") or ""))
    change = body.get("change")
    if not isinstance(change, dict) or not change.get("op"):
        raise HTTPException(400, "change is { op, … }")
    f = _tmp_json(change)
    try:
        return _node_json(DEMOS, "demo", demo_id, "change", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.get("/demo")
def get_demo(type: str, id: str) -> dict[str, Any]:  # noqa: A002
    return _node_json(DEMOS, "get", _check_type(type), _check_id(id))


@router.post("/demo")
def post_demo(body: dict[str, Any]) -> dict[str, Any]:
    t = _check_type(str(body.get("type") or ""))
    asset = body.get("asset")
    if not isinstance(asset, dict):
        raise HTTPException(400, "asset must be the asset@1 object")
    f = _tmp_json(asset)
    try:
        return _node_json(DEMOS, "save", t, str(f))
    finally:
        f.unlink(missing_ok=True)


@router.delete("/demo")
def delete_demo(type: str, id: str) -> dict[str, Any]:  # noqa: A002
    code, out, err = _run("delete", _check_type(type), _check_id(id), cli=DEMOS)
    if code != 0:
        raise HTTPException(400, (err or out)[-300:])
    return {"removed": "removed" in out, "type": type, "id": id}


@router.post("/demo/generate")
def post_generate(body: dict[str, Any] | None = None) -> dict[str, Any]:
    b = body or {}
    entry = str(b.get("entry") or "").strip()
    if not entry:
        raise HTTPException(400, "entry is the glossary entry id to demonstrate")
    args = ["generate", entry]
    if b.get("save", True):
        args.append("--save")
    if b.get("build"):
        args += ["--build", str(b["build"])[:120]]
    return _node_json(DEMOS, *args)


@router.get("/demo/walkthrough")
def get_walkthrough(type: str, id: str) -> dict[str, Any]:  # noqa: A002
    return _node_json(DEMOS, "walkthrough", _check_type(type), _check_id(id))


@router.post("/book/new")
def post_book_new(body: dict[str, Any] | None = None) -> dict[str, Any]:
    f = _tmp_json(body or {})
    try:
        return _node_json(DEMOS, "book", "new-from", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.post("/book/change")
def post_book_change(body: dict[str, Any]) -> dict[str, Any]:
    book_id = _check_id(str(body.get("id") or ""))
    change = body.get("change")
    if not isinstance(change, dict) or not change.get("op"):
        raise HTTPException(400, "change is { op, … }")
    f = _tmp_json(change)
    try:
        return _node_json(DEMOS, "book", book_id, "change", str(f))
    finally:
        f.unlink(missing_ok=True)


@router.get("/book/outline")
def get_outline(id: str = "") -> list[dict[str, Any]]:  # noqa: A002
    return _node_json(DEMOS, "outline", *([_check_id(id)] if id else [])) or []


@router.post("/book/record")
def post_book_record(body: dict[str, Any]) -> dict[str, Any]:
    args = ["book", _check_id(str(body.get("id") or "")), "record"]
    if body.get("dryRun"):
        args.append("--dry-run")
    return _node_json(DEMOS, *args, timeout=120)


@router.post("/clip/register")
def post_clip_register(body: dict[str, Any]) -> dict[str, Any]:
    asset = body.get("asset", body)
    f = _tmp_json(asset)
    try:
        return _node_json(DEMOS, "clip", "register", str(f), "--full")
    finally:
        f.unlink(missing_ok=True)


@router.post("/clip/from-demo")
def post_clip_from_demo(body: dict[str, Any]) -> dict[str, Any]:
    demo_id = _check_id(str(body.get("id") or ""))
    media = body.get("media") if isinstance(body.get("media"), dict) else {}
    recorded = body.get("recorded") if isinstance(body.get("recorded"), dict) else {}
    f = _tmp_json({"media": media, "recorded": recorded})
    try:
        return _node_json(DEMOS, "clip", "from-demo", demo_id, "--from", str(f), "--full")
    finally:
        f.unlink(missing_ok=True)


@router.post("/docs/generate")
def post_docs_generate(body: dict[str, Any]) -> dict[str, Any]:
    source = body.get("source") if isinstance(body.get("source"), dict) else {}
    options = body.get("options") if isinstance(body.get("options"), dict) else {}
    kind = str(source.get("kind") or "")
    if kind not in ("book", "demonstration", "entries"):
        raise HTTPException(400, "source.kind must be book, demonstration or entries")
    tokens = body.get("tokens") if isinstance(body.get("tokens"), dict) else None
    f = _tmp_json({"source": source, "options": options, "build": str(body.get("build") or ""), "tokens": tokens, "consoleOrigin": str(body.get("consoleOrigin") or "")[:200]})
    try:
        return _node_json(DOCS, "generate-from", str(f), timeout=300)
    finally:
        f.unlink(missing_ok=True)


_MEDIA = {".html": "text/html; charset=utf-8", ".md": "text/markdown; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".ts": "text/plain; charset=utf-8", ".json": "application/json", ".vtt": "text/vtt", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg", ".mp4": "video/mp4"}


@router.get("/docs/file")
def get_docs_file(id: str, path: str = "index.html") -> FileResponse:  # noqa: A002
    """One file of a generated documentation set (the docs asset's folder, <dataDir>/docs-out/<id>/)."""
    root = (data_dir() / "docs-out" / _check_id(id)).resolve()
    target = (root / path.lstrip("/")).resolve()
    if root not in target.parents or not target.is_file():
        raise HTTPException(404, f"no file {path} in docs {id}")
    return FileResponse(str(target), media_type=_MEDIA.get(target.suffix.lower(), "application/octet-stream"))


class Service:
    """glossary@1 for other plugins: entries by id, ranked search, rebuild after a build lands, demonstrations."""

    def lookup(self, entry_id: str) -> dict[str, Any] | None:
        return lookup(entry_id)

    def search(self, q: str, kind: str = "", limit: int = 30) -> list[dict[str, Any]]:
        return search(q, kind, limit)

    def rebuild(self, reason: str = "service", build: str = "") -> dict[str, Any]:
        return rebuild(reason, build)

    def demos(self, type: str = "") -> list[dict[str, Any]]:  # noqa: A002
        return get_demos(type)["items"]

    def demo(self, type: str, id: str) -> dict[str, Any]:  # noqa: A002
        return get_demo(type, id)

    def generate(self, entry: str, save: bool = True) -> dict[str, Any]:
        return post_generate({"entry": entry, "save": save})


plugin_services.provide(SELF, Service(), HERE.name)
