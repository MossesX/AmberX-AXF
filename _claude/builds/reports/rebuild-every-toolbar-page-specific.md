# Rebuild every toolbar with page-specific buttons

Build `rebuild-every-toolbar-page-specific`, branch `claude/rebuild-every-toolbar-page-specific`, Nov 17 2026.

Brett: "Everywhere there's a toolbar, rebuild the asset for that page/plugin with useful, integrated buttons made for it. Use Fable."

Phase 1 (Fable) built the contract (`page-toolbar@1`), the migration, the engine, fixtures, the React `<PageToolbar>` and
the API spine (`toolbar:<id>` / `toolbar:<id>/button:<b>`). Its differences report is
`_claude/memory/docs/rebuilds/rebuild-every-toolbar-page-specific.md`. Phase 2 (Opus, this report) ships the page assets.

## Result

- 19 page toolbar assets on 18 console plugins, 97 buttons, each bound to an existing action: the plugin's own commands
  (`command:<plugin>/<cmd>`, the same call REST / MCP / CLI make), the plugin's registered console actions (`action:`),
  or a page handler (`handler:`) that runs the same function the page's own buttons run.
- Every page draws its toolbar with `<PageToolbar view=… slot=…>` and publishes the state the buttons read
  (selection, counts, toggles), so buttons enable, badge and toggle from live page state.
- 59 of the 122 inventoried toolbars sit on a page that now has a page toolbar (marked `rebuilt` in `inventory.json`).
  The handwritten bars stay beside it for now (filters, search fields, pickers that are not buttons).
- Approve / Reject (UI Review) and merging (merge queue) stay person-only or queue-only: no toolbar button decides or merges.
- Destructive buttons (Remove from the merge queue, Restore to default, Reset rules) are drawn in the danger tone and
  ask first; through the API they answer `confirmation_required` until sent with `confirm`.

## Each toolbar, before and after

| Toolbar (deep link) | Plugin | Before: handwritten bars on the page (buttons) | After: page toolbar buttons (`ref kind`) |
|---|---|---|---|
| `toolbar:agent-swarm` | agent-swarm | — | Hire `handler`, Run job `handler`, Job types `handler`, Pause agent `handler`, Agent card `handler`, Budget `handler` |
| `toolbar:build-orchestrator.pipeline` | build-orchestrator | watchdog-actions (3), attempts (2), groups-new-group (1), groups-selected-builds (3), settings (4), show-states (1), smart-rule (2), group-actions (4), bulk-actions (2), show (3), watchdog-actions (3) | Queue selected `handler`, Split now `command`, Set priority `command`, Raise to Fable `handler`, Show what Brett said `handler`, Open PR `handler`, Relaunch `command`, Filter by status `handler` |
| `toolbar:chat-viewer` | chat-viewer | — | Sync chats `handler`, Search `handler`, Export `handler` |
| `toolbar:claude-accounts` | claude-accounts | — | Switch account `handler`, Check accounts now `command`, Refresh `handler`, Job routing `handler`, Add a worker `handler`, Recent runs `handler` |
| `toolbar:codebase-changes` | codebase-changes | — | Filter live `handler`, Resume `handler`, Open branch `handler`, Show areas `handler` |
| `toolbar:terminal.sessions` | console-terminal | context-chain (4), terminal-commands (12), extra-keys (3), find-sessions (2) | New tab `handler`, Split `handler`, Jump into session `action`, Mirror session `action`, Copy `handler`, Clear `handler`, Send to Claude `handler` |
| `toolbar:data-store` | data-store | data-store-backups (2), data-store-mode (4) | Back up now `command`, Verify backup `command`, Sync tables `command` |
| `toolbar:gate` | gate | gate-auto-lander (5), gate-build-rule (3), actions (1), gate-build-rules (1), gate-build-rules-run (2), gate-history (1), gate-lander (4), gate-rules (2) | Land now `command`, Pause lander `command`, Resume lander `command`, Run auto-lander `command`, Build rules `handler`, History `handler`, Reset rules `command` |
| `toolbar:glossary-index` | glossary-index | chapter-actions (4), item (5), book-builder (2), book-actions (4), step (4), demonstration-actions (6), clip-actions (3), tab-clip-clip-list-tools-demonstration-list-tools (4), entry-actions (8), index-tools (2), demonstration-player (4) | Search `handler`, Undescribed `handler`, Drafts `handler`, Rebuild index `command`, Make a demo `command` |
| `toolbar:notify-control` | notify-control | — | Mark read `handler`, Filter by plugin `handler`, Notification settings `handler` |
| `toolbar:plan-studio` | plan-studio | catalog-view-and-filters (2), plan (3), view-filter-and-sort (5), bulk-actions (2), categories (5) | New plan `handler`, Search `handler`, Park `handler`, Turn into a build `handler`, Move category `handler`, Attach media `handler` |
| `toolbar:plugin-manager` | plugin-manager | plugin-list (2) | Enable/Disable `handler`, Open settings `handler`, View logs `handler`, Show dependencies `handler`, Check clashes `handler`, Install/Uninstall `handler`, Update/Replace `handler` |
| `toolbar:push-banner.merge-queue` | push-banner | merge-queue (6), kicked-out (1), not-queued (1), merge-queue (2) | Add PR to queue `command`, Move up `command`, Move down `command`, Remove `command`, Run queue `command`, Open CI `handler`, Show red reason `handler` |
| `toolbar:shipped-features` | shipped-features | shipped-features-filters (7), shipped-features-actions (3), shipped-features-view (1) | Sync `command`, Import manifests `command`, Backfill (dry run) `command` |
| `toolbar:systems-check` | systems-check | — | Run checks `handler`, Auto fix all `handler`, Mute `handler`, Open source `handler` |
| `toolbar:theme-manager` | theme-manager | roll (5), token-tree (0), saved-themes (0) | Use skin `handler`, Back to skin `handler`, Preview `handler`, Scope here `handler`, Pick asset `handler`, Restore to default `handler` |
| `toolbar:ui-review.queue` | ui-review | b-title (2), group (5), screenshot-groups-search-and-view (3), screenshots-filter-and-view (3), selected (4), filter-and-view (0) | Group by `handler`, Compare before/after `handler`, Open PR `handler`, Open choices `handler` |
| `toolbar:ui-review.shots` | ui-review | b-title (2), group (5), screenshot-groups-search-and-view (3), screenshots-filter-and-view (3), selected (4), filter-and-view (0) | Send to review `handler`, Group by `handler`, Compare before/after `handler`, Rename group `handler` |
| `toolbar:wake-listener` | wake-listener | history-filter (2) | Listen `command`, Stop listening `command`, Claude understands `command`, Rules only `command` |

