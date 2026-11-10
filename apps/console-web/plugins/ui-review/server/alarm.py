"""UI Review timeout (ui-review-alarm@1): nothing sits in UI Review for more than an hour.

Brett, Nov 10 2026: "Does UI review hold shit up? If shit sits in UI review for more than an hour, send me a
notification and just go." This upgrades the Nov 4 review alarm (30 min, loud alarm, 5 min grace, approve-or-hold
switch): builds never sit blocked on UI Review any more, so there is no hold and no grace.

Per waiting item:
  submitted ──(timeout, 60 min, adjustable)──► phone notification "UI Review: <build> waited 1 h, going ahead with
  <option>" + the item is approved with the build's recommended option (the first one it ships; a single-option or
  plain item is simply approved), marked "auto-approved after timeout". The build's holds lift, so it continues and
  lands. Brett can still change the pick afterwards (choose another option, ask changes, reject): that files a
  follow-up build with the orchestrator. Every auto-approval is logged on the item, in the fix log (axf.changes@1,
  kind fix), in Activity Monitor (axf.activity@1) and in the Breakroom chat.

The clock starts at the later of the item's submittedAt, the moment the timeout was first switched on (`since`, so
items already waiting when this shipped get a full hour), a snooze, and a re-open. Snooze pushes one item's deadline;
Go now takes the pick at once. Scope: every item, or only items blocking a merge (a PR or a branch).

Pure part: norm_settings, applies, pick, step, tick, due_at, follow_up_reason (no I/O; `now` is epoch seconds so tests
use a fake clock). Server part: router_for(h) adds GET alarm, GET/PUT alarm/settings, POST alarm/snooze, alarm/go,
alarm/undo, alarm/tick, and starts the ticker thread (every TICK_S seconds).
"""
from __future__ import annotations

import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

TAG = "ui-review-alarm@1"
SETTINGS_TAG = "ui-review-alarm-settings@1"
BY = "ui-review-timeout"
AUTO_COMMENT = "auto-approved after timeout"
TICK_S = 30
SCOPES = ("all", "blocking")

DEFAULTS: dict[str, Any] = {
    "$axf": SETTINGS_TAG,
    "enabled": True,       # off = items wait for Brett, like before
    "timeoutMin": 60,      # unreviewed this long → notify and go ahead
    "notify": True,        # the phone notification when it goes ahead
    "followUp": True,      # changing an auto-approved pick files a follow-up build
    "openOnNew": True,     # a new item opens UI Review on it (Follow Amber)
    "scope": "all",        # all | blocking (only items with a PR or branch, i.e. holding a merge)
}
BOOLS = ("enabled", "notify", "followUp", "openOnNew")
LIMITS = {"timeoutMin": (1, 24 * 60)}


def norm_settings(raw: Any) -> dict:
    o = raw if isinstance(raw, dict) else {}
    s = dict(DEFAULTS)
    for k in BOOLS:
        if isinstance(o.get(k), bool):
            s[k] = o[k]
    for k, (lo, hi) in LIMITS.items():
        v = o.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            s[k] = max(lo, min(hi, int(v)))
    if o.get("scope") in SCOPES:
        s["scope"] = o["scope"]
    if isinstance(o.get("updatedAt"), str):
        s["updatedAt"] = o["updatedAt"][:40]
    return s


def settings_errors(body: dict) -> list[str]:
    """What a PUT would refuse (wrong types or values), naming the field."""
    errs = [f"{k}: unknown setting" for k in body if k not in DEFAULTS or k == "$axf"]
    errs += [f"{k} must be true or false" for k in BOOLS if k in body and not isinstance(body[k], bool)]
    for k, (lo, hi) in LIMITS.items():
        if k in body and (isinstance(body[k], bool) or not isinstance(body[k], (int, float)) or not lo <= body[k] <= hi):
            errs.append(f"{k} must be a number from {lo} to {hi}")
    if "scope" in body and body["scope"] not in SCOPES:
        errs.append(f"scope must be one of {', '.join(SCOPES)}")
    return errs


def parse_at(s: Any) -> float | None:
    """ISO 8601 (Z or offset) → epoch seconds."""
    if not isinstance(s, str) or not s:
        return None
    try:
        d = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return (d if d.tzinfo else d.replace(tzinfo=timezone.utc)).timestamp()


def iso(t: float) -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(t))


