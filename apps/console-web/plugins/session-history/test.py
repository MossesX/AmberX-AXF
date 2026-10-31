#!/usr/bin/env python3
"""Self-test for the session browser: manifest, run store (transcripts, stream logs, agent-run@1, swarm-runs@1),
statuses, prices, what it did (against a throwaway git repo), tabs, live tail, kill (process finding + route guards),
config, and the pure web core (npx tsx web/core-check.mts).

    python3 apps/console-web/plugins/session-history/test.py

Runs without FastAPI (a stand-in is used when it isn't installed) and never touches real sessions or processes.
"""
from __future__ import annotations

import asyncio
import json
import os
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


print("session-history self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.session-history" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/session-history", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["opens"] == "main" and man["tabable"] is True and man["banner"] is False, "model recorded, opens in main, tabable, no banner")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("id: ID" in web and "parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")
srcs = "".join(p.read_text("utf-8") for p in (HERE / "server").glob("*.py"))
check("codebase-changes" not in srcs and "session-checkin" not in srcs and "plugins/agent-swarm/" not in srcs.replace('"plugins" / "agent-swarm"', ""), "never imports other plugins by folder (capability service + shared data files only)")

# ---------------------------------------------------------------- stand-ins: fastapi (when missing), plugin_services
try:
    import fastapi  # noqa: F401
except ImportError:
    fa = types.ModuleType("fastapi")

    class HTTPException(Exception):
        def __init__(self, status_code, detail=""):
            super().__init__(detail)
            self.status_code, self.detail = status_code, detail

    class APIRouter:
        def __getattr__(self, _name):
            return lambda *a, **k: (lambda f: f)

    fa.HTTPException, fa.APIRouter, fa.Request = HTTPException, APIRouter, object
    sys.modules["fastapi"] = fa
services: dict = {}
sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: services.get(name))
from fastapi import HTTPException  # noqa: E402

tmp = Path(tempfile.mkdtemp(prefix="axf-sh-test-"))
os.environ["AXF_SESSION_HISTORY_DIR"] = str(tmp / "data")
sys.path.insert(0, str(HERE))
import server as srv  # noqa: E402
from server import did as D  # noqa: E402
from server import kill as K  # noqa: E402
from server import runs as R  # noqa: E402
from server import tabs as T  # noqa: E402


def jl(path: Path, rows: list) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(r) + "\n" for r in rows), "utf-8")


def ts(sec: float) -> str:
    return R.iso(sec)


# ---------------------------------------------------------------- prices
p = R.prices()
check(p["opus"]["input"] == 4 and "haiku" in p, "prices from model-pricing@1 (+ Haiku fallback)")
check(R.model_key("claude-opus-5-5") == "opus" and R.model_key("claude-fable-5-1") == "fable" and R.model_key("<synthetic>") == "", "model families")
u = R.usage_tokens({"input_tokens": 1_000_000, "output_tokens": 1_000_000, "cache_read_input_tokens": 1_000_000, "cache_creation_input_tokens": 2_000_000, "cache_creation": {"ephemeral_1h_input_tokens": 1_000_000}})
check(u == {"input": 1_000_000, "output": 1_000_000, "cacheRead": 1_000_000, "cacheWrite": 1_000_000, "cacheWrite1h": 1_000_000}, "usage split: 5-min and 1-h cache writes")
check(abs(R.cost(u, "claude-opus-5-5") - (4 + 20 + 0.2 + 5 + 8)) < 1e-9, "turn cost: 1-h cache writes at 2× input")
check(R.cost(u, "mystery") is None, "unknown model = unpriced, never guessed")
check(R.redact("key ghp_abcdefghijklmnop1234 and Bearer abcdefghijklmnopqrstuv") == "key [removed] and [removed]", "secrets removed from text")

