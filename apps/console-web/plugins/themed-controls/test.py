"""Server self-test of the Themed controls plugin (no console needed): switches, revisions, the console report, routes.

    python3 apps/console-web/plugins/themed-controls/test.py
"""
import asyncio
import importlib.util
import os
import sys
import tempfile
from pathlib import Path

os.environ["AXF_THEMED_CONTROLS_DIR"] = tempfile.mkdtemp(prefix="tc-test-")
spec = importlib.util.spec_from_file_location("tc_server", Path(__file__).parent / "server" / "__init__.py")
m = importlib.util.module_from_spec(spec)
spec.loader.exec_module(m)

fails = 0


def check(name, ok, detail=""):
    global fails
    print(("  ✓ " if ok else "  ✗ ") + name + ("" if ok else f" — {detail}"))
    fails += 0 if ok else 1


class Req:
    def __init__(self, body=None):
        self._b = body or {}
        self.headers = {}
        self.state = type("S", (), {})()

    async def json(self):
        return self._b


run = asyncio.run
s = m.get_state()
check("defaults: everything on", s["on"] and s["sheet"] and all(s["families"].values()) and len(s["active"]) == 10, s)
r = m.turn_off(Req())
check("off: no family active, revision up", r["active"] == [] and r["rev"] == 1, r)
r = m.turn_on(Req())
r = run(m.set_family(Req({"family": "checkbox", "on": "off"})))
check("one family off", r["families"]["checkbox"] is False and "checkbox" not in r["active"] and r["rev"] == 3, r)
try:
    run(m.set_family(Req({"family": "dropdown", "on": True})))
    check("unknown family refused", False)
except m.HTTPException as e:
    check("unknown family refused", e.status_code == 422)
r = run(m.report(Req({"settings": {"axf.themedControls.checkbox": True}, "rev": 1, "live": {"controls": [{"ref": "d1", "family": "datetime", "value": "2026-11-15"}]}})))
check("a stale console report never overwrites a newer API change", m.get_state()["families"]["checkbox"] is False, r)
r = run(m.report(Req({"settings": {"axf.themedControls.checkbox": True}, "rev": 3})))
check("a current console report is taken", m.get_state()["families"]["checkbox"] is True and r.get("changed"), r)
check("live controls readable", m.controls()["controls"][0]["ref"] == "d1")
check("datetime filter", m.controls("color")["controls"] == [])
try:
    run(m.set_scrollbar(Req({"width": 99})))
    check("scrollbar width range enforced", False)
except m.HTTPException as e:
    check("scrollbar width range enforced", e.status_code == 422)
try:
    run(m.answer(Req({"answer": "maybe"})))
    check("answer must be ok or cancel", False)
except m.HTTPException as e:
    check("answer must be ok or cancel", e.status_code == 422)
r = run(m.set_control(Req({"ref": "d1", "value": "2026-03-03"})))
check("set without a console answers unavailable", r.get("ok") is False, r)
print(f"themed-controls server: {'ok' if not fails else f'{fails} failed'}")
sys.exit(1 if fails else 0)
