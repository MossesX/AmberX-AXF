#!/usr/bin/env python3
"""Unit tests for the Claude link bus (claude_link.py): the ring, redaction, the JSONL tail through data_store and the
buffer-size setting.

    python3 apps/console-web/plugins/console-terminal/server/test_claude_link.py
"""
from __future__ import annotations

import importlib
import json
import os
import sys
import tempfile
import threading
import types
import unittest
from pathlib import Path

HERE = Path(__file__).resolve().parent
REPO = HERE.parents[4]
TMP = Path(tempfile.mkdtemp(prefix="axf-claude-link-"))
os.environ["AXF_STATE"] = str(TMP / "console" / "state.json")       # data_store's roots: <TMP>/console(/plugins)
os.environ["AXF_TERMINAL_DIR"] = str(TMP / "console" / "plugins" / "console-terminal")
os.environ.pop("AXF_PLUGINS_DATA_DIR", None)
os.environ.pop("AXF_DATA_STORE_DIR", None)
sys.path.insert(0, str(HERE.parents[2] / "server"))

import console_context as cx  # noqa: E402
import data_store as ds  # noqa: E402

cx.set_context(ROOT=REPO, current_token=lambda: "t" * 32)
# the plugin's server folder as a package, without running its routes (__init__.py)
PKG = "axf_console_plugins_claude_link_test"
pkg = types.ModuleType(PKG)
pkg.__path__ = [str(HERE)]
sys.modules[PKG] = pkg
cl = importlib.import_module(f"{PKG}.claude_link")
store = importlib.import_module(f"{PKG}.store")


def ev(i: int = 0, **kw) -> dict:
    return {"kind": "mcp", "source": "test", "summary": f"call {i}", **kw}


def memory(size: int = 100) -> "cl.Bus":
    return cl.Bus(size)


def on_disk(size: int = 100, d: Path | None = None, **kw) -> tuple["cl.Bus", Path]:
    d = d or Path(tempfile.mkdtemp(prefix="bus-", dir=TMP))
    return cl.Bus(size, folder=lambda: d, store=cl.Files, background=False, **kw), d


