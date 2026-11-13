#!/usr/bin/env python3
"""Self-test for the Claude badge plugin (fake AI assistant service).

    python3 apps/console-web/plugins/claude-badge/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import time
import types
import urllib.request
from datetime import datetime
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_CLAUDE_BADGE_DIR"] = tempfile.mkdtemp(prefix="axf-cb-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import plugin_services  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.claude_badge_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


class FakeLlm:
    mode = "ok"
    calls: list = []

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append({"messages": messages, "params": params})
        if self.mode == "broke":
            raise RuntimeError("400 Your credit balance is too low to access the Anthropic API")
        if self.mode == "limit":
            raise RuntimeError("Claude usage limit reached")
        if self.mode == "boom":
            raise RuntimeError("401 invalid x-api-key")
        if self.mode == "empty":
            return {"text": "", "model": "claude-opus-5-5"}
        return {"text": "OK", "model": self.model, "profile": "anthropic-main"}


print("claude-badge self-test")
check(c.get("/p/status").json()["last"] is None, "no result before the first test")
r = c.post("/p/test").json()
check(not r["ok"] and "AI assistant" in r["error"] and r["state"] == "error", "no assistant: AI unavailable, says why")
llm = FakeLlm()
llm.model = "claude-opus-5-5"
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
r = c.post("/p/test").json()
check(r["ok"] and r["state"] == "ok" and r["name"] == "Claude Opus 5.5" and r["claude"] and r["provider"] == "anthropic-main", "connected: model name made readable")
check(llm.calls[-1]["params"]["max_tokens"] <= 16 and len(llm.calls[-1]["messages"]) == 1, "the test is one tiny request")
for raw, want in [("claude-sonnet-5-5", "Claude Sonnet 5.5"), ("claude-fable-5-1", "Claude Fable 5.1"), ("claude-haiku-5-5-20261001", "Claude Haiku 5.5"),
                  ("claude-3-5-sonnet-20241022", "Claude Sonnet 3.5"), ("claude-opus-5", "Claude Opus 5"), ("gpt-5", "gpt-5"), ("", "")]:
    check(mod.pretty_model(raw) == want, f"model name {raw!r} → {want!r}")
llm.model = "gpt-5"
r = c.post("/p/test").json()
check(r["ok"] and r["name"] == "gpt-5" and not r["claude"], "another provider's model is shown as is")
llm.mode = "boom"
r = c.post("/p/test").json()
check(not r["ok"] and "invalid x-api-key" in r["error"] and r["name"] == "" and r["state"] == "error", "bad key: can't connect (state error) with the reason")
llm.mode = "broke"
r = c.post("/p/test").json()
check(not r["ok"] and r["state"] == "no-credit" and "credit balance" in r["error"], "account works but no credits: state no-credit")
llm.mode = "limit"
check(c.post("/p/test").json()["state"] == "no-credit", "usage limit reached counts as out of credits")
for msg, want in [("402 Payment Required", "no-credit"), ("insufficient_quota", "no-credit"), ("401 invalid x-api-key", "error"), ("connection refused", "error"), ("", "error")]:
    check(mod.classify(False, msg) == want, f"classify {msg!r} → {want}")
check(mod.classify(True, "quota") == "ok", "a working answer is ok whatever the text")
f0 = Path(os.environ["AXF_CLAUDE_BADGE_DIR"]) / "status.json"
saved = f0.read_text("utf-8")
f0.write_text(json.dumps({"at": 1, "ok": False, "error": "credit balance is too low"}), "utf-8")
check(c.get("/p/status").json()["last"]["state"] == "no-credit", "an older saved result without a state gets one")
f0.write_text(saved, "utf-8")
f0.chmod(0o600)
llm.mode = "empty"
r = c.post("/p/test").json()
check(not r["ok"] and r["state"] == "error", "an empty answer counts as unavailable")
last = c.get("/p/status").json()["last"]
check(last and not last["ok"] and "OK" not in json.dumps(last), "last result kept, no reply text stored")
f = Path(os.environ["AXF_CLAUDE_BADGE_DIR"]) / "status.json"
check((f.stat().st_mode & 0o777) == 0o600, "result file is private (0600)")
plugin_services.withdraw("fake-assistant")
check(not c.post("/p/test").json()["ok"], "assistant removed: unavailable again")
print("Can Claude build (the dispatcher's ready read, no model call)")


class FakeDispatch:
    def __init__(self):
        self.calls = 0
        self.fail = False
        self.value = {"ok": True, "ready": 1, "total": 2, "source": "host", "from": "", "why": "", "health": "2026-11-13T01:11:59.727Z", "accounts": [
            {"name": "worker-1", "label": "Main", "kind": "subscription", "ready": True, "signedIn": True, "credits": True, "fable": True, "healthAt": "2026-11-13T01:11:59.727Z", "why": "", "token": "SECRET"},
            {"name": "worker-2", "label": "", "kind": "subscription", "ready": False, "signedIn": True, "credits": False, "fable": None, "healthAt": "2026-11-13T01:11:40.000Z", "why": "no credits left"}]}

    def ready(self):
        self.calls += 1
        if self.fail:
            raise RuntimeError("pipeline failed")
        return self.value


def fresh_build(**q):
    mod._build.update(at=0.0, value=None)
    return c.get("/p/build", params=q).json()


llm = FakeLlm()
llm.model = "claude-opus-5-5"
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
llm.calls.clear()
before = f.read_text("utf-8")
r = fresh_build()
check(r["state"] == "off" and not r["ok"] and "orchestrator is off" in r["text"], "no orchestrator: grey, says why")
check(c.get("/p/vps").json()["state"] == "off", "no orchestrator: the VPS badge is grey too")
fd = FakeDispatch()
plugin_services.provide("axf.build-dispatch@1", fd, "fake-orchestrator")
r = fresh_build()
check(r["ok"] and r["state"] == "ok" and r["ready"] == 1 and r["total"] == 2 and "1 of 2" in r["text"], "one build account ready: green, says how many")
check([a["name"] for a in r["accounts"]] == ["worker-1", "worker-2"] and r["accounts"][1]["why"] == "no credits left" and r["accounts"][1]["credits"] is False, "every account with ready and why not")
check("SECRET" not in json.dumps(r), "only the listed fields leave the read: nothing extra from the account")
n = fd.calls
c.get("/p/build")
check(fd.calls == n, "cached: a second read within 30 s doesn't run the orchestrator again")
fd.value = {**fd.value, "accounts": [{**a, "ready": False, "why": "cannot sign in", "signedIn": False} for a in fd.value["accounts"]]}
r = fresh_build()
check(r["state"] == "error" and not r["ok"] and r["ready"] == 0 and "none of 2" in r["text"], "no account can sign in with credits: red")
fd.value = {**fd.value, "accounts": [], "why": "this process can't see the Claude logins", "source": "none"}
r = fresh_build()
check(r["state"] == "error" and "no build account" in r["text"] and "can't see" in r["text"], "no accounts at all: red, with the reason")
v = c.get("/p/vps").json()
check(v["state"] == "error" and not v["reachable"], "VPS badge: the console can't see the accounts on the host: red")
fd.fail = True
r = fresh_build()
check(r["state"] == "off" and "pipeline failed" in r["text"], "a failing read: grey, says why, never green")
fd.fail = False
fd.value = FakeDispatch().value
r = fresh_build(refresh=1)
check(r["ok"] and not r["cached"], "refresh reads again")
v = c.get("/p/vps").json()
check(v["state"] == "ok" and v["reachable"] and v["source"] == "host", "VPS badge: accounts read live on the host: green")
now = int(time.time() * 1000)
iso = lambda ms: datetime.fromtimestamp(ms / 1000).astimezone().isoformat()  # noqa: E731
check(mod.vps_classify("snapshot", iso(now - 3 * 60000), "", now)[0] == "ok", "VPS badge: a 3-minute-old host snapshot is green")
check(mod.vps_classify("snapshot", iso(now - 30 * 60000), "", now)[0] == "warn", "VPS badge: a 30-minute-old snapshot is amber (the host tick stopped)")
check(mod.vps_classify("none", "", "", now)[:2] == ("error", False), "VPS badge: nothing to read is red")
check(not llm.calls, "build reads never called a model")
check(f.read_text("utf-8") == before, "build reads leave the AI assistant test's saved result alone")
src = (HERE / "server" / "__init__.py").read_text("utf-8")
check("claude-accounts@1" not in src and "active_account" not in src and "limited_at" not in src and ".view()" not in src, "the VPS root `claude auth status` / .active login is not read any more")


guest_app = FastAPI()


@guest_app.middleware("http")
async def _guest(request, call_next):
    request.state.axf_user = types.SimpleNamespace(admin=False, name="guest")
    return await call_next(request)


guest_app.include_router(mod.router, prefix="/p")
g = TestClient(guest_app).get("/p/build").json()
check(g["state"] == "ok" and g["ready"] == 1 and g["accounts"] == [], "a non-owner gets the state and counts, not the account names")
# ---- usage meter: the read on the host

import io  # noqa: E402
import urllib.error  # noqa: E402

home = Path(tempfile.mkdtemp(prefix="axf-usage-host-"))
acc = home / ".claude-accounts"
far = int(time.time() * 1000) + 3600_000
for name, files in {"live": {".credentials.json": {"claudeAiOauth": {"accessToken": "OLD-COPY", "expiresAt": 1}}}, "old": {".credentials.json": {"claudeAiOauth": {"accessToken": "SECRET-OLD", "expiresAt": 5, "subscriptionType": "pro"}}},
                    "tok": {"token": "SECRET-TOK"}, "key": {"apikey": "SECRET-KEY"}, "shut": {".credentials.json": {"claudeAiOauth": {"accessToken": "SECRET-REVOKED", "expiresAt": far}}}, "none": {}}.items():
    (acc / name).mkdir(parents=True)
    for f, v in files.items():
        (acc / name / f).write_text(json.dumps(v) if isinstance(v, dict) else v)
(acc / ".active").write_text("live\n")
(home / ".claude").mkdir()
(home / ".claude" / ".credentials.json").write_text(json.dumps({"claudeAiOauth": {"accessToken": "SECRET-LIVE", "expiresAt": far, "subscriptionType": "max"}}))
asked: list = []


def fake_open(req, timeout=0):
    tok = req.headers.get("Authorization", "").split(" ")[-1]
    asked.append((req.full_url, tok))
    if tok == "SECRET-LIVE":
        return io.BytesIO(json.dumps({"five_hour": None, "seven_day": {"utilization": 13.0, "resets_at": "2099-01-01T00:00:00+00:00", "locked_reason": None}}).encode())
    raise urllib.error.HTTPError(req.full_url, 403 if tok == "SECRET-TOK" else 401, "no", None, io.BytesIO(b'{"leak":"SECRET-BODY"}'))


src = (HERE / "server" / "usage_host.py").read_text()
os.environ["HOME"], old_home = str(home), os.environ.get("HOME", "")
real_open, real_stdout = urllib.request.urlopen, sys.stdout
urllib.request.urlopen, sys.stdout = fake_open, io.StringIO()
exec(compile(src, "usage_host.py", "exec"), {"__name__": "usage_host"})  # noqa: S102
out = sys.stdout.getvalue()
urllib.request.urlopen, sys.stdout = real_open, real_stdout
os.environ["HOME"] = old_home
read = json.loads(out)
rows = {r["name"]: r for r in read["rows"]}
check("SECRET" not in out, "the host read prints no token and no answer text")
check(all(u == "https://api.anthropic.com/api/oauth/usage" for u, _ in asked), "tokens go to the usage address and nowhere else")
check(rows["live"]["http"] == 200 and rows["live"]["weekly"]["used"] == 13.0, "the active account reads the live login, not its saved copy")
check(rows["old"]["http"] == 401 and "SECRET-OLD" not in [t for _, t in asked], "an expired token is never sent")
check(rows["key"]["kind"] == "api-key" and rows["key"]["http"] is None, "an API key isn't asked")
check(rows["tok"]["http"] == 403 and rows["tok"]["kind"] == "token", "a token login says what it is")
check(rows["none"]["http"] == -1, "nothing saved says so")

# ---- usage meter: merge, states, cache, route

now = int(time.time() * 1000)
past, future = "2020-01-01T00:00:00+00:00", "2099-01-01T00:00:00+00:00"
w = lambda used, at=future: {"used": used, "resetsAt": at, "locked": False}  # noqa: E731
m = mod.merge_usage({}, {"rows": [{"name": "a", "active": True, "http": 200, "fiveHour": None, "weekly": w(13)}, {"name": "b", "http": 403, "kind": "token"}, {"name": "c", "kind": "api-key", "http": None}]}, now)
by = {x["name"]: x for x in m}
check(by["a"]["status"] == "ok" and by["a"]["fiveHour"] is None and by["a"]["asOf"] == now, "a fresh read")
check(by["b"]["status"] == "no-meter" and "token" in by["b"]["why"], "a token login has no meter")
check(by["c"]["status"] == "no-meter" and "API key" in by["c"]["why"], "an API key has no meter")
m2 = {x["name"]: x for x in mod.merge_usage({"a": {**by["a"], "weekly": w(40), "fiveHour": w(90, past)}}, {"rows": [{"name": "a", "http": 401}]}, now)}
check(m2["a"]["status"] == "old" and m2["a"]["weekly"]["used"] == 40 and m2["a"]["asOf"] == now, "an account that can't be read keeps its last numbers and their date")
check(m2["a"]["fiveHour"]["used"] == 0, "a window that has reset since reads zero")
full = mod.merge_usage({}, {"rows": [{"name": "a", "http": 200, "weekly": w(100)}]}, now)[0]
check(full["status"] == "limit" and mod.meter_state({**full, "active": True}) == "error", "a full window is a limit")
locked = mod.merge_usage({}, {"rows": [{"name": "a", "http": 200, "weekly": {**w(50), "locked": True}}]}, now)[0]
check(locked["status"] == "limit", "a locked window is a limit too")
check(mod.meter_state({"status": "ok", "fiveHour": w(80), "weekly": None}) == "warn", "80% is a warning")
check(mod.meter_state({"status": "ok", "fiveHour": w(79), "weekly": w(1)}) == "ok", "under 80% is fine")
check(mod.meter_state(None) == "off" and mod.meter_state({"status": "no-meter"}) == "off", "nothing to read is off")
check(mod.clean_window({"used": 250}) == {"used": 100.0, "resetsAt": "", "locked": False} and mod.clean_window({"used": "x"}) is None, "a bad number can't get through")
check("SECRET" not in mod.usage_command() and "usage_host" not in mod.usage_command().split("b64decode")[0], "the command is the script, base64, nothing else")


class FakeHeadless:
    n = 0
    out = json.dumps({"active": "a", "rows": [{"name": "a", "active": True, "http": 200, "weekly": w(13), "plan": "max"}]})

    def vps_read(self, remote, timeout=15):
        FakeHeadless.n += 1
        return {"ready": bool(self.out), "out": self.out, "why": "" if self.out else "no VPS"}


plugin_services.provide("axf.headless@1", FakeHeadless(), "fake")
mod._usage.update(at=0.0, value=None)
u = c.get("/p/usage").json()
check(u["active"] == "a" and u["state"] == "ok" and u["accounts"][0]["weekly"]["used"] == 13, "GET usage")
check(c.get("/p/usage").json()["cached"] and FakeHeadless.n == 1, "cached: a second read doesn't touch the host")
check(c.get("/p/usage", params={"refresh": 1}).json()["cached"] and FakeHeadless.n == 1, "refresh right after a read still waits its 30 s")
mod._usage["at"] -= 31
check(c.get("/p/usage", params={"refresh": 1}).json()["cached"] is False and FakeHeadless.n == 2, "refresh after that reads the host")
FakeHeadless.out = ""
mod._usage["at"] -= 301
down = c.get("/p/usage").json()
check(down["accounts"][0]["status"] == "ok" or down["accounts"][0]["fresh"] is False, "the host down: the last numbers stay")
check(down["accounts"][0]["fresh"] is False, "and they are marked as old")
mod._usage.update(at=0.0, value=None)
check(c.get("/p/usage").json()["accounts"][0]["name"] == "a", "a restart reads the last numbers from disk")
check(TestClient(guest_app).get("/p/usage").json()["accounts"] == [], "a non-owner gets no account names")

# ---- AmberX phone

check(mod.amberx_classify("Recorder is idle", now)["state"] == "ok", "phone online")
check(mod.amberx_classify('The AmberX phone (S26) is offline; showing its last known recorder state.', now)["state"] == "error", "phone offline, no date")
seen = datetime.fromtimestamp((now - 60000) / 1000).astimezone().isoformat()
check(mod.amberx_classify(f'The AmberX phone is offline {{"lastSeen":"{seen}"}}', now)["state"] == "warn", "phone offline a minute: amber")
check(mod.amberx_classify("No AmberX phone is paired with axHub", now)["state"] == "off", "no phone paired")
check(mod.read_amberx()["state"] == "off", "no hub tool: off, says why")


class FakeVinny:
    n = 0

    def ready(self):
        return True, ""

    def call(self, tool, args, confirmation_id=None, timeout=600, reason=""):
        FakeVinny.n += 1
        assert tool == "amberx.recorder_status" and reason
        return {"ok": "Recorder is idle"}


plugin_services.provide("axf.vinny@1", FakeVinny(), "fake")
mod._amberx.update(at=0.0, value=None)
check(c.get("/p/amberx").json()["online"] is True and c.get("/p/amberx").json()["state"] == "ok" and FakeVinny.n == 1, "GET amberx asks the hub once a minute")
print(f"all {ok} checks passed")
