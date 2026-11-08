/**
 * Nested menus (AmberX): the framework's generated-menus library (src/axf/react/generatedMenus.tsx, nested-menu@1)
 * under AmberX's plugin id. AmberX's registry is its Approvals page plus every plugin (its own and the console plugins
 * that run here); the library generates `amberx-droid-generated` app-menu and nav-menu assets, swaps them in while the
 * override is on, and gives the same Jump to…, Favourites, Recent, settings sections and commands as the console and
 * Molly. Voice: every `menus.*` action is on the actions bus the voice plugin reads.
 */
import { generatedMenusLibrary } from '../../../axf/react';
import type { AxfWebLibrary } from '../../../axf/react';

const lib = generatedMenusLibrary({
  id: 'ai.amberx.amberx.nested-menus',
  label: 'Nested menus',
  version: '0.1.0',
  appLabel: 'AmberX',
  settingsTab: 'menus',
  builtWith: { model: 'fable', builtAt: '2026-11-08' },
});

export const library: AxfWebLibrary = {
  ...lib,
  menu: { category: 'look', keywords: ['menus', 'navigation', 'generated'] },
};
