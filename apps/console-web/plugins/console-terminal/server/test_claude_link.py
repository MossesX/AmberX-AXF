"""Unit tests for the Claude link bus (ring, JSONL tail, spool, view marker) and its redaction.

    python3 apps/console-web/plugins/console-terminal/server/test_claude_link.py
"""
from __future__ import annotations

import json
import os
import sys
import tempfile
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import claude_link as cl  # noqa: E402


def bus(size: int = 100, d: Path | None = None) -> tuple[cl.Bus, Path]:
    d = d or Path(tempfile.mkdtemp(prefix="axf-claude-link-"))
    return cl.Bus(size, folder=lambda: d, spool=lambda: d / "spool.jsonl"), d


class Ring(unittest.TestCase):
    def test_numbers_and_caps(self) -> None:
        b, _ = bus(100)
        for i in range(250):
            b.append({"kind": "mcp", "source": "t", "summary": f"call {i}"})
        snap = b.snapshot(limit=1000)
        self.assertEqual(len(snap["items"]), 100)
        self.assertEqual(snap["items"][0]["id"], 151)
        self.assertEqual(snap["items"][-1]["id"], 250)
        self.assertEqual(snap["seq"], 250)

    def test_min_and_max_size(self) -> None:
        self.assertEqual(cl.Bus(5).ring.maxlen, cl.MIN_SIZE)
        self.assertEqual(cl.Bus(10**9).ring.maxlen, cl.MAX_SIZE)
        b, _ = bus(100)
        self.assertEqual(b.resize(300), 300)
        self.assertEqual(b.ring.maxlen, 300)

    def test_filters(self) -> None:
        b, _ = bus()
        b.append({"kind": "launch", "source": "headless", "summary": "started axf-one", "account": "hulu"})
        b.append({"kind": "axhub", "source": "axhub-client", "summary": "vps.run held", "detail": {"tool": "call"}})
        b.append({"kind": "error", "source": "mcp-server", "summary": "boom"})
        self.assertEqual([e["kind"] for e in b.snapshot(kinds=["launch", "error"])["items"]], ["launch", "error"])
        self.assertEqual([e["summary"] for e in b.snapshot(q="HULU")["items"]], ["started axf-one"])
        self.assertEqual(len(b.snapshot(q="tool call")["items"]), 1)  # detail is searched too
        self.assertEqual([e["id"] for e in b.snapshot(since=2)["items"]], [3])
        self.assertTrue(b.snapshot(limit=1)["more"])

    def test_bad_events(self) -> None:
        b, _ = bus()
        with self.assertRaises(ValueError):
            b.append({"kind": "nope"})
        with self.assertRaises(ValueError):
            b.append({"kind": "mcp", "level": "loud"})
        svc = cl.ClaudeLinkService(b)
        self.assertIsNone(svc.append({"kind": "nope"}))  # the capability never raises
        e = svc.append({"kind": "error"})
        self.assertEqual(e["level"], "error")
        self.assertEqual(e["summary"], "error")

    def test_state_and_link(self) -> None:
        b, _ = bus()
        self.assertIsNone(b.state()["connected"])
        b.append({"kind": "connect", "source": "axhub-client", "summary": "axHub answered"})
        b.append({"kind": "mcp", "source": "mcp-server"})
        st = b.state()
        self.assertTrue(st["connected"])
        self.assertEqual(st["counts"]["mcp"], 1)
        self.assertEqual(st["last"]["kind"], "mcp")
        b.append({"kind": "disconnect", "source": "axhub-client", "summary": "timed out"})
        self.assertFalse(b.state()["connected"])
        self.assertEqual(b.state()["why"], "timed out")

    def test_clear_keeps_log(self) -> None:
        b, d = bus()
        for _ in range(3):
            b.append({"kind": "mcp"})
        self.assertEqual(b.clear()["clearedAt"], 3)
        self.assertEqual(b.snapshot()["items"], [])
        self.assertEqual(len(b.snapshot(all=True)["items"]), 3)
        b.append({"kind": "exit"})
        self.assertEqual([e["id"] for e in b.snapshot()["items"]], [4])
        self.assertEqual(b.state()["counts"]["mcp"], 0)
        # marker and log survive a restart
        b2, _ = bus(100, d)
        self.assertEqual(b2.snapshot()["clearedAt"], 3)
        self.assertEqual([e["id"] for e in b2.snapshot()["items"]], [4])
        b2.append({"kind": "mcp"})
        self.assertEqual(b2.seq, 5)

    def test_jsonl_and_trim(self) -> None:
        b, d = bus(100)
        for i in range(1100):
            b.append({"kind": "mcp", "summary": str(i)})
        lines = (d / "claude-link" / "events.jsonl").read_text().splitlines()
        self.assertLessEqual(len(lines), 1000)
        self.assertEqual(json.loads(lines[-1])["summary"], "1099")

    def test_spool_drain(self) -> None:
        b, d = bus()
        (d / "spool.jsonl").write_text(json.dumps({"kind": "launch", "source": "headless", "summary": "offline launch", "ts": 1}) + "\nnot json\n")
        items = b.snapshot()["items"]
        self.assertEqual(len(items), 1)
        self.assertTrue(items[0]["detail"]["spooled"])
        self.assertEqual(items[0]["ts"], 1)
        self.assertFalse((d / "spool.jsonl").exists())

    def test_subscribers(self) -> None:
        b, _ = bus()
        got: list[int] = []
        stop = b.subscribe(lambda e: got.append(e["id"]))
        b.subscribe(lambda e: 1 / 0)  # a broken subscriber never fails the sender
        b.append({"kind": "mcp"})
        stop()
        b.append({"kind": "mcp"})
        self.assertEqual(got, [1])


