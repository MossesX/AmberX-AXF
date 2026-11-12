"""AmberX settings (server part). Mounted at /api/plugins/amberx-settings/.

The AmberX app's settings on the console (build move-amberx-web-app-into-the-console-amberx-andr, s10; contract C32,
C32a). They stay in AmberX's own hub-settings@1 document, `<projects>/_shared/_data/settings/apps/amberx-droid.json`,
which lib-hubsync mirrors onto every phone, so a change here reaches every device on its next settings refresh. The
keys the console knows are in registry.json (short name → document key, kind, default, range); writes are per key,
so a phone's own keys are never touched.

  GET  settings                    every known setting: value, default, kind, options or range, overridden
  GET  settings/{key}              one setting
  PUT  settings/{key} {value}      set it (checked against the registry)
  POST settings/{key}/reset        back to the default (the key leaves the document)
  GET  document                    the whole hub-settings@1 document, with an ETag (C32a, the phone's mirror)
  PUT  document {values} + If-Match   per-key merge of the phone's values (412 when the ETag moved)

Sensitive settings (the watch's auto-approve) change only from a signed-in admin's own browser, never with the console
token: a Claude session must not be able to make its own calls approve themselves. They read like the others.
"""
from __future__ import annotations

import hashlib
import json
import os
import re
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse

import wall

router = APIRouter()
HERE = Path(__file__).resolve().parents[1]
FOLDER = HERE.name
ROOT = Path(__file__).resolve().parents[5]
APP = "amberx-droid"
FORMAT = "hub-settings@1"
MAX_BODY = 64 * 1024
TEXT_MAX = 2000


def registry() -> list[dict[str, Any]]:
    return json.loads((HERE / "registry.json").read_text())["settings"]


def by_key() -> dict[str, dict[str, Any]]:
    return {s["key"]: s for s in registry()}


