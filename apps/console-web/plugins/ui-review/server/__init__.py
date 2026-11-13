"""UI Review (server part). Mounted at /api/plugins/ui-review/ (console token on every route, 404 while off).

Every UI a build makes is submitted here for Brett's approval (review-item@1), one section per kind (open registry).

  GET  kinds                  the kinds registry: kinds.json here + kinds.json in the data folder
  GET  items                  submitted items, saved decisions on design packs, the packs index and the picks
  POST submit  {kind, title, app?, build?, branch?, pr?, notes?, shots: [{name, device?, data: base64 | data URL}]}
  POST decide  {ids: [..], decision: approve|changes|reject|reopen, comment?}   one or many (bulk)
  POST remove  {ids: [..]}    take submitted items (and their screenshots) out
  GET  shot?path=r<n>/<file> | items/<id>/<file>    one screenshot (png/jpg/webp)
  GET  picks / PUT picks {picked: [ids]}             design-pack picks (the page allows 3)
  GET  gate / POST gate {on}  "UI Review is a merge gate" (uiReview.gate, default off): {on, heldPrs, openReviews, line};
                              on is Brett's own click only, off is open to everyone (server/gate.py)
  POST release {prs|all, dryRun}  release-held (review.mjs): items nonBlocking (still filed), un-draft, merge queue add; never merges
  POST release/items {prs|all, dryRun}  its UI Review half only
  GET  state?branch=&pr=      ui-review@1: the strictest status of that branch's / PR's items; holds only while the gate is on
  …    settings, predicted, predict, predict/real, approve-look
  …    choices/*                  the options a build shipped, Brett's pick, option assets (ui-choices@1, choices.py)
                              predicted looks (ui-prediction@1, predicted.py): a build's mockup waits here before it runs
  …    shots/*                Screenshots tab (ui-screenshot@1, screenshots.py): ad-hoc pictures that never enter this
                              queue; shots/promote sends one in ("Send to review"), shots/migrate moves "Breakroom check:" items out

Capability ui-review@1 (plugin_services): state(branch, pr), items(branch, pr), submit(fields, shots),
held / hold / holds / isHeld (held only while the gate switch is on, default off), gate_on(), gate().
Data folder (AXF_UI_REVIEW_DIR): items.json, shots/<id>/, picks.json, kinds.json, screenshots/ (index.json + files/). On first start the old Design
packs data folder (its picks) moves in here.
"""
from __future__ import annotations

import base64
import json
import os
import re
import secrets
import shutil
import subprocess
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import FileResponse

import console_context as cx
import plugin_services

from . import conform as cf
from . import schema as S
from .screenshots import Store as ShotStore, resolve_group, router_for as shots_router
from . import screenshots as shots_mod
from . import choices as choices_mod
from . import predicted as predicted_mod
from . import notify
from . import gate as gate_mod

router = APIRouter()
FOLDER = "ui-review"
HERE = Path(__file__).resolve().parent.parent
PACKS = HERE / "packs"
SCHEMA = "review-item@1"
STATUSES = ["waiting", "changes", "rejected", "approved"]
DECISIONS = {"approve": "approved", "changes": "changes", "reject": "rejected", "reopen": "waiting"}
_PACK_SHOT = re.compile(r"^r\d{1,3}/[a-z0-9][a-z0-9-]{0,120}\.(png|jpg|jpeg|webp)$")
_ITEM_SHOT = re.compile(r"^items/([a-z0-9][a-z0-9:._-]{0,80})/([a-z0-9][a-z0-9._-]{0,120}\.(png|jpg|jpeg|webp))$")
_ID = re.compile(r"^[a-z0-9][a-z0-9:._-]{0,80}$")
_KIND = re.compile(r"^[a-z0-9][a-z0-9-]{0,40}$")
_PACK_ID = re.compile(r"^[a-z0-9][a-z0-9-]{0,60}$")
TYPES = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
MAX_SHOT = 8 * 1024 * 1024
MAX_BODY = 48 * 1024 * 1024
_lock = threading.Lock()


