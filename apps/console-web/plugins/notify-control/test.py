"""Notifications panel: the decision order, the alert hub seam end to end, the routes, and the inventory staying true.

    python apps/console-web/plugins/notify-control/test.py
"""
from __future__ import annotations

import json
import os
import re
import sys
import tempfile
import types
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parents[1] / "server"))
os.environ["AXF_NOTIFY_DATA_DIR"] = tempfile.mkdtemp()
os.environ["AXF_TIMEZONE"] = "America/New_York"

import importlib.util  # noqa: E402
import threading  # noqa: E402

from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import alerts as A  # noqa: E402
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

checks = 0


def ok(v: object, what: str) -> None:
    global checks
    checks += 1
    if not v:
        raise SystemExit(f"FAILED: {what}")


spec = importlib.util.spec_from_file_location("notify_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["notify_server"] = mod
spec.loader.exec_module(mod)
C = sys.modules["notify_server.core"]

# ---- pure decisions

reg = C.read_registry(HERE / "registry.json")
apps = {c["id"]: c["app"] for c in reg["channels"]}
chans = [c["id"] for c in reg["channels"]]
plain = C.normal({"id": "x", "label": "X", "match": {"source": "x"}}, chans)
guard = C.normal({"id": "g", "label": "G", "guarded": True, "enforced": "device", "only": ["amberx"]}, chans)
base = {"master": True, "apps": {}, "types": {}}


def used(v: dict) -> set:
    return {c for c, on in v["channels"].items() if on}


ok(used(C.decide(plain, base, {}, False, apps)) == {"banner", "amberx", "webpush"}, "defaults: what alerts always did, sound and pop-up off")
ok(C.normal({"id": "b", "label": "B", "enforced": "browser", "only": ["sound"]}, chans)["defaults"]["sound"], "a sound-only sender keeps ringing")
ok(C.normal({"id": "c", "label": "C", "channels": {"popup": True}}, chans)["defaults"]["popup"], "a type can opt in")
off = C.decide(plain, {**base, "master": False}, {}, False, apps)
ok(not off["allow"] and off["why"] == "Master switch is off", "master off")
ok(C.decide(guard, {**base, "master": False}, {}, False, apps)["allow"], "guarded ignores master")
ok(C.decide(guard, {**base, "apps": {"amberx": False}}, {}, False, apps)["allow"], "guarded ignores the app switch")
ok("amberx" not in used(C.decide(plain, {**base, "apps": {"amberx": False}}, {}, False, apps)), "app off drops its channels")
ok("banner" in used(C.decide(plain, {**base, "apps": {"amberx": False}}, {}, False, apps)), "app off leaves the others")
t_off = {**base, "types": {"x": {"enabled": False}}}
ok(C.decide(plain, t_off, {}, False, apps)["why"] == "Switched off", "type off")
linked = C.normal({"id": "l", "label": "L", "setting": "notify.x"}, chans)
ok(C.decide(linked, base, {"notify.x": False}, False, apps)["why"] == "Off in Claude settings", "linked setting off")
ok(used(C.decide(plain, {**base, "types": {"x": {"priority": "low"}}}, {}, False, apps)) == {"banner"}, "low = banner only")
q = C.decide(plain, base, {}, True, apps)
ok(q["held"] and used(q) == {"banner"} and q["why"] == "Held for quiet hours", "quiet holds what interrupts")
ok(not C.decide(plain, {**base, "types": {"x": {"priority": "urgent"}}}, {}, True, apps)["held"], "urgent goes through quiet hours")
ok(not C.decide(guard, base, {}, True, apps)["held"], "guarded goes through quiet hours")
fixed = C.normal({"id": "f", "label": "F", "enforced": "required", "only": ["amberx"]}, chans)
ok(C.decide(fixed, {**base, "master": False}, {}, False, apps)["allow"], "a required notification can't be switched")

at = lambda h, m: datetime(2026, 11, 6, h, m)  # noqa: E731
ok(C.in_window(at(23, 0), "22:00", "07:00") and C.in_window(at(6, 59), "22:00", "07:00"), "window past midnight")
ok(not C.in_window(at(7, 0), "22:00", "07:00") and not C.in_window(at(21, 59), "22:00", "07:00"), "outside the window")
ok(C.in_window(at(12, 0), "09:00", "17:00") and not C.in_window(at(12, 0), "09:00", "09:00"), "same day; equal = never")

ts = C.build_types(reg, C.plugin_types(HERE.parent))
ok(C.classify(ts, "deploys", "deployed:r:w:b")["id"] == "deploy.done", "longest prefix wins")
ok(C.classify(ts, "deploys", "deploys:r:w:b")["id"] == "deploy.failed", "whole source")
ok(C.classify(ts, "system", "system:claude-code-token")["id"] == "account.claude", "accounts split off health")
ok(C.classify(ts, "nobody", "z") is None, "unknown source")
ok(C.classify(ts, "ci", "z", "builds.done")["id"] == "builds.done", "forced type (test send)")
for bad, why in (({"priority": "loud"}, "bad priority"), ({"channel": "fax"}, "bad channel"), ({}, "empty")):
    try:
        C.clean_patch(plain, bad)
        ok(False, why)
    except ValueError:
        ok(True, why)
try:
    C.clean_patch(guard, {"channel": "sound"})
    ok(False, "a channel the type can't use")
except ValueError:
    ok(True, "a channel the type can't use")

ok(not any(t["defaults"].get("sound") or t["defaults"].get("popup") for t in ts if t["enforced"] == "gate" and len(t["allowed"]) > 1), "no alert starts beeping or popping up")

# ---- the inventory stays true: every source raised anywhere in the repo is in the registry

ROOT = HERE.parents[3]
found: set[str] = set()
pat = re.compile(r"""["']?source["']?\s*:\s*["']([a-z][a-z0-9-]*)["'][^\n]*\b(?:severity|key)\b|ALERT_SOURCE\s*=\s*["']([a-z-]+)["']""")
scan = [*(ROOT / "apps/console-web/plugins").glob("*/server/*.py"), *(ROOT / "apps/console-web/plugins").glob("*/land/*core.mjs"),
        *(ROOT / "apps/console-web/plugins").glob("*/land/merge-queue.mjs"), ROOT / "apps/console-web/server/alerts.py"]
for f in scan:
    if f.parent.parent == HERE or "test" in f.name:
        continue
    text = f.read_text(errors="replace")
    if "raise_alert" not in text and "ALERT_SOURCE" not in text and "/api/alerts" not in text and "alertKey" not in text:
        continue
    found |= {a or b for a, b in pat.findall(text)}
known = {(t["match"] or {}).get("source") for t in ts}
missing = sorted(s for s in found if s not in known)
ok(len(found) >= 12, f"the scan still finds senders ({sorted(found)})")
ok(not missing, f"sources raised in code but not in any registry: {missing}")
ok(len({t["id"] for t in ts}) == len(ts), "type ids unique")
ok(all(t["group"] in {g["id"] for g in reg["groups"]} for t in ts), "every type is in a known group")

# ---- the hub seam, end to end

hub = A.AlertHub(Path(tempfile.mkdtemp()))
cx.set_context(raise_alert=lambda i: hub.raise_alert(i)[0], resolve_alerts=hub.resolve, alerts_changed=hub.touch)
owner_flag = {"on": False}
plugin_services.provide("control@1", types.SimpleNamespace(owner=lambda r: owner_flag["on"]), folder="fake-control")
store: dict = {"notify.quietHours": False, "notify.quietStart": "22:00", "notify.quietEnd": "07:00", "notify.buildDone": True}


class FakeSettings:
    def get(self) -> dict:
        return {"values": dict(store)}

    def set(self, values: dict, by: str) -> dict:
        store.update(values)
        return {"ok": True}


plugin_services.provide("axf.claude-settings@1", FakeSettings(), folder="fake-settings")
mod._refresh_settings()
app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)


