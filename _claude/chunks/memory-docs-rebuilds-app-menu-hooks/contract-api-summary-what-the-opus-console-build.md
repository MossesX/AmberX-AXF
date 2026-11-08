<!-- memory-chunk@1 source=_claude/memory/docs/rebuilds/app-menu-hooks.md tokens=208 -->
## Contract / API summary (what the Opus console build uses)

```ts
// AxfWebLibrary
appMenu?: { id; menu?; menuLabel?; menuOrder?; path?: (string | {id,label?,icon?})[]; order?; before?; after?; items: MenuItem[] }[]
appMenuProviders?: Record<string, (() => MenuItem[] | Promise<MenuItem[]>) | { items; max?; moreAction?; moreLabel? }>
// MenuItem extras
{ provider?: string; badge?: string; checked?: 'setting:<key>'|'counter:<name>'|'slot:<type>'|'hidden:<type>'; order?: number; before?: string; after?: string }
// runtime
rt.addAppMenuItems(c); rt.removeAppMenuItems(moduleOrId); rt.registerAppMenuProvider(id, fnOrSpec) → remover;
rt.appMenu() → { menus: [{ id, label, origin, items: CompiledMenuItem[] }], conflicts, notes };
await rt.loadAppMenuProvider(id) → CompiledMenuItem[]; rt.dispatch('slot.hide:toolbar:toggle')
```