# ---------------------------------------------------------------- fixture files
now = time.time()
t0 = now - 3600
home = tmp / "claude" / "projects" / "-w-repo"
work = tmp / "repo"
work.mkdir()
git = lambda *a: subprocess.run(["git", "-C", str(work), *a], capture_output=True, text=True, check=True)  # noqa: E731
git("init", "-q", "-b", "claude/demo")
git("config", "user.email", "t@example.com")
git("config", "user.name", "T")
git("remote", "add", "origin", "https://github.com/MossesX/AmberX-AXF.git")
(work / "a.txt").write_text("old line\nkeep\n")
git("add", "a.txt")
env_old = {"GIT_AUTHOR_DATE": ts(t0 - 100), "GIT_COMMITTER_DATE": ts(t0 - 100)}
subprocess.run(["git", "-C", str(work), "commit", "-q", "-m", "base"], env={**os.environ, **env_old}, check=True, capture_output=True)
(work / "a.txt").write_text("new line\nkeep\n")
git("add", "a.txt")
subprocess.run(["git", "-C", str(work), "commit", "-q", "-m", "Fix the banner clipping\n\nThe banner overlapped the clock on phones.\n\nCo-Authored-By: x"],
               env={**os.environ, "GIT_AUTHOR_DATE": ts(t0 + 25), "GIT_COMMITTER_DATE": ts(t0 + 25)}, check=True, capture_output=True)
sha = git("rev-parse", "HEAD").stdout.strip()