class Redaction(unittest.TestCase):
    def test_keys(self) -> None:
        r = cl.redact({"token": "abc123", "apiKey": "x" * 10, "AXHUB_TOKEN": "t", "authorization": "Bearer zz", "headers": {"Cookie": "a=b"},
                       "tool": "vps.run", "keys": 3, "count": 4, "ok": True})
        self.assertEqual(r["token"], cl.REDACTED)
        self.assertEqual(r["apiKey"], cl.REDACTED)
        self.assertEqual(r["AXHUB_TOKEN"], cl.REDACTED)
        self.assertEqual(r["authorization"], cl.REDACTED)
        self.assertEqual(r["headers"]["Cookie"], cl.REDACTED)
        self.assertEqual(r["tool"], "vps.run")
        self.assertEqual(r["count"], 4)
        self.assertTrue(r["ok"])

    def test_text(self) -> None:
        cases = ["Authorization: Bearer abcdefghijklmnop", "key sk-ant-oat01-AAAAAAAAAAAAAAAAAAAAAAAA end", "ghp_" + "a1" * 15,
                 "github_pat_" + "B2" * 15, "url?token=supersecretvalue&x=1", "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
                 "blob " + "aZ09" * 13]
        for c in cases:
            out = cl.redact_text(c)
            self.assertIn(cl.REDACTED, out, c)
        self.assertNotIn("supersecretvalue", cl.redact_text(cases[4]))
        self.assertIn("token=", cl.redact_text(cases[4]))
        # ordinary text and git SHAs stay readable
        for keep in ["vps.run held for veto (12 s)", "apps/console-web/plugins/console-terminal/server/claude_link.py", "a" * 3, "0123456789abcdef0123456789abcdef01234567"]:
            self.assertEqual(cl.redact_text(keep), keep)

    def test_event_is_redacted(self) -> None:
        b, d = bus()
        e = b.append({"kind": "axhub", "summary": "call with Bearer abcdefghijklmnopqrs", "detail": {"args": {"password": "hunter22"}, "note": "sk-ant-api03-ZZZZZZZZZZZZZZ"}})
        raw = (d / "claude-link" / "events.jsonl").read_text()
        for leak in ("abcdefghijklmnopqrs", "hunter22", "ZZZZZZZZZZZZZZ"):
            self.assertNotIn(leak, raw)
            self.assertNotIn(leak, json.dumps(e))

    def test_detail_cap(self) -> None:
        b, _ = bus()
        e = b.append({"kind": "mcp", "detail": {"text": "word " * 5000}})
        self.assertTrue(e["detail"]["truncated"])
        self.assertLessEqual(len(e["detail"]["text"]), cl.DETAIL_MAX)


