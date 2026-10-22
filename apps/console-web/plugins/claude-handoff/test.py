#!/usr/bin/env python3
"""Self-test for the Claude handoff plugin: server routes, the 6-hourly reminder (one alert, overwritten), publishing to
a local bare repo standing in for GitHub, plus the core/CLI test (test.mjs) and the lifecycle check.

    python3 apps/console-web/plugins/claude-handoff/test.py
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
ok = 0
ORIG_ENV = dict(os.environ)  # the installer check runs on the real repo with the real HOME (npx cache)


def check(cond, msg):
    global ok
    if not cond:
        raise SystemExit(f"FAIL: {msg}")
    ok += 1
    print(f"  ✓ {msg}")


def git(*args, cwd=None):
    return subprocess.run(["git", "-c", "safe.directory=*", *args], cwd=cwd, capture_output=True, text=True, check=True).stdout.strip()


print("claude-handoff self-test")
r = subprocess.run(["node", str(HERE / "test.mjs")], capture_output=True, text=True)
check(r.returncode == 0, f"core + CLI (test.mjs): {r.stdout.strip().splitlines()[-1] if r.stdout.strip() else r.stderr[-300:]}")

# a scratch repo with a "GitHub" (bare repo) behind it
ROOT = Path(tempfile.mkdtemp(prefix="axf-handoff-root-"))
BARE = Path(tempfile.mkdtemp(prefix="axf-handoff-bare-")) / "origin.git"
DATA = Path(tempfile.mkdtemp(prefix="axf-handoff-data-"))
HOME = Path(tempfile.mkdtemp(prefix="axf-handoff-home-"))
(ROOT / "_claude/rules").mkdir(parents=True)
(ROOT / "_claude/memory").mkdir(parents=True)
(ROOT / "CLAUDE.md").write_text("# Test project\n\n@_claude/rules/RULES.md\n")
(ROOT / "_claude/rules/RULES.md").write_text("- pick the model first\n")
(ROOT / "_claude/memory/decisions.md").write_text("# decisions\n")
(ROOT / ".env").write_text("GITHUB_TOKEN=ghp_" + "x" * 36 + "\n")
(ROOT / "project.manifest.json").write_text(json.dumps({"$manifest": "project-manifest@1", "name": "test-handoff", "displayName": "Test Handoff", "description": "A scratch project.",
                                                       "repo": {"owner": "MossesX", "name": "test-handoff", "defaultBranch": "main", "visibility": "private"}, "links": {"pendingBuilds": "https://claude.ai/artifact/abc"}}))
(ROOT / ".gitignore").write_text(".env\n")
git("init", "-q", "-b", "main", cwd=ROOT)
git("-c", "user.name=t", "-c", "user.email=t@t", "add", "-A", cwd=ROOT)
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qm", "init", cwd=ROOT)
git("init", "-q", "--bare", "-b", "main", str(BARE))
git("push", "-q", str(BARE), "main", cwd=ROOT)
git("remote", "add", "origin", "https://github.com/MossesX/test-handoff.git", cwd=ROOT)

os.environ.update({"AXF_ROOT": str(ROOT), "AXF_HANDOFF_DATA": str(DATA), "AXF_HANDOFF_NO_THREAD": "1", "GITHUB_TOKEN": "test-token",
                   "AXF_LIFECYCLE_PUSH_URL": str(BARE), "AXF_LIFECYCLE_BRANCH": "main", "HOME": str(HOME)})
sys.path.insert(0, str(REPO / "apps/console-web/server"))
import alerts  # noqa: E402
import console_context as cx  # noqa: E402

items: list[dict] = []
raised: list[dict] = []
resolved: list[list[str]] = []


def fake_raise(inp):
    global items
    raised.append(inp)
    items, alert, _ = alerts.apply_alert(items, inp, len(raised))
    return alert


def fake_resolve(keys):
    global items
    resolved.append(keys)
    items = alerts.resolve_alerts(items, keys, 0)


cx.set_context(ROOT=ROOT, raise_alert=fake_raise, resolve_alerts=fake_resolve)
sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.claude_handoff_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/p")
c = TestClient(app)

man = json.loads((HERE / "plugin.json").read_text("utf-8"))
check(man["id"] == "ai.amberx.axf.console.claude-handoff" and man["lifecycle"]["dataDir"] == ".axf-console/plugins/claude-handoff", "plugin@1 manifest: id, data folder")
web = (HERE / "web" / "index.tsx").read_text("utf-8")
check("label: 'Tools'" in web and "parent: 'plugins'" in web and "PluginLifecyclePanel" in web and "banners:" in web, "Tools nav section, Plugins sub-tab, lifecycle panel, banner")
check("menu: 'tools'" in (HERE / "web" / "menu.ts").read_text("utf-8"), "a Tools menu in the application menu")

s = c.get("/p/status").json()
check(s["kit"] is None and s["current"] is False and s["canPublish"] is True, "status: no kit yet, can publish")
check(any(m["host"] == "console" for m in s["machines"]), "the console's own ~/.claude counts as a machine")
check(c.get("/p/last-assembly").status_code == 404 and c.post("/p/last-assembly/run", json={}).status_code == 409, "no last assembly yet: 404, a run can't attach")

# reminder: one alert, a fixed key, overwritten
start = mod._state()["startedAt"] if mod._state().get("startedAt") else None
mod._set_state(startedAt=1_000_000)
H = 3600_000
check(mod.check_reminder(now=1_000_000 + H) is False and not raised, "not due before 6 hours")
check(mod.check_reminder(now=1_000_000 + 6 * H + 1) is True and raised[-1]["key"] == mod.ALERT_KEY, "due after 6 hours: one alert with the fixed key")
check(mod.check_reminder(now=1_000_000 + 7 * H) is False and len(raised) == 1, "not again within the next 6 hours")
check(mod.check_reminder(now=1_000_000 + 12 * H + 2) is True and len(items) == 1 and items[0]["count"] == 2, "6 hours later it overwrites the same alert (one entry, count 2)")
check(c.get("/p/status").json()["reminder"]["open"] is True, "banner shows while the reminder is open")
c.post("/p/reminder/dismiss")
check(resolved[-1] == [mod.ALERT_KEY] and items[0]["resolved"] and c.get("/p/status").json()["reminder"]["open"] is False, "dismiss clears the banner and resolves the alert")

# publish to the bare "GitHub"
r = c.post("/p/publish")
check(r.status_code == 200 and r.json().get("pushed") is True, f"publish pushes the kit ({r.json().get('files')} files)")
listed = git("ls-tree", "-r", "--name-only", "main", "_claude/handoff", cwd=BARE)
check("_claude/handoff/HANDOFF.md" in listed and "_claude/handoff/context/CLAUDE.md" in listed and "_claude/handoff/PROMPT.md" in listed, "GitHub has HANDOFF.md, context copies, PROMPT.md")
check(".env" not in listed and "ghp_" not in git("show", "main:_claude/handoff/FILES.md", cwd=BARE), "no .env and no token in the kit")
check((ROOT / "_claude/handoff/handoff.json").exists(), "this clone's copy matches what was pushed")
s = c.get("/p/status").json()
check(s["current"] is True and s["state"]["lastPublishedAt"], "status: current after publishing")
check(c.post("/p/publish").json().get("pushed") is False, "publishing an unchanged kit pushes nothing")

git("fetch", "-q", str(BARE), "main", cwd=ROOT)
git("reset", "-q", "--hard", "FETCH_HEAD", cwd=ROOT)  # the clone follows GitHub (as the console's 5-minute update does)
(ROOT / "_claude/memory/decisions.md").write_text("# decisions\n- new decision\n")
git("-c", "user.name=t", "-c", "user.email=t@t", "commit", "-qam", "a decision", cwd=ROOT)
git("push", "-q", str(BARE), "HEAD:main", cwd=ROOT)
s = c.get("/p/status").json()
check(s["current"] is False and "_claude/memory/decisions.md" in s["changes"]["changed"], "a changed memory file makes the kit out of date")
a = c.post("/p/assemble", json={"publish": True}).json()
check("MossesX/test-handoff" in a["prompt"] and a["current"] is True and a["published"]["pushed"] is True, "assemble publishes first, then returns the prompt")
check("new decision" in git("show", "main:_claude/handoff/context/claude__memory__decisions.md", cwd=BARE), "the published context copy has the change")

# the last assembly: kept with its plan, the installer's run attached, served back for Last assembly
last = c.get("/p/last-assembly").json()
check(last["result"]["prompt"] == a["prompt"] and last["result"]["published"]["pushed"] is True and isinstance(last["plan"], dict) and last["plan"].get("repo") and last["run"] is None, "last assembly saved: result, plan, no run yet")
run = {"elapsed": 75000, "read": 4096, "written": 2048, "filesDone": 12, "failed": "", "log": ["[0:00] Installing", "[1:15] Install complete: the prompt is ready"]}
check(c.post("/p/last-assembly/run", json=run).status_code == 200 and c.get("/p/last-assembly").json()["run"]["log"][-1].endswith("ready"), "the installer's finished run is attached")
check(c.post("/p/last-assembly/run", json={**run, "extra": 1}).status_code == 400, "unknown run field refused")
check(c.post("/p/last-assembly/run", json={**run, "log": ["x" * 401]}).status_code == 400 and c.post("/p/last-assembly/run", json={**run, "log": ["x"] * 201}).status_code == 400, "over-long log refused")
check(c.post("/p/last-assembly/run", json={**run, "elapsed": -1}).status_code == 400 and c.post("/p/last-assembly/run", json={**run, "filesDone": True}).status_code == 400, "bad numbers refused")
check(oct((mod._data() / "last-assembly.json").stat().st_mode & 0o777) == "0o600", "last-assembly.json is private (0600)")

# claude.ai items
ca = c.get("/p/claude-ai").json()
check(any(i["id"] == "pending-builds" for i in ca["items"]), "claude.ai items seeded from the manifest")
check(c.put("/p/claude-ai", json={"items": [{"id": "Bad Id", "kind": "other"}]}).status_code == 400, "bad item refused")
check(c.put("/p/claude-ai", json={"items": [{"id": "a", "kind": "artifact", "url": "http://x"}]}).status_code == 400, "non-https link refused")
ca["memory"] = "prefers short replies"
check(c.put("/p/claude-ai", json=ca).status_code == 200 and c.get("/p/status").json()["current"] is False, "saving claude.ai items marks the kit out of date")

# machines
rec = {"$axf": "claude-handoff-machine@1", "host": "vps", "collectedAt": "2026-10-22T00:00:00Z", "files": [{"path": ".claude/CLAUDE.md", "kind": "user-instructions", "bytes": 2, "sha": "x", "content": "hi"}], "settings": None, "mcp": [], "secrets": []}
check(c.post("/p/machines", json=rec).status_code == 200, "a machine sends its files")
check(c.post("/p/machines", json={**rec, "host": "../etc"}).status_code == 400, "bad host refused")
check(c.post("/p/machines", json={**rec, "files": [{"path": ".claude/.env", "content": "A=1"}]}).status_code == 400, "secret-looking file refused")
check(c.post("/p/machines", json={**rec, "files": [{"path": "../../x", "content": ""}]}).status_code == 400, "path traversal refused")
check(any(m["host"] == "vps" for m in c.get("/p/machines").json()["machines"]), "machines listed")
check(c.delete("/p/machines/vps").json()["removed"] is True, "forget a machine")

# config + preview
check(c.put("/p/config", json={"context": ["../secret"]}).status_code == 400, "context paths can't leave the repo")
check(c.put("/p/config", json={"remindHours": 6, "context": ["_claude/memory/decisions.md"]}).status_code == 200, "config saved")
p = c.post("/p/preview").json()
check(any(f["path"] == "HANDOFF.md" for f in p["files"]) and "MossesX/test-handoff" in p["prompt"], "preview builds the kit without publishing")
check(c.get("/p/preview/file", params={"path": "HANDOFF.md"}).status_code == 200, "preview file readable")
check(c.get("/p/preview/file", params={"path": "../../state.json"}).status_code == 404, "preview can't read outside the kit")

# files the plugin makes or edits
(HOME / ".claude").mkdir(exist_ok=True)
(HOME / ".claude" / "settings.json").write_text(json.dumps({"env": {"SOME_TOKEN": "ghp_" + "y" * 36}, "hooks": {}}))
fl = c.get("/p/files").json()["files"]
secs = {f["section"] for f in fl}
check({"kit", "data", "docs", "hub", "machine"} <= secs, f"files list covers kit, data, docs, axHub and this machine ({sorted(secs)})")
kit_md = next(f for f in fl if f["section"] == "kit" and f["path"].endswith("HANDOFF.md"))
check(kit_md["made"] == "makes" and kit_md["exists"] and kit_md["bytes"] > 0, "the kit's HANDOFF.md is listed with its size")
check(any(f["section"] == "data" and f["path"].endswith("state.json") for f in fl), "plugin data files are listed")
check(any(f["section"] == "docs" and f["made"] == "edits" for f in fl), "docs it edits are marked edits")
r = c.get("/p/files/read", params={"id": kit_md["id"]}).json()
check(r["text"] and "Handoff" in r["text"], "a listed file reads by id")
st = next(f for f in fl if f["section"] == "machine" and f["path"] == "~/.claude/settings.json")
r = c.get("/p/files/read", params={"id": st["id"]}).json()
check("ghp_" not in r["text"] and "[hidden]" in r["text"], "~/.claude/settings.json shows env names, never values")
check(c.get("/p/files/read", params={"id": "0" * 16}).status_code == 404, "an id not in the list is refused")
check(c.get("/p/files/read", params={"id": "../../etc/passwd"}).status_code == 400, "a path instead of an id is refused")
hub = next(f for f in fl if f["section"] == "hub")
check(c.get("/p/files/read", params={"id": hub["id"]}).json().get("remote") is True, "the axHub look document is read by the browser (remote)")

# no token: assemble still gives the last published prompt and says why
os.environ.pop("GITHUB_TOKEN")
a = c.post("/p/assemble", json={"publish": True}).json()
check(a["prompt"] and "GITHUB_TOKEN" in a["note"], "without GITHUB_TOKEN: prompt + a note that the kit couldn't be published")
check(c.post("/p/publish").status_code == 409, "publish without GITHUB_TOKEN is refused with the fix")

npx = __import__("shutil").which("npx")
if npx:
    r = subprocess.run([npx, "-y", "tsx", str(HERE / "installer-check.mts")], capture_output=True, text=True, cwd=str(REPO), env=ORIG_ENV)
    check(r.returncode == 0, f"installer window plan (installer-check.mts): {(r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else ''}")
    r = subprocess.run([npx, "-y", "tsx", str(HERE / "look-check.mts")], capture_output=True, text=True, cwd=str(REPO), env=ORIG_ENV)
    check(r.returncode == 0, f"installer look: tree, marks, roll (look-check.mts): {(r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else ''}")

r = subprocess.run(["node", str(REPO / "framework/cli/plugin-lifecycle.mjs"), "check", "claude-handoff"], capture_output=True, text=True, env={k: v for k, v in os.environ.items() if k not in ("AXF_ROOT", "HOME")} | {"HOME": str(HOME)})
check(r.returncode == 0, f"lifecycle check: {(r.stdout or r.stderr).strip().splitlines()[-1] if (r.stdout or r.stderr).strip() else ''}")

print(f"claude-handoff self-test: {ok} checks passed")