def raise_it(**kw) -> tuple:
    return hub.raise_alert({"source": "ci", "severity": "error", "title": "T", "key": "ci:r:w:b", **kw})


def phone() -> list:
    return [a["key"] for a in hub.snapshot(phone=True)["alerts"] if not a["ack"] and not a["resolved"]]


alert, _, targets = raise_it()
ok(alert and "bell" in targets, "default: delivered as before")
ok("ci:r:w:b" in phone(), "default: reaches the phone")
ok(hub.snapshot()["alerts"][0]["notify"]["type"] == "ci.failed", "alerts carry their decision")
ok(hub.snapshot()["unread"] == 1, "counts as unread")

r = c.post("/set", json={"type": "ci.failed", "channel": "amberx", "on": False})
ok(r.status_code == 200 and "ci:r:w:b" not in phone(), "AmberX off: gone from the phone at once")
ok(hub.snapshot()["unread"] == 1, "still in the banner")
v0 = hub.version
c.post("/set", json={"type": "ci.failed", "channel": "banner", "on": False})
ok(hub.version > v0, "a change wakes the streams")
s = hub.snapshot()
ok(s["unread"] == 0 and s["alerts"][0]["ack"], "banner off: kept, already read")
ok(hub.items[0]["ack"] is False, "the stored alert isn't changed: turning it back on brings it back")
c.post("/reset", json={"type": "ci.failed", "confirm": "reset"})

