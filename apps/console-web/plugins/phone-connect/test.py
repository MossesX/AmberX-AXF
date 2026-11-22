"""Phone Connect self-test: the Python engine port replays framework/spec/fixtures/phone-connect.json (same answers,
messages included, as framework/core/phone-connect.mjs), then the plugin's server is driven through its routes.

    python apps/console-web/plugins/phone-connect/test.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[3]
sys.path[:0] = [str(HERE / "server"), str(ROOT / "apps/console-web/server"), str(ROOT / "framework/python")]

import engine as E  # noqa: E402

FX = json.loads((ROOT / "framework/spec/fixtures/phone-connect.json").read_text())
ORIGIN, AT = FX["origin"], FX["at"]
passed = 0
failed: list[str] = []


def check(name: str, got, want) -> None:
    global passed
    if got == want:
        passed += 1
    else:
        failed.append(f"{name}\n    got  {json.dumps(got)[:600]}\n    want {json.dumps(want)[:600]}")


def short(v: dict) -> dict:
    """The fixture records validator errors as `field:code`."""
    return {"ok": v["ok"], "errors": [f"{e['field']}:{e['code']}" for e in v["errors"]]}


def ok(name: str, cond: bool) -> None:
    check(name, bool(cond), True)


# ---- engine parity with the fixture -----------------------------------------------------------------------------

for n, c in FX["devices"].items():
    check(f"device {n}", short(E.validate_device(c["device"])), {"ok": c["ok"], "errors": c["errors"]})
for n, c in FX["pairings"].items():
    check(f"pairing {n}", short(E.validate_pairing(c["pairing"])), {"ok": c["ok"], "errors": c["errors"]})
for n, c in FX["commands"].items():
    check(f"command {n}", short(E.validate_command(c["command"])), {"ok": c["ok"], "errors": c["errors"]})
for n, c in FX["results"].items():
    check(f"result {n}", short(E.validate_result(c["result"])), {"ok": c["ok"], "errors": c["errors"]})
for n, c in FX["make"].items():
    i = dict(c["input"])
    got = E.make_command(**{("from_" if k == "from" else k): v for k, v in i.items()})
    want = {k: v for k, v in c.items() if k != "input"}
    check(f"make {n}", got, want)
for n, c in FX["wire"].items():
    check(f"wire {n}", E.to_wire(c["command"]), c["wire"])
cmd0 = FX["wire"]["open_url"]["command"]
for n, c in FX["fromWire"].items():
    cmd = FX["decisions"]["brett tapped over the device token"]["command"] if "person" in n else cmd0
    r = E.from_wire(c["message"], {**cmd, "command": c["result"]["command"]}, c["result"]["at"])
    check(f"fromWire {n}", r, c["result"])
    check(f"fromWire valid {n}", short(E.validate_result(r)), c["valid"])
for n, c in FX["dispatch"].items():
    check(f"dispatch {n}", E.dispatch_errors(c["command"], c["device"], c.get("at", AT), origin=ORIGIN), c["error"])
for n, c in FX["decisions"].items():
    check(f"decision {n}", E.decision_errors(c["result"], c["command"], c["auth"]), c["error"])
for n, c in FX["presence"].items():
    check(f"presence {n}", (E.is_online(c["device"], c["at"]), E.presence(c["device"], c["at"])), (c["online"], c["presence"]))
for n, c in FX["urls"].items():
    check(f"url {n}", E.url_errors(c["url"], c["device"], ORIGIN), c["error"])
for n, c in FX["link"].items():
    check(f"link {n}", E.link_verdict(c["reply"], c["uncoded"]), c["verdict"])
for h, site in FX["ownSites"].items():
    check(f"own site {h!r}", E.own_site(h), site)
for n, c in FX["migration"].items():
    d = E.migrate_device(c["old"], AT)
    check(f"migration {n}", d, c["device"])
    check(f"migration valid {n}", short(E.validate_device(d)), c["valid"])
    check(f"migration hello {n}", E.hello_errors(d), c["hello"])
for n, c in FX["autoApprove"].items():
    check(f"autoApprove {n}", (E.auto_approvable(n), E.auto_approvable(n, all=True)), (c["alone"], c["inAll"]))
for n, c in FX["errors"].items():
    check(f"error {n}", {"retryable": E.ERROR_CODES[n]["retryable"], "doc": E.ERROR_CODES[n]["doc"]}, c)
for n, to in FX["aliases"].items():
    check(f"alias {n}", (E.resolve_command(n) or {}).get("command"), to)
for n, t in FX["ttl"].items():
    check(f"ttl {n}", E.ttl_for(n), t)

# pairing flow, structurally (the fixture's codes come from a seeded JS random)
seq = iter([i / 97 % 1 for i in range(1, 10_000)])
rnd = lambda: next(seq)  # noqa: E731
p = E.issue_pairing(AT, {"kind": "session", "who": "axf-build-x", "via": "mcp"}, rnd)
ok("issued pairing valid", E.validate_pairing(p)["ok"])
dev = FX["pairingFlow"]["claim"]["device"]
hello = {"code": p["code"], "device": {k: dev[k] for k in ("deviceId", "name", "app", "appVersion", "platform", "capabilities")}}
check("claim by session", E.claim_pairing(p, {**hello, "person": {"kind": "session", "who": "x"}}, "2026-11-17T17:00:30.000Z", rnd), FX["pairingFlow"]["claimBySession"])
check("claim no person", E.claim_pairing(p, hello, "2026-11-17T17:00:30.000Z", rnd), FX["pairingFlow"]["claimNoPerson"])
check("claim wrong code", E.claim_pairing(p, {**hello, "code": "AAAAAAAA", "person": {"kind": "person", "who": "brett"}}, AT, rnd), FX["pairingFlow"]["claimWrongCode"])
check("claim malformed", E.claim_pairing(p, {"code": p["code"]}, AT, rnd), FX["pairingFlow"]["claimMalformed"])
check("claim expired", E.claim_pairing(p, {**hello, "person": {"kind": "person", "who": "brett"}}, "2026-11-17T17:10:00.000Z", rnd), FX["pairingFlow"]["claimExpired"])
cl = E.claim_pairing(p, {**hello, "person": {"kind": "person", "who": "brett"}}, "2026-11-17T17:00:30.000Z", rnd)
ok("claim ok", cl["ok"] and E.is_token(cl["token"]) and E.validate_device(cl["device"])["ok"] and E.validate_pairing(cl["pairing"])["ok"])
ok("token never stored", cl["token"] not in json.dumps(cl["device"]))
check("verify ok", E.verify_token(cl["device"], cl["token"]), None)
check("verify bad", E.verify_token(cl["device"], "tok_" + "x" * 32), FX["pairingFlow"]["verifyBad"])
check("revoke by session", E.revoke_device(cl["device"], {"kind": "session", "who": "x"}, AT), FX["pairingFlow"]["revokeBySession"])
rot = E.rotate_token(cl["device"], cl["token"], "2026-11-17T17:01:00.000Z", rnd)
ok("rotate", rot["ok"] and rot["token"] != cl["token"] and E.verify_token(rot["device"], cl["token"]) is not None and E.verify_token(rot["device"], rot["token"]) is None)
rv = E.revoke_device(rot["device"], {"kind": "person", "who": "brett"}, AT)
ok("revoke", rv["ok"] and rv["device"]["state"] == "revoked" and rv["device"]["token"] is None)
check("verify revoked", E.verify_token(rv["device"], rot["token"]), FX["pairingFlow"]["verifyRevoked"])

# ---- server: routes, store, queue, relay (filled in by the plugin's server steps) ----------------------------------

TMP = tempfile.mkdtemp(prefix="phone-connect-test-")
os.environ["AXF_STATE"] = str(Path(TMP) / "state.json")
os.environ["AXF_PLUGINS_DATA_DIR"] = str(Path(TMP) / "plugins")
os.environ.setdefault("AXF_PHONE_CONNECT_ORIGIN", ORIGIN)
os.environ["AXF_PHONE_CONNECT_APPROVALS"] = "off"  # the watcher thread stays off: test_server.py drives its tick

server_tests = HERE / "test_server.py"
if server_tests.exists():
    ns: dict = {"check": check, "ok": ok, "E": E, "FX": FX, "TMP": TMP, "__file__": str(server_tests), "__name__": "phone_connect_test_server"}
    exec(compile(server_tests.read_text(), str(server_tests), "exec"), ns)  # noqa: S102 — our own test file
    passed += ns.get("_passed", 0)

if failed:
    print(f"phone-connect: {len(failed)} FAILED, {passed} passed")
    for f in failed:
        print("  ✗", f)
    sys.exit(1)
print(f"phone-connect: {passed} checks passed")