def applies(item: dict, s: dict) -> bool:
    if not isinstance(item, dict) or str(item.get("id", "")).startswith("pack:"):
        return False
    if s.get("scope") == "blocking":
        return bool(item.get("pr") or item.get("branch"))
    return True


def pick(item: dict) -> dict:
    """What going ahead means for an item: {option, label}. A build ships its options in its order of preference, so
    the recommended one is the first; no options (or a single option) = plain approve (option "")."""
    c = item.get("choices") if isinstance(item.get("choices"), dict) else {}
    opts = [o for o in c.get("options") or [] if isinstance(o, dict) and o.get("id")]
    if len(opts) > 1:
        return {"option": str(opts[0]["id"]), "label": str(opts[0].get("label") or opts[0]["id"])}
    if len(opts) == 1:
        return {"option": "", "label": str(opts[0].get("label") or "the only option")}
    return {"option": "", "label": "it as submitted"}


def phase(st: dict | None) -> str:
    """none | counting | approved (went ahead) | changed (Brett changed it afterwards)."""
    st = st or {}
    if st.get("changedAt"):
        return "changed"
    if st.get("actedAt"):
        return "approved"
    return "none"


def _start(item: dict, st: dict, since: float) -> float:
    return max(parse_at(item.get("submittedAt")) or 0, since, parse_at(st.get("startAt")) or 0)


def step(item: dict, st: dict | None, s: dict, now: float, since: float) -> tuple[dict, str | None]:
    """One item, one tick → (its new state, event). Event: "go" (timed out: notify and go ahead) or None.

    `st` keys (ISO strings unless noted): startAt (clock restart: snooze, undo, re-open), actedAt, option, label,
    changedAt, followUp (build id)."""
    st = dict(st or {})
    if item.get("status", "waiting") != "waiting":
        return st, None
    if st.get("actedAt"):
        # went ahead, then re-opened by hand: a fresh clock from now
        st = {"startAt": iso(now)}
    if not s.get("enabled") or not applies(item, s):
        return st, None
    if now < _start(item, st, since) + s["timeoutMin"] * 60:
        return st, None
    p = pick(item)
    st.update({"actedAt": iso(now), "option": p["option"], "label": p["label"]})
    return st, "go"


def tick(items: list[dict], state: dict, s: dict, now: float) -> tuple[dict, list[tuple[str, dict]]]:
    """Every item → (new state, [(event, item)]). `state` = {since, items: {id: st}, log: […]}."""
    state = {**state, "items": dict(state.get("items") or {})}
    if s.get("enabled") and not state.get("since"):
        state["since"] = iso(now)
    since = parse_at(state.get("since")) or now
    events: list[tuple[str, dict]] = []
    seen = set()
    for it in items:
        iid = it.get("id")
        if not isinstance(iid, str) or iid.startswith("pack:"):
            continue
        seen.add(iid)
        st, ev = step(it, state["items"].get(iid), s, now, since)
        if st:
            state["items"][iid] = st
        else:
            state["items"].pop(iid, None)
        if ev:
            events.append((ev, it))
    for iid in [k for k in state["items"] if k not in seen]:
        state["items"].pop(iid)  # removed items
    return state, events


def snooze(state: dict, iid: str, now: float, minutes: int, timeout_min: int) -> dict:
    """Push one item's deadline: it goes ahead `minutes` from now instead (the clock restarts so that it does)."""
    items = dict(state.get("items") or {})
    items[iid] = {"startAt": iso(now + (minutes - timeout_min) * 60), "snoozedAt": iso(now), "snoozeMin": minutes}
    return {**state, "items": items}


def undo(state: dict, iid: str, now: float) -> dict:
    """An auto-approval undone (the item re-opened): its clock starts again from now."""
    items = dict(state.get("items") or {})
    items[iid] = {"startAt": iso(now), "undoneAt": iso(now)}
    return {**state, "items": items}


def due_at(item: dict, st: dict | None, s: dict, since: float) -> float | None:
    """When the item goes ahead (epoch seconds), None when it won't."""
    st = st or {}
    if item.get("status", "waiting") != "waiting" or not s.get("enabled") or not applies(item, s) or st.get("actedAt"):
        return None
    return _start(item, st, since) + s["timeoutMin"] * 60


