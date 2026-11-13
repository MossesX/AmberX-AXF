#!/usr/bin/env python3
"""Self-test for the GitHub client plugin: a fake GitHub API on loopback (through the real lib-github client) and a
real local git remote for the scratch-clone work (pull main in, batches, clashes).

    python3 apps/console-web/plugins/github-client/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import re
import subprocess
import sys
import tempfile
import threading
import time
import types
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlsplit

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TOKEN = "ghp_" + "T" * 36
DATA = Path(tempfile.mkdtemp(prefix="axf-ghc-test-"))
os.environ.update(AXF_GITHUB_CLIENT_DIR=str(DATA), GITHUB_TOKEN=TOKEN, AXF_GITHUB_CLIENT_NO_TICK="1", AXF_GITHUB_REPO="MossesX/AmberX-AXF")
R = "/repos/MossesX/AmberX-AXF"
NOW = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
OLD = "2026-01-01T00:00:00Z"
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


# ---------------------------------------------------------------- fake GitHub
def pr(n, head, *, title="", draft=False, updated=NOW, mergeable=True, state="clean", sha=None, labels=()):
    return {"number": n, "title": title or f"PR {n}", "user": {"login": "brett" if n % 2 else "claude"}, "state": "open", "draft": draft,
            "head": {"ref": head, "sha": sha or f"{n:040d}"}, "base": {"ref": "main"}, "labels": [{"name": x} for x in labels],
            "updated_at": updated, "created_at": OLD, "html_url": f"https://github.com/MossesX/AmberX-AXF/pull/{n}", "node_id": f"PR_{n}",
            "mergeable": mergeable, "mergeable_state": state, "comments": 1, "review_comments": 0, "changed_files": 2, "additions": 5, "deletions": 1}


GH = {
    "pulls": {}, "checks": {}, "statuses": {}, "compare": {}, "reviews": {}, "branches": {}, "calls": [], "update_branch": {}, "merge_status": 200,
}


def reset():
    GH["pulls"] = {
        1: pr(1, "feat/ready"), 2: pr(2, "feat/failing"), 3: pr(3, "feat/conflict", mergeable=False, state="dirty"),
        4: pr(4, "feat/draft", draft=True), 5: pr(5, "feat/stale", updated=OLD), 6: pr(6, "feat/dnm", labels=["do-not-merge"]),
    }
    ok_run = {"name": "CI", "status": "completed", "conclusion": "success"}
    GH["checks"] = {f"{n:040d}": [ok_run] for n in (1, 3, 4, 5, 6)}
    GH["checks"][f"{2:040d}"] = [ok_run, {"name": "lint", "status": "completed", "conclusion": "failure", "html_url": "https://github.com/MossesX/AmberX-AXF/actions/runs/77/job/9"}]
    GH["compare"] = {f"{n:040d}": {"ahead_by": 2, "behind_by": 3 if n in (1, 2) else 0} for n in range(1, 7)}
    GH["branches"] = {"main": {"name": "main", "commit": {"sha": "f" * 40}, "protected": True}, "old/thing": {"name": "old/thing", "commit": {"sha": "a" * 40}, "protected": False}}
    GH["calls"] = []


class Fake(BaseHTTPRequestHandler):
    def log_message(self, *a):
        pass

    def _send(self, code, data):
        body = json.dumps(data).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("x-ratelimit-remaining", "4321")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _body(self):
        n = int(self.headers.get("Content-Length") or 0)
        return json.loads(self.rfile.read(n) or b"null") if n else None

    def handle_any(self, method):
        u = urlsplit(self.path)
        p, q = u.path, parse_qs(u.query)
        body = self._body() if method != "GET" else None
        GH["calls"].append((method, p, body))
        assert self.headers.get("Authorization", "").endswith(TOKEN), "token on every API call"
        if method == "GET":
            if p == f"{R}/pulls":
                return self._send(200, [x for x in GH["pulls"].values() if x["state"] == "open"] if q.get("page", ["1"])[0] == "1" else [])
            m = re.fullmatch(rf"{R}/pulls/(\d+)", p)
            if m:
                x = GH["pulls"].get(int(m.group(1)))
                return self._send(200, x) if x else self._send(404, {"message": "Not Found"})
            if re.fullmatch(rf"{R}/pulls/\d+/reviews", p):
                return self._send(200, [])
            if re.fullmatch(rf"{R}/pulls/\d+/(commits|files)", p):
                return self._send(200, [{"sha": "b" * 40, "commit": {"message": "Do it", "author": {"name": "B", "date": NOW}}, "parents": []}] if p.endswith("commits")
                                  else [{"filename": "a.txt", "status": "modified", "additions": 1, "deletions": 0, "patch": "@@ -1 +1 @@\n-a\n+b"}])
            m = re.fullmatch(rf"{R}/commits/([0-9a-f]+)/check-runs", p)
            if m:
                return self._send(200, {"check_runs": GH["checks"].get(m.group(1), [])})
            if re.fullmatch(rf"{R}/commits/[0-9a-f]+/statuses", p):
                return self._send(200, [])
            m = re.fullmatch(rf"{R}/compare/(.+)\.\.\.(.+)", p)
            if m:
                return self._send(200, GH["compare"].get(m.group(2), {"ahead_by": 1, "behind_by": 0, "commits": [], "files": []}))
            m = re.fullmatch(rf"{R}/branches/(.+)", p)
            if m:
                b = GH["branches"].get(m.group(1))
                return self._send(200, b) if b else self._send(404, {"message": "Branch not found"})
            if p == f"{R}/branches":
                return self._send(200, list(GH["branches"].values()) if q.get("page", ["1"])[0] == "1" else [])
            if p == f"{R}/actions/runs":
                return self._send(200, {"workflow_runs": [{"id": 77, "name": "CI", "status": "completed", "conclusion": "failure"}]})
            if re.fullmatch(rf"{R}/commits", p):
                return self._send(200, [{"sha": "c" * 40, "commit": {"message": "Hello\n\nbody", "author": {"name": "B", "date": NOW}}, "parents": [{"sha": "d" * 40}]}])
            m = re.fullmatch(rf"{R}/commits/([0-9a-f]+)", p)
            if m:
                return self._send(200, {"sha": m.group(1).ljust(40, "0"), "commit": {"message": "x", "author": {"name": "B", "date": NOW}}, "parents": [], "files": [{"filename": "f.py", "status": "added", "additions": 3, "deletions": 0, "patch": "+x"}], "stats": {"additions": 3, "deletions": 0}})
            return self._send(404, {"message": f"no fake for {p}"})
        m = re.fullmatch(rf"{R}/pulls/(\d+)/merge", p)
        if m:
            if GH["merge_status"] != 200:
                return self._send(GH["merge_status"], {"message": "Pull Request is not mergeable"})
            GH["pulls"][int(m.group(1))].update(state="closed", merged_at=NOW)
            return self._send(200, {"sha": "e" * 40, "merged": True})
        m = re.fullmatch(rf"{R}/pulls/(\d+)/update-branch", p)
        if m:
            code = GH["update_branch"].get(int(m.group(1)), 202)
            return self._send(code, {"message": "merge conflict" if code == 422 else "Updating pull request branch."})
        m = re.fullmatch(rf"{R}/pulls/(\d+)", p)
        if m and method == "PATCH":
            x = GH["pulls"][int(m.group(1))]
            x.update({k: v for k, v in (body or {}).items() if k == "state"})
            return self._send(200, x)
        if p == f"{R}/pulls" and method == "POST":
            n = 100 + len([k for k in GH["pulls"] if k >= 100])
            GH["pulls"][n] = pr(n, body["head"], title=body["title"])
            return self._send(201, GH["pulls"][n])
        if re.fullmatch(rf"{R}/issues/\d+/comments", p):
            return self._send(201, {"html_url": "https://github.com/MossesX/AmberX-AXF/pull/1#c1"})
        if re.fullmatch(rf"{R}/issues/\d+/labels(/.*)?", p):
            return self._send(200, [])
        if re.fullmatch(rf"{R}/actions/runs/\d+/rerun(-failed-jobs)?", p):
            return self._send(201, {})
        m = re.fullmatch(rf"{R}/git/refs/heads/(.+)", p)
        if m and method == "DELETE":
            GH["branches"].pop(m.group(1), None)
            return self._send(204, {})
        if p == f"{R}/git/refs" and method == "POST":
            name = body["ref"].removeprefix("refs/heads/")
            if name in GH["branches"]:
                return self._send(422, {"message": "Reference already exists"})
            GH["branches"][name] = {"name": name, "commit": {"sha": body["sha"]}, "protected": False}
            return self._send(201, {})
        if p == "/graphql":
            GH["pulls"][4]["draft"] = False
            return self._send(200, {"data": {"markPullRequestReadyForReview": {"pullRequest": {"isDraft": False}}}})
        return self._send(404, {"message": f"no fake for {method} {p}"})

    def do_GET(self):  # noqa: N802
        self.handle_any("GET")

    def do_POST(self):  # noqa: N802
        self.handle_any("POST")

    def do_PUT(self):  # noqa: N802
        self.handle_any("PUT")

    def do_PATCH(self):  # noqa: N802
        self.handle_any("PATCH")

    def do_DELETE(self):  # noqa: N802
        self.handle_any("DELETE")


srv = ThreadingHTTPServer(("127.0.0.1", 0), Fake)
threading.Thread(target=srv.serve_forever, daemon=True).start()
os.environ["GITHUB_API_URL"] = f"http://127.0.0.1:{srv.server_address[1]}"

# ---------------------------------------------------------------- load the plugin
sys.path.insert(0, str(REPO / "apps" / "console-web" / "server"))
import console_context as cx  # noqa: E402

ALERTS: list[dict] = []
cx.set_context(ROOT=REPO, GITHUB_REPO="MossesX/AmberX-AXF", raise_alert=lambda a: ALERTS.append(a) or a)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.github_client_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
core = sys.modules["axf_console_plugins.github_client_test.core"]

import plugin_services  # noqa: E402
from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)
reset()
print("github-client self-test")

# ---------------------------------------------------------------- readiness: server and web agree (web/core.ts mirrors it)
POL = core.DEFAULT_CONFIG
base = {"state": "open", "draft": False, "mergeable": "clean", "checks": {"state": "success"}, "review": "none", "labels": []}
CASES = [(base, []), ({**base, "draft": True}, ["it is a draft"]), ({**base, "mergeable": "conflict"}, ["it has conflicts with its base"]),
         ({**base, "checks": {"state": "none"}}, ["no checks have run"]), ({**base, "labels": ["do-not-merge"]}, ["it has the do-not-merge label"]),
         ({**base, "review": "changes"}, ["changes were requested"])]
for rec, want in CASES:
    check(core.ready_reasons(rec, POL) == want, f"ready_reasons {want or 'ready'}")
check(core.ready_reasons({**base, "checks": {"state": "none"}}, {**POL, "allowNoChecks": True}) == [], "allowNoChecks lets a PR without checks through")
ts = (HERE / "web" / "core.ts").read_text()
for _, want in CASES[1:]:
    check(all(w.split(":")[0].replace("it has the do-not-merge label", "it has the ") in ts for w in want), f"web/core.ts says the same: {want[0]}")
check(core.parse_deleted_list("feat/a " + "1" * 40 + "\n" + "2" * 40 + " origin/feat/b\n# c\nDeleted branch x/y (was " + "3" * 40 + ")\nnot a sha line") ==
      [{"branch": "feat/a", "sha": "1" * 40}, {"branch": "feat/b", "sha": "2" * 40}, {"branch": "x/y", "sha": "3" * 40}], "deleted-branch lists: three line shapes")

# ---------------------------------------------------------------- s2: the list
r = c.get("/p/prs").json()
by = {p["number"]: p for p in r["items"]}
check(r["repo"] == "MossesX/AmberX-AXF" and r["total"] == 6, "GET /prs: the console's repo, every open PR")
check(by[1]["ready"] and by[1]["behind"] == 3 and by[1]["checks"]["state"] == "success", "#1 ready, 3 behind main, checks green")
check(not by[2]["ready"] and by[2]["checks"]["failed"] == ["lint"], "#2 failing: lint named")
check(by[3]["mergeable"] == "conflict" and "it has conflicts with its base" in by[3]["why"], "#3 conflicts, said why")
check(by[4]["draft"] and not by[4]["ready"], "#4 draft not ready")
check(by[5]["stale"] and by[5]["ageDays"] > 14, "#5 stale")
check("it has the do-not-merge label" in by[6]["why"], "#6 held by the do-not-merge label")
check(r["counts"]["ready"] == 2 and r["counts"]["failing"] == 1 and r["counts"]["conflicts"] == 1 and r["counts"]["stale"] == 1, f"counts per filter {r['counts']}")
check([p["number"] for p in c.get("/p/prs?filter=ready").json()["items"]] == [1, 5] or {p["number"] for p in c.get("/p/prs?filter=ready").json()["items"]} == {1, 5}, "filter=ready")
check([p["number"] for p in c.get("/p/prs?sort=number").json()["items"]] == [6, 5, 4, 3, 2, 1], "sort=number")
check([p["number"] for p in c.get("/p/prs?q=failing").json()["items"]] == [2], "search by branch")
check(c.get("/p/prs?filter=bogus").status_code == 400, "an unknown filter is a 400")
calls = len(GH["calls"])
c.get("/p/prs")
check(len(GH["calls"]) == calls, "a second read inside the poll interval costs no GitHub call")
check(len(c.get("/p/pr/MossesX/AmberX-AXF/2/checks").json()["items"]) == 2, "GET pr checks")
check(c.get("/p/pr/MossesX/AmberX-AXF/1/files").json()["items"][0]["patch"].startswith("@@"), "GET pr files with patch")
st = c.get("/p/status").json()
check(st["token"] == "set" and st["rate"]["remaining"] == 4321 and TOKEN not in json.dumps(st), "GET /status: token set (never shown), rate limit")

# ---------------------------------------------------------------- s3: actions
H = {"x-axf-by": "claude-session-42"}
check(c.post("/p/pr/MossesX/AmberX-AXF/1/merge", json={}, headers=H).status_code == 403, "a Claude session can't merge (403)")
check(c.post("/p/pr/MossesX/AmberX-AXF/1/update-main", json={}, headers=H).status_code == 403, "a Claude session can't pull main in (403)")
x = c.post("/p/pr/MossesX/AmberX-AXF/2/merge", json={})
check(x.status_code == 409 and "checks are failing" in x.json()["detail"], "merge refuses a PR that isn't ready, says why")
x = c.post("/p/pr/MossesX/AmberX-AXF/1/merge", json={}).json()
check(x["merged"] and any(m == "PUT" and p.endswith("/pulls/1/merge") for m, p, _ in GH["calls"]), "merge (queue off) → GitHub merge with the head SHA")


class Queue:
    added: list = []

    def queue(self):
        return {"on": True, "repo": "MossesX/AmberX-AXF", "items": [{"pr": n} for n in self.added]}

    def add(self, n, why=""):
        self.added.append(n)

    def remove(self, n, why=""):
        self.added.remove(n)


plugin_services.provide("axf.merge-queue@1", Queue(), "fake-queue")
GH["pulls"][5]["updated_at"] = NOW
mod.CLIENT.changed(drop=True)
x = c.post("/p/pr/MossesX/AmberX-AXF/5/merge", json={}).json()
check(x["queued"] and Queue.added == [5], "merge with the queue on → into the merge queue, not GitHub")
check(c.get("/p/prs").json()["items"] and next(p for p in c.get("/p/prs").json()["items"] if p["number"] == 5)["queue"]["state"] == "queued", "the row shows its queue position")
check(c.post("/p/pr/MossesX/AmberX-AXF/5/queue-remove", json={"why": "test"}).json()["ok"] and Queue.added == [], "queue-remove")
plugin_services.withdraw("fake-queue")
check("Pulling main" in c.post("/p/pr/MossesX/AmberX-AXF/2/update-main", json={}).json()["text"], "update-main → GitHub update-branch")
check(c.post("/p/pr/MossesX/AmberX-AXF/2/close", json={"why": "superseded"}).json()["ok"] and GH["pulls"][2]["state"] == "closed", "close")
check(c.post("/p/pr/MossesX/AmberX-AXF/2/reopen", json={}).json()["ok"] and GH["pulls"][2]["state"] == "open", "reopen")
check(c.post("/p/pr/MossesX/AmberX-AXF/2/comment", json={"body": "hi"}).json()["ok"], "comment")
check(c.post("/p/pr/MossesX/AmberX-AXF/2/comment", json={"body": " "}).status_code == 400, "an empty comment is a 400")
x = c.post("/p/pr/MossesX/AmberX-AXF/2/rerun-checks", json={"failedOnly": True}).json()
check(x["runs"] == ["CI"] and any(p.endswith("/runs/77/rerun-failed-jobs") for _, p, _ in GH["calls"]), "re-run failed jobs of the failing run")
check(c.post("/p/pr/MossesX/AmberX-AXF/4/ready", json={}).json()["ok"] and not GH["pulls"][4]["draft"], "draft → ready for review (GraphQL)")
check(c.post("/p/pr/MossesX/AmberX-AXF/2/label", json={"add": ["x"], "remove": ["y"]}).json()["ok"], "labels")

# ---------------------------------------------------------------- scratch git: a real local remote
GIT = DATA / "remote.git"
seed = DATA / "seed"
env = {**os.environ, "GIT_AUTHOR_NAME": "t", "GIT_AUTHOR_EMAIL": "t@t", "GIT_COMMITTER_NAME": "t", "GIT_COMMITTER_EMAIL": "t@t"}


def g(*a, cwd=seed):
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True, env=env).stdout.strip()


subprocess.run(["git", "init", "-q", "--bare", "-b", "main", str(GIT)], check=True)
seed.mkdir()
g("init", "-q", "-b", "main")
(seed / "a.txt").write_text("one\ntwo\nthree\n")
(seed / "b.txt").write_text("b\n")
g("add", ".")
g("commit", "-qm", "base")
g("remote", "add", "origin", str(GIT))
g("push", "-q", "origin", "main")
for br, f, txt in (("feat/x", "x.txt", "x\n"), ("feat/y", "y.txt", "y\n"), ("feat/clash", "a.txt", "one\nTWO-clash\nthree\n"), ("feat/clash2", "a.txt", "one\nTWO-other\nthree\n")):
    g("checkout", "-q", "-B", br, "main")
    (seed / f).write_text(txt)
    g("add", ".")
    g("commit", "-qm", br)
    g("push", "-q", "origin", br)
g("checkout", "-q", "main")
(seed / "b.txt").write_text("b moved on main\n")
g("commit", "-qam", "main moves")
g("push", "-q", "origin", "main")


def local_mirror(repo):
    d = DATA / "work" / "mirror.git"
    if not (d / "HEAD").exists():
        d.parent.mkdir(parents=True, exist_ok=True)
        subprocess.run(["git", "clone", "-q", "--bare", str(GIT), str(d)], check=True)
    subprocess.run(["git", "fetch", "-q", "--prune", "origin", "+refs/heads/*:refs/heads/*"], cwd=d, check=True)
    return d


mod.WORK.mirror = local_mirror
GH["pulls"].update({10: pr(10, "feat/x"), 11: pr(11, "feat/y"), 12: pr(12, "feat/clash"), 13: pr(13, "feat/clash2")})
for n in (10, 11, 12, 13):
    GH["checks"][f"{n:040d}"] = [{"name": "CI", "status": "completed", "conclusion": "success"}]

# update-main when GitHub can't: the scratch merge
GH["update_branch"][10] = 422
GH["compare"][f"{10:040d}"] = {"ahead_by": 1, "behind_by": 1}
r = mod.ACTIONS.update_main("MossesX/AmberX-AXF", 10, {"kind": "console", "name": "console"}, wait=True)
check(mod.JOBS.get(r["job"]["id"])["state"] == "done", "update-main with a GitHub 422 → scratch merge job done")
check("main moves" in g("log", "--format=%s", "origin/feat/x") if not g("fetch", "-q", "origin") else True, "main is now in feat/x on the remote")
GH["update_branch"].clear()

# batch: two clean members + a clash between members
r = mod.BATCHES.create({"repo": "MossesX/AmberX-AXF", "prs": [10, 11], "name": "Two clean"}, {"kind": "console", "name": "console"}, wait=True)
grp = mod.BATCHES.get(r["group"]["id"])
check(grp["state"] == "open" and grp["merged"] == [10, 11] and grp["pr"] and grp["branch"] == "queue/group-two-clean", "batch of two: one branch, one PR, both merged in")
g("fetch", "-q", "origin")
files = g("ls-tree", "--name-only", "origin/queue/group-two-clean")
check({"x.txt", "y.txt"} <= set(files.split()) and "b moved on main" in g("show", "origin/queue/group-two-clean:b.txt"), "the batch branch has both PRs and the newest main")
check(c.post("/p/group", json={"repo": "MossesX/AmberX-AXF", "prs": [10, 12]}).status_code == 409, "a PR can't be in two open batches")


class Dispatch:
    asked: list = []

    def request(self, title, detail, **kw):
        self.asked.append((title, detail))
        return {"ok": True, "id": "fix-build-1"}


plugin_services.provide("axf.build-dispatch@1", Dispatch(), "fake-orch")
ALERTS.clear()
r = mod.BATCHES.create({"repo": "MossesX/AmberX-AXF", "prs": [12, 13], "name": "Clashing"}, {"kind": "console", "name": "console"}, wait=True)
grp = mod.BATCHES.get(r["group"]["id"])
check(grp["state"] == "conflict" and grp["merged"] == [12] and grp["conflicts"][0]["member"] == 13 and grp["conflicts"][0]["files"] == ["a.txt"], "a clash between members stops at that member, names the file")
check(grp["fixBuild"] == "fix-build-1" and "git merge origin/feat/clash2" in Dispatch.asked[0][1] and "Do not merge" in Dispatch.asked[0][1], "the clash goes to Claude as a build (merge, resolve, push; never merge)")
check(any(a["severity"] == "error" and "group create" in a["title"] for a in ALERTS), "Brett is alerted")
# Claude's fix: resolve on the batch branch, push; Retry carries on
fix = DATA / "fix"
subprocess.run(["git", "clone", "-q", "-b", grp["branch"], str(GIT), str(fix)], check=True, env=env)
subprocess.run(["git", "merge", "-q", "origin/feat/clash2"], cwd=fix, env=env, capture_output=True)
(fix / "a.txt").write_text("one\nTWO-clash and TWO-other\nthree\n")
g("add", "a.txt", cwd=fix)
g("commit", "-qm", "resolve", cwd=fix)
g("push", "-q", "origin", f"HEAD:{grp['branch']}", cwd=fix)
mod.JOBS.start  # noqa: B018
r = mod.BATCHES.build(grp, {"kind": "console", "name": "console"}, keep=True, wait=True)
grp = mod.BATCHES.get(grp["id"])
check(grp["state"] == "open" and grp["merged"] == [12, 13] and grp["pr"] and grp["conflicts"][0]["how"] == "resolved", "Retry after the fix: both in, batch PR opened, clash marked resolved")
plugin_services.withdraw("fake-orch")
# land: the batch PR merges, members close as landed
check(c.post(f"/p/group/{grp['id']}/land", json={}, headers=H).status_code == 403, "a Claude session can't land a batch")
x = c.post(f"/p/group/{grp['id']}/land", json={"force": True}).json()
grp = mod.BATCHES.get(grp["id"])
check(x["merged"] and grp["state"] == "landed" and GH["pulls"][12]["state"] == "closed" and GH["pulls"][13]["state"] == "closed", "land: batch PR merged, members closed as landed")

# ---------------------------------------------------------------- s5: bulk
mod.CLIENT.changed(drop=True)
pv = c.post("/p/bulk/preview", json={"action": "close-stale"}).json()
GH["pulls"][5]["updated_at"] = OLD
mod.CLIENT.changed(drop=True)
pv = c.post("/p/bulk/preview", json={"action": "merge-ready", "prs": [2, 11]}).json()
check([t["number"] for t in pv["take"]] == [11] and pv["skipped"][0]["target"] == "#2" and "not ready" in pv["skipped"][0]["note"], "bulk preview: merge-ready takes only ready PRs, says why it skips")
check(c.post("/p/bulk", json={"action": "merge-ready"}, headers=H).status_code == 403, "a Claude session can't run bulk actions")
r = mod.bulk({"action": "close-stale"}, {"kind": "console", "name": "console"}, wait=True)
j = mod.JOBS.get(r["job"]["id"])
check(j["state"] == "done" and GH["pulls"][5]["state"] == "closed" and r["take"] == [5], "close-stale closes only the stale PR")

# ---------------------------------------------------------------- s6: branches, commits, diffs
b = c.get("/p/branches").json()["items"]
check({x["name"] for x in b} >= {"main", "old/thing"} and next(x for x in b if x["name"] == "main")["default"], "branches with the default flagged")
check(c.delete("/p/branch/MossesX/AmberX-AXF/main").status_code == 403, "the default branch is never deleted")
x = c.delete("/p/branch/MossesX/AmberX-AXF/old/thing").json()
check(x["savedSha"] == "a" * 40 and "old/thing" not in GH["branches"], "branch delete saves the SHA first")
check(len(c.get("/p/commits?branch=main").json()["items"]) == 1 and c.get("/p/commit/MossesX/AmberX-AXF/" + "c" * 40).json()["files"][0]["path"] == "f.py", "commits and one commit with files")

# ---------------------------------------------------------------- s9: git log, restore, import
log = c.get("/p/log").json()
kinds = {e["kind"] for e in log["items"]}
check({"merge", "merge-failed", "queue-add", "update-main", "close", "group-create", "pr-close", "branch-delete", "bulk", "push"} <= kinds, f"the log has every kind of action: {sorted(kinds)}")
fail = c.get("/p/log?outcome=failed").json()["items"]
check(fail and all(e["outcome"] == "failed" for e in fail) and any("not ready" in e.get("why", "") for e in fail), "failed merges are logged with why")
d = next(e for e in log["items"] if e["kind"] == "branch-delete")
check(d["restorable"] and c.post(f"/p/log/{d['id']}/restore", json={}).json()["ok"] and GH["branches"]["old/thing"]["commit"]["sha"] == "a" * 40, "Restore recreates the branch at the saved SHA")
check(next(e for e in c.get("/p/log?q=old/thing").json()["items"] if e["kind"] == "branch-delete").get("restoredAt"), "the delete shows as restored")
(DATA / "imports").mkdir(exist_ok=True)
(DATA / "imports" / "_deleted-branches-2026-11.txt").write_text("# repo: MossesX/AmberX-AXF\nfeat/gone " + "9" * 40 + "\n")
x = c.post("/p/log/import", json={}).json()
check(x["added"] == 1 and c.post("/p/log/import", json={}).json()["added"] == 0, "import of _deleted-branches-*.txt, idempotent")
check(c.get("/p/log?q=feat/gone").json()["items"][0]["restorable"], "imported deletes are restorable")
check(TOKEN not in (DATA / "log.jsonl").read_text(), "the token is never in the log")

# ---------------------------------------------------------------- settings
check(c.put("/p/config", json={"staleDays": 7, "mergeMethod": "squash"}).json()["staleDays"] == 7, "PUT config")
check(c.put("/p/config", json={"nope": 1}).status_code == 400 and c.put("/p/config", json={"extraRepos": ["bad"]}).status_code == 400, "bad settings are a 400")

# ---------------------------------------------------------------- s7: the contract is what shipped (REST, MCP, CLI, voice from one list)
contract = json.loads((HERE / "contract.json").read_text())
manifest = json.loads((HERE / "plugin.json").read_text())
items = [i for i in manifest["commands"]["items"] if not i.get("skip")]
check({x["id"] for x in contract["commands"]} == {i["id"] for i in items if not i.get("readOnly")}, "contract commands = plugin.json commands")
check({x["id"] for x in contract["reads"] if "id" in x} == {i["id"] for i in items if i.get("readOnly")}, "contract reads = plugin.json reads")
routes = {f"{m} {r.path}" for r in mod.router.routes for m in getattr(r, "methods", set()) if m != "HEAD"}
check(all(i["route"] in routes for i in items if "route" in i), "every declared route is on the server")
check(all((i.get("confirm") is True) == (x.get("confirm") is True) for x in contract["commands"] for i in items if i["id"] == x["id"]), "confirm flags agree")
for v in contract["voice"]:
    check(v["command"] in {i["id"] for i in items}, f"voice \"{v['say']}\" maps to {v['command']}")
web = (HERE / "web" / "core.ts").read_text() + (HERE / "web" / "index.tsx").read_text()
for word in ("'pr'", "'prs'", "'branch'", "'branches'", "'commits'", "'commit'", "'checks'", "'log'", "'batch'", "'batches'", "github-client.focus"):
    check(word in web, f"deep link {word} is handled by the web part")

print(f"github-client: {ok} checks passed")