class Routes(unittest.TestCase):
    def setUp(self) -> None:
        from fastapi import FastAPI
        from fastapi.testclient import TestClient
        import importlib.util
        import types
        pkg = types.ModuleType("axf_claude_link_pkg")
        pkg.__path__ = [str(HERE)]
        sys.modules["axf_claude_link_pkg"] = pkg
        sys.modules["axf_claude_link_pkg.claude_link"] = cl
        spec = importlib.util.spec_from_file_location("axf_claude_link_pkg.routes", HERE / "routes.py")
        routes = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = routes
        spec.loader.exec_module(routes)
        self.routes = routes
        self.bus, _ = bus()
        app = FastAPI()
        app.include_router(routes.build(lambda: self.bus), prefix="/api/plugins/console-terminal")
        self.c = TestClient(app)
        self.base = "/api/plugins/console-terminal/claude-link"

    def test_snapshot_filters(self) -> None:
        for k in ("launch", "mcp", "mcp", "error"):
            self.bus.append({"kind": k, "summary": f"{k} thing"})
        r = self.c.get(self.base, params={"kind": "mcp,error"}).json()
        self.assertEqual([e["kind"] for e in r["items"]], ["mcp", "mcp", "error"])
        self.assertEqual(len(self.c.get(self.base, params={"since": 3}).json()["items"]), 1)
        self.assertEqual(len(self.c.get(self.base, params={"q": "launch"}).json()["items"]), 1)
        self.assertEqual(len(self.c.get(self.base, params={"limit": 2}).json()["items"]), 2)
        self.assertEqual(self.c.get(self.base, params={"kind": "bogus"}).status_code, 400)

    def test_state_and_clear(self) -> None:
        self.bus.append({"kind": "connect", "summary": "up"})
        self.bus.append({"kind": "mcp"})
        st = self.c.get(self.base + "/state").json()
        self.assertTrue(st["connected"])
        self.assertEqual(st["counts"]["mcp"], 1)
        self.assertEqual(st["last"]["id"], 2)
        self.assertEqual(self.c.post(self.base + "/clear").json()["clearedAt"], 2)
        self.assertEqual(self.c.get(self.base).json()["items"], [])
        self.assertEqual(len(self.c.get(self.base, params={"all": 1}).json()["items"]), 2)

    def test_view(self) -> None:
        self.assertFalse(self.c.get(self.base + "/view").json()["paused"])
        v = self.c.put(self.base + "/view", json={"paused": True, "kinds": ["mcp"], "q": "vps"}).json()
        self.assertEqual((v["paused"], v["kinds"], v["q"]), (True, ["mcp"], "vps"))
        self.assertEqual(self.c.put(self.base + "/view", json={"kinds": ["nope"]}).status_code, 400)
        self.assertTrue(self.c.get(self.base + "/state").json()["view"]["paused"])

    def test_stream_backlog_and_resume(self) -> None:
        for k in ("launch", "mcp", "exit"):
            self.bus.append({"kind": k})
        body = self.c.get(self.base + "/stream", params={"once": 1}).text
        self.assertIn("event: hello", body)
        self.assertEqual(body.count("event: link"), 3)
        self.assertIn("id: 3\n", body)
        resumed = self.c.get(self.base + "/stream", params={"once": 1}, headers={"Last-Event-ID": "2"}).text
        self.assertEqual(resumed.count("event: link"), 1)
        filtered = self.c.get(self.base + "/stream", params={"once": 1, "kind": "mcp"}).text
        self.assertEqual(filtered.count("event: link"), 1)

    def test_stream_live_and_heartbeat(self) -> None:
        import asyncio

        async def run() -> list[str]:
            out: list[str] = []
            gen = self.routes.sse(self.bus, 0, [], "", heartbeat=0.05)
            out.append(await gen.__anext__())  # hello
            out.append(await gen.__anext__())  # quiet: a ping
            self.bus.append({"kind": "axhub", "summary": "live one"})
            out.append(await gen.__anext__())
            await gen.aclose()
            return out

        out = asyncio.run(run())
        self.assertIn("event: hello", out[0])
        self.assertEqual(out[1], ": ping\n\n")
        self.assertIn("live one", out[2])
        self.assertEqual(self.bus.state()["subscribers"], 0)  # closing the stream unsubscribes

    def test_ingest(self) -> None:
        r = self.c.post(self.base + "/ingest", json={"event": {"kind": "launch", "source": "headless", "summary": "go", "detail": {"token": "x" * 20}}}).json()
        self.assertEqual(r["ids"], [1])
        many = self.c.post(self.base + "/ingest", json={"events": [{"kind": "exit"}, {"kind": "bad"}]}).json()
        self.assertEqual(len(many["ids"]), 1)
        self.assertEqual(len(many["errors"]), 1)
        self.assertEqual(self.c.post(self.base + "/ingest", json={"event": {"kind": "bad"}}).status_code, 400)
        e = self.bus.snapshot()["items"][0]
        self.assertEqual(e["detail"]["token"], cl.REDACTED)
        self.assertEqual(self.bus.snapshot()["items"][1]["source"], "ingest")


