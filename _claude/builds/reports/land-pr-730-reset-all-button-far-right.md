# Land PR #730: Reset all button (far right)

Brett (2026-11-17 21:26): "reset all on the right"

Build `land-pr-730-reset-all-button-far-right` (Opus). Branch `claude/reset-all-button-every-asset-override`, PR #730.
Original build: `reset-all-button-every-asset-override` (report `reset-all-button-every-asset-override.md`).

## Result
PR #730 is merged up to date with main, every check passes, and the PR is in the merge queue.
Reset all is the last control in the Settings → Appearance "Asset overrides" toolbar. The toolbar uses `fx-row--between`, so Reset all sits on the far right (the "header, Reset all on the right" option, `framework/react/components/ChromeContext.tsx`).

## Merge (s1)
`origin/main` merged into the PR branch (merge commit `33a816afb`). Three conflicts:

| File | Resolution |
| --- | --- |
| `apps/axhub-web/axf.lock.json` | took main's |
| `apps/molly/axf.lock.json` | took main's (`apps/molly` still exists on main, so it was kept) |
| `apps/console-web/src/control/inventory.json` | untracked. Main stopped committing it in `1a7ff8e84`: it is generated at build time (`scripts/control-inventory.mjs`), published to axf-data (`control_targets`) and gitignored |

The merged `ChromeContext.tsx` still has Reset all on the far right, plus the control target, actions, undo ring and voice phrases.

## Inventory regeneration (s2)
`node apps/console-web/scripts/control-inventory.mjs` → 66 views, 16 nav, 32 tab groups, 82 tabs, 85 settings tabs, 89 settings, 319 functions, 62 buttons, 73 plugins.
It lists `function:chrome.reset-all` (destructive, requires `assets.swap`), `function:chrome.overrides` and `function:chrome.overrides-undo`.
The row target `setting:appearance.asset-overrides.reset-all` is registered at runtime in the control registry (`controlRegistry(rt).register` in `ChromeContext.tsx`, with focus/open/press/state), the same as in the original PR. The file is gitignored, so regenerating it changed no tracked files.

## Checks
These were the original PR's results before the merge, and the same checks after it:

| Check | Before (PR #730) | After merge |
| --- | --- | --- |
| check-console-control.mjs | pass | pass |
| check-theme.mjs | pass | pass (1433 files) |
| check-controls.mjs | pass | pass |
| check-toolbars.mjs | pass | pass (471 files) |
| check-chrome-assets.mjs | pass | pass |
| tracker.mjs --check | — | pass |
| shared-assets.mjs check / chrome-settings.mjs check | pass | pass |
| check-chrome-settings.mts | 334 | 334 |
| check-console-control.mts | — | 290 checks |
| theme-manager test.py | 66 | 66 |
| console `tsc --noEmit` | clean | clean |

Nothing needed fixing.

## How Reset all is reached
| Surface | How |
| --- | --- |
| Deep link | `view:settings/tab:settings.tabs=appearance/setting:appearance.asset-overrides.reset-all` (`console_open` / `console_show`) |
| control@1 / console-control | `state` / `press` + `confirm` on `setting:appearance.asset-overrides.reset-all` |
| REST | `POST /api/console-control` on that address; `GET /api/plugins/theme-manager/overrides`, `POST …/reset-all {"confirm": true}`, `POST …/reset-all/undo {"undoId"}` |
| MCP | `console_control_*` on the address; plugin commands theme-manager `overrides`, `reset-all`, `reset-all-undo` |
| CLI | `axf console overrides \| reset-all --confirm \| reset-all-undo <id>`; `node framework/cli/chrome-settings.mjs overrides \| reset-all --confirm \| undo <id>` |
| Voice (AmberX) | "reset all asset overrides" (asks first), "… confirm", "undo reset all", "show my asset overrides" |
| Actions | `chrome.reset-all:confirm`, `chrome.overrides`, `chrome.overrides-undo:<id\|last>` |

## Landing
PR #730 had been closed when the earlier build was archived. It was reopened, linked to this build (`builds-live.mjs link`) and added to the merge queue (`land.mjs queue add 730`). It was not merged directly.
