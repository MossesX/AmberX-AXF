<!-- memory-chunk@1 source=_claude/memory/STATUS.md lines=236-243 tokens=191 -->
## Menus stay on screen and scroll (Nov 3 2026, menu-scroll, Opus; branch `claude/menu-scroll`)
menu-fit@1: `framework/core/engines/menufit.ts` (pure `fitMenu` / `menuBox`; checks `spec/check-menu-fit.mts`, in CI) and
`framework/react/components/menuFit.ts` (visual viewport + safe areas + `--fx-layout-phone-edge`; `useMenuFit`,
`installMenuFit` for self-placed plugin ⋯ menus, `focusMenuItem`). App menu drop-downs, submenus (placed in the parent
menu box, `.fx-menu__li` static), context menus and plugin ⋯ menus flip / shift to stay on screen and only then scroll,
with `data-fx-more` fade + chevron hints and contained overscroll. Re-baked console, axHub web, AmberX, Molly. Android
twin deferred (PORTING.md). Report `_claude/builds/reports/menu-scroll.md`.
