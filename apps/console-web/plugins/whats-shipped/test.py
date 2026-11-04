#!/usr/bin/env python3
"""Self-test for the What's new feed (fake GitHub and git, a throwaway repo folder with a store, reports and changes).

    python3 apps/console-web/plugins/whats-shipped/test.py
"""
from __future__ import annotations

import importlib.util
import json
import os
import sys
import tempfile
import types
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[3]
TMP = Path(tempfile.mkdtemp(prefix="axf-whats-shipped-test-"))
os.environ["AXF_WHATS_SHIPPED_DIR"] = str(TMP / "data")
os.environ["AXF_CHANGES_DIR"] = str(TMP / "root" / "changes")
TOKEN = "ghp_" + "W" * 36

# ---------------------------------------------------------------- a small repo folder
ROOT = TMP / "root"
(ROOT / "apps" / "console-web" / "plugins" / "sample-editor").mkdir(parents=True)
(ROOT / "apps" / "axhub-web").mkdir(parents=True)
(ROOT / "apps" / "molly").mkdir(parents=True)
(ROOT / "apps" / "molly" / "project.manifest.json").write_text(json.dumps({"name": "molly", "displayName": "Molly"}))
(ROOT / "apps" / "console-web" / "plugins" / "sample-editor" / "plugin.json").write_text(json.dumps({"name": "Theme Editor"}))
(ROOT / "_claude" / "builds" / "reports").mkdir(parents=True)
STORE = {"builds": [
    {"id": "sample-editor", "title": "Theme Editor plugin", "profiles": ["urgent"], "status": "complete", "pr": "#243", "branch": "claude/sample-editor", "steps": []},
    {"id": "dock-engine", "title": "Shared dock engine", "profiles": ["urgent"], "status": "pending", "pr": "", "branch": "",
     "steps": [{"id": "s1", "branch": "claude/molly-fable", "pr": ""}]},
    {"id": "quiet-fix", "title": "Quiet fix shipped by hand", "profiles": ["main-framework"], "status": "complete", "merged": True, "mergedAt": "2026-11-02T08:00:00Z", "branch": "claude/quiet"},
    {"id": "gone", "title": "Deleted", "deleted": True, "pr": "#999"},
]}
(ROOT / "_claude" / "builds" / "store.json").write_text(json.dumps(STORE))
(ROOT / "_claude" / "builds" / "reports" / "sample-editor.md").write_text(
    "# Theme Editor — report (Nov 3 2026, Opus)\n\n## Tests\n- 12 pass\n\n## What changed\n\n- Colour and style sections list every token\n- Copy, save and load themes\n\n## Known gaps\n- none\n")
(ROOT / "changes" / "2026" / "11").mkdir(parents=True)
(ROOT / "changes" / "2026" / "11" / "chg-1.json").write_text(json.dumps(
    {"updatedAt": "2026-11-03T10:00:00Z", "branch": "claude/molly-fable", "result": {"state": "done", "summary": "Dock engine: split, float and re-dock panes."}}))

# ---------------------------------------------------------------- fakes
SEEN: list[str] = []
PRS = [
    {"number": 250, "title": "feat(sample-tools): Token control plugin", "merged_at": "2026-11-03T12:00:00Z", "merge_commit_sha": "a" * 40,
     "head": {"ref": "claude/sample-tools-opus"}, "html_url": "https://github.com/MossesX/AmberX-AXF/pull/250", "body": "Every token from one API.\n\nMore."},
    {"number": 245, "title": "Molly Fable foundation", "merged_at": "2026-11-03T09:00:00Z", "merge_commit_sha": "b" * 40,
     "head": {"ref": "claude/molly-fable"}, "html_url": "https://github.com/MossesX/AmberX-AXF/pull/245", "body": ""},
    {"number": 243, "title": "Theme Editor plugin", "merged_at": "2026-10-20T09:00:00Z", "merge_commit_sha": "c" * 40,
     "head": {"ref": "claude/sample-editor"}, "html_url": "javascript:alert(1)", "body": ""},
    {"number": 242, "title": "Plan MD Studio", "merged_at": "2026-11-02T09:00:00Z", "merge_commit_sha": "d" * 40,
     "head": {"ref": "claude/plan"}, "html_url": "https://github.com/MossesX/AmberX-AXF/pull/242", "body": ""},
    {"number": 241, "title": "never merged", "merged_at": None, "head": {"ref": "x"}},
]
FILES = {
    250: ["apps/console-web/plugins/sample-tools/web/index.tsx", "framework/core/engines/layout.ts", "apps/axhub-web/src/axf/core/x.ts"],
    245: ["framework/core/engines/dock.ts", "apps/molly/src/App.tsx", "apps/molly/_claude/x.md"],
    243: ["apps/console-web/plugins/sample-editor/web/index.tsx"],
    242: ["_claude/sync/amberx-axf.md", "framework/plan/plan.json", "changes/2026/11/c.json"],
}
DEPLOYS = [{"conclusion": "success", "updated_at": "2026-11-03T11:00:00Z"}, {"conclusion": "success", "updated_at": "2026-10-21T00:00:00Z"}]
MODE = {"fail": False}


