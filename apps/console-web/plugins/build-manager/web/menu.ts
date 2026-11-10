/** Application-menu entries this plugin adds (pure data: also read by apps/console-web/scripts/menu-reach.mts). */
import type { AxfWebLibrary } from '@console/axf/react/library';

/** Live list provider id (kept for the app-menu provider registration). */
export const REMAINING = 'build-manager.remaining';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'build-manager.builds', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 5, items: [
    { id: 'build-manager', label: 'Build manager', icon: 'play', action: 'nav:build-manager' },
    { id: 'pending', label: 'Pending', icon: 'clock', action: 'build-manager.pending' },
    { id: 'complete', label: 'Complete (account, cost, PR)', icon: 'check-circle', action: 'build-manager.complete' },
  ] },
  { id: 'build-manager.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'build-manager', label: 'Build manager', icon: 'play', action: 'nav:build-manager' }] },
];
