/**
 * Application-menu entries this plugin adds (pure data: no React or CSS imports, because the console's reachability
 * check, scripts/menu-reach.mts, reads this file too). Every plugin with a page, dialog or settings tab has one, so
 * the console still reaches it while the toolbar and side navigation are hidden.
 * Top menus: console, builds, framework, plugins, apps, view, help (give menuLabel/menuOrder so another app-menu asset
 * still shows it). A live list = an item with `provider: '<id>'`, registered in index.tsx `appMenuProviders` under
 * an exported constant (see plugins/README.md → App-menu hooks).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'example.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'example', label: 'Example', icon: 'box', action: 'nav:example' }] },
];
