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
import axf_framework  # noqa: E402,F401
from axf_server import http as axf_http  # noqa: E402

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


def _fake(method: str, url: str, headers: dict, body: bytes | None):
    if url.endswith("/dispatches"):
        return 204, {}, b""
    if "/runs?branch=" in url:
        head = sh("git", "--git-dir", str(remote), "rev-parse", "pilot/pilot-notes").strip()
        return 200, {}, json.dumps({"workflow_runs": [{"id": 7, "status": RUN["status"], "conclusion": RUN["conclusion"], "html_url": "https://gh/run/7", "created_at": "2999-01-01T00:00:00Z", "head_sha": head}]}).encode()
    if url.endswith("/runs/7/artifacts"):
        return 200, {}, json.dumps({"artifacts": [{"name": "pilot-notes-debug.apk", "archive_download_url": "https://api.github.com/x/zip", "expired": False}]}).encode()
    if url.endswith("/x/zip"):  # GitHub answers with a redirect to blob storage
        return 302, {"location": "https://blob.example/x.zip?sig=1"}, b""
    if url.startswith("https://blob.example/x.zip"):
        b = io.BytesIO()
        with zipfile.ZipFile(b, "w") as z:
            z.writestr("app-debug.apk", b"APKDATA")
        return 200, {}, b.getvalue()
    if url.endswith("/runs/7/jobs"):
        return 200, {}, json.dumps({"jobs": [{"id": 9, "conclusion": "failure"}]}).encode()
    if url.endswith("/jobs/9/logs"):
        return 302, {"location": "https://logs.example/9.txt"}, b""
    if url == "https://logs.example/9.txt":
        return 200, {}, b"2026-10-19T10:00:00Z e: file.kt:3 Unresolved reference: foo\n2026-10-19T10:00:01Z all good line\n"
    return 404, {}, b'{"message":"nope"}'


def fake_http(req: "axf_http.Request") -> "axf_http.Response":
    """The fake GitHub as an axf_server.http transport (what lib-github's client sends)."""
    calls.append((req.method, req.url, dict(req.headers)))
    code, h, raw = _fake(req.method, req.url, req.headers, req.body)
    return axf_http.Response(code, h, raw, req.url)


def auth_of(headers: dict) -> str | None:
    return next((v for k, v in headers.items() if k.lower() == "authorization"), None)


# git through the real CLI against the local remote (the token's header is scoped to https://github.com/)
ci = app_ci.AppCi(clone, "MossesX/AmberX-AXF", lambda: "tok-123", tmp / "state", transport=fake_http)

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
check("token only to api.github.com", all(c[1].startswith("https://api.github.com/") for c in calls if auth_of(c[2])))
check("record file 0600", oct(os.stat(tmp / "state/pilot-notes.json").st_mode & 0o777) == "0o600")
check("token not in record", "tok-123" not in (tmp / "state/pilot-notes.json").read_text())

st = ci.status("apps/pilot-notes")
check("status success", st["state"] == "success" and st["url"] == "https://gh/run/7")
p = ci.apk("apps/pilot-notes")
check("apk extracted", p.read_bytes() == b"APKDATA")
check("artifact redirect fetched without the token", any(c[1].startswith("https://blob.example/") and not auth_of(c[2]) for c in calls))
n = len(calls); ci.apk("apps/pilot-notes")
check("apk cached", not any(c[1].endswith("/x/zip") for c in calls[n:]))

# a failed run reports compiler lines
r = ci.publish("apps/pilot-notes")
check("republish clears the old apk", not (tmp / "state/pilot-notes.apk").exists())
RUN.update(conclusion="failure")
st = ci.status("apps/pilot-notes")
check("failure state", st["state"] == "failure")
check("compiler error lines", st.get("errors") == ["e: file.kt:3 Unresolved reference: foo"])
check("job log redirect fetched without the token", any(c[1] == "https://logs.example/9.txt" and not auth_of(c[2]) for c in calls))
try:
    ci.apk("apps/pilot-notes"); check("no apk on failure", False)
except app_ci.CiError:
    check("no apk on failure", True)
RUN.update(status="in_progress", conclusion=None)
check("in progress", ci.status("apps/pilot-notes")["state"] == "in_progress")
check("never started", ci.status("apps/other")["state"] == "none")

# no token
ci2 = app_ci.AppCi(clone, "MossesX/AmberX-AXF", lambda: "", tmp / "state2", transport=fake_http)
try:
    ci2._api("GET", "/x"); check("no token refused", False)
except app_ci.CiError as e:
    check("no token refused", "GITHUB_TOKEN" in str(e))
try:
    ci2.publish("apps/pilot-notes"); check("no token: no push", False)
except app_ci.CiError as e:
    check("no token: no push", "GITHUB_TOKEN" in str(e))

# lib-github guards as app_ci uses them
try:
    app_ci.AppCi(clone, "../etc", lambda: "t", tmp / "s3"); check("bad repo refused", False)
except app_ci.CiError:
    check("bad repo refused", True)
n = len(calls)
evil = app_ci.AppCi(clone, "MossesX/AmberX-AXF", lambda: "tok-123", tmp / "state4", transport=lambda r: (calls.append((r.method, r.url, dict(r.headers))), axf_http.Response(200, {}, json.dumps({"artifacts": [{"name": "x.apk", "archive_download_url": "https://evil.example/zip"}]}).encode(), r.url))[1])
evil.status = lambda d: {"state": "success", "runId": 7}  # type: ignore[method-assign]
try:
    evil.apk("apps/pilot-notes"); check("artifact URL off api.github.com refused", False)
except app_ci.CiError:
    check("artifact URL off api.github.com refused", not any(c[1].startswith("https://evil.example") for c in calls[n:]))

# the token reaches git through the environment of that one command, never argv
seen_cmd: list[tuple[list[str], dict]] = []
real_run = app_ci.subprocess.run
def spy(cmd, **kw):  # noqa: ANN001,ANN003
    seen_cmd.append((cmd, kw.get("env") or {}))
    return real_run(["true"], **{k: v for k, v in kw.items() if k != "env"})
app_ci.subprocess.run = spy  # type: ignore[assignment]
try:
    ci._git("fetch", "-q", "origin", "main", auth=True)
finally:
    app_ci.subprocess.run = real_run  # type: ignore[assignment]
cmd, env = seen_cmd[-1]
check("token not on the command line", not any("tok-123" in a or "extraheader" in a.lower() or "Basic" in a for a in cmd))
cfg = {env[f"GIT_CONFIG_KEY_{i}"]: env.get(f"GIT_CONFIG_VALUE_{i}", "") for i in range(int(env.get("GIT_CONFIG_COUNT", "0"))) if f"GIT_CONFIG_KEY_{i}" in env}
check("token header in the environment, scoped to github.com", cfg.get("http.https://github.com/.extraheader", "").startswith("Authorization: Basic "))
check("git follows no redirects with it", cfg.get("http.followRedirects") == "false")

print(f"app-ci self-test: {ok} passed, {fail} failed")
sys.exit(1 if fail else 0)