def follow_up_reason(item: dict, st: dict | None) -> str:
    """Brett changed an auto-approved item: what changed, in words ("" = nothing that needs a follow-up build).
    A re-open alone (back to waiting) is an undo, not a change: the clock restarts and nothing is filed."""
    st = st or {}
    if not st.get("actedAt") or st.get("changedAt"):
        return ""
    status = item.get("status")
    if status == "changes":
        return f"asked for changes: {item.get('comment') or '(no comment)'}"
    if status == "rejected":
        return f"rejected it: {item.get('comment') or '(no comment)'}"
    chosen = (item.get("choices") or {}).get("chosen") if isinstance(item.get("choices"), dict) else None
    if status == "approved" and st.get("option") and isinstance(chosen, list) and chosen and chosen != [st["option"]]:
        labels = {o.get("id"): o.get("label") or o.get("id") for o in (item.get("choices") or {}).get("options") or [] if isinstance(o, dict)}
        return f"picked {', '.join(str(labels.get(x, x)) for x in chosen)} instead of {st.get('label') or st['option']}"
    return ""


def build_name(item: dict) -> str:
    return str(item.get("build") or (item.get("branch") or "").split("/")[-1] or item.get("title") or item.get("id") or "an item")


def message(item: dict, st: dict, s: dict) -> str:
    """The phone line: 'UI Review: <build> waited 1 h, going ahead with <option>'."""
    m = s["timeoutMin"]
    waited = f"{m // 60} h" if m % 60 == 0 else f"{m} min"
    return f"UI Review: {build_name(item)} waited {waited}, going ahead with {st.get('label') or 'it'}"


# ---------------------------------------------------------------- server part

