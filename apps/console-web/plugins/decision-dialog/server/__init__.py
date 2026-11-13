"""Decision dialog (server part): one queue of everything waiting for Brett's decision (decision@1).

Brett, Nov 13 2026: "anytime something goes to UI review I'm gonna get a notification, and another type of dialogue
just pops up like approve, for other types of things, an approve deny control panel". Every source that needs him
(UI Review, veto countdowns, confirms, model upgrades, merge clashes, keys needed, passes) raises a decision here; the
console pops the one dialog up on whatever screen he is on, several waiting stack with a counter, and his answer goes
back to the source.

  GET  types                         the decision types (types.json) with their default buttons and pop-up switch
  GET  list?status=waiting&type=     decisions (newest first) + counts; each carries `popup` (should it pop up now)
  GET  item?id=                      one decision
  GET  shot?id=&src=                 a screenshot of the decision, read from its source (handler.shot_file)
  POST raise   {decision@1 fields}   a source raises (or refreshes: same source + ref) a decision
  POST answer  {id, button, option?, note?, by?}   Brett's answer; it is handed to the source's handler capability
  POST later   {id, minutes?}        snooze the pop-up (it stays in the queue and the counter)
  POST withdraw {id} | {source, ref} the source no longer needs it (decided elsewhere, ran out, gone)
  GET  settings / PUT settings {popup: {<type>: bool}, notify: {<type>: bool}, laterMinutes}

Sources answer through capabilities, never folders: a decision names `handler` (e.g. "ui-review@1"); its provider's
`answer_decision(ref, button, option, note, by)` does the work and `shot_file(src)` serves its pictures. A decision
without a handler is answered here only (browser sources run the console action named by the button's `action`).

Capability decisions@1 (plugin_services): raise_decision(fields), withdraw(source, ref), waiting(type?), get(id).
Data folder (AXF_DECISION_DIALOG_DIR): decisions.json, settings.json, answers.jsonl.
"""
from __future__ import annotations

import calendar
import json
import os
import re
import secrets
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import FileResponse

import console_context as cx
import plugin_services

router = APIRouter()
FOLDER = "decision-dialog"
HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[4]
TAG = "decision@1"
STATUSES = ("waiting", "answered", "withdrawn")
KINDS = ("primary", "danger", "neutral")
KEEP_DONE = 200
ALERT_KEY = "decision:"
PICS = {"png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg", "webp": "image/webp"}
_lock = threading.RLock()
_ID = re.compile(r"^[a-z0-9][a-z0-9._:-]{0,99}$")


def data_dir() -> Path:
    return Path(os.environ.get("AXF_DECISION_DIALOG_DIR") or (ROOT / ".axf-console" / "plugins" / FOLDER))


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _s(v: Any, n: int = 300) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def _read(path: Path, default: Any) -> Any:
    try:
        return json.loads(path.read_text())
    except (OSError, ValueError):
        return default


def _write(path: Path, doc: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(doc, indent=1))
    os.chmod(tmp, 0o600)
    tmp.replace(path)


def types() -> dict:
    d = _read(HERE.parent / "types.json", {})
    return d if isinstance(d, dict) else {"types": []}


def _type(tid: str) -> dict:
    return next((t for t in types().get("types") or [] if t.get("id") == tid), {})


DEFAULT_SETTINGS = {"popup": {}, "notify": {}, "laterMinutes": 15}


def settings() -> dict:
    d = _read(data_dir() / "settings.json", {})
    s = {**DEFAULT_SETTINGS, **({k: v for k, v in d.items() if k in DEFAULT_SETTINGS} if isinstance(d, dict) else {})}
    lm = s.get("laterMinutes")
    out: dict = {"popup": {}, "notify": {}, "laterMinutes": lm if isinstance(lm, int) and 1 <= lm <= 24 * 60 else 15}
    for t in types().get("types") or []:
        for k in ("popup", "notify"):
            v = (s.get(k) or {}).get(t["id"]) if isinstance(s.get(k), dict) else None
            out[k][t["id"]] = v if isinstance(v, bool) else t.get(k, True) is not False
    return out


