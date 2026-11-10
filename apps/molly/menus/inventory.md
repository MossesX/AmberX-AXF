# Molly menu inventory

Every Molly command and every place it can be reached. The menu bar stays short (Molly, View, Help, plus one menu per
app while xLayout merges their chrome); everything else sits one level down in a sub-menu. Redundant paths are on
purpose: a command can be reached from the menu bar, the navigation, the toolbar, a context menu, the start page,
Settings, or the API (deep link, REST, MCP, CLI, voice).

Sources: Molly's own menu `src/assets/app-menu/molly.json`; plugin contributions (`plugins/*/web/index.tsx` →
`appMenu`, `contextMenu`); the framework's Help menu (help-rules). Plugin rows disappear with their plugin.

## Menu bar

| Menu | Top-level entries | Sub-menu contents |
|---|---|---|
| **Molly** | Start page · Apps ▸ · This app ▸ · Appearance ▸ · Status ▸ · Settings · Account | Apps: AmberX, axHub, Console, Expenses. This app: Reload this app, Open this app on its own. Appearance and Status: see below |
| **View** | Layout ▸ · Navigation ▸ · Banners ▸ · Toolbar designer… | Layout (xLayout): IDE mode, Pane layout…, Open this app in a pane, Open this app in a floating window, xLayout settings…. Navigation: Collapse navigation, Navigation settings…. Banners: Show banners, Banner settings… |
| **Help** | Help mode · Show this screen's intro · Show all screen intros again | — |

Appearance ▸ (inline choices, applied at once, current value beside the label): Skin, Day / night, Density, Text size,
Motion, and Appearance settings…. Status ▸ (live, icon green / amber / red with a tooltip): axHub connection, Look sync,
Account, Approvals waiting. Details: `menus/status-sources.mjs` notes in the PR, `src/molly/status.ts`.

## Every command and its paths

| Command | Action | Menu path | Other paths |
|---|---|---|---|
| Start page | `nav:home` | Molly → Start page | nav Molly; bottom bar (phone) |
| Switch to AmberX / axHub / Console / Expenses | `nav:<app>` | Molly → Apps ▸ | nav Apps; start page "Open in Molly"; nav context menu "Open"; deep link `#/<app>/<route>` |
| Reload this app | `molly.reload` | Molly → This app ▸ | Alt+R; app context menu |
| Open this app on its own | `molly.own-tab` | Molly → This app ▸ | start page "Open on its own"; app context menu |
| Open this app in a pane / floating window | `xlayout.open:pane` / `:floating` | View → Layout ▸ | nav-item context menu (xLayout) |
| IDE mode | `xlayout.ide` | View → Layout ▸ | Settings → Plugins → xLayout |
| Pane layout… | `xlayout.layout` | View → Layout ▸ | Settings → Plugins → xLayout |
| xLayout settings… | `settings.open:xlayout` | View → Layout ▸ | toolbar context menu "Toolbar settings…" |
| Customize toolbar… | `xlayout.customize` | — | toolbar context menu |
| Collapse navigation | `navigation.collapse` | View → Navigation ▸ | nav context menu "Collapse to icons" |
| Navigation settings… | `navigation.settings` | View → Navigation ▸ | nav and nav-item context menus; Settings → Plugins → Navigation |
| Reset navigation | `navigation.reset` | — | nav context menu |
| Show banners | `molly-banners.toggle` | View → Banners ▸ | Settings → Plugins → Banners |
| Banner settings… | `settings.open:banners` | View → Banners ▸ | Settings → Plugins → Banners |
| Toolbar designer… | `toolbar-designer.open:1` | View → Toolbar designer… | toolbar context menu; Settings → Plugins → Toolbar designer |
| Skin (Flagship Day / Night / app's own) | `skin.use:<id>` / `skin.off` | Molly → Appearance ▸ Skin | Settings → Appearance |
| Day / night, density, text size, motion | choice settings | Molly → Appearance ▸ | Settings → Appearance; theme switch in the banner |
| Settings | `app.settings` | Molly → Settings | Ctrl+,; nav Settings; context menus |
| Account | `nav:account` | Molly → Account | nav Account; bottom bar (phone) |
| Help mode | `help.mode` | Help → Help mode | F1; the ? button in the menu bar |
| Screen intro / all intros | `help.intro` / `help.intros.reset` | Help ▸ | — |
| Item settings (behaviour and look of one menu row) | `menu.item.settings` (`menu.item.set` / `menu.item.reset`) | right-click any menu row | control@1 `tokens.menu` |

## Removed

- Flat "Reload this app" / "Open this app on its own" rows at the top level of the Molly menu: now under This app ▸
  (same actions, plus the context menu).
- Ten flat View rows from four plugins: each plugin now contributes one sub-menu (or one row).
- No dead entries were found: every action above is registered by Molly, its plugins or the framework.
