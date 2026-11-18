# Plan Studio 2: Open button, working deep links, Ctrl+K command palette

Build `plan-studio-2-open-button-working-deep`, branch `claude/plan-studio-2-open-button-working-deep`.

## Result

- **Plan Studio 2.0 opens its page, not only its settings.** Its view root is a `SkinScope` with the control scope
  `view:plan-studio-2`; the tree is `grid:plan-studio-2.tree`, every item a `row:<id>`. Its settings sub-tab has an
  *Open Plan Studio 2.0* button, and the Plugin Manager / Amber → Plugins know its page from `plugin.json` before
  the chunk has loaded once (that gap is what sent "open" to the settings).
- **Open button** on the tree tools (the selected row) and on every plan row (and any row with children): the plan on
  its own, with *All plans* to go back. Framework `Button`s in `role="toolbar"` rows with aria-labels, so tap-confirm
  applies on touch.
- **Deep links work**: `#/<view>[/<sub>…]`, `?axf-target=<address>` and `?axf-open=` are read before the first
  render, wait for a lazily loaded plugin view, then open with the highlight; `hashchange` / `popstate` follow links
  while the console is open; a target that never arrives is a notice, not Home.
- **One Ctrl+K command palette**: the console-control search palette, now over every control target, plugin
  command and Plan Studio 2.0 plan, recent first, destructive presses confirm, approve / deny / owner-only never
  listed; a Search button on the banner for phones; three looks as dialog assets.

## How each feature is reached

| Feature | Deep link | REST | MCP | CLI | Voice (AmberX) |
| --- | --- | --- | --- | --- | --- |
| Plan Studio 2.0 page | `#/plan-studio-2`, `?axf-target=view:plan-studio-2` | `POST /api/console-control/open {target}` | `console_open("view:plan-studio-2")` | `axf console open '#/plan-studio-2'` | "open plan studio 2" |
| Open one plan | `?axf-target=view:plan-studio-2/plan:<id>`, `#/plan-studio-2/plan:<id>` | `GET /api/plugins/plan-studio-2/plans/<id>` (state + address), `POST …/plans/<id>/open` | plugin commands `plan-studio-2 plan` / `open` (plugin-commands@1), `console_open("view:plan-studio-2/plan:<id>")` | `node apps/console-web/plugins/plan-studio-2/tree.mjs open <id or words>`, `axf plan-studio-2 open --id <id>` | "open Launch day" (`POST …/plan-studio-2/say`, relayed to the console) |
| Back to all plans | — | console action `plan-studio-2.close-plan` via `/api/console-control/do` | `console_action("plan-studio-2.close-plan")` | `axf console do press function:plan-studio-2.close-plan` | — |
| What a link opens | — | `GET /api/console-control/resolve?target=…` | via REST | `axf console resolve <link>` | — |
| Follow any link | the link itself | `POST /api/console-control/open {target}` | `console_open` / `console_show` take URLs, `#/…`, `?axf-…=` | `axf console open <link or address>` | "open #/…", "open view:…" (`POST /api/console-control/voice`) |
| Command palette | `#/command-palette/<words>`, `?axf-target=view:command-palette&q=<words>`, `?axf-cmd=search&q=` | `GET /api/console-control/search?q=` | `console_control_search`, `console_open("view:command-palette")` | `axf console search <words>` | "search for …", "find …" |
| Palette look | — | `/api/console-control/do {verb: set, address: setting:console.palette.look}` | `console_control_set` | `axf console do set setting:console.palette.look --value command-palette-sheet` | "set the palette look to <option>" (the generic set intent) |

State is readable everywhere: `console_control_state` (screen, open dialog = the palette), `GET …/plans/<id>`,
`plan-studio-2 state`.

## What changed

- `plugins/plan-studio-2/web/{ui,index,api}.tsx`: SkinScope root, control scopes, Open buttons, opened-plan state,
  `plan-studio-2.open[:<id>]` / `plan-studio-2.close-plan`, Open panel, palette source for plans.
- `plugins/plan-studio-2/tree.mjs` (`open` op + CLI), `server/__init__.py` (`GET /plans/{id}`, `POST /plans/{id}/open`,
  voice open relayed), `plugin.json` (commands `plan`, `open`), `help.json`.
- `plugins/plugin-manager/web/model.ts`, `src/menuLibrary.tsx`: a plugin's page from `plugin.json` before its chunk loaded.
- `src/control/deepLink-core.mjs` + `deepLink.ts` (new), `executor.ts` (link opener), `index.ts`, `native/axfNative.ts`
  (its `?axf-open=` handling moved into the resolver).
