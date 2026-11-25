"""Tests for the Claude link's observer on axf_server.http (hub_watch.py): axHub /mcp calls and their held / veto /
denied / ok / error state, connect and disconnect, auth failures, Anthropic API health, and what is left out.

    python3 apps/console-web/plugins/console-terminal/server/test_hub_watch.py

Runs on its own (a temp dataDir, a fake transport: no network, no console server) and from the plugin's test.py.
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
sys.path.insert(0, str(HERE.parents[4] / "framework" / "python"))
import claude_link as cl  # noqa: E402
import hub_watch  # noqa: E402
from axf_server import http  # noqa: E402

CALL = {"jsonrpc": "2.0", "id": 1, "method": "tools/call", "params": {"name": "call", "arguments": {
    "service": "vps", "action": "run", "reason": {"title": "Restart the console"}, "token": "sk-ant-api03-SECRETSECRETSECRET"}}}


class HubWatchTests(unittest.TestCase):
    def setUp(self) -> None:
        d = Path(tempfile.mkdtemp(prefix="axf-hub-watch-"))
        self.bus = cl.Bus(100, folder=lambda: d, spool=lambda: d / "spool.jsonl")
        self.stop = hub_watch.install(cl.ClaudeLinkService(self.bus).append, {"localhost"})

    def tearDown(self) -> None:
        self.stop()

    def call(self, status: int, answer: dict | None = None, rpc: dict | None = None, url: str = "https://axhub.example/mcp",
             boom: bool = False, sse: bool = False) -> None:
        def transport(req):
            if boom:
                raise http.HttpError("connection refused")
            if sse:
                return http.Response(status, {"content-type": "text/event-stream"}, f"event: message\ndata: {json.dumps(answer or {})}\n\n".encode(), req.url)
            return http.Response(status, {"content-type": "application/json"}, json.dumps(answer or {}).encode(), req.url)
        try:
            http.request("POST", url, headers={"authorization": "Bearer hub-token-xyz"}, body=json.dumps(rpc or CALL).encode(), transport=transport)
        except http.HttpError:
            pass

    def items(self) -> list[dict]:
        return self.bus.snapshot()["items"]

    def kinds(self) -> list[str]:
        return [e["kind"] for e in self.items()]

    def test_call_states(self) -> None:
        self.call(200, {"result": {"content": [{"type": "text", "text": "ok: done"}]}})
        self.call(200, {"result": {"content": [{"type": "text", "text": "Held for veto: runs in 30 s unless Brett denies it"}]}})
        self.call(200, {"result": {"content": [{"type": "text", "text": "Held: waiting for approval"}]}}, sse=True)
        self.call(200, {"result": {"isError": True, "content": [{"type": "text", "text": "Brett denied this call"}]}})
        self.call(200, {"error": {"code": -1, "message": "unknown service"}})
        self.call(502)
        items = self.items()
        self.assertEqual(items[0]["kind"], "connect")
        calls = [e for e in items if e["kind"] == "axhub"]
        self.assertEqual([e["detail"]["state"] for e in calls], ["ok", "veto", "held", "denied", "error", "error"])
        self.assertEqual([e["level"] for e in calls], ["info", "warn", "warn", "warn", "error", "error"])
        self.assertEqual(calls[0]["detail"]["tool"], "call vps.run")
        self.assertEqual(calls[0]["detail"]["reason"], "Restart the console")
        self.assertIsInstance(calls[0]["detail"]["ms"], int)
        self.assertIn("unknown service", calls[4]["summary"])
        self.assertNotIn("hub-token-xyz", json.dumps(items))
        self.assertNotIn("SECRETSECRET", json.dumps(items))

    def test_plain_tool_logs_argument_names_only(self) -> None:
        self.call(200, {"result": {}}, rpc={"jsonrpc": "2.0", "id": 2, "method": "tools/call", "params": {"name": "list_services", "arguments": {"filter": "private-value"}}})
        e = self.items()[-1]
        self.assertEqual((e["detail"]["tool"], e["detail"]["args"]), ("list_services", ["filter"]))
        self.assertNotIn("private-value", json.dumps(e))

    def test_connect_disconnect_auth(self) -> None:
        self.call(200, {"result": {}})
        self.call(0, boom=True)
        self.call(0, boom=True)  # still down: one disconnect line only
        self.call(200, {"result": {}})
        self.call(401)
        ks = self.kinds()
        self.assertEqual(ks.count("disconnect"), 1)
        self.assertEqual(ks.count("connect"), 2)
        down = [e for e in self.items() if e["kind"] == "axhub" and e["detail"]["state"] == "error"]
        self.assertEqual(len(down), 2)  # each failed call still has its own line, with the reason
        self.assertIn("connection refused", down[0]["summary"])
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

    def test_observer_never_breaks_the_call_and_unsubscribes(self) -> None:
        def bad(_info: dict) -> None:
            raise RuntimeError("observer bug")
        off = http.observe(bad)
        r = http.request("GET", "https://axhub.example/x", transport=lambda req: http.Response(200, {}, b"ok", req.url))
        self.assertEqual(r.status, 200)
        off()
        self.stop()
        self.call(200, {"result": {}})
        self.assertEqual(self.kinds(), [])


if __name__ == "__main__":
    os.environ.pop("AXF_CLAUDE_LINK_SPOOL", None)
    unittest.main(verbosity=1)
