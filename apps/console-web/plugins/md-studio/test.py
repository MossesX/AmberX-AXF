#!/usr/bin/env python3
"""Self-test for the MD Studio plugin's server part (scratch repo + hub trees, routes through FastAPI's test client).

Covers: the scopes (Project grouped by manifest, Claude from the hub by project and category with the notes folder left
out, Repo by top folder with builds/caches/baked copies skipped, Notes through axf.notes@1 and hidden when it's absent);
path search and content search; read with version, tokens and references resolved to ids (imports, links, code paths,
relative and hub paths); create-only and conflict-safe saves (409); kept versions for repo files (data folder) and hub
files (axHub memory semantics: meta.json attribution + versions/<urlencoded>.json, sha256[:16]); history, version,
restore (and undoing it); the context chain with token counts, repeats counted once and missing refs listed; path
safety (.., absolute, hidden, links, non-.md, skipped folders, the notes folder through hub:).

    python3 apps/console-web/plugins/md-studio/test.py
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import os
import shutil
import sys
import tempfile
from pathlib import Path
from urllib.parse import quote

HERE = Path(__file__).resolve().parent
TMP = Path(tempfile.mkdtemp(prefix="axf-md-studio-test-"))
REPO, HUB, DATA = TMP / "repo", TMP / "projects", TMP / "data"
os.environ.update({"AXF_ROOT": str(REPO), "AXHUB_PROJECTS_DIR": str(HUB), "AXF_MD_STUDIO_DATA_DIR": str(DATA)})


def put(p: Path, text: str) -> None:
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text, encoding="utf-8")


put(REPO / "project.manifest.json", json.dumps({"name": "amberx-axf"}))
put(REPO / "apps/voice/project.manifest.json", json.dumps({"name": "voice-vault"}))
put(REPO / "CLAUDE.md", "# Root rules\n\n@_claude/rules/RULES.md\n\nSee [the guide](docs/guide.md#top) and `framework/spec/THEMING.md`.\nAlso [gone](docs/missing.md).\n")
put(REPO / "_claude/rules/RULES.md", "# Rules\n\nBack to [root](../../CLAUDE.md).\n")
put(REPO / "docs/guide.md", "# Guide\n\nhello world\n")
put(REPO / "framework/spec/THEMING.md", "# Theming\n\ntokens only\n")
put(REPO / "apps/voice/README.md", "# Voice Vault\n")
put(REPO / "node_modules/x/README.md", "# vendored\n")
put(REPO / "apps/console-web/src/axf/README.md", "# baked\n")
put(REPO / "_claude/builds/journal/a.md", "# journal\n")
put(REPO / "docs/notes.txt", "not markdown")
put(HUB / "_shared/_claude/rules/RULES.md", "# Shared rules\n")
put(HUB / "_shared/_claude/notes/plans/p.md", "# A plan\n")
put(HUB / "amberx-axf/_claude/rules/RULES.md", "# AXF rules\n\nShared: `_claude/shared/rules/RULES.md`.\n")
put(HUB / "amberx-axf/_claude/THREADS.md", "# Threads\n")


class FakeNotes:
    """axf.notes@1 as the Notes plugin provides it (list/read/write/history), over the scratch hub's notes folder."""
    on = True
    root = HUB / "_shared/_claude/notes"

    def available(self):
        return self.on

    def list(self, q=""):
        notes = []
        for f in sorted(self.root.rglob("*.md")):
            rel = f.relative_to(self.root).as_posix()
            t = f.read_text()
            if q and q.lower() not in t.lower():
                continue
            notes.append({"path": rel, "folder": rel.rpartition("/")[0], "name": f.name, "title": t.splitlines()[0].lstrip("# "), "size": len(t), "updatedAt": "2026-11-03T00:00:00Z"})
        return {"notes": notes}

    def read(self, path):
        f = self.root / path
        if not f.is_file():
            e = Exception(f'"{path}" doesn\'t exist.')
            e.status = 404
            raise e
        t = f.read_text()
        return {"path": path, "content": t, "updatedAt": "2026-11-03T00:00:00Z", "updatedBy": "x"}

    def write(self, path, content, if_version=None, by=None):
        f = self.root / path
        cur = f.read_text() if f.is_file() else None
        if if_version is not None and if_version != (hashlib.sha256(cur.encode()).hexdigest()[:16] if cur is not None else ""):
            e = Exception(f'"{path}" changed since you opened it')
            e.status = 409
            raise e
        f.parent.mkdir(parents=True, exist_ok=True)
        f.write_text(content)
        return {"path": path}


