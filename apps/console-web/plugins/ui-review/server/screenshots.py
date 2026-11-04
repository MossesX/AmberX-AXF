"""UI Review → Screenshots (ui-screenshot@1): ad-hoc pictures that are not waiting for a decision.

Check sessions, live captures, PR before/after and Brett's own uploads land here. They never enter the approve / reject
queue (items.json); `promote` copies one in when he wants it reviewed. Mounted by the plugin's router under /shots:

  GET  shots                         every screenshot + the sources registry
  POST shots                         upload: JSON {title?, source?, session?, build?, agent?, app?, screen?, viewport?,
                                     takenAt?, pair?, side?, note?, branch?, pr?, data | files: [{name, data, ...fields}]}
                                     (data = base64 or a data URL), or multipart/form-data (file / files + the same fields)
  GET  shots/file?id=<id>            the picture
  POST shots/update  {id, title?, note?, app?, screen?, source?, viewport?, pair?, side?}
  POST shots/remove  {ids: [..]}
  POST shots/promote {ids: [..], kind?, title?}   send to review: one review item per screenshot (its picture copied)
  POST shots/migrate                 move review items titled "Breakroom check: …" in here (also runs on start)

Groups (shot-group@1): every screenshot belongs to exactly one named, timestamped group. An upload's `group` (a name)
picks the group of that name made the same day (console time zone, AXF_SHOT_TZ, default America/New_York), else makes
it; `groupId` names an existing group; neither = '<session/build/source> - <YYYY-MM-DD HH:mm>'.
  GET  shots                         also lists the groups
  POST shots/groups  {name, source?, session?, build?, agent?, app?, note?}   make (or reuse, same name same day) a group
  POST shots/groups/update  {id, name?, note?, app?}       rename / edit
  POST shots/groups/merge   {from, into}                   from's shots move into into; from goes
  POST shots/groups/delete  {id, into?}                    with into: its shots move there; without: they are deleted
  POST shots/move    {ids: [..], group: <id> | groupName: <name>}   move screenshots into a group (made if new)

Files: <data folder>/screenshots/index.json + screenshots/files/<id>.<ext> (the console data volume).
"""
from __future__ import annotations

import base64
import binascii
import json
import re
import secrets
import shutil
import threading
import os
import time
from datetime import datetime, timedelta, timezone
from email.parser import BytesParser
from email.policy import default as email_policy
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

from . import conform as cf
from .schema import _eastern, local_time as _schema_local_time  # noqa: F401 — _eastern re-exported for the tests

SCHEMA = "ui-screenshot@1"
GROUP_SCHEMA = "ui-review-group@1"  # was shot-group@1 (same fields)
DEFAULT_TZ = "America/New_York"
_GID = re.compile(r"^g-[a-z0-9-]{4,60}$")
# where a screenshot came from: the ui-review-item@1 sources (framework/schemas/ui-review.json), with a label + icon
SOURCES = [
    {"id": "claude-chat", "label": "Claude chat", "icon": "chat"},
    {"id": "claude-voice", "label": "Claude voice", "icon": "mic"},
    {"id": "claude-code", "label": "Claude Code", "icon": "terminal"},
    {"id": "headless", "label": "Headless build", "icon": "hammer"},
    {"id": "agent", "label": "Agent", "icon": "user"},
    {"id": "console", "label": "Console", "icon": "monitor"},
    {"id": "plugin", "label": "Plugin", "icon": "puzzle"},
    {"id": "manual", "label": "Upload", "icon": "upload"},
    {"id": "watch-live", "label": "Watch live", "icon": "eye"},
]
SOURCE_IDS = [x["id"] for x in SOURCES]
MIGRATE_PREFIXES = ["Breakroom check:"]
EDITABLE = ("title", "note", "app", "screen", "source", "viewport", "pair", "side", "session", "build", "agent", "branch", "pr")
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
MAX_SHOT = 20 * 1024 * 1024
MAX_BODY = 64 * 1024 * 1024
_ID = re.compile(r"^[a-z0-9][a-z0-9._-]{0,80}$")
_FILE = re.compile(r"^[a-z0-9][a-z0-9._-]{0,120}\.(png|jpg|jpeg|webp)$")
_lock = threading.Lock()


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _s(v: Any, n: int = 300) -> str:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    return v.strip()[:n] if isinstance(v, str) else ""


