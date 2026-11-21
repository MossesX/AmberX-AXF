"""Server part of the Phone Connect self-test (run by test.py, which supplies check / ok / E / FX / TMP)."""
# ruff: noqa: F821 — check, ok, E, FX, TMP come from test.py
import importlib.util
import json
import os
import sys
import types
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

import wall

HERE = Path(__file__).resolve().parent
_pkg = types.ModuleType("axf_console_plugins")
_pkg.__path__ = []
sys.modules.setdefault("axf_console_plugins", _pkg)
_spec = importlib.util.spec_from_file_location("axf_console_plugins.phone_connect", HERE / "server/__init__.py", submodule_search_locations=[str(HERE / "server")])
pc = importlib.util.module_from_spec(_spec)
sys.modules[_spec.name] = pc
_spec.loader.exec_module(pc)
svc = sys.modules["axf_console_plugins.phone_connect.service"]
S = sys.modules["axf_console_plugins.phone_connect.store"]

BRETT = wall.Caller("brett", "admin", frozenset({"*"}), "session")
HOST = "console.test"
app = FastAPI()


@app.middleware("http")
async def who(request: Request, call_next):
    """Stands in for main.py's auth: `x-test-person: 1` = the wall's admin browser, else the console token."""
    request.state.axf_user = BRETT if request.headers.get("x-test-person") == "1" else wall.TOKEN_CALLER
    return await call_next(request)


app.include_router(pc.router, prefix="/api/plugins/phone-connect")
app.include_router(pc.device_router, prefix="/api/plugins/phone-connect/device")
cl = TestClient(app, base_url=f"https://{HOST}")
P = "/api/plugins/phone-connect"
PERSON = {"x-test-person": "1", "origin": f"https://{HOST}"}
SESSION = {"x-axf-session": "axf-build-test", "x-axf-via": "mcp"}
DEV = {"deviceId": "phone-0123456789abcdef", "name": "samsung SM-S938B", "app": "phone-connect-droid", "appVersion": "1.0.0",
       "platform": "android", "capabilities": ["open-url@1", "notify@1", "approvals@1", "recorder@1", "voice@1"]}

# ---- s7 pairing routes

r = cl.post(f"{P}/pair/start", headers=SESSION).json()
ok("a session may issue a code", r["ok"] and E.is_code(r["pairing"]["code"]) and r["pairing"]["issuedBy"]["kind"] == "session")
code1 = r["pairing"]["code"]
r2 = cl.post(f"{P}/pair/start", headers=SESSION).json()
check("issuing again cancels the old code", S.pairing(code1)["state"], "cancelled")
code = r2["pairing"]["code"]
check("GET pair shows the pending code", cl.get(f"{P}/pair").json()["pairing"]["code"], code)

r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV, "person": {"kind": "person", "who": "brett"}}, headers=SESSION)
check("the console token cannot claim, even naming a person in the body", (r.status_code, r.json()["error"]["code"]), (403, "denied"))
check("a refused claim leaves the code pending", S.pairing(code)["state"], "pending")
r = cl.post(f"{P}/pair/confirm", json={"code": "AAAAAAAA", "device": DEV}, headers=PERSON)
check("wrong code", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers={"x-test-person": "1", "origin": "https://evil.test"})
check("a person from another origin is not a person", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers=PERSON)
j = r.json()
ok("Brett's own sign-in claims and gets the token once", r.status_code == 200 and E.is_token(j["token"]) and j["device"]["state"] == "paired")
TOKEN = j["token"]
ok("the token is never stored", TOKEN not in (Path(TMP) / "plugins/phone-connect/devices/phone-0123456789abcdef.json").read_text())
ok("the device view never shows the hash", "hash" not in (j["device"]["token"] or {}))
check("claimed code is spent", cl.post(f"{P}/pair/confirm", json={"code": code, "device": DEV}, headers=PERSON).json()["error"]["code"], "denied")
devs = cl.get(f"{P}/devices").json()["devices"]
check("GET devices lists the phone", [d["deviceId"] for d in devs], ["phone-0123456789abcdef"])
check("GET devices/{id}", cl.get(f"{P}/devices/phone-0123456789abcdef").json()["device"]["presence"], "online")
check("unknown device", cl.get(f"{P}/devices/phone-ffffffffffffffff").status_code, 404)
r = cl.delete(f"{P}/devices/phone-0123456789abcdef", headers=SESSION)
check("a session cannot revoke", (r.status_code, r.json()["error"]["code"]), (403, "denied"))
r = cl.post(f"{P}/devices/phone-0123456789abcdef/settings", json={"watch": {"on": True}}, headers=SESSION)
check("a session cannot change a phone's settings", r.status_code, 403)
r = cl.post(f"{P}/devices/phone-0123456789abcdef/settings", json={"urlPolicy": {"mode": "allowlist", "allowlist": ["github.com"]}}, headers=PERSON)
check("the owner sets the url policy", r.json()["device"]["urlPolicy"], {"mode": "allowlist", "allowlist": ["github.com"]})
_passed = 0

