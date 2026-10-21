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
jobs.start("host-mosh-ports", hf.command("host-mosh-ports"))
for _ in range(200):
    if (jobs.get("host-mosh-ports") or {}).get("state") in ("done", "failed"): break
    time.sleep(0.01)
j = jobs.get("host-mosh-ports")
check(j["state"] == "done" and rechecked == ["host-mosh-ports"], "approved on the hub → ran, then re-checked")
check(calls[0] == ("vps.run", "ufw allow 60000:61000/udp && bash /opt/axf/deploy/console-doctor.sh --report", None) and calls[-1][2], "the exact table command, then the same call with the approval id")
jobs2 = hf.Jobs(lambda cid: None, fake_call(["confirm", "reject"]), poll_s=0.01)
jobs2.start("host-mosh", hf.command("host-mosh"))
for _ in range(200):
    if (jobs2.get("host-mosh") or {}).get("state") in ("done", "failed"): break
    time.sleep(0.01)
check(jobs2.get("host-mosh")["state"] == "failed" and "Rejected" in jobs2.get("host-mosh")["message"], "rejected on the hub → nothing runs")
try:
    jobs.start("host-moshi-key", None); refused = False
except hf.HubError:
    refused = True
check(refused, "a check with no planned command is refused (the job never takes text from a request)")
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
# ---------------------------------------------------------------- Auto fix: anything a terminal can fix (Oct 21 2026)
fp = sys.modules[spec.name + ".fixplan"]
cf = sys.modules[spec.name + ".coolify"]
p_ = fp.plan({"id": "host-mosh", "fix": {"type": "host", "command": "anything"}})
check(p_ and p_["command"].startswith("DEBIAN_FRONTEND=noninteractive apt-get install") and p_["source"] == "table", "host checks use the table's non-interactive command")
check(fp.plan({"id": "host-claude-sync", "fix": {"type": "host", "command": "bash /opt/axf/deploy/console-doctor.sh --fix host-claude-sync"}})["command"].startswith("{ test -f /root/axHub"),
      "claude-sync is fixable now (clone + install, no prompt)")
check(fp.plan({"id": "host-x", "fix": {"type": "host", "command": "bash /opt/axf/deploy/console-doctor.sh --fix host-x"}}) is None, "interactive doctor --fix commands are never planned (Copy fix stays)")
check(all(fp.plan({"id": m, "fix": {"type": "host", "command": "true"}}) is None for m in ("host-claude-login", "moshi-key", "console-token", "host-git-auth")),
      "sign-ins, the Moshi key and the console token stay with Brett")
p_ = fp.plan({"id": "some-check", "fix": {"type": "host", "command": "systemctl restart cron"}})
check(p_["kind"] == "host" and p_["command"] == "systemctl restart cron && bash /opt/axf/deploy/console-doctor.sh --report", "any check's host command is planned, then the host report refreshes")
p_ = fp.plan({"id": "c1", "fix": {"type": "container", "container": "axhub-app", "command": "rm -f /tmp/x; echo 'hi'"}})
check(p_["command"].startswith("docker exec axhub-app sh -lc 'rm -f /tmp/x; echo '\"'\"'hi'\"'\"''"), "container commands run with docker exec, quoted")
check(fp.plan({"id": "c2", "fix": {"type": "container", "container": "coolify-db", "command": "psql"}}) is None
      and fp.plan({"id": "c3", "fix": {"type": "container", "container": "coolify-db", "restart": True}})["command"].startswith("docker restart coolify-db"),
      "never exec into Coolify or a database; restarting one is still allowed (approved)")
check(fp.plan({"id": "c4", "fix": {"type": "container", "container": "a;b", "restart": True}}) is None, "bad container names refused")
p_ = fp.plan({"id": "coolify-app:axhub", "fix": {"type": "coolify", "app": "abc123", "appKind": "service", "ops": [
    {"action": "env-set", "key": "PORT", "value": "8080"}, {"action": "env-from", "key": "AXHUB_WALL_SECRET", "source": "console-wall-secret"}, {"action": "env-unset", "key": "OLD"}], "then": "deploy"}})
