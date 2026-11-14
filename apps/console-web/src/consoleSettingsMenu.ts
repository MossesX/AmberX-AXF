/**
 * Console settings on top of every right-click / long-press menu (context-lead@1, framework/core/engines/windows.ts).
 *
 * Every context menu the console shows, on any screen or plugin (plugins draw inside the console shell), starts
 * with "Console settings", then a separator, then the page's own entries. The entry runs `app.settings`, so the
 * context-menu asset's own Settings item (Amber has one at the bottom) is folded into it instead of showing twice.
 * `console.settings.open` is the same thing under the name people say: search, voice, MCP and the CLI reach it through
 * console.actions (`run console.settings.open`).
 */
import { CONTEXT_LEAD_PREFIX, type AxfRuntime, type HelpData, type MenuEntry } from './axf/core';

export const CONSOLE_SETTINGS_LEAD = `${CONTEXT_LEAD_PREFIX}console-settings`;
export const CONSOLE_SETTINGS_ACTION = 'console.settings.open';
export const CONSOLE_SETTINGS_ENTRY: MenuEntry = { id: 'console-settings', label: 'Console settings', icon: 'settings', action: 'app.settings' };

/** Help mode: the menu entry (by its label) and the named action. */
export const CONSOLE_SETTINGS_HELP: HelpData = {
  scope: 'console',
  entries: [
    { target: 'console-settings', title: 'Console settings', kind: 'menu-item', text: 'Always the first entry of every right-click or long-press menu, on every screen and plugin. Opens the console\'s Settings.', tryIt: 'Right-click anywhere (long-press on a phone) and pick Console settings.', related: ['view:settings'] },
    { target: `action:${CONSOLE_SETTINGS_ACTION}`, title: 'Console settings', kind: 'menu-item', text: 'Opens the console\'s Settings. Also reachable by voice ("console settings"), search, MCP and the CLI.', related: ['view:settings'] },
  ],
};

/** Register the lead entry and its named action. Idempotent; returns the undo. */
export function installConsoleSettingsMenu(rt: AxfRuntime): () => void {
  rt.contextExtras.set(CONSOLE_SETTINGS_LEAD, () => [CONSOLE_SETTINGS_ENTRY]);
  const off = rt.actions.register('console.settings.open', () => { rt.dispatch('app.settings'); }, { label: 'Console settings' });
  return () => { rt.contextExtras.delete(CONSOLE_SETTINGS_LEAD); off(); };
}
