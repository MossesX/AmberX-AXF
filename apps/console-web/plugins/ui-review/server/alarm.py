"""UI Review alarm (ui-review-alarm@1): an item nobody reviews rings Brett's phone, then follows his switch.

Brett, Nov 4 2026: "After 30 minutes, if it's not been reviewed, it needs to do a loud alarm five minutes before it's
gonna be run. And if the alarm is unanswered, then … run it. Make it a switch. Either or."

Per waiting item:
  submitted ──(window, 30 min)──► ALARM (loud, phone + banner) ──(grace, 5 min)──► switch:
                                      │                                             approve = auto-approve (default)
                                      └─ answered (tapped): paused until Brett       hold    = leave it waiting
                                         approves / rejects it himself
The clock starts at the later of the item's submittedAt and the moment the alarm was first switched on (`since`), so
items that were already waiting when this shipped never ring at once. Quiet hours (optional): `silent` follows the
switch without ringing, `hold` waits for quiet hours to end. Scope: every item, or only items blocking a merge (a PR
or a branch). An auto-approval is logged on the item (history by `ui-review-alarm`), in the Breakroom chat, and can
be undone (POST alarm/undo re-opens the item and restarts its clock).

Pure part: norm_settings, in_quiet, applies, step, tick (no I/O; `now` is epoch seconds so tests use a fake clock).
Server part: router_for(h) adds GET alarm, PUT alarm/settings, POST alarm/answer, POST alarm/undo, POST alarm/tick,
and starts the ticker thread (every TICK_S seconds).
"""
from __future__ import annotations

import calendar
import threading
import time
from datetime import datetime, timezone
from typing import Any, Callable

from fastapi import APIRouter, HTTPException, Request

TAG = "ui-review-alarm@1"
SETTINGS_TAG = "ui-review-alarm-settings@1"
BY = "ui-review-alarm"
AUTO_COMMENT = "auto-approved after alarm went unanswered"
HOLD_COMMENT = "alarm went unanswered: left waiting (switch: don't run it)"
TICK_S = 30
UNANSWERED = ("approve", "hold")
QUIET_MODES = ("silent", "hold")
SCOPES = ("all", "blocking")
SOUNDS = ("alarm", "ringtone", "siren", "beacon", "pulse")

DEFAULTS: dict[str, Any] = {
    "$axf": SETTINGS_TAG,
    "enabled": True,          # the whole alarm (off = items just wait, like before)
    "openOnNew": True,        # a new item opens UI Review (Follow Amber) and notifies the phone
    "windowMin": 30,          # unreviewed this long → alarm
    "graceMin": 5,            # alarm unanswered this long → the switch
    "unanswered": "approve",  # When the alarm isn't answered: approve (run it) | hold (don't run it)
    "sound": "alarm", "volume": 100, "vibrate": True, "repeat": True,
    "quietHours": False, "quietStart": "22:00", "quietEnd": "07:00", "quietMode": "silent", "timeZone": "America/New_York",
    "scope": "all",           # all | blocking (only items with a PR or branch, i.e. holding a merge)
}
LIMITS = {"windowMin": (1, 24 * 60), "graceMin": (0, 240), "volume": (0, 100)}


def _hhmm(v: Any, d: str) -> str:
    if isinstance(v, str) and len(v) == 5 and v[2] == ":" and v[:2].isdigit() and v[3:].isdigit() and int(v[:2]) < 24 and int(v[3:]) < 60:
        return v
    return d


def norm_settings(raw: Any) -> dict:
    o = raw if isinstance(raw, dict) else {}
    s = dict(DEFAULTS)
    for k in ("enabled", "openOnNew", "vibrate", "repeat", "quietHours"):
        if isinstance(o.get(k), bool):
            s[k] = o[k]
    for k, (lo, hi) in LIMITS.items():
        v = o.get(k)
        if isinstance(v, (int, float)) and not isinstance(v, bool):
            s[k] = max(lo, min(hi, int(v)))
    for k, allowed in (("unanswered", UNANSWERED), ("quietMode", QUIET_MODES), ("scope", SCOPES), ("sound", SOUNDS)):
        if o.get(k) in allowed:
            s[k] = o[k]
    s["quietStart"], s["quietEnd"] = _hhmm(o.get("quietStart"), DEFAULTS["quietStart"]), _hhmm(o.get("quietEnd"), DEFAULTS["quietEnd"])
    if isinstance(o.get("timeZone"), str) and 0 < len(o["timeZone"]) <= 64:
        s["timeZone"] = o["timeZone"]
    if isinstance(o.get("updatedAt"), str):
        s["updatedAt"] = o["updatedAt"][:40]
    return s


