"""Plugins menu — server part. Mounted at /api/plugins/plugins-menu/ (console token on every method, 404 when disabled,
never on the console MCP).

The plugin installer's **archive locations**: places plugins are kept (plugin-catalog@1 layout: `catalog.json` +
`packages/<kind>/<folder>/<version>.json` = plugin-package@1), each with the credentials it needs. **axHub** is the
permanent archive (it can't be removed and it always needs a credential: the axHub token saved here, or the console's
own AXHUB_TOKEN); others are added by the person. Kinds are an open registry (ARCHIVE_KINDS): `axhub`, `folder` (a
catalog folder on this server), `https` (any https server with that layout, optional bearer / basic / header auth),
`console` (another Dev Console's /api/plugin-catalog with its console token) + placeholders (`github`, `s3`, `sftp`,
`oci`) that say they aren't built yet.

Credentials live only in <dataDir>/archives.json (0600); the browser sees whether one is set, its type and a user name,
never a token or password. Every request is https (plain http only to this machine), never follows a redirect, and is
size-capped. Installing never trusts an archive: the package goes through `plugin-catalog.mjs install-package`, which
verifies it (hash against the archive's index, file rules, plugin@1 + build-defaults@1, one instance per plugin, another
model's build only through the confirmed replace).

Routes: GET /archives · POST /archives · DELETE /archives/{id} · POST /archives/{id}/test · GET /browse?archive=&q= ·
GET /item?archive=&folder= · POST /install {archive, folder, version?, confirm, update?, replace?, keepData?, publish?} ·
GET /config · PUT /config
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
import subprocess
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import quote

from fastapi import APIRouter, HTTPException

import build_defaults
import console_context as cx
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import http as axf_http
from axf_server import storage

router = APIRouter()
FOLDER = "plugins-menu"
_lock = threading.Lock()
_install_lock = threading.Lock()

ID_RE = re.compile(r"^[a-z][a-z0-9-]{1,31}$")
FOLDER_RE = re.compile(r"^[a-z0-9][a-z0-9-]{1,47}$")
VERSION_RE = re.compile(r"^\d{1,6}\.\d{1,6}\.\d{1,6}(?:[-+][0-9A-Za-z.-]{1,40})?$")
HEADER_RE = re.compile(r"^[A-Za-z][A-Za-z0-9-]{0,63}$")
MAX_ARCHIVES = 30
INDEX_BYTES = 4 * 1024 * 1024
PACKAGE_BYTES = 16 * 1024 * 1024
CACHE_S = 60

# Open registry of archive kinds. `built: False` = placeholder (shown in the add form, refused on save until built).
ARCHIVE_KINDS: dict[str, dict[str, Any]] = {
    "axhub": {"label": "axHub (permanent)", "built": True, "location": "https URL of the hub", "auth": ["bearer"], "needsCredential": True},
    "folder": {"label": "Folder on the console server", "built": True, "location": "absolute path of a plugin-catalog folder", "auth": ["none"]},
    "https": {"label": "HTTPS server", "built": True, "location": "https URL holding catalog.json", "auth": ["none", "bearer", "basic", "header"]},
    "console": {"label": "Another Dev Console", "built": True, "location": "https URL of the console", "auth": ["bearer"], "needsCredential": True},
    "github": {"label": "GitHub repository (placeholder)", "built": False, "location": "owner/repo[/path]", "auth": ["none", "bearer"]},
    "s3": {"label": "S3 bucket (placeholder)", "built": False, "location": "s3://bucket/prefix", "auth": ["keypair"]},
    "sftp": {"label": "SFTP (placeholder)", "built": False, "location": "sftp://host/path", "auth": ["basic", "key"]},
    "oci": {"label": "OCI registry (placeholder)", "built": False, "location": "registry/repo", "auth": ["bearer", "basic"]},
}
AUTH_TYPES = {"none": "No credentials", "bearer": "Token (Bearer)", "basic": "User + password", "header": "Custom header", "keypair": "Access key + secret (placeholder)", "key": "SSH key (placeholder)"}

# The installer's own settings (hard-baked in its dialog). Every key, its type and default; unknown keys are dropped.
CONFIG_SPEC: dict[str, tuple[type, Any]] = {
    "publish": (bool, True),            # commit an installed plugin to GitHub so the console keeps it
    "keepDataOnReplace": (bool, False),  # replacing a build with another model's keeps the old data folder
    "showInstalled": (bool, True),       # list plugins that are already installed
    "showOtherKinds": (bool, False),     # list Build Pilot plugins too (read-only here)
    "checkOnOpen": (bool, True),         # read every archive when the dialog opens
    "confirmTyping": (bool, True),       # type the folder name to confirm an install (off = tap twice)
    "sort": (str, "name"),               # name | archive | newest | model
    "pageSize": (int, 50),               # 10-200
    "defaultArchive": (str, "all"),      # all | <archive id>
}
SORTS = {"name", "archive", "newest", "model"}

HUB_DEFAULT = "https://axhub.amberxai.com"


class ArchiveError(Exception):
    pass


# ------------------------------------------------------------------ store

def data_dir() -> Path:
    return Path(os.environ.get("AXF_PLUGINS_MENU_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _axhub_default() -> dict[str, Any]:
    return {"id": "axhub", "label": "axHub", "kind": "axhub", "location": (os.environ.get("AXHUB_URL") or HUB_DEFAULT).rstrip("/"),
            "enabled": True, "permanent": True, "auth": {"type": "bearer"}, "createdAt": 0}


def _load() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "archives.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    items = [a for a in (raw.get("archives") or []) if isinstance(a, dict) and ID_RE.match(str(a.get("id", "")))]
    hub = next((a for a in items if a["id"] == "axhub"), None)
    base = _axhub_default()
    if hub is None:
        items.insert(0, base)
    else:  # the permanent archive keeps its kind and stays on; only its address and credential can change
        hub.update({"kind": "axhub", "permanent": True, "enabled": True})
        hub.setdefault("location", base["location"])
    return {"archives": items}


def _save(db: dict[str, Any]) -> None:
    storage.write_json(data_dir() / "archives.json", db, indent=None)  # atomic, 0600, folder 0700


def _config() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "config.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    return clean_config(raw)


def clean_config(raw: Any) -> dict[str, Any]:
    raw = raw if isinstance(raw, dict) else {}
    out: dict[str, Any] = {}
    for k, (t, d) in CONFIG_SPEC.items():
        v = raw.get(k, d)
        if t is bool:
            out[k] = v if isinstance(v, bool) else d
        elif t is int:
            out[k] = min(200, max(10, int(v))) if isinstance(v, (int, float)) and not isinstance(v, bool) else d
        else:
            out[k] = v if isinstance(v, str) and len(v) <= 40 else d
    if out["sort"] not in SORTS:
        out["sort"] = "name"
    if out["defaultArchive"] != "all" and not ID_RE.match(out["defaultArchive"]):
        out["defaultArchive"] = "all"
    return out


def credential_of(a: dict[str, Any]) -> dict[str, str]:
    """The stored secret fields of an archive's auth (or, for axHub with none saved, the console's AXHUB_TOKEN)."""
    auth = a.get("auth") if isinstance(a.get("auth"), dict) else {}
    cred = {k: str(auth.get(k) or "") for k in ("token", "user", "password", "header", "value")}
    if a.get("kind") == "axhub" and not cred["token"]:
        cred["token"] = os.environ.get("AXHUB_TOKEN", "").strip()
        cred["fromEnv"] = "1" if cred["token"] else ""
    return cred


def public(a: dict[str, Any]) -> dict[str, Any]:
    auth = a.get("auth") if isinstance(a.get("auth"), dict) else {}
    t = str(auth.get("type") or "none")
    cred = credential_of(a)
    has = bool(cred["token"]) if t == "bearer" else bool(cred["user"] and cred["password"]) if t == "basic" else bool(cred["header"] and cred["value"]) if t == "header" else t == "none"
    k = ARCHIVE_KINDS.get(str(a.get("kind")), {})
    return {"id": a["id"], "label": a.get("label") or a["id"], "kind": a.get("kind"), "kindLabel": k.get("label", a.get("kind")),
            "built": bool(k.get("built")), "location": a.get("location", ""), "enabled": a.get("enabled", True) is not False,
            "permanent": bool(a.get("permanent")), "auth": {"type": t, "user": cred["user"] if t == "basic" else "", "header": cred["header"] if t == "header" else "",
                                                           "set": has, "fromEnv": bool(cred.get("fromEnv"))},
            "needsCredential": bool(k.get("needsCredential")), "lastTest": a.get("lastTest"), "createdAt": a.get("createdAt")}


def listing(db: dict[str, Any] | None = None) -> dict[str, Any]:
    db = db or _load()
    return {"archives": [public(a) for a in db["archives"]],
            "kinds": [{"id": k, **v} for k, v in ARCHIVE_KINDS.items()],
            "authTypes": [{"id": k, "label": v} for k, v in AUTH_TYPES.items()]}


def _check_location(kind: str, loc: str) -> str:
    loc = loc.strip()
    if not loc or len(loc) > 300:
        raise ArchiveError("a location is needed (at most 300 characters)")
    if kind == "folder":
        p = Path(loc)
        if not p.is_absolute() or ".." in p.parts:
            raise ArchiveError("a folder archive needs an absolute path without ..")
        return str(p)
    if kind in ("https", "console", "axhub"):
        if not axf_http.target_ok(loc):
            raise ArchiveError("the address must be https (plain http only to this machine)")
        return loc.rstrip("/")
    return loc


# ------------------------------------------------------------------ reading an archive

_cache: dict[str, tuple[float, dict[str, Any]]] = {}


def _headers(a: dict[str, Any]) -> tuple[dict[str, str], list[str]]:
    auth = a.get("auth") if isinstance(a.get("auth"), dict) else {}
    t = str(auth.get("type") or "none")
    c = credential_of(a)
    if t == "bearer" and c["token"]:
        return {"authorization": f"Bearer {c['token']}"}, ["authorization"]
    if t == "basic" and c["user"]:
        return {"authorization": "Basic " + base64.b64encode(f"{c['user']}:{c['password']}".encode()).decode()}, ["authorization"]
    if t == "header" and c["header"]:
        return {c["header"]: c["value"]}, [c["header"]]
    return {}, []


def _get(a: dict[str, Any], url: str, cap: int) -> Any:
    h, secret = _headers(a)
    try:
        r = axf_http.request("GET", url, headers={**h, "accept": "application/json"}, timeout=20, max_bytes=cap, secret_headers=secret)
    except axf_http.HttpError as e:
        raise ArchiveError(f"couldn't reach {a.get('label')} ({type(e).__name__})") from None
    if r.status in (401, 403):
        raise ArchiveError(f"{a.get('label')} refused the credentials ({r.status})")
    if r.status == 404:
        raise ArchiveError(f"{a.get('label')}: not found (404)")
    if not r.ok:
        raise ArchiveError(f"{a.get('label')} answered {r.status}")
    try:
        return json.loads(r.text())
    except ValueError:
        raise ArchiveError(f"{a.get('label')} didn't answer JSON") from None


def _cli(args: list[str], env: dict[str, str] | None = None, stdin: str | None = None, timeout: int = 120) -> dict[str, Any]:
    cli = cx.ROOT / "framework" / "cli" / "plugin-catalog.mjs"
    proc = subprocess.run(["node", str(cli), *args, "--json"], cwd=cx.ROOT, input=stdin, capture_output=True, text=True, timeout=timeout,
                          env={**os.environ, "AXF_ROOT": str(cx.ROOT), **(env or {})})
    try:
        out = json.loads((proc.stdout or "").strip().splitlines()[-1])
    except (ValueError, IndexError):
        raise ArchiveError(f"plugin-catalog failed: {(proc.stderr or proc.stdout)[-300:]}") from None
    if isinstance(out, dict) and out.get("ok") is False:
        raise ArchiveError(str(out.get("error", "plugin-catalog failed")))
    return out


class Hub:
    """The few calls the installer makes to axHub's MCP endpoint (`call` → axhub.memory_read). Token never leaves the hub."""

    def __init__(self, base: str, token: str) -> None:
        self.url, self.token, self.session, self.ready = f"{base.rstrip('/')}/mcp", token, None, False

    def _rpc(self, method: str, params: dict[str, Any], notify: bool = False, cap: int = INDEX_BYTES) -> Any:
        body: dict[str, Any] = {"jsonrpc": "2.0", "method": method, "params": params}
        if not notify:
            body["id"] = str(uuid.uuid4())
        h = {"authorization": f"Bearer {self.token}", "content-type": "application/json", "accept": "application/json, text/event-stream", "mcp-protocol-version": "2025-06-18"}
        if self.session:
            h["mcp-session-id"] = self.session
        try:
            r = axf_http.request("POST", self.url, headers=h, body=json.dumps(body).encode(), timeout=30, max_bytes=cap, secret_headers=["authorization"])
        except axf_http.HttpError as e:
            raise ArchiveError(f"couldn't reach axHub ({type(e).__name__})") from None
        if r.status in (401, 403):
            raise ArchiveError("axHub refused the credentials: check the axHub token")
        if not r.ok and r.status != 202:
            raise ArchiveError(f"axHub answered {r.status}")
        self.session = r.headers.get("mcp-session-id") or self.session
        if notify:
            return None
        raw = r.text()
        if "text/event-stream" in r.headers.get("content-type", ""):
            msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
            msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
        else:
            msg = json.loads(raw or "{}")
        if "error" in msg:
            raise ArchiveError(f"axHub: {str(msg['error'].get('message', 'error'))[:200]}")
        return msg.get("result") or {}

    def read(self, path: str, cap: int = INDEX_BYTES) -> str:
        if not self.ready:
            self._rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-plugins-menu", "version": "1"}})
            self._rpc("notifications/initialized", {}, notify=True)
            self.ready = True
        res = self._rpc("tools/call", {"name": "call", "arguments": {"tool": "axhub.memory_read", "arguments": {"project": "shared", "area": "data", "path": path}}}, cap=cap)
        text = "\n".join(c.get("text", "") for c in (res.get("content") or []) if c.get("type") == "text")
        if res.get("isError"):
            raise ArchiveError(f"axHub: {text[:200] or 'read failed'}")
        return text