class HubWatchTests(unittest.TestCase):
    """The axf_server.http observer: axHub /mcp calls, connect / disconnect, auth failures, Anthropic health."""

    def setUp(self) -> None:
        sys.path.insert(0, str(HERE.parents[4] / "framework" / "python"))
        from axf_server import http
        import hub_watch
        self.http, self.hw = http, hub_watch
        self.bus, _ = bus()
        self.stop = hub_watch.install(self.bus.append, {"localhost"})

    def tearDown(self) -> None:
        self.stop()

    def call(self, status: int, answer: dict | None = None, rpc: dict | None = None, url: str = "https://axhub.example/mcp", boom: bool = False) -> None:
        def transport(req):
            if boom:
                raise self.http.HttpError("connection refused")
            return self.http.Response(status, {"content-type": "application/json"}, json.dumps(answer or {}).encode(), req.url)
        body = json.dumps(rpc or {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "call", "arguments": {
            "service": "vps", "action": "run", "reason": {"title": "Restart the console"}, "token": "sk-ant-api03-SECRETSECRETSECRET"}}}).encode()
        try:
            self.http.request("POST", url, headers={"authorization": "Bearer hub-token-xyz"}, body=body, transport=transport)
        except self.http.HttpError:
            pass

    def kinds(self) -> list[str]:
        return [e["kind"] for e in self.bus.snapshot()["items"]]

    def test_call_states(self) -> None:
        self.call(200, {"result": {"content": [{"type": "text", "text": "ok: done"}]}})
        self.call(200, {"result": {"content": [{"type": "text", "text": "Held for veto: runs in 30 s unless Brett denies it"}]}})
        self.call(200, {"result": {"isError": True, "content": [{"type": "text", "text": "Brett denied this call"}]}})
        self.call(200, {"error": {"code": -1, "message": "unknown service"}})
        items = self.bus.snapshot()["items"]
        self.assertEqual(items[0]["kind"], "connect")
        states = [e["detail"]["state"] for e in items if e["kind"] == "axhub"]
        self.assertEqual(states, ["ok", "veto", "denied", "error"])
        self.assertEqual(items[1]["detail"]["tool"], "call vps.run")
        self.assertEqual(items[1]["detail"]["reason"], "Restart the console")
        self.assertNotIn("hub-token-xyz", json.dumps(items))
        self.assertNotIn("SECRETSECRET", json.dumps(items))

    def test_connect_disconnect_auth(self) -> None:
        self.call(200, {"result": {}})
        self.call(0, boom=True)
        self.call(0, boom=True)  # still down: one disconnect line only
        self.call(200, {"result": {}})
        self.call(401)
        ks = self.kinds()
        self.assertEqual(ks.count("disconnect"), 1)
        self.assertEqual(ks.count("connect"), 2)
        self.assertTrue(self.bus.snapshot(kinds=["error"])["items"][-1]["summary"].startswith("axHub refused the token (401) on call vps.run"))
        self.assertTrue(self.bus.state()["connected"])

    def test_ignored(self) -> None:
        self.call(200, {"result": {}}, url="https://localhost/mcp")
        self.call(200, {"result": {}}, url="https://example.com/api/other")
        self.call(200, {"result": {}}, rpc={"jsonrpc": "2.0", "id": 1, "method": "initialize"})
        self.assertEqual(self.kinds(), ["connect"])  # only the handshake's connect line

    def test_anthropic(self) -> None:
        self.call(200, {}, url="https://api.anthropic.com/v1/messages")
        self.call(200, {}, url="https://api.anthropic.com/v1/messages")
        self.call(401, {}, url="https://api.anthropic.com/v1/messages")
        self.assertEqual(self.kinds(), ["connect", "disconnect", "error"])


