"""Hidden assets over REST (hidden-assets@1, framework/core/engines/hidden-assets.ts): /api/hidden-assets…

Brett, Nov 17 2026: "We're supposed to be able to hide toolbars and tab groups and all that and be able to see what's
hidden." The UI hides a piece through the runtime (rt.hide / rt.unhide / rt.unhideAll); these routes make the same
change for a caller with no page open (MCP, the CLI, voice, a script), in the same place: the list `own.hiddenAssets`
of the app's own look document (app-look@1, `shared/settings/looks/<app>.json` on the hub). No second store.

    GET  /api/hidden-assets?app=             what is hidden in the app, oldest first, with the kinds that can be hidden
    POST /api/hidden-assets/hide             { app?, kind, id, assetRef?, by? }   or { app?, key: "<kind>:<id>", … }
    POST /api/hidden-assets/unhide           { app?, kind, id }                   or { app?, key: "<kind>:<id>" }
    POST /api/hidden-assets/unhide-all       { app? }

`app` defaults to the console's own app id. Every answer carries `{ ok, contract, app, hidden, count }`; a write adds
`changed` (false when there was nothing to do: hiding what is hidden, unhiding what is not) and, for hide, `entry`.
Refusals are `{ ok: false, code, error }`:

    400 bad-app       not an app id
    400 bad-target    a kind that can't be hidden, or an id that is not an instance id (the engine's own words)
    409 no-document   hide for an app that has no look document yet (it is made by the app on its first run)
    409 bad-document  the stored file is not an app-look@1 document
    413 too-large     the document would pass the app-look size limit, so the app could no longer read it
    423 read-only     the data store is rolling back (data-store-mode@1)
    503 unavailable   the data store can't be reached

The rules here are the Python twin of the reference engine: same kinds (read from the chrome kind list in
core/engines/chrome-settings-rules.mjs, plus widget), same id / assetRef / by / time shapes, same list rules (one entry
per kind + id, the first hide stands, oldest first, at most 500), same refusal words. The shared fixture
framework/spec/fixtures/hidden-assets.json pins both (server/tests/test_hidden_assets.py).

Only `own.hiddenAssets` is touched, plus the `updatedBy` / `updatedAt` stamp the skins CLI leaves: every other field
of the document is written back as it was read. The file is read and written through data_store.py, so it follows the
settings namespace's data-store mode.
"""
from __future__ import annotations

import json
import os
import re
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, Request
from fastapi.responses import JSONResponse

import data_store as ds

CONTRACT = "hidden-assets@1"
APP_LOOK_FRAME = "app-look@1"
APP_LOOK_MAX_BYTES = 64 * 1024  # engines/skin-rules.mjs: a longer document is not read by the app
FIELD = "hiddenAssets"
MAX = 500
WIDGET_KIND = "widget"
ROOT = ds.ROOT

_A = re.ASCII
APP_ID = re.compile(r"[a-z0-9][a-z0-9-]{0,79}", _A)
INSTANCE_ID = re.compile(r"[a-z0-9][a-z0-9._:/-]{0,119}", _A)
ASSET_REF = re.compile(r"[a-z0-9][a-z0-9._-]{0,119}", _A)
BY = re.compile(r"[A-Za-z0-9][A-Za-z0-9 ._:@/-]{0,119}", _A)
ISO = re.compile(r"\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})", _A)

# What the chrome kind list held when this was written; used only when the engine file can't be read (a stripped image).
_FALLBACK_KINDS = ("tab-group", "toolbar", "banner", "nav-menu", "app-menu")
_LOCK = threading.Lock()
_kinds: tuple[str, ...] | None = None


class HiddenAssetsError(Exception):
    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status, self.code = status, code


# ── the rules (twin of engines/hidden-assets.ts) ──────────────────────────────────────────────────────────────────────