c.post("/master", json={"on": False})
_, _, t2 = raise_it(key="ci:other")
ok(t2 == [] and len(hub.items) == 2, "master off: nothing delivered, nothing lost")
ok(any(x["key"] == "ci:other" and not x["allow"] for x in c.get("/recent").json()["items"]), "the block shows in recent")
ok(hub.snapshot(phone=True)["notify"]["off"] == ["amberx.auto-approved"], "guarded device types stay on with master off")
c.post("/master", json={"on": True})

c.post("/app", json={"app": "amberx", "on": False})
ok(not phone(), "AmberX switched off as an app")
c.post("/app", json={"app": "amberx", "on": True})

hub.raise_alert({"source": "builds", "severity": "success", "title": "Built", "key": "built:a"})
ok("built:a" in phone(), "build done reaches the phone though AmberX ignores success")
ok(next(a for a in hub.snapshot(phone=True)["alerts"] if a["key"] == "built:a")["severity"] == "warning", "promoted for the phone")
hub.raise_alert({"source": "maintenance", "severity": "info", "title": "Note", "key": "maintenance:jobs"})
ok(next((a for a in hub.snapshot(phone=True)["alerts"] if a["key"] == "maintenance:jobs"), {}).get("severity") == "info", "others keep their severity")
hub.resolve(["built:a"])
ok(any(a["key"] == "built:a" and a["resolved"] for a in hub.snapshot(phone=True)["alerts"]), "resolved ones still reach the phone, so it clears them")

store["notify.buildDone"] = False
mod._refresh_settings()
ok(c.get("/check", params={"type": "builds.done"}).json()["why"] == "Off in Claude settings", "the Claude setting counts")
c.post("/set", json={"type": "builds.done", "enabled": True})
ok(store["notify.buildDone"] is True, "the panel writes the same switch")

hub.raise_alert({"source": "somebody-new", "severity": "error", "title": "New", "key": "n"})
ids = [t["id"] for t in c.get("/types").json()["types"]]
ok("other.somebody-new" in ids, "an unregistered source shows up to be named")
ok("n" in phone(), "and still works")
hub.raise_alert({"source": "somebody-quiet", "severity": "info", "title": "Q", "key": "q"})
ok(next((a for a in hub.snapshot(phone=True)["alerts"] if a["key"] == "q"), {}).get("severity") == "info", "an unregistered info alert stays what it was")

# guarded
r = c.post("/set", json={"type": "amberx.veto", "enabled": False})
ok(r.status_code == 403, "a session can't mute the veto notice")
r = c.post("/set", json={"type": "amberx.veto", "channel": "amberx", "on": False})
ok(r.status_code == 403, "nor through its channel")
ok(c.post("/set", json={"type": "amberx.veto", "enabled": True}).status_code == 200, "turning it up is fine")
owner_flag["on"] = True
ok(c.post("/set", json={"type": "amberx.veto", "enabled": False}).status_code == 200, "Brett's click can")
ok("amberx.veto" in hub.snapshot(phone=True)["notify"]["off"], "the phone is told")
c.post("/reset", json={"type": "amberx.veto", "confirm": "reset"})
owner_flag["on"] = False
ok(c.post("/set", json={"type": "amberx.wake", "enabled": False}).status_code == 400, "a required one can't be changed")
ok(c.post("/test", json={"type": "amberx.wake"}).status_code == 400, "nor tested")

# quiet hours: the end of them lets a held alert through, because the phone view is live
c.post("/quiet", json={"enabled": True, "start": "00:00", "end": "23:59"})
ok(store["notify.quietHours"] is True and store["notify.quietStart"] == "00:00", "quiet hours live in Claude settings")
mod_quiet = mod.quiet_now
mod.quiet_now = lambda at=None: True
_, _, t3 = raise_it(key="ci:quiet")
ok("webpush" not in t3 and "ci:quiet" not in phone(), "quiet: held")
ok(c.get("/check", params={"type": "amberx.approval"}).json()["channels"]["amberx"], "quiet: approvals still buzz")
mod.quiet_now = lambda at=None: False
ok("ci:quiet" in phone(), "quiet over: it reaches the phone")
mod.quiet_now = mod_quiet
ok(c.post("/quiet", json={"start": "25:00"}).status_code == 400, "bad time")
c.post("/quiet", json={"enabled": False})

