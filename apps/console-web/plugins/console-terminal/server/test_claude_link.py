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


if __name__ == "__main__":
    os.environ.pop("AXF_CLAUDE_LINK_SPOOL", None)
    unittest.main(verbosity=1)
