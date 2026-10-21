"""
app-ci@1 — compile an app the build engine made into an APK on GitHub Actions.

  publish(dir)  commits the app folder (apps/<name>) plus framework files the engine changed on this server (new
                libraries) onto a branch `pilot/<name>` built from origin/main — with a separate index, so the
                server's checkout, HEAD and index are never touched — pushes it, and starts the `pilot-apk.yml`
                workflow on that branch.
  status(dir)   the latest run for that branch: queued / in_progress / success / failure, the run link and, on
                failure, the compiler's error lines.
  apk(dir)      the debug APK of the last successful run (downloaded once, cached in .axf-console/app-apks/).

Needs GITHUB_TOKEN with Contents: write and Actions: write on the repo (AXF_GITHUB_REPO). GitHub calls go through
lib-github (axf_server.github): the token goes to git as a header through the environment of one command (never argv,
.git/config or a URL) and to api.github.com only; it is never returned.
"""
from __future__ import annotations

import json
import os
import re
import subprocess
import tempfile
import time
from pathlib import Path
from typing import Any, Callable
from urllib.parse import urlencode

import axf_framework  # noqa: F401 — framework/python on sys.path
from axf_server import github, http as axf_http, storage

WORKFLOW = "pilot-apk.yml"
APP_DIR_RE = re.compile(r"^apps/[a-z0-9][a-z0-9-]{0,63}$")
# Framework paths an engine op may have changed on this server (new libraries); published with the app.
FRAMEWORK_PATHS = ("framework/android", "framework/libs", "framework/python/axf_libs", "framework/catalog/libraries.json")
MAX_APK = 200 * 1024 * 1024


class CiError(Exception):
    pass


def branch_for(app_dir: str) -> str:
    return "pilot/" + app_dir.split("/", 1)[1]


def check_dir(root: Path, app_dir: str) -> Path:
    if not isinstance(app_dir, str) or not APP_DIR_RE.match(app_dir):
        raise CiError("dir must be apps/<name>")
    p = (root / app_dir).resolve()
    if root.resolve() not in p.parents or not p.is_dir():
        raise CiError(f"{app_dir} doesn't exist on this server")
    if p.is_symlink():
        raise CiError("refusing a symlinked app folder")
    try:
        m = json.loads((p / "axf.manifest.json").read_text())
    except (OSError, ValueError):
        raise CiError(f"{app_dir} isn't an AXF app (no axf.manifest.json)") from None
    if "android" not in (m.get("targets") or []):
        raise CiError(f"{app_dir} isn't an Android app")
    return p


