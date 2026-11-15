"""Anthropic key classification and the live check, shared by every Python surface that takes an Anthropic key.

Anthropic changes its key prefixes from time to time (``sk-ant-api03-…`` API keys, then ``sk-ant-usr…`` in Nov 2026),
so nothing classifies a key by one hard-coded prefix any more. ``classify`` looks the key up in ``PREFIXES`` (longest
match first) and falls back to *unknown ``sk-ant-``*: such a key is still taken as an Anthropic API key and the live check
decides, instead of the key being refused with "unknown key type".

Kinds:
  * ``anthropic``   — an API key for the Messages API (x-api-key).
  * ``claude-code`` — a Claude subscription login (OAuth access token, ``sk-ant-oat…``), used through the Claude Code CLI.
  * ``refresh``     — the refresh token that goes with a subscription access token (``sk-ant-ort…``); never a key on its own.
  * ``admin``       — an Admin API key (``sk-ant-admin…``): manages the organisation, can't call models.
  * ``session``     — a claude.ai browser session cookie (``sk-ant-sid…``): never accepted.
  * ``""``          — not an Anthropic key at all.

Never log or echo a key: use ``mask`` (last 4 only) and ``scrub`` for error text.
"""
from __future__ import annotations

import json
import re
import urllib.error
import urllib.request
from typing import Any, Callable

KEY_RE = re.compile(r"^sk-ant-[A-Za-z0-9_-]{20,400}$")

# prefix → (kind, label). Longest prefix wins, so a specific entry can sit under a broader one.
PREFIXES: dict[str, tuple[str, str]] = {
    "sk-ant-api": ("anthropic", "API key"),
    "sk-ant-usr": ("anthropic", "API key"),
    "sk-ant-oat": ("claude-code", "subscription access token"),
    "sk-ant-ort": ("refresh", "subscription refresh token"),
    "sk-ant-admin": ("admin", "Admin API key"),
    "sk-ant-sid": ("session", "claude.ai session cookie"),
}
UNKNOWN = ("anthropic", "API key (new format)")  # any other sk-ant- key: accepted as an API key, verified live
API_KINDS = ("anthropic",)


def clean(key: Any) -> str:
    """The key with all whitespace removed (pasted keys often carry a newline or spaces)."""
    return re.sub(r"\s+", "", str(key or ""))


def classify(key: str) -> dict[str, Any]:
    """{kind, label, prefix, known, wellFormed}. ``known`` is False for the unknown-``sk-ant-`` fallback."""
    k = clean(key)
    if not k.startswith("sk-ant-"):
        return {"kind": "", "label": "not an Anthropic key", "prefix": "", "known": False, "wellFormed": False}
    for p in sorted(PREFIXES, key=len, reverse=True):
        if k.startswith(p):
            kind, label = PREFIXES[p]
            return {"kind": kind, "label": label, "prefix": p, "known": True, "wellFormed": bool(KEY_RE.match(k))}
    m = re.match(r"^sk-ant-[a-z]+", k)
    return {"kind": UNKNOWN[0], "label": UNKNOWN[1], "prefix": m.group(0) if m else "sk-ant-", "known": False,
            "wellFormed": bool(KEY_RE.match(k))}


def kind_of(key: str) -> str:
    """'anthropic' | 'claude-code' | 'refresh' | 'admin' | 'session' | ''."""
    c = classify(key)
    return c["kind"] if c["wellFormed"] else ""


def is_api_key(key: str) -> bool:
    return kind_of(key) in API_KINDS


def is_subscription(key: str) -> bool:
    return kind_of(key) == "claude-code"


def refusal(key: str, want: str = "anthropic") -> str:
    """Why ``key`` can't go where a ``want`` key is needed ('' when it can). Never contains the key."""
    c = classify(key)
    if not c["kind"]:
        return "that doesn't look like an Anthropic key (Anthropic keys start with sk-ant-)"
    if not c["wellFormed"]:
        return "that Anthropic key looks cut off or has stray characters: copy it again"
    if c["kind"] == want:
        return ""
    if c["kind"] == "claude-code":
        return "that's a Claude subscription token (sk-ant-oat…), not an API key: add it as a subscription login"
    if c["kind"] == "anthropic":
        return "that's an Anthropic API key, not a subscription token (sk-ant-oat… from `claude setup-token`)"
    if c["kind"] == "refresh":
        return "that's a refresh token (sk-ant-ort…): it goes with a subscription access token, not on its own"
    if c["kind"] == "admin":
        return "that's an Admin API key (sk-ant-admin…): it manages the organisation and can't run models. Make a normal API key"
    if c["kind"] == "session":
        return "that's a claude.ai browser session cookie, not a key: never paste it anywhere"
    return f"that key can't be used here ({c['label']})"