# ---- s8 queue + delivery

DEVH = {"authorization": f"Bearer {TOKEN}", "x-axpp": "axpp@1"}
check("no X-AXPP header", cl.post(f"{P}/device/hello", json={}, headers={"authorization": f"Bearer {TOKEN}"}).json()["error"]["code"], "invalid")
check("bad token", cl.post(f"{P}/device/hello", json={}, headers={**DEVH, "authorization": "Bearer tok_" + "z" * 32}).json()["error"]["code"], "denied")
h = cl.post(f"{P}/device/hello", json={"device": {"capabilityState": {"recorder@1": {"running": False}}}}, headers=DEVH).json()
ok("hello answers the watch, url policy and features", h["ok"] and h["features"]["open_url"] is True and h["hub"]["pollWaitSeconds"] == 25)
check("nothing queued: next is 204", cl.get(f"{P}/device/next", headers=DEVH).status_code, 204)
r = cl.post(f"{P}/open", json={"url": "https://console.test/x"}, headers=SESSION).json()
check("url outside the allowlist policy is denied", r["error"]["code"], "denied")
r = cl.post(f"{P}/open", json={"url": "intent://x"}, headers=SESSION).json()
check("intent: never opens", r["error"]["code"], "denied")
r = cl.post(f"{P}/open", json={"url": "https://github.com/MossesX"}, headers=SESSION).json()
ok("open_url inside the policy is queued", r["ok"] and r["command"]["status"] == "queued" and r["command"]["from"]["via"] == "mcp")
cid = r["id"]
w = cl.get(f"{P}/device/next", headers=DEVH).json()
check("the phone gets the AXPP call", (w["protocol"], w["kind"], w["id"], w["payload"]["tool"]), ("axpp@1", "call", cid, "browser.open"))
check("sent once", cl.get(f"{P}/device/next", headers=DEVH).status_code, 204)
check("ack", cl.post(f"{P}/device/ack", json={"protocol": "axpp@1", "correlationId": cid, "status": "shown"}, headers=DEVH).json()["status"], "acked")
check("result", cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": {"opened": True}}, headers=DEVH).json()["status"], "done")
c = cl.get(f"{P}/commands/{cid}").json()["command"]
ok("command carries ack and result", c["ack"]["status"] == "shown" and c["result"]["ok"] and c["result"]["data"] == {"opened": True})
r = cl.post(f"{P}/command", json={"command": "amberx.open_url", "arguments": {"url": "https://github.com/"}}, headers=SESSION).json()
ok("the AmberX alias still works and says it is deprecated", r["ok"] and "deprecated" in r["deprecated"])
r = cl.post(f"{P}/recorder/start", json={"session": "Build review"}, headers=SESSION).json()
check("recorder.start without a confirm", r["error"]["code"], "confirmation_required")
r = cl.post(f"{P}/command", json={"command": "approval", "arguments": {"approvalId": "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", "kind": "approval", "decision": "approve"}}, headers=SESSION).json()
check("a command can never carry a decision", r["error"]["code"], "validation")
r = cl.post(f"{P}/recorder/start", json={"session": "x", "approvalId": "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d", "mic": True}, headers=SESSION).json()
ok("mic is not an argument the route passes on", r["ok"] and "mic" not in r["command"]["arguments"])
cl.post(f"{P}/settings", json={"features": {"voice": False}}, headers=PERSON)
check("a feature switched off refuses its command", cl.post(f"{P}/voice", json={"mode": "say", "text": "hi"}, headers=SESSION).json()["error"]["code"], "denied")
cl.post(f"{P}/settings", json={"features": {"voice": True}}, headers=PERSON)
r = cl.post(f"{P}/notify", json={"title": "Build landed"}, headers=SESSION).json()
check("notify defaults to fyi with the direct notify id", (r["command"]["arguments"]["kind"], r["command"]["arguments"]["notifyId"]), ("fyi", "phone-connect.direct"))
st = cl.get(f"{P}/status").json()
ok("status reads presence and the recorder", st["paired"] and st["presence"] == "online" and st["recorder"] == {"running": False})
import importlib  # noqa: E402
import plugin_services  # noqa: E402
cap = plugin_services.get("axf.phone@1")
ok("axf.phone@1 is provided", cap is not None and cap.available())
ok("the capability has no way to decide", not any(hasattr(cap, n) for n in ("decide", "approve", "deny", "shelve")))
# timeouts
old = svc.send("recorder.stop", {}, {"kind": "session", "who": "t", "via": "cli"}, at=E.now_iso())
svc.sweep(E.iso(E.ms(E.now_iso()) + 3600_000))
check("an uncollected command times out", S.command(old["id"])["status"], "failed")
# websocket: the same loop over one socket
r = cl.post(f"{P}/open", json={"url": "https://github.com/ws"}, headers=SESSION).json()
with cl.websocket_connect(f"{P}/device/ws", headers={"authorization": f"Bearer {TOKEN}"}) as ws:
    call = ws.receive_json()
    check("ws delivers the call", (call["id"], call["payload"]["tool"]), (r["id"], "browser.open"))
    ws.send_json({"protocol": "axpp@1", "kind": "result", "correlationId": r["id"], "payload": {}})
    check("ws takes the result", ws.receive_json()["status"], "done")

# ---- s9 approvals relay (personOnly)

AID = "7a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d"
TAP = "9f8e7d6c-5b4a-4f3e-8d2c-1b0a9f8e7d6c"
relayed: list = []


class FakeRelay:
    def decide_from_phone_tap(self, tap):
        relayed.append(tap)
        return {"ok": True, "via": "phone", "action": "approve"}


plugin_services.provide("approvals-relay@1", FakeRelay(), folder="approvals-banner")


def prompt(kind="approval", actions=None):
    args = {"approvalId": AID, "kind": kind, "summary": "vps.run: restart traefik"}
    if actions:
        args["actions"] = actions
    r = svc.send("approval", args, {"kind": "service", "who": "approvals-banner", "via": "hub"})
    cl.get(f"{P}/device/next", headers=DEVH)
    return r["id"]


cid = prompt()
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": {"decision": "approve"}}, headers=DEVH)
check("a decision without Brett's tap is dropped", (r.status_code, r.json()["error"]["code"]), (403, "denied"))
check("nothing relayed", relayed, [])
check("the prompt stays open", S.command(cid)["status"], "sent")
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": {"decision": "shelve"}, "by": {"kind": "person", "tap": TAP}}, headers=DEVH)
check("an action the prompt didn't offer is dropped", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": {"decision": "approve"}, "by": {"kind": "person", "tap": TAP}}, headers=DEVH).json()
ok("Brett's tap over the device token is relayed", r["ok"] and r["relay"]["ok"] and len(relayed) == 1)
check("the relay gets a verified phone tap", {k: relayed[0][k] for k in ("kind", "auth", "approvalId", "prompt", "decision", "owner")},
      {"kind": "phone-tap", "auth": "device", "approvalId": AID, "prompt": "approval", "decision": "approve", "owner": "brett"})
cid = prompt()
r = cl.post(f"{P}/command", json={"command": "approval", "arguments": {"approvalId": AID, "kind": "approval"}, "decision": "approve"}, headers=PERSON).json()
ok("a decision field on the console's command route is ignored (only shows a prompt)", r["ok"] and len(relayed) == 1)
# no route anywhere decides: the router has no decide / approve / deny path, and the console token can't post a result
paths = [getattr(rt, "path", "") for rt in pc.router.routes]
ok("no console route decides", not any(w in p for p in paths for w in ("decide", "approve", "deny", "shelve")))
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": {"decision": "approve"}, "by": {"kind": "person", "tap": TAP}}, headers={**SESSION, "x-axpp": "axpp@1", "authorization": "Bearer axf-console-token"})
check("the console token is not a device token", r.json()["error"]["code"], "denied")
check("still one relayed decision", len(relayed), 1)

# the approvals banner's side refuses anything that isn't a verified phone tap
_ab = importlib.util.spec_from_file_location("approvals_banner_for_phone", HERE.parent / "approvals-banner/server/__init__.py")
ab = importlib.util.module_from_spec(_ab)
_ab.loader.exec_module(ab)
good = {"kind": "phone-tap", "auth": "device", "by": {"kind": "person", "tap": TAP}, "approvalId": AID, "prompt": "veto", "decision": "deny", "owner": "brett"}
check("relay: a verified tap passes the shape check", ab.phone_tap_errors(good), "")
ok("relay: a session-made tap is refused", ab.phone_tap_errors({**good, "auth": "session"}) != "")
ok("relay: no tap uuid is refused", ab.phone_tap_errors({**good, "by": {"kind": "person"}}) != "")
ok("relay: a device-made decision is refused", ab.phone_tap_errors({**good, "by": {"kind": "device"}}) != "")
check("relay: refused taps are never sent to the hub", ab.PhoneTapRelay().decide_from_phone_tap({**good, "auth": "token"})["code"], "denied")
os.environ.pop("AXF_HUB_RELAY_USER", None)
check("relay: without the owner sign-in nothing is decided", ab.PhoneTapRelay().decide_from_phone_tap(good)["code"], "no_credential")

# ---- s10 alerts to the phone
r = cap.push_alert({"source": "build-orchestrator", "severity": "error", "title": "CI red on main", "body": "android.yml failed"}, "builds.ci-red", "https://console.test/builds")
c = S.command(r["id"])
check("an alert becomes a phone notification", (c["command"], c["arguments"]["kind"], c["arguments"]["priority"], c["arguments"]["notifyId"]), ("notify", "alert", "high", "builds.ci-red"))
r = cap.push_alert({"source": "x", "severity": "warning", "title": "t"}, "", "https://elsewhere.test/")
ok("a link outside the phone's policy is dropped, not refused", r["ok"] and "url" not in S.command(r["id"])["arguments"])


class Gate:
    def allowed(self, type_id, channel):
        return type_id != "phone-connect.direct"


plugin_services.provide("axf.notify@1", Gate(), folder="notify-control")
check("a direct notification asks axf.notify@1 first", cl.post(f"{P}/notify", json={"title": "x"}, headers=SESSION).json()["error"]["code"], "denied")
ok("the alert hub's own pushes were checked already", cap.push_alert({"source": "x", "severity": "error", "title": "t"}, "phone-connect.direct")["ok"])
plugin_services.withdraw("notify-control")

# ---- s14 state + addresses
stt = cl.get(f"{P}/state").json()
ok("state carries status, devices, settings and commands", stt["$axf"] == "phone-connect-state@1" and stt["devices"] and "features" in stt["settings"] and isinstance(stt["commands"], list))
check("state names the settings address", stt["links"]["settings"], "view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect")
check("state names each phone's row", stt["links"]["devices"]["phone-0123456789abcdef"], "row:device/phone-0123456789abcdef")

# ---- s15 systems check
regd: dict = {}


class Health:
    def register(self, item, owner):
        regd[item["id"]] = (item, owner)


plugin_services.provide("axf.health@1", Health(), folder="systems-check")
svc._health_done = False
ok("the check registers on axf.health@1", svc.ensure_health() and "phone-connect" in regd and regd["phone-connect"][1] == "phone-connect")
item = regd["phone-connect"][0]
check("online phone → ok", item["run"]()["status"], "ok")
cl.post(f"{P}/devices/phone-0123456789abcdef/settings", json={"watch": {"on": True}}, headers=PERSON)
late = E.iso(E.ms(E.now_iso()) + 3600_000)
check("watched phone silent an hour → red", svc.health_probe(late)["status"], "error")
raised: list = []
import console_context as cx  # noqa: E402
cx.set_context(raise_alert=lambda a: raised.append(a) or {})
r = svc.health_fix(late)
ok("auto fix sends the open-the-app notice", r["state"] == "started" and raised and raised[-1]["key"].startswith("phone-connect:offline:"))
for d in S.paired():
    svc.revoke(d["deviceId"], {"kind": "person", "who": "brett"})
check("nothing paired → amber", svc.health_probe()["status"], "warn")
r = svc.health_fix()
ok("auto fix issues a pairing code and sends it", r["state"] == "done" and E.is_code(svc.current_pairing()["code"]) and raised[-1]["key"] == "phone-connect:pair:notice")

# ---- s21 voice in
ran: list = []


class CC:
    def run(self, command, grants=None, by="", audience="owner"):
        ran.append(command)
        return {"ok": True, "status": "delivered"}


plugin_services.provide("console-commands@1", CC(), folder="console-commands")
svc.pair_start({"kind": "person", "who": "brett"})
p2 = S.pending_pairing()
j2 = cl.post(f"{P}/pair/confirm", json={"code": p2["code"], "device": DEV}, headers=PERSON).json()
DEVH2 = {"authorization": f"Bearer {j2['token']}", "x-axpp": "axpp@1"}
r = cl.post(f"{P}/device/voice-in", json={"text": "open the build manager"}, headers=DEVH2).json()
ok("a phrase from the phone reaches the console as phone.voice", r["ok"] and ran and ran[-1]["path"] == "phone.voice" and ran[-1]["input"]["args"] == ["open the build manager"])
check("the console token can't speak as the phone", cl.post(f"{P}/device/voice-in", json={"text": "x"}, headers={**SESSION, "x-axpp": "axpp@1"}).json()["error"]["code"], "denied")

# ---- s23 axHub tool names answered by the phone
cap2 = plugin_services.get("axf.phone@1")
check("recorder_start never goes around the hub's approval", cap2.hub_tool("amberx.recorder_start", {"session": "x"}), None)
cl.post(f"{P}/device/hello", json={}, headers=DEVH2)
r = cap2.hub_tool("amberx.recorder_status", {}, wait_s=0)
ok("amberx.recorder_status is answered by the paired phone", r is not None and r["ok"] and r["command"]["command"] == "recorder.status")
r = cap2.hub_tool("amberx.open_url", {"url": "https://intent.example/"}, wait_s=0)
ok("amberx.open_url keeps the phone's url policy", r is not None and not r["ok"] and r["error"]["code"] == "denied")
for d in S.paired():
    svc.revoke(d["deviceId"], {"kind": "person", "who": "brett"})
check("no phone: the caller goes to axHub as before", cap2.hub_tool("amberx.open_url", {"url": "https://console.test/"}), None)

# ---- token rejection stops the retry loop (Fable audit F8): the console says "re-pair", once, machine-readable
from axf_console_plugins.phone_connect import approvals as AP  # noqa: E402


def pair_again() -> dict:
    svc.pair_start({"kind": "person", "who": "brett"})
    j = cl.post(f"{P}/pair/confirm", json={"code": S.pending_pairing()["code"], "device": DEV}, headers=PERSON).json()
    h = {"authorization": f"Bearer {j['token']}", "x-axpp": "axpp@1"}
    cl.post(f"{P}/device/hello", json={}, headers=h)
    return h


DEVH3 = pair_again()
check("a paired phone that greeted is connected", cl.get(f"{P}/status").json()["link"]["state"], "connected")
raised.clear()
svc.revoke("phone-0123456789abcdef", {"kind": "person", "who": "brett"})
r = cl.post(f"{P}/device/hello", json={}, headers=DEVH3)
e = r.json()["error"]
check("a revoked key is answered revoked, with the reason to pair", (r.status_code, e["code"], e["retryable"], e["detail"]["reason"]), (410, "revoked", False, "pair"))
check("the phone's verdict on that reply: rejected, never retried", E.link_verdict({"status": r.status_code, "code": e["code"]}), "rejected")
r = cl.get(f"{P}/device/next", headers=DEVH3)
check("next with the dead key is rejected too", E.link_verdict({"status": r.status_code, "code": r.json()["error"]["code"]}), "rejected")
st = cl.get(f"{P}/status").json()
ok("status says disconnected, tap to re-pair", st["link"]["state"] == "disconnected" and "re-pair" in st["link"]["message"] and st["link"]["repair"].endswith("tab:phone-connect.tabs=pair"))
ok("the rejection is counted, never the key itself", st["link"]["rejected"]["count"] == 2 and st["link"]["rejected"]["prefix"] == DEVH3["authorization"][7:15]
   and DEVH3["authorization"][7:] not in (Path(TMP) / "plugins/phone-connect/link.json").read_text())
check("one banner alert for it, not one per retry", [a["key"] for a in raised if a["key"].startswith("phone-connect:rejected:")], [f"phone-connect:rejected:{DEVH3['authorization'][7:15]}"])
hp = svc.health_probe()
ok("the systems check turns red and says re-pair", hp["status"] == "error" and "old key" in hp["summary"] and hp["link"].endswith("tab:phone-connect.tabs=pair"))
check("its auto fix makes a pairing code", svc.health_fix()["state"], "done")
r = cl.post(f"{P}/device/hello", json={}, headers={"authorization": "Bearer not-a-device-key", "x-axpp": "axpp@1"})
ok("a caller that is no phone at all is refused without being counted", r.json()["error"]["code"] == "denied" and cl.get(f"{P}/status").json()["link"]["rejected"]["count"] == 2)
r = cl.post(f"{P}/device/hello", json={}, headers={"authorization": "Bearer tok_" + "q" * 32, "x-axpp": "axpp@1"}).json()
check("an unknown key: denied, reason pair", (r["error"]["code"], r["error"]["detail"]["reason"]), ("denied", "pair"))
check("the phone's verdict on a bare 401 (a proxy): retry twice, then rejected", [E.link_verdict({"status": 401, "code": ""}, n) for n in range(3)], ["retry", "retry", "rejected"])
DEVH4 = pair_again()
st = cl.get(f"{P}/status").json()
ok("pairing again clears it", st["link"]["state"] == "connected" and st["link"]["rejected"] is None and svc.health_probe()["status"] == "ok")

# ---- presence (MCP phone_status)
pr = cl.get(f"{P}/presence").json()
ok("presence: paired, online, when it last checked in", pr["ok"] and pr["paired"] and pr["online"] and pr["presence"] == "online" and E.is_timestamp(pr["lastSeenAt"])
   and pr["lastSeenAgo"].endswith("s ago") and pr["device"]["name"] == DEV["name"] and pr["canOpenPages"] is True and pr["link"]["state"] == "connected")
ok("presence never shows a key", "token" not in json.dumps(pr) and "hash" not in json.dumps(pr))
later = E.iso(E.ms(E.now_iso()) + 12 * 60_000)
pr = svc.presence(later)
check("presence 12 min later: offline, last seen 12 min ago", (pr["online"], pr["presence"], pr["lastSeenAgo"], pr["canOpenPages"], pr["link"]["state"]), (False, "offline: last seen 12 min ago", "12 min ago", False, "offline"))
check("presence over the capability", plugin_services.get("axf.phone@1").presence()["paired"], True)
ok("an app at the current version is not outdated", DEV["appVersion"] == "1.0.0" and svc.presence()["appOutdated"] is False and svc.health_probe()["status"] == "ok")
S.save_device({**S.device(DEV["deviceId"]), "appVersion": "0.1.0"})
hp = svc.health_probe()
ok("an old app turns the systems check amber with where to get the new one", svc.presence()["appOutdated"] is True and hp["status"] == "warn" and "axHub → Apps" in hp["details"][0])
check("version compare is by number, and an unknown version counts as old", [svc.app_outdated({"appVersion": v}) for v in ("0.2.0", "0.10.0", "0.1.9", "", "dev")], [False, False, True, True, True])
S.save_device({**S.device(DEV["deviceId"]), "appVersion": "1.0.0"})

# ---- open a page and bring it to the front (MCP phone_open_url)
import threading  # noqa: E402
import time as _time  # noqa: E402


def phone_answers(payload: dict, tries: int = 40) -> threading.Thread:
    """A phone on the link: takes the next call, acks it and answers with `payload`."""
    def run() -> None:
        for _ in range(tries):
            w = cl.get(f"{P}/device/next", headers=DEVH4)
            if w.status_code == 200:
                cid = w.json()["id"]
                got.append(w.json())
                cl.post(f"{P}/device/ack", json={"protocol": "axpp@1", "correlationId": cid, "status": "shown"}, headers=DEVH4)
                cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": cid, "payload": payload}, headers=DEVH4)
                return
            _time.sleep(0.05)
    t = threading.Thread(target=run, daemon=True)
    t.start()
    return t


got: list = []
t = phone_answers({"opened": True, "how": "direct", "browser": "chrome"})
r = cl.post(f"{P}/open-url", json={"url": "https://axhub.amberxai.com/auth/admin/approvals"}, headers=SESSION).json()
t.join(5)
ok("open-url: the phone opened it in front", r["ok"] and r["opened"] and r["how"] == "direct" and r["status"] == "done" and "in front" in r["message"])
check("open-url: Chrome by default, straight to the browser", got[-1]["payload"], {"tool": "browser.open", "arguments": {"url": "https://axhub.amberxai.com/auth/admin/approvals", "where": "browser", "browser": "chrome"}})
t = phone_answers({"opened": True, "how": "notification"})
r = cl.post(f"{P}/open-url", json={"url": "https://console.amberxai.com/?x=1", "browser": "default"}, headers=SESSION).json()
t.join(5)
ok("open-url: a blocked background start says a notification is waiting, one tap", r["ok"] and r["how"] == "notification" and "one tap" in r["message"] and got[-1]["payload"]["arguments"]["browser"] == "default")
for bad, code in (("https://github.com/MossesX", "denied"), ("https://evilamberxai.com/", "denied"), ("http://console.amberxai.com/", "denied"),
                  ("intent://scan/#Intent;end", "denied"), ("https://brett:pw@console.amberxai.com/", "denied"), ("", "validation")):
    check(f"open-url refuses {bad or 'an empty url'}", cl.post(f"{P}/open-url", json={"url": bad}, headers=SESSION).json()["error"]["code"], code)
check("open-url: only chrome or default", cl.post(f"{P}/open-url", json={"url": "https://console.amberxai.com/", "browser": "firefox"}, headers=SESSION).json()["error"]["code"], "validation")
r = svc.open_page("https://console.amberxai.com/", "chrome", {"kind": "session", "who": "t", "via": "mcp"}, wait_s=0)
ok("open-url: a phone that has not answered yet is said so, not called opened", r["ok"] and r["opened"] is False and r["status"] == "queued")
cl.get(f"{P}/device/next", headers=DEVH4)
cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "error", "correlationId": r["id"], "error": {"code": "consent_required", "message": "Notifications are off for Phone Connect."}}, headers=DEVH4)
cl.post(f"{P}/settings", json={"features": {"open_url": False}}, headers=PERSON)
check("open-url: the Open pages switch off refuses it", cl.post(f"{P}/open-url", json={"url": "https://console.amberxai.com/"}, headers=SESSION).json()["error"]["code"], "denied")
cl.post(f"{P}/settings", json={"features": {"open_url": True}}, headers=PERSON)
try:
    S.save_device({**S.device(DEV["deviceId"]), "lastSeenAt": E.iso(E.ms(E.now_iso()) - 600_000)})
    svc.open_page("https://console.amberxai.com/", wait_s=0)
    check("open-url: an offline phone is an error", "sent", "offline")