def _chrome_kinds() -> tuple[str, ...]:
    """The chrome-settings@1 kinds that have a target on the page, in the kind list's order."""
    try:
        src = (ROOT / "framework/core/engines/chrome-settings-rules.mjs").read_text("utf-8")
        types = re.search(r"export const CHROME_TYPES = \[([^\]]*)\]", src)
        targets = re.search(r"export const CHROME_TARGETS = \{(.*?)\};", src, re.S)
        if not types or not targets:
            return _FALLBACK_KINDS
        with_target = {m.group(1) or m.group(2) for m in re.finditer(r"(?:'([^']+)'|([A-Za-z][\w-]*)):\s*\[\s*[^\]\s]", targets.group(1))}
        kinds = tuple(k for k in re.findall(r"'([^']+)'", types.group(1)) if k in with_target)
        return kinds or _FALLBACK_KINDS
    except OSError:
        return _FALLBACK_KINDS


def kinds() -> list[str]:
    """The kinds that may be hidden: every chrome kind drawn on the page, plus widget."""
    global _kinds
    if _kinds is None:
        _kinds = (*_chrome_kinds(), WIDGET_KIND)
    return list(_kinds)


def is_kind(k: Any) -> bool:
    return isinstance(k, str) and k in kinds()


def is_id(i: Any) -> bool:
    return isinstance(i, str) and INSTANCE_ID.fullmatch(i) is not None


def key_of(kind: str, id_: str) -> str:
    return f"{kind}:{id_}"


def _split(ref: Any) -> tuple[str, str]:
    if isinstance(ref, str):
        kind, sep, id_ = ref.partition(":")
        return kind, (id_ if sep else "")
    if isinstance(ref, dict):
        return (ref["kind"] if isinstance(ref.get("kind"), str) else ""), (ref["id"] if isinstance(ref.get("id"), str) else "")
    return "", ""


def target(ref: Any) -> dict[str, str] | None:
    """`{kind, id}` or `<kind>:<id>` as a target; None when it is not one (unknown kind, bad id)."""
    kind, id_ = _split(ref)
    return {"kind": kind, "id": id_} if is_kind(kind) and is_id(id_) else None


def target_error(ref: Any) -> str | None:
    """Why a reference is refused, in the engine's words; None when it is fine."""
    kind, id_ = _split(ref)
    if not is_kind(kind):
        return f'"{kind}" is not a kind that can be hidden ({", ".join(kinds())})'
    if not is_id(id_):
        return f'"{id_}" is not an instance id'
    return None


def normalize_entry(raw: Any) -> dict[str, str] | None:
    if not isinstance(raw, dict) or not is_kind(raw.get("kind")) or not is_id(raw.get("id")):
        return None
    at, by, ref = raw.get("hiddenAt"), raw.get("by"), raw.get("assetRef")
    out = {"kind": raw["kind"], "id": raw["id"],
           "hiddenAt": at if isinstance(at, str) and ISO.fullmatch(at) else "",
           "by": by if isinstance(by, str) and BY.fullmatch(by) else ""}
    if isinstance(ref, str) and ASSET_REF.fullmatch(ref):
        out["assetRef"] = ref
    return out


def normalize_list(raw: Any) -> list[dict[str, str]]:
    """Valid entries only, one per kind + id (the first stands), at most MAX (the oldest fall off)."""
    out: list[dict[str, str]] = []
    seen: set[str] = set()
    for e in raw if isinstance(raw, list) else []:
        n = normalize_entry(e)
        if not n or key_of(n["kind"], n["id"]) in seen:
            continue
        seen.add(key_of(n["kind"], n["id"]))
        out.append(n)
    return out[-MAX:]


def list_hidden(look: Any) -> list[dict[str, str]]:
    own = look.get("own") if isinstance(look, dict) else None
    return normalize_list(own.get(FIELD) if isinstance(own, dict) else None)


def is_hidden(look: Any, ref: Any) -> bool:
    t = target(ref)
    return bool(t) and any(e["kind"] == t["kind"] and e["id"] == t["id"] for e in list_hidden(look))


def _with_list(look: dict, items: list[dict[str, str]]) -> dict:
    own = dict(look["own"]) if isinstance(look.get("own"), dict) else {}
    if items:
        own[FIELD] = items
    else:
        own.pop(FIELD, None)  # an empty list is never written: nothing hidden reads as the document was
    return {**look, "own": own}


def hide(look: dict, ref: Any, *, at: str | None = None, by: str = "", asset_ref: str = "") -> dict:
    """A new document with the entry appended; the same object back when refused or already hidden."""
    t = target(ref)
    if not t or is_hidden(look, t):
        return look
    entry = {"kind": t["kind"], "id": t["id"], "hiddenAt": at if at is not None else now_iso(), "by": by}
    if asset_ref:
        entry["assetRef"] = asset_ref
    return _with_list(look, normalize_list([*list_hidden(look), entry]))


