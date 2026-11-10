"""UI Review choices (ui-choices@1, framework/core/ui-choices.mjs is the reference): the options a build ships for one
UI, Brett's pick in priority order, every option kept as an asset, and asking him how many options to build.

  GET  choices/settings                     {minOptions, askOptions, askTimeoutMin}
  PUT  choices/settings {…}                 minOptions never goes under 3
  POST choices/choose {id, chosen: [ids], comment?}   his pick, in priority order; the item is approved and the build goes on
  GET  choices/decision?id=<item>           {status, chosen, default, decided}; the build waits on it like any hold
  GET  choices/assets?type=<asset type>     every saved option asset, each with picked true/false
  POST choices/ask {build, title?}          a build asks how many options to make; → {id, count?, default}
  GET  choices/asks                         what is waiting for his answer (the console's pop-up reads this)
  GET  choices/ask?id=<ask>                 {answered, count}: his number, or the default once the wait ran out
  POST choices/answer {id, count}           his answer (console pop-up, AmberX, voice through MCP)

Assets: a build's checkout writes them to plugins/<owner>/assets/<type>/ (review.mjs --choices, shipped in its PR); an
option that arrives through this API is kept in the data folder under the same path, so nothing is lost before it ships.
"""
from __future__ import annotations

import json
import re
import secrets
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, HTTPException, Request, Query

TAG = "ui-choices@1"
MIN_OPTIONS = 3
MULTI_VIEW_TYPES = ("layout", "dock-layout", "xlayout", "nav-menu", "nav-style", "app-menu", "toolbar", "tab-group", "banner", "card", "interface")
DEFAULT_SETTINGS = {"minOptions": MIN_OPTIONS, "askOptions": False, "askTimeoutMin": 5}
_ASK = re.compile(r"^a-[0-9a-f]{8}$")
_TYPE = re.compile(r"^[a-z][a-z0-9-]{0,40}$")


def slug(v: Any) -> str:
    return re.sub(r"[^a-z0-9]+", "-", str(v or "").lower()).strip("-")[:40]


def _str(v: Any, n: int = 200) -> str:
    return v.strip()[:n] if isinstance(v, str) else ""


def min_options(v: Any) -> int:
    try:
        return max(MIN_OPTIONS, min(int(v), 12))
    except (TypeError, ValueError):
        return MIN_OPTIONS


def norm_choices(raw: Any, set_id: str = "") -> dict:
    """Mirror of normChoices."""
    o = raw if isinstance(raw, dict) else {}
    atype = _str(o.get("assetType"), 40)
    options = []
    for i, x in enumerate([x for x in (o.get("options") if isinstance(o.get("options"), list) else []) if isinstance(x, dict)][:12]):
        opt = {"id": slug(x.get("id") or x.get("label")) or f"option-{i + 1}", "label": _str(x.get("label"), 120) or f"Option {i + 1}"}
        if _str(x.get("notes"), 600):
            opt["notes"] = _str(x.get("notes"), 600)
        if _str(x.get("asset"), 120):
            opt["asset"] = _str(x.get("asset"), 120)
        options.append(opt)
    ids = [x["id"] for x in options]
    chosen: list[str] = []
    for c in o.get("chosen") if isinstance(o.get("chosen"), list) else []:
        if c in ids and c not in chosen:
            chosen.append(c)
    out = {"$axf": TAG, "set": slug(o.get("set") or set_id), "assetType": atype, "owner": _str(o.get("owner"), 60), "multi": atype in MULTI_VIEW_TYPES, "options": options, "chosen": chosen}
    if _str(o.get("decidedAt"), 40):
        out |= {"decidedAt": _str(o.get("decidedAt"), 40), "decidedBy": _str(o.get("decidedBy"), 60)}
    return out


def problems(c: dict, minimum: int = MIN_OPTIONS) -> list[str]:
    """Mirror of choicesProblems."""
    out = []
    if not c["assetType"]:
        out.append("choices.assetType: which asset type the options are")
    if not c["owner"]:
        out.append("choices.owner: the plugin whose assets folder keeps them")
    if len(c["options"]) < min_options(minimum):
        out.append(f"choices.options: {len(c['options'])} sent, at least {min_options(minimum)} are needed")
    if len({x["id"] for x in c["options"]}) != len(c["options"]):
        out.append("choices.options: option ids must differ")
    return out


