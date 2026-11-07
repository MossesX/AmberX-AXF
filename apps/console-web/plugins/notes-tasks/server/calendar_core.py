"""The calendar's rules the server needs with no browser open (web/calendar/core.ts has all of them; the two must give
the same answers, web/calendar/fixture.json is checked against both). Times are wall-clock strings in the event's `tz`.
"""
from __future__ import annotations

import json
import os
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo

from .migrate import read_table, write_table

FOLDER = "amberx-calendar"
ANSWERS = ("yes", "no", "maybe", "seen")


def calendar_dir() -> Path:
    if os.environ.get("AXF_AMBERX_CALENDAR_DIR"):
        return Path(os.environ["AXF_AMBERX_CALENDAR_DIR"])
    return Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects") / "amberx-axf" / "_data" / FOLDER


def read(name: str, root: Path | None = None) -> dict[str, Any]:
    return read_table(root or calendar_dir(), name)


def write(name: str, rows: dict[str, Any], root: Path | None = None) -> None:
    write_table(root or calendar_dir(), name, rows)


def now_iso() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def _d(s: str) -> date:
    return date.fromisoformat(s[:10])


def _t(s: str) -> datetime:
    return datetime.fromisoformat(s)


def weekday(d: date) -> int:
    """0 = Sunday, as in core.ts."""
    return (d.weekday() + 1) % 7


def _week_start(d: date) -> date:
    return d - timedelta(days=weekday(d))


def _months_on(d: date, n: int) -> date | None:
    i = d.year * 12 + d.month - 1 + n
    try:
        return date(i // 12, i % 12 + 1, d.day)
    except ValueError:  # the 31st repeats on months that have one
        return None


def series_dates(start: str, repeat: dict[str, Any] | None, to: str) -> list[str]:
    first = _d(start)
    end = _d(to)
    if not repeat or not repeat.get("freq"):
        return [first.isoformat()] if first <= end else []
    if repeat.get("until"):
        end = min(end, _d(repeat["until"]))
    cap = repeat.get("count") or 100_000
    step = max(1, int(repeat.get("interval") or 1))
    out: list[str] = []
    if repeat["freq"] == "weekly":
        days = repeat.get("days") or [weekday(first)]
        base = _week_start(first)
        while base <= end and len(out) < cap:
            for dd in days:
                x = base + timedelta(days=dd)
                if first <= x <= end and len(out) < cap:
                    out.append(x.isoformat())
            base += timedelta(days=7 * step)
        return out
    i = 0
    while len(out) < cap and i < 100_000:
        if repeat["freq"] == "daily":
            x: date | None = first + timedelta(days=i)
        else:
            x = _months_on(first, i if repeat["freq"] == "monthly" else i * 12)
            if x is None:
                probe = date(first.year, first.month, 1)
                if _months_on(probe, i if repeat["freq"] == "monthly" else i * 12).isoformat() > end.isoformat():  # type: ignore[union-attr]
                    break
                i += step
                continue
        if x > end:
            break
        out.append(x.isoformat())
        i += step
    return out


def occurrences(e: dict[str, Any], frm: str, to: str) -> list[dict[str, str]]:
    """{date, start, end, title} of an event in a date range, moved occurrences included, removed ones not."""
    if e.get("deletedAt"):
        return []
    length = _t(e["end"]) - _t(e["start"])
    out = []
    moved = e.get("overrides") or {}
    gone = e.get("except") or []
    for d in series_dates(e["start"], e.get("repeat"), to):
        if d in gone or d in moved:
            continue
        s = _t(f"{d}T{e['start'][11:16]}")
        if (s + length).date().isoformat() < frm:
            continue
        out.append({"date": d, "start": s.strftime("%Y-%m-%dT%H:%M"), "end": (s + length).strftime("%Y-%m-%dT%H:%M"), "title": e.get("title") or ""})
    for d, o in moved.items():
        if d not in gone and o["start"][:10] <= to and o["end"][:10] >= frm:
            out.append({"date": d, "start": o["start"], "end": o["end"], "title": o.get("title") or e.get("title") or ""})
    return sorted(out, key=lambda o: o["start"])


def schedule_occurrences(s: dict[str, Any], frm: str, to: str) -> list[dict[str, str]]:
    if s.get("active") is False:
        return []
    a = max(frm, s.get("from") or frm)
    b = min(to, s.get("until") or to)
    out = []
    d = _d(a)
    while d.isoformat() <= b:
        for bl in s.get("blocks") or []:
            if bl.get("day") == weekday(d):
                out.append({"date": d.isoformat(), "start": f"{d.isoformat()}T{bl['start']}", "end": f"{d.isoformat()}T{bl['end']}", "title": bl.get("title") or "", "block": bl.get("id") or ""})
        d += timedelta(days=1)
    return out


def instant(wall: str, tz: str) -> datetime:
    """A wall-clock time in a zone as a real instant. An unknown zone reads as UTC."""
    try:
        zone = ZoneInfo(tz or "UTC")
    except (KeyError, ValueError):
        zone = timezone.utc  # type: ignore[assignment]
    return _t(wall).replace(tzinfo=zone)


def guest_status(guest: dict[str, Any], event_id: str, replies: dict[str, Any]) -> str:
    log = sorted((r for r in replies.values() if r.get("event") == event_id and r.get("guest") == guest.get("id")), key=lambda r: r.get("at") or "")
    answers = [r for r in log if r.get("answer") in ("yes", "no", "maybe")]
    if answers:
        return answers[-1]["answer"]
    return "seen" if any(r.get("answer") == "seen" for r in log) else "invited"


def state_read(p: Path, default: Any) -> Any:
    try:
        return json.loads(p.read_text("utf-8"))
    except (OSError, ValueError):
        return default


def state_write(p: Path, value: Any) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    tmp = p.with_name(f"{p.name}.tmp-{os.getpid()}")
    tmp.write_text(json.dumps(value), "utf-8")
    tmp.replace(p)
