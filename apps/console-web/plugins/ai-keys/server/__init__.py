"""AI keys — server part. Mounted at /api/plugins/ai-keys/ (console token on every method, 404 when disabled, never
on the console MCP).

A keyring for Anthropic keys: API keys (sk-ant-api03…, sk-ant-usr… and any newer sk-ant- API format, kind `anthropic`;
classified by `axf.anthropic_keys`, never by one hard-coded prefix) and Claude subscription tokens (sk-ant-oat…
+ a refresh token sk-ant-ort…, kind `claude-code`). Every key is tested before it is saved and can be re-tested; the
active key of each kind is what the AI assistant uses for profiles of that kind (it reads it through the capability
service axf.ai-keys@1, never by folder). Keys live only in <dataDir>/keys.json (0600); the browser only ever sees the
label, the kind, the last 4 characters and the last test.

Subscription tokens are pairs (Brett, Oct 25 2026): an access token and its refresh token, both required (typed in, or
Claude Code's ~/.claude/.credentials.json pasted whole). A pair is authorised only when both work together: the access
token answers (or has just expired), the refresh token gets a new access token from Anthropic's OAuth endpoint, and
that new access token answers too. The rotated pair is what's stored. Pairs are refreshed before they expire (a thread
every 10 minutes, and on read), and the active pair is written to Claude Code's credentials file on the VPS: directly
when this server can reach it (`AXF_CLAUDE_CREDENTIALS`), otherwise — or when that fails, noted in the sync log — by
Vinny through axHub `vps.run` (approved on axHub; the command copies a staged 0600 file out of the console container,
so no token is ever in a command or an approval page).

Routes: GET /keys · POST /keys {label, key} · PATCH /keys/{id} {label} · DELETE /keys/{id} · POST /keys/{id}/test ·
POST /active {kind, id}  (id "" = no active key of that kind: the assistant profile's own key applies again) ·
POST /keys {label, key, refresh} | {label, credentials} for a pair · PATCH /keys/{id} {refresh} adds the refresh token
to an older single token · GET /vps · POST /vps/sync · POST /switch {kind, reason} · POST /order {ids} (account
priority) · POST /validate {step, …} (the add-account wizard checks one step without saving or renewing anything) ·
POST /keys/{id}/test {part: "access"} tests only the access token (no renewal). GET /keys also answers `vpsAccounts`;
POST /active {id: "vps:<name>"} and POST /switch reach them (below).

Several Claude accounts (Brett, Nov 2 2026): every subscription pair shows the email of the Claude account it belongs to
(Anthropic's OAuth profile, looked up when the pair is added, re-tested or first refreshed; never blocks a save). When a
headless build stops on "You've hit your weekly limit" (or any usage/credit limit), deploy/claude-headless.sh calls
POST /switch: the next saved account that still answers becomes active, is written to the VPS, and the build re-runs on
it. The banner's Claude badge names the active account's email.

One store for the whole console (Brett, Nov 5 2026): keys.json holds the keys, active choice, priority order and VPS state
for every caller; nothing here is keyed on who is asking. Only console admins and the console's own token (AXF_TOKEN) get
in (`_admins_only`, on top of the console's plugin gate). Per-user keyring files, should any turn up in the data folder,
are merged into keys.json at startup and kept as .bak (`migrate_user_stores`).

The logins saved on the VPS (Claude accounts plugin, `claude-account`, ~/.claude-accounts) are a second keyring this
plugin doesn't own: GET /keys lists them as `vpsAccounts` (name, kind, email, plan; never a credential) and POST /active
{id: "vps:<name>"} or POST /switch moves between them with the Claude accounts plugin's one held switch
(axf.claude-accounts@1). Their tokens are deliberately never copied here: this plugin renews every pair it holds, and a
renewal rotates the refresh token, which would log out the saved copy and every build running on a snapshot of it.
"""
from __future__ import annotations

import json
import os
import re
import secrets
import shlex
import threading
import time
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Depends, HTTPException, Request

import console_context as cx
import plugin_services
import axf_framework  # noqa: F401 — framework/python on sys.path
from axf import anthropic_keys as ak
from axf_server import http, storage



def _admins_only(request: Request) -> None:
    """A console admin (signed in through the wall) or the console's token, never a wall user, whatever they were granted.
    Who passes makes no difference to what they see: there is one store."""
    user = getattr(request.state, "axf_user", None)
    if user is not None and not getattr(user, "admin", False):
        raise HTTPException(403, "AI keys is for console admins only.")


router = APIRouter(dependencies=[Depends(_admins_only)])
_lock = threading.Lock()
FOLDER = "ai-keys"
KINDS = {"anthropic": "Anthropic API key", "claude-code": "Claude subscription"}
MAX_KEYS = 50
KEY_RE = re.compile(r"^sk-ant-[A-Za-z0-9_-]{20,400}$")
REFRESH_RE = re.compile(r"^sk-ant-ort[A-Za-z0-9_-]{20,400}$")
OAUTH_URL = os.environ.get("AXF_CLAUDE_OAUTH_URL") or "https://console.anthropic.com/v1/oauth/token"
OAUTH_CLIENT_ID = os.environ.get("AXF_CLAUDE_OAUTH_CLIENT_ID") or "9d1c250a-e61b-44d9-88ed-5944d1962f5e"  # Claude Code's public client
REFRESH_AHEAD_MS = 30 * 60 * 1000  # the thread refreshes pairs this close to expiry
FRESH_MS = 5 * 60 * 1000  # a read refreshes a pair this close to expiry
VPS_LOG_MAX = 30
VPS_PREFIX = "vps:"  # ids of the accounts saved on the VPS, which live in ~/.claude-accounts and not in keys.json
HOST_LIMIT_MS = 24 * 3600 * 1000  # a VPS account that hit a limit isn't picked again for this long
PROFILE_URL = os.environ.get("AXF_CLAUDE_PROFILE_URL") or "https://api.anthropic.com/api/oauth/profile"
# A Claude account that can't take more work right now: out of credits, or over its weekly / daily / 5-hour limit.
LIMIT_RE = re.compile(r"hit your (?:weekly |daily |session |5-hour )?limit|weekly limit|usage limit|limit reached|rate limit"
                      r"|credit balance|out of credits?|insufficient[ _-]?(?:credit|funds|balance)|quota|payment required|\b402\b", re.I)