class Ring(unittest.TestCase):
    def test_default_size(self) -> None:
        self.assertEqual(cl.DEFAULT_SIZE, 2000)
        self.assertEqual(cl.Bus().ring.maxlen, 2000)
        self.assertEqual(cl.Bus(None).ring.maxlen, 2000)
        self.assertEqual(cl.Bus("nonsense").ring.maxlen, 2000)

    def test_size_limits(self) -> None:
        self.assertEqual(cl.Bus(5).ring.maxlen, cl.MIN_SIZE)
        self.assertEqual(cl.Bus(10**9).ring.maxlen, cl.MAX_SIZE)
        self.assertEqual(cl.Bus("350").ring.maxlen, 350)

    def test_numbers_and_drops_the_oldest(self) -> None:
        b = memory(100)
        for i in range(250):
            b.append(ev(i))
        snap = b.snapshot(limit=1000)
        self.assertEqual([e["id"] for e in snap["items"]], list(range(151, 251)))
        self.assertEqual(snap["items"][0]["summary"], "call 150")
        self.assertEqual((snap["seq"], snap["size"], snap["more"]), (250, 100, False))
        self.assertEqual(b.state()["held"], 100)

    def test_resize_keeps_the_newest(self) -> None:
        b = memory(300)
        for i in range(300):
            b.append(ev(i))
        self.assertEqual(b.resize(100), 100)
        self.assertEqual([e["id"] for e in b.ring][0], 201)
        self.assertEqual(b.resize(1), cl.MIN_SIZE)
        self.assertEqual(b.resize(500), 500)
        b.append(ev(300))
        self.assertEqual(len(b.ring), 101)
        self.assertEqual(b.seq, 301)

    def test_event_shape_and_defaults(self) -> None:
        b = memory()
        e = b.append({"kind": "launch", "source": "headless", "session": "axf-one", "account": "hulu", "model": "claude-fable-5-2",
                      "summary": "started\n axf-one  ", "detail": {"slot": 2}, "ts": 1_760_000_000_000})
        self.assertEqual(e, {"id": 1, "$axf": "claude-link-event@1", "ts": 1_760_000_000_000, "kind": "launch", "source": "headless",
                             "session": "axf-one", "account": "hulu", "model": "claude-fable-5-2", "summary": "started axf-one",
                             "detail": {"slot": 2}, "level": "info"})
        self.assertEqual(b.append({"kind": "error"})["level"], "error")
        self.assertEqual(b.append({"kind": "disconnect"})["level"], "warn")
        d = b.append({"kind": "exit", "detail": "exit code 3"})
        self.assertEqual((d["source"], d["summary"], d["detail"]), ("unknown", "exit", {"text": "exit code 3"}))
        self.assertGreater(d["ts"], 1_700_000_000_000)

    def test_rejects_what_is_not_an_event(self) -> None:
        b = memory()
        for bad in ("text", None, {}, {"kind": "nope"}, {"kind": "mcp", "level": "loud"}):
            with self.assertRaises(ValueError):
                b.append(bad)
        self.assertEqual((b.seq, len(b.ring)), (0, 0))

    def test_long_fields_are_cut(self) -> None:
        e = memory().append(ev(summary="x " * 500, source="s" * 99, detail={"out": "word " * 5000}))
        self.assertEqual((len(e["summary"]), len(e["source"])), (200, 40))
        self.assertTrue(e["detail"]["truncated"])
        self.assertLessEqual(len(json.dumps(e["detail"])), cl.DETAIL_MAX + 200)

    def test_filters(self) -> None:
        b = memory()
        b.append({"kind": "launch", "source": "headless", "summary": "started axf-one", "account": "hulu"})
        b.append({"kind": "axhub", "source": "axhub-client", "summary": "vps.run held", "detail": {"tool": "call"}})
        b.append({"kind": "error", "source": "mcp-server", "summary": "boom"})
        self.assertEqual([e["kind"] for e in b.snapshot(kinds=["launch", "error"])["items"]], ["launch", "error"])
        self.assertEqual([e["summary"] for e in b.snapshot(q="HULU")["items"]], ["started axf-one"])
        self.assertEqual(len(b.snapshot(q="tool call")["items"]), 1)  # the detail is searched too
        self.assertEqual([e["id"] for e in b.snapshot(since=2)["items"]], [3])
        snap = b.snapshot(limit=2)
        self.assertEqual(([e["id"] for e in snap["items"]], snap["more"]), ([2, 3], True))

    def test_clear_moves_the_view_marker_only(self) -> None:
        b = memory()
        for i in range(5):
            b.append(ev(i))
        self.assertEqual(b.clear(), {"clearedAt": 5})
        b.append(ev(5))
        self.assertEqual([e["id"] for e in b.snapshot()["items"]], [6])
        self.assertEqual(len(b.snapshot(all=True)["items"]), 6)
        self.assertEqual(b.state()["counts"]["mcp"], 1)
        self.assertEqual(len(b.ring), 6)

    def test_state(self) -> None:
        b = memory()
        st = b.state()
        self.assertEqual((st["connected"], st["last"], st["seq"]), (None, None, 0))
        self.assertEqual(set(st["counts"]), set(cl.KINDS))
        b.append({"kind": "connect", "source": "axhub-client", "summary": "axHub answered", "ts": 111})
        b.append(ev())
        self.assertEqual((b.state()["connected"], b.state()["since"]), (True, 111))
        last = b.append({"kind": "disconnect", "source": "axhub-client", "summary": "axHub timed out", "ts": 222})
        st = b.state()
        self.assertEqual((st["connected"], st["since"], st["why"], st["last"]), (False, 222, "axHub timed out", last))
        self.assertEqual((st["counts"]["connect"], st["counts"]["mcp"], st["counts"]["disconnect"], st["held"]), (1, 1, 1, 3))

    def test_subscribers(self) -> None:
        b = memory()
        got: list[int] = []
        stop = b.subscribe(lambda e: got.append(e["id"]))
        b.subscribe(lambda e: 1 / 0)  # a broken subscriber never fails the sender or the others
        b.append(ev())
        b.append(ev())
        stop()
        stop()
        b.append(ev())
        self.assertEqual(got, [1, 2])
        self.assertEqual(b.state()["subscribers"], 1)

    def test_threads_never_share_an_id(self) -> None:
        b = memory(5000)
        ts = [threading.Thread(target=lambda: [b.append(ev(i)) for i in range(200)]) for _ in range(8)]
        for t in ts:
            t.start()
        for t in ts:
            t.join()
        self.assertEqual([e["id"] for e in b.ring], list(range(1, 1601)))


