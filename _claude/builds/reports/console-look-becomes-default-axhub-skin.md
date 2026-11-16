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

## Skin asset (s7, Opus)
- `framework/assets/skin/console-default.json` ("Console (default)"): built from `snapshot-before.json`, exact values. Themes `classic-ide` / `arctic-daylight` (dark pair `fresh-dark`, closing the s2 gap) / `soft-studio` / behaviour `calm`; 39 assets (every resolved slot except the themes and the two a skin never sets, `design-package` and `interface`, which keep coming from each app's saved default); icon pack `amberx-outline`; extras: spacing `tight`, toolbar and nav shown, settings `axf.tokens.style` (`opacityGlass` 0.7), `axf.tokens.layout` (toolbar at the bottom) and `axf.banners.group` (folded).
- Font scale 80 is not in the skin: `axf.display.fontScale` is a per-app display setting, not a look key.
- `axf validate --framework`: valid (545 assets).
- `npx -y tsx framework/spec/skin-snapshot-diff.mts console-default <snapshot>` compiles the skin as the hub default (with the shared document's own token overrides removed, so the floor has to carry them) and diffs slots, the asset data behind each slot, colour and style tokens, spacing, hidden chrome and token settings: a fresh app on the floor 45 slots, 0 differences; the console after `adoptHubDefault` 45 slots, 0 differences; dark pair `fresh-dark` is a dark theme.

## Bake (s8, Opus)
- `shared-assets.mjs bake`: 529 shared assets (now with `skin/console-default`) baked into console-web, axhub-web, amberx-droid and molly. `shared-assets.mjs check`: 4 apps ship all 529, no own copies.
- `rebake.mjs apply --force` for the same four: their baked `src/axf/{core,react,ui,schemas,libs}` were behind the framework (no hub-default engine, older `appearance.ts`, `skin-rules`, settings panel); `status` read them as "edited" only because merges had updated baked files without the lock. All four are `current` now; console `tsc --noEmit` passes.
- Expenses has no baked `src/axf`: it is a peeled Next.js app on its vendored `@axf/core` + `axf-tokens`, so there is nothing for `rebake.mjs` to write; its six chrome-settings copies are checked by `chrome-settings.mjs check` (5 apps, 6 types each: pass). It takes the look from the hub like the others (s13).
- `apps/demo` and `apps/walkthrough-studio` stay stale (left out of shared assets by Brett, Nov 1 2026).

## CLI (s9, Opus)
`framework/cli/skins.mjs` (all with `--json`):
- `default get`: the hub default skin and, per app, inherit (stands on the floor), skin in force and level, own slot / setting overrides, backup count and the newest backup.
- `default set <skin> [--adopt] [--keep-equal]`: backs up every app's app-look@1 first (reason "before the hub default skin became …"), then writes `defaultSkin` on appearance@1; `--adopt` moves every app onto it. `default adopt <app>|--all`, `default off`. The old `default <app>|global` (an app's Default skin) is unchanged.
- Adopt = `adoptHubDefault` (backup, Use skin / Follow off, overrides become own picks, scopes inherit, one undo), then own picks the floor already draws the same way are dropped (`editsOver`), so an app keeps only its real edits and follows later default changes. `--keep-equal` keeps them.
- `backup <app> [--reason]`, `backups <app>`, `restore <app> --backup [<id>]` (alias `restore-backup <app> [<id>]`). Plain `restore <app>` still means Restore to default (the saved snapshot), so no existing caller changes meaning.
- `snapshot --from <app> --as <id> [--name]`: what the app draws now (`currentLookPart`, same order as `composeLookAt`) as a skin@1 under the made skins on the hub (`skin-config/made/skins/<id>.json`, listed by `skins.mjs list` like any skin). Framework and Default skin ids are refused.
- `status` / `at` now pass the hub default to `resolveLookSkin`, so `apps` and `at` report `from: default` for apps on the floor.
- Scratch-hub run (snapshot-before data): `default set console-default --adopt` took one backup of axf-console (arctic-calm, Use skin on, own nav-menu), set the pointer, and left the console with no own picks (all three equal to the floor); `restore console --backup` put arctic-calm back with one undo; `snapshot --from console --as console-captured` reproduced console-default's 39 assets (+ behaviour theme as an asset).

## Routes, MCP, actions, voice (s10, Opus)
- Theme manager (`/api/plugins/theme-manager`, all through `skins.mjs`, declared before the `{app}` routes): `GET skins/default-skin` (pointer + per-app state), `POST skins/default-skin {skin, adopt=true, keepEqual?, confirm}` (409 without `confirm: true`; `skin: off` clears), `POST skins/default-skin/adopt {app?}`, `POST skins/snapshot {from, as, name?}`, `GET skins/backups/<app>`, `POST skins/backup/<app> {reason?}`, `POST skins/restore/<app> {backup?}`. MCP: the plugin's `plugin-commands@1` is `auto`, so each route is a tool with its docstring.
- Runtime (every app): `makeDefaultSkin(id?)` (the skin in force when no id), `restoreLookBackupNow(id?)`, `lookBackups()`, `snapshotSkin(id, name?)`, and a `SkinHub` seam (`setSkinHub`): the console installs one (`src/actions/skin-hub.ts`) that calls the routes above, so the console's button and action back up every app, set the pointer and adopt every app. An app without a skin hub backs up and adopts itself and writes the pointer through its appearance source.
- Actions: `skin.default[:<skin>]` ("Make this the default look"), `skin.restoreBackup[:<id>]` ("Restore my old look"), `skin.snapshot:<id>[:<name>]` ("Save this look as a skin"). In the console they are `function:` targets, so REST `/api/console-control`, `console_control_*` MCP tools and `axf console` reach them.
- Voice (console-control-voice@1, JS + Python twin `voice_intent`): "make this the default look" / "make the console look the default for every app" → press `function:skin.default`; "restore my old look" / "bring back the previous skin" → press `function:skin.restoreBackup`. Fixture `console-control-voice.json` regenerated (only file changed); `test_console_control.py` parity passes.
- Theme-manager `test.py`: 75 checks pass (21 new: route order, confirm, unknown skin, backups first, pointer, adopt drops equal picks, state, restore with undo, twin backup not added, snapshot, adopt one app, off).

## UI (s11, Opus)
Settings → Appearance (`AppearancePanel`, `framework/libs/settings`, every app) gets a **Default look** section under Use skin / Follow axHub:
- Badge `Default: Console (default)` (framework `Chip`, accent; `None` when the hub has no default) with a line saying whether this app stands on it.
- **Make this the default look** (framework `Button`, `confirm`: "Make <skin> the default look of every app? Each app's current look is backed up first and can be restored."): makes the skin in force here the hub default. Disabled when the skin in force already is the default or the app has no skin. In the console it goes through the theme-manager routes (every app backed up and moved); elsewhere this app is backed up and moved and the pointer goes through its appearance source.
- **Restore previous skin**: one tap, from this app's newest backup (shows when it was kept and which skin), one undo.
- Framework controls and tokens only; targets register through `Button` (`button:skin-default`, `button:skin-restore-backup`), plus `data-axf-settings-section="default-look"`. The section is locked while "Get my skin only from axHub" is on. `check-theme.mjs` and `check-controls.mjs` pass; console `tsc` passes after the re-bake.

## API parity (s12, Opus)
- Deep links: `view:settings/tab:settings.tabs=appearance/panel:default-look`, `…/button:skin-default`, `…/button:skin-restore-backup` (`console_show` / `console_open`, REST `/api/console-control`, `console_control_*` MCP, `axf console`).
- State read: `panel:default-look` answers `state` with `rt.defaultLookState()` (default skin, inherit / from / skin in force / Use skin, own picks and settings over the default, backups). Hub-wide: `GET skins/default-skin` / `skins.mjs default get`.
- `control-inventory.mjs --check`: current. `check-console-control.mjs`: pass (no count rose). Doc: `_claude/memory/docs/console-control.md` → Default look.

## Publish (s13, Opus): staged, not switched live yet
**Why not live now.** Two blockers found on the hub (`/projects/_shared/_data/settings`):
1. The deployed console (and every deployed app) has an older baked framework: its `skin-rules.mjs` has no `backups` and no hub default, and its baked assets have no `console-default`. Setting the pointer now would make every live app read an unknown default (= none) while adopt turns their skins off: each app would drop to its old saved look until this PR is merged and deployed. Backups written now would also be dropped by the old runtime's next save.
2. The console's look moved on after Brett asked: on Nov 15 15:29 it was switched to **AmberX Signature Day** (design package, colour Arctic Daylight inside it; animation speed 255, a desktop banner widget setting). `Console (default)` is the Nov 14 look Brett asked for (Arctic Calm based). Moving the console onto it replaces his newer pick, so that call is his.

**What is in place.** Systems check item `hub-default-skin` ("Console look is the axHub default", registered by the theme manager through `axf.health@1`): green while the deployed console doesn't ship the skin ("waits for the deploy"), then red with **Auto fix: Make Console (default) the axHub default** in **Ask first** mode. The fix runs `skins.mjs default set console-default --adopt` (every app backed up first, pointer, every app adopted keeping only its edits). Undo per app: Settings → Appearance → Restore previous skin, `skins.mjs restore <app> --backup`, or "restore my old look". Green once the hub default is `console-default`.

**Dry run on a copy of the live hub** (`default set console-default --adopt`), the backups list it takes:
| App | Backup (skin, Use skin) | After: own edits kept over the default |
|---|---|---|
| amberx-droid | own look (no skin) | none |
| axf-console | amberx-signature-day, on | `axf.appearance.animations` (speed 255), `axf.banners.widgets.axf-console.desktop` |
| axhub-web | windows, off | hidden toolbar |
| molly | own look (no skin) | none (unchanged) |
Pointer: `defaultSkin: { id: "console-default" }`. Every app reports `from: default`.

## Android (s14, Opus)
- AmberX droid (allowed exception): no Kotlin needed. The Capacitor shell loads the AmberX web app (`capacitor.config.json` → `server.url` https://amberx.amberxai.com); `src/main.tsx` attaches `HubAppearanceSource`, which reads `defaultSkin` from appearance@1, and the re-baked `src/axf` carries the hub-default engine and `skin/console-default`. `tsc --noEmit` passes. It picks up the default when the AmberX web app is deployed.
- Other Android apps (console app, AXHub Android, Voice Vault, Kotlin-kernel apps): deferred under the Android hold, recorded in `framework/spec/PORTING.md` → "Deferred: the hub default skin". No Kotlin written.

## Pixel diff (s15, Opus)
- After set: `shots/after/` (12 shots: home, Builds, Settings → Appearance; light + dark; desktop 1366×860 + phone 412×915 @2x) from `rebuild-shots.mjs --label after` with `shots-after.json`: the before steps with only the seed changed, generated by compiling `console-default` as the hub default for a fresh console look (`composeLookAt`); 0 slot differences against the before seed (dark = the skin's own `fresh-dark` pair).
- Diff (`pixel-diff.cjs`, canvas in headless Chromium, per-channel delta ≤ 24 = antialias; `pixel-diff.json`): 1 of 12 shots pixel-identical (settings-appearance-dark-desktop); 11 differ. **Not zero, and not from the look.** Each pair was checked by eye: colours, fonts, sizes, spacing, radii, borders, the banner, nav, toolbar position and status bar are the same. The changed pixels are content that moved between the two runs, two days apart: the clock, live build data (counts, agent slots, rows), build engine offline vs online (MCP endpoint text and the row reflow under it), "Layout saved on axHub", asset counts (+1 = `console-default`), agent avatars on build rows (a feature merged from main since the baseline), and the new Default look section on Settings → Appearance.
- Token drift: none found, so nothing to fix. The token-level proof is s7's compile diff (0 differences in slots, asset data, colour and style tokens, spacing, hidden chrome, token settings). A pixel-exact rerun needs the views frozen on fixed data (scratch builds store, fixed clock); noted as a follow-up for the screenshot tool, not this build.

## Screenshots + UI Review (s16, Opus)
- Group **"console-look-becomes-default-axhub-skin - 2026-11-16 13:55"** (`shot.mjs`, 22 shots): the console's 12 after shots from this branch, plus the live sites of the other apps desktop + phone (`shots/apps/`). The demo (https://axf.amberxai.com) renders; AmberX web, axHub web and Molly stop at the axHub sign-in wall and Expenses at its own login, so they show sign-in pages and the code that is deployed now, not this build. Shots of those apps on the default skin are for after the deploy and the publish (s13 item).
- UI Review item `r-20261116-82x3x01` "Settings → Appearance: Default look", 3 options (ui-choices@1, asset type `settings`, owner theme-manager; assets in `apps/console-web/plugins/theme-manager/assets/settings/settings-appearance-defa-mwjc59sj-*.json`), each with desktop + phone pictures (`shots/options/`): **Under Use skin** (built), **Top of Appearance**, **With Restore to default**. Choices file: `ui-choices.json`.
- Gap: this headless session has no `AXF_CONSOLE_URL` / `AXF_TOKEN`, so the shots group and the review item were written to this worktree's data folder, not the live console (same as earlier headless builds). Re-send from a session that has them: `node framework/cli/shot.mjs <file> … --console` and `review.mjs submit … --choices _claude/builds/reports/console-look-becomes-default-axhub-skin/ui-choices.json --console`.

## Help, glossary, shipped features (s17, Opus)
- Help (`framework/assets/help/framework.json`, every app): `default-look`, `skin-default` (Make this the default look), `skin-restore-backup` (Restore previous skin), `action:skin.default`, `action:skin.restoreBackup`, `action:skin.snapshot`, each with how to reach it (action, route, CLI, voice).
- Glossary: term `hub-default-skin` (glossary-index `terms.json`); the skin asset carries its own description. `catalog.mjs --check`: complete (3617 entries, ratchet 388 held). Found on the way: the glossary reads the first 4000 characters of a CLI's header, so the longer `skins.mjs` header lost its summary; the new commands are documented in a `//` block right after the header instead.
- Catalog item `f.appearance.hubdefault` (next to `f.appearance.hubskinonly`) and its status `built` in `framework/catalog/status.json`, written to the hub copy (`/projects/amberx-axf/_data/framework/catalog/status.json`) and the repo snapshot; `tracker.mjs` regenerated, `--check` passes.
- Shipped features: the ledger row comes from the shipped manifest the orchestrator writes when the build lands (`_claude/builds/shipped/<build>.json`, feature-ledger), so no hand-written row.

## Tests (s18, Opus)
- New `framework/spec/check-skins-default-cli.mjs` (13 checks, in CI next to `check-skins-config-cli.mjs`): `default get`, unknown skin refused, `set` backs up every app first and leaves looks alone, Use skin on keeps its own skin while an app without one stands on the floor, `adopt --all` drops picks the floor draws and keeps real edits (axhub-web's hidden toolbar), adopt is idempotent, `--keep-equal`, `restore --backup` with one undo, `restore-backup <id>` and an unknown id, backup by hand, `snapshot --from --as` (listed, framework ids refused), `off`, and the Console (default) compile diff (0 differences).
- Route tests: theme-manager `test.py` 75 checks (s10).
- Pass: `check-skin.mts` (500), `check-skin-coverage.mjs` (55 types, 0 uncovered), `check-skin-modes.mjs` (7 skins with both colour themes), `check-skins-config-cli.mjs`, `check-theme.mjs`, `check-controls.mjs`, `check-toolbars.mjs`, `check-chrome-assets.mjs`, `check-console-control.mjs`, console-control server tests (voice parity), `notify-control/test.py`, console `tsc` + `vite build`, `scripts/theme-swap.mjs` on the built console (every colour, transparency and size follows the themes and scale assets).
- Fixed on the way: `plugin-lifecycle.mjs check theme-manager` flagged the console core calling the theme manager by name (`src/actions/skin-hub.ts`). The skin hub now lives in the plugin's own web library (`plugins/theme-manager/web/index.tsx` → `rt.setSkinHub`), so without the plugin an app falls back to backing up and moving only itself. The help line names the route without the plugin path. The only remaining hit is the dispatcher's untracked brief file, which is not in the repo.
