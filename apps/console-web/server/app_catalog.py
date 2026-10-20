"""
app-catalog@1 — every app built with the framework, downloadable from axHub.

CI (`android.yml`) uploads one artifact, `app-apks`: each app's debug APK plus `apps.json` (app-bundle@1, written by
framework/cli/app-bundle.mjs). This module watches for the newest green run on main, downloads that artifact once,
checks every file against the bundle's sha256 and files it in the hub's shared data folder, where axHub serves
the Apps page:

  /projects/_shared/_data/app-catalog/
      catalog.json                          app-catalog@1 index (no secrets)
      apks/<project>/<project>-<version>-b<build>.apk

The last KEEP builds of each app are kept. `AXF_APP_CATALOG` overrides the folder (`off` = none).
Needs GITHUB_TOKEN (Actions: read) to download artifacts; the token goes to api.github.com only.
"""
from __future__ import annotations

import hashlib
import io
import json
import os
import re
import tempfile
import threading
import time
import zipfile
from pathlib import Path
from typing import Any, Callable

import app_ci

KEEP = 3
MAX_BUNDLE = app_ci.MAX_APK  # the download helper caps reads at this size
MAX_APP = 300 * 1024 * 1024
PROJECT_RE = re.compile(r"^[a-z0-9][a-z0-9-]{0,63}$")
VERSION_RE = re.compile(r"^[0-9A-Za-z][0-9A-Za-z.+_-]{0,31}$")
SHA_RE = re.compile(r"^[0-9a-f]{64}$")
APPID_RE = re.compile(r"^[a-zA-Z][a-zA-Z0-9_]*(\.[a-zA-Z][a-zA-Z0-9_]*)+$")


def default_dir() -> Path | None:
    env = os.environ.get("AXF_APP_CATALOG")
    if env is not None:
        return Path(env) if env and env != "off" else None
    projects = Path(os.environ.get("AXHUB_PROJECTS_DIR") or "/projects")
    return projects / "_shared" / "_data" / "app-catalog" if projects.is_dir() else None


class CatalogError(Exception):
    pass


