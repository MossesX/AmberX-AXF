# Tab groups: choose how many rows of tabs

Build `tab-groups-choose-how-many-rows-tabs` · Phase 1 · Opus · branch `claude/tab-groups-choose-how-many-rows-tabs` · PR #623

## Brett said (verbatim, Nov 13 2026 17:51)
> I want to be able to select how many rows it is so you can stack tab groups, so it fits on the page without scrolling to the right, you can say three and it will list three rows of tabs

## Result
Every tab group has a **Rows** setting, saved per tab group: 1 (default, same as today), 2–6, or Auto. With a number, the tabs are split evenly across that many rows (perRow = ceil(tabs / rows)). Auto wraps them at their natural width. Either way no row scrolls sideways. Measured with the harness at 1280 and 390 px wide: Rows 3 → 3 lines, Rows 2 → 2, Auto → 1 line on desktop and 3 on phone. None of them scroll sideways. Rows 1 on phone still scrolls, as it does today.

## Steps
- s1: the engine field plus helpers, TabGroup layout, CSS on tokens, actions, control state, help, fixtures, specs, PORTING gap, synced baked copies. Commit 4e50ec800.
- s2: checked against Brett's words at desktop and phone width. Shots are in `shots/`. Regenerated the control inventory so it lists `tabs.rows`.
- s3: tests, this report, THREADS row, PR #623.

## How to reach it
| Surface | How |
|---|---|
| UI | right-click / long-press a tab row → Settings… → Look → Rows |
| Deep link | `chrome.settings:tab-group:<row id>` |
| State | `tab:<row id>` control target state `.rows`; Settings → Appearance → Assets with edits |
| REST / MCP / CLI | `chrome.set:tab-group:<row id>:rows:<1-6\|auto>` or `tabs.rows:<row id or words>:<n>` (console_action; `axf console action tabs.rows settings 3`) |
| Voice | "make the settings tabs three rows" → `tabs.rows:settings:3` (`matchTabGroup` + `parseTabRows`) |

## Design choices
- `rows` is an **instance-only** chrome-settings@1 field, set up the same way as `tapConfirm`. The tab-group@1 asset type and asset-types.json are unchanged, so no schema step was needed and this stayed on Opus.
- Left and right rails and dropdown rows ignore Rows, because they never scroll sideways. When Rows is above 1, the "More" overflow menu is turned off, so every tab is visible, the active one included.
- Drag-reorder still works across rows: each tab is its own drop target, and the drop side uses the horizontal midpoint.

## Tests
check-chrome-settings 295 ✓ · check-tab-group 445 ✓ · check-tapconfirm 80 ✓ · check-asset-overrides ✓ · check-theme ✓ · check-controls ✓ · check-toolbars ✓ · check-chrome-assets ✓ · console-web tsc ✓.
check-help: the framework help is the same in every copy. It still fails on help coverage (99.6%) because of controls already on main in other plugins (approvals-banner, molly-guide). That is not from this build.

## Gaps
- Kotlin twin deferred (PORTING.md).
- The UI Review item is local only. This headless session has no `AXF_CONSOLE_URL` / `AXF_TOKEN`, so `review.mjs submit --console` couldn't upload the shots. To fix: give dispatched build sessions those two env vars, then re-run the submit command in the PR.
- The shots come from a harness (the real runtime tokens, axf.css and engine output in TabGroup's markup), not the live console, because the console needs axHub sign-in.
