"""AI keys — server part. Mounted at /api/plugins/ai-keys/ (console token on every method, 404 when disabled, never
on the console MCP).

A keyring for Anthropic keys: API keys (sk-ant-api…, kind `anthropic`) and Claude subscription tokens (sk-ant-oat…
from `claude setup-token`, kind `claude-code`). Every key is tested before it is saved and can be re-tested; the
active key of each kind is what the AI assistant uses for profiles of that kind (it reads it through the capability
service axf.ai-keys@1, never by folder). Keys live only in <dataDir>/keys.json (0600); the browser only ever sees the
label, the kind, the last 4 characters and the last test.

Routes: GET /keys · POST /keys {label, key} · PATCH /keys/{id} {label} · DELETE /keys/{id} · POST /keys/{id}/test ·
POST /active {kind, id}  (id "" = no active key of that kind: the assistant profile's own key applies again)
"""
from __future__ import annotations

import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import storage

router = APIRouter()
_lock = threading.Lock()
FOLDER = "ai-keys"
KINDS = {"anthropic": "Anthropic API key", "claude-code": "Claude subscription"}
MAX_KEYS = 50
KEY_RE = re.compile(r"^sk-ant-[A-Za-z0-9_-]{20,400}$")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AI_KEYS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _load() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "keys.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
    active = raw.get("active") if isinstance(raw.get("active"), dict) else {}
    return {"keys": keys, "active": {k: str(active.get(k) or "") for k in KINDS}}


def _save(db: dict[str, Any]) -> None:
    storage.write_json(data_dir() / "keys.json", db, indent=None)  # atomic, 0600, folder 0700


def kind_of(key: str) -> str:
    if key.startswith("sk-ant-oat"):
        return "claude-code"
    if key.startswith("sk-ant-api") or key.startswith("sk-ant-admin"):
        return "anthropic"
    return ""


def _default_test(kind: str, key: str) -> dict[str, Any]:
    """Anthropic API key: list models (free). Subscription token: one tiny turn through the Claude Code CLI."""
    from axf.assistant_host import providers
    prof = {"kind": kind, "key": key, "noKeyOverride": True}
    started = time.monotonic()
    if kind == "anthropic":
        models = providers.list_models(prof)
        return {"ok": True, "ms": int((time.monotonic() - started) * 1000), "detail": f"{len(models)} models available"}
    r = providers.test_profile(prof, "haiku")
    return {"ok": True, "ms": r.get("ms", 0), "detail": "Claude Code answered" + (f": {r['reply']}" if r.get("reply") else "")}


TESTER: Callable[[str, str], dict[str, Any]] = _default_test  # replaced by the self-test


def run_test(kind: str, key: str) -> dict[str, Any]:
    res: dict[str, Any] = {"at": int(time.time() * 1000), "ok": False, "ms": 0, "detail": "", "error": ""}
    try:
        res.update(TESTER(kind, key))
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip("'\"") or e.__class__.__name__
        res["error"] = msg.replace(key, "…")[:300]  # never echo the key
    return res


def public(kid: str, rec: dict[str, Any], active: dict[str, str]) -> dict[str, Any]:
    return {"id": kid, "label": rec.get("label") or kid, "kind": rec.get("kind"), "kindLabel": KINDS.get(rec.get("kind", ""), ""),
            "hint": "…" + str(rec.get("key", ""))[-4:], "active": active.get(rec.get("kind", "")) == kid,
            "createdAt": rec.get("createdAt"), "lastTest": rec.get("lastTest")}


def listing(db: dict[str, Any] | None = None) -> dict[str, Any]:
    db = db or _load()
    rows = [public(k, v, db["active"]) for k, v in db["keys"].items()]
    rows.sort(key=lambda r: (r["kind"] or "", -(r["createdAt"] or 0)))
    return {"keys": rows, "active": db["active"], "kinds": [{"id": k, "label": v} for k, v in KINDS.items()]}


def _err(status: int, msg: str) -> HTTPException:
    return HTTPException(status, msg)


@router.get("/keys")
def get_keys() -> dict[str, Any]:
    return listing()


@router.post("/keys")
def add_key(body: dict[str, Any]) -> dict[str, Any]:
    key = re.sub(r"\s+", "", str(body.get("key") or ""))
    label = str(body.get("label") or "").strip()[:80]
    if not KEY_RE.match(key):
        raise _err(400, "that doesn't look like an Anthropic key: API keys start with sk-ant-api…, subscription tokens (from `claude setup-token`) with sk-ant-oat…")
    kind = kind_of(key)
    if not kind:
        raise _err(400, "unknown key type: API keys start with sk-ant-api…, subscription tokens with sk-ant-oat…")
    with _lock:
        db = _load()
        if len(db["keys"]) >= MAX_KEYS:
            raise _err(400, f"at most {MAX_KEYS} keys")
        if any(secrets.compare_digest(str(v.get("key", "")), key) for v in db["keys"].values()):
            raise _err(409, "that key is already stored")
    test = run_test(kind, key)  # outside the lock: the CLI test can take seconds
    if not test["ok"]:
        raise _err(400, f"the key didn't work, so it wasn't saved: {test['error'] or 'no answer'}")
    with _lock:
        db = _load()
        kid = secrets.token_hex(6)
        db["keys"][kid] = {"label": label or f"{KINDS[kind]} …{key[-4:]}", "kind": kind, "key": key, "createdAt": int(time.time() * 1000), "lastTest": test}
        if body.get("activate") or not db["active"].get(kind):
            db["active"][kind] = kid
        _save(db)
    cx.log("system", f"AI keys: added {KINDS[kind]} …{key[-4:]}", "ok")
    return {"key": public(kid, db["keys"][kid], db["active"]), **listing(db)}


