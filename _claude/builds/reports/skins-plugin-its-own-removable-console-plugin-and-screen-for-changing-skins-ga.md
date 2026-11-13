# Skins plugin: removable plugin and screen for changing skins

Build `skins-plugin-its-own-removable-console-plugin-and-screen-for-changing-skins-ga` · branch
`claude/skins-plugin-its-own-removable-console-plugin-and-screen-for-changing-skins-ga` · PR #553.

## What landed

| Phase | Model | What |
| --- | --- | --- |
| Fable phase 1 | Fable | skin-switch@1 engine (`framework/core/engines/skin-switch.mjs`): use / back-to-skin / restore-default / undo per scope (hub, app:<id>, ui:<view>, plugin:<id>), one undo record in the look document; fixture `spec/fixtures/skin-switch.json`, check `spec/check-skin-switch.mts` (CI); Kotlin twin deferred in PORTING.md |
| Opus phase 1, s1 | Opus | Removable plugin `apps/console-web/plugins/skin-gallery` (shown as **Skins**): plugin.json, install / uninstall / hooks, help, README; `skin-gallery.mjs` CLI over the engine and the framework skins CLI's documents (no second store); REST routes; plugin-commands@1 auto commands; `test.py` (16 checks) |
| Opus phase 1, s2 | Opus | Gallery screen, live preview (desktop / phone frame, `rt.previewSkin`, nothing saved until Use skin), scope TabGroup with screen / plugin picker, Use skin / Back to skin / Restore to Default (confirm, undoable) / Undo toolbar, banner quick switcher (`KNOWN_BANNERS`) |

Folder name: `skin-gallery`, not `skins`. "skins" is a common key across the repo (theme-manager's `skins` field),
so the lifecycle stale-reference check flagged it; the user-facing name stays "Skins".

## How every feature is reached

| Feature | Deep link | REST (`/api/plugins/skin-gallery/`) | MCP / `axf` CLI (plugin commands) | Local CLI | Voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| Open the gallery | `#/skin-gallery`, `console_open {kind: screen, target: skin-gallery}` | `GET open?skin=&scope=` | `skin-gallery open` | `skin-gallery.mjs open [<skin>] [--scope]` | "open skins" |
| List skins | — | `GET skins` | `skin-gallery skins` | `skin-gallery.mjs list` | plugin command |
| Scopes | `?scope=hub \| app \| ui:<v> \| plugin:<id>` | `GET scopes` | `skin-gallery scopes` | `skin-gallery.mjs scopes` | plugin command |
| State of a scope | — | `GET state?scope=` | `skin-gallery state --scope …` | `skin-gallery.mjs state --scope …` | plugin command |
| Preview a skin | `?skin=<id>&view=phone` | — (preview is screen only, by design: it saves nothing) | — | — | — |
| Use skin | — | `POST use {skin, scope}` | `skin-gallery use --skin … --scope …` | `skin-gallery.mjs use <id> --scope …` | plugin command |
| Back to skin | — | `POST back {scope, slot?}` | `skin-gallery back` | `skin-gallery.mjs back [<slot>]` | plugin command |
| Restore to Default | — | `POST restore {scope}` | `skin-gallery restore` (confirm) | `skin-gallery.mjs restore --scope …` | plugin command |
| Undo | — | `POST undo` | `skin-gallery undo` | `skin-gallery.mjs undo` | plugin command |
| Quick switcher | banner (Banner settings → Quick skin switcher) | same routes (scope `app`) | same | same | same |

## Tests

- `python3 apps/console-web/plugins/skin-gallery/test.py`: 16/16 (hub, app and plugin round trips, undo after
  restore, second undo refused, unknown skin / bad scope refused, deep link).
- `npx tsx framework/spec/check-skin-switch.mts`: 392 checks. `check-skin-coverage.mjs`: 55 types, 0 uncovered.
- `tsc --noEmit` (console-web): clean. check-theme, check-controls, check-toolbars, check-chrome-assets: clean.
- `plugin-lifecycle check skin-gallery`: only finding is the local, untracked `.axf-focus.json` watcher file.
- `scripts/lazy-loader-check.mts`: fails on `project-switcher` missing from `KNOWN_BANNERS`. That was already
  failing before this build; not changed here.

## Open (next phases)

The original 20-step split was replaced by a 3-step plan after the splitter failed. These items from it are still open:

- Desktop and phone screenshots of the gallery, preview, scope picker and banner chip; UI Review submission with
  3 layout choices for the gallery and the chip (s17, s19). Not submitted yet; the PR is not ready for review.
- Plugin settings sub-tab content (show the banner chip, default scope, preview viewport) with API parity (s15).
  Today the tab holds only the lifecycle panel, and the banner chip is always shown while the plugin is on.
- Context-menu "Change skin here…" on view and plugin roots (s14).
- AppearancePanel in framework/libs/settings calling skin-switch@1, plus an "Open Skins gallery" link found through
  a capability check (s16).
- Named console actions `skin.use / skin.back / skin.restore / skin.undo` for voice. Voice reaches the plugin
  commands today.
- Preview inside a framed copy of the app. The preview applies the skin to the live console and frames a sample
  panel at phone width; it doesn't draw a separate rendering.
