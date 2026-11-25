"""Route tests for the Claude link REST API (routes.py): snapshot filters, state, clear, and the SSE stream.

    python3 apps/console-web/plugins/console-terminal/server/test_claude_link_routes.py

Runs on its own (a temp dataDir, no console server) and from the plugin's test.py.
"""
from __future__ import annotations

import asyncio
import importlib.util
import json
import sys
import tempfile
import types
import unittest
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

HERE = Path(__file__).resolve().parent
PKG = "axf_claude_link_routes_test"


def _load(name: str):
    spec = importlib.util.spec_from_file_location(f"{PKG}.{name}", HERE / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = mod
    spec.loader.exec_module(mod)
    return mod


pkg = types.ModuleType(PKG)
pkg.__path__ = [str(HERE)]
sys.modules[PKG] = pkg
cl = _load("claude_link")
routes = _load("routes")

BASE = "/api/plugins/console-terminal/claude-link"


def frames(body: str) -> list[dict[str, str]]:
    """An SSE body as its frames: {id, event, data, retry, comment}."""
    out = []
    for block in body.split("\n\n"):
        f: dict[str, str] = {}
        for ln in block.splitlines():
            if ln.startswith(":"):
                f["comment"] = ln[1:].strip()
            elif ": " in ln:
                k, v = ln.split(": ", 1)
                f[k] = v
        if f:
            out.append(f)
    return out


class Case(unittest.TestCase):
    def setUp(self) -> None:
        self.dir = Path(tempfile.mkdtemp(prefix="axf-claude-link-routes-"))
        self.bus = cl.Bus(100, folder=lambda: self.dir, spool=lambda: self.dir / "spool.jsonl")
        app = FastAPI()
        app.include_router(routes.build(lambda: self.bus), prefix="/api/plugins/console-terminal")
        self.c = TestClient(app)

    def add(self, *kinds: str, **kw: str) -> None:
        for k in kinds:
            self.bus.append({"kind": k, "source": "test", "summary": f"{k} thing", **kw})

    def ids(self, **params) -> list[int]:
        r = self.c.get(BASE, params=params)
        self.assertEqual(r.status_code, 200, r.text)
        return [e["id"] for e in r.json()["items"]]


class Snapshot(Case):
    def test_empty(self) -> None:
        r = self.c.get(BASE).json()
        self.assertEqual((r["items"], r["more"], r["seq"], r["clearedAt"]), ([], False, 0, 0))

    def test_shape_and_order(self) -> None:
        self.add("launch", "mcp", "exit")
        r = self.c.get(BASE).json()
        self.assertEqual([e["id"] for e in r["items"]], [1, 2, 3])  # oldest first
        self.assertEqual(r["seq"], 3)
        e = r["items"][0]
        self.assertEqual(e["$axf"], "claude-link-event@1")
        for k in ("ts", "kind", "source", "session", "account", "model", "summary", "detail", "level"):
            self.assertIn(k, e)

    def test_since(self) -> None:
        self.add("launch", "mcp", "exit")
        self.assertEqual(self.ids(since=1), [2, 3])
        self.assertEqual(self.ids(since=3), [])
        self.assertEqual(self.ids(since=-5), [1, 2, 3])
        self.assertEqual(self.c.get(BASE, params={"since": "soon"}).status_code, 422)

    def test_kind(self) -> None:
        self.add("launch", "mcp", "mcp", "error")
        self.assertEqual(self.ids(kind="mcp"), [2, 3])
        self.assertEqual(self.ids(kind="mcp, error"), [2, 3, 4])
        self.assertEqual(self.ids(kind=""), [1, 2, 3, 4])
        r = self.c.get(BASE, params={"kind": "mcp,bogus"})
        self.assertEqual(r.status_code, 400)
        self.assertIn("launch", r.json()["detail"])

    def test_q(self) -> None:
        self.add("launch", account="hulu0241", model="opus")
        self.bus.append({"kind": "axhub", "source": "axhub-client", "summary": "vps.run held", "detail": {"tool": "call"}})
        self.assertEqual(self.ids(q="HULU"), [1])  # case-insensitive, any field
        self.assertEqual(self.ids(q="tool call"), [2])  # every word, detail included
        self.assertEqual(self.ids(q="nothing-like-it"), [])

    def test_limit(self) -> None:
        self.add(*["mcp"] * 5)
        r = self.c.get(BASE, params={"limit": 2}).json()
        self.assertEqual([e["id"] for e in r["items"]], [4, 5])  # the newest, still oldest first
        self.assertTrue(r["more"])
        self.assertEqual(self.ids(limit=0), [5])  # clamped to 1
        self.assertEqual(len(self.ids(limit=10**9)), 5)

    def test_filters_together(self) -> None:
        self.add("mcp", "launch", "mcp", "mcp", "error")
        self.assertEqual(self.ids(since=1, kind="mcp", q="thing", limit=1), [4])

    def test_secrets_never_leave(self) -> None:
        self.bus.append({"kind": "axhub", "summary": "call with Bearer abcdefghijklmnopqrs", "detail": {"args": {"password": "hunter22"}}})
        for body in (self.c.get(BASE).text, self.c.get(BASE + "/state").text, self.c.get(BASE + "/stream", params={"once": 1}).text):
            self.assertNotIn("abcdefghijklmnopqrs", body)
            self.assertNotIn("hunter22", body)


class StateAndClear(Case):
    def test_state_empty(self) -> None:
        st = self.c.get(BASE + "/state").json()
        self.assertEqual(st["$axf"], "claude-link-state@1")
        self.assertIsNone(st["connected"])
        self.assertIsNone(st["last"])
        self.assertEqual(st["counts"], {k: 0 for k in cl.KINDS})

    def test_state(self) -> None:
        self.add("connect", "mcp", "mcp")
        st = self.c.get(BASE + "/state").json()
        self.assertTrue(st["connected"])
        self.assertEqual((st["counts"]["mcp"], st["counts"]["connect"], st["counts"]["error"]), (2, 1, 0))
        self.assertEqual((st["last"]["id"], st["last"]["kind"], st["seq"]), (3, "mcp", 3))
        self.bus.append({"kind": "disconnect", "summary": "timed out"})
        st = self.c.get(BASE + "/state").json()
        self.assertFalse(st["connected"])
        self.assertEqual(st["why"], "timed out")

    def test_clear_moves_the_marker_not_the_log(self) -> None:
        self.add("connect", "mcp", "mcp")
        r = self.c.post(BASE + "/clear").json()
        self.assertEqual((r["ok"], r["clearedAt"]), (True, 3))
        self.assertEqual(self.ids(), [])
        self.assertEqual(self.ids(all=1), [1, 2, 3])  # the log is kept
        self.assertEqual(len((self.dir / "claude-link" / "events.jsonl").read_text().splitlines()), 3)
        st = self.c.get(BASE + "/state").json()
        self.assertEqual((st["counts"]["mcp"], st["clearedAt"], st["last"]["id"]), (0, 3, 3))
        self.assertTrue(st["connected"])  # clearing the view doesn't forget the link
        self.add("exit")
        self.assertEqual(self.ids(), [4])
        self.assertEqual(self.c.post(BASE + "/clear").json()["clearedAt"], 4)  # again is fine
        self.assertEqual(self.c.get(BASE + "/clear").status_code, 405)

    def test_clear_survives_a_restart(self) -> None:
        self.add("mcp", "mcp")
        self.c.post(BASE + "/clear")
        self.bus = cl.Bus(100, folder=lambda: self.dir, spool=lambda: self.dir / "spool.jsonl")
        self.assertEqual(self.c.get(BASE).json()["clearedAt"], 2)
        self.assertEqual(self.ids(all=1), [1, 2])


class Stream(Case):
    def once(self, headers: dict[str, str] | None = None, **params) -> list[dict[str, str]]:
        r = self.c.get(BASE + "/stream", params={"once": 1, **params}, headers=headers or {})
        self.assertEqual(r.status_code, 200, r.text)
        self.assertTrue(r.headers["content-type"].startswith("text/event-stream"))
        self.assertEqual(r.headers["cache-control"], "no-store")
        self.assertEqual(r.headers["x-accel-buffering"], "no")
        return frames(r.text)

    def link_ids(self, fs: list[dict[str, str]]) -> list[int]:
        return [int(f["id"]) for f in fs if f.get("event") == "link"]

    def test_hello_then_backlog(self) -> None:
        self.add("connect", "mcp", "exit")
        fs = self.once()
        self.assertEqual(fs[0]["event"], "hello")
        self.assertEqual(fs[0]["retry"], str(routes.RETRY_MS))
        hello = json.loads(fs[0]["data"])
        self.assertEqual((hello["connected"], hello["seq"]), (True, 3))
        self.assertEqual(self.link_ids(fs), [1, 2, 3])
        self.assertEqual(json.loads(fs[2]["data"])["kind"], "mcp")

    def test_filters(self) -> None:
        self.add("launch", "mcp", "mcp", "error")
        self.assertEqual(self.link_ids(self.once(kind="mcp,error")), [2, 3, 4])
        self.assertEqual(self.link_ids(self.once(q="launch")), [1])
        self.assertEqual(self.link_ids(self.once(since=3)), [4])
        self.assertEqual(self.c.get(BASE + "/stream", params={"kind": "bogus"}).status_code, 400)

    def test_resume_from_last_event_id(self) -> None:
        self.add("launch", "mcp", "exit")
        self.assertEqual(self.link_ids(self.once({"Last-Event-ID": "2"})), [3])
        self.assertEqual(self.link_ids(self.once({"Last-Event-ID": "2"}, since=0)), [3])  # the header wins over since
        self.assertEqual(self.link_ids(self.once({"Last-Event-ID": "3"})), [])
        self.assertEqual(self.link_ids(self.once({"Last-Event-ID": "junk"}, since=1)), [2, 3])

    def test_view_marker(self) -> None:
        self.add("launch", "mcp", "exit")
        self.c.post(BASE + "/clear")
        self.add("mcp")
        self.assertEqual(self.link_ids(self.once()), [4])  # a fresh stream starts after the marker
        self.assertEqual(self.link_ids(self.once({"Last-Event-ID": "1"})), [2, 3, 4])  # a resume gets what it missed

    def run_sse(self, steps, **kw) -> list[str]:
        async def run() -> list[str]:
            gen = routes.sse(self.bus, kw.pop("last", 0), kw.pop("kinds", []), kw.pop("q", ""), heartbeat=0.05, **kw)
            out = [await gen.__anext__()]  # hello
            for step in steps:
                if step:
                    step()
                out.append(await asyncio.wait_for(gen.__anext__(), timeout=5))
            await gen.aclose()
            return out
        return asyncio.run(run())

    def test_live_and_heartbeat(self) -> None:
        out = self.run_sse([None, lambda: self.bus.append({"kind": "axhub", "summary": "live one"}), None])
        self.assertIn("event: hello", out[0])
        self.assertEqual(out[1], ": ping\n\n")  # quiet: a heartbeat comment
        self.assertTrue(out[2].startswith("id: 1\nevent: link\ndata: "))
        self.assertIn("live one", out[2])
        self.assertEqual(out[3], ": ping\n\n")
        self.assertEqual(self.bus.state()["subscribers"], 0)  # closing the stream unsubscribes

    def test_live_filter_and_no_duplicates(self) -> None:
        self.add("mcp")

        def burst() -> None:
            self.add("launch", "error")
        out = self.run_sse([None, burst], kinds=["mcp", "error"])
        self.assertIn("id: 1\n", out[1])  # the backlog line, once
        self.assertIn("id: 3\n", out[2])  # launch (id 2) is filtered out of the live feed

    def test_live_from_another_thread(self) -> None:
        import threading

        def other() -> None:
            t = threading.Thread(target=lambda: self.bus.append({"kind": "launch", "summary": "from a worker"}))
            t.start()
            t.join()
        out = self.run_sse([other])
        self.assertIn("from a worker", out[1])

    def test_ends_when_the_client_is_gone(self) -> None:
        async def run() -> list[str]:
            async def gone() -> bool:
                return True
            return [f async for f in routes.sse(self.bus, 0, [], "", gone=gone, heartbeat=0.05)]
        out = asyncio.run(run())
        self.assertEqual(len(out), 1)  # hello, then the stream closes on its first idle check
        self.assertEqual(self.bus.state()["subscribers"], 0)

    def test_unicode(self) -> None:
        self.bus.append({"kind": "mcp", "summary": "naïve → done"})
        self.assertEqual(json.loads(self.once()[1]["data"])["summary"], "naïve → done")


class Mounted(unittest.TestCase):
    """The routes as the plugin mounts them (server/__init__.py), when the console server's modules are importable."""

    def test_plugin_router_has_the_routes(self) -> None:
        text = (HERE / "__init__.py").read_text("utf-8")
        self.assertIn("router.include_router(routes.build(", text)
        paths = {(m, r.path) for r in routes.build(lambda: None).routes for m in r.methods}
        self.assertEqual(paths, {("GET", "/claude-link"), ("GET", "/claude-link/stream"), ("GET", "/claude-link/state"), ("POST", "/claude-link/clear")})


if __name__ == "__main__":
    unittest.main(verbosity=1)