NOTES = FakeNotes()
sys.path.insert(0, str(HERE.parent.parent / "server"))
import plugin_services  # noqa: E402

plugin_services.provide("axf.notes@1", NOTES, "notes-browser")

spec = importlib.util.spec_from_file_location("md_studio_server", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules["md_studio_server"] = mod
spec.loader.exec_module(mod)

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router)
c = TestClient(app)
fails = 0


def check(name: str, ok: bool, detail: object = "") -> None:
    global fails
    print(f"{'ok  ' if ok else 'FAIL'} {name}{'' if ok else f'  -> {detail}'}")
    if not ok:
        fails += 1


def ver(t: str) -> str:
    return hashlib.sha256(t.encode()).hexdigest()[:16]


def ids(scope: dict) -> list[str]:
    return [f["id"] for g in scope["groups"] for f in g["files"]]


try:
    # ---- listing --------------------------------------------------------------------------------------------------
    r = c.get("/files")
    check("files answers", r.status_code == 200, r.text)
    sc = {s["id"]: s for s in r.json()["scopes"]}
    check("four scopes in order", [s["id"] for s in r.json()["scopes"]] == ["project", "claude", "repo", "notes"], list(sc))
    proj = {g["label"]: [f["id"] for f in g["files"]] for g in sc["project"]["groups"]}
    check("project groups by manifest", "repo:apps/voice/README.md" in proj.get("voice-vault", []) and "repo:CLAUDE.md" in proj.get("amberx-axf", []), proj)
    check("root project listed first", sc["project"]["groups"][0]["label"] == "amberx-axf", sc["project"]["groups"][0])
    repo_ids = ids(sc["repo"])
    check("repo skips vendored, baked, journal, non-md", not any(x in " ".join(repo_ids) for x in ("node_modules", "src/axf", "journal", "notes.txt")), repo_ids)
    check("repo groups by top folder", {g["label"] for g in sc["repo"]["groups"]} >= {"(top level)", "docs", "framework", "_claude", "apps"}, [g["label"] for g in sc["repo"]["groups"]])
    claude_ids = ids(sc["claude"])
    check("claude lists hub files of every project", {"hub:_shared/rules/RULES.md", "hub:amberx-axf/rules/RULES.md", "hub:amberx-axf/THREADS.md"} <= set(claude_ids), claude_ids)
    check("claude leaves the notes folder to Notes", not any("notes/" in x for x in claude_ids), claude_ids)
    check("claude categories", {(g["label"], g["category"]) for g in sc["claude"]["groups"]} >= {("Shared (every project)", "rules"), ("amberx-axf", "top")}, sc["claude"]["groups"])
    check("notes scope via axf.notes@1", sc["notes"]["available"] and ids(sc["notes"]) == ["notes:plans/p.md"], sc["notes"])
    r = c.get("/files", params={"q": "guide"})
    check("path search", ids({s["id"]: s for s in r.json()["scopes"]}["repo"]) == ["repo:docs/guide.md"], r.json())
    r = c.get("/files", params={"q": "tokens only", "content": "true"})
    hit = [f for s in r.json()["scopes"] for g in s["groups"] for f in g["files"] if f["id"] == "repo:framework/spec/THEMING.md"]
    check("content search with snippet", hit and "tokens only" in hit[0].get("snippet", ""), r.json())

    # ---- read + refs ----------------------------------------------------------------------------------------------
    r = c.get("/file", params={"id": "repo:CLAUDE.md"})
    d = r.json()
    check("read", r.status_code == 200 and d["title"] == "Root rules" and d["version"] == ver(d["content"]) and d["tokens"] == (len(d["content"]) + 3) // 4, d)
    refs = {x["ref"]: x for x in d["refs"]}
    check("import ref resolved", refs["_claude/rules/RULES.md"]["id"] == "repo:_claude/rules/RULES.md" and refs["_claude/rules/RULES.md"]["kind"] == "import", refs)
    check("link ref with anchor resolved", refs["docs/guide.md"]["id"] == "repo:docs/guide.md", refs)
    check("code path ref resolved", refs["framework/spec/THEMING.md"]["id"] == "repo:framework/spec/THEMING.md", refs)
    check("missing ref = null id", refs["docs/missing.md"]["id"] is None, refs)
    r = c.get("/refs", params={"id": "repo:_claude/rules/RULES.md"})
    check("relative ../ ref", r.json()["refs"][0]["id"] == "repo:CLAUDE.md", r.json())
    r = c.get("/refs", params={"id": "hub:amberx-axf/rules/RULES.md"})
    check("hub _claude/shared ref → hub:_shared", r.json()["refs"][0]["id"] == "hub:_shared/rules/RULES.md", r.json())
    r = c.get("/file", params={"id": "notes:plans/p.md"})
    check("read a note", r.status_code == 200 and r.json()["title"] == "A plan", r.text)

    # ---- chain ----------------------------------------------------------------------------------------------------
    r = c.get("/chain", params={"id": "repo:CLAUDE.md"})
    ch = r.json()
    kids = {k["id"]: k for k in ch["root"]["children"]}
    check("chain lists children", set(kids) == {"repo:_claude/rules/RULES.md", "repo:docs/guide.md", "repo:framework/spec/THEMING.md"}, list(kids))
    back = kids["repo:_claude/rules/RULES.md"]["children"]
    check("chain repeat counted once", back and back[0]["repeat"] and back[0]["children"] == [], back)
    total = sum(len((REPO / p).read_text()) + 3 for p in ("CLAUDE.md", "_claude/rules/RULES.md", "docs/guide.md", "framework/spec/THEMING.md")) // 1
    expect = sum((len((REPO / p).read_text()) + 3) // 4 for p in ("CLAUDE.md", "_claude/rules/RULES.md", "docs/guide.md", "framework/spec/THEMING.md"))
    check("chain tokens total", ch["tokens"] == expect and ch["files"] == 4 and ch["root"]["subtotal"] == expect, ch)
    check("chain lists unresolved", ch["root"]["unresolved"] == ["docs/missing.md"], ch["root"])
    r = c.get("/chain", params={"id": "repo:CLAUDE.md", "follow": "import"})
    ch2 = r.json()
    check("chain follow=import keeps only imports", [k["id"] for k in ch2["root"]["children"]] == ["repo:_claude/rules/RULES.md"] and ch2["follow"] == "import" and ch2["root"]["unresolved"] == [], ch2)
    check("repeat nodes list no unresolved", back[0]["unresolved"] == [], back)
    r = c.get("/chain", params={"id": "repo:CLAUDE.md", "depth": 0})
    check("chain depth 0", r.json()["root"]["children"] == [], r.json())

    # ---- repo writes ----------------------------------------------------------------------------------------------
    g = c.get("/file", params={"id": "repo:docs/guide.md"}).json()
    r = c.put("/file", json={"id": "repo:docs/guide.md", "content": "# Guide\n\nv2\n", "if_version": g["version"]})
    check("save", r.status_code == 200 and (REPO / "docs/guide.md").read_text() == "# Guide\n\nv2\n", r.text)
    r = c.put("/file", json={"id": "repo:docs/guide.md", "content": "# stale\n", "if_version": g["version"]})
    check("stale save = 409", r.status_code == 409 and "changed since" in r.text, r.text)
    r = c.put("/file", json={"id": "repo:docs/guide.md", "content": "# new\n", "if_version": ""})
    check("create-only on existing = 409", r.status_code == 409, r.text)
    r = c.put("/file", json={"id": "repo:docs/new/fresh.md", "content": "# Fresh\n", "if_version": ""})
    check("create new file + folder", r.status_code == 200 and (REPO / "docs/new/fresh.md").is_file(), r.text)
    h = c.get("/history", params={"id": "repo:docs/guide.md"}).json()["versions"]
    check("repo version kept in data folder", len(h) == 1 and h[0]["version"] == g["version"] and "content" not in h[0] and (DATA / "versions" / f"{quote('docs/guide.md', safe='')}.json").is_file(), h)
    v = c.get("/version", params={"id": "repo:docs/guide.md", "version": g["version"]}).json()
    check("version with content", v["content"] == g["content"], v)
    cur = c.get("/file", params={"id": "repo:docs/guide.md"}).json()
    r = c.post("/restore", json={"id": "repo:docs/guide.md", "version": g["version"], "if_version": cur["version"]})
    check("restore", r.status_code == 200 and (REPO / "docs/guide.md").read_text() == g["content"], r.text)
    h = c.get("/history", params={"id": "repo:docs/guide.md"}).json()["versions"]
    check("restore keeps what it replaced", h[0]["version"] == ver("# Guide\n\nv2\n") and len(h) == 2, h)
    r = c.get("/version", params={"id": "repo:docs/guide.md", "version": "nope"})
    check("unknown version = 404", r.status_code == 404, r.text)

    # ---- hub writes (axHub memory semantics) ----------------------------------------------------------------------
    hv = ver("# AXF rules\n\nShared: `_claude/shared/rules/RULES.md`.\n")
    r = c.put("/file", json={"id": "hub:amberx-axf/rules/RULES.md", "content": "# AXF rules v2\n", "if_version": hv})
    check("hub save", r.status_code == 200 and (HUB / "amberx-axf/_claude/rules/RULES.md").read_text() == "# AXF rules v2\n", r.text)
    meta = json.loads((HUB / ".axhub/claude/amberx-axf/meta.json").read_text())
    check("hub attribution in meta.json", meta.get("rules/RULES.md", {}).get("updatedBy") == "console:md-studio", meta)
    kept = json.loads((HUB / ".axhub/claude/amberx-axf/versions" / f"{quote('rules/RULES.md', safe='')}.json").read_text())
    check("hub version kept (hub format)", kept[0]["version"] == hv and kept[0]["reason"] == "write" and kept[0]["content"].startswith("# AXF rules"), kept)
    r = c.put("/file", json={"id": "hub:_shared/rules/RULES.md", "content": "# Shared v2\n", "if_version": ver("# Shared rules\n")})
    check("_shared state dir = shared", r.status_code == 200 and (HUB / ".axhub/claude/shared/meta.json").is_file(), r.text)
    r = c.get("/file", params={"id": "hub:amberx-axf/rules/RULES.md"})
    check("hub read shows attribution", r.json()["updatedBy"] == "console:md-studio", r.json())

    # ---- notes writes ---------------------------------------------------------------------------------------------
    n = c.get("/file", params={"id": "notes:plans/p.md"}).json()
    r = c.put("/file", json={"id": "notes:plans/p.md", "content": "# A plan v2\n", "if_version": n["version"]})
    check("note save through axf.notes@1", r.status_code == 200 and (HUB / "_shared/_claude/notes/plans/p.md").read_text() == "# A plan v2\n", r.text)
    r = c.put("/file", json={"id": "notes:plans/p.md", "content": "x", "if_version": n["version"]})
    check("note stale save = 409 (status kept)", r.status_code == 409, r.text)

    # ---- safety ---------------------------------------------------------------------------------------------------
    os.symlink(REPO / "docs", REPO / "linked")
    bad = ["repo:../etc/passwd.md", "repo:/etc/x.md", "repo:.hidden/x.md", "repo:docs/notes.txt", "repo:node_modules/x/README.md",
           "repo:linked/guide.md", "hub:../x/rules.md", "hub:_shared/notes/plans/p.md", "notes:a/b/c.md", "zip:x.md", "nocolon"]
    for b in bad:
        r = c.get("/file", params={"id": b})
        check(f"refused {b}", r.status_code in (400, 404), (r.status_code, r.text))
    r = c.put("/file", json={"id": "repo:docs/x.md", "content": 3})
    check("content must be text", r.status_code == 400, r.text)
    r = c.put("/file", json={"id": "repo:docs/big.md", "content": "x" * (512 * 1024 + 1)})
    check("size limit", r.status_code == 413, r.text)

    # ---- notes off ------------------------------------------------------------------------------------------------
    NOTES.on = False
    sc = {s["id"]: s for s in c.get("/files").json()["scopes"]}
    check("notes scope unavailable when the capability is off", not sc["notes"]["available"] and sc["notes"]["groups"] == [], sc["notes"])
    r = c.put("/file", json={"id": "notes:plans/p.md", "content": "x"})
    check("note write without the capability = 503", r.status_code == 503, r.text)
    NOTES.on = True

    # ---- hub not mounted ------------------------------------------------------------------------------------------
    mod.STORE.hub = TMP / "nohub"
    sc = {s["id"]: s for s in c.get("/files").json()["scopes"]}
    check("no hub: Claude scope falls back to the repo's copies", not sc["claude"]["hub"] and "repo:_claude/rules/RULES.md" in ids(sc["claude"]) and "repo:CLAUDE.md" in ids(sc["claude"]), sc["claude"])
finally:
    shutil.rmtree(TMP, ignore_errors=True)

print(f"\n{'all passed' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
