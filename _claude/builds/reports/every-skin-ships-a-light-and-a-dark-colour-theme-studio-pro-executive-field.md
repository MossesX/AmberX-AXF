# Every skin ships a light and a dark colour theme: per-skin quick switch, Default included

Follow-up to `every-skin-ships-light-dark-colour-theme` (#590, on main): that build made every skin carry
`colorThemes: { light, dark }`, added skin-modes@1, `check-skin-modes` and the CLI / REST / voice `mode`. It left two
gaps, closed here: no light / dark control in the Skins UI, and nothing for the Default look (no skin, or a design
package such as the console's `amberx-signature-night`, which refused with "use a skin first").

## What shipped
- Engine (skin-modes@1, pure): `defaultModePair(themeSwitches, colorThemes)` gives the Default pair from the app's
  `theme-switch` (falls back to the first light and first dark colour theme). `skinModeState(...)` returns
  `{ skin, mode, scheme, theme, light, dark }`. Types are in `skin-modes.d.mts`.
- Runtime: `setSkinMode` works without a skin. With nothing in force it swaps the app's own colour theme. With a design
  package in force it picks the Default pair inside the package. `skinModeState()` reads where the page stands, and
  `skin.mode` with no argument toggles from it. `system` keeps following `prefers-color-scheme`. Mirrored into the
  console's baked `src/axf/core` (the console is "edited" per `rebake.mjs status`, so it can't be rebaked automatically).
- UI: a Light / Dark / System switch (framework `Segmented`, `web/ModeSwitch.tsx`) in the Skins banner chip's popover
  and on the Skins screen. It works for every skin and for Default. Target: `[data-axf-target=skin-mode]`.
- CLI: `skins.mjs mode <app>` / `mode <app> light|dark|system` handle Default and design packages. `skins.mjs modes`
  lists a `default` row first.
- CI: `check-skin-modes` now also fails if Default lacks either scheme. It has new engine cases for the pair fallback
  and the state.

## How each is reached (parity)
- Deep link: `#/skin-gallery` (the switch sits under the action bar). `console_open skin-gallery`.
- State: `GET /api/plugins/theme-manager/skins/{app}/mode` / `skins.mjs mode <app>` / in-app `rt.skinModeState()`.
- Switch: `POST /skins/{app}/mode {mode, system?, scope?}` (theme-manager). MCP gets it automatically through
  plugin-commands. Also `skins.mjs mode <app> dark`, console action / voice `skin.mode:light|dark|system`, and
  `skin.mode` alone toggles. "Make the console dark" calls the same action.
- List: `GET /skins/modes` / `skins.mjs modes`. Default comes first, then every skin.

## Studio Pro, Executive, Field, Command
These four skins are not on main. They live in the unmerged professional-skins PRs #604 / #591, flagged in
`land-all-skin-builds.md` as needing their own Fable build. Nothing here was invented for them. When they land,
`check-skin-modes` fails until each one carries `colorThemes` (studio-pro-slate, executive-ivory, field-day,
command-phosphor each need a partner of the other scheme). That is the coverage rule working as intended.

## Checks
check-skin-modes (Default + 6 skins), check-skin-coverage (55 types, 0 uncovered), check-theme, check-controls,
check-console-commands (101), theme-manager test.py (56), skin-gallery test.py, console-web `tsc --noEmit` clean.

## Not done
- No UI Review shots: headless can't sign in to the console. The switch uses only the framework `Segmented` control and
  existing layout classes.
- Light / dark for a screen or plugin scope under Default is refused with a clear message. Default is app-wide.
- Android twin deferred (`framework/spec/PORTING.md`, skin-modes section).
