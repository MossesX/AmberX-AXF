/*
 * The console's own application-menu contributions (pure data, no React, no CSS), shared by the console menu library
 * (src/menuLibrary.tsx) and the reachability check (scripts/menu-reach.mts). The static menus live in the app-menu
 * asset `console` (src/assets/app-menu/console.json); plugins add their own entries from `plugins/<folder>/web/menu.ts`.
 *
 * Live lists the console registers (filled when their submenu opens, capped with "More…" opening the full view):
 *   console.pending       open pending builds            → Pending builds (row flashed)
 *   console.queue         build-queue steps not done     → Build queue (row flashed)
 *   console.features      plan features not built yet    → the feature in its own window
 *   console.libraries     installable libraries          → Libraries (row flashed)
 *   console.modules       framework modules              → Modules & packages (row flashed)
 *   console.boilerplates  boilerplates                   → Boilerplates (row picked)
 *   console.plugins       every bundled plugin           → Plugin Manager (or Settings → Plugins)
 */
import { chromeToggleItems, type AppMenuContribution } from './axf/core/engines/appmenu';

/** Library id of the console menu (its contributions and providers leave with it). */
export const CONSOLE_MENU_ID = 'ai.amberx.axf.console.menu';

/** Chrome the View menu can show or hide with a check mark (the app menu itself is never offered: it can't bring itself back). */
export const CHROME_TOGGLES = ['toolbar', 'nav-menu', 'banner'] as const;

export const CONSOLE_PROVIDERS = {
  pending: { id: 'console.pending', max: 12, moreAction: 'nav:pending', moreLabel: 'All pending builds…' },
  queue: { id: 'console.queue', max: 12, moreAction: 'nav:build', moreLabel: 'The whole build queue…' },
  features: { id: 'console.features', max: 12, moreAction: 'nav:plan', moreLabel: 'Every feature in the Plan…' },
  libraries: { id: 'console.libraries', max: 14, moreAction: 'nav:libraries', moreLabel: 'All libraries…' },
  modules: { id: 'console.modules', max: 14, moreAction: 'nav:modules', moreLabel: 'All modules…' },
  boilerplates: { id: 'console.boilerplates', max: 14, moreAction: 'nav:boilerplates', moreLabel: 'All boilerplates…' },
  plugins: { id: 'console.plugins', max: 30, moreAction: 'settings.open:plugins', moreLabel: 'Settings → Plugins…' },
} as const;

/** Runtime counter: pending builds not complete (badge on Builds → Pending builds). */
export const PENDING_BADGE = 'pending.open';

/** The console's own contributions (the chrome toggles come from the framework's `chromeToggleItems`). */
export const consoleMenuContributions: Omit<AppMenuContribution, 'module'>[] = [
  {
    id: 'console.menu.chrome', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 1,
    items: chromeToggleItems([...CHROME_TOGGLES], { toolbar: 'Toolbar', 'nav-menu': 'Side navigation', banner: 'Banner' }),
  },
  {
    id: 'console.menu.chrome-all', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 5,
    items: [{ id: 'chrome-all', label: 'All bars and menus', icon: 'layout', provider: 'chrome' }],
  },
];
