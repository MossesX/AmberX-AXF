<!-- memory-chunk@1 source=_claude/memory/docs/console-menu.md lines=8-15 tokens=131 -->
## What the console shows now

- Manifest: `app-menu: console` (new asset), `hidden: ["toolbar", "nav-menu"]`. Users' own choices still win
  (Settings → Appearance, or View → Toolbar / Side navigation).
- The menu bar shows in every console layout (the console's `studio-dock` copy turned `showMenubar` on).
- One-time per browser: if a saved look (the hub's appearance document) still names another app menu, the console
  moves to `console` once; picking another menu afterwards sticks (`axf-console:menu-console-v1`).
