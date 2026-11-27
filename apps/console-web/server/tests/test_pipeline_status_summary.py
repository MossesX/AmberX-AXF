"""pipeline_status stays small and never touches a status file (Nov 25 2026).

The MCP tool `pipeline_status` and its REST twin `GET /api/pipeline-status` (mcp_server.py) answer from the builds
store through data_store.py. With many builds seeded (each one heavy: long detail, steps, notes), both answers stay
under a small byte cap, honour limit / offset, and no pipeline status file (the retired whole-document export
`orchestrator.json`) appears on disk afterwards.

    python apps/console-web/server/tests/test_pipeline_status_summary.py      (pytest picks up the test_* functions too)
"""
from __future__ import annotations

import asyncio
import json
import logging
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

HERE = Path(__file__).resolve().parent
SERVER = HERE.parent
ROOT = SERVER.parents[2]
sys.path.insert(0, str(SERVER))

# A scratch home for everything the server could write: the builds store, the console state, the data dirs.
TMP = Path(tempfile.mkdtemp(prefix="pipeline-status-summary-"))
STORE = TMP / "builds" / "store.json"
os.environ["AXF_BUILDS_STORE"] = str(STORE)
os.environ["AXF_STATE"] = str(TMP / "console" / "state.json")
os.environ["AXHUB_PROJECTS_DIR"] = str(TMP / "projects")
os.environ["AXF_DATA_DIR"] = str(TMP / "data")
os.environ.pop("AXF_TOKEN", None)

from starlette.applications import Starlette  # noqa: E402
from starlette.testclient import TestClient  # noqa: E402

import data_store  # noqa: E402
import mcp_server  # noqa: E402

STATUS_FILE = "orchestrator.json"
BYTE_CAP = 32_000          # the small cap both answers stay under, whatever the store holds
SEEDED = 600
STATUSES = ("pending",) * 6 + ("split", "queued", "building", "failed", "complete", "complete")


def _build(i: int) -> dict[str, Any]:
    status = STATUSES[i % len(STATUSES)]
    return {
        "id": f"seed-{i:04d}", "number": f"B-{i:04d}", "title": f"Seeded build {i} " + "t" * 60, "status": status,
        "profiles": ["all", "side"] if i % 5 == 0 else ["all"], "branch": f"claude/seed-{i:04d}", "pr": str(1000 + i),
        "createdAt": f"2026-11-{1 + i % 25:02d}T08:00:00.000Z", "updatedAt": f"2026-11-{1 + i % 25:02d}T09:{i % 60:02d}:00.000Z",
        "statusAt": f"2026-11-{1 + i % 25:02d}T09:{i % 60:02d}:{i % 60:02d}.000Z",
        "detail": "d" * 6000,
        "steps": [{"id": f"s{k}", "text": "step text " * 40, "model": "Opus", "status": "completed" if k < 3 else "ready", "done": k < 3} for k in range(1, 8)],
        "notes": [{"text": "note " * 80, "at": "2026-11-25T10:00:00.000Z"} for _ in range(6)],
        "origin": {"said": "s" * 2000, "brief": "b" * 4000},
    }


def _seed() -> list[dict[str, Any]]:
    builds = [_build(i) for i in range(SEEDED)]
    STORE.parent.mkdir(parents=True, exist_ok=True)
    STORE.write_text(json.dumps({"$axf": "builds@1", "rev": 7, "updatedAt": "2026-11-25T12:00:00.000Z", "builds": builds}), "utf-8")
    data_store.builds_clear()
    return builds


BUILDS = _seed()
SERVER_MCP = mcp_server.build_server(lambda op, **a: {}, terminal=lambda since: [], control=lambda c: {"ok": True, "text": ""})
REST = TestClient(Starlette(routes=[mcp_server.pipeline_status_route(lambda: "")]))
logging.getLogger("httpx").setLevel(logging.WARNING)  # the MCP server turns request logging on; keep the test output short


def _tool(**args: Any) -> tuple[dict[str, Any], int]:
    """Call the MCP tool; → (the answer, its size on the wire as JSON)."""
    out = asyncio.run(SERVER_MCP.call_tool("pipeline_status", args))
    doc = out[1] if isinstance(out, tuple) else getattr(out, "structured_content", None) or getattr(out, "structuredContent", None)
    if doc is None:  # an older SDK: content blocks only
        blocks = out if isinstance(out, list) else out.content
        doc = json.loads(blocks[0].text)
    if isinstance(doc, dict) and set(doc) == {"result"} and isinstance(doc["result"], dict):
        doc = doc["result"]
    return doc, len(json.dumps(doc, ensure_ascii=False).encode("utf-8"))


def _rest(**q: Any) -> tuple[dict[str, Any], int]:
    r = REST.get(mcp_server.PIPELINE_STATUS_PATH, params=q)
    assert r.status_code == 200, f"{r.status_code} {r.text[:200]}"
    return r.json(), len(r.content)


def _count(status: str, project: str = "") -> int:
    return sum(1 for b in BUILDS if b["status"] == status and (not project or project in b["profiles"]))


def _status_files() -> list[str]:
    roots = [TMP, ROOT / "_claude" / "builds", ROOT / "apps" / "console-web" / ".axf-console"]
    return sorted(str(p) for r in roots if r.is_dir() for p in r.rglob(STATUS_FILE))


def test_store_is_big() -> None:
    assert STORE.stat().st_size > 7_000_000, "the seeded store is bigger than the old 7 MB status file"
    assert len(BUILDS) == SEEDED