def save_settings(patch: dict) -> dict:
    cur = settings()
    known = {t["id"] for t in types().get("types") or []}
    for k in ("popup", "notify"):
        for tid, v in (patch.get(k) or {}).items() if isinstance(patch.get(k), dict) else []:
            if tid not in known:
                raise ValueError(f'unknown decision type "{tid}"')
            if not isinstance(v, bool):
                raise ValueError(f"{k}.{tid}: true or false")
            cur[k][tid] = v
    if "laterMinutes" in patch:
        m = patch["laterMinutes"]
        if not isinstance(m, int) or isinstance(m, bool) or not 1 <= m <= 24 * 60:
            raise ValueError("laterMinutes: 1 to 1440")
        cur["laterMinutes"] = m
    _write(data_dir() / "settings.json", cur)
    return settings()


def _doc() -> dict:
    d = _read(data_dir() / "decisions.json", {})
    items = d.get("items") if isinstance(d, dict) else None
    return {"$axf": "decisions@1", "items": [x for x in items or [] if isinstance(x, dict)]}


def _save(doc: dict) -> None:
    waiting = [x for x in doc["items"] if x.get("status") == "waiting"]
    done = [x for x in doc["items"] if x.get("status") != "waiting"][-KEEP_DONE:]
    _write(data_dir() / "decisions.json", {"$axf": "decisions@1", "items": waiting + done})


def _shots(raw: Any) -> list[dict]:
    out = []
    for s in raw if isinstance(raw, list) else []:
        if isinstance(s, dict) and _s(s.get("src"), 500):
            dev = s.get("device") if s.get("device") in ("desktop", "phone") else ""
            out.append({"src": _s(s.get("src"), 500), "device": dev, "name": _s(s.get("name"), 120)})
    return out[:12]


def _buttons(raw: Any, tid: str) -> list[dict]:
    src = raw if isinstance(raw, list) and raw else _type(tid).get("buttons") or [{"id": "approve", "label": "Approve", "kind": "primary"}, {"id": "deny", "label": "Deny", "kind": "danger"}]
    out = []
    for b in src:
        if not isinstance(b, dict) or not _ID.match(_s(b.get("id"), 60)):
            continue
        out.append({"id": _s(b["id"], 60), "label": _s(b.get("label"), 60) or b["id"], "kind": b.get("kind") if b.get("kind") in KINDS else "neutral",
                    "note": b.get("note") is True, "action": _s(b.get("action"), 300), "icon": _s(b.get("icon"), 40)})
    return out[:8]


def norm(raw: dict, now: str | None = None) -> tuple[dict, list[str]]:
    """decision@1 from what a source sent; problems in words."""
    now = now or _now()
    problems = []
    tid = _s(raw.get("type"), 40) or "other"
    if not _type(tid):
        problems.append(f'type: unknown "{tid}" (see GET types)')
    title = _s(raw.get("title"), 200)
    if not title:
        problems.append("title: required")
    opts = []
    for i, o in enumerate(raw.get("options") if isinstance(raw.get("options"), list) else []):
        if isinstance(o, dict):
            oid = _s(o.get("id"), 60) or str(i + 1)
            opts.append({"id": oid, "label": _s(o.get("label"), 120) or f"Option {i + 1}", "notes": _s(o.get("notes"), 400), "shots": _shots(o.get("shots"))})
    d = {"$axf": TAG, "id": f"dec-{secrets.token_hex(5)}", "type": tid, "source": _s(raw.get("source"), 60) or tid, "ref": _s(raw.get("ref"), 200),
         "handler": _s(raw.get("handler"), 60), "title": title, "body": _s(raw.get("body"), 2000), "build": _s(raw.get("build"), 120),
         "app": _s(raw.get("app"), 60), "link": _s(raw.get("link"), 500), "openAction": _s(raw.get("openAction"), 300),
         "openLabel": _s(raw.get("openLabel"), 60), "shots": _shots(raw.get("shots")), "options": opts[:9],
         "buttons": _buttons(raw.get("buttons"), tid), "status": "waiting", "createdAt": now, "updatedAt": now, "laterUntil": "", "answer": None}
    return d, problems


