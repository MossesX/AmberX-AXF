import type { AxfRuntime } from './axf/core';

/** Console actions: menus/toolbars/context menus call these by id. The data-dependent ones read the store through `window.__axfConsole` set by App. */
export function registerActions(axf: AxfRuntime) {
  const on = axf.actions.register.bind(axf.actions);
  const store = () => (globalThis as unknown as { __axfConsole?: { exportPlan: () => string; exportStatusJson: () => string; refresh: () => Promise<void> } }).__axfConsole;
  const copy = (text: string, msg: string) => navigator.clipboard?.writeText(text).then(() => axf.toast(msg, 'success', 'Copied'), () => axf.toast('Clipboard not available.', 'warning'));
  on('console.exportPlan', () => copy(store()?.exportPlan() ?? '', 'Build plan copied — paste it into Claude Code.'), { label: 'Export build plan' });
  on('console.exportStatus', () => copy(store()?.exportStatusJson() ?? '{}', 'status.json fragment copied.'), { label: 'Export status.json' });
  on('console.refresh', () => store()?.refresh(), { label: 'Reload data' });
  on('console.openProject', () => axf.openDialog('project'), { label: 'Open project' });
  on('console.install', ([lib = '']) => axf.openDialog('install', { library: lib }), { label: 'Install library' });
  on('console.importUi', ([src = '']) => axf.openDialog('uiimport', { source: src }), { label: 'Import UI library' });
  on('help.about', () => axf.openDialog('about'), { label: 'About' });
  on('view.shortcuts', () => axf.openDialog('shortcuts'), { label: 'Keyboard shortcuts' });
  on('dev.console', () => axf.dispatch('terminal.open'), { label: 'Output terminal', requires: 'dev.tools' });
  on('file.save', () => axf.toast('Console state is saved automatically (browser storage + backend).', 'info'), { label: 'Save' });
  on('run.build', () => axf.navigate('libraries'), { label: 'Build', requires: 'dev.tools' });
}
