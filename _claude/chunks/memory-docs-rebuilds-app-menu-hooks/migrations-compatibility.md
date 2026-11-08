<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=85 -->
## Migrations / compatibility

- No asset changes required. Apps that never contribute see the exact menus they had.
- Apps rendering their own menubar can keep `useAsset('app-menu')`; to see contributions they read `rt.appMenu()`.
- Baked copies (`apps/console-web/src/axf`) were re-baked in this branch; `apps/demo` keeps its older bake.