def fake_get(path: str):
    SEEN.append(path)
    if MODE["fail"]:
        raise mod.github.GitHubError(401, "Bad credentials")
    if "/files" in path:
        return [{"filename": f} for f in FILES[int(path.split("/pulls/")[1].split("/")[0])]]
    if "/pulls" in path:
        return PRS
    if "/actions/workflows/" in path:
        return {"workflow_runs": DEPLOYS}
    return {}


GIT_LOG = ("1" * 40 + "\x1f" + "p" * 40 + " q\x1f2026-11-03T12:00:00+00:00\x1fMerge pull request #250 from MossesX/claude/sample-tools-opus\x1fToken control plugin\n\x1e"
           + "2" * 40 + "\x1f" + "r" * 40 + " s\x1f2026-11-01T12:00:00+00:00\x1fMerge branch 'main' into x\x1f\x1e")


def fake_git(args: list[str]) -> str:
    SEEN.append("git " + " ".join(args))
    if args[0] == "rev-parse":
        return "head1\n"
    if args[0] == "log" and "--merges" in args:
        return GIT_LOG
    if args[0] == "diff":
        return "apps/console-web/plugins/sample-tools/web/index.tsx\nframework/core/x.ts\n"
    if args[0] == "log":
        return "2026-11-03T13:00:00+00:00\n"
    raise RuntimeError("unknown")


# ---------------------------------------------------------------- load the plugin
sys.path.insert(0, str(HERE.parent.parent / "server"))
import console_context as cx  # noqa: E402

cx.set_context(ROOT=ROOT)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.whats_shipped_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

TOK = {"v": TOKEN}
NOW = {"t": 1_762_180_000.0}  # 2025-11-03; days are relative, so the window is set wide below
src = mod.Sources(root=lambda: ROOT, token=lambda: TOK["v"], repo=lambda: "MossesX/AmberX-AXF", get=fake_get, git=fake_git)
mod.FEED = mod.Feed(src, clock=lambda: NOW["t"])
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


print("whats-shipped self-test")
NOW["t"] = mod._ts("2026-11-03T14:00:00Z")

cfg = c.get("/p/config").json()
check(cfg["days"] == 30 and cfg["apps"] == [] and cfg["deployedOnly"] is False and cfg["deployWorkflows"] == ["deploy.yml"], "default config: 30 days, every app, merged, deploy.yml")
check({"id": "plugin:sample-editor", "label": "Theme Editor", "kind": "plugin"} in cfg["appChoices"] and any(a["id"] == "app:molly" and a["label"] == "Molly" for a in cfg["appChoices"]),
      "app choices from manifests and plugin.json")

f = c.get("/p/feed").json()
check(f["$axf"] == "whats-new@1" and f["source"] == "github" and f["deploysKnown"] is True, "feed: whats-new@1 from GitHub, deploys known")
ids = [i["id"] for i in f["items"]]
check(ids == ["pr-250", "pr-245", "build-quiet-fix", "pr-243"], f"one item per merged PR that shipped code, newest first; plan-only PR and unmerged PR left out ({ids})")
by = {i["id"]: i for i in f["items"]}
t = by["pr-250"]
check(t["title"] == "Token control plugin", "commit-speak prefix dropped from the title")
check([a["id"] for a in t["apps"]] == ["app:console-web", "plugin:sample-tools", "framework"],
      "apps from changed paths: app, plugin, framework (baked src/axf copies ignored)")
check(not any(a["id"] == "app:axhub-web" for a in t["apps"]), "a baked framework copy in another app is not that app's feature")
check(t["summary"] == "Every token from one API." and t["pr"] == {"number": 250, "url": "https://github.com/MossesX/AmberX-AXF/pull/250"}, "summary from the PR body's first paragraph; PR link")
check(t["deployed"] is False and t["deployedAt"] == "", "merged after the last deploy: not deployed yet")
check(t["build"] is None and t["where"].startswith("Dev Console → Plugins → "), "no build on record; where to find it names the plugin")
m = by["pr-245"]
check(m["build"] == {"id": "dock-engine", "title": "Shared dock engine", "profile": "urgent"}, "build matched by a step's branch (per-step fields)")
check(m["summary"] == "Dock engine: split, float and re-dock panes.", "summary from the Codebase changes entry for the branch")
check([a["id"] for a in m["apps"]] == ["app:molly", "framework"] and m["where"] == "Molly", "app _claude files ignored; where = the app")
te = by["pr-243"]
check(te["build"]["id"] == "sample-editor" and te["report"] == "_claude/builds/reports/sample-editor.md", "build matched by its PR number; report linked")
check(te["summary"] == "Colour and style sections list every token" and te["details"] == ["Colour and style sections list every token", "Copy, save and load themes"], "wording from the report's What changed bullets")
check(te["deployed"] is True and te["deployedAt"] == "2026-10-21T00:00:00Z", "a deploy after the merge carried it (the first one after)")
check(te["pr"]["url"] == "", "a link that isn't https://github.com is dropped")
q = by["build-quiet-fix"]
check(q["pr"] is None and q["build"]["profile"] == "main-framework" and q["mergedAt"] == "2026-11-02T08:00:00Z", "a store build marked merged with no PR becomes its own item")
check(TOKEN not in json.dumps(f), "the token never comes back to the browser")
check(f["total"] == 4 and len(f["items"]) == 4, "every item is inside 30 days here")

