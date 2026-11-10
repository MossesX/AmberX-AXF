"""Activity Monitor — server part. Mounted at /api/plugins/activity-monitor/ (console token, 404 when disabled).

One live log of everything the console, axHub and every app does, each line a plain-English sentence (engine.py), with
request chains, errors and the fixes after them, and rules ("when this happens again, do that").

  GET    events                 ?tab=&q=&kind=&severity=&minSeverity=&app=&source=&actor=&range=&since=&until=&chain=
                                &limit=&view=flat|tree  → {events | chains, total, rev, tabs, stats}
  GET    event/{id}             one event with its whole chain
  POST   emit                   {event} or {events: [...]}: write events (console UI, CLI, other apps through axHub)
  POST   retry/{id}             run the event's retry again → {done, how} or {action} the open console runs
  GET    stats                  counts per tab, errors today, the last error (the banner / toolbar widget)
  GET    export                 ?format=jsonl|csv|md|txt (+ the same filters as events)
  GET    rules                  every rule
  POST   rules                  {id?, name?, on: {kind, severity, minSeverity, app, source, actor, text}, do: {type:
                                notify|fix|route|action|note, agent?, action?, check?, message?}, enabled?, cooldownS?}
  POST   rules/from-event/{id}  a rule made from an event ({do} optional) → the saved rule
  POST   rules/test             {rule} → the recent events it would have matched
  DELETE rules/{id}             delete a rule
  GET    settings | PUT settings  colours (token names per kind), density, hidden kinds, capture switches, keep, view
  POST   collect                read every source now (normally done by every read, at most every few seconds)
  DELETE events                 clear the log (confirm)

Provides ``axf.activity-log@1``: emit(event | [events]), query(**filter), stats(), chain(id), rules(). Other plugins
write here without naming this plugin, or offer an ``activity_log(since_ms)`` method on their own service.
"""
from __future__ import annotations

import os
import threading
import time
from pathlib import Path
from typing import Any

from fastapi import APIRouter, Body, HTTPException, Request
from fastapi.responses import Response

import console_context as cx
import plugin_services

from . import collect, engine

router = APIRouter()
FOLDER = Path(__file__).resolve().parents[1].name
SELF = collect.SELF
COLLECT_EVERY_S = 4.0
_collect_lock = threading.Lock()
_last_collect = [0.0]
_cooldown: dict[str, int] = {}


def data_dir() -> Path:
    return Path(os.environ.get("AXF_ACTIVITY_MONITOR_DIR") or (cx.ROOT / ".axf-console" / "plugins" / FOLDER))


_STORE: dict[str, engine.Store] = {}


def store() -> engine.Store:
    d = data_dir()
    s = _STORE.get(str(d))
    if s is None:
        s = _STORE[str(d)] = engine.Store(d)
    return s


# ------------------------------------------------------------------------------------------------ ingest + rules

def _link_fix(st: engine.Store, e: dict[str, Any], pending: list[dict[str, Any]] = ()) -> None:  # type: ignore[assignment]
    """A fix with no chain of its own joins the error it fixes (same thing touched, in the last day)."""
    if e.get("kind") != "fix" or e.get("parent"):
        return
    rid = (e.get("ref") or {}).get("id") or (e.get("fixNote") or {}).get("id")
    if not rid:
        return
    for prev in reversed(st.events()[-3000:] + list(pending)):
        if prev.get("at", 0) < e["at"] - 86400_000:
            break
        if prev.get("severity") == "error" and (prev.get("ref") or {}).get("id") == rid and prev["id"] != e["id"]:
            e["chain"], e["parent"] = prev.get("chain") or prev["id"], prev["id"]
            return


def ingest(raw: list[dict[str, Any]], source: str = "api") -> list[dict[str, Any]]:
    st = store()
    clean: list[dict[str, Any]] = []
    for r in raw:
        try:
            e = engine.normalize(r, source=source)
        except ValueError:
            continue
        if st.has(e["id"]):
            continue
        _link_fix(st, e, clean)
        clean.append(e)
    added = st.add(clean)
    rules = [r for r in st.rules() if r.get("enabled")]
    if rules:
        for e in added:
            for rule in rules:
                if engine.rule_matches(rule, e):
                    _fire(st, rule, e)
    return added


