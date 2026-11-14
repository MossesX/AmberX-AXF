# merge-main-land-console-app-part-4

Build: Merge main and land `console-app-part-4-console-side-safe` (PR #640). Phase 1, Opus.

Brett (2026-11-14 23:16): "split the console wrapper so it runs on four slots at the same time; AmberX's banner was behind the camera, the clock and the notification panel. Merging main into claude/console-app-part-4-console-side-safe clashes in code: framework/ui/axf.css"

## Result
- Merged `origin/main` into `claude/console-app-part-4-console-side-safe` (b4d0a0479, fast-forward push from f4b2a8215).
- `framework/ui/axf.css` merges cleanly now: earlier merges of part 3 into part 4 had already brought in both blocks (the safe-area tokens and layers, plus the skin animations), so this time git found no conflict. No other files conflicted.
- Feature (s8): unchanged. PR #640 still pads every edge-fixed layer with `--fx-safe-*`, so nothing sits under the camera, clock or notification panel. API reach is listed in the PR (`native.*` console actions through REST, MCP, CLI and voice; state on `panel:phone-app`).

## Checks on the merged tree
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-safe-area: pass.
- `node --test` check-safe-area.test, push-banner land.test, nativeRules.test: 3/3 pass.
- `tracker.mjs --check`: passes against the repo's status.json (`AXF_PERSIST_DIR=off`, the same data CI uses). On this VPS it fails only because the host data dir status.json does not have the two new ids from this PR yet (`cx.phoneweb`, `cx.phonebridge`). That fixes itself once the PR lands and the data dir syncs. Main passes either way.
- Regenerated tracker.json, plan.json and libraries.json differed only by timestamp, so they were not committed.

## Landing
Not merged by hand. Auto-land and the merge queue land #640; attempt 1 is this push.