def unhide(look: dict, ref: Any) -> dict:
    t = target(ref)
    if not t or not is_hidden(look, t):
        return look
    return _with_list(look, [e for e in list_hidden(look) if not (e["kind"] == t["kind"] and e["id"] == t["id"])])


def unhide_all(look: dict) -> dict:
    return _with_list(look, []) if list_hidden(look) else look


def now_iso() -> str:
    n = datetime.now(timezone.utc)
    return n.strftime("%Y-%m-%dT%H:%M:%S.") + f"{n.microsecond // 1000:03d}Z"


# ── the document ──────────────────────────────────────────────────────────────────────────────────────────────────────

def looks_dir() -> Path:
    """Where the look documents are: the same folder the skins CLI writes (AXF_LOOKS_DIR, else beside appearance.json)."""
    if os.environ.get("AXF_LOOKS_DIR"):
        return Path(os.environ["AXF_LOOKS_DIR"])
    if os.environ.get("AXF_APPEARANCE_FILE"):
        return Path(os.environ["AXF_APPEARANCE_FILE"]).parent / "looks"
    return Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "_shared" / "_data" / "settings" / "looks"


def look_file(app: str) -> Path:
    return looks_dir() / f"{app}.json"


def default_app() -> str:
    """The console's own app id (its manifest)."""
    try:
        m = json.loads((Path(__file__).resolve().parents[1] / "axf.manifest.json").read_text("utf-8"))
        return str(m["app"]["id"])
    except (OSError, ValueError, KeyError, TypeError):
        return "axf-console"


def app_id(raw: Any) -> str:
    app = raw.strip() if isinstance(raw, str) else ""
    if not app:
        return default_app()
    if not APP_ID.fullmatch(app):
        raise HiddenAssetsError(400, "bad-app", f'"{app[:80]}" is not an app id')
    return app


def read_look(app: str) -> dict | None:
    """The app's stored look document as it is (not normalized); None when the app has none yet."""
    try:
        raw = ds.read_bytes(look_file(app))
    except ds.DataStoreError as e:
        raise _store_error(e) from e
    if raw is None:
        return None
    try:
        doc = json.loads(raw)
    except ValueError:
        doc = None
    if not isinstance(doc, dict) or doc.get("$axf") != APP_LOOK_FRAME:
        raise HiddenAssetsError(409, "bad-document", f"the look document of {app} is not an {APP_LOOK_FRAME} document")
    return doc


def write_look(app: str, doc: dict, by: str) -> None:
    """Save the way the skins CLI does: one compact line, stamped, readable by the hub's data server."""
    stamped = {**doc, "updatedBy": by or "console-rest", "updatedAt": now_iso()}
    text = json.dumps(stamped, separators=(",", ":"), ensure_ascii=False) + "\n"
    if len(text) > APP_LOOK_MAX_BYTES:  # the same count the app's reader checks before it parses
        raise HiddenAssetsError(413, "too-large", f"the look document of {app} would pass {APP_LOOK_MAX_BYTES} bytes")
    f = look_file(app)
    try:
        mode = f.stat().st_mode & 0o777
    except OSError:
        mode = 0o644
    try:
        ds.write_text(f, text, mode=mode, dir_mode=None)
    except ds.DataStoreError as e:
        raise _store_error(e) from e
    try:  # the hub's data server owns the folder: a file written as root stays writable by it
        st = f.parent.stat()
        os.chown(f, st.st_uid, st.st_gid)
    except OSError:
        pass  # not root, or the file lives in axf-data only


def _store_error(e: ds.DataStoreError) -> HiddenAssetsError:
    if e.code == "read_only":
        return HiddenAssetsError(423, "read-only", str(e))
    return HiddenAssetsError(503, "unavailable", f"the data store can't be reached ({e.code})")


# ── the four calls (REST below; MCP, the CLI and voice call the same functions or routes) ─────────────────────────────

