# Tabs get API control — report (build `tabs-api-control`, Nov 8 2026, Opus, headless)

## What Brett asked
Agents could open a screen but not switch its tabs (Build orchestrator › Pipeline). Every tab and tab group in every
app must be API / voice / MCP controllable: per-tab actions listed by `console_list`, `console_open "screen/tab"`,
`console_show` on a tab, sub-tabs / settings sections / accordions by id or label, deep links, tests on Build
orchestrator › Pipeline, Plan Studio and Settings, and a CI check that fails on a tab without an action.

## What landed (tab-control@1, framework-wide)
- **Pure engine** `framework/core/engines/tab-control.mjs` (+ `.d.mts`): path split (`/`, `›`, ` > `), tab matching
  (value, label, prefix), target pick (row on the current screen first; `row:tab`; sections by title or id), per-tab
  action ids `tab.<row>.<tab>`, deep-link param `axf-open`.
- **Live registry** `framework/react/tabRegistry.ts` (no React) + hooks `framework/react/tabControl.ts`:
  - every `TabGroup` registers its row (`useTabControl`); hand-drawn strips (Terminal tabs, Workspace panes) do too;
  - every titled `Container` and every settings section registers as a **section** (`useSectionControl`): a path part
    naming it expands it and scrolls to it;
  - `openTabPath(rt, "screen/tab/sub/section")` opens the screen, waits for each row to draw, switches/expands; on
    Settings a part naming a settings tab goes through `settings.open` (sub-tabs open their parent);
  - actions: `tab.open:<path>` (params) + one navigate-only `tab.<row>.<tab>` per tab of every row the device has
    shown (remembered in localStorage so they stay listed after the screen closes) → they show in
    `console_list kind=actions`;
  - deep link `?axf-open=<path>` (waits for lazily loaded plugin screens), `tabDeepLink(path)` builds one;
  - installed by `<AxfProvider>` for every app on the framework.
- **Console domain** (`console-commands.mjs`): `console_open` resolves `screen/tab…` strictly (leading parts = the
  screen's id or title, the rest is the tab path → message field `tab`); a bare tab name the console listed runs its
  tab action; `tab.*` actions count as navigate; `console_where` reports `here.tabs` (`row:tab` on screen).
- **Console client** runs `open` + `tab` through `openTabPath` and acks what it opened (async, de-duplicated).
- **REST** `POST /api/console/open {screen, tab?}`; **MCP** `console_open` / `console_show` docs name tab paths;
  **Follow Amber** `console_show` takes `tab:<screen>/<tab>` (or a plain `screen/tab`).
- **CI** `framework/cli/check-tab-actions.mjs` (android.yml): framework wiring present, every framework `<TabGroup>`
  has an `id`, a hand-drawn `role="tablist"` / `role="tab"` / `data-axf-tab-group` row must call `useTabControl`.
  Today: 419 files, 0 findings. Tests `framework/spec/check-tab-control.mts` (49 checks, in CI).

## Tested
- `check-tab-control.mts` 49/49 (engine, console domain, registry on a stand-in runtime: Build orchestrator ›
  Pipeline, Plan Studio › Board, Settings › Plugins › Console commands › section, unknown tab lists what is there,
  bare tab name, per-tab action, `tab.open`, remembered rows, CI check positives/negatives).
- Real console (vite preview + Chromium): `?axf-open=build-orchestrator/pipeline` → Pipeline tab active;
  `tab.open:Plan Studio › Catalog` → Catalog; `tab.open:settings/plugins/console-commands/When no console is open`
  → that section in view; `tab.build-orchestrator.tabs.builds` → Builds. Shots in `tabs-api-control/shots/`.
- Unchanged suites green: check-console-commands (66), check-tab-group (445), check-tapconfirm, check-control (369),
  check-chrome-settings, console-commands plugin + server (82), follow-amber server (35), MCP tools (203),
  check-toolbars, check-chrome-assets, check-theme, check-controls, plugin-lifecycle, glossary, console tsc.

## Contract notes
- console-command@1 gains an optional `tab` field; console-catalog@1 `here` gains optional `tabs`. Additive: old
  consoles ignore `tab` (they open the screen), old servers never send it.
- Kotlin twin deferred (PORTING.md row added). axHub web, AmberX, Molly and the demo pick tab control up on their next
  re-bake (their baked copies were already stale on main); the console is re-baked here.

## Gaps
- Per-tab actions appear for rows a device has shown at least once; a never-opened screen's tabs are still reachable
  by path (`console_open "screen/tab"`), just not listed until first shown.
- `help-coverage --check` was already below its ratchet on main (claude-accounts), unrelated to this build.
- No UI changed visually, so nothing went to UI Review.