def _iso(v: Any) -> str:
    v = _s(v, 40)
    if re.match(r"^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?)?$", v):
        return re.sub(r"\.\d+Z$", "Z", v)
    return ""


def viewport_of(name: str) -> str:
    return "phone" if re.search(r"(^|[-_.\s])phone([-_.\s]|$)", name or "", re.I) else "desktop"


def title_of(name: str) -> str:
    stem = re.sub(r"\.[a-z0-9]+$", "", (name or "").split("/")[-1], flags=re.I)
    stem = re.sub(r"([-_.])(phone|desktop)$", "", stem, flags=re.I)
    t = re.sub(r"[-_]+", " ", stem).strip()
    return t[:1].upper() + t[1:] if t else "Screenshot"


def new_id(now: str | None = None) -> str:
    return f"s-{(now or _now())[:10].replace('-', '')}-{secrets.token_hex(4)}"


def norm_shot(raw: dict, now: str | None = None) -> tuple[dict, list[str]]:
    """Mirror of shots-core.mjs normShot (unknown fields kept)."""
    now = now or _now()
    o = raw if isinstance(raw, dict) else {}
    problems: list[str] = []
    file = _s(o.get("file"), 140)
    if file and not _FILE.match(file):
        problems.append(f'file "{file}" is not a screenshot file name')
    title = _s(o.get("title"), 200) or _s(o.get("name"), 200)  # no name = refused by ui-review-item@1, naming the field
    pr_raw = _s(o.get("pr"), 12).lstrip("#")
    pr = None
    if pr_raw:
        if pr_raw.isdigit() and int(pr_raw) > 0:
            pr = int(pr_raw)
        else:
            problems.append("pr must be a PR number")
    pair = re.sub(r"^-+|-+$", "", re.sub(r"[^a-z0-9._-]+", "-", _s(o.get("pair"), 80).lower()))
    size = o.get("size")
    shot = {
        **o, "$axf": SCHEMA,
        "id": o["id"] if isinstance(o.get("id"), str) and _ID.match(o["id"]) else new_id(now),
        "title": title, "source": _s(o.get("source"), 40),
        "session": _s(o.get("session"), 120), "build": _s(o.get("build"), 120), "agent": _s(o.get("agent"), 80),
        "app": _s(o.get("app"), 80), "screen": _s(o.get("screen"), 200),
        "viewport": o.get("viewport") if o.get("viewport") in ("phone", "desktop") else viewport_of(file or title),
        "takenAt": _iso(o.get("takenAt")) or now, "addedAt": _iso(o.get("addedAt")) or now,
        "pair": pair, "side": o.get("side") if pair and o.get("side") in ("before", "after") else "",
        "note": _s(o.get("note"), 4000), "branch": _s(o.get("branch"), 200), "pr": pr, "by": _s(o.get("by"), 60),
        "file": file, "size": int(size) if isinstance(size, (int, float)) and not isinstance(size, bool) and size > 0 else 0,
        "promoted": [x for x in (o.get("promoted") or []) if isinstance(x, str)][-20:] if isinstance(o.get("promoted"), list) else [],
    }
    return shot, problems


def side_for(shots: list[dict], pair: str, side: str = "") -> str:
    if not pair:
        return ""
    if side in ("before", "after"):
        return side
    return "after" if any(x.get("pair") == pair and x.get("side") == "before" for x in shots) else "before"


# ---- groups (shot-group@1): mirror of web/groups-core.mjs

def _local(at: str, tz: str = "") -> datetime | None:
    """One rule for days and stamps on every port: the schema's local_time (REGISTRY.timeZone, AXF_SHOT_TZ override)."""
    return _schema_local_time(at, tz)


def day_key(at: str, tz: str = "") -> str:
    t = _local(at, tz)
    return t.strftime("%Y-%m-%d") if t else ""


def stamp(at: str, tz: str = "") -> str:
    t = _local(at, tz)
    return t.strftime("%Y-%m-%d %H:%M") if t else ""


def auto_name(by: str, at: str, tz: str = "") -> str:
    return f"{_s(by, 80) or 'Screenshots'} - {stamp(at, tz)}"


def _same(a: Any, b: Any) -> bool:
    return re.sub(r"\s+", " ", _s(a, 200).lower()) == re.sub(r"\s+", " ", _s(b, 200).lower())