def data_dir() -> Path:
    return Path(os.environ.get("AXF_UI_REVIEW_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


def _old_dir() -> Path:
    """Where the Design packs plugin kept its picks before it became UI Review."""
    return Path(os.environ.get("AXF_UI_REVIEW_OLD_DIR") or (data_dir().parent / "design-packs"))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + ".tmp")
    tmp.write_text(json.dumps(doc, indent=1))
    tmp.replace(path)


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (FileNotFoundError, json.JSONDecodeError):
        return default


def migrate() -> dict:
    """Move the old Design packs data folder (picks.json) into this one, once. Safe to call any time."""
    old, new = _old_dir(), data_dir()
    if not old.is_dir() or old.resolve() == new.resolve():
        return {"migrated": False}
    new.mkdir(parents=True, exist_ok=True)
    moved = []
    for f in old.iterdir():
        dest = new / f.name
        if f.is_file() and not dest.exists():
            shutil.copy2(f, dest)
            moved.append(f.name)
    _write(new / "migrated.json", {"from": str(old), "files": moved, "at": _now()})
    shutil.rmtree(old, ignore_errors=True)
    return {"migrated": True, "files": moved}


def _items_doc() -> dict:
    """items.json as working records (+ design-pack decisions as pack:<id> records, + the queue's groups)."""
    d = _read(data_dir() / "items.json", None)
    if not isinstance(d, dict) or not isinstance(d.get("items"), list):
        d = {"$axf": "ui-review-items@1", "items": []}
    packs = [v for v in (d.get("packDecisions") or {}).values() if isinstance(v, dict)]
    return {**d, "groups": [g for g in d.get("groups") or [] if isinstance(g, dict)], "items": [cf.stored_to_review(it) for it in d["items"]] + packs}


def _stored_items(doc: dict) -> tuple[dict, list[dict]]:
    groups = [cf.group_to_stored(g) for g in doc.get("groups") or []]
    items, packs, errors = [], {}, []
    for it in doc["items"]:
        if not isinstance(it, dict):
            continue
        if str(it.get("id", "")).startswith("pack:"):
            packs[it["id"]] = it
            continue
        stored, errs = cf.review_to_stored(it, groups)
        items.append(stored)
        errors += [{**e, "message": f"{it.get('id')}: {e['message']}"} for e in errs]
    errors += cf.store_errors([], groups)
    return {"$axf": "ui-review-items@1", "items": items, "groups": groups, "packDecisions": packs}, errors


def _save_items(doc: dict) -> None:
    """Working records → items.json; refuses (SchemaError, a ValueError) to write anything that isn't ui-review-item@1."""
    out, errors = _stored_items(doc)
    cf.refuse(errors)
    _write(data_dir() / "items.json", out)


def _s(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _device(name: str) -> str:
    return "phone" if re.search(r"(^|[-_.])phone([-_.]|$)", name, re.I) else "desktop"


def _shot_name(file: str) -> str:
    stem = re.sub(r"\.[a-z0-9]+$", "", file.split("/")[-1], flags=re.I)
    stem = re.sub(r"(^|[-_.])(phone|desktop)$", "", stem, flags=re.I)
    s = re.sub(r"[-_]+", " ", stem).strip()
    return s[:1].upper() + s[1:] if s else "Screen"


def _safe_file(name: str, i: int) -> str:
    stem = re.sub(r"[^a-z0-9._-]+", "-", name.lower()).strip("-.") or f"shot-{i + 1}"
    ext = stem.rsplit(".", 1)[-1] if "." in stem else ""
    if ext not in TYPES:
        stem = f"{stem}.png"
    return stem[:120] if stem[0].isalnum() else f"s{stem}"[:120]


def norm_item(raw: dict, now: str | None = None) -> tuple[dict, list[str]]:
    """Mirror of review-core.mjs normItem (unknown fields kept)."""
    now = now or _now()
    o = raw if isinstance(raw, dict) else {}
    problems: list[str] = []
    kind = _s(o.get("kind"), 41) or "other"
    if not _KIND.match(kind):
        problems.append(f'kind "{kind}" must be lowercase letters, digits and dashes')
    title = _s(o.get("title"), 200) or _s(o.get("name"), 200)  # a missing name is refused by ui-review-item@1, naming the field
    pr_raw = o.get("pr")
    pr = None
    if pr_raw not in (None, ""):
        try:
            pr = int(str(pr_raw).lstrip("#"))
            if pr <= 0:
                raise ValueError
        except ValueError:
            problems.append("pr must be a PR number")
            pr = None
    status = o.get("status") if o.get("status") in STATUSES else "waiting"
    item = {**o, "$axf": SCHEMA, "id": o["id"] if isinstance(o.get("id"), str) and _ID.match(o["id"]) else f"r-{now[:10].replace('-', '')}-{secrets.token_hex(4)}",
            "kind": kind, "title": title, "app": _s(o.get("app"), 80), "build": _s(o.get("build"), 120), "branch": _s(o.get("branch"), 200),
            "pr": pr, "notes": _s(o.get("notes"), 4000), "status": status, "comment": _s(o.get("comment"), 2000),
            "source": _s(o.get("source"), 40), "screen": _s(o.get("screen"), 200), "submittedAt": _s(o.get("submittedAt"), 40) or _s(o.get("createdAt"), 40) or now, "updatedAt": now}
    shots = []
    for s in (o.get("shots") or [])[:60]:
        s = {"src": s} if isinstance(s, str) else s
        if isinstance(s, dict) and isinstance(s.get("src"), str) and s["src"]:
            shots.append({**s, "src": s["src"][:300], "device": s.get("device") if s.get("device") in ("phone", "desktop") else _device(s["src"]), "name": _s(s.get("name"), 120) or _shot_name(s["src"])})
    item["shots"] = shots
    hist = o.get("history") if isinstance(o.get("history"), list) else []
    by = o.get("submittedBy")
    item["history"] = hist[-200:] or [{"at": item["submittedAt"], "by": _s(o.get("by"), 60) or _s(by.get("id") if isinstance(by, dict) else by, 60), "action": "submitted", "status": status}]
    item.pop("by", None)
    item.pop("name", None)
    return item, problems


def decide(item: dict, decision: str, comment: str = "", by: str = "brett", at: str | None = None) -> dict:
    status = DECISIONS.get(decision) or (decision if decision in STATUSES else None)
    if not status:
        raise ValueError(f'unknown decision "{decision}"')
    at = at or _now()
    c = _s(comment, 2000)
    line = {"at": at, "by": by, "action": decision if decision in DECISIONS else status, "status": status}
    if c:
        line["comment"] = c
    out = {**item, "status": status, "comment": c or (item.get("comment", "") if status == item.get("status") else ""), "updatedAt": at,
           "history": [*(item.get("history") or []), line][-200:]}
    p = predicted_mod.prediction_of(item)
    if p and p.get("state") == "predicted" and decision in predicted_mod.LOOK_DECISIONS:
        out["prediction"] = predicted_mod.decide_look(p, decision, c, by, at)  # deciding a predicted item = deciding its look
    return out


# The gate switch (Brett, Nov 13 2026: "'UI Review is a merge gate', default OFF"). gate_on() is the one decision every
# hold asks; off = items are filed for Brett to look at and no PR waits. server/gate.py keeps the value.
def gate_on() -> bool:
    return gate_mod.gate_on(data_dir)


def owner_of(request: Request) -> dict | None:
    """Brett's signed-in console session as control@1 sees it (never from a body); None for everyone else."""
    c = plugin_services.get("control@1")
    try:
        return c.owner(request) if c is not None and hasattr(c, "owner") else None
    except Exception:  # noqa: BLE001
        return None


def set_gate(request: Request, on: Any, by: str = "") -> dict:
    user = getattr(request.state, "axf_user", None)
    try:
        return gate_mod.write(data_dir, on, owner=owner_of(request), by=by or str(getattr(user, "name", "") or "console"))
    except gate_mod.GateError as e:
        raise HTTPException({"invalid": 400, "denied": 403}.get(e.code, 503), str(e)) from None


def review_state(items: list[dict], branch: str = "", pr: int | None = None, gate: bool | None = None) -> dict:
    """The strictest review status of a branch's / PR's items. `review` is always that status; `state` is it too while
    the gate is on, and 'filed (not a gate)' while it is off (then nothing holds). An item released with release-held
    (nonBlocking) is still filed and counted, but never holds."""
    on = gate_on() if gate is None else gate
    # a predicted look is approved for the look, not for merging: only real screens count for a branch / PR
    mine = [it for it in items if ((branch and it.get("branch") == branch) or (pr and it.get("pr") == pr)) and (predicted_mod.prediction_of(it) or {}).get("state") != "predicted"]
    c = {k: 0 for k in STATUSES}
    for it in mine:
        if it.get("status") in c:
            c[it["status"]] += 1
    review = "none" if not mine else "rejected" if c["rejected"] else "changes" if c["changes"] else "waiting" if c["waiting"] else "approved"
    blocking = [it for it in mine if it.get("status") in ("waiting", "pending", "changes", "rejected") and not it.get("nonBlocking")]
    holds = bool(on and blocking)
    state = review if on or review == "none" else gate_mod.NOT_A_GATE
    reason = (f"UI Review is a merge gate and this is {review}" if holds else "UI Review is a merge gate; nothing here holds" if on else gate_mod.OFF_LINE)
    return {"$axf": "ui-review@1", "branch": branch, "pr": pr, "state": state, "review": review, "gate": on, "holds": holds, "reason": reason, "counts": c,
            "items": [{"id": it["id"], "title": it.get("title", ""), "kind": it.get("kind", ""), "status": it.get("status", "waiting"), **({"nonBlocking": True} if it.get("nonBlocking") else {})} for it in mine]}


def held_prs(items: list[dict] | None = None, gate: bool | None = None) -> list[dict]:
    """PRs UI Review holds now (empty while the gate is off) and, either way, the PRs with an open review: [{pr, branch,
    review, held}]."""
    on = gate_on() if gate is None else gate
    its = _submitted(_items_doc()) if items is None else items
    out: dict[int, dict] = {}
    for it in its:
        n = it.get("pr")
        if isinstance(n, int) and n > 0 and n not in out:
            st = review_state(its, "", n, on)
            if st["review"] in ("waiting", "changes", "rejected"):
                out[n] = {"pr": n, "branch": it.get("branch", ""), "review": st["review"], "held": st["holds"]}
    return sorted(out.values(), key=lambda x: x["pr"])


def gate_view() -> dict:
    """ui-review-gate@1: {on, heldPrs, openReviews, line, source}; the same object on REST, MCP, the CLI and voice."""
    g = gate_mod.read(data_dir)
    prs = held_prs(gate=g["on"])
    return {"$axf": "ui-review-gate@1", "key": gate_mod.KEY, "label": gate_mod.LABEL, "on": g["on"], "gate": g["on"], "source": g["source"],
            "heldPrs": [p["pr"] for p in prs if p["held"]], "openReviews": prs, "line": gate_mod.line(g["on"]),
            "who": "Anyone may turn it off; only Brett turns it on, with his own click in the console."}


def _submitted(doc: dict) -> list[dict]:
    return [it for it in doc["items"] if isinstance(it, dict) and not str(it.get("id", "")).startswith("pack:")]


def _decode(data: str) -> bytes:
    if data.startswith("data:"):
        data = data.split(",", 1)[-1]
    raw = base64.b64decode(data, validate=False)
    if len(raw) > MAX_SHOT:
        raise HTTPException(413, "a screenshot is over 8 MB")
    if not (raw.startswith(b"\x89PNG") or raw.startswith(b"\xff\xd8") or raw[8:12] == b"WEBP"):
        raise HTTPException(400, "screenshots must be PNG, JPEG or WebP")
    return raw


def submit(fields: dict, shots: list[tuple[str, str, bytes]] | None = None) -> dict:
    """Add one item. shots: (file name, device or '', bytes). Fields may also list shots already in place (src)."""
    """Every field is checked against ui-review-item@1 before a picture is written; refused = SchemaError naming them.
    The group: fields.group (a name: today's group of that name, made if new), else '<session/build/source> - <time>'."""
    now = _now()
    item, problems = norm_item({**fields, "status": "waiting", "history": None, "id": None, "group": None}, now)
    if problems:
        raise ValueError("; ".join(problems))
    if fields.get("choices"):
        item["choices"] = choices_mod.norm_choices(fields["choices"], set_id=f"{choices_mod.slug(item['title'])[:24]}-{item['id'][-8:]}")
    if _s(fields.get("singleOption"), 300):
        item["singleOption"] = _s(fields.get("singleOption"), 300)
    folder = data_dir() / "shots" / item["id"]
    names: list[tuple[str, str, bytes]] = []
    used: set[str] = set()
    for i, (name, device, raw) in enumerate(shots or []):
        fn = _safe_file(name, i)
        while fn in used or (folder / fn).exists():
            fn = f"{i + 1}-{fn}"[:120]
        used.add(fn)
        names.append((fn, device if device in ("phone", "desktop") else _device(name), raw))
    item["shots"] = [{"src": f"items/{item['id']}/{fn}", "device": dev, "name": _shot_name(fn)} for fn, dev, _ in names] + [s for s in item["shots"] if _ITEM_SHOT.match(s["src"]) or _PACK_SHOT.match(s["src"])]
    with _lock:
        doc = _items_doc()
        g, created = resolve_group(doc["groups"], {"name": _s(fields.get("group") if isinstance(fields.get("group"), str) else (fields.get("group") or {}).get("name") if isinstance(fields.get("group"), dict) else "", 200),
                                                   "source": item.get("source", ""), "session": _s(fields.get("groupSession"), 120), "build": item.get("build", ""), "app": item.get("app", "")}, now)
        item["group"] = g["id"]
        item.pop("groupSession", None)
        stored, errors = cf.review_to_stored(item, [*doc["groups"], g])
        cf.refuse(errors)  # nothing written for a refused item
        gap = choices_mod.submission_gap(fields, choices_minimum())
        if gap:
            raise ValueError(gap)
        if created:
            doc["groups"].append(g)
        for fn, _, raw in names:
            folder.mkdir(parents=True, exist_ok=True)
            (folder / fn).write_bytes(raw)
        doc["items"].append(item)
        _save_items(doc)
        snapshot = {"items": list(doc["items"]), "groups": list(doc["groups"])}
    notify.ready(snapshot, g)  # outside the lock: AmberX shows it, a tap opens this group
    return stored


def decide_many(ids: list[str], decision: str, comment: str = "", by: str = "brett") -> dict:
    if decision not in DECISIONS:
        raise ValueError(f'unknown decision "{decision}"')
    at = _now()
    changed: list[str] = []
    with _lock:
        doc = _items_doc()
        by_id = {it.get("id"): i for i, it in enumerate(doc["items"]) if isinstance(it, dict)}
        for x in ids:
            if x in by_id:
                doc["items"][by_id[x]] = decide(doc["items"][by_id[x]], decision, comment, by, at)
                changed.append(x)
            elif x.startswith("pack:") and _PACK_ID.match(x[5:]):
                # a design pack's first decision: its overlay record (status, comment, history)
                doc["items"].append(decide({"id": x, "kind": "design-pack", "status": "waiting", "comment": "", "history": []}, decision, comment, by, at))
                changed.append(x)
        _save_items(doc)
        decided = [doc["items"][by_id[x]] for x in changed if x in by_id]
        snapshot = {"items": list(doc["items"]), "groups": list(doc["groups"])}
    notify.decided(snapshot, [str(it.get("group") or "") for it in decided])
    after_decide(decided)  # Ask changes on a predicted look → the build gets the comment
    return {"changed": changed, "missing": [x for x in ids if x not in changed], "at": at}


def release_items(prs: list[int], dry_run: bool = False, by: str = "release-held") -> dict:
    """release-held, the UI Review half: every open review item of these PRs becomes nonBlocking (still filed, Brett
    still looks, its status unchanged) with a history line. It never approves anything and never merges.
    Answers {dryRun, prs: [{pr, items: [ids], review}]}."""
    at = _now()
    out: list[dict] = []
    with _lock:
        doc = _items_doc()
        for n in prs:
            ids = []
            for i, it in enumerate(doc["items"]):
                if not isinstance(it, dict) or it.get("pr") != n or it.get("nonBlocking"):
                    continue
                if it.get("status") not in ("waiting", "pending", "changes", "rejected") or (predicted_mod.prediction_of(it) or {}).get("state") == "predicted":
                    continue
                ids.append(it.get("id"))
                if not dry_run:
                    hist = list(it.get("history") or [])
                    hist.append({"at": at, "by": by, "action": "released", "comment": "Not a merge gate: still filed for Brett to look at, the PR no longer waits for it."})
                    doc["items"][i] = {**it, "nonBlocking": True, "history": hist, "updatedAt": at}
            out.append({"pr": n, "items": ids, "review": review_state(_submitted(doc), "", n, True)["review"]})
        if not dry_run:
            _save_items(doc)
    return {"dryRun": dry_run, "at": at, "prs": out}


def after_decide(items: list[dict]) -> None:
    """Replaced by predicted.router_for (sends Ask changes comments on predicted looks to their builds)."""


class UiReviewService:
    """ui-review@1 for other plugins. held() / holds() / isHeld() / hold() follow gate_on(): while UI Review is not a
    merge gate (the default) nothing is held; items are still filed."""

    name = "ui-review@1"

    def items(self, branch: str = "", pr: int | None = None) -> list[dict]:
        """The branch's / PR's queue items as ui-review-item@1."""
        its = _stored_items(_items_doc())[0]["items"]
        return [it for it in its if (not branch or it.get("branch") == branch) and (not pr or it.get("pr") == pr)]

    def state(self, branch: str = "", pr: int | None = None) -> dict:
        return review_state(_submitted(_items_doc()), branch, pr)

    def held(self, branch: str = "", pr: int | None = None) -> bool:
        return bool(self.state(branch, pr)["holds"])

    def holds(self, branch: str = "", pr: int | None = None) -> bool:
        return self.held(branch, pr)

    def isHeld(self, branch: str = "", pr: int | None = None) -> bool:  # noqa: N802 — capability method name
        return self.held(branch, pr)

    def hold(self, branch: str = "", pr: int | None = None) -> dict:
        """{held, reason, state, review, gate}."""
        st = self.state(branch, pr)
        return {"held": st["holds"], "reason": st["reason"], "state": st["state"], "review": st["review"], "gate": st["gate"]}

    def gate_on(self) -> bool:
        return gate_on()

    def gate(self) -> dict:
        return gate_view()

    def submit(self, fields: dict, shots: list[tuple[str, str, bytes]] | None = None) -> dict:
        return submit(fields, shots)


shots = ShotStore(data_dir)


def promote_shot(shot: dict, raw: bytes, opts: dict) -> dict:
    """Send to review: a screenshot becomes a normal review item (its picture copied; the screenshot stays)."""
    ext = (shot.get("file") or "x.png").rsplit(".", 1)[-1]
    name = f"{re.sub(r'[^a-z0-9]+', '-', (shot.get('screen') or shot.get('title') or 'screen').lower()).strip('-')[:80] or 'screen'}-{shot.get('viewport') or 'desktop'}.{ext}"
    notes = "\n".join(x for x in [shot.get("note") or "", f"Sent from Screenshots ({shot['id']})."] if x)
    g = shots.group(shot.get("group", "")) or {}
    who = opts.get("by") or ""
    fields = {"kind": opts.get("kind") or "screen", "title": opts.get("title") or shot.get("title"), "app": shot.get("app", ""), "screen": shot.get("screen", ""), "build": shot.get("build", ""),
              "branch": shot.get("branch", ""), "pr": shot.get("pr"), "notes": notes, "source": "console" if who else shot.get("source"),
              "submittedBy": {"type": "user", "id": who} if who else shot.get("submittedBy"), "group": g.get("name", ""), "fromShot": shot["id"]}
    return submit(fields, [(name, shot.get("viewport") or "", raw)])


def migrate_shots() -> dict:
    """Review items titled "Breakroom check: …" (a check session's pictures) move into Screenshots."""
    return shots.migrate(_items_doc, _save_items, data_dir() / "shots", _lock)


def migrate_schema(apply: bool = True) -> dict:
    """Older items + screenshots → ui-review-item@1 (migrate.mjs; dry run with apply=False). The applied report is kept
    as schema-migration.md in the data folder."""
    r = cf.run_migration(data_dir(), apply=apply)
    if r.get("applied") and r.get("changed"):
        try:
            (data_dir() / "schema-migration.md").write_text(r.get("report", ""))
        except OSError:
            pass
    return r


try:
    migrate()
except OSError:
    pass  # a read-only checkout: the page still works, the picks stay where they were
try:
    _schema_migration = migrate_schema(apply=True)
except (OSError, ValueError, subprocess.SubprocessError) as e:  # never keeps the console from starting
    _schema_migration = {"ok": False, "errors": [str(e)]}
try:
    migrate_shots()
except OSError:
    pass
plugin_services.provide("ui-review@1", UiReviewService(), FOLDER)
router.include_router(shots_router(shots, promote_shot, migrate_shots))
import sys as _sys  # noqa: E402
router.include_router(predicted_mod.router_for(_sys.modules[__name__]))
router.include_router(choices_mod.router_for(_sys.modules[__name__]))

# ---------------------------------------------------------------- health@1: every open item's pictures load

HEALTH_ID = "ui-review-shots"
_health_done = False


_load_fails: dict[str, dict] = {}  # src -> {at, reason}: pictures a browser couldn't load (POST shot-failed)
LOAD_FAIL_WINDOW_S = 15 * 60


@router.post("/shot-failed")
async def post_shot_failed(request: Request) -> dict:
    """{src, reason} — a browser couldn't load this picture (timeout, HTTP error); the health check reports it."""
    body = await _json(request)
    src = _s(body.get("src"), 300)
    if not (_ITEM_SHOT.match(src) or _PACK_SHOT.match(src)):
        raise HTTPException(400, "bad screenshot path")
    _load_fails[src] = {"at": time.time(), "reason": _s(body.get("reason"), 120)}
    while len(_load_fails) > 500:
        _load_fails.pop(next(iter(_load_fails)))
    return {"ok": True}


def recent_load_fails(now: float | None = None) -> list[dict]:
    now = now or time.time()
    return [{"src": k, **v} for k, v in list(_load_fails.items()) if now - v["at"] < LOAD_FAIL_WINDOW_S]


def health_probe() -> dict:
    a = shot_audit()
    if not a["broken"]:
        fails = recent_load_fails()
        if fails:
            return {"status": "warn", "summary": f"{len(fails)} UI Review screenshot(s) are on disk but a browser couldn't load them in the last 15 min (console too busy or the request timed out).",
                    "details": [f"{f['src']}: {f['reason'] or 'failed'}" for f in fails[:40]]}
        return {"status": "ok", "summary": f"All {a['checked']} screenshot(s) of the open UI Review items load."}
    names = ", ".join(sorted({b["title"] or b["id"] for b in a["broken"]})[:4])
    return {"status": "error", "summary": f"{len(a['broken'])} screenshot(s) of {len(a['items'])} UI Review item(s) don't load: {names}.",
            "details": [f"{b['id']}: {b['src']}" for b in a["broken"][:40]]}


def ensure_health() -> bool:
    """Registers the check on the systems check once it provides axf.health@1 (plugins load in any order)."""
    global _health_done
    if _health_done:
        return True
    reg = plugin_services.get("axf.health@1")
    if reg is None:
        return False
    try:
        reg.register({"id": HEALTH_ID, "label": "UI Review pictures load", "service": "console", "order": 62, "severity": "error",
                      "run": health_probe,
                      "breaks": "Brett sees UI Review items without their pictures and can't approve them.",
                      "instructions": ["Open UI Review: a broken picture shows 'Shot missing' with Re-capture.",
                                       "On the VPS: `curl -H 'Authorization: Bearer …' …/api/plugins/ui-review/audit` lists them."]}, FOLDER)
    except Exception:  # noqa: BLE001 — UI Review works without its health item
        return False
    _health_done = True
    return True


def _register_later(tries: int = 12) -> None:
    if not ensure_health() and tries > 1:
        t = threading.Timer(5.0, _register_later, args=(tries - 1,))
        t.daemon = True
        t.start()


_register_later()


async def _json(request: Request, limit: int = 65536) -> dict:
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


@router.get("/kinds")
def kinds() -> dict:
    base = _read(HERE / "kinds.json", {}).get("kinds", [])
    extra = _read(data_dir() / "kinds.json", {}).get("kinds", [])
    return {"base": base, "extra": extra if isinstance(extra, list) else []}


@router.get("/items")
def items() -> dict:
    doc = _items_doc()
    overlay = {it["id"]: it for it in doc["items"] if isinstance(it, dict) and str(it.get("id", "")).startswith("pack:")}
    stored = _stored_items(doc)[0]
    return {"items": stored["items"], "groups": stored["groups"], "overlay": overlay, "packs": index(), "picks": get_picks(), "kinds": kinds()}


@router.post("/submit")
async def post_submit(request: Request) -> dict:
    body = await _json(request, MAX_BODY)
    shots = []
    files = body.get("files") if isinstance(body.get("files"), list) else []
    # an option's pictures travel in the option; they join the item's shots as opt-<option id>--<name>
    raw_choices = body.get("choices") if isinstance(body.get("choices"), dict) else None
    for x in (raw_choices or {}).get("options") or []:
        if isinstance(x, dict) and isinstance(x.get("files"), list):
            oid = choices_mod.slug(x.get("id") or x.get("label"))
            files = [*files, *({**f, "name": f"opt-{oid}--{_s(f.get('name'), 90) or 'shot.png'}"} for f in x["files"] if isinstance(f, dict))]
    for i, f in enumerate(files[:60]):
        if not isinstance(f, dict) or not isinstance(f.get("data"), str):
            raise HTTPException(400, "files: [{name, device?, data}]")
        shots.append((_s(f.get("name"), 120) or f"shot-{i + 1}.png", _s(f.get("device"), 10), _decode(f["data"])))
    fields = {k: v for k, v in body.items() if k != "files"}
    if "name" in fields and not fields.get("title"):
        fields["title"] = fields.pop("name")
    try:
        stored = submit(fields, shots)
        save_option_assets(stored, raw_choices)
        return {"ok": True, "item": stored}
    except S.SchemaError as e:
        raise HTTPException(400, str(e)) from e  # names every missing / bad field
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


def save_option_assets(stored: dict, raw: dict | None) -> None:
    """Every option of a set sent through the API is kept as a real asset, picked or not (ui-choices@1)."""
    c = stored.get("choices")
    if not raw or not isinstance(c, dict):
        return
    data = {choices_mod.slug(x.get("id") or x.get("label")): x.get("data") for x in raw.get("options") or [] if isinstance(x, dict)}
    for o in c["options"]:
        a = choices_mod.option_asset(c, o, data.get(o["id"]), str(stored.get("name") or ""))
        _write(data_dir() / "option-assets" / c["owner"] / "assets" / c["assetType"] / f"{a['id']}.json", a)


def choices_minimum() -> int:
    """Replaced by choices.router_for (the setting)."""
    return choices_mod.MIN_OPTIONS


def ask_notice(ask: dict) -> None:
    """How-many-options question: a console alert, pushed to AmberX by its delivery rules; the pop-up reads /choices/asks."""
    try:
        import console_context as cx  # only inside the console
        cx.raise_alert({"source": "ui-review", "key": f"ask-{ask['id']}", "severity": "warning", "title": f"How many options for {ask['build'] or ask['title'] or 'this UI'}?", "body": f"Answer in UI Review, or {ask['default']} get built."})
    except (ImportError, AttributeError):
        pass


@router.post("/migrate")
async def post_migrate(request: Request) -> dict:
    """{apply?: bool} — dry run by default: the report of what the ui-review-item@1 migration would change."""
    body = await _json(request)
    with _lock:
        return migrate_schema(apply=bool(body.get("apply")))


@router.get("/schema")
def get_schema() -> dict:
    """The registry and the last start-up migration (Settings and other tools show it)."""
    return {"registry": S.REGISTRY, "migration": _schema_migration}


@router.post("/decide")
async def post_decide(request: Request) -> dict:
    body = await _json(request)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else [body.get("id")] if body.get("id") else []
    if not ids or not all(isinstance(x, str) and _ID.match(x) for x in ids) or len(ids) > 500:
        raise HTTPException(400, "ids: a list of item ids")
    try:
        return {"ok": True, **decide_many(ids, str(body.get("decision", "")), _s(body.get("comment"), 2000), _s(body.get("by"), 60) or "brett")}
    except ValueError as e:
        raise HTTPException(400, str(e)) from e


@router.post("/remove")
async def post_remove(request: Request) -> dict:
    body = await _json(request)
    ids = body.get("ids") if isinstance(body.get("ids"), list) else []
    if not ids or not all(isinstance(x, str) and _ID.match(x) and not x.startswith("pack:") for x in ids):
        raise HTTPException(400, "ids: submitted item ids (design packs can't be removed here)")
    with _lock:
        doc = _items_doc()
        doc["items"] = [it for it in doc["items"] if it.get("id") not in ids]
        _save_items(doc)
    for x in ids:
        shutil.rmtree(data_dir() / "shots" / x, ignore_errors=True)
    return {"ok": True, "removed": ids}


@router.get("/gate")
def gate() -> dict:
    """'UI Review is a merge gate' (uiReview.gate = Claude setting builds.uiReviewGate, default off): {on, heldPrs,
    openReviews, line}. The same object as review.mjs gate, MCP ui-review_gate_get and the voice action uireview.gate."""
    return gate_view()


@router.post("/gate")
async def post_gate(request: Request) -> dict:
    """{on: bool}. Turning it on is Brett's own click only (personOnly, like the owner-only Claude setting); turning it
    off is open to everyone. Answers the gate object plus {changed}."""
    body = await _json(request, 4096)
    r = set_gate(request, body.get("on"), _s(body.get("by"), 80))
    return {**gate_view(), "changed": r.get("changed", False)}


def _release_prs(body: dict) -> list[int]:
    prs = [int(str(x).lstrip("#")) for x in (body.get("prs") or []) if str(x).lstrip("#").isdigit()]
    if body.get("all") is True:
        prs = sorted(set(prs) | {p["pr"] for p in held_prs(gate=True)})
    if not prs:
        raise HTTPException(400, "send {prs: [PR numbers]} or {all: true}")
    return prs[:100]


@router.post("/release/items")
async def post_release_items(request: Request) -> dict:
    """{prs?: [n], all?: bool, dryRun?: bool}: release-held's UI Review half. The open review items of these PRs become
    non-blocking: still filed, never holding. Open to everyone: it only stops UI Review from holding."""
    body = await _json(request, 8192)
    return release_items(_release_prs(body), body.get("dryRun") is True, _s(body.get("by"), 80) or "release-held")


@router.post("/release")
def post_release(body: dict | None = None) -> dict:
    """{prs?: [n], all?: bool, dryRun?: bool}: release every PR still held for UI Review, the same as review.mjs
    release-held (which this runs): items non-blocking (still filed), the PR un-drafted, then added to the merge queue
    (queue add). Only through the merge queue: it never merges."""
    body = body if isinstance(body, dict) else {}
    prs = _release_prs(body)
    port = os.environ.get("AXF_CONSOLE_PORT", "7090")
    env = {**os.environ, "AXF_CONSOLE_URL": os.environ.get("AXF_CONSOLE_SELF_URL", f"http://127.0.0.1:{port}"), "AXF_TOKEN": os.environ.get("AXF_TOKEN", "")}
    args = ["node", str(HERE / "review.mjs"), "release-held", *[x for n in prs for x in ("--pr", str(n))], "--json"] + (["--dry-run"] if body.get("dryRun") is True else [])
    try:
        r = subprocess.run(args, capture_output=True, text=True, timeout=120, env=env, cwd=str(HERE))
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"release-held could not run: {str(e)[:200]}") from None
    lines = (r.stdout or "").strip().splitlines()
    try:
        return {"ok": r.returncode == 0, **json.loads(lines[-1])}
    except (IndexError, ValueError):
        raise HTTPException(502, f"release-held: {(r.stderr or r.stdout).strip()[-300:]}") from None


@router.get("/state")
def state(branch: str = "", pr: str = "") -> dict:
    p = int(pr.lstrip("#")) if pr.lstrip("#").isdigit() else None
    if not branch and not p:
        raise HTTPException(400, "give a branch or a pr")
    return review_state(_submitted(_items_doc()), branch[:200], p)


def index() -> dict:
    return _read(PACKS / "index.json", {"packs": []})


@router.get("/index")
def get_index() -> dict:
    return index()


def _magic_ok(f: Path) -> bool:
    try:
        with f.open("rb") as fh:
            head = fh.read(12)
    except OSError:
        return False
    return head.startswith(b"\x89PNG") or head.startswith(b"\xff\xd8") or head[8:12] == b"WEBP"


def _item_files(it: dict) -> list[str]:
    files = it.get("files") if isinstance(it.get("files"), dict) else {}
    srcs = [f.get("src") for side in ("before", "after") for f in (files.get(side) or []) if isinstance(f, dict)]
    srcs += [(s.get("src") if isinstance(s, dict) else s) for s in (it.get("shots") or [])]
    return [s for s in srcs if isinstance(s, str) and s]


def shot_audit(statuses: tuple[str, ...] = ("waiting", "pending", "changes")) -> dict:
    """Every screenshot of the open items checked on disk: present, non-empty and a PNG/JPEG/WebP. The health@1 check reads it."""
    base = data_dir() / "shots"
    broken: list[dict] = []
    checked = 0
    for it in _submitted(_items_doc()):
        if it.get("status") not in statuses:
            continue
        for src in _item_files(it):
            checked += 1
            m = _ITEM_SHOT.match(src)
            f = base / m.group(1) / m.group(2) if m else (PACKS / src if _PACK_SHOT.match(src) else None)
            if f is None or not f.is_file() or f.stat().st_size == 0 or not _magic_ok(f):
                broken.append({"id": it.get("id"), "title": it.get("name") or it.get("title") or "", "src": src})
    return {"checked": checked, "broken": broken, "items": sorted({b["id"] for b in broken})}


@router.get("/audit")
def get_audit() -> dict:
    return {"ok": True, **shot_audit()}


@router.post("/recapture")
async def post_recapture(request: Request) -> dict:
    """{id | src} — hand a re-capture of that item's screen to the agent who owns the ui-screenshots job (agent-job.mjs)."""
    body = await _json(request)
    src = _s(body.get("src"), 300)
    m = _ITEM_SHOT.match(src) if src else None
    iid = m.group(1) if m else _s(body.get("id"), 80)
    it = next((x for x in _submitted(_items_doc()) if x.get("id") == iid), None)
    if not it:
        raise HTTPException(404, "no such item")
    g = it.get("group")
    group = g.get("name", "") if isinstance(g, dict) else ""
    inputs = {"app": it.get("app") or "console-web", "screen": it.get("screen") or "home",
              "name": f"Re-capture for UI Review item {iid}: {it.get('name') or it.get('title') or ''}"[:300], "groupName": group}
    cli = cx.ROOT / "framework" / "cli" / "agent-job.mjs"
    args = ["node", str(cli), "ui-screenshots", *[x for k, v in inputs.items() for x in ("--input", f"{k}={v}")], "--json"]
    try:
        proc = subprocess.run(args, cwd=cx.ROOT, capture_output=True, text=True, timeout=90)
    except (OSError, subprocess.TimeoutExpired) as e:
        raise HTTPException(503, f"couldn't start the re-capture: {e}") from e
    out = proc.stdout.strip().splitlines()
    try:
        res = json.loads(out[-1]) if out else {}
    except json.JSONDecodeError:
        res = {}
    if proc.returncode == 3:
        return {"ok": False, "unassigned": True, "message": "Nobody owns the UI Review screenshots job yet: hire one in Breakroom → Jobs."}
    if proc.returncode != 0:
        return {"ok": False, "message": (res.get("error") if isinstance(res, dict) else "") or (proc.stderr or proc.stdout).strip()[-400:] or "re-capture failed"}
    return {"ok": True, "item": iid, "job": res, "message": "Re-capture handed to the screenshots agent; the new pictures land in its group."}


@router.get("/shot")
async def shot(path: str = ""):
    """async on purpose: served on the event loop, never queued behind slow sync routes in the threadpool."""
    if _PACK_SHOT.match(path):
        base, f = PACKS, PACKS / path
    else:
        m = _ITEM_SHOT.match(path)
        if not m:
            raise HTTPException(400, "bad screenshot path")
        base = data_dir() / "shots"
        f = base / m.group(1) / m.group(2)
    f = f.resolve()
    if base.resolve() not in f.parents or not f.is_file():
        raise HTTPException(404, "no such screenshot")
    return FileResponse(f, media_type=TYPES[f.suffix[1:].lower()], headers={"Cache-Control": "private, max-age=86400"})


@router.get("/picks")
def get_picks() -> dict:
    d = _read(data_dir() / "picks.json", None)
    return d if isinstance(d, dict) and isinstance(d.get("picked"), list) else {"picked": [], "at": ""}


@router.put("/picks")
async def put_picks(request: Request) -> dict:
    body = await _json(request, 8192)
    picked = body.get("picked")
    if not isinstance(picked, list) or len(picked) > 12 or not all(isinstance(x, str) and _PACK_ID.match(x) for x in picked):
        raise HTTPException(400, "picked must be a list of up to 12 pack ids")
    doc = {"picked": picked, "at": _now()}
    with _lock:
        _write(data_dir() / "picks.json", doc)
    return {"ok": True, **doc}
