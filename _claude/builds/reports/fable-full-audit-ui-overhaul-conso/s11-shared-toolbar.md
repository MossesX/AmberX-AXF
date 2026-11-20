# s11: one shared toolbar

Goal: every console plugin draws the same framework toolbar (`<PageToolbar>`, page-toolbar@1 assets), no
plugin-made toolbars.

## Found

- 19 console plugins drew their own `role="toolbar"` divs with no toolbar asset (the ratchet
  `framework/spec/toolbar-page-baseline.json` held them). Those bars had no settings id, no context menu, no overflow
  and no API (deep link, REST, MCP, CLI, voice): the shared toolbar has all of these.
- Framework bug: `<PageToolbar>` rendered nothing when its page had no asset (or no runtime yet). A page that put its
  search field inside the toolbar would lose the field. Fixed: with no `fallback` given it now draws its children as a
  plain group (framework/react/components/Toolbar.tsx; the baked copies in console-web, axhub-web and molly are synced
  and their axf.lock hashes updated).
- Two plugins styled their bar themselves (Todos selection bar border and background, the Todos filter icon colour).
  Plugin CSS only lays a toolbar out now; the look is the framework's.
- `framework/spec/fixtures/page-toolbar-voice.json` was already behind the assets on main (build-orchestrator
  `queue`); it has been regenerated.

## Fixed: moved to the shared toolbar (asset + `useToolbarHandlers` + `<PageToolbar>`)

| Plugin | Toolbar(s) | Buttons |
|---|---|---|
| whats-shipped | whats-shipped | mark all read, check now, settings |
| changes-grid | changes-grid | reload, collapse all |
| feature-matrix | feature-matrix | import open builds, reload, collapse all |
| context-menu-designer | context-menu-actions | filter (badge: changed choices) |
| build-breaker | build-breaker | reload, expand, collapse, clear filters |
| builds-page | builds, builds-steps | reload; select all, divide, harvest, restore default |
| notes-browser | notes, notes-note | new note, new folder, reload; edit, save, rename, delete |
| md-studio | md-studio | save, edit, pane layouts, reload files |
| plugin-commands | plugin-commands | refresh |
| session-checkin | session-checkin | refresh, flagged only, settings |
| theme-editor | theme-editor | copy as new, back to active, copy JSON, paste JSON, load file |
| todo-manager | todo-manager, todo-manager-selection | new task, new group, filters; done, duplicate, delete, clear |
| plan-studio-2 | plan-studio-2, plan-studio-2-item | new plan, undo delete, expand, collapse, export, reload; new inside, move, link, send to build, delete |
| skin-editor | skin-editor, token-registry | pick a screen, pick element, every element, undo, browse tokens; edit skins |
| skin-gallery | skin-gallery | use skin, back to skin, restore to default (asks), undo |
| demonstration-designer | pitch, saved, record, timeline | play, export, share, delete; refresh; record, make steps; add step, save, revert |
| claude-handoff | claude-handoff-look, claude-handoff-files | roll, undo, tokens, back to app look; refresh |
| plugins-menu | plugins-menu | plugin list, reload, menu settings |

Fields (search boxes, Segmented switches, selects, counts) ride inside the shared bar as its children. Each plugin
ships `toolbar.test.mjs` (framework/spec/page-toolbar-test.mjs). Help targets that pointed at removed buttons now point
at the toolbar buttons (`action:handler:<id>`; plugin-commands, skin-gallery).

Rows that were only fields are no longer called toolbars: Plan Studio 2.0 tree find (`role="search"`) and command
row (`role="group"`), Skin editor token level (`role="search"`), Skins preview size (`role="group"`).

## Left, with the reason

- **basic-filter**: the plugin *is* a user-built filter bar (presets, display, alignment are its own settings) that
  other pages attach. Turning it into a page-toolbar asset is a redesign of the plugin, not a swap; it stays in the
  ratchet. No feature removed.
- **Per-item button clusters** (not page toolbars, kept as framework-tagged `role="toolbar"` so tap-to-confirm still
  guards them): Basic filter rule actions, Demonstration Designer step rows, Skins chip quick actions (banner popover),
  MD Studio's Markdown formatting row (one per editor pane; a split shows several, and page handlers are one per page),
  Claude handoff's file-tab header (one per open file tab), Skin editor's sample toolbar (a preview of the toolbar
  look).
- **molly/expenses, molly/xlayout**: Molly, not the console; out of this build's scope.

Ratchet: 21 plugins → 3 (`console-web/basic-filter`, `molly/expenses`, `molly/xlayout`).

## Checks

check-toolbars (ratchet written), check-theme, check-controls, check-chrome-assets, check-page-toolbars (46 toolbars),
check-page-toolbar-voice (181 buttons), every converted plugin's toolbar test, plugin-lifecycle check, help-coverage,
console-web `tsc --noEmit` (only the existing missing generated `src/control/inventory.json`, which is gitignored).

Not done: UI Review screenshots. The headless capture (framework/cli/rebuild-shots.mjs) starts the console but cannot reach axHub from the scratch console ("Waiting for axHub ... Failed to fetch"), so every shot is the hub wait screen. The same blocker stopped the screenshots of build rebuild-every-toolbar-page-specific. The 18 plugins need desktop + phone shots from a console with a hub session before this is called ready.
