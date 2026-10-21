"""Server part of the Sandbox plugin. Mounted at /api/plugins/sandbox/.

A place to try things with GitHub and Build Pilot's designer **without changing anything real**:

- GitHub: read-only, through axHub's `github` service and only the operations in `shield.GITHUB_OPS`, on the
  repositories the admin opened (shield.py explains the rules).
- Pilot: Build Pilot's designer steps (template, boilerplate, look, libraries, build options) over the framework's
  catalog, read from the console's own files (never written). A design is saved only as a sandbox file; the sandbox
  never builds, publishes or calls Build Pilot.
- Files: each signed-in person gets private editable files (workspace.py) that stay until an admin clears them.
- Admin (hub admin or the console token): config, every workspace with its size, clear one or all, activity log.

"wallUsers": true: every signed-in hub account reaches these routes (the console checks the wall signature and the
origin of browser writes); this module decides per caller (`openTo` in the config, admin-only routes).
Never on the console MCP. Data only in .axf-console/plugins/sandbox/ (AXF_SANDBOX_DIR overrides, for tests).
"""
from __future__ import annotations

import json
import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request

import axf_framework  # noqa: F401 — framework/python on sys.path
import console_context as cx
from axf_server import storage

from . import shield
from .hub import HubError, HubReader
from .shield import ShieldError
from .workspace import Workspaces

router = APIRouter()
MAX_BODY = 4 * 1024 * 1024
FILE_VIEW_MAX = 512 * 1024
AUDIT_ROTATE_BYTES = 512 * 1024
_cfg_lock = threading.Lock()
HUB = HubReader()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_SANDBOX_DIR") or (cx.ROOT / ".axf-console" / "plugins" / "sandbox"))


def workspaces() -> Workspaces:
    return Workspaces(data_dir())


# ---------------------------------------------------------------- config + who is calling

def config() -> dict[str, Any]:
    raw = storage.read_json(data_dir() / "config.json", {})
    try:
        return shield.clean_config(raw if isinstance(raw, dict) else {})
    except ShieldError:
        return dict(shield.DEFAULT_CONFIG)


class Who:
    def __init__(self, name: str, admin: bool, can: Any) -> None:
        self.name, self.admin, self.can = name, admin, can


def who(request: Request) -> Who:
    u = getattr(request.state, "axf_user", None)
    if u is None:  # an open console (no token, no wall): whoever reaches it runs it
        return Who("console", True, lambda _p: True)
    name = str(getattr(u, "name", "") or "user")
    admin = bool(getattr(u, "admin", False))
    can = getattr(u, "can", lambda _p: False)
    return Who("console" if name == "console-token" else name, admin, can)


def user(request: Request) -> Who:
    w = who(request)
    ok, why = shield.may_use(config(), w.admin, w.can)
    if not ok:
        raise HTTPException(403, why)
    return w


def admin(request: Request) -> Who:
    w = who(request)
    if not w.admin:
        raise HTTPException(403, "Sandbox management is for admins.")
    return w


def audit(w: Who, action: str, detail: str = "") -> None:
    p = data_dir() / "audit.jsonl"
    try:
        storage.append_jsonl(p, {"at": time.time(), "user": w.name[:64], "action": action[:40], "detail": detail[:200]}, rotate_at=AUDIT_ROTATE_BYTES)
    except Exception:  # noqa: BLE001 — the log never blocks the sandbox
        pass


async def body(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, "at most 4 MB")
    if not raw:
        return {}
    try:
        b = json.loads(raw)
    except ValueError:
        raise HTTPException(400, "send JSON") from None
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


def refuse(e: Exception) -> HTTPException:
    if isinstance(e, ShieldError):
        return HTTPException(400, str(e))
    if isinstance(e, HubError):
        return HTTPException(502, str(e))
    return HTTPException(500, "sandbox error")


# ---------------------------------------------------------------- me

@router.get("/me")
def me(request: Request) -> dict[str, Any]:
    w = who(request)
    cfg = config()
    ok, why = shield.may_use(cfg, w.admin, w.can)
    hub_ok, hub_why = HUB.ready()
    return {"user": w.name, "admin": w.admin, "allowed": ok, "reason": why, "readOnly": True,
            "github": {"ready": hub_ok, "reason": hub_why, "repos": cfg["repos"]},
            "limits": {k: cfg[k] for k in ("maxFiles", "maxFileKb", "maxTotalMb")},
            "usage": workspaces().usage(w.name) if ok else {"files": 0, "bytes": 0}}