def test_summary_is_small_and_right() -> None:
    for name, (doc, size) in (("mcp", _tool()), ("rest", _rest())):
        assert doc["$axf"] == mcp_server.PIPELINE_STATUS_SCHEMA, name
        assert size < BYTE_CAP, f"{name}: {size} bytes"
        assert doc["total"] == SEEDED, name
        assert doc["counts"] == {s: _count(s) for s in sorted(set(STATUSES))}, name
        assert doc["active"] and doc["active"]["status"] == "building", name
        assert doc["activeCount"] == _count("building"), name
        assert doc["queue"]["total"] == _count("split") + _count("queued"), name
        assert 0 < len(doc["queue"]["head"]) <= mcp_server.PIPELINE_QUEUE_HEAD, name
        assert "rows" not in doc, f"{name}: no filter, no rows"
        text = json.dumps(doc)
        assert "dddddddd" not in text and "note note" not in text and "step text" not in text and "bbbbbbbb" not in text, f"{name}: no build bodies"


def test_mcp_and_rest_agree() -> None:
    for q in ({}, {"status": "pending", "limit": 7}, {"status": "failed,complete", "project": "side", "limit": 5, "offset": 5}):
        assert _tool(**q)[0] == _rest(**q)[0], q


def test_limit_and_offset() -> None:
    newest = sorted((b for b in BUILDS if b["status"] == "pending"), key=lambda b: b["statusAt"], reverse=True)
    for call in (_tool, _rest):
        p1, size1 = call(status="pending", limit=10)
        assert size1 < BYTE_CAP
        assert p1["matched"] == _count("pending") and p1["limit"] == 10 and p1["offset"] == 0 and p1["next"] == 10
        assert len(p1["rows"]) == 10 and all(r["status"] == "pending" for r in p1["rows"])
        assert [r["statusAt"] for r in p1["rows"]] == [b["statusAt"] for b in newest[:10]], "newest status change first"
        p2, _ = call(status="pending", limit=10, offset=10)
        assert p2["offset"] == 10 and p2["next"] == 20 and len(p2["rows"]) == 10
        assert not {r["id"] for r in p1["rows"]} & {r["id"] for r in p2["rows"]}, "page 2 repeats nothing of page 1"
        last, _ = call(status="pending", limit=10, offset=_count("pending") - 3)
        assert len(last["rows"]) == 3 and last["next"] is None, "the last page ends the walk"
        past, _ = call(status="pending", limit=10, offset=100_000)
        assert past["rows"] == [] and past["next"] is None and past["matched"] == _count("pending")


def test_walking_the_pages_sees_every_build_once() -> None:
    seen: list[str] = []
    offset: int | None = 0
    for _ in range(200):
        page, size = _rest(status="failed", limit=9, offset=offset)
        assert size < BYTE_CAP
        seen += [r["id"] for r in page["rows"]]
        offset = page["next"]
        if offset is None:
            break
    assert sorted(seen) == sorted(b["id"] for b in BUILDS if b["status"] == "failed") and len(seen) == len(set(seen))


def test_project_filter() -> None:
    for call in (_tool, _rest):
        doc, size = call(status="complete", project="side", limit=5)
        assert size < BYTE_CAP
        assert doc["project"] == "side" and doc["matched"] == _count("complete", "side") and len(doc["rows"]) == 5
        assert doc["total"] == sum(1 for b in BUILDS if "side" in b["profiles"]), "counts are the project's builds"
        assert doc["counts"].get("complete") == _count("complete", "side")
        none, _ = call(project="no-such-project")
        assert none["total"] == 0 and none["rows"] == [] and none["active"] is None


def test_the_biggest_ask_is_still_capped() -> None:
    for call in (_tool, _rest):
        doc, size = call(status=",".join(sorted(set(STATUSES))), limit=1_000_000)
        assert size < BYTE_CAP, f"{size} bytes"
        assert doc["limit"] == mcp_server.PIPELINE_ROWS_MAX and len(doc["rows"]) <= mcp_server.PIPELINE_ROWS_MAX
        assert doc["matched"] == SEEDED and doc["next"] == len(doc["rows"])
        for row in doc["rows"]:
            assert isinstance(row["steps"], dict) and not {"detail", "notes", "origin"} & set(row), "rows are small lines"


def test_rest_refuses_a_bad_page_and_a_missing_token() -> None:
    assert REST.get(mcp_server.PIPELINE_STATUS_PATH, params={"limit": "many"}).status_code == 400
    locked = TestClient(Starlette(routes=[mcp_server.pipeline_status_route(lambda: "secret")]))
    assert locked.get(mcp_server.PIPELINE_STATUS_PATH).status_code == 401
    r = locked.get(mcp_server.PIPELINE_STATUS_PATH, headers={"authorization": "Bearer secret"})
    assert r.status_code == 200 and len(r.content) < BYTE_CAP


def test_no_status_file_on_disk_afterwards() -> None:
    before = STORE.read_bytes()
    _tool(status="pending", limit=50)
    _rest(status="pending", limit=50)
    assert _status_files() == [], f"a pipeline status file appeared: {_status_files()}"
    assert STORE.read_bytes() == before, "reading the status never rewrites the store"
    assert data_store.is_status_file(ROOT / "_claude" / "builds" / STATUS_FILE) and data_store.key_for(ROOT / "_claude" / "builds" / STATUS_FILE) is None
    assert not data_store.exists(ROOT / "_claude" / "builds" / STATUS_FILE)


if __name__ == "__main__":
    tests = [(n, f) for n, f in sorted(globals().items()) if n.startswith("test_") and callable(f)]
    # the disk check runs last, after every read above
    tests.sort(key=lambda t: t[0] == "test_no_status_file_on_disk_afterwards")
    for name, fn in tests:
        fn()
        print(f"  ✓ {name}")
    print(f"test_pipeline_status_summary: {len(tests)} tests ok")
