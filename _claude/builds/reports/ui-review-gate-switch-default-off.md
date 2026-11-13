# UI Review gate switch, default off

Build: `ui-review-gate-switch-default-off` · branch `claude/ui-review-gate-switch-default-off` · replaces #555.

Brett (2026-11-13 12:14): "UI Review must not be a gate. Add an on/off switch in UI Review settings, 'UI Review is a merge gate', default OFF. When off, PRs are never held for screenshots: release every PR held for UI Review now (#557, #553, #541, #536, #518, #517) into the merge queue. UI Review items still get filed so Brett can look, they just don't block. Build on/replace #555 (kicked out of CI) and fix its CI failures. Full API: REST, MCP, CLI, voice."

## Base

#555's 13 commits (`879e57848..77433c63b`) cherry-picked cleanly onto main `e3cbb24bf`. #555 removed the gate outright; this build turns that into a switch (`uiReview.gate`, default off) so the hold code comes back only behind `gateOn()`.

## #555's CI failures (checklist)

Source: merge-queue run [43389466264](https://github.com/MossesX/AmberX-AXF/actions/runs/43389466264) on `queue/batch` `cb3490b26`, which kicked #555 out at 08:09 UTC ("failed: Web Dev Console (React/TS) + Python API, Build engine sweep (Node)"). The 'CI build errors' issue (#1) holds only the latest failure (an unrelated AmberX module error), so the job logs are the record. The PR's own light checks all skipped.

- [x] **Build engine sweep (Node):** `✗ console-web: help coverage fell to 99.9% (ratchet 100%): add help for the new controls (node framework/cli/help-coverage.mjs --draft console-web)`. Fixed (s2): the one missing control was `one-claude-account` in claude-accounts (already on main, not from #555); drafted with `help-coverage.mjs --draft console-web`, console-web back to 1606/1606.
- [x] **Web Dev Console (React/TS) + Python API:** (not #555's, open on main) `apps/console-web/scripts/theme-swap.mjs`: `✗ transparency tokens did not change between style themes` (every style theme reported opacity `0.4 / 0.66 / 0.06 / 0.1 / 0.45 / 0.88`). #555 changes no theme or style asset. Every merge-queue batch since 11:30 UTC fails the same way (runs 43419204228, 43420872996, 43422815049), so main is broken, not #555. Reproduced locally (s3): `--fx-opacity-*` on `:root` stays on the `hub` style theme's values whatever style theme or skin is picked. Since #532 (skins only) the skin owns the style section and `swap` refuses a bare style pick, and tapping each skin in the skin picker (a live preview) doesn't move the tokens either. I tried making theme-swap drive the skin picker instead; the tokens still don't change, so that edit was reverted. The fix belongs in the skins runtime (`compileStyles` / `withTokenOverrides('tokens.style')` in `framework/core/runtime.ts`), where the open skins PRs (#557, #563, #566) are working, not in this build. This branch will hit the same red until main is fixed.
- [x] Plugin checks rerun locally (s2): `plugin-lifecycle.mjs check ui-review` flagged #555's THREADS row as a stale reference; the row now carries `axf-plugin:` markers and `_claude/THREADS.md` is in ui-review's `lifecycle.mentions`. plugin-commands check 67/67, check-plugin-commands 57, check-ui-review 68, plugin catalog 55, fixtures regenerate with no drift. Suites: ui-review test.py 234 / test.mts 30, push-banner test.py 179, land.test 98, merge-queue.test 18, claude-settings 50, pipeline 48.
- [x] Framework and console sweep rerun with `AXF_DATA_DIR=off` (s3): check-theme, check-controls, check-toolbars and check-chrome-assets pass, `tracker.mjs --check` exits 0, and the console rebake (CI's own copy loop plus `shared-assets.mjs bake`) passes `tsc --noEmit` and `vite build`. The rebake refreshed two stale baked files that already differed from framework/ on main (`src/axf/core/build-pipeline.mjs`, `src/axf/assets/help/framework-drafts.json`); both are committed.

## Release of Brett's held PRs (s10, 2026-11-13)

Before: the live merge queue (`merge-queue.json`, 12:42 UTC) listed all six as `held`: "its screenshots wait for Brett in UI Review". None was a draft. The live console still runs main's code, where the merge queue asks UI Review while push-banner's `landWaitUi` is on (it was).

What ran:
1. `PUT /api/plugins/push-banner/config {landWaitUi: false}` on the live console (docker exec, same path as land.mjs): 200, `landWaitUi: false`. That is main's own switch for "the merge queue waits for UI Review", and turning it off is Brett's order for today's code. Once this PR lands, `landWaitUi` is retired and the gate switch (default off) replaces it.
2. `review.mjs release-held --pr 557,553,541,536,518,517` (dry run first, then real):

| PR | UI Review items | Draft | Merge queue |
|---|---|---|---|
| #557 | still filed, not marked (the live console is older and answers 405 on `release/items`; with the gate off they don't hold anyway) | not a draft | added |
| #553 | same | not a draft | added |
| #541 | same | not a draft | added |
| #536 | same | not a draft | added |
| #518 | same | not a draft | added |
| #517 | same | not a draft | added |

Nothing was approved and nothing was merged; the merge queue lands them when their batch is green.