# test send
r = c.post("/test", json={"type": "ui-review.ready"}).json()
ok("amberx" in r["sent"] and any(a["key"] == "notify-test:ui-review.ready" for a in hub.snapshot()["alerts"]), "test send goes through the real path")
c.post("/set", json={"type": "ui-review.ready", "enabled": False})
r = c.post("/test", json={"type": "ui-review.ready"}).json()
ok(r["sent"] == [] and r["why"] == "Switched off", "test send tells the truth when it's off")
ok(c.post("/reset", json={}).status_code == 400, "reset needs its confirm")
ok(c.post("/reset", json={"confirm": "reset"}).json()["counts"]["off"] == 0, "reset everything")
ok(c.post("/set", json={"type": "nope", "enabled": True}).status_code == 404, "unknown type")

svc = plugin_services.get("axf.notify@1")
ok(svc.allowed("nope", "banner") is True, "a type nobody knows stays allowed")
svc.register([{"id": "late.type", "label": "Late", "group": "other", "app": "console", "source": "x", "match": {"source": "late"}}])
ok(mod.type_of("late", "k")["id"] == "late.type", "register at run time")

# no panel or a broken panel: the hub works as it always did
plugin_services._services.pop("axf.notify@1")
a2, _, t4 = raise_it(key="ci:nogate")
ok(a2 and "bell" in t4 and "notify" not in hub.snapshot()["alerts"][0], "plugin gone: untouched")
broken = types.SimpleNamespace(check=lambda i: 1 / 0, view=lambda *a: 1 / 0, device_off=lambda: 1 / 0)
plugin_services.provide("axf.notify@1", broken, folder="notify-control")
a3, _, t5 = raise_it(key="ci:broken")
ok(a3 and "bell" in t5 and hub.snapshot(phone=True)["notify"]["off"] == [], "plugin broken: nothing lost")

# the phone reader
r0 = A.router_for(hub, lambda: None)
app2 = FastAPI()
app2.include_router(r0)
c2 = TestClient(app2)
plugin_services.provide("axf.notify@1", mod.Notify(), folder="notify-control")
ok("notify" in c2.get("/api/alerts", headers={"user-agent": "Dalvik/2.1.0 (Linux; U; Android 16)"}).json(), "AmberX's client gets the phone view")
ok("notify" in c2.get("/api/alerts", params={"view": "phone"}).json(), "or asks for it")
ok("notify" not in c2.get("/api/alerts", headers={"user-agent": "Mozilla/5.0"}).json(), "a browser gets the full list")

# ---- groups, triggers, commands

R = sys.modules["notify_server.rules"]
from datetime import datetime  # noqa: E402

sat = datetime(2026, 11, 7, 12, 0)  # a Saturday, noon
tr = {"name": "Twice", "on": True, "effect": "only", "event": {"types": ["x"], "groups": [], "source": "", "keyPrefix": "", "severity": ""}, "conditions": [],
      "threshold": {"count": 2, "minutes": 10}, "schedule": {"days": [], "start": "", "end": ""}}
alert = {"type": "x", "source": "x", "key": "k", "severity": "error", "title": "Build broke", "meta": {"percent": 90}}

for c_, want, what in [({"field": "meta.percent", "op": "gte", "value": 80}, True, "a number from meta"), ({"field": "meta.percent", "op": "lte", "value": 80}, False, "at most"),
                       ({"field": "title", "op": "contains", "value": "broke"}, True, "contains ignores case"), ({"field": "meta.nope", "op": "eq", "value": 1}, False, "a missing field isn't equal"),
                       ({"field": "meta.nope", "op": "ne", "value": 1}, True, "a missing field is not equal"), ({"field": "severity", "op": "not-contains", "value": "err"}, False, "not contains")]:
    ok(R.holds(R.clean_condition(c_), alert) is want, f"condition: {what}")
