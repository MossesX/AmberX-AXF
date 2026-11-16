# Assets menu: hide any asset, hidden list to bring them back

Build `assets-menu-hide-any-asset-hidden-list`, phase 1 (Opus), branch `claude/assets-menu-hide-any-asset-hidden-list`.
Rebuild of `assets-menu-hide-any-asset-visible` (PR #583, closed unmerged Nov 16 2026; its branch was deleted in cleanup).

## Brett said (verbatim)

> What happened to that build where I could hide anything? I could click a menu and it would show all the assets, hide them, and they'd move to hidden. Rebuild it.

## What happened

PR #583 was built and green but closed without merging on Nov 16 2026, and its branch was deleted in a cleanup. None of it ever reached main. The commits were still on GitHub as `pull/583/head`, so this build cherry-picks the four code commits onto current main, resolves the three conflicts (union merges in `libs/settings`, `react/index.ts`, `ui/axf.css`) and adds what the new brief asks for.

## What shipped

- **Restored (from #583):** page-assets@1 engine (`framework/core/engines/page-assets-rules.mjs`) and the web host (`framework/react/components/PageAssets.tsx`, mounted by `AppShell` in every framework app). It covers 8 asset types: toolbar, tab group, nav, app menu, banner, widget, grid and container. Every context menu (right-click or long-press) gets **Assets ▸** with *Hide this ‹kind›*, **Visible assets (n) ▸** and **Hidden assets (n) ▸** (+ Show all); tapping a row hides or shows it. The asset you right-click lights up while its menu is open. Type colours and the hidden colour are in Settings → Appearance. Chrome audit fixes: the menu bar opens its context menu, and own-target toolbars keep Settings / Change / Move.
- **New: saved per app in the look on axHub.** `axf.assets.` is now an appearance setting prefix (`framework/core/engines/designpackage.ts`), so the hidden list and colours go to the app's app-look@1 `own.settings` on axHub, come back on reload, and stay separate for each app. `check-page-assets.mjs` checks for the prefix.
- **New: View ▸ Assets…** (opens the Assets menu, `assets.open`) and **View ▸ Hidden assets…** (opens Settings → Appearance) in the menu bar.
- **New: Settings → Appearance → Assets** (`PageAssetsList`): a **Visible** list of every asset showing in the app (it scrolls and lights each asset on hover; Hide hides it on every page) and a **Hidden** list of every hidden entry from any page, each with Show, plus Show all.
- **New: Hide in each asset's settings dialog** (`ChromeSettingsPanel` header). It hides that piece on the page it was opened from.
- `assets.unhide:<type>:<instance>[:<page>]`: the optional page lets Settings show an asset that was hidden on a different page.
- Fixed in passing: the Claude settings tab row had no literal id, so `check-console-control` was red on main. It now has one.

## How each part is reached

| What | REST | MCP | CLI | Voice |
| --- | --- | --- | --- | --- |
| List (visible + hidden) | `GET /api/console/where` → `here.assets` | `console_where` | `console.mjs where` | "what's on this page" |
| Hide / show / toggle | `POST /api/console/action {id:"assets.hide", args:[type, instance, "all"?]}`, `assets.unhide` (+ page), `assets.toggle`, `assets.unhide-all[:all]` | `console_action assets.hide …` | `console.mjs action assets.hide toolbar home-cards` | console_action |
| Open the menu (deep link) | `assets.open`; `settings.open:appearance` | `console_action assets.open` / `console_settings appearance` | `console.mjs action assets.open` | same |
| Highlight / colours | `assets.highlight:…`, `assets.colour:…` | same | same | same |

Docs: `framework/spec/CONTROL.md` (page assets paragraph).

## Checks

- `node apps/console-web/scripts/page-assets.e2e.mjs` (new, against `vite preview` of dist): Settings lists the assets, Hide moves one to Hidden and off the page, the change is saved, it is still hidden after a reload, and Show brings it back. 7/7.
- console-web `tsc --noEmit` and `vite build`: pass.
- check-theme, check-controls, check-toolbars, check-chrome-assets, check-console-control, chrome-settings check: pass.
- spec: check-page-assets, check-chrome (130), check-chrome-settings (304), check-chrome-apply (174), check-skin (500), check-look-migration (241), check-skin-switch (392), check-settings-ui, check-settings-open, check-design-package (1158), check-hub-look (110), check-console-commands (101), check-control (396), check-menu-fit, check-banner-hide, check-app-menu, check-asset-overrides, check-skin-config, check-component-tokens: pass.
- Screenshot: UI Review → Screenshots `s-20261116-ff2cc7de` (saved locally; this session has no console token, so it was not uploaded).

## Merged in

- `hide-any-ui-asset-global-context-menu` (pending, added the same minute from the same request) asked for the same thing: a Hide entry in every asset's context menu in every app, plus an Assets menu. This build covers it, so its steps are ticked here.

## Open / deferred

- The Android twin is still deferred (`framework/spec/PORTING.md`, page assets row).
- Hiding from Settings applies to every page; hiding from the context menu or a settings dialog applies to the current page only. Both show up in the Hidden list.
- Other apps (axHub web, AmberX) pick up the framework change on their next re-bake.
