"""open-url-route@1, the console server's half (framework/core/open-url-route.mjs is the reference engine).

The console server only ever tries the first route, `console-tab`: a connected console tab that is on screen takes the
page and opens it. Everything after that (overlay, direct, full-screen intent, notification) is the phone's; the
result says so with `fallThrough: true` so the caller (AmberX, axHub's relay, the wake path) goes on to the next route.

Same URL rule as the engine (`allowedUrl`): https only, a host of Brett's own sites (amberxai.com or a subdomain), no
user info, no port, at most MAX_URL characters. `framework/spec/check-open-url-route.mjs` replays the engine's
fixtures through this module too, so the two cannot drift.
"""
from __future__ import annotations

from typing import Any
from urllib.parse import urlsplit, urlunsplit

SCHEMA = "open-url-route@1"
RESULT = "open-url-result@1"
ROUTES = ("console-tab", "overlay", "direct", "full-screen-intent", "notification")
DEFAULT_HOSTS = ("amberxai.com",)
MAX_URL = 2000
# The reason codes the console side can give (a subset of the engine's REASONS; the words are the engine's).
REASONS = {
    "console-visible": "the console tab on screen took it and opened the page",
    "url-refused": "the address is not one of Brett's own https pages",
    "no-console": "no console tab is connected",
    "console-stale": "the console tab stopped answering",
    "console-behind": "the console tab is connected but not on screen",
    "console-other-origin": "the connected console is not the site the page is on",
    "attempt-failed": "the route was tried and failed",
    "nothing-left": "every route was skipped or failed",
}


def norm_hosts(hosts: Any) -> list[str]:
    out: list[str] = []
    for h in hosts if isinstance(hosts, (list, tuple)) else []:
        s = str(h or "").strip()[:253].lower().strip(".")
        if s and s not in out:
            out.append(s)
    return out or list(DEFAULT_HOSTS)


def own_host(host: str, hosts: Any = DEFAULT_HOSTS) -> bool:
    h = str(host or "").strip()[:300].lower()
    if not h or h.endswith("."):
        return False
    return any(h == d or h.endswith("." + d) for d in norm_hosts(hosts))


def allowed_url(raw: Any, hosts: Any = DEFAULT_HOSTS) -> dict[str, Any]:
    """{ok, url, reason, detail}: the normalised URL when it may be opened, else why not (= allowedUrl)."""
    s = raw.strip()[: MAX_URL + 1] if isinstance(raw, str) else ""
    refused = lambda detail: {"ok": False, "url": "", "reason": "url-refused", "detail": detail}  # noqa: E731
    if not s:
        return refused("url is required")
    if len(s) > MAX_URL:
        return refused("url is too long")
    try:
        u = urlsplit(s)
        port = u.port
    except ValueError:
        return refused("url is not a valid address")
    if not u.scheme or not u.netloc:
        return refused("url is not a valid address")
    if u.scheme.lower() != "https":
        return refused("only https pages can be opened")
    if u.username is not None or u.password is not None:
        return refused("url cannot carry a user name or password")
    if port is not None:
        return refused("url cannot name a port")
    host = (u.hostname or "").lower()
    if not own_host(host, hosts):
        return refused(f"AmberX only opens Brett's own sites ({', '.join(norm_hosts(hosts))}), not \"{host}\"")
    return {"ok": True, "url": urlunsplit(("https", host, u.path or "/", u.query, u.fragment)), "reason": "", "detail": ""}


def origin_of(url: str) -> str:
    try:
        u = urlsplit(url)
        return f"{u.scheme.lower()}://{(u.hostname or '').lower()}" if u.scheme and u.hostname else ""
    except ValueError:
        return ""


def console_result(url: str, opened: bool, reason: str, mode: str = "", detail: str = "") -> dict[str, Any]:
    """An open-url-result@1 for the console-tab route: opened → route console-tab; otherwise route none with the
    console-tab attempt in `tried` and `fallThrough` (the caller tries the phone's routes next)."""
    reason = reason if reason in REASONS else "attempt-failed"
    if opened:
        out = {"$axf": RESULT, "url": url, "route": "console-tab", "opened": True, "notified": False, "reason": "console-visible",
               "tried": [{"route": "console-tab", "outcome": "ok", "reason": "console-visible"}], "fallThrough": False}
    else:
        outcome = "failed" if reason == "attempt-failed" else "skipped"
        out = {"$axf": RESULT, "url": url, "route": "none", "opened": False, "notified": False, "reason": reason,
               "tried": [{"route": "console-tab", "outcome": outcome, "reason": reason}], "fallThrough": reason != "url-refused"}
    if mode:
        out["mode"] = mode
    out["message"] = message(out) + (f" ({detail})" if detail and not opened else "")
    return out


def message(result: dict[str, Any]) -> str:
    words = REASONS.get(str(result.get("reason") or ""), REASONS["nothing-left"])
    if result.get("route") not in (None, "", "none"):
        return words[0].upper() + words[1:]
    why = [REASONS[t["reason"]] for t in result.get("tried") or [] if t.get("reason") in REASONS]
    return "The page did not open: " + ("; ".join(why) if why else words)