# ---------------------------------------------------------------- GitHub (read-only)

def _split(full: Any) -> tuple[str, str]:
    if not isinstance(full, str) or full.count("/") != 1:
        raise ShieldError("pick a repository (owner/name)")
    o, r = full.split("/")
    return o, r


def _gh(op: str, full: Any, args: dict[str, Any]) -> Any:
    o, r = _split(full)
    tool, arguments = shield.github_call(op, o, r, args, set(config()["repos"]))
    return HUB.call(tool, arguments)


@router.post("/github")
async def github(request: Request) -> dict[str, Any]:
    w = user(request)
    b = await body(request)
    op = b.get("op")
    try:
        data = _gh(str(op or ""), b.get("repo"), b.get("args") if isinstance(b.get("args"), dict) else {})
    except (ShieldError, HubError) as e:
        raise refuse(e) from None
    audit(w, "github", f"{op} {b.get('repo')}")
    return {"op": op, "data": data}


def _file_from_github(full: Any, path: Any, ref: Any) -> dict[str, Any]:
    if not isinstance(path, str) or not path:
        raise ShieldError("pick a file")
    args: dict[str, Any] = {"path": path}
    if ref:
        args["ref"] = ref
    item = _gh("contents", full, args)
    if not isinstance(item, dict) or item.get("type") != "file":
        raise ShieldError("that's not a file")
    text, is_text = shield.decode_content(item, FILE_VIEW_MAX)
    return {"path": item.get("path", path), "sha": item.get("sha"), "size": item.get("size"), "text": text, "isText": is_text,
            "htmlUrl": item.get("html_url") if str(item.get("html_url", "")).startswith("https://github.com/") else None}


@router.post("/github/file")
async def github_file(request: Request) -> dict[str, Any]:
    user(request)
    b = await body(request)
    try:
        return _file_from_github(b.get("repo"), b.get("path"), b.get("ref"))
    except (ShieldError, HubError) as e:
        raise refuse(e) from None


@router.post("/github/copy")
async def github_copy(request: Request) -> dict[str, Any]:
    """Copy a GitHub file into the person's sandbox files (as an editable copy; GitHub is untouched)."""
    w = user(request)
    b = await body(request)
    try:
        f = _file_from_github(b.get("repo"), b.get("path"), b.get("ref"))
        if not f["isText"]:
            raise ShieldError("only text files can be copied into the sandbox")
        o, r = _split(b.get("repo"))
        dest = b.get("to") or f"github/{r}/{f['path']}"
        saved = workspaces().write(w.name, str(dest), f["text"], config())
    except (ShieldError, HubError) as e:
        raise refuse(e) from None
    audit(w, "copy", f"{o}/{r}:{f['path']} → {saved['path']}")
    return saved


# ---------------------------------------------------------------- Pilot (the framework catalog, read-only)

def _read(rel: str, default: Any) -> Any:
    p = cx.ROOT / rel
    try:
        p.resolve().relative_to(cx.ROOT.resolve())
    except ValueError:
        return default
    if p.is_symlink():
        return default
    return storage.read_json(p, default)


def _assets() -> dict[str, list[dict[str, Any]]]:
    root = cx.ROOT / "framework" / "assets"
    out: dict[str, list[dict[str, Any]]] = {}
    if not root.is_dir():
        return out
    for tdir in sorted(root.iterdir()):
        if not tdir.is_dir() or tdir.is_symlink():
            continue
        items = []
        for f in sorted(tdir.glob("*.json")):
            if f.is_symlink():
                continue
            a = storage.read_json(f, {})
            if isinstance(a, dict) and a.get("$axf") == "asset@1":
                items.append({"id": a.get("id"), "name": a.get("name"), "description": a.get("description", ""), "tags": a.get("tags", [])})
        if items:
            out[tdir.name] = items
    return out


