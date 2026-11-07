#!/usr/bin/env python3
"""Self-test for the calendar's server part, with a fake axHub: recurrence against the shared fixture, REST rules,
reminders once each, mail queued then sent once, held calls never re-sent, the public reply page (signed, expiring,
limited, no leaks), plain email replies, and two-way Google sync.

    python3 apps/console-web/plugins/notes-tasks/test_calendar.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import shutil
import sys
import tempfile
import time
import types
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(ROOT / "apps/console-web/server"), str(ROOT / "framework/python")]
TMP = Path(tempfile.mkdtemp(prefix="axf-calendar-test-"))
os.environ.update({"AXF_AMBERX_CALENDAR_DIR": str(TMP / "hub"), "AXF_CALENDAR_REPLY_SECRET": "test-secret", "AXF_PUBLIC_URL": "https://c.example"})
os.environ.pop("AXHUB_TOKEN", None)

pkg = types.ModuleType("nt")
pkg.__path__ = [str(HERE / "server")]
sys.modules["nt"] = pkg


def load(name: str):
    spec = importlib.util.spec_from_file_location(f"nt.{name}", HERE / "server" / f"{name}.py")
    m = importlib.util.module_from_spec(spec)
    sys.modules[f"nt.{name}"] = m
    spec.loader.exec_module(m)
    return m


load("migrate")
cc = load("calendar_core")
hubcall = load("hubcall")
reply = load("reply")
gs = load("calendar_google")
api = load("calendar_api")

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

fails = 0


def ok(c: bool, what: str) -> None:
    global fails
    print(("ok   " if c else "FAIL ") + what)
    fails += 0 if c else 1


fx = json.loads((HERE / "web/calendar/fixture.json").read_text())
for s in fx["series"]:
    got = cc.series_dates(s["start"], s["repeat"], s["to"])
    ok(got == s["dates"], f"series: {s['name']}" + ("" if got == s["dates"] else f" got {got}"))
for s in fx["status"]:
    reps = {str(i): {**r, "event": "e", "guest": "g"} for i, r in enumerate(s["replies"])}
    ok(cc.guest_status({"id": "g"}, "e", reps) == s["status"], f"status: {s['name']}")

NOW = [datetime(2026, 11, 9, 22, 50, tzinfo=timezone.utc)]  # 5:50pm in New York


class FakeHub:
    def __init__(self) -> None:
        self.services = []
        self.calls = []
        self.jobs = {}
        self.google = {}
        self.hold = set()
        self.seq = 0
        self.mail = []

    def __call__(self, method, params, sid):
        if method == "initialize":
            return {}, "sid"
        name, a = params["name"], params["arguments"]
        if name == "list_services":
            return self.text({"services": [{"id": s} for s in self.services]}), sid
        if name == "get_job":
            return self.text(self.jobs.get(a["job_id"], {"status": "held"})), sid
        tool, args = a["tool"], a["arguments"]
        self.calls.append(tool)
        if tool in self.hold:
            self.seq += 1
            return self.text({"held": True, "job_id": f"job-{self.seq}"}), sid
        if tool == "gmail.send":
            self.mail.append(args)
            return self.text({"id": "m1"}), sid
        if tool == "gmail.search":
            return self.text({"messages": self.mail_in}), sid
        if tool == "gmail.read":
            return self.text({"body": "Yes I'll come\n\nOn Tue someone wrote:\n> old"}), sid
        if tool == "calendar.calendars":
            return self.text({"calendars": [{"id": "primary", "primary": True, "timeZone": "America/New_York"}]}), sid
        if tool == "calendar.list":
            return self.text({"events": list(self.google.values())}), sid
        if tool == "calendar.create":
            self.seq += 1
            gid = f"gc{self.seq}"
            self.google[gid] = {"id": gid, "status": "confirmed", "summary": args["summary"], "description": args.get("description", ""), "location": args.get("location", ""), "start": {"dateTime": args["start"] + "-05:00"}, "end": {"dateTime": args["end"] + "-05:00"}}
            return self.text(self.google[gid]), sid
        if tool == "calendar.update":
            self.google[args["eventId"]]["summary"] = args["summary"]
            return self.text(self.google[args["eventId"]]), sid
        if tool == "calendar.delete":
            self.google.pop(args["eventId"], None)
            return self.text({"deleted": True}), sid
        raise AssertionError(tool)

    mail_in: list = []

    def text(self, body):
        return {"content": [{"type": "text", "text": json.dumps(body)}]}


hub = FakeHub()
hubcall.transport = hub
alerts = []
cal = api.Calendar(lambda: TMP / "data", alerts.append, now=lambda: NOW[0])
app = FastAPI()
app.include_router(cal.router())
app.include_router(cal.reply.router(), prefix="/public/notes-tasks")
c = TestClient(app, raise_server_exceptions=False)


def services(*names) -> None:
    hub.services = list(names)
    hubcall.forget()


# ---- REST rules
r = c.post("/calendar/add", json={"title": "Gym", "start": "2026-11-09T18:00", "end": "2026-11-09T19:00", "tz": "America/New_York", "reminders": [10], "repeat": {"freq": "weekly", "interval": 1, "days": [1, 3], "until": "", "count": 0}})
ok(r.status_code == 200, "add an event")
gym = r.json()["id"]
ok(c.post("/calendar/add", json={"title": "", "start": "2026-11-09T18:00"}).status_code == 400, "no title refused")
ok(c.post("/calendar/add", json={"title": "x", "start": "soon"}).status_code == 400, "a bad time refused")
ok(c.post("/calendar/add", json={"title": "x", "start": "2026-11-09T18:00", "guests": [{"email": "nope"}]}).status_code == 400, "a bad guest address refused")
days = [o["date"] for o in c.get("/calendar/events", params={"from": "2026-11-08", "to": "2026-11-14"}).json()["occurrences"]]
ok(days == ["2026-11-09", "2026-11-11"], "list expands a repeating event")
ok(c.post("/calendar/update", json={"id": "nope", "fields": {}}).status_code == 404, "updating nothing is a 404")
ok(c.post("/calendar/update", json={"id": gym, "fields": {"title": "Gym!", "gcalId": "evil"}}).json().get("gcalId") is None, "update takes only event fields")

# ---- reminders
ok(cal.reminders() == 1, "a reminder fires 10 min before (wall-clock in the event's zone)")
ok(alerts[-1]["source"] == "calendar" and "Gym!" in alerts[-1]["title"], "through the console's alerts")
ok(cal.reminders() == 0, "and only once")
NOW[0] = NOW[0] + timedelta(days=2)
ok(cal.reminders() == 1, "the next occurrence fires on its own")
cc.write("events", {k: {**v, "reminders": []} for k, v in cc.read("events").items()})

# ---- alerts: a calendar reminder reaches the phone by default, nothing else changes
import alerts as alerts_mod  # noqa: E402
ok(alerts_mod.delivery_targets({"source": "calendar", "severity": "info"}, "new") == ["bell", "ntfy", "webpush"], "a reminder reaches the phone by default")
ok(alerts_mod.delivery_targets({"source": "builds", "severity": "info"}, "new") == ["bell"], "other sources keep their rule")

# ---- invites: wait for Gmail, then send once each
ev = c.post("/calendar/add", json={"title": "Dinner <b>", "location": "Al's", "notes": "secret notes", "start": "2026-11-20T19:00", "end": "2026-11-20T21:00", "tz": "America/New_York",
                                   "guests": [{"name": "Sam", "email": "Sam@x.co"}, {"name": "", "email": "pat@x.co"}]}).json()
eid, sam, pat = ev["id"], ev["guests"][0]["id"], ev["guests"][1]["id"]
ok(ev["guests"][0]["email"] == "sam@x.co", "guest addresses lower-cased")
out = c.post("/calendar/mail", json={"id": eid, "kind": "invite"}).json()
ok(out == {"queued": 2, "gmail": False}, "no Gmail on the hub: the invites wait")
ok(c.post("/calendar/mail", json={"id": eid, "kind": "invite"}).json()["queued"] == 0, "no second copy while one waits")
ok(c.post("/calendar/mail", json={"id": eid, "kind": "bogus"}).status_code == 400, "a bad kind is refused")
services("gmail")
hub.hold = {"gmail.send"}
ok(cal.drain() == {"gmail": True, "sent": 2} and len(hub.calls) == 2, "Gmail appears: each invite goes to the hub")
ok({m["status"] for m in cc.read("mail").values()} == {"held"}, "held for Brett")
cal.drain()
ok(len(hub.calls) == 2, "a held email is never sent again")
hub.hold = set()
jobs = {m["job"]: m for m in cc.read("mail").values()}
a, b = list(jobs)
hub.jobs = {a: {"status": "completed", "result": {}}, b: {"status": "denied"}}
cal.settle_mail()
ok(sorted(m["status"] for m in cc.read("mail").values()) == ["failed", "sent"], "approved = sent, denied = failed")
c.post("/calendar/mail", json={"id": eid, "kind": "reminder", "guests": [sam]})
link = re.search(r"https://c\.example(/public/\S+)", hub.mail[-1]["body"]).group(1)
ok(hub.mail[-1]["to"] == "sam@x.co" and hub.mail[-1]["subject"].endswith(f"[#{eid}]"), "the email is tagged with its event")
body = json.dumps(cc.read("mail"))
ok(link.rsplit("/", 1)[-1] not in body, "the personal link isn't kept in the hub tables")

# ---- the public page
page = c.get(link)
ok(page.status_code == 200 and "Dinner &lt;b&gt;" in page.text and "Sam" in page.text, "the page opens, escaped")
ok("secret notes" not in page.text and "pat@x.co" not in page.text, "no notes, no other guests")
ok("default-src 'none'" in page.headers["content-security-policy"] and page.headers["cache-control"] == "no-store" and "noindex" in page.headers["x-robots-tag"], "locked-down headers")
ok(not cc.read("replies"), "opening it changes nothing (mail scanners open links)")
r = c.post(link, content="answer=yes&message=" + "hi%20%3Cthere%3E", headers={"content-type": "application/x-www-form-urlencoded"})
ok(r.status_code == 200 and "Thanks" in r.text, "a guest answers")
ok(list(cc.read("replies").values())[0]["message"] == "hi <there>" and alerts[-1]["key"].startswith("calendar:reply:"), "logged, and the console is told")
g = c.get("/calendar/guests", params={"id": eid}).json()
ok({x["id"]: x["status"] for x in g["guests"]} == {sam: "yes", pat: "invited"}, "status follows the reply")
c.post(link, content="answer=seen", headers={"content-type": "application/x-www-form-urlencoded"})
ok(c.get("/calendar/guests", params={"id": eid}).json()["guests"][0]["status"] == "yes", "seen never takes a yes back")
ok(c.post(link, content="answer=hack", headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 400, "a made-up answer is refused")
ok(c.post(link, content="message=" + "x" * 9000, headers={"content-type": "application/x-www-form-urlencoded"}).status_code == 413, "too long is refused")
tok = link.rsplit("/", 1)[-1]
ok(c.get(f"/public/notes-tasks/reply/{tok[:-2]}xx").status_code == 404, "a forged token is refused")
sec = b"test-secret"
ok(reply.check(sec, reply.mint(sec, "e", "g", 100), now=200) is None, "an expired token is refused")
ok(reply.check(b"other", tok) is None, "a token from another key is refused")
e2 = cc.read("events")
saved = e2[eid]["guests"]
e2[eid]["guests"] = saved[1:]
cc.write("events", e2)
ok(c.get(link).status_code == 404, "a removed guest's link is dead")
e2[eid]["guests"] = saved
cc.write("events", e2)
ok(all(cal.reply.by_token.allow("t", now=1.0) for _ in range(10)) and not cal.reply.by_token.allow("t", now=2.0), "answers are limited per token")
ok(cal.reply.by_token.allow("t", now=4000.0), "the limit passes with time")
cal.reply.by_ip.hits.clear()
codes = [c.get(link).status_code for _ in range(61)]
ok(codes[-1] == 429 and codes[0] == 200, "requests are limited per address")
cal.reply.by_ip.hits.clear()
bad = [c.get("/public/notes-tasks/reply/nope.nope").status_code for _ in range(11)]
ok(bad[-1] == 429, "guessing tokens is limited harder")
cal.reply.by_ip.hits.clear(); cal.reply.bad_ip.hits.clear()
ip = types.SimpleNamespace(headers={"x-forwarded-for": "6.6.6.6, 1.2.3.4"}, client=None)
ok(reply.client_ip(ip) == "1.2.3.4", "a spoofed forwarded header doesn't move the limit")

# ---- a plain email reply
hub.mail_in = [{"id": "z1", "subject": f"Re: You're invited: Dinner [#{eid}]", "from": "Pat <pat@x.co>", "snippet": "yes"},
               {"id": "z2", "subject": f"Re: x [#{eid}]", "from": "stranger@x.co", "snippet": "hello"}]
ok(cal.catch_replies() == 1, "a guest's plain reply is logged, a stranger's isn't")
ok(cal.catch_replies() == 0, "once")
pr = next(x for x in c.get("/calendar/guests", params={"id": eid}).json()["guests"] if x["id"] == pat)
msg = [x for x in cc.read("replies").values() if x["source"] == "email"][0]
ok(pr["status"] == "yes" and msg["message"] == "Yes I'll come", "with what they typed, not the quoted mail")
ok(api.answer_in("Can't make it, sorry") == "no" and api.answer_in("Maybe!") == "maybe" and api.answer_in("Hello there") == "", "plain words read as answers only when clear")

# ---- automatic chasers
cc.write("mail", {})
cc.write("replies", {})
e3 = cc.read("events")
e3[eid]["rsvp"] = {"on": True, "remindHours": [24], "askSeen": False}
cc.write("events", e3)
NOW[0] = datetime(2026, 11, 20, 0, 30, tzinfo=timezone.utc)  # 24 h before 7pm New York
n0 = len(hub.mail)
ok(cal.rsvp_reminders() == 1 and len(hub.mail) == n0 + 2, "a chaser goes to who hasn't answered")
ok(cal.rsvp_reminders() == 0, "once")

# ---- Google
cc.write("events", {})
cc.write("calendars", {"personal": {"id": "personal", "name": "P", "google": "primary"}})
ok(c.post("/calendar/google/sync").json()["pulled"] == 0 and not any(x.startswith("calendar.") for x in hub.calls), "no service yet: sync does nothing")
hub.calls.clear()
services("gmail", "calendar")
hub.google = {"g1": {"id": "g1", "status": "confirmed", "summary": "Flight", "start": {"dateTime": "2026-11-21T14:00:00-05:00"}, "end": {"dateTime": "2026-11-21T16:00:00-05:00"}},
              "g2": {"id": "g2", "status": "confirmed", "summary": "Holiday", "start": {"date": "2026-11-26"}, "end": {"date": "2026-11-27"}}}
r = cal.google.run()
rows = {x["gcalId"]: x for x in cc.read("events").values()}
ok(r["pulled"] == 2 and rows["g1"]["start"] == "2026-11-21T14:00" and rows["g2"]["allDay"] and rows["g2"]["end"] == "2026-11-26T00:00", "pulled in: wall-clock, all-day end inclusive")
hub.calls.clear()
cal.google.run()
ok(hub.calls.count("calendar.update") == 0 and hub.calls.count("calendar.create") == 0, "unchanged = nothing pushed")
hub.google["g1"]["summary"] = "Flight 22"
cal.google.run()
ok(next(x for x in cc.read("events").values() if x.get("gcalId") == "g1")["title"] == "Flight 22", "a change on Google comes here")
mine = c.post("/calendar/add", json={"title": "Mine", "start": "2026-11-22T10:00", "end": "2026-11-22T11:00", "tz": "America/New_York"}).json()["id"]
loop = c.post("/calendar/add", json={"title": "Loop", "start": "2026-11-22T10:00", "end": "2026-11-22T11:00", "repeat": {"freq": "daily", "interval": 1}}).json()["id"]
cal.google.run()
rows = cc.read("events")
ok(rows[mine]["gcalId"].startswith("gc"), "a new event goes to Google")
ok(not rows[loop].get("gcalId"), "a repeating one stays here")
c.post("/calendar/update", json={"id": mine, "fields": {"title": "Mine 2"}})
cal.google.run()
ok(hub.google[rows[mine]["gcalId"]]["summary"] == "Mine 2", "an edit goes to Google")
hub.calls.clear()
cal.google.run()
ok("calendar.update" not in hub.calls, "and only once")
hub.hold = {"calendar.create"}
held = c.post("/calendar/add", json={"title": "Held", "start": "2026-11-23T10:00", "end": "2026-11-23T11:00"}).json()["id"]
cal.google.run()
pending = cc.read("events")[held]["gcalPending"]
ok(pending.startswith("job-"), "a held write keeps its job")
hub.calls.clear()
cal.google.run()
ok("calendar.create" not in hub.calls, "and isn't sent again")
hub.jobs = {pending: {"status": "denied"}}
cal.google.run()
ok(cc.read("events")[held]["gcalPending"] == "denied", "denied is remembered")
hub.calls.clear()
cal.google.run()
ok("calendar.create" not in hub.calls, "a denied write stays denied")
hub.hold = set()
time.sleep(0.01)
gid = cc.read("events")[mine]["gcalId"]
c.delete("/calendar/remove", params={"id": mine})
ok(cc.read("events")[mine]["deletedAt"] != "", "deleting a Google event leaves a tombstone")
cal.google.run()
ok(mine not in cc.read("events") and gid not in hub.google, "then it goes from both sides")
hub.google.pop("g2")
cal.google.run()
ok(not any(x.get("gcalId") == "g2" for x in cc.read("events").values()), "gone from Google = gone here")

shutil.rmtree(TMP, ignore_errors=True)
print(f"{fails} failed" if fails else "all good")
sys.exit(1 if fails else 0)
