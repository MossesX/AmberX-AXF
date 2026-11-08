<!-- memory-chunk@1 source=_claude/memory/docs/ui-all-assets.md lines=5-17 tokens=473 -->
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