HUB_FACTORY: Callable[[str, str], Any] = Hub  # replaced by the self-test


def _local_catalog_root() -> str | None:
    try:
        w = _cli(["where"])
        return w.get("root") if w.get("reachable") else None
    except ArchiveError:
        return None


def read_index(a: dict[str, Any], fresh: bool = False) -> dict[str, Any]:
    """The archive's plugin-catalog@1 index → {"items": [...], "via": str}."""
    if not ARCHIVE_KINDS.get(str(a.get("kind")), {}).get("built"):
        raise ArchiveError(f"{ARCHIVE_KINDS.get(str(a.get('kind')), {}).get('label', a.get('kind'))}: not built yet")
    hit = _cache.get(a["id"])
    if hit and not fresh and time.time() - hit[0] < CACHE_S:
        return hit[1]
    kind = a["kind"]
    if kind == "axhub":
        tok = credential_of(a)["token"]
        if not tok:
            raise ArchiveError("axHub needs credentials: add the axHub token to this archive (or AXHUB_TOKEN on the console)")
        hub = HUB_FACTORY(a["location"], tok)
        doc = json.loads(hub.read("plugin-catalog/catalog.json") or "{}")  # also proves the credential
        out = {"items": doc.get("items") or [], "via": "axHub"}
    elif kind == "folder":
        out = {**_cli(["list"], env={"AXF_PLUGIN_CATALOG": a["location"]}), "via": "folder"}
    elif kind == "https":
        doc = _get(a, f"{a['location']}/catalog.json", INDEX_BYTES)
        out = {"items": doc.get("items") or [], "via": "https"}
    elif kind == "console":
        doc = _get(a, f"{a['location']}/api/plugin-catalog?kind=console", INDEX_BYTES)
        out = {"items": doc.get("items") or [], "via": "console"}
    else:
        raise ArchiveError(f"unknown archive kind {kind}")
    if not isinstance(out.get("items"), list):
        raise ArchiveError("the archive's index has no items")
    out["items"] = [i for i in out["items"] if isinstance(i, dict) and FOLDER_RE.match(str(i.get("folder", ""))) and isinstance(i.get("version"), str)][:2000]
    _cache[a["id"]] = (time.time(), out)
    return out