def submission_gap(fields: dict, minimum: int = MIN_OPTIONS) -> str:
    """Mirror of submissionGap."""
    if fields.get("prediction"):
        return ""
    if fields.get("choices"):
        return "; ".join(problems(norm_choices(fields["choices"]), minimum))
    by = fields.get("submittedBy")
    by = _str((by.get("id") or by.get("type")) if isinstance(by, dict) else by, 80)
    from_build = fields.get("source") in ("headless", "agent") or by.startswith(("build:", "agent:"))
    if not from_build or _str(fields.get("singleOption"), 300):
        return ""
    return f"a build ships at least {min_options(minimum)} options: send choices (review.mjs --choices <file>), or singleOption with the reason there is only one"


def choose(c: dict, ids: Any, by: str, at: str) -> dict:
    """Mirror of choose; ValueError in words on a bad pick."""
    want: list[str] = []
    for x in ids if isinstance(ids, list) else []:
        if isinstance(x, str) and x not in want:
            want.append(x)
    if not want:
        raise ValueError("pick at least one option")
    unknown = [x for x in want if x not in [o["id"] for o in c["options"]]]
    if unknown:
        raise ValueError(f"no such option: {', '.join(unknown)}")
    if len(want) > 1 and not c["multi"]:
        raise ValueError(f"a {c['assetType']} has one view: pick one option")
    return {**c, "chosen": want, "decidedAt": at, "decidedBy": by}


def asset_id(set_id: str, option: str) -> str:
    return f"{slug(set_id)}-{slug(option)}"[:80]


def option_asset(c: dict, option: dict, data: Any, name: str) -> dict:
    """Mirror of optionAsset."""
    return {"$axf": "asset@1", "type": c["assetType"], "id": asset_id(c["set"], option["id"]), "name": f"{name or c['set']}: {option['label']}"[:120], "version": "0.1.0",
            "author": "UI Review choices", "description": option.get("notes") or f'Option "{option["label"]}" of choice set {c["set"]}.',
            "tags": ["ui-choice", f"choice-set:{c['set']}", f"choice-option:{option['id']}"], "data": data if isinstance(data, dict) else {}}