except svc.PhoneError as e:
    check("open-url: an offline phone is an error", (e.err["code"], e.err["retryable"]), ("offline", True))
cl.post(f"{P}/device/hello", json={}, headers=DEVH4)

# ---- Follow Amber on the phone (axf.phone@1 follow)
capf = plugin_services.get("axf.phone@1")
r = capf.follow("view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect", by={"kind": "agent", "who": "amber (mcp)", "via": "console"})
c = S.command(r["id"])
ok("follow: the console opens on the phone at that screen", r["shown"] and c["command"] == "open_url" and c["from"]["who"] == "amber (mcp)"
   and c["arguments"]["url"] == "https://console.amberxai.com/?axf-open=view:settings/tab:settings.tabs=plugins/subtab:settings.subtabs=phone-connect")
ok("follow: the address can't smuggle a second parameter", "&" not in S.command(capf.follow("view:x&evil=1#y")["id"])["arguments"]["url"].split("?", 1)[1])
check("follow: on by default", S.settings()["features"]["follow"], True)
cl.post(f"{P}/settings", json={"features": {"follow": False}}, headers=PERSON)
n = len(S.commands(limit=500))
r = capf.follow("view:builds")
ok("follow: its switch off sends nothing", r["ok"] and r["shown"] is False and len(S.commands(limit=500)) == n)
cl.post(f"{P}/settings", json={"features": {"follow": True}}, headers=PERSON)
check("follow: nothing to show", capf.follow("")["shown"], False)

