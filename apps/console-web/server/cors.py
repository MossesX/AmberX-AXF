"""Which browser origins may call the console API cross-origin (build molly-gap-console-token-handoff).

Molly (molly.amberxai.com) and the other amberxai.com apps call /api with the console token in `Authorization`
(bearer, `credentials: 'omit'`), so the console answers CORS for an allow-list instead of `*`:

  - every https amberxai.com app origin (molly, axhub, amberx, expenses, the console itself…),
  - http(s)://localhost and 127.0.0.1 on any port (local dev servers; a Capacitor app shell is https://localhost),
  - plus `AXF_CORS_ORIGINS` (comma-separated exact origins, e.g. a staging host).

Cookies are never allowed cross-origin (`allow_credentials` stays off): a cross-origin caller proves itself with the
token only. Preflights reach this middleware without meeting axHub's wall (deploy: axf_wall_preflight_labels) and the
middleware sits outermost, so a 401 from the token gate still carries the CORS headers and a browser can tell "signed
out" from "unreachable".
"""
from __future__ import annotations

import os
import re
from typing import Any

ORIGIN_REGEX = r"https://([a-z0-9-]+\.)*amberxai\.com|https?://(localhost|127\.0\.0\.1)(:[0-9]{1,5})?"
ALLOW_HEADERS = ("authorization", "content-type", "accept", "x-axf-session", "x-axhub-session")
ALLOW_METHODS = ("GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS")
MAX_AGE_S = 600

_ORIGIN = re.compile(r"https?://[a-z0-9.-]+(:[0-9]{1,5})?")


def extra_origins(raw: str | None = None) -> list[str]:
    """`AXF_CORS_ORIGINS` as exact origins (lower-cased, no path, no trailing slash); anything else is dropped."""
    raw = os.environ.get("AXF_CORS_ORIGINS", "") if raw is None else raw
    out: list[str] = []
    for part in raw.split(","):
        o = part.strip().lower().rstrip("/")
        if o and o != "*" and _ORIGIN.fullmatch(o) and o not in out:
            out.append(o)
    return out


def allowed(origin: str, extra: list[str] | None = None) -> bool:
    """True when the console answers CORS for `origin` (the same rule the middleware applies)."""
    o = (origin or "").strip().lower()
    return bool(re.fullmatch(ORIGIN_REGEX, o)) or o in (extra_origins() if extra is None else extra)


def middleware_kwargs(extra: list[str] | None = None) -> dict[str, Any]:
    """Arguments for Starlette's CORSMiddleware."""
    return {
        "allow_origins": extra_origins() if extra is None else extra,
        "allow_origin_regex": ORIGIN_REGEX,
        "allow_methods": list(ALLOW_METHODS),
        "allow_headers": list(ALLOW_HEADERS),
        "allow_credentials": False,
        "max_age": MAX_AGE_S,
    }