ok(R.in_schedule({"days": ["sat"], "start": "", "end": ""}, sat, C.in_window), "schedule: the day")
ok(not R.in_schedule({"days": ["mon"], "start": "", "end": ""}, sat, C.in_window), "schedule: not the day")
ok(not R.in_schedule({"days": [], "start": "13:00", "end": "14:00"}, sat, C.in_window), "schedule: outside the hours")
ok(R.watches({**tr, "event": {**tr["event"], "types": [], "severity": "warning"}}, alert, {}), "severity: an error is warning or worse")
ok(not R.watches({**tr, "event": {**tr["event"], "types": [], "severity": "critical"}}, alert, {}), "severity: an error isn't critical")
ok(R.watches({**tr, "event": {**tr["event"], "types": [], "groups": ["g"]}}, alert, {"g": {"types": ["x"]}}), "event: through a group")

hits: dict = {}
ok(R.apply({"t": tr}, {}, alert, sat, C.in_window, hits, 1000.0)["hold"].startswith("Waiting on rule"), "threshold: the first one waits")
ok(R.apply({"t": tr}, {}, alert, sat, C.in_window, hits, 1100.0)["hold"] == "", "threshold: the second one goes")
ok(hits["t"] == [], "threshold: firing starts the count again")
R.apply({"t": tr}, {}, alert, sat, C.in_window, hits, 2000.0)
ok(R.apply({"t": tr}, {}, alert, sat, C.in_window, hits, 2000.0 + 601)["hold"], "threshold: a hit older than the window doesn't count")
mute = {**tr, "effect": "mute", "threshold": {"count": 1, "minutes": 10}}
ok(R.apply({"m": mute}, {}, alert, sat, C.in_window, {})["hold"].startswith("Muted by rule"), "mute holds it")
ok(R.apply({"m": {**mute, "on": False}}, {}, alert, sat, C.in_window, {})["hold"] == "", "a rule that's off does nothing")
loud = {**mute, "effect": "raise", "title": "Hey", "body": "", "severity": "error"}
ok([f["id"] for f in R.apply({"r": loud}, {}, alert, sat, C.in_window, {})["fire"]] == ["r"], "raise fires and holds nothing")

ok(C.decide(plain, {**base, "groups": {"g": {"name": "Mine", "on": False, "types": ["x"]}}}, {}, False, apps)["why"] == "Group Mine is off", "a group that's off stops its types")
ok(C.decide(guard, {**base, "groups": {"g": {"name": "Mine", "on": False, "types": ["g"]}}}, {}, False, apps)["allow"], "a group never stops an approval")
ok(R.commands_for({"id": "g", "guarded": True}, {}, "view:approvals") == [{"label": "Approve", "kind": "approve", "target": "view:approvals", "icon": "check"}], "a held call has Approve, on its own link")
cmds = {"g": {"on": True, "types": ["x"], "commands": [{"label": "Logs", "kind": "console", "target": "terminal.claude", "icon": ""}]}}
ok([c_["label"] for c_ in R.commands_for({"id": "x"}, cmds, "")] == ["Logs"], "a group's own commands")
ok(R.commands_for({"id": "x"}, {"g": {**cmds["g"], "on": False}}, "") == [], "a group that's off brings none")
ok(R.commands_for({"id": "x", "commands": [{"label": "Fix conflicts now", "kind": "open", "target": "settings:push-banner"}]}, {}, "https://x")[0]["target"] == "settings:push-banner", "a type brings its own button")

ids = {"x"}
for bad, what in [({"name": ""}, "no name"), ({"name": "a", "types": ["nope"]}, "unknown type"), ({"name": "a", "commands": [{"label": "b", "kind": "shell", "target": "rm"}]}, "a kind that doesn't exist"),
                  ({"name": "a", "commands": [{"label": "b", "kind": "console", "target": ""}]}, "a console command with no target"), ({"name": "a", "id": "Bad Id"}, "a bad id")]:
    try:
        R.clean_group(bad, ids, {})
        ok(False, f"group refused: {what}")
    except ValueError:
        ok(True, f"group refused: {what}")
ev = {"event": {"types": ["x"]}}
for bad, what in [({"name": "a"}, "watches nothing"), ({"name": "a", **ev, "effect": "wipe"}, "a bad effect"), ({"name": "a", **ev, "threshold": {"count": 0}}, "a zero threshold"),
                  ({"name": "a", **ev, "schedule": {"start": "25:00", "end": "26:00"}}, "bad hours"), ({"name": "a", **ev, "schedule": {"days": ["someday"]}}, "a bad day"),
                  ({"name": "a", **ev, "effect": "raise"}, "raise with no title"), ({"name": "a", **ev, "conditions": [{"field": "x y", "op": "eq", "value": 1}]}, "a bad field"),
                  ({"name": "a", **ev, "conditions": [{"field": "title", "op": "gte", "value": "lots"}]}, "gte on words")]:
    try:
        R.clean_trigger(bad, ids, {}, {})
        ok(False, f"trigger refused: {what}")
    except ValueError:
        ok(True, f"trigger refused: {what}")