@router.patch("/keys/{kid}")
def rename_key(kid: str, body: dict[str, Any]) -> dict[str, Any]:
    label = str(body.get("label") or "").strip()[:80]
    if not label:
        raise _err(400, "a name is needed")
    with _lock:
        db = _load()
        if kid not in db["keys"]:
            raise _err(404, "no such key")
        db["keys"][kid]["label"] = label
        _save(db)
    return listing(db)


@router.delete("/keys/{kid}")
def delete_key(kid: str) -> dict[str, Any]:
    with _lock:
        db = _load()
        rec = db["keys"].pop(kid, None)
        if rec is None:
            raise _err(404, "no such key")
        kind = rec.get("kind", "")
        if db["active"].get(kind) == kid:  # the next newest key of that kind takes over, else none
            rest = sorted(((k, v) for k, v in db["keys"].items() if v.get("kind") == kind), key=lambda kv: -(kv[1].get("createdAt") or 0))
            db["active"][kind] = rest[0][0] if rest else ""
        _save(db)
    cx.log("system", f"AI keys: removed {rec.get('label')}", "info")
    return listing(db)


@router.post("/keys/{kid}/test")
def test_key(kid: str) -> dict[str, Any]:
    with _lock:
        rec = _load()["keys"].get(kid)
    if not rec:
        raise _err(404, "no such key")
    res = run_test(rec["kind"], rec["key"])
    with _lock:
        db = _load()
        if kid in db["keys"]:
            db["keys"][kid]["lastTest"] = res
            _save(db)
    return {"test": res, **listing(db)}


@router.post("/active")
def set_active(body: dict[str, Any]) -> dict[str, Any]:
    kind, kid = str(body.get("kind") or ""), str(body.get("id") or "")
    with _lock:
        db = _load()
        if kid:
            rec = db["keys"].get(kid)
            if not rec:
                raise _err(404, "no such key")
            kind = rec["kind"]
        elif kind not in KINDS:
            raise _err(400, "kind must be anthropic or claude-code")
        db["active"][kind] = kid
        _save(db)
    cx.log("system", f"AI keys: active {KINDS[kind]} → {db['keys'][kid]['label'] if kid else 'none (profile keys)'}", "info")
    return listing(db)


def _credit_probe(kind: str, key: str, model: str | None) -> None:
    """One tiny request that spends credit (listing models is free, so it can't tell an empty balance). Raises on failure."""
    from axf.assistant_host import providers
    providers.test_profile({"kind": kind, "key": key, "noKeyOverride": True}, model or ("haiku" if kind == "claude-code" else None))


CREDIT_PROBE: Callable[[str, str, str | None], None] = _credit_probe  # replaced by the self-test


class KeysService:
    """axf.ai-keys@1: the active key per provider kind (anthropic, claude-code) and a safe listing (no keys)."""
    settings_tab = FOLDER
    open_action = "ai-keys.open"  # the dialog the systems check opens after a credits switch

    def credit_switch(self, kind: str, model: str | None, is_no_credit: Callable[[str], bool]) -> dict[str, Any]:
        """The active key of `kind` is out of credits: test the other saved keys of that kind (newest first) with one tiny
        request each and make the first that answers the active one (Brett, Oct 23 2026). Never returns keys."""
        with _lock:
            db = _load()
        was = db["active"].get(kind) or ""
        cands = sorted(((k, v) for k, v in db["keys"].items() if v.get("kind") == kind and k != was), key=lambda kv: -(kv[1].get("createdAt") or 0))
        tried: list[dict[str, Any]] = []
        for kid, rec in cands:
            err = ""
            try:
                CREDIT_PROBE(kind, rec["key"], model)
            except Exception as e:  # noqa: BLE001 — classified below, never raised
                err = (str(e).strip("'\"") or e.__class__.__name__).replace(rec["key"], "…")[:300]
            state = "ok" if not err else "no-credit" if is_no_credit(err) else "error"
            tried.append({"id": kid, "label": rec.get("label") or kid, "state": state, "error": err})
            if state == "ok":
                with _lock:
                    db = _load()
                    if kid in db["keys"]:
                        db["active"][kind] = kid
                        _save(db)
                cx.log("system", f"AI keys: {KINDS.get(kind, kind)} out of credits, switched to {rec.get('label')}", "warn")
                return {"switched": {"from": was, "to": kid, "label": rec.get("label") or kid}, "tried": tried}
        return {"switched": None, "tried": tried}

    def active_key(self, kind: str) -> str:
        with _lock:
            db = _load()
        kid = db["active"].get(kind) or ""
        return str(db["keys"].get(kid, {}).get("key") or "") if kid else ""

    def list(self) -> dict[str, Any]:
        return listing()


plugin_services.provide("axf.ai-keys@1", KeysService(), FOLDER)