def data_dir() -> Path:
    return Path(os.environ.get("AXF_AI_KEYS_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _load() -> dict[str, Any]:
    try:
        raw = json.loads((data_dir() / "keys.json").read_text("utf-8"))
    except (OSError, ValueError):
        raw = {}
    keys = raw.get("keys") if isinstance(raw.get("keys"), dict) else {}
    active = raw.get("active") if isinstance(raw.get("active"), dict) else {}
    vps = raw.get("vps") if isinstance(raw.get("vps"), dict) else {}
    order = [str(x) for x in raw.get("order") or [] if str(x) in keys]
    limited = raw.get("hostLimited") if isinstance(raw.get("hostLimited"), dict) else {}
    return {"keys": keys, "active": {k: str(active.get(k) or "") for k in KINDS}, "vps": vps, "order": order, "hostLimited": limited}


def ranked(db: dict[str, Any], kind: str) -> list[str]:
    """Ids of `kind` in priority order: the saved order first, then the rest newest first."""
    ids = [k for k, v in db["keys"].items() if v.get("kind") == kind]
    pos = {k: i for i, k in enumerate(db.get("order") or [])}
    return sorted(ids, key=lambda k: (pos.get(k, len(pos)), -(db["keys"][k].get("createdAt") or 0)))


def _save(db: dict[str, Any]) -> None:
    storage.write_json(data_dir() / "keys.json", db, indent=None)  # atomic, 0600, folder 0700


def _user_stores() -> list[Path]:
    """Per-user keyrings in the data folder, oldest first: users/<name>/keys.json, users/<name>.json, keys-<name>.json."""
    d = data_dir()
    found = [*d.glob("users/*/keys.json"), *d.glob("users/*.json"), *d.glob("keys-*.json")]
    return sorted((f for f in found if f.is_file()), key=lambda f: f.stat().st_mtime)


def _same_key(a: dict[str, Any], b: dict[str, Any]) -> bool:
    return any(a.get(f) and b.get(f) and secrets.compare_digest(str(a[f]), str(b[f])) for f in ("key", "refresh"))


def migrate_user_stores() -> dict[str, Any]:
    """Merge every per-user keyring into keys.json: no duplicates (same key or refresh token), labels, emails, pairs, tests
    and priority kept, an active choice already set wins, then the newest store's. Each source becomes <file>.bak, never
    deleted; a file that can't be read is left alone. Logs counts and file names, never a key."""
    out: dict[str, Any] = {"stores": 0, "added": 0, "duplicates": 0, "skipped": []}
    with _lock:
        sources = _user_stores()
        if not sources:
            return out
        db, merged = _load(), []
        chosen = {kind for kind in KINDS if db["active"].get(kind) in db["keys"]}  # the console's own pick stays
        for src in sources:
            try:
                raw = json.loads(src.read_text("utf-8"))
                keys = raw["keys"]
                if not isinstance(keys, dict):
                    raise ValueError
            except (OSError, ValueError, KeyError, TypeError):
                out["skipped"].append(src.name)
                continue
            ids: dict[str, str] = {}
            for kid, rec in keys.items():
                if not isinstance(rec, dict) or rec.get("kind") not in KINDS or not rec.get("key"):
                    continue
                same = next((k for k, v in db["keys"].items() if _same_key(v, rec)), "")
                if same:
                    db["keys"][same] = {**rec, **db["keys"][same]}  # what's stored wins, the copy only fills gaps
                    ids[kid] = same
                    out["duplicates"] += 1
                    continue
                new = str(kid) if str(kid) not in db["keys"] else secrets.token_hex(6)
                db["keys"][new] = rec
                ids[kid] = new
                out["added"] += 1
            active = raw.get("active") if isinstance(raw.get("active"), dict) else {}
            for kind in KINDS:  # oldest first, so the newest store that has a choice decides
                if kind not in chosen and ids.get(active.get(kind)):
                    db["active"][kind] = ids[active[kind]]
            db["order"] += [ids[k] for k in raw.get("order") or [] if k in ids and ids[k] not in db["order"]]
            if not db.get("vps") and isinstance(raw.get("vps"), dict):
                db["vps"] = raw["vps"]
            merged.append(src)
            out["stores"] += 1
        if merged:
            _save(db)  # first, so a crash below leaves a source to merge again (it dedupes), never a lost key
            for src in merged:
                bak, n = src.with_name(src.name + ".bak"), 1
                while bak.exists():
                    bak, n = src.with_name(f"{src.name}.bak{n}"), n + 1
                src.rename(bak)
    if merged or out["skipped"]:
        cx.log("system", f"AI keys: merged {out['stores']} per-user store(s) into the console store: {out['added']} key(s) added, "
                         f"{out['duplicates']} duplicate(s), {len(out['skipped'])} unreadable", "warn" if out["skipped"] else "info")
    return out


def kind_of(key: str) -> str:
    """'anthropic' (any API key format, known or a new sk-ant- one) | 'claude-code' (sk-ant-oat…) | '' (anything else)."""
    k = ak.kind_of(key)
    return k if k in KINDS else ""


def _default_test(kind: str, key: str) -> dict[str, Any]:
    """Anthropic API key: the live check (list models, then a 1-token turn on the cheapest one for credit) → status
    ok | invalid | no-credit | error. Subscription token: one tiny turn through the Claude Code CLI."""
    from axf.assistant_host import providers
    prof = {"kind": kind, "key": key, "noKeyOverride": True}
    started = time.monotonic()
    if kind == "anthropic":
        r = ak.live_check(key)
        return {"ok": r["ok"], "status": r["status"], "ms": int((time.monotonic() - started) * 1000), "detail": r["detail"], "error": r["error"]}
    r = providers.test_profile(prof, "haiku")
    return {"ok": True, "ms": r.get("ms", 0), "detail": "Claude Code answered" + (f": {r['reply']}" if r.get("reply") else "")}


TESTER: Callable[[str, str], dict[str, Any]] = _default_test  # replaced by the self-test


def _default_refresh(refresh: str) -> dict[str, Any]:
    """Anthropic's OAuth refresh grant: refresh token → {access, refresh (rotated), expiresAt, scopes}. Raises on failure."""
    r = http.request("POST", OAUTH_URL, json_body={"grant_type": "refresh_token", "refresh_token": refresh, "client_id": OAUTH_CLIENT_ID},
                     headers={"Accept": "application/json"}, timeout=20, max_bytes=64_000)
    try:
        d = r.json() or {}
    except ValueError:
        d = {}
    if not r.ok:
        err = d.get("error") if isinstance(d, dict) else None
        why = (d.get("error_description") if isinstance(d, dict) else "") or (err.get("message") if isinstance(err, dict) else err) or ""
        raise RuntimeError(f"refresh refused ({r.status}){': ' + str(why) if why else ''}")
    access, new_refresh = str(d.get("access_token") or ""), str(d.get("refresh_token") or refresh)
    if not access.startswith("sk-ant-oat"):
        raise RuntimeError("the refresh answer had no access token")
    scopes = d.get("scope", "")
    return {"access": access, "refresh": new_refresh, "expiresAt": int(time.time() * 1000) + int(d.get("expires_in") or 28800) * 1000,
            "scopes": scopes.split() if isinstance(scopes, str) else list(scopes or [])}


REFRESHER: Callable[[str], dict[str, Any]] = _default_refresh  # replaced by the self-test


def _default_profile(access: str) -> dict[str, Any]:
    """The Claude account behind a subscription access token: {email, name, org}. Raises on failure."""
    r = http.request("GET", PROFILE_URL, headers={"Authorization": f"Bearer {access}", "anthropic-beta": "oauth-2025-04-20",
                                                  "Accept": "application/json"}, timeout=15, max_bytes=64_000)
    if not r.ok:
        raise RuntimeError(f"profile refused ({r.status})")
    d = r.json() or {}
    acc = d.get("account") if isinstance(d.get("account"), dict) else {}
    org = d.get("organization") if isinstance(d.get("organization"), dict) else {}
    email = str(acc.get("email_address") or acc.get("email") or "")[:200]
    if "@" not in email:
        raise RuntimeError("the profile had no email")
    return {"email": email, "name": str(acc.get("display_name") or acc.get("full_name") or "")[:120], "org": str(org.get("name") or "")[:120]}


PROFILER: Callable[[str], dict[str, Any]] = _default_profile  # replaced by the self-test


def fill_profile(kid: str, force: bool = False) -> None:
    """Look up and keep the account email of one subscription pair (best effort: a failure is only noted)."""
    with _lock:
        rec = dict(_load()["keys"].get(kid) or {})
    if rec.get("kind") != "claude-code" or not rec.get("key") or (rec.get("email") and not force):
        return
    try:
        prof, err = PROFILER(rec["key"]), ""
    except Exception as e:  # noqa: BLE001
        prof, err = {}, _hide(str(e), rec.get("key", ""), rec.get("refresh", ""))
    with _lock:
        db = _load()
        r = db["keys"].get(kid)
        if not r:
            return
        if prof.get("email"):
            r["email"], r["accountName"], r["org"] = prof["email"], prof.get("name") or "", prof.get("org") or ""
            r.pop("profileError", None)
        else:
            r["profileError"] = err or "no email"
        _save(db)


def _now() -> int:
    return int(time.time() * 1000)


def _hide(msg: str, *secrets_: str) -> str:
    for x in secrets_:
        if x:
            msg = msg.replace(x, "…")
    return msg[:300]


def parse_pair(body: dict[str, Any]) -> dict[str, Any] | None:
    """A subscription pair from the request: {key, refresh} or Claude Code's credentials file pasted whole. None = not a pair."""
    creds = body.get("credentials")
    if creds:
        try:
            d = json.loads(creds) if isinstance(creds, str) else creds
            o = d.get("claudeAiOauth") or d
            pair = {"key": str(o.get("accessToken") or ""), "refresh": str(o.get("refreshToken") or ""),
                    "expiresAt": int(o.get("expiresAt") or 0) or None, "scopes": list(o.get("scopes") or []),
                    "subscriptionType": str(o.get("subscriptionType") or "")[:40] or None}
        except (ValueError, TypeError, AttributeError):
            raise _err(400, "that isn't a Claude Code credentials file (expected {\"claudeAiOauth\": {accessToken, refreshToken, …}})") from None
    else:
        pair = {"key": re.sub(r"\s+", "", str(body.get("key") or "")), "refresh": re.sub(r"\s+", "", str(body.get("refresh") or "")),
                "expiresAt": None, "scopes": [], "subscriptionType": None}
        if not pair["key"].startswith("sk-ant-oat") and not pair["refresh"]:
            return None
    if not pair["key"].startswith("sk-ant-oat") or not KEY_RE.match(pair["key"]):
        raise _err(400, "a subscription access token is needed (sk-ant-oat…)")
    if not REFRESH_RE.match(pair["refresh"]):
        raise _err(400, "a subscription token needs its refresh token too (sk-ant-ort…): both are required")
    return pair


def validate_pair(pair: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any] | None]:
    """Both tokens in tandem: the access token answers (or has expired), the refresh token gets a new access token,
    and the new access token answers. Returns (test, rotated pair or None when it didn't pass)."""
    access, refresh = pair["key"], pair["refresh"]
    res: dict[str, Any] = {"at": _now(), "ok": False, "ms": 0, "detail": "", "error": "", "steps": []}
    started = time.monotonic()
    first = run_test("claude-code", access)
    expired = bool(pair.get("expiresAt")) and pair["expiresAt"] <= _now()
    res["steps"].append({"step": "access", "ok": first["ok"], "note": "expired, the refresh token renews it" if (not first["ok"] and expired) else (first.get("error") or "")})
    if not first["ok"] and not expired:
        res["error"] = f"the access token was refused: {first['error'] or 'no answer'}"
        return res, None
    try:
        new = REFRESHER(refresh)
    except Exception as e:  # noqa: BLE001
        res["steps"].append({"step": "refresh", "ok": False, "note": _hide(str(e), access, refresh)})
        res["error"] = f"the refresh token was refused: {_hide(str(e), access, refresh)}"
        return res, None
    res["steps"].append({"step": "refresh", "ok": True, "note": "new access token issued"})
    second = run_test("claude-code", new["access"])
    res["steps"].append({"step": "renewed access", "ok": second["ok"], "note": second.get("error") or ""})
    res["ms"] = int((time.monotonic() - started) * 1000)
    rotated = {**pair, "key": new["access"], "refresh": new.get("refresh") or refresh, "expiresAt": new.get("expiresAt"),
               "scopes": new.get("scopes") or pair.get("scopes") or [], "refreshedAt": _now()}
    if not second["ok"]:
        res["error"] = f"the renewed access token was refused: {_hide(second['error'] or 'no answer', new['access'], new.get('refresh', ''))}"
        return res, rotated  # the old pair is spent by the rotation: keep the new one so it isn't lost
    res["ok"] = True
    res["detail"] = "access token ✓ · refresh token ✓ · renewed access ✓" + (f" · {second['detail']}" if second.get("detail") else "")
    return res, rotated


def _apply_pair(rec: dict[str, Any], rotated: dict[str, Any]) -> None:
    for k in ("key", "refresh", "expiresAt", "scopes", "subscriptionType", "refreshedAt"):
        if rotated.get(k) is not None:
            rec[k] = rotated[k]


def is_pair(rec: dict[str, Any]) -> bool:
    return rec.get("kind") != "claude-code" or bool(rec.get("refresh"))


def refresh_record(kid: str, force: bool = False, ahead_ms: int = FRESH_MS) -> bool:
    """Refresh one pair when it's close to expiry (or `force`). Saves the rotated pair; True when it changed.
    Writes the VPS credentials when it's the active pair."""
    with _lock:
        rec = dict(_load()["keys"].get(kid) or {})
    if rec.get("kind") != "claude-code" or not rec.get("refresh"):
        return False
    if not force and rec.get("expiresAt") and rec["expiresAt"] - _now() > ahead_ms:
        return False
    try:
        new = REFRESHER(rec["refresh"])
    except Exception as e:  # noqa: BLE001
        msg = _hide(str(e), rec.get("key", ""), rec.get("refresh", ""))
        with _lock:
            db = _load()
            if kid in db["keys"]:
                db["keys"][kid]["refreshError"] = {"at": _now(), "error": msg}
                _save(db)
        cx.log("system", f"AI keys: couldn't refresh {rec.get('label')}: {msg}", "warn")
        return False
    with _lock:
        db = _load()
        if kid not in db["keys"]:
            return False
        r = db["keys"][kid]
        _apply_pair(r, {"key": new["access"], "refresh": new.get("refresh") or rec["refresh"], "expiresAt": new.get("expiresAt"),
                        "scopes": new.get("scopes") or None, "refreshedAt": _now()})
        r.pop("refreshError", None)
        _save(db)
        active = db["active"].get("claude-code") == kid
        needs_email = not r.get("email")
    if needs_email:
        fill_profile(kid)
    if active:
        sync_vps_soon("the active pair was refreshed")
    return True


def run_test(kind: str, key: str) -> dict[str, Any]:
    res: dict[str, Any] = {"at": int(time.time() * 1000), "ok": False, "ms": 0, "detail": "", "error": ""}
    try:
        res.update(TESTER(kind, key))
    except Exception as e:  # noqa: BLE001
        msg = str(e).strip("'\"") or e.__class__.__name__
        res["error"] = ak.scrub(msg.replace(key, "…"))[:300]  # never echo the key (nor any other key in the error)
    return res


def public(kid: str, rec: dict[str, Any], active: dict[str, str]) -> dict[str, Any]:
    return {"id": kid, "label": rec.get("label") or kid, "kind": rec.get("kind"), "kindLabel": KINDS.get(rec.get("kind", ""), ""),
            "hint": "…" + str(rec.get("key", ""))[-4:], "active": active.get(rec.get("kind", "")) == kid,
            "createdAt": rec.get("createdAt"), "lastTest": rec.get("lastTest"),
            "pair": bool(rec.get("refresh")), "needsRefresh": not is_pair(rec),
            "refreshHint": ("…" + str(rec["refresh"])[-4:]) if rec.get("refresh") else "",
            "expiresAt": rec.get("expiresAt"), "refreshedAt": rec.get("refreshedAt"), "refreshError": rec.get("refreshError"),
            "subscriptionType": rec.get("subscriptionType"), "email": rec.get("email") or "", "accountName": rec.get("accountName") or "",
            "limitedAt": rec.get("limitedAt"), "org": rec.get("org") or "", "accessTest": rec.get("accessTest")}


def listing(db: dict[str, Any] | None = None) -> dict[str, Any]:
    db = db or _load()
    rows = []
    for kind in KINDS:
        for i, k in enumerate(ranked(db, kind)):
            rows.append({**public(k, db["keys"][k], db["active"]), "priority": i + 1})
    return {"keys": rows, "active": db["active"], "kinds": [{"id": k, "label": v} for k, v in KINDS.items()], "vps": vps_public(db)}


def _err(status: int, msg: str) -> HTTPException:
    return HTTPException(status, msg)


def _by(request: Request) -> str:
    return str(getattr(getattr(request.state, "axf_user", None), "name", "") or "console")


def _host_view() -> dict[str, Any]:
    """What the Claude accounts plugin sees on the VPS, {} when it's off or can't answer: AI keys works without it."""
    svc = plugin_services.get("axf.claude-accounts@1")
    if svc is None:
        return {}
    try:
        return svc.view()
    except Exception as e:  # noqa: BLE001
        cx.log("system", f"AI keys: couldn't read the accounts on the VPS: {str(e)[:200]}", "warn")
        return {}


def vps_accounts(view: dict[str, Any] | None = None) -> list[dict[str, Any]]:
    """The accounts saved on the VPS, as listing rows: names, kinds, emails and plans only (they hold no key to show)."""
    limited = _load()["hostLimited"]
    rows = []
    for a in (_host_view() if view is None else view).get("accounts") or []:
        kind = "anthropic" if a.get("type") == "api-key" else "claude-code"
        rows.append({"id": VPS_PREFIX + a["name"], "label": a["name"], "kind": kind, "kindLabel": KINDS[kind], "type": a.get("type") or "login",
                     "active": bool(a.get("active")), "email": a.get("email") or "", "plan": a.get("plan") or "",
                     "limitedAt": limited.get(a["name"]), "source": "vps"})
    return rows


def _host_use(name: str, by: str) -> dict[str, Any]:
    """The Claude accounts plugin's one held switch: runs after the veto countdown unless Brett denies it."""
    svc = plugin_services.get("axf.claude-accounts@1")
    if svc is None:
        raise _err(503, "the Claude accounts plugin is off, so the accounts on the VPS can't be switched")
    return svc.use(name, by)


def _host_switch(reason: str, by: str) -> dict[str, Any]:
    """A limit hit with no pair of AI keys' own: mark the active VPS account and ask for the next subscription one down the
    list (API-key accounts are never picked: they cost money, so that's a choice for Brett). No probe: the tokens aren't
    here, so an account that turns out to be limited too is marked by the next hit."""
    rows = [r for r in vps_accounts() if r["kind"] == "claude-code"]
    cur = next((r for r in rows if r["active"]), None)
    now = _now()
    with _lock:
        db = _load()
        if cur:
            db["hostLimited"][cur["label"]] = now
            _save(db)
        limited = db["hostLimited"]
    at = rows.index(cur) + 1 if cur else 0
    cands = [r for r in rows[at:] + rows[:at] if r is not cur and now - (limited.get(r["label"]) or 0) > HOST_LIMIT_MS]
    answer: dict[str, Any] = {"switched": None, "tried": [], "account": {}, "vps": vps_public(_load())}
    lab = cur["label"] if cur else "the active account"
    if cands:
        r = cands[0]
        try:
            res = _host_use(r["label"], by)
            state, error = str(res.get("state") or ""), str(res.get("message") or "") if res.get("state") == "failed" else ""
        except HTTPException as e:
            state, error = "error", str(e.detail)
        answer["tried"].append({"id": r["id"], "label": r["label"], "state": state, "error": error})
        if state in ("done", "waiting"):
            answer["switched"] = {"from": cur["id"] if cur else "", "to": r["id"], "label": r["label"], "host": True, "state": state}
            answer["account"] = {"id": r["id"], "label": r["label"], "email": r["email"], "name": "", "kind": "claude-code"}
            cx.log("system", f"AI keys: {lab} on the VPS hit a limit{(' (' + reason + ')') if reason else ''}; switching to {r['label']}", "warn")
            return answer
    cx.log("system", f"AI keys: {lab} on the VPS hit a limit and no other saved account could take over", "error")
    return answer


@router.get("/keys")
def get_keys() -> dict[str, Any]:
    return {**listing(), "vpsAccounts": vps_accounts()}


@router.post("/keys")
def add_key(body: dict[str, Any]) -> dict[str, Any]:
    label = str(body.get("label") or "").strip()[:80]
    pair = parse_pair(body)
    if pair:
        return _add_pair(pair, label, bool(body.get("activate")))
    key = ak.clean(body.get("key"))
    kind = kind_of(key)
    if not kind:
        raise _err(400, ak.refusal(key) or "that key can't be stored here")
    if kind == "claude-code":  # unreachable (parse_pair takes every oat key), kept as a guard
        raise _err(400, "a subscription token needs its refresh token too (sk-ant-ort…): both are required")
    with _lock:
        db = _load()
        if len(db["keys"]) >= MAX_KEYS:
            raise _err(400, f"at most {MAX_KEYS} keys")
        if any(secrets.compare_digest(str(v.get("key", "")), key) for v in db["keys"].values()):
            raise _err(409, "that key is already stored")
    test = run_test(kind, key)  # outside the lock: the CLI test can take seconds
    no_credit = test.get("status") == "no-credit"  # a real key on an empty account: kept, so a top-up only needs a re-test
    if not test["ok"] and not no_credit:
        raise _err(400, f"the key didn't work, so it wasn't saved: {test['error'] or 'no answer'}")
    with _lock:
        db = _load()
        kid = secrets.token_hex(6)
        db["keys"][kid] = {"label": label or f"{KINDS[kind]} …{key[-4:]}", "kind": kind, "key": key, "createdAt": int(time.time() * 1000), "lastTest": test}
        if body.get("activate") or (not db["active"].get(kind) and not no_credit):
            db["active"][kind] = kid
        _save(db)
    cx.log("system", f"AI keys: added {KINDS[kind]} {ak.mask(key)}" + (" (no credit on the account yet)" if no_credit else ""), "warn" if no_credit else "ok")
    return {"key": public(kid, db["keys"][kid], db["active"]), **listing(db)}


def _dupe(db: dict[str, Any], *vals: str, skip: str = "") -> bool:
    return any(secrets.compare_digest(str(v.get(f, "")), x) for k, v in db["keys"].items() if k != skip for f in ("key", "refresh") for x in vals if x)


def _add_pair(pair: dict[str, Any], label: str, activate: bool) -> dict[str, Any]:
    with _lock:
        db = _load()
        if len(db["keys"]) >= MAX_KEYS:
            raise _err(400, f"at most {MAX_KEYS} keys")
        if _dupe(db, pair["key"], pair["refresh"]):
            raise _err(409, "that token is already stored")
    test, rotated = validate_pair(pair)  # outside the lock: the CLI test can take seconds
    if not test["ok"]:
        raise _err(400, f"the pair didn't authorise, so it wasn't saved: {test['error'] or 'no answer'}")
    with _lock:
        db = _load()
        kid = secrets.token_hex(6)
        rec = {"label": label or f"{KINDS['claude-code']} …{pair['key'][-4:]}", "kind": "claude-code", "createdAt": _now(), "lastTest": test}
        _apply_pair(rec, rotated or pair)
        db["keys"][kid] = rec
        became = activate or not db["active"].get("claude-code")
        if became:
            db["active"]["claude-code"] = kid
        _save(db)
    cx.log("system", f"AI keys: added {KINDS['claude-code']} pair {rec['label']}", "ok")
    fill_profile(kid)
    with _lock:
        db = _load()
    if became:
        sync_vps_soon("a new pair became active")
    return {"key": public(kid, db["keys"][kid], db["active"]), **listing(db)}


@router.patch("/keys/{kid}")
def rename_key(kid: str, body: dict[str, Any]) -> dict[str, Any]:
    if body.get("refresh") or body.get("credentials"):
        return _complete_pair(kid, body)
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


def _complete_pair(kid: str, body: dict[str, Any]) -> dict[str, Any]:
    """An older single subscription token gets its refresh token (or the whole credentials file), validated as a pair."""
    with _lock:
        db = _load()
        rec = db["keys"].get(kid)
        if not rec or rec.get("kind") != "claude-code":
            raise _err(404, "no such subscription token")
        if _dupe(db, re.sub(r"\s+", "", str(body.get("refresh") or "")), skip=kid):
            raise _err(409, "that refresh token is already stored")
    pair = parse_pair(body if body.get("credentials") else {"key": rec["key"], "refresh": body.get("refresh")})
    test, rotated = validate_pair(pair)
    with _lock:
        db = _load()
        if kid not in db["keys"]:
            raise _err(404, "no such key")
        db["keys"][kid]["lastTest"] = test
        if rotated:
            _apply_pair(db["keys"][kid], rotated)
        _save(db)
        active = db["active"].get("claude-code") == kid
    if not test["ok"]:
        raise _err(400, f"the pair didn't authorise: {test['error'] or 'no answer'}")
    fill_profile(kid)
    if active:
        sync_vps_soon("the active token got its refresh token")
    return listing()


@router.delete("/keys/{kid}")
def delete_key(kid: str) -> dict[str, Any]:
    with _lock:
        db = _load()
        rec = db["keys"].pop(kid, None)
        if rec is None:
            raise _err(404, "no such key")
        kind = rec.get("kind", "")
        handed = db["active"].get(kind) == kid
        if handed:  # the next newest usable key of that kind takes over, else none
            rest = sorted(((k, v) for k, v in db["keys"].items() if v.get("kind") == kind and is_pair(v)), key=lambda kv: -(kv[1].get("createdAt") or 0))
            db["active"][kind] = rest[0][0] if rest else ""
        _save(db)
    cx.log("system", f"AI keys: removed {rec.get('label')}", "info")
    if handed and kind == "claude-code" and db["active"].get(kind):
        sync_vps_soon("the active pair was removed, the next one took over")
    return listing(db)


@router.post("/keys/{kid}/test")
def test_key(kid: str, body: dict[str, Any] | None = None) -> dict[str, Any]:
    with _lock:
        rec = _load()["keys"].get(kid)
    if not rec:
        raise _err(404, "no such key")
    if (body or {}).get("part") == "access":  # just the access token: one tiny turn, nothing renewed
        res = run_test(rec["kind"], rec["key"])
        with _lock:
            db = _load()
            if kid in db["keys"]:
                db["keys"][kid]["accessTest"] = res
                _save(db)
        return {"test": res, **listing(db)}
    rotated = None
    if rec["kind"] == "claude-code" and rec.get("refresh"):
        res, rotated = validate_pair({k: rec.get(k) for k in ("key", "refresh", "expiresAt", "scopes", "subscriptionType")})
    elif rec["kind"] == "claude-code":
        res = {**run_test(rec["kind"], rec["key"]), "ok": False}
        res["error"] = "add its refresh token: subscription tokens are only used as an access + refresh pair"
    else:
        res = run_test(rec["kind"], rec["key"])
    with _lock:
        db = _load()
        if kid in db["keys"]:
            db["keys"][kid]["lastTest"] = res
            if rotated:
                _apply_pair(db["keys"][kid], rotated)
            _save(db)
        active = db["active"].get("claude-code") == kid
    if rec["kind"] == "claude-code" and res.get("ok"):
        fill_profile(kid, force=True)
        with _lock:
            db = _load()
            db["keys"].get(kid, {}).pop("limitedAt", None)
            _save(db)
    if rotated and active:
        sync_vps_soon("the active pair was re-tested (and so rotated)")
    return {"test": res, **listing(db)}


@router.post("/active")
def set_active(body: dict[str, Any], request: Request) -> dict[str, Any]:
    kind, kid = str(body.get("kind") or ""), str(body.get("id") or "")
    if kid.startswith(VPS_PREFIX):
        return {**listing(), "vpsSwitch": _host_use(kid[len(VPS_PREFIX):], _by(request))}
    with _lock:
        db = _load()
        if kid:
            rec = db["keys"].get(kid)
            if not rec:
                raise _err(404, "no such key")
            kind = rec["kind"]
            if not is_pair(rec):
                raise _err(400, "add its refresh token first: a subscription token is only used as an access + refresh pair")
        elif kind not in KINDS:
            raise _err(400, "kind must be anthropic or claude-code")
        db["active"][kind] = kid
        _save(db)
    cx.log("system", f"AI keys: active {KINDS[kind]} → {db['keys'][kid]['label'] if kid else 'none (profile keys)'}", "info")
    if kind == "claude-code" and kid:
        sync_vps_soon("a pair was picked")
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
        cands = [(k, db["keys"][k]) for k in ranked(db, kind) if k != was and is_pair(db["keys"][k])]  # priority order (drag to set)
        tried: list[dict[str, Any]] = []
        for kid, rec in cands:
            err = ""
            if kind == "claude-code":
                refresh_record(kid)  # a pair close to expiry is renewed before it's probed
                with _lock:
                    rec = _load()["keys"].get(kid) or rec
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
                if kind == "claude-code":
                    sync_vps_soon("credits ran out, switched pairs")
                return {"switched": {"from": was, "to": kid, "label": rec.get("label") or kid}, "tried": tried}
        return {"switched": None, "tried": tried}

    def active_key(self, kind: str) -> str:
        with _lock:
            db = _load()
        kid = db["active"].get(kind) or ""
        rec = db["keys"].get(kid) if kid else None
        if not rec or not is_pair(rec):
            return ""
        if kind == "claude-code" and rec.get("expiresAt") and rec["expiresAt"] - _now() <= FRESH_MS:
            refresh_record(kid)
            with _lock:
                rec = _load()["keys"].get(kid) or {}
        return str(rec.get("key") or "")

    def list(self) -> dict[str, Any]:
        return listing()

    def active_account(self, kind: str = "claude-code") -> dict[str, Any]:
        """The active key of `kind` without the key: {id, label, email, name, kind} ({} when none)."""
        with _lock:
            db = _load()
        kid = db["active"].get(kind) or ""
        rec = db["keys"].get(kid) if kid else None
        if not rec:
            return {}
        return {"id": kid, "label": rec.get("label") or kid, "email": rec.get("email") or "", "name": rec.get("accountName") or "", "kind": kind}


@router.post("/switch")
def switch_account(body: dict[str, Any], request: Request) -> dict[str, Any]:
    """The active account hit a limit (a headless build's "You've hit your weekly limit", say): mark it and make the next
    saved account that still answers the active one (written to the VPS). {switched: null} when none can take over.
    With no subscription saved here, the switch moves between the accounts saved on the VPS (`switched.host`)."""
    kind = str(body.get("kind") or "claude-code")
    if kind not in KINDS:
        raise _err(400, f"kind is one of {', '.join(KINDS)}")
    reason = str(body.get("reason") or "")[:200]
    with _lock:
        db = _load()
        was = db["active"].get(kind) or ""
        host = kind == "claude-code" and not ranked(db, kind)
    if host:
        return _host_switch(reason, _by(request))
    with _lock:
        db = _load()
        if was in db["keys"]:
            db["keys"][was]["limitedAt"] = _now()
            _save(db)
    r = KeysService().credit_switch(kind, None, lambda m: bool(LIMIT_RE.search(m)))
    lab = (db["keys"].get(was) or {}).get("label") or "the active account"
    if r["switched"]:
        cx.log("system", f"AI keys: {lab} hit a limit{(' (' + reason + ')') if reason else ''}; switched to {r['switched']['label']}", "warn")
    else:
        cx.log("system", f"AI keys: {lab} hit a limit and no other saved account could take over", "error")
    return {**r, "account": KeysService().active_account(kind), "vps": vps_public(_load())}


@router.post("/order")
def set_order(body: dict[str, Any]) -> dict[str, Any]:
    """Account priority (drag and drop in Manage Claude accounts): `ids` first to last. Unknown ids are dropped; saved
    keys left out keep their place after the listed ones. The switch on a limit hit tries accounts in this order."""
    ids = [str(x) for x in body.get("ids") or [] if isinstance(x, str)]
    with _lock:
        db = _load()
        seen: set[str] = set()
        order = [k for k in ids if k in db["keys"] and not (k in seen or seen.add(k))]
        db["order"] = order + [k for k in db["order"] if k not in seen]
        _save(db)
    return listing(db)


@router.post("/validate")
def validate_step(body: dict[str, Any]) -> dict[str, Any]:
    """One step of the add-account wizard, checked at once without saving or renewing anything (a refresh token can only
    be checked by renewing it, so the wizard's last step saves through POST /keys). Steps: `access` {key} · `credentials`
    {credentials} · `api` {key}. Answers {ok, error, email?, name?, expired?}; a key is never echoed."""
    step = str(body.get("step") or "")
    out: dict[str, Any] = {"ok": False, "error": ""}
    if step == "api":
        key = ak.clean(body.get("key"))
        why = ak.refusal(key, "anthropic")
        if why:
            return {**out, "error": why}
        with _lock:
            if _dupe(_load(), key):
                return {**out, "error": "that key is already saved"}
        t = run_test("anthropic", key)
        return {**out, "ok": t["ok"], "status": t.get("status") or ("ok" if t["ok"] else "error"), "error": t.get("error") or "", "detail": t.get("detail") or ""}
    if step == "access":
        pair = {"key": re.sub(r"\s+", "", str(body.get("key") or "")), "refresh": "", "expiresAt": None}
        if not pair["key"].startswith("sk-ant-oat") or not KEY_RE.match(pair["key"]):
            return {**out, "error": "that isn't an access token (it starts with sk-ant-oat…)"}
    elif step == "credentials":
        try:
            pair = parse_pair({"credentials": body.get("credentials")}) or {}
        except HTTPException as e:
            return {**out, "error": str(e.detail)}
    else:
        return {**out, "error": "step is one of access, credentials, api"}
    with _lock:
        if _dupe(_load(), pair["key"], pair.get("refresh", "")):
            return {**out, "error": "that account's token is already saved"}
    expired = bool(pair.get("expiresAt")) and pair["expiresAt"] <= _now()
    if not expired:
        t = run_test("claude-code", pair["key"])
        if not t["ok"]:
            return {**out, "error": f"the access token was refused: {_hide(t.get('error') or 'no answer', pair['key'], pair.get('refresh', ''))}"}
    try:
        prof = PROFILER(pair["key"]) if not expired else {}
    except Exception:  # noqa: BLE001 — the email is a nicety, never a reason to stop
        prof = {}
    return {"ok": True, "error": "", "expired": expired, "email": prof.get("email") or "", "name": prof.get("name") or ""}


# --- Claude Code's credentials on the VPS -------------------------------------------------------------------------
# Written directly when this server can reach the file (AXF_CLAUDE_CREDENTIALS = its path, e.g. a bind mount); otherwise,
# or when that fails, the trouble goes in the sync log and Vinny runs one fixed command through axHub vps.run (approved
# there). The command only copies a staged 0600 file out of the console container: no token in a command or approval.

CONTAINER = os.environ.get("AXF_CONSOLE_CONTAINER") or "axf-console"
VPS_CLAUDE_HOME = os.environ.get("AXF_VPS_CLAUDE_HOME") or "/root/.claude"
HUB = (os.environ.get("AXF_WALL_HUB") or "https://axhub.amberxai.com").rstrip("/")
SLEEP: Callable[[float], None] = time.sleep  # replaced by the self-test
_sync_lock = threading.Lock()
_sync_again = threading.Event()


def credentials_doc(rec: dict[str, Any]) -> dict[str, Any]:
    """Claude Code's ~/.claude/.credentials.json for one pair."""
    o: dict[str, Any] = {"accessToken": rec["key"], "refreshToken": rec["refresh"], "expiresAt": rec.get("expiresAt"),
                         "scopes": rec.get("scopes") or ["user:inference", "user:profile"]}
    if rec.get("subscriptionType"):
        o["subscriptionType"] = rec["subscriptionType"]
    return {"claudeAiOauth": o}


def staged_path() -> Path:
    return data_dir() / "vps-credentials.json"


def vps_command() -> str:
    dest = f"{VPS_CLAUDE_HOME}/.credentials.json"
    q = shlex.quote
    return (f"install -d -m 700 {q(VPS_CLAUDE_HOME)} && (umask 077; docker exec {q(CONTAINER)} cat {q(str(staged_path()))} > {q(dest + '.new')})"
            f" && chmod 600 {q(dest + '.new')} && mv -f {q(dest + '.new')} {q(dest)} && echo 'credentials written'")


def vps_public(db: dict[str, Any]) -> dict[str, Any]:
    v = db.get("vps") or {}
    return {"state": v.get("state") or "idle", "via": v.get("via"), "at": v.get("at"), "label": v.get("label"),
            "approval": v.get("approval"), "error": v.get("error"), "log": list(v.get("log") or [])[-VPS_LOG_MAX:],
            "direct": bool(os.environ.get("AXF_CLAUDE_CREDENTIALS")), "command": vps_command()}


def _vps(**kw: Any) -> None:
    """Update the VPS sync status; `note` adds a sync log line (also the console terminal)."""
    note, level = kw.pop("note", None), kw.pop("level", "info")
    with _lock:
        db = _load()
        v = db["vps"] = {**(db.get("vps") or {}), **kw, "at": _now()}
        if note:
            v["log"] = (list(v.get("log") or []) + [{"at": _now(), "level": level, "text": str(note)[:300]}])[-VPS_LOG_MAX:]
        _save(db)
    if note:
        cx.log("system", f"AI keys · VPS: {note}", level)


def _direct_write(doc: dict[str, Any]) -> None:
    target = Path(os.environ["AXF_CLAUDE_CREDENTIALS"])
    storage.write_json(target, doc, indent=None)  # atomic, 0600


def _vinny_write() -> None:
    vinny = plugin_services.get("axf.vinny@1")
    if not vinny:
        raise RuntimeError("Vinny isn't available (Agent manager → Add-on agents → Vinny)")
    ok, why = vinny.ready()
    if not ok:
        raise RuntimeError(why)
    args = {"command": vps_command(), "timeout_seconds": 60}
    conf, tries = None, 0
    deadline = time.monotonic() + 30 * 60
    while True:
        r = vinny.call("vps.run", args, conf, 120, "Write the active Claude subscription pair to ~/.claude/.credentials.json")
        if "ok" in r:
            out = str(r["ok"])
            if "credentials written" not in out:
                raise RuntimeError(f"the command didn't finish: {out.strip()[-200:] or 'no output'}")
            return
        conf = r.get("confirm")
        if not conf or time.monotonic() > deadline:
            raise RuntimeError("the approval wasn't given in time")
        if tries == 0:
            _vps(state="waiting", approval=f"{HUB}/auth/admin/approvals/{conf}", note="waiting for approval on axHub")
        SLEEP(15 if tries < 10 else 60)  # Brett's retry timing: 10 × 15 s, then every minute
        tries += 1


def sync_vps(reason: str = "") -> dict[str, Any]:
    """Write the active subscription pair to Claude Code's credentials on the VPS (direct, else Vinny)."""
    with _sync_lock:
        with _lock:
            db = _load()
        kid = db["active"].get("claude-code") or ""
        rec = db["keys"].get(kid) if kid else None
        if not rec or not is_pair(rec):
            _vps(state="idle", note="no active subscription pair, nothing to write")
            return vps_public(_load())
        doc = credentials_doc(rec)
        _vps(state="writing", label=rec.get("label"), error=None, approval=None, note=f"writing {rec.get('label')}" + (f" ({reason})" if reason else ""))
        if os.environ.get("AXF_CLAUDE_CREDENTIALS"):
            try:
                _direct_write(doc)
                _vps(state="done", via="direct", note="written directly")
                return vps_public(_load())
            except Exception as e:  # noqa: BLE001
                _vps(note=f"couldn't write it directly ({_hide(str(e), rec['key'], rec['refresh'])}); handing it to Vinny", level="warn")
        else:
            _vps(note="this server can't reach the VPS's ~/.claude directly; handing it to Vinny (axHub vps.run)", level="warn")
        try:
            storage.write_json(staged_path(), doc, indent=None)
            _vinny_write()
            _vps(state="done", via="vinny", approval=None, note="written by Vinny")
        except Exception as e:  # noqa: BLE001
            _vps(state="failed", via="vinny", error=_hide(str(e), rec["key"], rec["refresh"]), note=f"Vinny couldn't write it: {_hide(str(e), rec['key'], rec['refresh'])}", level="error")
        finally:
            try:
                staged_path().unlink()
            except OSError:
                pass
        return vps_public(_load())


def sync_vps_soon(reason: str) -> None:
    """Write in the background (an approval can take minutes); a second ask while one runs runs once more after it."""
    if os.environ.get("AXF_AI_KEYS_NO_VPS"):
        return
    if _sync_lock.locked():
        _sync_again.set()
        return

    def go() -> None:
        sync_vps(reason)
        while _sync_again.is_set():
            _sync_again.clear()
            sync_vps("changed again while writing")
    threading.Thread(target=go, name="ai-keys-vps", daemon=True).start()


@router.get("/vps")
def get_vps() -> dict[str, Any]:
    return vps_public(_load())


@router.post("/vps/sync")
def post_vps_sync() -> dict[str, Any]:
    with _lock:
        db = _load()
    if not db["active"].get("claude-code"):
        raise _err(409, "no active subscription pair")
    sync_vps_soon("asked from the dialog")
    return vps_public(_load())


def refresh_due() -> int:
    """Refresh every pair close to expiry; returns how many were renewed."""
    with _lock:
        ids = [k for k, v in _load()["keys"].items() if v.get("kind") == "claude-code" and v.get("refresh")]
    return sum(1 for k in ids if refresh_record(k, ahead_ms=REFRESH_AHEAD_MS))


def _refresh_loop() -> None:
    while True:
        try:
            refresh_due()
        except Exception as e:  # noqa: BLE001
            cx.log("system", f"AI keys: refresh pass failed: {str(e)[:200]}", "warn")
        time.sleep(600)


try:
    migrate_user_stores()
except Exception as e:  # noqa: BLE001 — a bad old file must not take the plugin down
    cx.log("system", f"AI keys: merging per-user stores failed: {e.__class__.__name__}", "error")

if not os.environ.get("AXF_AI_KEYS_NO_THREAD"):
    threading.Thread(target=_refresh_loop, name="ai-keys-refresh", daemon=True).start()


plugin_services.provide("axf.ai-keys@1", KeysService(), FOLDER)