check(p_["kind"] == "coolify" and p_["command"].startswith("python3 /opt/axf/deploy/coolify-fix.py --app abc123 --service env-set PORT=8080 env-from AXHUB_WALL_SECRET=console-wall-secret env-unset OLD deploy"),
      "Coolify fixes become one coolify-fix.py command (uuid, service flag, ops, redeploy)")
check(fp.plan({"id": "x", "fix": {"type": "coolify", "app": "a", "ops": [{"action": "env-set", "key": "K", "value": "it's; rm"}]}}) is None
      and fp.plan({"id": "x", "fix": {"type": "coolify", "app": "a", "ops": [{"action": "env-from", "key": "K", "source": "/etc/shadow"}]}}) is None
      and fp.plan({"id": "x", "fix": {"type": "coolify", "app": "a", "ops": [{"action": "env-set", "key": "bad key", "value": "1"}]}}) is None,
      "Coolify values must be plain text, secrets only from known VPS sources, keys checked")
check(fp.plan({"id": "routine:x", "fix": {"type": "host", "command": "true"}})["source"] == "ai", "commands Mosses wrote are marked AI")
fp.register_kind("test-kind", lambda f: "echo extension")
check(fp.plan({"id": "y", "fix": {"type": "test-kind"}})["command"].startswith("echo extension"), "fix kinds are an open registry")
fp.KINDS.pop("test-kind")
items_ = [{"id": "github-token", "status": "warn", "fix": {"type": "secrets", "fields": []}}, {"id": "zz", "status": "warn", "fix": {"type": "container", "container": "app1", "restart": True}},
          {"id": "host-claude-login", "status": "warn", "fix": {"type": "host", "command": "x"}}]
pl_ = fp.annotate(items_)
check(items_[0]["fix"]["type"] == "secrets" and items_[1]["fix"]["type"] == "host" and items_[1]["fix"]["kind"] == "container" and items_[1]["fix"]["auto"]
      and set(pl_) == {"zz"} and items_[2].get("manual"), "annotate: keys stay keys, terminal fixes show as host fixes the banner runs, manual ones say why")
check(fp.plan(items_[1])["command"] == pl_["zz"]["command"], "re-planning an annotated check gives the same command (no doubled report)")

# Coolify app checks: expectations are data; secrets compared by digest, never shown
app_ = {"name": "axHub", "env": [{"key": "PORT", "equals": "8080"}, {"key": "AXHUB_DATA_ORIGINS", "includes": ["https://a.example", "https://b.example"]},
                                 {"key": "AXHUB_WALL_SECRET", "sameAs": "console-wall-secret"}]}
os.environ["AXF_WALL_SECRET"] = "wall-secret-value-123"
pr_, ops_, _ = cf.evaluate(app_, {"PORT": "8080", "AXHUB_DATA_ORIGINS": "https://a.example", "AXHUB_WALL_SECRET": "other"})
check(len(pr_) == 2 and ops_[0] == {"action": "env-set", "key": "AXHUB_DATA_ORIGINS", "value": "https://a.example,https://b.example"}
      and ops_[1] == {"action": "env-from", "key": "AXHUB_WALL_SECRET", "source": "console-wall-secret"}, "includes adds what's missing; a different secret is fixed from the VPS copy")
check(not any("wall-secret-value" in x or "other" in x for x in pr_), "secret values never appear in the report")
pr_, ops_, _ = cf.evaluate(app_, {"PORT": "8080", "AXHUB_DATA_ORIGINS": "https://b.example https://a.example", "AXHUB_WALL_SECRET": "wall-secret-value-123"})
check(pr_ == [] and ops_ == [], "everything right (space-separated lists too) → nothing to fix")
del os.environ["AXF_WALL_SECRET"]
_, ops_, notes_ = cf.evaluate(app_, {"PORT": "1"})
check(ops_[0]["value"] == "8080" and any("skipped" in n for n in notes_) and len(ops_) == 2, "wrong value set back; sameAs skipped when the console has no secret")
check(cf.expectations()[0]["name"] == "axHub", "default expectations ship with the plugin")