# the same through REST, on the real gate
one = next(t["id"] for t in mod.all_types() if not t["guarded"] and t["enforced"] == "gate" and t.get("match"))
tp = next(t for t in mod.all_types() if t["id"] == one)
src = tp["match"]["source"]
kp = tp["match"].get("keyPrefix") or ""
r = c.post("/group", json={"name": "My builds", "types": [one], "commands": [{"label": "Terminal", "kind": "console", "target": "terminal.claude"}]})
ok(r.status_code == 200 and r.json()["id"] == "my-builds", "POST group makes one, with an id from its name")
gone = lambda: mod.alert_verdict({"source": src, "key": kp + "a", "title": "t"})  # noqa: E731
ok(gone()["actions"][0]["label"] == "Terminal", "the group's command is on the notification")
ok(c.post("/group", json={"name": "bad", "types": ["nope"]}).status_code == 400, "POST group says what is wrong")
c.post("/group", json={"id": "my-builds", "on": False})
ok(c.get("/groups").json()["groups"]["my-builds"]["types"] == [one], "changing one field keeps the others")
ok(gone()["why"] == "Group My builds is off" and not gone()["allow"], "group off: the gate stops it")
c.post("/group", json={"id": "my-builds", "on": True})
r = c.post("/trigger", json={"name": "Twice", "effect": "only", "event": {"groups": ["my-builds"]}, "threshold": {"count": 2, "minutes": 5}})
ok(r.status_code == 200 and r.json()["id"] == "twice", "POST trigger")
gate = mod.Notify()
first = gate.check({"source": src, "key": kp + "b", "title": "one"})
ok(first["allow"] is False and first["why"] == "Waiting on rule: Twice", "the first raise is held, and says why")
ok(not gate.view([{"source": src, "key": kp + "b", "title": "one"}])[0]["notify"]["channels"].get("banner"), "readers see the same answer")
second = gate.check({"source": src, "key": kp + "b", "title": "two"})
ok(second["allow"] is True, "the second raise goes")
ok(c.post("/group-remove", json={"id": "my-builds"}).status_code == 409, "a group a rule watches can't be removed")
t = c.post("/trigger-test", json={"id": "twice", "alert": {"source": src, "key": kp + "c", "title": "x"}}).json()
ok(t["watches"] and t["steps"]["threshold"] is False, "trigger-test explains each step")
ok(c.get("/triggers").json()["triggers"]["twice"]["hits"] == 0, "and counts nothing")
c.post("/trigger", json={"id": "twice", "effect": "raise", "title": "Twice now", "threshold": {"count": 1, "minutes": 5}})
sent: list = []
real_raise, cx.raise_alert = cx.raise_alert, lambda a: sent.append(a)
gate.check({"source": src, "key": kp + "d", "title": "go"})
for th in threading.enumerate():
    if th.name == "notify-rule":
        th.join(2)
cx.raise_alert = real_raise
ok(sent and sent[0]["title"] == "Twice now" and sent[0]["meta"]["notifyRule"] == "twice", "a raise rule sends its own notification")
hits_before = dict(mod._hits)
gate.check({**sent[0], "source": src, "key": kp + "d"})
ok(mod._hits == hits_before, "a rule's own notification doesn't run the rules again")
held = next((t for t in mod.all_types() if t["guarded"] and t["enforced"] == "gate"), None)
if held:
    c.post("/trigger", json={"name": "Mute it", "effect": "mute", "event": {"types": [held["id"]]}})
    ok(not gate.check({"source": held["match"]["source"], "key": held["match"].get("keyPrefix", "") + "z", "title": "veto"}).get("why", "").startswith("Muted"), "no rule mutes an approval")
    c.post("/trigger-remove", json={"id": "mute-it"})
ok(c.post("/trigger-remove", json={"id": "twice"}).status_code == 200 and c.post("/trigger-remove", json={"id": "twice"}).status_code == 404, "POST trigger-remove")
ok(c.post("/group-remove", json={"id": "my-builds"}).status_code == 200, "POST group-remove")
ok("userGroups" in c.get("/state").json() and "ruleOptions" in c.get("/state").json(), "the panel gets all of it")

print(f"notify-control: {checks} checks passed")
