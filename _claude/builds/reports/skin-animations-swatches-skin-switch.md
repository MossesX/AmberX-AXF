# Skin animations: swatches, skin-switch sweep, picker (skin-animations-swatches-skin-switch)

Built Nov 13 2026 on Opus, branch `claude/skin-animations-swatches-skin-switch`.

Brett: "where can I put some cool animations, like color swatches; make a separate build right now"

## Where the animations go
In the skin. Every skin's **behaviour theme** (`framework/assets/behavior-theme/<id>.json`, `data.motion`) now carries
its own animation set, so swapping the skin swaps the animations:

- `swatches` wave | ripple | pop | off: colour swatch rows (skin cards in the skin picker, the Animations preview)
- `skinSwitch` ripple | sweep | fade | off: switching skins, the new colours grow out of where you tapped
- `picker` fan | pop | off: colour pickers, the picked swatch pops and fans out into five shades, the colour morphs
- `animSpeed` 25 to 400 (percent) and `animIntensity` 0 to 100 (0 = still)

The engine compiles them to tokens: `--fx-anim-dur`, `--fx-anim-sweep-dur`, `--fx-anim-stagger`, `--fx-anim-ease`,
`--fx-anim-pop-ease`, `--fx-anim-intensity` (all derived from `--fx-motion`) plus `data-fx-anim-*` attributes. The one
keyframe block is in `framework/ui/axf.css` ("Skin animations"), tokens only. Reduced motion (system, or a skin's
`reduced: always`) and intensity 0 stop all of them. How to add another animation: `framework/spec/THEMING.md` →
"Skin animations: where they go".

## What changed
- **Engines:** `core/engines/animation-rules.mjs` (fields, picks, state; shared by runtime and CLI),
  `core/engines/behavior.ts` (fields in BEHAVIOR_ENUMS / RANGES, `skinAnimationVars`, `withAnimationPrefs`,
  `animationState`), `core/engines/swatches.ts` (`shadesOf`, `mixHex`, `skinSwatches`, `sweepOrigin`). Build-engine
  validator copy and asset-types description updated.
- **Components:** `Swatches` (a palette row that waves on hover / focus / tap; `data-fx-swatch-host` on a parent plays
  it) and `SwatchFan` (colour pick that pops and fans out), exported from `react`.
- **Skin cards:** the skin picker (Settings → Appearance → Skin → Choose…) shows each skin's palette as an animated row.
- **Skin switch:** the runtime paints every look change (skin on/off, preview in the picker, Back to skin, colour theme
  inside a skin, colour-theme swap) through the View Transitions API: ripple from the last tap, sweep away from the tap
  side, or fade. No View Transitions support = it snaps as before.
- **Colour pickers:** `ColorField` (Theme editor, plugin themes), colour settings, Theme manager's token tree and the
  asset Explorer use `SwatchFan`.
- **Per skin:** fluid, calm, alert, precise, quiet, playful, cinematic, snappy carry their own set; minimal-motion and
  instant are still. Atelier ripples, Control room sweeps, Clinic fades.
- **Settings → Appearance → Animations:** a live preview row, each animation on/off and its style ("Skin's (…)" keeps the
  skin's), speed and intensity sliders, Back to skin. Stored as `axf.appearance.animations` in the app's look document.

## API (all four the same)
- Deep link: `console.settings act open appearance` (MCP `console_show` / `console_open` target `settings/appearance`), or
  the action `animations.open`; the section carries `data-axf-settings-section="animations"`.
- Actions (console.actions run → REST `POST /api/control`, MCP `control`, CLI `axf control act console.actions run …`,
  voice through the catalog): `animations.set:<key>:<value>`, `animations.off[:<key>]`, `animations.reset`,
  `animations.state` (reads them out), `animations.open`.
- Runtime: `rt.animations()`, `rt.setAnimation(key, value)`, `rt.resetAnimations()`.
- CLI without a console: `node framework/cli/animations.mjs state|set|off|reset <app> … | options` reads and writes the
  app's look document on the hub; open apps follow through the change feed.

## Tests
- `npx -y tsx framework/spec/check-skin-animations.mts`: 80 checks passed (fixture replay, rules, every behaviour theme valid, runtime API + actions, CLI, tokens-only CSS, reduced motion). Added to CI.
- `npx -y tsx framework/spec/check-design-package.mts`: 1158 checks passed
- `npx -y tsx framework/spec/check-skin.mts`: 313 + 356 checks passed
- `npx -y tsx framework/spec/check-appearance.mts` 108 passed · `check-appearance-lock.mts` 27 passed · `check-settings-ui.mts` 55 passed · `check-roller.mts` 138 passed · `check-customize.mts` 163 passed · `check-scale.mts` 496 passed · `check-looktokens.mts` 195 passed · `check-console-control.mts` 290 passed · `check-mcp.mts` 210 passed
- `node framework/spec/check-skin-colour-rule.mjs`, `check-skin-sections.mjs`, `check-skin-coverage.mjs`: ok
- `node framework/cli/check-theme.mjs` (1288 files), `check-controls.mjs`, `check-toolbars.mjs`, `check-chrome-assets.mjs`: pass
- `node framework/cli/help-coverage.mjs --check`: pass (help synced to the app copies; one missing molly-guide tab drafted)
- `npx tsc --noEmit` in apps/console-web: clean
- `npx -y tsx framework/spec/gen-fixtures.mts`: new `fixtures/skin-animations.json`, no other fixture changed
- `check-help-mode.mts`: not run (jsdom is not installed in this sandbox)

## Still open
- UI Review shots: not taken. The headless console waits for axHub, which this sandbox can't reach, so every capture was the "Waiting for axHub" card. Needs a session with hub access: shots of Settings → Appearance → Animations and the skin picker, desktop and phone.
- The Skins plugin (branch `claude/skins-plugin-own-removable-console`) is not on main yet; when it lands, its skin cards should render `Swatches` (one line, same as the built-in picker).
- Kotlin twin deferred (framework/spec/PORTING.md → "Deferred: skin animations").
- Skin switch through View Transitions applies the colour change one frame later in the browser; callers that read state synchronously after `swap('color-theme', …)` in a browser see it after that frame (node and tests are unchanged).
