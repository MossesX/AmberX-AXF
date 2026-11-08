# Nested menus (Molly plugin)

Brett, Nov 8 2026: "You can optimize navigation and application menu for console with subcategories. That's just way
too long… generate new menus for AmberX, for Molly, for console, and actually generate new nested menus the same exact
way and override the shared."

- **One generator for three apps:** `framework/core/engines/menugen.mjs` (nested-menu@1) turns the live registry
  (Molly's apps, their pages, every plugin's pages, dialogs and settings tabs, the shared menu's actions and live lists)
  into categories → sub categories → items, at most 12 rows per level, with Favourites and Recent on top and a flat
  index for Jump to…. `framework/react/generatedMenus.tsx` runs it in the app; this plugin installs that library under
  Molly's id and adds `MOLLY_APPS` as app entries.
- **Override:** the generated `molly-generated` app-menu and nav-menu assets replace the shared ones while the setting
  is on (default). Off brings the shared menus back; the generated assets stay registered.
- **Control:** `menus.jump`, `menus.open`, `menus.favorite`, `menus.override`, `menus.set`, `menus.get`,
  `menus.outline`, `menus.generate` (plugin-commands@1 → REST, MCP, CLI; voice through the actions bus).
- **Settings:** Settings → Plugins → Menus: General, Categories, Favourites, Recent, Preview (collapsible sections).
- **Offline twin:** `node framework/cli/menu-gen.mjs apps/molly --outline` generates the same menus from the files.
