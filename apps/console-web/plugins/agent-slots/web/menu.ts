/**
 * Application-menu entries (pure data: scripts/menu-reach.mts reads this file too). The agent cap has no page of its
 * own: its settings and queue sit in Settings → Plugins → Agent cap (the queue also on the Builds page).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'agent-slots.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 40, items: [{ id: 'agent-slots-settings', label: 'Agent cap and queue', icon: 'layers', action: 'settings.open:agent-slots' }] },
];
