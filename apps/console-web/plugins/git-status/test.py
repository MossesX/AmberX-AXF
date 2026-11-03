#!/usr/bin/env python3
"""Self-test for the Git status board: manifest + commands, zero tokens (no LLM import anywhere), the pure classifier,
the local git scan against a throw-away repo with a worktree, and the routes against a fake push banner (axf.push@1),
UI Review and holds.

    python3 apps/console-web/plugins/git-status/test.py
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
ROOT = HERE.parents[3]
ok = 0


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


print("git-status self-test")
man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.git-status" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/git-status", "plugin@1 manifest: id, data folder")
check(man["builtWith"]["model"] == "opus" and man["opens"] == "main", "model recorded, opens in the main area")
check("service:axf.merge-holds@1" in man["provides"] and "service:axf.push@1" in man["optional"], "provides merge holds, reads the push banner by capability")
ids = {c["id"] for c in man["commands"]["items"]}
check({"board", "list", "item", "merge", "hold", "update", "rerun", "fix", "close", "kill", "batch-merge-next"} <= ids, "commands declared once (REST + MCP + CLI)")
check(all(c.get("destructive") for c in man["commands"]["items"] if c["id"] in ("close", "kill", "batch-remove")), "close / kill / batch remove need a confirm")

# Zero tokens: nothing in the plugin imports or calls an LLM.
LLM = re.compile(r"\banthropic\b|@anthropic-ai|openai|axf\.llm@1|claude_agent|/v1/messages|generativeai|claude -p", re.I)
src = [p for p in HERE.rglob("*") if p.suffix in (".py", ".ts", ".tsx", ".mjs", ".mts") and p.name != "test.py" and "node_modules" not in p.parts]
hits = [str(p.relative_to(HERE)) for p in src if LLM.search(p.read_text("utf-8"))]
check(not hits, f"zero tokens: no LLM import or call ({hits or 'none'})")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("parent: 'plugins'" in web and "PluginLifecyclePanel" in web, "settings are a Plugins sub-tab with the lifecycle panel")
server_src = (HERE / "server" / "__init__.py").read_text("utf-8")
check("push-banner" not in server_src and not re.search(r"plugins/(?!git-status)[a-z]", server_src), "never names another plugin's folder (capabilities only)")

sys.path[:0] = [str(HERE.parent / "push-banner" / ".."), str(ROOT / "apps" / "console-web" / "server"), str(ROOT / "framework" / "python")]
from importlib import util  # noqa: E402

spec = util.spec_from_file_location("gs_core", HERE / "server" / "core.py")
core = util.module_from_spec(spec)
spec.loader.exec_module(core)  # type: ignore[union-attr]
now = time.time()
iso = lambda d: time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(now - d * 86400))  # noqa: E731

# ---- the classifier
check(core.clean_title("feat(console): add git board [skip ci]") == "Add git board", "lead lines drop commit-type prefixes and [skip ci]")
check(core.first_sentence("# Title\n\n| a | b |\n> quote\n**Git status** shows every PR in grids. More text.") == "Git status shows every PR in grids.", "first plain sentence of a report")
b = {"id": "audio-extract", "title": "Audio Extract (screen recordings)", "detail": "Agent: Reel Rhonda (headless).", "notes": [], "steps": [{"id": "s1", "text": "x", "done": True}, {"id": "s2", "text": "y"}]}
check(core.lead_line(187, "Add audio", b, "Pulls audio out of screen recordings, no mic.") == "#187 Audio Extract: pulls audio out of screen recordings, no mic.", "row lead: #N name: what it does")
check(core.lead_line(12, "chore: bump thing", None) == "#12 Bump thing", "no build: the cleaned PR title")
check(core.lead_line(287, "Banner reference links: tap a mention to open it", {"title": "Banner reference links: tap a mention"}) == "#287 Banner reference links: tap a mention to open it", "a PR title that already names the build is the whole line")
check(core.agent_of(b) == "Reel Rhonda" and core.agent_of({"detail": "", "notes": [{"text": "Assigned: Ping Paulie (router)"}]}) == "Ping Paulie", "agent from the build's detail or notes")
check(core.depends_on("Depends on #274, after #12") == [12, 274], "dependency PRs from the body")

pr = {"number": 5, "title": "t", "head": "claude/x", "ci": "success", "mergeable": True, "draft": False, "updated": iso(0.1), "sha": "a" * 40, "body": ""}
r = core.pr_row("o/r", pr, build=b, summary="", ui=None, hold=None, open_numbers={5}, behind=0, ahead=3, cost=1.5, batch="", now=now)
check(r["sections"] == ["ready"] and r["status"] == "ready" and r["tone"] == "success", "green, mergeable, not held = Ready to merge")
check(r["build"]["done"] == 1 and r["build"]["total"] == 2 and r["agent"] == "Reel Rhonda" and r["cost"] == 1.5, "row carries build steps, agent and cost")
r = core.pr_row("o/r", {**pr, "ci": "failure"}, build=None, summary="", ui=None, hold=None, open_numbers={5}, behind=0, ahead=1, cost=None, batch="", now=now)
check(r["sections"] == ["ci"] and r["status"] == "CI failed" and r["blockers"][0]["clears"].startswith("Fix"), "red CI = In CI with Fix / Re-run")
r = core.pr_row("o/r", {**pr, "ci": "running"}, build=None, summary="", ui={"state": "waiting", "holds": True, "items": []}, hold=None, open_numbers={5}, behind=0, ahead=1, cost=None, batch="", now=now)
check(r["sections"] == ["ci", "held"] and r["status"] == "UI review", "CI running + UI Review waiting = In CI and Held")
r = core.pr_row("o/r", {**pr, "mergeable": False}, build=None, summary="", ui=None, hold={"reason": "Brett says wait"}, open_numbers={5}, behind=4, ahead=1, cost=None, batch="", now=now)
whys = [x["why"] for x in r["blockers"]]
check("held" in r["sections"] and "ready" not in r["sections"] and whys[:2] == ["On hold: Brett says wait", "Conflicts with main"], "a hold and conflicts hold it, each with what clears it")
r = core.pr_row("o/r", {**pr, "body": "Depends on #9"}, build=None, summary="", ui=None, hold=None, open_numbers={5, 9}, behind=0, ahead=1, cost=None, batch="", now=now)
check(r["status"] == "waits" and r["blockers"][0]["clears"] == "Merge #9 first", "a dependency PR that is still open holds it")
r = core.pr_row("o/r", {**pr, "updated": iso(9)}, build=None, summary="", ui=None, hold=None, open_numbers={5}, behind=300, ahead=1, cost=None, batch="", now=now)
check("stale" in r["sections"] and "ready" in r["sections"], "old or far behind = also Stale")
w = core.worktree_row({"path": "/x/wt", "branch": "claude/y", "unpushed": 2, "dirty": 1, "behind": 7, "at": iso(0.2), "subject": "s"}, build=None, summary="", pr=None, cost=None, now=now)
check(w["sections"] == ["push", "pull"] and w["status"] == "not pushed" and "2 commits not on GitHub" in w["detailLine"], "worktree: unpushed + behind = Needs push and Needs pull")
w = core.worktree_row({"path": "/x/wt", "branch": "claude/z", "unpushed": 0, "dirty": 0, "behind": 0, "at": iso(0.2)}, build=None, summary="", pr=None, cost=None, now=now)
check(w["sections"] == [], "a clean, current worktree isn't listed")
d = core.deploy_row({"name": "axf-console", "state": "running", "startedAt": iso(0.1), "commit": {"sha": "b" * 40, "subject": "fix: x"}, "behind": 2})
check(d["sections"] == ["deployed"] and d["lead"].startswith("axf-console runs bbbbbbbb") and d["blockers"][0]["clears"] == "Redeploy it", "deployed: which commit, how far main moved since")
rows = {"o/r#5": {**core.pr_row("o/r", pr, build=None, summary="", ui=None, hold=None, open_numbers={5}, behind=0, ahead=1, cost=None, batch="b-1", now=now)}}
v = core.batch_view({"id": "b-1111", "title": "T", "items": ["o/r#5", "o/r#6"]}, rows)
check(v["badges"]["ready"] == 1 and v["badges"]["gone"] == 1 and v["next"] == "o/r#5", "batch badges: ready / gone, next to merge")

# ---- the local scan against a throw-away repo with a worktree
tmp = Path(tempfile.mkdtemp(prefix="gs-test-"))
try:
    g = lambda *a, cwd=None: subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout  # noqa: E731
    origin = tmp / "origin.git"
    g("init", "-q", "--bare", "-b", "main", str(origin))
    main = tmp / "main"
    g("clone", "-q", str(origin), str(main))
    for k, v in (("user.email", "t@t"), ("user.name", "t")):
        g("config", k, v, cwd=main)
    (main / "a.txt").write_text("1")
    g("add", ".", cwd=main); g("commit", "-qm", "one", cwd=main); g("push", "-q", "origin", "HEAD:main", cwd=main)
    builds = tmp / "builds"
    builds.mkdir()
    g("worktree", "add", "-q", "-b", "claude/t", str(builds / "t"), cwd=main)
    (builds / "t" / "b.txt").write_text("2")
    g("add", ".", cwd=builds / "t"); g("commit", "-qm", "feat: two", cwd=builds / "t")
    (builds / "t" / "a.txt").write_text("dirty")
    (main / "a.txt").write_text("3"); g("commit", "-qam", "three", cwd=main); g("push", "-q", "origin", "HEAD:main", cwd=main)
    os.environ.update({"AXF_GIT_STATUS_WORKTREES": str(builds), "AXF_GIT_STATUS_MAIN": str(main), "AXF_GIT_STATUS_PATH_MAP": ""})
    spec = util.spec_from_file_location("gs_local", HERE / "server" / "localgit.py")
    lg = util.module_from_spec(spec)
    spec.loader.exec_module(lg)  # type: ignore[union-attr]
    res = lg.Scanner(main).scan(wait=True)
    wt = next(i for i in res["items"] if i["branch"] == "claude/t")
    check(wt["unpushed"] == 1 and wt["dirty"] == 1 and wt["behind"] == 1 and wt["ahead"] == 1 and not wt["error"], "local scan: unpushed, uncommitted, behind and ahead of origin/main")
    check(lg.repo_of("https://x-access-token:abc@github.com/MossesX/AmberX-AXF.git") == "MossesX/AmberX-AXF", "repo from a remote URL (a token in it is never kept)")
    check(lg.git_dir(builds / "t", [("/nowhere", "/elsewhere")]) is not None, "worktree git dir resolved")
    log = lg.Scanner(main)
    log.scan(wait=True)
    check([c["subject"] for c in log.local_log(str(builds / "t"))] == ["feat: two"] and log.local_log("/etc") == [], "commits not on main; unknown paths never reach git")

    # ---- routes against fakes (no FastAPI app needed: the route functions are plain)
    services: dict = {}
    sys.modules["plugin_services"] = types.SimpleNamespace(get=lambda name: services.get(name), provide=lambda name, impl, folder: services.__setitem__(name, impl))
    import console_context as cx  # noqa: E402

    cx.ROOT = tmp / "root"
    (cx.ROOT / "_claude" / "builds" / "reports").mkdir(parents=True)
    (cx.ROOT / "_claude" / "builds" / "store.json").write_text(json.dumps({"builds": [{**b, "branch": "claude/x", "pr": "#5"}]}))
    (cx.ROOT / "_claude" / "builds" / "reports" / "audio-extract.md").write_text("# Report\n\nPulls audio out of screen recordings, no mic.\n")
    os.environ["AXF_GIT_STATUS_DIR"] = str(tmp / "data")
    calls: list = []

    class FakePush:
        def snapshot(self, force=False):
            return {"checkedAt": 1, "repos": [{"repo": "MossesX/AmberX-AXF", "base": "main", "error": "",
                                               "branches": [{"name": "claude/x", "ahead": 2, "behind": 0, "pr": {"number": 5}}, {"name": "claude/old", "ahead": 1, "behind": 3, "date": iso(10), "subject": "old work", "pr": None}],
                                               "pulls": [{**pr, "author": "MossesX"}, {**pr, "number": 6, "head": "claude/red", "ci": "failure", "title": "fix: red"}]}]}

        def detail(self, repo, number=None, branch=None):
            return {"commits": [{"sha": "c" * 40, "subject": "s"}], "checks": [], "sha": "a" * 40, "body": "b", "files": 2}

        def checks(self, repo, sha):
            return [{"name": "web", "conclusion": "failure", "lines": ["x.ts:3 boom"]}]

        def merge(self, repo, number):
            calls.append(("merge", number)); return {"merged": True}

        def update(self, repo, number=None, branch=None):
            calls.append(("update", number or branch)); return {"ok": True}

        def merged(self, since):
            return [{"repo": "MossesX/AmberX-AXF", "number": 4, "title": "feat: done", "mergedAt": iso(0.05), "head": "claude/done"}]

        def delete_branch(self, repo, branch):
            calls.append(("kill", branch)); return {"deleted": branch}

    services["axf.push@1"] = FakePush()
    services["ui-review@1"] = types.SimpleNamespace(state=lambda branch, pr: {"state": "none", "holds": False} if pr != 6 else {"state": "waiting", "holds": True, "items": [{"id": "r-1"}]})
    sys.path.insert(0, str(HERE))
    import server as srv  # noqa: E402
    from fastapi import HTTPException  # noqa: E402

    check("axf.merge-holds@1" in services, "provides axf.merge-holds@1")
    first = srv.SCANNER.scan()
    check(first["items"] == [] and "scanning" in first["warning"], "first board load never waits for the scan (it runs in the background)")
    srv.SCANNER.scan(force=True, wait=True)
    bd = srv.BOARD.get(force=True, wait=True)
    keys = {r["key"]: r for r in bd["rows"]}
    check(keys["MossesX/AmberX-AXF#5"]["sections"] == ["ready"] and keys["MossesX/AmberX-AXF#5"]["lead"] == "#5 Audio Extract: pulls audio out of screen recordings, no mic.", "board: PR row with its build's lead line")
    check(set(keys["MossesX/AmberX-AXF#6"]["sections"]) == {"ci", "held"}, "board: red PR held by UI Review is In CI and Held")
    check("push" in keys["MossesX/AmberX-AXF:claude/old"]["sections"] and "stale" in keys["MossesX/AmberX-AXF:claude/old"]["sections"], "board: pushed branch without PR = Needs push, and Stale when old")
    check(any(r["kind"] == "worktree" and "push" in r["sections"] for r in bd["rows"]), "board: local worktree with unpushed commits")
    check(keys["MossesX/AmberX-AXF#4:merged"]["sections"] == ["merged"], "board: merged today")
    check(srv.board(since=bd["stamp"]) == {"same": True, "stamp": bd["stamp"], "checkedAt": bd["checkedAt"]}, "live feed: since=<stamp> answers same while nothing changed")
    check(srv.list_section("ready")["items"][0]["key"] == "MossesX/AmberX-AXF#5", "list a section (voice / CLI)")
    it = srv.item("MossesX/AmberX-AXF#6")
    check(it["checks"][0]["lines"] == ["x.ts:3 boom"] and it["commits"], "item: checks with failing lines, commits")
    srv.hold({"key": "MossesX/AmberX-AXF#5", "reason": "wait for Brett"})
    check(services["axf.merge-holds@1"].held("MossesX/AmberX-AXF", 5) == "wait for Brett", "Hold: the push banner sees it through axf.merge-holds@1")
    check("held" in {r["key"]: r for r in srv.BOARD.get(force=True, wait=True)["rows"]}["MossesX/AmberX-AXF#5"]["sections"], "held PR moves to Held")
    srv.hold({"key": "MossesX/AmberX-AXF#5"})
    check(services["axf.merge-holds@1"].held("MossesX/AmberX-AXF", 5) == "", "Hold again releases it")
    nb = srv.new_batch({"title": "Tonight", "items": ["MossesX/AmberX-AXF#6", "MossesX/AmberX-AXF#5"]})["batch"]
    step = srv.batch_merge_next({"id": nb["id"]})
    check(step["did"] == "wait" and step["key"].endswith("#6") and not calls, "batch: merge order respected (the first one isn't ready, nothing merges)")
    srv.batch_order({"id": nb["id"], "items": ["MossesX/AmberX-AXF#5", "MossesX/AmberX-AXF#6"]})
    step = srv.batch_merge_next({"id": nb["id"]})
    check(step["did"] == "merge" and calls[-1] == ("merge", 5), "batch: merge next merges the first ready PR through the push banner")
    srv.BOARD.get(force=True, wait=True)
    check(srv.get_batches()["batches"][0]["badges"]["held"] == 1, "batch badges live")
    srv.kill({"key": "MossesX/AmberX-AXF:claude/old"})
    check(calls[-1] == ("kill", "claude/old"), "Kill deletes a stale pushed branch through the push banner")
    for bad in ({"key": "MossesX/AmberX-AXF#5"}, {"key": "wt:/etc"}):
        try:
            srv.kill(bad)
            check(False, f"kill {bad} refused")
        except HTTPException as e:
            check(e.status_code == 400, f"kill {bad['key']} refused")
    forced: list = []
    real = services["axf.push@1"].snapshot
    services["axf.push@1"].snapshot = lambda force=False: (forced.append(force), real(force))[1]
    srv.BOARD.forced_github = 0.0
    srv.BOARD.get(force=True, wait=True); srv.BOARD.get(force=True, wait=True)
    check(forced == [True, False], "Check now re-reads GitHub at most every 2 minutes (the hourly limit is shared)")
    services.pop("axf.push@1")
    srv._changed()
    check("github" in srv.BOARD.get(force=True, wait=True)["errors"], "push banner off: the board says why instead of breaking")
finally:
    shutil.rmtree(tmp, ignore_errors=True)

npx = shutil.which("npx")
if npx and (HERE / "web" / "core-check.mts").exists():
    out = subprocess.run([npx, "-y", "tsx", str(HERE / "web" / "core-check.mts")], capture_output=True, text=True, timeout=300)
    last = json.loads(out.stdout.strip().splitlines()[-1]) if out.stdout.strip() else {"failed": ["crash"], "total": 0}
    check(out.returncode == 0 and not last["failed"] and last["total"] >= 8, f"web core: {last['total']} checks ({last['failed'] or 'all pass'})")
print(f"all {ok} checks passed")
