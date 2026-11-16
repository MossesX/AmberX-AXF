"""Wake a closed console (console-wake, Nov 3 2026): ask Brett's AmberX phone, through axHub, to open the Dev Console.

axHub's `amberx` device service relays `open_url` to the AmberX app over AXPP (axHub repo, packages/connectors/
device-relay). The phone opens it in its always-on overlay (the toolbar expands into a full-screen browser, no tap
needed); with the overlay off it goes to Chrome (or the default browser) and, where Android holds back a start from
the background, a high-priority notification opens it with one tap. The same tool carries the overlay verbs
(`?axf-overlay=expand|collapse`, console-commands `overlay`). The hub refuses any URL outside
Brett's own domains (amberxai.com), and so does the phone.

A "yes" from the phone is not proof a page opened: Android drops a blocked background start without raising anything,
so an older AmberX answers `opened: true` either way. `ok` here only means the phone took the request; `opened` and
`notified` are what it says it did, and only the console saying hello proves it (console-commands `picked`).

Needs AXHUB_URL (default https://axhub.amberxai.com) + AXHUB_TOKEN in the console's environment; the token goes only
to the hub (https only, no redirects).
"""
from __future__ import annotations

import json
import os
import uuid
from typing import Any

TOOL = "amberx.open_url"
REASON = {"title": "Open the Dev Console on Brett's phone",
          "description": "A console command (from a Claude session) is waiting and no console is open; AmberX opens console.amberxai.com in the browser so it can run."}


def _rpc(url: str, tok: str, sid: str | None, method: str, params: dict[str, Any], timeout: float) -> tuple[dict[str, Any], str | None]:
    from axf_server import http as axf_http, hub_session  # the console's own helpers (framework/python)

    headers = {"authorization": f"Bearer {tok}", "content-type": "application/json", "accept": "application/json, text/event-stream"}
    headers.update(hub_session.headers())
    if sid:
        headers["mcp-session-id"] = sid
    body = json.dumps({"jsonrpc": "2.0", "id": str(uuid.uuid4()), "method": method, "params": params}).encode()
    r = axf_http.request("POST", f"{url}/mcp", headers=headers, body=body, timeout=timeout, max_bytes=500_000, truncate=True)
    if not r.ok:
        raise RuntimeError(f"axHub answered {r.status}" + (" (check the axHub token)" if r.status in (401, 403) else ""))
    raw = r.text()
    if "text/event-stream" in r.headers.get("content-type", ""):
        msgs = [json.loads(ln[5:].strip()) for ln in raw.splitlines() if ln.startswith("data:") and ln[5:].strip()]
        msg = next((m for m in reversed(msgs) if "result" in m or "error" in m), {})
    else:
        msg = json.loads(raw or "{}")
    if "error" in msg:
        raise RuntimeError(str(msg["error"].get("message", "axHub error"))[:300])
    return msg.get("result") or {}, r.headers.get("mcp-session-id") or sid


def can_open_pages(last: dict[str, Any] | None = None) -> dict[str, Any]:
    """health@1 "AmberX can't open pages", from the phone's last open_url answer (passive: the check never opens a page).
    Red when the phone said Display over other apps and full-screen notices are both off, or the page only went out as
    a notification; green when the last page opened by itself; unknown until a page was asked for."""
    import time
    last = LAST if last is None else last
    a = last.get("answer") if isinstance(last, dict) else None
    if not isinstance(a, dict):
        return {"status": "unknown", "summary": "No page opened through AmberX since the console started.", "details": []}
    when = time.strftime("%H:%M UTC", time.gmtime(float(last.get("at") or 0)))
    reasons = {t.get("reason") for t in (a.get("tried") or []) if isinstance(t, dict)}
    no_overlay = a.get("overlay") is False or "overlay-off" in reasons
    no_fsi = "no-full-screen-intent" in reasons
    route = a.get("route") or ("overlay" if a.get("where") == "overlay" and a.get("opened") else "direct" if a.get("opened") else "notification" if a.get("notified") else "none")
    details = [f"Last open_url at {when}: route {route}, opened {'yes' if a.get('opened') else 'no'}."]
    if no_overlay:
        details.append("Display over other apps is off for AmberX.")
    if no_fsi:
        details.append("Full-screen notices are not allowed for AmberX.")
    if a.get("opened") is True:
        return {"status": "ok", "summary": f"AmberX opened the last page itself ({route}).", "details": details}
    if route in ("notification", "none") or (no_overlay and no_fsi):
        return {"status": "error", "summary": "AmberX can't open pages by itself: the last one " + ("only went out as a notification" if route == "notification" else "didn't open") + ".", "details": details}
    return {"status": "warn", "summary": "AmberX's last page didn't open by itself.", "details": details}