- `src/control/SearchPalette.tsx`, `palette-core.mjs` (new), `src/assets/dialog/command-palette*.json` (new),
  `console.css`, `consoleSettings.tsx` (Settings → Interface → Command palette), `actions/console-control.ts`.
- `server/console_control.py` (`parse_link`, `resolve_link`), `console_control_api.py` (`/resolve`, `/open`, voice),
  `mcp_server.py` (`LINK_RE`), `framework/cli/console-control.mjs` + `axf.mjs` (`console open|resolve`).
- `framework/spec/CONSOLE-CONTROL.md` (deep links section). CI: `deeplink.test.mjs`, `palette.test.mjs`.

## Decisions

- `plan:<id>` is not a new console-control kind (that would be a contract change): a segment of a kind the contract
  has not got is the view's own `<view>.open:<id>` action.
- `axf plan` stays the control@1 planner word; Plan Studio 2.0's CLI is `tree.mjs open` and the plugin-commands
  `axf plan-studio-2 open`.
- Per-dialog asset picks (any dialog choosing its own dialog asset) need the asset contract (Fable). The palette reads
  its look from `console.palette.look` over its own three dialog assets meanwhile.

## Draft: trace (s1)

### Naming

The step list says `view:plan-studio` and `plans.mjs`; those belong to the original Plan Studio
(`plugins/plan-studio`, untouched by rule). Plan Studio 2.0 is `plugins/plan-studio-2`: view id `plan-studio-2`,
CLI `tree.mjs`, items in a plan-tree@1 (plans are top-level items). This build uses the real ids:
`view:plan-studio-2`, `view:plan-studio-2/plan:<id>`, and `tree.mjs open <id>`.

### Why Plan Studio 2.0 "opens only its settings"

1. **The plugin's web part registers its view** (`web/index.tsx` → `views['plan-studio-2']`, `plugin.json`
   `opens: "main"`, `tabable.view: plan-studio-2`), so the page exists. Nothing in the console points at it from the
   places Brett lands on, though:
   - Settings → Plugins → *Plan Studio 2.0* (where the gear, the plugin list and `plugin.settings.open` go) shows
     the settings and the lifecycle panel only. There is no Open button on it.
   - Its only Open button is a `builds.toolbar` slot (Build manager toolbar), and the nav entry sits in the Builds group.
2. **The Plugin Manager only knows the view after the chunk loaded once.** `bundledPlugins[].library` is
   `undefined` until the lazy loader has a shape for the folder (`src/plugins.ts` → `loader.library()`), and
   `uiOf()` (`plugins/plugin-manager/web/model.ts`) then answers `views: []`, so the row has no Open, and
   `openPlugin()` (`src/menuLibrary.tsx`) falls through to `settings.open:<tab>` or the Plugin Manager. On a fresh
   browser, after a redeploy (hash change → stale shape) or with the plugin set to "load when opened", the plugin
   opens its settings instead of its page.
3. **No Open on the plans themselves.** Rows open the editor section on click, but there is no Open button that
   brings one plan up as the page (`plan:<id>` sub-target), and no REST/CLI/voice "open" that names the same thing.

### Why `#/…` and `?axf-target=view:…` land on the main page

- Nothing parses `location.hash` or `?axf-target=` at all. The only load-time links are `?axf-open=<address|action>`
  (`src/native/axfNative.ts` `runDeepLink`) and `?axf-cmd=search` (`src/control/SearchPalette.tsx`).
- `runDeepLink` fires on a fixed 300 ms timer. A lazily loaded plugin view is usually not registered yet, so
  `executeControl(open)` answers not-found (or the view is unknown to `rt.navigate`) and the console stays on Home
  with a toast at best.
- No `hashchange` / `popstate` handling, so a link followed while the console is open does nothing.

### Ctrl+K today

Two keydown handlers answer Ctrl+K: `menuLibrary.tsx` opens `console-search` (the older "Search everything" dialog,
`src/consoleSearch.ts`), and `control/SearchPalette.tsx` opens `console-control.search` (the console-control search,
`src/control/search.ts`). Which one wins depends on listener order. Decision recorded in s9.

### Fix plan

- s2 Plan Studio 2.0 main view root: `SkinScope` + `data-axf-target="view:plan-studio-2"`; an Open panel on its
  settings sub-tab (Settings → Plugins → Plan Studio 2.0 → *Open Plan Studio 2.0*); the Plugin Manager falls back to
  `plugin.json` `provides: view:*` when the chunk has not loaded, so Open is there from the first visit.
- s3 Open button (framework `Button`, in a `role="toolbar"` row with an aria-label, tap-confirm on touch) on the
  plan list and on each plan row → `plan-studio-2.open:<id>` → `view:plan-studio-2/plan:<id>`.