# ---- approvals pop up on the phone, console closed (the watcher's tick; approvals-relay@1 pending + phone tap)
A1, A2 = "11111111-1111-4111-8111-111111111111", "22222222-2222-4222-8222-222222222222"
feed = {"ok": True, "items": [
    {"id": A1, "kind": "approval", "tool": "github.merge_pr", "title": "Merge PR 870", "summary": "squash into main", "actions": ["approve", "decline"], "rev": 4, "expiresAt": E.iso(E.ms(E.now_iso()) + 1800_000)},
    {"id": A2, "kind": "veto", "tool": "vps.run", "title": "Restart the console", "summary": "docker restart axf-console", "secondsLeft": 61, "shelved": False, "actions": ["deny", "approve-now", "shelve"], "rev": 2}]}
asked: list = []


class FeedRelay(FakeRelay):
    def pending(self, owner=""):
        asked.append(owner)
        return feed


plugin_services.withdraw("approvals-banner")
plugin_services.provide("approvals-relay@1", FeedRelay(), folder="approvals-banner")
relayed.clear()
while cl.get(f"{P}/device/next", headers=DEVH4).status_code == 200:
    pass
t1 = AP.tick()
ok("tick: both new approvals are pushed, read as the phone's owner", t1["ok"] and t1["watching"] and t1["pushed"] == [A1, A2] and asked == ["brett"])
calls = {w["payload"]["arguments"]["approvalId"]: w for w in (cl.get(f"{P}/device/next", headers=DEVH4).json() for _ in range(2))}
w1, w2 = calls[A1], calls[A2]
check("the phone gets approval.show with Approve and Deny", (w1["payload"]["tool"], w1["payload"]["arguments"]),
      ("approval.show", {"actions": ["approve", "deny"], "approvalId": A1, "kind": "approval", "tool": "github.merge_pr", "title": "Merge PR 870", "summary": "squash into main", "rev": 4}))