def new_group_id(at: str) -> str:
    return f"g-{(_s(at, 10).replace('-', '') or '00000000')}-{secrets.token_hex(4)}"


def norm_group(raw: dict, now: str | None = None) -> dict:
    now = now or _now()
    o = raw if isinstance(raw, dict) else {}
    created = _s(o.get("createdAt"), 40) or now
    return {**o, "$axf": GROUP_SCHEMA, "id": o["id"] if isinstance(o.get("id"), str) and _GID.match(o["id"]) else new_group_id(created),
            "name": _s(o.get("name"), 200) or auto_name(o.get("source"), created), "createdAt": created,
            "source": _s(o.get("source"), 40), "session": _s(o.get("session"), 120), "build": _s(o.get("build"), 120),
            "agent": _s(o.get("agent"), 120), "app": _s(o.get("app"), 80), "note": _s(o.get("note"), 2000)}


def resolve_group(groups: list[dict], opts: dict, at: str | None = None, tz: str = "") -> tuple[dict, bool]:
    """(group, created): same name made the same day = that group; else a new one. No name = the auto name."""
    at = at or _now()
    o = opts if isinstance(opts, dict) else {}
    name = _s(o.get("name"), 200) or auto_name(_s(o.get("session")) or _s(o.get("build")) or _s(o.get("agent")) or _s(o.get("source")), at, tz)
    day = day_key(at, tz)
    for g in groups:
        if isinstance(g, dict) and _same(g.get("name"), name) and day_key(g.get("createdAt", ""), tz) == day:
            return g, False
    meta = {k: o.get(k, "") for k in ("source", "session", "build", "agent", "app", "note")}
    return norm_group({**meta, "id": new_group_id(at), "name": name, "createdAt": at}, at), True


def assign_groups(groups: list[dict], shots: list[dict], tz: str = "") -> tuple[list[dict], list[dict], list[str]]:
    """Every shot without a valid group gets one: bucketed by title prefix ("Breakroom check: Grid" -> "Breakroom check")
    or session / build / source, and day; each bucket = '<prefix> - <YYYY-MM-DD HH:mm of its first shot>'."""
    gs = list(groups)
    ids = {g.get("id") for g in gs}
    loose = sorted((x for x in shots if x.get("group") not in ids), key=lambda x: str(x.get("takenAt") or ""))
    buckets: dict[str, dict] = {}
    for x in loose:
        m = re.match(r"^(.{2,80}?)\s*:\s", _s(x.get("title"), 200))
        label = m.group(1) if m else (x.get("session") or x.get("build") or x.get("agent") or x.get("source") or "Screenshots")
        b = buckets.setdefault(f"{label.lower()}\x01{day_key(x.get('takenAt', ''), tz)}", {"label": label, "first": x, "ids": set()})
        b["ids"].add(x.get("id"))
    made: list[str] = []
    assign: dict[str, str] = {}
    for b in buckets.values():
        f = b["first"]
        at = f.get("takenAt") or _now()
        g = norm_group({"id": new_group_id(at), "name": f"{b['label']} - {stamp(at, tz)}", "createdAt": at, "source": f.get("source", ""),
                        "session": f.get("session", ""), "build": f.get("build", ""), "agent": f.get("agent", ""), "app": f.get("app", ""),
                        "note": "Made when screenshot groups came in."}, at)
        gs.append(g)
        made.append(g["name"])
        for sid in b["ids"]:
            assign[sid] = g["id"]
    return gs, [{**x, "group": assign[x["id"]]} if x.get("id") in assign else x for x in shots], made


def image_type(raw: bytes) -> str:
    if raw.startswith(b"\x89PNG"):
        return "png"
    if raw.startswith(b"\xff\xd8"):
        return "jpg"
    if raw[:4] == b"RIFF" and raw[8:12] == b"WEBP":
        return "webp"
    return ""


