# Merge main and land change-to-move-amberx-web-app-console

Build `merge-main-land-change-to-move-amberx` · branch `claude/change-to-move-amberx-web-app-console` · PR #586 · 2026-11-14

Brett said (2026-11-14 23:10): "Merging main into claude/change-to-move-amberx-web-app-console clashes in code: apps/amberx-droid/android/app/src/main/java/ai/amberx/droid/WatchService.java, apps/console-web/plugins/approvals-banner/plugin.json, apps/console-web/server/main.py"

## Result
`origin/main` merged into the branch (commit 018de23c7). Re-checked against the latest main afterwards: merges clean.

## Conflicts
| File | Branch side | Main side | Resolution |
|---|---|---|---|
| `apps/amberx-droid/.../WatchService.java` | `vetoCards = true` (phone shows its own veto card, console skips the veto alert) | approval overlay: `ApprovalOverlayRules.items(...)` + `syncApprovalOverlay()` | both kept; independent lines in the same block |
| `apps/console-web/plugins/approvals-banner/plugin.json` | version 0.6.0 → 0.7.0 | version 0.6.0 → 0.8.0 | 0.9.0 (carries both changes); mentions auto-merged |
| `apps/console-web/server/main.py` | `set_context(..., open_alert_keys=ALERTS.open_keys, alerts_hub=ALERTS)` | console-control@1 router + `set_context` without the two new keys | both kept: router included, `set_context` with the branch's extra keys |

`apps/console-web/src/control/inventory.json` was stale after the merge and was regenerated (`control-inventory.mjs`).

## Checks
- `python3 apps/console-web/plugins/approvals-banner/test.py`: 67 checks ok
- `python3 apps/console-web/server/tests/test_console_control.py`: 8 tests ok
- `python3 -m py_compile apps/console-web/server/main.py`: ok
- `node framework/cli/tracker.mjs --check`: ok
- `node framework/cli/plugin-lifecycle.mjs check approvals-banner`: clean
- `node framework/cli/check-console-control.mjs`: ok
- Not run here: Android unit tests (no JDK on the VPS) and `test.mts` (VPS Node lacks `--experimental-strip-types`); CI runs both.

## API
No UI or API surface added or changed by this merge; the branch's own surfaces are listed in PR #586.