def _console_url() -> str:
    return (os.environ.get("AXF_CONSOLE_PUBLIC_URL") or "https://console.amberxai.com").rstrip("/")


def _alert(d: dict) -> None:
    if not settings()["notify"].get(d["type"], True):
        return
    t = _type(d["type"])
    try:
        cx.raise_alert({"source": "decisions", "severity": "warning", "key": ALERT_KEY + d["id"], "title": f"{t.get('label', 'Decision')}: {d['title']}"[:200],
                        "body": (d["body"] or "Waiting for your decision. Tap to open it.")[:300], "link": f"{_console_url()}/?axf-decision={d['id']}",
                        "meta": {"label": "Decision", "decision": d["id"], "type": d["type"]}})
    except Exception as e:  # noqa: BLE001 — a failed notification never fails the source
        cx.log(FOLDER, f"notification failed: {str(e)[:200]}", "warn")


def _unalert(ids: list[str]) -> None:
    if not ids:
        return
    try:
        cx.resolve_alerts([ALERT_KEY + i for i in ids])
    except Exception:  # noqa: BLE001
        pass


def raise_decision(fields: dict) -> dict:
    """Add or refresh (same source + ref while waiting) a decision. ValueError in words when it can't be taken."""
    d, problems = norm(fields)
    if problems:
        raise ValueError("; ".join(problems))
    with _lock:
        doc = _doc()
        old = next((x for x in doc["items"] if x.get("status") == "waiting" and d["ref"] and x.get("source") == d["source"] and x.get("ref") == d["ref"]), None)
        if old:
            d = {**d, "id": old["id"], "createdAt": old["createdAt"], "laterUntil": old.get("laterUntil", "")}
            doc["items"] = [d if x is old else x for x in doc["items"]]
        else:
            doc["items"].append(d)
        _save(doc)
    if not old:
        _alert(d)
    return d


def _later_passed(d: dict, now: float) -> bool:
    lu = d.get("laterUntil")
    if not lu:
        return True
    try:
        return calendar.timegm(time.strptime(lu, "%Y-%m-%dT%H:%M:%SZ")) <= now
    except ValueError:
        return True


def view(d: dict, s: dict | None = None, now: float | None = None) -> dict:
    s = s or settings()
    now = time.time() if now is None else now
    return {**d, "popup": d["status"] == "waiting" and s["popup"].get(d["type"], True) and _later_passed(d, now)}


def listing(status: str = "waiting", tid: str = "") -> dict:
    s = settings()
    now = time.time()
    items = [view(x, s, now) for x in _doc()["items"] if (status == "all" or x.get("status") == status) and (not tid or x.get("type") == tid)]
    items.sort(key=lambda x: x.get("createdAt", ""), reverse=True)
    waiting = [x for x in items if x["status"] == "waiting"]
    counts: dict[str, int] = {}
    for x in waiting:
        counts[x["type"]] = counts.get(x["type"], 0) + 1
    return {"$axf": "decisions@1", "items": items, "waiting": len(waiting), "byType": counts}


def get(did: str) -> dict | None:
    d = next((x for x in _doc()["items"] if x.get("id") == did), None)
    return view(d) if d else None


def resolve_ref(q: str) -> dict | None:
    """'latest' / 'it', a full id, an id prefix or a 1-based place in the waiting queue (voice: 'the second one')."""
    q = (q or "").strip()
    waiting = listing()["items"]
    if q in ("", "latest", "it", "this", "that"):
        return waiting[0] if waiting else None
    if q.isdigit() and 1 <= int(q) <= len(waiting):
        return waiting[int(q) - 1]
    return get(q) or next((x for x in waiting if x["id"].startswith(q)), None)