class AppCatalog:
    def __init__(self, repo: str, token: Callable[[], str], folder: Path | None,
                 http: Callable[..., tuple[int, dict[str, str], bytes]] | None = None, workflow: str = "android.yml"):
        self.repo, self.token, self.folder, self.workflow = repo, token, folder, workflow
        self.http = http or _http
        self.lock = threading.Lock()
        self.last: dict[str, Any] = {"state": "idle"}

    # ---------- reading ----------
    def index_path(self) -> Path | None:
        return self.folder / "catalog.json" if self.folder else None

    def read(self) -> dict[str, Any]:
        p = self.index_path()
        if not p or not p.exists():
            return {"$axf": "app-catalog@1", "apps": [], "updatedAt": None}
        try:
            return json.loads(p.read_text())
        except (OSError, ValueError):
            return {"$axf": "app-catalog@1", "apps": [], "updatedAt": None, "damaged": True}

    def status(self) -> dict[str, Any]:
        cat = self.read()
        return {"folder": str(self.folder) if self.folder else None, "enabled": bool(self.folder), "tokenSet": bool(self.token()),
                "updatedAt": cat.get("updatedAt"), "source": cat.get("source"), "apps": len(cat.get("apps", [])), "last": self.last}

    # ---------- GitHub ----------
    def _api(self, path: str) -> Any:
        t = self.token()
        if not t:
            raise CatalogError("GITHUB_TOKEN isn't set on the console")
        code, _h, raw = self.http("GET", f"https://api.github.com/repos/{self.repo}{path}", {"Authorization": f"Bearer {t}", "Accept": "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28"}, None)
        if code >= 400:
            raise CatalogError(f"GitHub {code} on {path.split('?')[0]}")
        return json.loads(raw or b"{}")

    def latest_run(self) -> dict[str, Any] | None:
        runs = self._api(f"/actions/workflows/{self.workflow}/runs?branch=main&status=success&per_page=1").get("workflow_runs", [])
        return runs[0] if runs else None

    # ---------- sync ----------
    def sync(self, force: bool = False) -> dict[str, Any]:
        if not self.folder:
            raise CatalogError("no app catalog folder (mount /projects or set AXF_APP_CATALOG)")
        if not self.lock.acquire(blocking=False):
            raise CatalogError("a catalog update is already running")
        try:
            self.last = {"state": "checking", "at": _now()}
            run = self.latest_run()
            if not run:
                self.last = {"state": "idle", "at": _now(), "note": "no green build yet"}
                return self.last
            cat = self.read()
            if not force and (cat.get("source") or {}).get("runId") == run["id"]:
                self.last = {"state": "current", "at": _now(), "runId": run["id"]}
                return self.last
            arts = self._api(f"/actions/runs/{run['id']}/artifacts?per_page=100").get("artifacts", [])
            art = next((a for a in arts if a.get("name") == "app-apks" and not a.get("expired")), None)
            if not art:
                self.last = {"state": "idle", "at": _now(), "note": f"build {run.get('run_number')} has no app-apks bundle"}
                return self.last
            if int(art.get("size_in_bytes") or 0) > MAX_BUNDLE:
                raise CatalogError("bundle too large")
            code, _h, raw = self.http("GET", art["archive_download_url"], {"Authorization": f"Bearer {self.token()}"}, None)
            if code >= 400:
                raise CatalogError(f"GitHub {code} downloading the bundle")
            added = self._file_bundle(raw, run)
            self.last = {"state": "updated", "at": _now(), "runId": run["id"], "added": added}
            return self.last
        except CatalogError as e:
            self.last = {"state": "error", "at": _now(), "error": str(e)}
            raise
        finally:
            self.lock.release()

    def _file_bundle(self, raw: bytes, run: dict[str, Any]) -> list[str]:
        assert self.folder
        try:
            z = zipfile.ZipFile(io.BytesIO(raw))
        except zipfile.BadZipFile:
            raise CatalogError("the bundle isn't a zip") from None
        names = set(z.namelist())
        if "apps.json" not in names:
            raise CatalogError("the bundle has no apps.json")
        try:
            bundle = json.loads(z.read("apps.json"))
        except ValueError:
            raise CatalogError("apps.json isn't JSON") from None
        if bundle.get("$axf") != "app-bundle@1" or not isinstance(bundle.get("apps"), list):
            raise CatalogError("apps.json isn't app-bundle@1")
        build = bundle.get("build") if isinstance(bundle.get("build"), int) else run.get("run_number")
        cat = self.read()
        by = {a["project"]: a for a in cat.get("apps", []) if isinstance(a, dict) and PROJECT_RE.match(str(a.get("project", "")))}
        apks = self.folder / "apks"
        added: list[str] = []
        for a in bundle["apps"][:100]:
            project, version, sha, file = str(a.get("project", "")), str(a.get("version", "")), str(a.get("sha256", "")), str(a.get("file", ""))
            if not PROJECT_RE.match(project) or not VERSION_RE.match(version) or not SHA_RE.match(sha) or file != f"{project}.apk" or file not in names:
                continue  # never trust a name we didn't expect
            if z.getinfo(file).file_size > MAX_APP:
                raise CatalogError(f"{project}: APK too large")
            data = z.read(file)
            if hashlib.sha256(data).hexdigest() != sha or not data.startswith(b"PK"):
                raise CatalogError(f"{project}: file doesn't match its sha256")
            name = f"{project}-{version}-b{int(build or 0)}.apk"
            target_dir = apks / project
            target_dir.mkdir(parents=True, exist_ok=True)
            _chmod(target_dir, 0o2775)
            target = target_dir / name
            if not target.exists():
                fd, tmp = tempfile.mkstemp(dir=target_dir, prefix=".tmp-", suffix=".apk")
                with os.fdopen(fd, "wb") as f:
                    f.write(data)
                _chmod(Path(tmp), 0o664)
                os.replace(tmp, target)
            entry = {"version": version, "build": build, "versionCode": a.get("versionCode") if isinstance(a.get("versionCode"), int) else build,
                     "file": f"apks/{project}/{name}", "size": len(data), "sha256": sha, "builtAt": run.get("updated_at") or bundle.get("builtAt"),
                     "commit": (run.get("head_sha") or "")[:12], "runUrl": run.get("html_url")}
            app = by.get(project) or {"project": project}
            app.update({"project": project, "name": str(a.get("name") or project)[:80], "platform": "android",
                        "appId": a.get("appId") if isinstance(a.get("appId"), str) and APPID_RE.match(a["appId"]) else None})
            versions = [v for v in app.get("versions", []) if isinstance(v, dict) and v.get("file") != entry["file"]]
            versions.insert(0, entry)
            keep, drop = versions[:KEEP], versions[KEEP:]
            for v in drop:
                old = self.folder / str(v.get("file", ""))
                if old.resolve().parent == target_dir.resolve() and old.name.endswith(".apk"):
                    old.unlink(missing_ok=True)
            app["versions"] = keep
            app["latest"] = keep[0]
            by[project] = app
            added.append(project)
        cat = {"$axf": "app-catalog@1", "updatedAt": _now(), "apps": sorted(by.values(), key=lambda x: x.get("name", "").lower()),
               "source": {"repo": self.repo, "runId": run.get("id"), "runNumber": run.get("run_number"), "commit": (run.get("head_sha") or "")[:12], "runUrl": run.get("html_url")}}
        self._write_index(cat)
        return added

    def _write_index(self, cat: dict[str, Any]) -> None:
        assert self.folder
        self.folder.mkdir(parents=True, exist_ok=True)
        _chmod(self.folder, 0o2775)
        fd, tmp = tempfile.mkstemp(dir=self.folder, prefix=".tmp-", suffix=".json")
        with os.fdopen(fd, "w") as f:
            json.dump(cat, f, indent=2)
            f.write("\n")
        _chmod(Path(tmp), 0o664)
        os.replace(tmp, self.folder / "catalog.json")

    # ---------- background ----------
    def start(self, every: int = 600) -> None:
        if not self.folder:
            return

        def loop() -> None:
            time.sleep(30)
            while True:
                if self.token():
                    try:
                        self.sync()
                    except CatalogError:
                        pass
                    except Exception as e:  # noqa: BLE001 — keep the loop alive
                        self.last = {"state": "error", "at": _now(), "error": type(e).__name__}
                time.sleep(max(60, every))

        threading.Thread(target=loop, name="app-catalog", daemon=True).start()


def _chmod(p: Path, mode: int) -> None:
    try:
        os.chmod(p, mode)
    except OSError:
        pass


def _now() -> str:
    return time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())


def _http(method: str, url: str, headers: dict[str, str], body: bytes | None) -> tuple[int, dict[str, str], bytes]:
    return app_ci._http(method, url, headers, body)
