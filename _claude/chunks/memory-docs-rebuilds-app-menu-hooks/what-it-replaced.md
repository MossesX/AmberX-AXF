<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=93 -->
## What it replaced

Before: `MenuBar` (`framework/react/components/Chrome.tsx`) drew `app-menu` asset menus as they were (`menus[].items`,
one level of flyouts through `MenuList`). Nothing could add to the menu at run time; plugins reached only context
menus (`AxfWebLibrary.contextMenu`, `rt.addContextItems`) and nav sections. No badges, checks or live lists in menus.
