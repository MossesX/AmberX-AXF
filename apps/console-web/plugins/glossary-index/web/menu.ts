/**
 * Application-menu entries of the Glossary & Index plugin (pure data: scripts/menu-reach.mts reads this file too).
 */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'glossary-index.menu', menu: 'help', menuLabel: 'Help', menuOrder: 90, order: 20, items: [{ id: 'glossary-index', label: 'Glossary & Index', icon: 'list', action: 'nav:glossary-index' }] },
];