def settings_errors(body: dict) -> list[str]:
    """What a PUT would refuse (wrong types or values), naming the field."""
    errs = []
    for k in body:
        if k not in DEFAULTS or k == "$axf":
            errs.append(f"{k}: unknown setting")
    for k in ("enabled", "openOnNew", "vibrate", "repeat", "quietHours"):
        if k in body and not isinstance(body[k], bool):
            errs.append(f"{k} must be true or false")
    for k, (lo, hi) in LIMITS.items():
        if k in body and (isinstance(body[k], bool) or not isinstance(body[k], (int, float)) or not lo <= body[k] <= hi):
            errs.append(f"{k} must be a number from {lo} to {hi}")
    for k, allowed in (("unanswered", UNANSWERED), ("quietMode", QUIET_MODES), ("scope", SCOPES), ("sound", SOUNDS)):
        if k in body and body[k] not in allowed:
            errs.append(f"{k} must be one of {', '.join(allowed)}")
    for k in ("quietStart", "quietEnd"):
        if k in body and _hhmm(body[k], "") == "":
            errs.append(f"{k} must be HH:MM")
    if "timeZone" in body and _tz(body["timeZone"]) is None:
        errs.append("timeZone must be an IANA zone like America/New_York")
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


def _tz(name: Any):
    try:
        from zoneinfo import ZoneInfo
        return ZoneInfo(str(name))
    except Exception:  # noqa: BLE001 — unknown zone or no tz database
        return None


def in_quiet(s: dict, now: float) -> bool:
    if not s.get("quietHours"):
        return False
    z = _tz(s.get("timeZone")) or timezone.utc
    t = datetime.fromtimestamp(now, z)
    m = t.hour * 60 + t.minute
    a, b = (int(x[:2]) * 60 + int(x[3:]) for x in (s["quietStart"], s["quietEnd"]))
    return a <= m < b if a <= b else (m >= a or m < b)  # a window over midnight wraps


def applies(item: dict, s: dict) -> bool:
    if not isinstance(item, dict) or str(item.get("id", "")).startswith("pack:"):
        return False
    if s.get("scope") == "blocking":
        return bool(item.get("pr") or item.get("branch"))
    return True


def phase(st: dict | None) -> str:
    """none | alarm | answered | approved | held | done (the item left waiting)."""
    st = st or {}
    if st.get("doneAt"):
        return "done"
    if st.get("actedAt"):
        return "approved" if st.get("action") == "approve" else "held"
    if st.get("answeredAt"):
        return "answered"
    return "alarm" if st.get("alarmAt") else "none"


def step(item: dict, st: dict | None, s: dict, now: float, since: float) -> tuple[dict, str | None]:
    """One item, one tick → (its new state, event). Events: alarm | alarm-silent | approve | hold | stop.

    `st` keys (ISO strings): startAt (clock restart, after an undo), alarmAt, silent, answeredAt, actedAt, action,
    doneAt (the item was decided some other way; the alarm stops)."""
    st = dict(st or {})
    waiting = item.get("status", "waiting") == "waiting"
    if not waiting:
        if (st.get("alarmAt") or st.get("answeredAt")) and not st.get("doneAt") and not (st.get("actedAt") and st.get("action") == "approve"):
            st["doneAt"] = iso(now)
            return st, "stop"
        return st, None
    if st.get("doneAt") or (st.get("actedAt") and st.get("action") == "approve"):
        # back to waiting (re-opened by hand): a fresh clock from now
        st = {"startAt": iso(now)}
    if not s.get("enabled") or not applies(item, s) or st.get("answeredAt") or st.get("actedAt"):
        return st, None
    start = max(x for x in (parse_at(item.get("submittedAt")) or 0, since, parse_at(st.get("startAt")) or 0))
    quiet = in_quiet(s, now)
    hold_quiet = quiet and s.get("quietMode") == "hold"
    if not st.get("alarmAt"):
        if now < start + s["windowMin"] * 60 or hold_quiet:
            return st, None
        st["alarmAt"] = iso(now)
        st["silent"] = quiet
        return st, "alarm-silent" if quiet else "alarm"
    if now < (parse_at(st["alarmAt"]) or now) + s["graceMin"] * 60 or hold_quiet:
        return st, None
    st["actedAt"], st["action"] = iso(now), s["unanswered"]
    return st, s["unanswered"]


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


