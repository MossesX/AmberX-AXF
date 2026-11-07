"""The public RSVP page: a guest opens the link from an email, answers and leaves a message, with no login.

    GET  /public/notes-tasks/reply/<token>   the page: event title, time and place, nothing else
    POST /public/notes-tasks/reply/<token>   answer=yes|no|maybe|seen, message=<text>

A token names one guest of one event and is signed with a secret that never leaves the console's data folder. It
expires, and it stops working the moment the guest or the event is gone. Mail scanners open links, so opening the page
changes nothing: only a button press counts, "seen" included. Every request is rate limited per address and every answer
per token. The answer is appended to the `replies` table (only this server writes it), so it shows on every screen.
"""
from __future__ import annotations

import base64
import hashlib
import hmac
import html
import json
import os
import re
import secrets
import threading
import time
import uuid
from collections import deque
from pathlib import Path
from typing import Any, Callable
from urllib.parse import parse_qs

from fastapi import APIRouter, Request
from fastapi.responses import HTMLResponse

from . import calendar_core as cc

MAX_BODY = 8_000
MAX_MESSAGE = 2_000
DAY = 86_400
LABEL = {"yes": "Yes", "no": "No", "maybe": "Maybe", "seen": "Seen it"}


def _b64(b: bytes) -> str:
    return base64.urlsafe_b64encode(b).rstrip(b"=").decode()


