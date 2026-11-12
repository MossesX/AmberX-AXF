# Focus on every screen: console_open / console_show can jump to any item

Build `focus-on-every-screen-console-open-console-show-` · Phase 1 (Opus) · branch `claude/focus-on-every-screen-console-open-console-show-`

## Brett said (verbatim)
> Everything, everything needs to plan studio, UI review, everything. What the fuck?

## What was wrong
PR #496 added `<screen>.focus` only for the Build orchestrator. `console_open` / `console_show` with a focus on any other
screen answered "opened UI Review; it has no way to focus …". A settings dialog left open also stayed on top of the
screen that was opened.

## What changed
- **Every view answers `<view>.focus:<key>`.** `framework/core/screen-focus.ts` is the focus engine; the shell
  (`framework/react/screenFocus.ts`, wired in `AppShell`) registers a generic focus for every view that doesn't have its
  own. It closes a covering dialog, opens the view, then waits for the page to draw and finds:
  1. an item marked with the key (`data-fx-focus-key`, a context-menu payload, a settings anchor, an element id);
  2. a tab whose value or label is the key (counts like "(12)" ignored), and clicks it;
  3. the smallest row / card / group whose text contains the key (after 1.5 s).
  It unfolds the hit (`<details>`, or its own fold toggle: never a menu button), scrolls it to the middle and keeps it
  highlighted (`.fx-focus-hit`, accent ring from asset tokens) until the next focus.
- **Screens with their own state answer it themselves:**
  - **UI Review** (`ui-review.focus`, `ui-screenshots.focus`, `design-packs.focus`): a tab (review / screenshots), a
    section, a review group, an item id (filters cleared, Compare switched to Grid, row opened, scrolled, highlighted),
    or a screenshot / screenshot group (Screenshots tab).
  - **Plan Studio** (`plan-studio.focus`): a tab, a plan by id or title (its editor opens), a category path, a catalog
    feature (Catalog tab).
  - **Settings** (`settings.focus`): a tab id or label, `tab#anchor`, a setting key, a group or panel id; a folded group
    unfolds first, then the row comes forward.
  - **Build orchestrator** keeps its own from #496 (Pending, All builds, every tab and build).
- **Every list is marked.** All 32 plugin / library screens that drew lists without a marker now put
  `data-fx-focus-key` on their rows, cards and groups (186 elements); the framework `Container` takes `focusKey`.
- **Covering dialogs close.** `console_open` / `console_show` of a screen closes an open dialog first; a settings tab
  with an anchor goes through `settings.focus`.
- **Check:** `node framework/cli/check-screen-focus.mjs` fails when a screen that lists items marks none and registers
  no `<view>.focus`, when the shell stops registering the generic focus, when `settings.focus` goes, or when opening a
  screen stops closing a covering dialog. A screen with nothing to jump to opts out with
  `"screenFocus": "none: <why>"` in plugin.json. In CI (android.yml + ci-scope light commands), plus
  `framework/spec/check-screen-focus.mts` (27 checks, jsdom: marked hit, tab hit, text fallback, `<details>`, fold
  toggle clicked and menu button not).

## How it is reached (API)
| Surface | How |
|---|---|
| MCP | `console_open(screen, focus=…)`, `console_show(target, focus=…)`: docs now say every screen takes `focus` |
| REST | console-commands `open` / follow-amber `show` with `focus` (unchanged routes) |
| CLI | `node apps/console-web/plugins/console-commands/console.mjs open <screen> --focus <tab, group or item>` |
| Actions | `<view>.focus:<key>` for every view (search, context menus, toolbars, `run` console commands) |
| Voice (AmberX) | Amber's console_show / console_open calls carry `focus` the same way |

## Tests
- `check-screen-focus.mjs` ok (71 plugin web folders); `check-screen-focus.mts` 27/27
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`, `check-plugin-pages` pass
- console-web `tsc --noEmit` clean
- ui-review 30 + 229 checks, plan-studio 26 + 15, console-commands 7, follow-amber 40, MCP tools 206: all pass
- `help-coverage --check` fails on `plugins/agent-slots/help.json` (an entry kind): already on main, not touched here

## Gaps
- **No screenshots.** Playwright isn't installed in this worktree (the live-preview follower logged the same), and the
  page exposes no runtime handle to drive a focus from outside without the full console stack. The visible change is the
  highlight ring on the focused item; UI Review submission is still owed.
- Other apps that bake the framework (axHub web, Molly, AmberX droid, demo) get the generic focus on their next rebake.
- No Android/Kotlin twin (no new Kotlin work): deferred.
