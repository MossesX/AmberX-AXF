"""Predicted looks (ui-prediction@1, framework/core/ui-predict.mjs): UI Review items whose after-shots are a mockup of
what a build will probably look like, made before the build runs, so Brett approves the look before money is spent.

  GET  settings                 {waitForLook}: "Wait for my look approval before UI builds start" (default off)
  PUT  settings {waitForLook}
  GET  predicted?build=         the predicted items (all, or one build's), each with its look gate verdict
  POST predict {build, name, app, screen, prediction, files: [{name, data}], …}
                                make the build's predicted item, or refresh its pictures (same item, new shots)
  POST predict/real {build, files}
                                the build finished: its real after-shots replace the mockup (badge Real), the item waits
                                for the real approval, the look decision and the predicted pictures stay for compare
  POST approve-look {build | ids, decision: approve|changes|reject|reopen, comment?}
                                Brett's decision on the look (the same as decide on a predicted item); an Ask changes
                                comment goes to the build as an addendum (framework/cli/ui-predict.mjs addendum)

File roles are in the names: before-<screen>-<viewport>.png (the screen now, from main), predicted-…, real-….
The server mirrors ui-predict.mjs decideLook / lookVerdict; the JS core is the reference.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

PREDICTION_TAG = "ui-prediction@1"
LOOK_DECISIONS = {"approve": "approved", "changes": "changes", "reject": "rejected", "reopen": "waiting"}
LOOK_STATUSES = ["waiting", "approved", "changes", "rejected"]
_ROLE = re.compile(r"^(?:\d+-)?(before|predicted|real)-")
_BUILD = re.compile(r"^[a-z0-9][a-z0-9._-]{0,119}$")
DEFAULT_SETTINGS = {"$axf": "ui-review-settings@1", "waitForLook": False}


def role_of(src: str) -> str:
    m = _ROLE.match(str(src or "").split("/")[-1])
    return m.group(1) if m else "real"


def prediction_of(item: dict) -> dict | None:
    p = item.get("prediction") if isinstance(item, dict) else None
    return p if isinstance(p, dict) and p.get("$axf") == PREDICTION_TAG else None


def decide_look(p: dict, decision: str, comment: str, by: str, at: str) -> dict:
    status = LOOK_DECISIONS.get(decision) or (decision if decision in LOOK_STATUSES else None)
    if not status:
        raise ValueError(f'unknown look decision "{decision}"')
    c = (comment or "").strip()[:2000]
    addenda = list(p.get("addenda") or [])
    if status == "changes" and c:
        addenda.append({"at": at, "by": by, "text": c, "sent": False})
    look = {"status": status, "by": by, "at": at}
    if c:
        look["comment"] = c
    return {**p, "look": look, "addenda": addenda}


def look_verdict(settings: dict, touches: bool, item: dict | None) -> dict:
    p = prediction_of(item) if item else None
    look = ((p or {}).get("look") or {}).get("status") or ("waiting" if item else "none")
    if look == "rejected":
        return {"go": False, "wait": False, "look": look, "reason": "Brett rejected the predicted look in UI Review: the build is held and does not start."}
    if not settings.get("waitForLook"):
        return {"go": True, "wait": False, "look": look, "reason": "look approval is not required (setting off)"}
    if not touches:
        return {"go": True, "wait": False, "look": look, "reason": "the build changes nothing visible"}
    if look == "approved":
        return {"go": True, "wait": False, "look": look, "reason": "the predicted look is approved"}
    if look == "changes":
        return {"go": True, "wait": False, "look": look, "reason": "changes asked on the look: they ride along as an addendum"}
    return {"go": False, "wait": True, "look": look, "reason": "waiting for the predicted look to be made and approved in UI Review" if look == "none" else "waiting for Brett to approve the predicted look in UI Review"}


def router_for(h: Any) -> APIRouter:
    """h: the plugin module (data_dir, _lock, _items_doc, _save_items, _stored_items, submit, _decode, _safe_file, _json,
    _shot_name, _now, _s, _read, _write, cf, S, HERE)."""
    r = APIRouter()

    def settings_path() -> Path:
        return h.data_dir() / "settings.json"

    def get_settings() -> dict:
        d = h._read(settings_path(), {})
        return {**DEFAULT_SETTINGS, **({k: v for k, v in d.items() if k in DEFAULT_SETTINGS} if isinstance(d, dict) else {})}

    def find(doc: dict, build: str) -> dict | None:
        mine = [it for it in doc["items"] if isinstance(it, dict) and (prediction_of(it) or {}).get("build") == build]
        return mine[-1] if mine else None

    def files_of(body: dict) -> list[tuple[str, bytes]]:
        out = []
        for i, f in enumerate((body.get("files") if isinstance(body.get("files"), list) else [])[:60]):
            if not isinstance(f, dict) or not isinstance(f.get("data"), str):
                raise HTTPException(400, "files: [{name, data}]")
            out.append((h._s(f.get("name"), 120) or f"predicted-shot-{i + 1}.png", h._decode(f["data"])))
        return out

    def put_files(item: dict, files: list[tuple[str, bytes]], replace_roles: set[str]) -> None:
        """Write the pictures into the item's folder; pictures of the replaced roles go."""
        folder = h.data_dir() / "shots" / item["id"]
        keep = [s for s in item.get("shots") or [] if role_of(s.get("src", "")) not in replace_roles]
        for s in item.get("shots") or []:
            if role_of(s.get("src", "")) in replace_roles:
                try:
                    (h.data_dir() / "shots" / s["src"].split("/", 1)[-1]).unlink()
                except (OSError, KeyError):
                    pass
        folder.mkdir(parents=True, exist_ok=True)
        new = []
        for i, (name, raw) in enumerate(files):
            fn = h._safe_file(name, i)
            (folder / fn).write_bytes(raw)
            new.append({"src": f"items/{item['id']}/{fn}", "device": "phone" if re.search(r"(^|[-_.])phone([-_.]|$)", fn) else "desktop", "name": h._shot_name(fn)})
        item["shots"] = [*[s for s in keep if s["src"] not in {n["src"] for n in new}], *new]

    def send_addenda(build: str, texts: list[str]) -> None:
        """Ask changes → the build gets the comment (ui-predict.mjs addendum writes an orchestrator note). Best effort."""
        node = shutil.which("node")
        cli = h.HERE.parent.parent.parent.parent / "framework" / "cli" / "ui-predict.mjs"
        if not node or not cli.is_file() or not texts:
            return
        def run() -> None:
            ok = True
            for t in texts:
                try:
                    ok = subprocess.run([node, str(cli), "addendum", build, "--text", t], capture_output=True, timeout=60).returncode == 0 and ok
                except (OSError, subprocess.SubprocessError):
                    ok = False
            if ok:
                with h._lock:
                    doc = h._items_doc()
                    it = find(doc, build)
                    p = prediction_of(it) if it else None
                    if p:
                        p["addenda"] = [{**a, "sent": True} if a.get("text") in texts else a for a in p.get("addenda") or []]
                        h._save_items(doc)
        threading.Thread(target=run, daemon=True).start()

    def decide_items(ids: list[str], build: str, decision: str, comment: str, by: str) -> dict:
        if decision not in LOOK_DECISIONS:
            raise ValueError(f'unknown look decision "{decision}"')
        at = h._now()
        changed, pending = [], {}
        with h._lock:
            doc = h._items_doc()
            for it in doc["items"]:
                p = prediction_of(it)
                if not p or not ((ids and it.get("id") in ids) or (build and p.get("build") == build)):
                    continue
                nd = h.decide(it, decision, comment, by, at)
                it.clear()
                it.update(nd)  # decide() already decided the look too (decide_look on a predicted item)
                changed.append(it["id"])
                unsent = [a["text"] for a in (prediction_of(it) or {}).get("addenda") or [] if not a.get("sent")]
                if unsent:
                    pending[p["build"]] = unsent
            h._save_items(doc)
        for b, texts in pending.items():
            send_addenda(b, texts)
        return {"changed": changed, "at": at}

    h.after_decide = lambda items: [send_addenda((prediction_of(it) or {}).get("build", ""), [a["text"] for a in (prediction_of(it) or {}).get("addenda") or [] if not a.get("sent")]) for it in items if prediction_of(it)]

    @r.get("/settings")
    def settings() -> dict:
        return get_settings()

    @r.put("/settings")
    async def put_settings(request: Request) -> dict:
        body = await h._json(request, 8192)
        if "waitForLook" in body and not isinstance(body["waitForLook"], bool):
            raise HTTPException(400, "waitForLook must be true or false")
        with h._lock:
            s = {**get_settings(), **{k: body[k] for k in ("waitForLook",) if k in body}, "updatedAt": h._now()}
            h._write(settings_path(), s)
        return {k: v for k, v in s.items() if k != "updatedAt"} | {"updatedAt": s["updatedAt"]}

    @r.get("/predicted")
    def predicted(build: str = "", touches: bool = True) -> dict:
        doc = h._items_doc()
        stored = {it["id"]: it for it in h._stored_items(doc)[0]["items"]}
        out = []
        for it in doc["items"]:
            p = prediction_of(it)
            if p and (not build or p.get("build") == build):
                out.append({**stored.get(it["id"], {}), "verdict": look_verdict(get_settings(), touches, it)})
        res: dict = {"$axf": "ui-review-predicted@1", "settings": get_settings(), "items": out}
        if build:
            res["verdict"] = look_verdict(get_settings(), touches, find(doc, build))
        return res

    @r.post("/predict")
    async def predict(request: Request) -> dict:
        body = await h._json(request, h.MAX_BODY)
        p = body.get("prediction")
        build = h._s(body.get("build") or (p or {}).get("build"), 120)
        if not _BUILD.match(build):
            raise HTTPException(400, "build: the orchestrator build id")
        if not isinstance(p, dict) or p.get("$axf") != PREDICTION_TAG:
            raise HTTPException(400, f"prediction: a {PREDICTION_TAG} block (framework/core/ui-predict.mjs newPrediction)")
        files = files_of(body)
        if not files:
            raise HTTPException(400, "files: the predicted pictures")
        with h._lock:
            doc = h._items_doc()
            it = find(doc, build)
            if it:
                old = prediction_of(it) or {}
                it["prediction"] = {**old, "hash": p.get("hash", old.get("hash")), "screens": p.get("screens", old.get("screens")), "cost": p.get("cost", old.get("cost")),
                                    "refreshedAt": h._now(), "refreshes": int(old.get("refreshes") or 0) + 1, "diffFiles": p.get("diffFiles", old.get("diffFiles", 0))}
                put_files(it, files, {"predicted", "before"} if any(role_of(n) == "before" for n, _ in files) else {"predicted"})
                it["updatedAt"] = h._now()
                it["history"] = [*(it.get("history") or []), {"at": h._now(), "by": h._s(body.get("by"), 60) or "ui-predict", "action": "refreshed", "status": it.get("status", "waiting")}][-200:]
                h._save_items(doc)
                return {"ok": True, "refreshed": True, "item": h._stored_items({**doc, "items": [it]})[0]["items"][0]}
        fields = {k: v for k, v in body.items() if k not in ("files", "build")}
        if "name" in fields and not fields.get("title"):
            fields["title"] = fields.pop("name")
        fields["prediction"] = {**p, "build": build, "look": p.get("look") or {"status": "waiting"}, "addenda": p.get("addenda") or []}
        try:
            item = h.submit(fields, [(n, "", raw) for n, raw in files])
        except (h.S.SchemaError, ValueError) as e:
            raise HTTPException(400, str(e)) from e
        return {"ok": True, "refreshed": False, "item": item}

    @r.post("/predict/real")
    async def predict_real(request: Request) -> dict:
        body = await h._json(request, h.MAX_BODY)
        build = h._s(body.get("build"), 120)
        files = [(n if (_ROLE.match(n) or [None, ""])[1] == "real" else f"real-{_ROLE.sub('', n)}", raw) for n, raw in files_of(body)]
        if not files:
            raise HTTPException(400, "files: the real after-shots")
        with h._lock:
            doc = h._items_doc()
            it = find(doc, build)
            if not it:
                raise HTTPException(404, f"no predicted item for build {build}")
            put_files(it, files, {"real"})
            p = prediction_of(it) or {}
            at = h._now()
            it["prediction"] = {**p, "state": "real", "realAt": at}
            for k in ("branch", "pr"):
                if body.get(k):
                    it[k] = body[k] if k == "branch" else int(str(body[k]).lstrip("#")) if str(body[k]).lstrip("#").isdigit() else it.get(k)
            it["status"] = "waiting"  # the real screens wait for their own OK; the look decision stays on the prediction
            it["updatedAt"] = at
            it["history"] = [*(it.get("history") or []), {"at": at, "by": h._s(body.get("by"), 60) or "ui-predict", "action": "real", "status": "waiting"}][-200:]
            h._save_items(doc)
            return {"ok": True, "item": h._stored_items({**doc, "items": [it]})[0]["items"][0]}

    @r.post("/approve-look")
    async def approve_look(request: Request) -> dict:
        body = await h._json(request)
        ids = [x for x in body.get("ids") or [] if isinstance(x, str)] if isinstance(body.get("ids"), list) else []
        build = h._s(body.get("build"), 120)
        if not ids and not build:
            raise HTTPException(400, "give a build or ids")
        try:
            res = decide_items(ids, build, h._s(body.get("decision"), 20) or "approve", h._s(body.get("comment"), 2000), h._s(body.get("by"), 60) or "brett")
        except ValueError as e:
            raise HTTPException(400, str(e)) from e
        if not res["changed"]:
            raise HTTPException(404, "no predicted item matches")
        return {"ok": True, **res}

    return r
