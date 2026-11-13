# Assets menu: hide any asset, visible and hidden lists

Build `assets-menu-hide-any-asset-visible`, phase 1 (Opus), branch `claude/assets-menu-hide-any-asset-visible`.

## Brett said (verbatim)

> Brett: (1) Audit every toolbar, tab group, navigation menu and app menu on every console page: each one must offer its own asset settings on long-press/right-click, and the settings must apply. (2) Hide any asset on any page. (3) Context menu gets an 'Assets' entry with two submenus: 'Visible assets' and 'Hidden assets', listing every asset on the page. Each row shows a small icon and a colour for its type (toolbar, tab group, nav menu, banner, widget, grid etc.); hidden ones use a hidden colour. Type colours and the hidden colour are configurable in settings. Pick from the list to hide/unhide. (4) When you right-click an asset, that asset is highlighted on the page while the context menu is open, and it's marked in the Assets list. Full API: list/hide/unhide/highlight via REST, MCP, CLI, voice. Tokens and framework controls only.

## What shipped

- **page-assets@1 engine** `framework/core/engines/page-assets-rules.mjs` (+ `.d.mts`): 8 types (toolbar, tab group, navigation menu, application menu, banner, widget, grid, container), labels, icons, default colours; ids `<type>:<instance>`; the hidden list `axf.assets.hidden` (`<page>|<id>`, page `*` = every page); colours `axf.assets.colour.<type>` / `.hidden` as colour token names only (accent, info, success, warning, danger, muted).
- **Web host** `framework/react/components/PageAssets.tsx`, mounted once by `AppShell`:
  - finds every asset on the page (roles toolbar / tablist / menubar, `nav`, banners, banner widgets, grids / tables, containers, plus anything marked `data-axf-asset="<type>"`); ids come from settings ids, data ids or accessible names, never from text that changes (a clock);
  - hides in place (`data-axf-asset-hidden`, the element stays mounted, so its state survives);
  - the right-clicked or long-pressed asset is lit in its type colour while the menu is open (`data-axf-asset-highlight`) and marked (`is-current`, `aria-current`) in the list;
  - every context menu gets **Assets ▸** with *Hide this <kind>* (when opened on one), **Visible assets (n) ▸** and **Hidden assets (n) ▸** (+ *Show all*). Each row has the type icon and a type-colour swatch; hidden rows use the hidden colour. Picking a row hides or shows it.
- **MenuItem** gets `swatch` (a colour token name) and `current`; `MenuList` renders them.
- **Settings → Appearance → Assets list colours**: one framework `SelectField` per type + Hidden.
- **(1) audit fixes** found by right-clicking every toolbar, tab row, nav and menu bar on 36 console pages:
  - the application menu bar sits in the frame outside `.fx-shell`, so right-click opened nothing on any page: it now opens its menu like a banner does (`Overlays.tsx`);
  - a toolbar / tab row / nav that names its own menu target (e.g. the Settings level toolbar) had no Settings / Change / Move block: `*:chrome` now falls back to the chrome piece the menu was opened on (`ChromeContext.tsx`).
  - Result: 36 / 36 pages, every chrome piece offers its own settings, the Assets entry, and lights up. Whether each setting *applies* is the parallel build `fix-toolbar-settings-doing-nothing`; not re-done here.
- CSS (`framework/ui/axf.css`): tokens only (`--fx-*` colours, `--fx-border-w`, `--fx-radius-sm`, `--fx-type-scale-sm`, `--fx-dens-gap-*`).

## How each part is reached (API)

| What | REST | MCP | CLI | Voice (Amber) |
| --- | --- | --- | --- | --- |
| List assets + hidden state | `GET /api/console/where` → `here.assets` | `console_where` | `console.mjs where` | "what's on this page" → console_where |
| Hide / show / toggle | `POST /api/console/action {id: "assets.hide", args: [type, instance, "all"?]}`; also `assets.unhide`, `assets.toggle`, `assets.unhide-all` | `console_action assets.hide args [type, instance]` | `console.mjs action assets.hide toolbar home-cards` | console_action |
| Highlight | `assets.highlight:<type>:<instance>[:<ms>]`, `assets.highlight:off` | same | same | same |
| Colours | `assets.colour:<type|hidden>:<colour|default>` | same | same | same |
| Open it (deep link) | `assets.open` (context menu holding Assets), `settings.open:appearance` (colours) | `console_action assets.open`, `console_settings appearance` | `console.mjs action assets.open` | same |
| Summary | `assets.list` (toast) | same | same | same |

Documented in `framework/spec/CONTROL.md` (Targets section) and the `console_where` MCP docstring.

## Checks

- `node framework/spec/check-page-assets.mjs` — new, in CI (`android.yml` web checks): ids, hidden list per page / every page, colour tokens only, `here.assets`.
- `check-theme`, `check-controls`, `check-toolbars`, `check-chrome-assets`: pass.
- `check-console-commands.mts` (101), `check-control.mts` (369), `check-chrome-settings.mts` (282), `check-app-menu.mts` (124), `check-tapconfirm.mts`, `check-banner-hide.mts`, `check-asset-overrides.mjs`, console-commands `test.mjs`: pass.
- console-web `tsc --noEmit` + `vite build`: pass.
- Browser (Playwright on the built console, hub off): right-click lights the toolbar and marks its row; Hide this toolbar → gone, listed under Hidden in the hidden colour; Show → back; phone long-press on a container opens the menu with the container lit; the Settings colour picker changes a swatch.

## Open / deferred

- Android twin (`PageAssetsRules.kt` + Compose) deferred, recorded in `framework/spec/PORTING.md`.
- No fixture yet (web check only); a Fable review can promote it to `spec/fixtures/page-assets.json`.
- Hovering a row does not light its asset yet (only the right-clicked one and API highlights do).
- The baked framework copy in `apps/console-web/src/axf` is updated for the touched files only; other apps re-bake through CI as usual.