def _fire(st: engine.Store, rule: dict[str, Any], e: dict[str, Any]) -> None:
    now = engine.now_ms()
    if now - _cooldown.get(rule["id"], int(rule.get("lastHit") or 0)) < int(rule.get("cooldownS") or 0) * 1000:
        return
    _cooldown[rule["id"]] = now
    st.hit_rule(rule["id"], now)
    do = rule.get("do") or {}
    typ = do.get("type")
    result, reason, ref = "done", "", {"type": "rule", "id": rule["id"], "label": rule["name"]}
    try:
        if typ == "notify":
            cx.raise_alert({"source": "activity-monitor", "key": f"rule:{rule['id']}", "severity": "danger" if e.get("severity") == "error" else "warning",
                            "title": do.get("message") or rule["name"], "body": e.get("sentence", ""), "link": ""})
        elif typ == "fix":
            res = _retry(e, check=do.get("check") or "")
            result, reason = ("done", res.get("how", "")) if res.get("done") else ("waiting", res.get("how", "")) if res.get("action") else ("failed", res.get("how", ""))
            if res.get("action"):
                ref["action"] = res["action"]
        elif typ == "route":
            svc = plugin_services.get("axf.build-dispatch@1")
            who = do.get("agent") or do.get("target")
            if svc is None:
                result, reason = "failed", "the orchestrator isn't installed"
            else:
                r = svc.request(f"Activity rule: {rule['name']}"[:120], f"For {who}. The activity log saw: {e.get('sentence')}\n\nEvent {e['id']} (chain {e.get('chain')}).\n{do.get('message') or ''}",
                                by="activity-monitor", source="activity-monitor", priority="", queue=False)
                result, reason = ("sent", f"build {r.get('id')}") if r.get("ok", True) else ("failed", str(r.get("error") or ""))
        elif typ == "action":
            ref["action"] = do.get("action", "")
            result = "waiting"
            reason = "runs in the open console"
    except Exception as exc:  # noqa: BLE001 — a rule never breaks the log
        result, reason = "failed", str(exc)[:200]
    out = {"id": f"rule:{rule['id']}:{e['id']}"[:150], "at": now, "app": e.get("app", "console"), "source": "rule", "kind": "rule",
           "actor": f"Rule “{rule['name']}”", "verb": {"notify": "notified you about", "fix": "ran the fix for", "route": "sent",
                                                         "action": "asked the console to run " + do.get("action", ""), "note": "noted"}.get(typ, "handled"),
           "object": "this" if typ != "route" else "it", "target": (do.get("agent") or do.get("target")) if typ == "route" else "",
           "result": result, "reason": reason, "chain": e.get("chain") or e["id"], "parent": e["id"], "ref": ref,
           "raw": {"rule": rule, "event": e["id"]}}
    try:
        st.add([engine.normalize(out, source="rule")])
    except ValueError:
        pass


def _retry(e: dict[str, Any], check: str = "") -> dict[str, Any]:
    """Run what the event did again. Console actions run in the open console ({action}); builds are re-queued through the
    orchestrator; a systems check fix runs through axf.syscheck@1."""
    ref = e.get("ref") or {}
    if ref.get("retry") or (e.get("kind") in ("action", "click") and ref.get("action")):
        return {"action": ref.get("retry") or ref.get("action"), "how": "runs again in the open console"}
    if ref.get("type") == "build" and ref.get("id"):
        svc = plugin_services.get("axf.build-dispatch@1")
        if svc is None:
            return {"done": False, "how": "the orchestrator isn't installed"}
        r = svc.queue(ref["id"], by="activity-monitor")
        return {"done": bool(r.get("ok", True)), "how": f"build {ref['id']} put back in the Queue"}
    cid = check or (ref.get("id") if ref.get("type") == "syscheck" else "")
    if cid:
        svc = plugin_services.get("axf.syscheck@1")
        fix = getattr(svc, "fix", None) or getattr(svc, "run_one", None)
        if not callable(fix):
            return {"done": False, "how": "the systems check isn't installed"}
        r = fix(cid) or {}
        return {"done": bool(r.get("ok", r.get("status") != "fail")), "how": f"systems check {cid} ran again: {r.get('status') or r.get('detail') or 'done'}"}
    return {"done": False, "how": "nothing to retry: this event has no action, build or fix attached"}