def _phone_answer(text: str) -> dict[str, Any]:
    """The phone's reply inside the hub's result text ({opened, notified, …}, at the top or under data/result)."""
    try:
        body = json.loads(text) if text else {}
    except json.JSONDecodeError:
        return {}
    for doc in (body, body.get("data") if isinstance(body, dict) else None, body.get("result") if isinstance(body, dict) else None):
        if isinstance(doc, dict) and ("opened" in doc or "held" in doc):
            return doc
    return body if isinstance(body, dict) else {}


LAST: dict[str, Any] = {}  # the last phone answer to amberx.open_url: {at, answer} (systems check "AmberX can't open pages")


def remember(a: dict[str, Any]) -> None:
    import time
    if isinstance(a, dict) and ("opened" in a or "route" in a or "overlay" in a):
        LAST.clear()
        LAST.update({"at": time.time(), "answer": a})


def outcome(res: dict[str, Any]) -> dict[str, Any]:
    """The hub's `tools/call` result → {ok, opened, notified, message}, saying only what the phone reported."""
    text = "\n".join(c.get("text", "") for c in res.get("content", []) if isinstance(c, dict))
    if res.get("isError"):
        try:
            err = json.loads(text).get("error", {})
        except Exception:  # noqa: BLE001
            err = {"message": text}
        return {"ok": False, "opened": False, "notified": False, "message": f"AmberX couldn't open the console: {str(err.get('message') or text)[:240]}"}
    a = _phone_answer(text)
    if a.get("verb") != "grant":
        remember(a)
    if a.get("route") == "console-tab" and a.get("opened") is True:
        return {"ok": True, "opened": True, "notified": False, "message": "the console tab on screen opened it", "route": "console-tab"}
    if a.get("held"):
        return {"ok": False, "opened": False, "notified": False, "message": "axHub is holding the request instead of sending it to the phone"}
    opened, notified = a.get("opened") is True, a.get("notified") is not False
    if a.get("where") == "overlay":
        # One overlay (Nov 13 2026): the always-on toolbar took it, no notification tap needed.
        if a.get("verb") == "collapse":
            ok = a.get("collapsed") is True
            return {"ok": ok, "opened": False, "notified": False,
                    "message": "AmberX collapsed the overlay to its toolbar" if ok else "the overlay isn't on screen on the phone"}
        return {"ok": True, "opened": opened, "notified": False,
                "message": "AmberX opened it full screen in its overlay" if opened else "AmberX's overlay couldn't open it"}
    if a.get("overlay") is False and not opened:
        message = "AmberX can't open pages on its own (Display over other apps is off): tap its notification"
    elif opened:
        message = "AmberX started the browser on the phone"
    elif notified:
        message = "Android held the browser back: tap AmberX's notification to open the console"
    else:
        message = "AmberX couldn't open the page and its notifications are off"
    return {"ok": True, "opened": opened, "notified": notified, "message": message}


GRANT_URL = "https://console.amberxai.com/?axf-open-pages=grant"
GRANT_REASON = {"title": "Ask AmberX to turn on what it needs to open pages",
                "description": "The systems check found AmberX can't open pages on its own (Display over other apps or full-screen notices off, or the last page only went out as a notification). AmberX opens the Android grant screen, or posts a notification whose tap opens it."}


def ask_to_grant() -> dict[str, Any]:
    """Auto fix: amberx.open_url with axf-open-pages=grant → the phone opens (or offers by notification) the grant screen."""
    r = open_url(GRANT_URL, reason=GRANT_REASON)
    return {"state": "done" if r.get("ok") else "failed", "message": "AmberX was asked to open the grant screen (tap its notification if it didn't come up)" if r.get("ok") else r.get("message", "AmberX couldn't be asked")}


def open_url(target: str, browser: str = "chrome", reason: dict[str, str] | None = None) -> dict[str, Any]:
    """→ {ok, opened, notified, message}. Never raises for a hub or phone failure: the command stays queued and the answer says why."""
    url = (os.environ.get("AXHUB_URL") or "https://axhub.amberxai.com").rstrip("/")
    tok = os.environ.get("AXHUB_TOKEN", "")
    if not tok:
        return {"ok": False, "opened": False, "notified": False, "message": "axHub isn't connected (no AXHUB_TOKEN), so AmberX can't be asked to open the console"}
    if not url.startswith("https://"):
        return {"ok": False, "opened": False, "notified": False, "message": "the axHub address must be https"}
    try:
        _, sid = _rpc(url, tok, None, "initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "axf-console-wake", "version": "1"}}, 15)
        res, _ = _rpc(url, tok, sid, "tools/call", {"name": "call", "arguments": {"tool": TOOL, "arguments": {"url": target, "browser": browser}, "reason": reason or REASON, "timeout_seconds": 20}}, 40)
    except Exception as e:  # noqa: BLE001
        return {"ok": False, "opened": False, "notified": False, "message": f"couldn't reach axHub: {str(e)[:200]}"}
    return outcome(res)
