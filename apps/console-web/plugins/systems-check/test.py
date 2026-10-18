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
llm.broken = False
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

# What's new
head = subprocess.run(["git", "-C", str(REPO), "rev-parse", "HEAD"], capture_output=True, text=True).stdout.strip()
base = subprocess.run(["git", "-C", str(REPO), "rev-parse", "--verify", "-q", "HEAD~3^{commit}"], capture_output=True, text=True).stdout.strip()
check(any(p["folder"] == "systems-check" for p in c.get("/p/whats-new").json()["plugins"]), "plugin versions listed (for added / updated / removed)")
check(c.get("/p/whats-new?since=../../x").status_code == 400, "since must be a commit id")
check(not c.get("/p/whats-new?since=" + "f" * 40).json()["known"], "unknown commit → recent changes, flagged")
if not base:  # a shallow checkout (CI clones one commit): no history to count changes in
    print("  - commit-range checks skipped (shallow clone: no HEAD~3)")
    base = head
else:
    w = c.get(f"/p/whats-new?since={base}").json()
    check(w["head"] == head and w["known"] and len(w["commits"]) >= 1 and base not in [x["sha"] for x in w["commits"]], "commits since the last visit (not the last-seen one)")
    w = c.get(f"/p/whats-new?since={base}&summary=1").json()
    check(w["summary"]["text"].startswith("## New") and w["summary"]["agent"] == "Mosses", "AI summary by Mosses")
    c.put("/p/settings", json={"ai": {"whatsnew": False}})
    n_calls = len(llm.calls)
    w = c.get(f"/p/whats-new?since={base}&summary=1").json()
    check(w["summary"]["cached"] and len(llm.calls) == n_calls, "AI off: the saved summary still shows, no model call")
c.put("/p/settings", json={"whatsNewBanner": False})
check(c.get(f"/p/whats-new?since={base}").json()["banner"] is False, "banner can be switched off")

plugin_services.withdraw("fake-agent-manager")
check(not c.get("/p/ai").json()["effective"]["systems"], "removing Mosses switches AI off again")
check(c.post("/p/ai/test").status_code == 409, "AI test refused again without Mosses")
check(c.delete("/p/routine").json()["ok"] and c.get("/p/routine").json()["routine"] is None, "routine can be deleted")
root = os.environ["AXF_SYSTEMS_CHECK_DIR"]
check(all((p.stat().st_mode & 0o077) == 0 for p in Path(root).rglob("*") if p.is_file()), "data files private")
print(f"all {ok} checks passed")