def router_for(h: Any, clock: Callable[[], float] = time.time):
    """h: the plugin module (data_dir, _lock, _items_doc, _submitted, decide_many, decide, _save_items, _json, _read,
    _write, _now, _s, cx, plugin_services, decided_hooks). Returns the router; the ticker starts with it."""
    r = APIRouter()
    lock = threading.Lock()

    def spath():
        return h.data_dir() / "alarm-settings.json"

    def apath():
        return h.data_dir() / "alarm.json"

    def get_settings() -> dict:
        return norm_settings(h._read(spath(), {}))

    def get_state() -> dict:
        d = h._read(apath(), {})
        return d if isinstance(d, dict) else {}

    def put_state(st: dict) -> None:
        h._write(apath(), {"$axf": TAG, **st, "log": list(st.get("log") or [])[-200:]})

    def log(st: dict, line: dict) -> None:
        st["log"] = [*(st.get("log") or []), {"at": iso(clock()), **line}][-200:]

    def service(name: str, method: str):
        fn = getattr(h.plugin_services.get(name), method, None)
        return fn if callable(fn) else None

    def quietly(fn, *a, **k):
        try:
            return fn(*a, **k) if fn else None
        except Exception:  # noqa: BLE001 — a log or notice never stops the build going ahead
            return None

    def link(item: dict) -> str:
        """The phone / console link: opens UI Review on the item's group (notify.py's ?axf-review-group=)."""
        return h.notify.link(str(item.get("group") or ""))

    def go_ahead(item: dict, st: dict, s: dict) -> None:
        """Approve with the pick, then tell everyone: phone, fix log, Activity Monitor, Breakroom."""
        iid = item["id"]
        comment = f"{AUTO_COMMENT}: went ahead with {st.get('label')}"
        if st.get("option"):
            with h._lock:
                doc = h._items_doc()
                for i, x in enumerate(doc["items"]):
                    if isinstance(x, dict) and x.get("id") == iid and isinstance(x.get("choices"), dict):
                        c = {**x["choices"], "chosen": [st["option"]], "decidedAt": h._now(), "decidedBy": BY}
                        doc["items"][i] = {**h.decide(x, "approve", comment, BY), "choices": c}
                h._save_items(doc)
                snapshot = {"items": list(doc["items"]), "groups": list(doc["groups"])}
            h.notify.decided(snapshot, [str(item.get("group") or "")])
        else:
            h.decide_many([iid], "approve", comment, BY)
        line = message(item, st, s)
        if s["notify"]:
            quietly(h.cx.raise_alert, {"source": "ui-review", "severity": "warning", "key": f"ui-review-timeout:{iid}", "title": line[:200],
                                       "body": "Auto-approved after timeout. Tap to open it: change the pick and a follow-up build is filed."[:300],
                                       "link": link(item), "meta": {"label": "UI Review", "kind": TAG, "items": [iid], "option": st.get("option")}})
        quietly(service("axf.changes@1", "open"), {"kind": "fix", "title": f"UI Review timeout: {build_name(item)}"[:160],
                                                   "asked": f"{item.get('title') or iid} ({iid}) waited {s['timeoutMin']} min in UI Review unanswered.",
                                                   "result": {"state": "done", "summary": f"{AUTO_COMMENT}: went ahead with {st.get('label')}."[:600]}}, by=BY)
        quietly(service("axf.activity@1", "report"), {"id": f"ui-review-timeout:{iid}", "title": line[:200], "state": "done",
                                                      "detail": f"{AUTO_COMMENT}. Change it in UI Review: a follow-up build is filed.", "url": link(item), "by": BY})
        quietly(service("axf.crew@1", "say"), f"{line}. {AUTO_COMMENT}; changing the pick in UI Review files a follow-up build.")

    def run_tick() -> dict:
        s = get_settings()
        now = clock()
        with lock:
            items = h._submitted(h._items_doc())
            st, events = tick(items, get_state(), s, now)
            for ev, it in events:
                v = st["items"].get(it["id"]) or {}
                log(st, {"event": ev, "item": it["id"], "title": it.get("title", ""), "option": v.get("option", ""), "label": v.get("label", "")})
            put_state(st)
        for ev, it in events:
            if ev == "go":
                go_ahead(it, st["items"].get(it["id"]) or {}, s)
        return {"events": [{"event": ev, "item": it["id"], "option": (st["items"].get(it["id"]) or {}).get("option", "")} for ev, it in events]}

    def on_decided(items: list[dict], by: str) -> None:
        """Brett decided items by hand: a change to an auto-approved one files a follow-up build."""
        if by == BY:
            return
        s = get_settings()
        filed = []
        with lock:
            st = get_state()
            for it in items:
                v = (st.get("items") or {}).get(it.get("id"))
                why = follow_up_reason(it, v)
                if not why:
                    continue
                v = {**v, "changedAt": iso(clock())}
                st.setdefault("items", {})[it["id"]] = v
                filed.append((it, v, why))
                log(st, {"event": "changed", "item": it["id"], "why": why[:300]})
            if filed:
                put_state(st)
        for it, v, why in filed:
            if not s["followUp"]:
                continue
            title = f"UI Review follow-up: {build_name(it)} ({it.get('title') or it['id']})"
            detail = (f"UI Review item {it['id']} ({it.get('title')}, app {it.get('app')}, screen {it.get('screen')}) went ahead after the timeout "
                      f"with {v.get('label')}. Brett then {why}. Make the build match his decision.\nItem: {link(it)}"
                      + (f"\nPR: #{it['pr']}" if it.get("pr") else "") + (f"\nBranch: {it['branch']}" if it.get("branch") else ""))
            res = quietly(service("axf.build-dispatch@1", "request"), title[:300], detail, by=BY, source="ui-review", said=f"UI Review: {why}"[:600])
            bid = (res or {}).get("id") if isinstance(res, dict) else None
            with lock:
                st = get_state()
                cur = (st.get("items") or {}).get(it["id"])
                if cur is not None:
                    cur["followUp"] = bid or ""
                log(st, {"event": "follow-up", "item": it["id"], "build": bid or "", "ok": bool(bid)})
                put_state(st)

    def view() -> dict:
        s = get_settings()
        st = get_state()
        since = parse_at(st.get("since")) or clock()
        out = {}
        for it in h._submitted(h._items_doc()):
            v = (st.get("items") or {}).get(it["id"])
            d = due_at(it, v, s, since)
            if v or d:
                out[it["id"]] = {"phase": phase(v), "goesAt": iso(d) if d else None,
                                 **({k: v.get(k) for k in ("actedAt", "option", "label", "changedAt", "followUp", "snoozedAt") if v.get(k) is not None} if v else {})}
        return {"$axf": TAG, "settings": s, "since": st.get("since"), "now": iso(clock()), "items": out, "log": list(st.get("log") or [])[-50:]}

    def one(body: dict) -> dict:
        iid = h._s(body.get("id") or body.get("item"), 80)
        it = next((x for x in h._submitted(h._items_doc()) if x.get("id") == iid), None) if iid else None
        if not it:
            raise HTTPException(404, "no such UI Review item")
        return it

    @r.get("/alarm")
    def get_alarm() -> dict:
        return view()

    @r.get("/alarm/settings")
    def get_alarm_settings() -> dict:
        return get_settings()

    @r.put("/alarm/settings")
    async def put_alarm_settings(request: Request) -> dict:
        body = {k: v for k, v in (await h._json(request)).items() if k not in ("by", "updatedAt")}
        errs = settings_errors(body)
        if errs:
            raise HTTPException(400, "; ".join(errs))
        with lock:
            s = norm_settings({**get_settings(), **body, "updatedAt": h._now()})
            h._write(spath(), s)
            st = get_state()
            log(st, {"event": "settings", "changed": sorted(body)})
            if s["enabled"] and not st.get("since"):
                st["since"] = iso(clock())
            put_state(st)
        return s

    @r.post("/alarm/snooze")
    async def post_snooze(request: Request) -> dict:
        """Give one waiting item more time: it goes ahead `minutes` from now (default: one more timeout)."""
        body = await h._json(request)
        it = one(body)
        if it.get("status", "waiting") != "waiting":
            raise HTTPException(409, "that item isn't waiting")
        s = get_settings()
        m = body.get("minutes", s["timeoutMin"])
        if isinstance(m, bool) or not isinstance(m, (int, float)) or not 1 <= m <= 24 * 60:
            raise HTTPException(400, "minutes must be a number from 1 to 1440")
        with lock:
            st = snooze(get_state(), it["id"], clock(), int(m), s["timeoutMin"])
            log(st, {"event": "snoozed", "item": it["id"], "minutes": int(m)})
            put_state(st)
        return {"ok": True, "item": it["id"], "goesAt": iso(clock() + int(m) * 60)}

    @r.post("/alarm/go")
    async def post_go(request: Request) -> dict:
        """Go ahead with one waiting item now, the same way the timeout does (recommended / first option)."""
        it = one(await h._json(request))
        if it.get("status", "waiting") != "waiting":
            raise HTTPException(409, "that item isn't waiting")
        s = get_settings()
        p = pick(it)
        with lock:
            st = get_state()
            v = {"actedAt": iso(clock()), **p}
            st.setdefault("items", {})[it["id"]] = v
            log(st, {"event": "go", "item": it["id"], "title": it.get("title", ""), "option": p["option"], "label": p["label"], "manual": True})
            put_state(st)
        go_ahead(it, v, s)
        return {"ok": True, "item": it["id"], **p}

    @r.post("/alarm/undo")
    async def post_undo(request: Request) -> dict:
        """Undo an auto-approval: re-open the item (back to waiting) and restart its clock."""
        body = await h._json(request)
        it = one(body)
        with lock:
            v = (get_state().get("items") or {}).get(it["id"]) or {}
        if not v.get("actedAt"):
            raise HTTPException(409, "that item wasn't auto-approved")
        h.decide_many([it["id"]], "reopen", "auto-approval undone", h._s(body.get("by"), 60) or "brett")
        with lock:
            st = undo(get_state(), it["id"], clock())
            log(st, {"event": "undone", "item": it["id"]})
            put_state(st)
        return {"ok": True, "item": it["id"]}

    @r.post("/alarm/tick")
    def post_tick() -> dict:
        """Run the timer now (the ticker does this every 30 s)."""
        return run_tick()

    def loop() -> None:
        while True:
            time.sleep(TICK_S)
            try:
                run_tick()
            except Exception:  # noqa: BLE001 — one bad tick never stops the timer
                pass

    def on_submit(item: dict) -> None:
        """A new item: open UI Review on it (Follow Amber; a no-op when off). The phone notice is notify.ready's."""
        if not get_settings()["openOnNew"]:
            return
        quietly(service("follow-amber@1", "show"), "ui-review", kind="view", highlight=item["id"],
                say=f"New in UI Review: {item.get('name') or item.get('title') or item['id']}", by=BY)

    r.run_tick = run_tick  # type: ignore[attr-defined]
    r.view = view  # type: ignore[attr-defined]
    r.on_submit = on_submit  # type: ignore[attr-defined]
    r.on_decided = on_decided  # type: ignore[attr-defined]
    r.start = lambda: threading.Thread(target=loop, name="ui-review-timeout", daemon=True).start()  # type: ignore[attr-defined]
    return r