def projects() -> Path:
    return Path(os.environ.get("AXF_AMBERX_SETTINGS_PROJECTS") or os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")


def doc_file() -> Path:
    p = projects()
    if p.exists():
        return p / "_shared" / "_data" / "settings" / "apps" / f"{APP}.json"
    return ROOT / ".axf-console" / "plugins" / FOLDER / f"{APP}.json"


def read_doc() -> dict[str, Any]:
    try:
        raw = json.loads(doc_file().read_text())
    except (OSError, ValueError):
        raw = None
    if isinstance(raw, dict) and raw.get("$axf") == FORMAT and isinstance(raw.get("values"), dict):
        return {"$axf": FORMAT, "values": dict(raw["values"]), "updatedAt": str(raw.get("updatedAt") or ""), "updatedBy": str(raw.get("updatedBy") or "")}
    return {"$axf": FORMAT, "values": {}, "updatedAt": "", "updatedBy": ""}


def etag(doc: dict[str, Any]) -> str:
    return '"' + hashlib.sha256(json.dumps(doc, sort_keys=True).encode()).hexdigest()[:24] + '"'


def write_doc(doc: dict[str, Any], by: str) -> dict[str, Any]:
    doc = {**doc, "updatedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "updatedBy": by[:80]}
    f = doc_file()
    f.parent.mkdir(parents=True, exist_ok=True)
    tmp = f.with_name(f".{f.name}.{os.getpid()}")
    tmp.write_text(json.dumps(doc, indent=1))
    os.replace(tmp, f)
    return doc


def check(s: dict[str, Any], v: Any) -> Any:
    """The value to store for setting `s`, or HTTPException 400."""
    k = s["kind"]
    if k == "toggle":
        if not isinstance(v, bool):
            raise HTTPException(400, f"{s['key']} is true or false")
        return v
    if k == "number":
        if isinstance(v, bool) or not isinstance(v, (int, float)) or not s.get("min", float("-inf")) <= v <= s.get("max", float("inf")):
            raise HTTPException(400, f"{s['key']} is a number from {s.get('min')} to {s.get('max')}")
        return v
    if k == "choice":
        if v not in s["options"]:
            raise HTTPException(400, f"{s['key']} is one of {', '.join(s['options'])}")
        return v
    if not isinstance(v, str) or len(v) > TEXT_MAX or (s.get("pattern") and not re.match(s["pattern"], v)):
        raise HTTPException(400, f"{s['key']} is a text" + (f" like {s['default']}" if s.get("pattern") else f" of at most {TEXT_MAX} characters"))
    return v


def view(s: dict[str, Any], values: dict[str, Any]) -> dict[str, Any]:
    has = s["doc"] in values and values[s["doc"]] is not None
    out = {k: s[k] for k in ("key", "label", "kind", "default", "group") if k in s}
    out.update({"value": values[s["doc"]] if has else s["default"], "overridden": has, "document": s["doc"]})
    for k in ("options", "min", "max", "step", "sensitive"):
        if k in s:
            out[k] = s[k]
    return out


def who(request: Request) -> tuple[str, bool]:
    """(name for updatedBy, is this a signed-in admin's own browser)."""
    c = wall.wall_caller(request.headers)
    if c is not None and c.via == "session" and c.admin:
        return f"web:{c.name}", True
    u = getattr(request.state, "axf_user", None)
    name = getattr(u, "name", None) or (u.get("name") if isinstance(u, dict) else None)
    return (f"console:{str(name)[:40]}" if name and name != "console-token" else "console"), False


def need(key: str) -> dict[str, Any]:
    s = by_key().get(key)
    if s is None:
        raise HTTPException(404, f"no AmberX setting {key} (GET settings lists them)")
    return s


async def body_of(request: Request) -> dict[str, Any]:
    raw = await request.body()
    if len(raw) > MAX_BODY:
        raise HTTPException(413, f"at most {MAX_BODY} bytes")
    try:
        b = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "send JSON") from e
    if not isinstance(b, dict):
        raise HTTPException(400, "send a JSON object")
    return b


@router.get("/settings")
def list_settings() -> dict[str, Any]:
    doc = read_doc()
    return {"ok": True, "settings": [view(s, doc["values"]) for s in registry()], "updatedAt": doc["updatedAt"], "updatedBy": doc["updatedBy"], "live": projects().exists()}


@router.get("/settings/{key}")
def get_setting(key: str) -> dict[str, Any]:
    return {"ok": True, "setting": view(need(key), read_doc()["values"])}


@router.put("/settings/{key}")
async def set_setting(key: str, request: Request) -> dict[str, Any]:
    s = need(key)
    b = await body_of(request)
    if "value" not in b:
        raise HTTPException(400, "send { value }")
    name, person = who(request)
    if s.get("sensitive") and not person:
        raise HTTPException(403, f"{key} changes only from your own signed-in browser (Settings → Plugins → AmberX): a session must not change what approves itself")
    v = check(s, b["value"])
    doc = read_doc()
    doc["values"][s["doc"]] = v
    doc = write_doc(doc, name)
    return {"ok": True, "changed": True, "setting": view(s, doc["values"])}


@router.post("/settings/{key}/reset")
def reset_setting(key: str, request: Request) -> dict[str, Any]:
    s = need(key)
    name, person = who(request)
    if s.get("sensitive") and not person:
        raise HTTPException(403, f"{key} changes only from your own signed-in browser")
    doc = read_doc()
    if s["doc"] in doc["values"]:
        doc["values"].pop(s["doc"])
        doc = write_doc(doc, name)
    return {"ok": True, "setting": view(s, doc["values"])}


@router.get("/document")
def get_document() -> JSONResponse:
    doc = read_doc()
    return JSONResponse(doc, headers={"etag": etag(doc), "cache-control": "no-store"})


@router.put("/document")
async def put_document(request: Request) -> JSONResponse:
    doc = read_doc()
    want = request.headers.get("if-match", "")
    if want and want != etag(doc):
        return JSONResponse({"ok": False, "code": "conflict", "message": "the document changed: read it again", "etag": etag(doc)}, status_code=412)
    b = await body_of(request)
    values = b.get("values")
    if not isinstance(values, dict):
        raise HTTPException(400, "send { values: { key: value } } (null removes a key)")
    name, person = who(request)
    known = {s["doc"]: s for s in registry()}
    for k, v in values.items():
        if not isinstance(k, str) or not k.startswith("amberx.") or len(k) > 120:
            raise HTTPException(400, f"{k}: AmberX keys start with amberx.")
        s = known.get(k)
        if s is not None and s.get("sensitive") and not person:
            raise HTTPException(403, f"{s['key']} changes only from your own signed-in browser")
        if v is None:
            doc["values"].pop(k, None)
        else:
            doc["values"][k] = check(s, v) if s is not None else v
    doc = write_doc(doc, name)
    return JSONResponse({"ok": True, "etag": etag(doc), "updatedAt": doc["updatedAt"]}, headers={"etag": etag(doc)})
