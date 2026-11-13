# UI Review gate switch, default off

Build: `ui-review-gate-switch-default-off` · branch `claude/ui-review-gate-switch-default-off` · replaces #555.

Brett (2026-11-13 12:14): "UI Review must not be a gate. Add an on/off switch in UI Review settings, 'UI Review is a merge gate', default OFF. When off, PRs are never held for screenshots: release every PR held for UI Review now (#557, #553, #541, #536, #518, #517) into the merge queue. UI Review items still get filed so Brett can look, they just don't block. Build on/replace #555 (kicked out of CI) and fix its CI failures. Full API: REST, MCP, CLI, voice."

## Result

UI Review is no longer a merge gate unless Brett turns it on. New switch *UI Review is a merge gate* in Settings → Plugins → UI Review, at the Simple level, **default off**. Off: every item is still filed for Brett to look at, and no PR waits or stays a draft for it. The six PRs held for UI Review were released into the merge queue. This replaces #555, which removed the gate outright and was kicked out of the merge queue.

## Base

#555's 13 commits (`879e57848..77433c63b`) cherry-picked cleanly onto main `e3cbb24bf`. #555 removed the gate outright; this build turns that into a switch (`uiReview.gate`, default off) so the hold code comes back only behind `gateOn()`.

## #555's CI failures (checklist)

