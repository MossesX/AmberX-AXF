/**
 * Application-menu entries (pure data, read by scripts/menu-reach.mts too): Builds → Orchestrator demo (the page with
 * the check-list), Start the demo (the start overlay) and its settings, so the console still reaches them while the
 * toolbar and side navigation are hidden.
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'orchestrator-demo.menu', menu: 'builds', menuLabel: 'Builds', menuOrder: 20, order: 70, items: [
    { id: 'orchestrator-demo', label: 'Orchestrator demo', icon: 'play', action: 'nav:orchestrator-demo' },
    { id: 'orchestrator-demo-start', label: 'Start the orchestrator demo…', icon: 'play', action: 'orchestrator-demo.open' },
    { id: 'orchestrator-demo-settings', label: 'Orchestrator demo settings', icon: 'settings', action: 'settings.open:orchestrator-demo' },
  ] },
];