class AppCi:
    def __init__(self, root: Path, repo: str, token: Callable[[], str], state_dir: Path,
                 transport: axf_http.Transport | None = None, git: Callable[..., str] | None = None):
        if not github.valid_repo(repo):
            raise CiError("AXF_GITHUB_REPO must look like owner/name")
        self.root = root
        self.repo = repo
        self.token = token
        self.state = state_dir
        # lib-github: token only to api.github.com, no redirects on API calls, downloads capped at MAX_APK
        self.gh = github.GitHubClient(token, user_agent="axf-console", timeout=120, max_bytes=MAX_APK, transport=transport)
        self.git = git or self._git

    # ------------------------------------------------------------ helpers
    def _git_auth(self) -> dict[str, str]:
        t = self.token()
        if not t:
            raise CiError("GITHUB_TOKEN isn't set on the console (needs Contents: write and Actions: write)")
        return github.git_env(t)

    def _git(self, *args: str, env: dict[str, str] | None = None, auth: bool = False, inp: str | None = None) -> str:
        extra = self._git_auth() if auth else {"GIT_TERMINAL_PROMPT": "0"}
        r = subprocess.run(["git", "-C", str(self.root), *args], capture_output=True, text=True, timeout=300, env={**os.environ, **(env or {}), **extra}, input=inp)
        if r.returncode != 0:
            msg = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["git failed"]
            raise CiError(f"git {args[0]}: {github.scrub(msg[0], [self.token()])[:300]}")
        return r.stdout

    def _api(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        """`path` is relative to /repos/<repo> (e.g. '/actions/runs/7/jobs')."""
        try:
            data = self.gh.json(method, f"/repos/{self.repo}{path}", body)
        except github.GitHubError as e:
            if e.status == 0 and not self.token():
                raise CiError("GITHUB_TOKEN isn't set on the console") from None
            hint = " (the token needs Actions: write)" if e.status in (403, 404) and "dispatches" in path else ""
            raise CiError(f"{e}{hint}") from None
        return 200, data

    def _record_path(self, app_dir: str) -> Path:
        return self.state / f"{app_dir.split('/', 1)[1]}.json"

    def _record(self, app_dir: str) -> dict[str, Any]:
        rec = storage.read_json(self._record_path(app_dir), {})
        return rec if isinstance(rec, dict) else {}

    def _save(self, app_dir: str, rec: dict[str, Any]) -> None:
        storage.write_json(self._record_path(app_dir), rec)  # atomic, 0600, folder 0700

    # ------------------------------------------------------------ publish + start
    def changed_framework_files(self) -> list[str]:
        """Files under FRAMEWORK_PATHS that differ from HEAD on this server (untracked or modified)."""
        out = self.git("status", "--porcelain", "-z", "--untracked-files=all", "--", *FRAMEWORK_PATHS)
        files = []
        for entry in out.split("\0"):
            if len(entry) > 3:
                path = entry[3:]
                if entry[:2].strip() != "D" and "/build/" not in path and "/.gradle/" not in path:
                    files.append(path)
        return files

    def publish(self, app_dir: str) -> dict[str, Any]:
        check_dir(self.root, app_dir)
        branch = branch_for(app_dir)
        self.git("fetch", "-q", "origin", "main", auth=True)
        base = self.git("rev-parse", "FETCH_HEAD").strip()
        extra = self.changed_framework_files()
        with tempfile.TemporaryDirectory(prefix="app-ci-") as tmp:
            env = {"GIT_INDEX_FILE": str(Path(tmp) / "index")}
            self.git("read-tree", base, env=env)
            self.git("add", "-f", "--", app_dir, env=env)
            # never ship build output, local properties or secrets that might sit in the app folder
            self.git("rm", "-r", "-q", "--cached", "--ignore-unmatch", "--", f"{app_dir}/app/build", f"{app_dir}/build", f"{app_dir}/.gradle", f"{app_dir}/local.properties", f"{app_dir}/.env", env=env)
            if extra:
                self.git("add", "-f", "--", *extra, env=env)
            tree = self.git("write-tree", env=env).strip()
        msg = f"Build Pilot: {app_dir} for an APK build\n\nPublished by the Dev Console (app-ci@1); framework files changed on the server: {len(extra)}."
        commit = self.git("commit-tree", tree, "-p", base, inp=msg, env={"GIT_AUTHOR_NAME": "AXF Dev Console", "GIT_AUTHOR_EMAIL": "console@amberxai.com", "GIT_COMMITTER_NAME": "AXF Dev Console", "GIT_COMMITTER_EMAIL": "console@amberxai.com"}).strip()
        self.git("push", "-q", "-f", "origin", f"{commit}:refs/heads/{branch}", auth=True)
        started = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime(time.time() - 5))
        self._api("POST", f"/actions/workflows/{WORKFLOW}/dispatches", {"ref": branch, "inputs": {"app_dir": app_dir}})
        rec = {"dir": app_dir, "branch": branch, "commit": commit, "startedAt": started, "frameworkFiles": len(extra)}
        self._save(app_dir, rec)
        apk = self.state / f"{app_dir.split('/', 1)[1]}.apk"
        apk.unlink(missing_ok=True)
        return {**rec, "state": "queued"}

    # ------------------------------------------------------------ status + apk
    def status(self, app_dir: str) -> dict[str, Any]:
        rec = self._record(app_dir)
        if not rec:
            return {"dir": app_dir, "state": "none"}
        q = urlencode({"branch": rec["branch"], "event": "workflow_dispatch", "per_page": 5})
        _c, data = self._api("GET", f"/actions/workflows/{WORKFLOW}/runs?{q}")
        runs = [r for r in (data or {}).get("workflow_runs", []) if r.get("created_at", "") >= rec["startedAt"] and r.get("head_sha") == rec["commit"]]
        if not runs:
            return {**rec, "state": "queued"}
        run = runs[0]
        done = github.run_state(run.get("status"), run.get("conclusion")) in ("success", "failure", "cancelled")
        state = ("success" if run.get("conclusion") == "success" else "failure") if done else run.get("status")
        out = {**rec, "state": state, "runId": run.get("id"), "url": run.get("html_url"), "conclusion": run.get("conclusion")}
        if state == "failure" and not rec.get("errors"):
            rec["errors"] = self._errors(run.get("id"))
            self._save(app_dir, rec)
        if rec.get("errors"):
            out["errors"] = rec["errors"]
        out["apkReady"] = (self.state / f"{app_dir.split('/', 1)[1]}.apk").exists()
        return out

    def _errors(self, run_id: Any) -> list[str]:
        try:
            _c, jobs = self._api("GET", f"/actions/runs/{run_id}/jobs")
            job = next((j for j in (jobs or {}).get("jobs", []) if j.get("conclusion") == "failure"), None)
            if not job:
                return []
            try:
                text = self.gh.job_log(self.repo, int(job["id"]), max_bytes=16 * 1024 * 1024)
            except (github.GitHubError, ValueError, TypeError):
                text = ""
            lines = [re.sub(r"^\S+Z ", "", l) for l in text.splitlines() if re.search(r"(^|\s)e: |error:|What went wrong|FAILED|Could not resolve|Unresolved reference", l)]
            return [l.replace("/home/runner/work/AmberX-AXF/AmberX-AXF/", "")[:300] for l in lines][-40:]
        except CiError:
            return []

    def apk(self, app_dir: str) -> Path:
        st = self.status(app_dir)
        if st.get("state") != "success":
            raise CiError("no finished APK build yet")
        path = self.state / f"{app_dir.split('/', 1)[1]}.apk"
        if path.exists():
            return path
        _c, arts = self._api("GET", f"/actions/runs/{st['runId']}/artifacts")
        art = next((a for a in (arts or {}).get("artifacts", []) if a.get("name", "").endswith(".apk") and not a.get("expired")), None)
        if not art:
            raise CiError("the run has no APK artifact (expired?)")
        try:
            # the zip URL must be on api.github.com (the token goes nowhere else); its redirect is fetched without it
            raw = self.gh.download(str(art.get("archive_download_url") or ""), max_bytes=MAX_APK)
            _name, data = github.zip_member(raw, lambda n: n.endswith(".apk"), MAX_APK)  # unzipped size capped too
        except github.GitHubError as e:
            raise CiError(f"APK download: {e}") from None
        storage.write_bytes(path, data)  # atomic, 0600, folder 0700
        return path

