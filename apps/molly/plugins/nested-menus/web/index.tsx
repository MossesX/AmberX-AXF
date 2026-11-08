/**
 * Nested menus (Molly): the framework's generated-menus library (src/axf/react/generatedMenus.tsx, nested-menu@1)
 * under Molly's own plugin id. Molly's registry adds the apps it frames (MOLLY_APPS) as `app` entries, so they land
 * in the Apps category with the pages xLayout hangs under them; everything else (Jump to…, Favourites, Recent,
 * settings sections, context items, commands) is the shared library, generated the same exact way as the console's
 * and AmberX's.
 */
import { generatedMenusLibrary } from '../../../src/axf/react';
import type { AxfWebLibrary } from '../../../src/axf/react/library';
import { MOLLY_APPS } from '../../../src/molly/apps';
import helpPack from '../help.json';

const lib = generatedMenusLibrary({
  id: 'ai.amberx.axf.molly.nested-menus',
  label: 'Nested menus',
  version: '0.1.0',
  appLabel: 'Molly',
  settingsTab: 'menus',
  builtWith: { model: 'fable', builtAt: '2026-11-08' },
  extraSources: () => MOLLY_APPS.map((a) => ({ kind: 'app' as const, view: a.id, action: `nav:${a.id}`, label: a.label, icon: a.icon, keywords: [a.description], module: 'app' })),
});

export const plugin: AxfWebLibrary = {
  ...lib,
  help: helpPack.data as AxfWebLibrary['help'],
  menu: { category: 'look', keywords: ['menus', 'navigation', 'generated'] },
};