def _answer(app: str, look: dict | None, **extra: Any) -> dict[str, Any]:
    items = list_hidden(look)
    return {"ok": True, "contract": CONTRACT, "app": app, "document": look is not None, "hidden": items, "count": len(items), **extra}


def list_for(app: str) -> dict[str, Any]:
    return _answer(app, read_look(app), kinds=kinds())


def _target_or_raise(ref: Any) -> dict[str, str]:
    err = target_error(ref)
    if err:
        raise HiddenAssetsError(400, "bad-target", err)
    return target(ref)  # type: ignore[return-value]


def hide_for(app: str, ref: Any, *, by: str = "", asset_ref: str = "") -> dict[str, Any]:
    t = _target_or_raise(ref)
    if asset_ref and not ASSET_REF.fullmatch(asset_ref):
        raise HiddenAssetsError(400, "bad-target", f'"{asset_ref[:120]}" is not an asset id')
    by = by if BY.fullmatch(by or "") else ""
    with _LOCK:
        look = read_look(app)
        if look is None:
            raise HiddenAssetsError(409, "no-document", f"{app} has no look document yet: it is made when the app first runs")
        nxt = hide(look, t, by=by, asset_ref=asset_ref)
        if nxt is not look:
            write_look(app, nxt, by)
    entry = next((e for e in list_hidden(nxt) if e["kind"] == t["kind"] and e["id"] == t["id"]), None)
    return _answer(app, nxt, changed=nxt is not look, entry=entry)


def unhide_for(app: str, ref: Any, *, by: str = "") -> dict[str, Any]:
    t = _target_or_raise(ref)
    with _LOCK:
        look = read_look(app)
        nxt = unhide(look, t) if look is not None else None
        if look is not None and nxt is not look:
            write_look(app, nxt, by)  # type: ignore[arg-type]
    return _answer(app, nxt, changed=nxt is not look, target=t)


def unhide_all_for(app: str, *, by: str = "") -> dict[str, Any]:
    with _LOCK:
        look = read_look(app)
        shown = list_hidden(look)
        nxt = unhide_all(look) if look is not None else None
        if look is not None and nxt is not look:
            write_look(app, nxt, by)  # type: ignore[arg-type]
    return _answer(app, nxt, changed=nxt is not look, shown=shown)


# ── REST ──────────────────────────────────────────────────────────────────────────────────────────────────────────────

async def _body(request: Request) -> dict[str, Any]:
    try:
        b = await request.json()
    except Exception:  # noqa: BLE001 - an empty or broken body reads as no fields
        return {}
    return b if isinstance(b, dict) else {}


def _by(request: Request, body: dict[str, Any]) -> str:
    v = body.get("by") if isinstance(body.get("by"), str) and body.get("by") else request.headers.get("x-axf-by")
    v = (v or "console-rest").strip()
    return v if BY.fullmatch(v) else "console-rest"


def _ref(body: dict[str, Any]) -> Any:
    key = body.get("key")
    return key if isinstance(key, str) and key else {"kind": body.get("kind"), "id": body.get("id")}


def _run(fn: Callable[[], dict[str, Any]]) -> Any:
    try:
        return fn()
    except HiddenAssetsError as e:
        return JSONResponse({"ok": False, "contract": CONTRACT, "code": e.code, "error": str(e)}, status_code=e.status)


def router_for(auth: Callable[..., Any]) -> APIRouter:
    router = APIRouter(prefix="/api/hidden-assets", dependencies=[Depends(auth)])

    @router.get("")
    def hidden_list(app: str = "") -> Any:
        return _run(lambda: list_for(app_id(app)))

    @router.post("/hide")
    async def hidden_hide(request: Request) -> Any:
        b = await _body(request)
        ref = b.get("assetRef")
        return _run(lambda: hide_for(app_id(b.get("app")), _ref(b), by=_by(request, b), asset_ref=ref.strip() if isinstance(ref, str) else ""))

    @router.post("/unhide")
    async def hidden_unhide(request: Request) -> Any:
        b = await _body(request)
        return _run(lambda: unhide_for(app_id(b.get("app")), _ref(b), by=_by(request, b)))

    @router.post("/unhide-all")
    async def hidden_unhide_all(request: Request) -> Any:
        b = await _body(request)
        return _run(lambda: unhide_all_for(app_id(b.get("app")), by=_by(request, b)))

    return router
