#!/usr/bin/env python3
"""Self-test for the Systems check plugin (no network, no model: fake axf.llm@1 and axf.agents@1).

    python3 apps/console-web/plugins/systems-check/test.py

Checks the report (built-in + codebase-declared checks for every plugin and project manifest), credentials going to
the core store and never coming back, the AI switches (greyed out with what's missing, found by capability), the
AI routine (validated, saved, run without AI afterwards, nothing executed), What's new (commit ranges, unknown or
bad commits, saved summaries shown when AI is off) and the axf.syscheck@1 service.
"""
from __future__ import annotations

import importlib.util
import json
import time
import os
import subprocess
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
os.environ["AXF_SYSTEMS_CHECK_DIR"] = tempfile.mkdtemp(prefix="axf-sc-test-")
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402
import credentials  # noqa: E402
import plugin_services  # noqa: E402

CRED_DIR = Path(tempfile.mkdtemp(prefix="axf-sc-cred-"))
credentials.init(CRED_DIR)  # the store writes here, never into the repo
PLUGINS = {f.parent.name: {"folder": f.parent.name, "server": "loaded", "error": None} for f in (REPO / "apps/console-web/plugins").glob("*/plugin.json") if not f.parent.name.startswith("_")}
cx.set_context(ROOT=REPO, GITHUB_REPO="MossesX/AmberX-AXF", PLUGINS=PLUGINS, current_token=lambda: "t" * 32, persist_root=lambda: None,
               log=lambda *a, **k: None, plugin_enabled=lambda f: f in PLUGINS)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []

spec = importlib.util.spec_from_file_location("axf_console_plugins.systems_check_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
routine = sys.modules["axf_console_plugins.systems_check_test.routine"]

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")


@app.middleware("http")
async def _who(request, call_next):  # stands in for the console's auth: x-test-role picks the caller
    import wall
    role = request.headers.get("x-test-role", "admin")
    if role == "admin":
        request.state.axf_user = wall.TOKEN_CALLER
    elif role == "user":
        request.state.axf_user = wall.Caller("sam", "user", frozenset(), "session")
    return await call_next(request)
c = TestClient(app)
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("systems-check self-test")
r = c.get("/p/check?force=1").json()
ids = {x["id"] for x in r["checks"]}
check("console-token" in ids and "github-token" in ids, "built-in checks run")
check(all(f"plugin:{f}" in ids for f in PLUGINS), "every plugin folder gets a codebase-declared check")
check(any(i.startswith("plugin:ai-assistant:") for i in ids), "plugins' own declared self-checks (hooks.mjs) run")
check("project:." in ids and any(i.startswith("project:apps/") for i in ids), "every project manifest is validated")
check("shared-data-files" in ids, "the root manifest's shared data files are checked")
check({"plugins", "routine"} <= {s["id"] for s in r["services"]}, "plugin and routine groups listed")
check(r["routine"] is None and r["aiOn"] is False, "no routine and AI off on a fresh install")
check(plugin_services.get("axf.syscheck@1").run_all(), "axf.syscheck@1 serves alerts")
check(c.post("/p/check/console-token").json()["status"] == "ok", "re-run one built-in check")
check(c.post("/p/check/plugin:ai-assistant").json()["id"] == "plugin:ai-assistant", "re-run one derived check (id with a colon)")
check(c.post("/p/check/nope").status_code == 404, "unknown check is 404")

# credentials: core store, never returned
check(c.post("/p/secret", json={"key": "PATH", "value": "x"}).status_code == 400, "only known credentials are stored")
check(c.post("/p/secret", json={"key": "COOLIFY_TOKEN", "value": "bad\nvalue"}).status_code in (400, 422), "newlines refused")
rs = c.post("/p/secret", json={"key": "COOLIFY_TOKEN", "value": "tok-1234567890abcdef"})
check(rs.status_code == 200 and "tok-1234567890abcdef" not in rs.text, "credential saved and never echoed")
check("COOLIFY_TOKEN=tok-1234567890abcdef" in (CRED_DIR / ".axf-console" / "secrets.env").read_text() and os.environ.get("COOLIFY_TOKEN") == "tok-1234567890abcdef", "…in the core credential store and the environment")
check((CRED_DIR / ".axf-console" / "secrets.env").stat().st_mode & 0o077 == 0, "credential file is owner-only")
c.post("/p/secret/clear", json={"key": "COOLIFY_TOKEN"})
check("COOLIFY_TOKEN" not in os.environ, "credential cleared")

# Moshi key: public key saved here, installed on the VPS only by the host doctor (after it asks)
core = mod.SVC.core
core.host_file = CRED_DIR / "host-check.json"
def moshi_report(status):
    core.host_file.write_text(json.dumps({"at": int(time.time()), "checks": {"host-moshi-key": {"status": status, "summary": "Moshi's key can sign in as root (SHA256:abc)" if status == "ok" else "no key"}}}))
    core._cache = None
    return c.post("/p/check/moshi-key").json()
m = moshi_report("error")
check(m["status"] == "error" and m["fix"]["type"] == "secrets" and m["fix"]["fields"][0]["key"] == "MOSHI_SSH_PUBKEY", "missing Moshi key asks for it (Keys banner)")
check(c.post("/p/secret", json={"key": "MOSHI_SSH_PUBKEY", "value": "ssh-ed25519 AAAA; rm -rf /"}).status_code == 400, "a bad public key is refused")
PUB = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIOGOC/N77BgvtZdG/uidgdTbvzLfmJuahdbTZgOlB2FC moshi"
check(c.post("/p/secret", json={"key": "MOSHI_SSH_PUBKEY", "value": PUB}).status_code == 200, "Moshi public key saved")
m = moshi_report("error")
check(m["status"] == "warn" and "--fix host-moshi-key" in m["summary"], "saved but not on the VPS: says the command that installs it")
check(moshi_report("ok")["status"] == "ok", "on the VPS: ok")
c.post("/p/secret/clear", json={"key": "MOSHI_SSH_PUBKEY"})

# Auto fix for VPS checks: only commands from the table, sent to axHub's vps.run, run once approved there
hf = sys.modules.get(spec.name + ".hostfix")
check(hf is not None, "hostfix module loaded with the plugin")
calls = []
def fake_call(states):
    def f(tool, args, conf=None):
        calls.append((tool, args["command"], conf))
        st_ = states.pop(0)
        if st_ == "confirm": return {"confirm": "11111111-2222-3333-4444-555555555555"}
        if st_ == "reject": raise hf.HubError("The user rejected this call.")
        return {"ok": "$ cmd\nexit 0 · 10 ms\n"}
    return f
os.environ["AXHUB_TOKEN"] = "hub-token-for-test"
rechecked = []
jobs = hf.Jobs(lambda cid: rechecked.append(cid), fake_call(["confirm", "confirm", "ok"]), poll_s=0.01)
jobs.start("host-mosh-ports")
for _ in range(200):
    if (jobs.get("host-mosh-ports") or {}).get("state") in ("done", "failed"): break
    time.sleep(0.01)
j = jobs.get("host-mosh-ports")
check(j["state"] == "done" and rechecked == ["host-mosh-ports"], "approved on the hub → ran, then re-checked")
check(calls[0] == ("vps.run", "ufw allow 60000:61000/udp && bash /opt/axf/deploy/console-doctor.sh --report", None) and calls[-1][2], "the exact table command, then the same call with the approval id")
jobs2 = hf.Jobs(lambda cid: None, fake_call(["confirm", "reject"]), poll_s=0.01)
jobs2.start("host-mosh")
for _ in range(200):
    if (jobs2.get("host-mosh") or {}).get("state") in ("done", "failed"): break
    time.sleep(0.01)
check(jobs2.get("host-mosh")["state"] == "failed" and "Rejected" in jobs2.get("host-mosh")["message"], "rejected on the hub → nothing runs")
try:
    jobs.start("host-moshi-key"); refused = False
except hf.HubError:
    refused = True
check(refused and not hf.Jobs.allowed("host-moshi-key") and not hf.Jobs.allowed("host-mosh; rm -rf /"), "checks not in the table (Moshi key, anything else) are refused")
# Fixes that run longer than the hub's 25 s sync wait come back as a job: follow it to the command's real output
JID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee"
started = {"content": [{"type": "text", "text": json.dumps({"status": "started", "job_id": JID})}], "_meta": {"axhub/status": "started", "axhub/jobId": JID}}
check(hf._started_job(started, started["content"][0]["text"]) == JID, "a started job is recognised (not taken as the output)")
check(hf._started_job({"content": []}, "$ cmd\nexit 0") is None, "a direct answer isn't a job")
def job_reply(state, out=None, err=None):
    head = {"job_id": JID, "state": state, **({"error": err} if err else {})}
    return {"content": [{"type": "text", "text": json.dumps(head)}] + ([{"type": "text", "text": out}] if out else []), "_meta": {"axhub/jobState": state}}
def fake_rpc(replies):
    def f(url, tok, sid, method, params, timeout):
        r = replies.pop(0)
        if isinstance(r, Exception): raise r
        assert params == {"name": "get_job", "arguments": {"job_id": JID}}
        return r, sid
    return f
r = hf._follow_job("https://hub", "t", "s1", JID, 60, poll_s=0, rpc=fake_rpc([job_reply("running"), hf.HubError("axHub answered 404"), job_reply("succeeded", "$ apt-get install -y mosh\nexit 0 · 40000 ms\n")]), reinit=lambda: "s2")
check(r["ok"].splitlines()[1].startswith("exit 0"), "running → session expired (new session) → succeeded: the command's output comes back")
try:
    hf._follow_job("https://hub", "t", "s1", JID, 60, poll_s=0, rpc=fake_rpc([job_reply("failed", err={"message": "The command didn't finish"})])); bad = ""
except hf.HubError as e:
    bad = str(e)
check("didn't finish" in bad, "a failed job reports the hub's reason")
check(c.post("/p/autofix/host-claude-login").status_code == 400, "route refuses checks that need you at the machine")
del os.environ["AXHUB_TOKEN"]
check(c.post("/p/autofix/host-mosh").status_code == 409, "without the axHub token it says to add it")

# AI switches need the assistant + Mosses
a = c.get("/p/ai").json()
check(not a["requirements"]["ok"] and not a["effective"]["systems"], "AI greyed out with nothing installed")
r409 = c.post("/p/ai/test")
check(r409.status_code == 409 and "AI assistant" in r409.json()["detail"] and "Mosses" in r409.json()["detail"], "AI test says what's missing")
def _providing(cap):
    return sorted(f.parent.name for f in (REPO / "apps/console-web/plugins").glob("*/plugin.json")
                  if not f.parent.name.startswith("_") and f"service:{cap}" in json.loads(f.read_text()).get("provides", []))


check(sorted(p["folder"] for p in a["requirements"]["assistant"]["providers"]) == _providing("axf.llm@1"), "the missing assistant is found by capability (for the install link)")
check(sorted(p["folder"] for p in a["requirements"]["mosses"]["providers"]) == _providing("axf.agents@1")
      and all(p["tab"] for p in a["requirements"]["mosses"]["providers"]), "…and the agent manager, with its settings tab")
check(c.put("/p/settings", json={"ai": {"systems": True}}).status_code == 409, "can't turn AI on while something's missing")
check(c.post("/p/routine/run").status_code == 409, "no AI run while off")
st = c.get("/p/ai/state").json()
check(not st["ok"] and "isn't connected" in st["error"], "key Auto fix: Claude not connected without the assistant + Mosses")
check(c.post("/p/keys/GITHUB_TOKEN/guide").status_code == 409, "key Auto fix refused while Claude isn't connected")

REPLY = {"checks": [
    {"id": "coolify-url-set", "kind": "env", "params": {"name": "COOLIFY_URL"}, "title": "Coolify URL", "service": "coolify", "severity": "warn", "why": "redeploys need it"},
    {"id": "readme", "kind": "file", "params": {"path": "README.md"}, "title": "README exists", "severity": "info"},
    {"id": "pkg-name", "kind": "json", "params": {"path": "apps/console-web/package.json", "key": "name"}, "title": "console package name"},
    {"id": "containers", "kind": "service", "params": {"name": "axf.containers@1"}, "title": "container access"},
    {"id": "evil-path", "kind": "file", "params": {"path": "../../etc/passwd"}, "title": "x"},
    {"id": "evil-kind", "kind": "command", "params": {"cmd": "rm -rf /"}, "title": "x"},
    {"id": "evil-http", "kind": "http", "params": {"url": "http://169.254.169.254/latest"}, "title": "x"},
    {"id": "readme", "kind": "file", "params": {"path": "README.md"}, "title": "dupe"},
]}


class FakeLlm:
    calls: list = []

    def profiles(self):
        return [{"id": "fake", "keyReady": True}]

    def complete(self, messages, system=None, profile=None, model=None, tools=None, params=None):
        self.calls.append({"system": system, "text": messages[-1]["content"]})
        if messages[-1]["content"].startswith("Connection test"):
            if getattr(self, "broken", False):
                raise RuntimeError("401 invalid x-api-key")
            return {"text": "OK, Mosses here.", "model": "fake-1", "profile": "fake"}
        if messages[-1]["content"].startswith("Brett needs a"):
            return {"text": "1. Open the page\n2. Tap Generate token\n3. Copy it\n4. Paste it here", "model": "fake-1"}
        if messages[-1]["content"].startswith("You're running the systems check"):
            return {"text": "Aight boss, here's the routine:\n" + json.dumps(REPLY), "model": "fake-1", "profile": "fake"}
        return {"text": "## New\n- **Mosses** got container powers\n- Snapshots before every change", "model": "fake-1"}


class FakeAgents:
    def get_agent(self, aid):
        return {"id": aid, "name": "Mosses", "system_prompt": "You are Mosses."} if aid == "coder" else None


llm = FakeLlm()
plugin_services.provide("axf.llm@1", llm, "fake-assistant")
check(not c.get("/p/ai").json()["requirements"]["ok"], "assistant alone isn't enough")
plugin_services.provide("axf.agents@1", FakeAgents(), "fake-agent-manager")
a = c.get("/p/ai").json()
check(a["requirements"]["ok"] and a["requirements"]["mosses"]["name"] == "Mosses", "assistant + Mosses → AI available")
t = c.post("/p/ai/test").json()
check(t["ok"] and t["agent"] == "Mosses" and t["model"] == "fake-1" and t["reply"].startswith("OK") and t["ms"] >= 0 and "You are Mosses" in llm.calls[-1]["system"], "AI test: one request through the assistant, as Mosses (switches still off)")
llm.broken = True
t = c.post("/p/ai/test").json()
check(not t["ok"] and "invalid x-api-key" in t["error"], "AI test reports the provider's error")
check(not c.get("/p/ai/state").json()["ok"], "AI state follows a failed test")
check(c.post("/p/keys/GITHUB_TOKEN/guide").status_code == 409, "key Auto fix greyed out while Claude's connection fails")
llm.broken = False
st = c.get("/p/ai/state?refresh=true").json()
check(st["ok"] and st["model"] == "fake-1", "AI state ok once Claude answers")
g = c.post("/p/keys/GITHUB_TOKEN/guide").json()
check(g["url"].startswith("https://github.com/settings/personal-access-tokens/new?") and "contents=write" in g["url"] and "actions=write" in g["url"] and "target_name=MossesX" in g["url"], "GitHub: pre-filled fine-grained token page")
check(len(g["steps"]) == 4 and "Paste" in g["steps"][-1] and "Brett needs a GitHub token" in llm.calls[-1]["text"], "Claude writes the steps for this key")
check(c.post("/p/keys/ANTHROPIC_API_KEY/guide").json()["url"] == "https://console.anthropic.com/settings/keys", "Anthropic key page")
check(c.post("/p/keys/COOLIFY_URL/guide").status_code == 404 and c.post("/p/keys/NOPE/guide").status_code == 404, "only secret keys the console asks for")
check(all("ghp_" not in str(x) and "sk-ant" not in str(x) for x in g.values()), "the guide never carries a key")
check(c.put("/p/settings", json={"ai": {"systems": True, "whatsnew": True}}).status_code == 200, "AI switches turn on")
rr = c.post("/p/routine/run").json()["routine"]
kept = {x["id"] for x in rr["checks"]}
check(kept == {"coolify-url-set", "readme", "pkg-name", "containers"}, f"AI routine validated (kept {sorted(kept)})")
check(len(rr["rejected"]) == 4 and rr["agent"] == "Mosses" and rr["head"], "bad proposals rejected; routine records agent and commit")
check("You are Mosses" in llm.calls[-1]["system"] and "Console plugins" in llm.calls[-1]["text"] and "secrets.env" not in llm.calls[-1]["text"].replace("credentials", ""),
      "Mosses gets a codebase digest (no secret values)")
r = c.get("/p/check?force=1").json()
rc = {x["id"]: x for x in r["checks"] if x["id"].startswith("routine:")}
check(rc["routine:readme"]["status"] == "ok" and rc["routine:pkg-name"]["status"] == "ok", "routine checks run")
check(rc["routine:coolify-url-set"]["status"] == "warn" and rc["routine:coolify-url-set"]["service"] == "coolify", "failing routine check keeps its severity and group")
check(r["routine"]["checks"] == 4 and not r["routine"]["stale"], "report says where the routine came from")
c.put("/p/settings", json={"ai": {"systems": False}})
n_calls = len(llm.calls)
r = c.get("/p/check?force=1").json()
check(any(x["id"] == "routine:readme" for x in r["checks"]) and len(llm.calls) == n_calls, "AI off: the saved routine still runs, with no model call")
check("pattern" not in routine.validate([{"id": "x1", "kind": "env", "params": {"name": "A_B", "pattern": "(a|aa)+$"}}])[0][0]["params"], "env checks are presence only (no pattern on a secret's value)")
check(routine._public_ips("localhost") == [] and routine._public_ips("10.0.0.1") == [], "https checks resolve once and only to public addresses")
check(routine.run_one({"id": "h", "kind": "http", "params": {"url": "https://localhost/"}, "title": "h", "service": "routine", "severity": "warn"}, mod.SVC.core.item)["summary"].startswith("refused"),
      "https checks only reach public hosts")

# What's new (one shared "seen" point on the server; only admins move it)
head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
base = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--verify", "-q", "HEAD~3^{commit}"], capture_output=True, text=True).stdout.strip()
w = c.get("/p/whats-new").json()
check(any(p["folder"] == "systems-check" for p in w["plugins"]), "plugin versions listed (for added / updated / removed)")
check(w["seen"]["sha"] == head and not w["commits"], "first run starts counting from now, for everyone")
check(w["canClear"] is True and c.get("/p/whats-new", headers={"x-test-role": "user"}).json()["canClear"] is False, "canClear: admins yes, hub users no")
check(c.get("/p/whats-new", headers={"x-test-role": "none"}).json()["canClear"] is False, "unknown caller can't clear (fails closed)")
check(c.post("/p/whats-new/seen", json={"head": head}, headers={"x-test-role": "user"}).status_code == 403, "a non-admin can't clear What's new")
check(c.post("/p/whats-new/seen", json={"head": head}, headers={"x-test-role": "none"}).status_code == 403, "an unknown caller can't clear What's new")
check(c.post("/p/whats-new/seen", json={"head": "../../x"}).status_code == 400, "head must look like a commit id")
check(c.post("/p/whats-new/seen", json={"head": "f" * 40}).status_code == 400, "head must be a commit on the branch")
if not base:  # a shallow checkout (CI clones one commit): no history to count changes in
    print("  - commit-range checks skipped (shallow clone: no HEAD~3)")
    base = head
else:
    store = mod.store
    store.save_whats_new_seen(base, {"systems-check": "0.0.0"}, "test")
    w = c.get("/p/whats-new", headers={"x-test-role": "user"}).json()
    check(w["head"] == head and w["known"] and len(w["commits"]) >= 1 and base not in [x["sha"] for x in w["commits"]], "commits since the shared seen point (not the seen one)")
    check(w["seen"]["plugins"] == {"systems-check": "0.0.0"}, "seen plugin versions shared (so updates show)")
    w = c.get("/p/whats-new?summary=1").json()
    check(w["summary"]["text"].startswith("## New") and w["summary"]["agent"] == "Mosses", "AI summary by Mosses")
    c.put("/p/settings", json={"ai": {"whatsnew": False}})
    n_calls = len(llm.calls)
    w = c.get("/p/whats-new?summary=1").json()
    check(w["summary"]["cached"] and len(llm.calls) == n_calls, "AI off: the saved summary still shows, no model call")
    r = c.post("/p/whats-new/seen", json={"head": head})
    check(r.status_code == 200 and r.json()["seen"]["by"] == "console-token", "an admin clears it (who is recorded)")
    w = c.get("/p/whats-new", headers={"x-test-role": "user"}).json()
    check(not w["commits"] and w["seen"]["sha"] == head, "cleared for every viewer")
c.put("/p/settings", json={"whatsNewBanner": False})
check(c.get("/p/whats-new").json()["banner"] is False, "banner can be switched off")

plugin_services.withdraw("fake-agent-manager")
check(not c.get("/p/ai").json()["effective"]["systems"], "removing Mosses switches AI off again")
check(c.post("/p/ai/test").status_code == 409, "AI test refused again without Mosses")
check(c.delete("/p/routine").json()["ok"] and c.get("/p/routine").json()["routine"] is None, "routine can be deleted")

# Coolify address rules (Oct 21 2026): https anywhere, plain http only to Coolify's own container on the Docker network.
_chk = sys.modules.get("axf_console_plugins.systems_check_test.checks")
if _chk is not None:
    from axf_server import http as _h
    check(_h.target_ok("http://coolify:8080", _chk.COOLIFY_INTERNAL_HOSTS) and _h.target_ok("https://coolify.example.com", _chk.COOLIFY_INTERNAL_HOSTS)
          and not _h.target_ok("http://31.97.13.252:8000", _chk.COOLIFY_INTERNAL_HOSTS), "Coolify URL: https or http://coolify only, never http to an IP")
root = os.environ["AXF_SYSTEMS_CHECK_DIR"]
check(all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_file()), "data files private")
print(f"all {ok} checks passed")
