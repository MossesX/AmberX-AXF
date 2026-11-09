# Skins upgrade: every asset type, at any scope (build `skins-asset-types`)

Branch `claude/skins-asset-types` (Fable, Nov 7 2026, agent Greenlight Gina). Builds on the skins build
(`claude/skins-r4`, merged into this branch; its last three steps are closed here). Brett (voice): "What about skins?
How's skins doing? Is skins gonna um, be upgraded since we've we've made um so many more asset types?" and the brief:
"Upgrade the skins system so it styles EVERY asset type now in the registry … Skins apply at any scope:
global/app/UI/plugin, with child-overrides-parent inheritance … A skin is a design pack; it MAY reference an icon pack …
no hardcoded list; add a CI check that fails if a registered asset type has no skin coverage. Voice + API/MCP/CLI parity.
Submit at least 3 UI options to UI Review first."

## What changed

**skin-coverage@1** (`framework/core/engines/skin-coverage.mjs` + `.d.mts`, TS face in `engines/skin.ts`): how a skin
reaches each registered asset type is derived from `schemas/asset-types.json` and the style targets in
`schemas/customize.json`; nothing names a type by hand.

| by | how | which types today |
| --- | --- | --- |
| slot | the skin picks the active asset | 26 (themes, chrome, controls, settings interface, dock / x layouts, branding, scale assets, agent card …) |
| parts | the skin styles the type's box, text, icon and items under its style target | 14 (clock, search bar, action button, logo, label, status, counter, progress, avatar, link, theme switch, spacer, divider, badge) |
| reference | named through a field (`iconPack`) or a picked asset (`via: branding`) | 3 (icon pack, logo mark, animated logo) |
| bundle | a whole look the skin stands in for | 4 (design package, style package, interface, skin) |
| none | no look, declared with a why | 4 (access policy, help, job type, card) |

51 of 51 types covered; `node framework/spec/check-skin-coverage.mjs` (in CI) fails on a widget without a style target,
an excluded type with no `skin: { by }` declaration, or a bad declaration. Composite assets: the parts reach `box`,
`text`, `icon` and (where the target names them) `items`, so "button = box + text", "nav = container + items" are one
`parts` block per type. Twelve widget types got style targets (they had none), so labels, badges, counters and the rest
now take parts.

**skin@1** gains `iconPack` (an icon-pack id; the skin puts it in force through `axf.icons.pack.<scope>`, the key the
icon-map engine reads) and `parts` (type → customize tokens, checked against the registry and the targets). The Windows
skin names the AmberX outline pack and square-cornered widget parts. Validators: `engines/skin.ts`, the build engine
mirror, `axf.mjs validate --framework`.

**Scopes** (the icon-map model): hub-wide → app → screen → plugin, the child overrides the parent.
`appearance@1` carries the hub-wide `skin`; `app-look@1` gains `skin.inherit` (Follow the hub-wide skin, off by
default: "by default they're all their own") and `scopes["ui:<view>" | "plugin:<id>"]` = `{ use: on | off | inherit, id,
overrides }`. `resolveSkinChain` / `resolveLookSkin` / `composeLookAt` are pure and pinned by `spec/fixtures/skin.json`
(`coverage`, `scopes` blocks). The runtime draws a level that resolves differently from the app as a scoped view
(`rt.skinScoped(key)`, the same mechanism interface scopes use) under `<SkinScope>` on every view root (AppShell) and
every plugin root (plugintheme `PluginScope`, settings `TabContent`); parts ride the customize sheet; `brandGlyph` takes
the skin's pack.

**UI** (`framework/libs/settings/skinwhere.tsx`): Settings → Appearance shows *Follow the hub-wide skin*, *Where the
skin applies* (This app, one row per screen / plugin with Inherit / Skin / Off and the skin pick, Add a screen or
plugin) and *What a skin covers* (every type grouped by how a skin reaches it, the current skin's picks lit), in three
layouts switchable live (`axf.skin.whereLayout`: rows / dialog / matrix). Help texts for the new controls.

**Parity**: `node framework/cli/skins.mjs use <app> <skin> [--scope ui:<id>|plugin:<id>] | off [--scope] | inherit <app>
<scope> | follow <app> on|off | global <skin>|off | at <app> [--scope] | coverage | covers <skin>`; theme-manager routes
`/skins/{app}/use|off|inherit|follow|at`, `/skins/global`, `/skins/coverage`, `/skins/covers/{skin}` (MCP tools by
plugin-commands); actions `skin.inherit:on|off`, `skin.scope:<ui|plugin>:<id>:<on|off|inherit>[:<skin>]` for voice.

## Checks

check-skin.mts 476 checks (102 + 167 coverage/scopes + 207 runtime scopes), check-skin-coverage 51 types / 0
uncovered, check-customize 163, check-theme, check-controls, check-toolbars, check-chrome-assets, check-interface,
check-design-package, check-widgets, check-scale, check-brand, check-settings-ui, check-chrome-settings, plugin
lifecycle (theme-manager clean), plugin commands, console commands, help coverage (framework back at 100%), tsc clean in
console-web, molly, axhub-web, amberx-droid; `axf validate --framework` 530 assets.

## UI Review

Group "skins-asset-types - Nov 7, 12:30 AM": Option A Rows, Option B Dialog, Option C Matrix (desktop + phone each)
and "Scoping in action" (the Windows skin on the app while the Home screen draws under Hub Default). Copies in
`shots/`. Shot with the built console under vite preview (hub mocked off, local look document).

## Known gaps and notes

- Kotlin twin deferred (Android on hold): PORTING.md names the functions and fixture blocks a port needs.
- The matrix layout on a phone folds each level into stacked lines with small column labels; the UI Review phone shot of
  option C predates the labels (added after the shots).
- The hub-wide skin is set by CLI / API (`skins.mjs global`); the console has no "set the hub-wide skin" button yet (the
  Follow switch tells where to set it).
- The VPS disk hit 100% during this build (docker build cache 17 GB, old `/tmp` scratch); `docker builder prune` and the
  tsx cache freed 13 GB. A disk-space health check with Auto fix belongs in the systems check.

## Finish (Nov 9 2026)

Merged origin/main (568 commits) into `claude/skins-finish`. Conflicts: the asset-type lists in `core/types.ts` (main's
demo types + `skin`), the `build-engine.mjs` imports and the PORTING.md deferred sections took both sides; the lock files,
build profiles and another build's report took main's. After the merge: tsc clean (console-web), check-theme,
check-controls, check-toolbars, check-chrome-assets, check-skin (476 checks), check-skin-coverage (55 types, 0 uncovered;
main's demonstration / book / clip / docs types are covered as slots), theme-manager tests (34) and its lifecycle check
all pass. The UI Review options A-C and "scoping in action" were already approved there; nothing new was posted.
