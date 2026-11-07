"""Two-way sync with Google Calendar through axHub's `calendar` service. Runs only for calendars that name a Google
calendar (`google`), and only once the hub has the service; until then the calendar works on its own.

Pull: Google's events in a window become rows (`gcalId`). What changed on Google overwrites the row; a linked event
gone from Google goes here too. Push: a new or edited row goes to Google; the hub may hold the write for Brett's veto, so
the job id is kept in `gcalPending` and read later, and a denied call is never sent again unless the event is edited.
Guests aren't sent to Google (it would email them): invites go through this plugin's own mail.

A repeating event stays on this side: the hub's calendar tools have no recurrence field. Google's repeating events
arrive as single occurrences.
"""
from __future__ import annotations

import copy
import hashlib
import logging
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Callable
from zoneinfo import ZoneInfo

from . import calendar_core as cc, hubcall

log = logging.getLogger("notes-tasks")
BACK_DAYS, AHEAD_DAYS = 30, 180
MAX_PAGES = 5
MAX_WRITES = 10


def _zone(name: str) -> Any:
    try:
        return ZoneInfo(name)
    except (KeyError, ValueError):
        return timezone.utc


def from_google(g: dict[str, Any], tz: str) -> dict[str, Any] | None:
    """A Google event as our fields, in wall-clock time of `tz`. All-day ends are exclusive on Google, inclusive here."""
    s, e = g.get("start") or {}, g.get("end") or {}
    if s.get("date"):
        last = (datetime.fromisoformat(e.get("date") or s["date"]) - timedelta(days=1)).strftime("%Y-%m-%d")
        return {"start": f"{s['date']}T00:00", "end": f"{max(last, s['date'])}T00:00", "allDay": True, "tz": tz}
    if not s.get("dateTime"):
        return None
    zone = tz if not s.get("timeZone") else s["timeZone"]
    z = _zone(zone)
    fmt = "%Y-%m-%dT%H:%M"
    a = datetime.fromisoformat(s["dateTime"].replace("Z", "+00:00")).astimezone(z)
    b = datetime.fromisoformat((e.get("dateTime") or s["dateTime"]).replace("Z", "+00:00")).astimezone(z)
    return {"start": a.strftime(fmt), "end": b.strftime(fmt), "allDay": False, "tz": zone}


def fingerprint(title: str, start: str, end: str, location: str, notes: str) -> str:
    return hashlib.sha256("\x1f".join([title, start, end, location, notes]).encode()).hexdigest()[:24]


def row_hash(r: dict[str, Any]) -> str:
    return fingerprint(r.get("title") or "", r["start"], r["end"], r.get("location") or "", r.get("notes") or "")


def to_google(r: dict[str, Any], gid: str) -> dict[str, Any]:
    body: dict[str, Any] = {"calendarId": gid, "summary": r.get("title") or "", "description": r.get("notes") or "", "location": r.get("location") or ""}
    if r.get("allDay"):
        end = (datetime.fromisoformat(r["end"][:10]) + timedelta(days=1)).strftime("%Y-%m-%d")
        return {**body, "start": r["start"][:10], "end": end}
    return {**body, "start": f"{r['start']}:00", "end": f"{r['end']}:00", "timeZone": r.get("tz") or "UTC"}


def _job_event(result: Any) -> dict[str, Any]:
    return result if isinstance(result, dict) else {}