Source: merge-queue run [43389466264](https://github.com/MossesX/AmberX-AXF/actions/runs/43389466264) on `queue/batch` `cb3490b26`, which kicked #555 out at 08:09 UTC ("failed: Web Dev Console (React/TS) + Python API, Build engine sweep (Node)"). The 'CI build errors' issue (#1) holds only the latest failure (an unrelated AmberX module error), so the job logs are the record. The PR's own light checks all skipped.

- [x] **Build engine sweep (Node):** `✗ console-web: help coverage fell to 99.9% (ratchet 100%): add help for the new controls (node framework/cli/help-coverage.mjs --draft console-web)`. Fixed (s2): the one missing control was `one-claude-account` in claude-accounts (already on main, not from #555); drafted with `help-coverage.mjs --draft console-web`, console-web back to 1606/1606.
- [x] **Web Dev Console (React/TS) + Python API:** (not #555's, open on main) `apps/console-web/scripts/theme-swap.mjs`: `✗ transparency tokens did not change between style themes` (every style theme reported opacity `0.4 / 0.66 / 0.06 / 0.1 / 0.45 / 0.88`). #555 changes no theme or style asset. Every merge-queue batch since 11:30 UTC fails the same way (runs 43419204228, 43420872996, 43422815049), so main is broken, not #555. Reproduced locally (s3): `--fx-opacity-*` on `:root` stays on the `hub` style theme's values whatever style theme or skin is picked. Since #532 (skins only) the skin owns the style section and `swap` refuses a bare style pick, and tapping each skin in the skin picker (a live preview) doesn't move the tokens either. I tried making theme-swap drive the skin picker instead; the tokens still don't change, so that edit was reverted. The fix belongs in the skins runtime (`compileStyles` / `withTokenOverrides('tokens.style')` in `framework/core/runtime.ts`), where the open skins PRs (#557, #563, #566) are working, not in this build. This branch will hit the same red until main is fixed.
- [x] Plugin checks rerun locally (s2): `plugin-lifecycle.mjs check ui-review` flagged #555's THREADS row as a stale reference; the row now carries `axf-plugin:` markers and `_claude/THREADS.md` is in ui-review's `lifecycle.mentions`. plugin-commands check 67/67, check-plugin-commands 57, check-ui-review 68, plugin catalog 55, fixtures regenerate with no drift. Suites: ui-review test.py 234 / test.mts 30, push-banner test.py 179, land.test 98, merge-queue.test 18, claude-settings 50, pipeline 48.
- [x] Framework and console sweep rerun with `AXF_DATA_DIR=off` (s3): check-theme, check-controls, check-toolbars and check-chrome-assets pass, `tracker.mjs --check` exits 0, and the console rebake (CI's own copy loop plus `shared-assets.mjs bake`) passes `tsc --noEmit` and `vite build`. The rebake refreshed two stale baked files that already differed from framework/ on main (`src/axf/core/build-pipeline.mjs`, `src/axf/assets/help/framework-drafts.json`); both are committed.


## What changed

- **One value:** `uiReview.gate` (UI Review) = the Claude setting `builds.uiReviewGate`, read and written through `axf.claude-settings@1` (`server/gate.py`, with a copy in UI Review's data folder for when Claude settings is off). Default off, and a missing value is off. A one-time migration (`ui-review-gate-off` in claude-settings `core.mjs`) turns an old stored `true` off; a later choice by Brett stays. The setting changed from owner-only to `owner: "raise"`, which now also covers toggles: anyone may turn it off, only Brett's own console click turns it on (Brett asked for exactly that split).
- **One decision:** `gateOn()` / `gate_on()`. `review_state` (Python) and `reviewState` (Node) return `review` (the real status), `state` (`filed (not a gate)` while off), `gate` and `holds` (only while on, and never for a released `nonBlocking` item). `ui-review@1` gains `held()` and `gate_on()`; `hold` / `holds` / `isHeld` follow the switch. `review.mjs state --exit-code` exits 1 only while the gate is on and the PR is held.
- **Merge queue, auto-land, Merge:** push-banner `ui_hold` asks UI Review only while the gate is on; `GET ui-hold` with no PR answers `{gate}`. `merge-queue.mjs` and `land.mjs` ask the gate once a round and per PR only while it is on (`notReady` / `blockReason` take `waitUi` again). `landWaitUi` stays retired: the switch replaces it. Open PR, auto-land and the merge queue open PRs with `draft: false`.
- **UI:** a framework `Switch` in a *Merge gate* panel, with the status line "Off: items are filed for you to look at, PRs never wait." The framework gained `SettingsTab.level` and `SettingsPanel.level` (copied into the baked apps; the Android twin is recorded as deferred in PORTING.md) so the tab and panel show from Simple.
- **release-held** (new): the open items become `nonBlocking` (still filed, status kept, a history line), a draft PR is marked ready for review, and the PR is added to the merge queue through the command `mergequeue-add`, found in the plugin-commands registry (not by folder). There is a dry run, and it never merges. On the VPS host, `--console` falls back to the console container (docker exec), like land.mjs.
- **Docs:** the shared rule "Every UI change goes to UI Review" (`_claude/shared/rules/RULES.md`), the CLAUDE.md line, the UI rules brief (`rules-briefs.json`), the ui-review README, help.json and `memory/decisions.md`. `claude-sync sync` ran.

## API (every action and setting, all four transports)

| What | Deep link | REST | MCP | CLI | Voice / console action |
|---|---|---|---|---|---|
| Read the switch | `console_show` target `settings:plugins/ui-review`, highlight `#gate` | `GET /api/plugins/ui-review/gate` → `{on, heldPrs, openReviews, line, who}` | `ui_review_gate_get` | `review.mjs gate [status] [--console]` | `uireview.gate` / `ui-review.gate` |
| Turn it on / off | same | `POST /api/plugins/ui-review/gate {on}` (on: Brett only, else 403) | `ui_review_gate_set` | `review.mjs gate on\|off [--console]` (on is refused outside the console) | `uireview.gate on\|off` |
| As a settings key | Settings → Plugins → UI Review | `GET\|PUT /api/plugins/ui-review/settings` `uiReview.gate` | `ui_review_settings` / `ui_review_settings_set` | — | — |
| Claude setting | Settings → Plugins → Claude | claude-settings `PUT settings` `builds.uiReviewGate` | `claude_settings_get` / `claude_settings_set` (off only) | `claude-settings.mjs get` | — |
| Release held PRs | — | `POST /api/plugins/ui-review/release {prs\|all, dryRun}`; `POST release/items` (items only) | `ui_review_release`, `ui_review_release_items` | `review.mjs release-held [--pr n…] [--all] [--dry-run]` | `uireview.release 557 553 \| all` / `ui-review.release` |
| PR state | — | `GET /api/plugins/ui-review/state?pr=` | (plugin read) | `review.mjs state --pr n --exit-code` | — |

## Tests

- ui-review: test.py 246 (gate off by default, filed-not-a-gate state, personOnly 403 on turning it on, held while on, release/items dry run and real, REST = CLI = action object, MCP tool names), test.mts 33 (gateOn defaults, `--exit-code` 0/1 in both states, release-held dry run and real against a fake GitHub, queue route found by command id)
- claude-settings: test.mjs 54 (default off, migration, only Brett turns it on, anyone turns it off), test.py 21
- push-banner: test.py 181 (ui_hold both states, `GET ui-hold` gate), land.test 104 (blockReason both states, a gate-on round), merge-queue.test 18 (`notReady` both states)
- pipeline 48, check-ui-review 68, check-ui-predict 12, check-headless-context 38, check-plugin-commands 57, plugin catalog 55, help coverage 100%, glossary complete, tracker --check ok; check-theme, check-controls, check-toolbars and check-chrome-assets pass; console `tsc --noEmit` and `vite build` are clean after a rebake.
- Local engine sweep: every step passes except `check-profiles` (a git-ignored local `_claude/builds/profiles/breakroom/`), `check-agent-slots`, `claude-login.test` and `claude-token-save.test`. The last three give the same results on a clean main checkout on this VPS (the shared slot lock and the saved logins here), so this machine causes them, not this branch.

## UI Review

Item `r-20261113-c78d9cf9`, group "ui-review-gate-switch-default-off - Nov 13 1:20 PM": three settings options (`ui-review-gate-switch-panel`, `-compact`, `-with-reviews` in `apps/console-web/plugins/ui-review/assets/settings/`), desktop and phone each. Option A is the built panel; B and C are predicted looks of the same panel. With the gate off it is filed and does not hold this PR.

## Merge queue after the release (13:21 UTC)

#557, #541, #518, #517 waiting; #536 testing in a batch; #553 kicked out by CI (Web Dev Console + Build engine sweep, the same two jobs main fails on, see below). None says "held" any more.

## Open on main (not this build)

Every merge-queue batch since about 11:30 UTC fails the Web Dev Console job on `theme-swap.mjs`: `--fx-opacity-*` on `:root` stays on the `hub` style values whatever style theme or skin is picked. That is a skins-runtime problem from #532. This PR will hit the same red in its batch until it is fixed.

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
