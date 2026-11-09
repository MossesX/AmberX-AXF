#!/usr/bin/env python3
"""Self-test for the Shipped features server part: reads the SQLite ledger the Node side writes (feature-ledger@1).

    python3 apps/console-web/plugins/shipped-features/test.py
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
DATA = Path(tempfile.mkdtemp(prefix="axf-shipped-test-"))
os.environ["AXF_SHIPPED_FEATURES_DIR"] = str(DATA)
# manifest writes go to a scratch builds store with no git, no hooks, no live publish (framework/cli/shipped.mjs)
os.environ.update({"AXF_BUILDS_STORE": str(DATA / "store.json"), "AXF_SHIPPED_GIT": "off", "AXF_SHIPPED_UI_REVIEW": "off", "AXF_BUILDS_LIVE": "0", "AXF_HEADLESS_DIR": str(DATA), "AXF_PIPELINE_WORKTREES": str(DATA)})
SEED = r"""
const D = await import(process.argv[1]);
const db = D.openDb();
const f = D.putFeature(db, { name: 'Status chips', plugin: 'shipped-features', status: 'planned', plannedAt: '2026-11-04T21:35:00Z', prompts: [{ id: 'p-sf-0' }] });
D.putPrompt(db, { build: 'sf', said: 'Put every feature in the list the moment it is planned.', verbatim: true });
D.putEdit(db, { feature: f.id, summary: 'Stalled tone', build: 'sf-fix', status: 'building', at: '2026-11-05T00:00:00Z' });
const { applyManifest } = await import(process.argv[2]);
applyManifest(db, { build: { id: 'veto', title: 'Veto notice alarm too loud', profile: 'all' }, said: { text: 'I received the alarm, so it is still stopping.', verbatim: true }, pr: { number: 397 }, landedCommit: '661901740ba21f97', mergedAt: '2026-11-09T00:06:38Z', files: ['apps/console-web/plugins/approvals-banner/web/index.tsx'], tests: [{ name: 'banner 18 checks', result: 'pass' }] });
"""
subprocess.run(["node", "--input-type=module", "-e", SEED, str(HERE / "ledger" / "db.mjs"), str(HERE / "ledger" / "manifest.mjs")], check=True, env=os.environ)

sys.modules.setdefault("axf_console_plugins", types.ModuleType("axf_console_plugins")).__path__ = []
spec = importlib.util.spec_from_file_location("axf_console_plugins.shipped_features_test", HERE / "server" / "__init__.py", submodule_search_locations=[str(HERE / "server")])
mod = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = mod
spec.loader.exec_module(mod)
mod._state["syncAt"] = 1e18  # no background sync in the test
mod._after_write = lambda: None  # nor after a write

from fastapi import FastAPI  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402

app = FastAPI()
app.include_router(mod.router, prefix="/api/plugins/shipped-features")
c = TestClient(app)
n = 0


def ok(cond: bool, what: str) -> None:
    global n
    if not cond:
        print(f"✗ {what}")
        sys.exit(1)
    n += 1


r = c.get("/api/plugins/shipped-features/ledger").json()
ok(r["$axf"] == "feature-ledger@1" and len(r["features"]) == 2 and len(r["edits"]) == 1, "ledger: every table, as the contract's records")
ok(r["meta"]["schema"] >= 3 and r["meta"]["counts"]["prompts"] == 2, "ledger meta: schema version and counts (his words for sf and veto)")
f = next(x for x in r["features"] if x["name"] == "Status chips")
ok(f["beingEdited"] is True and f["editCount"] == 1, "feature carries its edit fields")
d = c.get(f"/api/plugins/shipped-features/feature/{f['id']}").json()
ok(d["edits"][0]["summary"] == "Stalled tone" and d["prompts"][0]["said"].startswith("Put every feature"), "feature detail: edits + his words")
ok(len(d["history"]) >= 1 and d["history"][0]["doc"]["editCount"] == 0, "feature detail: the original version is kept")
ok(c.get("/api/plugins/shipped-features/feature/BAD!").status_code == 400, "bad id refused")
ok(c.get("/api/plugins/shipped-features/feature/f-nope").status_code == 404, "unknown id is 404")
csv = c.get("/api/plugins/shipped-features/export", params={"kind": "csv", "view": json.dumps({"hideCancelled": True})})
ok(csv.status_code == 200 and "Status chips" in csv.text, "export csv")
ok(c.get("/api/plugins/shipped-features/export", params={"kind": "pdf"}).status_code == 400, "export kind checked")
sm = c.get("/api/plugins/shipped-features/summary").json()
ok(sm["ready"] and sm["beingEdited"] == 1 and sm["statuses"].get("planned") == 1 and sm["active"] == 1, "summary: counts for the menu badge")

# shipped-manifest@1: read, list, search, write through the builds store
base = "/api/plugins/shipped-features"
ms = c.get(f"{base}/manifests").json()
ok(ms["count"] == 1 and ms["manifests"][0]["build"] == "veto" and ms["manifests"][0]["pr"] == 397, "manifests: one line per landed build")
ok(c.get(f"{base}/manifests", params={"q": "nothing like this"}).json()["count"] == 0, "manifests: q filters on the full text")
m = c.get(f"{base}/manifest/veto").json()
ok(m["from"] == "ledger" and m["manifest"]["said"]["text"].startswith("I received the alarm") and m["manifest"]["landedCommit"] == "661901740ba21f97", "manifest: the full record, his words first")
ok(c.get(f"{base}/manifest/BAD!").status_code == 400 and c.get(f"{base}/manifest/nope").status_code == 404, "manifest: bad id 400, unknown 404")
vf = next(x for x in r["features"] if x["name"] == "Veto notice alarm too loud")
ok(vf["status"] == "merged" and vf["mergeCommit"] == "661901740ba21f97", "a build with no planned feature gets one from its manifest, merged")
vd = c.get(f"{base}/feature/{vf['id']}").json()
ok(len(vd["manifests"]) == 1 and vd["manifests"][0]["build"]["id"] == "veto", "feature detail carries the manifest of its build")
sr = c.get(f"{base}/search", params={"q": "alarm"}).json()
ok(any(x["name"] == "Veto notice alarm too loud" for x in sr["features"]) and sr["manifests"][0]["build"] == "veto", "search: features by his words, manifests by text")
ok(c.get(f"{base}/search").status_code == 400, "search needs q")
w = c.post(f"{base}/manifest", json={"build": {"id": "direct-launch", "title": "Started outside the store"}, "said": {"text": "Make it work.", "verbatim": True}, "landedCommit": "abcdef1234", "by": "test"})
ok(w.status_code == 200 and w.json()["created"] is True and w.json()["manifest"]["source"] == "api", f"POST /manifest: a build the store never had is created from its manifest ({w.text[:200]})")
ok((DATA / "store.shipped" / "direct-launch.json").is_file(), "the manifest is the sidecar next to the store")
bad = c.post(f"{base}/manifest", json={"build": {"id": "direct-launch"}, "said": {"text": "x", "verbatim": "yes"}})
ok(bad.status_code == 400 and "said.verbatim" in bad.json()["detail"], "a bad field is refused by name")
ok(c.post(f"{base}/manifest", json={"said": "x"}).status_code == 400, "POST /manifest needs build.id")
lk = c.post(f"{base}/link", json={"build": "direct-launch", "pr": "#401"})
ok(lk.status_code == 200 and lk.json()["build"]["pr"] == "#401", f"link: PR recorded through the builds store ({lk.text[:200]})")
ok(c.post(f"{base}/link", json={"build": "direct-launch"}).status_code == 400, "link needs branch, pr or mergedAt")
bf = c.post(f"{base}/backfill", json={"since": "2000-01-01", "dry": True})
ok(bf.status_code == 200 and bf.json()["dry"] is True and bf.json()["found"] == 0, f"backfill dry: nothing landed without a manifest ({bf.text[:200]})")
ok(c.post(f"{base}/backfill", json={}).status_code == 400, "backfill needs since")
print(f"shipped-features server: {n} checks passed")
