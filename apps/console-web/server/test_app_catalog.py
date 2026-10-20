"""Self-test for app_catalog.py (fake GitHub API, real files). Run: python apps/console-web/server/test_app_catalog.py"""
from __future__ import annotations

import hashlib
import io
import json
import sys
import tempfile
import zipfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
import app_catalog  # noqa: E402

passed = 0


def check(cond: bool, what: str) -> None:
    global passed
    if not cond:
        raise SystemExit(f"FAIL: {what}")
    passed += 1


def apk(tag: str) -> bytes:
    return b"PK\x03\x04" + tag.encode() * 50


def bundle(build: int, apps: dict[str, bytes], tamper: str | None = None, extra: list[dict] | None = None) -> bytes:
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w") as z:
        entries = []
        for project, data in apps.items():
            z.writestr(f"{project}.apk", data)
            entries.append({"project": project, "name": project.title(), "appId": f"ai.amberx.{project.replace('-', '')}", "version": "0.1.0", "versionCode": build,
                            "build": build, "file": f"{project}.apk", "size": len(data), "sha256": hashlib.sha256(data if project != tamper else b"x").hexdigest()})
        entries += extra or []
        z.writestr("apps.json", json.dumps({"$axf": "app-bundle@1", "build": build, "apps": entries}))
    return buf.getvalue()


class FakeGitHub:
    def __init__(self) -> None:
        self.run = 0
        self.zip = b""
        self.downloads = 0

    def set(self, run: int, data: bytes) -> None:
        self.run, self.zip = run, data

    def __call__(self, method: str, url: str, headers: dict, body):  # noqa: ANN001
        assert "Authorization" in headers
        if "/runs?" in url:
            return 200, {}, json.dumps({"workflow_runs": [{"id": 1000 + self.run, "run_number": self.run, "head_sha": "abc123def4567890", "html_url": f"https://github.com/x/runs/{self.run}", "updated_at": "2026-10-20T20:00:00Z"}]}).encode()
        if url.endswith("/artifacts?per_page=100"):
            return 200, {}, json.dumps({"artifacts": [{"name": "voicevault-debug.apk", "archive_download_url": "https://api.github.com/a/1"}, {"name": "app-apks", "size_in_bytes": len(self.zip), "archive_download_url": "https://api.github.com/a/2"}]}).encode()
        if url == "https://api.github.com/a/2":
            self.downloads += 1
            return 200, {}, self.zip
        return 404, {}, b""


with tempfile.TemporaryDirectory() as tmp:
    folder = Path(tmp) / "app-catalog"
    gh = FakeGitHub()
    cat = app_catalog.AppCatalog("MossesX/AmberX-AXF", lambda: "t0ken", folder, http=gh)

    # no token -> clear error
    nocat = app_catalog.AppCatalog("r/r", lambda: "", folder, http=gh)
    try:
        nocat.sync(); check(False, "sync without a token fails")
    except app_catalog.CatalogError as e:
        check("GITHUB_TOKEN" in str(e), "token error names GITHUB_TOKEN")

    gh.set(110, bundle(110, {"voice-vault": apk("v110"), "axhub-android": apk("a110")}))
    r = cat.sync()
    check(r["state"] == "updated" and sorted(r["added"]) == ["axhub-android", "voice-vault"], "first sync files both apps")
    c = json.loads((folder / "catalog.json").read_text())
    check(c["$axf"] == "app-catalog@1" and c["source"]["runNumber"] == 110, "index records the run")
    vv = next(a for a in c["apps"] if a["project"] == "voice-vault")
    check(vv["latest"]["file"] == "apks/voice-vault/voice-vault-0.1.0-b110.apk", "file named project-version-build")
    check((folder / vv["latest"]["file"]).read_bytes() == apk("v110"), "APK bytes written")
    check(vv["appId"] == "ai.amberx.voicevault", "appId kept")

    check(cat.sync()["state"] == "current" and gh.downloads == 1, "same run is not downloaded again")

    for n in (111, 112, 113):
        gh.set(n, bundle(n, {"voice-vault": apk(f"v{n}")}))
        cat.sync()
    c = json.loads((folder / "catalog.json").read_text())
    vv = next(a for a in c["apps"] if a["project"] == "voice-vault")
    check([v["build"] for v in vv["versions"]] == [113, 112, 111], "keeps the last 3 builds, newest first")
    check(not (folder / "apks/voice-vault/voice-vault-0.1.0-b110.apk").exists(), "oldest build's file removed")
    check(any(a["project"] == "axhub-android" for a in c["apps"]), "apps missing from a later bundle stay listed")

    gh.set(114, bundle(114, {"voice-vault": apk("evil")}, tamper="voice-vault"))
    try:
        cat.sync(); check(False, "tampered APK rejected")
    except app_catalog.CatalogError as e:
        check("sha256" in str(e), "sha mismatch reported")
    check(json.loads((folder / "catalog.json").read_text())["source"]["runNumber"] == 113, "index unchanged after a rejected bundle")

    evil = [{"project": "../../etc", "version": "1", "file": "../../etc.apk", "sha256": "0" * 64},
            {"project": "ok-app", "version": "1;rm", "file": "ok-app.apk", "sha256": "0" * 64},
            {"project": "ghost", "version": "1.0", "file": "ghost.apk", "sha256": "0" * 64}]
    gh.set(115, bundle(115, {"voice-vault": apk("v115")}, extra=evil))
    r = cat.sync()
    check(r["added"] == ["voice-vault"], "unexpected names, bad versions and missing files are skipped")
    check(not any(p.name.startswith("etc") for p in Path(tmp).rglob("*")), "nothing written outside the catalog")

    st = cat.status()
    check(st["enabled"] and st["apps"] == 2 and st["last"]["state"] == "updated", "status summary")

print(f"app_catalog: {passed} checks passed")
