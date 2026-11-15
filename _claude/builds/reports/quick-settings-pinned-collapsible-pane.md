# quick-settings-pinned-collapsible-pane — Quick settings at the top of every settings interface

Build `quick-settings-pinned-collapsible-pane`: Phase 1 (s1, Fable) and Phase 2 (s2–s9, Opus).
Branch `claude/quick-settings-pinned-collapsible-pane`. Status: **s1–s8 done, s9 in this report**.

> "every settings interface has a collapsible pane at the very top, header Quick settings, doesn't scroll, everything
> scrolls underneath it; current skin and override console skin; default assets like navigation menu; it says it's
> overriding the current skin" (Brett, Nov 13 2026 18:07)

## What shipped

- **One frame for every settings interface.** `<QuickSettingsFrame scope>` (`framework/react/components/QuickSettings.tsx`)
  draws the pane first. These interfaces use it:
  - console Settings (scope `settings`)
  - a plugin's own settings: Settings → Plugins → <plugin> (`plugin.<tab>`), the plugin settings dialog, and the Plugins
    menu settings browser
  - chrome settings for tab groups, toolbars, banners, nav and the menu bar (`chrome.<type>.<instance>`)
  - Banner settings (`banner.<id>`) and Window settings (`window.<id>`)
- **Enforced.** `framework/cli/check-quick-settings.mjs` runs in CI. It fails on any settings dialog or `*SettingsView`
  that renders without the frame, whether directly or through a component that draws it (it follows components
  transitively, e.g. AllDialog → SettingsView). A tool that only edits settings can opt out on its line with
  `// quick-settings: exempt (<why>)`; the level editor does. An app whose baked framework is older than the pane is
  listed as *pending re-bake* until it is re-baked. Today that is only Molly's Navigation settings.
- **Pinned.** The pane uses `position: sticky` at the top of whatever scrolls the interface (the page, a dialog body, a
  floating window), so everything else scrolls under it. Its own body is capped at 45dvh and scrolls inside.
- **Collapsible.** Folding is remembered per interface (`axf.quick.<scope>.collapsed`). The handle style is set in
  Settings → Appearance → *Quick settings handle*: arrow, chevron button, grab bar or text (`quick.handle`). When the
  pane is folded and something is overridden, it shows an *Overriding* chip.
- **Contents, in order:**
  1. **Skin.** Shows the skin in force, with *Override console skin*. Ticking it gives just this interface its own skin,
     using skin-coverage@1 UI level `ui:qs.<scope>`; the frame's `<SkinScope>` draws it. The picker is greyed out until
     the box is ticked.
  2. **Default assets** for the interface, each showing the current asset with *Override console default*: navigation
     menu, toolbar, tab group and settings interface. Chrome dialogs list toolbar, tab group and settings interface.
     Each picker is greyed out until its box is ticked. Picks go through asset-gate@1, so an asset without a valid
     manifest is refused.
     - Where overrides apply: every tab row inside the frame (through `QuickAssetsContext` → `useTabGroupData`), the
       Settings page's toolbar and settings interface, and plugin settings dialogs.
  3. **Override notice.** Reads "This is overriding the current skin / defaults / skin and defaults". It lists each
     override with *Reset* (plus *Reset all here*), followed by the existing "N assets are controlled by their own
     settings" line (chrome.edits), which is shown only when there are such assets.

## How it is reached (API rule)