class Redaction(unittest.TestCase):
    def gone(self, text: str, *secrets: str) -> str:
        out = cl.redact_text(text)
        for s in secrets:
            self.assertNotIn(s, out, text)
        self.assertIn(cl.REDACTED, out, text)
        return out

    def test_secret_keys(self) -> None:
        d = cl.redact({"token": "abc", "apiKey": "k-1", "api_key": "k-2", "ANTHROPIC_API_KEY": "k-3", "client_secret": "s", "password": "p",
                       "Authorization": "anything", "set-cookie": "sid=1", "key": "k", "ssh_key": "k", "private_key": "pk", "sessionId": "sid",
                       "nested": {"refreshToken": "r", "note": "kept"}, "list": [{"access_token": "a"}, "plain"],
                       "credentials": {"user": "brett", "pass": "hunter2", "port": 22}, "tool": "vps.run", "ok": True})
        for k in ("token", "apiKey", "api_key", "ANTHROPIC_API_KEY", "client_secret", "password", "Authorization", "set-cookie", "key", "ssh_key",
                  "private_key", "sessionId"):
            self.assertEqual(d[k], cl.REDACTED, k)
        self.assertEqual(d["nested"], {"refreshToken": cl.REDACTED, "note": "kept"})
        self.assertEqual(d["list"], [{"access_token": cl.REDACTED}, "plain"])
        self.assertEqual(d["credentials"], {"user": cl.REDACTED, "pass": cl.REDACTED, "port": 22})  # every string under a secret key
        self.assertEqual((d["tool"], d["ok"]), ("vps.run", True))

    def test_counts_and_names_are_kept(self) -> None:
        d = cl.redact({"inputTokens": 1200, "output_tokens": 88, "tokens": {"in": 5, "out": 7}, "max_tokens": 4096, "tokenCount": "12k",
                       "keyId": "console-1", "token": 0, "secret": None, "hasToken": True, "monkey": "banana", "keyboard": "us"})
        self.assertEqual(d, {"inputTokens": 1200, "output_tokens": 88, "tokens": {"in": 5, "out": 7}, "max_tokens": 4096, "tokenCount": "12k",
                             "keyId": "console-1", "token": 0, "secret": None, "hasToken": True, "monkey": "banana", "keyboard": "us"})

    def test_token_shapes_in_text(self) -> None:
        for s in ("sk-ant-oat01-" + "aB3_" * 12, "sk-ant-api03-" + "Zz9-" * 10, "sk-proj-" + "a1B2" * 8, "ghp_" + "a1B2c3D4" * 5,
                  "gho_" + "0123456789abcdefghij", "github_pat_" + "11ABCDEFG0" * 4, "glpat-" + "abcdefghij0123456789", "xoxb-1234567890-abcdefghij",
                  "AKIAIOSFODNN7EXAMPLE", "AIza" + "SyD3x4mpl3" * 4,
                  "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N",
                  "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08", "Qm9yaW5nQmFzZTY0VG9rZW5XaXRoTWl4ZWRDYXNlMTIzNDU2Nzg5MA=="):
            out = self.gone(f"call failed with {s} in the answer", s)
            self.assertTrue(out.startswith("call failed with ") and out.endswith(" in the answer"), out)

    def test_headers_urls_and_assignments(self) -> None:
        self.assertEqual(self.gone("Authorization: Bearer abc.def-123456", "abc.def"), f"Authorization: {cl.REDACTED}")
        self.assertEqual(self.gone("sent bearer abcdefgh12345678 to hub", "abcdefgh12345678"), f"sent bearer {cl.REDACTED} to hub")
        self.assertEqual(self.gone("x-api-key: shortkey\nhost: hub.example", "shortkey"), f"x-api-key: {cl.REDACTED}\nhost: hub.example")
        self.assertEqual(self.gone("Cookie: sid=abc; theme=dark", "abc", "dark"), f"Cookie: {cl.REDACTED}")
        self.assertEqual(self.gone("clone https://brett:hunter2@github.com/a/b.git", "hunter2", "brett:"), f"clone https://{cl.REDACTED}@github.com/a/b.git")
        self.assertEqual(self.gone("GET /mcp?token=abc123&page=2", "abc123"), f"GET /mcp?token={cl.REDACTED}&page=2")
        self.assertEqual(self.gone("env AXF_TOKEN=s3cr3t CLAUDE_CODE_OAUTH_TOKEN='a b' HOME=/root", "s3cr3t", "a b"),
                         f"env AXF_TOKEN={cl.REDACTED} CLAUDE_CODE_OAUTH_TOKEN={cl.REDACTED} HOME=/root")
        self.assertEqual(self.gone('body {"api_key": "k-123", "tool": "run"}', "k-123"), f'body {{"api_key": "{cl.REDACTED}", "tool": "run"}}')
        self.assertEqual(self.gone("claude --api-key abc123 --model fable", "abc123"), f"claude --api-key {cl.REDACTED} --model fable")
        self.assertEqual(self.gone("login --token=abc123", "abc123"), f"login --token={cl.REDACTED}")
        pem = "-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNzaC1rZXktdjEAAAAA\nAAAEbm9uZQ\n-----END OPENSSH PRIVATE KEY-----"
        self.assertEqual(self.gone(f"key was {pem} ok", "b3BlbnNzaC1rZXk", "AAAEbm9uZQ"), f"key was {cl.REDACTED} ok")

    def test_ordinary_text_is_untouched(self) -> None:
        for s in ("tools/call vps.run held 412 ms", "axf-terminal-main-tab-streaming-console-s--s2--paulie started on claude-fable-5-2",
                  "commit e88f7ff22b1455fd3e8c3ed0b4260bcc227eefea01a2 landed", "exit code 1: tokens used 18234, cost $0.42",
                  "/root/axf-builds/terminal-main-tab-streaming-console-s--s2/apps/console-web/plugins/console-terminal/server/claude_link.py",
                  "account hulu hit its usage limit; handed off to paulie", "the token expired, sign in again", "auth failed (401) on /mcp",
                  "https://claude.ai/chat/0b6e1c1e-58a5-4d0f-9d6a-2f5a8b1c3d4e", "id st-mwuoifwf21zava rev 2", ""):
            self.assertEqual(cl.redact_text(s), s)

    def test_append_redacts_every_field(self) -> None:
        tok, gh = "sk-ant-oat01-" + "aB3_" * 12, "ghp_" + "a1B2c3D4" * 5
        b, d = on_disk()
        e = b.append({"kind": "error", "source": f"hub {tok}", "session": f"s {gh}", "account": f"a {tok}", "model": f"m {gh}",
                      "summary": f"401 from axHub with Authorization: Bearer {tok}",
                      "detail": {"headers": {"authorization": f"Bearer {tok}", "x-request": "r-1"}, "stderr": f"export GH_TOKEN={gh}",
                                 "args": ["--token", "inline", tok], tok: "a key that is a secret", "bytes": b"raw", "when": 1.5}})
        stored = json.dumps(e)
        on_file = (d / "claude-link" / "events.jsonl").read_text("utf-8")
        for text in (stored, on_file):
            self.assertNotIn(tok, text)
            self.assertNotIn(gh, text)
            self.assertNotIn("oat01", text)
        self.assertEqual(e["detail"]["headers"], {"authorization": cl.REDACTED, "x-request": "r-1"})
        self.assertEqual(e["detail"]["stderr"], f"export GH_TOKEN={cl.REDACTED}")
        self.assertEqual((e["detail"]["bytes"], e["detail"]["when"]), ("<3 bytes>", 1.5))
        self.assertEqual(json.loads(on_file), e)

    def test_redact_never_changes_its_input_and_survives_odd_values(self) -> None:
        loop: dict = {"token": "abc"}
        loop["self"] = loop
        out = cl.redact(loop)
        self.assertEqual(loop["token"], "abc")
        self.assertEqual(out["token"], cl.REDACTED)
        json.dumps(out)
        json.dumps(cl.redact({"nan": float("nan"), "set": {1}, "obj": object(), 3: "three", "path": Path("/tmp/x")}))


