"""hidden-assets@1, console REST half (server/hidden_assets.py): /api/hidden-assets, …/hide, …/unhide, …/unhide-all.

    python apps/console-web/server/tests/test_hidden_assets.py      (pytest picks up the test_* functions too)

Covers: the rules against the reference engine's fixture (framework/spec/fixtures/hidden-assets.json: kinds, targets,
refusal words, normalize, hide / unhide / unhide all, an old document; skipped while the fixture is not in the
checkout), the kinds read from the chrome kind list, the list route (an app with no document, the default app, a bad
app id), hide (kind + id and key, assetRef, by, already hidden, refused targets, no document, a broken document, the
size limit), unhide and unhide all (nothing to do = no write), every other field of the document kept as it was, the
file the skins CLI and the hub read (one compact line, stamped), the data-store modes (rollback = 423, unreachable =
503), auth on every route, and the mount in main.py.
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = SERVER.parents[2]
sys.path.insert(0, str(SERVER))

TMP = Path(tempfile.mkdtemp(prefix="axf-hidden-"))
os.environ["AXF_STATE"] = str(TMP / "console/state.json")
os.environ["AXHUB_PROJECTS_DIR"] = str(TMP / "projects")
for _k in ("AXF_LOOKS_DIR", "AXF_APPEARANCE_FILE"):
    os.environ.pop(_k, None)

from fastapi import FastAPI, HTTPException, Request  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

import data_store as ds  # noqa: E402
import hidden_assets as ha  # noqa: E402

FIXTURE = ROOT / "framework/spec/fixtures/hidden-assets.json"
LOOKS = TMP / "projects/_shared/_data/settings/looks"
KINDS = ["tab-group", "toolbar", "banner", "nav-menu", "app-menu", "widget"]
AT = "2026-11-17T14:50:00Z"


def _auth(request: Request) -> None:
    if request.headers.get("x-axf-token") != "t":
        raise HTTPException(401, "unauthorized")


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(ha.router_for(_auth))
    return TestClient(app, headers={"x-axf-token": "t"})


C = _client()


def look(app: str = "app", own: dict | None = None, **extra: Any) -> dict:
    return {"$axf": "app-look@1", "app": app, "default": {"slots": {"toolbar": "standard-icons"}}, "own": own if own is not None else {},
            "skin": {"use": False, "inherit": False, "id": "", "overrides": {}}, "scopes": {}, "undo": None, **extra}


def put(app: str, doc: Any) -> Path:
    LOOKS.mkdir(parents=True, exist_ok=True)
    f = LOOKS / f"{app}.json"
    f.write_text(doc if isinstance(doc, str) else json.dumps(doc) + "\n")
    return f


def stored(app: str) -> dict:
    return json.loads((LOOKS / f"{app}.json").read_text())


def fixture() -> dict | None:
    return json.loads(FIXTURE.read_text()) if FIXTURE.exists() else None


# ── the rules ─────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_kinds_come_from_the_chrome_kind_list() -> None:
    assert ha.kinds() == KINDS
    assert "context-menu" not in ha.kinds()  # no region on the page
    assert ha._chrome_kinds() == tuple(KINDS[:-1])  # parsed from chrome-settings-rules.mjs, not the fallback by luck
    src = (ROOT / "framework/core/engines/chrome-settings-rules.mjs").read_text()
    assert "export const CHROME_TYPES = [" in src and "export const CHROME_TARGETS = {" in src


def test_targets_and_refusals() -> None:
    assert ha.target("toolbar:main") == {"kind": "toolbar", "id": "main"}
    assert ha.target("tab-group:plugin:notes/tabs") == {"kind": "tab-group", "id": "plugin:notes/tabs"}
    assert ha.target({"kind": "widget", "id": "clock"}) == {"kind": "widget", "id": "clock"}
    assert ha.target_error("toolbar:main") is None
    listed = ", ".join(KINDS)
    for ref, err in [("grid:main", f'"grid" is not a kind that can be hidden ({listed})'), ("context-menu:main", f'"context-menu" is not a kind that can be hidden ({listed})'),
                     ("Toolbar:main", f'"Toolbar" is not a kind that can be hidden ({listed})'), (7, f'"" is not a kind that can be hidden ({listed})'),
                     (None, f'"" is not a kind that can be hidden ({listed})'), ("toolbar", '"" is not an instance id'),
                     ({"kind": "toolbar", "id": "Bad Id"}, '"Bad Id" is not an instance id'), ({"kind": "toolbar", "id": "main\n"}, '"main\n" is not an instance id')]:
        assert ha.target(ref) is None, ref
        assert ha.target_error(ref) == err, ref


def test_normalize_list() -> None:
    junk = [{"kind": "grid", "id": "x", "hiddenAt": AT, "by": "y"}, {"kind": "toolbar", "id": "Bad Id", "hiddenAt": AT, "by": "y"},
            {"kind": "toolbar", "id": "main", "hiddenAt": "yesterday", "by": 7, "assetRef": "Bad Ref", "extra": True},
            {"kind": "toolbar", "id": "main", "hiddenAt": AT, "by": "second"}, "toolbar:main", None]
    assert ha.normalize_list(junk) == [{"kind": "toolbar", "id": "main", "hiddenAt": "", "by": ""}]
    assert ha.normalize_list({"kind": "toolbar"}) == [] and ha.normalize_list(None) == []
    many = [{"kind": "toolbar", "id": f"t{i}", "hiddenAt": AT, "by": "x"} for i in range(ha.MAX + 3)]
    capped = ha.normalize_list(many)
    assert (len(capped), capped[0]["id"], capped[-1]["id"]) == (500, "t3", "t502")


def test_pure_functions() -> None:
    l0 = look()
    one = ha.hide(l0, {"kind": "toolbar", "id": "main"}, at=AT, by="axf-console", asset_ref="standard-icons")
    assert l0["own"] == {} and one is not l0
    assert ha.list_hidden(one) == [{"kind": "toolbar", "id": "main", "hiddenAt": AT, "by": "axf-console", "assetRef": "standard-icons"}]
    assert ha.hide(one, "toolbar:main", at="2026-11-18T00:00:00Z", by="later") is one  # the first hide stands
    assert ha.hide(one, "grid:main") is one and ha.unhide(one, "grid:main") is one and not ha.is_hidden(one, "grid:main")
    assert ha.unhide(one, "banner:top") is one and ha.unhide_all(l0) is l0
    two = ha.hide(one, "widget:clock", at=AT, by="plugin:clock")
    assert [e["id"] for e in ha.list_hidden(ha.unhide(two, "toolbar:main"))] == ["clock"]
    assert ha.unhide_all(two)["own"] == {} and FIELD_GONE(ha.unhide(one, "toolbar:main"))
    assert ha.list_hidden(None) == [] and ha.list_hidden({"own": []}) == [] and ha.list_hidden({"default": {"hiddenAssets": [{"kind": "toolbar", "id": "a"}]}}) == []


def FIELD_GONE(doc: dict) -> bool:
    return ha.FIELD not in doc["own"]


def test_matches_the_reference_engine_fixture() -> None:
    fx = fixture()
    if fx is None:
        print("  - fixture framework/spec/fixtures/hidden-assets.json not in this checkout: engine parity skipped")
        return
    assert (fx["contract"], fx["field"], fx["max"]) == (ha.CONTRACT, ha.FIELD, ha.MAX)
    assert fx["kinds"] == ha.kinds()
    t = fx["targets"]
    assert ha.target(t["key"]) == t["parsed"]
    for kind, want in t["everyKind"].items():
        assert ha.target(f"{kind}:main") == want
    for name, r in t["refused"].items():
        assert ha.target(r["ref"]) is None, name
        assert ha.target_error(r["ref"]) == r["error"], name
    three = fx["hide"]["three"]["doc"]
    assert ha.list_hidden(three) == fx["hide"]["three"]["list"] == fx["refused"]["list"]
    for name, r in t["refused"].items():
        assert ha.hide(three, r["ref"], at=AT, by="x") is three and ha.unhide(three, r["ref"]) is three and ha.is_hidden(three, r["ref"]) is False, name
    # the same calls the generator makes give the same documents
    l0 = fx["hide"]["empty"]["doc"]
    one = ha.hide(l0, {"kind": "toolbar", "id": "main"}, at=AT, by="axf-console", asset_ref="standard-icons")
    assert one == fx["hide"]["one"]["doc"]
    two = ha.hide(one, "tab-group:settings.tabs", at="2026-11-17T14:51:00Z", by="axf-console")
    mine = ha.hide(two, {"kind": "widget", "id": "clock"}, at="2026-11-17T14:52:00Z", by="plugin:clock")
    assert mine == three
    assert ha.unhide(mine, "toolbar:main") == fx["unhide"]["doc"]
    assert ha.unhide_all(mine) == fx["unhideAll"]["doc"]
    m = fx["migration"]
    assert ha.list_hidden(m["old"]) == [] and ha.unhide_all(m["old"]) is m["old"]
    hidden = ha.hide(m["normalized"], "banner:top", at=AT, by="app")
    assert hidden == m["hidden"]["doc"] and ha.unhide(hidden, "banner:top") == m["shownAgain"]


# ── the routes ────────────────────────────────────────────────────────────────────────────────────────────────────────

def test_list() -> None:
    r = C.get("/api/hidden-assets", params={"app": "nobody"})
    assert r.status_code == 200
    assert r.json() == {"ok": True, "contract": "hidden-assets@1", "app": "nobody", "document": False, "hidden": [], "count": 0, "kinds": KINDS}
    put("lister", look("lister", {"slots": {"button": "terminal"}, "hiddenAssets": [{"kind": "banner", "id": "top", "hiddenAt": AT, "by": "x"}, {"kind": "grid", "id": "x"}]}))
    j = C.get("/api/hidden-assets?app=lister").json()
    assert j["document"] is True and j["count"] == 1 and j["hidden"] == [{"kind": "banner", "id": "top", "hiddenAt": AT, "by": "x"}]
    # an old document (no list) reads as nothing hidden; no app = the console's own
    put("axf-console", look("axf-console", {"slots": {"button": "terminal"}}))
    j = C.get("/api/hidden-assets").json()
    assert j["app"] == ha.default_app() == "axf-console" and j["hidden"] == [] and j["document"] is True
    r = C.get("/api/hidden-assets", params={"app": "../etc"})
    assert r.status_code == 400 and r.json()["code"] == "bad-app" and r.json()["ok"] is False


def test_hide_unhide_round_trip() -> None:
    before = look("round", {"slots": {"button": "terminal"}, "hidden": {"toolbar": False}}, backups=[{"at": AT, "own": {}}], migratedTo="default", futureField={"kept": True})
    f = put("round", before)
    r = C.post("/api/hidden-assets/hide", json={"app": "round", "kind": "toolbar", "id": "builds", "assetRef": "toolbar-compact", "by": "mcp:amber"})
    j = r.json()
    assert r.status_code == 200 and j["ok"] and j["changed"] is True and j["count"] == 1
    e = j["entry"]
    assert (e["kind"], e["id"], e["assetRef"], e["by"]) == ("toolbar", "builds", "toolbar-compact", "mcp:amber") and ha.ISO.fullmatch(e["hiddenAt"])
    doc = stored("round")
    assert doc["own"] == {"slots": {"button": "terminal"}, "hidden": {"toolbar": False}, "hiddenAssets": [e]}
    assert doc["updatedBy"] == "mcp:amber" and ha.ISO.fullmatch(doc["updatedAt"])
    for k, v in before.items():  # every other field as it was, unknown ones too
        if k != "own":
            assert doc[k] == v, k
    raw = f.read_text()
    assert raw.endswith("}\n") and raw.count("\n") == 1 and ": " not in raw.split('"hiddenAssets"')[0]  # one compact line, as the app saves it

    # the key form, the caller header, a second piece
    j = C.post("/api/hidden-assets/hide", json={"app": "round", "key": "tab-group:plugin:notes/tabs"}, headers={"x-axf-by": "axf-cli"}).json()
    assert j["changed"] and j["entry"]["by"] == "axf-cli" and "assetRef" not in j["entry"] and [x["kind"] for x in j["hidden"]] == ["toolbar", "tab-group"]

    # hiding what is hidden: fine, nothing written, the first entry stands
    stamp = stored("round")["updatedAt"]
    mtime = f.stat().st_mtime_ns
    j = C.post("/api/hidden-assets/hide", json={"app": "round", "kind": "toolbar", "id": "builds", "by": "someone-else"}).json()
    assert j["ok"] and j["changed"] is False and j["entry"] == e and j["count"] == 2
    assert stored("round")["updatedAt"] == stamp and f.stat().st_mtime_ns == mtime

    assert C.get("/api/hidden-assets?app=round").json()["hidden"] == j["hidden"]

    j = C.post("/api/hidden-assets/unhide", json={"app": "round", "kind": "toolbar", "id": "builds"}).json()
    assert j["ok"] and j["changed"] is True and j["count"] == 1 and j["target"] == {"kind": "toolbar", "id": "builds"} and j["hidden"][0]["kind"] == "tab-group"
    mtime = f.stat().st_mtime_ns
    j = C.post("/api/hidden-assets/unhide", json={"app": "round", "key": "toolbar:builds"}).json()
    assert j["ok"] and j["changed"] is False and f.stat().st_mtime_ns == mtime

    # the last one out drops the field: the own part is what it was before anything was hidden
    j = C.post("/api/hidden-assets/unhide", json={"app": "round", "key": "tab-group:plugin:notes/tabs"}).json()
    assert j["changed"] and j["count"] == 0 and stored("round")["own"] == before["own"]


def test_unhide_all() -> None:
    f = put("all", look("all", {"settings": {"axf.banners.group": "a"}, "hiddenAssets": [{"kind": "banner", "id": "top", "hiddenAt": AT, "by": "x"}, {"kind": "widget", "id": "clock", "hiddenAt": AT, "by": "plugin:clock"}]}))
    j = C.post("/api/hidden-assets/unhide-all", json={"app": "all"}).json()
    assert j["ok"] and j["changed"] is True and j["count"] == 0 and j["hidden"] == [] and [x["id"] for x in j["shown"]] == ["top", "clock"]
    assert stored("all")["own"] == {"settings": {"axf.banners.group": "a"}} and stored("all")["updatedBy"] == "console-rest"
    mtime = f.stat().st_mtime_ns
    j = C.post("/api/hidden-assets/unhide-all", json={"app": "all"}).json()
    assert j["ok"] and j["changed"] is False and j["shown"] == [] and f.stat().st_mtime_ns == mtime
    # no body at all = the console's own app; an app with no document has nothing to show again
    put("axf-console", look("axf-console", {"hiddenAssets": [{"kind": "nav-menu", "id": "app", "hiddenAt": AT, "by": "x"}]}))
    j = C.post("/api/hidden-assets/unhide-all").json()
    assert j["app"] == "axf-console" and j["changed"] and stored("axf-console")["own"] == {}
    j = C.post("/api/hidden-assets/unhide-all", json={"app": "never-ran"}).json()
    assert j["ok"] and j["changed"] is False and j["document"] is False and not (LOOKS / "never-ran.json").exists()
    j = C.post("/api/hidden-assets/unhide", json={"app": "never-ran", "key": "toolbar:app"}).json()
    assert j["ok"] and j["changed"] is False and not (LOOKS / "never-ran.json").exists()


def test_refusals() -> None:
    f = put("strict", look("strict"))
    raw = f.read_text()
    for body, words in [({"kind": "grid", "id": "main"}, '"grid" is not a kind that can be hidden'), ({"kind": "context-menu", "id": "main"}, '"context-menu" is not a kind'),
                        ({"kind": "toolbar"}, '"" is not an instance id'), ({"kind": "toolbar", "id": "Bad Id"}, '"Bad Id" is not an instance id'),
                        ({"key": "Toolbar:main"}, '"Toolbar" is not a kind'), ({}, '"" is not a kind'), ({"kind": 7, "id": ["x"]}, '"" is not a kind')]:
        for route in ("hide", "unhide"):
            r = C.post(f"/api/hidden-assets/{route}", json={"app": "strict", **body})
            assert r.status_code == 400 and r.json()["code"] == "bad-target" and words in r.json()["error"], (route, body)
    r = C.post("/api/hidden-assets/hide", json={"app": "strict", "key": "toolbar:main", "assetRef": "Bad Ref"})
    assert r.status_code == 400 and r.json()["code"] == "bad-target"
    r = C.post("/api/hidden-assets/hide", content=b"not json", headers={"content-type": "application/json"})
    assert r.status_code == 400 and r.json()["code"] == "bad-target"
    for route in ("hide", "unhide", "unhide-all"):
        r = C.post(f"/api/hidden-assets/{route}", json={"app": "Bad App", "key": "toolbar:main"})
        assert r.status_code == 400 and r.json()["code"] == "bad-app", route
    assert f.read_text() == raw

    # no document: the app makes it (with its default snapshot) on its first run, so a hide has nowhere to go
    r = C.post("/api/hidden-assets/hide", json={"app": "never-ran", "key": "toolbar:main"})
    assert r.status_code == 409 and r.json()["code"] == "no-document" and not (LOOKS / "never-ran.json").exists()

    # a file that is not a look document is left alone
    for name, text in [("broken", "{not json"), ("other", json.dumps({"$axf": "appearance@1"})), ("listy", "[]")]:
        bf = put(name, text)
        for call in (lambda: C.get(f"/api/hidden-assets?app={name}"), lambda: C.post("/api/hidden-assets/hide", json={"app": name, "key": "toolbar:main"}),
                     lambda: C.post("/api/hidden-assets/unhide-all", json={"app": name})):
            r = call()
            assert r.status_code == 409 and r.json()["code"] == "bad-document", name
        assert bf.read_text() == text

    # a caller name that is not one is not written down
    j = C.post("/api/hidden-assets/hide", json={"app": "strict", "key": "banner:top", "by": "<script>"}).json()
    assert j["changed"] and j["entry"]["by"] == "console-rest"


def test_size_limit() -> None:
    pad = {f"axf.pad.{i}": "x" * 100 for i in range(530)}
    f = put("big", look("big", {"settings": pad}))
    raw = f.read_text()
    assert ha.APP_LOOK_MAX_BYTES - 4000 < len(raw) < ha.APP_LOOK_MAX_BYTES, len(raw)
    codes = [C.post("/api/hidden-assets/hide", json={"app": "big", "kind": "toolbar", "id": f"toolbar-with-a-long-instance-id-{i}", "by": "size-test"}).status_code for i in range(60)]
    assert codes[0] == 200 and codes[-1] == 413 and sorted(codes) == codes  # fine until the limit, refused from there on
    assert len(f.read_text()) <= ha.APP_LOOK_MAX_BYTES
    n = C.get("/api/hidden-assets?app=big").json()["count"]
    assert n == codes.count(200)
    # showing things again always fits
    assert C.post("/api/hidden-assets/unhide-all", json={"app": "big"}).json()["changed"] is True


def test_file_mode_is_kept() -> None:
    f = put("moded", look("moded"))
    f.chmod(0o664)
    assert C.post("/api/hidden-assets/hide", json={"app": "moded", "key": "toolbar:app"}).json()["changed"]
    assert f.stat().st_mode & 0o777 == 0o664
    assert not [p for p in LOOKS.iterdir() if p.name.startswith("moded") and p.name != "moded.json"]  # no temp file left behind


def test_looks_dir() -> None:
    assert ha.look_file("x") == LOOKS / "x.json"
    assert ds.key_for(ha.look_file("x")) == "settings/looks/x.json"  # the settings namespace: the file follows its data-store mode
    try:
        os.environ["AXF_APPEARANCE_FILE"] = "/somewhere/settings/appearance.json"
        assert ha.looks_dir() == Path("/somewhere/settings/looks")
        os.environ["AXF_LOOKS_DIR"] = "/elsewhere/looks"
        assert ha.looks_dir() == Path("/elsewhere/looks")
    finally:
        os.environ.pop("AXF_APPEARANCE_FILE", None)
        os.environ.pop("AXF_LOOKS_DIR", None)


def test_data_store_modes() -> None:
    put("moving", look("moving", {"hiddenAssets": [{"kind": "banner", "id": "top", "hiddenAt": AT, "by": "x"}]}))
    real_write, real_read = ds.write_text, ds.read_bytes

    def rolling(*_a: Any, **_k: Any) -> Any:
        raise ds.DataStoreError("read_only", "settings is rolling back: writes wait until it is local again", 423)

    def down(*_a: Any, **_k: Any) -> Any:
        raise ds.DataStoreError("unavailable", "axf-data unreachable")

    try:
        ds.write_text = rolling  # type: ignore[assignment]
        r = C.post("/api/hidden-assets/hide", json={"app": "moving", "key": "toolbar:app"})
        assert r.status_code == 423 and r.json()["code"] == "read-only"
        assert C.get("/api/hidden-assets?app=moving").json()["count"] == 1  # reads still answer
        ds.write_text = down  # type: ignore[assignment]
        r = C.post("/api/hidden-assets/unhide-all", json={"app": "moving"})
        assert r.status_code == 503 and r.json()["code"] == "unavailable"
        ds.read_bytes = down  # type: ignore[assignment]
        r = C.get("/api/hidden-assets?app=moving")
        assert r.status_code == 503 and r.json()["code"] == "unavailable"
    finally:
        ds.write_text, ds.read_bytes = real_write, real_read  # type: ignore[assignment]
    assert [e["id"] for e in stored("moving")["own"]["hiddenAssets"]] == ["top"]


def test_auth_on_every_route() -> None:
    put("guarded", look("guarded"))
    bare = TestClient(C.app)
    assert bare.get("/api/hidden-assets?app=guarded").status_code == 401
    for route in ("hide", "unhide", "unhide-all"):
        assert bare.post(f"/api/hidden-assets/{route}", json={"app": "guarded", "key": "toolbar:app"}).status_code == 401, route
    assert stored("guarded")["own"] == {}


def test_mounted_in_main() -> None:
    src = (SERVER / "main.py").read_text()
    assert '__import__("hidden_assets").router_for(auth)' in src
    paths = {(m, p) for p, ops in C.app.openapi()["paths"].items() for m in ops}
    assert {("get", "/api/hidden-assets"), ("post", "/api/hidden-assets/hide"), ("post", "/api/hidden-assets/unhide"), ("post", "/api/hidden-assets/unhide-all")} <= paths


if __name__ == "__main__":
    fails = 0
    for name, fn in sorted((n, f) for n, f in globals().items() if n.startswith("test_") and callable(f)):
        try:
            fn()
            print(f"  ✓ {name}")
        except Exception as e:  # noqa: BLE001 - report every failing check, then exit non-zero
            fails += 1
            print(f"  ✗ {name}: {type(e).__name__}: {e}")
    print(f"\n{'FAILED: ' + str(fails) if fails else 'hidden assets REST: all checks passed'}")
    sys.exit(1 if fails else 0)