class Sync:
    def __init__(self, root: Callable[[], Path], now: Callable[[], datetime] = lambda: datetime.now(timezone.utc)) -> None:
        self.root, self.now = root, now
        self.last: dict[str, Any] = {"at": "", "pulled": 0, "pushed": 0, "held": 0, "error": ""}

    def status(self) -> dict[str, Any]:
        linked = [c for c in cc.read("calendars", self.root()).values() if c.get("google")]
        return {"service": hubcall.available("calendar"), "gmail": hubcall.available("gmail"), "linked": [{"id": c.get("id"), "name": c.get("name"), "google": c.get("google")} for c in linked], "last": self.last}

    def _remote(self, gid: str) -> list[dict[str, Any]]:
        n = self.now()
        out: list[dict[str, Any]] = []
        token = ""
        for _ in range(MAX_PAGES):
            args: dict[str, Any] = {"calendarId": gid, "timeMin": (n - timedelta(days=BACK_DAYS)).isoformat(), "timeMax": (n + timedelta(days=AHEAD_DAYS)).isoformat(), "maxResults": 250}
            if token:
                args["pageToken"] = token
            r = hubcall.call("calendar.list", args, "Read Google Calendar", "The calendar's two-way sync.")
            body = r.get("result") or {}
            out += [g for g in body.get("events") or [] if isinstance(g, dict)]
            token = body.get("nextPageToken") or ""
            if not token:
                break
        return out

    def _zone_of(self, gid: str) -> str:
        try:
            cals = (hubcall.call("calendar.calendars", {}, "Read Google calendars", "The calendar's two-way sync.").get("result") or {}).get("calendars") or []
        except hubcall.HubError:
            return "UTC"
        pick = next((c for c in cals if c.get("id") == gid or (gid == "primary" and c.get("primary"))), None)
        return (pick or {}).get("timeZone") or "UTC"

    def _pull(self, cal: dict[str, Any], rows: dict[str, Any]) -> int:
        gid = cal["google"]
        tz = self._zone_of(gid)
        remote = self._remote(gid)
        by_gcal = {r.get("gcalId"): r for r in rows.values() if r.get("gcalId")}
        at = cc.now_iso()
        changed = 0
        seen = set()
        for g in remote:
            gcal = g.get("id")
            local = by_gcal.get(gcal)
            seen.add(gcal)
            if g.get("status") == "cancelled":
                if local:
                    rows.pop(local["id"], None)
                    changed += 1
                continue
            when = from_google(g, tz)
            if not gcal or not when:
                continue
            fields = {"title": g.get("summary") or "(no title)", "location": g.get("location") or "", "notes": g.get("description") or "", **when}
            h = row_hash(fields)
            if not local:
                rid = f"g-{hashlib.sha256(gcal.encode()).hexdigest()[:16]}"
                rows[rid] = {"id": rid, "calendar": cal["id"], **fields, "repeat": None, "except": [], "overrides": {}, "reminders": [], "guests": [], "rsvp": {"on": False, "remindHours": [], "askSeen": False},
                             "gcalId": gcal, "gcalHash": h, "gcalPending": "", "syncedAt": at, "deletedAt": "", "createdAt": at, "updatedAt": at, "by": "google"}
                changed += 1
            elif h != local.get("gcalHash"):
                local.update({**fields, "gcalHash": h, "syncedAt": at, "updatedAt": at})
                changed += 1
        # gone from Google while inside the window it was asked about = deleted there
        n = self.now()
        lo, hi = (n - timedelta(days=BACK_DAYS)).strftime("%Y-%m-%d"), (n + timedelta(days=AHEAD_DAYS - 1)).strftime("%Y-%m-%d")
        for r in list(rows.values()):
            if r.get("calendar") == cal["id"] and r.get("gcalId") and r["gcalId"] not in seen and lo <= r["start"][:10] <= hi and not r.get("deletedAt") and not r.get("gcalPending"):
                rows.pop(r["id"])
                changed += 1
        return changed

    def _settle(self, rows: dict[str, Any]) -> None:
        """Held writes that have an answer now. Each job is read here and nothing is ever re-sent."""
        for r in list(rows.values()):
            jid = r.get("gcalPending")
            if not jid or jid == "denied":
                continue
            j = hubcall.job(jid)
            if j["state"] == "waiting":
                continue
            if r.get("deletedAt") and j["state"] == "done":
                rows.pop(r["id"])
            elif j["state"] == "done":
                gcal = _job_event(j.get("result")).get("id")
                r.update({"gcalPending": "", "gcalId": r.get("gcalId") or gcal or "", "gcalHash": row_hash(r), "syncedAt": cc.now_iso()})
            else:
                r.update({"gcalPending": "denied", "syncedAt": cc.now_iso()})

    def _write(self, r: dict[str, Any], tool: str, args: dict[str, Any], title: str, why: str) -> str:
        out = hubcall.call(tool, args, title, why)
        if out.get("held") or out.get("confirm"):
            r["gcalPending"] = out.get("job") or out.get("confirm") or "denied"
            return "held"
        return "done" if out.get("result") is not None else ""

    def _push(self, cal: dict[str, Any], rows: dict[str, Any]) -> tuple[int, int]:
        gid = cal["google"]
        pushed = held = 0
        for r in list(rows.values()):
            if pushed + held >= MAX_WRITES:
                break
            if r.get("calendar") != cal["id"] or (r.get("gcalPending") and r["gcalPending"] != "denied"):
                continue
            edited_since_denied = r.get("gcalPending") == "denied" and (r.get("updatedAt") or "") > (r.get("syncedAt") or "")
            if r.get("gcalPending") == "denied" and not edited_since_denied:
                continue
            if r.get("deletedAt"):
                if not r.get("gcalId"):
                    rows.pop(r["id"])
                    continue
                state = self._write(r, "calendar.delete", {"calendarId": gid, "eventId": r["gcalId"]}, f"Delete {r.get('title')} from Google Calendar", "Deleted in the calendar; the two-way sync removes it from Google too.")
                if state == "done":
                    rows.pop(r["id"])
            elif r.get("repeat"):
                continue
            elif not r.get("gcalId"):
                out = hubcall.call("calendar.create", to_google(r, gid), f"Add {r.get('title')} to Google Calendar", "Made in the calendar; the two-way sync adds it to Google.")
                if out.get("held") or out.get("confirm"):
                    r["gcalPending"] = out.get("job") or out.get("confirm") or ""
                    state = "held"
                else:
                    r.update({"gcalId": (out.get("result") or {}).get("id") or "", "gcalHash": row_hash(r), "gcalPending": "", "syncedAt": cc.now_iso()})
                    state = "done"
            elif row_hash(r) != r.get("gcalHash"):
                state = self._write(r, "calendar.update", {**to_google(r, gid), "eventId": r["gcalId"]}, f"Update {r.get('title')} on Google Calendar", "Changed in the calendar; the two-way sync updates Google.")
                if state == "done":
                    r.update({"gcalHash": row_hash(r), "gcalPending": "", "syncedAt": cc.now_iso()})
            else:
                continue
            pushed += state == "done"
            held += state == "held"
        return pushed, held

    def run(self) -> dict[str, Any]:
        """One round. Nothing linked, or no service yet = nothing happens."""
        root = self.root()
        cals = [c for c in cc.read("calendars", root).values() if c.get("google")]
        if not cals or not hubcall.available("calendar"):
            return self.last
        rows = cc.read("events", root)
        base = copy.deepcopy(rows)
        res = {"at": cc.now_iso(), "pulled": 0, "pushed": 0, "held": 0, "error": ""}
        try:
            self._settle(rows)
            for c in cals:
                res["pulled"] += self._pull(c, rows)
                p, h = self._push(c, rows)
                res["pushed"] += p
                res["held"] += h
        except hubcall.HubError as e:
            res["error"] = str(e)[:200]
            log.warning("calendar sync: %s", e)
        if rows != base:
            # read again so a row an app wrote during the round isn't lost: only our changes are laid over it
            fresh = cc.read("events", root)
            for k in set(base) | set(rows):
                if rows.get(k) != base.get(k):
                    if k in rows:
                        fresh[k] = rows[k]
                    else:
                        fresh.pop(k, None)
            cc.write("events", fresh, root)
        self.last = res
        return res