def _package_from_folder(root: str, kind: str, folder: str, version: str) -> dict[str, Any]:
    """`plugin-catalog.mjs package` against a catalog folder (verified there against that folder's index)."""
    proc = subprocess.run(["node", str(cx.ROOT / "framework" / "cli" / "plugin-catalog.mjs"), "package", kind, folder, "--version", version],
                          cwd=cx.ROOT, capture_output=True, text=True, timeout=60, env={**os.environ, "AXF_ROOT": str(cx.ROOT), "AXF_PLUGIN_CATALOG": root})
    if proc.returncode:
        raise ArchiveError((proc.stderr or "couldn't read the package").strip()[-300:])
    try:
        return json.loads(proc.stdout or "{}")
    except ValueError:
        raise ArchiveError("the package isn't JSON") from None


def read_package(a: dict[str, Any], kind: str, folder: str, version: str) -> dict[str, Any]:
    if a["kind"] == "axhub":
        root = _local_catalog_root()
        if root:  # the console mounts the hub's projects tree: the same file, read locally (the index read proved the credential)
            return _package_from_folder(root, kind, folder, version)
        hub = HUB_FACTORY(a["location"], credential_of(a)["token"])
        try:
            return json.loads(hub.read(f"plugin-catalog/packages/{kind}/{folder}/{version}.json", cap=PACKAGE_BYTES) or "{}")
        except ValueError:
            raise ArchiveError("axHub's package isn't JSON") from None
    if a["kind"] == "folder":
        return _package_from_folder(a["location"], kind, folder, version)
    if a["kind"] == "https":
        return _get(a, f"{a['location']}/packages/{quote(kind)}/{quote(folder)}/{quote(version)}.json", PACKAGE_BYTES)
    if a["kind"] == "console":
        return _get(a, f"{a['location']}/api/plugin-catalog/package?kind={quote(kind)}&folder={quote(folder)}&version={quote(version)}", PACKAGE_BYTES)
    raise ArchiveError("not built yet")


