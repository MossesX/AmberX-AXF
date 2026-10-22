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
            return self._send(200, {"ahead_by": STATE["ahead"].get(head, 0), "behind_by": 2, "commits": [{"sha": "x"}], "files": []})
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

os.environ["GITHUB_TOKEN"] = ""
clock["t"] += 999
out = c.get("/p/branches").json()
check("GITHUB_TOKEN" in out["error"] and out["repos"] == [], "no token: says so instead of failing")
print(f"push-banner: {ok} checks passed")
