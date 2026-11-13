# fix-merge-conflicts-pr-557-professional (Opus, phase 1)

Brett (Nov 13 2026): "Alright, land that shit."

PR #557 (professional skins, skin@2) was 260 commits behind main with 12 conflicted files. Main had merged
look-migration@1 / skins-only (the theme, style and layout pickers folded into the skin) and five professional skins of
its own while the PR built skin@2 behaviour and four other professional skins. Merge commit `49cc956c1`, pushed to the
PR branch `claude/professional-skins-that-rebuild-the-whole-app-fable-ultrathink-every-step-e` (fast-forward) and to
`claude/fix-merge-conflicts-pr-557-professional`. Landing is the merge queue's job; nothing was merged by hand.

## Conflicts and how they were resolved

The console's baked copy (`apps/console-web/src/axf`) mirrors `framework/` on both sides, so each file was resolved in
`framework/` and copied over.

| File | Resolution |
|---|---|
| `core/engines/skin.ts` | Both export sets kept (skin@2 behaviour + look-migration@1 / skin sections). `skinSlotMap` existed twice (main in `skin-rules.mjs`, PR in `skin-coverage.mjs`): one definition now, in `skin-coverage.mjs`, with main's `behaviorTheme` section; `skin-rules.mjs` re-exports it (skin-rules already imports skin-coverage, so no cycle). |
| `core/runtime.ts` | Imports unioned. The per-scope skin view takes main's version (no design-package re-read, skins only) and keeps the PR's composed `behaviour`. In `swap()`, the PR's `swap('skin', …)` branch runs first, then main's "picked by the skin now" guard. |
| `libs/settings/index.tsx` | PR's behaviour overrides row kept; the style and layout theme rows stay removed (main, skins only). |
| `schemas/json/skin.schema.json` | Regenerated (`axf schemas`). Main had hand-added `behaviorTheme`; the generator (`build-engine.mjs` `skinSchemaProperties`) now emits it, and `asset-types.json` documents it. |
| `ui/axf.css`, `spec/PORTING.md`, `spec/gen-fixtures.mts` | Both sides kept. |

## Integration fixes (checks that failed after the merge, or on the PR alone)

- **Skin sections vs skin@2 coverage.** Main's `check-skin-sections` wants every professional skin to name all four
  sections; the PR's four skins had the behaviour preset in `assets['behavior-theme']`. Moved to `behaviorTheme`
  (command → instant, executive → executive, field → gentle, studio-pro → focused).
- **Main's five professional skins (atelier, clinic, control-room, ledger, newsroom)** fail the PR's strict
  `check-skin-coverage` (34 types each: no behaviour axes, no parts for 13 widgets, 13 unset slots). Bringing them to
  skin@2 is design work, not conflict work: they are tagged `partial` (reported, not failed). **Follow-up:** give them
  behaviour and full coverage, then drop the tag.
- **chrome-settings:** the PR added `bottom` to the layout `nav` enum but not to the nav-menu move positions (failed on
  the PR alone). Added; fixture regenerated.
- **Asset type order:** the PR put `table` after `tab-group` in `core/types.ts` but after `meter` in
  `asset-types.json` (the Kotlin order). TS now follows the JSON. Fixed check-agent-card, check-demo, check-job-type,
  check-scale (all failed on the PR alone).
- **check-hubsync:** its stub runtime lacked `appearanceLocalOnly()` (called by the PR's hubsync). Stub added.
- **check-design-language:** the PR's `field-day` colour theme had white on #e8590c (3.58:1). Accent text is now
  #101418 (5.17:1), same orange; copied to the four apps that bake it.
- **check-roller:** the roll is seeded off the layout enums, so `bottom` changed one note line; fixture rewritten.
- **Help coverage** (failed on main too): three new controls drafted, help copies synced.
- `gen-fixtures.mts` rerun: appearance, roll, theme, roller, chrome-settings fixtures moved with the type order and the
  theme change.

## Checks on the merged tree

Pass: every `framework/spec/check-*` except the ones below; `check-theme`, `check-controls`, `check-toolbars`,
`check-chrome-assets`, `check-banner-widgets`, `check-plugin-pages`, `tracker --check`, `plugins --check`,
`help-coverage --check`; console-web `tsc --noEmit`.

Not green here, and not from this merge (each fails the same way on a clean `origin/main` checkout, or needs a package
this VPS checkout does not have installed):
- `check-approval-expand`, `check-approvals-menu`, `check-help-mode`: need `jsdom` (CI installs it).
- `check-windows`: needs `react` resolvable from `framework/` (CI installs it).
- `check-headless-tabs` ("meter starts with the memory chain loaded"): fails on main too.
- `check-agent-slots`: 51/56 locally on main as well (live VPS lock state).

## API

No UI or API surface added by this build. The skin@2 surfaces are as described in PR #557 (REST, MCP, CLI `skins.mjs`,
console actions, deep link `settings/appearance/skin/<id>`). The `partial` tag only changes what CI reports.

## Android

No Kotlin work. PORTING.md now carries both deferred entries (skin@2 behaviour, look-migration@1).
