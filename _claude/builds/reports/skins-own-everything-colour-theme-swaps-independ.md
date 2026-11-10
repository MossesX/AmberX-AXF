# skins-own-everything-colour-theme-swaps-independ — Phase 1 (Fable), Nov 10 2026

Brett (Nov 9 2026): "All the skins control everything. The skins have different sections, but the skins have the color
theme in them. You can change the color theme without changing the skin. If you change the color theme, it makes a new
skin, don't like that. You can change the color theme without changing the skin."

## The standing rule (now in framework/spec/APPEARANCE-SOURCE.md)

A skin owns everything and includes a colour theme section. Picking a colour theme while a skin is in force switches that
one section inside the current skin: the skin id, the skin asset, the list of skins and every other section stay as they
were. Nothing is created, copied or forked. The pick is the level's `colorTheme` field (app, `ui:` / `plugin:` scope,
hub-wide skin), never `overrides["color-theme"]`; absent = the skin's own. It is the same document from every entry
point, never leaks when the skin is off or another skin is picked, and comes back with the skin it was made in. Old
documents that kept the pick as an override are read as `colorTheme` and draw the same look.

## What changed

- **Engine** (`skin-rules.mjs`, `skin.ts`, `skin-coverage.mjs`, `appearance.ts`, `runtime.ts`): `colorTheme` on
  app-look@1 skin state, scope states and the hub-wide skin of appearance@1; `setSkinColorTheme`, `skinColorTheme`,
  `skinColorOf`; `lookAfterChange`, `setLookSlot(…, global)`, `setScopeOverride`, `backToSkin` and `resolveSkinChain`
  route the colour slot to that field; `pickSkin` / `setScopeSkin` start another skin with its own colours; legacy
  override migrated on read. Runtime: `rt.skinColorTheme()`, `rt.setSkinColorTheme(id | null, scope?)`, action
  `skin.color:<theme|default>` and `skin.color:<ui|plugin>:<id>:<theme|default>`; `skinScoped` compares against a fresh
  resolve of the document. This finishes the uncommitted engine draft left in the `skins-theme-rule` worktree (that
  build is still queued; its s1 is done here).
- **Pickers** (`framework/libs/settings/index.tsx`): the Colour theme row under a skin shows "The skin's own colours" /
  "Switched inside the skin. The skin is unchanged." with a *Skin's colours* button and no overridden dot; the skin
  picker dialog has a Colour theme select for the applied skin (the grid never gains a tile).
- **CLI** (`framework/cli/skins.mjs`): `color <app> [<theme>|default] [--scope ui:<id>|plugin:<id>]`, `global-color
  <theme>|default`; `apps` / `at` report `colorTheme`; control@1 `tokens.slots` for `color-theme` lands inside the skin.
- **REST / MCP / voice** (theme-manager plugin, plugin-commands@1 auto): `GET/POST /skins/{app}/color` (`{theme,
  scope?}`), `POST /skins/global/color` (`{theme}`); self-test checks the routes and their order.
- **Help**: entries for *Skin's colours* and *Colour theme inside this skin* (framework help at 100%).
- **Docs**: APPEARANCE-SOURCE.md (rule section), PORTING.md (Kotlin gap), theme-manager README.
- **Tests / fixtures**: `spec/fixtures/skin.json` gains a `colour` block; `check-skin.mts` pins the engine, the runtime,
  every entry point, legacy documents and the invariant (skin id never moves, skin data never written).
- App copies of the changed framework files refreshed in console-web, axhub-web, molly, amberx-droid (demo and
  walkthrough-studio were already stale and are left as they were).

## Running builds checked against the rule

- `skins-restyle-everything-badges-banner-and-every-visual-element` (PR #409): touches coverage declarations, the skin
  audit and the screenshot gate; nothing there makes a skin on a theme change. Its `skin-coverage.mjs` hunks (ingredient
  declarations) sit apart from the `resolveSkinChain` change here.
- `appearance-skins-colour-themes-only-remove-design-packs`: only its look-regression suite so far; no skin or theme logic.
- `skins-theme-rule`: uncommitted engine draft for this same rule; carried into this branch and finished (see above).
- Nothing on main minted a skin asset on a colour pick. What read as "a new skin" was the colour pick being stored as a
  skin *override* (an "Overridden" dot and "Back to skin" on the colour row, and the design-package label "<name>
  (colour changed)"); the pick is now a section switch inside the skin.

## Checks

check-skin 356 (137 colour-theme + engine + runtime), check-skin-coverage 55/0 uncovered, check-hub-look 110, console
commands 66, theme-manager self-test 36, check-theme, check-controls, check-toolbars, check-chrome-assets, help coverage
(framework 158/158, synced to the app copies), `axf validate --framework` 534 assets, tsc clean in console-web (build).
Pre-existing and not from this build: check-help fails on `apps/console-web/plugins/claude-accounts/help.json`
entries[17].kind (an unknown kind), which already fails on main.

## UI Review

Shots in `shots/` (desktop + phone): Appearance with the Windows skin on, the colour theme switched to Aurora Night
inside it (skin row still "Windows, in this app only"), the skin picker with the colour theme row, all taken from the built
console under vite preview with the hub mocked off and hubsync's look off. Submitted to UI Review (kind settings) from
this checkout's data folder: no console credentials in this session, so it is not on the running console.

## Notes

- Dev mode with `AXF_APPEARANCE_HUB=off` lets lib-hubsync attach a follow-only look source that has no app-look store,
  so Apply in the skin picker is refused there ("look can't be read from axHub"). Pre-existing; the capture worked
  around it by saving `axf.hubsync.connection` with `look: off`. Worth a small fix in hubsync or the console later.
- Kotlin twin deferred (PORTING.md).
