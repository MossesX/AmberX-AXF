# One place changes everything — typography@1, density@1, sizing@1 (Angel `ui-all-assets`)

Brett, Oct 30 2026: "Any part of the UI that needs to be an asset in order to be changed, make an asset out of it… change it in one place, changes it everywhere. I want the whole framework and all the apps and plugins built on it to follow the same code." Slimmed (voice, then "Run that now") to three broad assets. Each app gets one update to read them; after that every change comes live from axHub.

## The three assets (Fable, s1–s2, Oct 30 2026)
| Type | Owns | Tokens |
| --- | --- | --- |
| `typography` | text scale xs–xl, headings h1–h4 + tracking, weights body/medium/strong, line heights, eyebrow (size, weight, tracking, case), mono size | `--fx-type-<group>-<field>` |
| `density` | gaps xs–xl, paddings control/card/page/row/cell (× `--fx-space`), row heights list/table/menu/control (× font size) | `--fx-dens-<group>-<field>` |
| `sizing` | button, iconButton, chip (+ radius sm/md/pill), field, tab, segment, card (+ radius sm/md/lg), listRow, countStrip, table, pageHead (description font + lines) | `--fx-size-<group>-<field>` |

- Rules in ONE place: `framework/core/engines/scale-rules.mjs` (`SCALE_FIELDS`: `[default, min, max, unit]`; `SCALE_ENUMS`); typed face `scale.ts`. Both validators (core + build engine) call the same `scaleErrors`; the JSON schemas come from the same registry; the fixture `spec/fixtures/scale.json` is what every port replays.
- Every default = the framework's look as merged on Oct 30 (compact frame), so an app with no asset, or an asset that sets one value, changes nothing else. Unknown fields are ignored (open registry: add fields, never types).
- Starters (`framework/assets/<type>/`): `compact` (= defaults) for all three; `typography` classic / reader; `density` classic / roomy / dense; `sizing` classic / touch. `framework/defaults.json` names `compact`.
- Live everywhere: the three are shared appearance slots, so the axHub look document (`shared/settings/appearance.json`) carries them; an app that ships the asset id follows, one that doesn't keeps its default and reports it. A design package names them in `extras.slots`. Not style-package members.
- Runtime: `compileStyles` adds `scaleThemeVars(...)` after the style theme. Settings → Appearance → Assets lists the three pickers automatically (asset_slot per registered type).

## Still to do (Opus, s3–s5)
- s3 adopt: `framework/ui/axf.css` (incl. the Oct 30 compact block), `framework/libs/settings` compact CSS, `apps/console-web/src/console.css` count strips, React components + libs (incl. `framework/libs/mcp` pages) read only the new tokens; delete the hard-coded sizes they replace.
- s4: plugins' duplicated sizes → the tokens; copy the starters into every app's `src/assets` + name `compact` in each `axf.manifest.json` defaults (console, AmberX, axHub web, Walkthrough Studio, demo; Patches paused); Settings → Appearance shows the three as compact dropdown rows.
- s5: `check-theme` flags hard-coded sizes that a scale token covers; `theme-swap` swaps the three types; re-bake; screenshots; report.
