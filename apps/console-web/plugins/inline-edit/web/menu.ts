/** Application-menu entries (pure data; read by scripts/menu-reach.mts too). */
import type { AxfWebLibrary } from '@console/axf/react/library';

export const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [
  { id: 'inline-edit.menu', menu: 'plugins', menuLabel: 'Plugins', menuOrder: 40, order: 50, items: [{ id: 'inline-edit', label: 'Inline edit', icon: 'edit', items: [
    { id: 'inline-edit.mode', label: 'Inline edit mode', icon: 'edit', action: 'inline-edit.mode.toggle', checked: 'setting:axf.inline-edit.mode' },
    { id: 'inline-edit.overrides', label: 'Overrides list', icon: 'layers', action: 'nav:inline-edit-overrides' },
    { id: 'inline-edit.settings', label: 'Inline edit settings', icon: 'settings', action: 'settings.open:inline-edit' },
  ] }] },
  { id: 'inline-edit.view', menu: 'view', menuLabel: 'View', menuOrder: 60, order: 40, items: [
    { id: 'inline-edit.view-mode', label: 'Inline edit mode', icon: 'edit', action: 'inline-edit.mode.toggle', checked: 'setting:axf.inline-edit.mode' },
  ] },
];
