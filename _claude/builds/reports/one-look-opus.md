# one-look-opus — one default look from axHub, design theme precedence, selection-only Appearance

Brett, Nov 1 2026: "How come the refactor didn't compress banners. I need a new default style and color theme that
GizmoX, amberx, and axhub all inherit from axhub. Change in one changed all. Then I need the 2 new themes to be
combined into a default design theme. When a design theme is loaded the individual style and color themes are not
applied. Only when something changes is the design pack overridden with the individual packs. Remove all appearance
and theme editing abilities from the settings interface that is read from axHub and changes every apps interface only
allow selecting design, style, and color themes." Then: "Build it on opus now fable later" and "I only wanted it
removed from settings for the apps not plugins" and "The banner plugins are supposed to store their style and colors
on a hub so they render the same everywhere."

Built on Opus in a claude.ai session (the VPS Claude account hit its weekly limit until Tue Nov 3; the headless
`one-look-default` (Fable) and `one-look-opus` runs died in 1 s at $0). Branch `claude/one-look-opus`.
Apps: GizmoX AI Studio (Dev Console, `apps/console-web`), axHub web (`apps/axhub-web`), AmberX (`apps/amberx-droid`).

## 1. Why the banners didn't compress

| Cause | Before | After |
|---|---|---|
| Banner defaults (`DEFAULT_BANNER_PREFS`, `react/components/BannerSettings.tsx`) | density `regular`, launch `expanded`, height = the banner's own (no cap) | density `compact`, launch `minimized` (one line), at most 6 rows open (scrolls past that) |
| What `banner-fix` changed | only the activity banner's own launch and its 30 vh cap | every banner, through the shared default |

The refactor never touched the default every other banner falls back to, so each banner Brett hadn't tuned by hand
still opened full height. A banner's own saved choice or Apply to all still wins (Brett: the banner plugins keep
their style and colours on the hub so they render the same everywhere), so a banner he set to Regular earlier stays
Regular until he changes it in Banner settings.

## 2. New default style + colour theme, owned by axHub

- `framework/assets/style-theme/hub.json`: Inter 13 px, compact density, radii 4/8/12, space 7, flat shadows, 120 ms.
- `framework/assets/color-theme/hub-night.json`: graphite neutrals, AmberX amber accent (`#f5a524`), dark scheme.
- Both shared (every app bakes them at `src/axf/assets`, 471 shared assets now).

## 3. Default design theme

`framework/assets/design-package/hub-default.json` = `hub` + `hub-night`, Fresh's layout, behaviour and extras
(compact chrome, tight spacing). It is now the default of all three apps (`axf.manifest.json` defaults:
`design-package`, `style-theme`, `color-theme`). The `default` tag moved from Fresh to the Hub assets.
`framework/defaults.json` (the framework's own default, used by fixtures and the demo) is unchanged.

## 4. Precedence rule (contract)

Spec: `framework/spec/APPEARANCE-SOURCE.md` → Design theme precedence. Engine `core/engines/designpackage.ts`.

1. Design package loaded → its style and colour theme are in force; a style/colour slot in the document is ignored.
2. A later style or colour pick overrides only that part, recorded in the look setting `axf.appearance.overrides`
   (shared through appearance@1 `settings`, so every app agrees). Picking the package's own theme drops it.
3. Loading a design package again clears every override (Restore default too).
4. Missing assets fall back override → package → pick.

Status line in Settings: "Hub Default (style changed)".

## 5. Settings → Appearance (apps): selection only

| Before | After |
|---|---|
| Lock the look | removed |
| AmberX Design Package (pick, Save the current look, Restore) | **Look**: Design theme, Style theme, Colour theme pickers + Restore |
| Sliders | removed; `axf.look` retired |
| Settings interface (settings asset picker) | removed |
| Assets (a picker for every slot) | removed |
| Asset appearance (per-asset tokens) | removed; `axf.custom.*` retired |
| Assets in rolls / Randomize | removed; `axf.roll.*` retired |
| Display: Spacing | removed (design packages set it) |
| Display: Text size, Animations, Level toolbar | kept (device display, not the theme) |
| Banner settings (a plugin's settings) | **kept as is**, incl. Apply to all |

Retired settings are never applied or sent; a hub document still carrying them is cleaned once by the first app that
reads it (`RETIRED_LOOK_SETTINGS`, `isRetiredLookSetting`). Actions (`appearance.package`, `appearance.restore`, swaps)
and the banner's day/night switch still work; the switch now records a colour override while a package is loaded.

## Checks

| Check | Before | After |
|---|---|---|
| `check-design-package.mts` | pass | 1238 (precedence, overrides, retired keys) |
| `check-hub-look.mts` | 26 | 42 (two apps: plugin look settings shared, retired keys never travel and are cleaned, precedence across apps) |
| `check-appearance.mts` | pass | 107 pass (fixtures regenerated: rows added for the new assets only) |
| `check-help.mts` / `help-coverage --check` | pass | 214 pass; framework ratchet 110 → 106 (4 removed controls, still 100%) |
| AmberX `test.mjs` | 2148 | 2146 (default look test now expects Hub Default) |
| axHub web `test.mjs` | 232 | 232 |
| check-settings-ui, check-interface, check-style-packages, check-scale, check-looktokens, check-roller, check-widgets, check-banner-hide, check-appearance-lock | pass | pass |
| check-theme, check-controls, check-conform, validate --framework (479 assets), shared-assets check, menu-reach (324) | pass | pass |
| `tsc --noEmit` + `vite build`: console, axHub web, AmberX | pass | pass |

Not run here: `check-help-mode.mts` (needs jsdom, CI installs it), Gradle/Kotlin (CI), `theme-swap.mjs` (Playwright, CI).

## For the Fable review

Foundation work built on Opus by Brett's call; a Fable pass should review exactly these:

- `designLookSlots` / `overrideAfterPick` / `normalizeDesignOverrides` and where the runtime applies them
  (`applyAppearance`, `swap`, `applyDesignPackage`): the precedence contract and its edge cases (package missing in an
  app, override of an asset one app lacks, interface scopes).
- `axf.appearance.overrides` riding appearance@1 `settings` (vs a first-class document field).
- `RETIRED_LOOK_SETTINGS` and the one-shot clean of an older document.
- New assets `style-theme/hub`, `color-theme/hub-night`, `design-package/hub-default`; fixture rows added.
- Banner defaults (`DEFAULT_BANNER_PREFS`).
- Kotlin twin (PORTING.md, deferred while Android is on hold).

## Known gaps

- No UI Review screenshots: this claude.ai session has no console or hub token. The PR says so; shots are due before
  it counts as ready.
- `apps/console-web/src/hubAppearance.tsx` and Build Pilot's Look still offer their own look controls outside
  Settings; untouched here.
- AmberX now starts on the shared Hub Default (its layout and navigation follow the package). Its own AmberX Day /
  Night packages still ship and can be picked.
- Patches, demo and Walkthrough Studio left out (paused / not listed).