def _unb64(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


class Secret:
    def __init__(self, folder: Callable[[], Path]) -> None:
        self.folder = folder

    def value(self) -> bytes:
        env = os.environ.get("AXF_CALENDAR_REPLY_SECRET")
        if env:
            return env.encode()
        p = self.folder() / "reply-secret"
        try:
            return p.read_bytes()
        except OSError:
            p.parent.mkdir(parents=True, exist_ok=True)
            fd = os.open(p, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            key = secrets.token_bytes(32)
            with os.fdopen(fd, "wb") as f:
                f.write(key)
            return key


def mint(secret: bytes, event: str, guest: str, expires: int) -> str:
    body = _b64(json.dumps({"e": event, "g": guest, "x": expires}, separators=(",", ":")).encode())
    return f"{body}.{_b64(hmac.new(secret, body.encode(), hashlib.sha256).digest())}"


def check(secret: bytes, token: str, now: float | None = None) -> dict[str, Any] | None:
    """The token's claims, or None when it's forged, malformed or expired (the page doesn't say which)."""
    if len(token) > 600 or token.count(".") != 1:
        return None
    body, sig = token.split(".")
    if not hmac.compare_digest(_b64(hmac.new(secret, body.encode(), hashlib.sha256).digest()), sig):
        return None
    try:
        c = json.loads(_unb64(body))
    except (ValueError, UnicodeDecodeError):
        return None
    if not isinstance(c, dict) or not isinstance(c.get("x"), int) or c["x"] < (now if now is not None else time.time()):
        return None
    return c


def expiry(event: dict[str, Any], now: float) -> int:
    """Two weeks past the event, at least two weeks from now, a year at most. A repeating event runs 90 days."""
    if event.get("repeat"):
        return int(now + 90 * DAY)
    try:
        end = cc.instant(event["end"], event.get("tz") or "UTC").timestamp()
    except (KeyError, ValueError):
        end = now
    return int(min(now + 365 * DAY, max(now + 14 * DAY, end + 14 * DAY)))


class Limiter:
    """A sliding window per key. Bounded: the oldest keys go first."""

    def __init__(self, limit: int, window: float, keys: int = 5_000) -> None:
        self.limit, self.window, self.keys = limit, window, keys
        self.hits: dict[str, deque[float]] = {}
        self.lock = threading.Lock()

    def allow(self, key: str, now: float | None = None) -> bool:
        t = now if now is not None else time.monotonic()
        with self.lock:
            q = self.hits.pop(key, None) or deque()
            while q and t - q[0] > self.window:
                q.popleft()
            self.hits[key] = q  # newest last, so the first keys are the oldest
            if len(self.hits) > self.keys:
                self.hits.pop(next(iter(self.hits)))
            if len(q) >= self.limit:
                return False
            q.append(t)
            return True


def client_ip(request: Request) -> str:
    """Traefik appends the address it saw: the last entry is the real one, whatever a client sent before it."""
    f = request.headers.get("x-forwarded-for", "")
    return f.rsplit(",", 1)[-1].strip() if f else (request.client.host if request.client else "?")


def clean(text: str) -> str:
    return re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text).strip()[:MAX_MESSAGE]


CSS = """
:root{color-scheme:light dark;--bg:#f6f5f2;--card:#fff;--text:#1d1c1a;--muted:#6b6862;--line:#dcd9d2;--accent:#b4610f;--on:#fff}
@media (prefers-color-scheme:dark){:root{--bg:#161513;--card:#201f1c;--text:#f1efe9;--muted:#a5a198;--line:#37352f;--accent:#e8a14f;--on:#1c1407}}
*{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;padding:16px;background:var(--bg);color:var(--text);font:16px/1.45 system-ui,sans-serif}
main{width:100%;max-width:440px;background:var(--card);border:1px solid var(--line);border-radius:14px;padding:22px}
h1{font-size:21px;margin:0 0 6px}p{margin:0 0 6px;color:var(--muted)}.who{margin-bottom:16px}
.row{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin:14px 0}
button{font:inherit;font-weight:600;min-height:46px;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text);cursor:pointer}
button.main{background:var(--accent);border-color:var(--accent);color:var(--on)}button.wide{width:100%}
label{display:block;font-weight:600;margin-top:12px}textarea{width:100%;min-height:96px;margin-top:6px;padding:10px;font:inherit;border-radius:10px;border:1px solid var(--line);background:transparent;color:var(--text)}
.small{font-size:13px;margin-top:12px}
""".strip()


def _page(body: str, status: int = 200) -> HTMLResponse:
    nonce = secrets.token_urlsafe(12)
    doc = f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>RSVP</title><style nonce="{nonce}">{CSS}</style></head><body><main>{body}</main></body></html>'
    return HTMLResponse(doc, status, headers={
        "content-security-policy": f"default-src 'none'; style-src 'nonce-{nonce}'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
        "cache-control": "no-store", "referrer-policy": "no-referrer", "x-robots-tag": "noindex, nofollow", "x-content-type-options": "nosniff",
    })


def _nope(status: int = 404) -> HTMLResponse:
    return _page("<h1>This link has expired</h1><p>Ask whoever invited you for a new one.</p>", status)


def _slow() -> HTMLResponse:
    return _page("<h1>Slow down a little</h1><p>Too many tries. Wait a few minutes and open the link again.</p>", 429)


def _when(e: dict[str, Any]) -> str:
    from datetime import datetime
    s = datetime.fromisoformat(e["start"])
    day = s.strftime("%a %b ") + str(s.day)
    if e.get("allDay"):
        return day
    return f"{day}, {s.strftime('%I:%M %p').lstrip('0').replace(':00', '')}"


class Reply:
    def __init__(self, secret: Secret, root: Callable[[], Path], on_reply: Callable[[dict[str, Any], dict[str, Any]], None], now: Callable[[], float] = time.time) -> None:
        self.secret, self.root, self.on_reply, self.now = secret, root, on_reply, now
        self.by_ip = Limiter(60, 600)
        self.bad_ip = Limiter(10, 600)
        self.by_token = Limiter(10, 3600)
        self.lock = threading.Lock()

    def link(self, base: str, event: dict[str, Any], guest_id: str) -> str:
        return f"{base.rstrip('/')}/public/notes-tasks/reply/{mint(self.secret.value(), event['id'], guest_id, expiry(event, self.now()))}"

    def find(self, token: str) -> tuple[dict[str, Any], dict[str, Any]] | None:
        c = check(self.secret.value(), token, self.now())
        if not c:
            return None
        e = cc.read("events", self.root()).get(str(c.get("e")))
        if not e or e.get("deletedAt"):
            return None
        g = next((x for x in e.get("guests") or [] if x.get("id") == c.get("g")), None)
        return (e, g) if g else None

    def form(self, e: dict[str, Any], g: dict[str, Any]) -> str:
        where = f"<p>{html.escape(e['location'])}</p>" if e.get("location") else ""
        who = html.escape(g.get("name") or g.get("email") or "there")
        seen = '<p class="small">Just letting them know you saw this?</p><button class="wide" name="answer" value="seen">I\'ve seen it</button>'
        return (f"<h1>{html.escape(e.get('title') or 'Event')}</h1><p>{html.escape(_when(e))}</p>{where}<p class='who'>For {who}</p>"
                f'<form method="post"><label for="m">Your message</label><textarea id="m" name="message" maxlength="{MAX_MESSAGE}" placeholder="Anything to add? It goes on the event."></textarea>'
                '<div class="row"><button class="main" name="answer" value="yes">Yes</button><button class="main" name="answer" value="maybe">Maybe</button><button class="main" name="answer" value="no">No</button></div>'
                f"{seen}</form>")

    def save(self, e: dict[str, Any], g: dict[str, Any], answer: str, message: str, source: str = "page", rid: str = "") -> dict[str, Any]:
        row = {"id": rid or f"r-{uuid.uuid4().hex[:12]}", "event": e["id"], "guest": g.get("id") or "", "name": g.get("name") or g.get("email") or "",
               "at": cc.now_iso(), "answer": answer, "message": message, "source": source}
        with self.lock:
            rows = cc.read("replies", self.root())
            if row["id"] in rows:
                return rows[row["id"]]
            rows[row["id"]] = row
            cc.write("replies", rows, self.root())
        self.on_reply(e, row)
        return row

    def router(self) -> APIRouter:
        r = APIRouter()

        @r.get("/reply/{token}")
        def page(token: str, request: Request) -> HTMLResponse:
            ip = client_ip(request)
            if not self.by_ip.allow(ip):
                return _slow()
            found = self.find(token)
            if not found:
                return _nope() if self.bad_ip.allow(ip) else _slow()
            return _page(self.form(*found))

        @r.post("/reply/{token}")
        async def answer(token: str, request: Request) -> HTMLResponse:
            ip = client_ip(request)
            if not self.by_ip.allow(ip):
                return _slow()
            raw = await request.body()
            if len(raw) > MAX_BODY:
                return _page("<h1>That's too long</h1><p>Shorten your message and try again.</p>", 413)
            found = self.find(token)
            if not found:
                return _nope() if self.bad_ip.allow(ip) else _slow()
            if not self.by_token.allow(token):
                return _slow()
            form = parse_qs(raw.decode("utf-8", "replace"), keep_blank_values=True)
            ans = (form.get("answer") or [""])[0]
            message = clean((form.get("message") or [""])[0])
            if ans not in cc.ANSWERS:
                return _page(self.form(*found), 400)
            self.save(found[0], found[1], ans, message)
            return _page(f"<h1>Thanks!</h1><p>Your answer ({html.escape(LABEL[ans])}) is on {html.escape(found[0].get('title') or 'the event')}.</p>"
                         '<p class="small">Changed your mind? Open the link again.</p>')

        return r
