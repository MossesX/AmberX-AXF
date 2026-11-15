"""Phone Connect server tests: the Python port replays the phone-connect@1 golden fixture, then the routes end to end
(pairing with personOnly, the command queue with acks, the recorder's straight approval, auto-approval rules, the
amberx_* aliases, settings and the overlay).
  python3 apps/console-web/plugins/phone-connect/test.py
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_PHONE_CONNECT_DIR"] = tempfile.mkdtemp()
os.environ["AXF_PHONE_RECORDER_NO_WORKER"] = "1"
sys.path.insert(0, str(HERE.parent))

C = importlib.import_module("phone-connect.server.core")
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    assert cond, what
    n += 1


# ------------------------------------------------------------------ the golden fixture (framework/spec/fixtures/phone-connect.json)
fx = json.loads((REPO / "framework/spec/fixtures/phone-connect.json").read_text())
I, O = fx["in"], fx["out"]
AT, LATER, MUCH_LATER, NEXT_DAY = I["AT"], I["LATER"], I["MUCH_LATER"], I["NEXT_DAY"]
HELLO, PAIRED = I["HELLO"], I["PAIRED"]

pairing = C.issue_pairing("K7MP3QRX", AT, "brett")
ok(pairing == O["pairing"]["issued"], f"issue_pairing matches the reference ({pairing})")
dev, done = C.confirm_pairing(pairing, HELLO, LATER, "brett")
ok(dev == O["pairing"]["confirmed"]["device"] and done == O["pairing"]["confirmed"]["pairing"], "confirm_pairing matches the reference")


def err_of(fn):
    try:
        fn()
    except C.PhoneError as e:
        return {"ok": False, "error": e.as_dict()}
    return None


ok(err_of(lambda: C.confirm_pairing(pairing, {**HELLO, "code": "WRONGCOD"}, LATER, "brett")) == O["pairing"]["wrongCode"], "wrong code: denied, same words")
ok(err_of(lambda: C.confirm_pairing(pairing, HELLO, "2026-11-15T14:10:01Z", "brett")) == O["pairing"]["expired"], "expired: timeout, same words")
ok(err_of(lambda: C.confirm_pairing(C.end_pairing(pairing, "cancel", LATER), HELLO, LATER, "brett")) == O["pairing"]["nothingWaiting"], "nothing waiting: not_found")
ok(err_of(lambda: C.confirm_pairing(pairing, {"code": "K7MP3QRX", "deviceId": "x"}, LATER, "brett"))["error"]["code"] == O["pairing"]["notADevice"]["error"]["code"], "not a device: invalid")
ok(err_of(lambda: C.confirm_pairing(C.issue_pairing("K7MP3QRX", AT, "brett", "phone-fedcba9876543210"), HELLO, LATER, "brett")) == O["pairing"]["otherPhone"], "another phone: denied")
ok(C.end_pairing(pairing, "expire", "2026-11-15T14:10:01Z") == O["pairing"]["expiredRecord"], "expired record")
ok([C.pairing_expired(pairing, LATER), C.pairing_expired(pairing, MUCH_LATER)] == O["pairing"]["expiredFlag"], "expiry flag")
machine = {f"{s}:{e}": C.transition(s, e) for s in C.PAIRING_STATES for e in ("issue", "confirm", "expire", "cancel", "revoke", "forget")}
ok(machine == O["pairing"]["machine"], "the pairing state machine matches")
ok(C.device_from_hello(HELLO, AT) == O["pairing"]["fromHello"], "device from hello")

offline = {**PAIRED, "lastSeenAt": "2026-11-15T13:47:00Z"}
revoked = C.revoke(PAIRED, NEXT_DAY, "brett", "phone sold")
ok(revoked == O["pairing"]["revoked"]["device"], "revoke matches")
pres = O["presence"]
ok([C.is_online(PAIRED, LATER), C.presence(PAIRED, LATER)] == pres["online"], "online")
ok([C.is_online(PAIRED, "2026-11-15T14:00:45Z"), C.is_online(PAIRED, "2026-11-15T14:00:46Z")] == pres["edge"], "45 s edge")
ok(C.presence(offline, AT) == pres["offline"] and C.presence(offline, "2026-11-15T16:00:00Z") == pres["hours"] and C.presence(offline, "2026-11-18T16:00:00Z") == pres["days"], "offline words")
ok(C.presence({**PAIRED, "lastSeenAt": ""}, AT) == pres["neverSeen"] and C.presence(revoked, NEXT_DAY) == pres["revoked"], "never seen, revoked")
ok(C.is_online(PAIRED, "2026-11-15T13:59:00Z") == pres["clockBack"], "a clock going back is not online")

for k, (raw, opts) in I["URL_CASES"].items():
    want = O["openUrl"][k]
    try:
        got = {"ok": True, "url": C.open_url_allowed(raw, opts.get("policy", "own"), opts.get("allowlist"))}
    except C.PhoneError as e:
        got = {"ok": False, "code": e.code}
    ok(got["ok"] == want["ok"] and (not want["ok"] or got["url"].rstrip("/") == want["url"].rstrip("/")) and (want["ok"] or got["code"] == want["error"]["code"]), f"open_url {k}: {got} vs {want}")

for k, (o, tool) in I["AUTO"].items():
    ok(C.auto_approves(bool(o.get("approveAll")), bool(o.get("listOn")), o.get("list", ""), tool) == O["commands"]["autoApproves"][k], f"auto_approves {k}")

for k, c in I["COMMANDS"].items():
    want = O["commands"]["norm"][k]
    got = C.norm_command(c, AT)
    ok({x: got.get(x) for x in ("tool", "arguments", "policy", "from", "alias")} == {x: want.get(x) for x in ("tool", "arguments", "policy", "from", "alias")}, f"norm_command {k}")

# ------------------------------------------------------------------ the routes
from fastapi import FastAPI, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

srv = importlib.import_module("phone-connect.server")
hub = importlib.import_module("phone-connect.server.hub")
app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):  # the wall: x-test-brett = Brett signed in on the phone / in his browser
    if request.headers.get("x-test-brett"):
        request.state.axf_user = types.SimpleNamespace(name="brett", via="session", admin=True)
    else:
        request.state.axf_user = types.SimpleNamespace(name="console-token", via="token", admin=True)
    return await call_next(request)

app.include_router(srv.router, prefix="/p")
c = TestClient(app)
BRETT = {"x-test-brett": "1"}

st = c.get("/p/status").json()
ok(st["device"] is None and st["presence"] == "not paired", "nothing paired at first")
code = c.post("/p/pair", json={}).json()["code"]
ok(len(code) == 8 and c.get("/p/pair").json()["pairing"]["code"] == code, "a code is issued and waiting")
qr = c.get("/p/pair/qr.svg")
ok(qr.status_code in (200, 503), "the QR answers (503 only without the engine)")
hello = {**HELLO, "code": code}
r = c.post("/p/pair/claim", json=hello)
ok(r.status_code == 403 and r.json()["error"]["personOnly"], "a machine can't claim a pairing: personOnly")
r = c.post("/p/pair/claim", json={**hello, "code": "ZZZZZZZZ"}, headers=BRETT)
ok(r.status_code == 403 and r.json()["error"]["code"] == "denied", "a wrong code is denied")
r = c.post("/p/pair/claim", json=hello, headers=BRETT)
ok(r.status_code == 200 and r.json()["state"] == "paired" and r.json()["owner"] == "brett", "Brett's own session pairs it")
DID = r.json()["deviceId"]
ok(c.get("/p/devices").json()["devices"][0]["online"] is True, "online right after pairing")

r = c.post("/p/open", json={"url": "https://evil.example.com/"})
ok(r.status_code == 403, "open_url refuses another site")
r = c.post("/p/open", json={"url": "http://console.amberxai.com/"})
ok(r.status_code == 403, "open_url refuses plain http")
cmd = c.post("/p/open", json={"url": "https://console.amberxai.com/?x=1", "via": "mcp"}).json()
ok(cmd["status"] == "queued" and cmd["command"]["arguments"]["browser"] == "chrome", "open_url queued, Chrome by default")
note = c.post("/p/notify", json={"kind": "alert", "title": "Main is red"}).json()
ok(note["command"]["arguments"]["priority"] == "high", "an alert is high priority")
c.post("/p/settings", json={"notify": {"fyi": False}})
ok(c.post("/p/notify", json={"kind": "fyi", "title": "x"}).json()["status"] == "skipped", "a switched-off type is skipped")
nxt = c.post(f"/p/devices/{DID}/next", json={"state": {"recorder@1": {"running": True, "session": "Review", "part": 2}}}).json()
ok(len(nxt["commands"]) == 2 and "rules" in nxt and "overlay" in nxt["settings"], "the phone's poll takes the queue, settings, rules and overlay")
ok(c.get(f"/p/commands/{cmd['command']['id']}").json()["status"] == "delivered", "delivered after the poll")
a = c.post(f"/p/commands/{cmd['command']['id']}/ack", json={"deviceId": DID, "ok": True, "data": {"opened": "browser"}}).json()
ok(a["status"] == "acked" and a["result"]["ok"], "acked with a phone-result")
ok(c.post(f"/p/commands/{note['command']['id']}/ack", json={"deviceId": "phone-ffffffffffffffff", "ok": True}).status_code == 403, "another phone can't ack it")

calls: list = []


def fake(method, params, sid):
    if method == "initialize":
        return {}, "s"
    calls.append(params["arguments"])
    return {"isError": True, "content": [{"type": "text", "text": json.dumps({"error": {"code": "confirmation_required", "details": {"confirmationId": "c-9"}}})}]}, "s"


hub.transport = fake
r = c.post("/p/recorder/start", json={"session_name": "Build review"}).json()
ok(r["state"] == "asked" and r["confirm"] == "c-9" and calls[-1]["tool"] == "phone.recorder_start" and "mic" not in calls[-1]["arguments"], "recorder start is a straight approval on axHub, mic never sent")
ok(c.post("/p/recorder/start", json={}).status_code == 422, "a session name is required")
q = c.post("/p/recorder/start", json={"session_name": "Approved", "approvalId": "appr-1"}).json()
ok(q["state"] == "queued" and q["command"]["approvalId"] == "appr-1", "with Brett's approval id it is queued for the phone")
s = c.get("/p/recorder/status").json()
ok(s["running"] and s["session"] == "Review" and s["part"] == 2 and s["mic"] is False, "status reads the phone's report; mic off by default")
ok(c.post("/p/settings", json={"recorderMic": True}).status_code == 403, "a command can't turn the mic on")
ok(c.post("/p/settings", json={"recorderMic": True}, headers=BRETT).json()["recorderMic"] is True, "Brett's own click turns it on")
ok(c.post("/p/settings", json={"recorderMic": False}).json()["recorderMic"] is False, "a command may turn it off")

for bad in ("*", "phone.recorder_start", "vps.run", "build.delete_branch"):
    ok(c.post("/p/rules", json={"what": bad}).status_code in (403, 422), f"no rule covers {bad}")
rule = c.post("/p/rules", json={"what": "build.*", "scope": "project:axf"}).json()
ok(rule["state"] == "proposed" and not rule["active"], "a command's rule is only proposed")
ok(not c.post("/p/rules/evaluate", json={"tool": "build.status", "project": "axf"}).json()["approve"], "a proposed rule approves nothing")
ok(c.post(f"/p/rules/{rule['id']}/enable", json={"on": True}).status_code == 403, "only Brett turns a rule on")
ok(c.post(f"/p/rules/{rule['id']}/enable", json={"on": True}, headers=BRETT).json()["state"] == "on", "Brett turns it on")
ok(c.post("/p/rules/evaluate", json={"tool": "build.status", "project": "axf"}).json()["approve"], "now it approves in scope")
ok(not c.post("/p/rules/evaluate", json={"tool": "build.status", "project": "other"}).json()["approve"], "never out of scope")
ok(not c.post("/p/rules/evaluate", json={"tool": "build.reset", "project": "axf"}).json()["approve"], "never a destructive tool")
ok(not c.post("/p/rules/evaluate", json={"tool": "build.status", "project": "axf", "personOnly": True}).json()["approve"], "never a personOnly action")
ok(c.delete(f"/p/rules/{rule['id']}").json()["removed"] == rule["id"], "a rule is removed")

al = c.post("/p/amberx/open_url", json={"url": "https://console.amberxai.com/"}).json()
ok(al["status"] == "queued" and "deprecated" in al, "amberx_open_url still works, marked deprecated")
ok("deprecated" in c.get("/p/amberx/recorder_status").json(), "amberx_recorder_status answers as deprecated")
c.post("/p/amberx/recorder_start", json={"session_name": "Old name"})
ok(calls[-1]["tool"] == "phone.recorder_start", "the alias asks the same straight approval")

ov = c.post("/p/overlay", json={"popups": {"approval": {"enter": "burst", "stayMs": 0}}, "buttonSize": 64}).json()
ok(ov["popups"]["approval"]["enter"] == "burst" and ov["buttonSize"] == 64 and ov["popups"]["alert"]["enter"] == "slide-top", "an overlay patch merges per popup type")
ok(c.post("/p/overlay", json={"items": [{"id": "x", "action": "open:https://evil.com/"}]}).status_code == 422, "a toolbar button never opens another site")
ok(c.post("/p/overlay/presets/quiet").json()["popups"]["alert"]["sound"] is False, "a preset applies")
ok(c.post(f"/p/devices/{DID}/revoke", json={"why": "test"}).json()["state"] == "revoked", "revoke")
ok(c.post(f"/p/devices/{DID}/next", json={}).status_code == 403, "a revoked phone's poll is refused")
ok(c.post("/p/open", json={"url": "https://console.amberxai.com/"}).status_code == 409, "nothing is queued with no paired phone")

print(f"phone-connect: {n}/{n} passed")