## How every button is reached

Each toolbar is addressed by its settings id (`toolbar:<id>`), each button by `toolbar:<id>/button:<button id>`.

| Surface | Open / deep link | Read state | Press a button |
|---|---|---|---|
| Console UI | the page; `console_open toolbar:<id>` | — | tap / click (tap-to-confirm on touch) |
| REST | `POST /api/console-control/do {verb: open, address: toolbar:<id>}` | `GET /api/console-control/toolbars/<id>` | `POST /api/console-control/toolbars/<id>/press {button, confirm?}` |
| MCP | `console_control_toolbar {toolbar, open: true}` | `console_control_toolbar {toolbar}` | `console_control_toolbar {toolbar, button, confirm?}` |
| control@1 | `console.toolbars` | `get <id>` | `act press <id>/<button>` |
| CLI | `axf console do open toolbar:<id>` | `axf console toolbar get <id>` | `axf console toolbar press <id> <button> [--confirm]` |
| Voice (AmberX) | "show the <toolbar> toolbar" | "what's on the <toolbar> toolbar" | "press <button> on the <toolbar> toolbar" |

The voice inventory is `framework/spec/fixtures/page-toolbar-voice.json` (97 phrases). Buttons bound to a
`command:` ref are also callable with no page open, as the plugin command itself (`axf <plugin> <command>`, MCP
`<plugin>_<command>`, `POST /api/control/<plugin>/<command>`).

## Checks

- `framework/spec/check-page-toolbars.mts` (CI): every plugin toolbar asset is page-scoped, every button bound to a ref
  that exists (plugin command in the registry, handler registered by the page, action registered by the plugin, valid
  control address), drawn by its page, enabled when its terms hold, and reachable by deep link, REST, MCP, CLI and voice.
- `framework/spec/check-page-toolbar-voice.mts` (CI): each phrase in the voice inventory resolves, through the console's
  target search, to the same address the REST / MCP / CLI / control@1 press names.
- `plugins/<folder>/toolbar.test.mjs` (CI, by glob): each plugin's buttons as shipped, plus page-specific rules (no
  approve / reject in UI Review, no merge in the merge queue, Restore to default destructive with confirm).
- `framework/cli/check-toolbars.mjs` rules 4 and 5: page toolbar assets are page-scoped with every button bound; the
  plugins that still draw a handwritten toolbar with no page asset are held in the ratchet
  `framework/spec/toolbar-page-baseline.json` (21 plugins, only comes down).

## UI Review options

Each page toolbar ships three looks as ui-choice assets beside it (`plugins/<folder>/assets/toolbar/toolbar-<asset>-<option>.json`,
57 in all; generator `_claude/builds/reports/rebuild-every-toolbar-page-specific/options.mjs`):

- **Dense icons**: icons only, every button on one short bar.
- **Icons + text**: icon and name on every button (ships as the default).
- **Grouped with overflow**: the first group on the bar, the rest in More.

Options are never auto-picked for a page (the console loads page toolbars without the `ui-choice` tag; a picked option
joins through UI Review's choices). The pictures and the `review.mjs submit --choices` items (grouped per app) are not
done yet: `rebuild-shots.mjs` starts a scratch console that waits for axHub, and the headless browser here has no hub
session, so every capture showed "Waiting for axHub". Step s27 stays open for a session that can capture.

## Known gaps

- Skipped this phase: Molly, AmberX web, axHub web and Expenses toolbars (s22–s24 marked skip on the build).
- Framework library bars (Settings level, workspace, tree, window frame) keep their handwritten controls: the Settings
  level bar's main control is a level picker, not buttons; a shared framework asset for it needs another re-bake.
- 21 console plugins with handwritten toolbars have no page asset yet (the ratchet lists them): Home, Plan, basic
  filter, build breaker, builds page, changes grid, Claude handoff, context menu designer, demonstration designer,
  feature matrix, md studio, notes browser, Plan Studio 2, plugin commands, plugins menu, session check-in, skin editor,
  skin gallery, theme editor, to-do manager, What's shipped.
- `handler:` buttons need their page open (they run the page's function); the API answers with the engine's reason
  otherwise. Command-bound buttons work with no page open.
- Two windows of the same page (two Terminal hosts) share one toolbar id; the last one mounted answers the API.
- Kotlin twin of the page toolbars stays deferred (`framework/spec/PORTING.md`).