class SettingsTests(unittest.TestCase):
    """The Claude link settings in the Terminal's settings store: buffer range, kinds checked, booleans."""

    def test_settings(self) -> None:
        sys.path.insert(0, str(HERE.parents[2] / "server"))
        sys.path.insert(0, str(HERE.parents[4] / "framework" / "python"))
        os.environ["AXF_TERMINAL_DIR"] = tempfile.mkdtemp(prefix="axf-term-settings-")
        import importlib.util
        import types
        import console_context as cx
        cx.set_context(ROOT=HERE.parents[4], current_token=lambda: "t" * 32)
        pkg = types.ModuleType("axf_cl_settings_pkg")
        pkg.__path__ = [str(HERE)]
        sys.modules["axf_cl_settings_pkg"] = pkg
        sys.modules["axf_cl_settings_pkg.claude_link"] = cl
        spec = importlib.util.spec_from_file_location("axf_cl_settings_pkg.store", HERE / "store.py")
        store = importlib.util.module_from_spec(spec)
        sys.modules[spec.name] = store
        spec.loader.exec_module(store)
        d = store.settings()
        self.assertEqual((d["claudeLinkBuffer"], d["claudeLinkKinds"], d["claudeLinkAutoScroll"], d["claudeLinkDetail"]), (2000, [], True, False))
        out = store.save_settings({"claudeLinkBuffer": 50, "claudeLinkKinds": ["mcp", "error", "mcp"], "claudeLinkAutoScroll": False, "claudeLinkDetail": 1})
        self.assertEqual((out["claudeLinkBuffer"], out["claudeLinkKinds"], out["claudeLinkAutoScroll"], out["claudeLinkDetail"]), (100, ["mcp", "error"], False, True))
        self.assertEqual(store.save_settings({"claudeLinkBuffer": 10**6})["claudeLinkBuffer"], 20000)
        with self.assertRaises(ValueError):
            store.save_settings({"claudeLinkKinds": ["nope"]})


class McpServerCalls(unittest.TestCase):
    """The console's own /mcp server: every tool call reaches axf.claude-link@1 (session, tool, ok / error)."""

    def test_feed_recorder(self) -> None:
        srv = HERE.parents[2] / "server"
        sys.path.insert(0, str(srv))
        sys.path.insert(0, str(HERE.parents[4] / "framework" / "python"))
        try:
            import mcp_server
            import plugin_services
        except Exception as e:  # noqa: BLE001 — the MCP SDK isn't installed here
            self.skipTest(f"mcp_server not importable: {e}")
        b, _ = bus()
        plugin_services.provide("axf.claude-link@1", cl.ClaudeLinkService(b), "console-terminal")
        try:
            rec = mcp_server.feed_recorder()
            rec("chat:abc", "console_show", {"target": "x", "token": "t"}, True, "", 12)
            rec("chat:abc", "builds_get", {}, False, "no such build", 3)
        finally:
            plugin_services.withdraw("console-terminal")
        items = b.snapshot()["items"]
        self.assertEqual([(e["kind"], e["session"], e["level"]) for e in items], [("mcp", "chat:abc", "info"), ("mcp", "chat:abc", "error")])
        self.assertEqual(items[0]["detail"]["tool"], "console_show")
        self.assertIn("no such build", items[1]["summary"])


if __name__ == "__main__":
    os.environ.pop("AXF_CLAUDE_LINK_SPOOL", None)
    unittest.main(verbosity=1)
