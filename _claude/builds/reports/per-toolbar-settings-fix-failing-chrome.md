# Per-toolbar settings: fix failing chrome-settings check and land

Build `per-toolbar-settings-fix-failing-chrome`. Brett, 2026-11-13 20:08: "land the per-toolbar, tab group and menu settings".

## Result

Landed. PR #650 merged into main on 2026-11-13 20:44 UTC (merge commit `ec579ee23`). It carried #642 (per-toolbar, tab group and menu settings), and #642 is also shown as merged.

## Phases

- **s1 (Fable):** brought #642 up to date with main. `framework/spec/gen-fixtures.mts` now writes the per-instance chrome-settings fixture sections (`keys.instanceInterface`, `instancePicks`, `instanceInterfaces`, `prefixTargets`, `instanceSlugs`). Regenerating the fixture had dropped these sections because they were only in the hand-edited file, and that broke `check-chrome-settings`.
- **s2 (Opus):** landed. The merge queue had already merged #650 when this phase started, so no code changes were needed. Checked on current main.
- **s3 (Opus):** this report and the THREADS row.

## Verification (current origin/main)

| Check | Result |
|---|---|
| `npx tsx framework/spec/check-chrome-settings.mts` | ✓ chrome-settings@1: 304 checks |
| `node framework/cli/check-toolbars.mjs` | ✓ 442 files |
| `node framework/cli/check-chrome-assets.mjs` | ✓ within baseline (25 left over in 18 files, unchanged) |

## API reach

This build added no UI of its own. It landed #642 and fixed its fixture generator. The API reach for the per-instance settings UI is described in #642.

## Still open (Fable, separate build)

- A per-instance transparency field on every chrome kind.
- A `dialog` chrome kind.

Already broken on main and not caused by this build: the `check-help` gizmo-guide tab, drift in the baked `framework-drafts.json`, and a stale bake lock.