def mask(key: str) -> str:
    k = clean(key)
    return "…" + k[-4:] if k else ""


def scrub(text: str, *keys: str) -> str:
    """``text`` with every given key (and anything that looks like an Anthropic key) replaced by its mask."""
    out = str(text or "")
    for k in keys:
        if k:
            out = out.replace(k, mask(k))
    return re.sub(r"sk-ant-[A-Za-z0-9_-]{8,}", lambda m: mask(m.group(0)), out)


# ------------------------------------------------------------------ live check

API_BASE = "https://api.anthropic.com"
CREDIT_RE = re.compile(r"credit balance|out of credits?|insufficient[ _-]?(?:credit|funds|balance)|billing|payment required|purchase credits", re.I)

# (method, url, headers, body|None) → (status, json|None). Swapped in tests; never sees anything but Anthropic's API.
Transport = Callable[[str, str, dict[str, str], Any], "tuple[int, Any]"]


def _urllib(method: str, url: str, headers: dict[str, str], body: Any) -> tuple[int, Any]:
    data = json.dumps(body).encode() if body is not None else None
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=20) as r:  # noqa: S310 — fixed Anthropic URL
            return r.status, json.loads(r.read() or b"null")
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"null")
        except ValueError:
            return e.code, None


def _message(j: Any) -> str:
    err = j.get("error") if isinstance(j, dict) else None
    return str((err.get("message") if isinstance(err, dict) else err) or "")[:300]


def live_check(key: str, transport: Transport | None = None, base: str = API_BASE) -> dict[str, Any]:
    """Checks an API key against Anthropic. Answers {ok, status, detail, error, models}:

    * ``status: "ok"``        — the key works and the account has credit;
    * ``status: "no-credit"`` — the key is real but the account has no credit (it is kept: top up and re-test);
    * ``status: "invalid"``   — Anthropic refused the key (401/403);
    * ``status: "error"``     — Anthropic couldn't be reached or answered something else.

    Step 1 lists the models (free; proves the key). Step 2, only when step 1 passed, is a 1-token turn on the cheapest
    model listed, because only a real turn shows a credit problem (a fraction of a cent). The key never appears in the answer.
    """
    send = transport or _urllib
    k = clean(key)
    h = {"x-api-key": k, "anthropic-version": "2023-06-01", "content-type": "application/json", "user-agent": "axf-ai-keys"}
    out: dict[str, Any] = {"ok": False, "status": "error", "detail": "", "error": "", "models": 0}
    try:
        st, j = send("GET", f"{base}/v1/models?limit=100", h, None)
    except Exception as e:  # noqa: BLE001
        return {**out, "error": scrub(f"cannot reach Anthropic: {e}", k)}
    if st in (401, 403):
        return {**out, "status": "invalid", "error": scrub(f"Anthropic refused the key ({st}){': ' + _message(j) if _message(j) else ''}", k)}
    if st != 200:
        msg = _message(j)
        if st in (400, 402) and CREDIT_RE.search(msg):
            return {**out, "status": "no-credit", "error": scrub(f"no credit on this account: {msg}", k)}
        return {**out, "error": scrub(f"Anthropic answered {st}{': ' + msg if msg else ''}", k)}
    ids = [m.get("id") for m in (j or {}).get("data", []) if isinstance(m, dict) and m.get("id")]
    out["models"] = len(ids)
    if not ids:
        return {**out, "ok": True, "status": "ok", "detail": "key accepted (no models listed)"}
    cheap = next((m for m in ids if "haiku" in m), ids[-1])
    try:
        st, j = send("POST", f"{base}/v1/messages", h, {"model": cheap, "max_tokens": 1, "messages": [{"role": "user", "content": "hi"}]})
    except Exception as e:  # noqa: BLE001
        return {**out, "ok": True, "status": "ok", "detail": f"{len(ids)} models available (credit not checked: {scrub(str(e), k)})"}
    msg = _message(j)
    if st == 200:
        return {**out, "ok": True, "status": "ok", "detail": f"{len(ids)} models available, credit OK"}
    if st in (400, 402, 403) and CREDIT_RE.search(msg):
        return {**out, "status": "no-credit", "error": scrub(f"the key works but the account has no credit: {msg}", k)}
    if st in (401, 403):
        return {**out, "status": "invalid", "error": scrub(f"Anthropic refused the key ({st}){': ' + msg if msg else ''}", k)}
    if st == 429:  # rate limited: the key and credit are fine as far as we can tell
        return {**out, "ok": True, "status": "ok", "detail": f"{len(ids)} models available (rate limited, credit not checked)"}
    return {**out, "ok": True, "status": "ok", "detail": f"{len(ids)} models available (credit check answered {st})"}
