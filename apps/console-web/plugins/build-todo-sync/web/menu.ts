/**
 * Application-menu entries of the Build to-do sync plugin (pure data: the console's reachability check,
 * scripts/menu-reach.mts, reads this file too). One entry under Plugins, one under Builds, so the page and the name
 * prompt are reachable while the toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-todo-sync.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'build-todo-sync', label: 'Build to-dos', icon: 'check-circle', action: 'nav:build-todo-sync' }] },
  { id: 'build-todo-sync.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 64, items: [
    { id: 'build-todo-sync.builds.page', label: 'Build to-do lists', icon: 'check-circle', action: 'nav:build-todo-sync' },
    { id: 'build-todo-sync.builds.name', label: 'Name a build…', icon: 'tag', action: 'build-todo-sync.name' },
  ] },
];
