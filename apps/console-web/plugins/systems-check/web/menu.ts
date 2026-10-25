/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'systems-check.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{
    id: 'systems-check', label: 'Systems check', icon: 'shield',
    items: [
      { id: 'open', label: 'Systems check', icon: 'shield', action: 'system-check.open' },
      { id: 'keys', label: 'Keys needed…', icon: 'key', action: 'keys-needed.open' },
      { id: 'settings', label: 'Systems check settings', icon: 'settings', action: 'settings.open:systems-check' },
    ],
  }] },
  { id: 'systems-check.help', menu: 'help', menuLabel: 'Help', menuOrder: 70, order: 30, items: [{ id: 'systems-check', label: 'Systems check', icon: 'shield', action: 'system-check.open' }] },
];
