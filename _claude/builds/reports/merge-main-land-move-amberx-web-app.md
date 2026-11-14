# Report: merge-main-land-move-amberx-web-app

Brett (Nov 14 2026, 23:10): "Now what we're gonna end up doing is just moving everything over the console and making AmberX app read the console instead of AmberX."

Model: Opus, one session. Merged on `claude/move-amberx-web-app-console-amberx-andr` (PR #596), merge commit `536763203`. No new PR for the land itself.

## What shipped

- **Merge:** `origin/main` merged into `claude/move-amberx-web-app-console-amberx-andr`. Three files clashed, all resolved keeping both sides:
  - `apps/console-web/plugins/approvals-banner/plugin.json`: main's phone overlay description plus the branch's Approvals page sentence. Capabilities are the union (`view:approvals`, `action:approvals.focus`, `action:approvals.page` + `action:approvals.overlay`, `action:overlay.expand|collapse|open`). Mentions are the union. Version is 0.9.0, above both sides (0.7.0 / 0.8.0).
  - `apps/console-web/plugins/approvals-banner/help.json`: both sets of help entries (Approvals page and actions, plus the overlay settings fields).
  - `apps/console-web/server/main.py`: main's console-control router (`/api/console-control/*`) with the branch's alert context (`open_alert_keys`, `alerts_hub`) on `console_context.set_context`.
- **Brett's intent (s8):** PR #596 is the move itself: AmberX's web app is served by the console and the phone app reads the console. The merge keeps all of it.

## API

Unchanged by the merge. The Approvals page is still `console_open("approvals", focus="<id>")` and `approvals-banner_*` (MCP / REST / CLI / voice). The overlay is still `overlay.expand|collapse|open` on all four.

## Checks (green after the merge)

- `apps/console-web/scripts/amberx-parity.test.mjs`: 258/258
- `apps/console-web/plugins/approvals-banner/test.py`: relay ok, 80 checks
- `apps/console-web/server/tests/test_console_control.py`: 8 tests
- `plugin-lifecycle.mjs check approvals-banner`: clean
- `tracker.mjs --check`: exit 0

Auto-land and the merge queue land PR #596 from here.