# A fake Coolify on loopback: the check, the route's plan, and deploy/coolify-fix.py against it
import http.server, threading, socketserver  # noqa: E401,E402
SEEN: list = []
STATE = {"envs": [{"uuid": "e1", "key": "PORT", "value": "3000", "is_preview": False}, {"uuid": "e2", "key": "OLD", "value": "1", "is_preview": False}]}
class FakeCoolify(http.server.BaseHTTPRequestHandler):
    def log_message(self, *a): pass
    def _send(self, code, body):
        b = json.dumps(body).encode(); self.send_response(code); self.send_header("content-type", "application/json"); self.send_header("content-length", str(len(b))); self.end_headers(); self.wfile.write(b)
    def _auth(self):
        if self.headers.get("authorization") != "Bearer cool-token": self._send(401, {"message": "no"}); return False
        return True
    def do_GET(self):
        if not self._auth(): return
        SEEN.append(("GET", self.path))
        if self.path == "/api/v1/applications": return self._send(200, [{"uuid": "u-axhub", "name": "axHub"}, {"uuid": "u-other", "name": "Other"}])
        if self.path == "/api/v1/services": return self._send(200, [])
        if self.path == "/api/v1/applications/u-axhub/envs": return self._send(200, STATE["envs"])
        if self.path.startswith("/api/v1/deploy?uuid=u-axhub"): return self._send(200, {"deployments": [{"message": "queued"}]})
        if self.path == "/api/v1/redirect": self.send_response(302); self.send_header("location", "https://evil.example/"); self.end_headers(); return
        self._send(404, {"message": "nope"})
    def do_POST(self):
        if not self._auth(): return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        SEEN.append(("POST", self.path, body))
        if self.path == "/api/v1/applications/u-axhub/envs":
            if "is_build_time" in body: return self._send(422, {"message": "unknown field"})
            STATE["envs"].append({"uuid": "e" + str(len(STATE["envs"]) + 1), **body}); return self._send(201, {"uuid": "new"})
        self._send(404, {})
    def do_PATCH(self):
        if not self._auth(): return
        body = json.loads(self.rfile.read(int(self.headers.get("content-length", 0))) or b"{}")
        SEEN.append(("PATCH", self.path, body))
        for e in STATE["envs"]:
            if e["key"] == body["key"]: e["value"] = body["value"]
        self._send(201, {"uuid": "x"})
    def do_DELETE(self):
        if not self._auth(): return
        SEEN.append(("DELETE", self.path))
        STATE["envs"] = [e for e in STATE["envs"] if not self.path.endswith("/" + e["uuid"])]
        self._send(200, {"message": "deleted"})
srv = socketserver.ThreadingTCPServer(("127.0.0.1", 0), FakeCoolify); srv.daemon_threads = True
threading.Thread(target=srv.serve_forever, daemon=True).start()
base_ = f"http://127.0.0.1:{srv.server_address[1]}"
os.environ.update({"COOLIFY_URL": base_, "COOLIFY_TOKEN": "cool-token"})
cf._cache = None
got_ = cf.checks(mod.SVC.core.item)
ax_ = next(x for x in got_ if x["id"] == "coolify-app:axhub")
check(ax_["status"] == "warn" and ax_["fix"]["type"] == "coolify" and ax_["fix"]["app"] == "u-axhub" and any("PORT is wrong" in d for d in ax_["details"]),
      "Coolify app check: reads the app's variables and plans the fix by uuid")
mod.SVC.invalidate()
al_ = c.get("/p/autofix").json()
check(al_["plans"].get("coolify-app:axhub", {}).get("kind") == "coolify" and "coolify-fix.py --app u-axhub" in al_["commands"]["coolify-app:axhub"]
      and "host-claude-login" in al_["manual"], "GET autofix lists the Coolify fix with its exact command, and what stays manual")
check(c.post("/p/autofix/coolify-app:axhub").status_code == 409, "a planned Coolify fix still needs the axHub token (approval on the hub)")
check(c.post("/p/autofix/console-token").status_code == 400 and c.post("/p/autofix/host-moshi-key").status_code == 400 and c.post("/p/autofix/no-such-check").status_code == 400, "manual and unknown checks are refused")
rep_ = c.get("/p/check?force=1").json()
row_ = next(x for x in rep_["checks"] if x["id"] == "coolify-app:axhub")
check(row_["fix"]["type"] == "host" and row_["fix"]["kind"] == "coolify" and row_["fix"]["auto"], "the banner gets it as a host-type fix (so the existing Auto fix button runs it)")