def answer(did: str, button: str, option: str = "", note: str = "", by: str = "brett", via: str = "console") -> dict:
    d = resolve_ref(did)
    if not d:
        raise LookupError("no such decision")
    if d["status"] != "waiting":
        raise ValueError(f"already {d['status']}")
    b = _s(button, 60).lower()
    opt = _s(option, 60)
    if b in ("pick", "choose") or (not b and opt):
        if not d["options"]:
            raise ValueError("this decision has no options to pick")
        if opt.isdigit() and 1 <= int(opt) <= len(d["options"]) and opt not in [o["id"] for o in d["options"]]:
            opt = d["options"][int(opt) - 1]["id"]
        if opt not in [o["id"] for o in d["options"]]:
            raise ValueError(f'no option "{opt}" (1 to {len(d["options"])})')
        b = "pick"
    elif b not in [x["id"] for x in d["buttons"]]:
        raise ValueError(f'no button "{b}" here: {", ".join(x["id"] for x in d["buttons"])}')
    btn = next((x for x in d["buttons"] if x["id"] == b), {"id": b, "note": False, "action": ""})
    if btn.get("action") and via != "console":
        raise PermissionError(f'"{btn.get("label", b)}" is a tap in the console only: open the decision there (?axf-decision={d["id"]})')
    if btn.get("note") and not _s(note, 2000):
        raise ValueError(f"{btn.get('label', b)} needs a note")
    result: dict = {"ok": True}
    if d.get("handler"):
        svc = plugin_services.get(d["handler"])
        if svc is None or not hasattr(svc, "answer_decision"):
            raise RuntimeError(f"{d['handler']} isn't running, so the answer can't reach it; nothing was decided")
        result = svc.answer_decision(d["ref"], b, opt, _s(note, 2000), by) or {"ok": True}
    at = _now()
    with _lock:
        doc = _doc()
        for i, x in enumerate(doc["items"]):
            if x.get("id") == d["id"]:
                doc["items"][i] = {**x, "status": "answered", "updatedAt": at, "answer": {"button": b, "option": opt, "note": _s(note, 2000), "by": _s(by, 60) or "brett", "via": via, "at": at}}
        _save(doc)
    _unalert([d["id"]])
    try:
        with (data_dir() / "answers.jsonl").open("a") as f:
            f.write(json.dumps({"at": at, "id": d["id"], "type": d["type"], "source": d["source"], "ref": d["ref"], "button": b, "option": opt, "by": by, "via": via}) + "\n")
    except OSError:
        pass
    return {"ok": True, "id": d["id"], "button": b, "option": opt, "action": btn.get("action", ""), "result": result}


def later(did: str, minutes: Any = None) -> dict:
    m = minutes if isinstance(minutes, int) and not isinstance(minutes, bool) and 1 <= minutes <= 24 * 60 else settings()["laterMinutes"]
    until = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() + m * 60))
    with _lock:
        doc = _doc()
        x = next((x for x in doc["items"] if x.get("id") == did and x.get("status") == "waiting"), None)
        if not x:
            raise LookupError("no such waiting decision")
        x["laterUntil"] = until
        _save(doc)
    return {"ok": True, "id": did, "laterUntil": until}


def withdraw(source: str = "", ref: str = "", did: str = "") -> dict:
    gone = []
    with _lock:
        doc = _doc()
        for x in doc["items"]:
            if x.get("status") == "waiting" and ((did and x.get("id") == did) or (ref and x.get("source") == source and x.get("ref") == ref)):
                x.update(status="withdrawn", updatedAt=_now())
                gone.append(x["id"])
        if gone:
            _save(doc)
    _unalert(gone)
    return {"ok": True, "withdrawn": gone}


