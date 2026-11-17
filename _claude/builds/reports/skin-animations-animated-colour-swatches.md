# Skin animations follow-up (skin-animations-animated-colour-swatches)

Built Nov 17 2026 on Opus, branch `claude/skin-animations-animated-colour-swatches`.

Brett: "where can I put some cool animations, like color swatches; make a separate build right now"

## Result
This build duplicates `skin-animations-swatches-skin-switch` (PR #652, merged Nov 14), which already shipped every
step: token-driven animations with reduced motion (s1), swatch rows in the built-in skin picker (s2), the skin-switch
ripple / sweep (s3), `SwatchFan` colour pickers (s4), per-skin animation sets + Settings → Appearance → Animations
(s5), and the full API (s6). Its report: `_claude/builds/reports/skin-animations-swatches-skin-switch.md`.

The one gap: the **Skins plugin** gallery (`apps/console-web/plugins/skin-gallery`) landed after #652 and its cards had
no swatches. Fixed here:

- `framework/cli/skins.mjs` `skinRows()` now gives every row its `colorTheme` (skins, design packages, Default skins,
  made skins), so the plugin's `GET /skins` route, CLI `skins.mjs list` and MCP get it too.
- `SkinsScreen.tsx`: each card shows the skin's palette as a joined `Swatches` row (`skinSwatches` from the colour
  theme's tokens); the card is a `data-fx-swatch-host`, so hovering or tapping it plays the skin's swatch animation.
  Tokens only, reduced motion respected (the shared keyframes in `framework/ui/axf.css`).

## API
Unchanged from #652 (all four the same): deep link `#/skin-gallery?skin=<id>` / `console_open skin-gallery focus
skin/<id>`; the swatch animation style, speed and on/off are `animations.set:swatches:<wave|ripple|pop|off>`,
`animations.off`, `animations.state` (REST `/api/control`, MCP `control`, `node framework/cli/animations.mjs`, voice).
Each row's colours are readable through `GET /api/plugins/skin-gallery/skins` (`colorTheme`).

## Tests
- `npx -y tsx framework/spec/check-skin-animations.mts`: 82 checks passed (2 new: plugin cards draw Swatches; every skin row names its colour theme)
- `npx -y tsx framework/spec/check-skin.mts`: 473 + 500 passed
- `node framework/cli/check-theme.mjs`, `check-controls.mjs`, `check-console-control.mjs`: pass
- `tsc --noEmit` in apps/console-web: clean
- Not run: Playwright theme-swap (no visual change to colours outside the swatch data).
