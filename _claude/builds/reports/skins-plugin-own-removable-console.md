# Skins plugin: removable plugin and screen for changing skins

Build `skins-plugin-own-removable-console` · branch
`claude/skins-plugin-own-removable-console` · PR #553.

## What landed

| Phase | Model | What |
| --- | --- | --- |
| Fable phase 1 | Fable | skin-switch@1 engine (`framework/core/engines/skin-switch.mjs`): use / back-to-skin / restore-default / undo per scope (hub, app:<id>, ui:<view>, plugin:<id>), one undo record in the look document; fixture `spec/fixtures/skin-switch.json`, check `spec/check-skin-switch.mts` (CI); Kotlin twin deferred in PORTING.md |
| Opus phase 1 | Opus | Removable plugin `apps/console-web/plugins/skin-gallery` (shown as **Skins**): manifest, install / uninstall / hooks, help, README, CLI over the engine, REST routes, first gallery screen and banner switcher |
| Opus phase 2 (s3–s20) | Opus | `notify.json` and a help.json fix; coverage per skin, `POST scope` (Inherit / Follow hub), `GET apps`, settings route; named MCP commands; `skin.*` console actions for voice; screen split into SkinsScreen (SkinScope root) / ScopePicker / SkinActions (Undo snackbar) / SkinPreview (desktop + phone side by side); deep links through `console_open … focus`; banner chip with popover; context menu; settings sub-tab; AppearancePanel through the skin-switch@1 service; 3 + 3 UI Review options; screenshots; `KNOWN_BANNERS` fix |

Folder name: `skin-gallery`, not `skins` (phase 1's decision). "skins" is a common key across the repo, so the
lifecycle stale-reference check flags it. The name people see is still "Skins". This phase kept the folder, so the steps' `skins/…`
paths are `skin-gallery/…`, the routes live in `server/__init__.py`, and the CLI is `skin-gallery.mjs`.

## How every feature is reached

REST base: `/api/plugins/skin-gallery/`. MCP tools are `skin-gallery_<command>` (plugin-commands@1); the `axf` CLI is
`axf skin-gallery <command>`; the local CLI is `node apps/console-web/plugins/skin-gallery/skin-gallery.mjs`.
Voice (AmberX) runs the console actions; it can also run the plugin commands.

| Feature | Deep link (`console_open {kind: screen, target: skin-gallery, focus}`) | REST | MCP / `axf skin-gallery` | Local CLI | Voice / console action |
| --- | --- | --- | --- | --- | --- |
| Open the gallery | no focus; hash `#/skin-gallery` | `GET open` | `open` | `open` | `skin.open` |
| One skin picked / previewed | `skin/<id>`, `preview/<id>?view=phone` | `GET open?skin=&view=phone` | `open --skin --view` | `open <id> --view phone` | `skin.open <id>` |
| Scope picker on a scope | `scope/<scope>` | `GET open?scope=` | `open --scope` | `open --scope` | `skin.open "" <scope>`, right-click Change skin here… (`skin.here:ui|plugin`) |
| List skins (with coverage) | in the gallery | `GET skins` | `list` | `list` | via `list` command |
| Apps / scopes | in the picker | `GET apps`, `GET scopes` | `apps`, `scopes` | `apps`, `scopes` | via commands |
| State of a scope | in the picker | `GET state?scope=` | `state` | `state --scope` | via `state` command |
| Use skin | toolbar, chip | `POST use {skin, scope}` | `use` | `use <id> --scope` | `skin.use <id> [scope]` |
| Back to skin | toolbar, chip, Appearance | `POST back {scope, slot?}` | `back` | `back [slot] --scope` | `skin.back [scope] [slot]` |
| Restore to Default | toolbar (tap to confirm), Appearance | `POST restore {scope}` | `restore` (confirm) | `restore --scope` | `skin.restore [scope]` |
| Undo | toolbar, snackbar, chip, Appearance | `POST undo` | `undo` | `undo` | `skin.undo` |
| Inherit / Follow hub | switch in the picker | `POST scope {scope, follow}` | `scope` | `scope <scope> follow\|own` | `skin.scope <scope> [own]` |
| Settings (banner chip, default scope, undo window, preview viewport) | Settings → Plugins → Skins; chip right-click Settings… | `GET / POST settings` | `settings`, `set-settings` | `settings [<key> <value>]` | `skin.setting <key> <value>` |
| Banner chip | Banner settings → Quick skin switcher; right-click Settings… / Change… / Move | same routes | same | same | same |

The live preview is screen-only by design: it saves nothing (`rt.previewSkin`).

## Tests

- `python3 apps/console-web/plugins/skin-gallery/test.py`: 37/37 (list with coverage, state per scope, use → back →
  restore → undo round trips at hub, app and plugin, Inherit / Follow hub, settings and their refusals, deep links,
  unknown skin and bad scope refused).
- `check-skin-switch.mts`: 392 checks. `check-skin-coverage.mjs`: 55 types, 0 uncovered.
- `tsc --noEmit` (console-web): clean. Also clean or passing: check-theme, check-controls, check-toolbars,
  check-chrome-assets, check-banner-widgets, plugin-commands check and test, glossary-index `catalog.mjs --check`, lazy-loader-check.
- `uninstall.mjs --all`, then `plugin-lifecycle check skin-gallery --after-uninstall`: clean (the folder was restored
  from git afterwards).
- Found and fixed along the way: `project-switcher` was missing from `KNOWN_BANNERS` (lazy-loader-check failed on main).

## UI Review

Both sets are waiting for Brett in UI Review (group "skins-plugin-…-ga - Nov 13 7:55 AM"):

- `r-20261113-e4671753`: gallery layout, 3 options (split = today's default, stage, list), plus previews and the scope
  picker, desktop and phone.
- `r-20261113-142d30e7`: banner chip, 3 options (name = today's default, icon, scope).

The option assets are in `apps/console-web/plugins/skin-gallery/assets/{container,badge}/`, and the choices JSON in `choices/`.
Shots are in `_claude/builds/reports/skins-plugin-own-removable-console/shots/`.
They were taken on a local console with no hub (`AXF_APPEARANCE_HUB=off`), on scratch look documents.

## Gaps and choices made

- **Scoped preview.** The preview frames show the picked skin through `rt.previewSkin`, which reskins the whole
  console without saving anything. `SkinScope` and `InterfaceScope` resolve only saved looks, so drawing an unsaved
  skin inside just one frame needs a runtime `skinScoped`-style preview hook. That is kernel work for Fable; it is
  not in this build.
- **`axf skins-ui`.** `axf <plugin>` dispatches by folder name and has no alias mechanism, so the CLI is
  `axf skin-gallery …`. An alias field would be a plugin-commands@1 contract change (Fable).
- **Banner chip shots.** The test console's banner was full, so the chip was folded into the overflow. The chip shots
  show its popover, which now opens under the banner's right end when the chip has no box.
- **AppearancePanel.** It goes through the skin-switch@1 service only when a library provides `axf.skin-switch@1`
  (found by capability). Without the plugin, the runtime's own calls run as before.
- **MCP tool names.** They are `skin-gallery_list`, `skin-gallery_use` and so on, not `skins_*`, because names come from the folder.
