/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Runtime counter: axHub calls waiting for approval (0 while signed out or not an admin). */
export const WAITING = 'approvals.waiting';
/** Live list: each waiting call (opens its review dialog). */
export const WAITING_LIST = 'approvals.list';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'approvals-banner.console', menu: 'console', menuLabel: 'Console', menuOrder: 10, order: 12.5, items: [{ id: 'approvals', label: 'Approvals waiting', icon: 'shield', provider: WAITING_LIST, badge: WAITING }] },
  { id: 'approvals-banner.axhub', menu: 'apps', menuLabel: 'Apps', menuOrder: 50, path: [{ id: 'axhub', label: 'axHub', icon: 'layers' }], order: 10, items: [
    { id: 'waiting', label: 'Waiting for approval', icon: 'shield', provider: WAITING_LIST, badge: WAITING },
    { id: 'check', label: 'Check approvals now', icon: 'refresh', action: 'approvals.check' },
  ] },
  { id: 'approvals-banner.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'approvals-banner', label: 'Approvals banner', icon: 'shield', action: 'settings.open:approvals-banner' }] },
];
