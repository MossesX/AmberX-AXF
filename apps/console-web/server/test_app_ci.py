"""app-ci@1 self-test: real git (bare remote + clone), fake GitHub API. Run: python3 apps/console-web/server/test_app_ci.py"""
from __future__ import annotations

import io
import json
import os
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, os.path.dirname(__file__))
import app_ci  # noqa: E402

ok = fail = 0


def check(name: str, cond: bool) -> None:
    global ok, fail
    if cond:
        ok += 1
    else:
        fail += 1
        print("FAIL", name)


def sh(*a: str, cwd: Path | None = None) -> str:
    return subprocess.run(a, cwd=cwd, check=True, capture_output=True, text=True).stdout


tmp = Path(tempfile.mkdtemp(prefix="app-ci-test-"))
remote = tmp / "remote.git"
sh("git", "init", "-q", "--bare", "-b", "main", str(remote))
clone = tmp / "clone"
sh("git", "clone", "-q", str(remote), str(clone))
for k, v in (("user.name", "t"), ("user.email", "t@t")):
    sh("git", "config", k, v, cwd=clone)
(clone / "framework/android").mkdir(parents=True)
(clone / "framework/android/settings.gradle.kts").write_text("include(':axf-kernel')\n")
(clone / "README.md").write_text("x\n")
sh("git", "add", "-A", cwd=clone); sh("git", "commit", "-qm", "base", cwd=clone); sh("git", "push", "-q", "origin", "main", cwd=clone)

# the server state after Build Pilot built an app and a new library (untracked + modified, never committed)
app = clone / "apps/pilot-notes"
(app / "app/build/outputs").mkdir(parents=True)
(app / "app/build/outputs/junk.bin").write_text("build output")
(app / "axf.manifest.json").write_text(json.dumps({"targets": ["android"]}))
(app / "settings.gradle.kts").write_text("rootProject.name='x'\n")
(app / "local.properties").write_text("sdk.dir=/secret\n")
(clone / "framework/android/lib-trail").mkdir()
(clone / "framework/android/lib-trail/build.gradle.kts").write_text("// lib\n")
(clone / "framework/android/settings.gradle.kts").write_text("include(':axf-kernel')\ninclude(':lib-trail')\n")
(clone / "notes.txt").write_text("unrelated local file\n")
head_before = sh("git", "rev-parse", "HEAD", cwd=clone).strip()
status_before = sh("git", "status", "--porcelain", cwd=clone)

calls: list[tuple[str, str, dict]] = []
RUN = {"status": "completed", "conclusion": "success"}


def fake_http(method: str, url: str, headers: dict, body: bytes | None):
    calls.append((method, url, headers))
    if url.endswith("/dispatches"):
        return 204, {}, b""
    if "/runs?branch=" in url:
        head = sh("git", "--git-dir", str(remote), "rev-parse", "pilot/pilot-notes").strip()
        return 200, {}, json.dumps({"workflow_runs": [{"id": 7, "status": RUN["status"], "conclusion": RUN["conclusion"], "html_url": "https://gh/run/7", "created_at": "2999-01-01T00:00:00Z", "head_sha": head}]}).encode()
    if url.endswith("/runs/7/artifacts"):
        return 200, {}, json.dumps({"artifacts": [{"name": "pilot-notes-debug.apk", "archive_download_url": "https://api.github.com/x/zip", "expired": False}]}).encode()
    if url.endswith("/x/zip"):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr("app-debug.apk", b"APKDATA")
        return 200, {}, b.getvalue()
    if url.endswith("/runs/7/jobs"):
        return 200, {}, json.dumps({"jobs": [{"id": 9, "conclusion": "failure"}]}).encode()
    if url.endswith("/jobs/9/logs"):
        return 200, {}, b"2026-10-19T10:00:00Z e: file.kt:3 Unresolved reference: foo\n2026-10-19T10:00:01Z all good line\n"
    return 404, {}, b'{"message":"nope"}'


# git through the real CLI against the local remote (no token header for a file:// remote)
class LocalCi(app_ci.AppCi):
    def _auth_header(self) -> str:
        return "X-Test: 1"