def maybe_collect(force: bool = False) -> int:
    st = store()
    if not force and (time.time() - _last_collect[0] < COLLECT_EVERY_S or not st.settings().get("collect", True)):
        return 0
    if not _collect_lock.acquire(blocking=force):
        return 0
    try:
        _last_collect[0] = time.time()
        cur = st.cursors()
        raw = collect.collect_all(cx.ROOT, cur, getattr(cx, "terminal_lines", None))
        added = ingest(raw, source="collect") if raw else []
        st.save_cursors(cur)
        return len(added)
    finally:
        _collect_lock.release()


# ------------------------------------------------------------------------------------------------ service

class Service:
    """axf.activity-log@1"""
    version = 1

    def emit(self, event: dict[str, Any] | list[dict[str, Any]], source: str = "plugin") -> list[dict[str, Any]]:
        return ingest(event if isinstance(event, list) else [event], source=source)

    def query(self, **f: Any) -> list[dict[str, Any]]:
        maybe_collect()
        return store().query(f, int(f.pop("limit", 200) or 200))[0]

    def stats(self) -> dict[str, Any]:
        maybe_collect()
        return engine.stats(store().events())

    def chain(self, chain_id: str) -> list[dict[str, Any]]:
        return [e for e in store().events() if e.get("chain") == chain_id]

    def rules(self) -> list[dict[str, Any]]:
        return store().rules()


plugin_services.provide(SELF, Service(), FOLDER)


# ------------------------------------------------------------------------------------------------ routes

def _filters(request: Request) -> dict[str, Any]:
    q = request.query_params
    f: dict[str, Any] = {k: q.get(k) for k in ("tab", "q", "kind", "severity", "minSeverity", "app", "source", "actor", "range", "chain") if q.get(k)}
    for k in ("since", "until"):
        if q.get(k):
            try:
                f[k] = int(q[k])
            except ValueError:
                raise HTTPException(400, f"{k} must be epoch milliseconds") from None
    if q.get("hide") is not None:
        f["hide"] = [x for x in q["hide"].split(",") if x]
    else:
        f["hide"] = store().settings().get("hide") or []
    return f


@router.get("/events")
def events(request: Request) -> dict[str, Any]:
    maybe_collect()
    st = store()
    f = _filters(request)
    try:
        limit = int(request.query_params.get("limit") or 500)
    except ValueError:
        limit = 500
    hits, total = st.query(f, limit)
    s = engine.stats(st.events())
    out: dict[str, Any] = {"total": total, "rev": st.rev, "tabs": engine.tab_list(s, st.settings().get("appTabs", True)), "stats": s}
    if (request.query_params.get("view") or "") == "tree":
        ids = {e.get("chain") for e in hits}
        full = [e for e in st.events() if e.get("chain") in ids]  # a chain shows whole, even when only one line matched
        out["chains"] = engine.chains(full)[:300]
        out["matched"] = [e["id"] for e in hits]
    else:
        out["events"] = hits
    return out


@router.get("/event/{eid:path}")
def event(eid: str) -> dict[str, Any]:
    st = store()
    e = st.get(eid)
    if not e:
        raise HTTPException(404, "no such event")
    chain = [x for x in st.events() if x.get("chain") == e.get("chain")]
    return {"event": e, "chain": engine.chains(chain)[0] if chain else None}