- s4 one handler: REST `GET /api/plugins/plan-studio-2/plans/<id>` + `POST …/plans/<id>/open`, plugin command
  `open` (MCP through plugin-commands), `tree.mjs open <id>`, voice "open <plan>".
- s5–s7 a deep-link resolver (`src/control/deepLink.ts` + pure `deepLink-core.mjs`): parses `#/<view>[/<sub>]`,
  `?axf-target=<address>` (and the existing `?axf-open=`) before first render, queues the target until the view is
  registered (plugin views load lazily), then opens and highlights through the console-control executor; unknown
  targets show a notice; `hashchange` / `popstate` run the same path. Test `scripts/deeplink.test.mjs`.
- s8 parity: `console_show` / `console_open` accept the same addresses and URLs; REST
  `/api/console-control/resolve`; `axf console open <target|url>`; voice "open …".
- s9–s12 one palette: extend the console-control `SearchPalette` (dialog asset, plugin commands and plans in the
  results, recent first, never approve/deny or owner-only), retire the second Ctrl+K handler.

### Deep links: where they are resolved (s5)

- Load time: `src/native/axfNative.ts` `runDeepLink()` (only `?axf-open=`, a fixed 300 ms timer),
  `src/control/SearchPalette.tsx` (`?axf-cmd=search`), `framework/react/components/RefText.tsx` (`?axf-ref=`).
- `#/…` and `?axf-target=` are read nowhere, so `rt.navigate` is never called and the shell keeps its default view
  (Home). No `hashchange` / `popstate` listener either.
- Failing test first: `apps/console-web/scripts/deeplink.test.mjs` (`#/plan-studio`, `#/plan-studio-2`,
  `?axf-target=view:plan-studio`, plugin sub-targets, settings tabs, late plugin views, unknown targets). It fails
  with `Cannot find module src/control/deepLink-core.mjs` until s6.

### Ctrl+K: one palette (s9 decision)

Today three things answer Ctrl+K: the banner's search bar (framework `Search`, focuses itself), `menuLibrary.tsx`
(opens the older `console-search` dialog, a LiveSearch over the runtime index, when no bar is visible) and
`control/SearchPalette.tsx` (opens `console-control.search`, the console-control search). Which wins depends on
listener order; usually two react at once.

Decision: **the console-control `SearchPalette` is the command palette**. One component, one search
(`src/control/search.ts` `consoleSearch`, the same ranking REST `/search`, MCP `console_control_search`, `axf console
search` and voice "find …" use). It already ranks the runtime index (plan features, builds, windows, dialogs) next to
every control target, so nothing the old dialog found is lost.

- Ctrl+K / Cmd+K opens the palette, always (a capture-phase handler; the bar keeps `/`). `menuLibrary`'s Ctrl+K
  handler goes; `console.search` opens the palette when no search bar is on screen.
- Plugin commands are already `function:` targets (every registered action). Plans come in as a loaded source from
  Plan Studio 2.0 (`view:plan-studio-2/grid:plan-studio-2.tree/row:<id>`; picking one opens the plan).
- Its look is a `dialog` asset of the console (`src/assets/dialog/command-palette*.json`, three options for UI Review),
  picked with the console setting `console.palette.look`. A per-dialog asset pick in the framework (any dialog choosing
  its own dialog asset) would need an asset-contract change (Fable); recorded as a follow-up, not done here.

### Tests and checks (s13)

| Suite | Before | After |
| --- | --- | --- |
| `apps/console-web/scripts/deeplink.test.mjs` (new, in CI) | did not exist; failed first (s5) | 12 checks pass |
| `apps/console-web/scripts/palette.test.mjs` (new, in CI) | did not exist | 7 checks pass |
| `apps/console-web/plugins/plan-studio-2/test.mjs` | 17 checks | 17 checks, Open via CLI / api / voice and the manifest commands added inside them |
| `apps/console-web/server/tests/test_console_control.py` | 10 tests | 11 tests (resolve, open, voice "open <link>", MCP `LINK_RE`) |
| `apps/console-web/server/test_mcp_tools.py` | pass | 222 checks pass |
| `apps/console-web/src/native/nativeRules.test.mjs` | 7 | 7 (its `?axf-open=` now runs through the resolver) |
| `tsc --noEmit` (console-web) | clean | clean |
| check-theme, check-controls, check-toolbars, check-console-control, check-chrome-assets | pass | pass |
| shared-assets, chrome-settings, plugin-commands, check-plugin-settings, check-plugin-pages, help-coverage --check | pass | pass |

`apps/console-web/scripts/console-control-parity.mjs` fails with `fetch failed` on this VPS on this branch **and on
origin/main** (checked in a clean worktree): an environment problem of the harness here, not a change from this build.