check("a veto countdown carries its seconds and its actions", {k: w2["payload"]["arguments"][k] for k in ("approvalId", "kind", "secondsLeft", "actions")},
      {"approvalId": A2, "kind": "veto", "secondsLeft": 61, "actions": ["deny", "approve", "shelve"]})
c1 = S.command(w1["id"])
ok("the prompt may be answered until the approval expires; the countdown until it runs", 1700 <= c1["ttl"] <= 1800 and S.command(w2["id"])["ttl"] == 61)
ok("the pushed command never carries a decision", c1["policy"] == "allow" and not any(k in c1["arguments"] for k in ("decision", "decide")) and c1["from"] == {"kind": "service", "who": "approvals", "via": "hub"})
check("tick again: nothing is pushed twice", AP.tick()["pushed"], [])
cl.post(f"{P}/device/ack", json={"protocol": "axpp@1", "correlationId": w1["id"], "status": "shown"}, headers=DEVH4)
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": w1["id"], "payload": {"decision": "approve"}}, headers=DEVH4)
check("the app can't approve by itself (no tap)", r.json()["error"]["code"], "denied")
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": w1["id"], "payload": {"decision": "approve"}, "by": {"kind": "person", "tap": TAP}}, headers=DEVH4).json()
ok("Brett's Approve tap on the notification is relayed with the hub's revision", r["relay"]["ok"] and relayed[-1]["approvalId"] == A1 and relayed[-1]["decision"] == "approve" and relayed[-1]["rev"] == 4 and relayed[-1]["auth"] == "device")
r = cl.post(f"{P}/device/answer", json={"protocol": "axpp@1", "kind": "result", "correlationId": w2["id"], "payload": {"decision": "deny"}, "by": {"kind": "person", "tap": TAP}}, headers=DEVH4).json()
ok("Deny on a veto countdown is relayed as a veto deny", r["relay"]["ok"] and relayed[-1]["prompt"] == "veto" and relayed[-1]["decision"] == "deny")
feed["items"] = [{"id": "33333333-3333-4333-8333-333333333333", "kind": "approval", "tool": "vps.run", "summary": "x", "actions": ["approve", "decline"]}]
S.save_device({**S.device(DEV["deviceId"]), "lastSeenAt": E.iso(E.ms(E.now_iso()) - 600_000)})
n = len(asked)
t3 = AP.tick()
ok("phone offline: the hub is not even asked, nothing is marked pushed", t3["watching"] is False and len(asked) == n and "33333333-3333-4333-8333-333333333333" not in S.approvals()["pushed"])
cl.post(f"{P}/device/hello", json={}, headers=DEVH4)
check("back online: the waiting approval is pushed then", AP.tick()["pushed"], ["33333333-3333-4333-8333-333333333333"])
w3 = cl.get(f"{P}/device/next", headers=DEVH4).json()
svc._finish(S.command(w3["id"]), E.wire_error("timeout", "no answer"), E.now_iso())
cl.post(f"{P}/device/hello", json={}, headers=DEVH4)
check("a prompt that timed out unanswered is shown again while it still waits", AP.tick()["pushed"], ["33333333-3333-4333-8333-333333333333"])
for _ in range(AP.MAX_PUSHES):
    c = S.command(S.approvals()["pushed"]["33333333-3333-4333-8333-333333333333"]["commandId"])
    if c["status"] != "failed":
        svc._finish(c, E.wire_error("timeout", "no answer"), E.now_iso())
    AP.tick()