@router.get("/pilot/catalog")
def pilot_catalog(request: Request) -> dict[str, Any]:
    user(request)
    templates = {}
    tdir = cx.ROOT / "framework" / "templates"
    if tdir.is_dir():
        for t in sorted(tdir.iterdir()):
            meta = storage.read_json(t / "template.json", None) if t.is_dir() and not t.is_symlink() else None
            if isinstance(meta, dict):
                templates[t.name] = {"label": meta.get("label", t.name), "kind": meta.get("kind"), "targets": meta.get("targets", [])}
    bp = _read("framework/boilerplates/index.json", {})
    libs = _read("framework/catalog/libraries.json", {})
    opts = _read("framework/schemas/build-options.json", {})
    return {
        "templates": templates,
        "boilerplates": {"categories": bp.get("categories", []), "items": bp.get("items", [])} if isinstance(bp, dict) else {"categories": [], "items": []},
        "libraries": [{"id": x.get("id"), "name": x.get("name"), "description": x.get("description", ""), "dependsOn": x.get("dependsOn", [])}
                      for x in (libs.get("items", []) if isinstance(libs, dict) else []) if isinstance(x, dict)],
        "buildOptions": opts.get("options", {}) if isinstance(opts, dict) else {},
        "defaults": _read("framework/defaults.json", {}),
        "assets": _assets(),
    }


# ---------------------------------------------------------------- the person's files

@router.get("/files")
def files(request: Request) -> dict[str, Any]:
    w = user(request)
    ws = workspaces()
    return {"files": ws.list(w.name), "usage": ws.usage(w.name)}


@router.get("/file")
def file_get(request: Request, path: str = "") -> dict[str, Any]:
    w = user(request)
    try:
        return workspaces().read(w.name, path)
    except ShieldError as e:
        raise refuse(e) from None


@router.put("/file")
async def file_put(request: Request) -> dict[str, Any]:
    w = user(request)
    b = await body(request)
    try:
        saved = workspaces().write(w.name, str(b.get("path") or ""), b.get("text"), config(), create_only=b.get("create") is True)
    except ShieldError as e:
        raise refuse(e) from None
    audit(w, "save", saved["path"])
    return saved


@router.post("/file/rename")
async def file_rename(request: Request) -> dict[str, Any]:
    w = user(request)
    b = await body(request)
    try:
        r = workspaces().rename(w.name, str(b.get("from") or ""), str(b.get("to") or ""))
    except ShieldError as e:
        raise refuse(e) from None
    audit(w, "rename", f"{b.get('from')} → {r['path']}")
    return r


@router.delete("/file")
def file_delete(request: Request, path: str = "") -> dict[str, bool]:
    w = user(request)
    try:
        workspaces().delete(w.name, path)
    except ShieldError as e:
        raise refuse(e) from None
    audit(w, "delete", path)
    return {"ok": True}


# ---------------------------------------------------------------- admin: Sandbox management

@router.get("/admin/state")
def admin_state(request: Request) -> dict[str, Any]:
    admin(request)
    hub_ok, hub_why = HUB.ready()
    log: list[dict[str, Any]] = []
    p = data_dir() / "audit.jsonl"
    if p.is_file() and not p.is_symlink():
        for line in p.read_text(encoding="utf-8", errors="replace").splitlines()[-200:]:
            try:
                log.append(json.loads(line))
            except ValueError:
                continue
    return {"config": config(), "workspaces": workspaces().all(), "hub": {"ready": hub_ok, "reason": hub_why},
            "log": list(reversed(log)), "readTools": sorted(shield.READ_TOOLS), "ops": sorted(shield.GITHUB_OPS)}


@router.put("/admin/config")
async def admin_config(request: Request) -> dict[str, Any]:
    w = admin(request)
    b = await body(request)
    with _cfg_lock:
        try:
            cfg = shield.clean_config(b, config())
        except ShieldError as e:
            raise refuse(e) from None
        storage.write_json(data_dir() / "config.json", cfg)
    audit(w, "config", ", ".join(sorted(b))[:200])
    return cfg


@router.post("/admin/clear")
async def admin_clear(request: Request) -> dict[str, Any]:
    """Clear one person's sandbox files ({"workspace": id, "confirm": id}) or everyone's ({"workspace": "*", "confirm": "clear all"})."""
    w = admin(request)
    b = await body(request)
    target = b.get("workspace")
    if target == "*":
        if b.get("confirm") != "clear all":
            raise HTTPException(400, 'type "clear all" to clear every sandbox')
        n = workspaces().clear(None)
    else:
        if not isinstance(target, str) or shield.user_slug(target) != target or b.get("confirm") != target:
            raise HTTPException(400, "confirm with the workspace's id")
        n = workspaces().clear(target)
    audit(w, "clear", f"{target} ({n})")
    return {"cleared": n}