# filters
c.put("/p/config", json={"days": 7})
check([i["id"] for i in c.get("/p/feed").json()["items"]] == ["pr-250", "pr-245", "build-quiet-fix"], "how far back: 7 days drops the older one")
c.put("/p/config", json={"days": 30, "apps": ["app:molly"]})
check([i["id"] for i in c.get("/p/feed").json()["items"]] == ["pr-245"], "which apps: only items touching Molly")
c.put("/p/config", json={"days": 30, "apps": [], "deployedOnly": True})
check([i["id"] for i in c.get("/p/feed").json()["items"]] == ["pr-245", "build-quiet-fix", "pr-243"], "deployed only: what a deploy carried")
for body, why in [({"days": 5}, "days not a choice"), ({"apps": ["../x"]}, "bad app id"), ({"deployedOnly": "yes"}, "deployedOnly not bool"),
                  ({"deployWorkflows": ["a b.yml"]}, "bad workflow"), ({"deployWorkflows": []}, "no workflow"), ({"token": "x"}, "unknown key"), ([1], "not an object")]:
    check(c.put("/p/config", json=body).status_code == 400, f"config refused: {why}")
r = c.put("/p/config", json={"reset": True}).json()
check(r["days"] == 30 and r["deployedOnly"] is False, "reset goes back to the defaults")
cf = Path(os.environ["AXF_WHATS_SHIPPED_DIR"]) / "config.json"
check((cf.stat().st_mode & 0o777) == 0o600, "config file private (0600)")

# caching
c.get("/p/feed")  # a config save invalidates once
n = len(SEEN)
c.get("/p/feed")
c.get("/p/feed")
check(len(SEEN) == n, "cached: no new GitHub call inside the check period")
n = len(SEEN)
c.get("/p/feed?refresh=true")
check(sum("/files" in s for s in SEEN[n:]) == 0, "merged PRs' file lists are kept for good (not fetched again)")
check(json.loads((Path(os.environ["AXF_WHATS_SHIPPED_DIR"]) / "pr-files.json").read_text()).keys() == {"250", "245", "243", "242"}, "file lists cached on disk")
NOW["t"] += 301
n = len(SEEN)
c.get("/p/feed")
check(len(SEEN) > n, "re-read after the check period (GitHub)")
STORE["builds"][0]["title"] = "Theme Editor plugin, renamed"
store_f = ROOT / "_claude" / "builds" / "store.json"
store_f.write_text(json.dumps(STORE))
os.utime(store_f, ns=(store_f.stat().st_atime_ns, store_f.stat().st_mtime_ns + 5_000_000_000))
check(any(i["build"] and i["build"]["title"] == "Theme Editor plugin, renamed" for i in c.get("/p/feed").json()["items"]), "a store change rebuilds the feed at once")
fd = json.loads((Path(os.environ["AXF_WHATS_SHIPPED_DIR"]) / "feed.json").read_text())
check(fd["$axf"] == "whats-new@1" and fd["key"], "feed cached in feed.json with what it was built from")
fresh = mod.Feed(src, clock=lambda: NOW["t"])
n = len(SEEN)
fresh.get()
check(len([s for s in SEEN[n:] if not s.startswith("git")]) == 0, "after a restart the cached file answers (same facts, no GitHub call)")

# GitHub fails → git history
MODE["fail"] = True
f = c.get("/p/feed?refresh=true").json()
check(f["source"] == "git" and "GitHub" in f["error"] and TOKEN not in f["error"], "GitHub error: falls back to the repo's git history, says why")
check([i["id"] for i in f["items"]][:1] == ["pr-250"] and f["items"][0]["title"] == "Token control plugin", "git: merge commits give PR number, branch and title")
check(f["items"][0]["deployed"] is True and f["items"][0]["deployedAt"] == "2026-11-03T13:00:00Z" and f["items"][0]["apps"][0]["id"] == "app:console-web", "git: files from the merge's diff; deploy from the site branch")
MODE["fail"] = False
TOK["v"] = ""
f = c.get("/p/feed?refresh=true").json()
check(f["source"] == "git" and f["error"] == "", "no token: git history, no error")

# pure helpers
check(mod.clean_title("fix(ui): banner snaps [skip ci]") == "Banner snaps", "clean_title")
check(mod.report_info("# agent-cap — Agent cap + queue (Nov 1 2026)\n\nIntro para.\n")["title"] == "Agent cap + queue", "report title: id prefix and date dropped")
check(mod.deployed_after("2026-11-01T00:00:00Z", None) == (None, ""), "no deploy information: deployed unknown (null)")
check(mod.apps_of(["README.md", "_claude/x", "tracker.json"], {}) == [], "notes and logs alone ship nothing")
print(f"all {ok} checks passed")