@router.post("/emit")
def emit(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    evs = body.get("events") if isinstance(body.get("events"), list) else [body.get("event") if isinstance(body.get("event"), dict) else body]
    if len(evs) > 500:
        raise HTTPException(400, "at most 500 events per call")
    added = ingest([e for e in evs if isinstance(e, dict)], source=str(body.get("source") or "api")[:40])
    return {"ok": True, "added": len(added), "ids": [e["id"] for e in added]}


@router.post("/retry/{eid:path}")
def retry(eid: str) -> dict[str, Any]:
    e = store().get(eid)
    if not e:
        raise HTTPException(404, "no such event")
    res = _retry(e)
    ingest([{"kind": "action", "app": e.get("app", "console"), "actor": "You", "verb": "retried", "object": f"“{e.get('sentence', '')[:120]}”",
             "result": "done" if res.get("done") else "waiting" if res.get("action") else "failed", "reason": res.get("how", ""),
             "chain": e.get("chain"), "parent": e["id"], "ref": e.get("ref") or {}}], source="activity-monitor")
    return res


@router.get("/stats")
def stats() -> dict[str, Any]:
    maybe_collect()
    st = store()
    s = engine.stats(st.events())
    return {**s, "rev": st.rev, "rules": len(st.rules())}


@router.get("/export")
def export(request: Request) -> Response:
    fmt = request.query_params.get("format") or "jsonl"
    if fmt not in ("jsonl", "csv", "md", "txt"):
        raise HTTPException(400, "format: jsonl | csv | md | txt")
    hits, _ = store().query(_filters(request), 5000)
    body, media = engine.export(hits, fmt)
    return Response(body, media_type=media, headers={"Content-Disposition": f'attachment; filename="activity-log.{fmt}"'})


@router.get("/rules")
def rules() -> dict[str, Any]:
    return {"rules": store().rules(), "do": list(engine.RULE_DO)}


@router.post("/rules")
def save_rule(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        rule = store().save_rule(body.get("rule") if isinstance(body.get("rule"), dict) else body)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    ingest([{"kind": "rule", "actor": "You", "verb": "saved the rule", "object": f"“{rule['name']}”", "result": "done",
             "ref": {"type": "rule", "id": rule["id"], "label": rule["name"]}}], source="activity-monitor")
    return {"ok": True, "rule": rule}


@router.post("/rules/from-event/{eid:path}")
def rule_from_event(eid: str, body: dict[str, Any] = Body(default={})) -> dict[str, Any]:
    e = store().get(eid)
    if not e:
        raise HTTPException(404, "no such event")
    try:
        draft = engine.rule_from_event(e, body.get("do") if isinstance(body.get("do"), dict) else None)
        if body.get("save") is False:
            return {"ok": True, "rule": draft, "saved": False}
        rule = store().save_rule({**draft, **{k: v for k, v in body.items() if k in ("name", "on", "cooldownS", "enabled")}})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {"ok": True, "rule": rule, "saved": True}


@router.post("/rules/test")
def test_rule(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        rule = engine.rule_normalize({**(body.get("rule") if isinstance(body.get("rule"), dict) else body), "enabled": True})
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    hits = [e for e in store().events()[-5000:] if engine.rule_matches(rule, e)]
    return {"rule": rule, "matches": len(hits), "recent": hits[-20:]}


@router.delete("/rules/{rid}")
def delete_rule(rid: str) -> dict[str, Any]:
    if not store().delete_rule(rid):
        raise HTTPException(404, "no such rule")
    return {"ok": True}


@router.get("/settings")
def get_settings() -> dict[str, Any]:
    return {"settings": store().settings(), "kinds": list(engine.KINDS), "severities": list(engine.SEVERITIES),
            "colorTokens": list(engine.COLOR_TOKENS)}


@router.put("/settings")
def put_settings(body: dict[str, Any] = Body(...)) -> dict[str, Any]:
    try:
        return {"ok": True, "settings": store().save_settings(body.get("settings") if isinstance(body.get("settings"), dict) else body)}
    except (ValueError, TypeError) as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/collect")
def collect_now() -> dict[str, Any]:
    return {"ok": True, "added": maybe_collect(force=True)}


@router.delete("/events")
def clear(request: Request) -> dict[str, Any]:
    if request.query_params.get("confirm") != FOLDER:
        raise HTTPException(400, f"add ?confirm={FOLDER} to clear the whole log")
    return {"ok": True, "removed": store().clear()}
