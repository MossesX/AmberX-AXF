"""
app-ci@1 — compile an app the build engine made into an APK on GitHub Actions.

  publish(dir)  commits the app folder (apps/<name>) plus framework files the engine changed on this server (new
                libraries) onto a branch `pilot/<name>` built from origin/main — with a separate index, so the
                server's checkout, HEAD and index are never touched — pushes it, and starts the `pilot-apk.yml`
                workflow on that branch.
  status(dir)   the latest run for that branch: queued / in_progress / success / failure, the run link and, on
                failure, the compiler's error lines.
  apk(dir)      the debug APK of the last successful run (downloaded once, cached in .axf-console/app-apks/).

Needs GITHUB_TOKEN with Contents: write and Actions: write on the repo (AXF_GITHUB_REPO). The token goes to git as
a header for one command and to the GitHub API; it is never written to .git/config or returned.
"""
from __future__ import annotations

import base64
import io
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.request
import zipfile
from pathlib import Path
from typing import Any, Callable

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
                 http: Callable[..., tuple[int, dict[str, str], bytes]] | None = None, git: Callable[..., str] | None = None):
        self.root = root
        self.repo = repo
        self.token = token
        self.state = state_dir
        self.http = http or _http
        self.git = git or self._git

    # ------------------------------------------------------------ helpers
    def _auth_header(self) -> str:
        t = self.token()
        if not t:
            raise CiError("GITHUB_TOKEN isn't set on the console (needs Contents: write and Actions: write)")
        return "AUTHORIZATION: basic " + base64.b64encode(f"x-access-token:{t}".encode()).decode()

    def _git(self, *args: str, env: dict[str, str] | None = None, auth: bool = False, inp: str | None = None) -> str:
        cmd = ["git"]
        if auth:
            cmd += ["-c", f"http.https://github.com/.extraheader={self._auth_header()}"]
        cmd += ["-C", str(self.root), *args]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=300, env={**os.environ, **(env or {}), "GIT_TERMINAL_PROMPT": "0"}, input=inp)
        if r.returncode != 0:
            msg = (r.stderr or r.stdout).strip().splitlines()[-1:] or ["git failed"]
            raise CiError(f"git {args[0]}: {msg[0].replace(self.token() or '¤', '***')[:300]}")
        return r.stdout

    def _api(self, method: str, path: str, body: Any = None) -> tuple[int, Any]:
        t = self.token()
        if not t:
            raise CiError("GITHUB_TOKEN isn't set on the console")
        code, _h, raw = self.http(method, f"https://api.github.com/repos/{self.repo}{path}", {"Authorization": f"Bearer {t}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"},
                                  json.dumps(body).encode() if body is not None else None)
        try:
            data = json.loads(raw) if raw else None
        except ValueError:
            data = None
        if code >= 400:
            msg = (data or {}).get("message") if isinstance(data, dict) else ""
            hint = " (the token needs Actions: write)" if code in (403, 404) and "dispatches" in path else ""
            raise CiError(f"GitHub {code}: {msg or 'request failed'}{hint}")
        return code, data

    def _record_path(self, app_dir: str) -> Path:
        return self.state / f"{app_dir.split('/', 1)[1]}.json"

    def _record(self, app_dir: str) -> dict[str, Any]:
        try:
            return json.loads(self._record_path(app_dir).read_text())
        except (OSError, ValueError):
            return {}

    def _save(self, app_dir: str, rec: dict[str, Any]) -> None:
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        p = self._record_path(app_dir)
        p.write_text(json.dumps(rec, indent=2))
        os.chmod(p, 0o600)

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
        _c, data = self._api("GET", f"/actions/workflows/{WORKFLOW}/runs?branch={rec['branch']}&event=workflow_dispatch&per_page=5")
        runs = [r for r in (data or {}).get("workflow_runs", []) if r.get("created_at", "") >= rec["startedAt"] and r.get("head_sha") == rec["commit"]]
        if not runs:
            return {**rec, "state": "queued"}
        run = runs[0]
        state = run.get("status") if run.get("status") != "completed" else ("success" if run.get("conclusion") == "success" else "failure")
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
            code, _h, raw = self.http("GET", f"https://api.github.com/repos/{self.repo}/actions/jobs/{job['id']}/logs", {"Authorization": f"Bearer {self.token()}"}, None)
            text = raw.decode("utf-8", "replace") if code < 400 else ""
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
        code, _h, raw = self.http("GET", art["archive_download_url"], {"Authorization": f"Bearer {self.token()}"}, None)
        if code >= 400:
            raise CiError(f"GitHub {code} downloading the APK")
        if len(raw) > MAX_APK:
            raise CiError("APK too large")
        with zipfile.ZipFile(io.BytesIO(raw)) as z:
            name = next((n for n in z.namelist() if n.endswith(".apk") and "/" not in n.strip("/")), None) or next((n for n in z.namelist() if n.endswith(".apk")), None)
            if not name:
                raise CiError("the artifact has no .apk")
            data = z.read(name)
        self.state.mkdir(parents=True, exist_ok=True, mode=0o700)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(data)
        os.chmod(tmp, 0o600)
        tmp.replace(path)
        return path


class _NoAuthRedirect(urllib.request.HTTPRedirectHandler):
    """Follow GitHub's redirects to blob storage without carrying the token there."""
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # type: ignore[override]
        new = super().redirect_request(req, fp, code, msg, headers, newurl)
        if new is not None and not newurl.startswith("https://api.github.com/"):
            for h in list(new.headers):
                if h.lower() == "authorization":
                    del new.headers[h]
            new.unredirected_hdrs.pop("Authorization", None)
        return new


def _http(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, dict[str, str], bytes]:
    req = urllib.request.Request(url, data=body, method=method, headers={**headers, **({"Content-Type": "application/json"} if body else {})})
    opener = urllib.request.build_opener(_NoAuthRedirect)
    try:
        with opener.open(req, timeout=120) as r:
            return r.status, dict(r.headers), r.read(MAX_APK + 1)
    except urllib.error.HTTPError as e:
        return e.code, dict(e.headers or {}), e.read(65536)
    except (urllib.error.URLError, TimeoutError, OSError) as e:
        raise CiError(f"GitHub not reachable: {getattr(e, 'reason', e)}") from None
