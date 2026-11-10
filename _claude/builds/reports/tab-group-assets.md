# tab-group-assets: every tab group, toolbar, banner and nav menu is an asset with an asset settings interface

Build `tab-group-assets` (Current profile), Nov 4 2026, Fable, branch `claude/tab-group-assets`.
Agent: Amber (headless worktree; the console's agent pick was unreachable: `claude-session start` answered 503).

## What Brett said (verbatim)

> "If it's a tab group, why can't I get to the tab group settings by right-clicking on it?" … "Needs to be. Yeah, all tab groups are supposed to be assets. With a settings interface, that's also an asset."

Addendum 1 (voice, Nov 4): "Right now, I want to make sure that navigation menus, toolbars, banners, are all asset types, and they all have a settings interface, which is an asset, and we can get to their settings by right-clicking all of them."

Addendum 2 (voice, Nov 4): "Every asset type that has the settings interface, there's going to be a default settings interface for all, used by default. And then there will be another one that will make a customized one for every app. And by default, the custom one will be selected."

Addendum 3 (voice, Nov 4, correction): "No, actually, by default, it uses the default one."

## What changed

### tab-group@1 (s1)
- `framework/schemas/asset-types.json` → `tab-group`: `style` gains `chips`; `position` gains `left` / `right` (a vertical rail); `overflow` gains `more` (the rest under a More menu) and `dropdown` (one button opens the list); new `display` (icons + text / text / icons; wins over the older `showIcons`), `sticky`, `collapsible` (fold to the active tab, per device), `closable` + `reorderable` (default on; they only show where the host passes `onClose` / `onReorder`), `badges` (count badges), `rememberLast` (per device). Every earlier asset renders unchanged: `TAB_GROUP_DEFAULT` is the pre-Nov 4 look.
- Engine `core/engines/components.ts`: `normalizeTabGroup` / `tabGroupStyle` compile the new fields to `data-fx-tabs-display | -sticky | -collapsible | -badges` on top of the existing attributes. The same attributes go on the app root (the app's active tab-group) and on every TabGroup element (its own effective asset): `ui/axf.css` rules for `.fx-tabs--group[data-fx-tabs=…]` outrank the root's descendant rules, so a row that picked its own asset keeps it.
- Seven new starters in `framework/assets/tab-group`: chips, icon-rail, side-dock, side-rail, more-menu, dropdown-compact, sticky-badged (37 in all; the default stays `underline`).
- Fixture `spec/fixtures/components.json` → `tab-group` (every starter's normalized data + output) and `tab-group-cases`; `spec/check-tab-group.mts` (444 checks: enums = engine, starters validate on both validators and keep every value they write, fixture replay, stylesheet tokens only).

### chrome-settings@1 (s2)
- ONE rules file `core/engines/chrome-settings-rules.mjs` (+ `.d.mts`, exported from `core/index.ts`): the chrome types that have a settings interface (`tab-group`, `toolbar`, `banner`, `nav-menu`, `app-menu`, `context-menu`; an open list), their ids (`chrome-<type>` shared default, `chrome-<type>-<app>` custom copy), settings keys (`axf.chrome.settings.<type>` = the interface in use, `axf.chrome.<type>.<instance>` = one instance's overrides, `…<instance>.asset` = a tab group's own pick), the context targets each kind reports, where each kind can move and through which setting, the fields each settings dialog edits (`CHROME_FIELDS`, every one a real field of the asset type, enums = asset-types.json), `resolveSettingsChain` (inherit@1 `extends` folding, depth ≤ 4, cycle-safe), `chromeSettingsPick` (the shared default unless the app picked its copy: addendum 3), `customCopy`, `chromeSettingsErrors`, `normalizeInstanceOverride`.
- `settings` assets gain `for` (the chrome type) and `extends` (inherit@1). Six shared defaults ship in `framework/assets/settings/chrome-*.json` (layout tabs-top, compact header, four tabs Look / Behaviour / Asset / Interface, levels on with Interface at Developer).
- Every app gets its custom copy automatically: `axf init` writes them (`cli/build-engine.mjs`), `node framework/cli/chrome-settings.mjs backfill` wrote them for the console, Molly, axHub web, AmberX and Expenses (30 files under `apps/*/src/assets/settings/`); `chrome-settings.mjs check` runs in CI.
- Fixture `spec/fixtures/chrome-settings.json`, `spec/check-chrome-settings.mts` (270 checks: registry, ids, inherit chain, picks, choices, overrides, errors, every app's copies present + valid, an unedited copy resolves to exactly its default).

### The framework TabGroup + the shared chrome context menu (s3)
- `react/components/TabGroup.tsx`: one component for every tab row (`<TabGroup id label value onChange tabs [onClose] [onReorder] [extra] [children] [asset] [size] />`), drawn from the row's effective asset (its own pick → the host's → the app's) with its overrides; More menu and dropdown overflow, sticky, fold, close buttons, drag-to-reorder, count badges, remember last tab, left / right rails with `children` laid out in `.fx-tabframe`. Carries `data-axf-tab-group` (its settings id) and the `tab-group` context target.
- `react/components/ChromeContext.tsx`: `installChrome(rt)` (called by `AppShell`) registers the actions `chrome.settings | chrome.pick | chrome.move | chrome.set | chrome.reset | chrome.swap | chrome.interface` and one `contextExtras('*:chrome')` block: **Settings…**, **Change <kind>…**, **Move ▸** on every tab group, toolbar, banner, navigation menu and menu bar. Dialogs `axf.chrome.settings` (laid out by the settings asset in force: tabs, hide, levels, search, header, descriptions, extra `groups`; Look / Behaviour edit the instance's overrides, Asset picks the asset, Interface picks the settings interface with *Reset custom to default*) and `axf.chrome.pick` (the picker alone).
- `react/components/Overlays.tsx`: a toolbar (`role="toolbar"`), a tab row (`role="tablist"`) or a `<nav>` that names no context target is still one, so every toolbar / tab row / nav in every app gets the block with no attribute of its own (its settings id = `data-axf-toolbar` / `data-axf-tab-group` / `data-axf-nav`, else its accessible name).
- `Chrome.tsx` / `NavTree.tsx`: the nav, toolbar and menu bar carry their targets + `app` instance ids. `core/runtime.ts`: the windowing menu (Undock / Split…) now only joins a window tab group's menu, never a page row's.

### Migrations (s4)
Every hard-coded tab row converted to `TabGroup` (id in brackets):
- Console: UI Review categories (`ui-review.sections`, the row Brett pointed at) and Review / Screenshots (`ui-review.tabs`); Build manager views (`build-manager.views`); Plan Studio (`plan-studio.tabs`); Build orchestrator (`build-orchestrator.tabs`); Build Breaker view (`build-breaker.view`); Terminal connection mode (`terminal.connection-mode`) and split pager (`terminal.panes`); Plugin Manager categories (`plugin-manager.categories`) and plugin detail (`plugin-manager.detail`); Systems check views (`systems-check.views`); AI assistant Chats / Archived (`ai-assistant.chats`); Brand library (`brand-library.tabs`); Agent swarm (`agent-swarm.tabs`, `agent-swarm.chat-view`); Agent manager (`agent-manager.tabs`, `agent-manager.detail-view`); Agent voice section (`agent-voice.section`).
- AmberX web: held commands (`approvals.held`, closable), Tasks (`tasks.tabs`), Notes (`notes.tabs`), Web tabs (`web.tabs`, closable), Commands categories + lists (`commands.categories`, `commands.lists`), Voice groups (`voice.groups`).
- Framework: the settings page's tab bar (`settings.tabs`; `tabs-side` lays it down the side with the side-rail starter) and sub-tabs (`settings.subtabs`), Banner settings' banner tabs (`banner-settings.banners`), Asset Studio groups (`asset-studio.groups`), lib-mcp connection tabs (`mcp.connection`), AshesUI parameters (`ashes.params`), layout repeat slots in `tabs` style (`repeat.<slot>`), the chrome settings dialog's own tabs (`chrome.settings.<type>`).
- Kept hand-drawn, with the tab-group id and context target so they still get the menu: the workspace pane strip (`workspace.<id>`, drag-to-dock). The Terminal tab strip (its own drag / window menu) stays in the ratchet baseline.
- Not tab groups, left as option pickers: Standards' severity segments, Plan Studio / orchestrator / to-dos / Notes "Show as" / "Kind" segments, axHub web's "Postpone how".
- Molly and axHub web had no hard-coded tab rows; their nav, toolbar, banner and menu bar are framework chrome and get the block through the framework.

### Rule + CI (s5)
- Rule in `_claude/shared/rules/RULES.md` (Code must conform) and `_claude/rules/RULES.md`; PORTING.md entry (Android twins deferred: Compose `AxfTabGroup`, `ChromeSettingsRules`, the dialog).
- `cli/check-chrome-assets.mjs` (CI): hand-made tab rows (`tab-row`), `<Segmented>` used as tabs (`tab-seg`), `<nav>` without a settings id (`nav`), banners outside the banner frame (`banner`), plus check-toolbars' findings (`toolbar`). Ratchet `spec/chrome-baseline.json`: 25 findings left in 18 app files (15 navs = breadcrumbs / section lists in plugins, 13 banner-named cards drawn inside the frame, the Terminal strip's 2); counts only go down. The framework itself is clean.
- CI lines in `.github/workflows/android.yml`: `check-tab-group.mts`, `check-chrome-settings.mts`, `chrome-settings.mjs check`, `check-chrome-assets.mjs`.
- Voice: the `chrome.*` actions are registered with labels and `params`, so they sit in the console catalog (`console.actions`) and Amber runs them through `console_action` (e.g. `chrome.set:tab-group:ui-review.sections:style:pills`, `chrome.move:nav-menu:app:right`, `chrome.interface:toolbar:custom`).

## Audit: every chrome instance, before → after

Columns: asset type · settings interface is an asset · right-click Settings / Change / Move. ✓ = yes, ✗ = no, ~ = partly.

| Instance (app) | Kind | Asset before → after | Settings-interface asset before → after | Right-click before → after |
|---|---|---|---|---|
| UI Review categories (console) | tab group | ✗ chips row → ✓ `tab-group` | ✗ → ✓ `chrome-tab-group` | ✗ → ✓ |
| UI Review Review / Screenshots (console) | tab group | ✗ Segmented → ✓ | ✗ → ✓ | ✗ → ✓ |
| Build manager views (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Plan Studio tabs (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Build orchestrator tabs (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Build Breaker view (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Terminal connection mode, split pager (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Terminal tab strip (console) | tab group | ✗ → ✗ (baseline; its own drag + window menu) | ✗ → ✗ | own menu → own menu |
| Plugin Manager categories, detail tabs (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Systems check views (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| AI assistant Chats / Archived (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Brand library, Agent swarm ×2, Agent manager ×2, Agent voice (console) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Settings page tab bar + sub-tabs (every app) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Banner settings tabs, Asset Studio, lib-mcp, AshesUI, repeat slots (framework) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| Workspace pane strip (framework lib) | tab group | ✗ → ~ (hand-drawn, carries the id + target) | ✗ → ✓ | pane menu → pane menu + chrome block |
| Window tab groups (framework windows) | tab group | ✓ → ✓ | ✗ → ✓ | Undock / Split → + Settings / Change / Move |
| Held commands, Tasks, Notes, Web tabs, Commands ×2, Voice (AmberX) | tab group | ✗ → ✓ | ✗ → ✓ | ✗ → ✓ |
| App toolbar (console, Molly, axHub web, AmberX) | toolbar | ✓ `toolbar` → ✓ | ✗ (lib-toolbars settings tab) → ✓ `chrome-toolbar` | Arrange widgets → + Settings / Change / Move |
| Plugin toolbars (`role="toolbar"`, every app) | toolbar | ~ (framework toolbar behaviour, no asset) → ~ | ✗ → ✓ (instance = its settings id) | ✗ → ✓ Settings / Change / Move |
| App banner (every app) | banner | ✓ `banner` → ✓ | ✗ (Banner settings dialog) → ✓ `chrome-banner` (wraps Banner settings) | Banner settings + Hide → + Settings / Change |
| Plugin banners in the frame (console, Molly, AmberX) | banner | ✓ BannerDef in the frame → ✓ | ✗ → ✓ | Banner settings + Hide → + Settings / Change |
| Navigation menu (every app; NavMenu / NavTree) | nav-menu | ✓ `nav-menu` → ✓ | ✗ (nav-style settings for opted-in navs) → ✓ `chrome-nav-menu` | item menu only → + Settings / Change / Move (left / right / top) |
| Other `<nav>` elements in plugins (15, baseline) | nav | n/a (breadcrumbs, section lists) | ✗ → ✓ when right-clicked (implicit target) | ✗ → ✓ |
| Application menu bar (every app) | app-menu | ✓ `app-menu` → ✓ | ✗ → ✓ `chrome-app-menu` | ✗ → ✓ Settings / Change |
| Context menu (every app) | context-menu | ✓ `context-menu` → ✓ | ✗ → ✓ `chrome-context-menu` (through `chrome.settings:context-menu:app`) | n/a |

Per-app custom settings interfaces (addendum 2): console (`axf-console`), Molly, axHub web, AmberX, Expenses — six each, all `extends` the shared default; the default is selected by default (addendum 3).

## Checks

| Check | Result |
|---|---|
| `npx -y tsx framework/spec/check-tab-group.mts` | ✓ 444 checks |
| `npx -y tsx framework/spec/check-chrome-settings.mts` | ✓ 270 checks |
| `npx -y tsx framework/spec/check-customize.mts` | ✓ 163 checks |
| `npx -y tsx framework/spec/check-settings-ui.mts` | ✓ 55 checks |
| `npx -y tsx framework/spec/check-tapconfirm.mts` | ✓ 40 checks |
| `node framework/cli/chrome-settings.mjs check` | ✓ 5 apps × 6 types |
| `node framework/cli/check-chrome-assets.mjs` | ✓ 400 files, 25 left over in 18 files (baseline) |
| `node framework/cli/check-theme.mjs` / `check-controls.mjs` / `check-toolbars.mjs` | ✓ |
| `node framework/cli/axf.mjs validate --framework` + the four apps | ✓ |
| `npx tsc --noEmit` in apps/console-web, amberx-droid, axhub-web, molly (re-baked with `rebake.mjs apply`) | ✓ 0 errors in each (Molly checked with the console's TypeScript: its node_modules is not installed in this sandbox) |

## Screenshots

UI Review → Screenshots, group **"tab-group-assets - Nov 4 11:38 AM"** (nine shots, console app, screen ui-review; built console served by `vite preview` with `/api/me` + the UI Review items stubbed, Playwright Chromium, desktop 1280×800 and phone 412×915 with touch). Files: `_claude/builds/reports/tab-group-assets/shots/`.

| Shot | What it shows |
|---|---|
| `desktop-ui-review.png`, `phone-ui-review.png` | UI Review: Review / Screenshots and the category row are TabGroups (underline, count badges), the row Brett pointed at |
| `desktop-ui-review-right-click.png`, `phone-ui-review-right-click.png` | right-click / long-press on the category row: **Tab group settings…**, **Change tab style…**, **Move ▸** first, then the other context items |
| `desktop-tab-group-settings.png`, `phone-tab-group-settings.png` | the Chrome settings dialog for `ui-review.sections`, laid out by `settings/chrome-tab-group`: level bar, Look / Behaviour / Asset / Interface tabs (themselves a TabGroup), every field at its asset value |
| `desktop-tab-group-settings-chips.png`, `phone-tab-group-settings-chips.png` | Tab style → Chips: the row behind the dialog restyles live, "Set for this one" and Reset appear |
| `desktop-tab-group-asset-picker.png` | the Asset tab: the app's tab style plus every tab-group starter for this one row |

## Known gaps
- Expenses runs its own vendored `@axf/core` line (not asset@1 files): its six custom settings interfaces ship as files under `apps/expenses/src/assets/settings/` for its port; nothing in Expenses reads them yet.
- The Terminal tab strip keeps its own drag and window menu; it is in the ratchet baseline (2 findings).
- Banner `Move` has no positions (a banner is the top bar); the Banner settings dialog stays the richer editor and the chrome dialog links to it.
- Android twins deferred (Android on hold): Compose `AxfTabGroup`, `ChromeSettingsRules`, the dialog (PORTING.md).
- The chrome settings dialog's Interface tab sits at the Developer level (the shared default's `levelOf`), so at Basic it is out of sight until the level bar is raised: by design, noted so nobody looks for it.