class Store:
    """The screenshots of one data folder (the plugin passes data_dir lazily, so tests can point it anywhere)."""

    def __init__(self, data_dir: Callable[[], Path]):
        self._data_dir = data_dir

    @property
    def root(self) -> Path:
        return self._data_dir() / "screenshots"

    @property
    def files(self) -> Path:
        return self.root / "files"

    def stored(self, doc: dict) -> tuple[dict, list[dict]]:
        """Working records → what index.json holds (ui-review-item@1 screenshots, ui-review-group@1 groups) + errors."""
        groups = [cf.group_to_stored(g) for g in doc.get("groups") or [] if isinstance(g, dict)]
        shots, errors = [], []
        for x in doc.get("shots") or []:
            if not isinstance(x, dict):
                continue
            item, errs = cf.shot_to_stored(x, groups)
            shots.append(item)
            errors += [{**e, "message": f"{x.get('id')}: {e['message']}"} for e in errs]
        errors += cf.store_errors([], groups)
        return {**{k: v for k, v in doc.items() if k not in ("shots", "groups")}, "$axf": "ui-screenshots@1", "shots": shots, "groups": groups}, errors

    def _write(self, doc: dict) -> None:
        """Refuses (SchemaError) to write anything that isn't ui-review-item@1 / ui-review-group@1."""
        out, errors = self.stored(doc)
        cf.refuse(errors)
        self.root.mkdir(parents=True, exist_ok=True)
        tmp = self.root / "index.json.tmp"
        tmp.write_text(json.dumps(out, indent=1))
        tmp.replace(self.root / "index.json")

    def doc(self) -> dict:
        try:
            d = json.loads((self.root / "index.json").read_text())
        except (FileNotFoundError, json.JSONDecodeError):
            d = None
        if not isinstance(d, dict) or not isinstance(d.get("shots"), list):
            d = {"$axf": "ui-screenshots@1", "shots": []}
        if not isinstance(d.get("groups"), list):
            d["groups"] = []
        return {**d, "shots": [cf.stored_to_shot(x) for x in d["shots"]]}

    def all(self) -> list[dict]:
        return [x for x in self.doc()["shots"] if isinstance(x, dict)]

    def groups(self) -> list[dict]:
        return [g for g in self.doc()["groups"] if isinstance(g, dict)]

    def group(self, gid: str) -> dict | None:
        return next((g for g in self.groups() if g.get("id") == gid), None)

    def ensure_group(self, opts: dict, at: str | None = None) -> dict:
        """The group for an upload: an existing groupId, else resolve_group by name (made and saved when new)."""
        gid = _s((opts or {}).get("groupId"), 80)
        with _lock:
            doc = self.doc()
            if gid:
                hit = next((g for g in doc["groups"] if isinstance(g, dict) and g.get("id") == gid), None)
                if not hit:
                    raise ValueError(f"no such group: {gid}")
                return hit
            g, created = resolve_group(doc["groups"], {**(opts or {}), "name": (opts or {}).get("group") or (opts or {}).get("name")}, at)
            if created:
                doc["groups"].append(g)
                self._write(doc)
            return g

    def repair(self) -> list[str]:
        """Give every screenshot a group (migration of shots from before groups, and after a bad edit)."""
        with _lock:
            doc = self.doc()
            ids = {g.get("id") for g in doc["groups"] if isinstance(g, dict)}
            if all(not isinstance(x, dict) or x.get("group") in ids for x in doc["shots"]):
                return []
            doc["groups"], doc["shots"], made = assign_groups([g for g in doc["groups"] if isinstance(g, dict)], [x for x in doc["shots"] if isinstance(x, dict)])
            self._write(doc)
            return made

    def update_group(self, gid: str, changes: dict) -> dict:
        with _lock:
            doc = self.doc()
            for i, g in enumerate(doc["groups"]):
                if isinstance(g, dict) and g.get("id") == gid:
                    if "name" in changes and not _s(changes.get("name"), 200):
                        raise ValueError("a name is needed")
                    g2 = norm_group({**g, **{k: changes[k] for k in ("name", "note", "app") if k in changes}})
                    g2["updatedAt"] = _now()
                    doc["groups"][i] = g2
                    self._write(doc)
                    return g2
        raise KeyError(gid)

    def merge_groups(self, src: str, into: str) -> int:
        if src == into:
            raise ValueError("pick two different groups")
        with _lock:
            doc = self.doc()
            have = {g.get("id") for g in doc["groups"] if isinstance(g, dict)}
            if src not in have or into not in have:
                raise KeyError(src if src not in have else into)
            n = 0
            for x in doc["shots"]:
                if isinstance(x, dict) and x.get("group") == src:
                    x["group"] = into
                    n += 1
            doc["groups"] = [g for g in doc["groups"] if not (isinstance(g, dict) and g.get("id") == src)]
            self._write(doc)
            return n

    def move(self, ids: list[str], into: str) -> int:
        with _lock:
            doc = self.doc()
            if not any(isinstance(g, dict) and g.get("id") == into for g in doc["groups"]):
                raise KeyError(into)
            n = 0
            for x in doc["shots"]:
                if isinstance(x, dict) and x.get("id") in ids and x.get("group") != into:
                    x["group"] = into
                    n += 1
            self._write(doc)
            return n

    def delete_group(self, gid: str, into: str = "") -> dict:
        """With into: the shots move there first. Without: the group's screenshots are deleted with it."""
        if into:
            if into == gid:
                raise ValueError("pick another group to keep the screenshots in")
            moved = self.merge_groups(gid, into)
            return {"deleted": gid, "moved": moved, "removed": []}
        if not self.group(gid):
            raise KeyError(gid)
        gone = self.remove([x["id"] for x in self.all() if x.get("group") == gid])
        with _lock:
            doc = self.doc()
            doc["groups"] = [g for g in doc["groups"] if not (isinstance(g, dict) and g.get("id") == gid)]
            self._write(doc)
        return {"deleted": gid, "moved": 0, "removed": gone}

    def get(self, sid: str) -> dict | None:
        return next((x for x in self.all() if x.get("id") == sid), None)

    def path(self, shot: dict) -> Path | None:
        f = shot.get("file") or ""
        if not _FILE.match(f):
            return None
        p = (self.files / f).resolve()
        return p if self.files.resolve() in p.parents and p.is_file() else None

    def add(self, fields: dict, raw: bytes, name: str = "", group: str = "") -> dict:
        """Save one picture + its record in `group` (an id; else the upload's group name / the auto group). Raises
        ValueError on bad fields or a file that isn't PNG / JPEG / WebP."""
        kind = image_type(raw)
        if not kind:
            raise ValueError("screenshots must be PNG, JPEG or WebP")
        if len(raw) > MAX_SHOT:
            raise ValueError("a screenshot is over 20 MB")
        now = _now()
        base = {**fields, "file": None, "size": len(raw), "promoted": [], "addedAt": now}
        if not base.get("viewport") and name:
            base["viewport"] = viewport_of(name)
        base.pop("id", None)
        base.pop("groupId", None)
        group_name = base.pop("group", "")
        shot, problems = norm_shot(base, now)
        if problems:
            raise ValueError("; ".join(problems))
        shot["group"] = group or self.ensure_group({**fields, "group": group_name, "groupId": fields.get("groupId", "")})["id"]
        shot["file"] = f"{shot['id']}.{kind}"
        cf.refuse(cf.shot_to_stored(shot, self.groups())[1])  # nothing written for a refused screenshot
        self.files.mkdir(parents=True, exist_ok=True)
        (self.files / shot["file"]).write_bytes(raw)
        with _lock:
            doc = self.doc()
            shot["side"] = side_for(doc["shots"], shot["pair"], shot["side"])
            doc["shots"].append(shot)
            self._write(doc)
        return shot

    def update(self, sid: str, changes: dict) -> dict:
        with _lock:
            doc = self.doc()
            for i, x in enumerate(doc["shots"]):
                if isinstance(x, dict) and x.get("id") == sid:
                    merged = {**x, **{k: v for k, v in changes.items() if k in EDITABLE}, "group": x.get("group", "")}
                    shot, problems = norm_shot(merged)
                    if problems:
                        raise ValueError("; ".join(problems))
                    shot["addedAt"] = x.get("addedAt") or shot["addedAt"]
                    shot["updatedAt"] = _now()
                    doc["shots"][i] = shot
                    self._write(doc)
                    return shot
        raise KeyError(sid)

    def remove(self, ids: list[str]) -> list[str]:
        gone: list[str] = []
        with _lock:
            doc = self.doc()
            keep = []
            for x in doc["shots"]:
                if isinstance(x, dict) and x.get("id") in ids:
                    p = self.path(x)
                    if p:
                        p.unlink(missing_ok=True)
                    gone.append(x["id"])
                else:
                    keep.append(x)
            doc["shots"] = keep
            self._write(doc)
        return gone

    def mark_promoted(self, sid: str, item_id: str) -> None:
        with _lock:
            doc = self.doc()
            for x in doc["shots"]:
                if isinstance(x, dict) and x.get("id") == sid:
                    x["promoted"] = [*(x.get("promoted") or []), item_id][-20:]
            self._write(doc)

    def migrate(self, read_items: Callable[[], dict], write_items: Callable[[dict], None], item_shots: Path, lock: threading.Lock) -> dict:
        """Review items titled "Breakroom check: …" → screenshots (one per picture); the items and their folders go."""
        moved: list[str] = []
        added: list[str] = []
        with lock:
            items = read_items()
            keep = []
            for it in items.get("items", []):
                title = it.get("title", "") if isinstance(it, dict) else ""
                if not isinstance(it, dict) or str(it.get("id", "")).startswith("pack:") or not any(title.startswith(p) for p in MIGRATE_PREFIXES):
                    keep.append(it)
                    continue
                pics = it.get("shots") if isinstance(it.get("shots"), list) else []
                screen = title.split(":", 1)[-1].strip()
                at0 = it.get("submittedAt") or _now()
                # their group: '<title prefix> - <date time>' (Screenshots' own rule), made once per check item
                gid = self.ensure_group({"group": f"{title.split(':', 1)[0].strip()} - {stamp(at0)}", "source": "claude-code", "build": it.get("build") or "", "app": it.get("app") or "Breakroom"}, at0)["id"]
                for i, p in enumerate(pics):
                    src = p.get("src", "") if isinstance(p, dict) else ""
                    m = re.match(r"^items/([a-z0-9][a-z0-9:._-]{0,80})/([a-z0-9][a-z0-9._-]{0,120})$", src)
                    f = (item_shots / m.group(1) / m.group(2)) if m else None
                    raw = f.read_bytes() if f and f.is_file() else b""
                    if not image_type(raw):
                        continue
                    sid = "s-" + re.sub(r"[^a-z0-9]+", "", str(it.get("id", "")).lower())[-24:] + f"-{i + 1}"
                    if self.get(sid):
                        added.append(sid)
                        continue
                    name = _s(p.get("name"), 120) or title_of(src)
                    shot, _ = norm_shot({
                        "id": sid, "title": f"{title} · {name}" if len(pics) > 1 else title, "source": "claude-code", "submittedBy": {"type": "build", "id": it.get("build") or it.get("branch") or "check"}, "app": it.get("app") or "Breakroom",
                        "screen": name if len(pics) > 1 else screen, "viewport": p.get("device"), "takenAt": it.get("submittedAt"),
                        "session": it.get("build") or it.get("branch") or "", "build": it.get("build") or "", "branch": it.get("branch") or "", "pr": it.get("pr"),
                        "note": "\n".join(x for x in [it.get("notes") or "", f"Moved from UI Review item {it.get('id')}."] if x), "by": ((it.get("history") or [{}])[0] or {}).get("by", "check"),
                        "migratedFrom": it.get("id"), "size": len(raw),
                    })
                    shot["file"] = f"{sid}.{image_type(raw)}"
                    shot["group"] = gid
                    self.files.mkdir(parents=True, exist_ok=True)
                    (self.files / shot["file"]).write_bytes(raw)
                    with _lock:
                        doc = self.doc()
                        doc["shots"].append(shot)
                        self._write(doc)
                    added.append(sid)
                moved.append(str(it.get("id")))
            if moved:
                items["items"] = keep
                write_items(items)
        for x in moved:
            shutil.rmtree(item_shots / x, ignore_errors=True)
        if moved:
            self.root.mkdir(parents=True, exist_ok=True)
            log = self.root / "migrated.json"
            try:
                past = json.loads(log.read_text())
            except (FileNotFoundError, json.JSONDecodeError):
                past = []
            past = past if isinstance(past, list) else []
            log.write_text(json.dumps([*past, {"at": _now(), "items": moved, "shots": added}], indent=1))
        groups = self.repair()  # the moved shots land in '<title prefix> - <their date time>' groups
        return {"moved": moved, "shots": added, "groups": groups}