class DecisionsService:
    """decisions@1 for other plugins: raise one, take it back, read the queue."""

    name = "decisions@1"

    def raise_decision(self, fields: dict) -> dict:
        return raise_decision(fields)

    def withdraw(self, source: str, ref: str) -> dict:
        return withdraw(source, ref)

    def waiting(self, type_id: str = "") -> list[dict]:
        return listing("waiting", type_id)["items"]

    def get(self, did: str) -> dict | None:
        return get(did)


plugin_services.provide("decisions@1", DecisionsService(), FOLDER)


async def _json(request: Request, limit: int = 262144) -> dict:
    raw = await request.body()
    if len(raw) > limit:
        raise HTTPException(413, "body too large")
    try:
        b = json.loads(raw or b"{}")
    except ValueError as e:
        raise HTTPException(400, "JSON body required") from e
    if not isinstance(b, dict):
        raise HTTPException(400, "JSON object required")
    return b


def _http(fn, *a, **k):
    try:
        return fn(*a, **k)
    except LookupError as e:
        raise HTTPException(404, str(e).strip("'\"")) from e
    except ValueError as e:
        raise HTTPException(400, str(e)) from e
    except PermissionError as e:
        raise HTTPException(403, str(e)) from e
    except RuntimeError as e:
        raise HTTPException(409, str(e)) from e


@router.get("/types")
def get_types() -> dict:
    return types()


@router.get("/list")
def get_list(status: str = Query("waiting"), type: str = Query("")) -> dict:  # noqa: A002 — the query name
    return listing(status if status in (*STATUSES, "all") else "waiting", type)


@router.get("/item")
def get_item(id: str = Query("")) -> dict:  # noqa: A002
    d = get(id)
    if not d:
        raise HTTPException(404, "no such decision")
    return d


@router.get("/shot")
async def get_shot(id: str = Query(""), src: str = Query("")):  # noqa: A002
    """A screenshot of a decision, read from its source through the handler capability (shot_file)."""
    d = get(id)
    if not d or not d.get("handler"):
        raise HTTPException(404, "no such decision")
    srcs = {s["src"] for s in d["shots"]} | {s["src"] for o in d["options"] for s in o["shots"]}
    if src not in srcs:
        raise HTTPException(404, "not a screenshot of this decision")
    svc = plugin_services.get(d["handler"])
    f = svc.shot_file(src) if svc is not None and hasattr(svc, "shot_file") else None
    kind = PICS.get(Path(f).suffix[1:].lower()) if f else None
    if not f or not kind:
        raise HTTPException(404, "screenshot gone")
    return FileResponse(f, media_type=kind, headers={"Cache-Control": "private, max-age=86400"})


@router.post("/raise")
async def post_raise(request: Request) -> dict:
    return _http(raise_decision, await _json(request))


@router.post("/answer")
async def post_answer(request: Request) -> dict:
    b = await _json(request)
    return _http(answer, _s(b.get("id"), 100), _s(b.get("button"), 60), _s(str(b.get("option") or ""), 60), _s(b.get("note"), 2000), _s(b.get("by"), 60) or "brett", _s(b.get("via"), 20) or "api")


@router.post("/later")
async def post_later(request: Request) -> dict:
    b = await _json(request)
    return _http(later, _s(b.get("id"), 100), b.get("minutes"))


@router.post("/withdraw")
async def post_withdraw(request: Request) -> dict:
    b = await _json(request)
    if not b.get("id") and not (b.get("source") and b.get("ref")):
        raise HTTPException(400, "id, or source + ref")
    return withdraw(_s(b.get("source"), 60), _s(b.get("ref"), 200), _s(b.get("id"), 100))


@router.get("/settings")
def get_settings() -> dict:
    return settings()


@router.put("/settings")
async def put_settings(request: Request) -> dict:
    return _http(save_settings, await _json(request))