def router_for(h: Any) -> APIRouter:
    """h: the plugin module (data_dir, _lock, _items_doc, _save_items, _read, _write, _json, _now, _s, HERE)."""
    r = APIRouter()

    def settings() -> dict:
        d = h._read(h.data_dir() / "choices-settings.json", {})
        s = {**DEFAULT_SETTINGS, **({k: v for k, v in d.items() if k in DEFAULT_SETTINGS} if isinstance(d, dict) else {})}
        return {**s, "minOptions": min_options(s["minOptions"]), "askOptions": s["askOptions"] is True, "askTimeoutMin": max(1, min(int(s["askTimeoutMin"]), 120))}

    h.choices_minimum = lambda: settings()["minOptions"]

    def asks_file() -> Path:
        return h.data_dir() / "choices-asks.json"

    def asks() -> list[dict]:
        d = h._read(asks_file(), [])
        return [a for a in d if isinstance(a, dict)] if isinstance(d, list) else []

    def expire(a: dict, now: float) -> dict:
        """No answer in time: the default stands."""
        if a.get("count") is None and now >= a["until"]:
            return {**a, "count": a["default"], "by": "default"}
        return a

    def asset_dirs() -> list[Path]:
        return [h.HERE.parent, h.data_dir() / "option-assets"]

    def picked_tags() -> set[str]:
        out: set[str] = set()
        for it in h._items_doc()["items"]:
            c = it.get("choices") if isinstance(it, dict) else None
            if isinstance(c, dict):
                out |= {f"{c.get('set')}:{x}" for x in c.get("chosen") or []}
        return out

    @r.get("/choices/settings")
    def get_settings() -> dict:
        return settings()

    @r.put("/choices/settings")
    async def put_settings(request: Request) -> dict:
        b = await h._json(request)
        s = {**settings(), **{k: v for k, v in b.items() if k in DEFAULT_SETTINGS}}
        s["minOptions"] = min_options(s["minOptions"])
        h._write(h.data_dir() / "choices-settings.json", s)
        return settings()

    @r.post("/choices/choose")
    async def post_choose(request: Request) -> dict:
        b = await h._json(request)
        with h._lock:
            doc = h._items_doc()
            it = next((x for x in doc["items"] if isinstance(x, dict) and x.get("id") == b.get("id")), None)
            if not it or not isinstance(it.get("choices"), dict):
                raise HTTPException(404, "no such item with choices")
            at = h._now()
            who = h._s(b.get("by"), 60) or "brett"
            try:
                c = choose(norm_choices(it["choices"]), b.get("chosen"), who, at)
            except ValueError as e:
                raise HTTPException(400, str(e)) from e
            labels = [next(o["label"] for o in c["options"] if o["id"] == x) for x in c["chosen"]]
            note = h._s(b.get("comment"), 2000) or f"Chose {', '.join(labels)}" + (f" ({labels[0]} is the default)" if len(labels) > 1 else "")
            done = {**h.decide(it, "approve", note, who, at), "choices": c}
            doc["items"] = [done if x is it else x for x in doc["items"]]
            h._save_items(doc)
        return {"ok": True, "id": done["id"], "chosen": c["chosen"], "default": c["chosen"][0], "status": done["status"]}

    @r.get("/choices/decision")
    def decision(id: str = Query("")) -> dict:  # noqa: A002 — the query name
        it = next((x for x in h._items_doc()["items"] if isinstance(x, dict) and x.get("id") == id), None)
        if not it:
            raise HTTPException(404, "no such item")
        c = norm_choices(it.get("choices"))
        return {"id": id, "status": it.get("status"), "decided": bool(c["chosen"]), "chosen": c["chosen"], "default": c["chosen"][0] if c["chosen"] else "", "multi": c["multi"]}

    @r.get("/choices/assets")
    def assets(type: str = Query("")) -> dict:  # noqa: A002 — the query name
        if type and not _TYPE.match(type):
            raise HTTPException(400, "type: an asset type")
        picks = picked_tags()
        out: dict[str, dict] = {}
        for base in asset_dirs():
            for f in base.glob(f"*/assets/{type or '*'}/*.json"):
                try:
                    a = json.loads(f.read_text())
                except (OSError, ValueError):
                    continue
                tags = a.get("tags") if isinstance(a, dict) else None
                if not isinstance(tags, list) or "ui-choice" not in tags:
                    continue
                set_id = next((t.split(":", 1)[1] for t in tags if isinstance(t, str) and t.startswith("choice-set:")), "")
                option = next((t.split(":", 1)[1] for t in tags if isinstance(t, str) and t.startswith("choice-option:")), "")
                out.setdefault(f"{a.get('type')}/{a.get('id')}", {**a, "picked": f"{set_id}:{option}" in picks, "set": set_id, "option": option, "owner": f.parts[-4]})
        return {"assets": sorted(out.values(), key=lambda x: (str(x.get("type")), str(x.get("id"))))}

    @r.post("/choices/ask")
    async def post_ask(request: Request) -> dict:
        b = await h._json(request)
        s = settings()
        if not s["askOptions"]:
            return {"ok": True, "asked": False, "count": s["minOptions"], "default": s["minOptions"]}
        a = {"id": f"a-{secrets.token_hex(4)}", "build": h._s(b.get("build"), 120), "title": h._s(b.get("title"), 200), "at": h._now(), "until": time.time() + s["askTimeoutMin"] * 60, "default": s["minOptions"], "count": None}
        with h._lock:
            h._write(asks_file(), [x for x in (expire(y, time.time()) for y in asks()) if x.get("count") is None][-49:] + [a])
        h.ask_notice(a)
        return {"ok": True, "asked": True, **a}

    @r.get("/choices/asks")
    def open_asks() -> dict:
        now = time.time()
        return {"asks": [a for a in (expire(x, now) for x in asks()) if a.get("count") is None]}

    @r.get("/choices/ask")
    def one_ask(id: str = Query("")) -> dict:  # noqa: A002 — the query name
        a = next((x for x in asks() if x.get("id") == id), None)
        if not a:
            raise HTTPException(404, "no such question")
        a = expire(a, time.time())
        return {**a, "answered": a.get("count") is not None}

    @r.post("/choices/answer")
    async def post_answer(request: Request) -> dict:
        b = await h._json(request)
        aid = h._s(b.get("id"), 20)
        if not _ASK.match(aid):
            raise HTTPException(400, "id: a question id")
        with h._lock:
            all_ = asks()
            a = next((x for x in all_ if x.get("id") == aid), None)
            if not a:
                raise HTTPException(404, "no such question")
            a.update({"count": min_options(b.get("count")), "by": h._s(b.get("by"), 60) or "brett"})
            h._write(asks_file(), all_)
        return {"ok": True, "id": aid, "count": a["count"]}

    return r