def _decode(data: str) -> bytes:
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    try:
        return base64.b64decode(data, validate=False)
    except (binascii.Error, ValueError) as e:
        raise HTTPException(400, "data must be base64 or a data URL") from e


def _multipart(content_type: str, body: bytes) -> tuple[dict, list[tuple[str, bytes, dict]]]:
    """Fields + files of a multipart/form-data body (stdlib only: no python-multipart on the console image)."""
    msg = BytesParser(policy=email_policy).parsebytes(b"Content-Type: " + content_type.encode("latin-1") + b"\r\n\r\n" + body)
    if not msg.is_multipart():
        raise HTTPException(400, "not a multipart body")
    fields: dict[str, Any] = {}
    files: list[tuple[str, bytes, dict]] = []
    for part in msg.iter_parts():
        name = part.get_param("name", header="content-disposition") or ""
        filename = part.get_filename()
        payload = part.get_payload(decode=True) or b""
        if filename is not None:
            files.append((filename, payload, {}))
        elif name:
            fields[name] = payload.decode("utf-8", "replace")
    return fields, files


def router_for(store: Store, promote: Callable[[dict, bytes, dict], dict], migrate: Callable[[], dict]) -> APIRouter:
    """The /shots routes. promote(shot, picture bytes, {kind, title}) → the new review item."""
    r = APIRouter()

    def caller(request: Request) -> str:
        u = getattr(request.state, "axf_user", None)
        name = getattr(u, "name", "") or getattr(u, "user", "")
        return name if isinstance(name, str) and name else "console"

    async def body_json(request: Request, limit: int = 65536) -> dict:
        raw = await request.body()
        if len(raw) > limit:
            raise HTTPException(413, "too big")
        try:
            body = json.loads(raw or b"{}")
        except json.JSONDecodeError as e:
            raise HTTPException(400, "not JSON") from e
        if not isinstance(body, dict):
            raise HTTPException(400, "send a JSON object")
        return body

    def ids_of(body: dict) -> list[str]:
        ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")] if body.get("id") else []
        if not ids or len(ids) > 500 or not all(isinstance(x, str) and _ID.match(x) for x in ids):
            raise HTTPException(400, "ids: a list of screenshot ids")
        return ids

    @r.get("/shots")
    def list_shots() -> dict:
        store.repair()
        d = store.stored(store.doc())[0]
        return {"shots": d["shots"], "groups": d["groups"], "sources": SOURCES}

    def gid_of(v: Any, what: str = "id") -> str:
        if not isinstance(v, str) or not _GID.match(v):
            raise HTTPException(400, f"{what}: a group id")
        return v

    @r.post("/shots/groups")
    async def make_group(request: Request) -> dict:
        body = await body_json(request)
        if not _s(body.get("name"), 200):
            raise HTTPException(400, "a name is needed")
        before = {g.get("id") for g in store.groups()}
        g = store.ensure_group({"source": "console", **body, "group": body.get("name"), "groupId": ""})
        return {"ok": True, "group": g, "created": g["id"] not in before}

    @r.post("/shots/groups/update")
    async def update_group(request: Request) -> dict:
        body = await body_json(request)
        try:
            return {"ok": True, "group": store.update_group(gid_of(body.get("id")), body)}
        except KeyError as e:
            raise HTTPException(404, "no such group") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @r.post("/shots/groups/merge")
    async def merge_groups(request: Request) -> dict:
        body = await body_json(request)
        try:
            return {"ok": True, "moved": store.merge_groups(gid_of(body.get("from"), "from"), gid_of(body.get("into"), "into"))}
        except KeyError as e:
            raise HTTPException(404, "no such group") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @r.post("/shots/groups/delete")
    async def delete_group(request: Request) -> dict:
        body = await body_json(request)
        into = gid_of(body.get("into"), "into") if body.get("into") else ""
        try:
            return {"ok": True, **store.delete_group(gid_of(body.get("id")), into)}
        except KeyError as e:
            raise HTTPException(404, "no such group") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @r.post("/shots/move")
    async def move(request: Request) -> dict:
        body = await body_json(request)
        ids = ids_of(body)
        if body.get("group"):
            into = gid_of(body.get("group"), "group")
        elif _s(body.get("groupName"), 200):
            into = store.ensure_group({"group": body["groupName"], "source": "manual", "by": caller(request)})["id"]
        else:
            raise HTTPException(400, "group: a group id, or groupName: a new or today's group")
        try:
            return {"ok": True, "moved": store.move(ids, into), "group": into}
        except KeyError as e:
            raise HTTPException(404, "no such group") from e

    @r.post("/shots")
    async def upload(request: Request) -> dict:
        raw = await request.body()
        if len(raw) > MAX_BODY:
            raise HTTPException(413, "too big (64 MB per upload)")
        ctype = request.headers.get("content-type", "")
        files: list[tuple[str, bytes, dict]] = []
        if ctype.startswith("multipart/form-data"):
            fields, files = _multipart(ctype, raw)
        else:
            try:
                fields = json.loads(raw or b"{}")
            except json.JSONDecodeError as e:
                raise HTTPException(400, "send JSON or multipart/form-data") from e
            if not isinstance(fields, dict):
                raise HTTPException(400, "send a JSON object")
            if isinstance(fields.get("data"), str):
                files.append((_s(fields.get("name"), 120), _decode(fields["data"]), {}))
            for i, f in enumerate(fields.get("files") or [] if isinstance(fields.get("files"), list) else []):
                if not isinstance(f, dict) or not isinstance(f.get("data"), str):
                    raise HTTPException(400, "files: [{name, data, ...fields}]")
                files.append((_s(f.get("name"), 120) or f"shot-{i + 1}.png", _decode(f["data"]), {k: v for k, v in f.items() if k not in ("data", "name")}))
            fields = {k: v for k, v in fields.items() if k not in ("data", "files", "name")}
        if not files:
            raise HTTPException(400, "no picture: send data (base64), files: [...] or a multipart file")
        if len(files) > 40:
            raise HTTPException(400, "at most 40 pictures per upload")
        fields.setdefault("by", caller(request))
        if not fields.get("submittedBy") and fields.get("source") in ("manual", "console"):
            fields["submittedBy"] = {"type": "user", "id": fields["by"]}  # the signed-in user (or console token) uploading
        saved = []
        group = ""
        had = {g.get("id") for g in store.groups()}
        try:
            # one group for the whole upload (named, or '<session/build/source> - <YYYY-MM-DD HH:mm>')
            group = store.ensure_group(fields)["id"]
            for name, data, extra in files:
                saved.append(store.add({**fields, **extra}, data, name, group))
        except ValueError as e:
            store.remove([x["id"] for x in saved])
            if group and group not in had:
                store.delete_group(group)
            raise HTTPException(400, str(e)) from e
        groups = store.groups()
        return {"ok": True, "shots": [cf.shot_to_stored(x, groups)[0] for x in saved], "group": cf.group_to_stored(store.group(group) or {})}

    @r.get("/shots/file")
    def file(id: str = ""):  # noqa: A002 — the query name
        shot = store.get(id) if _ID.match(id or "") else None
        p = store.path(shot) if shot else None
        if not p:
            raise HTTPException(404, "no such screenshot")
        return FileResponse(p, media_type=TYPES[p.suffix[1:].lower()], headers={"Cache-Control": "private, max-age=86400"})

    @r.post("/shots/update")
    async def update(request: Request) -> dict:
        body = await body_json(request)
        sid = body.get("id")
        if not isinstance(sid, str) or not _ID.match(sid):
            raise HTTPException(400, "id: a screenshot id")
        try:
            return {"ok": True, "shot": store.update(sid, body)}
        except KeyError as e:
            raise HTTPException(404, "no such screenshot") from e
        except ValueError as e:
            raise HTTPException(400, str(e)) from e

    @r.post("/shots/remove")
    async def remove(request: Request) -> dict:
        ids = ids_of(await body_json(request))
        return {"ok": True, "removed": store.remove(ids)}

    @r.post("/shots/promote")
    async def send_to_review(request: Request) -> dict:
        body = await body_json(request)
        ids = ids_of(body)
        items = []
        for sid in ids:
            shot = store.get(sid)
            p = store.path(shot) if shot else None
            if not shot or not p:
                raise HTTPException(404, f"no such screenshot: {sid}")
            try:
                item = promote(shot, p.read_bytes(), {"kind": _s(body.get("kind"), 41), "title": _s(body.get("title"), 200) if len(ids) == 1 else "", "by": caller(request)})
            except ValueError as e:
                raise HTTPException(400, str(e)) from e
            store.mark_promoted(sid, item["id"])
            items.append(item)
        return {"ok": True, "items": items}

    @r.post("/shots/migrate")
    def run_migrate() -> dict:
        return {"ok": True, **migrate()}

    return r
