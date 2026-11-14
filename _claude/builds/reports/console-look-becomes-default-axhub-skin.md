# Console look becomes default axHub skin

Build `console-look-becomes-default-axhub-skin`, branch `claude/console-look-becomes-default-axhub-skin`.

Brett (2026-11-14 22:19): "Keep the design, all the style, the way the console looks right now, and make it the default axHub look, and then make all the apps inherit it right now"

## Baseline
- Baseline commit: `a2c2995d1f4dc372ed1ce268655668d3df89e591` (origin/main, 2026-11-14 22:42 UTC).
- Wait gate (s1): passed. All 8 skin PRs are in origin/main:
  - #647 skins-plugin-merge-main-and-land, #648 skin-config-panel-merge-main-and-land, #590 every-skin-ships-light-dark-colour-theme, #618 console-skin-axhub-only: landed stacked, inside #641 (branch tips are ancestors of main).
  - #641 skin-axhub-override-switch-greyed-out (`2bb2c6a7d`), #652 skin-animations-swatches-skin-switch (`aee42bbe8`), #657 token-registry-skin-editor-live-sandbox (`c0d479286`), #654 own-token-sets-for-grids-and-tab-groups (`647b79e58`).
  - `land-all-skin-builds` is still `running`, but only on s23-s25 (redeploy, deploy log and phone note, wrap-up). The code this build depends on is merged; the live console may not be redeployed yet, so the pixel baseline is built from the baseline commit, not taken from the live server.

## Look snapshot (s2)
`console-look-becomes-default-axhub-skin/snapshot-before.json` (look-snapshot@1): the raw hub appearance@1 doc, the console's app-look@1 (`looks/axf-console.json`), its hub-settings values, and the look resolved to asset data.
- Skin in force: `arctic-calm` (design package, app level, Use skin on, no hub-wide skin). Brings style-theme `soft-studio`, color-theme `arctic-daylight`, layout `classic-ide`, behavior-theme `calm`, typography / density / sizing `compact`.
- Console's own picks on top: nav-menu `amber-signature`, toolbar at the bottom (`axf.tokens.layout`), banner group folded.
- Hub token override: `axf.tokens.style` `opacityGlass` 0.7 (soft-studio says 0.72). Font scale 80, spacing tight.
- Chrome: toolbar `standard-icons`, banner `amberx-branded` with its widget arrangement, nav-style `accordion`, tab-group `underline`. No `axf.chrome.*` values are stored on the hub: every chrome element runs on its shared default.
- Gap: `arctic-calm` has no light/dark pair, so `skin.mode dark` fails for the console today. The new default skin has to ship a dark theme (candidate: `fresh-dark`, the day/night switch's dark side).

## Pixel baseline (s3)
`console-look-becomes-default-axhub-skin/shots/before/`: 12 shots at the baseline commit, from `rebuild-shots.mjs --label before` with `shots-before.json`. Views: home, Builds, Settings → Appearance; light and dark; desktop (1366×860) and phone (412×915 @2x).
- The shot run has no hub (`AXF_APPEARANCE_HUB=off`, scratch data). Each shot seeds the console's resolved look from `snapshot-before.json` into local storage first (the 45 resolved slots plus the console's look settings: `axf.tokens.style`, toolbar at the bottom, banner group, font scale 80, spacing tight), then reloads. So the shots show the live look's assets and tokens, but not hub data: the banner says "axHub off", and the hub's widgets and counters are empty.
- Dark = the same look with colour theme `fresh-dark` (the day/night switch's dark side), because `arctic-calm` has no dark pair.
- The "after" run must use the same `shots-before.json` steps (only the seed changes to the new default skin) so the diff compares like with like.
- The Settings → Appearance search shows a "did not render, so it cannot be focused" toast on some shots. It is the same on both runs, so it does not affect the diff, but it is a bug in global search to look at.

## Contract (s4, Fable)
Spec: `framework/spec/APPEARANCE-SOURCE.md` → "The hub default skin: `defaultSkin`".
- appearance@1 gets `defaultSkin: { id, overrides?, colorTheme? }` beside the hub-wide `skin` (same shape, `normalizeHubSkin`, `HubSkinPointer`; `AppearanceChange.defaultSkin`, null clears). The hub-wide skin needs Follow; the hub default is the floor every app stands on without opting in.
- Chain is now `plugin → ui → app → global → default` (`SKIN_SCOPE_DEFAULT`, `skinScopeChain`, `SKIN_SCOPE_KINDS`). `resolveLookSkin(look, global, scope, hubDefault)`: Use skin off and not following = inherit the floor (never the hub-wide skin); a `ui:` / `plugin:` scope's explicit off still means no skin there. Without a hub default nothing changes (every existing check passes unchanged).
- Composition order with the floor in force (implemented in s5): hub default skin → the pointer's overrides and colour theme → the app's own picks (the edits, skin-axhub-override rule) → ui overrides → plugin overrides. Writers (`lookAfterChange`, `setLookSlot`) are unchanged: with Use skin off a pick is already the app's own.
- skin@1 gets `chrome: { <chrome-settings@1 kind>: { interface?, instances? } }` (`normalizeSkinChrome`, `skinChromeErrors`, `skinChromeSettings` in skin-rules.mjs; the build engine validates the same lines; registry `optional_fields.chrome`). Lands in settings as `axf.chrome.settings.<kind>` and `axf.chrome.<kind>.<instance>`.
- app-look@1 gets `backups: [{ id, at, by, reason, own, skin, scopes }]`, newest first, `LOOK_BACKUPS_MAX` 5 (`normalizeLookBackup`; kept through `normalizeAppLook`).
- Bug found and fixed on the way: `serializeAppearance` never wrote `skin`, so every save from the web source (`hubAppearance.ts` PUTs `serializeAppearance(next)`) dropped the hub-wide skin. It now writes `skin` and `defaultSkin`.