check("but never more than the cap", S.approvals()["pushed"]["33333333-3333-4333-8333-333333333333"]["pushes"], AP.MAX_PUSHES)
cl.post(f"{P}/settings", json={"features": {"approval": False}}, headers=PERSON)
feed["items"] = [{"id": "44444444-4444-4444-8444-444444444444", "kind": "approval", "tool": "x", "actions": ["approve", "decline"]}]
ok("Approval prompts switched off: nothing is read or pushed", AP.tick()["watching"] is False and "44444444-4444-4444-8444-444444444444" not in S.approvals()["pushed"])
cl.post(f"{P}/settings", json={"features": {"approval": True}}, headers=PERSON)
feed.clear()
feed.update({"ok": False, "code": "no_credential", "message": "The console has no axHub owner sign-in."})
t5 = AP.tick()
ok("no hub sign-in: the watcher says why, status carries it", t5["ok"] is False and t5["code"] == "no_credential" and cl.get(f"{P}/status").json()["approvals"]["code"] == "no_credential")
plugin_services.withdraw("approvals-banner")
check("no relay plugin: unavailable, said plainly", AP.tick()["code"], "unavailable")
ok("the watcher stays off in the self-test", AP.start() is False)
check("feed items map to prompt actions", (AP.arguments({"id": A1, "kind": "veto", "actions": []})["actions"], AP.arguments({"id": A1, "kind": "approval", "actions": ["decline"]})["actions"]), (["deny"], ["deny"]))
