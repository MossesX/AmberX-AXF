"""ui-review-item@1 / ui-review-group@1 for the server: the Python copy of framework/core/ui-review-schema.mjs.

Field lists and vocabularies come from framework/schemas/ui-review.json (written by `axf schemas` from the JS
registry), so both copies use one registry; framework/spec/fixtures/ui-review-item.json is the contract both pass
(test.py runs it here, framework/spec/check-ui-review.mjs runs it in JS). Every intake route calls prepare_item and
refuses what fails with a message naming the field.
"""
from __future__ import annotations

import json
import re
import time
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

_REG_FILE = Path(__file__).resolve().parents[5] / "framework" / "schemas" / "ui-review.json"
REGISTRY: dict = json.loads(_REG_FILE.read_text())
ITEM_TAG: str = REGISTRY["item"]
GROUP_TAG: str = REGISTRY["group"]

_ID = re.compile(REGISTRY["idPattern"])
_SECTION = re.compile(REGISTRY["sectionPattern"])
_ISO = re.compile(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:\d{2})$")
_FILE_NAME = re.compile(r"\.(png|jpe?g|webp|gif)$", re.I)
_SLUG_ID = re.compile(r"^[a-z0-9]+(?:[-_.:][a-z0-9]+)+$")
_SUBMITTER = re.compile(r"^(session|build|agent|user):(.+)$")

HINTS = {
    "name": 'every UI Review item needs a human name, e.g. "Breakroom phone check"',
    "createdAt": "an ISO timestamp, e.g. 2026-11-01T08:20:00Z",
    "group": 'a group { id, name } (ask Brett for its name, or let the intake make "<source> - <date time>")',
    "kind": "one of " + ", ".join(REGISTRY["kinds"]),
    "source": "one of " + ", ".join(REGISTRY["sources"]),
    "submittedBy": "{ type: " + "|".join(REGISTRY["submitterTypes"]) + ", id } — the session, build, agent or user sending it",
    "app": 'the app the UI belongs to, e.g. "Console"',
    "screen": 'the screen or route shown, e.g. "Breakroom" or "/settings/plugins"',
    "viewport": "one of " + ", ".join(REGISTRY["viewports"]),
    "files": "{ before: [...], after: [...] } with at least one screenshot",
    "status": "one of " + ", ".join(REGISTRY["statuses"]) + " (review items)",
}


