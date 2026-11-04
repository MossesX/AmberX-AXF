"""The boundary between UI Review's working records and what it stores and serves (ui-review-item@1 /
ui-review-group@1): the Python copy of web/conform.mjs. Both stores (items.json, screenshots/index.json) read through
stored_to_* and write through *_to_stored + refuse(), so nothing that fails the schema is ever written.

The migration of older data folders is one implementation (migrate.mjs, run through node, which the console image
ships): run_migration() calls it, the server runs it on start, POST /migrate {apply?} runs it on demand.
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
from pathlib import Path
from typing import Any

from . import schema as S

HERE = Path(__file__).resolve().parent.parent
STATUS_IN = {"waiting": "pending"}
STATUS_OUT = {"pending": "waiting"}
WORK_STATUSES = ["waiting", "changes", "rejected", "approved"]


def _s(v: Any, n: int = 300) -> str:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        v = str(v)
    return v.strip()[:n] if isinstance(v, str) else ""


def _pr(v: Any) -> int | None:
    try:
        n = int(str(v if v is not None else "").lstrip("#"))
        return n if n > 0 else None
    except ValueError:
        return None


def _drop(o: dict) -> dict:
    return {k: v for k, v in o.items() if v is not None and v != ""}


def submitter_of(o: dict) -> dict | None:
    by = S.parse_submitter(o.get("submittedBy"))
    if by and by.get("type") and by.get("id"):
        return by
    for k, t in (("session", "session"), ("agent", "agent"), ("build", "build")):
        if _s(o.get(k)):
            return {"type": t, "id": _s(o.get(k), 120)}
    if _s(o.get("by")):
        return {"type": "user" if o.get("by") == "brett" or o.get("source") in ("manual", "console") else "build", "id": _s(o.get("by"), 120)}
    return by


def _group_ref(gid: Any, groups: list[dict]) -> dict | None:
    g = next((x for x in groups if isinstance(x, dict) and x.get("id") == gid), None)
    return {"id": g["id"], "name": g.get("name")} if g else ({"id": gid} if gid else None)


def _viewport(files: list[dict]) -> str:
    v = {f.get("viewport") for f in files if f.get("viewport")}
    return "" if not v else next(iter(v)) if len(v) == 1 else "mixed"


# ------------------------------------------------------------------ review items

def review_to_stored(r: dict, groups: list[dict]) -> tuple[dict, list[dict]]:
    shots = r.get("shots") if isinstance(r.get("shots"), list) else []
    extra = {k: v for k, v in r.items() if k not in ("$axf", "kind", "title", "shots", "notes", "status", "submittedAt", "group", "groupName", "groupSession", "build", "step", "by", "pr", "name")}
    after = [_drop({"src": x.get("src"), "name": x.get("name"), "viewport": x.get("device")}) for x in shots if isinstance(x, dict)]
    item = _drop({
        **extra, "$axf": S.ITEM_TAG, "id": r.get("id"), "name": _s(r.get("title"), S.REGISTRY["maxName"]), "group": _group_ref(r.get("group"), groups),
        "createdAt": r.get("submittedAt") or r.get("createdAt"), "kind": "review", "section": _s(r.get("kind"), 41) or "other", "source": r.get("source"),
        "submittedBy": submitter_of(r), "app": _s(r.get("app"), 80), "screen": _s(r.get("screen"), 200), "viewport": _viewport(after) or None,
        "files": {"before": [], "after": after}, "status": STATUS_IN.get(r.get("status"), r.get("status")), "note": r.get("notes") or None, "pr": _pr(r.get("pr")),
        "build": _drop({"id": _s(r.get("build"), 120), "step": _s(r.get("step"), 80)}) if _s(r.get("build")) else None,
    })
    item["comment"] = r.get("comment") or ""
    return item, S.validate_item(item)["errors"]


def stored_to_review(it: Any) -> Any:
    if not isinstance(it, dict) or it.get("$axf") != S.ITEM_TAG:
        return it
    files = [*(it.get("files") or {}).get("before", []), *(it.get("files") or {}).get("after", [])]
    out = {**it, "$axf": "review-item@1", "kind": it.get("section") or "other", "title": it.get("name"),
           "shots": [{"src": f.get("src"), "device": f.get("viewport") or "desktop", "name": f.get("name") or f.get("src")} for f in files if isinstance(f, dict)],
           "notes": it.get("note") or "", "status": STATUS_OUT.get(it.get("status"), it.get("status") if it.get("status") in WORK_STATUSES else "waiting"),
           "submittedAt": it.get("createdAt"), "group": (it.get("group") or {}).get("id", ""), "groupName": (it.get("group") or {}).get("name", ""),
           "build": (it.get("build") or {}).get("id", ""), "step": (it.get("build") or {}).get("step", ""), "pr": it.get("pr")}
    for k in ("name", "files", "note", "createdAt", "section"):
        out.pop(k, None)
    return out


# ------------------------------------------------------------------ screenshots

def shot_to_stored(x: dict, groups: list[dict]) -> tuple[dict, list[dict]]:
    extra = {k: v for k, v in x.items() if k not in ("$axf", "title", "takenAt", "file", "group", "groupName", "pair", "side", "build", "pr", "by", "name", "status")}
    item = _drop({
        **extra, "$axf": S.ITEM_TAG, "id": x.get("id"), "name": _s(x.get("title"), S.REGISTRY["maxName"]), "group": _group_ref(x.get("group"), groups),
        "createdAt": x.get("takenAt") or x.get("createdAt"), "kind": "screenshot", "source": x.get("source"), "submittedBy": submitter_of(x),
        "app": _s(x.get("app"), 80), "screen": _s(x.get("screen"), 200), "viewport": x.get("viewport"),
        "files": {"before": [], "after": [_drop({"src": x.get("file"), "viewport": x.get("viewport")})] if x.get("file") else []},
        "pairId": _s(x.get("pair"), 80) or None, "side": x.get("side") if x.get("pair") else None, "pr": _pr(x.get("pr")),
        "build": {"id": _s(x.get("build"), 120)} if _s(x.get("build")) else None, "by": _s(x.get("by"), 60) or None,
    })
    return item, S.validate_item(item)["errors"]


def stored_to_shot(it: Any) -> Any:
    if not isinstance(it, dict) or it.get("$axf") != S.ITEM_TAG:
        return it
    files = it.get("files") or {}
    f = ((files.get("after") or []) + (files.get("before") or []) or [{}])[0]
    by = it.get("submittedBy") or {}
    out = {**it, "$axf": "ui-screenshot@1", "title": it.get("name"), "takenAt": it.get("createdAt"), "file": f.get("src", ""), "group": (it.get("group") or {}).get("id", ""),
           "groupName": (it.get("group") or {}).get("name", ""), "pair": it.get("pairId", ""), "side": it.get("side", ""), "build": (it.get("build") or {}).get("id", ""),
           "pr": it.get("pr"), "session": it.get("session", by.get("id") if by.get("type") == "session" else ""), "agent": it.get("agent", by.get("id") if by.get("type") == "agent" else ""),
           "by": it.get("by", ""), "note": it.get("note", ""), "addedAt": it.get("addedAt", it.get("createdAt")), "promoted": it.get("promoted") if isinstance(it.get("promoted"), list) else [],
           "size": it.get("size", 0)}
    for k in ("name", "files", "createdAt", "pairId", "kind"):
        out.pop(k, None)
    return out


# ------------------------------------------------------------------ groups + checks

def group_to_stored(g: dict) -> dict:
    return _drop({**g, "$axf": S.GROUP_TAG})


def store_errors(items: list[dict], groups: list[dict]) -> list[dict]:
    out = []
    for g in groups:
        out += [{**e, "message": f"group {g.get('id', '?')}: {e['message']}"} for e in S.validate_group(g)["errors"]]
    ids = {g.get("id") for g in groups}
    for it in items:
        out += [{**e, "message": f"{it.get('id', '?')}: {e['message']}"} for e in S.validate_item(it)["errors"]]
        gid = (it.get("group") or {}).get("id") if isinstance(it.get("group"), dict) else None
        if gid and groups and gid not in ids:
            out.append({"field": "group.id", "code": "invalid", "message": f"{it.get('id')}: group.id \"{gid}\" is not a known group"})
    return out


def refuse(errors: list[dict]) -> None:
    if errors:
        raise S.SchemaError(errors)


def run_migration(data_dir: Path, apply: bool = False, timeout: int = 60) -> dict:
    """migrate.mjs through node: {ok, applied, changed, rows, errors, report, backups}. A folder with nothing to change
    (or no data yet) returns changed 0 without starting node."""
    files = [data_dir / "items.json", data_dir / "screenshots" / "index.json"]
    if not any(f.is_file() for f in files):
        return {"ok": True, "applied": False, "changed": 0, "rows": [], "errors": [], "report": "no data yet", "backups": []}
    if all(_conforms(f) for f in files):
        return {"ok": True, "applied": False, "changed": 0, "rows": [], "errors": [], "report": "Nothing to change: every item, screenshot and group already conforms.", "backups": []}
    node = shutil.which("node")
    if not node:
        return {"ok": False, "applied": False, "changed": 0, "rows": [], "errors": ["node is not installed: run review.mjs migrate --apply where it is"], "report": "", "backups": []}
    env = {**os.environ, "AXF_UI_REVIEW_DIR": str(data_dir)}
    args = [node, str(HERE / "review.mjs"), "migrate", "--json"] + (["--apply"] if apply else [])
    p = subprocess.run(args, capture_output=True, text=True, env=env, timeout=timeout, check=False)
    try:
        return json.loads(p.stdout.strip().splitlines()[-1])
    except (json.JSONDecodeError, IndexError):
        return {"ok": False, "applied": False, "changed": 0, "rows": [], "errors": [(p.stderr or p.stdout or "migrate.mjs gave no answer").strip()[-400:]], "report": "", "backups": []}


def _conforms(f: Path) -> bool:
    """True when the file is missing or every record in it already is ui-review-item@1 / ui-review-group@1."""
    try:
        d = json.loads(f.read_text())
    except FileNotFoundError:
        return True
    except json.JSONDecodeError:
        return False
    recs = [x for x in (d.get("items") or d.get("shots") or []) if isinstance(x, dict) and not str(x.get("id", "")).startswith("pack:")]
    if any(isinstance(x, dict) and str(x.get("id", "")).startswith("pack:") for x in d.get("items") or []):
        return False
    return all(S.validate_item(x)["ok"] for x in recs) and all(S.validate_group(g)["ok"] for g in d.get("groups") or [])
