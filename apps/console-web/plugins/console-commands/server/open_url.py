"""open_url on the console (build move-amberx-web-app-into-the-console-amberx-andr, s8; contract C31, C31a, C31b).

The console sends a page to Brett's phone instead of the AmberX web app. Every URL is checked here with the phone's own
rule (`OpenUrlRules.allowed` in the AmberX app: https, amberxai.com or a subdomain, no user name or password, no port
other than 443, at most 2000 characters) and the phone checks it again.

Delivery, in order:
  1. the phone's own pick-up: a phone that talks to the console (s12) reads `GET open-url/pending?device=` and answers
     `POST open-url/{id}/answer {opened, notified}`;
  2. otherwise axHub's `amberx.open_url` tool (the AXPP device link the console wake already uses), straight away.
The history (queued, sent, opened, notified, refused, cancelled, failed) is kept in the plugin's data folder.

Pure helpers over a file; the routes in __init__.py call them, test_open_url.py drives them.
"""
from __future__ import annotations

import json
import os
import threading
import time
import uuid
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlsplit

DOMAINS = ("amberxai.com",)
MAX_URL = 2000
BROWSERS = ("chrome", "default")
STATES = ("queued", "sent", "opened", "notified", "refused", "cancelled", "failed")
OPEN = ("queued",)
KEEP = 200
PICKUP_S = 20.0  # a queued URL nobody picked up this long goes to axHub instead

_lock = threading.Lock()


def allowed(raw: Any) -> str:
    """The URL if the phone may open it, else ValueError with the phone's own message."""
    s = raw.strip() if isinstance(raw, str) else ""
    if not s:
        raise ValueError("url is required.")
    if len(s) > MAX_URL:
        raise ValueError("url is too long.")
    try:
        u = urlsplit(s)
        port = u.port
    except ValueError as e:
        raise ValueError("url isn't a valid address.") from e
    if u.scheme.lower() != "https":
        raise ValueError("Only https pages can be opened.")
    if u.username is not None or u.password is not None or "@" in u.netloc:
        raise ValueError("url can't carry a user name or password.")
    if port not in (None, 443):
        raise ValueError("url can't name a port.")
    host = (u.hostname or "").lower()
    if not host or host.endswith(".") or not any(host == d or host.endswith("." + d) for d in DOMAINS):
        raise ValueError(f"AmberX only opens Brett's own sites ({', '.join(DOMAINS)}), not \"{host}\".")
    return s


class Store:
    """The open-url history in one JSON file (newest last, at most KEEP)."""

    def __init__(self, path: Callable[[], Path]) -> None:
        self.path = path

    def _read(self) -> list[dict[str, Any]]:
        try:
            rows = json.loads(self.path().read_text())
        except (OSError, ValueError):
            return []
        return [r for r in rows if isinstance(r, dict)] if isinstance(rows, list) else []

    def _write(self, rows: list[dict[str, Any]]) -> None:
        p = self.path()
        p.parent.mkdir(parents=True, exist_ok=True)
        tmp = p.with_name(f".{p.name}.{os.getpid()}")
        tmp.write_text(json.dumps(rows[-KEEP:]))
        os.replace(tmp, p)

    def add(self, url: str, browser: str, to: str, by: str) -> dict[str, Any]:
        now = int(time.time() * 1000)
        item = {"id": f"ou-{uuid.uuid4().hex[:12]}", "url": url, "browser": browser, "device": to, "by": by, "state": "queued", "at": now, "updatedAt": now}
        with _lock:
            self._write(self._read() + [item])
        return item

    def update(self, iid: str, **change: Any) -> dict[str, Any] | None:
        with _lock:
            rows = self._read()
            for r in rows:
                if r.get("id") == iid:
                    r.update(change, updatedAt=int(time.time() * 1000))
                    self._write(rows)
                    return r
        return None

    def get(self, iid: str) -> dict[str, Any] | None:
        return next((r for r in self._read() if r.get("id") == iid), None)

    def listing(self, since: int = 0, state: str = "", limit: int = 50) -> list[dict[str, Any]]:
        rows = [r for r in self._read() if int(r.get("updatedAt") or 0) > since and (not state or r.get("state") == state)]
        return list(reversed(rows))[: max(1, min(limit, KEEP))]

    def pending(self, device: str) -> list[dict[str, Any]]:
        """What a phone should open: queued, for it or for any phone."""
        return [r for r in self._read() if r.get("state") == "queued" and (not r.get("device") or r.get("device") == device)]


def outcome_state(r: dict[str, Any]) -> str:
    """The history state for a delivery answer ({ok, opened, notified})."""
    if not r.get("ok"):
        return "failed"
    if r.get("opened"):
        return "opened"
    if r.get("notified"):
        return "notified"
    return "sent"
