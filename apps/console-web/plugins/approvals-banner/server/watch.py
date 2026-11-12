"""Approvals as console alerts (build move-amberx-web-app-into-the-console-amberx-andr, s15).

Brett, Nov 12 2026: "I want to get rid of the AmberX app and make it all run on the console. I want all the
notifications. I want everything to go through the console."

The console reads axHub's approvals feed (`GET /auth/admin/approvals.json`) itself, with its server-side owner sign-in
(`AXF_HUB_RELAY_USER` / `AXF_HUB_RELAY_PASSWORD`, the same one the relay uses), and keeps one console alert per waiting
call: source `approvals`, key `approvals:<id>`, a held veto call as `approvals:veto:<id>`. The alerts hub then delivers
them like every other alert (bell, ntfy, web push, the AmberX watch), so nothing depends on the AmberX web app. A call
that is no longer waiting (decided anywhere, expired) resolves its alert and the phone takes the notification away.

It only reads. Deciding stays a person's tap (`POST decide`), never this loop.

  GET  watch        {ok, on, state, waiting, lastAt, error}: what the watch saw last
  POST watch/poll   read the feed now (otherwise every POLL_S seconds, or the pollSeconds setting)
  feed()            the waiting calls the last good read saw, with a version that moves when they change (s6, C20)
"""
from __future__ import annotations

import os
import threading
import time
from typing import Any, Callable

import httpx

KEY = "approvals:"
VETO_KEY = "approvals:veto:"
SOURCE = "approvals"
POLL_S = 30
FEED = "/auth/admin/approvals.json"
FEED_MAX = 256 * 1024
MAX_ITEMS = 50
CAPS = {"tool": 120, "summary": 600, "title": 200}


def _s(v: Any, cap: int) -> str:
    return " ".join(v.split())[:cap] if isinstance(v, str) else ""


def items_of(hub: str, body: Any, id_ok: Callable[[str], bool]) -> list[dict[str, Any]]:
    """The waiting calls in one feed reply (lib-hub interpretFeed rules): a real id, a link on the hub, no duplicates."""
    pending = body.get("pending") if isinstance(body, dict) else None
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for p in pending if isinstance(pending, list) else []:
        if len(out) >= MAX_ITEMS:
            break
        if not isinstance(p, dict) or not isinstance(p.get("id"), str) or not id_ok(p["id"]) or p["id"] in seen:
            continue
        url = p.get("url")
        if not isinstance(url, str) or not (url == hub or url.startswith(hub + "/")):
            continue
        seen.add(p["id"])
        veto = p.get("veto") if isinstance(p.get("veto"), dict) else None
        out.append({"id": p["id"], "tool": _s(p.get("tool"), CAPS["tool"]) or "call", "summary": _s(p.get("summary"), CAPS["summary"]),
                    "title": _s(p.get("title"), CAPS["title"]), "held": p.get("status") == "held" or veto is not None,
                    "url": f"{hub}/auth/admin/approvals/{p['id']}"})
    return out


def alert_for(item: dict[str, Any]) -> dict[str, Any]:
    """The console alert for one waiting call. A held veto call runs by itself unless stopped: critical."""
    what = item["title"] or item["tool"]
    if item["held"]:
        return {"source": SOURCE, "severity": "critical", "key": VETO_KEY + item["id"], "title": f"Runs by itself unless you stop it: {what}"[:200],
                "body": (item["summary"] or item["tool"])[:600], "link": item["url"],
                "meta": {"notifyType": "approvals.veto-call", "label": "Veto call", "approval": item["id"], "tool": item["tool"]}}
    return {"source": SOURCE, "severity": "warning", "key": KEY + item["id"], "title": f"Waiting for your approval: {what}"[:200],
            "body": (item["summary"] or item["tool"])[:600], "link": item["url"],
            "meta": {"notifyType": "approvals.waiting", "label": "Approval", "approval": item["id"], "tool": item["tool"]}}


def plan(open_keys: list[str], items: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[str]]:
    """(alerts to raise, keys to resolve). Raising an open key again is a repeat: the bell refreshes, the phone doesn't
    buzz twice. A call that turns from waiting into a held countdown gets its veto alert and loses the plain one."""
    want = [alert_for(i) for i in items]
    keys = {a["key"] for a in want}
    return [a for a in want if a["key"] not in open_keys], [k for k in open_keys if k not in keys]


