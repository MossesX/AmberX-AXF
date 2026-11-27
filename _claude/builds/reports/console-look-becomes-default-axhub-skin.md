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

## Engine (s5, Fable)
- `hubDefaultOf(shared)` reads the pointer; `composeLookAt` passes it to `resolveLookSkin` and, when the `default` level decides, composes floor-first: hub default skin → pointer overrides / colour → the app's own picks → ui / plugin overrides and colour (`subScopeAdds`). A skin's `chrome` block lands in settings after `extras.settings` in every mode. No change when there is no hub default: every existing fixture-pinned case passes unchanged.
- `adoptHubDefault(look, meta)`: backup first, Use skin and Follow off (skin id kept), overrides and the colour pick under the skin become own picks, scopes back to inherit, one undo (`adopt-default`); unchanged when there is nothing to move (idempotent). `backupLook`, `lookBackup`, `restoreLookBackup(look, id, at)` (one undo, `restore-backup`).
- Runtime: `rt.hubDefaultSkin()`; `skinAt`, `skinScoped` and `pushAppearance` resolve with the pointer. Writers unchanged: with Use skin off a pick is the app's own, which is exactly an edit over the floor.
- JSON schemas regenerated (`axf schemas`): `skin.schema.json` now comes from a skin special case in the writer (`skinSchemaProperties`: the colour pair, `behaviorTheme`, `chrome` with every chrome-settings@1 field typed), so the hand-kept `colorThemes` block survives a regeneration. Only that file changed.
- Smoke-tested by hand (no override, partial override, plugin override over the floor, own skin beats the floor, adopt, adopt twice, undo, restore from backup, round trip, appearance@1 merge / serialize, Follow with and without a hub-wide skin): all as specified. Golden cases land in s6.

## Fixtures + checks (s6, Fable)
- `spec/fixtures/skin.json` gains a `hubDefault` block (gen-fixtures.mts): the chain, the pointer (good / none / junk / legacy colour), the chrome block (normalized, errors, skinErrors, settings), ten resolution cases (no override, no default, own skin on, plugin off, plugin override, Follow with and without a hub-wide skin, hub-wide skin without Follow, no document, switched-off skin's colour), eight compositions (no override, partial override, plugin override, plugin off, own skin on, Follow, unknown default, hub-only), adopt / adopt twice / already on the floor / undo / restore from backup / undo after restore / nothing to restore / round trip / backups (twin, cap, by id), and the shared document (parsed, merged, cleared, serialized, combined). Only `skin.json` changed on regeneration.
- `spec/check-skin.mts`: a "hub default skin" block replays the fixture and pins the rules (floor-first composition, only the edited slot differs, a plugin override beats the app edit, a plugin that says off stands below the floor, Use skin on beats the floor, an unknown default reads as none, adopt is idempotent and keeps edits, restore keeps the backups, the text carries both pointers), then runs the runtime: an app whose shared document names a hub default draws it with no change to its look document and nothing written to the hub; an edit over the floor is an own pick; Use skin on / off, Restore, a plugin below the floor, and the pointer going away all behave.
- `spec/check-skin-coverage.mjs`: pins `SKIN_SCOPE_KINDS` (default first) and the chain `plugin → ui → app → global → default`, and checks every chrome-settings@1 kind a skin's `chrome` block can name is a registered type covered as a slot.
- Two rules fixed while pinning: with no look document every level inherits the floor (a `plugin:` level no longer reads as off), and `hubDefaultOf` carries `overrides: {}` like `globalSkinOf`.
- `spec/PORTING.md`: "Deferred: the hub default skin (Nov 14 2026)": the Kotlin twin (both pointers on `AppearanceEngine`, the chain root, floor-first composition, the chrome block, backups and the moves) is recorded as a deferred gap; a port replays the `hubDefault` block.