usage = {"input_tokens": 1000, "output_tokens": 500, "cache_read_input_tokens": 0, "cache_creation_input_tokens": 0}
S1 = "11111111-aaaa-bbbb-cccc-000000000001"
base = {"sessionId": S1, "cwd": str(work), "gitBranch": "claude/demo", "entrypoint": "cli", "version": "2.1"}
jl(home / f"{S1}.jsonl", [
    {**base, "type": "user", "timestamp": ts(t0), "message": {"role": "user", "content": "Fix the banner on phones"}},
    {**base, "type": "attachment", "timestamp": ts(t0 + 1), "attachment": {"type": "environment"}, "rendered": [{"content": "<system-reminder>env</system-reminder>"}]},
    {**base, "type": "assistant", "timestamp": ts(t0 + 10), "message": {"id": "m1", "model": "claude-opus-5-5", "content": [{"type": "thinking", "thinking": "look"}], "usage": usage}},
    {**base, "type": "assistant", "timestamp": ts(t0 + 10), "message": {"id": "m1", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": "tu1", "name": "Edit", "input": {"file_path": str(work / "a.txt"), "old_string": "old line", "new_string": "new line"}}], "usage": usage}},
    {**base, "type": "user", "timestamp": ts(t0 + 11), "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu1", "content": "edited"}]}},
    {**base, "type": "assistant", "timestamp": ts(t0 + 20), "message": {"id": "m2", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": "tu2", "name": "Bash", "input": {"command": "git commit -q -m 'Fix the banner clipping'"}}, {"type": "tool_use", "id": "tu3", "name": "Bash", "input": {"command": "git push"}}], "usage": usage}},
    {**base, "type": "user", "timestamp": ts(t0 + 30), "message": {"role": "user", "content": [{"type": "tool_result", "tool_use_id": "tu2", "content": ""}, {"type": "tool_result", "tool_use_id": "tu3", "content": "pushed https://github.com/MossesX/AmberX-AXF/pull/181", "is_error": False}]}},
    {**base, "type": "assistant", "timestamp": ts(t0 + 40), "message": {"id": "m3", "model": "claude-opus-5-5", "content": [{"type": "tool_use", "id": "tu4", "name": "Write", "input": {"file_path": str(work / "b.txt"), "content": "fresh\n"}}], "usage": usage}},
    {**base, "type": "assistant", "timestamp": ts(t0 + 50), "message": {"id": "m4", "model": "claude-haiku-5-5", "content": [{"type": "text", "text": "Fixed the banner; PR open."}], "usage": usage}},
    {**base, "type": "api-request", "timestamp": ts(t0 + 51)},
])
# a headless run: its transcript (entrypoint sdk-cli) + its stream log with the exact result
S2 = "22222222-aaaa-bbbb-cccc-000000000002"
jl(home / f"{S2}.jsonl", [
    {"sessionId": S2, "cwd": str(tmp / "w2"), "entrypoint": "sdk-cli", "type": "user", "timestamp": ts(t0 + 100), "message": {"role": "user", "content": "Build x"}},
    {"sessionId": S2, "type": "assistant", "timestamp": ts(t0 + 110), "message": {"id": "h1", "model": "claude-sonnet-5-5", "content": [{"type": "text", "text": "done"}], "usage": usage}},
])
streams = tmp / "streams"
jl(streams / ".axf-build.jsonl", [
    {"type": "system", "subtype": "init", "session_id": S2, "model": "claude-sonnet-5-5", "cwd": str(tmp / "w2"), "tools": ["Bash"]},
    {"type": "assistant", "session_id": S2, "message": {"id": "h1", "model": "claude-sonnet-5-5", "content": [{"type": "text", "text": "done"}], "usage": usage}},
    {"type": "result", "subtype": "success", "is_error": False, "session_id": S2, "total_cost_usd": 0.4242, "duration_ms": 61000, "num_turns": 1, "result": "Built x.", "usage": usage},
])
(streams / "notes.jsonl").write_text('{"hello": 1}\n')
# a stream that ran out of turns, still being written (a running stream without session in a transcript)
S3 = "33333333-aaaa-bbbb-cccc-000000000003"
jl(streams / "sub" / "run.jsonl", [
    {"type": "system", "subtype": "init", "session_id": S3, "model": "claude-opus-5-5", "cwd": "/nowhere"},
    {"type": "result", "subtype": "error_max_turns", "is_error": True, "session_id": S3, "total_cost_usd": 1.5},
])
# agent reports: agent-run@1 (with its own session id) and the agent swarm's runs.json (matched by folder + time)
reports = tmp / "reports"
reports.mkdir()
(reports / "r1.json").write_text(json.dumps({"$axf": "agent-run@1", "id": "r1", "agent": "docs-writer", "build": "session-history", "job": "s7", "model": "claude-haiku-5-5",
                                             "status": "running", "startedAt": ts(now - 30), "pid": 999999, "costUsd": 0.01,
                                             "changes": [{"item": "README for the browser", "wrong": "no docs", "before": "", "after": "# Session browser", "files": ["a.txt"]}]}))
swd = tmp / "swarm-wt"
S4 = "44444444-aaaa-bbbb-cccc-000000000004"
jl(home / f"{S4}.jsonl", [
    {"sessionId": S4, "cwd": str(swd), "entrypoint": "axf-swarm", "type": "user", "timestamp": ts(t0 + 200), "message": {"role": "user", "content": "job"}},
    {"sessionId": S4, "type": "assistant", "timestamp": ts(t0 + 205), "message": {"id": "s1", "model": "claude-haiku-5-5", "content": [{"type": "text", "text": "ok"}], "usage": usage}},
])
(reports / "runs.json").write_text(json.dumps({"$axf": "swarm-runs@1", "runs": [
    {"$axf": "swarm-run@1", "jobId": "b1:s2", "buildId": "b1", "stepId": "s2", "agent": "kotlin", "model": "haiku", "startedAt": ts(t0 + 199), "endedAt": ts(t0 + 210),
     "status": "killed", "reason": "over the token budget (9 > 5)", "usage": {"input": 1000, "output": 500, "cacheRead": 0, "cacheWrite": 0}, "reportedCost": 0.0031, "cwd": str(swd), "budget": {"tokens": 5}},
    {"$axf": "swarm-run@1", "jobId": "b1:s3", "buildId": "b1", "stepId": "s3", "agent": "docs", "model": "haiku", "startedAt": ts(t0 + 300), "endedAt": ts(t0 + 310), "status": "done",
     "report": {"summary": "Docs written", "files": ["README.md"]}, "usage": {"input": 10, "output": 5}, "cwd": "/gone"},
]}))

cfg = {"transcripts": [str(tmp / "claude" / "projects")], "streams": [str(streams)], "reports": [str(reports)]}
store = R.Store(tmp / "data", cfg)
srv.STORE = store
runs = {r["id"]: r for r in store.scan(now)}

# ---------------------------------------------------------------- run store
s1 = runs.get(S1)
check(s1 is not None and s1["kind"] == "session" and s1["title"] == "Fix the banner on phones", "regular session: kind and title from its first prompt")
check(s1["turns"] == 4 and s1["tools"] == 4 and s1["prompts"] == 1, "turns counted once per message (usage repeated per block is deduped)")
check(s1["tokens"]["input"] == 4000 and s1["tokens"]["output"] == 2000, "tokens summed per turn")
exp = 3 * R.cost(R.usage_tokens(usage), "opus") + R.cost(R.usage_tokens(usage), "haiku")
check(abs(s1["usd"] - exp) < 1e-9 and s1["costFrom"] == "usage", "session cost = every turn priced on its own model")
check(set(s1["models"]) == {"opus", "haiku"} and s1["models"]["opus"]["turns"] == 3, "per-model usage kept for the breakdown")
check(s1["status"] == "ended" and s1["build"] == "demo" and s1["branch"] == "claude/demo", "ended session; build from its claude/<build> branch")
check(s1["edits"] == sorted([str(work / "a.txt"), str(work / "b.txt")]), "edited files listed")
s2 = runs.get(S2)
check(s2 and s2["kind"] == "headless" and s2["status"] == "done" and s2["usd"] == 0.4242 and s2["costFrom"] == "result", "headless: transcript + stream merged, exact cost from the result")
check(s2["durationMs"] == 61000 and s2["files"]["stream"] and s2["files"]["transcript"], "duration from the result, both files linked")
s3 = runs.get(S3)
check(s3 and s3["status"] == "killed-budget" and s3["usd"] == 1.5, "a run out of turns = killed for budget")
check(not any("notes" in (r["files"].get("stream") or "") for r in runs.values()), "jsonl files that aren't stream logs are ignored")
r1 = runs.get("run-r1")
check(r1 and r1["kind"] == "agent" and r1["agent"] == "docs-writer" and r1["job"] == "s7" and r1["costFrom"] == "report", "agent-run@1 report: agent, build, job, cost")
check(r1["status"] == "stopped", "a report's pid that isn't alive = stopped, not running")
s4 = runs.get(S4)
check(s4 and s4["kind"] == "agent" and s4["agent"] == "kotlin" and s4["build"] == "b1" and s4["job"] == "s2", "swarm-run@1 matched to its transcript by worktree + time")
check(s4["status"] == "killed-budget" and s4["usd"] == 0.0031 and s4["budget"] == {"tokens": 5}, "swarm run killed over budget, its reported cost and budget")
lone = [r for r in runs.values() if r["agent"] == "docs"]
check(len(lone) == 1 and lone[0]["status"] == "done" and lone[0]["report"]["summary"] == "Docs written", "a swarm run without a transcript still shows, with its report")
check(list(runs)[0] == "run-r1", "newest first")

stamp = store.stamp()
store.scan(now)
check(store.stamp() == stamp, "stamp unchanged when nothing changed")
f1 = home / f"{S1}.jsonl"
with f1.open("a") as f:
    f.write(json.dumps({**base, "type": "assistant", "timestamp": ts(now - 5), "message": {"id": "m5", "model": "claude-opus-5-5", "content": [{"type": "text", "text": "more"}], "usage": usage}}) + "\n")
    f.write('{"type": "user", "partial')  # a line still being written
acc = store.accs[str(f1)]
before = acc.offset
runs = {r["id"]: r for r in store.scan(now)}
check(store.stamp() != stamp and runs[S1]["turns"] == 5 and runs[S1]["status"] == "running", "appended lines read incrementally; recent activity = running")
check(acc.offset > before and not f1.read_bytes()[: acc.offset].endswith(b"partial"), "a partial last line waits for the rest")

# ---------------------------------------------------------------- routes
r = srv.list_runs()
check(r["changed"] and len(r["runs"]) == len(runs) and all(not k.startswith("_") for k in r["runs"][0]), "GET runs: every run, no private keys")
check(srv.list_runs(since=r["stamp"]) == {"stamp": r["stamp"], "changed": False}, "GET runs?since=<stamp>: unchanged answer is tiny")
for bad, code in (("../etc", 400), ("nope", 404)):
    try:
        srv.get_run(bad)
        check(False, f"{bad} refused")
    except HTTPException as e:
        check(e.status_code == code, f"run id {bad!r} → {code}")

# ---------------------------------------------------------------- what it did
did = srv.get_did(S1)
commits = [ln for ln in did["lines"] if ln["kind"] == "commit"]
check(len(commits) == 1 and commits[0]["sha"] == sha and commits[0]["item"] == "Fix the banner clipping", "the run's commit found from the branch log (git commit -q prints nothing)")
check(commits[0]["wrong"] == "The banner overlapped the clock on phones.", "what was wrong = the commit body's first paragraph")
fa = commits[0]["files"][0]
check(fa["path"] == "a.txt" and fa["before"] == ["old line"] and fa["after"] == ["new line"] and fa["added"] == 1 and fa["removed"] == 1, "before / after from the real commit")
check(commits[0]["url"] == f"https://github.com/MossesX/AmberX-AXF/commit/{sha}" and fa["url"] == "https://github.com/MossesX/AmberX-AXF/blob/claude/demo/a.txt", "GitHub commit and file links")
unc = [ln for ln in did["lines"] if ln["kind"] == "uncommitted"]
check(len(unc) == 1 and unc[0]["files"][0]["path"] == "b.txt" and unc[0]["files"][0]["after"] == ["fresh"], "edits after the last commit listed as not committed")
check(did["links"]["prs"] == ["https://github.com/MossesX/AmberX-AXF/pull/181"] and did["summary"] == "more", "PR link from its output; summary = its last reply")
check(all(isinstance(ln["usd"], float) for ln in did["lines"]), "every line has an estimated price")
total = sum(ln["usd"] for ln in did["lines"])
check(abs(total - srv.STORE.run(S1)["usd"]) < 1e-6, "line prices add up to the run's turns")
check(did["changes"] == [] and did["checkin"] is None, "no changes service / check-in record: empty, no error")
services["axf.changes@1"] = types.SimpleNamespace(summaries=lambda: [{"id": "chg-20261031-abcdef", "title": "Banner fix", "branch": "claude/demo", "state": "done"}, {"id": "x", "branch": "other"}])
check([c["id"] for c in srv.get_did(S1)["changes"]] == ["chg-20261031-abcdef"], "Codebase changes entries by branch, through axf.changes@1")
services["axf.changes@1"] = types.SimpleNamespace(summaries=lambda: (_ for _ in ()).throw(RuntimeError("disk")))
check(srv.get_did(S1)["changes"] == [], "a broken changes log never breaks the detail")
rep = srv.get_did("run-r1")
check(rep["lines"][0]["kind"] == "report" and rep["lines"][0]["after"] == "# Session browser" and rep["lines"][0]["usd"] is None, "reported changes shown as lines (no transcript = no price)")
evs = [{"n": 0, "kind": "tool_result", "turn": 3, "text": "[claude/x 1a2b3c4] Add it\n 1 file changed"}]
check(D.commits_in_events(evs) == [{"sha": "1a2b3c4", "branch": "claude/x", "subject": "Add it", "turn": 3, "n": 0}], "commits read from git commit output")

# ---------------------------------------------------------------- tabs
ctx = srv.get_events(S1, "context", 0, 100)
check(ctx["total"] == 5 and ctx["items"][0]["inputs"][0]["kind"] == "prompt" and ctx["items"][0]["inputs"][1]["kind"] == "context", "context: one item per turn, prompt + reminders flow in")
check([o["kind"] for o in ctx["items"][0]["outputs"]] == ["thinking", "tool_use"] and ctx["items"][0]["usd"] is not None, "context: what it said back + the turn's cost")
check(ctx["items"][1]["inputs"][0]["kind"] == "tool_result", "tool results flow into the next turn")
tl = srv.get_events(S1, "tools", 0, 100)["items"]
check([t["tool"] for t in tl] == ["Edit", "Bash", "Bash", "Write"] and tl[2]["result"].startswith("pushed") and tl[3]["done"] is False, "tools: every call with its result (or still waiting)")
check(tl[1]["usd"] == tl[2]["usd"] and abs(tl[1]["usd"] * 2 - ctx["items"][1]["usd"]) < 1e-6, "cost per command = its share of the turn")
cv = srv.get_events(S1, "conversation", 0, 100)["items"]
check([c["who"] for c in cv] == ["you", "claude", "claude"] and cv[1]["text"].startswith("Fixed"), "conversation: prompts and replies only")
check(srv.get_events(S1, "tools", 1, 2)["items"][0]["tool"] == "Bash", "tabs are paged")
try:
    srv.get_events(S1, "secrets")
    check(False, "bad tab refused")
except HTTPException as e:
    check(e.status_code == 400, "unknown tab → 400")
check(T.tool_summary("Bash", {"command": "ls   -la"}) == "ls -la", "tool summary")

# ---------------------------------------------------------------- tail
tl0 = srv.get_tail(S1, -1)
check(tl0["offset"] == acc.offset and tl0["events"][-1]["text"] == "more" and tl0["status"] == "running", "tail from the end: last events, whole lines only")
check(srv.get_tail(S1, tl0["offset"])["events"] == [], "tail from the offset: nothing new")
with f1.open("a") as f:
    f.write('": "x"}\n')
    f.write(json.dumps({**base, "type": "assistant", "timestamp": ts(now - 1), "message": {"id": "m6", "model": "claude-opus-5-5", "content": [{"type": "text", "text": "newest"}], "usage": usage}}) + "\n")
check([e.get("text") for e in srv.get_tail(S1, tl0["offset"])["events"]] == ["newest"], "tail returns only what was appended")

# ---------------------------------------------------------------- kill
check(K.is_claude(["/usr/local/bin/claude-build", "-p", "x"]) and K.is_claude(["node", "/x/@anthropic-ai/claude-code/cli.js"]), "Claude Code processes recognised")
check(not K.is_claude(["/bin/bash", "-c", "source ~/.claude/shell-snapshots/claude-x"]) and not K.is_claude(["bash", "deploy/claude-headless.sh"]), "shells and wrapper scripts are not")
procs = [{"pid": 10, "argv": ["claude", "-p", "a"], "cwd": "/w/a"}, {"pid": 11, "argv": ["claude", "-p", "b"], "cwd": "/w/b"}, {"pid": 12, "argv": ["claude", "-p", "c"], "cwd": "/w/b"},
         {"pid": 13, "argv": ["claude", "--resume", "sid-9"], "cwd": "/w/c"}]
check(K.find_target({"pid": 10, "cwd": "/w/z"}, procs) == {"how": "pid", "pid": 10}, "kill target: the report's pid when it is Claude Code")
check("error" in K.find_target({"pid": 77, "cwd": "/w/a"}, procs), "a report pid that isn't Claude Code is refused")
check(K.find_target({"tmux": "axf-build-x"}, procs) == {"how": "tmux", "tmux": "axf-build-x"} and "error" in K.find_target({"tmux": "evil; rm"}, procs), "tmux session by its axf- name only")
check(K.find_target({"id": "sid-9", "cwd": "/w/c"}, procs) == {"how": "session", "pid": 13}, "a process naming the session id")
check(K.find_target({"id": "q", "cwd": "/w/a/"}, procs) == {"how": "folder", "pid": 10}, "the only claude -p in its folder")
check("not guessing" in K.find_target({"id": "q", "cwd": "/w/b"}, procs).get("error", ""), "two in one folder: refused, never a guess")
check("visible" in K.find_target({"id": "q", "cwd": "/w/none"}, procs).get("error", ""), "nothing visible: said so")


class Req:
    def __init__(self, body):
        self.body, self.headers = body, {}

    async def json(self):
        return self.body


def kill(rid, body):
    try:
        return asyncio.run(srv.post_kill(rid, Req(body)))
    except HTTPException as e:
        return e.status_code


check(kill(S2, {"confirm": "x"}) == 400, "kill needs confirm = the run id")
check(kill(S1, {"confirm": S1}) == 400, "a regular session can't be killed from here")
check(kill(S2, {"confirm": S2}) == 409, "a run that isn't running can't be killed")
sleeper = subprocess.Popen(["sleep", "30"])
orig = K.find_target
K.find_target = lambda run, procs=None: {"how": "pid", "pid": sleeper.pid}
store.runs()[[r["id"] for r in store.runs()].index(S4)]["status"] = "running"
res = kill(S4, {"confirm": S4})
K.find_target = orig
sleeper.wait(timeout=10)
check(isinstance(res, dict) and res["ok"] and sleeper.returncode is not None, "kill stops the process (SIGTERM)")
check(store.killed()[S4]["how"].startswith("pid") and res["run"]["status"] == "killed", "the kill is recorded and the run shows killed")

# ---------------------------------------------------------------- config
for bad in ({"streams": "x"}, {"streams": ["relative/path"]}, {"maxRuns": 5}, ["x"]):
    try:
        srv._clean_config(bad)
        check(False, f"{bad} refused")
    except HTTPException as e:
        check(e.status_code == 400, f"config {json.dumps(bad)} refused")
check(srv._clean_config({"streams": ["~/b", "/opt/axf"], "maxRuns": 100, "other": 1}) == {"streams": ["~/b", "/opt/axf"], "maxRuns": 100}, "config keeps only known, valid keys")
c = asyncio.run(srv.put_config(Req({"streams": [str(streams)]})))
check(c["config"]["streams"] == [str(streams)] and json.loads((tmp / "data" / "config.json").read_text())["streams"] == [str(streams)], "PUT config saved in the data folder only")

# ---------------------------------------------------------------- web core
npx = shutil.which("npx")
if not npx:
    print("  - core checks skipped (no node/npx)")
else:
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "web" / "core-check.mts")], capture_output=True, text=True, timeout=300)
    last = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {"failed": ["crash"], "total": 0}
    check(out.returncode == 0 and not last["failed"] and last["total"] > 20, f"pure web core: {last['total']} checks ({last['failed'] or 'all pass'})")

shutil.rmtree(tmp, ignore_errors=True)
print(f"all {ok} checks passed")
