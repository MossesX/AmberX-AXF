/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Runtime counter: decisions waiting for Brett. */
export const WAITING = 'decisions.waiting';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'decision-dialog.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 12.4, items: [{ id: 'decisions', label: 'Decisions waiting for me', icon: 'shield', action: 'decisions.next', badge: WAITING }] },
  { id: 'decision-dialog.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'decision-dialog', label: 'Decision dialog', icon: 'shield', action: 'settings.open:decision-dialog' }] },
];
