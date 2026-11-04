#!/usr/bin/env python3
"""Self-test for the Crew plugin: manifest, the pure core (stream fold, agent lookup, steps, status, git files + diff),
the server routes against fake capabilities, the zero-token rule, and the web core (core-check.mts).

    python3 apps/console-web/plugins/crew-live/test.py
"""
from __future__ import annotations

import json
import os
import re
import shutil
import subprocess
import sys
import tempfile
import time
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("crew self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.crew-live" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/crew-live", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["opens"] == "main", "model recorded, opens in the main area")
items = {i.get("id") or i.get("route"): i for i in man["commands"]["items"]}
check({"agents", "agent", "files", "diff", "stop"} <= set(items) and items["stop"]["destructive"] and items["stop"]["confirm"], "commands declared once: list, detail, files, diff, stop (destructive, confirmed)")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")
check("target: 'agent'" in web and all(f"'{a}" in web for a in ("agent-swarm.profile:{payload}", "crew.agent:{payload}", "crew.terminal:{payload}", "crew.stop:{payload}")), "agent context items contributed at run time (target agent)")

# ---- zero tokens: nothing in this plugin may reach a model
LLM = re.compile(r"\b(anthropic|openai|@anthropic-ai|claude_agent_sdk|langchain|google\.generativeai|axf\.llm@1|axf\.agents@1|messages\.create|/v1/messages|ai-assistant)\b", re.I)
hits = []
for f in [*HERE.glob("server/*.py"), *HERE.glob("web/*.ts"), *HERE.glob("web/*.tsx"), HERE / "hooks.mjs"]:
    for n, line in enumerate(f.read_text("utf-8").splitlines(), 1):
        if re.search(r"^\s*(import|from)\b|require\(|import\(|plugin_services\.get\(|fetch\(", line) and LLM.search(line):
            hits.append(f"{f.name}:{n}")
check(not hits, f"zero tokens: no LLM client, model API or LLM capability is imported or called ({hits or 'none'})")
srv_text = "\n".join(f.read_text("utf-8") for f in HERE.glob("server/*.py"))
check("claude -p" not in srv_text and '"claude"' not in srv_text, "never launches claude")
check("agent-swarm/" not in srv_text and "console-terminal/" not in srv_text and "session-history/" not in srv_text, "never reads another plugin's folder (capabilities only)")

sys.path.insert(0, str(HERE / "server"))
import crew  # noqa: E402

# ---- the stream fold
tmp = Path(tempfile.mkdtemp(prefix="crew-test-"))
os.environ["AXF_CREW_PATHS"] = ""
wt = tmp / "builds" / "demo-build"
wt.mkdir(parents=True)
ev = [
    {"type": "system", "subtype": "init", "model": "claude-opus-5-5", "session_id": "sess-1"},
    {"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 1000, "output_tokens": 100}, "content": [{"type": "text", "text": "Reading the store first."}]}},
    {"type": "assistant", "message": {"id": "m1", "model": "claude-opus-5-5", "usage": {"input_tokens": 1000, "output_tokens": 200}, "content": [
        {"type": "tool_use", "id": "t1", "name": "Read", "input": {"file_path": "/x/store.json"}},
        {"type": "tool_use", "id": "t2", "name": "Bash", "input": {"command": "git status", "description": "Show working tree status"}}]}},
    {"type": "user", "message": {"content": [{"type": "tool_result", "tool_use_id": "t1"}, {"type": "tool_result", "tool_use_id": "t2", "is_error": True}]}},
    {"type": "assistant", "message": {"id": "m2", "model": "claude-opus-5-5", "usage": {"input_tokens": 10, "output_tokens": 10, "cache_read_input_tokens": 5000}, "content": [
        {"type": "tool_use", "id": "t3", "name": "Edit", "input": {"file_path": "/x/apps/a.ts", "old_string": "sk-ant-abcdefghijk", "new_string": "b"}}]}},
]
(wt / "demo-build.jsonl").write_text("\n".join(json.dumps(e) for e in ev) + "\nnot json\n", "utf-8")
s = crew.read_stream(wt / "demo-build.jsonl")
check(s["model"] == "claude-opus-5-5" and s["sessionId"] == "sess-1", "stream: model and session id")
check(s["tokens"]["output"] == 210 and s["tokens"]["input"] == 1010 and s["tokens"]["cacheRead"] == 5000, "usage counted once per message id, last usage wins")
p = crew.prices().get("opus") or {}
want = (1010 * p.get("input", 0) + 210 * p.get("output", 0) + 5000 * p.get("cacheRead", 0)) / 1e6
check(abs(s["costUsd"] - round(want, 4)) < 1e-4 and not s["exactCost"], f"live cost from model-pricing@1 (${s['costUsd']})")
check([t["what"] for t in s["tools"]] == ["Editing a.ts", "Show working tree status", "Reading store.json"], "tool calls in plain English, newest first")
check(s["tools"][0]["state"] == "running" and s["tools"][1]["state"] == "failed" and s["tools"][2]["state"] == "done" and s["toolRunning"], "tool states: running / failed / done")
check(abs(s["tools"][1]["costUsd"] - s["tools"][2]["costUsd"]) < 1e-9 and s["tools"][1]["costUsd"] > 0, "a turn's cost is split between the calls it made")
check(s["text"] == "Reading the store first.", "last text kept")
with (wt / "demo-build.jsonl").open("a") as fh:
    fh.write(json.dumps({"type": "result", "subtype": "success", "total_cost_usd": 0.4242, "num_turns": 3}) + "\n")
s2 = crew.read_stream(wt / "demo-build.jsonl")
check(s2["costUsd"] == 0.4242 and s2["exactCost"] and not s2["toolRunning"], "the final result's total_cost_usd is the exact cost")
check(crew.redact("token sk-ant-abcdefghijk end") == "token [removed] end", "secrets removed")

# ---- agents, builds, status
roster = [{"id": "paulie", "name": "Ping Paulie", "role": "Site checker", "avatar": {"face": "tall", "hair": 1, "gear": "cap", "hue": 100}},
          {"id": "earl", "name": "Earl the Ear", "role": "Listener"}]
check(crew.resolve_agent(["paulie"], roster)["id"] == "paulie", "agent by tag")
check(crew.resolve_agent(["", "earl-site-check"], roster)["id"] == "earl", "agent by job session axf-<agent>-<job>")
check(crew.resolve_agent(["crew-live"], roster, "Brett said so. Assigned agent: Ping Paulie. Then…")["id"] == "paulie", "agent from the build's 'Agent: <name>' line")
check(crew.resolve_agent(["x"], roster, "Agent: **Earl the Ear** (voice)")["id"] == "earl", "bold names too")
check(crew.resolve_agent(["nobody"], roster, "no agent named") is None, "unknown agent: none")
check(crew.agent_view(None, "crew-live")["initials"] == "CL", "unknown agents get initials")
store = tmp / "store.json"
t0 = time.time() - 900
store.write_text(json.dumps({"builds": [{"id": "demo-build", "title": "Demo", "detail": "Agent: Ping Paulie", "pr": "301", "steps": [
    {"id": "s1", "text": "first", "model": "Opus", "done": True, "doneAt": crew.iso(t0 + 300)},
    {"id": "s2", "text": "second", "model": "Opus", "done": False},
    {"id": "s3", "text": "third", "model": "Fable", "done": False, "skip": False}]}]}), "utf-8")
builds = crew.store_builds(store)
prog = crew.build_progress(builds["demo-build"], t0)
check([x["state"] for x in prog["steps"]] == ["done", "now", "next"] and prog["now"]["id"] == "s2", "steps: done / now / next")
check(crew.parse_ts(prog["stepStartedAt"]) == crew.parse_ts(crew.iso(t0 + 300)), "the current step started when the last one was ticked")
check(prog["prUrl"].endswith("/pull/301"), "PR link")
now = time.time()
ses = [{"name": "axf-demo-build", "cwd": str(wt), "agent": "demo-build", "createdAt": int(t0 * 1000), "live": True}]
snap = crew.snapshot(ses, {}, builds, roster, now)
r = snap["runs"][0]
check(r["agent"]["id"] == "paulie" and r["build"]["id"] == "demo-build" and r["status"] == "idle", "a run with a result is idle; agent and build found")
(wt / "demo-build.jsonl").write_text("\n".join(json.dumps(e) for e in ev) + "\n", "utf-8")
snap = crew.snapshot(ses, {"axf-demo-build": {"costUsd": 1.5, "costEstimated": True, "tokens": {"input": 1, "output": 2}, "startedAt": crew.iso(t0)}}, builds, roster, now)
r = snap["runs"][0]
check(r["status"] == "working" and r["now"] == "Editing a.ts", "working; 'doing now' is the newest tool call")
check(r["costUsd"] == 1.5 and r["tokensTotal"] == 3, "the live meter (headless-meter@1) wins over the stream")
check(snap["totals"]["working"] == 1 and snap["totals"]["costRunningUsd"] == 1.5, "totals: working, cost running now")
check([a["id"] for a in snap["offTheClock"]] == ["earl"], "crew with no run are off the clock")
check(snap["buildAgents"] == {"demo-build": "paulie"}, "build → agent map for avatars on every build row")
old = now - 3 * 3600
os.utime(wt / "demo-build.jsonl", (old, old))
st = crew.snapshot([{**ses[0], "live": None}], {}, builds, roster, now)
check(st["runs"] == [] and st["totals"]["working"] == 0, "silent for hours with no tmux to ask: stopped, and out of the list")
st = crew.snapshot([{**ses[0], "live": True}], {}, builds, roster, now)
check(st["runs"][0]["status"] == "stuck" and "No activity" in st["runs"][0]["now"], "silent but its tmux is up: stuck")
b2 = json.loads(store.read_text("utf-8")); b2["builds"][0]["upgradeRequests"] = [{"phase": 1, "status": "pending"}]; store.write_text(json.dumps(b2))
st = crew.snapshot(ses, {}, crew.store_builds(store), roster, now)
check(st["runs"][0]["status"] == "waiting" and "approve" in st["runs"][0]["now"], "an upgrade request waiting: waiting on approval")
found = crew.discover_sessions(str(tmp / "builds"), now, within=4 * 3600)
check([x["name"] for x in found] == ["axf-demo-build"], "runs found from the worktrees' stream logs")

# ---- git: files + diff vs the base
git = shutil.which("git")
if not git:
    print("  - git checks skipped (no git)")
else:
    repo = tmp / "repo"
    repo.mkdir()
    g = lambda *a: subprocess.run(["git", "-C", str(repo), *a], capture_output=True, text=True, check=True)  # noqa: E731
    g("init", "-q", "-b", "main"); g("config", "user.email", "t@t"); g("config", "user.name", "t")
    (repo / "keep.py").write_text("def a():\n    return 1\n"); (repo / "gone.txt").write_text("x\n")
    g("add", "."); g("commit", "-qm", "base")
    g("checkout", "-qb", "work")
    (repo / "keep.py").write_text("def a():\n    return 2  # changed\n"); (repo / "gone.txt").unlink()
    g("commit", "-qam", "work")
    (repo / "fresh.ts").write_text("const x = 'hi';\n")
    fc = crew.changed_files(str(repo), time.time() - 60)
    kinds = {f["path"]: f["kind"] for f in fc["files"]}
    check(fc["ok"] and kinds == {"keep.py": "modified", "gone.txt": "deleted", "fresh.ts": "created"}, f"files vs the base: {kinds}")
    check(next(f for f in fc["files"] if f["path"] == "keep.py")["added"] == 1, "added / removed line counts")
    check(not any(f["path"] == "fresh.ts" for f in crew.changed_files(str(repo), time.time() + 60)["files"]), "untracked files from before the run don't count")
    d = crew.file_diff(str(repo), "keep.py")
    h = d["hunks"][0]
    check(h["added"] == 1 and h["removed"] == 1 and [x["t"] for x in h["lines"]] == ["ctx", "del", "add"], "diff hunks with typed lines")
    check(h["lines"][2]["n"] == 2 and h["lines"][1]["o"] == 2, "old / new line numbers")
    nd = crew.file_diff(str(repo), "fresh.ts")
    (repo / "pic.png").write_bytes(b"\x89PNG\r\n\x1a\n\0\0\0IHDR")
    check(crew.file_diff(str(repo), "pic.png").get("binary") is True, "a binary file is flagged, never shown as text")
    check(nd["hunks"][0]["added"] == 1 and nd["hunks"][0]["lines"][0]["text"] == "const x = 'hi';", "a new untracked file shows all added")
    for bad in ("../etc/passwd", "/etc/passwd", "a/../../x"):
        try:
            crew.file_diff(str(repo), bad)
            check(False, f"{bad} refused")
        except ValueError:
            check(True, f"path {bad!r} refused")
    # a worktree whose .git file names a host path, seen through the path map (the console container)
    os.environ["AXF_CREW_PATHS"] = f"/root/axf-builds={tmp / 'builds'},/opt/axf={tmp / 'repo'}"
    check(crew.local_path("/root/axf-builds/demo-build") == str(tmp / "builds" / "demo-build"), "host paths map into the container")
    os.environ["AXF_CREW_PATHS"] = ""

# ---- routes against fake capabilities
services: dict = {}
sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: services.get(name), provide=lambda *a: None)
try:
    import fastapi  # noqa: F401
except ImportError:
    print("  - server checks skipped (no fastapi)")
else:
    sys.path.insert(0, str(HERE))
    os.environ["AXF_BUILDS_ROOT"] = str(tmp / "builds")
    os.utime(wt / "demo-build.jsonl", None)
    import importlib
    srv = importlib.import_module("server")
    from fastapi import HTTPException
    srv.STORE = store
    srv.BUILDS_ROOT = str(tmp / "builds")
    a = srv.snapshot(force=True)
    check(a["$axf"] == "crew@1" and a["runs"][0]["name"] == "demo-build" and a["source"]["headless"] is False, "no Terminal: runs still read from the stream logs")
    check(a["runs"][0]["agent"]["known"] is False, "no roster: agents shown with initials")
    killed = []

    class Headless:
        def sessions(self):
            return {"ready": True, "items": [{"name": "axf-demo-build", "cwd": str(wt), "agent": "paulie", "createdAt": int(t0 * 1000)}]}

        def meters(self, names):
            return {"items": {"axf-demo-build": {"costUsd": 2.25, "tokens": {"input": 5}, "startedAt": crew.iso(t0)}}}

        def kill(self, name):
            killed.append(name)
            return {"ok": True, "name": name}

    class Roster:
        def agents(self):
            return roster

    services["axf.headless@1"] = Headless()
    services["axf.swarm-roster@1"] = Roster()
    a = srv.snapshot(force=True)
    check(a["runs"][0]["agent"]["name"] == "Ping Paulie" and a["runs"][0]["costUsd"] == 2.25, "Terminal + roster: named agent, live meter cost")
    check(srv.agent("paulie")["run"]["id"] == "axf-demo-build" and srv.agent("axf-demo-build")["run"]["name"] == "demo-build", "detail by agent id or run")
    try:
        srv.agent("nobody")
        check(False, "unknown → 404")
    except HTTPException as e:
        check(e.status_code == 404, "unknown agent → 404")
    out = srv.stop("paulie")
    check(out["ok"] and killed == ["axf-demo-build"], "stop kills the run's tmux session through axf.headless@1")
    services.pop("axf.headless@1")
    try:
        srv.stop("demo-build")
        check(False, "stop without Terminal refused")
    except HTTPException as e:
        check(e.status_code in (404, 409), "stop without the Terminal plugin is refused")
    try:
        srv.diff("demo-build", "../../etc/passwd")
        check(False, "bad diff path refused")
    except HTTPException as e:
        check(e.status_code == 400, "diff refuses paths outside the worktree")
    t1 = time.time(); srv.snapshot(); srv.snapshot(); srv.snapshot()
    check(time.time() - t1 < 1.0, "one snapshot shared by every caller within its TTL (no polling storm)")

npx = shutil.which("npx")
if not npx:
    print("  - web core checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "web" / "core-check.mts")], capture_output=True, text=True, timeout=300)
    last = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {"failed": ["crash: " + out.stderr[-300:]], "total": 0}
    check(out.returncode == 0 and not last["failed"] and last["total"] >= 10, f"web core: {last['total']} checks ({last['failed'] or 'all pass'})")
shutil.rmtree(tmp, ignore_errors=True)
print(f"all {ok} checks passed")
