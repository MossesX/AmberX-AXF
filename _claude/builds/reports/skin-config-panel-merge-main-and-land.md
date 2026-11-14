# Skin config panel: merge main and land

Brett, Nov 13 2026: "land the skin config panel".

## Result
Landed. PR [#648](https://github.com/MossesX/AmberX-AXF/pull/648) merged into main on 2026-11-14 20:15 UTC
(merge commit `42d28acfe`). The original PR #547 (`claude/skin-configuration-panel-before-ai-makes`) is closed in
its favour.

## Phases
- **Phase 1 (Fable):** merged main (800 commits ahead) into the skin configuration panel branch and resolved the ten
  clashes, keeping main's newer code plus the panel: CI workflow checks, build-engine schema writers, PORTING.md
  deferred-twin notes, the settings library and its four app copies (main's Appearance "Skin" panel plus the Skin
  config sub-tab), theme-manager plugin.json and web entry. Help entries for the six Skin config controls brought
  help-coverage back to 100%. VetoHost gained the members CI's rebake needed. Commit `263b8974f`.
- **Merge queue:** the branch was restacked on `land/skins-plugin` (help packs rebaked, Skins plugin banner
  contribution declared, head `0c23f110d`) and merged.
- **Phase 2 (Opus):** s2 confirmed the panel is on main (`framework/libs/settings/SkinConfigPanel.tsx`, the
  `skin-config-*` settings assets, theme-manager routes, CI checks). s3: checks re-run on main, this report, the
  THREADS row.

## Checks on main (Nov 14)
- `node framework/spec/check-skin-config.mjs`: 38 checks passed (1147 options in the real tree)
- `node framework/spec/check-skins-config-cli.mjs`: 9 checks passed
- `apps/console-web/plugins/theme-manager/test.py`: 56 checks passed
- `node framework/cli/check-theme.mjs`, `check-controls.mjs`: pass

## How it is reached
Nothing new in this build. The Skin config panel's API was already complete (REST, MCP plugin commands,
`skins.mjs config`, actions `skin.config.*`, deep link `settings:appearance/skin-config`), see
`_claude/builds/reports/skin-configuration-panel-before-ai-makes.md`.

## Open
- UI Review `r-20261113-46228a31`: Brett picks one of the three layouts (tree, two columns, chips).
- Kotlin twin of skin-config@1 is still deferred (framework/spec/PORTING.md).