tmp_axf = Path(tempfile.mkdtemp(prefix="axf-cf-"))
(tmp_axf / ".axf-console").mkdir()
(tmp_axf / ".axf-console" / "wall-secret").write_text("vps-wall-secret-xyz\n")
(tmp_axf / ".axf-console" / "secrets.env").write_text("COOLIFY_TOKEN=cool-token\nCOOLIFY_URL=http://coolify:8080\n")
def cfix(*args, env=None):
    e = {**{k: v for k, v in os.environ.items() if not k.startswith("COOLIFY_")}, "AXF_DIR": str(tmp_axf), "COOLIFY_HOST_URL": base_, **(env or {})}
    return subprocess.run([sys.executable, str(REPO / "deploy" / "coolify-fix.py"), *args], capture_output=True, text=True, timeout=60, env=e)
SEEN.clear()
r_ = cfix("--app", "u-axhub", "env-set", "PORT=8080", "env-from", "AXHUB_WALL_SECRET=console-wall-secret", "env-unset", "OLD", "deploy")
envs_ = {e["key"]: e.get("value") for e in STATE["envs"]}
check(r_.returncode == 0 and envs_.get("PORT") == "8080" and envs_.get("AXHUB_WALL_SECRET") == "vps-wall-secret-xyz" and "OLD" not in envs_,
      "coolify-fix.py: updates, creates (retrying without the build flag), removes")
check(any(x[0] == "GET" and x[1].startswith("/api/v1/deploy?uuid=u-axhub") for x in SEEN), "then redeploys the app")
check("vps-wall-secret-xyz" not in r_.stdout + r_.stderr and "cool-token" not in r_.stdout + r_.stderr, "never prints a secret value or the token")
SEEN.clear()
r_ = cfix("--app", "axHub", "env-set", "PORT=8080", "deploy")
check(r_.returncode == 0 and "already set" in r_.stdout and "no deploy" in r_.stdout and not any(x[0] == "GET" and "/deploy" in x[1] for x in SEEN),
      "by name too; nothing changed → no redeploy")
r_ = cfix("--app", "axHub", "env-set", "PORT=1", env={"COOLIFY_HOST_URL": "http://10.0.0.5:8000"})
check(r_.returncode == 1 and "refusing plain http" in r_.stderr, "plain http only to this machine")
r_ = cfix("--app", "axHub", "env-from", "X=/etc/shadow")
check(r_.returncode == 1 and "unknown secret source" in r_.stderr, "env-from only reads known sources")
r_ = cfix("--app", "axHub", "env-set", "PORT=1", env={"COOLIFY_TOKEN": "wrong"})
check(r_.returncode == 1 and "401" in r_.stderr and "permissions" in r_.stderr, "a refused token says so")
r_ = cfix("--app", "nope", "restart")
check(r_.returncode == 1 and "no single application" in r_.stderr, "an unknown app is refused")
srv.shutdown()
for k in ("COOLIFY_URL", "COOLIFY_TOKEN"):
    os.environ.pop(k, None)
mod.SVC.invalidate(); cf._cache = None

# AI routine checks may propose a fix; it's validated and only ever shown for approval
rt_ = sys.modules[spec.name + ".routine"]
v_, _ = rt_.validate([{"id": "a-check", "kind": "env", "params": {"name": "SOME_VAR"}, "fix": {"type": "host", "command": "touch /tmp/ok"}},
                      {"id": "b-check", "kind": "env", "params": {"name": "SOME_VAR"}, "fix": {"type": "host", "command": "a\nb"}},
                      {"id": "c-check", "kind": "env", "params": {"name": "SOME_VAR"}, "fix": {"type": "python", "code": "x"}}])
check(v_[0].get("fix") == {"type": "host", "command": "touch /tmp/ok"} and "fix" not in v_[1] and "fix" not in v_[2], "routine fixes: one-line host/container commands only")
row_ = rt_.run_one(v_[0], mod.SVC.core.item)
check(row_["status"] == "warn" and fp.plan(row_)["source"] == "ai", "a failing AI check offers its fix, marked AI")

root = os.environ["AXF_SYSTEMS_CHECK_DIR"]
check(all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_file()), "data files private")
print(f"all {ok} checks passed")
