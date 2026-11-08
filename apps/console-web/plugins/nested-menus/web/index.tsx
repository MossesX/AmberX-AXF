/**
 * Nested menus (console): the framework's generated-menus library (src/axf/react/generatedMenus.tsx, nested-menu@1)
 * installed under this plugin's id, plus the lifecycle panel. The library reads the console's live registry (every
 * plugin's pages, dialogs, settings tabs and menu entries), generates `axf-console-generated` app-menu and nav-menu
 * assets and swaps them in while the override setting is on. Everything else (actions, Jump to…, settings panels,
 * context items) comes from the library, so Molly and AmberX get the same behaviour from the same code.
 */
import { generatedMenusLibrary } from '@console/axf/react';
import type { AxfWebLibrary } from '@console/axf/react/library';
import { PluginLifecyclePanel } from '@console/pluginLifecycle';
import { appMenu as ownMenu } from './menu';

const FOLDER = 'nested-menus';
const TAB = 'nested-menus';

const lib = generatedMenusLibrary({
  id: 'ai.amberx.axf.console.nested-menus',
  label: 'Nested menus',
  version: '0.1.0',
  appLabel: 'Console',
  settingsTab: TAB,
  builtWith: { model: 'fable', builtAt: '2026-11-08' },
});

const appMenu: NonNullable<AxfWebLibrary['appMenu']> = [...(lib.appMenu ?? []), ...ownMenu];

export const plugin: AxfWebLibrary = {
  ...lib,
  appMenu,
  menu: { category: 'look', keywords: ['menus', 'navigation', 'generated'] },
  settingsPanels: [
    ...(lib.settingsPanels ?? []),
    { id: `${TAB}.lifecycle`, tab: TAB, title: 'Install & uninstall', icon: 'package', order: 90, render: () => <PluginLifecyclePanel folder={FOLDER} /> },
  ],
};
