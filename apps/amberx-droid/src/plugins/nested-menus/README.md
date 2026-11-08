# Nested menus (AmberX plugin)

AmberX's menus generated from its registry with the framework's nested-menu@1 generator
(`framework/core/engines/menugen.mjs` + `framework/react/generatedMenus.tsx`), the same code the Dev Console and Molly
use: categories → sub menus → items, at most 12 rows per level, Favourites and Recent on top, Jump to… for the rest.
The generated `amberx-droid-generated` app-menu and nav-menu override the shared assets while the setting is on
(default). Commands `menus.*` reach REST, MCP, the CLI (plugin-commands@1) and voice (the actions bus).
Offline twin: `node framework/cli/menu-gen.mjs apps/amberx-droid --outline`.