ci = LocalCi(clone, "MossesX/AmberX-AXF", lambda: "tok-123", tmp / "state", http=fake_http)

for bad in ("apps/../x", "/etc", "apps/Bad", "framework", "apps/missing"):
    try:
        ci.publish(bad); check(f"refuses {bad}", False)
    except app_ci.CiError:
        check(f"refuses {bad}", True)

r = ci.publish("apps/pilot-notes")
check("branch name", r["branch"] == "pilot/pilot-notes")
files = sh("git", "--git-dir", str(remote), "ls-tree", "-r", "--name-only", "pilot/pilot-notes").split()
check("app published", "apps/pilot-notes/axf.manifest.json" in files and "apps/pilot-notes/settings.gradle.kts" in files)
check("new library published", "framework/android/lib-trail/build.gradle.kts" in files)
check("changed framework settings published", "include(':lib-trail')" in sh("git", "--git-dir", str(remote), "show", "pilot/pilot-notes:framework/android/settings.gradle.kts"))
check("build output not published", not any("/build/" in f for f in files))
check("local.properties not published", "apps/pilot-notes/local.properties" not in files)
check("unrelated file not published", "notes.txt" not in files)
check("base files kept", "README.md" in files)
check("parent is origin/main", sh("git", "--git-dir", str(remote), "rev-parse", "pilot/pilot-notes^").strip() == sh("git", "--git-dir", str(remote), "rev-parse", "main").strip())
check("server HEAD untouched", sh("git", "rev-parse", "HEAD", cwd=clone).strip() == head_before)
check("server index/worktree untouched", sh("git", "status", "--porcelain", cwd=clone) == status_before)
check("main untouched on the remote", sh("git", "--git-dir", str(remote), "log", "--oneline", "main").count("\n") == 1)
disp = [c for c in calls if c[1].endswith("/dispatches")]
check("workflow dispatched once", len(disp) == 1 and "pilot-apk.yml" in disp[0][1])
check("token only to api.github.com", all(c[1].startswith("https://api.github.com/") for c in calls if "Authorization" in c[2]))
check("record file 0600", oct(os.stat(tmp / "state/pilot-notes.json").st_mode & 0o777) == "0o600")
check("token not in record", "tok-123" not in (tmp / "state/pilot-notes.json").read_text())

st = ci.status("apps/pilot-notes")
check("status success", st["state"] == "success" and st["url"] == "https://gh/run/7")
p = ci.apk("apps/pilot-notes")
check("apk extracted", p.read_bytes() == b"APKDATA")
n = len(calls); ci.apk("apps/pilot-notes")
check("apk cached", not any(c[1].endswith("/x/zip") for c in calls[n:]))

# a failed run reports compiler lines
r = ci.publish("apps/pilot-notes")
check("republish clears the old apk", not (tmp / "state/pilot-notes.apk").exists())
RUN.update(conclusion="failure")
st = ci.status("apps/pilot-notes")
check("failure state", st["state"] == "failure")
check("compiler error lines", st.get("errors") == ["e: file.kt:3 Unresolved reference: foo"])
try:
    ci.apk("apps/pilot-notes"); check("no apk on failure", False)
except app_ci.CiError:
    check("no apk on failure", True)
RUN.update(status="in_progress", conclusion=None)
check("in progress", ci.status("apps/pilot-notes")["state"] == "in_progress")
check("never started", ci.status("apps/other")["state"] == "none")

# no token
ci2 = LocalCi(clone, "MossesX/AmberX-AXF", lambda: "", tmp / "state2", http=fake_http)
try:
    ci2._api("GET", "/x"); check("no token refused", False)
except app_ci.CiError as e:
    check("no token refused", "GITHUB_TOKEN" in str(e))

# the redirect handler drops the token off-site
h = app_ci._NoAuthRedirect()
import urllib.request  # noqa: E402
req = urllib.request.Request("https://api.github.com/x", headers={"Authorization": "Bearer s"})
new = h.redirect_request(req, None, 302, "Found", {}, "https://blob.example/zip")
check("token dropped on redirect", new is not None and not new.has_header("Authorization"))

print(f"app-ci self-test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