class Tail(unittest.TestCase):
    def test_restart_refills_the_ring_and_keeps_numbering(self) -> None:
        b, d = on_disk(100)
        for i in range(130):
            b.append(ev(i))
        b.append({"kind": "disconnect", "summary": "axHub timed out", "ts": 5})
        b.clear()
        self.assertEqual(len((d / "claude-link" / "events.jsonl").read_text("utf-8").splitlines()), 131)
        b2, _ = on_disk(100, d)
        e = b2.append(ev(131))
        self.assertEqual(e["id"], 132)
        self.assertEqual([x["id"] for x in b2.ring], list(range(33, 133)))
        self.assertEqual((b2.cleared_at, b2.state()["connected"]), (131, False))
        self.assertEqual([x["id"] for x in b2.snapshot()["items"]], [132])

    def test_rotation_keeps_one_old_generation(self) -> None:
        b, d = on_disk(100)
        old = cl.TAIL_BYTES
        cl.TAIL_BYTES = 2000
        try:
            for i in range(60):
                b.append(ev(i))
        finally:
            cl.TAIL_BYTES = old
        names = sorted(p.name for p in (d / "claude-link").iterdir())
        self.assertEqual(names, ["events.1.jsonl", "events.jsonl"])
        b2, _ = on_disk(100, d)
        b2.load()
        ids = [x["id"] for x in b2.ring]
        self.assertEqual(ids, sorted(ids))
        self.assertEqual(ids[-1], 60)
        self.assertGreater(len(ids), len((d / "claude-link" / "events.jsonl").read_text("utf-8").splitlines()))  # the old generation filled the rest

    def test_bad_lines_and_a_failing_store_never_stop_the_bus(self) -> None:
        d = Path(tempfile.mkdtemp(prefix="bus-", dir=TMP))
        (d / "claude-link").mkdir()
        (d / "claude-link" / "events.jsonl").write_text('not json\n{"id": "x"}\n[1]\n' + json.dumps({"id": 7, **cl.normalise(ev())}) + "\n")
        (d / "claude-link" / "view.json").write_text("{broken")
        b, _ = on_disk(100, d)
        self.assertEqual(b.append(ev())["id"], 8)
        self.assertEqual(len(b.ring), 2)

        class Broken:
            def __getattr__(self, name):
                def fail(*a, **kw):
                    raise OSError("disk full")
                return fail
        b3 = cl.Bus(100, folder=lambda: d, store=Broken(), background=False)
        self.assertEqual(b3.append(ev())["id"], 1)
        b3.clear()
        self.assertEqual(b3.state()["dropped"], 1)

    def test_background_writer_keeps_order_and_never_blocks_append(self) -> None:
        gate = threading.Event()
        lines: list[int] = []

        class Slow:
            read_text = staticmethod(lambda p, default="": default)
            read_json = staticmethod(lambda p, default: default)

            @staticmethod
            def append_jsonl(path, entry, **kw):
                gate.wait(10)
                lines.append(entry["id"])
        b = cl.Bus(100, folder=lambda: TMP / "slow", store=Slow())
        for i in range(50):
            b.append(ev(i))            # returns while the store is still stuck on the first line
        self.assertEqual((len(b.ring), lines), (50, []))
        gate.set()
        b.flush()
        self.assertEqual(lines, list(range(1, 51)))

    def test_written_through_data_store(self) -> None:
        calls: list[tuple] = []

        class Spy:
            def __getattr__(self, name):
                def call(path, *a, **kw):
                    calls.append((name, ds.key_for(path)))
                    return getattr(ds, name)(path, *a, **kw)
                return call
        b = cl.Bus(100, folder=store.data_dir, store=Spy(), background=False)
        b.append(ev(detail={"token": "abc"}))
        b.clear()
        self.assertIn(("append_jsonl", "plugins/console-terminal/claude-link/events.jsonl"), calls)
        self.assertIn(("write_json", "plugins/console-terminal/claude-link/view.json"), calls)
        self.assertEqual(ds.kind_of("plugins/console-terminal/claude-link/events.jsonl"), "journal")
        f = store.data_dir() / "claude-link" / "events.jsonl"
        self.assertEqual(json.loads(f.read_text("utf-8").splitlines()[-1])["detail"], {"token": cl.REDACTED})
        self.assertEqual(f.stat().st_mode & 0o077, 0)
        self.assertIs(cl.data_layer(), ds)  # what a bus uses when it isn't handed a store