def now_iso() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _blank(v: Any) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _s(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def is_id(v: Any) -> bool:
    return isinstance(v, str) and bool(_ID.match(v))


def is_timestamp(v: Any) -> bool:
    if not isinstance(v, str) or not _ISO.match(v):
        return False
    try:
        datetime.fromisoformat(v.replace("Z", "+00:00"))
        return True
    except ValueError:
        return False


def name_problem(name: Any, id_: Any = None) -> str:
    if not isinstance(name, str) or not name.strip():
        return "missing"
    n = name.strip()
    if len(n) > REGISTRY["maxName"]:
        return f"longer than {REGISTRY['maxName']} characters"
    if not any(ch.isalpha() for ch in n):
        return "has no letters (give it a human name)"
    if _FILE_NAME.search(n):
        return "is a file name (give it a human name)"
    if id_ and n == id_:
        return "is the id (give it a human name)"
    if _SLUG_ID.match(n) and any(ch.isdigit() for ch in n):
        return "looks like an id (give it a human name)"
    return ""


def _e(field: str, code: str, message: str) -> dict:
    return {"field": field, "code": code, "message": message}


def _missing(field: str) -> dict:
    return _e(field, "missing", f"{field} is missing — {HINTS.get(field, 'required')}")


def _bad(field: str, why: str) -> dict:
    hint = HINTS.get(field)
    return _e(field, "invalid", f"{field} {why}" + (f" — {hint}" if hint else ""))


def _file_errors(lst: Any, where: str) -> list[dict]:
    if not isinstance(lst, list):
        return [_bad(f"files.{where}", "must be a list")]
    out = []
    for i, f in enumerate(lst):
        at = f"files.{where}[{i}]"
        if not isinstance(f, dict):
            out.append(_bad(at, "must be { src, name?, viewport? }"))
            continue
        src = f.get("src")
        if _blank(src) or not isinstance(src, str) or len(src) > 300 or re.search(r"[\0\n\r]", src):
            out.append(_e(f"{at}.src", "missing" if _blank(src) else "invalid", f"{at}.src " + ("is missing" if _blank(src) else "is not a file path")))
        if "viewport" in f and f["viewport"] not in REGISTRY["viewports"]:
            out.append(_bad(f"{at}.viewport", f'"{f["viewport"]}" is not a viewport'))
    return out


def validate_group(g: Any, ref: bool = False) -> dict:
    if not isinstance(g, dict):
        return {"ok": False, "errors": [_missing("group")]}
    errors: list[dict] = []
    p = "group." if ref else ""
    if not ref and g.get("$axf") != GROUP_TAG:
        errors.append(_e("$axf", "missing", f'$axf is missing — "{GROUP_TAG}"') if "$axf" not in g else _bad("$axf", f'must be "{GROUP_TAG}"'))
    if _blank(g.get("id")):
        errors.append(_e(f"{p}id", "missing", f"{p}id is missing — the group needs an id"))
    elif not is_id(g.get("id")):
        errors.append(_bad(f"{p}id", f'"{g.get("id")}" must be lowercase letters, digits and - _ . :'))
    np = name_problem(g.get("name"), g.get("id"))
    if np == "missing":
        errors.append(_e(f"{p}name", "missing", f'{p}name is missing — every group needs a human name, e.g. "Breakroom check - Oct 31 8:20 PM"'))
    elif np:
        errors.append(_bad(f"{p}name", np))
    if not ref:
        if _blank(g.get("createdAt")):
            errors.append(_missing("createdAt"))
        elif not is_timestamp(g.get("createdAt")):
            errors.append(_bad("createdAt", f'"{g.get("createdAt")}" is not an ISO timestamp'))
        if _blank(g.get("source")):
            errors.append(_missing("source"))
        elif g.get("source") not in REGISTRY["sources"]:
            errors.append(_bad("source", f'"{g.get("source")}" is not a source'))
    return {"ok": not errors, "errors": errors}


def validate_item(it: Any) -> dict:
    if not isinstance(it, dict):
        return {"ok": False, "errors": [_e("item", "invalid", "the item must be a JSON object")]}
    errors: list[dict] = []
    if it.get("$axf") != ITEM_TAG:
        errors.append(_e("$axf", "missing", f'$axf is missing — "{ITEM_TAG}"') if "$axf" not in it else _bad("$axf", f'must be "{ITEM_TAG}"'))
    if _blank(it.get("id")):
        errors.append(_e("id", "missing", "id is missing"))
    elif not is_id(it.get("id")):
        errors.append(_bad("id", f'"{it.get("id")}" must be lowercase letters, digits and - _ . :'))
    np = name_problem(it.get("name"), it.get("id"))
    if np == "missing":
        errors.append(_missing("name"))
    elif np:
        errors.append(_bad("name", np))
    if it.get("group") is None:
        errors.append(_missing("group"))
    else:
        errors.extend(validate_group(it["group"], ref=True)["errors"])
    if _blank(it.get("createdAt")):
        errors.append(_missing("createdAt"))
    elif not is_timestamp(it.get("createdAt")):
        errors.append(_bad("createdAt", f'"{it.get("createdAt")}" is not an ISO timestamp'))
    for f, vocab in (("kind", "kinds"), ("source", "sources")):
        if _blank(it.get(f)):
            errors.append(_missing(f))
        elif it.get(f) not in REGISTRY[vocab]:
            errors.append(_bad(f, f'"{it.get(f)}" is not a {f}'))
    by = it.get("submittedBy")
    if by is None or by == "":
        errors.append(_missing("submittedBy"))
    elif not isinstance(by, dict):
        errors.append(_bad("submittedBy", "must be an object"))
    else:
        if by.get("type") not in REGISTRY["submitterTypes"]:
            t = by.get("type")
            errors.append(_e("submittedBy.type", "missing" if _blank(t) else "invalid", "submittedBy.type " + ("is missing" if _blank(t) else f'"{t}" is not a submitter type') + " — one of " + ", ".join(REGISTRY["submitterTypes"])))
        if _blank(by.get("id")) or not isinstance(by.get("id"), str):
            errors.append(_e("submittedBy.id", "missing", "submittedBy.id is missing — which session, build, agent or user sent it"))
    for f in ("app", "screen"):
        if _blank(it.get(f)):
            errors.append(_missing(f))
        elif not isinstance(it.get(f), str):
            errors.append(_bad(f, "must be text"))
    if _blank(it.get("viewport")):
        errors.append(_missing("viewport"))
    elif it.get("viewport") not in REGISTRY["viewports"]:
        errors.append(_bad("viewport", f'"{it.get("viewport")}" is not a viewport'))
    files = it.get("files")
    if files is None:
        errors.append(_missing("files"))
    elif not isinstance(files, dict):
        errors.append(_bad("files", "must be { before: [...], after: [...] }"))
    else:
        fe = _file_errors(files.get("before") or [], "before") + _file_errors(files.get("after") or [], "after")
        errors.extend(fe)
        n = sum(len(files.get(k)) for k in ("before", "after") if isinstance(files.get(k), list))
        if not fe and n == 0:
            errors.append(_e("files", "missing", f"files has no screenshots — {HINTS['files']}"))
        if n > REGISTRY["maxFiles"]:
            errors.append(_bad("files", f"has {n} screenshots (at most {REGISTRY['maxFiles']})"))
    if it.get("kind") == "review":
        if _blank(it.get("status")):
            errors.append(_missing("status"))
        elif it.get("status") not in REGISTRY["statuses"]:
            errors.append(_bad("status", f'"{it.get("status")}" is not a status'))
    elif it.get("kind") == "screenshot" and "status" in it:
        errors.append(_bad("status", "is only for review items (screenshots are never approved or rejected)"))
    pr = it.get("pr")
    if pr is not None and not (isinstance(pr, int) and not isinstance(pr, bool) and pr > 0):
        errors.append(_bad("pr", "must be a PR number"))
    sec = it.get("section")
    if sec not in (None, "") and not (isinstance(sec, str) and _SECTION.match(sec)):
        errors.append(_bad("section", "must be lowercase letters, digits and dashes"))
    if it.get("build") is not None and not isinstance(it.get("build"), dict):
        errors.append(_bad("build", "must be { id, step? }"))
    if it.get("updatedAt") not in (None, "") and not is_timestamp(it.get("updatedAt")):
        errors.append(_bad("updatedAt", f'"{it.get("updatedAt")}" is not an ISO timestamp'))
    for f in ("note", "branch", "comment", "pairId"):
        if it.get(f) is not None and not isinstance(it.get(f), str):
            errors.append(_bad(f, "must be text"))
    return {"ok": not errors, "errors": errors}


def rejection(errors: list[dict], tag: str = ITEM_TAG) -> str:
    return f"{tag} rejected: " + "; ".join(e["message"] for e in errors)


class SchemaError(ValueError):
    def __init__(self, errors: list[dict], tag: str = ITEM_TAG):
        super().__init__(rejection(errors, tag))
        self.errors = errors
        self.fields = [e["field"] for e in errors]


# ------------------------------------------------------------------ groups


def stamp(iso: str) -> str:
    try:
        d = datetime.fromisoformat(str(iso).replace("Z", "+00:00"))
    except ValueError:
        return ""
    if d.tzinfo:
        d = d.astimezone(timezone.utc)
    return d.strftime("%Y-%m-%d %H:%M")


def slug(s: Any, n: int = 48) -> str:
    t = unicodedata.normalize("NFKD", str(s or "")).lower()
    t = re.sub(r"[^\w]+|_", "-", t)
    t = re.sub(r"[^a-z0-9-]", "", t).strip("-")[:n].rstrip("-")
    return t or "group"


def group_id(name: str, iso: str) -> str:
    return f"g-{str(iso)[:10].replace('-', '')}-{slug(name)}"


def auto_group_name(source: str = "", session: str = "", now: str = "") -> str:
    who = _s(session, 80) or _s(source, 40) or "UI Review"
    return f"{who} - {stamp(now or now_iso())}"


def make_group(name: str, now: str, source: str, submitted_by: dict | None = None, app: str = "", session: str = "") -> dict:
    n = _s(name, REGISTRY["maxName"]) or auto_group_name(source, session, now)
    g = {"$axf": GROUP_TAG, "id": group_id(n, now), "name": n, "createdAt": now, "source": source}
    if submitted_by:
        g["submittedBy"] = submitted_by
    if app:
        g["app"] = app
    if session:
        g["session"] = session
    return g


# ------------------------------------------------------------------ intake


def parse_submitter(v: Any) -> dict | None:
    if isinstance(v, dict):
        return {**v, "type": _s(v.get("type"), 20), "id": _s(v.get("id"), 120)}
    s = _s(v, 160)
    if not s:
        return None
    m = _SUBMITTER.match(s)
    return {"type": m.group(1), "id": m.group(2).strip()} if m else {"type": "", "id": s}


def _file_of(f: Any) -> Any:
    return {"src": f} if isinstance(f, str) else dict(f) if isinstance(f, dict) else f


def viewport_of(files: dict) -> str:
    v = {f.get("viewport") for f in [*(files.get("before") or []), *(files.get("after") or [])] if isinstance(f, dict) and f.get("viewport")}
    return "" if not v else next(iter(v)) if len(v) == 1 else "mixed"


def prepare_item(raw: Any, now: str | None = None, auto_group: bool = False, session: str = "") -> dict:
    """Mirror of prepareItem: the allowed defaults (createdAt = now, the automatic group), legacy spellings, then
    validation. Returns {ok, item, group, errors}."""
    now = now or now_iso()
    o = dict(raw) if isinstance(raw, dict) else {}
    item = {**o, "$axf": ITEM_TAG}
    if _blank(item.get("name")) and not _blank(o.get("title")):
        item["name"] = _s(o.get("title"), REGISTRY["maxName"])
    item.pop("title", None)
    if isinstance(item.get("name"), str):
        item["name"] = item["name"].strip()
    if "note" not in item and isinstance(o.get("notes"), str):
        item["note"] = o["notes"]
    item.pop("notes", None)
    if _blank(item.get("createdAt")):
        item["createdAt"] = now
    if isinstance(item.get("status"), str) and item["status"] in REGISTRY["statusAliases"]:
        item["status"] = REGISTRY["statusAliases"][item["status"]]
    if item.get("kind") == "review" and "status" not in item:
        item["status"] = "pending"
    by = parse_submitter(o.get("submittedBy"))
    if by:
        item["submittedBy"] = by
    else:
        item.pop("submittedBy", None)
    if o.get("pr") not in (None, ""):
        try:
            n = int(str(o["pr"]).lstrip("#"))
            item["pr"] = n if n > 0 else o["pr"]
        except ValueError:
            item["pr"] = o["pr"]
    else:
        item.pop("pr", None)
    flat = o.get("files") if isinstance(o.get("files"), list) else o.get("shots") if isinstance(o.get("shots"), list) else None
    if flat is not None:
        item["files"] = {"before": [], "after": [_file_of(f) for f in flat]}
    elif isinstance(o.get("files"), dict):
        fo = o["files"]
        item["files"] = {k: [_file_of(f) for f in (fo.get(k) if isinstance(fo.get(k), list) else [])] for k in ("before", "after")}
    item.pop("shots", None)
    if _blank(item.get("viewport")) and isinstance(item.get("files"), dict):
        v = viewport_of(item["files"])
        if v:
            item["viewport"] = v
    g_in = o.get("group")
    at = item["createdAt"] if is_timestamp(item.get("createdAt")) else now
    group = None
    if isinstance(g_in, str) and g_in.strip():
        group = make_group(g_in, at, item.get("source", ""), item.get("submittedBy"), _s(item.get("app"), 80), session)
    elif isinstance(g_in, dict) and not _blank(g_in.get("name")):
        made = make_group(g_in["name"], g_in["createdAt"] if is_timestamp(g_in.get("createdAt")) else at, g_in.get("source") or item.get("source", ""), item.get("submittedBy"), _s(item.get("app"), 80), session)
        group = {**made, **g_in, "$axf": GROUP_TAG, "name": _s(g_in["name"], REGISTRY["maxName"])}
    elif _blank(g_in) and auto_group:
        group = make_group("", now, item.get("source", ""), item.get("submittedBy"), _s(item.get("app"), 80), session or (item.get("submittedBy") or {}).get("id", ""))
    if group:
        if _blank(group.get("id")):
            group["id"] = group_id(group["name"], group["createdAt"])
        item["group"] = {"id": group["id"], "name": group["name"]}
    elif isinstance(g_in, dict):
        item["group"] = g_in
    else:
        item.pop("group", None)
    v = validate_item(item)
    return {"ok": v["ok"], "item": item, "group": group, "errors": v["errors"]}


def require_item(raw: Any, **kw: Any) -> dict:
    """prepare_item, raising SchemaError (a ValueError) naming every missing or bad field."""
    r = prepare_item(raw, **kw)
    if not r["ok"]:
        raise SchemaError(r["errors"])
    return r