# ------------------------------------------------------------------ what is installed here

def installed() -> dict[str, dict[str, Any]]:
    out: dict[str, dict[str, Any]] = {}
    base = cx.ROOT / "apps" / "console-web" / "plugins"
    try:
        names = sorted(os.listdir(base))
    except OSError:
        return out
    for name in names:
        d = base / name
        if name.startswith((".", "_")) or d.is_symlink() or not (d / "plugin.json").is_file():
            continue
        try:
            out[name] = json.loads((d / "plugin.json").read_text("utf-8"))
        except (OSError, ValueError):
            continue
    return out


def mark(item: dict[str, Any], have: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """installed version/model, and whether installing it would clash (another build of the same plugin is installed)."""
    folder = str(item.get("folder", ""))
    m = {"id": item.get("id"), "name": item.get("name"), "builtWith": item.get("builtWith") or {}}
    local = have.get(folder)
    same = bool(local and local.get("id") == item.get("id"))
    clash = build_defaults.instance_clash(folder, m, {f: v for f, v in have.items() if f != folder})
    if local and not same:
        clash = clash or f"{folder} already holds another plugin ({local.get('id')})"
    lm = (local or {}).get("builtWith", {}).get("model") if same else None
    im = (item.get("builtWith") or {}).get("model") or (item.get("models") or {}).get(item.get("version"))
    return {**item, "installed": local.get("version") if same else None, "installedModel": lm, "model": im,
            "otherModel": bool(same and lm and im and lm != im), "clash": clash,
            "enabled": cx.plugin_enabled(folder) if same else None}


# ------------------------------------------------------------------ routes

def _err(status: int, msg: str) -> HTTPException:
    return HTTPException(status, msg)


def _find(db: dict[str, Any], aid: str) -> dict[str, Any]:
    a = next((x for x in db["archives"] if x["id"] == aid), None)
    if not a:
        raise _err(404, "no such archive")
    return a


@router.get("/archives")
def get_archives() -> dict[str, Any]:
    return listing()


@router.post("/archives")
def save_archive(body: dict[str, Any]) -> dict[str, Any]:
    aid = str(body.get("id") or "").strip()
    kind = str(body.get("kind") or "")
    with _lock:
        db = _load()
        cur = next((x for x in db["archives"] if x["id"] == aid), None) if aid else None
        if cur is None:
            if kind not in ARCHIVE_KINDS or kind == "axhub":
                raise _err(400, "pick an archive kind (axHub is already there and permanent)")
            if not ARCHIVE_KINDS[kind]["built"]:
                raise _err(400, f"{ARCHIVE_KINDS[kind]['label']} isn't built yet")
            if len(db["archives"]) >= MAX_ARCHIVES:
                raise _err(400, f"at most {MAX_ARCHIVES} archives")
            aid = aid or f"{kind}-{secrets.token_hex(3)}"
            if not ID_RE.match(aid):
                raise _err(400, "archive ids are short lowercase words")
            cur = {"id": aid, "kind": kind, "createdAt": int(time.time() * 1000), "auth": {"type": "none"}}
            db["archives"].append(cur)
        kind = cur["kind"]
        if "label" in body:
            cur["label"] = str(body.get("label") or "").strip()[:60] or aid
        if "location" in body:
            try:
                cur["location"] = _check_location(kind, str(body.get("location") or ""))
            except ArchiveError as e:
                raise _err(400, str(e)) from None
        if not cur.get("location"):
            raise _err(400, "a location is needed")
        if "enabled" in body and not cur.get("permanent"):
            cur["enabled"] = body.get("enabled") is not False
        auth_in = body.get("auth") if isinstance(body.get("auth"), dict) else None
        if auth_in is not None or body.get("clearCredential"):
            prev = cur.get("auth") if isinstance(cur.get("auth"), dict) else {}
            t = str((auth_in or {}).get("type") or prev.get("type") or "none")
            if t not in ARCHIVE_KINDS[kind]["auth"]:
                raise _err(400, f"{ARCHIVE_KINDS[kind]['label']} takes: {', '.join(AUTH_TYPES[x] for x in ARCHIVE_KINDS[kind]['auth'])}")
            nxt: dict[str, Any] = {"type": t}
            keep = not body.get("clearCredential") and t == prev.get("type")
            for k in ("token", "user", "password", "header", "value"):
                v = (auth_in or {}).get(k)
                if isinstance(v, str) and v.strip():
                    nxt[k] = v.strip()[:2000]
                elif keep and prev.get(k):
                    nxt[k] = prev[k]
            if t == "header" and nxt.get("header") and not HEADER_RE.match(nxt["header"]):
                raise _err(400, "a header name is letters, digits and -")
            cur["auth"] = nxt
        cur.pop("lastTest", None)
        _cache.pop(aid, None)
        _save(db)
    cx.log("plugins", f"Plugins installer: archive {cur.get('label')} saved", "info")
    return {"archive": public(cur), **listing(db)}


@router.delete("/archives/{aid}")
def delete_archive(aid: str) -> dict[str, Any]:
    with _lock:
        db = _load()
        a = _find(db, aid)
        if a.get("permanent"):
            raise _err(400, "axHub is the permanent archive: it can't be removed (clear or change its credential instead)")
        db["archives"] = [x for x in db["archives"] if x["id"] != aid]
        _cache.pop(aid, None)
        _save(db)
    cx.log("plugins", f"Plugins installer: archive {a.get('label')} removed", "info")
    return listing(db)


@router.post("/archives/{aid}/test")
def test_archive(aid: str) -> dict[str, Any]:
    with _lock:
        a = _find(_load(), aid)
    started = time.monotonic()
    res: dict[str, Any] = {"at": int(time.time() * 1000)}
    try:
        idx = read_index(a, fresh=True)
        res.update(ok=True, count=len(idx["items"]), detail=f"{len(idx['items'])} plugins via {idx['via']}")
    except ArchiveError as e:
        res.update(ok=False, count=0, error=str(e)[:300])
    res["ms"] = int((time.monotonic() - started) * 1000)
    with _lock:
        db = _load()
        for x in db["archives"]:
            if x["id"] == aid:
                x["lastTest"] = res
        _save(db)
    return {"test": res, **listing(db)}


@router.get("/browse")
def browse(archive: str = "all", q: str = "", kind: str = "console", fresh: bool = False) -> dict[str, Any]:
    if kind not in ("console", "pilot", "all"):
        raise _err(400, "kind is console, pilot or all")
    db = _load()
    picked = [a for a in db["archives"] if a.get("enabled", True) is not False and (archive == "all" or a["id"] == archive)]
    if archive != "all" and not picked:
        raise _err(404, "no such archive (or it's switched off)")
    have = installed()
    needle = q.strip().lower()[:80]
    items: list[dict[str, Any]] = []
    archives: list[dict[str, Any]] = []
    for a in picked:
        try:
            idx = read_index(a, fresh=fresh)
            archives.append({"id": a["id"], "label": a.get("label"), "ok": True, "count": len(idx["items"])})
        except ArchiveError as e:
            archives.append({"id": a["id"], "label": a.get("label"), "ok": False, "error": str(e)[:300]})
            continue
        for it in idx["items"]:
            if kind != "all" and it.get("kind") != kind:
                continue
            text = " ".join(str(it.get(k, "")) for k in ("name", "folder", "id", "description")).lower()
            if needle and needle not in text:
                continue
            row = mark(it, have) if it.get("kind") == "console" else {**it, "installed": None, "clash": None, "readOnly": True}
            items.append({**row, "archive": a["id"], "archiveLabel": a.get("label")})
    return {"items": items, "archives": archives, "config": _config()}


@router.get("/item")
def item(archive: str, folder: str, kind: str = "console") -> dict[str, Any]:
    if not FOLDER_RE.match(folder):
        raise _err(400, "bad folder")
    a = _find(_load(), archive)
    try:
        idx = read_index(a)
    except ArchiveError as e:
        raise _err(502, str(e)) from None
    it = next((i for i in idx["items"] if i.get("folder") == folder and i.get("kind") == kind), None)
    if not it:
        raise _err(404, f"{folder} isn't in {a.get('label')}")
    return {"item": mark(it, installed()) if kind == "console" else it, "archive": public(a)}


@router.post("/install")
def install(body: dict[str, Any]) -> dict[str, Any]:
    folder, aid = str(body.get("folder") or ""), str(body.get("archive") or "")
    version = str(body.get("version") or "")
    replace = bool(body.get("replace"))
    if not FOLDER_RE.match(folder):
        raise _err(400, "bad folder")
    if version and not VERSION_RE.match(version):
        raise _err(400, "bad version")
    want = f"replace {folder}" if replace else folder
    if body.get("confirm") != want:
        raise _err(400, f'installing runs the plugin\'s code on this server: confirm with "{want}"')
    a = _find(_load(), aid)
    if a.get("enabled", True) is False:
        raise _err(400, "that archive is switched off")
    if not _install_lock.acquire(blocking=False):
        raise _err(409, "another install is running")
    try:
        try:
            idx = read_index(a, fresh=True)
            it = next((i for i in idx["items"] if i.get("folder") == folder and i.get("kind") == "console"), None)
            if not it:
                raise ArchiveError(f"{folder} isn't in {a.get('label')}")
            ver = version or str(it.get("version"))
            if ver not in (it.get("versions") or [it.get("version")]):
                raise ArchiveError(f"{folder} has no version {ver} in {a.get('label')}")
            pkg = read_package(a, "console", folder, ver)
        except ArchiveError as e:
            raise _err(502, str(e)) from None
        cfg = _config()
        local = installed().get(folder)
        args = ["install-package", "-", "--no-state"]
        if replace:
            args.append("--replace")
            if body.get("keepData", cfg["keepDataOnReplace"]):
                args.append("--keep-data")
        elif local:
            args.append("--update")
        if ver == it.get("version") and isinstance(it.get("sha256"), str):
            args += ["--sha256", it["sha256"]]  # the index's hash: a package that doesn't match it is refused
        publish = body.get("publish", cfg["publish"]) is not False and bool(os.environ.get("GITHUB_TOKEN"))
        if publish:
            args.append("--publish")
        try:
            out = _cli(args, stdin=json.dumps(pkg), timeout=600)
        except ArchiveError as e:
            raise _err(400, str(e)) from None
        cx.set_plugin_enabled(folder, True)
        cx.log("plugins", f"{folder} {'replaced' if replace else 'updated' if local else 'installed'} from {a.get('label')} ({out.get('version') or ver})", "ok")
        out["restartNeeded"] = True
        out["archive"] = a["id"]
        out["note"] = ("Committed to GitHub: the console rebuilds with it within about 5 minutes." if (out.get("published") or {}).get("pushed")
                       else "Already on GitHub: the console loads it at its next rebuild." if publish
                       else "Unpacked in this clone only: it loads after the next rebuild of this console.")
        return out
    finally:
        _install_lock.release()


@router.get("/config")
def get_config() -> dict[str, Any]:
    return {"config": _config(), "spec": {k: {"type": t.__name__, "default": d} for k, (t, d) in CONFIG_SPEC.items()}}


@router.put("/config")
def put_config(body: dict[str, Any]) -> dict[str, Any]:
    cfg = clean_config({**_config(), **(body if isinstance(body, dict) else {})})
    with _lock:
        storage.write_json(data_dir() / "config.json", cfg, indent=None)
    return {"config": cfg}