def answer(state: dict, iid: str, now: float) -> dict:
    """The alarm was tapped: pause this item's countdown until Brett decides it."""
    items = dict(state.get("items") or {})
    st = dict(items.get(iid) or {})
    st["answeredAt"] = iso(now)
    items[iid] = st
    return {**state, "items": items}


def undo(state: dict, iid: str, now: float) -> dict:
    """An auto-approval undone (the item is re-opened): its clock starts again from now."""
    items = dict(state.get("items") or {})
    items[iid] = {"startAt": iso(now), "undoneAt": iso(now)}
    return {**state, "items": items}


def due_at(item: dict, st: dict | None, s: dict, since: float) -> dict:
    """When the alarm rings and when the switch acts (epoch seconds, None when it won't)."""
    st = st or {}
    if item.get("status") != "waiting" or not s.get("enabled") or not applies(item, s) or st.get("answeredAt") or st.get("actedAt"):
        return {"alarmAt": parse_at(st.get("alarmAt")), "actAt": None}
    start = max(parse_at(item.get("submittedAt")) or 0, since, parse_at(st.get("startAt")) or 0)
    alarm = parse_at(st.get("alarmAt")) or start + s["windowMin"] * 60
    return {"alarmAt": alarm, "actAt": alarm + s["graceMin"] * 60}


def native_config(s: dict) -> dict:
    """What the phone's alarm needs (the AmberX VetoAlarm config shape), sent with the alert."""
    return {"enabled": True, "tone": s["sound"], "volume": s["volume"] / 100, "louder": False, "ringSeconds": 30,
            "repeat": 20 if s["repeat"] else 1, "repeatGapSeconds": 2, "vibration": [0, 800, 400, 800] if s["vibrate"] else [],
            "throughSilent": True, "fullScreen": True}


# ---------------------------------------------------------------- server part

