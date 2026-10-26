#!/usr/bin/env python3
"""Self-test for the Push banner plugin (fake GitHub API on loopback, through the real lib-github client).

    python3 apps/console-web/plugins/push-banner/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TOKEN = "ghp_" + "P" * 36
os.environ["AXF_PUSH_BANNER_DIR"] = tempfile.mkdtemp(prefix="axf-push-test-")
os.environ["GITHUB_TOKEN"] = TOKEN

# ---------------------------------------------------------------- fake GitHub (one repo, MossesX/AmberX-AXF)
R = "/repos/MossesX/AmberX-AXF"
SEEN: list[dict] = []
STATE = {
    "branches": ["main", "site", "feat/a", "feat/b", "old/merged"],
    "ahead": {"feat/a": 3, "feat/b": 1, "old/merged": 0},
    "pulls": [{"number": 18, "title": "Feature A", "html_url": "https://github.com/MossesX/AmberX-AXF/pull/18", "draft": False, "updated_at": "2026-10-22T07:00:00Z",
               "base": {"ref": "main"}, "user": {"login": "MossesX"}, "head": {"ref": "feat/a", "sha": "aaa111", "repo": {"full_name": "MossesX/AmberX-AXF"}}},
              {"number": 7, "title": "From a fork", "html_url": "https://github.com/MossesX/AmberX-AXF/pull/7", "draft": False, "updated_at": "2026-10-22T08:00:00Z",
               "base": {"ref": "main"}, "user": {"login": "someone"}, "head": {"ref": "patch-1", "sha": "fff999", "repo": {"full_name": "someone/AmberX-AXF"}}},
              {"number": 9, "title": "Draft work", "html_url": "https://github.com/MossesX/AmberX-AXF/pull/9", "draft": True, "updated_at": "2026-10-21T08:00:00Z",
               "base": {"ref": "feat/a"}, "user": {"login": "MossesX"}, "head": {"ref": "feat/a-sub", "sha": "ddd444", "repo": {"full_name": "MossesX/AmberX-AXF"}}}],
    "checks": {"aaa111": [{"status": "completed", "conclusion": "success", "name": "CI"}]},
    "mergeable": True,
    "merged": [],
    "created": [],
}


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null")

    def do_GET(self):  # noqa: N802
        u = urlsplit(self.path)
        p, q = unquote(u.path), parse_qs(u.query)
        SEEN.append({"method": "GET", "path": p, "auth": self.headers.get("Authorization", "")})
        if p == R:
            return self._send(200, {"default_branch": "main"})
        if p == R + "/branches":
            return self._send(200, [{"name": b} for b in STATE["branches"]])
        if p == R + "/pulls":
            pulls = STATE["pulls"]
            if "head" in q:
                pulls = [x for x in pulls if f"MossesX:{x['head']['ref']}" == q["head"][0]]
            return self._send(200, pulls)
        if p.startswith(R + "/pulls/") and p.endswith("/commits"):
            return self._send(200, [{"sha": f"c{i}", "html_url": f"https://github.com/MossesX/AmberX-AXF/commit/c{i}",
                                     "commit": {"message": f"Commit {i}\n\nmore", "author": {"name": "Brett", "date": "2026-10-22T06:00:00Z"}}} for i in range(25)])
        if p.startswith(R + "/pulls/"):
            n = int(p.rsplit("/", 1)[1])
            x = next((x for x in STATE["pulls"] if x["number"] == n), None)
            return self._send(200, {**x, "state": "open", "mergeable": STATE["mergeable"]} if x else {"message": "Not Found"})
        if p.startswith(R + "/compare/"):
            head = p.split("...", 1)[1]
            return self._send(200, {"ahead_by": STATE["ahead"].get(head, 0), "behind_by": STATE.get("behind", {}).get(head, 2), "commits": [{"sha": "x"}], "files": []})
        if p == R + "/commits":
            b = q["sha"][0]
            return self._send(200, [{"sha": f"{b}-head", "commit": {"message": f"Last on {b}\n\nbody", "committer": {"date": "2026-10-22T06:00:00Z" if b == "feat/b" else "2026-10-21T06:00:00Z"}}}])
        if p.startswith(R + "/commits/") and p.endswith("/check-runs"):
            sha = p.split("/")[-2]
            return self._send(200, {"check_runs": STATE["checks"].get(sha, [])})
        self._send(404, {"message": "Not Found"})

    def do_POST(self):  # noqa: N802
        p = unquote(urlsplit(self.path).path)
        b = self._body()
        SEEN.append({"method": "POST", "path": p, "body": b})
        if p == R + "/merges":
            STATE.setdefault("pulled", []).append(b)
            if b.get("base") == "feat/conflict":
                return self._send(409, {"message": "Merge conflict"})
            return self._send(201, {"sha": "pulled1"})
        if p == R + "/pulls":
            STATE["created"].append(b)
            return self._send(201, {"number": 19, "html_url": "https://github.com/MossesX/AmberX-AXF/pull/19"})
        self._send(404, {"message": "Not Found"})

    def do_PUT(self):  # noqa: N802
        p = unquote(urlsplit(self.path).path)
        b = self._body()
        SEEN.append({"method": "PUT", "path": p, "body": b})
        if p.endswith("/update-branch"):
            STATE.setdefault("updated", []).append((p, b))
            return self._send(202, {"message": "Updating pull request branch."})
        if p.endswith("/merge"):
            STATE["merged"].append((p, b))
            return self._send(200, {"merged": True, "sha": "merge123"})
        self._send(404, {"message": "Not Found"})


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["GITHUB_API_URL"] = f"http://127.0.0.1:{srv.server_address[1]}"

# ---------------------------------------------------------------- load the plugin
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=REPO)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.push_banner_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

clock = {"t": 1_000_000.0}
mod.PUSHES.clock = lambda: clock["t"]
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


print("push-banner self-test")
cfg = c.get("/p/config").json()
check(cfg["repos"] == ["MossesX/AmberX-AXF", "MossesX/axHub", "MossesX/Build-Pilot"], "default repos: AmberX-AXF, axHub, Build-Pilot")
# Pull main in: a PR through GitHub's update-branch (head pinned), a branch without one as a merge commit on it
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "number": 18})
check(u.status_code == 400 and "confirm" in u.json()["detail"], "pull main in: needs the typed confirm")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
up, ub = STATE["updated"][-1]
check(u.status_code == 200 and up == R + "/pulls/18/update-branch" and ub == {"expected_head_sha": "aaa111"}, "PR: update-branch, pinned to its head")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/b", "confirm": "MossesX/AmberX-AXF:feat/b"})
check(u.status_code == 200 and STATE["pulled"][-1] == {"base": "feat/b", "head": "main", "commit_message": "Merge main into feat/b (Dev Console Push banner)"}, "branch: main merged into it")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "main", "confirm": "MossesX/AmberX-AXF:main"})
check(u.status_code == 400, "never into the default branch")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
check(u.status_code == 409 and "conflicts" in u.json()["detail"], "conflicts: says to merge by hand")
u = c.post("/p/update", json={"repo": "Someone/Else", "branch": "x", "confirm": "Someone/Else:x"})
check(u.status_code == 400, "only watched repos")

# Claude on failure: a conflicted pull / refused merge goes to headless Claude Code on the VPS (approved on axHub)
cf = sys.modules[spec.name + ".claudefix"]
hub_calls = []
def fake_hub(tool, args, conf=None, timeout=None):
    hub_calls.append((tool, args["command"], conf))
    return {"confirm": "11111111-2222-3333-4444-555555555555"} if conf is None else {"ok": "$ …\nexit 0 · 40 ms\nstarted pid 7"}
class FakeChanges:
    def __init__(self): self.opened, self.updates = [], []
    def open(self, e, by): self.opened.append(e); return {"id": "chg-20261022-abcdef1234"}
    def update(self, cid, patch): self.updates.append(patch); return {}
fch = FakeChanges()
mod.CLAUDE.call, mod.CLAUDE.delays, mod.CLAUDE.changes = fake_hub, (lambda: [0.01] * 5), (lambda: fch)
# The real route goes through Mosses (axf.agents@1 → axhub_call): the push banner never calls axHub itself
import plugin_services  # noqa: E402
class FakeMosses:
    def __init__(self, tools=("axhub_call",)): self.tools, self.runs = tools, []
    def get_agent(self, aid): return {"id": aid, "tools": [{"name": t} for t in self.tools]} if aid == "coder" else None
    def run_tool(self, aid, name, args, ctx=None):
        self.runs.append((aid, name, args))
        return json.dumps({"status": "confirm", "confirmationId": "11111111-2222-3333-4444-555555555555"} if "confirmation_id" not in args else {"status": "ok", "output": "exit 0"})
check("agent manager" in cf.mosses_ready()[1], "no Mosses: the fix can't be handed over (it says why)")
fmo = FakeMosses()
plugin_services.provide("axf.agents@1", fmo, "fake-mosses")
r1 = cf.call_hub("vps.run", {"command": "echo hi"})
r2 = cf.call_hub("vps.run", {"command": "echo hi"}, "11111111-2222-3333-4444-555555555555")
check(r1 == {"confirm": "11111111-2222-3333-4444-555555555555"} and r2 == {"ok": "exit 0"} and fmo.runs[0][:2] == ("coder", "axhub_call")
      and fmo.runs[0][2]["wait"] is False and fmo.runs[0][2]["tool"] == "vps.run", "the launch goes through Mosses's axhub_call (approval id, then the output)")
plugin_services.withdraw("fake-mosses")
plugin_services.provide("axf.agents@1", FakeMosses(tools=("repo_read",)), "fake-mosses")
check("Safety" in cf.mosses_ready()[1], "Mosses without axhub_call: says to allow him dangerous tools")
plugin_services.withdraw("fake-mosses")
def settle(key):
    for _ in range(300):
        j = mod.CLAUDE.get(key)
        if j and j["state"] in ("launched", "failed"): return j
        time.sleep(0.01)
    return mod.CLAUDE.get(key)
check(c.post("/p/claude", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/b", "confirm": "MossesX/AmberX-AXF:feat/b"}).status_code == 409 and not hub_calls, "setting off: nothing handed over, Fix with Claude refused")
check(c.put("/p/config", json={"claudeOnFail": "yes"}).status_code == 400, "the switches are true/false")
check(c.put("/p/config", json={"claudeOnFail": True}).json()["claudeOnFail"] is True, "Hand failures to Claude Code is a setting")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
check(u.status_code == 409 and "Handed to Claude Code" in u.json()["detail"], "a conflicted Pull main in is handed to Claude (the error says so)")
j = settle("MossesX/AmberX-AXF:feat/conflict")
cmd = hub_calls[0][1]
check(j["state"] == "launched" and hub_calls[0][0] == "vps.run" and hub_calls[-1][2], "vps.run, waits for the approval, retries with its id, launched")
check(len(cmd) <= cf.MAX_COMMAND and "git clone -q 'https://github.com/MossesX/AmberX-AXF.git'" in cmd and "-B 'feat/conflict'" in cmd
      and "'origin/feat/conflict'" in cmd and "AXF_ADOPT_CHANGE=chg-20261022-abcdef1234" in cmd, "one clone per repo, a worktree on that branch, reports on its entry")
check("'Bash(git push origin HEAD:feat/conflict)'" in cmd and "--allowedTools Bash " not in cmd and "push origin HEAD:main" not in cmd, "shell off: edits + git, a push only to that branch")
b = __import__("base64").b64decode(cmd.split("echo '")[1].split("'")[0]).decode()
check("Never push to `main`" in b and "never force-push" in b and "never merge the PR" in b and "secrets" in b, "the brief: never main, never force, never merge, no secrets")
check(fch.opened and fch.opened[0]["surface"] == "console-launch" and fch.opened[0]["kind"] == "fix" and any(p.get("status") == "running" for p in fch.updates), "a change-log entry: it shows in the building banner")
u = c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
check(len(hub_calls) == 2, "not handed over again within the cooldown")
r = c.post("/p/claude", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
check(r.status_code == 200 and settle("MossesX/AmberX-AXF:feat/conflict")["state"] == "launched" and len(hub_calls) == 4, "Fix with Claude by hand skips the cooldown")
check(c.post("/p/claude", json={"repo": "MossesX/AmberX-AXF", "branch": "main", "confirm": "MossesX/AmberX-AXF:main"}).status_code == 400, "never the default branch")
STATE["mergeable"] = False
m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
STATE["mergeable"] = True
check(m.status_code == 409 and "conflicts" in m.json()["detail"] and "Handed to Claude Code" in m.json()["detail"], "a Merge GitHub refuses for conflicts is handed over")
check(settle("MossesX/AmberX-AXF:#18")["branch"] == "feat/a", "…on the PR's own branch")
# Vinny first (Oct 24 2026): his mapped command for the failure runs before Claude; the hub call goes through his tool first
class FakeVinny:
    def __init__(self, state="done"): self.state, self.started, self.calls = state, [], []
    def ready(self): return True, ""
    def auto_fix_first(self): return True
    def start_fix(self, key, text="", ctx=None, source=""): self.started.append((key, text, ctx)); return {"id": "v1", "name": "Re-pull", "state": "running"}
    def get_run(self, rid): return {"id": rid, "name": "Re-pull", "state": self.state, "message": "x"}
    def call(self, tool, a, conf=None, timeout=0, reason=""): self.calls.append(tool); return {"ok": "exit 0"}
fv = FakeVinny()
fch2 = FakeChanges()
L = cf.Launches(lambda: {"claudeOnFail": True}, call=fake_hub, delays=lambda: [0.01] * 5, changes=lambda: fch2, vinny_svc=lambda: fv, sleep=lambda s: None)
n0 = len(hub_calls)
L.maybe_launch({"repo": "MossesX/AmberX-AXF", "branch": "feat/v", "base": "main", "kind": "conflict", "action": "pull main in", "failure": "conflict"})
for _ in range(300):
    if (L.get("MossesX/AmberX-AXF:feat/v") or {}).get("state") in ("launched", "failed"): break
    time.sleep(0.01)
jv = L.get("MossesX/AmberX-AXF:feat/v")
check(jv["state"] == "launched" and "Vinny" in jv["message"] and len(hub_calls) == n0 and fv.started[0][2]["branch"] == "feat/v"
      and any(p.get("status") == "done" for p in fch2.updates), "Vinny's mapped command fixes it first: no Claude launch, the entry is done")
fv.state = "failed"
L.maybe_launch({"repo": "MossesX/AmberX-AXF", "branch": "feat/w", "base": "main", "kind": "conflict", "action": "pull main in", "failure": "conflict"})
for _ in range(300):
    if (L.get("MossesX/AmberX-AXF:feat/w") or {}).get("state") in ("launched", "failed"): break
    time.sleep(0.01)
check(L.get("MossesX/AmberX-AXF:feat/w")["state"] == "launched" and len(hub_calls) > n0, "Vinny's command fails → Claude Code is launched")
plugin_services.provide("axf.vinny@1", fv, "fake-vinny")
fv.calls.clear()
check(cf.call_hub("vps.run", {"command": "echo"}) == {"ok": "exit 0"} and fv.calls == ["vps.run"], "the hub call goes through Vinny's tool first")
plugin_services.withdraw("fake-vinny")
c.put("/p/config", json={"claudeShell": True})
try:
    cf.launch_command({"repo": "MossesX/AmberX-AXF", "branch": "x; rm -rf /", "base": "main", "kind": "conflict", "action": "x", "failure": ""}, "")
    odd = False
except cf.HubError:
    odd = True
check(odd, "odd branch names never reach the shell")
check("--allowedTools Bash;" in cf.launch_command({"repo": "MossesX/AmberX-AXF", "branch": "feat/a", "base": "main", "kind": "merge", "action": "merge it", "failure": "", "shell": True}, ""), "shell on: any command")
check(c.get("/p/claude").json()["on"] is True and all("command" not in j for j in c.get("/p/claude").json()["jobs"]), "GET claude: the setting and the jobs (no commands)")
c.put("/p/config", json={"claudeOnFail": False, "claudeShell": False})

cfg = c.put("/p/config", json={"repos": ["MossesX/AmberX-AXF"]}).json()
check(cfg["repos"] == ["MossesX/AmberX-AXF"], "repos are a setting")
check(c.put("/p/config", json={"repos": ["not a repo"]}).status_code == 400, "a bad repo name is refused")
check(c.put("/p/config", json={"hidden": ["MossesX/AmberX-AXF:../x"]}).status_code == 400, "a bad hidden entry is refused")
check(c.put("/p/config", json={"hidden": ["MossesX/AmberX-AXF:#7"]}).status_code == 200 and c.put("/p/config", json={"hidden": []}).status_code == 200, "a pull request can be hidden (owner/name:#N)")

out = c.get("/p/branches?refresh=true").json()
repo = out["repos"][0]
names = [b["name"] for b in repo["branches"]]
check(repo["base"] == "main" and not repo["error"], "base = the repo's default branch")
check(names == ["feat/b", "feat/a"], "only branches ahead of main, newest first (site, main and merged ones left out)")
a = next(b for b in repo["branches"] if b["name"] == "feat/a")
check(a["ahead"] == 3 and a["behind"] == 2 and a["subject"] == "Last on feat/a", "ahead/behind and the last commit's subject")
check(a["pr"] and a["pr"]["number"] == 18 and a["pr"]["ci"] == "success", "its open PR and the PR's CI")
check(a["url"] == "https://github.com/MossesX/AmberX-AXF/compare/main...feat/a", "compare link on github.com")
check(any(s["path"] == R + "/compare/main...feat/a" for s in SEEN), "compare asked with the branch name quoted as one ref")
check(all(s.get("auth") in (None, f"Bearer {TOKEN}") for s in SEEN), "the token goes to the API origin only")
check(TOKEN not in json.dumps(out), "the token never comes back to the browser")

pulls = repo["pulls"]
check([p["number"] for p in pulls] == [18, 7, 9], "every open pull request is an entry: ready first, then newest")
p18, p7, p9 = pulls
check(p18["ready"] is True and p18["ci"] == "success" and p18["mergeable"] is True and p18["head"] == "feat/a" and p18["base"] == "main", "ready = CI passed + mergeable + not a draft")
check(p7["fork"] is True and p7["ready"] is False and p7["ci"] == "none" and p7["author"] == "someone", "a PR from a fork is listed, with no CI it isn't ready")
check(p9["draft"] is True and p9["base"] == "feat/a" and p9["ready"] is False, "a draft PR into another branch is listed, not ready")
check(not any(b["name"] == "feat/a-sub" for b in repo["branches"]), "a PR's head that isn't ahead of main isn't a branch row")

n = len(SEEN)
c.get("/p/branches")
check(len(SEEN) == n, "answers cached (~2 min)")

r = c.post("/p/pr", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/a"}).json()
check(r["existing"] is True and r["number"] == 18, "Open PR on a branch that has one answers that PR")
r = c.post("/p/pr", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/b"}).json()
check(r["existing"] is False and r["number"] == 19 and STATE["created"][-1]["head"] == "feat/b" and STATE["created"][-1]["base"] == "main", "Open PR creates feat/b → main")
check(STATE["created"][-1]["title"] == "Last on feat/b", "the PR is titled from the last commit")
check(c.post("/p/pr", json={"repo": "MossesX/Other", "branch": "feat/b"}).status_code == 400, "a repo that isn't watched is refused")
check(c.post("/p/pr", json={"repo": "MossesX/AmberX-AXF", "branch": "main"}).status_code == 400, "no PR from main into main")

m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18})
check(m.status_code == 400, "merge needs the typed confirm")
STATE["checks"]["aaa111"] = [{"status": "in_progress", "conclusion": None}]
m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
check(m.status_code == 409 and "running" in m.json()["detail"], "no merge while CI runs")
STATE["checks"]["aaa111"] = [{"status": "completed", "conclusion": "success"}, {"status": "completed", "conclusion": "failure"}]
m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
check(m.status_code == 409 and "failed" in m.json()["detail"], "no merge when any check failed")
STATE["checks"]["aaa111"] = [{"status": "completed", "conclusion": "success"}, {"status": "completed", "conclusion": "skipped"}]
STATE["mergeable"] = False
m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
check(m.status_code == 409, "no merge when GitHub can't merge it (conflicts)")
STATE["mergeable"] = True
check(not STATE["merged"], "nothing merged so far")
m = c.post("/p/merge", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"}).json()
path, body = STATE["merged"][-1]
check(m["merged"] is True and path == R + "/pulls/18/merge", "green + mergeable: merged through the PR")
check(body == {"merge_method": "merge", "sha": "aaa111"}, "merge commit, pinned to the head that passed CI")
check(not any(s["method"] == "PUT" and "/git/refs" in s["path"] for s in SEEN), "main is never pushed to directly")

cfg = c.put("/p/config", json={"hidden": ["MossesX/AmberX-AXF:feat/b"]}).json()
out = c.get("/p/branches").json()
check(next(b for b in out["repos"][0]["branches"] if b["name"] == "feat/b")["hidden"] is True, "hidden branches are marked (shared setting)")

# ---------------------------------------------------------------- details, finished entries, the trash can
d = c.get("/p/detail", params={"repo": "MossesX/AmberX-AXF", "number": 18}).json()
check(len(d["commits"]) == 20 and d["commits"][0]["subject"] == "Commit 24" and d["commits"][0]["url"].startswith("https://github.com/"), "PR details: newest 20 commits, github.com links")
check(d["checks"] and d["checks"][0]["conclusion"] == "success" and d["sha"] == "aaa111", "PR details: the check runs on its head commit")
d = c.get("/p/detail", params={"repo": "MossesX/AmberX-AXF", "branch": "feat/b"}).json()
check(d["sha"] == "feat/b-head" and not d["error"], "branch details: compare + its head")
check(c.get("/p/detail", params={"repo": "MossesX/Other", "number": 1}).status_code == 400, "details: only watched repos")
check(c.get("/p/detail", params={"repo": "MossesX/AmberX-AXF", "branch": "../x"}).status_code == 400, "details: a bad branch name is refused")

out = c.get("/p/branches").json()
keys = [x["key"] for x in out["done"]]
check("MossesX/AmberX-AXF:#18" in keys and next(x for x in out["done"] if x["key"] == "MossesX/AmberX-AXF:#18")["kind"] == "merged", "a merge is remembered as finished (every device)")
check("MossesX/AmberX-AXF:#18" in keys and "MossesX/AmberX-AXF:feat/b" in keys, "a pull main in is remembered too (PR + branch)")
p18 = next(p for p in out["repos"][0]["pulls"] if p["number"] == 18)
check(p18["sha"] == "aaa111", "PR entries carry their head commit")
r = c.post("/p/done/remove", json={"key": "MossesX/AmberX-AXF:#18", "sha": "aaa111"}).json()
out = c.get("/p/branches").json()
p18 = next(p for p in out["repos"][0]["pulls"] if p["number"] == 18)
check(r["hiddenUntilNewCommit"] and "MossesX/AmberX-AXF:#18" not in [x["key"] for x in out["done"]] and p18["hidden"] is True, "trash: off the banner (finished entry gone, PR hidden at this commit)")
STATE["pulls"][0]["head"]["sha"] = "bbb222"
clock["t"] += 999
out = c.get("/p/branches").json()
p18 = next(p for p in out["repos"][0]["pulls"] if p["number"] == 18)
check(p18["hidden"] is False, "trash: it comes back once it gets a new commit")
check(c.post("/p/done/remove", json={"key": "MossesX/AmberX-AXF:feat/b"}).status_code == 200 and "MossesX/AmberX-AXF:feat/b" not in [x["key"] for x in c.get("/p/branches").json()["done"]], "trash without a sha: just forgotten")
check(c.post("/p/done/remove", json={"key": "nope"}).status_code == 400 and c.post("/p/done/remove", json={"key": "MossesX/AmberX-AXF:#1", "sha": "zz"}).status_code == 400, "trash: bad key or sha refused")
check(c.put("/p/config", json={"hidden": ["MossesX/AmberX-AXF:#7@abc1234"]}).status_code == 200 and c.put("/p/config", json={"hidden": ["MossesX/AmberX-AXF:#7@nothex!"]}).status_code == 400, "hidden@sha entries are checked")
clock["t"] += 8 * 24 * 3600
c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "number": 18, "confirm": "MossesX/AmberX-AXF#18"})
clock["t"] += 8 * 24 * 3600
check(c.get("/p/branches").json()["done"] == [], "finished entries expire after 7 days")

# ---- branches without a PR that merge cleanly (not behind main)
STATE["branches"] += ["cleanx", "waitx"]
STATE["ahead"].update({"cleanx": 2, "waitx": 1})
STATE["behind"] = {"cleanx": 0, "waitx": 0}
STATE["checks"]["cleanx-head"] = [{"status": "completed", "conclusion": "success", "name": "CI"}]
STATE["checks"]["waitx-head"] = [{"status": "in_progress", "conclusion": None, "name": "CI"}]
clock["t"] += 999
bs = {b["name"]: b for b in c.get("/p/branches").json()["repos"][0]["branches"]}
check(bs["cleanx"].get("clean") is True and bs["cleanx"]["canMerge"] is True and bs["cleanx"]["ci"] == "success", "clean: a PR-less branch not behind main with CI passed can merge")
check(bs["waitx"].get("clean") is True and bs["waitx"]["canMerge"] is False and bs["waitx"]["ci"] == "running", "clean: CI still running = listed, Merge waits")
check(not bs["feat/b"].get("clean"), "clean: a branch behind main isn't listed as clean")
M = "/p/merge-branch"
check(c.post(M, json={"repo": "MossesX/AmberX-AXF", "branch": "cleanx"}).status_code == 400, "merge-branch: needs the typed confirm")
check(c.post(M, json={"repo": "x/y", "branch": "cleanx", "confirm": "x/y:cleanx"}).status_code == 400, "merge-branch: only watched repos")
check(c.post(M, json={"repo": "MossesX/AmberX-AXF", "branch": "main", "confirm": "MossesX/AmberX-AXF:main"}).status_code == 400, "merge-branch: never the default branch")
r = c.post(M, json={"repo": "MossesX/AmberX-AXF", "branch": "waitx", "confirm": "MossesX/AmberX-AXF:waitx"})
check(r.status_code == 409 and "running" in r.json()["detail"], "merge-branch: refused while CI runs")
STATE["behind"]["cleanx"] = 1
r = c.post(M, json={"repo": "MossesX/AmberX-AXF", "branch": "cleanx", "confirm": "MossesX/AmberX-AXF:cleanx"})
check(r.status_code == 409 and "behind" in r.json()["detail"], "merge-branch: re-checked: behind main now = refused")
STATE["behind"]["cleanx"] = 0
n_created, n_merged = len(STATE["created"]), len(STATE["merged"])
r = c.post(M, json={"repo": "MossesX/AmberX-AXF", "branch": "cleanx", "confirm": "MossesX/AmberX-AXF:cleanx"})
check(r.status_code == 200 and r.json()["merged"] is True and r.json()["number"] == 19, "merge-branch: merged through its new PR")
check(len(STATE["created"]) == n_created + 1 and STATE["created"][-1]["head"] == "cleanx" and STATE["created"][-1]["base"] == "main", "merge-branch: opened a PR cleanx → main")
check(len(STATE["merged"]) == n_merged + 1 and STATE["merged"][-1][1] == {"merge_method": "merge", "sha": "cleanx-head"}, "merge-branch: merged with the head commit pinned")
check(not any(s["method"] in ("PUT", "POST") and s["path"].endswith("/git/refs/heads/main") for s in SEEN), "merge-branch: never writes main directly")
check("MossesX/AmberX-AXF:cleanx" in [d["key"] for d in c.get("/p/branches").json()["done"]], "merge-branch: shows in Done")

# ---- Pull failed group + Repair (Oct 23 2026)
c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
fl = {d["key"]: d for d in c.get("/p/branches").json()["failed"]}
check("MossesX/AmberX-AXF:feat/conflict" in fl and "conflicts" in fl["MossesX/AmberX-AXF:feat/conflict"]["error"], "failed pull: listed under Pull failed with its error")
check(c.post("/p/failed/remove", json={"key": "../x"}).status_code == 400, "failed/remove: checks the key")
c.put("/p/config", json={"claudeOnFail": False})
R0 = {"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"}
check(c.post("/p/claude", json=R0).status_code == 409, "setting off: Fix with Claude still refused")
n_hub = len(hub_calls)
r = c.post("/p/claude", json={**R0, "repair": True})
check(r.status_code == 200 and r.json()["job"]["state"] in ("asking", "waiting", "launched"), "Repair: hands it to Claude even with the setting off")
j = settle("MossesX/AmberX-AXF:feat/conflict")
check(len(hub_calls) > n_hub and j["state"] == "launched", "Repair: launched through vps.run")
check(c.post("/p/claude", json={**R0, "repair": "yes"}).status_code in (200, 409), "Repair: only true counts")
check(c.post("/p/claude", json={**R0, "rest": ["feat/b"]}).status_code == 400, "rest only with repair: true")
check(c.post("/p/claude", json={**R0, "repair": True, "rest": ["bad..name"]}).status_code == 400, "rest: branch names are checked")
n_hub = len(hub_calls)
r = c.post("/p/claude", json={**R0, "repair": True, "rest": ["feat/b", "main", "feat/x"]})
j = settle("MossesX/AmberX-AXF:feat/conflict")
cmd = hub_calls[n_hub][1]
check(r.status_code == 200 and j["rest"] == ["feat/b", "feat/x"], "Pull all hand-over: the rest of the repo's branches go with it (never the base)")
check("HEAD:feat/b" in cmd and "HEAD:feat/x" in cmd and "HEAD:main" not in cmd, "Pull all hand-over: pushes allowed only to those branches")
import base64 as _b64, gzip as _gz
_raw = _b64.b64decode(cmd.split("echo '")[1].split("'")[0])
b = (_gz.decompress(_raw) if "gunzip" in cmd else _raw).decode()
check("finish the banner's Pull all" in b and "`feat/x`" in b, "Pull all hand-over: the brief lists the rest")
many = [f"feat/n{i:02d}-{'x' * 60}" for i in range(80)]
cmd2, sent = cf.fit({"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "base": "main", "kind": "conflict", "action": "pull main in", "failure": "x", "rest": many}, "")
check(len(cmd2) <= cf.MAX_COMMAND and 0 < len(sent) < 80 and sent == many[:len(sent)], "Pull all hand-over: trimmed to fit the hub, extra branches dropped from the end")
check(c.post("/p/failed/remove", json={"key": "MossesX/AmberX-AXF:feat/conflict"}).json()["ok"], "failed/remove: takes it off")
check(not c.get("/p/branches").json()["failed"], "failed/remove: gone from the banner")
c.post("/p/update", json={"repo": "MossesX/AmberX-AXF", "branch": "feat/conflict", "confirm": "MossesX/AmberX-AXF:feat/conflict"})
check(c.get("/p/branches").json()["failed"], "failed again: back in Pull failed")

os.environ["GITHUB_TOKEN"] = ""
clock["t"] += 999
out = c.get("/p/branches").json()
check("GITHUB_TOKEN" in out["error"] and out["repos"] == [], "no token: says so instead of failing")
print(f"push-banner: {ok} checks passed")
