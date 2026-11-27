# Everything on tokens before skins

Build `everything-on-tokens-before-skins-fix-the-27-open-check-theme-problems-and-the`, Phase 1 (Opus), Nov 13 2026.

## Result

- `node framework/cli/check-theme.mjs`: passes, 1271 files. `check-controls`, `check-toolbars`, `check-chrome-assets`, `framework/spec/check-conform.mjs` (17 checks): pass.
- The 27 open check-theme problems and the `apps/player` Home.tsx raw button: already fixed on main before this build started (both checks passed at the branch point; `apps/player` no longer exists). Nothing to do.
- `framework/spec/conform-baseline.json`: **1,209 → 286**. All 923 web findings (the imported Expense app, `apps/expenses`) are gone. The 286 left are Kotlin (Android on hold), recorded as a deferred gap in `framework/spec/PORTING.md`.

## What changed

- **apps/expenses on the tokens (46 files).** scale-adopt plus a MUI-aware pass. In MUI `sx`, a bare `gap: 1` / `borderRadius: 1` is a theme multiple (8px), not px. A plain scale-adopt run turned `gap: 1` into a 1px hairline, so the MUI numbers went through as `n × 8px` first. Border widths now use `var(--fx-border-w)` (× n), opacities and fixed `color-mix` transparencies use `--fx-opacity-*`, box-shadow colours use `--fx-shadow`, and 14px text uses `--fx-font-size`.
- **Tokens resolve in the Expense app.** It doesn't run the framework theme engines (it vendors @axf/core 0.0.25 and has a self-contained Docker context). The new `framework/cli/vendor-tokens.mjs` generates `apps/expenses/vendor/axf-tokens/fx-tokens.css` from axf.css's `:root` defaults plus every scale token default, and `app/layout.tsx` imports it. The defaults (14px font, 8px space) match the bases the literals were converted from, so the look stays the same. The values become live assets when the app moves onto the engines.
- **Deliberate exceptions are marked, not hidden.** `check-theme` now accepts `theme-ok-begin` … `theme-ok-end` blocks (self-test added). Marked:
  - the exported report's baked stylesheet and fallback palette (a standalone HTML file with no engine)
  - the Amber and AXS Studio branding-pack palettes (asset definitions)
  - default category and avatar colours (user data)
  - doc comments that quote measured hex values

## Not done

- **Kotlin, 286 findings** (285 `.dp` literals, 1 `Color(0x…)`), in `framework/android` and `apps/console`. The standing rule is no new Android/Kotlin work. There is also no Kotlin/Android toolchain here, and `Axf.space` is a `@Composable` getter, so a blind rewrite could break the Android build. Recorded in PORTING.md with the exact follow-up.
- **No type-check or browser run of apps/expenses.** It has no installed node_modules here, and an install is a heavy step. The edits are string values in MUI `sx`/style objects, so the type risk is low.

## API

There's no new UI surface: this build only moves existing styling onto tokens. The token values are driven through the existing control@1 token API (MCP), console REST, CLI and voice paths, as before.