def router_for(h: Any, clock: Callable[[], float] = time.time):
    """h: the plugin module (data_dir, _lock, _items_doc, _submitted, decide_many, _json, _read, _write, _now, cx,
    plugin_services). Returns the router; the ticker starts with it."""
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

    def breakroom(text: str) -> None:
        crew = h.plugin_services.get("axf.crew@1")
        say = getattr(crew, "say", None)
        if callable(say):
            try:
                say(text)
            except Exception:  # noqa: BLE001 — the chat is a courtesy; the item's history is the record
                pass

    def link(iid: str) -> str:
        return f"ui-review?item={iid}"

    def ring(its: list[dict], s: dict, silent: bool) -> None:
        names = ", ".join((it.get("title") or it["id"]) for it in its[:3]) + (f" +{len(its) - 3}" if len(its) > 3 else "")
        act = "auto-approves" if s["unanswered"] == "approve" else "stays waiting"
        h.cx.raise_alert({"source": "ui-review", "severity": "warning" if silent else "critical", "key": f"ui-review-alarm:{its[0]['id']}" if len(its) == 1 else "ui-review-alarm",
                          "title": f"UI Review: {len(its)} item(s) waiting {s['windowMin']} min — {names}",
                          "body": f"Unanswered, it {act} in {s['graceMin']} min. Tap to open it (that pauses the countdown).",
                          "link": link(its[0]["id"]),
                          "meta": {"alarm": not silent, "kind": TAG, "items": [it["id"] for it in its], "native": native_config(s) if not silent else None}})
        fa = h.plugin_services.get("follow-amber@1")
        if fa is not None:
            try:
                fa.show(link(its[0]["id"]), kind="view", highlight=its[0]["id"], say=f"UI Review alarm: {names}", by=BY)
            except Exception:  # noqa: BLE001
                pass

    def run_tick() -> dict:
        s = get_settings()
        now = clock()
        with lock:
            items = h._submitted(h._items_doc())
            st, events = tick(items, get_state(), s, now)
            alarms = [it for ev, it in events if ev == "alarm"]
            quiet_alarms = [it for ev, it in events if ev == "alarm-silent"]
            approve = [it for ev, it in events if ev == "approve"]
            hold = [it for ev, it in events if ev == "hold"]
            stops = [it for ev, it in events if ev == "stop"]
            for ev, it in events:
                log(st, {"event": ev, "item": it["id"], "title": it.get("title", "")})
            put_state(st)
        if alarms:
            ring(alarms, s, False)
        if quiet_alarms:
            ring(quiet_alarms, s, True)
        if approve:
            h.decide_many([it["id"] for it in approve], "approve", AUTO_COMMENT, BY)
            breakroom(f"UI Review: auto-approved after alarm went unanswered — {', '.join(it.get('title') or it['id'] for it in approve)}. Undo: re-open it in UI Review.")
        if hold:
            for it in hold:
                h.note_history(it["id"], {"action": "alarm-unanswered", "status": "waiting", "comment": HOLD_COMMENT}, BY)
        done = [it["id"] for it in approve + stops]
        if done:
            try:
                h.cx.resolve_alerts([f"ui-review-alarm:{x}" for x in done] + (["ui-review-alarm"] if not any(phase(v) == "alarm" for v in st["items"].values()) else []))
            except Exception:  # noqa: BLE001
                pass
        return {"events": [{"event": ev, "item": it["id"]} for ev, it in events]}

    def view() -> dict:
        s = get_settings()
        st = get_state()
        since = parse_at(st.get("since")) or clock()
        items = h._submitted(h._items_doc())
        out = {}
        for it in items:
            v = st.get("items", {}).get(it["id"])
            d = due_at(it, v, s, since)
            if v or d["actAt"]:
                out[it["id"]] = {"phase": phase(v), **{k: iso(t) if t else None for k, t in d.items()}, **({"answeredAt": v.get("answeredAt"), "actedAt": v.get("actedAt"), "action": v.get("action")} if v else {})}
        return {"$axf": TAG, "settings": s, "since": st.get("since"), "now": iso(clock()), "items": out, "log": list(st.get("log") or [])[-50:]}

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

    def one(body: dict) -> str:
        iid = h._s(body.get("id") or body.get("item"), 80)
        if not iid or not any(it.get("id") == iid for it in h._submitted(h._items_doc())):
            raise HTTPException(404, "no such UI Review item")
        return iid

    @r.post("/alarm/answer")
    async def post_answer(request: Request) -> dict:
        """The alarm was tapped (or the item opened from it): the countdown stops until Brett decides."""
        iid = one(await h._json(request))
        with lock:
            st = answer(get_state(), iid, clock())
            log(st, {"event": "answered", "item": iid})
            put_state(st)
        try:
            h.cx.resolve_alerts([f"ui-review-alarm:{iid}", "ui-review-alarm"])
        except Exception:  # noqa: BLE001
            pass
        return {"ok": True, "item": iid, "phase": "answered"}

    @r.post("/alarm/undo")
    async def post_undo(request: Request) -> dict:
        """Undo an auto-approval: re-open the item (back to waiting) and restart its clock."""
        body = await h._json(request)
        iid = one(body)
        with lock:
            v = (get_state().get("items") or {}).get(iid) or {}
        if v.get("action") != "approve":
            raise HTTPException(409, "that item wasn't auto-approved")
        h.decide_many([iid], "reopen", "auto-approval undone", h._s(body.get("by"), 60) or "brett")
        with lock:
            st = undo(get_state(), iid, clock())
            log(st, {"event": "undone", "item": iid})
            put_state(st)
        return {"ok": True, "item": iid}

    @r.post("/alarm/tick")
    def post_tick() -> dict:
        """Run the timer now (the ticker does this every 30 s)."""
        return run_tick()

    def loop() -> None:
        while True:
            time.sleep(TICK_S)
            try:
                run_tick()
            except Exception:  # noqa: BLE001 — one bad tick never stops the alarm
                pass

    def on_submit(item: dict) -> None:
        """A new item: open UI Review on it (Follow Amber; a no-op when off) and tell the phone."""
        s = get_settings()
        if not s["openOnNew"]:
            return
        fa = h.plugin_services.get("follow-amber@1")
        if fa is not None:
            try:
                fa.show(link(item["id"]), kind="view", highlight=item["id"], say=f"New in UI Review: {item.get('name') or item.get('title') or item['id']}", by=BY)
            except Exception:  # noqa: BLE001
                pass
        try:
            h.cx.raise_alert({"source": "ui-review", "severity": "error", "key": f"ui-review-new:{item['id']}",
                              "title": f"UI Review: {item.get('name') or item.get('title') or 'new item'} is waiting",
                              "body": f"Alarm in {s['windowMin']} min if it isn't reviewed." if s["enabled"] else "Waiting for your review.", "link": link(item["id"])})
        except Exception:  # noqa: BLE001
            pass

    r.run_tick = run_tick  # type: ignore[attr-defined]
    r.view = view  # type: ignore[attr-defined]
    r.on_submit = on_submit  # type: ignore[attr-defined]
    r.start = lambda: threading.Thread(target=loop, name="ui-review-alarm", daemon=True).start()  # type: ignore[attr-defined]
    return r