| Path | How |
|---|---|
| Deep link | `quick.open:<scope>` (Settings, a plugin's tab, a chrome / banner dialog), unfolded |
| Console API (REST, control@1) | `console.actions` → `quick.collapse:<scope>:<on\|off\|toggle>`, `quick.skin:<scope>:<skin\|off>`, `quick.asset:<scope>:<type>:<asset\|off>`, `quick.reset:<scope>`, `quick.handle:<style>`, `quick.state[:<scope>]` |
| State | console-control@1 target `panel:quick-settings`: `state` returns `{scope, kind, collapsed, handle, skin{console, override}, assets[{type, console, override}], overrides, notice}`, `set` folds, `press` toggles. The keys are ordinary settings (`axf.quick.<scope>.*`, `axf.quick.handle`) |
| MCP | `console_action` (the same ids), `console_control_state panel:quick-settings`, `console_control_do` |
| CLI | `node apps/console-web/plugins/console-commands/console.mjs action quick.skin settings <skin>`, `axf console state panel:quick-settings` |
| Voice (AmberX) | The action labels are searchable ("Override the console skin for one settings interface…"), so they run through console_action / console_control_voice |

## Checks run (all green unless noted)

- `tsc --noEmit` (console-web) ✓ · `vite build` ✓
- `check-theme` ✓ · `check-controls` ✓ · `check-toolbars` ✓ · `check-console-control` ✓ (inventory regenerated) ·
  `check-chrome-assets` ✓ · `plugin-lifecycle check plugins-menu` ✓ · `axf validate` (console-web) ✓
- `check-quick-settings` ✓ (9 interfaces when merged with the floating build; 1 pending re-bake)
- `framework/spec/check-quick-settings.mjs` ✓ (8 checks) · `check-asset-gate` ✓ 45/45 · `check-asset-overrides` ✓ ·
  `check-chrome-settings.mts` ✓ 282
- `help-coverage --check`: framework is back at 100%. **console-web is at 99.6% from 6 controls in the approvals-banner and
  molly-guide plugins.** Those came from earlier main merges, not this build, so I left them alone.
- Playwright on the built console, desktop 1280×800 and phone 412×860:
  - one pane on Settings, no page errors
  - the pane stays at the top after scrolling
  - the nav-menu override shows the notice
  - folding persists across a reload
  - The same run on a trial merge with `claude/all-settings-interfaces-open-floating` shows the pane pinned to the
    top of the floating dialog's scrolling body.
- **Not exercised end to end:** *Override console skin*. The offline harness has no app look (it comes from axHub), so
  `scopeSkin` refuses. It is the same `rt.scopeSkin` path that Settings → Appearance → *Where the skin applies* already
  uses.

## Works with the other settings builds (s7)

- **Per-instance settings-window picker:** already on main. My branch merges with main with no conflicts in the s2–s8
  files, and the chrome dialog keeps its frame.
- **All settings interfaces open floating** (`claude/all-settings-interfaces-open-floating`, not landed): the only overlap
  is the `TAB_DIALOG` line. Resolve it by keeping `surface: 'glass', size: 'wide'` and wrapping in the frame:
  `render: (p) => <QuickSettingsFrame scope={quickScopeId(\`plugin.${p.tab}\`) || 'settings'}><TabDialog …/></QuickSettingsFrame>`.
  Its `AllDialog` renders `SettingsView`, which already draws the pane.
- **Left over from s1** (asset-gate@1, Fable): conflicts with main in `core/runtime.ts` (framework + 4 baked copies),
  `framework/cli/build-engine.mjs`, `PORTING.md` and `android.yml`. The generated `src/control/inventory.json` also
  conflicts; regenerate it after merging.

## Open

- Molly, axHub web and AmberX droid carry older baked frameworks. They get the pane when they are re-baked
  (`node framework/cli/rebake.mjs`), and check-quick-settings then enforces it there (Molly's Navigation settings is the
  one listed).
- Inline Settings → Plugins → <plugin>: the *Settings interface* override applies in the plugin's own dialog and to
  tab rows inside. The inline page is still laid out by the console Settings interface's pick.
- Kotlin twin deferred (PORTING.md, quick-settings@1).
- UI Review: desktop and phone shots are in `_claude/builds/reports/quick-settings-pinned-collapsible-pane/`. They are
  not in the review queue yet: this headless session has no console token (AXF_CONSOLE_URL / AXF_TOKEN). PR #698.
