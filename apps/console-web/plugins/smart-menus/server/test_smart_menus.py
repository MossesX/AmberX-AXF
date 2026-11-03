"""Menus plugin server part: settings clean-up, picks, pins, reset, topics (decay, replace) and console_context."""
from __future__ import annotations

import asyncio
import os
import sys
import tempfile
import time
import unittest
from pathlib import Path

HERE = Path(__file__).resolve()
sys.path.insert(0, str(HERE.parents[3] / "server"))
os.environ["AXF_SMART_MENUS_SYNC"] = "0"
os.environ["AXF_SMART_MENUS_DIR"] = tempfile.mkdtemp(prefix="smart-menus-")

import importlib.util  # noqa: E402

spec = importlib.util.spec_from_file_location("smart_menus_server", HERE.parent / "__init__.py")
sm = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sm)  # type: ignore[union-attr]


class Settings(unittest.TestCase):
    def test_defaults_and_clamps(self):
        s = sm.effective_settings({"suggestions": 99, "topicTtlMin": 0, "bogus": 1})
        self.assertEqual(s["suggestions"], 8)
        self.assertEqual(s["topicTtlMin"], 1)
        self.assertNotIn("bogus", s)
        self.assertEqual([x["kind"] for x in s["sections"]], ["talking", "pinned", "suggested", "context", "static"])

    def test_sections_static_forced(self):
        secs = sm.clean_sections([{"kind": "suggested", "max": 40}, {"kind": "nope"}, {"kind": "static", "on": False}])
        self.assertEqual(secs, [{"kind": "suggested", "on": True, "max": 12}, {"kind": "static", "on": True}])

    def test_per_menu_merge_and_remove(self):
        s = sm.clean_settings({"perMenu": {"ctx:build-card": {"off": True}, "bad": {"off": True}}}, {})
        self.assertEqual(s["perMenu"], {"ctx:build-card": {"off": True}})
        s = sm.clean_settings({"perMenu": {"ctx:build-card": None}}, s)
        self.assertEqual(s["perMenu"], {})

    def test_behavior(self):
        s = sm.clean_settings({"behavior": {"openOnHover": True, "longPressMs": 99999}}, {})
        self.assertEqual(s["behavior"], {"openOnHover": True, "longPressMs": 2000, "keyboard": True})


class Picks(unittest.TestCase):
    def test_prune_and_reset(self):
        now = int(time.time() * 1000)
        picks = [{"key": "ctx:a|a||home", "item": "x", "at": now - 1000}, {"key": "app:builds|builds||home", "item": "y", "at": now - 2000},
                 {"key": "ctx:a|a||home", "item": "old", "at": now - 400 * 86_400_000}, {"bad": 1}]
        kept = sm.prune_picks(picks, now)
        self.assertEqual([p["item"] for p in kept], ["y", "x"])
        self.assertEqual(len(sm.reset_picks(kept, menu="ctx:a")), 1)
        self.assertEqual(len(sm.reset_picks(kept, key="app:builds|builds||home")), 1)
        self.assertEqual(sm.reset_picks(kept), [])


class Topics(unittest.TestCase):
    def setUp(self):
        sm._write("topics.json", {"topics": []})

    def test_merge_replace_decay(self):
        sm.set_topics([{"kind": "build", "id": "toolbar", "label": "Toolbar build"}])
        sm.set_topics([{"kind": "plugin", "id": "smart-menus"}])
        self.assertEqual([t["id"] for t in sm.live_topics()], ["smart-menus", "toolbar"])
        sm.set_topics([{"kind": "pr", "id": "300"}], replace=True)
        self.assertEqual([t["id"] for t in sm.live_topics()], ["300"])
        later = int(time.time() * 1000) + 31 * 60_000
        self.assertEqual(sm.live_topics(later), [])

    def test_ttl_and_bad_kinds(self):
        r = sm.set_topics([{"kind": "build", "id": "a"}, {"kind": "weather", "id": "rain"}], ttl_min=5)
        self.assertEqual(len(r["ignored"]), 1)
        self.assertEqual(sm.live_topics(int(time.time() * 1000) + 6 * 60_000), [])
        with self.assertRaises(sm.HTTPException):
            sm.set_topics([{"kind": "weather", "id": "rain"}])

    def test_console_context_tool(self):
        r = asyncio.run(sm.console_context([{"kind": "screen", "id": "builds", "label": "Builds"}]))
        self.assertTrue(r["ok"])
        self.assertEqual(r["topics"][0]["by"], "amber")
        self.assertIn("Talking about", sm.console_context.__doc__)


if __name__ == "__main__":
    unittest.main()