class Settings(unittest.TestCase):
    def test_the_console_bus_follows_the_setting(self) -> None:
        self.assertEqual(store.settings()["claudeLinkBuffer"], 2000)
        self.assertEqual(store.save_settings({"claudeLinkBuffer": 300})["claudeLinkBuffer"], 300)
        cl._BUS = None
        b = cl.bus()
        self.assertIs(cl.bus(), b)
        self.assertEqual(b.ring.maxlen, 300)
        self.assertEqual(b.path(), store.data_dir() / "claude-link" / "events.jsonl")
        self.assertEqual(store.save_settings({"claudeLinkBuffer": 10**7})["claudeLinkBuffer"], cl.MAX_SIZE)
        self.assertEqual(b.ring.maxlen, cl.MAX_SIZE)  # a live bus resizes when the setting is saved
        self.assertEqual(store.save_settings({"claudeLinkBuffer": "1"})["claudeLinkBuffer"], cl.MIN_SIZE)
        with self.assertRaises(ValueError):
            store.save_settings({"claudeLinkBuffer": "lots"})
        self.assertEqual(store.save_settings({"fontSize": 15})["claudeLinkBuffer"], cl.MIN_SIZE)  # other saves leave it alone

    def test_module_append_never_raises(self) -> None:
        cl._BUS = None
        self.assertIsNone(cl.append({"kind": "nope"}))
        self.assertIsNone(cl.append("text"))
        e = cl.append({"kind": "axhub", "source": "axhub-client", "summary": "tools/call vps.run", "detail": {"authorization": "Bearer abcdefgh1234"}})
        self.assertEqual(e["detail"], {"authorization": cl.REDACTED})
        cl.bus().flush()
        last = json.loads(cl.bus().path().read_text("utf-8").splitlines()[-1])
        self.assertEqual(last, e)


if __name__ == "__main__":
    unittest.main(verbosity=1)