class Watch:
    """One loop per console. `read(client)` → (status, body); `raise_alert` / `resolve` / `open_keys` are the alerts hub's."""

    def __init__(self, hub: Callable[[], str], cred: Callable[[], tuple[str, str] | None], session: Any, id_ok: Callable[[str], bool],
                 raise_alert: Callable[[dict[str, Any]], Any], resolve: Callable[[list[str]], Any], open_keys: Callable[[str], list[str]],
                 on: Callable[[], bool] = lambda: True) -> None:
        self.hub, self.cred, self.session, self.id_ok = hub, cred, session, id_ok
        self.raise_alert, self.resolve, self.open_keys, self.on = raise_alert, resolve, open_keys, on
        self.lock = threading.Lock()
        self.last: dict[str, Any] = {"state": "idle", "waiting": 0, "lastAt": 0, "error": ""}
        # the waiting calls the last good read saw (C20 feed) and a version that moves when they change
        self.items: list[dict[str, Any]] = []
        self.version = 0
        self.interval: Callable[[], int] = lambda: POLL_S

    def feed(self) -> dict[str, Any]:
        """The waiting calls as the console last read them: {pending, count, version, lastAt, state}."""
        return {"pending": [dict(i) for i in self.items], "count": len(self.items), "version": self.version, "lastAt": self.last.get("lastAt", 0), "state": self.state().get("state")}

    def _keep(self, items: list[dict[str, Any]]) -> None:
        sig = lambda xs: [(i["id"], i["held"], i["summary"]) for i in xs]  # noqa: E731
        if sig(items) != sig(self.items):
            self.version += 1
        self.items = items

    def state(self) -> dict[str, Any]:
        on = bool(self.hub() and self.cred())
        return {"on": on and self.on(), **self.last, **({} if on else {"state": "off", "error": "Needs the console's axHub owner sign-in (AXF_HUB_RELAY_USER / AXF_HUB_RELAY_PASSWORD) and an https AXF_WALL_HUB."})}

    def _note(self, state: str, waiting: int = 0, error: str = "") -> dict[str, Any]:
        self.last = {"state": state, "waiting": waiting, "lastAt": int(time.time() * 1000), "error": error[:300]}
        return self.state()

    def fetch(self, hub: str, cred: tuple[str, str], client: httpx.Client) -> tuple[int, Any]:
        for _ in (1, 2):
            s = self.session.get(hub, cred, client)
            if not s["ok"]:
                return 0, s.get("message") or "sign-in refused"
            r = client.get(hub + FEED, headers={"Cookie": f"axhub_session={s['cookie']}", "Accept": "application/json"})
            if r.status_code in (401, 302, 303):
                self.session.drop(s["cookie"])  # the hub dropped the session: sign in once more
                continue
            if len(r.content) > FEED_MAX:
                return 0, "the hub's reply is too large"
            try:
                return r.status_code, r.json()
            except ValueError:
                return 0, "the hub sent something unexpected"
        return 0, "axHub keeps refusing the console's sign-in session"

    def poll(self, client: httpx.Client | None = None) -> dict[str, Any]:
        """Read the feed once and bring the alerts in line. A failed read changes no alert (never clears on an outage)."""
        hub, cred = self.hub(), self.cred()
        if not hub or not cred or not self.on():
            return self.state()
        with self.lock:
            own = client is None
            c = client or httpx.Client(timeout=12.0, follow_redirects=False)
            try:
                status, body = self.fetch(hub, cred, c)
            except httpx.HTTPError as e:
                return self._note("unreachable", error=f"Can't reach axHub ({type(e).__name__}).")
            finally:
                if own:
                    c.close()
            if status != 200 or not isinstance(body, dict):
                return self._note("error", error=body if isinstance(body, str) else f"The hub answered {status}.")
            if body.get("signedIn") is False or body.get("admin") is False:
                return self._note("error", error="The console's axHub sign-in isn't an admin.")
            items = items_of(hub, body, self.id_ok)
            self._keep(items)
            fresh, gone = plan(self.open_keys(KEY), items)
            if gone:
                self.resolve(gone)
            for a in fresh:
                self.raise_alert(a)
            return self._note("ok", len(items))

    def loop(self, stop: threading.Event) -> None:
        stop.wait(15)
        while not stop.is_set():
            try:
                self.poll()
            except Exception as e:  # noqa: BLE001 — the watch must never take the console down
                self._note("error", error=f"{type(e).__name__}: {str(e)[:200]}")
            try:
                wait = max(10, min(300, int(self.interval())))
            except Exception:  # noqa: BLE001
                wait = POLL_S
            stop.wait(wait)


def start(w: Watch) -> threading.Event | None:
    stop = threading.Event()
    if os.environ.get("AXF_APPROVALS_WATCH") == "0":
        return None
    threading.Thread(target=w.loop, args=(stop,), name="approvals-watch", daemon=True).start()
    return stop
