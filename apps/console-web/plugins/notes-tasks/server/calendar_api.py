"""The calendar's server part: REST under /api/plugins/notes-tasks/calendar/ (plugin-commands turns these routes into
MCP tools and `axf notes-tasks …` commands by itself), reminders, invite and RSVP mail, and catching plain email
replies. The events live in the hub tables (calendar_core); the apps read and write them directly, this reaches the same
rows. `replies` and `mail` are written only here.
"""
from __future__ import annotations

import logging
import os
import re
import threading
import time
import uuid
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, Body, HTTPException, Query

from . import calendar_core as cc, calendar_google, hubcall
from .reply import Reply, Secret

log = logging.getLogger("notes-tasks")
TICK_S = 30
LATE_S = 15 * 60
MAIL_ROUND = 25
GMAIL_EVERY_S = 300
SYNC_EVERY_S = 300
KINDS = ("invite", "reminder", "seen")
EMAIL = re.compile(r"^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$")
FIELDS = ("calendar", "title", "location", "notes", "start", "end", "allDay", "tz", "repeat", "except", "overrides", "reminders", "guests", "rsvp")
TIME = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$")


def public_base() -> str:
    return (os.environ.get("AXF_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")


def _new_id(prefix: str) -> str:
    return f"{prefix}-{uuid.uuid4().hex[:12]}"


def check_event(row: dict[str, Any]) -> None:
    for k in ("start", "end"):
        v = row.get(k)
        if not isinstance(v, str) or not TIME.match(v):
            raise HTTPException(400, f"{k} must look like 2026-11-09T18:00")
    if row["end"] < row["start"]:
        raise HTTPException(400, "end is before start")
    if not str(row.get("title") or "").strip():
        raise HTTPException(400, "title is required")
    for g in row.get("guests") or []:
        if not EMAIL.match(str(g.get("email") or "")):
            raise HTTPException(400, f"not an email address: {str(g.get('email'))[:80]}")


def subject_line(e: dict[str, Any], kind: str) -> str:
    word = {"invite": "You're invited", "reminder": "Reminder", "seen": "Please confirm"}[kind]
    title = re.sub(r"[\r\n]+", " ", e.get("title") or "Event")[:120]
    return f"{word}: {title} [#{e['id']}]"


def mail_body(e: dict[str, Any], guest: dict[str, Any], kind: str, link: str) -> str:
    start = datetime.fromisoformat(e["start"])
    when = start.strftime("%A %B ") + str(start.day) + ("" if e.get("allDay") else start.strftime(", %I:%M %p").replace(" 0", " "))
    hello = f"Hi {guest['name']}," if guest.get("name") else "Hi,"
    ask = {"invite": "You're invited.", "reminder": "We haven't heard from you yet.", "seen": "Please confirm you've seen this."}[kind]
    lines = [hello, "", ask, "", e.get("title") or "Event", when]
    if e.get("location"):
        lines.append(e["location"])
    lines += ["", "Answer here (yes, no, maybe, and a message if you like):", link, "", "This link is just for you."]
    return "\n".join(lines)


class Calendar:
    def __init__(self, data: Callable[[], Path], raise_alert: Callable[[dict[str, Any]], Any], root: Callable[[], Path] = cc.calendar_dir,
                 now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.data, self.alert, self.root, self.now = data, raise_alert, root, now
        self.lock = threading.RLock()
        self.reply = Reply(Secret(data), root, self._replied, lambda: self.now().timestamp())
        self.google = calendar_google.Sync(root, now)
        self.last_gmail = 0.0
        self.last_sync = 0.0

    def _replied(self, e: dict[str, Any], r: dict[str, Any]) -> None:
        said = {"yes": "said yes", "no": "said no", "maybe": "said maybe", "seen": "saw it"}.get(r["answer"], "replied")
        self.alert({"source": "calendar", "severity": "info", "key": f"calendar:reply:{r['id']}", "title": f"{r['name']} {said}: {e.get('title')}"[:200], "body": r["message"][:500], "link": "view:calendar"})

    # ---- events

    def list(self, frm: str, to: str, q: str = "", calendar: str = "") -> list[dict[str, Any]]:
        out = []
        needle = q.lower()
        for e in cc.read("events", self.root()).values():
            if calendar and e.get("calendar") != calendar:
                continue
            if needle and needle not in f"{e.get('title')} {e.get('location')} {e.get('notes')}".lower():
                continue
            for o in cc.occurrences(e, frm, to):
                out.append({**o, "id": e["id"], "calendar": e.get("calendar"), "location": e.get("location") or "", "repeating": bool(e.get("repeat"))})
        return sorted(out, key=lambda o: o["start"])

    def add(self, fields: dict[str, Any], by: str = "api") -> dict[str, Any]:
        at = cc.now_iso()
        start = fields.get("start") or ""
        row = {k: fields[k] for k in FIELDS if k in fields}
        rid = _new_id("e")
        row.update({"id": rid, "calendar": row.get("calendar") or "personal", "end": row.get("end") or start, "createdAt": at, "updatedAt": at, "by": by})
        row["guests"] = [{"id": g.get("id") or _new_id("g"), "name": g.get("name") or "", "email": str(g.get("email") or "").strip().lower()} for g in row.get("guests") or []]
        check_event(row)
        with self.lock:
            rows = cc.read("events", self.root())
            rows[rid] = row
            cc.write("events", rows, self.root())
        return row

    def update(self, rid: str, fields: dict[str, Any], by: str = "api") -> dict[str, Any]:
        with self.lock:
            rows = cc.read("events", self.root())
            row = rows.get(rid)
            if not row:
                raise HTTPException(404, f"no event {rid}")
            row.update({k: fields[k] for k in FIELDS if k in fields})
            row["guests"] = [{"id": g.get("id") or _new_id("g"), "name": g.get("name") or "", "email": str(g.get("email") or "").strip().lower()} for g in row.get("guests") or []]
            row.update({"updatedAt": cc.now_iso(), "by": by})
            check_event(row)
            cc.write("events", rows, self.root())
        return row

    def remove(self, rid: str) -> dict[str, Any]:
        with self.lock:
            rows = cc.read("events", self.root())
            row = rows.get(rid)
            if not row:
                raise HTTPException(404, f"no event {rid}")
            if row.get("gcalId"):  # a tombstone until Google has it too
                row.update({"deletedAt": cc.now_iso(), "updatedAt": cc.now_iso()})
            else:
                rows.pop(rid)
            cc.write("events", rows, self.root())
        return {"removed": rid}

    def upsert(self, table: str, row: dict[str, Any]) -> dict[str, Any]:
        rid = str(row.get("id") or _new_id(table[0]))
        with self.lock:
            rows = cc.read(table, self.root())
            rows[rid] = {**rows.get(rid, {}), **row, "id": rid, "updatedAt": cc.now_iso()}
            cc.write(table, rows, self.root())
            return rows[rid]

    def guests(self, rid: str) -> dict[str, Any]:
        e = cc.read("events", self.root()).get(rid)
        if not e:
            raise HTTPException(404, f"no event {rid}")
        replies = cc.read("replies", self.root())
        rows = [{"id": g["id"], "name": g.get("name") or "", "email": g.get("email") or "", "status": cc.guest_status(g, rid, replies)} for g in e.get("guests") or []]
        return {"event": rid, "title": e.get("title"), "guests": rows, "replies": sorted((r for r in replies.values() if r.get("event") == rid), key=lambda r: r.get("at") or "")}

    # ---- mail: queued here, sent through the hub (Gmail) once it's there; each send is Brett's to confirm

    def queue_mail(self, rid: str, kind: str, only: list[str] | None = None) -> dict[str, Any]:
        if kind not in KINDS:
            raise HTTPException(400, f"kind must be one of {', '.join(KINDS)}")
        e = cc.read("events", self.root()).get(rid)
        if not e:
            raise HTTPException(404, f"no event {rid}")
        replies = cc.read("replies", self.root())
        with self.lock:
            mail = cc.read("mail", self.root())
            waiting = {(m.get("guest"), m.get("kind")) for m in mail.values() if m.get("event") == rid and m.get("status") in ("queued", "held")}
            added = 0
            for g in e.get("guests") or []:
                if only and g["id"] not in only:
                    continue
                st = cc.guest_status(g, rid, replies)
                # nobody who already answered is nagged, and a reminder goes only to who hasn't
                if (kind != "invite" and st in ("yes", "no", "maybe")) or (kind == "seen" and st == "seen") or (g["id"], kind) in waiting:
                    continue
                mid = _new_id("m")
                mail[mid] = {"id": mid, "event": rid, "guest": g["id"], "to": g["email"], "kind": kind, "subject": subject_line(e, kind), "status": "queued", "at": cc.now_iso(), "job": "", "error": ""}
                added += 1
            if added:
                cc.write("mail", mail, self.root())
        sent = self.drain()
        return {"queued": added, **sent}

    def drain(self) -> dict[str, Any]:
        """Sends what's queued, once each. No Gmail on the hub yet = it waits, and says so."""
        if not hubcall.available("gmail"):
            return {"gmail": False}
        with self.lock:
            mail = cc.read("mail", self.root())
            events = cc.read("events", self.root())
            n = 0
            for m in sorted(mail.values(), key=lambda x: x.get("at") or ""):
                if m.get("status") != "queued" or n >= MAIL_ROUND:
                    continue
                n += 1
                e = events.get(m["event"])
                g = next((x for x in (e or {}).get("guests") or [] if x.get("id") == m["guest"]), None)
                if not e or not g:
                    m.update({"status": "failed", "error": "the event or guest is gone"})
                    continue
                body = mail_body(e, g, m["kind"], self.reply.link(public_base(), e, g["id"]))
                try:
                    out = hubcall.call("gmail.send", {"to": m["to"], "subject": m["subject"], "body": body}, f"Email {m['to']}: {m['subject']}", f"Calendar {m['kind']} for {e.get('title')}. It carries a personal reply link.")
                except hubcall.HubError as err:
                    m.update({"status": "failed", "error": str(err)[:300]})
                    continue
                if out.get("held") or out.get("confirm"):
                    m.update({"status": "held", "job": out.get("job") or out.get("confirm") or ""})
                else:
                    m.update({"status": "sent", "at": cc.now_iso()})
                cc.write("mail", mail, self.root())  # at once: a crash here must not send it twice
            if n:
                cc.write("mail", mail, self.root())
        return {"gmail": True, "sent": n}

    def settle_mail(self) -> None:
        with self.lock:
            mail = cc.read("mail", self.root())
            changed = False
            for m in mail.values():
                if m.get("status") != "held" or not m.get("job"):
                    continue
                j = hubcall.job(m["job"])
                if j["state"] == "done":
                    m.update({"status": "sent", "at": cc.now_iso()})
                    changed = True
                elif j["state"] == "denied":
                    m.update({"status": "failed", "error": j.get("error") or "denied"})
                    changed = True
            if changed:
                cc.write("mail", mail, self.root())

    def catch_replies(self) -> int:
        """A plain reply to one of our emails, logged on its event when the sender is a guest of it."""
        got = 0
        tag = re.compile(r"\[#(e-[0-9a-z]+|g-[0-9a-z]+)\]")
        out = hubcall.call("gmail.search", {"query": 'subject:"[#" newer_than:14d -from:me', "maxResults": 30}, "Read calendar replies in Gmail", "Logs plain email replies on their events.")
        events = cc.read("events", self.root())
        known = cc.read("replies", self.root())
        for msg in (out.get("result") or {}).get("messages") or []:
            mid = str(msg.get("id") or "")
            found = tag.search(str(msg.get("subject") or ""))
            rid = f"gm-{mid}"
            e = events.get(found.group(1)) if found else None
            if not mid or not e or rid in known:
                continue
            sender = re.search(r"[^\s<>]+@[^\s<>]+", str(msg.get("from") or ""))
            g = next((x for x in e.get("guests") or [] if sender and x.get("email") == sender.group(0).lower()), None)
            if not g:
                continue
            full = hubcall.call("gmail.read", {"id": mid}, "Read a calendar reply", "Logs a plain email reply on its event.").get("result") or {}
            text = first_lines(str(full.get("body") or msg.get("snippet") or ""))
            self.reply.save(e, g, answer_in(text), text, "email", rid)
            got += 1
        return got

    # ---- reminders (console alerts; AmberX delivers them)

    def _due(self, now: datetime) -> list[dict[str, str]]:
        today = now.date()
        out = []
        def scan(source: str, tz: str, mins: list[int], occs: list[dict[str, str]]) -> None:
            for o in occs:
                try:
                    at = cc.instant(o["start"], tz)
                except ValueError:
                    continue
                for m in mins:
                    late = (now - (at - timedelta(minutes=m))).total_seconds()
                    if 0 <= late <= LATE_S:
                        out.append({"key": f"{source}|{o['date']}{'|' + o['block'] if o.get('block') else ''}|{m}", "title": o["title"], "start": o["start"]})
        reach = 8
        frm, to = (today - timedelta(days=1)).isoformat(), (today + timedelta(days=reach)).isoformat()
        for e in cc.read("events", self.root()).values():
            if e.get("reminders"):
                scan(e["id"], e.get("tz") or "UTC", e["reminders"], cc.occurrences(e, frm, to))
        for s in cc.read("schedules", self.root()).values():
            if s.get("reminders"):
                scan(s["id"], s.get("tz") or "UTC", s["reminders"], cc.schedule_occurrences(s, frm, to))
        return out

    def reminders(self) -> int:
        now = self.now()
        p = self.data() / "reminders.json"
        fired: dict[str, str] = cc.state_read(p, {})
        n = 0
        for r in self._due(now):
            if r["key"] in fired:
                continue
            fired[r["key"]] = now.isoformat()
            start = datetime.fromisoformat(r["start"])
            self.alert({"source": "calendar", "severity": "info", "key": f"calendar:{r['key']}", "title": f"{r['title']} at {start.strftime('%I:%M %p').lstrip('0')}"[:200], "link": "view:calendar"})
            n += 1
        if n:
            old = (now - timedelta(days=3)).isoformat()
            cc.state_write(p, {k: v for k, v in fired.items() if v > old})
        return n

    def rsvp_reminders(self) -> int:
        """Automatic chasers: `rsvp.remindHours` before the event, once each, to who hasn't answered."""
        now = self.now()
        p = self.data() / "rsvp-chased.json"
        done: dict[str, str] = cc.state_read(p, {})
        n = 0
        frm, to = now.date().isoformat(), (now.date() + timedelta(days=31)).isoformat()
        for e in cc.read("events", self.root()).values():
            rsvp = e.get("rsvp") or {}
            if not rsvp.get("on") or not e.get("guests") or not rsvp.get("remindHours"):
                continue
            for o in cc.occurrences(e, frm, to)[:1]:
                at = cc.instant(o["start"], e.get("tz") or "UTC")
                for h in rsvp["remindHours"]:
                    key = f"{e['id']}|{o['date']}|{h}"
                    if key not in done and 0 <= (now - (at - timedelta(hours=h))).total_seconds() <= 3600:
                        done[key] = now.isoformat()
                        self.queue_mail(e["id"], "reminder")
                        n += 1
        if n:
            cc.state_write(p, done)
        return n

    def tick(self, mono: Callable[[], float] = time.monotonic) -> None:
        self.reminders()
        self.rsvp_reminders()
        t = mono()
        if hubcall.available("gmail"):
            self.drain()
            if t - self.last_gmail >= GMAIL_EVERY_S:
                self.last_gmail = t
                self.settle_mail()
                self.catch_replies()
        if t - self.last_sync >= SYNC_EVERY_S:
            self.last_sync = t
            self.google.run()

    def loop(self) -> None:
        while True:
            time.sleep(TICK_S)
            try:
                self.tick()
            except hubcall.HubError as e:
                log.warning("calendar: %s", e)
            except Exception:  # noqa: BLE001 — one bad round must not end reminders
                log.exception("calendar round failed")

    def router(self) -> APIRouter:
        r = APIRouter()

        @r.get("/calendar/events")
        def list_events(frm: str = Query("", alias="from"), to: str = "", q: str = "", calendar: str = "") -> dict[str, Any]:
            today = self.now().date()
            a = frm or today.isoformat()
            b = to or (today + timedelta(days=30)).isoformat()
            return {"from": a, "to": b, "occurrences": self.list(a, b, q, calendar)}

        @r.post("/calendar/add")
        def add(fields: dict[str, Any] = Body(...)) -> dict[str, Any]:
            return self.add(fields)

        @r.post("/calendar/update")
        def update(id: str = Body(..., embed=True), fields: dict[str, Any] = Body(..., embed=True)) -> dict[str, Any]:
            return self.update(id, fields)

        @r.delete("/calendar/remove")
        def remove(id: str = Query(...)) -> dict[str, Any]:
            return self.remove(id)

        @r.get("/calendar/calendars")
        def calendars() -> dict[str, Any]:
            return {"calendars": list(cc.read("calendars", self.root()).values())}

        @r.post("/calendar/calendar")
        def calendar_upsert(row: dict[str, Any] = Body(...)) -> dict[str, Any]:
            return self.upsert("calendars", {k: row[k] for k in ("id", "name", "tone", "hidden", "google", "order") if k in row})

        @r.get("/calendar/schedules")
        def schedules() -> dict[str, Any]:
            return {"schedules": list(cc.read("schedules", self.root()).values())}

        @r.post("/calendar/schedule")
        def schedule_upsert(row: dict[str, Any] = Body(...)) -> dict[str, Any]:
            return self.upsert("schedules", {k: row[k] for k in ("id", "name", "calendar", "active", "from", "until", "tz", "reminders", "blocks") if k in row})

        @r.get("/calendar/guests")
        def guests(id: str = Query(...)) -> dict[str, Any]:
            return self.guests(id)

        @r.post("/calendar/mail")
        def mail(id: str = Body(..., embed=True), kind: str = Body("invite", embed=True), guests: list[str] | None = Body(None, embed=True)) -> dict[str, Any]:
            return self.queue_mail(id, kind, guests)

        @r.get("/calendar/google")
        def google() -> dict[str, Any]:
            return self.google.status()

        @r.post("/calendar/google/sync")
        def sync() -> dict[str, Any]:
            return self.google.run()

        return r


TAG_LINE = re.compile(r"^(>|On .* wrote:|-{2,}|_{2,}|From: )")


def first_lines(body: str) -> str:
    """What they typed above the quoted email."""
    out = []
    for line in body.splitlines():
        if TAG_LINE.match(line.strip()):
            break
        out.append(line)
    return "\n".join(out).strip()[:2000]


def answer_in(text: str) -> str:
    m = re.match(r"\W*(yes|yep|yeah|sure|i'?ll be there|no|nope|can'?t make it|maybe|not sure)\b", text.lower())
    if not m:
        return ""
    w = m.group(1)
    return "maybe" if w in ("maybe", "not sure") else "no" if w in ("no", "nope") or w.startswith("can") else "yes"
